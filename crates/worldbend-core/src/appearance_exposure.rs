//! Product-controlled exposure of appearance controls (consumer stream E1).
//!
//! A receiver (product) selects which material controls its users and their
//! Agents may adjust. Worldbend owns the parameter meaning: stable field
//! semantics, authored versus effective ranges, change costs and the
//! versioned composite mappings. This module resolves a product exposure
//! policy against the actual target capabilities so a receiver can
//! distinguish an unsupported mechanism, a policy-hidden field and a
//! temporarily adapted control — three different facts that must never
//! collapse into one "off" state.
//!
//! The report is a versioned, fingerprinted artifact: receivers pin it like
//! a delivery receipt instead of re-deriving meaning locally.

use crate::appearance::{
    AppearanceDeliveryTarget, GlassField, GlassMaterial, MAX_GLASS_DEPTH, MAX_GLASS_RADIUS,
    WEB_DEPTH_EFFECTIVE_MAX, WEB_RIM_AT_EFFECTIVE_MAX,
};
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{ErrorCode, TransformError, TransformResult};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};

pub const APPEARANCE_EXPOSURE_POLICY_SCHEMA: &str = "worldbend.appearance-exposure-policy@0.1";
pub const APPEARANCE_EXPOSURE_REPORT_SCHEMA: &str = "worldbend.appearance-exposure@0.1";
pub const APPEARANCE_EXPOSURE_VERSION: &str = "0.1";
/// Composite control id a policy may expose instead of (or beside) `radius`.
pub const CLARITY_CONTROL_ID: &str = "clarity";
/// Version of the clarity→frost mapping. Changing the curve bumps this.
pub const CLARITY_MAPPING_VERSION: &str = "1";
/// Default frost ceiling for the clarity composite when the policy does not
/// narrow the radius range. Generous authored bounds are resource ceilings,
/// not visually useful control ranges; 64 logical px already saturates frost
/// on typical control surfaces.
pub const DEFAULT_CLARITY_RADIUS_MAX: f64 = 64.0;

fn schema_error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

/// What changing one exposed control costs the receiving surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceChangeCost {
    /// Applies within the live rendering path; no rebake or new assets.
    Live,
    /// Requires regenerating a derived artifact before it shows.
    Rebake,
    /// Requires producing or fetching new source assets.
    Asset,
}

/// The shape of one control surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceControlKind {
    Toggle,
    Scalar,
    Composite,
}

/// Default value of a control: the family default, not a product decision.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceControlDefault {
    Toggle(bool),
    Number(f64),
}

/// How a control currently exists for the receiver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceControlState {
    /// Selected by policy and actually drivable on the current target.
    Exposed,
    /// Implemented by the family but not selected by the product policy.
    NotExposed,
    /// No honest implementation exists on this target; not a temporary state.
    Unsupported,
    /// Exposed by policy but temporarily degraded by the runtime (for
    /// example a browser without SVG backdrop filters). The saved preference
    /// keeps driving canonical state; presentation catches up when the
    /// runtime can render it again.
    Adapted,
}

/// One control the product chooses to expose, optionally narrowed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceExposedControl {
    /// A glass field id or the composite `clarity`.
    pub field: String,
    /// Optional product-facing label; meaning stays owned by the field id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Narrow the authored range for this product. Must stay inside it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
}

/// Product exposure policy: what this product lets users and their Agents
/// adjust. Owned by the receiver, versioned independently of the design
/// recipe and of any user preference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceExposurePolicy {
    #[schemars(schema_with = "policy_schema")]
    pub schema: String,
    #[schemars(schema_with = "policy_version_schema")]
    pub version: String,
    /// Monotonic ordering token for policy changes; not a content hash.
    #[schemars(range(min = 1))]
    pub policy_revision: u64,
    /// Currently `glass`; typed controls exist only for the glass family.
    pub family: String,
    pub target: AppearanceDeliveryTarget,
    /// Product scope ids this policy covers (for example surface roles).
    pub scopes: Vec<String>,
    /// May be empty: a product can expose nothing and stay design-locked.
    pub exposed: Vec<AppearanceExposedControl>,
}

fn policy_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_EXPOSURE_POLICY_SCHEMA })
}

fn policy_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_EXPOSURE_VERSION })
}

/// Runtime capability of the receiving target. This is observable state, not
/// policy: a browser either supports SVG backdrop filters or it does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceOpticsMode {
    /// Web receiver with SVG backdrop-filter optics.
    SvgOptics,
    /// Web receiver fallback: frost only, no displacement/dispersion.
    FrostOnly,
    /// SwiftUI system Liquid Glass: only visibility has a real setter.
    SystemGlass,
    /// SwiftUI explicit Metal optics driven by the kernel inputs.
    ExplicitOptical,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceRuntimeState {
    pub optics: AppearanceOpticsMode,
}

/// One resolved control row: meaning plus current availability.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceExposureRow {
    pub field: String,
    pub state: AppearanceControlState,
    /// Why the row has this state, in receiver-reportable words.
    pub reason: String,
    pub kind: AppearanceControlKind,
    pub unit: String,
    /// Which way the value moves the material.
    pub direction: String,
    /// Authored acceptance range of the family field.
    pub authored_min: f64,
    pub authored_max: f64,
    /// Range after policy narrowing; equals authored when not narrowed.
    pub effective_min: f64,
    pub effective_max: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    pub default: AppearanceControlDefault,
    pub cost: AppearanceChangeCost,
    /// Other channels this control intentionally influences.
    pub depends_on: Vec<String>,
    pub note: String,
}

/// The versioned composite mapping behind a `clarity` control.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ClarityMappingReceipt {
    pub version: String,
    /// `radius = min + (max - min) * (1 - clarity)`, clamped to the range.
    pub formula: String,
    pub maps_to: String,
    /// Effective frost range the composite drives, in logical px.
    pub range_min: f64,
    pub range_max: f64,
    pub note: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceExposureReport {
    #[schemars(schema_with = "report_schema")]
    pub schema: String,
    #[schemars(schema_with = "report_version_schema")]
    pub version: String,
    pub family: String,
    pub target: AppearanceDeliveryTarget,
    pub policy_revision: u64,
    pub scopes: Vec<String>,
    /// Every family control plus anything the policy named: supported,
    /// hidden, unsupported and adapted states are all explicit here.
    pub controls: Vec<AppearanceExposureRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clarity: Option<ClarityMappingReceipt>,
    /// Content identity of this report; pin it like a delivery receipt.
    pub fingerprint: String,
}

fn report_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_EXPOSURE_REPORT_SCHEMA })
}

fn report_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_EXPOSURE_VERSION })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceExposureInput {
    pub policy: AppearanceExposurePolicy,
    pub runtime: AppearanceRuntimeState,
}

fn field_unit(field: GlassField) -> &'static str {
    match field {
        GlassField::Visible => "toggle",
        GlassField::LightIntensity | GlassField::Refraction | GlassField::Dispersion => "ratio",
        GlassField::LightAngle => "degrees",
        GlassField::Depth | GlassField::Radius => "logical-px",
    }
}

fn field_direction(field: GlassField) -> &'static str {
    match field {
        GlassField::Visible => "on shows the material; off removes only the optical layer",
        GlassField::LightIntensity => "higher strengthens the edge highlight",
        GlassField::LightAngle => "rotates the lit edge; 0 down, 90 left, 180 up, 270 right",
        GlassField::Refraction => "higher displaces more backdrop at the rim",
        GlassField::Depth => "higher widens the refracting rim",
        GlassField::Dispersion => "higher separates red/green/blue more",
        GlassField::Radius => "higher frosts more spatial detail",
    }
}

fn field_default(field: GlassField, family_default: &GlassMaterial) -> AppearanceControlDefault {
    match field {
        GlassField::Visible => AppearanceControlDefault::Toggle(family_default.visible),
        GlassField::LightIntensity => {
            AppearanceControlDefault::Number(family_default.light_intensity)
        }
        GlassField::LightAngle => AppearanceControlDefault::Number(family_default.light_angle),
        GlassField::Refraction => AppearanceControlDefault::Number(family_default.refraction),
        GlassField::Depth => AppearanceControlDefault::Number(family_default.depth),
        GlassField::Dispersion => AppearanceControlDefault::Number(family_default.dispersion),
        GlassField::Radius => AppearanceControlDefault::Number(family_default.radius),
    }
}

fn authored_range(field: GlassField) -> (f64, f64) {
    match field {
        GlassField::Visible => (0.0, 1.0),
        GlassField::LightIntensity | GlassField::Refraction | GlassField::Dispersion => (0.0, 1.0),
        GlassField::LightAngle => (0.0, 360.0),
        GlassField::Depth => (1.0, MAX_GLASS_DEPTH),
        GlassField::Radius => (0.0, MAX_GLASS_RADIUS),
    }
}

fn validate_scalar_bounds(
    field: &str,
    value: Option<f64>,
    bound: f64,
    kind: &str,
) -> TransformResult<f64> {
    let Some(value) = value else {
        return Ok(bound);
    };
    if !value.is_finite() {
        return Err(schema_error(format!(
            "exposure bound {kind} for `{field}` must be finite"
        )));
    }
    Ok(value)
}

/// Validate the policy shape: known family, known fields, narrowed ranges
/// inside the authored range, and scope ids that can name an instance.
pub fn validate_appearance_exposure_policy(
    policy: &AppearanceExposurePolicy,
) -> TransformResult<()> {
    if policy.schema != APPEARANCE_EXPOSURE_POLICY_SCHEMA
        || policy.version != APPEARANCE_EXPOSURE_VERSION
    {
        return Err(schema_error(
            "exposure policy must declare worldbend.appearance-exposure-policy@0.1",
        ));
    }
    if policy.policy_revision < 1 {
        return Err(schema_error("policyRevision must be >= 1"));
    }
    if !policy.family.trim().eq_ignore_ascii_case("glass") {
        return Err(schema_error(
            "exposure policy family must be `glass`; typed controls exist only for the glass family today",
        ));
    }
    if policy.scopes.is_empty() {
        return Err(schema_error("exposure policy needs at least one scope id"));
    }
    for scope in &policy.scopes {
        let id = scope.trim();
        if id.is_empty() || id.chars().count() > 64 || id.chars().any(char::is_control) {
            return Err(schema_error(
                "scope ids must be 1..=64 non-control characters",
            ));
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    for control in &policy.exposed {
        let field = control.field.trim();
        if !seen.insert(field.to_string()) {
            return Err(schema_error(format!(
                "exposure policy lists `{field}` more than once"
            )));
        }
        if field == CLARITY_CONTROL_ID {
            continue;
        }
        if field == "splay" {
            // Known native extra without a portable mechanism; the report
            // must say `unsupported` instead of failing discovery.
            continue;
        }
        let Ok(glass_field) = GlassField::from_wire(field) else {
            return Err(schema_error(format!(
                "unknown exposure field `{field}`; known fields are visible, light-intensity, light-angle, refraction, depth, dispersion, radius, clarity (splay reports unsupported)"
            )));
        };
        if glass_field == GlassField::Visible {
            if control.min.is_some() || control.max.is_some() || control.step.is_some() {
                return Err(schema_error(
                    "the visible toggle has no numeric range to narrow",
                ));
            }
            continue;
        }
        let (authored_min, authored_max) = authored_range(glass_field);
        let min = validate_scalar_bounds(field, control.min, authored_min, "min")?;
        let max = validate_scalar_bounds(field, control.max, authored_max, "max")?;
        if min > max {
            return Err(schema_error(format!(
                "exposure range for `{field}` has min above max"
            )));
        }
        if min < authored_min || max > authored_max {
            return Err(schema_error(format!(
                "exposure range for `{field}` must stay inside the authored range [{authored_min},{authored_max}]"
            )));
        }
        if let Some(step) = control.step
            && (!step.is_finite() || step <= 0.0)
        {
            return Err(schema_error(format!(
                "exposure step for `{field}` must be a positive finite number"
            )));
        }
    }
    Ok(())
}

/// Map a composite clarity value onto the effective frost range.
/// clarity 1 is clearest (range_min frost); clarity 0 is most solid
/// (range_max frost). Linear, monotonic, invertible.
pub fn map_clarity_to_radius(clarity: f64, range_min: f64, range_max: f64) -> TransformResult<f64> {
    if !clarity.is_finite() || !(0.0..=1.0).contains(&clarity) {
        return Err(schema_error("clarity must be in [0,1]"));
    }
    if range_min.partial_cmp(&range_max) != Some(std::cmp::Ordering::Less)
        && range_min.partial_cmp(&range_max) != Some(std::cmp::Ordering::Equal)
        || range_min < 0.0
    {
        return Err(schema_error(
            "clarity frost range must satisfy 0 <= min <= max",
        ));
    }
    Ok(range_min + (range_max - range_min) * (1.0 - clarity))
}

/// Resolve what the product exposure actually means on this runtime.
pub fn resolve_appearance_exposure(
    input: &AppearanceExposureInput,
) -> TransformResult<AppearanceExposureReport> {
    validate_appearance_exposure_policy(&input.policy)?;
    let family_default = GlassMaterial::default();
    let exposed: std::collections::BTreeMap<&str, &AppearanceExposedControl> = input
        .policy
        .exposed
        .iter()
        .map(|control| (control.field.trim(), control))
        .collect();
    let mut controls = Vec::new();
    let mut clarity = None;

    let system_target = input.policy.target == AppearanceDeliveryTarget::SwiftUI;
    let displacement_fields_adapted = input.runtime.optics == AppearanceOpticsMode::FrostOnly;

    for field in crate::appearance::GLASS_FIELDS {
        let id = field.as_str();
        let (authored_min, authored_max) = authored_range(field);
        let exposed_row = exposed.get(id).copied();
        let depends_on = match field {
            GlassField::Refraction | GlassField::Dispersion
                if input.policy.target == AppearanceDeliveryTarget::Web =>
            {
                vec!["backdrop-filter.saturate".to_string()]
            }
            GlassField::Depth => vec!["refraction".to_string()],
            _ => Vec::new(),
        };
        let note = match field {
            GlassField::Visible => "on/off drives only the optical layer; content and actions stay untouched".to_string(),
            GlassField::Radius => "frost radius changes spatial detail of the backdrop; it never fades foreground content".to_string(),
            GlassField::Refraction => if input.policy.target == AppearanceDeliveryTarget::Web {
                "edge-only backdrop displacement; intentionally also raises saturation (see dependsOn)"
            } else { "edge-only backdrop displacement without global saturation compensation" }.to_string(),
            GlassField::Depth => match input.policy.target {
                AppearanceDeliveryTarget::Web | AppearanceDeliveryTarget::WebColorPreserving => format!(
                    "Web displacement stays responsive through authored {WEB_DEPTH_EFFECTIVE_MAX} (rim contribution caps at {WEB_RIM_AT_EFFECTIVE_MAX}); higher values clamp with a receipt"
                ),
                _ => "rim width in logical points, bounded by the receiving surface half-size".to_string(),
            },
            GlassField::Dispersion => "RGB channel separation at the refracting rim".to_string(),
            GlassField::LightAngle => "cardinal mapping is calibrated across Figma, Web and Metal".to_string(),
            GlassField::LightIntensity => "scales the inset edge highlight strength".to_string(),
        };
        let (state, reason, effective_min, effective_max) = if system_target
            && field != GlassField::Visible
        {
            (
                if exposed_row.is_some() {
                    AppearanceControlState::Unsupported
                } else {
                    AppearanceControlState::NotExposed
                },
                "Apple's system Liquid Glass exposes no setter for this field; use the swiftui-optical target when numbers must drive rendering".to_string(),
                authored_min,
                authored_max,
            )
        } else if displacement_fields_adapted
            && matches!(
                field,
                GlassField::Refraction | GlassField::Depth | GlassField::Dispersion
            )
        {
            (
                if exposed_row.is_some() {
                    AppearanceControlState::Adapted
                } else {
                    AppearanceControlState::NotExposed
                },
                "temporary runtime fallback: this receiver currently renders frost only, so displacement has no visible effect; the saved value stays canonical".to_string(),
                authored_min,
                authored_max,
            )
        } else if let Some(row) = exposed_row {
            let min = row.min.unwrap_or(authored_min).max(authored_min);
            let max = row.max.unwrap_or(authored_max).min(authored_max);
            (
                AppearanceControlState::Exposed,
                "selected by policy and drivable on this target".to_string(),
                min,
                max,
            )
        } else {
            (
                AppearanceControlState::NotExposed,
                "implemented by the glass family but not selected by this policy".to_string(),
                authored_min,
                authored_max,
            )
        };
        controls.push(AppearanceExposureRow {
            field: id.to_string(),
            state,
            reason,
            kind: if field == GlassField::Visible {
                AppearanceControlKind::Toggle
            } else {
                AppearanceControlKind::Scalar
            },
            unit: field_unit(field).to_string(),
            direction: field_direction(field).to_string(),
            authored_min,
            authored_max,
            effective_min,
            effective_max,
            step: exposed_row.and_then(|row| row.step),
            default: field_default(field, &family_default),
            cost: AppearanceChangeCost::Live,
            depends_on,
            note,
        });
    }

    if let Some(row) = exposed.get(CLARITY_CONTROL_ID).copied() {
        let radius_row = exposed.get("radius").copied();
        let (range_min, range_max) = match radius_row {
            Some(radius) => {
                let authored = authored_range(GlassField::Radius);
                (
                    radius.min.unwrap_or(authored.0).max(authored.0),
                    radius.max.unwrap_or(authored.1).min(authored.1),
                )
            }
            None => (0.0, DEFAULT_CLARITY_RADIUS_MAX),
        };
        let (state, reason) = if system_target {
            (
                AppearanceControlState::Unsupported,
                "the composite drives frost radius, which has no setter on the system material; use swiftui-optical when clarity must change rendering".to_string(),
            )
        } else {
            (
                AppearanceControlState::Exposed,
                "selected by policy; coordinates frost radius through the versioned mapping"
                    .to_string(),
            )
        };
        let maps_radius_too = radius_row.is_some();
        controls.push(AppearanceExposureRow {
            field: CLARITY_CONTROL_ID.to_string(),
            state,
            reason,
            kind: AppearanceControlKind::Composite,
            unit: "ratio".to_string(),
            direction: "1 is clearest, 0 is most solid".to_string(),
            authored_min: 0.0,
            authored_max: 1.0,
            effective_min: 0.0,
            effective_max: 1.0,
            step: row.step,
            // The clarity that reproduces the family default radius; when the
            // policy's range excludes or pins that radius no clarity does, so
            // the nearest representable state is reported instead of an
            // out-of-range number.
            default: AppearanceControlDefault::Number(
                (1.0 - (family_default.radius - range_min) / (range_max - range_min).max(1e-9))
                    .clamp(0.0, 1.0),
            ),
            cost: AppearanceChangeCost::Live,
            depends_on: vec!["radius".to_string()],
            note: format!(
                "clarity {} the frost radius range [{range_min},{range_max}] logical px; tint/coverage stays a receiver role layer outside the seven portable glass fields, and this control never lowers foreground opacity or disables actions{}",
                if maps_radius_too { "shares" } else { "owns" },
                if displacement_fields_adapted { "; frost remains visible while displacement is temporarily adapted" } else { "" },
            ),
        });
        clarity = Some(ClarityMappingReceipt {
            version: CLARITY_MAPPING_VERSION.to_string(),
            formula: "radius = rangeMin + (rangeMax - rangeMin) * (1 - clarity)".to_string(),
            maps_to: "radius".to_string(),
            range_min,
            range_max,
            note: "Versioned composite: coordinates frost only. Direction was verified against rendered backgrounds: lower clarity increases measured backdrop blur and leaves foreground content, opacity and hit targets untouched.".to_string(),
        });
    }

    if let Some(row) = exposed.get("splay").copied() {
        controls.push(AppearanceExposureRow {
            field: "splay".to_string(),
            state: AppearanceControlState::Unsupported,
            reason: "authored native Figma extra without a portable mechanism; it stays in the source and is reported as a delivery loss".to_string(),
            kind: AppearanceControlKind::Scalar,
            unit: "native".to_string(),
            direction: "native-only control; no portable direction".to_string(),
            authored_min: 0.0,
            authored_max: 0.0,
            effective_min: 0.0,
            effective_max: 0.0,
            step: row.step,
            default: AppearanceControlDefault::Number(0.0),
            cost: AppearanceChangeCost::Asset,
            depends_on: Vec::new(),
            note: "kept in the report so a policy cannot silently promise an adjustment Worldbend cannot deliver".to_string(),
        });
    }

    let report = AppearanceExposureReport {
        schema: APPEARANCE_EXPOSURE_REPORT_SCHEMA.to_string(),
        version: APPEARANCE_EXPOSURE_VERSION.to_string(),
        family: "glass".to_string(),
        target: input.policy.target,
        policy_revision: input.policy.policy_revision,
        scopes: input.policy.scopes.clone(),
        controls,
        clarity,
        fingerprint: String::new(),
    };
    let fingerprint = exposure_report_fingerprint(&report)?;
    Ok(AppearanceExposureReport {
        fingerprint,
        ..report
    })
}

/// Content identity of a resolved report. Rebinds when meaning, policy
/// revision or capability states change.
pub fn exposure_report_fingerprint(report: &AppearanceExposureReport) -> TransformResult<String> {
    #[derive(Serialize)]
    struct Identity<'a> {
        schema: &'a str,
        version: &'a str,
        family: &'a str,
        target: AppearanceDeliveryTarget,
        policy_revision: u64,
        scopes: &'a [String],
        controls: &'a [AppearanceExposureRow],
        clarity: &'a Option<ClarityMappingReceipt>,
    }
    let identity = Identity {
        schema: report.schema.as_str(),
        version: report.version.as_str(),
        family: report.family.as_str(),
        target: report.target,
        policy_revision: report.policy_revision,
        scopes: &report.scopes,
        controls: &report.controls,
        clarity: &report.clarity,
    };
    fingerprint_json_value(
        &canonical_json_value(&identity).map_err(|_| schema_error("invalid exposure report"))?,
    )
    .map_err(|_| schema_error("invalid exposure report"))
}

impl GlassField {
    /// Parse the kebab-case wire id used by exposure and preference records.
    pub fn from_wire(value: &str) -> TransformResult<GlassField> {
        match value.trim() {
            "visible" => Ok(GlassField::Visible),
            "light-intensity" => Ok(GlassField::LightIntensity),
            "light-angle" => Ok(GlassField::LightAngle),
            "refraction" => Ok(GlassField::Refraction),
            "depth" => Ok(GlassField::Depth),
            "dispersion" => Ok(GlassField::Dispersion),
            "radius" => Ok(GlassField::Radius),
            other => Err(schema_error(format!(
                "unknown glass field `{other}`; expected one of visible, light-intensity, light-angle, refraction, depth, dispersion, radius"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_preserving_control_meaning_and_fallback_remain_distinct() {
        let policy = base_policy(AppearanceDeliveryTarget::WebColorPreserving);
        let report = resolve_appearance_exposure(&AppearanceExposureInput {
            policy: policy.clone(),
            runtime: AppearanceRuntimeState {
                optics: AppearanceOpticsMode::SvgOptics,
            },
        })
        .unwrap();
        for id in ["refraction", "dispersion"] {
            let row = report.controls.iter().find(|row| row.field == id).unwrap();
            assert!(row.depends_on.is_empty());
        }
        let frost = resolve_appearance_exposure(&AppearanceExposureInput {
            policy,
            runtime: AppearanceRuntimeState {
                optics: AppearanceOpticsMode::FrostOnly,
            },
        })
        .unwrap();
        assert_eq!(
            frost
                .controls
                .iter()
                .find(|row| row.field == "refraction")
                .unwrap()
                .state,
            AppearanceControlState::Adapted
        );
        assert_ne!(report.fingerprint, frost.fingerprint);
    }

    fn base_policy(target: AppearanceDeliveryTarget) -> AppearanceExposurePolicy {
        AppearanceExposurePolicy {
            schema: APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 3,
            family: "glass".to_string(),
            target,
            scopes: vec!["hero-card".to_string()],
            exposed: vec![
                AppearanceExposedControl {
                    field: "visible".to_string(),
                    label: None,
                    min: None,
                    max: None,
                    step: None,
                },
                AppearanceExposedControl {
                    field: "clarity".to_string(),
                    label: Some("Clear ↔ more solid".to_string()),
                    min: None,
                    max: None,
                    step: Some(0.05),
                },
                AppearanceExposedControl {
                    field: "radius".to_string(),
                    label: None,
                    min: Some(0.0),
                    max: Some(40.0),
                    step: Some(1.0),
                },
                AppearanceExposedControl {
                    field: "refraction".to_string(),
                    label: None,
                    min: None,
                    max: None,
                    step: None,
                },
                AppearanceExposedControl {
                    field: "splay".to_string(),
                    label: None,
                    min: None,
                    max: None,
                    step: None,
                },
            ],
        }
    }

    fn resolve(
        policy: &AppearanceExposurePolicy,
        optics: AppearanceOpticsMode,
    ) -> AppearanceExposureReport {
        resolve_appearance_exposure(&AppearanceExposureInput {
            policy: policy.clone(),
            runtime: AppearanceRuntimeState { optics },
        })
        .unwrap()
    }

    fn row<'a>(report: &'a AppearanceExposureReport, field: &str) -> &'a AppearanceExposureRow {
        report
            .controls
            .iter()
            .find(|row| row.field == field)
            .unwrap_or_else(|| panic!("row {field} missing"))
    }

    #[test]
    fn distinguishes_unsupported_not_exposed_and_adapted() {
        let report = resolve(
            &base_policy(AppearanceDeliveryTarget::Web),
            AppearanceOpticsMode::FrostOnly,
        );
        assert_eq!(
            row(&report, "radius").state,
            AppearanceControlState::Exposed
        );
        assert_eq!(
            row(&report, "radius").effective_max,
            40.0,
            "policy narrowing caps the effective range"
        );
        assert_eq!(
            row(&report, "refraction").state,
            AppearanceControlState::Adapted
        );
        assert_eq!(
            row(&report, "light-angle").state,
            AppearanceControlState::NotExposed
        );
        assert_eq!(
            row(&report, "splay").state,
            AppearanceControlState::Unsupported
        );
        assert!(report.fingerprint.starts_with("sha256:"));
    }

    #[test]
    fn system_target_reports_structural_unsupported() {
        let report = resolve(
            &base_policy(AppearanceDeliveryTarget::SwiftUI),
            AppearanceOpticsMode::SystemGlass,
        );
        assert_eq!(
            row(&report, "visible").state,
            AppearanceControlState::Exposed
        );
        assert_eq!(
            row(&report, "radius").state,
            AppearanceControlState::Unsupported
        );
        assert_eq!(
            row(&report, "clarity").state,
            AppearanceControlState::Unsupported
        );
    }

    #[test]
    fn full_optics_keeps_displacement_exposed() {
        let report = resolve(
            &base_policy(AppearanceDeliveryTarget::Web),
            AppearanceOpticsMode::SvgOptics,
        );
        assert_eq!(
            row(&report, "refraction").state,
            AppearanceControlState::Exposed
        );
        let clarity_receipt = report.clarity.as_ref().expect("clarity receipt");
        assert_eq!(clarity_receipt.version, CLARITY_MAPPING_VERSION);
        // The policy narrows radius; clarity coordinates the narrowed range.
        assert_eq!(clarity_receipt.range_max, 40.0);
    }

    #[test]
    fn clarity_without_radius_policy_uses_default_ceiling() {
        let mut policy = base_policy(AppearanceDeliveryTarget::Web);
        policy.exposed.retain(|control| control.field == "clarity");
        let report = resolve(&policy, AppearanceOpticsMode::SvgOptics);
        assert_eq!(
            report.clarity.as_ref().unwrap().range_max,
            DEFAULT_CLARITY_RADIUS_MAX
        );
        assert_eq!(
            row(&report, "radius").state,
            AppearanceControlState::NotExposed
        );
    }

    #[test]
    fn clarity_default_stays_representable_when_the_range_excludes_or_pins_the_default() {
        // The family default radius is 12. A policy narrowing radius to
        // [20,40] excludes it; a pinned min==max range divides by ~0. Both
        // must report a clarity default inside [0,1] instead of a garbage
        // number a receiver would render as a broken slider position.
        for (min, max) in [(20.0, 40.0), (40.0, 40.0), (0.0, 5.0)] {
            let mut policy = base_policy(AppearanceDeliveryTarget::Web);
            policy
                .exposed
                .retain(|control| control.field == "clarity" || control.field == "radius");
            let radius = policy
                .exposed
                .iter_mut()
                .find(|control| control.field == "radius")
                .unwrap();
            radius.min = Some(min);
            radius.max = Some(max);
            let report = resolve(&policy, AppearanceOpticsMode::SvgOptics);
            let clarity = row(&report, "clarity");
            let AppearanceControlDefault::Number(default) = clarity.default else {
                panic!("clarity default must be numeric");
            };
            assert!(
                (0.0..=1.0).contains(&default),
                "clarity default {default} out of range for radius [{min},{max}]"
            );
        }
    }

    #[test]
    fn clarity_mapping_is_monotonic_and_clamped() {
        let clear = map_clarity_to_radius(1.0, 4.0, 40.0).unwrap();
        let solid = map_clarity_to_radius(0.0, 4.0, 40.0).unwrap();
        let middle = map_clarity_to_radius(0.5, 4.0, 40.0).unwrap();
        assert_eq!(clear, 4.0);
        assert_eq!(solid, 40.0);
        assert_eq!(middle, 22.0);
        assert!(map_clarity_to_radius(1.2, 0.0, 40.0).is_err());
        assert!(map_clarity_to_radius(f64::NAN, 0.0, 40.0).is_err());
    }

    #[test]
    fn rejects_unknown_fields_and_ranges_outside_authored() {
        let mut policy = base_policy(AppearanceDeliveryTarget::Web);
        policy
            .exposed
            .iter_mut()
            .find(|control| control.field == "radius")
            .unwrap()
            .max = Some(2000.0);
        assert!(validate_appearance_exposure_policy(&policy).is_err());
        let mut policy = base_policy(AppearanceDeliveryTarget::Web);
        policy.exposed.push(AppearanceExposedControl {
            field: "sparkle".to_string(),
            label: None,
            min: None,
            max: None,
            step: None,
        });
        let error = validate_appearance_exposure_policy(&policy).unwrap_err();
        assert!(error.message.contains("unknown exposure field `sparkle`"));
        let mut policy = base_policy(AppearanceDeliveryTarget::Web);
        policy.family = "texture".to_string();
        assert!(validate_appearance_exposure_policy(&policy).is_err());
        let mut policy = base_policy(AppearanceDeliveryTarget::Web);
        policy.scopes = vec![];
        assert!(validate_appearance_exposure_policy(&policy).is_err());
    }

    #[test]
    fn fingerprint_tracks_policy_revision_and_states() {
        let base = resolve(
            &base_policy(AppearanceDeliveryTarget::Web),
            AppearanceOpticsMode::SvgOptics,
        );
        let mut changed = base_policy(AppearanceDeliveryTarget::Web);
        changed.policy_revision = 4;
        let bumped = resolve(&changed, AppearanceOpticsMode::SvgOptics);
        assert_ne!(base.fingerprint, bumped.fingerprint);
        let adapted = resolve(
            &base_policy(AppearanceDeliveryTarget::Web),
            AppearanceOpticsMode::FrostOnly,
        );
        assert_ne!(base.fingerprint, adapted.fingerprint);
        let again = resolve(
            &base_policy(AppearanceDeliveryTarget::Web),
            AppearanceOpticsMode::SvgOptics,
        );
        assert_eq!(base.fingerprint, again.fingerprint);
    }
}

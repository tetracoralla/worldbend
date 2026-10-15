//! Durable personal preference over an appearance delivery.
//!
//! A preference record is explicit override intent, not a value diff: keeping
//! a value equal to the current default is representable and survives later
//! design changes, while value-difference merging alone would silently drop
//! it. The record carries its own revision, independent of the design source
//! revision and of the product exposure-policy revision; proposals prepared
//! against an older revision are rejected by receivers instead of overwriting
//! a newer human edit.
//!
//! Overrides the current policy does not expose stay in the record — intent
//! is recoverable — but do not drive the effective material while hidden.

use crate::appearance::{
    AppearanceDeliveryInput, AppearanceDeliveryPlan, AppearanceDeliveryTarget, GlassField,
    GlassMaterial, plan_appearance_delivery,
};
use crate::appearance_exposure::{
    AppearanceControlState, AppearanceExposureInput, AppearanceExposurePolicy,
    AppearanceOpticsMode, AppearanceRuntimeState, resolve_appearance_exposure,
};
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{ErrorCode, TransformError, TransformResult};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const APPEARANCE_PREFERENCE_SCHEMA: &str = "worldbend.appearance-preference@0.1";
pub const APPEARANCE_PREFERENCE_PLAN_SCHEMA: &str = "worldbend.appearance-preference-plan@0.1";
pub const APPEARANCE_PREFERENCE_VERSION: &str = "0.1";
/// Revision of an empty record: no override has ever been committed.
pub const EMPTY_PREFERENCE_REVISION: u64 = 0;

fn schema_error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

/// Who authored one override. Both actors go through the same product action
/// and revision checks; neither can bypass the other's edits.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceOverrideActor {
    User,
    Agent,
}

/// Typed override value: booleans only for `visible`, finite numbers for the
/// optical fields. Untyped bags cannot express field meaning safely.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum AppearanceOverrideValue {
    Toggle(bool),
    Number(f64),
}

impl AppearanceOverrideValue {
    fn type_name(self) -> &'static str {
        match self {
            Self::Toggle(_) => "toggle",
            Self::Number(_) => "number",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceFieldOverride {
    pub value: AppearanceOverrideValue,
    pub actor: AppearanceOverrideActor,
}

/// Explicit personal overrides over one appearance source. `fields` keeps the
/// stable glass wire order, so two equal records serialize identically.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearancePreferenceRecord {
    #[schemars(schema_with = "preference_schema")]
    pub schema: String,
    #[schemars(schema_with = "preference_version_schema")]
    pub version: String,
    /// Ordering token owned by the receiver; monotonic across commits.
    #[schemars(range(min = 0))]
    pub revision: u64,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub fields: BTreeMap<GlassField, AppearanceFieldOverride>,
}

fn preference_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_PREFERENCE_SCHEMA })
}

fn preference_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_PREFERENCE_VERSION })
}

impl AppearancePreferenceRecord {
    /// The empty record: no override, revision 0.
    pub fn empty() -> Self {
        Self {
            schema: APPEARANCE_PREFERENCE_SCHEMA.to_string(),
            version: APPEARANCE_PREFERENCE_VERSION.to_string(),
            revision: EMPTY_PREFERENCE_REVISION,
            fields: BTreeMap::new(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.fields.is_empty()
    }

    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != APPEARANCE_PREFERENCE_SCHEMA
            || self.version != APPEARANCE_PREFERENCE_VERSION
        {
            return Err(schema_error(
                "preference record must declare worldbend.appearance-preference@0.1",
            ));
        }
        if !self.is_empty() && self.revision == EMPTY_PREFERENCE_REVISION {
            return Err(schema_error("a record with overrides needs revision >= 1"));
        }
        for (field, override_value) in &self.fields {
            let expected_toggle = *field == GlassField::Visible;
            let matches = match override_value.value {
                AppearanceOverrideValue::Toggle(_) => expected_toggle,
                AppearanceOverrideValue::Number(_) => !expected_toggle,
            };
            if !matches {
                return Err(schema_error(format!(
                    "override for `{}` must be a {}, not a {}",
                    field.as_str(),
                    if expected_toggle { "toggle" } else { "number" },
                    override_value.value.type_name()
                )));
            }
            if let AppearanceOverrideValue::Number(value) = override_value.value {
                if !value.is_finite() {
                    return Err(schema_error(format!(
                        "override for `{}` must be finite",
                        field.as_str()
                    )));
                }
                let valid = match field {
                    GlassField::Visible => true,
                    GlassField::LightIntensity
                    | GlassField::Refraction
                    | GlassField::Dispersion => (0.0..=1.0).contains(&value),
                    GlassField::LightAngle => (0.0..360.0).contains(&value),
                    GlassField::Depth => {
                        (1.0..=crate::appearance::MAX_GLASS_DEPTH).contains(&value)
                    }
                    GlassField::Radius => {
                        (0.0..=crate::appearance::MAX_GLASS_RADIUS).contains(&value)
                    }
                };
                if !valid {
                    return Err(schema_error(format!(
                        "override value {value} is outside the authored range of `{}`",
                        field.as_str()
                    )));
                }
            }
        }
        Ok(())
    }

    /// Content identity of the record (ignores the revision token).
    pub fn fingerprint(&self) -> TransformResult<String> {
        #[derive(Serialize)]
        struct Identity<'a> {
            schema: &'a str,
            version: &'a str,
            fields: &'a BTreeMap<GlassField, AppearanceFieldOverride>,
        }
        fingerprint_json_value(
            &canonical_json_value(&Identity {
                schema: self.schema.as_str(),
                version: self.version.as_str(),
                fields: &self.fields,
            })
            .map_err(|_| schema_error("invalid preference record"))?,
        )
        .map_err(|_| schema_error("invalid preference record"))
    }

    /// Apply overrides to a base material and report the applied fields.
    pub fn apply_to(&self, base: GlassMaterial) -> (GlassMaterial, Vec<GlassField>) {
        let mut material = base;
        let mut applied = Vec::new();
        for (field, override_value) in &self.fields {
            match (field, override_value.value) {
                (GlassField::Visible, AppearanceOverrideValue::Toggle(value)) => {
                    material.visible = value;
                }
                (GlassField::LightIntensity, AppearanceOverrideValue::Number(value)) => {
                    material.light_intensity = value;
                }
                (GlassField::LightAngle, AppearanceOverrideValue::Number(value)) => {
                    material.light_angle = value;
                }
                (GlassField::Refraction, AppearanceOverrideValue::Number(value)) => {
                    material.refraction = value;
                }
                (GlassField::Depth, AppearanceOverrideValue::Number(value)) => {
                    material.depth = value;
                }
                (GlassField::Dispersion, AppearanceOverrideValue::Number(value)) => {
                    material.dispersion = value;
                }
                (GlassField::Radius, AppearanceOverrideValue::Number(value)) => {
                    material.radius = value;
                }
                // validate() rejects type mismatches before any apply.
                _ => unreachable!("validated override must match its field type"),
            }
            applied.push(*field);
        }
        (material, applied)
    }
}

/// Which overrides actually drive the effective material under a policy.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearancePreferenceFieldState {
    /// The override drives the resolved material.
    Applied,
    /// The policy currently hides this field. The override stays in the
    /// record with its intent recoverable, but the material keeps the base
    /// value until the policy exposes the field again.
    NotExposed,
}

#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearancePreferenceFieldReceipt {
    pub field: GlassField,
    pub state: AppearancePreferenceFieldState,
    pub reason: String,
}

/// Split a record into the fields that drive the effective material and the
/// receipts explaining hidden ones. Without a policy every override applies.
pub fn effective_override_fields(
    preference: &AppearancePreferenceRecord,
    policy: Option<&AppearanceExposurePolicy>,
) -> TransformResult<(Vec<GlassField>, Vec<AppearancePreferenceFieldReceipt>)> {
    let Some(policy) = policy else {
        return Ok((
            preference.fields.keys().copied().collect(),
            preference
                .fields
                .keys()
                .map(|field| AppearancePreferenceFieldReceipt {
                    field: *field,
                    state: AppearancePreferenceFieldState::Applied,
                    reason: "explicit override applied to the effective material".to_string(),
                })
                .collect(),
        ));
    };
    let report = resolve_appearance_exposure(&AppearanceExposureInput {
        policy: policy.clone(),
        runtime: AppearanceRuntimeState {
            optics: match policy.target {
                AppearanceDeliveryTarget::Web | AppearanceDeliveryTarget::WebColorPreserving => {
                    AppearanceOpticsMode::SvgOptics
                }
                AppearanceDeliveryTarget::SwiftUI => AppearanceOpticsMode::SystemGlass,
                AppearanceDeliveryTarget::SwiftUIOptical => AppearanceOpticsMode::ExplicitOptical,
            },
        },
    })?;
    let mut applied = Vec::new();
    let mut receipts = Vec::new();
    // The clarity composite owns the frost field it maps to: a policy may
    // expose the concise composite instead of raw radius, and a radius
    // override saved through that composite then stays applied (and tunable).
    let clarity_owns_radius = report.controls.iter().any(|row| {
        row.field == crate::appearance_exposure::CLARITY_CONTROL_ID
            && row.state == AppearanceControlState::Exposed
    }) && report
        .clarity
        .as_ref()
        .is_some_and(|mapping| mapping.maps_to == "radius");
    let radius_directly_exposed = report
        .controls
        .iter()
        .any(|row| row.field == "radius" && row.state == AppearanceControlState::Exposed);
    for field in preference.fields.keys() {
        let id = field.as_str();
        let state = report
            .controls
            .iter()
            .find(|row| row.field == id)
            .map(|row| row.state);
        // Only a hidden radius row is carried by the composite; when the
        // policy exposes raw radius too, the override applies through its
        // own row and the receipt says so.
        let carried_by_clarity =
            clarity_owns_radius && *field == GlassField::Radius && !radius_directly_exposed;
        match state {
            Some(AppearanceControlState::NotExposed) if !carried_by_clarity => receipts.push(
                AppearancePreferenceFieldReceipt {
                    field: *field,
                    state: AppearancePreferenceFieldState::NotExposed,
                    reason: format!(
                        "the current exposure policy (revision {}) does not expose `{id}`; the override stays saved and applies again when the field is re-exposed",
                        report.policy_revision
                    ),
                },
            ),
            _ => {
                applied.push(*field);
                receipts.push(AppearancePreferenceFieldReceipt {
                    field: *field,
                    state: AppearancePreferenceFieldState::Applied,
                    reason: if carried_by_clarity {
                        "explicit override applied through the exposed clarity composite".to_string()
                    } else {
                        "explicit override applied to the effective material".to_string()
                    },
                });
            }
        }
    }
    Ok((applied, receipts))
}

pub(crate) fn apply_field(
    material: &mut GlassMaterial,
    field: GlassField,
    value: AppearanceOverrideValue,
) {
    match (field, value) {
        (GlassField::Visible, AppearanceOverrideValue::Toggle(value)) => {
            material.visible = value;
        }
        (GlassField::LightIntensity, AppearanceOverrideValue::Number(value)) => {
            material.light_intensity = value;
        }
        (GlassField::LightAngle, AppearanceOverrideValue::Number(value)) => {
            material.light_angle = value;
        }
        (GlassField::Refraction, AppearanceOverrideValue::Number(value)) => {
            material.refraction = value;
        }
        (GlassField::Depth, AppearanceOverrideValue::Number(value)) => {
            material.depth = value;
        }
        (GlassField::Dispersion, AppearanceOverrideValue::Number(value)) => {
            material.dispersion = value;
        }
        (GlassField::Radius, AppearanceOverrideValue::Number(value)) => {
            material.radius = value;
        }
        // validate() rejects type mismatches before any apply.
        _ => unreachable!("validated override must match its field type"),
    }
}

fn apply_effective(
    base: AppearanceDeliveryInput,
    preference: &AppearancePreferenceRecord,
    policy: Option<&AppearanceExposurePolicy>,
) -> TransformResult<(
    AppearanceDeliveryPlan,
    Vec<AppearancePreferenceFieldReceipt>,
)> {
    let (applied, receipts) = effective_override_fields(preference, policy)?;
    let mut material = base.material;
    for field in &applied {
        apply_field(&mut material, *field, preference.fields[field].value);
    }
    material.validate()?;
    let plan = plan_appearance_delivery(&AppearanceDeliveryInput { material, ..base })?;
    Ok((plan, receipts))
}

/// Resolve a preference against one base delivery: the canonical evaluated
/// result receivers display, plus per-field receipts for hidden overrides.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearancePreferenceInput {
    pub base: AppearanceDeliveryInput,
    pub preference: AppearancePreferenceRecord,
    /// Optional exposure policy; hidden fields keep their override saved but
    /// do not drive the effective material.
    #[serde(default)]
    pub policy: Option<AppearanceExposurePolicy>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearancePreferencePlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "plan_version_schema")]
    pub version: String,
    /// The effective material after policy-allowed overrides.
    pub material: GlassMaterial,
    pub delivery: AppearanceDeliveryPlan,
    pub receipts: Vec<AppearancePreferenceFieldReceipt>,
    pub preference_revision: u64,
    pub preference_fingerprint: String,
}

fn plan_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_PREFERENCE_PLAN_SCHEMA })
}

fn plan_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_PREFERENCE_VERSION })
}

pub fn resolve_appearance_preference(
    input: &AppearancePreferenceInput,
) -> TransformResult<AppearancePreferencePlan> {
    input.base.recipe.validate()?;
    input.base.material.validate()?;
    input.preference.validate()?;
    if let Some(policy) = &input.policy
        && policy.target != input.base.target
    {
        return Err(schema_error(
            "the exposure policy target must match the base delivery target",
        ));
    }
    let (delivery, receipts) =
        apply_effective(input.base.clone(), &input.preference, input.policy.as_ref())?;
    Ok(AppearancePreferencePlan {
        schema: APPEARANCE_PREFERENCE_PLAN_SCHEMA.to_string(),
        version: APPEARANCE_PREFERENCE_VERSION.to_string(),
        material: delivery.material,
        delivery,
        receipts,
        preference_revision: input.preference.revision,
        preference_fingerprint: input.preference.fingerprint()?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::appearance::{
        APPEARANCE_SCHEMA, APPEARANCE_VERSION, AppearanceRecipeSpec, GlassMaterial,
    };

    fn base() -> AppearanceDeliveryInput {
        AppearanceDeliveryInput {
            recipe: AppearanceRecipeSpec {
                schema: APPEARANCE_SCHEMA.to_string(),
                version: APPEARANCE_VERSION.to_string(),
                recipe_id: "consumer-glass".to_string(),
                recipe_version: 1,
                material: GlassMaterial::default(),
            },
            material: GlassMaterial::default(),
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        }
    }

    fn record(revision: u64, radius: f64) -> AppearancePreferenceRecord {
        AppearancePreferenceRecord {
            schema: APPEARANCE_PREFERENCE_SCHEMA.to_string(),
            version: APPEARANCE_PREFERENCE_VERSION.to_string(),
            revision,
            fields: [(
                GlassField::Radius,
                AppearanceFieldOverride {
                    value: AppearanceOverrideValue::Number(radius),
                    actor: AppearanceOverrideActor::User,
                },
            )]
            .into_iter()
            .collect(),
        }
    }

    #[test]
    fn validates_types_and_ranges() {
        assert!(record(1, 12.0).validate().is_ok());
        let mut bad_type = record(1, 12.0);
        bad_type.fields.insert(
            GlassField::Radius,
            AppearanceFieldOverride {
                value: AppearanceOverrideValue::Toggle(true),
                actor: AppearanceOverrideActor::User,
            },
        );
        assert!(bad_type.validate().is_err());
        let mut toggle_on_visible = record(1, 12.0);
        toggle_on_visible.fields.insert(
            GlassField::Visible,
            AppearanceFieldOverride {
                value: AppearanceOverrideValue::Toggle(false),
                actor: AppearanceOverrideActor::Agent,
            },
        );
        assert!(toggle_on_visible.validate().is_ok());
        assert!(record(1, 2000.0).validate().is_err());
        assert!(record(0, 12.0).validate().is_err());
        assert!(AppearancePreferenceRecord::empty().validate().is_ok());
    }

    #[test]
    fn equal_to_default_override_is_representable() {
        // The exact 2026-10-11 probe: user fixed radius at the old source
        // value 1; a later source raises it to 5. Explicit intent keeps 1.
        let record = record(1, 1.0);
        let plan = resolve_appearance_preference(&AppearancePreferenceInput {
            base: base(),
            preference: record,
            policy: None,
        })
        .unwrap();
        assert_eq!(plan.delivery.material.radius, 1.0);
        assert_eq!(plan.receipts.len(), 1);
        assert_eq!(
            plan.receipts[0].state,
            AppearancePreferenceFieldState::Applied
        );
    }

    #[test]
    fn hidden_override_keeps_intent_but_not_effect() {
        use crate::appearance_exposure::{
            APPEARANCE_EXPOSURE_POLICY_SCHEMA, APPEARANCE_EXPOSURE_VERSION,
            AppearanceExposedControl,
        };
        let policy = AppearanceExposurePolicy {
            schema: APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 2,
            family: "glass".to_string(),
            target: AppearanceDeliveryTarget::Web,
            scopes: vec!["hero".to_string()],
            // Exposes only clarity: radius is hidden.
            exposed: vec![AppearanceExposedControl {
                field: "clarity".to_string(),
                label: None,
                min: None,
                max: None,
                step: None,
            }],
        };
        let mut preference = record(4, 30.0);
        preference.fields.insert(
            GlassField::Refraction,
            AppearanceFieldOverride {
                value: AppearanceOverrideValue::Number(0.8),
                actor: AppearanceOverrideActor::User,
            },
        );
        let plan = resolve_appearance_preference(&AppearancePreferenceInput {
            base: base(),
            preference,
            policy: Some(policy),
        })
        .unwrap();
        // The clarity composite owns frost: the radius override saved through
        // it still drives the material, while refraction — exposed by no row
        // and carried by no composite — stays saved but out of the effective
        // material (wire-order receipts).
        assert_eq!(plan.delivery.material.radius, 30.0);
        assert_eq!(
            plan.delivery.material.refraction,
            GlassMaterial::default().refraction
        );
        let states: Vec<_> = plan
            .receipts
            .iter()
            .map(|receipt| (receipt.field.as_str(), receipt.state))
            .collect();
        assert_eq!(
            states,
            vec![
                ("refraction", AppearancePreferenceFieldState::NotExposed),
                ("radius", AppearancePreferenceFieldState::Applied),
            ]
        );
        assert!(plan.receipts[0].reason.contains("does not expose"));
        assert!(plan.receipts[1].reason.contains("clarity composite"));
    }

    #[test]
    fn composite_exposed_policy_carries_radius_overrides() {
        use crate::appearance_exposure::{
            APPEARANCE_EXPOSURE_POLICY_SCHEMA, APPEARANCE_EXPOSURE_VERSION,
            AppearanceExposedControl,
        };
        // The concise product surface: one clarity composite, no raw radius.
        let policy = AppearanceExposurePolicy {
            schema: APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 5,
            family: "glass".to_string(),
            target: AppearanceDeliveryTarget::Web,
            scopes: vec!["hero".to_string()],
            exposed: vec![AppearanceExposedControl {
                field: "clarity".to_string(),
                label: Some("Clear ↔ more solid".to_string()),
                min: None,
                max: None,
                step: Some(0.05),
            }],
        };
        // The user pinned frost at 1 (the v1 default) through the composite;
        // the policy hides raw radius but owns it through clarity, so the
        // explicit value drives the material and survives design updates.
        let plan = resolve_appearance_preference(&AppearancePreferenceInput {
            base: base(),
            preference: record(6, 1.0),
            policy: Some(policy),
        })
        .unwrap();
        assert_eq!(plan.delivery.material.radius, 1.0);
        assert_eq!(plan.receipts.len(), 1);
        assert_eq!(
            plan.receipts[0].state,
            AppearancePreferenceFieldState::Applied
        );
        assert!(plan.receipts[0].reason.contains("clarity composite"));
        // Without the composite the same override stays hidden.
        let locked = AppearanceExposurePolicy {
            exposed: Vec::new(),
            policy_revision: 6,
            ..plan_input_policy()
        };
        let plan = resolve_appearance_preference(&AppearancePreferenceInput {
            base: base(),
            preference: record(6, 1.0),
            policy: Some(locked),
        })
        .unwrap();
        assert_eq!(
            plan.receipts[0].state,
            AppearancePreferenceFieldState::NotExposed
        );
    }

    fn plan_input_policy() -> crate::appearance_exposure::AppearanceExposurePolicy {
        crate::appearance_exposure::AppearanceExposurePolicy {
            schema: crate::appearance_exposure::APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: crate::appearance_exposure::APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 1,
            family: "glass".to_string(),
            target: AppearanceDeliveryTarget::Web,
            scopes: vec!["hero".to_string()],
            exposed: Vec::new(),
        }
    }

    #[test]
    fn fingerprint_ignores_revision_orders_fields() {
        let first = record(3, 12.0);
        let bumped = record(9, 12.0);
        assert_eq!(first.fingerprint().unwrap(), bumped.fingerprint().unwrap());
        let mut reordered = record(3, 12.0);
        reordered.fields.insert(
            GlassField::Dispersion,
            AppearanceFieldOverride {
                value: AppearanceOverrideValue::Number(0.2),
                actor: AppearanceOverrideActor::Agent,
            },
        );
        assert_ne!(
            first.fingerprint().unwrap(),
            reordered.fingerprint().unwrap()
        );
    }

    #[test]
    fn policy_target_must_match_base() {
        use crate::appearance_exposure::{
            APPEARANCE_EXPOSURE_POLICY_SCHEMA, APPEARANCE_EXPOSURE_VERSION,
            AppearanceExposurePolicy,
        };
        let policy = AppearanceExposurePolicy {
            schema: APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 1,
            family: "glass".to_string(),
            target: AppearanceDeliveryTarget::SwiftUI,
            scopes: vec!["hero".to_string()],
            exposed: vec![],
        };
        let error = resolve_appearance_preference(&AppearancePreferenceInput {
            base: base(),
            preference: record(1, 12.0),
            policy: Some(policy),
        })
        .unwrap_err();
        assert!(error.message.contains("target"));
    }
}

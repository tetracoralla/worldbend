//! Native appearance recipes and frontend delivery.
//!
//! A `worldbend.appearance@0.1` recipe is an editable starting state over a
//! Figma native material (today: the native GLASS effect). The live Figma
//! properties remain the authority for actual values; the recipe records
//! identity, version and the defaults an instance was seeded from. Resolution
//! reports which fields drifted from the seed without invalidating the
//! instance, and an untagged native appearance stays inspectable and
//! deliverable instead of being guessed back into a preset.
//!
//! The delivery plan projects one resolved state onto a typed target
//! implementation — Web CSS/SVG, Apple system glass, or explicit SwiftUI/Metal
//! optics — with explicit per-field fidelity. Parameter portability never
//! implies identical rendering across Figma, browsers and native platforms.

use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{ErrorCode, TransformError, TransformResult, bounded_text};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const APPEARANCE_VERSION: &str = "0.1";
pub const APPEARANCE_SCHEMA: &str = "worldbend.appearance@0.1";
pub const APPEARANCE_INSPECTION_SCHEMA: &str = "worldbend.appearance-inspection@0.1";
pub const APPEARANCE_DELIVERY_SCHEMA: &str = "worldbend.appearance-delivery@0.1";

pub const MAX_APPEARANCE_RECIPE_ID: usize = 64;
/// Generous bounds that accept every value Figma's GLASS effect can hold in
/// practice while still rejecting garbage before it reaches a target adapter.
pub const MAX_GLASS_DEPTH: f64 = 1000.0;
pub const MAX_GLASS_RADIUS: f64 = 1000.0;
/// Authored Glass depth accepts `[1, MAX_GLASS_DEPTH]`. Web displacement keeps the
/// historical linear band through this end-point, then a soft tail.
pub const WEB_DEPTH_LINEAR_END: f64 = 10.0;
/// Web displacement and rim remain optically responsive through this authored value.
/// Above it the compiler clamps and the delivery receipt reports the clamp.
pub const WEB_DEPTH_EFFECTIVE_MAX: f64 = 100.0;
pub const WEB_DEPTH_FACTOR_AT_LINEAR_END: f64 = 1.0;
pub const WEB_DEPTH_FACTOR_AT_EFFECTIVE_MAX: f64 = 1.5;
/// Historical Web receiver rim used `min(depth, 20)` literally through this end.
pub const WEB_RIM_LINEAR_END: f64 = 20.0;
pub const WEB_RIM_EFFECTIVE_MAX: f64 = 100.0;
pub const WEB_RIM_AT_EFFECTIVE_MAX: f64 = 40.0;
/// Maximum Web displacement scale after the soft depth tail (`64 * 1.0 * 1.5`).
pub const WEB_DISPLACEMENT_SCALE_MAX: f64 = 96.0;

fn schema_error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

fn spec_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_SCHEMA })
}

fn version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_VERSION })
}

/// One native Figma GLASS effect's optical controls. Field names follow the
/// Figma Effect API; `radius` is frost. Figma's beta Glass API does not expose
/// every UI setting (Splay is absent) and glass effects cannot bind variables.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GlassMaterial {
    #[serde(default = "default_glass_visible")]
    pub visible: bool,
    /// Intensity of specular highlights, in `[0,1]`.
    #[serde(rename = "lightIntensity")]
    pub light_intensity: f64,
    /// Angle of the specular light in degrees, in `[0,360)`.
    #[serde(rename = "lightAngle")]
    pub light_angle: f64,
    /// Intensity of the refraction distortion, in `[0,1]`.
    pub refraction: f64,
    /// Depth of the refraction effect, `>= 1`.
    pub depth: f64,
    /// Chromatic aberration amount, in `[0,1]`.
    pub dispersion: f64,
    /// Frost radius in logical pixels, `>= 0`.
    pub radius: f64,
}

fn default_glass_visible() -> bool {
    true
}

impl Default for GlassMaterial {
    fn default() -> Self {
        Self {
            visible: true,
            light_intensity: 0.5,
            light_angle: 90.0,
            refraction: 0.35,
            depth: 2.0,
            dispersion: 0.0,
            radius: 12.0,
        }
    }
}

/// The glass fields, in the stable wire order used by customized-field lists
/// and target mapping tables.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum GlassField {
    Visible,
    LightIntensity,
    LightAngle,
    Refraction,
    Depth,
    Dispersion,
    Radius,
}

pub const GLASS_FIELDS: [GlassField; 7] = [
    GlassField::Visible,
    GlassField::LightIntensity,
    GlassField::LightAngle,
    GlassField::Refraction,
    GlassField::Depth,
    GlassField::Dispersion,
    GlassField::Radius,
];

impl GlassField {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::LightIntensity => "light-intensity",
            Self::LightAngle => "light-angle",
            Self::Refraction => "refraction",
            Self::Depth => "depth",
            Self::Dispersion => "dispersion",
            Self::Radius => "radius",
        }
    }
}

impl GlassMaterial {
    pub fn validate(&self) -> TransformResult<()> {
        let normalized = [
            self.light_intensity,
            self.light_angle,
            self.refraction,
            self.depth,
            self.dispersion,
            self.radius,
        ];
        if normalized.iter().any(|value| !value.is_finite()) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "glass material values must be finite",
            ));
        }
        if !(0.0..=1.0).contains(&self.light_intensity)
            || !(0.0..=1.0).contains(&self.refraction)
            || !(0.0..=1.0).contains(&self.dispersion)
        {
            return Err(schema_error(
                "lightIntensity, refraction and dispersion must be in [0,1]",
            ));
        }
        if !(0.0..360.0).contains(&self.light_angle) {
            return Err(schema_error("lightAngle must be in [0,360) degrees"));
        }
        if !(1.0..=MAX_GLASS_DEPTH).contains(&self.depth) {
            return Err(schema_error("glass depth must be in [1,1000]"));
        }
        if !(0.0..=MAX_GLASS_RADIUS).contains(&self.radius) {
            return Err(schema_error("glass frost radius must be in [0,1000]"));
        }
        Ok(())
    }

    /// Fields whose live values differ from the recipe seed. Comparison is
    /// exact, except for the host's known float32 storage roundtrip.
    pub fn changed_fields(&self, seed: &GlassMaterial) -> Vec<GlassField> {
        let differs = |live: f64, seed: f64| live != seed && live != f64::from(seed as f32);
        GLASS_FIELDS
            .into_iter()
            .filter(|field| match field {
                GlassField::Visible => self.visible != seed.visible,
                GlassField::LightIntensity => differs(self.light_intensity, seed.light_intensity),
                GlassField::LightAngle => differs(self.light_angle, seed.light_angle),
                GlassField::Refraction => differs(self.refraction, seed.refraction),
                GlassField::Depth => differs(self.depth, seed.depth),
                GlassField::Dispersion => differs(self.dispersion, seed.dispersion),
                GlassField::Radius => differs(self.radius, seed.radius),
            })
            .collect()
    }
}

/// An editable appearance starting state: named, versioned, self-describing.
/// The material is the seed; live native values stay the authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceRecipeSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    /// Stable recipe identity carried by every applied instance.
    #[schemars(length(min = 1, max = MAX_APPEARANCE_RECIPE_ID))]
    pub recipe_id: String,
    /// Seed version; `>= 1`. A newer seed keeps compatible instance overrides.
    #[schemars(range(min = 1))]
    pub recipe_version: u32,
    pub material: GlassMaterial,
}

impl AppearanceRecipeSpec {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != APPEARANCE_SCHEMA || self.version != APPEARANCE_VERSION {
            return Err(schema_error(
                "appearance recipe must declare worldbend.appearance@0.1",
            ));
        }
        let id = self.recipe_id.trim();
        if id.is_empty()
            || self.recipe_id.chars().count() > MAX_APPEARANCE_RECIPE_ID
            || self.recipe_id.chars().any(char::is_control)
        {
            return Err(schema_error(
                "recipeId must be 1..=64 characters after trimming",
            ));
        }
        if self.recipe_version < 1 {
            return Err(schema_error("recipeVersion must be >= 1"));
        }
        self.material.validate()
    }

    /// Stable content identity of the seed. Live drift never changes it: the
    /// fingerprint names the recipe an instance came from, not its values.
    pub fn fingerprint(&self) -> TransformResult<String> {
        fingerprint_json_value(
            &canonical_json_value(self).map_err(|_| schema_error("invalid recipe"))?,
        )
        .map_err(|_| schema_error("invalid recipe"))
    }
}

/// One surface's reconciliation input: the stored seed plus the live native
/// state read from the host.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceInspectionInput {
    pub recipe: AppearanceRecipeSpec,
    /// Current native GLASS values. `None` when the surface has no GLASS
    /// effect at all (including a Worldbend-tagged one removed natively).
    pub live: Option<GlassMaterial>,
    /// Whether the surface carries Worldbend appearance provenance.
    #[serde(default)]
    pub tagged: bool,
}

/// How the appearance currently exists on the surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceInstanceState {
    /// No glass effect and no Worldbend provenance: untouched surface.
    Absent,
    /// Worldbend applied this recipe and native values still match the seed.
    Tagged,
    /// Worldbend provenance exists with live native drift; the drift is the
    /// designer's edit, not an invalid instance.
    Customized,
    /// A native GLASS effect exists without Worldbend provenance. Inspectable
    /// and deliverable; never guessed back into a preset.
    UntaggedNative,
    /// Worldbend provenance exists but the native glass effect was removed.
    /// Native authority wins: resolution reports the seed as fallback state.
    Removed,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceInspection {
    #[schemars(schema_with = "inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "inspection_version_schema")]
    pub version: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    /// The resolved material: live native values when present, otherwise the
    /// recipe seed as explicit fallback state.
    pub material: GlassMaterial,
    pub state: AppearanceInstanceState,
    /// Fields where live values differ from the seed. Empty unless the state
    /// is `customized`.
    pub customized: Vec<GlassField>,
}

fn inspection_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_INSPECTION_SCHEMA })
}

fn inspection_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_VERSION })
}

/// Resolve one surface's current appearance against its seed. The native
/// values are authoritative whenever they exist; provenance only explains
/// where the state came from.
pub fn inspect_appearance(
    input: &AppearanceInspectionInput,
) -> TransformResult<AppearanceInspection> {
    input.recipe.validate()?;
    let live = input.live;
    if let Some(material) = live {
        material.validate()?;
    }
    let (material, state, customized) = match (&live, input.tagged) {
        (Some(live), true) => {
            let customized = live.changed_fields(&input.recipe.material);
            let state = if customized.is_empty() {
                AppearanceInstanceState::Tagged
            } else {
                AppearanceInstanceState::Customized
            };
            (*live, state, customized)
        }
        (Some(live), false) => (*live, AppearanceInstanceState::UntaggedNative, Vec::new()),
        (None, true) => (
            input.recipe.material,
            AppearanceInstanceState::Removed,
            Vec::new(),
        ),
        (None, false) => (
            input.recipe.material,
            AppearanceInstanceState::Absent,
            Vec::new(),
        ),
    };
    Ok(AppearanceInspection {
        schema: APPEARANCE_INSPECTION_SCHEMA.to_string(),
        version: APPEARANCE_VERSION.to_string(),
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint: input.recipe.fingerprint()?,
        material,
        state,
        customized,
    })
}

/// Upgrade a seed while retaining changes made in the native editor.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceRevisionInput {
    pub previous: AppearanceRecipeSpec,
    pub next: AppearanceRecipeSpec,
    pub live: Option<GlassMaterial>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceRevisionPlan {
    pub recipe: AppearanceRecipeSpec,
    /// None keeps a natively removed effect removed; application must be explicit.
    pub material: Option<GlassMaterial>,
    pub preserved: Vec<GlassField>,
}
pub fn plan_appearance_revision(
    input: &AppearanceRevisionInput,
) -> TransformResult<AppearanceRevisionPlan> {
    input.previous.validate()?;
    input.next.validate()?;
    if input.previous.recipe_id != input.next.recipe_id
        || input.next.recipe_version <= input.previous.recipe_version
    {
        return Err(schema_error(
            "A seed upgrade requires the same recipeId and a newer recipeVersion",
        ));
    }
    let Some(live) = input.live else {
        return Ok(AppearanceRevisionPlan {
            recipe: input.next.clone(),
            material: None,
            preserved: Vec::new(),
        });
    };
    live.validate()?;
    let preserved = live.changed_fields(&input.previous.material);
    let material = merge_material(input.next.material, live, &preserved);
    Ok(AppearanceRevisionPlan {
        recipe: input.next.clone(),
        material: Some(material),
        preserved,
    })
}

fn merge_material(
    mut next: GlassMaterial,
    live: GlassMaterial,
    preserved: &[GlassField],
) -> GlassMaterial {
    for field in preserved {
        match field {
            GlassField::Visible => next.visible = live.visible,
            GlassField::LightIntensity => next.light_intensity = live.light_intensity,
            GlassField::LightAngle => next.light_angle = live.light_angle,
            GlassField::Refraction => next.refraction = live.refraction,
            GlassField::Depth => next.depth = live.depth,
            GlassField::Dispersion => next.dispersion = live.dispersion,
            GlassField::Radius => next.radius = live.radius,
        }
    }
    next
}

/// The supported delivery targets. Each owns one typed implementation route;
/// neither is a pixel-identity claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum AppearanceDeliveryTarget {
    #[serde(rename = "web")]
    Web,
    /// The Web optical route without global saturation/brightness compensation.
    /// Frost, displacement, dispersion and edge lighting retain their meanings.
    #[serde(rename = "web-color-preserving")]
    WebColorPreserving,
    #[serde(rename = "swiftui")]
    SwiftUI,
    /// Parameter-driven Metal rendering of an explicitly supplied SwiftUI backdrop.
    #[serde(rename = "swiftui-optical")]
    SwiftUIOptical,
}

/// How one glass field maps onto a target. `native` fields have a real setter
/// (or inherent system behavior); `approximated` fields influence derived
/// values; `unavailable` fields have no honest representation on the target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AppearanceFieldMapping {
    Native,
    Approximated,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceFieldDelivery {
    pub field: GlassField,
    pub mapping: AppearanceFieldMapping,
    /// One-line explanation of the setter, derivation or loss.
    pub note: String,
}

/// Authored acceptance versus the optically live compiled range for one control.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ParameterRangeReceipt {
    pub field: String,
    pub unit: String,
    pub authored_min: f64,
    pub authored_max: f64,
    pub effective_min: f64,
    pub effective_max: f64,
    pub authored: f64,
    /// Clamped authored input used by the compiler for this field — never the
    /// mapped output channel (for example `depth.rim` reports clamped depth here;
    /// `WebGlassDelivery.rim_depth` carries the rim contribution).
    pub effective: f64,
    pub clamped: bool,
    pub note: String,
}

/// An intentional cross-parameter influence that Agents must not treat as independent.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ParameterCoupling {
    pub from_field: String,
    pub to_channel: String,
    pub formula: String,
    pub intentional: bool,
    pub note: String,
}

/// Cardinal light-axis mapping shared across hosts after calibration.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LightAxisReceipt {
    pub convention: String,
    pub angle_degrees: f64,
    /// Unit vector in the host's 2D plane: +x right, +y down (CSS/Figma screen space).
    pub direction: [f64; 2],
    pub cardinal: String,
    pub note: String,
}

/// Native-only or otherwise unmapped authored state that did not enter the portable fields.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceLossReceipt {
    pub key: String,
    pub kind: String,
    pub note: String,
}

/// Compact discovery row for a concrete glass/texture receiving backend.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceProfileDescriptor {
    pub id: String,
    pub family: String,
    pub target: String,
    pub title: String,
    pub required_fields: Vec<String>,
    pub optional_fields: Vec<String>,
    pub mechanisms: Vec<String>,
    pub limits: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceProfileQuery {
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub required_mechanisms: Vec<String>,
    #[serde(default)]
    pub required_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceProfileCatalog {
    pub schema: String,
    pub version: String,
    pub profiles: Vec<AppearanceProfileDescriptor>,
}

/// Smoothstep in `[0,1]`.
fn saturate01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn smoothstep(t: f64) -> f64 {
    let t = saturate01(t);
    t * t * (3.0 - 2.0 * t)
}

/// Web displacement depth factor. Preserves the historical linear map on
/// `[1,10]`, then a soft tail through [`WEB_DEPTH_EFFECTIVE_MAX`].
pub fn web_depth_factor(depth: f64) -> (f64, f64, bool) {
    let clamped = !(1.0..=WEB_DEPTH_EFFECTIVE_MAX).contains(&depth);
    let effective = depth.clamp(1.0, WEB_DEPTH_EFFECTIVE_MAX);
    let factor = if effective <= WEB_DEPTH_LINEAR_END {
        effective / WEB_DEPTH_LINEAR_END
    } else {
        let t =
            (effective - WEB_DEPTH_LINEAR_END) / (WEB_DEPTH_EFFECTIVE_MAX - WEB_DEPTH_LINEAR_END);
        WEB_DEPTH_FACTOR_AT_LINEAR_END
            + (WEB_DEPTH_FACTOR_AT_EFFECTIVE_MAX - WEB_DEPTH_FACTOR_AT_LINEAR_END) * smoothstep(t)
    };
    (factor, effective, clamped)
}

/// Web rim depth in logical pixels. Preserves the historical `min(depth,20)`
/// band, then a soft tail through [`WEB_RIM_EFFECTIVE_MAX`].
///
/// Returns `(rim_contribution, clamped_authored_depth, clamped)`.
/// `parameterRanges` for `depth.rim` must report the clamped authored depth as
/// `effective` (same semantics as `depth` / etch); the mapped rim contribution
/// is carried on `WebGlassDelivery.rim_depth`.
pub fn web_rim_depth(depth: f64) -> (f64, f64, bool) {
    let clamped = !(1.0..=WEB_RIM_EFFECTIVE_MAX).contains(&depth);
    let effective = depth.clamp(1.0, WEB_RIM_EFFECTIVE_MAX);
    let rim = if effective <= WEB_RIM_LINEAR_END {
        effective
    } else {
        let t = (effective - WEB_RIM_LINEAR_END) / (WEB_RIM_EFFECTIVE_MAX - WEB_RIM_LINEAR_END);
        WEB_RIM_LINEAR_END + (WEB_RIM_AT_EFFECTIVE_MAX - WEB_RIM_LINEAR_END) * smoothstep(t)
    };
    (rim, effective, clamped)
}

/// Native/Figma/Metal/Web-calibrated light direction in screen space (+x right, +y down).
/// Cardinals: 0 down, 90 left, 180 up, 270 right.
pub fn light_direction_screen(angle_degrees: f64) -> ([f64; 2], &'static str) {
    let radians = angle_degrees.to_radians();
    let direction = [-radians.sin(), radians.cos()];
    let cardinal = match angle_degrees.round() as i32 {
        0 => "down",
        90 => "left",
        180 => "up",
        270 => "right",
        _ => "oblique",
    };
    (direction, cardinal)
}

fn glass_native_extra_losses(
    native_extras: &BTreeMap<String, serde_json::Value>,
) -> Vec<AppearanceLossReceipt> {
    native_extras
        .iter()
        .map(|(key, value)| {
            let kind = if key == "splay" {
                "unmapped-native-control".to_string()
            } else {
                "unmapped-native-extra".to_string()
            };
            AppearanceLossReceipt {
                key: key.clone(),
                kind,
                note: format!(
                    "authored native extra `{key}`={value} is outside the portable seven-field Glass input and has no Web/SwiftUI optical setter; seven-field delivery success does not include it",
                    value = value
                ),
            }
        })
        .collect()
}

fn appearance_profile_rows() -> Vec<AppearanceProfileDescriptor> {
    vec![
        AppearanceProfileDescriptor {
            id: "worldbend.glass-web-svg@0.1".into(),
            family: "glass".into(),
            target: "web".into(),
            title: "Web SVG backdrop glass".into(),
            required_fields: vec![
                "visible".into(),
                "radius".into(),
                "refraction".into(),
                "depth".into(),
                "dispersion".into(),
                "lightAngle".into(),
                "lightIntensity".into(),
            ],
            optional_fields: vec!["nativeExtras".into()],
            mechanisms: vec![
                "backdrop-blur".into(),
                "edge-displacement".into(),
                "rgb-dispersion".into(),
                "inset-highlight".into(),
                "refraction-saturation-coupling".into(),
            ],
            limits: "Rounded CSS outlines; soft-effective depth/rim through 100; Splay and environmental reflection unavailable".into(),
        },
        AppearanceProfileDescriptor {
            id: "worldbend.glass-web-color-preserving@0.1".into(),
            family: "glass".into(),
            target: "web-color-preserving".into(),
            title: "Web color-preserving backdrop optics".into(),
            required_fields: vec!["visible".into(), "radius".into(), "refraction".into(), "depth".into(), "dispersion".into(), "lightAngle".into(), "lightIntensity".into()],
            optional_fields: vec!["nativeExtras".into()],
            mechanisms: vec!["backdrop-blur".into(), "edge-displacement".into(), "rgb-dispersion".into(), "inset-highlight".into(), "color-preserving-refraction".into()],
            limits: "No global saturation or brightness compensation; explicit dispersion still separates RGB and edge lighting still adds highlights. Rounded CSS outlines; soft-effective depth/rim through 100; Splay and environmental reflection unavailable".into(),
        },
        AppearanceProfileDescriptor {
            id: "worldbend.glass-swiftui-system@0.1".into(),
            family: "glass".into(),
            target: "swiftui".into(),
            title: "Apple system Liquid Glass modifier".into(),
            required_fields: vec!["visible".into()],
            optional_fields: vec![],
            mechanisms: vec!["system-liquid-glass".into()],
            limits: "Optical magnitudes have no setters; use swiftui-optical when numbers must drive rendering".into(),
        },
        AppearanceProfileDescriptor {
            id: "worldbend.rounded-glass-metal@0.1".into(),
            family: "glass".into(),
            target: "swiftui-optical".into(),
            title: "Explicit SwiftUI/Metal rounded glass".into(),
            required_fields: vec![
                "visible".into(),
                "radius".into(),
                "refraction".into(),
                "depth".into(),
                "dispersion".into(),
                "lightAngle".into(),
                "lightIntensity".into(),
            ],
            optional_fields: vec!["nativeExtras".into()],
            mechanisms: vec![
                "explicit-backdrop".into(),
                "metal-refraction".into(),
                "metal-dispersion".into(),
                "directional-highlight".into(),
            ],
            limits: "Rounded shapes only; requires an explicit presentation backdrop; Splay unavailable".into(),
        },
        AppearanceProfileDescriptor {
            id: "worldbend.texture-web-svg@0.1".into(),
            family: "texture".into(),
            target: "web".into(),
            title: "Web SVG grain and etch".into(),
            required_fields: vec![
                "visible".into(),
                "grain".into(),
                "grainSize".into(),
                "grainColor".into(),
                "etch".into(),
                "etchSize".into(),
                "clipToShape".into(),
            ],
            optional_fields: vec!["nativeExtras".into()],
            mechanisms: vec!["grain-tile".into(), "svg-bump-etch".into()],
            limits: "Soft-effective etch through 100; duotone/anisotropic Y/color alpha stay native-only losses".into(),
        },
    ]
}

/// Compact discovery of implemented glass/texture backends. Incompatible
/// required mechanisms fail with a precise missing-mechanism error.
pub fn discover_appearance_profiles(
    query: &AppearanceProfileQuery,
) -> TransformResult<AppearanceProfileCatalog> {
    let mut profiles = appearance_profile_rows();
    if let Some(family) = query.family.as_deref() {
        let family = family.trim().to_ascii_lowercase();
        profiles.retain(|row| row.family == family);
    }
    if let Some(target) = query.target.as_deref() {
        let target = target.trim().to_ascii_lowercase();
        profiles.retain(|row| row.target == target);
    }
    if !query.required_fields.is_empty() {
        profiles.retain(|row| {
            query.required_fields.iter().all(|field| {
                row.required_fields.iter().any(|owned| owned == field)
                    || row.optional_fields.iter().any(|owned| owned == field)
                    || row.mechanisms.iter().any(|owned| owned == field)
            })
        });
    }
    for mechanism in &query.required_mechanisms {
        let mechanism = mechanism.trim();
        if mechanism.is_empty() {
            continue;
        }
        let supported = profiles
            .iter()
            .any(|row| row.mechanisms.iter().any(|owned| owned == mechanism));
        if !supported {
            return Err(schema_error(format!(
                "missing mechanism `{mechanism}`: no discovered appearance profile provides it (known mechanisms include backdrop-blur, edge-displacement, explicit-backdrop, metal-refraction, grain-tile, svg-bump-etch; Splay is not a portable mechanism yet)"
            )));
        }
        profiles.retain(|row| row.mechanisms.iter().any(|owned| owned == mechanism));
    }
    Ok(AppearanceProfileCatalog {
        schema: "worldbend.appearance-profiles@0.1".into(),
        version: APPEARANCE_VERSION.into(),
        profiles,
    })
}

/// Deterministic numbers for the SVG displacement route. Edge-only refraction:
/// a flat backdrop has no thickness field to lens, so the displacement is
/// concentrated at the surface edge like a thick glass rim.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GlassDisplacementFilter {
    /// Displacement scale in logical pixels, derived from refraction and
    /// depth: `64 * refraction * depthFactor`. `depthFactor` is linear on
    /// authored `[1,10]`, then a soft tail through [`WEB_DEPTH_EFFECTIVE_MAX`].
    pub scale: f64,
    /// Second-pass channel offset in pixels for chromatic aberration:
    /// `24 * dispersion`.
    pub chromatic_offset: f64,
    /// Ready-to-inline `<filter>` markup. The map image is an inline SVG
    /// gradient edge ramp sized by the receiving element.
    pub markup: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebGlassDelivery {
    /// Complete declaration list for the glass surface. Apply to the
    /// element that must show the backdrop through the material.
    pub css: String,
    /// The `backdrop-filter` value on its own, for hosts that compose it.
    pub backdrop_filter: String,
    /// The inset edge response derived from light intensity and angle.
    pub box_shadow: String,
    /// Edge-refraction and dispersion route. `None` when `refraction` and
    /// `dispersion` are both zero: plain frost needs no displacement.
    pub displacement: Option<GlassDisplacementFilter>,
    pub fidelity: Vec<AppearanceFieldDelivery>,
    /// Authored versus optically effective ranges for the Web compile path.
    pub parameter_ranges: Vec<ParameterRangeReceipt>,
    /// Intentional couplings (for example refraction→saturation).
    pub couplings: Vec<ParameterCoupling>,
    /// Calibrated cardinal light-axis mapping used for the inset highlight.
    pub light_axis: LightAxisReceipt,
    /// Rim depth the Web receiver should use (`attachAppearance` reads this).
    pub rim_depth: f64,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SwiftUIGlassDelivery {
    /// SwiftUI's Liquid Glass is the intended native material on iOS 26+.
    pub uses_native_liquid_glass: bool,
    /// Runnable view extension. Optical numbers are not setters; the snippet
    /// maps visibility, shape and interaction and documents the rest.
    pub snippet: String,
    pub fidelity: Vec<AppearanceFieldDelivery>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub optical: Option<OpticalGlassDelivery>,
}

/// Rounded-glass kernel inputs in logical points. The core owns the mapping;
/// the receiving renderer supplies the actual backdrop and surface geometry.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OpticalGlassDelivery {
    pub profile: String,
    pub backdrop: String,
    pub edge_width: f64,
    pub refraction_scale: f64,
    pub chromatic_offset: f64,
    pub frost_radius: f64,
    pub light_direction: [f64; 2],
    pub highlight_strength: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceDeliveryInput {
    pub recipe: AppearanceRecipeSpec,
    /// The resolved material to deliver (typically from `inspect_appearance`).
    pub material: GlassMaterial,
    pub target: AppearanceDeliveryTarget,
    /// Native-only extras inspected beside the seven portable fields (for example
    /// Figma Splay). They never widen GlassMaterial; delivery reports them as losses.
    #[serde(default)]
    #[schemars(default)]
    pub native_extras: BTreeMap<String, serde_json::Value>,
}

/// Redeliver a current native material, independently of a preset upgrade.
/// `previous` is the receiver's accepted source, not its locally edited state.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceUpdateInput {
    pub previous: AppearanceDeliveryInput,
    pub next: AppearanceDeliveryInput,
    #[serde(deserialize_with = "required_live_material")]
    #[schemars(schema_with = "nullable_live_material_schema")]
    pub live: Option<GlassMaterial>,
    #[schemars(length(min = 71, max = 71))]
    pub expected_fingerprint: String,
    /// Consumer path: merge by explicit override intent instead of value
    /// difference. Pass `live: null` alongside; a record keeps overrides
    /// even when they equal the new source defaults.
    #[serde(default)]
    #[schemars(default)]
    pub preference: Option<crate::appearance_preference::AppearancePreferenceRecord>,
    /// Exposure policy that filters which overrides drive the merged
    /// material. Hidden overrides stay in the record with recoverable intent.
    #[serde(default)]
    #[schemars(default)]
    pub policy: Option<crate::appearance_exposure::AppearanceExposurePolicy>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceUpdatePlan {
    #[schemars(schema_with = "update_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub previous_fingerprint: String,
    /// Reject a plan that was prepared before a newer destination edit/removal.
    #[schemars(schema_with = "nullable_fingerprint_schema")]
    pub previous_delivery_fingerprint: Option<String>,
    /// The new source identity stays distinct from the locally merged delivery.
    pub source_fingerprint: String,
    #[schemars(schema_with = "nullable_delivery_plan_schema")]
    pub delivery: Option<AppearanceDeliveryPlan>,
    pub preserved: Vec<GlassField>,
    /// Preference revision this plan was prepared against. Receivers reject
    /// the plan when their committed revision differs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preference_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preference_fingerprint: Option<String>,
    /// Per-override receipts when the consumer path was used.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub preference_receipts: Vec<crate::appearance_preference::AppearancePreferenceFieldReceipt>,
}

fn required_live_material<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<GlassMaterial>, D::Error> {
    Option::<GlassMaterial>::deserialize(deserializer)
}

/// `required` on an Option field would also strip the explicit null that
/// carries local removal; these keep the key required and the value nullable.
fn nullable_live_material_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<GlassMaterial> as JsonSchema>::json_schema(generator)
}

fn nullable_fingerprint_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<String> as JsonSchema>::json_schema(generator)
}

fn nullable_delivery_plan_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<AppearanceDeliveryPlan> as JsonSchema>::json_schema(generator)
}

fn update_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({ "type": "string", "const": "worldbend.appearance-update@0.1" })
}

pub fn plan_appearance_update(
    input: &AppearanceUpdateInput,
) -> TransformResult<AppearanceUpdatePlan> {
    use crate::appearance_preference::{
        AppearancePreferenceFieldReceipt, AppearancePreferenceFieldState, apply_field,
        effective_override_fields,
    };
    let previous = plan_appearance_delivery(&input.previous)?;
    let next = plan_appearance_delivery(&input.next)?;
    if input.expected_fingerprint != previous.fingerprint {
        return Err(schema_error(
            "Appearance source changed; reread the accepted delivery",
        ));
    }
    if input.previous.target != input.next.target
        || input.previous.recipe.recipe_id != input.next.recipe.recipe_id
        || input.next.recipe.recipe_version < input.previous.recipe.recipe_version
        || (input.next.recipe.recipe_version == input.previous.recipe.recipe_version
            && previous.recipe_fingerprint != next.recipe_fingerprint)
    {
        return Err(schema_error(
            "Appearance update needs the same recipe and target; seed changes need a newer version",
        ));
    }
    if let (Some(_), Some(_)) = (input.live, &input.preference) {
        return Err(schema_error(
            "pass either a live material for value-diff merging or `live: null` with an explicit preference, not both",
        ));
    }
    if let Some(preference) = &input.preference {
        preference.validate()?;
        if let Some(policy) = &input.policy
            && policy.target != input.next.target
        {
            return Err(schema_error(
                "the exposure policy target must match the update target",
            ));
        }
        // The consumer path: explicit intent decides preserved fields, so an
        // override equal to the new source default still survives.
        let (applied, receipts) = effective_override_fields(preference, input.policy.as_ref())?;
        let apply = |material: &mut GlassMaterial| {
            for field in &applied {
                apply_field(material, *field, preference.fields[field].value);
            }
        };
        let mut merged = input.next.material;
        apply(&mut merged);
        merged.validate()?;
        // What the receiver currently displays: the previous source with the
        // same preference applied. This is the CAS token for stale rejection.
        let mut previous_display = input.previous.material;
        apply(&mut previous_display);
        let previous_delivery_fingerprint = plan_appearance_delivery(&AppearanceDeliveryInput {
            material: previous_display,
            ..input.previous.clone()
        })?
        .fingerprint;
        let receipts: Vec<AppearancePreferenceFieldReceipt> = receipts
            .into_iter()
            .filter(|receipt| receipt.state == AppearancePreferenceFieldState::Applied)
            .collect();
        let preserved = applied;
        let delivery = plan_appearance_delivery(&AppearanceDeliveryInput {
            material: merged,
            ..input.next.clone()
        })?;
        return Ok(AppearanceUpdatePlan {
            schema: "worldbend.appearance-update@0.1".to_string(),
            version: APPEARANCE_VERSION.to_string(),
            previous_fingerprint: previous.fingerprint,
            previous_delivery_fingerprint: Some(previous_delivery_fingerprint),
            source_fingerprint: next.fingerprint,
            delivery: Some(delivery),
            preserved,
            preference_revision: Some(preference.revision),
            preference_fingerprint: Some(preference.fingerprint()?),
            preference_receipts: receipts,
        });
    }
    let preserved = input
        .live
        .map(|live| live.changed_fields(&input.previous.material))
        .unwrap_or_default();
    let previous_delivery_fingerprint = input
        .live
        .map(|material| {
            plan_appearance_delivery(&AppearanceDeliveryInput {
                material,
                ..input.previous.clone()
            })
            .map(|plan| plan.fingerprint)
        })
        .transpose()?;
    let delivery = if let Some(live) = input.live {
        live.validate()?;
        // Reuse the field merge owned by the seed-upgrade planner, with the
        // previously resolved source as the comparison base. Do not invent or
        // advance recipe versions to represent a native field edit.
        let material = merge_material(input.next.material, live, &preserved);
        Some(plan_appearance_delivery(&AppearanceDeliveryInput {
            material,
            ..input.next.clone()
        })?)
    } else {
        None
    };
    Ok(AppearanceUpdatePlan {
        schema: "worldbend.appearance-update@0.1".to_string(),
        version: APPEARANCE_VERSION.to_string(),
        previous_fingerprint: previous.fingerprint,
        previous_delivery_fingerprint,
        source_fingerprint: next.fingerprint,
        delivery,
        preserved,
        preference_revision: None,
        preference_fingerprint: None,
        preference_receipts: Vec::new(),
    })
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AppearanceDeliveryPlan {
    #[schemars(schema_with = "delivery_schema")]
    pub schema: String,
    #[schemars(schema_with = "delivery_version_schema")]
    pub version: String,
    /// Identity of the delivered state: seed identity plus resolved values.
    /// Two deliveries with the same fingerprint show the same parameters.
    pub fingerprint: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: GlassMaterial,
    pub target: AppearanceDeliveryTarget,
    pub web: Option<WebGlassDelivery>,
    pub swiftui: Option<SwiftUIGlassDelivery>,
    /// Native extras / mechanisms that did not enter the portable seven fields.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub losses: Vec<AppearanceLossReceipt>,
}

fn delivery_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_DELIVERY_SCHEMA })
}

fn delivery_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": APPEARANCE_VERSION })
}

fn format_px(value: f64) -> String {
    let rounded = (value * 100.0).round() / 100.0;
    if (rounded - rounded.trunc()).abs() < f64::EPSILON {
        format!("{}px", rounded.trunc() as i64)
    } else {
        format!("{rounded}px")
    }
}

fn format_ratio(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if (rounded - rounded.trunc()).abs() < f64::EPSILON {
        format!("{}", rounded.trunc() as i64)
    } else {
        format!("{rounded}")
    }
}

fn plan_web_delivery(material: &GlassMaterial, preserve_color: bool) -> WebGlassDelivery {
    // Frost stays literal. Saturation and brightness are intentional
    // compensation for backdrop-filter milkiness; refraction also raises
    // saturation (disclosed below as a coupling, not an independent color control).
    let saturation = 1.0 + 0.35 * material.dispersion + 0.25 * material.refraction;
    let brightness = 1.0 + f64::min(0.12, material.radius / 2000.0);
    let backdrop_filter = if preserve_color {
        format!("blur({})", format_px(material.radius))
    } else {
        format!(
            "blur({}) saturate({}) brightness({})",
            format_px(material.radius),
            format_ratio(saturation),
            format_ratio(brightness)
        )
    };

    // Calibrated to native/Metal cardinals: 0 down, 90 left, 180 up, 270 right.
    // Highlight sits on the lit edge in CSS screen space (+x right, +y down).
    let (light_dir, cardinal) = light_direction_screen(material.light_angle);
    let amount = 2.0 + 6.0 * material.light_intensity;
    let offset_x = light_dir[0] * amount;
    let offset_y = light_dir[1] * amount;
    let highlight_blur = 4.0 + 10.0 * material.light_intensity;
    let highlight_alpha = 0.15 + 0.55 * material.light_intensity;
    let border_alpha = 0.08 + 0.25 * material.light_intensity;
    let box_shadow = format!(
        "inset {} {} {} rgba(255,255,255,{:.2}), inset 0 0 {} rgba(255,255,255,{:.2})",
        format_px(offset_x),
        format_px(offset_y),
        format_px(highlight_blur),
        highlight_alpha.min(1.0),
        format_px(highlight_blur * 1.5),
        (highlight_alpha * 0.6).min(1.0)
    );
    let mut css = format!(
        "backdrop-filter: {};\nbox-shadow: {};\nborder: 1px solid rgba(255,255,255,{:.2});",
        backdrop_filter,
        box_shadow,
        border_alpha.min(1.0)
    );

    let (depth_factor, depth_effective, depth_clamped) = web_depth_factor(material.depth);
    let (rim_depth, rim_effective, rim_clamped) = web_rim_depth(material.depth);
    let displacement = if material.refraction > 0.0 || material.dispersion > 0.0 {
        let scale = 64.0 * material.refraction * depth_factor;
        let chromatic_offset = 24.0 * material.dispersion;
        // The edge-ramp map rides as one percent-encoded SVG data URI, so the
        // markup stays a well-formed attribute value in HTML and XML hosts.
        // Reference elliptical normal map. The Web runtime replaces this
        // map with a rounded-rectangle distance field at the element's size.
        let y_svg = "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><defs><linearGradient id='y' x1='0' y1='0' x2='0' y2='1'><stop stop-color='#80ff80'/><stop offset='1' stop-color='#800080'/></linearGradient></defs><rect width='256' height='256' fill='url(#y)'/></svg>";
        let y_uri = format!(
            "data:image/svg+xml,{}",
            y_svg
                .bytes()
                .map(|b| format!("%{b:02X}"))
                .collect::<String>()
        );
        let map_svg = format!(
            "<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><defs><linearGradient id='x'><stop stop-color='#ff8080'/><stop offset='1' stop-color='#008080'/></linearGradient><radialGradient id='rim'><stop offset='.65' stop-color='black'/><stop offset='1' stop-color='white'/></radialGradient><mask id='m'><rect width='256' height='256' fill='url(#rim)'/></mask><filter id='n' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feImage href='{y_uri}' result='y' x='0' y='0' width='100%' height='100%'/><feComposite in='SourceGraphic' in2='y' operator='arithmetic' k2='1' k3='1' k4='-.502'/></filter></defs><rect width='256' height='256' fill='#808080'/><rect width='256' height='256' fill='url(#x)' filter='url(#n)' mask='url(#m)'/></svg>"
        );
        let edge_map = format!(
            "data:image/svg+xml,{}",
            map_svg
                .bytes()
                .map(|b| format!("%{b:02X}"))
                .collect::<String>()
        );
        let markup = format!(
            "<filter id=\"worldbend-glass\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\" color-interpolation-filters=\"sRGB\">\n<feImage href=\"{edge_map}\" result=\"edge-map\" preserveAspectRatio=\"none\"/>\n<feDisplacementMap in=\"SourceGraphic\" in2=\"edge-map\" scale=\"{}\" xChannelSelector=\"R\" yChannelSelector=\"G\" result=\"refracted\"/>\n<feDisplacementMap in=\"refracted\" in2=\"edge-map\" scale=\"{}\" xChannelSelector=\"R\" yChannelSelector=\"G\" result=\"red-shift\"/>\n<feColorMatrix in=\"red-shift\" values=\"1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0\" result=\"red\"/>\n<feColorMatrix in=\"refracted\" values=\"0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0\" result=\"green\"/>\n<feDisplacementMap in=\"refracted\" in2=\"edge-map\" scale=\"{}\" xChannelSelector=\"R\" yChannelSelector=\"G\" result=\"blue-shift\"/>\n<feColorMatrix in=\"blue-shift\" values=\"0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0\" result=\"blue\"/>\n<feBlend in=\"red\" in2=\"green\" mode=\"screen\" result=\"rg\"/><feBlend in=\"rg\" in2=\"blue\" mode=\"screen\"/>\n</filter>",
            format_ratio(scale),
            format_ratio(chromatic_offset),
            format_ratio(-chromatic_offset)
        );
        Some(GlassDisplacementFilter {
            scale,
            chromatic_offset,
            markup,
        })
    } else {
        None
    };

    if displacement.is_some() {
        css = css.replacen(
            &backdrop_filter,
            &format!("{} url(\"#worldbend-glass\")", backdrop_filter),
            1,
        );
    }
    if !material.visible {
        css.clear();
    }
    let fidelity = vec![
        AppearanceFieldDelivery {
            field: GlassField::Visible,
            mapping: AppearanceFieldMapping::Native,
            note: "visible=false omits the glass declarations entirely".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Radius,
            mapping: AppearanceFieldMapping::Native,
            note: "frost radius maps to the backdrop-filter blur length".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::LightIntensity,
            mapping: AppearanceFieldMapping::Approximated,
            note: "drives the inset edge highlight strength; Figma's full specular response is richer"
                .to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::LightAngle,
            mapping: AppearanceFieldMapping::Approximated,
            note: format!(
                "positions the inset highlight on the lit edge; cardinals match native/Metal ({cardinal} at {angle}°)",
                angle = material.light_angle
            ),
        },
        AppearanceFieldDelivery {
            field: GlassField::Refraction,
            mapping: AppearanceFieldMapping::Approximated,
            note: if preserve_color { "edge-only displacement without global saturation or brightness compensation; sampled color stays intact, while explicit dispersion and edge lighting remain separate" } else { "edge-only displacement; also intentionally raises backdrop-filter saturate (see couplings)" }.to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Depth,
            mapping: AppearanceFieldMapping::Approximated,
            note: format!(
                "scales edge displacement (linear to depth {WEB_DEPTH_LINEAR_END}, soft tail to {WEB_DEPTH_EFFECTIVE_MAX}; effective {depth_effective}, clamped={depth_clamped}) and rim width (linear to {WEB_RIM_LINEAR_END}, soft tail to {WEB_RIM_EFFECTIVE_MAX})"
            ),
        },
        AppearanceFieldDelivery {
            field: GlassField::Dispersion,
            mapping: AppearanceFieldMapping::Approximated,
            note: "RGB channel separation in the Web runtime; an approximation rather than a spectral solver".to_string(),
        },
    ];
    let parameter_ranges = vec![
        ParameterRangeReceipt {
            field: "depth".into(),
            unit: "logical-px".into(),
            authored_min: 1.0,
            authored_max: MAX_GLASS_DEPTH,
            effective_min: 1.0,
            effective_max: WEB_DEPTH_EFFECTIVE_MAX,
            authored: material.depth,
            effective: depth_effective,
            clamped: depth_clamped,
            note: "Web displacement depthFactor is linear on [1,10] then a soft tail through 100; values above 100 clamp".into(),
        },
        ParameterRangeReceipt {
            field: "depth.rim".into(),
            unit: "logical-px".into(),
            authored_min: 1.0,
            authored_max: MAX_GLASS_DEPTH,
            effective_min: 1.0,
            effective_max: WEB_RIM_EFFECTIVE_MAX,
            authored: material.depth,
            effective: rim_effective,
            clamped: rim_clamped,
            note: "Web receiver rim uses clamped authored depth on [1,100] (historical linear [1,20] then soft tail); mapped rim contribution is delivery.rimDepth (max 40)".into(),
        },
    ];
    let couplings = if preserve_color {
        vec![]
    } else {
        vec![
        ParameterCoupling {
            from_field: "refraction".into(),
            to_channel: "backdrop-filter.saturate".into(),
            formula: "1 + 0.35*dispersion + 0.25*refraction".into(),
            intentional: true,
            note: "This Web profile also changes artwork saturation; use web-color-preserving when refraction must retain the sampled color treatment".into(),
        },
        ParameterCoupling {
            from_field: "dispersion".into(),
            to_channel: "backdrop-filter.saturate".into(),
            formula: "1 + 0.35*dispersion + 0.25*refraction".into(),
            intentional: true,
            note: "Dispersion shares the same saturate compensation channel as refraction".into(),
        },
    ]
    };
    let light_axis = LightAxisReceipt {
        convention: "native-cardinal@1".into(),
        angle_degrees: material.light_angle,
        direction: light_dir,
        cardinal: cardinal.into(),
        note: "Shared Figma/Web/Metal screen-space mapping: 0 down, 90 left, 180 up, 270 right; Web inset highlight uses this vector on the lit edge".into(),
    };
    WebGlassDelivery {
        css,
        backdrop_filter: if material.visible {
            backdrop_filter
        } else {
            String::new()
        },
        box_shadow: if material.visible {
            box_shadow
        } else {
            String::new()
        },
        displacement: if material.visible { displacement } else { None },
        fidelity,
        parameter_ranges: if material.visible {
            parameter_ranges
        } else {
            Vec::new()
        },
        couplings: if material.visible {
            couplings
        } else {
            Vec::new()
        },
        light_axis,
        rim_depth: if material.visible { rim_depth } else { 0.0 },
    }
}

fn plan_swiftui_delivery(
    material: &GlassMaterial,
    recipe: &AppearanceRecipeSpec,
) -> SwiftUIGlassDelivery {
    let recipe_id = bounded_text(recipe.recipe_id.trim(), MAX_APPEARANCE_RECIPE_ID)
        .replace(['\u{2028}', '\u{2029}'], " ");
    let snippet = format!(
        "import SwiftUI\n\n@available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, *)\nextension View {{\n  \
         /// Worldbend appearance delivery — recipe \"{recipe_id}\" v{}.\n  \
         /// Applies the system Liquid Glass material on iOS 26+.\n  \
         func worldbendGlass(cornerRadius: CGFloat) -> some View {{\n    \
         self.glassEffect({} ? .regular.interactive() : .identity, in: .rect(cornerRadius: cornerRadius))\n  \
         }}\n\
         }}\n",
        recipe.recipe_version, material.visible
    );
    let fidelity = vec![
        AppearanceFieldDelivery {
            field: GlassField::Visible,
            mapping: AppearanceFieldMapping::Native,
            note: format!(
                "the generated modifier applies the exported visibility: {}",
                material.visible
            ),
        },
        AppearanceFieldDelivery {
            field: GlassField::LightIntensity,
            mapping: AppearanceFieldMapping::Unavailable,
            note: "system-driven highlights; not a SwiftUI setter".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::LightAngle,
            mapping: AppearanceFieldMapping::Unavailable,
            note: "system lighting; not a SwiftUI setter".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Refraction,
            mapping: AppearanceFieldMapping::Unavailable,
            note:
                "the system refracts inherently but the exported refraction magnitude has no setter"
                    .to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Depth,
            mapping: AppearanceFieldMapping::Unavailable,
            note: "no thickness setter on the system material".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Dispersion,
            mapping: AppearanceFieldMapping::Unavailable,
            note: "system chromatic behavior is fixed; no dispersion setter".to_string(),
        },
        AppearanceFieldDelivery {
            field: GlassField::Radius,
            mapping: AppearanceFieldMapping::Unavailable,
            note: "the material adapts frost itself; a fixed radius needs a custom implementation"
                .to_string(),
        },
    ];
    SwiftUIGlassDelivery {
        uses_native_liquid_glass: true,
        snippet,
        fidelity,
        optical: None,
    }
}

fn plan_optical_delivery(material: &GlassMaterial) -> SwiftUIGlassDelivery {
    let (light_direction, _) = light_direction_screen(material.light_angle);
    SwiftUIGlassDelivery {
        uses_native_liquid_glass: false,
        snippet: "// Requires WorldbendAppearance (iOS 17+/macOS 14+). Supply a renderable, presentation-only backdrop.\nWorldbendOpticalScene(backdrop: { sceneArtwork }) { backdrop in\n  existingControls.background {\n    WorldbendOpticalPane(backdrop: backdrop, optics: material.opticalConfiguration, cornerRadius: 24)\n  }.contentShape(RoundedRectangle(cornerRadius: 24))\n}\n// Retain one AppearanceSession. Foreground controls are never sampled.\n".to_string(),
        fidelity: GLASS_FIELDS.iter().map(|field| AppearanceFieldDelivery {
            field: *field,
            mapping: if *field == GlassField::Visible { AppearanceFieldMapping::Native } else { AppearanceFieldMapping::Approximated },
            note: match field {
                GlassField::Visible => "hidden or removed material emits no pane; foreground identity is preserved",
                GlassField::LightIntensity => "scales directional edge highlights in the Metal kernel",
                GlassField::LightAngle => "calibrated to the native Glass primary highlight: 0 down, 90 left, 180 up, 270 right",
                GlassField::Refraction => "scales rounded-surface backdrop displacement up to 32 logical points",
                GlassField::Depth => "sets the refracting rim width, limited by the receiving surface half-size",
                GlassField::Dispersion => "separates sampled red and blue by up to 8 logical points at the rim",
                GlassField::Radius => "sets SwiftUI Gaussian backdrop blur in logical points before refraction",
            }.to_string(),
        }).collect(),
        optical: Some(OpticalGlassDelivery {
            profile: "worldbend.rounded-glass-metal@0.1".to_string(),
            backdrop: "explicit-swiftui-layer".to_string(),
            edge_width: material.depth,
            refraction_scale: 32.0 * material.refraction,
            chromatic_offset: 8.0 * material.dispersion,
            frost_radius: material.radius,
            light_direction,
            highlight_strength: 0.6 * material.light_intensity,
        }),
    }
}

/// Project one resolved appearance state onto its target implementation. The
/// plan is complete for the requested target only; the other stays `None`.
pub fn plan_appearance_delivery(
    input: &AppearanceDeliveryInput,
) -> TransformResult<AppearanceDeliveryPlan> {
    input.recipe.validate()?;
    input.material.validate()?;
    let recipe_fingerprint = input.recipe.fingerprint()?;
    let fingerprint = fingerprint_json_value(
        &canonical_json_value(&DeliveryFingerprintValue {
            schema: APPEARANCE_DELIVERY_SCHEMA,
            version: APPEARANCE_VERSION,
            recipe_fingerprint: recipe_fingerprint.as_str(),
            material: &input.material,
            target: input.target,
        })
        .map_err(|_| schema_error("invalid delivery input"))?,
    )
    .map_err(|_| schema_error("invalid delivery input"))?;
    let (web, swiftui) = match input.target {
        AppearanceDeliveryTarget::Web => (Some(plan_web_delivery(&input.material, false)), None),
        AppearanceDeliveryTarget::WebColorPreserving => {
            (Some(plan_web_delivery(&input.material, true)), None)
        }
        AppearanceDeliveryTarget::SwiftUI => (
            None,
            Some(plan_swiftui_delivery(&input.material, &input.recipe)),
        ),
        AppearanceDeliveryTarget::SwiftUIOptical => {
            (None, Some(plan_optical_delivery(&input.material)))
        }
    };
    let losses = glass_native_extra_losses(&input.native_extras);
    Ok(AppearanceDeliveryPlan {
        schema: APPEARANCE_DELIVERY_SCHEMA.to_string(),
        version: APPEARANCE_VERSION.to_string(),
        fingerprint,
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint,
        material: input.material,
        target: input.target,
        web,
        swiftui,
        losses,
    })
}

#[derive(Serialize)]
struct DeliveryFingerprintValue<'a> {
    schema: &'a str,
    version: &'a str,
    recipe_fingerprint: &'a str,
    material: &'a GlassMaterial,
    target: AppearanceDeliveryTarget,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe() -> AppearanceRecipeSpec {
        AppearanceRecipeSpec {
            schema: APPEARANCE_SCHEMA.to_string(),
            version: APPEARANCE_VERSION.to_string(),
            recipe_id: "clear-lens".to_string(),
            recipe_version: 1,
            material: GlassMaterial::default(),
        }
    }

    #[test]
    fn rejects_out_of_range_glass_fields() {
        let mut spec = recipe();
        spec.material.light_intensity = 1.4;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.light_intensity = 0.5;
        spec.material.depth = 0.5;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.depth = f64::NAN;
        assert_eq!(
            spec.validate().unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
        spec.material.depth = 2.0;
        spec.material.light_angle = 360.0;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn rejects_foreign_schema_and_blank_recipe_ids() {
        let mut spec = recipe();
        spec.schema = "worldbend.mockup@0.1".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.schema = APPEARANCE_SCHEMA.to_string();
        spec.recipe_id = "   ".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.recipe_id = "x".repeat(MAX_APPEARANCE_RECIPE_ID + 1);
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn recipe_fingerprint_is_stable_across_key_order() {
        let first = recipe().fingerprint().unwrap();
        let json = serde_json::to_value(recipe()).unwrap();
        let second: AppearanceRecipeSpec = serde_json::from_value(json).unwrap();
        assert_eq!(first, second.fingerprint().unwrap());
        let mut changed = recipe();
        changed.material.radius = 24.0;
        assert_ne!(first, changed.fingerprint().unwrap());
    }

    #[test]
    fn inspection_reports_every_reconciliation_state() {
        let seed = recipe();
        // Untouched surface.
        let absent = inspect_appearance(&AppearanceInspectionInput {
            recipe: seed.clone(),
            live: None,
            tagged: false,
        })
        .unwrap();
        assert_eq!(absent.state, AppearanceInstanceState::Absent);
        assert_eq!(absent.customized.len(), 0);
        // Seed-matching instance.
        let tagged = inspect_appearance(&AppearanceInspectionInput {
            recipe: seed.clone(),
            live: Some(seed.material),
            tagged: true,
        })
        .unwrap();
        assert_eq!(tagged.state, AppearanceInstanceState::Tagged);
        // Native drift is the designer's edit, never invalid.
        let mut drifted = seed.material;
        drifted.radius = 40.0;
        drifted.light_angle = 200.0;
        let customized = inspect_appearance(&AppearanceInspectionInput {
            recipe: seed.clone(),
            live: Some(drifted),
            tagged: true,
        })
        .unwrap();
        assert_eq!(customized.state, AppearanceInstanceState::Customized);
        assert_eq!(
            customized.customized,
            vec![GlassField::LightAngle, GlassField::Radius]
        );
        assert_eq!(customized.material.radius, 40.0);
        // Untagged native glass stays inspectable.
        let untagged = inspect_appearance(&AppearanceInspectionInput {
            recipe: seed.clone(),
            live: Some(seed.material),
            tagged: false,
        })
        .unwrap();
        assert_eq!(untagged.state, AppearanceInstanceState::UntaggedNative);
        // Native removal beats provenance.
        let removed = inspect_appearance(&AppearanceInspectionInput {
            recipe: seed,
            live: None,
            tagged: true,
        })
        .unwrap();
        assert_eq!(removed.state, AppearanceInstanceState::Removed);
    }

    #[test]
    fn web_delivery_maps_frost_and_light_deterministically() {
        let material = GlassMaterial {
            radius: 16.0,
            light_intensity: 1.0,
            light_angle: 90.0,
            refraction: 0.0,
            dispersion: 0.0,
            ..GlassMaterial::default()
        };
        let plan = plan_appearance_delivery(&AppearanceDeliveryInput {
            recipe: recipe(),
            material,
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap();
        let web = plan.web.expect("web target fills the web block");
        assert!(plan.swiftui.is_none());
        assert!(web.backdrop_filter.contains("blur(16px)"));
        assert!(web.backdrop_filter.contains("saturate(1)"));
        // Native-cardinal@1: 90° is left; highlight sits on the lit edge.
        assert!(web.box_shadow.contains("inset -8px 0px 14px"));
        assert_eq!(web.light_axis.cardinal, "left");
        assert!((web.light_axis.direction[0] + 1.0).abs() < 1e-9);
        assert!(web.light_axis.direction[1].abs() < 1e-9);
        assert!(web.displacement.is_none());
        assert!(web.css.starts_with("backdrop-filter: blur(16px)"));
        assert_eq!(web.fidelity.len(), GLASS_FIELDS.len());
        assert!(web.couplings.iter().any(|c| c.from_field == "refraction"));
    }

    #[test]
    fn web_delivery_adds_edge_displacement_only_with_optics() {
        let material = GlassMaterial {
            refraction: 0.5,
            dispersion: 0.25,
            depth: 10.0,
            ..GlassMaterial::default()
        };
        let plan = plan_appearance_delivery(&AppearanceDeliveryInput {
            recipe: recipe(),
            material,
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap();
        let displacement = plan.web.unwrap().displacement.unwrap();
        assert!((displacement.scale - 32.0).abs() < 1e-9);
        assert!((displacement.chromatic_offset - 6.0).abs() < 1e-9);
        assert!(displacement.markup.contains("feDisplacementMap"));
        // The feImage source is one percent-encoded data URI: a raw `<` or
        // unescaped quote would break the attribute in HTML and XML hosts.
        let href = displacement
            .markup
            .split("href=\"")
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .expect("feImage carries an href attribute");
        assert!(href.starts_with("data:image/svg+xml,%3C%73%76%67"));
        assert!(!href.contains(['<', '>', '"', ' ']));
        assert!(!href.contains("%3E%3Csvg"));
        assert!(href.contains("%78%6D%6C%6E%73"));
    }

    #[test]
    fn swiftui_delivery_discloses_field_level_losses() {
        let plan = plan_appearance_delivery(&AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial::default(),
            target: AppearanceDeliveryTarget::SwiftUI,
            native_extras: BTreeMap::new(),
        })
        .unwrap();
        assert!(plan.web.is_none());
        let swiftui = plan
            .swiftui
            .expect("swiftui target fills the swiftui block");
        assert!(swiftui.uses_native_liquid_glass);
        assert!(
            swiftui
                .snippet
                .contains("glassEffect(true ? .regular.interactive() : .identity")
        );
        assert!(swiftui.snippet.contains("clear-lens"));
        assert_eq!(swiftui.fidelity.len(), GLASS_FIELDS.len());
        let unavailable = swiftui
            .fidelity
            .iter()
            .filter(|entry| entry.mapping == AppearanceFieldMapping::Unavailable)
            .count();
        assert_eq!(unavailable, 6);
    }

    #[test]
    fn optical_delivery_compiles_each_field_and_keeps_system_route_explicit() {
        let base = GlassMaterial::default();
        let plan = plan_optical_delivery(&base);
        assert!(!plan.uses_native_liquid_glass);
        assert_eq!(
            plan.fidelity
                .iter()
                .filter(|f| f.mapping == AppearanceFieldMapping::Approximated)
                .count(),
            6
        );
        let uniforms = serde_json::to_value(plan.optical.unwrap()).unwrap();
        let variants = [
            GlassMaterial {
                depth: 20.0,
                ..base
            },
            GlassMaterial {
                refraction: 0.8,
                ..base
            },
            GlassMaterial {
                dispersion: 0.6,
                ..base
            },
            GlassMaterial {
                radius: 2.0,
                ..base
            },
            GlassMaterial {
                light_angle: 45.0,
                ..base
            },
            GlassMaterial {
                light_intensity: 0.8,
                ..base
            },
        ];
        for material in variants {
            assert_ne!(
                serde_json::to_value(plan_optical_delivery(&material).optical.unwrap()).unwrap(),
                uniforms
            );
        }
        for (angle, expected) in [
            (0.0, [0.0, 1.0]),
            (90.0, [-1.0, 0.0]),
            (180.0, [0.0, -1.0]),
            (270.0, [1.0, 0.0]),
        ] {
            let optical = plan_optical_delivery(&GlassMaterial {
                light_angle: angle,
                ..base
            })
            .optical
            .unwrap();
            assert!((optical.light_direction[0] - expected[0]).abs() < 1e-9);
            assert!((optical.light_direction[1] - expected[1]).abs() < 1e-9);
        }
        let system = plan_swiftui_delivery(&base, &recipe());
        assert!(system.optical.is_none());
        assert!(system.uses_native_liquid_glass);
        let input = AppearanceDeliveryInput {
            recipe: recipe(),
            material: base,
            target: AppearanceDeliveryTarget::SwiftUIOptical,
            native_extras: BTreeMap::new(),
        };
        let optical = plan_appearance_delivery(&input).unwrap();
        let system = plan_appearance_delivery(&AppearanceDeliveryInput {
            target: AppearanceDeliveryTarget::SwiftUI,
            ..input
        })
        .unwrap();
        assert_ne!(optical.fingerprint, system.fingerprint);
    }

    #[test]
    fn delivery_fingerprint_binds_resolved_values_and_target() {
        let base = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial::default(),
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let first = plan_appearance_delivery(&base).unwrap().fingerprint;
        let mut changed_material = base.clone();
        changed_material.material.radius = 40.0;
        let second = plan_appearance_delivery(&changed_material)
            .unwrap()
            .fingerprint;
        let mut changed_target = base;
        changed_target.target = AppearanceDeliveryTarget::SwiftUI;
        let third = plan_appearance_delivery(&changed_target)
            .unwrap()
            .fingerprint;
        assert_ne!(first, second);
        assert_ne!(first, third);
    }
    #[test]
    fn native_float_storage_is_not_customization_and_invalid_live_is_rejected() {
        let seed = recipe();
        let mut live = seed.material;
        live.refraction = f64::from(live.refraction as f32);
        let input = AppearanceInspectionInput {
            recipe: seed,
            live: Some(live),
            tagged: true,
        };
        assert_eq!(
            inspect_appearance(&input).unwrap().state,
            AppearanceInstanceState::Tagged
        );
        let mut invalid = input;
        invalid.live.as_mut().unwrap().depth = 0.5;
        assert!(inspect_appearance(&invalid).is_err());
    }
    #[test]
    fn hidden_delivery_really_omits_effects() {
        let mut input = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial {
                visible: false,
                ..GlassMaterial::default()
            },
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let web = plan_appearance_delivery(&input).unwrap().web.unwrap();
        assert!(web.css.is_empty() && web.backdrop_filter.is_empty() && web.displacement.is_none());
        input.target = AppearanceDeliveryTarget::SwiftUI;
        let snippet = plan_appearance_delivery(&input)
            .unwrap()
            .swiftui
            .unwrap()
            .snippet;
        assert!(
            snippet.contains("glassEffect(false ? .regular.interactive() : .identity")
                && snippet.contains("@available(iOS 26.0")
        );
    }
    #[test]
    fn seed_upgrade_preserves_native_edits_and_removal() {
        let previous = recipe();
        let mut next = previous.clone();
        next.recipe_version = 2;
        next.material.refraction = 0.7;
        next.material.radius = 20.0;
        let mut live = previous.material;
        live.radius = 1.0;
        live.refraction = f64::from(live.refraction as f32);
        let mut input = AppearanceRevisionInput {
            previous,
            next,
            live: Some(live),
        };
        let result = plan_appearance_revision(&input).unwrap();
        assert_eq!(result.preserved, vec![GlassField::Radius]);
        assert_eq!(result.material.unwrap().radius, 1.0);
        assert_eq!(result.material.unwrap().refraction, 0.7);
        input.live = None;
        assert!(plan_appearance_revision(&input).unwrap().material.is_none());
        input.next.recipe_id = "different-material".into();
        assert!(plan_appearance_revision(&input).is_err());
    }

    fn update_input() -> AppearanceUpdateInput {
        let previous = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial {
                radius: 1.0,
                ..GlassMaterial::default()
            },
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let mut next = previous.clone();
        next.material.radius = 8.0;
        next.material.refraction = 0.8;
        let expected_fingerprint = plan_appearance_delivery(&previous).unwrap().fingerprint;
        AppearanceUpdateInput {
            live: Some(previous.material),
            previous,
            next,
            expected_fingerprint,
            preference: None,
            policy: None,
        }
    }

    #[test]
    fn native_redelivery_does_not_invent_a_preset_upgrade() {
        let input = update_input();
        let result = plan_appearance_update(&input).unwrap();
        let delivery = result.delivery.unwrap();
        assert_eq!(delivery.material, input.next.material);
        assert_eq!(
            delivery.recipe_version,
            input.previous.recipe.recipe_version
        );
        assert_eq!(delivery.fingerprint, result.source_fingerprint);
        assert_eq!(
            result.previous_delivery_fingerprint.as_deref(),
            Some(input.expected_fingerprint.as_str())
        );
        assert!(result.preserved.is_empty());
    }

    #[test]
    fn native_redelivery_keeps_destination_overrides_and_distinct_source_identity() {
        let mut input = update_input();
        input.live.as_mut().unwrap().radius = 4.0;
        let result = plan_appearance_update(&input).unwrap();
        let delivery = result.delivery.unwrap();
        assert_eq!(delivery.material.radius, 4.0);
        assert_eq!(delivery.material.refraction, input.next.material.refraction);
        assert_eq!(result.preserved, vec![GlassField::Radius]);
        assert_ne!(delivery.fingerprint, result.source_fingerprint);
        assert_ne!(
            result.previous_delivery_fingerprint.as_deref(),
            Some(input.expected_fingerprint.as_str())
        );
        assert_eq!(
            result.source_fingerprint,
            plan_appearance_delivery(&input.next).unwrap().fingerprint
        );
        input.live = None;
        let removed = plan_appearance_update(&input).unwrap();
        assert!(removed.delivery.is_none() && removed.previous_delivery_fingerprint.is_none());
    }

    #[test]
    fn redelivery_rejects_stale_source_and_incompatible_recipe_or_target() {
        let mut input = update_input();
        input.expected_fingerprint = "stale".into();
        assert!(plan_appearance_update(&input).is_err());
        input.expected_fingerprint = plan_appearance_delivery(&input.previous)
            .unwrap()
            .fingerprint;
        input.next.target = AppearanceDeliveryTarget::SwiftUI;
        assert!(plan_appearance_update(&input).is_err());
        input.next.target = AppearanceDeliveryTarget::Web;
        input.next.recipe.recipe_id = "foreign".into();
        assert!(plan_appearance_update(&input).is_err());
        input.next.recipe = input.previous.recipe.clone();
        input.next.recipe.material.radius += 1.0;
        assert!(plan_appearance_update(&input).is_err());
        input.next.recipe.recipe_version += 1;
        assert!(plan_appearance_update(&input).is_ok());
        input.live.as_mut().unwrap().depth = f64::NAN;
        assert_eq!(
            plan_appearance_update(&input).unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
    }

    #[test]
    fn redelivery_requires_explicit_live_state_before_planning_removal() {
        let mut json = serde_json::to_value(update_input()).unwrap();
        json.as_object_mut().unwrap().remove("live");
        assert!(serde_json::from_value::<AppearanceUpdateInput>(json.clone()).is_err());
        json["live"] = serde_json::Value::Null;
        let input: AppearanceUpdateInput = serde_json::from_value(json).unwrap();
        assert!(plan_appearance_update(&input).unwrap().delivery.is_none());
    }

    #[test]
    fn web_depth_20_and_100_diverge_inside_effective_range() {
        let plan = |depth: f64| {
            plan_appearance_delivery(&AppearanceDeliveryInput {
                recipe: recipe(),
                material: GlassMaterial {
                    depth,
                    refraction: 0.8,
                    dispersion: 0.2,
                    ..GlassMaterial::default()
                },
                target: AppearanceDeliveryTarget::Web,
                native_extras: BTreeMap::new(),
            })
            .unwrap()
            .web
            .unwrap()
        };
        let a = plan(20.0);
        let b = plan(100.0);
        let scale_a = a.displacement.as_ref().unwrap().scale;
        let scale_b = b.displacement.as_ref().unwrap().scale;
        assert!(
            (scale_b - scale_a).abs() > 1.0,
            "expected optically distinct scales, got {scale_a} vs {scale_b}"
        );
        assert!((scale_a - 64.0 * 0.8 * web_depth_factor(20.0).0).abs() < 1e-9);
        assert!((scale_b - 64.0 * 0.8 * web_depth_factor(100.0).0).abs() < 1e-9);
        assert!(scale_b <= WEB_DISPLACEMENT_SCALE_MAX + 1e-9);
        // Historical linear band is preserved: depth 10 still yields factor 1.0.
        assert!((web_depth_factor(10.0).0 - 1.0).abs() < 1e-12);
        let deep = plan(1000.0);
        let depth_range = deep
            .parameter_ranges
            .iter()
            .find(|row| row.field == "depth")
            .unwrap();
        assert!(depth_range.clamped);
        assert_eq!(depth_range.effective, WEB_DEPTH_EFFECTIVE_MAX);
        assert_eq!(deep.rim_depth, web_rim_depth(1000.0).0);
        let rim_range = deep
            .parameter_ranges
            .iter()
            .find(|row| row.field == "depth.rim")
            .unwrap();
        assert!(rim_range.clamped);
        // effective is clamped authored depth, not the mapped rim contribution.
        assert_eq!(rim_range.effective, WEB_RIM_EFFECTIVE_MAX);
        assert!((deep.rim_depth - WEB_RIM_AT_EFFECTIVE_MAX).abs() < 1e-12);
        assert!((plan(20.0).rim_depth - 20.0).abs() < 1e-12);
        assert!(plan(100.0).rim_depth > plan(20.0).rim_depth);
        let web20 = plan(20.0);
        let rim20 = web20
            .parameter_ranges
            .iter()
            .find(|row| row.field == "depth.rim")
            .unwrap();
        assert!((rim20.effective - 20.0).abs() < 1e-12);
        assert!(!rim20.clamped);
    }

    #[test]
    fn web_refraction_saturation_coupling_is_disclosed() {
        let web = plan_appearance_delivery(&AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial {
                refraction: 1.0,
                dispersion: 0.0,
                ..GlassMaterial::default()
            },
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap()
        .web
        .unwrap();
        assert!(web.backdrop_filter.contains("saturate(1.25)"));
        let coupling = web
            .couplings
            .iter()
            .find(|row| row.from_field == "refraction")
            .expect("refraction coupling");
        assert!(coupling.intentional);
        assert!(coupling.to_channel.contains("saturate"));
    }

    #[test]
    fn native_extras_survive_as_loss_receipts_not_seven_field_success() {
        let mut extras = BTreeMap::new();
        extras.insert("splay".into(), serde_json::json!(0.2));
        let plan = plan_appearance_delivery(&AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial::default(),
            target: AppearanceDeliveryTarget::Web,
            native_extras: extras,
        })
        .unwrap();
        assert_eq!(plan.losses.len(), 1);
        assert_eq!(plan.losses[0].key, "splay");
        assert_eq!(plan.losses[0].kind, "unmapped-native-control");
        assert!(plan.web.is_some());
    }

    #[test]
    fn color_preserving_profile_changes_identity_without_adding_global_color_filters() {
        let mut input = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial {
                refraction: 1.0,
                dispersion: 0.4,
                radius: 24.0,
                ..Default::default()
            },
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let compensated = plan_appearance_delivery(&input).unwrap();
        input.target = AppearanceDeliveryTarget::WebColorPreserving;
        let faithful = plan_appearance_delivery(&input).unwrap();
        assert_ne!(faithful.fingerprint, compensated.fingerprint);
        assert_eq!(faithful.material, compensated.material);
        let web = faithful.web.as_ref().unwrap();
        assert_eq!(web.backdrop_filter, "blur(24px)");
        assert!(web.couplings.is_empty());
        assert!(!web.css.contains("saturate") && !web.css.contains("brightness"));
        assert_eq!(
            web.displacement.as_ref().unwrap().scale,
            compensated
                .web
                .as_ref()
                .unwrap()
                .displacement
                .as_ref()
                .unwrap()
                .scale
        );
        assert!((web.displacement.as_ref().unwrap().chromatic_offset - 9.6).abs() < 1e-12);
        input.material.visible = false;
        let hidden = plan_appearance_delivery(&input).unwrap().web.unwrap();
        assert!(
            hidden.css.is_empty()
                && hidden.backdrop_filter.is_empty()
                && hidden.displacement.is_none()
        );
        let profiles = discover_appearance_profiles(&AppearanceProfileQuery {
            family: Some("glass".into()),
            target: None,
            required_mechanisms: vec!["color-preserving-refraction".into()],
            required_fields: vec![],
        })
        .unwrap();
        assert_eq!(profiles.profiles.len(), 1);
        assert_eq!(profiles.profiles[0].target, "web-color-preserving");
    }

    #[test]
    fn color_preserving_source_revision_keeps_local_values_and_requires_the_same_profile() {
        let previous = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial::default(),
            target: AppearanceDeliveryTarget::WebColorPreserving,
            native_extras: BTreeMap::new(),
        };
        let mut next = previous.clone();
        next.material.depth = 40.0;
        let live = GlassMaterial {
            refraction: 0.8,
            ..previous.material
        };
        let mut request = AppearanceUpdateInput {
            previous: previous.clone(),
            next,
            live: Some(live),
            expected_fingerprint: plan_appearance_delivery(&previous).unwrap().fingerprint,
            preference: None,
            policy: None,
        };
        let updated = plan_appearance_update(&request).unwrap();
        let delivery = updated.delivery.unwrap();
        assert_eq!(delivery.material.refraction, 0.8);
        assert_eq!(delivery.material.depth, 40.0);
        assert_eq!(delivery.web.unwrap().backdrop_filter, "blur(12px)");
        request.next.target = AppearanceDeliveryTarget::Web;
        assert!(plan_appearance_update(&request).is_err());
    }

    #[test]
    fn appearance_profile_discovery_rejects_missing_splay_mechanism() {
        let ok = discover_appearance_profiles(&AppearanceProfileQuery {
            family: Some("glass".into()),
            target: Some("web".into()),
            required_mechanisms: vec!["edge-displacement".into()],
            required_fields: vec![],
        })
        .unwrap();
        assert_eq!(ok.profiles.len(), 1);
        let err = discover_appearance_profiles(&AppearanceProfileQuery {
            family: None,
            target: None,
            required_mechanisms: vec!["splay".into()],
            required_fields: vec![],
        })
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Schema);
        assert!(err.message.contains("missing mechanism `splay`"));
    }

    #[test]
    fn light_axis_cardinals_match_across_web_and_metal() {
        for (angle, cardinal, dir) in [
            (0.0, "down", [0.0, 1.0]),
            (90.0, "left", [-1.0, 0.0]),
            (180.0, "up", [0.0, -1.0]),
            (270.0, "right", [1.0, 0.0]),
        ] {
            let web = plan_appearance_delivery(&AppearanceDeliveryInput {
                recipe: recipe(),
                material: GlassMaterial {
                    light_angle: angle,
                    light_intensity: 1.0,
                    refraction: 0.0,
                    dispersion: 0.0,
                    ..GlassMaterial::default()
                },
                target: AppearanceDeliveryTarget::Web,
                native_extras: BTreeMap::new(),
            })
            .unwrap()
            .web
            .unwrap();
            assert_eq!(web.light_axis.cardinal, cardinal);
            assert!((web.light_axis.direction[0] - dir[0]).abs() < 1e-9);
            assert!((web.light_axis.direction[1] - dir[1]).abs() < 1e-9);
            let optical = plan_optical_delivery(&GlassMaterial {
                light_angle: angle,
                ..GlassMaterial::default()
            })
            .optical
            .unwrap();
            assert!((optical.light_direction[0] - dir[0]).abs() < 1e-9);
            assert!((optical.light_direction[1] - dir[1]).abs() < 1e-9);
        }
    }

    fn preference_update_input(
        previous_radius: f64,
        next_radius: f64,
        override_radius: f64,
    ) -> AppearanceUpdateInput {
        use crate::appearance_preference::{
            APPEARANCE_PREFERENCE_SCHEMA, APPEARANCE_PREFERENCE_VERSION, AppearanceFieldOverride,
            AppearanceOverrideActor, AppearanceOverrideValue, AppearancePreferenceRecord,
        };
        let previous = AppearanceDeliveryInput {
            recipe: recipe(),
            material: GlassMaterial {
                radius: previous_radius,
                ..GlassMaterial::default()
            },
            target: AppearanceDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let next = AppearanceDeliveryInput {
            material: GlassMaterial {
                radius: next_radius,
                ..GlassMaterial::default()
            },
            ..previous.clone()
        };
        let expected_fingerprint = plan_appearance_delivery(&previous).unwrap().fingerprint;
        AppearanceUpdateInput {
            previous,
            next,
            live: None,
            expected_fingerprint,
            preference: Some(AppearancePreferenceRecord {
                schema: APPEARANCE_PREFERENCE_SCHEMA.to_string(),
                version: APPEARANCE_PREFERENCE_VERSION.to_string(),
                revision: 2,
                fields: [(
                    GlassField::Radius,
                    AppearanceFieldOverride {
                        value: AppearanceOverrideValue::Number(override_radius),
                        actor: AppearanceOverrideActor::User,
                    },
                )]
                .into_iter()
                .collect(),
            }),
            policy: None,
        }
    }

    #[test]
    fn explicit_equal_to_default_preference_survives_design_update() {
        // The 2026-10-11 consumer probe: value-diff merging delivered the new
        // source radius; explicit intent must keep the user's fixed value.
        let input = preference_update_input(1.0, 5.0, 1.0);
        let plan = plan_appearance_update(&input).unwrap();
        assert_eq!(plan.preserved, vec![GlassField::Radius]);
        let delivery = plan.delivery.expect("preference path delivers");
        assert_eq!(delivery.material.radius, 1.0);
        assert_eq!(plan.preference_revision, Some(2));
        assert_eq!(
            plan.preference_receipts.len(),
            1,
            "the applied override carries a receipt"
        );
        // The CAS token names what the receiver currently displays: the
        // previous source with the same preference applied.
        let previous_display = plan_appearance_delivery(&AppearanceDeliveryInput {
            material: GlassMaterial {
                radius: 1.0,
                ..GlassMaterial::default()
            },
            ..input.previous.clone()
        })
        .unwrap();
        assert_eq!(
            plan.previous_delivery_fingerprint.as_deref(),
            Some(previous_display.fingerprint.as_str())
        );
    }

    #[test]
    fn preference_update_rejects_live_material_and_reports_the_conflict() {
        let mut input = preference_update_input(1.0, 5.0, 1.0);
        input.live = Some(input.next.material);
        let error = plan_appearance_update(&input).unwrap_err();
        assert!(error.message.contains("not both"));
    }

    #[test]
    fn hidden_preference_override_stays_saved_but_not_effective_in_update() {
        use crate::appearance_exposure::{
            APPEARANCE_EXPOSURE_POLICY_SCHEMA, APPEARANCE_EXPOSURE_VERSION,
            AppearanceExposurePolicy,
        };
        let mut input = preference_update_input(1.0, 5.0, 9.0);
        input.policy = Some(AppearanceExposurePolicy {
            schema: APPEARANCE_EXPOSURE_POLICY_SCHEMA.to_string(),
            version: APPEARANCE_EXPOSURE_VERSION.to_string(),
            policy_revision: 7,
            family: "glass".to_string(),
            target: AppearanceDeliveryTarget::Web,
            scopes: vec!["hero".to_string()],
            // Empty exposure: radius is hidden, so the override waits.
            exposed: vec![],
        });
        let plan = plan_appearance_update(&input).unwrap();
        assert!(plan.preserved.is_empty());
        assert_eq!(plan.delivery.unwrap().material.radius, 5.0);
        assert!(
            plan.preference_fingerprint.is_some(),
            "the saved intent stays bound to the plan for recovery"
        );
    }
}

//! Native texture recipes and frontend delivery.
//!
//! A `worldbend.texture@0.1` recipe is an editable starting state over the
//! native Figma NOISE and TEXTURE effects: tinted grain plus surface etch. As
//! with Glass, the live native properties are the authority for actual values;
//! the recipe records identity, version and the seed an instance came from.
//! Native extras outside the seven-field portable material — duotone secondary
//! colors, blend modes, per-axis sizes — are preserved and disclosed rather
//! than guessed into a portable field.

use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{
    AppearanceFieldMapping, AppearanceInstanceState, AppearanceLossReceipt, ErrorCode,
    ParameterRangeReceipt, TransformError, TransformResult,
};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const TEXTURE_VERSION: &str = "0.1";
pub const TEXTURE_SCHEMA: &str = "worldbend.texture@0.1";
pub const TEXTURE_INSPECTION_SCHEMA: &str = "worldbend.texture-inspection@0.1";
pub const TEXTURE_DELIVERY_SCHEMA: &str = "worldbend.texture-delivery@0.1";

/// Bound shared with the Glass recipe identity rule.
pub const MAX_TEXTURE_RECIPE_ID: usize = 64;
/// Accepts every size the native panels can hold in practice; authored seeds
/// start at 0.5, Figma's own smallest step.
pub const MIN_TEXTURE_EFFECT_SIZE: f64 = 0.5;
pub const MAX_TEXTURE_EFFECT_SIZE: f64 = 1000.0;
pub const MAX_TEXTURE_ETCH_RADIUS: f64 = 1000.0;
/// Web etch surfaceScale is linear on `[0,12]`, then a soft tail through this max.
pub const WEB_ETCH_LINEAR_END: f64 = 12.0;
pub const WEB_ETCH_EFFECTIVE_MAX: f64 = 100.0;
pub const WEB_ETCH_SURFACE_SCALE_AT_LINEAR_END: f64 = 3.0;
pub const WEB_ETCH_SURFACE_SCALE_AT_EFFECTIVE_MAX: f64 = 4.5;

fn schema_error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

fn spec_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_SCHEMA })
}

fn version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_VERSION })
}

/// Parse `#rrggbb` into its three byte channels.
pub fn parse_hex_color(value: &str) -> Option<(u8, u8, u8)> {
    let bytes = value.as_bytes();
    if bytes.len() != 7 || bytes[0] != b'#' {
        return None;
    }
    let channel = |high: u8, low: u8| -> Option<u8> {
        let digit = |byte: u8| match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            b'A'..=b'F' => Some(byte - b'A' + 10),
            _ => None,
        };
        Some(digit(high)? * 16 + digit(low)?)
    };
    Some((
        channel(bytes[1], bytes[2])?,
        channel(bytes[3], bytes[4])?,
        channel(bytes[5], bytes[6])?,
    ))
}

/// The seven portable texture controls. Field names follow the native effects:
/// grain maps the NOISE effect (density, size, color) and etch maps the
/// TEXTURE effect (radius, size, clip).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureMaterial {
    #[serde(default = "default_texture_visible")]
    pub visible: bool,
    /// Grain density in `[0,1]` — the NOISE effect's density.
    pub grain: f64,
    /// Grain cell size in `[0.5,1000]` logical pixels.
    #[serde(rename = "grainSize")]
    pub grain_size: f64,
    /// Grain tint, `#rrggbb`; the NOISE effect's primary color.
    #[serde(rename = "grainColor")]
    pub grain_color: String,
    /// Etch bump radius in `[0,1000]` logical pixels — the TEXTURE effect.
    pub etch: f64,
    /// Etch cell size in `[0.5,1000]` logical pixels.
    #[serde(rename = "etchSize")]
    pub etch_size: f64,
    /// Whether the etch follows the layer outline instead of its bounds.
    #[serde(rename = "clipToShape", default = "default_clip_to_shape")]
    pub clip_to_shape: bool,
}

fn default_texture_visible() -> bool {
    true
}

fn default_clip_to_shape() -> bool {
    true
}

impl Default for TextureMaterial {
    fn default() -> Self {
        Self {
            visible: true,
            grain: 0.35,
            grain_size: 3.0,
            grain_color: "#8a7f72".to_string(),
            etch: 1.5,
            etch_size: 4.0,
            clip_to_shape: true,
        }
    }
}

/// The texture fields, in the stable wire order used by customized-field lists
/// and target mapping tables.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, PartialOrd, Ord,
)]
#[serde(rename_all = "kebab-case")]
pub enum TextureField {
    Visible,
    Grain,
    GrainSize,
    GrainColor,
    Etch,
    EtchSize,
    ClipToShape,
}

pub const TEXTURE_FIELDS: [TextureField; 7] = [
    TextureField::Visible,
    TextureField::Grain,
    TextureField::GrainSize,
    TextureField::GrainColor,
    TextureField::Etch,
    TextureField::EtchSize,
    TextureField::ClipToShape,
];

impl TextureField {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Grain => "grain",
            Self::GrainSize => "grain-size",
            Self::GrainColor => "grain-color",
            Self::Etch => "etch",
            Self::EtchSize => "etch-size",
            Self::ClipToShape => "clip-to-shape",
        }
    }
}

impl TextureMaterial {
    pub fn validate(&self) -> TransformResult<()> {
        let numeric = [self.grain, self.grain_size, self.etch, self.etch_size];
        if numeric.iter().any(|value| !value.is_finite()) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "texture material values must be finite",
            ));
        }
        if !(0.0..=1.0).contains(&self.grain) {
            return Err(schema_error("grain density must be in [0,1]"));
        }
        if !(MIN_TEXTURE_EFFECT_SIZE..=MAX_TEXTURE_EFFECT_SIZE).contains(&self.grain_size) {
            return Err(schema_error(
                "grain size must be in [0.5,1000] logical pixels",
            ));
        }
        if parse_hex_color(&self.grain_color).is_none() {
            return Err(schema_error("grainColor must be #rrggbb"));
        }
        if !(0.0..=MAX_TEXTURE_ETCH_RADIUS).contains(&self.etch) {
            return Err(schema_error("etch radius must be in [0,1000]"));
        }
        if !(MIN_TEXTURE_EFFECT_SIZE..=MAX_TEXTURE_EFFECT_SIZE).contains(&self.etch_size) {
            return Err(schema_error(
                "etch size must be in [0.5,1000] logical pixels",
            ));
        }
        Ok(())
    }

    /// Fields whose live values differ from the recipe seed. Numeric
    /// comparison is exact except for the host's known float32 storage
    /// roundtrip; colors compare by byte because the adapter rounds the
    /// float32 channels to the same byte they were authored from.
    pub fn changed_fields(&self, seed: &TextureMaterial) -> Vec<TextureField> {
        let differs = |live: f64, seed: f64| live != seed && live != f64::from(seed as f32);
        let color_differs =
            |live: &str, seed: &str| match (parse_hex_color(live), parse_hex_color(seed)) {
                (Some(live), Some(seed)) => live != seed,
                // An unreadable native color is a disclosed difference, not a
                // silent match.
                _ => true,
            };
        TEXTURE_FIELDS
            .into_iter()
            .filter(|field| match field {
                TextureField::Visible => self.visible != seed.visible,
                TextureField::Grain => differs(self.grain, seed.grain),
                TextureField::GrainSize => differs(self.grain_size, seed.grain_size),
                TextureField::GrainColor => color_differs(&self.grain_color, &seed.grain_color),
                TextureField::Etch => differs(self.etch, seed.etch),
                TextureField::EtchSize => differs(self.etch_size, seed.etch_size),
                TextureField::ClipToShape => self.clip_to_shape != seed.clip_to_shape,
            })
            .collect()
    }
}

/// An editable texture starting state: named, versioned, self-describing.
/// The material is the seed; live native values stay the authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureRecipeSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = MAX_TEXTURE_RECIPE_ID))]
    pub recipe_id: String,
    #[schemars(range(min = 1))]
    pub recipe_version: u32,
    pub material: TextureMaterial,
}

impl TextureRecipeSpec {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != TEXTURE_SCHEMA || self.version != TEXTURE_VERSION {
            return Err(schema_error(
                "texture recipe must declare worldbend.texture@0.1",
            ));
        }
        if self.recipe_id.trim().is_empty()
            || self.recipe_id.chars().count() > MAX_TEXTURE_RECIPE_ID
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

    /// Stable content identity of the seed. Live drift never changes it.
    pub fn fingerprint(&self) -> TransformResult<String> {
        fingerprint_json_value(
            &canonical_json_value(self).map_err(|_| schema_error("invalid recipe"))?,
        )
        .map_err(|_| schema_error("invalid recipe"))
    }
}

/// One surface's reconciliation input: the stored seed plus the resolved live
/// material read from the host. `None` means neither native effect remains.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureInspectionInput {
    pub recipe: TextureRecipeSpec,
    pub live: Option<TextureMaterial>,
    #[serde(default)]
    pub tagged: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureInspection {
    #[schemars(schema_with = "inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "inspection_version_schema")]
    pub version: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    /// The resolved material: live native values when present, otherwise the
    /// recipe seed as explicit fallback state.
    pub material: TextureMaterial,
    pub state: AppearanceInstanceState,
    /// Fields where live values differ from the seed. Empty unless the state
    /// is `customized`.
    pub customized: Vec<TextureField>,
}

fn inspection_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_INSPECTION_SCHEMA })
}

fn inspection_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_VERSION })
}

/// Resolve one surface's current texture against its seed. Native values are
/// authoritative whenever they exist; provenance only explains origin.
pub fn inspect_texture(input: &TextureInspectionInput) -> TransformResult<TextureInspection> {
    input.recipe.validate()?;
    if let Some(material) = &input.live {
        material.validate()?;
    }
    let (material, state, customized) = match (&input.live, input.tagged) {
        (Some(live), true) => {
            let customized = live.changed_fields(&input.recipe.material);
            let state = if customized.is_empty() {
                AppearanceInstanceState::Tagged
            } else {
                AppearanceInstanceState::Customized
            };
            (live.clone(), state, customized)
        }
        (Some(live), false) => (
            live.clone(),
            AppearanceInstanceState::UntaggedNative,
            Vec::new(),
        ),
        (None, true) => (
            input.recipe.material.clone(),
            AppearanceInstanceState::Removed,
            Vec::new(),
        ),
        (None, false) => (
            input.recipe.material.clone(),
            AppearanceInstanceState::Absent,
            Vec::new(),
        ),
    };
    Ok(TextureInspection {
        schema: TEXTURE_INSPECTION_SCHEMA.to_string(),
        version: TEXTURE_VERSION.to_string(),
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
pub struct TextureRevisionInput {
    pub previous: TextureRecipeSpec,
    pub next: TextureRecipeSpec,
    pub live: Option<TextureMaterial>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureRevisionPlan {
    pub recipe: TextureRecipeSpec,
    /// None keeps a natively removed effect removed; application must be explicit.
    pub material: Option<TextureMaterial>,
    pub preserved: Vec<TextureField>,
}

pub fn plan_texture_revision(input: &TextureRevisionInput) -> TransformResult<TextureRevisionPlan> {
    input.previous.validate()?;
    input.next.validate()?;
    if input.previous.recipe_id != input.next.recipe_id
        || input.next.recipe_version <= input.previous.recipe_version
    {
        return Err(schema_error(
            "A seed upgrade requires the same recipeId and a newer recipeVersion",
        ));
    }
    let Some(live) = &input.live else {
        return Ok(TextureRevisionPlan {
            recipe: input.next.clone(),
            material: None,
            preserved: Vec::new(),
        });
    };
    live.validate()?;
    let preserved = live.changed_fields(&input.previous.material);
    let mut material = input.next.material.clone();
    for field in &preserved {
        match field {
            TextureField::Visible => material.visible = live.visible,
            TextureField::Grain => material.grain = live.grain,
            TextureField::GrainSize => material.grain_size = live.grain_size,
            TextureField::GrainColor => material.grain_color = live.grain_color.clone(),
            TextureField::Etch => material.etch = live.etch,
            TextureField::EtchSize => material.etch_size = live.etch_size,
            TextureField::ClipToShape => material.clip_to_shape = live.clip_to_shape,
        }
    }
    Ok(TextureRevisionPlan {
        recipe: input.next.clone(),
        material: Some(material),
        preserved,
    })
}

/// The supported delivery targets. The texture family's first verified target
/// is the self-contained Web route; a SwiftUI profile stays unadvertised until
/// a real adapter exists.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum TextureDeliveryTarget {
    #[serde(rename = "web")]
    Web,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TextureOverlayBlend {
    /// Tinted grain composites over the surface without density-dependent
    /// changes to its blend equation.
    Normal,
    /// Grain multiplies the surface: printed paper.
    Multiply,
    /// Grain overlays: frosted plastic sheen.
    Overlay,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureFieldDelivery {
    pub field: TextureField,
    pub mapping: AppearanceFieldMapping,
    pub note: String,
}

/// Deterministic numbers for the Web SVG etch route.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureEtchFilter {
    /// `feTurbulence` base frequency: `1 / etchSize` in cycles per pixel.
    pub base_frequency: f64,
    /// Bump height for `feDiffuseLighting`. Linear on authored `[0,12]`, then
    /// a soft tail through [`WEB_ETCH_EFFECTIVE_MAX`].
    pub surface_scale: f64,
    /// Ready-to-inline `<filter>` markup with a fixed overhead key light.
    pub markup: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WebTextureDelivery {
    /// Complete declaration list for one grain overlay layer. Apply to an
    /// absolutely-positioned child that covers the textured surface.
    pub css: String,
    /// The overlay's `background-image` data-URI tile on its own, for hosts
    /// that compose it themselves.
    pub grain_tile: String,
    /// CSS size of the 64 px tile, calibrated to the noise frequency so
    /// grainSize scales cells rather than squeezing the entire tile to it.
    pub grain_tile_size: f64,
    /// The grain layer's mix-blend-mode.
    pub grain_blend: TextureOverlayBlend,
    /// Etch route through SVG bump lighting. `None` when `etch` is zero: a
    /// flat grain sheet needs no displacement.
    pub etch: Option<TextureEtchFilter>,
    pub fidelity: Vec<TextureFieldDelivery>,
    pub parameter_ranges: Vec<ParameterRangeReceipt>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureDeliveryInput {
    pub recipe: TextureRecipeSpec,
    /// The resolved material to deliver (typically from `inspect_texture`).
    pub material: TextureMaterial,
    pub target: TextureDeliveryTarget,
    #[serde(default)]
    #[schemars(default)]
    pub native_extras: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureDeliveryPlan {
    #[schemars(schema_with = "delivery_schema")]
    pub schema: String,
    #[schemars(schema_with = "delivery_version_schema")]
    pub version: String,
    /// Identity of the delivered state: seed identity plus resolved values.
    pub fingerprint: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: TextureMaterial,
    pub target: TextureDeliveryTarget,
    pub web: Option<WebTextureDelivery>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub losses: Vec<AppearanceLossReceipt>,
}

fn delivery_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_DELIVERY_SCHEMA })
}

fn delivery_version_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    let _ = generator;
    schemars::json_schema!({ "type": "string", "const": TEXTURE_VERSION })
}

fn format_ratio(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    if (rounded - rounded.trunc()).abs() < f64::EPSILON {
        format!("{}", rounded.trunc() as i64)
    } else {
        format!("{rounded}")
    }
}

/// One deterministic 64x64 grain tile as a portable SVG data URI. Turbulence
/// generates the cells; alpha coverage rises with grain density, tinted to
/// the grain color. The same markup drives
/// the reference delivery and the reusable Web runtime, so the two cannot
/// drift apart.
fn grain_tile_data_uri(material: &TextureMaterial) -> String {
    let (red, green, blue) = parse_hex_color(&material.grain_color).unwrap_or((138, 127, 114));
    // Map noise luminance through the tint: bright noise cells approach the
    // full color, dim cells fall to black. Alpha coverage rises with density,
    // so grain=0 renders no tile
    // cells and grain=1 the strongest noise, matching the native NOISE
    // density direction.
    let keep = (material.grain.clamp(0.0, 1.0) * 100.0).round() / 100.0;
    let svg = format!(
        "<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><filter id='g' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='0.16' numOctaves='2' seed='11' result='noise'/><feComponentTransfer in='noise' result='shaped'><feFuncR type='table' tableValues='0 {slope:.3}'/><feFuncG type='table' tableValues='0 {slope:.3}'/><feFuncB type='table' tableValues='0 {slope:.3}'/><feFuncA type='table' tableValues='0 1'/></feComponentTransfer><feColorMatrix in='shaped' type='matrix' values='0 0 0 0 {r:.4} 0 0 0 0 {g:.4} 0 0 0 0 {b:.4} 0.9 0.9 0.9 0 0'/><feComponentTransfer><feFuncA type='linear' slope='{coverage:.3}' intercept='0'/></feComponentTransfer></filter><rect width='64' height='64' filter='url(#g)'/></svg>",
        r = f64::from(red) / 255.0,
        g = f64::from(green) / 255.0,
        b = f64::from(blue) / 255.0,
        slope = (0.4 + 0.6 * keep).max(0.4),
        coverage = keep,
    );
    format!(
        "data:image/svg+xml,{}",
        svg.bytes().map(|b| format!("%{b:02X}")).collect::<String>()
    )
}

fn saturate01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn smoothstep(t: f64) -> f64 {
    let t = saturate01(t);
    t * t * (3.0 - 2.0 * t)
}

/// Web etch bump height. Preserves the historical linear map on `[0,12]`.
pub fn web_etch_surface_scale(etch: f64) -> (f64, f64, bool) {
    let clamped = !(0.0..=WEB_ETCH_EFFECTIVE_MAX).contains(&etch);
    let effective = etch.clamp(0.0, WEB_ETCH_EFFECTIVE_MAX);
    let scale = if effective <= WEB_ETCH_LINEAR_END {
        WEB_ETCH_SURFACE_SCALE_AT_LINEAR_END * effective / WEB_ETCH_LINEAR_END
    } else {
        let t = (effective - WEB_ETCH_LINEAR_END) / (WEB_ETCH_EFFECTIVE_MAX - WEB_ETCH_LINEAR_END);
        WEB_ETCH_SURFACE_SCALE_AT_LINEAR_END
            + (WEB_ETCH_SURFACE_SCALE_AT_EFFECTIVE_MAX - WEB_ETCH_SURFACE_SCALE_AT_LINEAR_END)
                * smoothstep(t)
    };
    (scale, effective, clamped)
}

fn texture_native_extra_losses(
    native_extras: &BTreeMap<String, serde_json::Value>,
) -> Vec<AppearanceLossReceipt> {
    native_extras
        .iter()
        .map(|(key, value)| AppearanceLossReceipt {
            key: key.clone(),
            kind: "unmapped-native-extra".into(),
            note: format!(
                "authored native extra `{key}`={value} is outside the portable seven-field texture input; Web grain/etch success does not include it",
                value = value
            ),
        })
        .collect()
}

fn plan_web_texture(material: &TextureMaterial) -> WebTextureDelivery {
    let grain_tile = grain_tile_data_uri(material);
    // Density changes coverage, never the blend equation: a density slider
    // must not abruptly switch from dark print to light sheen at 0.6.
    let blend = TextureOverlayBlend::Normal;
    let grain_tile_size = 64.0 * 0.16 * material.grain_size;
    let css = format!(
        "position: absolute; inset: 0; background-image: url(\"{grain_tile}\"); background-size: {grain}px {grain}px; mix-blend-mode: {blend}; pointer-events: none;",
        grain = format_ratio(grain_tile_size),
        blend = match blend {
            TextureOverlayBlend::Normal => "normal",
            TextureOverlayBlend::Multiply => "multiply",
            TextureOverlayBlend::Overlay => "overlay",
        },
    );

    let (surface_scale, etch_effective, etch_clamped) = web_etch_surface_scale(material.etch);
    let etch = if material.etch > 0.0 {
        let base_frequency = 1.0 / material.etch_size;
        let markup = format!(
            "<filter id=\"worldbend-etch\" x=\"-10%\" y=\"-10%\" width=\"120%\" height=\"120%\" color-interpolation-filters=\"sRGB\">\n<feTurbulence type=\"fractalNoise\" baseFrequency=\"{base}\" numOctaves=\"2\" seed=\"7\" result=\"bump\"/>\n<feDiffuseLighting in=\"bump\" lighting-color=\"white\" surfaceScale=\"{scale}\" diffuseConstant=\"1\" result=\"light\">\n<feDistantLight azimuth=\"235\" elevation=\"55\"/>\n</feDiffuseLighting>\n<feComposite in=\"light\" in2=\"bump\" operator=\"arithmetic\" k1=\"1\" k2=\"0\" k3=\"0\" k4=\"0\" result=\"etched\"/>\n<feColorMatrix in=\"etched\" type=\"saturate\" values=\"0\"/>\n</filter>",
            base = format_ratio(base_frequency),
            scale = format_ratio(surface_scale),
        );
        Some(TextureEtchFilter {
            base_frequency,
            surface_scale,
            markup,
        })
    } else {
        None
    };

    let fidelity = vec![
        TextureFieldDelivery {
            field: TextureField::Visible,
            mapping: AppearanceFieldMapping::Native,
            note: "visible=false omits the texture declarations entirely".to_string(),
        },
        TextureFieldDelivery {
            field: TextureField::Grain,
            mapping: AppearanceFieldMapping::Approximated,
            note: "grain density scales turbulence alpha coverage; it does not select sparse cells with Figma's native noise algorithm".to_string(),
        },
        TextureFieldDelivery {
            field: TextureField::GrainSize,
            mapping: AppearanceFieldMapping::Approximated,
            note: "grain size scales the 64px tile by its 0.16 noise frequency for nominal cell pitch; the cell shapes differ from native noise".to_string(),
        },
        TextureFieldDelivery {
            field: TextureField::GrainColor,
            mapping: AppearanceFieldMapping::Native,
            note: "grain color tints the tile pixels".to_string(),
        },
        TextureFieldDelivery {
            field: TextureField::Etch,
            mapping: AppearanceFieldMapping::Approximated,
            note: format!(
                "SVG bump lighting approximates native TEXTURE etch; surfaceScale linear to {WEB_ETCH_LINEAR_END} then soft tail to {WEB_ETCH_EFFECTIVE_MAX} (effective {etch_effective}, clamped={etch_clamped})"
            ),
        },
        TextureFieldDelivery {
            field: TextureField::EtchSize,
            mapping: AppearanceFieldMapping::Approximated,
            note: "etch size becomes feTurbulence frequency, not the native cell pitch".to_string(),
        },
        TextureFieldDelivery {
            field: TextureField::ClipToShape,
            mapping: AppearanceFieldMapping::Approximated,
            note: "clip-to-shape controls etch's rounded CSS outline; grain always follows the outline. Other Figma vector silhouettes require a host clip or mask".to_string(),
        },
    ];
    let fidelity = if material.visible {
        fidelity
    } else {
        Vec::new()
    };
    let parameter_ranges = vec![ParameterRangeReceipt {
        field: "etch".into(),
        unit: "logical-px".into(),
        authored_min: 0.0,
        authored_max: MAX_TEXTURE_ETCH_RADIUS,
        effective_min: 0.0,
        effective_max: WEB_ETCH_EFFECTIVE_MAX,
        authored: material.etch,
        effective: etch_effective,
        clamped: etch_clamped,
        note: "Web etch surfaceScale is linear on [0,12] then a soft tail through 100; values above 100 clamp".into(),
    }];
    WebTextureDelivery {
        css: if material.visible { css } else { String::new() },
        grain_tile: if material.visible {
            grain_tile
        } else {
            String::new()
        },
        grain_blend: blend,
        grain_tile_size,
        etch: if material.visible { etch } else { None },
        fidelity,
        parameter_ranges: if material.visible {
            parameter_ranges
        } else {
            Vec::new()
        },
    }
}

/// Project one resolved texture state onto its target implementation.
pub fn plan_texture_delivery(input: &TextureDeliveryInput) -> TransformResult<TextureDeliveryPlan> {
    input.recipe.validate()?;
    input.material.validate()?;
    let recipe_fingerprint = input.recipe.fingerprint()?;
    let fingerprint = fingerprint_json_value(
        &canonical_json_value(&TextureDeliveryFingerprintValue {
            schema: TEXTURE_DELIVERY_SCHEMA,
            version: TEXTURE_VERSION,
            recipe_fingerprint: recipe_fingerprint.as_str(),
            material: &input.material,
            target: input.target,
        })
        .map_err(|_| schema_error("invalid delivery input"))?,
    )
    .map_err(|_| schema_error("invalid delivery input"))?;
    let web = match input.target {
        TextureDeliveryTarget::Web => Some(plan_web_texture(&input.material)),
    };
    let losses = texture_native_extra_losses(&input.native_extras);
    Ok(TextureDeliveryPlan {
        schema: TEXTURE_DELIVERY_SCHEMA.to_string(),
        version: TEXTURE_VERSION.to_string(),
        fingerprint,
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint,
        material: input.material.clone(),
        target: input.target,
        web,
        losses,
    })
}

#[derive(Serialize)]
struct TextureDeliveryFingerprintValue<'a> {
    schema: &'a str,
    version: &'a str,
    recipe_fingerprint: &'a str,
    material: &'a TextureMaterial,
    target: TextureDeliveryTarget,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn recipe() -> TextureRecipeSpec {
        TextureRecipeSpec {
            schema: TEXTURE_SCHEMA.to_string(),
            version: TEXTURE_VERSION.to_string(),
            recipe_id: "warm-paper".to_string(),
            recipe_version: 1,
            material: TextureMaterial::default(),
        }
    }

    #[test]
    fn rejects_out_of_range_texture_fields() {
        let mut spec = recipe();
        spec.material.grain = 1.2;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.grain = 0.4;
        spec.material.grain_size = 0.2;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.grain_size = 4.0;
        spec.material.grain_color = "#ff00".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.grain_color = "#gg0000".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.grain_color = "#ff0000".to_string();
        spec.material.etch = f64::NAN;
        assert_eq!(
            spec.validate().unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
        spec.material.etch = 1.5;
        spec.material.etch_size = 0.1;
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.material.etch_size = 5.0;
        assert!(spec.validate().is_ok());
        assert_eq!(parse_hex_color("#AbCdEf"), Some((0xab, 0xcd, 0xef)));
    }

    #[test]
    fn rejects_foreign_schema_and_blank_recipe_ids() {
        let mut spec = recipe();
        spec.schema = "worldbend.appearance@0.1".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.schema = TEXTURE_SCHEMA.to_string();
        spec.recipe_id = "  ".to_string();
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
        spec.recipe_id = "x".repeat(MAX_TEXTURE_RECIPE_ID + 1);
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn recipe_fingerprint_is_stable_across_key_order() {
        let first = recipe().fingerprint().unwrap();
        let json = serde_json::to_value(recipe()).unwrap();
        let second: TextureRecipeSpec = serde_json::from_value(json).unwrap();
        assert_eq!(first, second.fingerprint().unwrap());
        let mut changed = recipe();
        changed.material.etch = 3.0;
        assert_ne!(first, changed.fingerprint().unwrap());
    }

    #[test]
    fn inspection_reports_every_reconciliation_state() {
        let seed = recipe();
        let absent = inspect_texture(&TextureInspectionInput {
            recipe: seed.clone(),
            live: None,
            tagged: false,
        })
        .unwrap();
        assert_eq!(absent.state, AppearanceInstanceState::Absent);
        let tagged = inspect_texture(&TextureInspectionInput {
            recipe: seed.clone(),
            live: Some(seed.material.clone()),
            tagged: true,
        })
        .unwrap();
        assert_eq!(tagged.state, AppearanceInstanceState::Tagged);
        let mut drifted = seed.material.clone();
        drifted.grain = 0.8;
        drifted.etch = 4.0;
        let customized = inspect_texture(&TextureInspectionInput {
            recipe: seed.clone(),
            live: Some(drifted),
            tagged: true,
        })
        .unwrap();
        assert_eq!(customized.state, AppearanceInstanceState::Customized);
        assert_eq!(
            customized.customized,
            vec![TextureField::Grain, TextureField::Etch]
        );
        let untagged = inspect_texture(&TextureInspectionInput {
            recipe: seed.clone(),
            live: Some(seed.material.clone()),
            tagged: false,
        })
        .unwrap();
        assert_eq!(untagged.state, AppearanceInstanceState::UntaggedNative);
        let removed = inspect_texture(&TextureInspectionInput {
            recipe: seed,
            live: None,
            tagged: true,
        })
        .unwrap();
        assert_eq!(removed.state, AppearanceInstanceState::Removed);
    }

    #[test]
    fn float32_storage_and_color_case_are_not_customization() {
        let seed = recipe();
        // The host stores every numeric as float32; that exact roundtrip
        // counts as unchanged.
        let mut live = seed.material.clone();
        live.grain = f64::from(live.grain as f32);
        live.etch_size = f64::from(live.etch_size as f32);
        let input = TextureInspectionInput {
            recipe: seed,
            live: Some(live),
            tagged: true,
        };
        assert_eq!(
            inspect_texture(&input).unwrap().state,
            AppearanceInstanceState::Tagged
        );
        // Colors compare bytewise, case-insensitively; an adapter that reads
        // the stored float32 channels rounds back to the authored bytes.
        let mut recased = input.clone();
        recased.live.as_mut().unwrap().grain_color = "#8A7F72".to_string();
        assert_eq!(
            inspect_texture(&recased).unwrap().state,
            AppearanceInstanceState::Tagged
        );
        let mut invalid = input;
        invalid.live.as_mut().unwrap().etch = -1.0;
        assert!(inspect_texture(&invalid).is_err());
    }

    #[test]
    fn web_delivery_builds_grain_and_etch_deterministically() {
        let plan = plan_texture_delivery(&TextureDeliveryInput {
            recipe: recipe(),
            material: TextureMaterial::default(),
            target: TextureDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap();
        let web = plan.web.expect("web target fills the web block");
        assert!(
            web.grain_tile
                .starts_with("data:image/svg+xml,%3C%73%76%67")
        );
        assert!(web.grain_tile.contains("%54%75%72%62%75%6C%65%6E%63%65"));
        assert!(!web.grain_tile.contains(['<', '>', '"', ' ']));
        assert!(web.css.contains("background-size: 30.72px 30.72px"));
        assert!(web.css.contains("mix-blend-mode: normal"));
        let etch = web.etch.expect("default etch is nonzero");
        assert!((etch.base_frequency - 0.25).abs() < 1e-9);
        assert!(etch.markup.contains("feDiffuseLighting"));
        assert!(etch.markup.contains("feTurbulence"));
        assert!(etch.markup.contains("color-interpolation-filters=\"sRGB\""));
        assert_eq!(web.fidelity.len(), TEXTURE_FIELDS.len());
        // The same input reproduces the same tile bytes.
        let again = plan_texture_delivery(&TextureDeliveryInput {
            recipe: recipe(),
            material: TextureMaterial::default(),
            target: TextureDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap();
        assert_eq!(web.grain_tile, again.web.unwrap().grain_tile);
    }

    #[test]
    fn grain_coverage_rises_with_density() {
        let tile = |grain: f64| {
            plan_texture_delivery(&TextureDeliveryInput {
                recipe: recipe(),
                material: TextureMaterial {
                    grain,
                    ..TextureMaterial::default()
                },
                target: TextureDeliveryTarget::Web,
                native_extras: BTreeMap::new(),
            })
            .unwrap()
            .web
            .unwrap()
            .grain_tile
        };
        // The overlay alpha's linear slope is the kept density fraction, so
        // the native NOISE density direction survives the Web tile: 0 hides
        // every cell, 1 keeps the strongest noise.
        let slope = |grain: f64| {
            let tile = tile(grain);
            let marker = "%73%6C%6F%70%65%3D%27";
            let start = tile.find(marker).expect("alpha slope markup") + marker.len();
            let end = tile[start..].find("%27").expect("closing quote") + start;
            tile[start..end].to_string()
        };
        assert_eq!(slope(0.0), "%30%2E%30%30%30");
        assert_eq!(slope(0.35), "%30%2E%33%35%30");
        assert_eq!(slope(1.0), "%31%2E%30%30%30");
        // Crossing 0.6 must keep the same compositing equation.
        let blend = |grain: f64| {
            plan_texture_delivery(&TextureDeliveryInput {
                recipe: recipe(),
                material: TextureMaterial {
                    grain,
                    ..TextureMaterial::default()
                },
                target: TextureDeliveryTarget::Web,
                native_extras: BTreeMap::new(),
            })
            .unwrap()
            .web
            .unwrap()
            .css
        };
        for density in [0.35, 0.59, 0.6, 0.61, 1.0] {
            assert!(blend(density).contains("mix-blend-mode: normal"));
        }
    }

    #[test]
    fn hidden_delivery_really_omits_effects() {
        let material = TextureMaterial {
            visible: false,
            ..TextureMaterial::default()
        };
        let web = plan_texture_delivery(&TextureDeliveryInput {
            recipe: recipe(),
            material,
            target: TextureDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        })
        .unwrap()
        .web
        .unwrap();
        assert!(web.css.is_empty() && web.grain_tile.is_empty() && web.etch.is_none());
    }

    #[test]
    fn delivery_fingerprint_binds_resolved_values() {
        let base = TextureDeliveryInput {
            recipe: recipe(),
            material: TextureMaterial::default(),
            target: TextureDeliveryTarget::Web,
            native_extras: BTreeMap::new(),
        };
        let first = plan_texture_delivery(&base).unwrap().fingerprint;
        let mut changed = base.clone();
        changed.material.grain = 0.9;
        let second = plan_texture_delivery(&changed).unwrap().fingerprint;
        assert_ne!(first, second);
    }

    #[test]
    fn seed_upgrade_preserves_native_edits_and_removal() {
        let previous = recipe();
        let mut next = previous.clone();
        next.recipe_version = 2;
        next.material.grain = 0.5;
        next.material.etch = 2.5;
        let mut live = previous.material.clone();
        live.etch = 6.0;
        live.grain = f64::from(live.grain as f32);
        let mut input = TextureRevisionInput {
            previous,
            next,
            live: Some(live),
        };
        let result = plan_texture_revision(&input).unwrap();
        assert_eq!(result.preserved, vec![TextureField::Etch]);
        let material = result.material.unwrap();
        assert_eq!(material.etch, 6.0);
        assert_eq!(material.grain, 0.5);
        input.live = None;
        assert!(plan_texture_revision(&input).unwrap().material.is_none());
        input.next.recipe_id = "different-family".into();
        assert!(plan_texture_revision(&input).is_err());
    }

    #[test]
    fn web_etch_12_and_100_diverge_inside_effective_range() {
        let plan = |etch: f64| {
            plan_texture_delivery(&TextureDeliveryInput {
                recipe: recipe(),
                material: TextureMaterial {
                    etch,
                    ..TextureMaterial::default()
                },
                target: TextureDeliveryTarget::Web,
                native_extras: BTreeMap::new(),
            })
            .unwrap()
            .web
            .unwrap()
        };
        let a = plan(12.0);
        let b = plan(100.0);
        let scale_a = a.etch.as_ref().unwrap().surface_scale;
        let scale_b = b.etch.as_ref().unwrap().surface_scale;
        assert!(
            (scale_b - scale_a).abs() > 0.5,
            "expected optically distinct etch scales, got {scale_a} vs {scale_b}"
        );
        assert!((web_etch_surface_scale(12.0).0 - 3.0).abs() < 1e-12);
        let deep = plan(1000.0);
        let range = deep
            .parameter_ranges
            .iter()
            .find(|row| row.field == "etch")
            .unwrap();
        assert!(range.clamped);
        assert_eq!(range.effective, WEB_ETCH_EFFECTIVE_MAX);
    }

    #[test]
    fn texture_native_extras_emit_loss_receipts() {
        let mut extras = BTreeMap::new();
        extras.insert("noise.noiseType".into(), serde_json::json!("DUOTONE"));
        let plan = plan_texture_delivery(&TextureDeliveryInput {
            recipe: recipe(),
            material: TextureMaterial::default(),
            target: TextureDeliveryTarget::Web,
            native_extras: extras,
        })
        .unwrap();
        assert_eq!(plan.losses.len(), 1);
        assert_eq!(plan.losses[0].key, "noise.noiseType");
    }
}

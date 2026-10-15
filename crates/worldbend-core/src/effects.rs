//! Versioned, data-only spatial recipes. Selection is authored; execution is pure.
use crate::{
    Bounds, ErrorCode, NormalizedAnchor, PlanePose, PlanePoseInput, PlanePoseOutput,
    PlaneStripInput, PlaneStripOutput, Point, Quad, Size, SurfaceWindowPlan, SurfaceWindowSpec,
    TransformError, TransformResult, TransformSpec, WindowFrost, emit_css_transform,
    inverse_transform_point, plan_surface_window, project_plane_pose, project_plane_strip,
    solve_spec, transform_point,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use crate::canonical::{canonical_json_value, fingerprint_json_value};

pub const EFFECT_VERSION: &str = "3";
pub const EFFECT_RECIPE_INSPECTION_SCHEMA: &str = "worldbend.effect-recipe-inspection";
const LEGACY_EFFECT_VERSION: &str = "1";
const CAMERA_EFFECT_VERSION: &str = "2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EffectId {
    LayeredDepth,
    MultiplaneCamera,
    RigidTilt,
    SharedPlane,
    HingedReveal,
    FrostedLens,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EffectIntent {
    Depth,
    Inspect,
    Reveal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EffectContent {
    Dom,
    Texture,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EffectCarrier {
    Web,
    Swiftui,
    Figma,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectCatalogInput {
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    #[serde(default)]
    pub intent: Option<EffectIntent>,
    #[serde(default)]
    pub content: Option<EffectContent>,
    #[serde(default)]
    pub carrier: Option<EffectCarrier>,
    /// Case-insensitive literal terms, all must match. No semantic inference.
    #[serde(default)]
    #[schemars(length(max = 256))]
    pub query: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectDescriptor {
    pub id: EffectId,
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    pub title: String,
    pub intent: EffectIntent,
    pub content: EffectContent,
    pub carriers: Vec<EffectCarrier>,
    pub expresses: String,
    pub compare: String,
    pub limits: String,
    pub slots: Vec<String>,
    pub input_axes: Vec<EffectAxis>,
    pub keywords: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectCatalog {
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    pub ordering: String,
    pub effects: Vec<EffectDescriptor>,
}

pub fn effect_catalog(input: &EffectCatalogInput) -> TransformResult<EffectCatalog> {
    version(&input.version)?;
    if input.query.chars().count() > 256 {
        return Err(limit("effect query exceeds 256 characters"));
    }
    let mut rows = vec![
        (
            EffectId::LayeredDepth,
            "分层纵深",
            EffectIntent::Depth,
            EffectContent::Dom,
            vec![EffectCarrier::Web, EffectCarrier::Swiftui],
            "Separate foreground, middle and background by response distance.",
            "Compare with rigid-tilt using the same three layers and pointer path.",
            "Requires authored layers and overscan; no depth extraction. SwiftUI delivery uses the explicit translation tracks in a local native host; no Web runtime or per-frame tool call.",
            vec!["background", "middle", "foreground"],
            vec![EffectAxis::PointerX, EffectAxis::PointerY],
            "parallax stage depth drag layers 视差 舞台 纵深 拖动 分层",
        ),
        (
            EffectId::RigidTilt,
            "整体倾斜",
            EffectIntent::Depth,
            EffectContent::Dom,
            vec![EffectCarrier::Web],
            "Keep all content on one rigid plane while the viewer changes direction.",
            "Compare with layered-depth: a single object versus a scene with depth.",
            "Does not separate objects into depth layers; live DOM controls remain native.",
            vec!["content"],
            vec![EffectAxis::PointerX, EffectAxis::PointerY],
            "card tilt rigid inspect depth 卡片 倾斜 观察 整体 纵深",
        ),
        (
            EffectId::SharedPlane,
            "共面画廊",
            EffectIntent::Inspect,
            EffectContent::Dom,
            vec![EffectCarrier::Web],
            "Keep adjacent cards on one projected plane with shared edge alignment.",
            "Compare edge alignment against independently tilted cards.",
            "Three explicit panels; edit the saved recipe for another bounded partition.",
            vec!["left", "center", "right"],
            vec![EffectAxis::PointerX, EffectAxis::PointerY],
            "gallery cards shared plane aligned 共面 画廊 卡片 对齐",
        ),
        (
            EffectId::HingedReveal,
            "折面显现",
            EffectIntent::Reveal,
            EffectContent::Texture,
            vec![EffectCarrier::Web],
            "Open a hinged window while sampled content remains on its original plane.",
            "Scrub opening and closing; inspect text alignment and frost near the flat endpoint.",
            "Decoded image/video/canvas texture; not interactive DOM. Edge-on faces are hidden.",
            vec!["window"],
            vec![EffectAxis::Progress],
            "fold hinge reveal screen frost 折屏 折叠 揭示 显现 屏幕 模糊",
        ),
        (
            EffectId::FrostedLens,
            "悬浮磨砂窗",
            EffectIntent::Reveal,
            EffectContent::Texture,
            vec![EffectCarrier::Web],
            "Move a raised window over stationary content; separation controls frost.",
            "Compare at identical positions while lowering the window to zero separation.",
            "Decoded texture; no real backdrop capture or arbitrary DOM sampling.",
            vec!["window"],
            vec![
                EffectAxis::Progress,
                EffectAxis::PointerX,
                EffectAxis::PointerY,
            ],
            "glass window frost lens reveal 玻璃 窗口 磨砂 透镜 揭示",
        ),
    ];
    if input.version != LEGACY_EFFECT_VERSION {
        let appearance = input.version == EFFECT_VERSION;
        rows.insert(
            1,
            (
                EffectId::MultiplaneCamera,
                if appearance {
                    "多平面空间成像"
                } else {
                    "多平面视点"
                },
                EffectIntent::Depth,
                if appearance {
                    EffectContent::Texture
                } else {
                    EffectContent::Dom
                },
                if appearance {
                    vec![EffectCarrier::Web, EffectCarrier::Figma]
                } else {
                    vec![EffectCarrier::Web]
                },
                if appearance {
                    "Project explicit planes through one camera, then derive bounded depth of field and motion exposure from authored distances and states."
                } else {
                    "Project explicit foreground, middle and background planes through one bounded look-at camera."
                },
                if appearance {
                    "Compare no blur, optical depth of field and explicit velocity blur using the same planes and input path."
                } else {
                    "Compare with layered-depth: coherent per-plane perspective and opposite-side parallax versus independent offsets."
                },
                if appearance {
                    "Texture planes require decoded sources. Optional grayscale depth maps are explicit bindings; no depth inference, hidden history, relighting or 3D reconstruction."
                } else {
                    "Requires authored plane depths and overscanned layers; reports viewport coverage but does not infer depth, fill exposed pixels or reconstruct objects."
                },
                vec!["background", "middle", "foreground"],
                vec![EffectAxis::PointerX, EffectAxis::PointerY],
                "multiplane camera viewpoint perspective parallax stage depth focus depth-of-field motion blur exposure 多平面 相机 视点 透视 视差 纵深 景深 动态模糊 对焦",
            ),
        );
    }
    let terms = input
        .query
        .to_lowercase()
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let effects = rows
        .into_iter()
        .map(
            |(
                id,
                title,
                intent,
                content,
                carriers,
                expresses,
                compare,
                limits,
                slots,
                input_axes,
                keywords,
            )| EffectDescriptor {
                id,
                version: input.version.clone(),
                title: title.into(),
                intent,
                content,
                carriers,
                expresses: expresses.into(),
                compare: compare.into(),
                limits: limits.into(),
                slots: slots.into_iter().map(str::to_owned).collect(),
                input_axes,
                keywords: keywords.into(),
            },
        )
        .filter(|row| {
            input.intent.is_none_or(|v| row.intent == v)
                && input.content.is_none_or(|v| row.content == v)
                && input.carrier.is_none_or(|v| row.carriers.contains(&v))
                && terms.iter().all(|term| {
                    format!("{} {} {}", row.title, row.keywords, row.expresses)
                        .to_lowercase()
                        .contains(term)
                })
        })
        .collect();
    Ok(EffectCatalog {
        version: input.version.clone(),
        ordering: "catalog-order; not an aesthetic ranking".into(),
        effects,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectRecipeInput {
    pub effect: EffectId,
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    #[schemars(schema_with = "preset_size_schema")]
    pub viewport: Size,
    #[schemars(range(min = 0, max = 1))]
    pub intensity: f64,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum EffectAxis {
    Progress,
    PointerX,
    PointerY,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "kebab-case")]
pub enum EffectProperty {
    RotateX,
    RotateY,
    RotateZ,
    TranslateX,
    TranslateY,
    Depth,
    FrostBase,
    FrostSpread,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum EffectCurve {
    Linear,
    Smoothstep,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectTrack {
    pub property: EffectProperty,
    pub axis: EffectAxis,
    pub from: f64,
    pub to: f64,
    pub curve: EffectCurve,
}

/// Maximum screen-space travel at the focus plane.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct EffectCameraTravel {
    #[schemars(range(min = 0, max = 1000000))]
    pub x: f64,
    #[schemars(range(min = 0, max = 1000000))]
    pub y: f64,
}

/// One explicit pinhole camera shared by every camera plane. `focusDistance`
/// is the version-2 name of the look-at/convergence plane. Version 3 keeps it
/// frozen for compatibility and gives optical focus its own appearance field.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectCameraRig {
    #[schemars(range(min = 1, max = 1000000))]
    pub focal_length: f64,
    #[schemars(range(min = 1, max = 1000000))]
    pub focus_distance: f64,
    pub travel: EffectCameraTravel,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectDepthOfField {
    /// Optical focus is independent from the camera's convergence plane.
    #[schemars(range(min = 1, max = 1000000))]
    pub focus_distance: f64,
    /// Full sharp interval around optical focus. Blur reaches its maximum one
    /// further focus-range beyond either edge of that interval.
    #[schemars(range(min = 1, max = 1000000))]
    pub focus_range: f64,
    /// Maximum blur radius in logical source pixels.
    #[schemars(range(min = 0, max = 64))]
    pub max_blur_radius: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectMotionBlur {
    /// Fraction of the explicit frame interval during which the shutter is open.
    #[schemars(range(min = 0, max = 1))]
    pub exposure_fraction: f64,
    /// Clamp for the screen-space trail in logical pixels.
    #[schemars(range(min = 0, max = 64))]
    pub max_blur_radius: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectSpatialAppearance {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_of_field: Option<EffectDepthOfField>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion_blur: Option<EffectMotionBlur>,
}

/// Optional caller-bound grayscale depth map for one camera plane. Red=0 maps
/// to `nearDistance`; red=1 maps to `farDistance`. The media bytes remain an
/// adapter binding and are not part of recipe identity.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectDepthMap {
    #[schemars(range(min = 1, max = 1000000))]
    pub near_distance: f64,
    #[schemars(range(min = 1, max = 1000000))]
    pub far_distance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    deny_unknown_fields,
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum EffectSurface {
    Plane {
        size: Size,
        pose: PlanePose,
    },
    CameraPlane {
        size: Size,
        #[schemars(range(min = 1, max = 1000000))]
        distance: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        depth_map: Option<EffectDepthMap>,
    },
    Window {
        spec: SurfaceWindowSpec,
    },
    Strip {
        size: Size,
        pose: PlanePose,
        panels: Vec<crate::PlaneStripPanel>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectLayer {
    pub id: String,
    pub offset: Point,
    pub surface: EffectSurface,
    #[schemars(length(max = 8))]
    pub tracks: Vec<EffectTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectRecipe {
    #[schemars(schema_with = "recipe_schema")]
    pub schema: String,
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    /// Provenance of a built-in expansion. Explicit layers remain authoritative.
    #[serde(default)]
    pub origin: Option<EffectRecipeInput>,
    pub viewport: Size,
    /// Present only for version-2+ recipes composed entirely of camera planes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub camera: Option<EffectCameraRig>,
    /// Version-3 optical/temporal rendering derived from the explicit camera.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub appearance: Option<EffectSpatialAppearance>,
    #[schemars(length(min = 1, max = 8))]
    pub layers: Vec<EffectLayer>,
}

/// The reusable media roles required to deliver one validated recipe. Media
/// bytes and paths stay in the carrier; this inspection makes their stable
/// identities available to a higher-level Spatial Document.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectRecipeInspection {
    #[schemars(schema_with = "recipe_inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    pub fingerprint: String,
    #[schemars(length(min = 1, max = 16))]
    pub source_slots: Vec<String>,
    #[schemars(length(max = 8))]
    pub depth_map_slots: Vec<String>,
    #[schemars(range(min = 1, max = 8))]
    pub layer_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectState {
    #[schemars(range(min = 0, max = 1))]
    pub progress: f64,
    #[schemars(range(min = -1, max = 1))]
    pub pointer_x: f64,
    #[schemars(range(min = -1, max = 1))]
    pub pointer_y: f64,
    pub reduced_motion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectPlanInput {
    pub recipe: EffectRecipe,
    pub state: EffectState,
    /// Explicit temporal sample for motion blur. The core retains no prior state.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub motion: Option<EffectMotionSample>,
    /// If supplied, reject a changed recipe before evaluating any layer.
    #[serde(default)]
    pub expected_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectMotionSample {
    pub previous_state: EffectState,
    /// Time between previous and current state in seconds.
    #[schemars(range(min = 0.001, max = 10))]
    pub elapsed_seconds: f64,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum EffectFrameSurface {
    Plane { plan: PlanePoseOutput },
    Window { plan: SurfaceWindowPlan },
    Strip { plan: PlaneStripOutput },
}

#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectSourcePadding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}

/// Geometric source coverage only. Transparent pixels inside the source remain
/// caller-owned content and are not claimed to cover the viewport.
#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectCoverage {
    pub viewport_covered: bool,
    pub sampled_source_bounds: Bounds,
    pub required_source_padding: EffectSourcePadding,
}

#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectDepthOfFieldPlan {
    pub focus_distance: f64,
    pub focus_range: f64,
    pub max_blur_radius: f64,
    pub plane_distance: f64,
    pub blur_radius: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_map: Option<EffectDepthMap>,
}

#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectMotionBlurPlan {
    pub elapsed_seconds: f64,
    pub exposure_fraction: f64,
    pub max_blur_radius: f64,
    pub screen_velocity: Point,
    pub screen_blur_vector: Point,
    /// Vector from the current sample toward its trail in logical source pixels.
    pub source_blur_vector: Point,
}

#[derive(Debug, Clone, Copy, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectFrameAppearance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_of_field: Option<EffectDepthOfFieldPlan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion_blur: Option<EffectMotionBlurPlan>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectFrame {
    pub id: String,
    pub offset: Point,
    pub size: Size,
    pub surface: EffectFrameSurface,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coverage: Option<EffectCoverage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<EffectFrameAppearance>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EffectPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "effect_version_schema")]
    pub version: String,
    pub fingerprint: String,
    pub viewport: Size,
    pub state: EffectState,
    pub frames: Vec<EffectFrame>,
}

fn effect_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","enum":["1","2","3"]})
}
fn recipe_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.effect-recipe"})
}
fn recipe_inspection_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":EFFECT_RECIPE_INSPECTION_SCHEMA})
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.effect-plan"})
}
fn preset_size_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"object","additionalProperties":false,"required":["width","height"],"properties":{"width":{"type":"number","minimum":16,"maximum":8192},"height":{"type":"number","minimum":16,"maximum":8192}}})
}
fn schema(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn limit(message: &str) -> TransformError {
    TransformError::new(ErrorCode::OutputLimit, message)
}
fn version(value: &str) -> TransformResult<()> {
    if value != LEGACY_EFFECT_VERSION && value != CAMERA_EFFECT_VERSION && value != EFFECT_VERSION {
        return Err(schema(
            "unsupported spatial-effects version; expected 1, 2 or 3",
        ));
    }
    Ok(())
}
fn size(value: Size) -> TransformResult<()> {
    value.validate("effect size")?;
    if !(1.0..=8192.0).contains(&value.width) || !(1.0..=8192.0).contains(&value.height) {
        return Err(limit("effect dimensions must be in [1,8192]"));
    }
    Ok(())
}
fn finite(value: f64, min: f64, max: f64) -> TransformResult<()> {
    if !value.is_finite() {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "effect values must be finite",
        ));
    }
    if !(min..=max).contains(&value) {
        return Err(schema("effect value outside its declared range"));
    }
    Ok(())
}
fn identifier(id: &str) -> TransformResult<()> {
    if id.is_empty()
        || id.len() > 48
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err(schema(
            "effect slot IDs require 1..48 ASCII letters, digits, hyphens or underscores",
        ));
    }
    Ok(())
}
fn validate_recipe(recipe: &EffectRecipe) -> TransformResult<()> {
    if recipe.schema != "worldbend.effect-recipe" {
        return Err(schema("expected worldbend.effect-recipe"));
    }
    version(&recipe.version)?;
    size(recipe.viewport)?;
    if let Some(origin) = &recipe.origin {
        version(&origin.version)?;
        if origin.version != recipe.version {
            return Err(schema("effect origin version must match its recipe"));
        }
        size(origin.viewport)?;
        if origin.viewport.width < 16.0 || origin.viewport.height < 16.0 {
            return Err(limit(
                "built-in origin viewport dimensions must be in [16,8192]",
            ));
        }
        finite(origin.intensity, 0.0, 1.0)?;
        if origin.effect == EffectId::MultiplaneCamera && recipe.version == LEGACY_EFFECT_VERSION {
            return Err(schema(
                "multiplane-camera requires spatial-effects version 2 or newer",
            ));
        }
    }
    if recipe.version == LEGACY_EFFECT_VERSION && recipe.camera.is_some() {
        return Err(schema("camera rigs require spatial-effects version 2"));
    }
    if recipe.version != EFFECT_VERSION && recipe.appearance.is_some() {
        return Err(schema(
            "spatial appearance requires spatial-effects version 3",
        ));
    }
    if let Some(camera) = recipe.camera {
        finite(camera.focal_length, 1.0, 1_000_000.0)?;
        finite(camera.focus_distance, 1.0, 1_000_000.0)?;
        finite(camera.travel.x, 0.0, 1_000_000.0)?;
        finite(camera.travel.y, 0.0, 1_000_000.0)?;
    }
    if let Some(appearance) = recipe.appearance {
        if appearance.depth_of_field.is_none() && appearance.motion_blur.is_none() {
            return Err(schema(
                "spatial appearance requires depthOfField or motionBlur",
            ));
        }
        if let Some(depth) = appearance.depth_of_field {
            finite(depth.focus_distance, 1.0, 1_000_000.0)?;
            finite(depth.focus_range, 1.0, 1_000_000.0)?;
            finite(depth.max_blur_radius, 0.0, 64.0)?;
        }
        if let Some(motion) = appearance.motion_blur {
            finite(motion.exposure_fraction, 0.0, 1.0)?;
            finite(motion.max_blur_radius, 0.0, 64.0)?;
        }
        if recipe.camera.is_none() {
            return Err(schema("spatial appearance requires a shared camera rig"));
        }
    }
    if recipe.layers.is_empty() || recipe.layers.len() > 8 {
        return Err(limit("effect recipe requires 1..8 layers"));
    }
    let mut slots = BTreeSet::new();
    let mut layers = BTreeSet::new();
    let mut camera_planes = 0usize;
    let mut previous_camera_distance = f64::INFINITY;
    for layer in &recipe.layers {
        identifier(&layer.id)?;
        if !layers.insert(&layer.id) {
            return Err(schema("duplicate effect layer ID"));
        }
        finite(layer.offset.x, -1_000_000.0, 1_000_000.0)?;
        finite(layer.offset.y, -1_000_000.0, 1_000_000.0)?;
        let window = matches!(layer.surface, EffectSurface::Window { .. });
        let base_pose = match &layer.surface {
            EffectSurface::Plane { pose, .. } | EffectSurface::Strip { pose, .. } => Some(pose),
            EffectSurface::CameraPlane { .. } => None,
            EffectSurface::Window { spec } => {
                for value in [
                    spec.content_origin.x,
                    spec.content_origin.y,
                    spec.frost.base_radius,
                    spec.frost.spread,
                    spec.frost.max_radius,
                ] {
                    finite(value, f64::MIN, f64::MAX)?;
                }
                Some(&spec.pose)
            }
        };
        // Tracks must not hide a non-finite authored value from serialization.
        if let Some(base_pose) = base_pose {
            for value in [
                base_pose.perspective,
                base_pose.rotate_x,
                base_pose.rotate_y,
                base_pose.rotate_z,
                base_pose.depth,
                base_pose.translate.x,
                base_pose.translate.y,
                base_pose.pivot.x,
                base_pose.pivot.y,
                base_pose.perspective_origin.x,
                base_pose.perspective_origin.y,
            ] {
                finite(value, f64::MIN, f64::MAX)?;
            }
        }
        match &layer.surface {
            EffectSurface::Strip {
                size: s, panels, ..
            } => {
                size(*s)?;
                if panels.is_empty() || panels.len() > 8 {
                    return Err(limit("effect strip requires 1..8 panels"));
                }
                for panel in panels {
                    identifier(&panel.id)?;
                    size(panel.element_size)?;
                    if !slots.insert(&panel.id) {
                        return Err(schema("duplicate effect slot ID"));
                    }
                }
            }
            EffectSurface::Plane { size: s, .. } => {
                size(*s)?;
                if !slots.insert(&layer.id) {
                    return Err(schema("duplicate effect slot ID"));
                }
            }
            EffectSurface::CameraPlane {
                size: s,
                distance,
                depth_map,
            } => {
                size(*s)?;
                finite(*distance, 1.0, 1_000_000.0)?;
                if recipe.camera.is_none() {
                    return Err(schema("camera-plane surfaces require a recipe camera rig"));
                }
                if let Some(map) = depth_map {
                    if recipe.version != EFFECT_VERSION {
                        return Err(schema("depth maps require spatial-effects version 3"));
                    }
                    if recipe
                        .appearance
                        .and_then(|appearance| appearance.depth_of_field)
                        .is_none()
                    {
                        return Err(schema("depth maps require depthOfField appearance"));
                    }
                    finite(map.near_distance, 1.0, 1_000_000.0)?;
                    finite(map.far_distance, 1.0, 1_000_000.0)?;
                    if map.near_distance >= map.far_distance {
                        return Err(schema(
                            "depthMap nearDistance must be less than farDistance",
                        ));
                    }
                }
                if *distance >= previous_camera_distance {
                    return Err(schema(
                        "camera planes must be ordered from farthest to nearest",
                    ));
                }
                previous_camera_distance = *distance;
                camera_planes += 1;
                if !layer.tracks.is_empty() {
                    return Err(schema(
                        "camera-plane motion is owned by the shared camera rig, not layer tracks",
                    ));
                }
                if !slots.insert(&layer.id) {
                    return Err(schema("duplicate effect slot ID"));
                }
            }
            EffectSurface::Window { spec } => {
                size(spec.window_size)?;
                size(spec.content_size)?;
                if !slots.insert(&layer.id) {
                    return Err(schema("duplicate effect slot ID"));
                }
            }
        }
        if layer.tracks.len() > 8 {
            return Err(limit("effect layer exceeds 8 tracks"));
        }
        let mut properties = BTreeSet::new();
        for track in &layer.tracks {
            if !properties.insert(track.property) {
                return Err(schema("a property may have only one effect track"));
            }
            let (min, max) = match track.property {
                EffectProperty::RotateX | EffectProperty::RotateY | EffectProperty::RotateZ => {
                    (-360.0, 360.0)
                }
                EffectProperty::FrostBase if window => (0.0, 64.0),
                EffectProperty::FrostSpread if window => (0.0, 1.0),
                EffectProperty::FrostBase | EffectProperty::FrostSpread => {
                    return Err(schema("frost tracks require a window surface"));
                }
                _ => (-1_000_000.0, 1_000_000.0),
            };
            finite(track.from, min, max)?;
            finite(track.to, min, max)?;
        }
    }
    if slots.len() > 16 {
        return Err(limit("effect recipe exceeds 16 total slots"));
    }
    if recipe.camera.is_some() {
        if camera_planes != recipe.layers.len() || camera_planes < 2 {
            return Err(schema(
                "a camera recipe requires 2..8 ordered camera-plane layers",
            ));
        }
    } else if camera_planes != 0 {
        return Err(schema("camera-plane surfaces require a recipe camera rig"));
    }
    Ok(())
}

pub fn inspect_effect_recipe(recipe: &EffectRecipe) -> TransformResult<EffectRecipeInspection> {
    validate_recipe(recipe)?;
    let mut source_slots = Vec::new();
    let mut depth_map_slots = Vec::new();
    for layer in &recipe.layers {
        match &layer.surface {
            EffectSurface::Strip { panels, .. } => {
                source_slots.extend(panels.iter().map(|panel| panel.id.clone()));
            }
            EffectSurface::CameraPlane { depth_map, .. } => {
                source_slots.push(layer.id.clone());
                if depth_map.is_some() {
                    depth_map_slots.push(layer.id.clone());
                }
            }
            EffectSurface::Plane { .. } | EffectSurface::Window { .. } => {
                source_slots.push(layer.id.clone());
            }
        }
    }
    Ok(EffectRecipeInspection {
        schema: EFFECT_RECIPE_INSPECTION_SCHEMA.to_owned(),
        version: recipe.version.clone(),
        fingerprint: effect_recipe_fingerprint(recipe)?,
        source_slots,
        depth_map_slots,
        layer_count: recipe.layers.len(),
    })
}

fn pose(size: Size) -> PlanePose {
    PlanePose {
        perspective: size.width.max(size.height) * 3.0,
        rotate_x: 0.0,
        rotate_y: 0.0,
        rotate_z: 0.0,
        depth: 0.0,
        translate: Point::new(0.0, 0.0),
        pivot: NormalizedAnchor { x: 0.5, y: 0.5 },
        perspective_origin: NormalizedAnchor { x: 0.5, y: 0.5 },
    }
}
fn track(property: EffectProperty, axis: EffectAxis, from: f64, to: f64) -> EffectTrack {
    EffectTrack {
        property,
        axis,
        from,
        to,
        curve: EffectCurve::Linear,
    }
}

pub fn effect_recipe(input: &EffectRecipeInput) -> TransformResult<EffectRecipe> {
    version(&input.version)?;
    if input.effect == EffectId::MultiplaneCamera && input.version == LEGACY_EFFECT_VERSION {
        return Err(schema(
            "multiplane-camera requires spatial-effects version 2 or newer",
        ));
    }
    size(input.viewport)?;
    finite(input.intensity, 0.0, 1.0)?;
    if input.viewport.width < 16.0 || input.viewport.height < 16.0 {
        return Err(limit(
            "built-in effect viewport dimensions must be in [16,8192]",
        ));
    }
    let s = input.viewport;
    let k = input.intensity;
    if input.effect == EffectId::MultiplaneCamera
        && (s.width * 1.2 > 8192.0 || s.height * 1.2 > 8192.0)
    {
        return Err(limit(
            "multiplane-camera viewport plus 10% source overscan per edge must fit within 8192",
        ));
    }
    let camera = (input.effect == EffectId::MultiplaneCamera).then_some(EffectCameraRig {
        focal_length: s.width.max(s.height) * 2.2,
        focus_distance: 1_000.0,
        travel: EffectCameraTravel {
            x: s.width * 0.1 * k,
            y: s.height * 0.1 * k,
        },
    });
    let appearance = (input.effect == EffectId::MultiplaneCamera
        && input.version == EFFECT_VERSION)
        .then_some(EffectSpatialAppearance {
            depth_of_field: Some(EffectDepthOfField {
                focus_distance: 1_000.0,
                focus_range: 300.0,
                max_blur_radius: 14.0 * k,
            }),
            motion_blur: Some(EffectMotionBlur {
                exposure_fraction: 0.65,
                max_blur_radius: 32.0 * k,
            }),
        });
    let plane = |id: &str, tracks: Vec<EffectTrack>| EffectLayer {
        id: id.into(),
        offset: Point::new(0.0, 0.0),
        surface: EffectSurface::Plane {
            size: s,
            pose: pose(s),
        },
        tracks,
    };
    let tilt = || {
        vec![
            track(
                EffectProperty::RotateX,
                EffectAxis::PointerY,
                12.0 * k,
                -12.0 * k,
            ),
            track(
                EffectProperty::RotateY,
                EffectAxis::PointerX,
                -18.0 * k,
                18.0 * k,
            ),
        ]
    };
    let layers = match input.effect {
        EffectId::LayeredDepth => [
            ("background", 0.015),
            ("middle", 0.035),
            ("foreground", 0.065),
        ]
        .into_iter()
        .map(|(id, depth)| {
            plane(
                id,
                vec![
                    track(
                        EffectProperty::TranslateX,
                        EffectAxis::PointerX,
                        -s.width * depth * k,
                        s.width * depth * k,
                    ),
                    track(
                        EffectProperty::TranslateY,
                        EffectAxis::PointerY,
                        -s.height * depth * k,
                        s.height * depth * k,
                    ),
                ],
            )
        })
        .collect(),
        EffectId::MultiplaneCamera => {
            let overscan = Point::new(s.width * 0.1, s.height * 0.1);
            let size = Size {
                width: s.width + overscan.x * 2.0,
                height: s.height + overscan.y * 2.0,
            };
            [
                ("background", 1_500.0),
                ("middle", 1_000.0),
                ("foreground", 650.0),
            ]
            .into_iter()
            .map(|(id, distance)| EffectLayer {
                id: id.into(),
                offset: Point::new(-overscan.x, -overscan.y),
                surface: EffectSurface::CameraPlane {
                    size,
                    distance,
                    depth_map: None,
                },
                tracks: Vec::new(),
            })
            .collect()
        }
        EffectId::RigidTilt => vec![plane("content", tilt())],
        EffectId::SharedPlane => {
            // Explicit intervals are stored in the recipe; the shared core owns subdivision.
            let panels = [
                ("left", 0.0, 0.32),
                ("center", 0.34, 0.66),
                ("right", 0.68, 1.0),
            ]
            .into_iter()
            .map(|(id, start, end)| crate::PlaneStripPanel {
                id: id.into(),
                start,
                end,
                element_size: Size {
                    width: s.width * (end - start),
                    height: s.height,
                },
            })
            .collect();
            vec![EffectLayer {
                id: "gallery".into(),
                offset: Point::new(0.0, 0.0),
                surface: EffectSurface::Strip {
                    size: s,
                    pose: pose(s),
                    panels,
                },
                tracks: tilt(),
            }]
        }
        EffectId::HingedReveal | EffectId::FrostedLens => {
            let hinge = input.effect == EffectId::HingedReveal;
            let ws = if hinge {
                s
            } else {
                Size {
                    width: s.width * 0.6,
                    height: s.height * 0.6,
                }
            };
            let offset = if hinge {
                Point::new(0.0, 0.0)
            } else {
                Point::new(s.width * 0.2, s.height * 0.2)
            };
            let mut p = pose(s);
            let tracks = if hinge {
                p.pivot.x = 0.0;
                p.perspective_origin.x = 0.0;
                vec![track(
                    EffectProperty::RotateY,
                    EffectAxis::Progress,
                    -85.0 * k,
                    0.0,
                )]
            } else {
                vec![
                    track(
                        EffectProperty::TranslateX,
                        EffectAxis::PointerX,
                        -s.width * 0.17 * k,
                        s.width * 0.17 * k,
                    ),
                    track(
                        EffectProperty::TranslateY,
                        EffectAxis::PointerY,
                        -s.height * 0.17 * k,
                        s.height * 0.17 * k,
                    ),
                    track(
                        EffectProperty::Depth,
                        EffectAxis::Progress,
                        s.width.min(s.height) * 0.25 * k,
                        0.0,
                    ),
                ]
            };
            vec![EffectLayer {
                id: "window".into(),
                offset,
                surface: EffectSurface::Window {
                    spec: SurfaceWindowSpec {
                        schema: "worldbend.surface-window".into(),
                        version: "0.1".into(),
                        content_size: s,
                        content_origin: Point::new(-offset.x, -offset.y),
                        window_size: ws,
                        pose: p,
                        frost: WindowFrost {
                            base_radius: 0.0,
                            spread: 0.13,
                            max_radius: 30.0,
                        },
                    },
                },
                tracks,
            }]
        }
    };
    let recipe = EffectRecipe {
        schema: "worldbend.effect-recipe".into(),
        version: input.version.clone(),
        origin: Some(input.clone()),
        viewport: s,
        camera,
        appearance,
        layers,
    };
    validate_recipe(&recipe)?;
    serde_json::from_value(canonical_recipe(&recipe)?).map_err(|_| schema("invalid recipe"))
}

fn canonical_recipe(recipe: &EffectRecipe) -> TransformResult<serde_json::Value> {
    // Typed data expands defaults. JavaScript JSON cannot retain -0, so signed
    // zero has one identity throughout this ABI.
    canonical_json_value(recipe).map_err(|_| schema("invalid recipe"))
}

fn effect_recipe_fingerprint(recipe: &EffectRecipe) -> TransformResult<String> {
    fingerprint_json_value(&canonical_recipe(recipe)?).map_err(|_| schema("invalid recipe"))
}

#[derive(Clone, Copy)]
struct Vec3 {
    x: f64,
    y: f64,
    z: f64,
}

impl Vec3 {
    fn subtract(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
            z: self.z - other.z,
        }
    }

    fn dot(self, other: Self) -> f64 {
        self.x * other.x + self.y * other.y + self.z * other.z
    }

    fn cross(self, other: Self) -> Self {
        Self {
            x: self.y * other.z - self.z * other.y,
            y: self.z * other.x - self.x * other.z,
            z: self.x * other.y - self.y * other.x,
        }
    }

    fn normalized(self) -> TransformResult<Self> {
        let length = self.dot(self).sqrt();
        if !length.is_finite() || length <= 1.0e-12 {
            return Err(schema("camera basis is degenerate"));
        }
        Ok(Self {
            x: self.x / length,
            y: self.y / length,
            z: self.z / length,
        })
    }
}

fn project_camera_plane(
    viewport: Size,
    offset: Point,
    size: Size,
    distance: f64,
    camera: EffectCameraRig,
    state: &EffectState,
) -> TransformResult<(PlanePoseOutput, EffectCoverage)> {
    let camera_position = Vec3 {
        x: state.pointer_x * camera.travel.x * camera.focus_distance / camera.focal_length,
        y: state.pointer_y * camera.travel.y * camera.focus_distance / camera.focal_length,
        z: 0.0,
    };
    let target = Vec3 {
        x: 0.0,
        y: 0.0,
        z: camera.focus_distance,
    };
    let forward = target.subtract(camera_position).normalized()?;
    let right = forward
        .cross(Vec3 {
            x: 0.0,
            y: -1.0,
            z: 0.0,
        })
        .normalized()?;
    let down = forward.cross(right).normalized()?;
    let center = Point::new(viewport.width / 2.0, viewport.height / 2.0);
    let mut projected = Vec::with_capacity(4);
    for source in [
        Point::new(0.0, 0.0),
        Point::new(size.width, 0.0),
        Point::new(size.width, size.height),
        Point::new(0.0, size.height),
    ] {
        let screen_x = offset.x + source.x;
        let screen_y = offset.y + source.y;
        let world = Vec3 {
            x: (screen_x - center.x) * distance / camera.focal_length,
            y: (screen_y - center.y) * distance / camera.focal_length,
            z: distance,
        };
        let relative = world.subtract(camera_position);
        let local_x = relative.dot(right);
        let local_y = relative.dot(down);
        let local_z = relative.dot(forward);
        if ![local_x, local_y, local_z]
            .iter()
            .all(|value| value.is_finite())
        {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "camera-plane projection overflowed",
            ));
        }
        if local_z <= 1.0e-9 {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "camera plane touches or crosses the projection horizon",
            ));
        }
        let global = Point::new(
            center.x + camera.focal_length * local_x / local_z,
            center.y + camera.focal_length * local_y / local_z,
        );
        projected.push(Point::new(global.x - offset.x, global.y - offset.y));
    }
    let spec = TransformSpec::pixel(
        size,
        Quad::new(projected[0], projected[1], projected[2], projected[3]),
    );
    let solved = solve_spec(&spec, None)?;
    let css = emit_css_transform(&spec, size, None)?;
    let mut sampled = Vec::with_capacity(4);
    for viewport_point in [
        Point::new(0.0, 0.0),
        Point::new(viewport.width, 0.0),
        Point::new(viewport.width, viewport.height),
        Point::new(0.0, viewport.height),
    ] {
        let normalized = inverse_transform_point(
            &solved.homography,
            Point::new(viewport_point.x - offset.x, viewport_point.y - offset.y),
        )?;
        sampled.push(Point::new(
            normalized.x * size.width,
            normalized.y * size.height,
        ));
    }
    let min_x = sampled
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let max_x = sampled
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = sampled
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let max_y = sampled
        .iter()
        .map(|point| point.y)
        .fold(f64::NEG_INFINITY, f64::max);
    let epsilon = size.width.max(size.height) * 1.0e-9;
    let required_source_padding = EffectSourcePadding {
        top: (-min_y).max(0.0),
        right: (max_x - size.width).max(0.0),
        bottom: (max_y - size.height).max(0.0),
        left: (-min_x).max(0.0),
    };
    let coverage = EffectCoverage {
        viewport_covered: min_x >= -epsilon
            && min_y >= -epsilon
            && max_x <= size.width + epsilon
            && max_y <= size.height + epsilon,
        sampled_source_bounds: Bounds {
            x: min_x,
            y: min_y,
            width: max_x - min_x,
            height: max_y - min_y,
        },
        required_source_padding,
    };
    Ok((PlanePoseOutput { spec, css }, coverage))
}

fn validate_effect_state(state: &EffectState) -> TransformResult<()> {
    finite(state.progress, 0.0, 1.0)?;
    finite(state.pointer_x, -1.0, 1.0)?;
    finite(state.pointer_y, -1.0, 1.0)
}

fn effective_state(state: &EffectState) -> EffectState {
    if state.reduced_motion {
        EffectState {
            progress: 1.0,
            pointer_x: 0.0,
            pointer_y: 0.0,
            reduced_motion: true,
        }
    } else {
        state.clone()
    }
}

fn depth_blur_radius(distance: f64, depth: EffectDepthOfField) -> f64 {
    let outside_focus = (distance - depth.focus_distance).abs() - depth.focus_range / 2.0;
    depth.max_blur_radius * (outside_focus / depth.focus_range).clamp(0.0, 1.0)
}

fn zero_motion_plan(motion: EffectMotionBlur, elapsed_seconds: f64) -> EffectMotionBlurPlan {
    EffectMotionBlurPlan {
        elapsed_seconds,
        exposure_fraction: motion.exposure_fraction,
        max_blur_radius: motion.max_blur_radius,
        screen_velocity: Point::new(0.0, 0.0),
        screen_blur_vector: Point::new(0.0, 0.0),
        source_blur_vector: Point::new(0.0, 0.0),
    }
}

fn motion_blur_plan(
    current: &PlanePoseOutput,
    previous: &PlanePoseOutput,
    size: Size,
    settings: EffectMotionBlur,
    sample: &EffectMotionSample,
) -> TransformResult<EffectMotionBlurPlan> {
    if sample.previous_state.reduced_motion {
        return Ok(zero_motion_plan(settings, sample.elapsed_seconds));
    }
    let current_solved = solve_spec(&current.spec, None)?;
    let previous_solved = solve_spec(&previous.spec, None)?;
    let center = Point::new(0.5, 0.5);
    let current_center = transform_point(&current_solved.homography, center)?;
    let previous_center = transform_point(&previous_solved.homography, center)?;
    let displacement = Point::new(
        current_center.x - previous_center.x,
        current_center.y - previous_center.y,
    );
    let velocity = Point::new(
        displacement.x / sample.elapsed_seconds,
        displacement.y / sample.elapsed_seconds,
    );
    let mut screen_blur = Point::new(
        displacement.x * settings.exposure_fraction,
        displacement.y * settings.exposure_fraction,
    );
    let magnitude = screen_blur.x.hypot(screen_blur.y);
    if magnitude > settings.max_blur_radius && magnitude > 0.0 {
        let scale = settings.max_blur_radius / magnitude;
        screen_blur.x *= scale;
        screen_blur.y *= scale;
    }
    let trail = inverse_transform_point(
        &current_solved.homography,
        Point::new(
            current_center.x - screen_blur.x,
            current_center.y - screen_blur.y,
        ),
    )?;
    Ok(EffectMotionBlurPlan {
        elapsed_seconds: sample.elapsed_seconds,
        exposure_fraction: settings.exposure_fraction,
        max_blur_radius: settings.max_blur_radius,
        screen_velocity: velocity,
        screen_blur_vector: screen_blur,
        source_blur_vector: Point::new((trail.x - 0.5) * size.width, (trail.y - 0.5) * size.height),
    })
}

pub fn effect_plan(input: &EffectPlanInput) -> TransformResult<EffectPlan> {
    validate_recipe(&input.recipe)?;
    validate_effect_state(&input.state)?;
    if let Some(motion) = &input.motion {
        validate_effect_state(&motion.previous_state)?;
        finite(motion.elapsed_seconds, 0.001, 10.0)?;
        if input
            .recipe
            .appearance
            .and_then(|appearance| appearance.motion_blur)
            .is_none()
        {
            return Err(schema(
                "motion samples require version-3 motionBlur appearance",
            ));
        }
    }
    let fingerprint = effect_recipe_fingerprint(&input.recipe)?;
    if input
        .expected_fingerprint
        .as_ref()
        .is_some_and(|value| value != &fingerprint)
    {
        return Err(schema(
            "effect recipe fingerprint mismatch; inspect the changed recipe before accepting it",
        ));
    }
    let state = effective_state(&input.state);
    let mut frames = Vec::with_capacity(input.recipe.layers.len());
    for layer in &input.recipe.layers {
        let mut surface = layer.surface.clone();
        for track in &layer.tracks {
            let t = match track.axis {
                EffectAxis::Progress => state.progress,
                EffectAxis::PointerX => (state.pointer_x + 1.0) / 2.0,
                EffectAxis::PointerY => (state.pointer_y + 1.0) / 2.0,
            };
            let t = match track.curve {
                EffectCurve::Linear => t,
                EffectCurve::Smoothstep => t * t * (3.0 - 2.0 * t),
            };
            let value = track.from + (track.to - track.from) * t;
            let p = match &mut surface {
                EffectSurface::Plane { pose, .. } | EffectSurface::Strip { pose, .. } => pose,
                EffectSurface::CameraPlane { .. } => {
                    return Err(schema(
                        "camera-plane motion is owned by the shared camera rig",
                    ));
                }
                EffectSurface::Window { spec } => &mut spec.pose,
            };
            match track.property {
                EffectProperty::RotateX => p.rotate_x = value,
                EffectProperty::RotateY => p.rotate_y = value,
                EffectProperty::RotateZ => p.rotate_z = value,
                EffectProperty::TranslateX => p.translate.x = value,
                EffectProperty::TranslateY => p.translate.y = value,
                EffectProperty::Depth => p.depth = value,
                EffectProperty::FrostBase | EffectProperty::FrostSpread => {
                    if let EffectSurface::Window { spec } = &mut surface {
                        if track.property == EffectProperty::FrostBase {
                            spec.frost.base_radius = value;
                        } else {
                            spec.frost.spread = value;
                        }
                    }
                }
            }
        }
        let (size, surface, coverage, appearance) = match surface {
            EffectSurface::Plane { size, pose } => (
                size,
                EffectFrameSurface::Plane {
                    plan: project_plane_pose(&PlanePoseInput {
                        element_size: size,
                        pose,
                    })?,
                },
                None,
                None,
            ),
            EffectSurface::CameraPlane {
                size,
                distance,
                depth_map,
            } => {
                let camera = input
                    .recipe
                    .camera
                    .ok_or_else(|| schema("camera-plane surfaces require a recipe camera rig"))?;
                let (plan, coverage) = project_camera_plane(
                    input.recipe.viewport,
                    layer.offset,
                    size,
                    distance,
                    camera,
                    &state,
                )?;
                let appearance = input.recipe.appearance.map(|settings| {
                    let depth_of_field =
                        settings.depth_of_field.map(|depth| EffectDepthOfFieldPlan {
                            focus_distance: depth.focus_distance,
                            focus_range: depth.focus_range,
                            max_blur_radius: depth.max_blur_radius,
                            plane_distance: distance,
                            blur_radius: depth_blur_radius(distance, depth),
                            depth_map,
                        });
                    let motion_blur = settings.motion_blur.map(|motion| {
                        if state.reduced_motion {
                            return Ok(zero_motion_plan(
                                motion,
                                input
                                    .motion
                                    .as_ref()
                                    .map_or(0.0, |sample| sample.elapsed_seconds),
                            ));
                        }
                        let Some(sample) = &input.motion else {
                            return Ok(zero_motion_plan(motion, 0.0));
                        };
                        let previous_state = effective_state(&sample.previous_state);
                        let (previous, _) = project_camera_plane(
                            input.recipe.viewport,
                            layer.offset,
                            size,
                            distance,
                            camera,
                            &previous_state,
                        )?;
                        motion_blur_plan(&plan, &previous, size, motion, sample)
                    });
                    match motion_blur {
                        Some(Ok(motion_blur)) => Ok(EffectFrameAppearance {
                            depth_of_field,
                            motion_blur: Some(motion_blur),
                        }),
                        Some(Err(error)) => Err(error),
                        None => Ok(EffectFrameAppearance {
                            depth_of_field,
                            motion_blur: None,
                        }),
                    }
                });
                (
                    size,
                    EffectFrameSurface::Plane { plan },
                    Some(coverage),
                    appearance.transpose()?,
                )
            }
            EffectSurface::Window { spec } => (
                spec.window_size,
                EffectFrameSurface::Window {
                    plan: plan_surface_window(&spec)?,
                },
                None,
                None,
            ),
            EffectSurface::Strip { size, pose, panels } => {
                let parent = project_plane_pose(&PlanePoseInput {
                    element_size: size,
                    pose,
                })?;
                (
                    size,
                    EffectFrameSurface::Strip {
                        plan: project_plane_strip(&PlaneStripInput {
                            spec: parent.spec,
                            panels,
                            destination_size: None,
                        })?,
                    },
                    None,
                    None,
                )
            }
        };
        frames.push(EffectFrame {
            id: layer.id.clone(),
            offset: layer.offset,
            size,
            surface,
            coverage,
            appearance,
        });
    }
    Ok(EffectPlan {
        schema: "worldbend.effect-plan".into(),
        version: input.recipe.version.clone(),
        fingerprint,
        viewport: input.recipe.viewport,
        state,
        frames,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn query() -> EffectCatalogInput {
        EffectCatalogInput {
            version: "1".into(),
            intent: None,
            content: None,
            carrier: None,
            query: String::new(),
        }
    }
    fn recipe(id: EffectId) -> EffectRecipe {
        effect_recipe(&EffectRecipeInput {
            effect: id,
            version: "1".into(),
            viewport: Size {
                width: 600.0,
                height: 400.0,
            },
            intensity: 0.8,
        })
        .unwrap()
    }
    fn recipe_v2(id: EffectId) -> EffectRecipe {
        effect_recipe(&EffectRecipeInput {
            effect: id,
            version: "2".into(),
            viewport: Size {
                width: 600.0,
                height: 400.0,
            },
            intensity: 0.8,
        })
        .unwrap()
    }
    fn recipe_v3(id: EffectId) -> EffectRecipe {
        effect_recipe(&EffectRecipeInput {
            effect: id,
            version: "3".into(),
            viewport: Size {
                width: 600.0,
                height: 400.0,
            },
            intensity: 0.8,
        })
        .unwrap()
    }
    fn request(id: EffectId) -> EffectPlanInput {
        EffectPlanInput {
            recipe: recipe(id),
            state: EffectState {
                progress: 0.4,
                pointer_x: 0.7,
                pointer_y: -0.4,
                reduced_motion: false,
            },
            motion: None,
            expected_fingerprint: None,
        }
    }
    fn request_v2(id: EffectId) -> EffectPlanInput {
        EffectPlanInput {
            recipe: recipe_v2(id),
            state: EffectState {
                progress: 0.4,
                pointer_x: 0.7,
                pointer_y: -0.4,
                reduced_motion: false,
            },
            motion: None,
            expected_fingerprint: None,
        }
    }
    #[test]
    fn catalog_is_literal_ordered_and_carrier_honest() {
        let all = effect_catalog(&query()).unwrap();
        assert_eq!(all.effects.len(), 5);
        let mut q = query();
        q.query = "视差".into();
        assert_eq!(
            effect_catalog(&q).unwrap().effects[0].id,
            EffectId::LayeredDepth
        );
        q.query = "not-an-effect".into();
        assert!(effect_catalog(&q).unwrap().effects.is_empty());
        q.query.clear();
        q.carrier = Some(EffectCarrier::Swiftui);
        let swiftui = effect_catalog(&q).unwrap();
        assert_eq!(swiftui.effects.len(), 1);
        assert_eq!(swiftui.effects[0].id, EffectId::LayeredDepth);
        assert_eq!(
            swiftui.effects[0].carriers,
            vec![EffectCarrier::Web, EffectCarrier::Swiftui]
        );
        q.carrier = Some(EffectCarrier::Figma);
        assert!(effect_catalog(&q).unwrap().effects.is_empty());
        q.version = "2".into();
        q.carrier = None;
        let current = effect_catalog(&q).unwrap();
        assert_eq!(current.effects.len(), 6);
        assert_eq!(current.effects[1].id, EffectId::MultiplaneCamera);
        assert_eq!(current.effects[1].version, "2");
        // The SwiftUI route stays layered-depth-only in the current version too.
        q.carrier = Some(EffectCarrier::Swiftui);
        let current_native = effect_catalog(&q).unwrap();
        assert_eq!(current_native.effects.len(), 1);
        assert_eq!(current_native.effects[0].id, EffectId::LayeredDepth);
        q.carrier = None;
        q.version = "3".into();
        let appearance = effect_catalog(&q).unwrap();
        assert_eq!(appearance.effects.len(), 6);
        assert_eq!(appearance.effects[1].version, "3");
        assert_eq!(appearance.effects[1].content, EffectContent::Texture);
        q.carrier = Some(EffectCarrier::Figma);
        let figma = effect_catalog(&q).unwrap();
        assert_eq!(figma.effects.len(), 1);
        assert_eq!(figma.effects[0].id, EffectId::MultiplaneCamera);
        q.version = "4".into();
        assert!(effect_catalog(&q).is_err());
    }
    #[test]
    fn spatial_appearance_separates_focus_plans_motion_and_explicit_depth_maps() {
        let mut recipe = recipe_v3(EffectId::MultiplaneCamera);
        let camera_focus = recipe.camera.unwrap().focus_distance;
        let mut appearance = recipe.appearance.unwrap();
        let mut depth = appearance.depth_of_field.unwrap();
        assert_eq!(camera_focus, 1_000.0);
        assert_eq!(depth.focus_distance, 1_000.0);
        depth.focus_distance = 650.0;
        appearance.depth_of_field = Some(depth);
        recipe.appearance = Some(appearance);
        assert_eq!(recipe.camera.unwrap().focus_distance, camera_focus);
        let EffectSurface::CameraPlane { depth_map, .. } = &mut recipe.layers[0].surface else {
            panic!()
        };
        *depth_map = Some(EffectDepthMap {
            near_distance: 900.0,
            far_distance: 1_800.0,
        });
        recipe.origin = None;
        let previous = EffectState {
            progress: 0.4,
            pointer_x: 0.0,
            pointer_y: 0.0,
            reduced_motion: false,
        };
        let input = EffectPlanInput {
            recipe: recipe.clone(),
            state: EffectState {
                pointer_x: 0.9,
                pointer_y: -0.4,
                ..previous.clone()
            },
            motion: Some(EffectMotionSample {
                previous_state: previous.clone(),
                elapsed_seconds: 1.0 / 60.0,
            }),
            expected_fingerprint: None,
        };
        let plan = effect_plan(&input).unwrap();
        assert_eq!(plan.version, "3");
        assert!(plan.frames.iter().all(|frame| frame.appearance.is_some()));
        let background = plan.frames[0].appearance.unwrap();
        assert_eq!(
            background.depth_of_field.unwrap().depth_map,
            Some(EffectDepthMap {
                near_distance: 900.0,
                far_distance: 1_800.0,
            })
        );
        assert!(background.motion_blur.unwrap().screen_velocity.x.abs() > 0.0);
        let background_depth = background.depth_of_field.unwrap();
        assert_eq!(background_depth.plane_distance, 1_500.0);
        assert_eq!(
            background_depth.blur_radius,
            background_depth.max_blur_radius
        );
        let middle = plan.frames[1].appearance.unwrap().depth_of_field.unwrap();
        let foreground = plan.frames[2].appearance.unwrap().depth_of_field.unwrap();
        assert!(middle.blur_radius > foreground.blur_radius);
        assert_eq!(foreground.blur_radius, 0.0);

        let still = effect_plan(&EffectPlanInput {
            recipe: recipe.clone(),
            state: previous.clone(),
            motion: None,
            expected_fingerprint: None,
        })
        .unwrap();
        assert!(still.frames.iter().all(|frame| {
            frame
                .appearance
                .unwrap()
                .motion_blur
                .unwrap()
                .screen_blur_vector
                == Point::new(0.0, 0.0)
        }));

        let identical = effect_plan(&EffectPlanInput {
            recipe: recipe.clone(),
            state: previous.clone(),
            motion: Some(EffectMotionSample {
                previous_state: previous.clone(),
                elapsed_seconds: 1.0 / 60.0,
            }),
            expected_fingerprint: None,
        })
        .unwrap();
        assert!(identical.frames.iter().all(|frame| {
            frame
                .appearance
                .unwrap()
                .motion_blur
                .unwrap()
                .screen_blur_vector
                == Point::new(0.0, 0.0)
        }));

        let mut reduced = input.clone();
        reduced.state.reduced_motion = true;
        assert!(effect_plan(&reduced).unwrap().frames.iter().all(|frame| {
            frame
                .appearance
                .unwrap()
                .motion_blur
                .unwrap()
                .screen_blur_vector
                == Point::new(0.0, 0.0)
        }));

        let mut v2 = request_v2(EffectId::MultiplaneCamera);
        v2.recipe.appearance = recipe.appearance;
        assert!(effect_plan(&v2).is_err());
        let mut irrelevant_motion = request(EffectId::RigidTilt);
        irrelevant_motion.motion = input.motion;
        assert!(effect_plan(&irrelevant_motion).is_err());
    }
    #[test]
    fn multiplane_camera_uses_one_viewpoint_and_preserves_coverage() {
        let mut input = request_v2(EffectId::MultiplaneCamera);
        input.state.pointer_x = 0.0;
        input.state.pointer_y = 0.0;
        let rest = effect_plan(&input).unwrap();
        assert_eq!(
            rest.fingerprint,
            "sha256:fbe5a8ded790dee02950a4d3f541db5f8875a0b55a53b3a55acb108a430e9280"
        );
        assert_eq!(rest.frames.len(), 3);
        for frame in &rest.frames {
            let EffectFrameSurface::Plane { plan } = &frame.surface else {
                panic!()
            };
            assert_eq!(
                plan.spec.destination.quad,
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(frame.size.width, 0.0),
                    Point::new(frame.size.width, frame.size.height),
                    Point::new(0.0, frame.size.height),
                )
            );
            assert!(frame.coverage.unwrap().viewport_covered);
        }

        for x in [-1.0, 1.0] {
            for y in [-1.0, 1.0] {
                input.state.pointer_x = x;
                input.state.pointer_y = y;
                assert!(
                    effect_plan(&input)
                        .unwrap()
                        .frames
                        .iter()
                        .all(|frame| frame.coverage.unwrap().viewport_covered)
                );
            }
        }

        input.state.pointer_x = 1.0;
        input.state.pointer_y = 0.0;
        let moved = effect_plan(&input).unwrap();
        let projected_center = |frame: &EffectFrame| {
            let EffectFrameSurface::Plane { plan } = &frame.surface else {
                panic!()
            };
            let solved = solve_spec(&plan.spec, None).unwrap();
            let local = crate::transform_point(&solved.homography, Point::new(0.5, 0.5)).unwrap();
            Point::new(local.x + frame.offset.x, local.y + frame.offset.y)
        };
        let background = projected_center(&moved.frames[0]);
        let middle = projected_center(&moved.frames[1]);
        let foreground = projected_center(&moved.frames[2]);
        assert!((middle.x - 300.0).abs() < 1.0e-9);
        assert!((background.x - 300.0) * (foreground.x - 300.0) < 0.0);

        let EffectFrameSurface::Plane { plan } = &moved.frames[2].surface else {
            panic!()
        };
        let quad = plan.spec.destination.quad;
        let left_height = (quad.bl.y - quad.tl.y).hypot(quad.bl.x - quad.tl.x);
        let right_height = (quad.br.y - quad.tr.y).hypot(quad.br.x - quad.tr.x);
        assert!((left_height - right_height).abs() > 0.01);
    }
    #[test]
    fn multiplane_camera_reports_exposure_and_rejects_incoherent_recipes() {
        assert!(
            effect_recipe(&EffectRecipeInput {
                effect: EffectId::MultiplaneCamera,
                version: "1".into(),
                viewport: Size::new(600.0, 400.0),
                intensity: 0.8,
            })
            .is_err()
        );
        let mut input = request_v2(EffectId::MultiplaneCamera);
        input.state.pointer_x = 1.0;
        for layer in &mut input.recipe.layers {
            layer.offset = Point::new(0.0, 0.0);
            let EffectSurface::CameraPlane { size, .. } = &mut layer.surface else {
                panic!()
            };
            *size = input.recipe.viewport;
        }
        let exposed = effect_plan(&input).unwrap();
        assert!(exposed.frames.iter().any(|frame| {
            let coverage = frame.coverage.unwrap();
            !coverage.viewport_covered
                && (coverage.required_source_padding.left > 0.0
                    || coverage.required_source_padding.right > 0.0)
        }));
        for frame in &exposed.frames {
            let coverage = frame.coverage.unwrap();
            let bounds = coverage.sampled_source_bounds;
            assert_eq!(coverage.required_source_padding.left, (-bounds.x).max(0.0));
            assert_eq!(coverage.required_source_padding.top, (-bounds.y).max(0.0));
            assert_eq!(
                coverage.required_source_padding.right,
                (bounds.x + bounds.width - frame.size.width).max(0.0)
            );
            assert_eq!(
                coverage.required_source_padding.bottom,
                (bounds.y + bounds.height - frame.size.height).max(0.0)
            );
        }

        let mut invalid = request_v2(EffectId::MultiplaneCamera);
        invalid.recipe.camera = None;
        assert!(effect_plan(&invalid).is_err());
        let mut invalid = request_v2(EffectId::MultiplaneCamera);
        let EffectSurface::CameraPlane { distance, .. } = &mut invalid.recipe.layers[1].surface
        else {
            panic!()
        };
        *distance = 2_000.0;
        assert!(effect_plan(&invalid).is_err());
        let mut invalid = request_v2(EffectId::MultiplaneCamera);
        invalid.recipe.layers[0].tracks.push(track(
            EffectProperty::TranslateX,
            EffectAxis::PointerX,
            -1.0,
            1.0,
        ));
        assert!(effect_plan(&invalid).is_err());
        let mut invalid = request_v2(EffectId::MultiplaneCamera);
        invalid.recipe.origin = None;
        invalid.recipe.version = "1".into();
        assert!(effect_plan(&invalid).is_err());
    }
    #[test]
    fn multiplane_camera_zero_intensity_and_reduced_motion_return_to_rest() {
        let recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "2".into(),
            viewport: Size::new(600.0, 400.0),
            intensity: 0.0,
        })
        .unwrap();
        let mut input = EffectPlanInput {
            recipe,
            state: EffectState {
                progress: 0.0,
                pointer_x: -1.0,
                pointer_y: 1.0,
                reduced_motion: false,
            },
            motion: None,
            expected_fingerprint: None,
        };
        let first = serde_json::to_value(effect_plan(&input).unwrap().frames).unwrap();
        input.state.pointer_x = 1.0;
        input.state.pointer_y = -1.0;
        assert_eq!(
            serde_json::to_value(effect_plan(&input).unwrap().frames).unwrap(),
            first
        );

        let mut moving = request_v2(EffectId::MultiplaneCamera);
        moving.state.reduced_motion = true;
        let reduced = effect_plan(&moving).unwrap();
        assert!(reduced.frames.iter().all(|frame| {
            let EffectFrameSurface::Plane { plan } = &frame.surface else {
                return false;
            };
            plan.css.matrix3d[3] == 0.0 && plan.css.matrix3d[7] == 0.0
        }));
    }
    #[test]
    fn all_presets_cover_extremes_and_replay_without_history() {
        for id in effect_catalog(&query())
            .unwrap()
            .effects
            .iter()
            .map(|row| row.id)
        {
            let mut input = request(id);
            let before = serde_json::to_string(&effect_plan(&input).unwrap()).unwrap();
            for progress in [0.0, 0.25, 0.5, 0.75, 1.0] {
                for x in [-1.0, 0.0, 1.0] {
                    for y in [-1.0, 0.0, 1.0] {
                        input.state = EffectState {
                            progress,
                            pointer_x: x,
                            pointer_y: y,
                            reduced_motion: false,
                        };
                        assert!(effect_plan(&input).is_ok(), "{id:?}");
                    }
                }
            }
            assert_eq!(
                before,
                serde_json::to_string(&effect_plan(&request(id)).unwrap()).unwrap()
            );
        }
    }
    #[test]
    fn version_one_recipe_identities_are_frozen() {
        // Published recipe data is a compatibility contract, not a snapshot to
        // regenerate when a preset changes. Changes require a new version.
        for (id, expected) in [
            (
                EffectId::LayeredDepth,
                "4ee225471824e2e6a74b082208ec180fa53ea3aff8dd674d8bb2be01aef2e32e",
            ),
            (
                EffectId::RigidTilt,
                "11a000ccf217d0ec1d0ea55cec589deeff80febd433391d9e7016ae01d5da265",
            ),
            (
                EffectId::SharedPlane,
                "55a8ef6974ccae801391a29f2fb8aaae53e74568f06b56707c5476b1ad98c0a5",
            ),
            (
                EffectId::HingedReveal,
                "423eea795de6e726530c1294a04e0faddf156c3490a37d2d6a822d7598455ac6",
            ),
            (
                EffectId::FrostedLens,
                "c4047fb0fb9c0ab6957d212f957b3c86a5477f7872546e1f944743ac4a9c1069",
            ),
        ] {
            assert_eq!(
                effect_plan(&request(id)).unwrap().fingerprint,
                format!("sha256:{expected}")
            );
        }
    }
    #[test]
    fn zero_intensity_removes_builtin_motion_without_changing_structure() {
        for id in effect_catalog(&query())
            .unwrap()
            .effects
            .iter()
            .map(|row| row.id)
        {
            let recipe = effect_recipe(&EffectRecipeInput {
                effect: id,
                version: "1".into(),
                viewport: Size {
                    width: 600.0,
                    height: 400.0,
                },
                intensity: 0.0,
            })
            .unwrap();
            let mut input = EffectPlanInput {
                recipe,
                state: EffectState {
                    progress: 0.0,
                    pointer_x: -1.0,
                    pointer_y: 1.0,
                    reduced_motion: false,
                },
                motion: None,
                expected_fingerprint: None,
            };
            let first = serde_json::to_value(effect_plan(&input).unwrap().frames).unwrap();
            input.state.progress = 1.0;
            input.state.pointer_x = 1.0;
            input.state.pointer_y = -1.0;
            assert_eq!(
                serde_json::to_value(effect_plan(&input).unwrap().frames).unwrap(),
                first,
                "zero intensity must make {id:?} independent of input state"
            );
        }
    }
    #[test]
    fn fingerprint_survives_json_roundtrip_and_detects_recipe_changes() {
        let mut input = request(EffectId::RigidTilt);
        let first = effect_plan(&input).unwrap();
        let original = serde_json::to_string(&input.recipe).unwrap();
        input = serde_json::from_str(&serde_json::to_string(&input).unwrap()).unwrap();
        assert_eq!(original, serde_json::to_string(&input.recipe).unwrap());
        input.expected_fingerprint = Some(first.fingerprint.clone());
        input.state.progress = 0.9;
        assert_eq!(effect_plan(&input).unwrap().fingerprint, first.fingerprint);
        input.recipe.layers[0].tracks[0].to += 0.1;
        assert!(effect_plan(&input).is_err());
    }
    #[test]
    fn signed_zero_and_browser_roundtrip_share_identity() {
        for id in [
            EffectId::LayeredDepth,
            EffectId::RigidTilt,
            EffectId::SharedPlane,
            EffectId::HingedReveal,
            EffectId::FrostedLens,
        ] {
            let mut input = request(id);
            input.recipe.layers[0].offset.x = 0.0;
            let first = effect_plan(&input).unwrap();
            input.recipe.layers[0].offset.x = -0.0;
            assert_eq!(effect_plan(&input).unwrap().fingerprint, first.fingerprint);
            let mut preset = input.recipe.origin.unwrap();
            preset.intensity = -0.0;
            let zero_recipe = effect_recipe(&preset).unwrap();
            assert!(
                !serde_json::to_string(&zero_recipe)
                    .unwrap()
                    .contains("-0.0")
            );
        }
        let mut input = request(EffectId::RigidTilt);
        let EffectSurface::Plane { pose, .. } = &mut input.recipe.layers[0].surface else {
            panic!()
        };
        pose.rotate_x = f64::NAN; // Overridden by a track, but invalid in the saved recipe.
        assert!(effect_plan(&input).is_err());
    }
    #[test]
    fn reduced_motion_is_explicit_and_restores_after_release() {
        let mut input = request(EffectId::HingedReveal);
        let before = effect_plan(&input).unwrap();
        input.state.reduced_motion = true;
        let reduced = effect_plan(&input).unwrap();
        assert_eq!(reduced.state.progress, 1.0);
        let EffectFrameSurface::Window { plan } = &reduced.frames[0].surface else {
            panic!()
        };
        assert_eq!(plan.spec.pose.rotate_y, 0.0);
        input.state.reduced_motion = false;
        assert_eq!(
            serde_json::to_value(before).unwrap(),
            serde_json::to_value(effect_plan(&input).unwrap()).unwrap()
        );
    }
    #[test]
    fn authored_tracks_use_absolute_axes_and_fixed_curve_semantics() {
        let mut input = request(EffectId::RigidTilt);
        input.recipe.layers[0].tracks = vec![EffectTrack {
            property: EffectProperty::TranslateX,
            axis: EffectAxis::PointerX,
            from: -100.0,
            to: 100.0,
            curve: EffectCurve::Smoothstep,
        }];
        input.state.pointer_x = -0.5; // normalized 1/4; smoothstep = 5/32
        let plan = effect_plan(&input).unwrap();
        let EffectFrameSurface::Plane { plan } = &plan.frames[0].surface else {
            panic!()
        };
        assert_eq!(plan.spec.destination.quad.tl.x, -68.75);
        input.recipe.layers[0].tracks[0].curve = EffectCurve::Linear;
        let plan = effect_plan(&input).unwrap();
        let EffectFrameSurface::Plane { plan } = &plan.frames[0].surface else {
            panic!()
        };
        assert_eq!(plan.spec.destination.quad.tl.x, -50.0);
    }
    #[test]
    fn authored_composition_is_supported_but_bad_bindings_and_tracks_fail() {
        let mut input = request(EffectId::RigidTilt);
        let mut next = input.recipe.layers[0].clone();
        next.id = "second".into();
        next.offset.x = 100.0;
        input.recipe.origin = None;
        input.recipe.layers.push(next);
        assert_eq!(effect_plan(&input).unwrap().frames.len(), 2);
        input.recipe.layers[1].id = "content".into();
        assert!(effect_plan(&input).is_err());
        input.recipe.layers.pop();
        let duplicate = input.recipe.layers[0].tracks[0].clone();
        input.recipe.layers[0].tracks.push(duplicate);
        assert!(effect_plan(&input).is_err());
        input.recipe.layers[0].tracks.pop();
        input.recipe.layers[0].tracks[0].property = EffectProperty::FrostBase;
        assert!(effect_plan(&input).is_err());
    }
    #[test]
    fn closed_inputs_nonfinite_and_bounds_do_not_silently_fallback() {
        let mut value = serde_json::to_value(request(EffectId::RigidTilt)).unwrap();
        value["recipe"]["layers"][0]["surface"]["surprise"] = true.into();
        assert!(serde_json::from_value::<EffectPlanInput>(value).is_err());
        let mut input = request(EffectId::RigidTilt);
        input.state.pointer_x = 1.001;
        assert!(effect_plan(&input).is_err());
        input.state.pointer_x = f64::NAN;
        assert!(effect_plan(&input).is_err());
        input.state.pointer_x = 0.0;
        input.recipe.layers = vec![];
        assert!(effect_plan(&input).is_err());
    }
}

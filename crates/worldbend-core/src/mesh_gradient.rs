//! Soft fluid mesh-gradient material, reconciliation and self-contained kernel delivery.
//! Native properties are live values; recipes explain origin, not current state.
//! Editable timing (duration/phase), pause/reduced-motion and independent clocks
//! are owned by receiving bindings; this module owns typed material and delivery.
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{AppearanceInstanceState, ErrorCode, TransformError, TransformResult};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MESH_GRADIENT_SCHEMA: &str = "worldbend.mesh-gradient@0.1";
pub const MESH_GRADIENT_VERSION: &str = "0.1";
pub const MESH_GRADIENT_KERNEL_ID: &str = "worldbend.mesh-gradient.rgba@0.2";
pub const MESH_GRADIENT_KERNEL_SOURCE: &str = include_str!("mesh_gradient.wgsl");
pub const MESH_GRADIENT_METAL_KERNEL_SOURCE: &str = include_str!("mesh_gradient.metal");
pub const MESH_GRADIENT_V1_KERNEL_SOURCE: &str = include_str!("mesh_gradient.v1.wgsl");
pub const MESH_GRADIENT_V1_METAL_KERNEL_SOURCE: &str = include_str!("mesh_gradient.v1.metal");
/// Six vec4 uniforms + two reserved = 128 bytes.
pub const MESH_GRADIENT_UNIFORM_BYTES: u32 = 128;

fn kernel_hash(source: &str) -> String {
    format!(
        "sha256:{}",
        Sha256::digest(source.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}
fn error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn fingerprint(value: &impl Serialize) -> TransformResult<String> {
    fingerprint_json_value(
        &canonical_json_value(value).map_err(|_| error("invalid mesh-gradient state"))?,
    )
    .map_err(|_| error("invalid mesh-gradient state"))
}
fn recipe_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.mesh-gradient@0.1"})
}
fn version_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"0.1"})
}
fn inspection_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.mesh-gradient-inspection@0.1"})
}
fn plan_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.mesh-gradient-delivery@0.1"})
}
fn update_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.mesh-gradient-update@0.1"})
}

/// Encoded sRGB tint and opacity. Interpolation uses premultiplied tint so a
/// fully transparent color does not introduce a colored fringe.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MeshGradientColor {
    #[schemars(range(min = 0.0, max = 1.0))]
    pub r: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub g: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub b: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub a: f64,
}
impl MeshGradientColor {
    fn validate(self) -> TransformResult<()> {
        for value in [self.r, self.g, self.b, self.a] {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(error(
                    "Mesh-gradient RGBA channels must be finite and in [0,1]",
                ));
            }
        }
        Ok(())
    }
    fn differs(self, seed: Self) -> bool {
        [self.r, self.g, self.b, self.a]
            .into_iter()
            .zip([seed.r, seed.g, seed.b, seed.a])
            .any(|(a, b)| differs(a, b))
    }
}
fn differs(live: f64, seed: f64) -> bool {
    live != seed && live != f64::from(seed as f32)
}

/// Soft four-corner mesh with editable loop timing and soft fluid warp.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientMaterial {
    pub visible: bool,
    pub color_tl: MeshGradientColor,
    pub color_tr: MeshGradientColor,
    pub color_bl: MeshGradientColor,
    pub color_br: MeshGradientColor,
    /// Soft fluid domain warp; zero keeps a static bilinear mesh.
    #[schemars(range(min = 0.0, max = 1.0))]
    pub warp: f64,
    /// Corner falloff softness; higher values blend regions like fluid light.
    #[schemars(range(min = 0.0, max = 1.0))]
    pub softness: f64,
    /// Editable loop duration in milliseconds.
    #[schemars(range(min = 100.0, max = 60000.0))]
    pub duration_ms: f64,
    /// Instance phase offset in milliseconds; independent surfaces may differ.
    #[schemars(range(min = 0.0, max = 60000.0))]
    pub phase_ms: f64,
    /// Motion energy inside the loop; zero freezes the fluid field.
    #[schemars(range(min = 0.0, max = 2.0))]
    pub flow_speed: f64,
}
impl Default for MeshGradientMaterial {
    fn default() -> Self {
        Self {
            visible: true,
            color_tl: MeshGradientColor {
                r: 0.18,
                g: 0.42,
                b: 0.92,
                a: 1.0,
            },
            color_tr: MeshGradientColor {
                r: 0.55,
                g: 0.22,
                b: 0.86,
                a: 1.0,
            },
            color_bl: MeshGradientColor {
                r: 0.12,
                g: 0.72,
                b: 0.68,
                a: 1.0,
            },
            color_br: MeshGradientColor {
                r: 0.95,
                g: 0.55,
                b: 0.22,
                a: 1.0,
            },
            warp: 0.35,
            softness: 0.55,
            duration_ms: 8000.0,
            phase_ms: 0.0,
            flow_speed: 0.45,
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, PartialOrd, Ord,
)]
#[serde(rename_all = "kebab-case")]
pub enum MeshGradientField {
    Visible,
    ColorTl,
    ColorTr,
    ColorBl,
    ColorBr,
    Warp,
    Softness,
    DurationMs,
    PhaseMs,
    FlowSpeed,
}
pub const MESH_GRADIENT_FIELDS: [MeshGradientField; 10] = [
    MeshGradientField::Visible,
    MeshGradientField::ColorTl,
    MeshGradientField::ColorTr,
    MeshGradientField::ColorBl,
    MeshGradientField::ColorBr,
    MeshGradientField::Warp,
    MeshGradientField::Softness,
    MeshGradientField::DurationMs,
    MeshGradientField::PhaseMs,
    MeshGradientField::FlowSpeed,
];
impl MeshGradientMaterial {
    pub fn validate(self) -> TransformResult<()> {
        self.color_tl.validate()?;
        self.color_tr.validate()?;
        self.color_bl.validate()?;
        self.color_br.validate()?;
        for (value, min, max, name) in [
            (self.warp, 0.0, 1.0, "warp"),
            (self.softness, 0.0, 1.0, "softness"),
            (self.duration_ms, 100.0, 60_000.0, "durationMs"),
            (self.phase_ms, 0.0, 60_000.0, "phaseMs"),
            (self.flow_speed, 0.0, 2.0, "flowSpeed"),
        ] {
            if !value.is_finite() || !(min..=max).contains(&value) {
                return Err(error(format!("{name} must be finite and in [{min},{max}]")));
            }
        }
        Ok(())
    }
    pub fn changed_fields(self, seed: Self) -> Vec<MeshGradientField> {
        MESH_GRADIENT_FIELDS
            .into_iter()
            .filter(|field| match field {
                MeshGradientField::Visible => self.visible != seed.visible,
                MeshGradientField::ColorTl => self.color_tl.differs(seed.color_tl),
                MeshGradientField::ColorTr => self.color_tr.differs(seed.color_tr),
                MeshGradientField::ColorBl => self.color_bl.differs(seed.color_bl),
                MeshGradientField::ColorBr => self.color_br.differs(seed.color_br),
                MeshGradientField::Warp => differs(self.warp, seed.warp),
                MeshGradientField::Softness => differs(self.softness, seed.softness),
                MeshGradientField::DurationMs => differs(self.duration_ms, seed.duration_ms),
                MeshGradientField::PhaseMs => differs(self.phase_ms, seed.phase_ms),
                MeshGradientField::FlowSpeed => differs(self.flow_speed, seed.flow_speed),
            })
            .collect()
    }
}
fn merge(
    mut next: MeshGradientMaterial,
    live: MeshGradientMaterial,
    fields: &[MeshGradientField],
) -> MeshGradientMaterial {
    for field in fields {
        match field {
            MeshGradientField::Visible => next.visible = live.visible,
            MeshGradientField::ColorTl => next.color_tl = live.color_tl,
            MeshGradientField::ColorTr => next.color_tr = live.color_tr,
            MeshGradientField::ColorBl => next.color_bl = live.color_bl,
            MeshGradientField::ColorBr => next.color_br = live.color_br,
            MeshGradientField::Warp => next.warp = live.warp,
            MeshGradientField::Softness => next.softness = live.softness,
            MeshGradientField::DurationMs => next.duration_ms = live.duration_ms,
            MeshGradientField::PhaseMs => next.phase_ms = live.phase_ms,
            MeshGradientField::FlowSpeed => next.flow_speed = live.flow_speed,
        }
    }
    next
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientRecipeSpec {
    #[schemars(schema_with = "recipe_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = 64))]
    pub recipe_id: String,
    #[schemars(range(min = 1))]
    pub recipe_version: u32,
    pub material: MeshGradientMaterial,
}
impl MeshGradientRecipeSpec {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != MESH_GRADIENT_SCHEMA
            || self.version != MESH_GRADIENT_VERSION
            || self.recipe_id.trim().is_empty()
            || self.recipe_id.chars().count() > 64
            || self.recipe_id.chars().any(char::is_control)
            || self.recipe_version == 0
        {
            return Err(error(
                "Mesh-gradient recipe needs worldbend.mesh-gradient@0.1, recipeId of 1..64 characters, and recipeVersion >= 1",
            ));
        }
        self.material.validate()
    }
    pub fn fingerprint(&self) -> TransformResult<String> {
        self.validate()?;
        fingerprint(self)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientInspectionInput {
    pub recipe: MeshGradientRecipeSpec,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<MeshGradientMaterial>,
    #[serde(default)]
    pub tagged: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeshGradientInspection {
    #[schemars(schema_with = "inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: MeshGradientMaterial,
    pub state: AppearanceInstanceState,
    pub customized: Vec<MeshGradientField>,
}
pub fn inspect_mesh_gradient(
    input: &MeshGradientInspectionInput,
) -> TransformResult<MeshGradientInspection> {
    input.recipe.validate()?;
    if let Some(live) = input.live {
        live.validate()?;
    }
    let customized = if input.tagged {
        input
            .live
            .map(|live| live.changed_fields(input.recipe.material))
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let state = match (input.live.is_some(), input.tagged) {
        (true, true) => {
            if customized.is_empty() {
                AppearanceInstanceState::Tagged
            } else {
                AppearanceInstanceState::Customized
            }
        }
        (true, false) => AppearanceInstanceState::UntaggedNative,
        (false, true) => AppearanceInstanceState::Removed,
        (false, false) => AppearanceInstanceState::Absent,
    };
    Ok(MeshGradientInspection {
        schema: "worldbend.mesh-gradient-inspection@0.1".into(),
        version: MESH_GRADIENT_VERSION.into(),
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint: input.recipe.fingerprint()?,
        material: input.live.unwrap_or(input.recipe.material),
        state,
        customized,
    })
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientRevisionInput {
    pub previous: MeshGradientRecipeSpec,
    pub next: MeshGradientRecipeSpec,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<MeshGradientMaterial>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeshGradientRevisionPlan {
    pub recipe: MeshGradientRecipeSpec,
    pub material: Option<MeshGradientMaterial>,
    pub preserved: Vec<MeshGradientField>,
}
pub fn plan_mesh_gradient_revision(
    input: &MeshGradientRevisionInput,
) -> TransformResult<MeshGradientRevisionPlan> {
    input.previous.validate()?;
    input.next.validate()?;
    if input.previous.recipe_id != input.next.recipe_id
        || input.next.recipe_version <= input.previous.recipe_version
    {
        return Err(error(
            "Mesh-gradient seed upgrade needs the same recipeId and newer recipeVersion",
        ));
    }
    if let Some(live) = input.live {
        live.validate()?;
    }
    let preserved = input
        .live
        .map(|live| live.changed_fields(input.previous.material))
        .unwrap_or_default();
    Ok(MeshGradientRevisionPlan {
        recipe: input.next.clone(),
        material: input
            .live
            .map(|live| merge(input.next.material, live, &preserved)),
        preserved,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MeshGradientDeliveryTarget {
    Web,
    Swiftui,
}
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum MeshGradientKernelProfile {
    #[serde(rename = "worldbend.mesh-gradient.rgba@0.1")]
    LinearV1,
    #[default]
    #[serde(rename = "worldbend.mesh-gradient.rgba@0.2")]
    LoopV2,
}
impl MeshGradientKernelProfile {
    fn id(self) -> &'static str {
        match self {
            Self::LinearV1 => "worldbend.mesh-gradient.rgba@0.1",
            Self::LoopV2 => MESH_GRADIENT_KERNEL_ID,
        }
    }
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeshGradientKernelResource {
    pub id: String,
    pub sha256: String,
    pub source: String,
    pub uniform_bytes: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientDeliveryInput {
    pub recipe: MeshGradientRecipeSpec,
    pub material: MeshGradientMaterial,
    pub target: MeshGradientDeliveryTarget,
    #[serde(default)]
    pub kernel_profile: MeshGradientKernelProfile,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeshGradientDeliveryPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub fingerprint: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: MeshGradientMaterial,
    pub target: MeshGradientDeliveryTarget,
    pub kernel: MeshGradientKernelResource,
}
pub fn plan_mesh_gradient_delivery(
    input: &MeshGradientDeliveryInput,
) -> TransformResult<MeshGradientDeliveryPlan> {
    input.recipe.validate()?;
    input.material.validate()?;
    let recipe_fingerprint = input.recipe.fingerprint()?;
    let source = match (input.kernel_profile, input.target) {
        (MeshGradientKernelProfile::LoopV2, MeshGradientDeliveryTarget::Web) => {
            MESH_GRADIENT_KERNEL_SOURCE
        }
        (MeshGradientKernelProfile::LoopV2, MeshGradientDeliveryTarget::Swiftui) => {
            MESH_GRADIENT_METAL_KERNEL_SOURCE
        }
        (MeshGradientKernelProfile::LinearV1, MeshGradientDeliveryTarget::Web) => {
            MESH_GRADIENT_V1_KERNEL_SOURCE
        }
        (MeshGradientKernelProfile::LinearV1, MeshGradientDeliveryTarget::Swiftui) => {
            MESH_GRADIENT_V1_METAL_KERNEL_SOURCE
        }
    };
    let sha256 = kernel_hash(source);
    let state = serde_json::json!({
        "schema":"worldbend.mesh-gradient-delivery@0.1",
        "version":MESH_GRADIENT_VERSION,
        "recipeFingerprint":recipe_fingerprint,
        "material":input.material,
        "target":input.target,
        "kernelId":input.kernel_profile.id(),
        "kernelSha256":sha256
    });
    Ok(MeshGradientDeliveryPlan {
        schema: "worldbend.mesh-gradient-delivery@0.1".into(),
        version: MESH_GRADIENT_VERSION.into(),
        fingerprint: fingerprint(&state)?,
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint,
        material: input.material,
        target: input.target,
        kernel: MeshGradientKernelResource {
            id: input.kernel_profile.id().into(),
            sha256,
            source: source.into(),
            uniform_bytes: MESH_GRADIENT_UNIFORM_BYTES,
        },
    })
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshGradientUpdateInput {
    pub previous: MeshGradientDeliveryInput,
    pub next: MeshGradientDeliveryInput,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<MeshGradientMaterial>,
    pub expected_fingerprint: String,
}
fn required_live<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<MeshGradientMaterial>, D::Error> {
    Option::<MeshGradientMaterial>::deserialize(deserializer)
}
fn live_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<MeshGradientMaterial> as JsonSchema>::json_schema(generator)
}
fn delivery_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<MeshGradientDeliveryPlan> as JsonSchema>::json_schema(generator)
}
fn fingerprint_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<String> as JsonSchema>::json_schema(generator)
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MeshGradientUpdatePlan {
    #[schemars(schema_with = "update_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub previous_fingerprint: String,
    #[schemars(schema_with = "fingerprint_schema")]
    pub previous_delivery_fingerprint: Option<String>,
    pub source_fingerprint: String,
    #[schemars(schema_with = "delivery_schema")]
    pub delivery: Option<MeshGradientDeliveryPlan>,
    pub preserved: Vec<MeshGradientField>,
}
pub fn plan_mesh_gradient_update(
    input: &MeshGradientUpdateInput,
) -> TransformResult<MeshGradientUpdatePlan> {
    let previous = plan_mesh_gradient_delivery(&input.previous)?;
    let next = plan_mesh_gradient_delivery(&input.next)?;
    if input.expected_fingerprint != previous.fingerprint {
        return Err(error(
            "Mesh-gradient source changed; reread the accepted delivery",
        ));
    }
    if input.previous.target != input.next.target
        || input.previous.recipe.recipe_id != input.next.recipe.recipe_id
        || input.next.recipe.recipe_version < input.previous.recipe.recipe_version
        || (input.next.recipe.recipe_version == input.previous.recipe.recipe_version
            && previous.recipe_fingerprint != next.recipe_fingerprint)
    {
        return Err(error(
            "Mesh-gradient update needs the same recipe and target; seed changes need a newer version",
        ));
    }
    if let Some(live) = input.live {
        live.validate()?;
    }
    let preserved = input
        .live
        .map(|live| live.changed_fields(input.previous.material))
        .unwrap_or_default();
    let previous_delivery_fingerprint = input
        .live
        .map(|material| {
            plan_mesh_gradient_delivery(&MeshGradientDeliveryInput {
                material,
                ..input.previous.clone()
            })
            .map(|plan| plan.fingerprint)
        })
        .transpose()?;
    let delivery = input
        .live
        .map(|live| {
            plan_mesh_gradient_delivery(&MeshGradientDeliveryInput {
                material: merge(input.next.material, live, &preserved),
                ..input.next.clone()
            })
        })
        .transpose()?;
    Ok(MeshGradientUpdatePlan {
        schema: "worldbend.mesh-gradient-update@0.1".into(),
        version: MESH_GRADIENT_VERSION.into(),
        previous_fingerprint: previous.fingerprint,
        previous_delivery_fingerprint,
        source_fingerprint: next.fingerprint,
        delivery,
        preserved,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn frozen_profile_reconstructs_old_receipts_and_explicit_upgrade_keeps_local_values() {
        let mut previous = MeshGradientDeliveryInput {
            recipe: recipe(),
            material: MeshGradientMaterial::default(),
            target: MeshGradientDeliveryTarget::Web,
            kernel_profile: MeshGradientKernelProfile::LinearV1,
        };
        let old = plan_mesh_gradient_delivery(&previous).unwrap();
        assert_eq!(old.kernel.id, "worldbend.mesh-gradient.rgba@0.1");
        assert_eq!(
            old.kernel.sha256,
            "sha256:ad079f0f3abe8cb33db40842e34a1f7758ce32184f1839854c21ecf3d12bd6a6"
        );
        let roundtrip: MeshGradientDeliveryInput =
            serde_json::from_value(serde_json::to_value(&previous).unwrap()).unwrap();
        assert_eq!(
            plan_mesh_gradient_delivery(&roundtrip).unwrap().fingerprint,
            old.fingerprint
        );
        let mut next = previous.clone();
        next.kernel_profile = MeshGradientKernelProfile::LoopV2;
        let mut live = previous.material;
        live.phase_ms = 3400.0;
        live.color_tr.a = 0.4;
        let updated = plan_mesh_gradient_update(&MeshGradientUpdateInput {
            previous: previous.clone(),
            next,
            live: Some(live),
            expected_fingerprint: old.fingerprint,
        })
        .unwrap();
        assert_eq!(
            updated.delivery.as_ref().unwrap().kernel.id,
            MESH_GRADIENT_KERNEL_ID
        );
        assert_eq!(updated.delivery.unwrap().material, live);
        previous.target = MeshGradientDeliveryTarget::Swiftui;
        assert_eq!(
            plan_mesh_gradient_delivery(&previous)
                .unwrap()
                .kernel
                .sha256,
            "sha256:0d05e7dde510e0a93b50ec2a8b64fda317d3c0f3713297b8fa924ce1086ca926"
        );
    }
    #[test]
    fn swiftui_delivery_uses_generated_metal_and_retains_local_timing() {
        let previous = MeshGradientDeliveryInput {
            recipe: recipe(),
            material: MeshGradientMaterial::default(),
            target: MeshGradientDeliveryTarget::Swiftui,
            kernel_profile: MeshGradientKernelProfile::default(),
        };
        let first = plan_mesh_gradient_delivery(&previous).unwrap();
        assert_eq!(first.kernel.source, MESH_GRADIENT_METAL_KERNEL_SOURCE);
        assert_eq!(
            first.kernel.sha256,
            kernel_hash(MESH_GRADIENT_METAL_KERNEL_SOURCE)
        );
        let web = plan_mesh_gradient_delivery(&MeshGradientDeliveryInput {
            target: MeshGradientDeliveryTarget::Web,
            kernel_profile: MeshGradientKernelProfile::default(),
            ..previous.clone()
        })
        .unwrap();
        assert_eq!(web.kernel.source, MESH_GRADIENT_KERNEL_SOURCE);
        assert_ne!(first.fingerprint, web.fingerprint);
        let mut next = previous.clone();
        next.material.warp = 0.8;
        let mut live = previous.material;
        live.phase_ms = 2400.0;
        let mut input = MeshGradientUpdateInput {
            previous,
            next,
            live: Some(live),
            expected_fingerprint: first.fingerprint,
        };
        let update = plan_mesh_gradient_update(&input).unwrap();
        assert_eq!(update.preserved, vec![MeshGradientField::PhaseMs]);
        assert_eq!(update.delivery.unwrap().material.phase_ms, 2400.0);
        input.next.target = MeshGradientDeliveryTarget::Web;
        assert!(plan_mesh_gradient_update(&input).is_err());
    }
    fn recipe() -> MeshGradientRecipeSpec {
        MeshGradientRecipeSpec {
            schema: MESH_GRADIENT_SCHEMA.into(),
            version: MESH_GRADIENT_VERSION.into(),
            recipe_id: "soft-fluid".into(),
            recipe_version: 1,
            material: MeshGradientMaterial::default(),
        }
    }
    #[test]
    fn native_float32_is_seed_but_timing_edit_is_customization() {
        let recipe = recipe();
        let mut live = recipe.material;
        live.warp = f64::from(live.warp as f32);
        live.softness = f64::from(live.softness as f32);
        assert!(live.changed_fields(recipe.material).is_empty());
        live.duration_ms = 12000.0;
        live.phase_ms = 1500.0;
        let inspected = inspect_mesh_gradient(&MeshGradientInspectionInput {
            recipe,
            live: Some(live),
            tagged: true,
        })
        .unwrap();
        assert_eq!(
            inspected.customized,
            vec![MeshGradientField::DurationMs, MeshGradientField::PhaseMs]
        );
        assert_eq!(inspected.material.duration_ms, 12000.0);
    }
    #[test]
    fn seed_upgrade_preserves_local_timing_warp_and_removal() {
        let previous = recipe();
        let mut next = previous.clone();
        next.recipe_version = 2;
        next.material.softness = 0.8;
        let mut live = previous.material;
        live.flow_speed = 0.0;
        live.duration_ms = 5000.0;
        live.phase_ms = 900.0;
        let mut input = MeshGradientRevisionInput {
            previous,
            next,
            live: Some(live),
        };
        let plan = plan_mesh_gradient_revision(&input).unwrap();
        assert_eq!(
            plan.preserved,
            vec![
                MeshGradientField::DurationMs,
                MeshGradientField::PhaseMs,
                MeshGradientField::FlowSpeed
            ]
        );
        assert_eq!(plan.material.unwrap().softness, 0.8);
        assert_eq!(plan.material.unwrap().flow_speed, 0.0);
        input.live = None;
        assert!(
            plan_mesh_gradient_revision(&input)
                .unwrap()
                .material
                .is_none()
        );
    }
    #[test]
    fn later_update_preserves_destination_edits_and_rejects_stale() {
        let previous = MeshGradientDeliveryInput {
            recipe: recipe(),
            material: MeshGradientMaterial::default(),
            target: MeshGradientDeliveryTarget::Web,
            kernel_profile: MeshGradientKernelProfile::default(),
        };
        let mut next = previous.clone();
        next.material.warp = 0.7;
        let mut live = previous.material;
        live.phase_ms = 2500.0;
        live.color_tl.a = 0.5;
        let mut input = MeshGradientUpdateInput {
            expected_fingerprint: plan_mesh_gradient_delivery(&previous).unwrap().fingerprint,
            previous,
            next,
            live: Some(live),
        };
        let plan = plan_mesh_gradient_update(&input).unwrap();
        let delivery = plan.delivery.unwrap();
        assert_eq!(delivery.material.warp, 0.7);
        assert_eq!(delivery.material.phase_ms, 2500.0);
        assert_eq!(delivery.material.color_tl.a, 0.5);
        assert_eq!(
            plan.preserved,
            vec![MeshGradientField::ColorTl, MeshGradientField::PhaseMs]
        );
        input.expected_fingerprint = "sha256:stale".into();
        assert!(plan_mesh_gradient_update(&input).is_err());
        input.expected_fingerprint = plan.previous_fingerprint;
        input.live = None;
        let removal = plan_mesh_gradient_update(&input).unwrap();
        assert!(removal.delivery.is_none());
        let mut value = serde_json::to_value(input.previous).unwrap();
        value["material"]["durationMs"] = serde_json::json!(50.0);
        assert!(plan_mesh_gradient_delivery(&serde_json::from_value(value).unwrap()).is_err());
    }
    #[test]
    fn kernel_mixes_premultiplied_corner_colors() {
        assert!(
            MESH_GRADIENT_KERNEL_SOURCE.contains("u.colorTl.rgb * u.colorTl.a"),
            "mesh-gradient kernel must mix premultiplied corner tints"
        );
        assert!(
            !MESH_GRADIENT_KERNEL_SOURCE.contains("let top = mix(u.colorTl, u.colorTr, sx);"),
            "mesh-gradient kernel must not mix straight RGBA corners"
        );
    }
    #[test]
    fn update_requires_explicit_live_and_kernel_is_bound_to_delivery() {
        let previous = MeshGradientDeliveryInput {
            recipe: recipe(),
            material: MeshGradientMaterial::default(),
            target: MeshGradientDeliveryTarget::Web,
            kernel_profile: MeshGradientKernelProfile::default(),
        };
        assert!(
            serde_json::from_value::<MeshGradientUpdateInput>(serde_json::json!({
                "previous":previous,"next":previous,"expectedFingerprint":"x"
            }))
            .is_err()
        );
        let plan = plan_mesh_gradient_delivery(&previous).unwrap();
        assert_eq!(plan.kernel.uniform_bytes, MESH_GRADIENT_UNIFORM_BYTES);
        assert!(plan.kernel.source.contains("Soft fluid"));
        assert_eq!(plan.kernel.sha256, kernel_hash(&plan.kernel.source));
        let mut changed = previous;
        changed.material.phase_ms = 100.0;
        assert_ne!(
            plan.fingerprint,
            plan_mesh_gradient_delivery(&changed).unwrap().fingerprint
        );
    }
}

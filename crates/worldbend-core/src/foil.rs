//! Procedural Foil material, reconciliation and self-contained kernel delivery.
//! Native properties are live values; recipes explain origin, not current state.
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{AppearanceInstanceState, ErrorCode, TransformError, TransformResult};
use schemars::{JsonSchema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const FOIL_SCHEMA: &str = "worldbend.foil@0.1";
pub const FOIL_VERSION: &str = "0.1";
pub const FOIL_KERNEL_ID: &str = "worldbend.foil.rgba@0.1";
pub const FOIL_KERNEL_SOURCE: &str = include_str!("foil.wgsl");
pub const FOIL_METAL_KERNEL_SOURCE: &str = include_str!("foil.metal");
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
    fingerprint_json_value(&canonical_json_value(value).map_err(|_| error("invalid Foil state"))?)
        .map_err(|_| error("invalid Foil state"))
}
fn recipe_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.foil@0.1"})
}
fn version_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"0.1"})
}

fn inspection_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.foil-inspection@0.1"})
}
fn plan_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.foil-delivery@0.1"})
}
fn update_schema(_: &mut SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":"worldbend.foil-update@0.1"})
}

/// Encoded sRGB tint and opacity. Interpolation uses premultiplied tint so a
/// fully transparent color does not introduce a colored fringe.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FoilColor {
    #[schemars(range(min = 0.0, max = 1.0))]
    pub r: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub g: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub b: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub a: f64,
}
impl FoilColor {
    fn validate(self) -> TransformResult<()> {
        for value in [self.r, self.g, self.b, self.a] {
            if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                return Err(error("Foil RGBA channels must be finite and in [0,1]"));
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

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FoilMaterial {
    pub visible: bool,
    pub base_color: FoilColor,
    pub highlight_color: FoilColor,
    #[schemars(range(min = 0.0, max = 360.0))]
    pub light_angle: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub intensity: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub roughness: f64,
    /// Flow multiplier; frame time is milliseconds in every host.
    #[schemars(range(min = 0.0, max = 2.0))]
    pub flow_speed: f64,
}
impl Default for FoilMaterial {
    fn default() -> Self {
        Self {
            visible: true,
            base_color: FoilColor {
                r: 0.72,
                g: 0.71,
                b: 0.68,
                a: 1.0,
            },
            highlight_color: FoilColor {
                r: 0.98,
                g: 0.92,
                b: 0.78,
                a: 1.0,
            },
            light_angle: 120.0,
            intensity: 0.6,
            roughness: 0.45,
            flow_speed: 0.25,
        }
    }
}
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, PartialOrd, Ord,
)]
#[serde(rename_all = "kebab-case")]
pub enum FoilField {
    Visible,
    BaseColor,
    HighlightColor,
    LightAngle,
    Intensity,
    Roughness,
    FlowSpeed,
}
pub const FOIL_FIELDS: [FoilField; 7] = [
    FoilField::Visible,
    FoilField::BaseColor,
    FoilField::HighlightColor,
    FoilField::LightAngle,
    FoilField::Intensity,
    FoilField::Roughness,
    FoilField::FlowSpeed,
];
impl FoilMaterial {
    pub fn validate(self) -> TransformResult<()> {
        self.base_color.validate()?;
        self.highlight_color.validate()?;
        for (value, max, name) in [
            (self.light_angle, 360.0, "lightAngle"),
            (self.intensity, 1.0, "intensity"),
            (self.roughness, 1.0, "roughness"),
            (self.flow_speed, 2.0, "flowSpeed"),
        ] {
            if !value.is_finite() || !(0.0..=max).contains(&value) {
                return Err(error(format!("{name} must be finite and in [0,{max}]")));
            }
        }
        Ok(())
    }
    pub fn changed_fields(self, seed: Self) -> Vec<FoilField> {
        FOIL_FIELDS
            .into_iter()
            .filter(|field| match field {
                FoilField::Visible => self.visible != seed.visible,
                FoilField::BaseColor => self.base_color.differs(seed.base_color),
                FoilField::HighlightColor => self.highlight_color.differs(seed.highlight_color),
                FoilField::LightAngle => differs(self.light_angle, seed.light_angle),
                FoilField::Intensity => differs(self.intensity, seed.intensity),
                FoilField::Roughness => differs(self.roughness, seed.roughness),
                FoilField::FlowSpeed => differs(self.flow_speed, seed.flow_speed),
            })
            .collect()
    }
}
fn merge(mut next: FoilMaterial, live: FoilMaterial, fields: &[FoilField]) -> FoilMaterial {
    for field in fields {
        match field {
            FoilField::Visible => next.visible = live.visible,
            FoilField::BaseColor => next.base_color = live.base_color,
            FoilField::HighlightColor => next.highlight_color = live.highlight_color,
            FoilField::LightAngle => next.light_angle = live.light_angle,
            FoilField::Intensity => next.intensity = live.intensity,
            FoilField::Roughness => next.roughness = live.roughness,
            FoilField::FlowSpeed => next.flow_speed = live.flow_speed,
        }
    }
    next
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FoilRecipeSpec {
    #[schemars(schema_with = "recipe_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = 64))]
    pub recipe_id: String,
    #[schemars(range(min = 1))]
    pub recipe_version: u32,
    pub material: FoilMaterial,
}
impl FoilRecipeSpec {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != FOIL_SCHEMA
            || self.version != FOIL_VERSION
            || self.recipe_id.trim().is_empty()
            || self.recipe_id.chars().count() > 64
            || self.recipe_id.chars().any(char::is_control)
            || self.recipe_version == 0
        {
            return Err(error(
                "Foil recipe needs worldbend.foil@0.1, recipeId of 1..64 characters, and recipeVersion >= 1",
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
pub struct FoilInspectionInput {
    pub recipe: FoilRecipeSpec,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<FoilMaterial>,
    #[serde(default)]
    pub tagged: bool,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoilInspection {
    #[schemars(schema_with = "inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: FoilMaterial,
    pub state: AppearanceInstanceState,
    pub customized: Vec<FoilField>,
}
pub fn inspect_foil(input: &FoilInspectionInput) -> TransformResult<FoilInspection> {
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
    Ok(FoilInspection {
        schema: "worldbend.foil-inspection@0.1".into(),
        version: FOIL_VERSION.into(),
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
pub struct FoilRevisionInput {
    pub previous: FoilRecipeSpec,
    pub next: FoilRecipeSpec,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<FoilMaterial>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoilRevisionPlan {
    pub recipe: FoilRecipeSpec,
    pub material: Option<FoilMaterial>,
    pub preserved: Vec<FoilField>,
}
pub fn plan_foil_revision(input: &FoilRevisionInput) -> TransformResult<FoilRevisionPlan> {
    input.previous.validate()?;
    input.next.validate()?;
    if input.previous.recipe_id != input.next.recipe_id
        || input.next.recipe_version <= input.previous.recipe_version
    {
        return Err(error(
            "Foil seed upgrade needs the same recipeId and newer recipeVersion",
        ));
    }
    if let Some(live) = input.live {
        live.validate()?;
    }
    let preserved = input
        .live
        .map(|live| live.changed_fields(input.previous.material))
        .unwrap_or_default();
    Ok(FoilRevisionPlan {
        recipe: input.next.clone(),
        material: input
            .live
            .map(|live| merge(input.next.material, live, &preserved)),
        preserved,
    })
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FoilDeliveryTarget {
    Web,
    Swiftui,
}
/// Obtainable, immutable implementation; no account-owned asset is needed by
/// a receiver. Source is bundled into the delivery and checked by the binding.
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoilKernelResource {
    pub id: String,
    pub sha256: String,
    pub source: String,
    pub uniform_bytes: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FoilDeliveryInput {
    pub recipe: FoilRecipeSpec,
    pub material: FoilMaterial,
    pub target: FoilDeliveryTarget,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoilDeliveryPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub fingerprint: String,
    pub recipe_id: String,
    pub recipe_version: u32,
    pub recipe_fingerprint: String,
    pub material: FoilMaterial,
    pub target: FoilDeliveryTarget,
    pub kernel: FoilKernelResource,
}
pub fn plan_foil_delivery(input: &FoilDeliveryInput) -> TransformResult<FoilDeliveryPlan> {
    input.recipe.validate()?;
    input.material.validate()?;
    let recipe_fingerprint = input.recipe.fingerprint()?;
    let source = match input.target {
        FoilDeliveryTarget::Web => FOIL_KERNEL_SOURCE,
        FoilDeliveryTarget::Swiftui => FOIL_METAL_KERNEL_SOURCE,
    };
    let sha256 = kernel_hash(source);
    let state = serde_json::json!({"schema":"worldbend.foil-delivery@0.1","version":FOIL_VERSION,"recipeFingerprint":recipe_fingerprint,"material":input.material,"target":input.target,"kernelId":FOIL_KERNEL_ID,"kernelSha256":sha256});
    Ok(FoilDeliveryPlan {
        schema: "worldbend.foil-delivery@0.1".into(),
        version: FOIL_VERSION.into(),
        fingerprint: fingerprint(&state)?,
        recipe_id: input.recipe.recipe_id.clone(),
        recipe_version: input.recipe.recipe_version,
        recipe_fingerprint,
        material: input.material,
        target: input.target,
        kernel: FoilKernelResource {
            id: FOIL_KERNEL_ID.into(),
            sha256,
            source: source.into(),
            uniform_bytes: 96,
        },
    })
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FoilUpdateInput {
    pub previous: FoilDeliveryInput,
    pub next: FoilDeliveryInput,
    #[serde(deserialize_with = "required_live")]
    #[schemars(schema_with = "live_schema")]
    pub live: Option<FoilMaterial>,
    pub expected_fingerprint: String,
}
fn required_live<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<FoilMaterial>, D::Error> {
    Option::<FoilMaterial>::deserialize(deserializer)
}
fn live_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<FoilMaterial> as JsonSchema>::json_schema(generator)
}
fn delivery_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<FoilDeliveryPlan> as JsonSchema>::json_schema(generator)
}
fn fingerprint_schema(generator: &mut SchemaGenerator) -> schemars::Schema {
    <Option<String> as JsonSchema>::json_schema(generator)
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoilUpdatePlan {
    #[schemars(schema_with = "update_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub previous_fingerprint: String,
    #[schemars(schema_with = "fingerprint_schema")]
    pub previous_delivery_fingerprint: Option<String>,
    pub source_fingerprint: String,
    #[schemars(schema_with = "delivery_schema")]
    pub delivery: Option<FoilDeliveryPlan>,
    pub preserved: Vec<FoilField>,
}
pub fn plan_foil_update(input: &FoilUpdateInput) -> TransformResult<FoilUpdatePlan> {
    let previous = plan_foil_delivery(&input.previous)?;
    let next = plan_foil_delivery(&input.next)?;
    if input.expected_fingerprint != previous.fingerprint {
        return Err(error("Foil source changed; reread the accepted delivery"));
    }
    if input.previous.target != input.next.target
        || input.previous.recipe.recipe_id != input.next.recipe.recipe_id
        || input.next.recipe.recipe_version < input.previous.recipe.recipe_version
        || (input.next.recipe.recipe_version == input.previous.recipe.recipe_version
            && previous.recipe_fingerprint != next.recipe_fingerprint)
    {
        return Err(error(
            "Foil update needs the same recipe and target; seed changes need a newer version",
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
            plan_foil_delivery(&FoilDeliveryInput {
                material,
                ..input.previous.clone()
            })
            .map(|plan| plan.fingerprint)
        })
        .transpose()?;
    let delivery = input
        .live
        .map(|live| {
            plan_foil_delivery(&FoilDeliveryInput {
                material: merge(input.next.material, live, &preserved),
                ..input.next.clone()
            })
        })
        .transpose()?;
    Ok(FoilUpdatePlan {
        schema: "worldbend.foil-update@0.1".into(),
        version: FOIL_VERSION.into(),
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
    fn swiftui_delivery_uses_generated_metal_and_retains_update_guards() {
        let previous = FoilDeliveryInput {
            recipe: recipe(),
            material: FoilMaterial::default(),
            target: FoilDeliveryTarget::Swiftui,
        };
        let first = plan_foil_delivery(&previous).unwrap();
        assert_eq!(first.kernel.source, FOIL_METAL_KERNEL_SOURCE);
        assert_eq!(first.kernel.sha256, kernel_hash(FOIL_METAL_KERNEL_SOURCE));
        assert!(first.kernel.source.contains("worldbend_foil_fs_main"));
        let web = plan_foil_delivery(&FoilDeliveryInput {
            target: FoilDeliveryTarget::Web,
            ..previous.clone()
        })
        .unwrap();
        assert_eq!(web.kernel.source, FOIL_KERNEL_SOURCE);
        assert_ne!(first.fingerprint, web.fingerprint);
        let mut next = previous.clone();
        next.material.intensity = 0.9;
        let mut live = previous.material;
        live.roughness = 0.8;
        let mut input = FoilUpdateInput {
            previous,
            next,
            live: Some(live),
            expected_fingerprint: first.fingerprint,
        };
        let update = plan_foil_update(&input).unwrap();
        assert_eq!(update.preserved, vec![FoilField::Roughness]);
        assert_eq!(update.delivery.unwrap().material.intensity, 0.9);
        input.next.target = FoilDeliveryTarget::Web;
        assert!(plan_foil_update(&input).is_err());
    }
    fn recipe() -> FoilRecipeSpec {
        FoilRecipeSpec {
            schema: FOIL_SCHEMA.into(),
            version: FOIL_VERSION.into(),
            recipe_id: "brand-metal".into(),
            recipe_version: 1,
            material: FoilMaterial::default(),
        }
    }
    #[test]
    fn native_float32_is_seed_but_alpha_edit_is_customization() {
        let recipe = recipe();
        let mut live = recipe.material;
        live.base_color.r = f64::from(live.base_color.r as f32);
        live.roughness = f64::from(live.roughness as f32);
        assert!(live.changed_fields(recipe.material).is_empty());
        live.highlight_color.a = 0.4;
        let inspected = inspect_foil(&FoilInspectionInput {
            recipe,
            live: Some(live),
            tagged: true,
        })
        .unwrap();
        assert_eq!(inspected.customized, vec![FoilField::HighlightColor]);
        assert_eq!(inspected.material.highlight_color.a, 0.4);
    }
    #[test]
    fn seed_upgrade_preserves_local_color_motion_and_removal() {
        let previous = recipe();
        let mut next = previous.clone();
        next.recipe_version = 2;
        next.material.intensity = 0.8;
        let mut live = previous.material;
        live.flow_speed = 0.0;
        live.base_color.a = 0.5;
        let mut input = FoilRevisionInput {
            previous,
            next,
            live: Some(live),
        };
        let plan = plan_foil_revision(&input).unwrap();
        assert_eq!(
            plan.preserved,
            vec![FoilField::BaseColor, FoilField::FlowSpeed]
        );
        assert_eq!(plan.material.unwrap().intensity, 0.8);
        assert_eq!(plan.material.unwrap().flow_speed, 0.0);
        input.live = None;
        assert!(plan_foil_revision(&input).unwrap().material.is_none());
    }
    #[test]
    fn later_native_update_preserves_destination_edits_and_rejects_stale() {
        let previous = FoilDeliveryInput {
            recipe: recipe(),
            material: FoilMaterial::default(),
            target: FoilDeliveryTarget::Web,
        };
        let mut next = previous.clone();
        next.material.intensity = 0.9;
        let mut live = previous.material;
        live.roughness = 0.0;
        live.highlight_color.a = 0.5;
        let mut input = FoilUpdateInput {
            expected_fingerprint: plan_foil_delivery(&previous).unwrap().fingerprint,
            previous,
            next,
            live: Some(live),
        };
        let plan = plan_foil_update(&input).unwrap();
        let delivery = plan.delivery.unwrap();
        assert_eq!(delivery.material.intensity, 0.9);
        assert_eq!(delivery.material.highlight_color.a, 0.5);
        assert_eq!(
            plan.preserved,
            vec![FoilField::HighlightColor, FoilField::Roughness]
        );
        assert_ne!(delivery.fingerprint, plan.source_fingerprint);
        input.expected_fingerprint = "sha256:stale".into();
        assert!(plan_foil_update(&input).is_err());
        input.expected_fingerprint = plan.previous_fingerprint;
        input.live = None;
        let removal = plan_foil_update(&input).unwrap();
        assert!(removal.delivery.is_none());
        assert!(removal.previous_delivery_fingerprint.is_none());
        let mut value = serde_json::to_value(input.previous).unwrap();
        value["material"]["roughness"] = serde_json::json!(-0.1);
        assert!(plan_foil_delivery(&serde_json::from_value(value).unwrap()).is_err());
    }
    #[test]
    fn update_requires_explicit_live_and_kernel_is_bound_to_delivery() {
        let previous = FoilDeliveryInput {
            recipe: recipe(),
            material: FoilMaterial::default(),
            target: FoilDeliveryTarget::Web,
        };
        assert!(
            serde_json::from_value::<FoilUpdateInput>(
                serde_json::json!({"previous":previous,"next":previous,"expectedFingerprint":"x"})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<FoilInspectionInput>(
                serde_json::json!({"recipe":previous.recipe,"tagged":true})
            )
            .is_err()
        );
        assert!(
            serde_json::from_value::<FoilRevisionInput>(
                serde_json::json!({"previous":previous.recipe,"next":previous.recipe})
            )
            .is_err()
        );
        let plan = plan_foil_delivery(&previous).unwrap();
        assert_eq!(plan.kernel.uniform_bytes, 96);
        assert!(plan.kernel.source.contains("premultiplied"));
        assert_eq!(plan.kernel.sha256, kernel_hash(&plan.kernel.source));
        let mut changed = previous;
        changed.material.highlight_color.a = 0.5;
        assert_ne!(
            plan.fingerprint,
            plan_foil_delivery(&changed).unwrap().fingerprint
        );
    }
}

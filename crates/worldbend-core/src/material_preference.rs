//! Typed, explicit consumer intent for Texture, Foil and mesh materials.
//! Family setters/deliveries remain canonical; common policy and intent rules live here.
use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{
    AppearanceControlState, AppearanceOverrideActor, ErrorCode, FoilColor, FoilDeliveryInput,
    FoilDeliveryPlan, FoilField, FoilMaterial, MeshGradientColor, MeshGradientDeliveryInput,
    MeshGradientDeliveryPlan, MeshGradientField, MeshGradientMaterial, TextureDeliveryInput,
    TextureDeliveryPlan, TextureField, TextureMaterial, TransformError, TransformResult,
    plan_foil_delivery, plan_mesh_gradient_delivery, plan_texture_delivery,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MATERIAL_PREFERENCE_SCHEMA: &str = "worldbend.material-preference@0.1";
pub const MATERIAL_POLICY_SCHEMA: &str = "worldbend.material-policy@0.1";
pub const MATERIAL_PREFERENCE_PLAN_SCHEMA: &str = "worldbend.material-preference-plan@0.1";
const MAX_REVISION: u64 = 9_007_199_254_740_991;
fn preference_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":MATERIAL_PREFERENCE_SCHEMA})
}
fn policy_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":MATERIAL_POLICY_SCHEMA})
}
fn plan_schema(_: &mut schemars::SchemaGenerator) -> schemars::Schema {
    schemars::json_schema!({"type":"string","const":MATERIAL_PREFERENCE_PLAN_SCHEMA})
}
fn error(message: impl Into<String>) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn fingerprint(value: &impl Serialize) -> TransformResult<String> {
    fingerprint_json_value(
        &canonical_json_value(value).map_err(|_| error("invalid material preference identity"))?,
    )
    .map_err(|_| error("invalid material preference identity"))
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct MaterialRgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "kebab-case",
    deny_unknown_fields
)]
pub enum MaterialPreferenceValue {
    Toggle(bool),
    Number(f64),
    Rgba(MaterialRgba),
    HexColor(String),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialFieldPreference {
    pub value: MaterialPreferenceValue,
    pub actor: AppearanceOverrideActor,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialPreferenceRecord<F: Ord> {
    #[schemars(schema_with = "preference_schema")]
    pub schema: String,
    #[schemars(range(min = 0, max = 9_007_199_254_740_991_u64))]
    pub revision: u64,
    /// Receiver-owned role/instance scope, never inferred from a design label.
    pub scope: String,
    pub recipe_id: String,
    pub fields: BTreeMap<F, MaterialFieldPreference>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialExposedControl<F> {
    pub field: F,
    pub min: Option<f64>,
    pub max: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialExposurePolicy<F> {
    #[schemars(schema_with = "policy_schema")]
    pub schema: String,
    pub policy_id: String,
    #[schemars(range(min = 1, max = 9_007_199_254_740_991_u64))]
    pub revision: u64,
    #[schemars(length(min = 1, max = 32))]
    pub scopes: Vec<String>,
    pub exposed: Vec<MaterialExposedControl<F>>,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialPreferenceRuntime {
    /// Actual mechanism availability, reported by the receiving target.
    pub renderer_available: bool,
    /// Pause/reduced-motion adaptation; does not rewrite saved authored timing.
    pub motion_allowed: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MaterialPreferenceInput {
    Texture {
        source: TextureDeliveryInput,
        policy: MaterialExposurePolicy<TextureField>,
        preference: MaterialPreferenceRecord<TextureField>,
        runtime: MaterialPreferenceRuntime,
    },
    Foil {
        source: FoilDeliveryInput,
        policy: MaterialExposurePolicy<FoilField>,
        preference: MaterialPreferenceRecord<FoilField>,
        runtime: MaterialPreferenceRuntime,
    },
    MeshGradient {
        source: MeshGradientDeliveryInput,
        policy: MaterialExposurePolicy<MeshGradientField>,
        preference: MaterialPreferenceRecord<MeshGradientField>,
        runtime: MaterialPreferenceRuntime,
    },
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum MaterialPreferenceFieldState {
    Applied,
    NotExposed,
    OutOfRange,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPreferenceReceipt<F> {
    pub field: F,
    pub state: MaterialPreferenceFieldState,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPreferenceControl<F> {
    pub field: F,
    pub state: AppearanceControlState,
    pub unit: String,
    pub direction: String,
    /// All adopted fields update the existing live target; no asset or rebake is implied.
    pub cost: crate::AppearanceChangeCost,
    pub authored_range: Option<[f64; 2]>,
    pub effective_range: Option<[f64; 2]>,
    /// Target-effective logical range, separate from product permission.
    pub target_range: Option<[f64; 2]>,
    pub target_value: MaterialPreferenceValue,
    pub default: MaterialPreferenceValue,
    pub current: MaterialPreferenceValue,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterialPreferencePlan<D, F> {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    pub source_fingerprint: String,
    pub policy_fingerprint: String,
    pub policy_revision: u64,
    pub preference_fingerprint: String,
    pub preference_revision: u64,
    pub scope: String,
    pub delivery: D,
    pub controls: Vec<MaterialPreferenceControl<F>>,
    pub receipts: Vec<MaterialPreferenceReceipt<F>>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(tag = "family", content = "plan", rename_all = "kebab-case")]
pub enum MaterialPreferenceOutput {
    Texture(MaterialPreferencePlan<TextureDeliveryPlan, TextureField>),
    Foil(MaterialPreferencePlan<FoilDeliveryPlan, FoilField>),
    MeshGradient(MaterialPreferencePlan<MeshGradientDeliveryPlan, MeshGradientField>),
}

struct Field<F> {
    id: F,
    key: &'static str,
    range: Option<[f64; 2]>,
    unit: &'static str,
    direction: &'static str,
    moving: bool,
}
trait Family: Serialize {
    type Material: Clone + Serialize;
    type Field: Copy + Ord + Serialize;
    type Delivery: Serialize;
    fn recipe_id(&self) -> &str;
    fn material(&self) -> Self::Material;
    fn fields() -> Vec<Field<Self::Field>>;
    fn target_range(field: Self::Field, authored: Option<[f64; 2]>) -> Option<[f64; 2]> {
        let _ = field;
        authored
    }
    fn validate(material: &Self::Material) -> TransformResult<()>;
    fn set(
        material: &mut Self::Material,
        field: Self::Field,
        value: &MaterialPreferenceValue,
    ) -> TransformResult<()>;
    fn deliver(&self, material: Self::Material) -> TransformResult<Self::Delivery>;
}
fn id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
fn toggle(value: &MaterialPreferenceValue) -> TransformResult<bool> {
    if let MaterialPreferenceValue::Toggle(v) = value {
        Ok(*v)
    } else {
        Err(error("field requires a toggle"))
    }
}
fn number(value: &MaterialPreferenceValue) -> TransformResult<f64> {
    if let MaterialPreferenceValue::Number(v) = value
        && v.is_finite()
    {
        return Ok(*v);
    }
    Err(error("field requires a finite scalar"))
}
fn rgba(value: &MaterialPreferenceValue) -> TransformResult<MaterialRgba> {
    if let MaterialPreferenceValue::Rgba(v) = value {
        Ok(*v)
    } else {
        Err(error("field requires an RGBA color"))
    }
}
fn current<M: Serialize, F>(
    material: &M,
    field: &Field<F>,
) -> TransformResult<MaterialPreferenceValue> {
    let json = serde_json::to_value(material).map_err(|_| error("invalid family material"))?;
    let value = &json[field.key];
    if let Some(v) = value.as_bool() {
        Ok(MaterialPreferenceValue::Toggle(v))
    } else if let Some(v) = value.as_f64() {
        Ok(MaterialPreferenceValue::Number(v))
    } else if let Some(v) = value.as_str() {
        Ok(MaterialPreferenceValue::HexColor(v.into()))
    } else {
        Ok(MaterialPreferenceValue::Rgba(
            serde_json::from_value(value.clone()).map_err(|_| error("invalid family color"))?,
        ))
    }
}
fn resolve<S: Family>(
    source: &S,
    policy: &MaterialExposurePolicy<S::Field>,
    preference: &MaterialPreferenceRecord<S::Field>,
    runtime: MaterialPreferenceRuntime,
) -> TransformResult<MaterialPreferencePlan<S::Delivery, S::Field>> {
    if policy.schema != MATERIAL_POLICY_SCHEMA
        || !id(&policy.policy_id)
        || policy.revision == 0
        || policy.revision > MAX_REVISION
        || policy.scopes.is_empty()
        || policy.scopes.len() > 32
        || policy.scopes.iter().any(|v| !id(v))
        || policy.scopes.iter().collect::<BTreeSet<_>>().len() != policy.scopes.len()
    {
        return Err(error("invalid material exposure policy"));
    }
    if preference.schema != MATERIAL_PREFERENCE_SCHEMA
        || preference.revision > MAX_REVISION
        || (!preference.fields.is_empty() && preference.revision == 0)
        || !id(&preference.scope)
        || preference.recipe_id != source.recipe_id()
        || !policy.scopes.contains(&preference.scope)
    {
        return Err(error(
            "preference identity, revision or product scope does not match",
        ));
    }
    let fields = S::fields();
    if policy.exposed.len() > fields.len()
        || policy
            .exposed
            .iter()
            .map(|c| c.field)
            .collect::<BTreeSet<_>>()
            .len()
            != policy.exposed.len()
    {
        return Err(error("duplicate or excessive exposed controls"));
    }
    let base = source.material();
    S::validate(&base)?;
    let mut checked = base.clone();
    // Validate saved intent even while a policy hides it; corrupt records are never silently accepted.
    for (field, value) in &preference.fields {
        S::set(&mut checked, *field, &value.value)?;
    }
    S::validate(&checked)?;
    let mut material = base.clone();
    let mut controls = Vec::new();
    let mut receipts = Vec::new();
    for field in fields {
        let exposed = policy.exposed.iter().find(|row| row.field == field.id);
        let mut range = field.range;
        if let Some(exposed) = exposed {
            if let Some([min, max]) = field.range {
                let low = exposed.min.unwrap_or(min);
                let high = exposed.max.unwrap_or(max);
                if !low.is_finite() || !high.is_finite() || low < min || high > max || low > high {
                    return Err(error(
                        "policy range must stay within the authored family range",
                    ));
                }
                range = Some([low, high]);
            } else if exposed.min.is_some() || exposed.max.is_some() {
                return Err(error("color/toggle controls cannot have scalar bounds"));
            }
        }
        if let Some(value) = preference.fields.get(&field.id) {
            let permitted = exposed.is_some();
            let in_range = match (&value.value, range) {
                (MaterialPreferenceValue::Number(v), Some([min, max])) => *v >= min && *v <= max,
                _ => true,
            };
            let state = if !permitted {
                MaterialPreferenceFieldState::NotExposed
            } else if !in_range {
                MaterialPreferenceFieldState::OutOfRange
            } else {
                S::set(&mut material, field.id, &value.value)?;
                MaterialPreferenceFieldState::Applied
            };
            receipts.push(MaterialPreferenceReceipt {
                field: field.id,
                state,
            });
        }
        let current_value = current(&material, &field)?;
        let target_range = S::target_range(field.id, field.range);
        let target_value = match (&current_value, target_range) {
            (MaterialPreferenceValue::Number(value), Some([min, max])) => {
                MaterialPreferenceValue::Number(value.clamp(min, max))
            }
            _ => current_value.clone(),
        };
        controls.push(MaterialPreferenceControl {
            field: field.id,
            state: if exposed.is_none() {
                AppearanceControlState::NotExposed
            } else if !runtime.renderer_available || (field.moving && !runtime.motion_allowed) {
                AppearanceControlState::Adapted
            } else {
                AppearanceControlState::Exposed
            },
            unit: field.unit.into(),
            direction: field.direction.into(),
            cost: crate::AppearanceChangeCost::Live,
            authored_range: field.range,
            target_range,
            target_value,
            effective_range: range,
            default: current(&base, &field)?,
            current: current_value,
        });
    }
    S::validate(&material)?;
    let source_fingerprint = fingerprint(source)?;
    let policy_fingerprint = fingerprint(
        &serde_json::json!({"schema":policy.schema,"policyId":policy.policy_id,"scopes":policy.scopes,"exposed":policy.exposed}),
    )?;
    let preference_fingerprint = fingerprint(
        &serde_json::json!({"schema":preference.schema,"scope":preference.scope,"recipeId":preference.recipe_id,"fields":preference.fields}),
    )?;
    Ok(MaterialPreferencePlan {
        schema: MATERIAL_PREFERENCE_PLAN_SCHEMA.into(),
        source_fingerprint,
        policy_fingerprint,
        policy_revision: policy.revision,
        preference_fingerprint,
        preference_revision: preference.revision,
        scope: preference.scope.clone(),
        delivery: source.deliver(material)?,
        controls,
        receipts,
    })
}
pub fn resolve_material_preference(
    input: &MaterialPreferenceInput,
) -> TransformResult<MaterialPreferenceOutput> {
    match input {
        MaterialPreferenceInput::Texture {
            source,
            policy,
            preference,
            runtime,
        } => resolve(source, policy, preference, *runtime).map(MaterialPreferenceOutput::Texture),
        MaterialPreferenceInput::Foil {
            source,
            policy,
            preference,
            runtime,
        } => resolve(source, policy, preference, *runtime).map(MaterialPreferenceOutput::Foil),
        MaterialPreferenceInput::MeshGradient {
            source,
            policy,
            preference,
            runtime,
        } => resolve(source, policy, preference, *runtime)
            .map(MaterialPreferenceOutput::MeshGradient),
    }
}

/// Build-time native binding rules. Runtime semantics stay in this module;
/// generated target code and parity fixtures share these exact field mappings.
#[doc(hidden)]
pub fn native_material_preference_rules() -> TransformResult<serde_json::Value> {
    fn rules<S: Family>(material: S::Material) -> TransformResult<Vec<serde_json::Value>> {
        S::fields().into_iter().map(|field| {
            let kind=match current(&material,&field)? {
                MaterialPreferenceValue::Toggle(_) => "toggle",
                MaterialPreferenceValue::Number(_) => "number",
                MaterialPreferenceValue::Rgba(_) => "rgba",
                MaterialPreferenceValue::HexColor(_) => "hex-color",
            };
            Ok(serde_json::json!({"field":field.id,"property":field.key,"kind":kind,"range":field.range,
                "unit":field.unit,"direction":field.direction,"moving":field.moving}))
        }).collect()
    }
    Ok(
        serde_json::json!({"foil":rules::<FoilDeliveryInput>(FoilMaterial::default())?,
        "mesh-gradient":rules::<MeshGradientDeliveryInput>(MeshGradientMaterial::default())?}),
    )
}

impl Family for FoilDeliveryInput {
    type Material = FoilMaterial;
    type Field = FoilField;
    type Delivery = FoilDeliveryPlan;
    fn recipe_id(&self) -> &str {
        &self.recipe.recipe_id
    }
    fn material(&self) -> FoilMaterial {
        self.material
    }
    fn validate(material: &FoilMaterial) -> TransformResult<()> {
        material.validate()
    }
    fn deliver(&self, material: FoilMaterial) -> TransformResult<FoilDeliveryPlan> {
        plan_foil_delivery(&Self {
            material,
            ..self.clone()
        })
    }
    fn fields() -> Vec<Field<FoilField>> {
        use FoilField::*;
        vec![
            Field {
                id: Visible,
                key: "visible",
                range: None,
                unit: "toggle",
                direction: "show material",
                moving: false,
            },
            Field {
                id: BaseColor,
                key: "baseColor",
                range: None,
                unit: "srgb-rgba",
                direction: "base tint and coverage",
                moving: false,
            },
            Field {
                id: HighlightColor,
                key: "highlightColor",
                range: None,
                unit: "srgb-rgba",
                direction: "highlight tint and coverage",
                moving: false,
            },
            Field {
                id: LightAngle,
                key: "lightAngle",
                range: Some([0., 360.]),
                unit: "degrees",
                direction: "rotate incident light",
                moving: false,
            },
            Field {
                id: Intensity,
                key: "intensity",
                range: Some([0., 1.]),
                unit: "ratio",
                direction: "increase highlight response",
                moving: false,
            },
            Field {
                id: Roughness,
                key: "roughness",
                range: Some([0., 1.]),
                unit: "ratio",
                direction: "soften specular detail",
                moving: false,
            },
            Field {
                id: FlowSpeed,
                key: "flowSpeed",
                range: Some([0., 2.]),
                unit: "multiplier",
                direction: "increase flow speed",
                moving: true,
            },
        ]
    }
    fn set(m: &mut FoilMaterial, f: FoilField, v: &MaterialPreferenceValue) -> TransformResult<()> {
        use FoilField::*;
        match f {
            Visible => m.visible = toggle(v)?,
            BaseColor | HighlightColor => {
                let c = rgba(v)?;
                let c = FoilColor {
                    r: c.r,
                    g: c.g,
                    b: c.b,
                    a: c.a,
                };
                if f == BaseColor {
                    m.base_color = c
                } else {
                    m.highlight_color = c
                }
            }
            LightAngle => m.light_angle = number(v)?,
            Intensity => m.intensity = number(v)?,
            Roughness => m.roughness = number(v)?,
            FlowSpeed => m.flow_speed = number(v)?,
        }
        Ok(())
    }
}
impl Family for MeshGradientDeliveryInput {
    type Material = MeshGradientMaterial;
    type Field = MeshGradientField;
    type Delivery = MeshGradientDeliveryPlan;
    fn recipe_id(&self) -> &str {
        &self.recipe.recipe_id
    }
    fn material(&self) -> MeshGradientMaterial {
        self.material
    }
    fn validate(material: &MeshGradientMaterial) -> TransformResult<()> {
        material.validate()
    }
    fn deliver(&self, material: MeshGradientMaterial) -> TransformResult<MeshGradientDeliveryPlan> {
        plan_mesh_gradient_delivery(&Self {
            material,
            ..self.clone()
        })
    }
    fn fields() -> Vec<Field<MeshGradientField>> {
        use MeshGradientField::*;
        vec![
            Field {
                id: Visible,
                key: "visible",
                range: None,
                unit: "toggle",
                direction: "show material",
                moving: false,
            },
            Field {
                id: ColorTl,
                key: "colorTl",
                range: None,
                unit: "srgb-rgba",
                direction: "top-left tint and coverage",
                moving: false,
            },
            Field {
                id: ColorTr,
                key: "colorTr",
                range: None,
                unit: "srgb-rgba",
                direction: "top-right tint and coverage",
                moving: false,
            },
            Field {
                id: ColorBl,
                key: "colorBl",
                range: None,
                unit: "srgb-rgba",
                direction: "bottom-left tint and coverage",
                moving: false,
            },
            Field {
                id: ColorBr,
                key: "colorBr",
                range: None,
                unit: "srgb-rgba",
                direction: "bottom-right tint and coverage",
                moving: false,
            },
            Field {
                id: Warp,
                key: "warp",
                range: Some([0., 1.]),
                unit: "ratio",
                direction: "increase fluid domain warp",
                moving: false,
            },
            Field {
                id: Softness,
                key: "softness",
                range: Some([0., 1.]),
                unit: "ratio",
                direction: "blend corner regions more softly",
                moving: false,
            },
            Field {
                id: DurationMs,
                key: "durationMs",
                range: Some([100., 60000.]),
                unit: "milliseconds",
                direction: "lengthen the authored loop",
                moving: true,
            },
            Field {
                id: PhaseMs,
                key: "phaseMs",
                range: Some([0., 60000.]),
                unit: "milliseconds",
                direction: "offset the loop phase",
                moving: true,
            },
            Field {
                id: FlowSpeed,
                key: "flowSpeed",
                range: Some([0., 2.]),
                unit: "multiplier",
                direction: "increase motion energy",
                moving: true,
            },
        ]
    }
    fn set(
        m: &mut MeshGradientMaterial,
        f: MeshGradientField,
        v: &MaterialPreferenceValue,
    ) -> TransformResult<()> {
        use MeshGradientField::*;
        match f {
            Visible => m.visible = toggle(v)?,
            ColorTl | ColorTr | ColorBl | ColorBr => {
                let c = rgba(v)?;
                let c = MeshGradientColor {
                    r: c.r,
                    g: c.g,
                    b: c.b,
                    a: c.a,
                };
                match f {
                    ColorTl => m.color_tl = c,
                    ColorTr => m.color_tr = c,
                    ColorBl => m.color_bl = c,
                    _ => m.color_br = c,
                }
            }
            Warp => m.warp = number(v)?,
            Softness => m.softness = number(v)?,
            DurationMs => m.duration_ms = number(v)?,
            PhaseMs => m.phase_ms = number(v)?,
            FlowSpeed => m.flow_speed = number(v)?,
        }
        Ok(())
    }
}
impl Family for TextureDeliveryInput {
    type Material = TextureMaterial;
    type Field = TextureField;
    type Delivery = TextureDeliveryPlan;
    fn target_range(field: TextureField, authored: Option<[f64; 2]>) -> Option<[f64; 2]> {
        if field == TextureField::Etch {
            Some([0., crate::texture::WEB_ETCH_EFFECTIVE_MAX])
        } else {
            authored
        }
    }
    fn recipe_id(&self) -> &str {
        &self.recipe.recipe_id
    }
    fn material(&self) -> TextureMaterial {
        self.material.clone()
    }
    fn validate(material: &TextureMaterial) -> TransformResult<()> {
        material.validate()
    }
    fn deliver(&self, material: TextureMaterial) -> TransformResult<TextureDeliveryPlan> {
        plan_texture_delivery(&Self {
            material,
            ..self.clone()
        })
    }
    fn fields() -> Vec<Field<TextureField>> {
        use TextureField::*;
        vec![
            Field {
                id: Visible,
                key: "visible",
                range: None,
                unit: "toggle",
                direction: "show material",
                moving: false,
            },
            Field {
                id: Grain,
                key: "grain",
                range: Some([0., 1.]),
                unit: "ratio",
                direction: "increase grain coverage",
                moving: false,
            },
            Field {
                id: GrainSize,
                key: "grainSize",
                range: Some([0.5, 1000.]),
                unit: "logical-pixels",
                direction: "enlarge grain cells",
                moving: false,
            },
            Field {
                id: GrainColor,
                key: "grainColor",
                range: None,
                unit: "srgb8-hex",
                direction: "tint the grain",
                moving: false,
            },
            Field {
                id: Etch,
                key: "etch",
                range: Some([0., 1000.]),
                unit: "logical-pixels",
                direction: "increase etch relief",
                moving: false,
            },
            Field {
                id: EtchSize,
                key: "etchSize",
                range: Some([0.5, 1000.]),
                unit: "logical-pixels",
                direction: "enlarge etch cells",
                moving: false,
            },
            Field {
                id: ClipToShape,
                key: "clipToShape",
                range: None,
                unit: "toggle",
                direction: "follow the surface outline",
                moving: false,
            },
        ]
    }
    fn set(
        m: &mut TextureMaterial,
        f: TextureField,
        v: &MaterialPreferenceValue,
    ) -> TransformResult<()> {
        use TextureField::*;
        match f {
            Visible => m.visible = toggle(v)?,
            Grain => m.grain = number(v)?,
            GrainSize => m.grain_size = number(v)?,
            GrainColor => {
                if let MaterialPreferenceValue::HexColor(color) = v {
                    m.grain_color = color.clone()
                } else {
                    return Err(error("grain color requires srgb8 hex"));
                }
            }
            Etch => m.etch = number(v)?,
            EtchSize => m.etch_size = number(v)?,
            ClipToShape => m.clip_to_shape = toggle(v)?,
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture(family: &str) -> MaterialPreferenceInput {
        let material = match family {
            "foil" => serde_json::to_value(FoilMaterial::default()).unwrap(),
            "mesh-gradient" => serde_json::to_value(MeshGradientMaterial::default()).unwrap(),
            _ => serde_json::to_value(TextureMaterial::default()).unwrap(),
        };
        let field = match family {
            "foil" => "roughness",
            "mesh-gradient" => "softness",
            _ => "grain",
        };
        serde_json::from_value(json!({"family":family,
            "source":{"recipe":{"schema":format!("worldbend.{family}@0.1"),"version":"0.1","recipeId":"work","recipeVersion":1,"material":material},"material":material,"target":"web"},
            "policy":{"schema":MATERIAL_POLICY_SCHEMA,"policyId":"reader","revision":1,"scopes":["cover"],"exposed":[{"field":field,"min":0,"max":1}]},
            "preference":{"schema":MATERIAL_PREFERENCE_SCHEMA,"revision":0,"scope":"cover","recipeId":"work","fields":{}},
            "runtime":{"rendererAvailable":true,"motionAllowed":true}})).unwrap()
    }
    fn wire(input: &MaterialPreferenceInput) -> serde_json::Value {
        serde_json::to_value(resolve_material_preference(input).unwrap()).unwrap()["plan"].clone()
    }
    #[test]
    fn equal_to_default_intent_survives_new_design_all_families() {
        for (family, field, key) in [
            ("foil", "roughness", "roughness"),
            ("mesh-gradient", "softness", "softness"),
            ("texture", "grain", "grain"),
        ] {
            let mut input = serde_json::to_value(fixture(family)).unwrap();
            let value = input["source"]["material"][key].clone();
            input["preference"]["revision"] = json!(1);
            input["preference"]["fields"][field] =
                json!({"value":{"kind":"number","value":value},"actor":"user"});
            input["source"]["material"][key] = json!(0.9);
            let output = wire(&serde_json::from_value(input).unwrap());
            assert_eq!(output["delivery"]["material"][key], value);
            assert_eq!(output["receipts"][0]["state"], "applied");
        }
    }
    #[test]
    fn policy_hide_and_narrow_suspend_but_do_not_rewrite_intent() {
        let mut input = serde_json::to_value(fixture("mesh-gradient")).unwrap();
        input["preference"]["revision"] = json!(2);
        input["preference"]["fields"]["softness"] =
            json!({"value":{"kind":"number","value":0.9},"actor":"agent"});
        let original = wire(&serde_json::from_value(input.clone()).unwrap());
        input["policy"]["exposed"] = json!([]);
        let hidden = wire(&serde_json::from_value(input.clone()).unwrap());
        assert_eq!(hidden["receipts"][0]["state"], "not-exposed");
        assert_eq!(
            hidden["preferenceFingerprint"],
            original["preferenceFingerprint"]
        );
        input["policy"]["exposed"] = json!([{"field":"softness","min":0,"max":0.6}]);
        let narrowed = wire(&serde_json::from_value(input.clone()).unwrap());
        assert_eq!(narrowed["receipts"][0]["state"], "out-of-range");
        assert_eq!(
            narrowed["preferenceFingerprint"],
            original["preferenceFingerprint"]
        );
        input["policy"]["exposed"][0]["max"] = json!(1);
        let restored = wire(&serde_json::from_value(input).unwrap());
        assert_eq!(restored["delivery"]["material"]["softness"], json!(0.9));
    }
    #[test]
    fn runtime_motion_adaptation_keeps_authored_timing() {
        let mut input = serde_json::to_value(fixture("foil")).unwrap();
        input["policy"]["exposed"] = json!([{"field":"flow-speed"}]);
        input["runtime"]["motionAllowed"] = json!(false);
        let result = wire(&serde_json::from_value(input).unwrap());
        let row = result["controls"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["field"] == "flow-speed")
            .unwrap();
        assert_eq!(row["state"], "adapted");
        assert_eq!(result["delivery"]["material"]["flowSpeed"], json!(0.25));
    }
    #[test]
    fn exact_revision_bound_and_target_range_are_not_policy_ranges() {
        let mut input = serde_json::to_value(fixture("texture")).unwrap();
        input["preference"]["revision"] = json!(MAX_REVISION);
        input["source"]["material"]["etch"] = json!(500);
        let output = wire(&serde_json::from_value(input.clone()).unwrap());
        let row = output["controls"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["field"] == "etch")
            .unwrap();
        assert_eq!(row["authoredRange"][1].as_f64(), Some(1000.0));
        assert_eq!(row["authoredRange"][0].as_f64(), Some(0.0));
        assert_eq!(row["targetRange"][1].as_f64(), Some(100.0));
        assert_eq!(row["targetRange"][0].as_f64(), Some(0.0));
        assert_eq!(row["current"]["value"].as_f64(), Some(500.0));
        assert_eq!(row["targetValue"]["value"].as_f64(), Some(100.0));
        input["preference"]["revision"] = json!(MAX_REVISION + 1);
        assert!(resolve_material_preference(&serde_json::from_value(input).unwrap()).is_err());
    }
    #[test]
    fn corrupt_hidden_intent_wrong_scope_and_duplicate_controls_reject() {
        let initial = serde_json::to_value(fixture("mesh-gradient")).unwrap();
        for case in 0..4 {
            let mut input = initial.clone();
            match case {
                0 => {
                    input["preference"]["scope"] = json!("other");
                }
                1 => {
                    let duplicate = input["policy"]["exposed"][0].clone();
                    input["policy"]["exposed"]
                        .as_array_mut()
                        .unwrap()
                        .push(duplicate);
                }
                2 => {
                    input["preference"]["revision"] = json!(1);
                    input["preference"]["fields"]["color-tl"] = json!({"value":{"kind":"rgba","value":{"r":2,"g":0,"b":0,"a":1}},"actor":"user"});
                }
                _ => {
                    input["preference"]["revision"] = json!(1);
                    input["preference"]["fields"]["visible"] =
                        json!({"value":{"kind":"number","value":1},"actor":"user"});
                }
            }
            assert!(resolve_material_preference(&serde_json::from_value(input).unwrap()).is_err());
        }
    }
    #[test]
    fn typed_colors_and_frozen_renderer_survive_preference_delivery() {
        let mut input = serde_json::to_value(fixture("mesh-gradient")).unwrap();
        input["source"]["kernelProfile"] = json!("worldbend.mesh-gradient.rgba@0.1");
        input["policy"]["exposed"] = json!([{"field":"color-tl"}]);
        input["preference"]["revision"] = json!(1);
        input["preference"]["fields"]["color-tl"] =
            json!({"value":{"kind":"rgba","value":{"r":0,"g":0.5,"b":1,"a":0.7}},"actor":"user"});
        let output = wire(&serde_json::from_value(input).unwrap());
        assert_eq!(
            output["delivery"]["kernel"]["id"],
            "worldbend.mesh-gradient.rgba@0.1"
        );
        assert_eq!(output["delivery"]["material"]["colorTl"]["a"], json!(0.7));
    }
}

//! Project actual native material snapshots, then revise through the same
//! family publishers. Host facts stay beside the ordinary Spatial Document.
use super::*;
use crate::figma_shader_source::{ShaderSource, source_hash};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum NativeMaterialState {
    Absent,
    Removed,
    UntaggedNative,
    Tagged,
    Customized,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum MaterialSnapshotVersion {
    #[serde(rename = "0.1")]
    V01,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum GlassSnapshotSchema {
    #[serde(rename = "worldbend.figma.appearance-handoff")]
    Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum TextureSnapshotSchema {
    #[serde(rename = "worldbend.figma.texture-handoff")]
    Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum FoilSnapshotSchema {
    #[serde(rename = "worldbend.figma.foil-state")]
    Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum MeshGradientSnapshotSchema {
    #[serde(rename = "worldbend.figma.mesh-gradient-state")]
    Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GlassSnapshot {
    schema: GlassSnapshotSchema,
    version: MaterialSnapshotVersion,
    file_key: String,
    page_id: String,
    node_id: String,
    name: String,
    eligible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    warnings: Vec<String>,
    glass_count: u32,
    #[serde(default)]
    native_extras: BTreeMap<String, serde_json::Value>,
    state: NativeMaterialState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    live: Option<GlassMaterial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provenance: Option<AppearanceRecipeSpec>,
    #[schemars(length(max = 7))]
    customized: Vec<GlassField>,
    preview_node_id: String,
    placement: FigmaPlacement,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextureSnapshot {
    schema: TextureSnapshotSchema,
    version: MaterialSnapshotVersion,
    file_key: String,
    page_id: String,
    node_id: String,
    name: String,
    eligible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    noise_count: u32,
    texture_count: u32,
    #[serde(default)]
    native_extras: BTreeMap<String, serde_json::Value>,
    state: NativeMaterialState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    live: Option<TextureMaterial>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provenance: Option<TextureRecipeSpec>,
    #[schemars(length(max = 7))]
    customized: Vec<TextureField>,
    preview_node_id: String,
    placement: FigmaPlacement,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativePaintModifiers {
    visible: bool,
    opacity: f64,
    blend_mode: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeShaderResource {
    import_id: String,
    paint_id: String,
    source_sha256: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeMaterialBinding {
    field: String,
    variable_id: String,
    resolved_type: String,
    value: serde_json::Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShaderSnapshot<S, M, R, F> {
    schema: S,
    version: MaterialSnapshotVersion,
    file_key: String,
    page_id: String,
    node_id: String,
    name: String,
    profile: String,
    can_apply_current_profile: bool,
    paint_index: Option<u32>,
    state: NativeMaterialState,
    material: Option<M>,
    recipe: Option<R>,
    #[schemars(length(max = 10))]
    customized: Vec<F>,
    #[schemars(length(max = 10))]
    bindings: Vec<NativeMaterialBinding>,
    paint_modifiers: Option<NativePaintModifiers>,
    #[schemars(length(max = 64))]
    warnings: Vec<String>,
    resource: NativeShaderResource,
    #[schemars(length(min = 1, max = 128))]
    expected_state: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum NativeMaterialSnapshot {
    Glass(GlassSnapshot),
    Texture(TextureSnapshot),
    Foil(ShaderSnapshot<FoilSnapshotSchema, FoilMaterial, FoilRecipeSpec, FoilField>),
    MeshGradient(
        ShaderSnapshot<
            MeshGradientSnapshotSchema,
            MeshGradientMaterial,
            MeshGradientRecipeSpec,
            MeshGradientField,
        >,
    ),
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MaterialTarget {
    Glass {
        target: AppearanceDeliveryTarget,
    },
    Texture {
        target: TextureDeliveryTarget,
    },
    Foil {
        target: FoilDeliveryTarget,
    },
    MeshGradient {
        target: MeshGradientDeliveryTarget,
        #[serde(default)]
        kernel_profile: Option<MeshGradientKernelProfile>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MaterialFields {
    Glass {
        #[schemars(length(min = 1, max = 7))]
        fields: Vec<GlassField>,
    },
    Texture {
        #[schemars(length(min = 1, max = 7))]
        fields: Vec<TextureField>,
    },
    Foil {
        #[schemars(length(min = 1, max = 7))]
        fields: Vec<FoilField>,
    },
    MeshGradient {
        #[schemars(length(min = 1, max = 10))]
        fields: Vec<MeshGradientField>,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "family", rename_all = "kebab-case", deny_unknown_fields)]
pub enum MaterialSeed {
    Glass { recipe: AppearanceRecipeSpec },
    Texture { recipe: TextureRecipeSpec },
    Foil { recipe: FoilRecipeSpec },
    MeshGradient { recipe: MeshGradientRecipeSpec },
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MaterialSeedOrigin {
    Native,
    Document,
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialProjectionInput {
    snapshot: NativeMaterialSnapshot,
    /// Explicit document-authored seed for a live untagged native instance.
    #[serde(default)]
    document_seed: Option<MaterialSeed>,
    target: MaterialTarget,
    #[serde(default = "default_expression")]
    expression_id: String,
    asset: SpatialDocumentAsset,
    slot_id: String,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MaterialContinuationLoss {
    SourceArtworkNotEmbedded,
    FigmaPlacementNotTransferred,
    NativeVariablesResolved,
    NativePaintCompositionNotTransferred,
    LegacyRendererNotTransferred,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialContinuation {
    schema: String,
    version: String,
    origin: NativeMaterialSnapshot,
    seed_origin: MaterialSeedOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    document_seed: Option<MaterialSeed>,
    document: SpatialDocumentSpec,
    inspection: SpatialDocumentInspection,
    delivery: SpatialDocumentDeliveryPlan,
    losses: Vec<MaterialContinuationLoss>,
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialDocumentRevisionInput {
    base: NativeMaterialSnapshot,
    #[serde(default)]
    document_seed: Option<MaterialSeed>,
    document: SpatialDocumentSpec,
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    expected_fingerprint: String,
    expression_id: String,
    /// Explicit receiving surface/asset relationship. No name-based binding.
    binding: SpatialDocumentBinding,
    fields: MaterialFields,
    /// Exact current get_shader evidence is required for Shader families.
    #[serde(default)]
    shader_source: Option<ShaderSource>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MaterialDocumentRevision {
    schema: String,
    version: String,
    document_fingerprint: String,
    expression_id: String,
    binding: SpatialDocumentBinding,
    origin: NativeMaterialSnapshot,
    seed_origin: MaterialSeedOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    document_seed: Option<MaterialSeed>,
    fields: MaterialFields,
    request: FigmaRequest,
}

impl NativeMaterialSnapshot {
    fn facts(&self) -> (&str, &str, &str, &str) {
        match self {
            Self::Glass(s) => (&s.file_key, &s.page_id, &s.node_id, &s.expected),
            Self::Texture(s) => (&s.file_key, &s.page_id, &s.node_id, &s.expected),
            Self::Foil(s) => (&s.file_key, &s.page_id, &s.node_id, &s.expected_state),
            Self::MeshGradient(s) => (&s.file_key, &s.page_id, &s.node_id, &s.expected_state),
        }
    }
    fn validate(&self) -> TransformResult<()> {
        let (file, page, node, expected) = self.facts();
        for id in [file, page, node] {
            figma_handoff::identity(id)?;
        }
        if expected.is_empty()
            || expected.len() > 8192
            || serde_json::to_vec(self)
                .map_err(|_| error("Invalid native material snapshot"))?
                .len()
                > DIRECT_BYTES
        {
            return Err(error(
                "Native material state exceeds its bounded snapshot contract",
            ));
        }
        let (state, has_live, has_recipe) = match self {
            Self::Glass(s) => {
                if !s.eligible || s.glass_count != 1 || s.reason.is_some() {
                    return Err(error(
                        "Read one eligible live Glass effect before projection or revision",
                    ));
                }
                figma_handoff::identity(&s.preview_node_id)?;
                validate_placement(&s.placement)?;
                (&s.state, s.live.is_some(), s.provenance.is_some())
            }
            Self::Texture(s) => {
                if !s.eligible
                    || s.noise_count > 1
                    || s.texture_count > 1
                    || s.noise_count + s.texture_count == 0
                    || s.reason.is_some()
                {
                    return Err(error(
                        "Read one eligible live Texture instance before projection or revision",
                    ));
                }
                figma_handoff::identity(&s.preview_node_id)?;
                validate_placement(&s.placement)?;
                (&s.state, s.live.is_some(), s.provenance.is_some())
            }
            Self::Foil(s) => {
                validate_shader(
                    s,
                    "foil",
                    include_str!("../../../../packages/figma/shaders/foil/main.ts"),
                    "sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6",
                )?;
                (&s.state, s.material.is_some(), s.recipe.is_some())
            }
            Self::MeshGradient(s) => {
                validate_shader(
                    s,
                    "mesh-gradient",
                    include_str!("../../../../packages/figma/shaders/mesh-gradient/main.ts"),
                    "sha256:86628a8917131534a39ff171245cb9e84394237237b77cc23d287d13de7fc9a7",
                )?;
                (&s.state, s.material.is_some(), s.recipe.is_some())
            }
        };
        let valid = match state {
            NativeMaterialState::Tagged | NativeMaterialState::Customized => has_live && has_recipe,
            NativeMaterialState::UntaggedNative => has_live && !has_recipe,
            _ => false,
        };
        if !valid {
            return Err(error(
                "Projection/revision needs actual live material; never replay a removed seed or invent native provenance",
            ));
        }
        Ok(())
    }
    fn seed(&self, explicit: Option<&MaterialSeed>) -> TransformResult<MaterialSeed> {
        self.validate()?;
        let native = match self {
            Self::Glass(s) => s
                .provenance
                .clone()
                .map(|recipe| MaterialSeed::Glass { recipe }),
            Self::Texture(s) => s
                .provenance
                .clone()
                .map(|recipe| MaterialSeed::Texture { recipe }),
            Self::Foil(s) => s.recipe.clone().map(|recipe| MaterialSeed::Foil { recipe }),
            Self::MeshGradient(s) => s
                .recipe
                .clone()
                .map(|recipe| MaterialSeed::MeshGradient { recipe }),
        };
        match (native, explicit) {
            (Some(seed), None) => Ok(seed),
            (None, Some(seed)) => Ok(seed.clone()),
            (Some(_), Some(_)) => Err(error(
                "Use the actual native seed; an explicit document seed cannot replace its provenance",
            )),
            _ => Err(error(
                "A live untagged instance requires an explicit documentSeed; its native provenance remains untagged",
            )),
        }
    }
    fn material(
        &self,
        target: &MaterialTarget,
        explicit: Option<&MaterialSeed>,
    ) -> TransformResult<SpatialMaterialInput> {
        let seed = self.seed(explicit)?;
        Ok(match (self, target, seed) {
            (Self::Glass(s), MaterialTarget::Glass { target }, MaterialSeed::Glass { recipe }) => {
                SpatialMaterialInput::Glass {
                    input: Box::new(AppearanceDeliveryInput {
                        recipe,
                        material: s.live.unwrap(),
                        target: *target,
                        native_extras: s.native_extras.clone(),
                    }),
                }
            }
            (
                Self::Texture(s),
                MaterialTarget::Texture { target },
                MaterialSeed::Texture { recipe },
            ) => SpatialMaterialInput::Texture {
                input: Box::new(TextureDeliveryInput {
                    recipe,
                    material: s.live.clone().unwrap(),
                    target: *target,
                    native_extras: s.native_extras.clone(),
                }),
            },
            (Self::Foil(s), MaterialTarget::Foil { target }, MaterialSeed::Foil { recipe }) => {
                SpatialMaterialInput::Foil {
                    input: Box::new(FoilDeliveryInput {
                        recipe,
                        material: s.material.unwrap(),
                        target: *target,
                    }),
                }
            }
            (
                Self::MeshGradient(s),
                MaterialTarget::MeshGradient {
                    target,
                    kernel_profile,
                },
                MaterialSeed::MeshGradient { recipe },
            ) => SpatialMaterialInput::MeshGradient {
                input: Box::new(MeshGradientDeliveryInput {
                    recipe,
                    material: s.material.unwrap(),
                    target: *target,
                    kernel_profile: kernel_profile.unwrap_or(
                        if s.profile == "worldbend.mesh-gradient.rgba@0.1" {
                            MeshGradientKernelProfile::LinearV1
                        } else {
                            MeshGradientKernelProfile::default()
                        },
                    ),
                }),
            },
            _ => {
                return Err(error(
                    "The target, actual native snapshot and seed must belong to the same family",
                ));
            }
        })
    }
}
fn material_seed(material: &SpatialMaterialInput) -> MaterialSeed {
    match material {
        SpatialMaterialInput::Glass { input } => MaterialSeed::Glass {
            recipe: input.recipe.clone(),
        },
        SpatialMaterialInput::Texture { input } => MaterialSeed::Texture {
            recipe: input.recipe.clone(),
        },
        SpatialMaterialInput::Foil { input } => MaterialSeed::Foil {
            recipe: input.recipe.clone(),
        },
        SpatialMaterialInput::MeshGradient { input } => MaterialSeed::MeshGradient {
            recipe: input.recipe.clone(),
        },
    }
}

fn validate_placement(p: &FigmaPlacement) -> TransformResult<()> {
    if ![p.x, p.y, p.width, p.height].iter().all(|v| v.is_finite())
        || p.width <= 0.
        || p.height <= 0.
    {
        return Err(error("Invalid native surface placement"));
    }
    Ok(())
}
fn validate_shader<S, M, R, F>(
    s: &ShaderSnapshot<S, M, R, F>,
    family: &str,
    current_source: &str,
    legacy_hash: &str,
) -> TransformResult<()> {
    for id in [&s.resource.import_id, &s.resource.paint_id] {
        figma_handoff::identity(id)?;
    }
    let current = s.resource.source_sha256 == source_hash(current_source);
    let mesh_v1 = family == "mesh-gradient"
        && s.resource.source_sha256
            == source_hash(include_str!(
                "../../../../packages/figma/shaders/mesh-gradient/legacy-v1.ts"
            ));
    let profile = if current && family == "mesh-gradient" {
        "worldbend.mesh-gradient.rgba@0.2".to_string()
    } else if current {
        format!("worldbend.{family}.rgba@0.1")
    } else if mesh_v1 {
        "worldbend.mesh-gradient.rgba@0.1".to_string()
    } else if family == "foil" {
        format!("worldbend.{family}.prototype@0.1")
    } else {
        format!("worldbend.{family}.legacy@0.1")
    };
    if (!current && !mesh_v1 && s.resource.source_sha256 != legacy_hash)
        || s.profile != profile
        || s.can_apply_current_profile != current
    {
        return Err(error(
            "Native renderer profile does not match its exact supported source evidence",
        ));
    }
    if s.paint_index.is_none()
        || s.paint_modifiers.as_ref().is_none_or(|m| {
            !m.opacity.is_finite() || !(0. ..=1.).contains(&m.opacity) || m.blend_mode.is_empty()
        })
        || s.expected_state.is_empty()
        || s.expected_state.len() > 128
        || s.bindings.len() > 10
        || s.warnings.len() > 64
    {
        return Err(error("Read a complete bounded native Shader instance"));
    }
    for binding in &s.bindings {
        figma_handoff::identity(&binding.variable_id)?;
        if binding.field.is_empty()
            || binding.field.len() > 64
            || !["BOOLEAN", "FLOAT", "STRING", "COLOR"].contains(&binding.resolved_type.as_str())
            || serde_json::to_vec(&binding.value)
                .map_err(|_| error("Invalid resolved variable value"))?
                .len()
                > 1024
        {
            return Err(error("Invalid bounded native variable binding"));
        }
    }
    Ok(())
}
pub(super) fn project(input: MaterialProjectionInput) -> TransformResult<MaterialContinuation> {
    let material = input
        .snapshot
        .material(&input.target, input.document_seed.as_ref())?;
    let transferred_v1 = matches!((&input.snapshot,&material),
        (NativeMaterialSnapshot::MeshGradient(snapshot),SpatialMaterialInput::MeshGradient {input})
        if snapshot.profile=="worldbend.mesh-gradient.rgba@0.1" && input.kernel_profile==MeshGradientKernelProfile::LinearV1);
    let document = SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.into(),
        version: SPATIAL_DOCUMENT_VERSION.into(),
        assets: vec![input.asset.clone()],
        expressions: vec![SpatialDocumentExpression::Material {
            id: input.expression_id,
            material,
            bindings: vec![SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: input.slot_id,
                asset_id: input.asset.id,
            }],
        }],
    };
    let inspection = inspect_spatial_document(&document)?;
    let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: document.clone(),
        expected_fingerprint: Some(inspection.fingerprint.clone()),
        expression_ids: None,
    })?;
    let mut losses = vec![MaterialContinuationLoss::SourceArtworkNotEmbedded];
    match &input.snapshot {
        NativeMaterialSnapshot::Glass(_) | NativeMaterialSnapshot::Texture(_) => {
            losses.push(MaterialContinuationLoss::FigmaPlacementNotTransferred)
        }
        NativeMaterialSnapshot::Foil(s) => shader_losses(s, &mut losses, false),
        NativeMaterialSnapshot::MeshGradient(s) => shader_losses(s, &mut losses, transferred_v1),
    }
    Ok(MaterialContinuation {
        schema: "worldbend.figma.material-continuation".into(),
        version: "0.1".into(),
        origin: input.snapshot,
        seed_origin: if input.document_seed.is_some() {
            MaterialSeedOrigin::Document
        } else {
            MaterialSeedOrigin::Native
        },
        document_seed: input.document_seed,
        document,
        inspection,
        delivery,
        losses,
    })
}
fn shader_losses<S, M, R, F>(
    s: &ShaderSnapshot<S, M, R, F>,
    losses: &mut Vec<MaterialContinuationLoss>,
    renderer_transferred: bool,
) {
    if !s.bindings.is_empty() {
        losses.push(MaterialContinuationLoss::NativeVariablesResolved);
    }
    if s.paint_modifiers
        .as_ref()
        .is_some_and(|m| !m.visible || m.opacity != 1. || m.blend_mode != "NORMAL")
    {
        losses.push(MaterialContinuationLoss::NativePaintCompositionNotTransferred);
    }
    if !s.can_apply_current_profile && !renderer_transferred {
        losses.push(MaterialContinuationLoss::LegacyRendererNotTransferred);
    }
}
fn distinct<F: PartialEq>(fields: &[F], max: usize) -> TransformResult<()> {
    if fields.is_empty()
        || fields.len() > max
        || fields
            .iter()
            .enumerate()
            .any(|(i, f)| fields[..i].contains(f))
    {
        return Err(error("Select distinct owned material fields"));
    }
    Ok(())
}
fn parsed<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> TransformResult<T> {
    serde_json::from_value(value).map_err(|e| error(&format!("Invalid native family request: {e}")))
}
pub(super) fn revise(
    input: MaterialDocumentRevisionInput,
) -> TransformResult<MaterialDocumentRevision> {
    input.base.validate()?;
    let inspection = inspect_spatial_document(&input.document)?;
    if inspection.fingerprint != input.expected_fingerprint {
        return Err(error(
            "Document changed; inspect its current fingerprint before material revision",
        ));
    }
    let expression = input
        .document
        .expressions
        .iter()
        .find(|e| e.id() == input.expression_id)
        .ok_or_else(|| error("Select an existing material expression"))?;
    let SpatialDocumentExpression::Material {
        material, bindings, ..
    } = expression
    else {
        return Err(error(
            "Native material revision requires a material expression",
        ));
    };
    if input.binding.role != SpatialDocumentBindingRole::Content
        || !bindings.contains(&input.binding)
    {
        return Err(error(
            "Bind exactly a receiving surface and asset from this expression",
        ));
    }
    if input.base.seed(input.document_seed.as_ref())? != material_seed(material) {
        return Err(error(
            "Material revision keeps its exact authored seed; use explicit seed upgrade/choice for a seed change",
        ));
    }
    let (file, page, node, expected) = input.base.facts();
    let scope = json!({"fileKey":file,"pageId":page,"nodeId":node,"expected":expected});
    let request = match (&input.base, material, &input.fields) {
        (
            NativeMaterialSnapshot::Glass(base),
            SpatialMaterialInput::Glass { input: next },
            MaterialFields::Glass { fields },
        ) => {
            distinct(fields, 7)?;
            if input.shader_source.is_some() {
                return Err(error(
                    "Material revision keeps the native authored seed; use explicit family choose/upgrade for a seed change",
                ));
            }
            let mut args = scope;
            args["material"] = json!(next.material);
            args["recipe"] = json!(next.recipe);
            args["fields"] = json!(fields);
            args["retainUntagged"] = json!(base.provenance.is_none());
            figma_handoff::appearance_apply(parsed(args)?)?
        }
        (
            NativeMaterialSnapshot::Texture(base),
            SpatialMaterialInput::Texture { input: next },
            MaterialFields::Texture { fields },
        ) => {
            distinct(fields, 7)?;
            if input.shader_source.is_some() {
                return Err(error(
                    "Material revision keeps the native authored seed; use explicit family choose/upgrade for a seed change",
                ));
            }
            let mut args = scope;
            args["material"] = json!(next.material);
            args["recipe"] = json!(next.recipe);
            args["fields"] = json!(fields);
            args["retainUntagged"] = json!(base.provenance.is_none());
            figma_handoff::texture_apply(parsed(args)?)?
        }
        (
            NativeMaterialSnapshot::Foil(base),
            SpatialMaterialInput::Foil { input: next },
            MaterialFields::Foil { fields },
        ) => {
            distinct(fields, 7)?;
            let source = shader_source(&input.shader_source, &base.resource)?;
            crate::figma_foil::prepare(parsed(
                json!({"fileKey":file,"pageId":page,"nodeId":node,"source":source,"paintIndex":base.paint_index,"operation":{"action":"edit","expectedState":expected,"change":{"action":"edit","material":next.material,"fields":fields}}}),
            )?)?
        }
        (
            NativeMaterialSnapshot::MeshGradient(base),
            SpatialMaterialInput::MeshGradient { input: next },
            MaterialFields::MeshGradient { fields },
        ) => {
            distinct(fields, 10)?;
            if (base.profile == "worldbend.mesh-gradient.rgba@0.1"
                && next.kernel_profile != MeshGradientKernelProfile::LinearV1)
                || (base.profile == "worldbend.mesh-gradient.rgba@0.2"
                    && next.kernel_profile != MeshGradientKernelProfile::LoopV2)
            {
                return Err(error(
                    "Material revision preserves the native renderer; explicitly adopt the requested profile before revising its controls",
                ));
            }
            let source = shader_source(&input.shader_source, &base.resource)?;
            crate::figma_mesh_gradient::prepare(parsed(
                json!({"fileKey":file,"pageId":page,"nodeId":node,"source":source,"paintIndex":base.paint_index,"operation":{"action":"edit","expectedState":expected,"change":{"action":"edit","material":next.material,"fields":fields}}}),
            )?)?
        }
        _ => {
            return Err(error(
                "The document, native snapshot and selected fields must belong to the same material family",
            ));
        }
    };
    Ok(MaterialDocumentRevision {
        schema: "worldbend.figma.material-revision".into(),
        version: "0.1".into(),
        document_fingerprint: inspection.fingerprint,
        expression_id: input.expression_id,
        binding: input.binding,
        origin: input.base,
        seed_origin: if input.document_seed.is_some() {
            MaterialSeedOrigin::Document
        } else {
            MaterialSeedOrigin::Native
        },
        document_seed: input.document_seed,
        fields: input.fields,
        request,
    })
}
fn shader_source<'a>(
    source: &'a Option<ShaderSource>,
    resource: &NativeShaderResource,
) -> TransformResult<&'a ShaderSource> {
    let source = source
        .as_ref()
        .ok_or_else(|| error("Native Shader revision requires exact get_shader source evidence"))?;
    if format!("{}/{}", source.id, source.version) != resource.import_id
        || source.paint_id.as_deref() != Some(&resource.paint_id)
        || source_hash(&source.main_source) != resource.source_sha256
    {
        return Err(error(
            "Shader source identity must match this native snapshot",
        ));
    }
    Ok(source)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicitly_authored_document_seed_preserves_untagged_native_provenance() {
        for family in ["glass", "texture", "foil", "mesh-gradient"] {
            let mut args = revision(family);
            let seed = material_seed(
                &parsed::<SpatialDocumentSpec>(args["document"].clone())
                    .unwrap()
                    .expressions
                    .iter()
                    .find_map(|e| {
                        if let SpatialDocumentExpression::Material { material, .. } = e {
                            Some(material.clone())
                        } else {
                            None
                        }
                    })
                    .unwrap(),
            );
            args["base"]["state"] = json!("untagged-native");
            let key = if ["glass", "texture"].contains(&family) {
                "provenance"
            } else {
                "recipe"
            };
            args["base"].as_object_mut().unwrap().remove(key);
            let mut projection = json!({"snapshot":args["base"],"target":{"family":family,"target":"web"},"expressionId":"finish","asset":{"id":"artwork"},"slotId":"hero"});
            assert!(project(parsed(projection.clone()).unwrap()).is_err());
            projection["documentSeed"] = json!(seed);
            let projected = json!(project(parsed(projection).unwrap()).unwrap());
            assert_eq!(projected["seedOrigin"], "document");
            assert!(projected["origin"][key].is_null());
            assert!(revise(parsed(args.clone()).unwrap()).is_err());
            args["documentSeed"] = json!(seed);
            let revision = json!(revise(parsed(args).unwrap()).unwrap());
            assert_eq!(revision["seedOrigin"], "document");
            assert!(revision["origin"][key].is_null());
        }
    }
    fn snapshot(family: &str) -> serde_json::Value {
        let (schema, material) = match family {
            "glass" => (APPEARANCE_SCHEMA, json!(GlassMaterial::default())),
            "texture" => (TEXTURE_SCHEMA, json!(TextureMaterial::default())),
            "foil" => (FOIL_SCHEMA, json!(FoilMaterial::default())),
            _ => (MESH_GRADIENT_SCHEMA, json!(MeshGradientMaterial::default())),
        };
        let recipe = json!({"schema":schema,"version":"0.1","recipeId":"authored-work","recipeVersion":1,"material":material});
        let mut s = json!({"version":"0.1","fileKey":"granted-file","pageId":"10:1","nodeId":"10:2","name":"Artwork","state":"customized","customized":[]});
        if ["glass", "texture"].contains(&family) {
            s["schema"] = json!(if family == "glass" {
                "worldbend.figma.appearance-handoff"
            } else {
                "worldbend.figma.texture-handoff"
            });
            s["eligible"] = json!(true);
            s["live"] = material;
            s["provenance"] = recipe;
            s["nativeExtras"] = json!({"native-extra":0.3});
            s["previewNodeId"] = json!("10:3");
            s["placement"] = json!({"x":5,"y":8,"width":300,"height":400});
            s["expected"] = json!("complete-native-expected");
            if family == "glass" {
                s["glassCount"] = json!(1);
                s["previewNodeId"] = json!("10:3");
                s["live"]["depth"] = json!(18.0);
            } else {
                s["noiseCount"] = json!(1);
                s["textureCount"] = json!(1);
                s["live"]["grain"] = json!(0.8);
            }
        } else {
            let source = if family == "foil" {
                include_str!("../../../../packages/figma/shaders/foil/main.ts")
            } else {
                include_str!("../../../../packages/figma/shaders/mesh-gradient/main.ts")
            };
            s["schema"] = json!(format!("worldbend.figma.{family}-state"));
            s["material"] = material;
            s["recipe"] = recipe;
            s["profile"] = json!(if family == "mesh-gradient" {
                "worldbend.mesh-gradient.rgba@0.2".to_string()
            } else {
                format!("worldbend.{family}.rgba@0.1")
            });
            s["canApplyCurrentProfile"] = json!(true);
            s["paintIndex"] = json!(0);
            s["expectedState"] = json!("hash32x2:10:0000000000000000");
            s["warnings"] = json!([]);
            s["bindings"] = json!([{ "field":"lightAngle", "variableId":"VariableID:1:2", "resolvedType":"FLOAT", "value":130 }]);
            s["paintModifiers"] = json!({"visible":true,"opacity":0.6,"blendMode":"MULTIPLY"});
            s["resource"] = json!({"importId":format!("fixture-shader/{}", "0".repeat(40)),"paintId":"fixture-paint","sourceSha256":source_hash(source)});
            if family == "foil" {
                s["material"]["intensity"] = json!(0.9);
            } else {
                s["material"]["colorTl"]["a"] = json!(0.3);
            }
        }
        s
    }
    fn projection(s: serde_json::Value, family: &str) -> MaterialProjectionInput {
        parsed(json!({"snapshot":s,"target":{"family":family,"target":"web"},"expressionId":"finish","asset":{"id":"artwork","contentVersion":"edition-1"},"slotId":"hero"})).unwrap()
    }
    fn revision(family: &str) -> serde_json::Value {
        let s = snapshot(family);
        let continuation = project(projection(s.clone(), family)).unwrap();
        let fields = match family {
            "glass" => vec!["depth"],
            "texture" => vec!["grain"],
            "foil" => vec!["intensity"],
            _ => vec!["warp"],
        };
        let mut input = json!({"base":s,"document":continuation.document,"expectedFingerprint":continuation.inspection.fingerprint,"expressionId":"finish","binding":{"role":"content","slotId":"hero","assetId":"artwork"},"fields":{"family":family,"fields":fields}});
        if ["foil", "mesh-gradient"].contains(&family) {
            input["shaderSource"] = json!({"id":"fixture-shader","version":"0".repeat(40),"paintId":"fixture-paint","mainSource":if family=="foil" { include_str!("../../../../packages/figma/shaders/foil/main.ts") } else { include_str!("../../../../packages/figma/shaders/mesh-gradient/main.ts") }});
        }
        input
    }
    #[test]
    fn frozen_native_v1_projects_its_actual_renderer_until_explicit_profile_choice() {
        let mut s = snapshot("mesh-gradient");
        s["profile"] = json!("worldbend.mesh-gradient.rgba@0.1");
        s["canApplyCurrentProfile"] = json!(false);
        s["resource"]["sourceSha256"] = json!(source_hash(include_str!(
            "../../../../packages/figma/shaders/mesh-gradient/legacy-v1.ts"
        )));
        let result = project(projection(s.clone(), "mesh-gradient")).unwrap();
        let value = json!(result);
        assert_eq!(
            value["document"]["expressions"][0]["material"]["input"]["kernelProfile"],
            "worldbend.mesh-gradient.rgba@0.1"
        );
        assert!(
            !value["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("legacyRendererNotTransferred"))
        );
        let mut requested = projection(s, "mesh-gradient");
        requested.target = MaterialTarget::MeshGradient {
            target: MeshGradientDeliveryTarget::Web,
            kernel_profile: Some(MeshGradientKernelProfile::LoopV2),
        };
        let value = json!(project(requested).unwrap());
        assert_eq!(
            value["document"]["expressions"][0]["material"]["input"]["kernelProfile"],
            "worldbend.mesh-gradient.rgba@0.2"
        );
        assert!(
            value["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("legacyRendererNotTransferred"))
        );
    }

    #[test]
    fn native_revision_requires_explicit_renderer_adoption_before_profile_change() {
        let mut request = revision("mesh-gradient");
        request["base"]["profile"] = json!("worldbend.mesh-gradient.rgba@0.1");
        request["base"]["canApplyCurrentProfile"] = json!(false);
        request["base"]["resource"]["sourceSha256"] = json!(source_hash(include_str!(
            "../../../../packages/figma/shaders/mesh-gradient/legacy-v1.ts"
        )));
        request["shaderSource"]["mainSource"] = json!(include_str!(
            "../../../../packages/figma/shaders/mesh-gradient/legacy-v1.ts"
        ));
        assert!(
            revise(parsed(request.clone()).unwrap())
                .unwrap_err()
                .message
                .contains("explicitly adopt")
        );
        request["document"]["expressions"][0]["material"]["input"]["kernelProfile"] =
            json!("worldbend.mesh-gradient.rgba@0.1");
        let document: SpatialDocumentSpec =
            serde_json::from_value(request["document"].clone()).unwrap();
        request["expectedFingerprint"] =
            json!(inspect_spatial_document(&document).unwrap().fingerprint);
        assert!(revise(parsed(request).unwrap()).is_ok());
    }

    #[test]
    fn each_actual_material_projects_without_replaying_seed_and_retains_host_origin() {
        for family in ["glass", "texture", "foil", "mesh-gradient"] {
            let s = snapshot(family);
            let result = project(projection(s.clone(), family)).unwrap();
            let value = json!(result);
            let input = &value["document"]["expressions"][0]["material"]["input"];
            let live_key = if ["glass", "texture"].contains(&family) {
                "live"
            } else {
                "material"
            };
            let recipe_key = if ["glass", "texture"].contains(&family) {
                "provenance"
            } else {
                "recipe"
            };
            assert_eq!(input["material"], s[live_key]);
            assert_eq!(input["recipe"], s[recipe_key]);
            assert_ne!(input["material"], input["recipe"]["material"]);
            assert_eq!(value["origin"][live_key], s[live_key]);
            assert_eq!(
                value["document"]["expressions"][0]["bindings"][0]["assetId"],
                "artwork"
            );
            if ["foil", "mesh-gradient"].contains(&family) {
                assert_eq!(value["origin"]["bindings"], s["bindings"]);
                assert_eq!(value["origin"]["paintModifiers"], s["paintModifiers"]);
                assert!(
                    value["losses"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("nativePaintCompositionNotTransferred"))
                );
                assert!(
                    value["losses"]
                        .as_array()
                        .unwrap()
                        .contains(&json!("nativeVariablesResolved"))
                );
            } else {
                assert_eq!(input["nativeExtras"], s["nativeExtras"]);
                assert!(
                    !value["delivery"]["deliveries"][0]["material"]["delivery"]["losses"].is_null()
                );
            }
        }
    }
    #[test]
    fn revisions_delegate_selected_fields_to_guarded_family_publishers() {
        for family in ["glass", "texture", "foil", "mesh-gradient"] {
            let args = revision(family);
            let result = revise(parsed(args.clone()).unwrap()).unwrap();
            assert_eq!(json!(result.fields), args["fields"]);
            assert_eq!(result.binding.asset_id, "artwork");
            assert!(
                result.request.code.contains("complete-native-expected")
                    || result.request.code.contains("hash32x2:10:0000000000000000")
            );
            assert!(result.request.code.contains("\"fields\":["));
            assert!(serde_json::to_vec(&result.request).unwrap().len() <= 48 * 1024);
        }
    }
    #[test]
    fn document_revision_rejects_stale_relationships_seed_changes_and_wrong_families() {
        for family in ["glass", "texture", "foil", "mesh-gradient"] {
            for mutation in 0..6 {
                let mut args = revision(family);
                match mutation {
                    0 => args["document"]["assets"][0]["contentVersion"] = json!("new-edition"),
                    1 => args["binding"]["assetId"] = json!("other"),
                    2 => args["fields"]["fields"] = json!([]),
                    3 => {
                        let first = args["fields"]["fields"][0].clone();
                        args["fields"]["fields"] = json!([first, first]);
                    }
                    4 => {
                        args["document"]["expressions"][0]["material"]["input"]["recipe"]["recipeVersion"] =
                            json!(2);
                        let d: SpatialDocumentSpec = parsed(args["document"].clone()).unwrap();
                        args["expectedFingerprint"] =
                            json!(inspect_spatial_document(&d).unwrap().fingerprint);
                    }
                    _ => {
                        args["fields"] = if family == "glass" {
                            json!({"family":"texture","fields":["grain"]})
                        } else {
                            json!({"family":"glass","fields":["depth"]})
                        }
                    }
                }
                assert!(
                    revise(parsed(args).unwrap()).is_err(),
                    "{family} mutation {mutation}"
                );
            }
        }
    }
    #[test]
    fn native_removed_untagged_and_unknown_schema_are_not_projected_as_seed_replay() {
        for family in ["glass", "texture", "foil", "mesh-gradient"] {
            for state in ["absent", "removed", "untagged-native"] {
                let mut s = snapshot(family);
                s["state"] = json!(state);
                assert!(project(projection(s, family)).is_err());
            }
            let mut s = snapshot(family);
            s["schema"] = json!("worldbend.foreign");
            assert!(parsed::<NativeMaterialSnapshot>(s).is_err());
            let mut s = snapshot(family);
            s["draft"] = json!({});
            assert!(parsed::<NativeMaterialSnapshot>(s).is_err());
            assert!(
                project(projection(
                    snapshot(family),
                    if family == "glass" {
                        "texture"
                    } else {
                        "glass"
                    }
                ))
                .is_err()
            );
        }
    }
    #[test]
    fn shader_identity_mismatch_and_renderer_difference_are_not_silently_adopted() {
        for family in ["foil", "mesh-gradient"] {
            for mutation in 0..3 {
                let mut args = revision(family);
                match mutation {
                    0 => args["shaderSource"]["id"] = json!("other"),
                    1 => args["shaderSource"]["version"] = json!("1".repeat(40)),
                    _ => args["shaderSource"]["paintId"] = json!("other-paint"),
                };
                assert!(revise(parsed(args).unwrap()).is_err());
            }
            let mut s = snapshot(family);
            s["canApplyCurrentProfile"] = json!(false);
            s["profile"] = json!(if family == "foil" {
                "worldbend.foil.prototype@0.1"
            } else {
                "worldbend.mesh-gradient.legacy@0.1"
            });
            s["resource"]["sourceSha256"] = json!(if family == "foil" {
                "sha256:9980aba7458f170d19cc0fd62dce26e482c277b8f5a1f2e023c2f0fcfd83a8a6"
            } else {
                "sha256:86628a8917131534a39ff171245cb9e84394237237b77cc23d287d13de7fc9a7"
            });
            let out = json!(project(projection(s, family)).unwrap());
            assert!(
                out["losses"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("legacyRendererNotTransferred"))
            );
            assert_eq!(out["origin"]["canApplyCurrentProfile"], false);
        }
    }
}

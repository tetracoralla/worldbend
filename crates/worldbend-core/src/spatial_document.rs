//! One durable work envelope over Worldbend's existing closed execution
//! contracts. A document shares asset identity across static, interactive and
//! temporal expressions without pretending those expressions have one renderer.

use crate::canonical::{canonical_json_value, fingerprint_json_value};
use crate::{
    EffectPlanInput, EffectRecipe, EffectRecipeInspection, EffectState, ErrorCode, MockupVideoPlan,
    MockupVideoSpec, SPATIAL_TEMPLATE_VERSION, SpatialTemplateInspection, SpatialTemplateSpec,
    TransformError, TransformResult, VARIATION_JOB_SCHEMA, VariationBinding,
    VariationFailurePolicy, VariationJobItem, VariationJobSpec, bounded_text, effect_plan,
    inspect_effect_recipe, inspect_spatial_template, plan_mockup_video,
};
use crate::{SpatialMaterialDelivery, SpatialMaterialFamily, SpatialMaterialInput};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};

pub const SPATIAL_DOCUMENT_SCHEMA: &str = "worldbend.spatial-document";
pub const SPATIAL_DOCUMENT_INSPECTION_SCHEMA: &str = "worldbend.spatial-document-inspection";
pub const SPATIAL_DOCUMENT_ASSEMBLY_PLAN_SCHEMA: &str = "worldbend.spatial-document-assembly-plan";
pub const SPATIAL_DOCUMENT_UPDATE_PLAN_SCHEMA: &str = "worldbend.spatial-document-update-plan";
pub const SPATIAL_DOCUMENT_DELIVERY_PLAN_SCHEMA: &str = "worldbend.spatial-document-delivery-plan";
pub const SPATIAL_STATIC_DELIVERY_SCHEMA: &str = "worldbend.spatial-static-delivery";
pub const SPATIAL_INTERACTIVE_DELIVERY_SCHEMA: &str = "worldbend.spatial-interactive-delivery";
pub const SPATIAL_INTERACTIVE_MEDIA_BUNDLE_SCHEMA: &str =
    "worldbend.spatial-interactive-media-bundle";
pub const SPATIAL_TEMPORAL_DELIVERY_SCHEMA: &str = "worldbend.spatial-temporal-delivery";
pub const SPATIAL_DOCUMENT_VERSION: &str = "0.1";
pub const SPATIAL_STATIC_DELIVERY_VERSION: &str = "0.1";
pub const SPATIAL_INTERACTIVE_DELIVERY_VERSION: &str = "0.1";
pub const SPATIAL_INTERACTIVE_MEDIA_BUNDLE_VERSION: &str = "0.1";
pub const SPATIAL_TEMPORAL_DELIVERY_VERSION: &str = "0.1";
pub const MAX_SPATIAL_DOCUMENT_ASSETS: usize = 64;
pub const MAX_SPATIAL_DOCUMENT_EXPRESSIONS: usize = 32;
pub const MAX_SPATIAL_DOCUMENT_BINDINGS: usize = 64;
pub const MAX_SPATIAL_DOCUMENT_REVISIONS: usize = 64;
pub const MAX_SPATIAL_DOCUMENT_ASSEMBLY_DOCUMENTS: usize = 32;
pub const MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS: usize =
    MAX_SPATIAL_DOCUMENT_ASSEMBLY_DOCUMENTS * MAX_SPATIAL_DOCUMENT_ASSETS;
pub const MAX_SPATIAL_MEDIA_ENCODED_BYTES: u64 = 67_108_864;
pub const MAX_SPATIAL_MEDIA_AXIS: u32 = 8192;
pub const MAX_SPATIAL_MEDIA_PIXELS: u64 = 16_777_216;

const MAX_HEADER_ECHO_CHARS: usize = 128;
const MAX_BINDING_DIAGNOSTIC_ITEMS: usize = 8;
const MAX_BINDING_DIAGNOSTIC_CHARS: usize = 64;

/// A stable content identity. Carriers resolve bytes, URLs, DOM nodes or local
/// paths separately; those transport details do not enter document meaning.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAsset {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    /// Optional caller-owned revision, digest or content version. It is
    /// descriptive provenance, not a path and not verified by the core.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 128))]
    pub content_version: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SpatialDocumentBindingRole {
    Content,
    DepthMap,
    /// Optional authoring dependency for a fitted DeformationWork stage. The
    /// slot names that stage; execution uses its captured geometry, not media
    /// from this asset. A geometry change requires recapture of the stage.
    FittingGuide,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentBinding {
    pub role: SpatialDocumentBindingRole,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub slot_id: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub asset_id: String,
}

/// Static, interactive and temporal expressions retain their own execution
/// contracts. The document owns their shared asset identity and repeat-use
/// relationship.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SpatialDocumentExpression {
    Scene3d {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        scene: crate::Scene3dSpec,
        #[schemars(length(min = 1, max = 17))]
        bindings: Vec<SpatialDocumentBinding>,
    },
    /// Apply typed material to existing content surfaces. Each binding's slot
    /// names a receiving surface; its asset is content identity, not a sampled
    /// backdrop or a baked representation of the material.
    Material {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        material: SpatialMaterialInput,
        #[schemars(length(min = 1, max = 64))]
        bindings: Vec<SpatialDocumentBinding>,
    },
    Static {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        template: SpatialTemplateSpec,
        #[schemars(length(min = 1, max = 64))]
        bindings: Vec<SpatialDocumentBinding>,
    },
    Interactive {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        recipe: EffectRecipe,
        #[schemars(length(min = 1, max = 64))]
        bindings: Vec<SpatialDocumentBinding>,
    },
    /// Multi-plane mockup-motion video (`worldbend.mockup-video@0.1`). Plane
    /// `sourceId` values become content slots bound to durable assets.
    Temporal {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        video: MockupVideoSpec,
        #[schemars(length(min = 1, max = 64))]
        bindings: Vec<SpatialDocumentBinding>,
    },
}

impl SpatialDocumentExpression {
    pub fn id(&self) -> &str {
        match self {
            Self::Scene3d { id, .. }
            | Self::Material { id, .. }
            | Self::Static { id, .. }
            | Self::Interactive { id, .. }
            | Self::Temporal { id, .. } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentSpec {
    #[schemars(schema_with = "spatial_document_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_document_version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(min = 1, max = 32))]
    pub expressions: Vec<SpatialDocumentExpression>,
}

/// One accepted source document. Assembly always guards the exact inspected
/// fingerprint so an Agent cannot accidentally combine stale projected work.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyDocument {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub document: SpatialDocumentSpec,
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub expected_fingerprint: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyAssetMember {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub document_id: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub asset_id: String,
}

/// Explicit caller assertion that source assets represent one durable asset.
/// Worldbend validates the assertion but never infers equivalence from names,
/// bytes, node IDs or geometry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyAsset {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 128))]
    pub content_version: Option<String>,
    #[schemars(length(min = 1, max = 2048))]
    pub members: Vec<SpatialDocumentAssemblyAssetMember>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyExpression {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub document_id: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub expression_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyInput {
    #[schemars(length(min = 2, max = 32))]
    pub documents: Vec<SpatialDocumentAssemblyDocument>,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAssemblyAsset>,
    #[schemars(length(min = 1, max = 32))]
    pub expressions: Vec<SpatialDocumentAssemblyExpression>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyDocumentResult {
    pub id: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssemblyPlan {
    #[schemars(schema_with = "spatial_document_assembly_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_document_version_schema")]
    pub version: String,
    #[schemars(length(min = 2, max = 32))]
    pub documents: Vec<SpatialDocumentAssemblyDocumentResult>,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAssemblyAsset>,
    #[schemars(length(min = 1, max = 32))]
    pub expressions: Vec<SpatialDocumentAssemblyExpression>,
    pub document: SpatialDocumentSpec,
    pub delivery_plan: SpatialDocumentDeliveryPlan,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SpatialDocumentExpressionInspection {
    Scene3d {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        scene: crate::Scene3dPlan,
    },
    Material {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        family: SpatialMaterialFamily,
        material_fingerprint: String,
    },
    Static {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        template: SpatialTemplateInspection,
    },
    Interactive {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        recipe: EffectRecipeInspection,
    },
    Temporal {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        video_fingerprint: String,
        #[schemars(length(min = 1, max = 16))]
        source_ids: Vec<String>,
    },
}

impl SpatialDocumentExpressionInspection {
    fn id(&self) -> &str {
        match self {
            Self::Scene3d { id, .. }
            | Self::Material { id, .. }
            | Self::Static { id, .. }
            | Self::Interactive { id, .. }
            | Self::Temporal { id, .. } => id,
        }
    }

    fn kind(&self) -> SpatialDocumentExpressionKind {
        match self {
            Self::Scene3d { .. } => SpatialDocumentExpressionKind::Scene3d,
            Self::Material { .. } => SpatialDocumentExpressionKind::Material,
            Self::Static { .. } => SpatialDocumentExpressionKind::Static,
            Self::Interactive { .. } => SpatialDocumentExpressionKind::Interactive,
            Self::Temporal { .. } => SpatialDocumentExpressionKind::Temporal,
        }
    }

    fn bindings(&self) -> &[SpatialDocumentBinding] {
        match self {
            Self::Scene3d { bindings, .. }
            | Self::Material { bindings, .. }
            | Self::Static { bindings, .. }
            | Self::Interactive { bindings, .. }
            | Self::Temporal { bindings, .. } => bindings,
        }
    }
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentInspection {
    #[schemars(schema_with = "spatial_document_inspection_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_document_version_schema")]
    pub version: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub fingerprint: String,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(min = 1, max = 32))]
    pub expressions: Vec<SpatialDocumentExpressionInspection>,
    #[schemars(length(max = 64))]
    pub unused_asset_ids: Vec<String>,
}

/// One explicit new content identity. `null` or an omitted `contentVersion`
/// clears the caller-owned revision without removing the durable asset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssetRevision {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub asset_id: String,
    #[serde(default)]
    #[schemars(length(min = 1, max = 128))]
    pub content_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentUpdateInput {
    pub document: SpatialDocumentSpec,
    /// Reject an update planned against a different accepted document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub expected_fingerprint: Option<String>,
    #[serde(default)]
    #[schemars(length(max = 64))]
    pub revisions: Vec<SpatialDocumentAssetRevision>,
    /// Add distinct durable assets for explicit expression-local bindings.
    /// Existing asset versions change only through `revisions`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 64))]
    pub new_assets: Vec<SpatialDocumentAsset>,
    /// Replace complete expressions under their existing identity. Omitted
    /// expressions and historical assets remain part of the same work.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 32))]
    pub expressions: Vec<SpatialDocumentExpression>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentExpressionRevisionResult {
    pub id: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub previous_fingerprint: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub fingerprint: String,
    pub changed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SpatialDocumentExpressionKind {
    Scene3d,
    Material,
    Static,
    Interactive,
    Temporal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAssetRevisionResult {
    pub asset_id: String,
    pub previous_content_version: Option<String>,
    pub content_version: Option<String>,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentAffectedExpression {
    pub id: String,
    pub kind: SpatialDocumentExpressionKind,
    #[schemars(length(min = 1, max = 64))]
    pub bindings: Vec<SpatialDocumentBinding>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentUpdatePlan {
    #[schemars(schema_with = "spatial_document_update_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_document_version_schema")]
    pub version: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub previous_fingerprint: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub fingerprint: String,
    pub changed: bool,
    #[schemars(length(max = 64))]
    pub revisions: Vec<SpatialDocumentAssetRevisionResult>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 32))]
    pub expression_revisions: Vec<SpatialDocumentExpressionRevisionResult>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 64))]
    pub added_assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(max = 32))]
    pub affected_expressions: Vec<SpatialDocumentAffectedExpression>,
    pub document: SpatialDocumentSpec,
}

/// Compile selected expressions into their existing execution contracts. An
/// omitted selection means every expression; a supplied selection remains in
/// canonical document order rather than caller presentation order.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentDeliveryInput {
    pub document: SpatialDocumentSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    pub expected_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 32))]
    pub expression_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum SpatialDocumentDelivery {
    Scene3d {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        scene: crate::Scene3dPlan,
    },
    Material {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        material: SpatialMaterialDelivery,
    },
    /// A ready-to-run one-item Variation Job. Carriers still resolve each
    /// document asset ID to bytes under their own resource authority.
    Static {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        job: VariationJobSpec,
    },
    /// A validated Effect Recipe plus canonical media bindings. A live-effect
    /// carrier retains DOM/media ownership and evaluates state separately.
    Interactive {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        recipe_fingerprint: String,
        recipe: EffectRecipe,
    },
    /// A validated mockup-video Spec plus content bindings for every plane
    /// source. Native encode still resolves asset IDs to raster paths.
    Temporal {
        id: String,
        bindings: Vec<SpatialDocumentBinding>,
        video_fingerprint: String,
        video: MockupVideoSpec,
    },
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialDocumentDeliveryPlan {
    #[schemars(schema_with = "spatial_document_delivery_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_document_version_schema")]
    pub version: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub document_fingerprint: String,
    #[schemars(length(min = 1, max = 32))]
    pub deliveries: Vec<SpatialDocumentDelivery>,
}

/// Construct one reusable static document and its executable delivery from an
/// accepted Spatial Template. Carrier-specific projections use this shared
/// constructor instead of rebuilding document bindings independently.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialStaticDeliveryInput {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub expression_id: String,
    pub template: SpatialTemplateSpec,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(min = 1, max = 64))]
    pub bindings: Vec<SpatialDocumentBinding>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialStaticDelivery {
    #[schemars(schema_with = "spatial_static_delivery_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_static_delivery_version_schema")]
    pub version: String,
    pub expression_id: String,
    pub document: SpatialDocumentSpec,
    pub delivery_plan: SpatialDocumentDeliveryPlan,
}

/// Construct one reusable interactive document and its ready carrier delivery
/// from explicit accepted state. This is the shared semantic use case beneath
/// carrier-specific projections such as Figma continuation.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialInteractiveDeliveryInput {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub expression_id: String,
    pub recipe: EffectRecipe,
    pub initial_state: EffectState,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(min = 1, max = 64))]
    pub bindings: Vec<SpatialDocumentBinding>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialInteractiveDelivery {
    #[schemars(schema_with = "spatial_interactive_delivery_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_interactive_delivery_version_schema")]
    pub version: String,
    pub expression_id: String,
    pub initial_state: EffectState,
    pub document: SpatialDocumentSpec,
    pub delivery_plan: SpatialDocumentDeliveryPlan,
}

/// Construct one reusable temporal document and its ready mockup-video delivery
/// from an accepted multi-plane MockupVideoSpec.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialTemporalDeliveryInput {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub expression_id: String,
    pub video: MockupVideoSpec,
    #[schemars(length(min = 1, max = 64))]
    pub assets: Vec<SpatialDocumentAsset>,
    #[schemars(length(min = 1, max = 64))]
    pub bindings: Vec<SpatialDocumentBinding>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialTemporalDelivery {
    #[schemars(schema_with = "spatial_temporal_delivery_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_temporal_delivery_version_schema")]
    pub version: String,
    pub expression_id: String,
    pub document: SpatialDocumentSpec,
    pub delivery_plan: SpatialDocumentDeliveryPlan,
}

/// Encoded raster facts established by an upstream media/Figma provider.
/// Worldbend validates their bounded relationship to the spatial delivery; it
/// does not claim to have fetched or decoded the bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum SpatialInteractiveMediaFormat {
    Png,
    Jpeg,
    Webp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialInteractiveMedia {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub asset_id: String,
    pub format: SpatialInteractiveMediaFormat,
    #[schemars(length(min = 64, max = 64), regex(pattern = r"^[0-9a-f]{64}$"))]
    pub sha256: String,
    #[schemars(range(min = 1, max = 67108864))]
    pub encoded_bytes: u64,
    #[schemars(range(min = 1, max = 8192))]
    pub width: u32,
    #[schemars(range(min = 1, max = 8192))]
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialInteractiveMediaBundleInput {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub expression_id: String,
    pub recipe: EffectRecipe,
    pub initial_state: EffectState,
    #[schemars(length(min = 1, max = 64))]
    pub bindings: Vec<SpatialDocumentBinding>,
    #[schemars(length(min = 1, max = 64))]
    pub media: Vec<SpatialInteractiveMedia>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialInteractiveMediaBundle {
    #[schemars(schema_with = "spatial_interactive_media_bundle_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_interactive_media_bundle_version_schema")]
    pub version: String,
    #[schemars(schema_with = "spatial_document_fingerprint_schema")]
    pub fingerprint: String,
    pub expression_id: String,
    pub initial_state: EffectState,
    #[schemars(length(min = 1, max = 64))]
    pub media: Vec<SpatialInteractiveMedia>,
    pub document: SpatialDocumentSpec,
    pub delivery_plan: SpatialDocumentDeliveryPlan,
}

pub fn inspect_spatial_document(
    document: &SpatialDocumentSpec,
) -> TransformResult<SpatialDocumentInspection> {
    validate_header(&document.schema, &document.version)?;
    if document.assets.is_empty() || document.assets.len() > MAX_SPATIAL_DOCUMENT_ASSETS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document must declare 1..64 assets",
        ));
    }
    if document.expressions.is_empty()
        || document.expressions.len() > MAX_SPATIAL_DOCUMENT_EXPRESSIONS
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document must contain 1..32 expressions",
        ));
    }

    let mut asset_ids = HashSet::with_capacity(document.assets.len());
    for asset in &document.assets {
        validate_id(&asset.id, "Spatial Document asset id")?;
        validate_content_version(asset.content_version.as_deref())?;
        if !asset_ids.insert(asset.id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document asset ids must be unique",
            )
            .with_details(json!({ "id": asset.id })));
        }
    }

    let mut expression_ids = HashSet::with_capacity(document.expressions.len());
    let mut used_asset_ids = HashSet::new();
    let mut expressions = Vec::with_capacity(document.expressions.len());
    for expression in &document.expressions {
        validate_id(expression.id(), "Spatial Document expression id")?;
        if !expression_ids.insert(expression.id()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document expression ids must be unique",
            )
            .with_details(json!({ "id": expression.id() })));
        }
        match expression {
            SpatialDocumentExpression::Scene3d {
                id,
                scene,
                bindings,
            } => {
                let plan = crate::plan_scene3d(scene)?;
                let mut required = vec![(
                    SpatialDocumentBindingRole::Content,
                    scene.scene_slot.clone(),
                )];
                required.extend(
                    scene
                        .artworks
                        .iter()
                        .map(|a| (SpatialDocumentBindingRole::Content, a.slot_id.clone())),
                );
                let bindings =
                    validate_bindings(id, bindings, &required, &asset_ids, &mut used_asset_ids)?;
                expressions.push(SpatialDocumentExpressionInspection::Scene3d {
                    id: id.clone(),
                    bindings,
                    scene: plan,
                });
            }
            SpatialDocumentExpression::Material {
                id,
                material,
                bindings,
            } => {
                if bindings.is_empty() || bindings.len() > MAX_SPATIAL_DOCUMENT_BINDINGS {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "Material expression requires 1..64 receiving surfaces",
                    ));
                }
                // Surface slots are explicit receiver roles, not inferred from
                // material parameters. Content is retained by the receiver.
                let mut required = bindings
                    .iter()
                    .map(|binding| (SpatialDocumentBindingRole::Content, binding.slot_id.clone()))
                    .collect::<Vec<_>>();
                required.sort_by(|a, b| a.1.cmp(&b.1));
                let bindings =
                    validate_bindings(id, bindings, &required, &asset_ids, &mut used_asset_ids)?;
                let delivery = material.plan()?;
                let (family, fingerprint) = delivery.identity();
                expressions.push(SpatialDocumentExpressionInspection::Material {
                    id: id.clone(),
                    bindings,
                    family,
                    material_fingerprint: fingerprint.to_owned(),
                });
            }
            SpatialDocumentExpression::Static {
                id,
                template,
                bindings,
            } => {
                let inspected = inspect_spatial_template(template)?;
                let mut required = inspected
                    .source_slots
                    .iter()
                    .map(|slot| (SpatialDocumentBindingRole::Content, slot.clone()))
                    .collect::<Vec<_>>();
                if let crate::SpatialTemplateOperation::RasterProgram { program, .. } =
                    &template.operation
                {
                    for stage in &program.stages {
                        if let crate::RasterProgramStage::DeformationWork { id, spec } = stage
                            && spec
                                .shape_fit
                                .as_ref()
                                .is_some_and(|fit| fit.clip.is_some())
                            && bindings.iter().any(|binding| {
                                binding.role == SpatialDocumentBindingRole::FittingGuide
                                    && binding.slot_id == *id
                            })
                        {
                            required.push((SpatialDocumentBindingRole::FittingGuide, id.clone()));
                        }
                    }
                }
                let bindings =
                    validate_bindings(id, bindings, &required, &asset_ids, &mut used_asset_ids)?;
                expressions.push(SpatialDocumentExpressionInspection::Static {
                    id: id.clone(),
                    bindings,
                    template: inspected,
                });
            }
            SpatialDocumentExpression::Interactive {
                id,
                recipe,
                bindings,
            } => {
                let recipe = inspect_effect_recipe(recipe)?;
                let required = recipe
                    .source_slots
                    .iter()
                    .map(|slot| (SpatialDocumentBindingRole::Content, slot.clone()))
                    .chain(
                        recipe
                            .depth_map_slots
                            .iter()
                            .map(|slot| (SpatialDocumentBindingRole::DepthMap, slot.clone())),
                    )
                    .collect::<Vec<_>>();
                let bindings =
                    validate_bindings(id, bindings, &required, &asset_ids, &mut used_asset_ids)?;
                expressions.push(SpatialDocumentExpressionInspection::Interactive {
                    id: id.clone(),
                    bindings,
                    recipe,
                });
            }
            SpatialDocumentExpression::Temporal {
                id,
                video,
                bindings,
            } => {
                let plan = plan_mockup_video(video)?;
                let video_fingerprint = mockup_video_plan_fingerprint(&plan)?;
                let required = plan
                    .mockup_motion
                    .source_ids
                    .iter()
                    .map(|slot| (SpatialDocumentBindingRole::Content, slot.clone()))
                    .collect::<Vec<_>>();
                let bindings =
                    validate_bindings(id, bindings, &required, &asset_ids, &mut used_asset_ids)?;
                expressions.push(SpatialDocumentExpressionInspection::Temporal {
                    id: id.clone(),
                    bindings,
                    video_fingerprint,
                    source_ids: plan.mockup_motion.source_ids,
                });
            }
        }
    }

    let unused_asset_ids = document
        .assets
        .iter()
        .filter(|asset| !used_asset_ids.contains(asset.id.as_str()))
        .map(|asset| asset.id.clone())
        .collect();
    let fingerprint = spatial_document_fingerprint(document, &expressions)?;
    Ok(SpatialDocumentInspection {
        schema: SPATIAL_DOCUMENT_INSPECTION_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        fingerprint,
        assets: document.assets.clone(),
        expressions,
        unused_asset_ids,
    })
}

/// Assemble independently projected documents into one durable work envelope.
/// Asset equivalence and expression identity remain explicit caller decisions;
/// the core proves that the mapping is exhaustive, unambiguous and current.
pub fn plan_spatial_document_assembly(
    input: &SpatialDocumentAssemblyInput,
) -> TransformResult<SpatialDocumentAssemblyPlan> {
    if !(2..=MAX_SPATIAL_DOCUMENT_ASSEMBLY_DOCUMENTS).contains(&input.documents.len()) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must contain 2..32 source documents",
        ));
    }
    if input.assets.is_empty() || input.assets.len() > MAX_SPATIAL_DOCUMENT_ASSETS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must declare 1..64 target assets",
        ));
    }
    if input.expressions.is_empty() || input.expressions.len() > MAX_SPATIAL_DOCUMENT_EXPRESSIONS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must declare 1..32 target expressions",
        ));
    }
    let total_asset_members = input
        .assets
        .iter()
        .map(|asset| asset.members.len())
        .sum::<usize>();
    if total_asset_members > MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must contain at most 2048 source asset members in total",
        )
        .with_details(json!({
            "members": total_asset_members,
            "maximum": MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS,
        })));
    }

    let mut source_documents = Vec::with_capacity(input.documents.len());
    let mut document_indices = HashMap::with_capacity(input.documents.len());
    let mut source_assets = HashSet::new();
    let mut source_expressions = HashSet::new();
    for source in &input.documents {
        validate_id(&source.id, "Spatial Document assembly source document id")?;
        if document_indices
            .insert(source.id.clone(), source_documents.len())
            .is_some()
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly source document ids must be unique",
            )
            .with_details(json!({ "id": source.id })));
        }
        let inspection = inspect_spatial_document(&source.document)?;
        guard_expected_fingerprint(
            Some(&source.expected_fingerprint),
            &inspection.fingerprint,
            "planning assembly",
        )?;
        for asset in &source.document.assets {
            source_assets.insert((source.id.clone(), asset.id.clone()));
        }
        for expression in &source.document.expressions {
            source_expressions.insert((source.id.clone(), expression.id().to_owned()));
        }
        source_documents.push((source, inspection));
    }

    let mut asset_remap = HashMap::with_capacity(source_assets.len());
    let mut target_asset_ids = HashSet::with_capacity(input.assets.len());
    let mut normalized_assets = input.assets.clone();
    for target in &mut normalized_assets {
        validate_id(&target.id, "Spatial Document assembly target asset id")?;
        validate_content_version(target.content_version.as_deref())?;
        if !target_asset_ids.insert(target.id.clone()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly target asset ids must be unique",
            )
            .with_details(json!({ "id": target.id })));
        }
        if target.members.is_empty() || target.members.len() > MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly target asset must contain 1..2048 source members",
            )
            .with_details(json!({ "id": target.id })));
        }
        for member in &target.members {
            validate_id(
                &member.document_id,
                "Spatial Document assembly asset member document id",
            )?;
            validate_id(
                &member.asset_id,
                "Spatial Document assembly asset member asset id",
            )?;
            let source_key = (member.document_id.clone(), member.asset_id.clone());
            if !source_assets.contains(&source_key) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "Spatial Document assembly asset member references an undeclared source asset",
                )
                .with_details(json!({
                    "documentId": member.document_id,
                    "assetId": member.asset_id,
                })));
            }
            if let Some(previous_target_id) = asset_remap.insert(source_key, target.id.clone()) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "Spatial Document assembly must map each source asset exactly once",
                )
                .with_details(json!({
                    "documentId": member.document_id,
                    "assetId": member.asset_id,
                    "targetAssetIds": [previous_target_id, target.id],
                })));
            }
        }
        target.members.sort_by(|left, right| {
            (&left.document_id, &left.asset_id).cmp(&(&right.document_id, &right.asset_id))
        });
    }
    if asset_remap.len() != source_assets.len() {
        let mut missing = source_assets
            .difference(&asset_remap.keys().cloned().collect())
            .cloned()
            .collect::<Vec<_>>();
        missing.sort();
        missing.truncate(MAX_BINDING_DIAGNOSTIC_ITEMS);
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must map every source asset exactly once",
        )
        .with_details(json!({
            "mappedCount": asset_remap.len(),
            "sourceCount": source_assets.len(),
            "missing": missing.into_iter().map(|(document_id, asset_id)| json!({
                "documentId": document_id,
                "assetId": asset_id,
            })).collect::<Vec<_>>(),
        })));
    }
    normalized_assets.sort_by(|left, right| left.id.cmp(&right.id));

    let mut mapped_expressions = HashSet::with_capacity(input.expressions.len());
    let mut target_expression_ids = HashSet::with_capacity(input.expressions.len());
    let mut expressions = Vec::with_capacity(input.expressions.len());
    for target in &input.expressions {
        validate_id(&target.id, "Spatial Document assembly target expression id")?;
        validate_id(
            &target.document_id,
            "Spatial Document assembly expression document id",
        )?;
        validate_id(
            &target.expression_id,
            "Spatial Document assembly source expression id",
        )?;
        if !target_expression_ids.insert(target.id.clone()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly target expression ids must be unique",
            )
            .with_details(json!({ "id": target.id })));
        }
        let source_key = (target.document_id.clone(), target.expression_id.clone());
        if !source_expressions.contains(&source_key) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly expression references an undeclared source expression",
            )
            .with_details(json!({
                "documentId": target.document_id,
                "expressionId": target.expression_id,
            })));
        }
        if !mapped_expressions.insert(source_key) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document assembly must map each source expression exactly once",
            )
            .with_details(json!({
                "documentId": target.document_id,
                "expressionId": target.expression_id,
            })));
        }
        let source_index = document_indices[&target.document_id];
        let source = source_documents[source_index].0;
        let source_expression = source
            .document
            .expressions
            .iter()
            .find(|expression| expression.id() == target.expression_id)
            .expect("declared source expression must remain available");
        expressions.push(remap_assembled_expression(
            source_expression,
            &target.id,
            &target.document_id,
            &asset_remap,
        )?);
    }
    if mapped_expressions.len() != source_expressions.len() {
        let mapped = mapped_expressions.iter().cloned().collect::<HashSet<_>>();
        let mut missing = source_expressions
            .difference(&mapped)
            .cloned()
            .collect::<Vec<_>>();
        missing.sort();
        missing.truncate(MAX_BINDING_DIAGNOSTIC_ITEMS);
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document assembly must map every source expression exactly once",
        )
        .with_details(json!({
            "mappedCount": mapped_expressions.len(),
            "sourceCount": source_expressions.len(),
            "missing": missing.into_iter().map(|(document_id, expression_id)| json!({
                "documentId": document_id,
                "expressionId": expression_id,
            })).collect::<Vec<_>>(),
        })));
    }

    let document = SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        assets: normalized_assets
            .iter()
            .map(|asset| SpatialDocumentAsset {
                id: asset.id.clone(),
                content_version: asset.content_version.clone(),
            })
            .collect(),
        expressions,
    };
    let inspection = inspect_spatial_document(&document)?;
    let delivery_plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: document.clone(),
        expected_fingerprint: Some(inspection.fingerprint.clone()),
        expression_ids: None,
    })?;
    let mut documents = source_documents
        .into_iter()
        .map(
            |(source, inspection)| SpatialDocumentAssemblyDocumentResult {
                id: source.id.clone(),
                fingerprint: inspection.fingerprint,
            },
        )
        .collect::<Vec<_>>();
    documents.sort_by(|left, right| left.id.cmp(&right.id));

    Ok(SpatialDocumentAssemblyPlan {
        schema: SPATIAL_DOCUMENT_ASSEMBLY_PLAN_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        documents,
        assets: normalized_assets,
        expressions: input.expressions.clone(),
        document,
        delivery_plan,
    })
}

fn remap_assembled_expression(
    source: &SpatialDocumentExpression,
    target_id: &str,
    source_document_id: &str,
    asset_remap: &HashMap<(String, String), String>,
) -> TransformResult<SpatialDocumentExpression> {
    let remap_bindings = |bindings: &[SpatialDocumentBinding]| {
        bindings
            .iter()
            .map(|binding| {
                let key = (source_document_id.to_owned(), binding.asset_id.clone());
                let Some(asset_id) = asset_remap.get(&key) else {
                    return Err(TransformError::new(
                        ErrorCode::Internal,
                        "Spatial Document assembly lost a validated asset mapping",
                    ));
                };
                let mut binding = binding.clone();
                binding.asset_id = asset_id.clone();
                Ok(binding)
            })
            .collect::<TransformResult<Vec<_>>>()
    };
    match source {
        SpatialDocumentExpression::Scene3d {
            scene, bindings, ..
        } => Ok(SpatialDocumentExpression::Scene3d {
            id: target_id.to_owned(),
            scene: scene.clone(),
            bindings: remap_bindings(bindings)?,
        }),
        SpatialDocumentExpression::Material {
            material, bindings, ..
        } => Ok(SpatialDocumentExpression::Material {
            id: target_id.to_owned(),
            material: material.clone(),
            bindings: remap_bindings(bindings)?,
        }),
        SpatialDocumentExpression::Static {
            template, bindings, ..
        } => Ok(SpatialDocumentExpression::Static {
            id: target_id.to_owned(),
            template: template.clone(),
            bindings: remap_bindings(bindings)?,
        }),
        SpatialDocumentExpression::Interactive {
            recipe, bindings, ..
        } => Ok(SpatialDocumentExpression::Interactive {
            id: target_id.to_owned(),
            recipe: recipe.clone(),
            bindings: remap_bindings(bindings)?,
        }),
        SpatialDocumentExpression::Temporal {
            video, bindings, ..
        } => Ok(SpatialDocumentExpression::Temporal {
            id: target_id.to_owned(),
            video: video.clone(),
            bindings: remap_bindings(bindings)?,
        }),
    }
}

pub fn plan_spatial_document_update(
    input: &SpatialDocumentUpdateInput,
) -> TransformResult<SpatialDocumentUpdatePlan> {
    let current = inspect_spatial_document(&input.document)?;
    guard_expected_fingerprint(
        input.expected_fingerprint.as_deref(),
        &current.fingerprint,
        "planning an update",
    )?;
    if (input.revisions.is_empty() && input.expressions.is_empty() && input.new_assets.is_empty())
        || input.revisions.len() > MAX_SPATIAL_DOCUMENT_REVISIONS
        || input.expressions.len() > MAX_SPATIAL_DOCUMENT_EXPRESSIONS
        || input.new_assets.len() > MAX_SPATIAL_DOCUMENT_ASSETS
        || input.document.assets.len() + input.new_assets.len() > MAX_SPATIAL_DOCUMENT_ASSETS
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document update requires bounded asset or expression edits within document capacity",
        ));
    }

    let mut document = input.document.clone();
    let mut new_ids = HashSet::new();
    for asset in &input.new_assets {
        validate_id(&asset.id, "Spatial Document new asset id")?;
        validate_content_version(asset.content_version.as_deref())?;
        if !new_ids.insert(asset.id.as_str()) || document.assets.iter().any(|a| a.id == asset.id) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "New assets must have distinct undeclared identities; revise existing versions separately",
            ));
        }
    }
    // Add assets in canonical ID order, independently of edit presentation order.
    let mut added_assets = input.new_assets.clone();
    added_assets.sort_by(|a, b| a.id.cmp(&b.id));
    document.assets.extend(added_assets.clone());
    let mut expression_revisions = Vec::new();
    let mut changed_expression_ids = HashSet::new();
    let mut expression_ids = HashSet::new();
    for proposed in &input.expressions {
        if !expression_ids.insert(proposed.id()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Revise each expression at most once",
            ));
        }
        let Some(existing) = document
            .expressions
            .iter_mut()
            .find(|e| e.id() == proposed.id())
        else {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Expression revision must retain an existing identity",
            ));
        };
        *existing = proposed.clone();
    }
    // Validate the combined candidate, including new-asset references and all
    // untouched callers, before calculating impact or returning any edits.
    let candidate = inspect_spatial_document(&document)?;
    if candidate
        .unused_asset_ids
        .iter()
        .any(|id| new_ids.contains(id.as_str()))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "New assets must be bound in the revised work",
        ));
    }
    for (index, existing) in input.document.expressions.iter().enumerate() {
        if !expression_ids.contains(existing.id()) {
            continue;
        }
        let expression_fingerprint =
            |expression: &SpatialDocumentExpression,
             inspection: &SpatialDocumentExpressionInspection| {
                let mut expression = expression.clone();
                match &mut expression {
                    SpatialDocumentExpression::Scene3d { bindings, .. }
                    | SpatialDocumentExpression::Material { bindings, .. }
                    | SpatialDocumentExpression::Static { bindings, .. }
                    | SpatialDocumentExpression::Interactive { bindings, .. }
                    | SpatialDocumentExpression::Temporal { bindings, .. } => {
                        *bindings = inspection.bindings().to_vec()
                    }
                }
                canonical_json_value(&expression)
                    .and_then(|v| fingerprint_json_value(&v))
                    .map_err(|_| {
                        TransformError::new(
                            ErrorCode::Internal,
                            "Cannot fingerprint expression revision",
                        )
                    })
            };
        let previous_fingerprint = expression_fingerprint(existing, &current.expressions[index])?;
        let fingerprint =
            expression_fingerprint(&document.expressions[index], &candidate.expressions[index])?;
        let changed = previous_fingerprint != fingerprint;
        if changed {
            changed_expression_ids.insert(existing.id());
        } else {
            document.expressions[index] = existing.clone();
        }
        expression_revisions.push(SpatialDocumentExpressionRevisionResult {
            id: existing.id().to_owned(),
            previous_fingerprint,
            fingerprint,
            changed,
        });
    }
    let mut seen = HashSet::with_capacity(input.revisions.len());
    let mut changed_asset_ids = HashSet::with_capacity(input.revisions.len());
    let mut revisions = Vec::with_capacity(input.revisions.len());
    for revision in &input.revisions {
        validate_id(&revision.asset_id, "Spatial Document revision asset id")?;
        validate_content_version(revision.content_version.as_deref())?;
        if new_ids.contains(revision.asset_id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Declare a new asset's accepted version in newAssets, not revisions",
            ));
        }
        if !seen.insert(revision.asset_id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document update may revise each asset at most once",
            )
            .with_details(json!({ "assetId": revision.asset_id })));
        }
        let Some(asset) = document
            .assets
            .iter_mut()
            .find(|asset| asset.id == revision.asset_id)
        else {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document update references an undeclared asset",
            )
            .with_details(json!({ "assetId": revision.asset_id })));
        };
        let previous_content_version = asset.content_version.clone();
        let changed = previous_content_version != revision.content_version;
        if changed {
            changed_asset_ids.insert(revision.asset_id.clone());
            asset.content_version = revision.content_version.clone();
        }
        revisions.push(SpatialDocumentAssetRevisionResult {
            asset_id: revision.asset_id.clone(),
            previous_content_version,
            content_version: revision.content_version.clone(),
            changed,
        });
    }

    let affected_expressions = candidate
        .expressions
        .iter()
        .filter_map(|expression| {
            let bindings = expression
                .bindings()
                .iter()
                .filter(|binding| {
                    changed_expression_ids.contains(expression.id())
                        || changed_asset_ids.contains(&binding.asset_id)
                })
                .cloned()
                .collect::<Vec<_>>();
            (!bindings.is_empty()).then(|| SpatialDocumentAffectedExpression {
                id: expression.id().to_owned(),
                kind: expression.kind(),
                bindings,
            })
        })
        .collect();
    let updated = inspect_spatial_document(&document)?;
    let changed = current.fingerprint != updated.fingerprint;
    Ok(SpatialDocumentUpdatePlan {
        schema: SPATIAL_DOCUMENT_UPDATE_PLAN_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        previous_fingerprint: current.fingerprint,
        fingerprint: updated.fingerprint,
        changed,
        revisions,
        expression_revisions,
        added_assets,
        affected_expressions,
        document,
    })
}

pub fn plan_spatial_document_delivery(
    input: &SpatialDocumentDeliveryInput,
) -> TransformResult<SpatialDocumentDeliveryPlan> {
    let inspection = inspect_spatial_document(&input.document)?;
    guard_expected_fingerprint(
        input.expected_fingerprint.as_deref(),
        &inspection.fingerprint,
        "planning delivery",
    )?;

    let selected = match &input.expression_ids {
        None => None,
        Some(ids) => {
            if ids.is_empty() || ids.len() > MAX_SPATIAL_DOCUMENT_EXPRESSIONS {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "Spatial Document delivery selection must contain 1..32 expression ids",
                ));
            }
            let declared = input
                .document
                .expressions
                .iter()
                .map(SpatialDocumentExpression::id)
                .collect::<HashSet<_>>();
            let mut selected = HashSet::with_capacity(ids.len());
            for id in ids {
                validate_id(id, "Spatial Document delivery expression id")?;
                if !selected.insert(id.as_str()) {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "Spatial Document delivery may select each expression at most once",
                    )
                    .with_details(json!({ "id": id })));
                }
                if !declared.contains(id.as_str()) {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "Spatial Document delivery references an undeclared expression",
                    )
                    .with_details(json!({ "id": id })));
                }
            }
            Some(selected)
        }
    };

    let mut deliveries = Vec::with_capacity(
        selected
            .as_ref()
            .map_or(input.document.expressions.len(), HashSet::len),
    );
    for (expression, inspected) in input
        .document
        .expressions
        .iter()
        .zip(inspection.expressions.iter())
    {
        if selected
            .as_ref()
            .is_some_and(|ids| !ids.contains(expression.id()))
        {
            continue;
        }
        match (expression, inspected) {
            (
                SpatialDocumentExpression::Scene3d { id, .. },
                SpatialDocumentExpressionInspection::Scene3d {
                    bindings, scene, ..
                },
            ) => deliveries.push(SpatialDocumentDelivery::Scene3d {
                id: id.clone(),
                bindings: bindings.clone(),
                scene: scene.clone(),
            }),
            (
                SpatialDocumentExpression::Material { id, material, .. },
                SpatialDocumentExpressionInspection::Material { bindings, .. },
            ) => deliveries.push(SpatialDocumentDelivery::Material {
                id: id.clone(),
                bindings: bindings.clone(),
                material: material.plan()?,
            }),
            (
                SpatialDocumentExpression::Static { id, template, .. },
                SpatialDocumentExpressionInspection::Static { bindings, .. },
            ) => {
                let variation_bindings = bindings
                    .iter()
                    .filter(|binding| binding.role == SpatialDocumentBindingRole::Content)
                    .map(|binding| VariationBinding {
                        slot_id: binding.slot_id.clone(),
                        asset_id: binding.asset_id.clone(),
                    })
                    .collect();
                deliveries.push(SpatialDocumentDelivery::Static {
                    id: id.clone(),
                    bindings: bindings.clone(),
                    job: VariationJobSpec {
                        schema: VARIATION_JOB_SCHEMA.to_owned(),
                        version: SPATIAL_TEMPLATE_VERSION.to_owned(),
                        template: template.clone(),
                        failure_policy: VariationFailurePolicy::AllOrNone,
                        items: vec![VariationJobItem {
                            id: id.clone(),
                            bindings: variation_bindings,
                        }],
                    },
                });
            }
            (
                SpatialDocumentExpression::Interactive { id, recipe, .. },
                SpatialDocumentExpressionInspection::Interactive {
                    bindings,
                    recipe: inspected_recipe,
                    ..
                },
            ) => deliveries.push(SpatialDocumentDelivery::Interactive {
                id: id.clone(),
                bindings: bindings.clone(),
                recipe_fingerprint: inspected_recipe.fingerprint.clone(),
                recipe: recipe.clone(),
            }),
            (
                SpatialDocumentExpression::Temporal { id, video, .. },
                SpatialDocumentExpressionInspection::Temporal {
                    bindings,
                    video_fingerprint,
                    ..
                },
            ) => deliveries.push(SpatialDocumentDelivery::Temporal {
                id: id.clone(),
                bindings: bindings.clone(),
                video_fingerprint: video_fingerprint.clone(),
                video: video.clone(),
            }),
            _ => {
                return Err(TransformError::new(
                    ErrorCode::Internal,
                    "Spatial Document inspection order differed from its source expressions",
                ));
            }
        }
    }

    Ok(SpatialDocumentDeliveryPlan {
        schema: SPATIAL_DOCUMENT_DELIVERY_PLAN_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        document_fingerprint: inspection.fingerprint,
        deliveries,
    })
}

pub fn prepare_spatial_static_delivery(
    input: &SpatialStaticDeliveryInput,
) -> TransformResult<SpatialStaticDelivery> {
    validate_id(
        &input.expression_id,
        "Spatial static delivery expression id",
    )?;
    inspect_spatial_template(&input.template)?;

    let mut assets = input.assets.clone();
    assets.sort_by(|left, right| left.id.cmp(&right.id));
    let mut document = SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        assets,
        expressions: vec![SpatialDocumentExpression::Static {
            id: input.expression_id.clone(),
            template: input.template.clone(),
            bindings: input.bindings.clone(),
        }],
    };
    let inspection = inspect_spatial_document(&document)?;
    if !inspection.unused_asset_ids.is_empty() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial static delivery may not contain unbound assets",
        )
        .with_details(json!({ "unusedAssetIds": inspection.unused_asset_ids })));
    }
    let Some(SpatialDocumentExpressionInspection::Static { bindings, .. }) =
        inspection.expressions.first()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to inspect Spatial static delivery",
        ));
    };
    let Some(SpatialDocumentExpression::Static {
        bindings: document_bindings,
        ..
    }) = document.expressions.first_mut()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to canonicalize Spatial static delivery",
        ));
    };
    *document_bindings = bindings.clone();
    let canonical = inspect_spatial_document(&document)?;
    let delivery_plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: document.clone(),
        expected_fingerprint: Some(canonical.fingerprint),
        expression_ids: Some(vec![input.expression_id.clone()]),
    })?;

    Ok(SpatialStaticDelivery {
        schema: SPATIAL_STATIC_DELIVERY_SCHEMA.to_owned(),
        version: SPATIAL_STATIC_DELIVERY_VERSION.to_owned(),
        expression_id: input.expression_id.clone(),
        document,
        delivery_plan,
    })
}

pub fn prepare_spatial_interactive_delivery(
    input: &SpatialInteractiveDeliveryInput,
) -> TransformResult<SpatialInteractiveDelivery> {
    validate_id(
        &input.expression_id,
        "Spatial interactive delivery expression id",
    )?;
    let recipe_inspection = inspect_effect_recipe(&input.recipe)?;
    effect_plan(&EffectPlanInput {
        recipe: input.recipe.clone(),
        state: input.initial_state.clone(),
        motion: None,
        expected_fingerprint: Some(recipe_inspection.fingerprint),
    })?;

    let mut assets = input.assets.clone();
    assets.sort_by(|left, right| left.id.cmp(&right.id));
    let mut document = SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        assets,
        expressions: vec![SpatialDocumentExpression::Interactive {
            id: input.expression_id.clone(),
            recipe: input.recipe.clone(),
            bindings: input.bindings.clone(),
        }],
    };
    let inspection = inspect_spatial_document(&document)?;
    if !inspection.unused_asset_ids.is_empty() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial interactive delivery may not contain unbound assets",
        )
        .with_details(json!({ "unusedAssetIds": inspection.unused_asset_ids })));
    }
    let Some(SpatialDocumentExpressionInspection::Interactive { bindings, .. }) =
        inspection.expressions.first()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to inspect Spatial interactive delivery",
        ));
    };
    let Some(SpatialDocumentExpression::Interactive {
        bindings: document_bindings,
        ..
    }) = document.expressions.first_mut()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to canonicalize Spatial interactive delivery",
        ));
    };
    *document_bindings = bindings.clone();
    let canonical = inspect_spatial_document(&document)?;
    let delivery_plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: document.clone(),
        expected_fingerprint: Some(canonical.fingerprint),
        expression_ids: Some(vec![input.expression_id.clone()]),
    })?;

    Ok(SpatialInteractiveDelivery {
        schema: SPATIAL_INTERACTIVE_DELIVERY_SCHEMA.to_owned(),
        version: SPATIAL_INTERACTIVE_DELIVERY_VERSION.to_owned(),
        expression_id: input.expression_id.clone(),
        initial_state: input.initial_state.clone(),
        document,
        delivery_plan,
    })
}

pub fn prepare_spatial_temporal_delivery(
    input: &SpatialTemporalDeliveryInput,
) -> TransformResult<SpatialTemporalDelivery> {
    validate_id(
        &input.expression_id,
        "Spatial temporal delivery expression id",
    )?;
    let _ = plan_mockup_video(&input.video)?;

    let mut assets = input.assets.clone();
    assets.sort_by(|left, right| left.id.cmp(&right.id));
    let mut document = SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
        version: SPATIAL_DOCUMENT_VERSION.to_owned(),
        assets,
        expressions: vec![SpatialDocumentExpression::Temporal {
            id: input.expression_id.clone(),
            video: input.video.clone(),
            bindings: input.bindings.clone(),
        }],
    };
    let inspection = inspect_spatial_document(&document)?;
    if !inspection.unused_asset_ids.is_empty() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial temporal delivery may not contain unbound assets",
        )
        .with_details(json!({ "unusedAssetIds": inspection.unused_asset_ids })));
    }
    let Some(SpatialDocumentExpressionInspection::Temporal { bindings, .. }) =
        inspection.expressions.first()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to inspect Spatial temporal delivery",
        ));
    };
    let Some(SpatialDocumentExpression::Temporal {
        bindings: document_bindings,
        ..
    }) = document.expressions.first_mut()
    else {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "failed to canonicalize Spatial temporal delivery",
        ));
    };
    *document_bindings = bindings.clone();
    let canonical = inspect_spatial_document(&document)?;
    let delivery_plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: document.clone(),
        expected_fingerprint: Some(canonical.fingerprint),
        expression_ids: Some(vec![input.expression_id.clone()]),
    })?;

    Ok(SpatialTemporalDelivery {
        schema: SPATIAL_TEMPORAL_DELIVERY_SCHEMA.to_owned(),
        version: SPATIAL_TEMPORAL_DELIVERY_VERSION.to_owned(),
        expression_id: input.expression_id.clone(),
        document,
        delivery_plan,
    })
}

pub fn prepare_spatial_interactive_media_bundle(
    input: &SpatialInteractiveMediaBundleInput,
) -> TransformResult<SpatialInteractiveMediaBundle> {
    if input.recipe.version != "3" {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial interactive media bundles require a version-3 texture recipe",
        ));
    }
    if input.media.is_empty() || input.media.len() > MAX_SPATIAL_DOCUMENT_ASSETS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial interactive media bundle must contain 1..64 media assets",
        ));
    }

    let mut seen = HashSet::with_capacity(input.media.len());
    let mut media = input.media.clone();
    for item in &media {
        validate_id(&item.asset_id, "Spatial media asset id")?;
        validate_media_sha256(&item.sha256)?;
        if item.encoded_bytes == 0 || item.encoded_bytes > MAX_SPATIAL_MEDIA_ENCODED_BYTES {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Spatial media encoded bytes must be in 1..67108864",
            )
            .with_details(json!({ "assetId": item.asset_id })));
        }
        let pixels = u64::from(item.width).saturating_mul(u64::from(item.height));
        if item.width == 0
            || item.height == 0
            || item.width > MAX_SPATIAL_MEDIA_AXIS
            || item.height > MAX_SPATIAL_MEDIA_AXIS
            || pixels > MAX_SPATIAL_MEDIA_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Spatial media dimensions exceed 8192 pixels per axis or 16777216 pixels",
            )
            .with_details(json!({ "assetId": item.asset_id })));
        }
        if !seen.insert(item.asset_id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial interactive media asset ids must be unique",
            )
            .with_details(json!({ "assetId": item.asset_id })));
        }
    }
    media.sort_by(|left, right| left.asset_id.cmp(&right.asset_id));
    let assets = media
        .iter()
        .map(|item| SpatialDocumentAsset {
            id: item.asset_id.clone(),
            content_version: Some(format!("sha256:{}", item.sha256)),
        })
        .collect();
    let delivery = prepare_spatial_interactive_delivery(&SpatialInteractiveDeliveryInput {
        expression_id: input.expression_id.clone(),
        recipe: input.recipe.clone(),
        initial_state: input.initial_state.clone(),
        assets,
        bindings: input.bindings.clone(),
    })?;
    let fingerprint_value = canonical_json_value(&json!({
        "expressionId": &delivery.expression_id,
        "initialState": &delivery.initial_state,
        "documentFingerprint": &delivery.delivery_plan.document_fingerprint,
        "media": &media,
    }))
    .map_err(|_| {
        TransformError::new(
            ErrorCode::Schema,
            "invalid Spatial interactive media bundle fingerprint input",
        )
    })?;
    let fingerprint = fingerprint_json_value(&fingerprint_value).map_err(|_| {
        TransformError::new(
            ErrorCode::Internal,
            "failed to fingerprint Spatial interactive media bundle",
        )
    })?;

    Ok(SpatialInteractiveMediaBundle {
        schema: SPATIAL_INTERACTIVE_MEDIA_BUNDLE_SCHEMA.to_owned(),
        version: SPATIAL_INTERACTIVE_MEDIA_BUNDLE_VERSION.to_owned(),
        fingerprint,
        expression_id: delivery.expression_id,
        initial_state: delivery.initial_state,
        media,
        document: delivery.document,
        delivery_plan: delivery.delivery_plan,
    })
}

fn mockup_video_plan_fingerprint(plan: &MockupVideoPlan) -> TransformResult<String> {
    let value = canonical_json_value(plan).map_err(|_| {
        TransformError::new(
            ErrorCode::Schema,
            "invalid mockup-video plan fingerprint input",
        )
    })?;
    fingerprint_json_value(&value).map_err(|_| {
        TransformError::new(
            ErrorCode::Internal,
            "failed to fingerprint mockup-video plan",
        )
    })
}

fn spatial_document_fingerprint(
    document: &SpatialDocumentSpec,
    expressions: &[SpatialDocumentExpressionInspection],
) -> TransformResult<String> {
    let mut canonical = document.clone();
    canonical
        .assets
        .sort_by(|left, right| left.id.cmp(&right.id));
    for (expression, inspection) in canonical.expressions.iter_mut().zip(expressions) {
        let bindings = inspection.bindings().to_vec();
        match expression {
            SpatialDocumentExpression::Scene3d {
                bindings: target, ..
            }
            | SpatialDocumentExpression::Material {
                bindings: target, ..
            }
            | SpatialDocumentExpression::Static {
                bindings: target, ..
            }
            | SpatialDocumentExpression::Interactive {
                bindings: target, ..
            }
            | SpatialDocumentExpression::Temporal {
                bindings: target, ..
            } => *target = bindings,
        }
    }
    let value = canonical_json_value(&canonical).map_err(|_| {
        TransformError::new(
            ErrorCode::Schema,
            "invalid Spatial Document fingerprint input",
        )
    })?;
    fingerprint_json_value(&value).map_err(|_| {
        TransformError::new(
            ErrorCode::Internal,
            "failed to fingerprint Spatial Document",
        )
    })
}

fn validate_bindings(
    expression_id: &str,
    bindings: &[SpatialDocumentBinding],
    required: &[(SpatialDocumentBindingRole, String)],
    asset_ids: &HashSet<&str>,
    used_asset_ids: &mut HashSet<String>,
) -> TransformResult<Vec<SpatialDocumentBinding>> {
    if bindings.len() > MAX_SPATIAL_DOCUMENT_BINDINGS || bindings.len() != required.len() {
        return Err(binding_mismatch(
            expression_id,
            bindings,
            required,
            "Spatial Document expression must bind every required role and slot exactly once",
        ));
    }
    let required_set = required
        .iter()
        .map(|(role, slot)| (*role, slot.as_str()))
        .collect::<HashSet<_>>();
    let mut by_slot = HashMap::with_capacity(bindings.len());
    for binding in bindings {
        validate_id(&binding.slot_id, "Spatial Document binding slot id")?;
        validate_id(&binding.asset_id, "Spatial Document binding asset id")?;
        let key = (binding.role, binding.slot_id.as_str());
        if !required_set.contains(&key) {
            return Err(binding_mismatch(
                expression_id,
                bindings,
                required,
                "Spatial Document expression binds an unknown role or slot",
            ));
        }
        if by_slot.insert(key, binding).is_some() {
            return Err(binding_mismatch(
                expression_id,
                bindings,
                required,
                "Spatial Document expression binds one role and slot more than once",
            ));
        }
        if !asset_ids.contains(binding.asset_id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial Document binding references an undeclared asset",
            )
            .with_details(json!({
                "expressionId": expression_id,
                "assetId": binding.asset_id,
            })));
        }
    }

    let mut canonical = Vec::with_capacity(required.len());
    for (role, slot) in required {
        let Some(binding) = by_slot.get(&(*role, slot.as_str())) else {
            return Err(binding_mismatch(
                expression_id,
                bindings,
                required,
                "Spatial Document expression is missing a required role or slot",
            ));
        };
        canonical.push((*binding).clone());
        used_asset_ids.insert(binding.asset_id.clone());
    }
    Ok(canonical)
}

fn binding_mismatch(
    expression_id: &str,
    bindings: &[SpatialDocumentBinding],
    required: &[(SpatialDocumentBindingRole, String)],
    message: &'static str,
) -> TransformError {
    let provided = bindings
        .iter()
        .take(MAX_BINDING_DIAGNOSTIC_ITEMS)
        .map(|binding| {
            json!({
                "role": binding.role,
                "slotId": bounded_text(&binding.slot_id, MAX_BINDING_DIAGNOSTIC_CHARS),
                "assetId": bounded_text(&binding.asset_id, MAX_BINDING_DIAGNOSTIC_CHARS),
            })
        })
        .collect::<Vec<_>>();
    TransformError::new(ErrorCode::Schema, message).with_details(json!({
        "expressionId": expression_id,
        "required": required.iter().map(|(role, slot)| json!({
            "role": role,
            "slotId": slot,
        })).collect::<Vec<_>>(),
        "providedCount": bindings.len(),
        "provided": provided,
        "providedTruncated": bindings.len() > MAX_BINDING_DIAGNOSTIC_ITEMS,
    }))
}

fn validate_header(schema: &str, version: &str) -> TransformResult<()> {
    if schema != SPATIAL_DOCUMENT_SCHEMA {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported schema {:?}; expected {SPATIAL_DOCUMENT_SCHEMA:?}",
                bounded_text(schema, MAX_HEADER_ECHO_CHARS)
            ),
        ));
    }
    if version != SPATIAL_DOCUMENT_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported version {:?}; expected {SPATIAL_DOCUMENT_VERSION:?}",
                bounded_text(version, MAX_HEADER_ECHO_CHARS)
            ),
        ));
    }
    Ok(())
}

fn validate_id(id: &str, field: &'static str) -> TransformResult<()> {
    let valid = (1..=64).contains(&id.len())
        && id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if valid {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Schema,
        format!("{field} must match ^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$"),
    ))
}

fn validate_content_version(content_version: Option<&str>) -> TransformResult<()> {
    if content_version.is_some_and(|value| value.is_empty() || value.chars().count() > 128) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Document asset contentVersion must contain 1..128 characters",
        ));
    }
    Ok(())
}

fn validate_fingerprint(fingerprint: &str) -> TransformResult<()> {
    let valid = fingerprint.len() == 71
        && fingerprint.starts_with("sha256:")
        && fingerprint[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    if valid {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Schema,
        "Spatial Document expectedFingerprint must match ^sha256:[0-9a-f]{64}$",
    ))
}

fn validate_media_sha256(value: &str) -> TransformResult<()> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Schema,
        "Spatial media sha256 must match ^[0-9a-f]{64}$",
    ))
}

fn guard_expected_fingerprint(
    expected: Option<&str>,
    actual: &str,
    action: &str,
) -> TransformResult<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    validate_fingerprint(expected)?;
    if expected == actual {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Schema,
        format!(
            "Spatial Document fingerprint mismatch; inspect the current document before {action}"
        ),
    )
    .with_details(json!({
        "expectedFingerprint": expected,
        "actualFingerprint": actual,
    })))
}

fn spatial_document_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_SCHEMA })
}

fn spatial_document_inspection_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_INSPECTION_SCHEMA })
}

fn spatial_document_assembly_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_ASSEMBLY_PLAN_SCHEMA })
}

fn spatial_document_update_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_UPDATE_PLAN_SCHEMA })
}

fn spatial_document_delivery_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_DELIVERY_PLAN_SCHEMA })
}

fn spatial_static_delivery_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_STATIC_DELIVERY_SCHEMA })
}

fn spatial_static_delivery_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_STATIC_DELIVERY_VERSION })
}

fn spatial_interactive_delivery_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_INTERACTIVE_DELIVERY_SCHEMA })
}

fn spatial_interactive_media_bundle_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_INTERACTIVE_MEDIA_BUNDLE_SCHEMA })
}

fn spatial_interactive_delivery_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_INTERACTIVE_DELIVERY_VERSION })
}

fn spatial_interactive_media_bundle_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_INTERACTIVE_MEDIA_BUNDLE_VERSION })
}

fn spatial_temporal_delivery_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_TEMPORAL_DELIVERY_SCHEMA })
}

fn spatial_temporal_delivery_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_TEMPORAL_DELIVERY_VERSION })
}

fn spatial_document_fingerprint_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "minLength": 71,
        "maxLength": 71,
        "pattern": r"^sha256:[0-9a-f]{64}$",
    })
}

fn spatial_document_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_DOCUMENT_VERSION })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CANVAS_VERSION, CanvasBackground, CanvasOperation, CanvasSpec, EffectId, EffectRecipeInput,
        FrameRate, MOCKUP_MOTION_SCHEMA, MOCKUP_MOTION_VERSION, MOCKUP_VIDEO_SCHEMA,
        MockupMotionPlane, MockupMotionSpec, MotionEasing, MotionKeyframe, PixelSize, Point, Quad,
        RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION, RasterProgramSpec, RasterProgramStage,
        SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, Size, SpatialTemplateOperation,
        SpatialTemplateOutput, TransformSpec, VIDEO_VERSION, VideoEncoding, effect_recipe,
    };

    fn asset(id: &str) -> SpatialDocumentAsset {
        SpatialDocumentAsset {
            id: id.to_owned(),
            content_version: None,
        }
    }

    fn static_expression() -> SpatialDocumentExpression {
        SpatialDocumentExpression::Static {
            id: "release-still".to_owned(),
            template: SpatialTemplateSpec {
                schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
                version: SPATIAL_TEMPLATE_VERSION.to_owned(),
                operation: SpatialTemplateOperation::RasterProgram {
                    source_slot: "artwork".to_owned(),
                    program: RasterProgramSpec {
                        schema: RASTER_PROGRAM_SCHEMA.to_owned(),
                        version: RASTER_PROGRAM_VERSION.to_owned(),
                        stages: vec![RasterProgramStage::Canvas {
                            id: "fit".to_owned(),
                            spec: CanvasSpec {
                                schema: crate::CANVAS_SCHEMA.to_owned(),
                                version: CANVAS_VERSION.to_owned(),
                                operation: CanvasOperation::Contain {
                                    output: PixelSize::new(1200, 800),
                                    anchor: crate::NormalizedAnchor { x: 0.5, y: 0.5 },
                                    background: CanvasBackground::Transparent {},
                                },
                            },
                        }],
                    },
                },
                output: SpatialTemplateOutput::Single {
                    id: "hero".to_owned(),
                },
            },
            bindings: vec![SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: "artwork".to_owned(),
                asset_id: "product".to_owned(),
            }],
        }
    }

    fn interactive_expression() -> SpatialDocumentExpression {
        let recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::LayeredDepth,
            version: "1".to_owned(),
            viewport: Size::new(1200.0, 800.0),
            intensity: 0.7,
        })
        .unwrap();
        SpatialDocumentExpression::Interactive {
            id: "interactive-hero".to_owned(),
            recipe,
            bindings: vec![
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "background".to_owned(),
                    asset_id: "backdrop".to_owned(),
                },
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "middle".to_owned(),
                    asset_id: "details".to_owned(),
                },
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "foreground".to_owned(),
                    asset_id: "product".to_owned(),
                },
            ],
        }
    }

    fn document() -> SpatialDocumentSpec {
        SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![asset("product"), asset("backdrop"), asset("details")],
            expressions: vec![static_expression(), interactive_expression()],
        }
    }

    #[test]
    fn scene_source_and_shared_print_have_distinct_revision_impact_and_stale_guards() {
        let mut source = document();
        source.assets.push(asset("scene-source"));
        let expression: SpatialDocumentExpression = serde_json::from_value(json!({
            "kind":"scene3d","id":"paper-theatre",
            "scene":{"schema":"worldbend.scene3d","version":"0.1","sceneSlot":"scene","camera":"RevealCamera","animation":"RevealCamera","canvas":{"width":960,"height":720},"timebase":{"numerator":24,"denominator":1},"frameCount":96,"artworks":[{"slotId":"cover","material":"CoverPrint","surfaceSize":{"width":840,"height":1120},"fit":"contain"}],"backgroundRgb":[222,216,193],"exposure":1,"ambientIntensity":2},
            "bindings":[{"role":"content","slotId":"scene","assetId":"scene-source"},{"role":"content","slotId":"cover","assetId":"product"}]
        })).unwrap();
        source.expressions.push(expression);
        let before = inspect_spatial_document(&source).unwrap();
        let revise = |document, fingerprint, asset_id: &str, version: &str| {
            plan_spatial_document_update(&SpatialDocumentUpdateInput {
                document,
                expected_fingerprint: Some(fingerprint),
                revisions: vec![SpatialDocumentAssetRevision {
                    asset_id: asset_id.into(),
                    content_version: Some(version.into()),
                }],
                new_assets: vec![],
                expressions: vec![],
            })
        };
        let print = revise(
            source.clone(),
            before.fingerprint.clone(),
            "product",
            "print-v2",
        )
        .unwrap();
        assert_eq!(print.affected_expressions.len(), 3);
        let scene = revise(
            print.document.clone(),
            print.fingerprint.clone(),
            "scene-source",
            "camera-v2",
        )
        .unwrap();
        assert_eq!(scene.affected_expressions.len(), 1);
        assert_eq!(scene.affected_expressions[0].id, "paper-theatre");
        assert!(
            revise(
                scene.document.clone(),
                before.fingerprint,
                "product",
                "stale"
            )
            .is_err()
        );
        let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: scene.document,
            expected_fingerprint: Some(scene.fingerprint),
            expression_ids: Some(vec!["paper-theatre".into()]),
        })
        .unwrap();
        assert!(
            matches!(&delivery.deliveries[0],SpatialDocumentDelivery::Scene3d {scene,..} if scene.samples.len()==96 && scene.spec.artworks[0].slot_id=="cover")
        );
        let mut broken = source;
        if let SpatialDocumentExpression::Scene3d { bindings, .. } = &mut broken.expressions[2] {
            bindings.pop();
        }
        assert!(inspect_spatial_document(&broken).is_err());
    }

    #[test]
    fn shared_content_revision_redelivers_material_static_and_interactive_work_together() {
        let mut source = document();
        let material = crate::MeshGradientMaterial {
            warp: 0.6,
            ..Default::default()
        };
        source.expressions.push(serde_json::from_value(json!({
            "kind":"material", "id":"material-hero",
            "material":{"family":"mesh-gradient","input":{
                "recipe":{"schema":crate::MESH_GRADIENT_SCHEMA,"version":"0.1","recipeId":"shared-hero","recipeVersion":1,"material":crate::MeshGradientMaterial::default()},
                "material":material,"target":"web"
            }},
            "bindings":[{"role":"content","slotId":"hero","assetId":"product"}]
        })).unwrap());
        let current = inspect_spatial_document(&source).unwrap();
        let updated = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: source,
            expected_fingerprint: Some(current.fingerprint),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".into(),
                content_version: Some("next-week".into()),
            }],
            new_assets: vec![],
            expressions: vec![],
        })
        .unwrap();
        assert_eq!(
            updated
                .affected_expressions
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["release-still", "interactive-hero", "material-hero"]
        );
        let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: updated.document,
            expected_fingerprint: Some(updated.fingerprint),
            expression_ids: None,
        })
        .unwrap();
        assert!(matches!(
            delivery.deliveries[0],
            SpatialDocumentDelivery::Static { .. }
        ));
        assert!(matches!(
            delivery.deliveries[1],
            SpatialDocumentDelivery::Interactive { .. }
        ));
        let SpatialDocumentDelivery::Material {
            material: SpatialMaterialDelivery::MeshGradient { delivery },
            ..
        } = &delivery.deliveries[2]
        else {
            panic!()
        };
        assert_eq!(delivery.material, material);
    }

    fn fitted_document() -> SpatialDocumentSpec {
        let contour = json!({"start":{"x":0,"y":0},"segments":[{"kind":"line","to":{"x":1,"y":0}},{"kind":"line","to":{"x":1,"y":1}},{"kind":"line","to":{"x":0,"y":1}}]});
        let stage = serde_json::from_value(json!({"kind":"deformationWork","id":"fit","spec":{
            "schema":"worldbend.deformation-work","version":"0.1",
            "transform":crate::TransformSpec::normalized(crate::Quad::unit()),
            "targetSize":{"width":32,"height":24},"meshSubdivisions":4,
            "shapeFit":{"contour":contour,"clip":{"contours":[contour],"fillRule":"nonZero"}}
        }}))
        .unwrap();
        let mut expression = static_expression();
        let SpatialDocumentExpression::Static {
            template, bindings, ..
        } = &mut expression
        else {
            panic!()
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &mut template.operation
        else {
            panic!()
        };
        program.stages = vec![stage];
        bindings.push(SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::FittingGuide,
            slot_id: "fit".into(),
            asset_id: "guide".into(),
        });
        SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.into(),
            version: SPATIAL_DOCUMENT_VERSION.into(),
            assets: vec![
                asset("product"),
                SpatialDocumentAsset {
                    id: "guide".into(),
                    content_version: Some("guide-v1".into()),
                },
            ],
            expressions: vec![expression],
        }
    }

    #[test]
    fn fitted_document_dependencies_are_canonical_without_becoming_raster_inputs() {
        let doc = fitted_document();
        let inspected = inspect_spatial_document(&doc).unwrap();
        assert!(inspected.unused_asset_ids.is_empty());
        let mut reordered = doc.clone();
        let SpatialDocumentExpression::Static { bindings, .. } = &mut reordered.expressions[0]
        else {
            panic!()
        };
        bindings.reverse();
        assert_eq!(
            inspected.fingerprint,
            inspect_spatial_document(&reordered).unwrap().fingerprint
        );
        let plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: doc.clone(),
            expected_fingerprint: Some(inspected.fingerprint),
            expression_ids: None,
        })
        .unwrap();
        let SpatialDocumentDelivery::Static { bindings, job, .. } = &plan.deliveries[0] else {
            panic!()
        };
        assert_eq!(bindings.len(), 2);
        assert_eq!(bindings[1].role, SpatialDocumentBindingRole::FittingGuide);
        assert_eq!(job.items[0].bindings.len(), 1);
        assert_eq!(job.items[0].bindings[0].asset_id, "product");
        crate::plan_variation_job(job).unwrap();
        for case in 0..4 {
            let mut candidate = doc.clone();
            let SpatialDocumentExpression::Static {
                template, bindings, ..
            } = &mut candidate.expressions[0]
            else {
                panic!()
            };
            match case {
                0 => bindings[1].slot_id = "missing-stage".into(),
                1 => bindings[1].asset_id = "undeclared".into(),
                2 => bindings.push(bindings[1].clone()),
                _ => {
                    *template = match static_expression() {
                        SpatialDocumentExpression::Static { template, .. } => template,
                        _ => panic!(),
                    }
                }
            }
            assert!(inspect_spatial_document(&candidate).is_err(), "{case}");
        }
        let mut baked = doc;
        let SpatialDocumentExpression::Static { bindings, .. } = &mut baked.expressions[0] else {
            panic!()
        };
        bindings.pop();
        baked.assets.pop();
        inspect_spatial_document(&baked).unwrap();
    }

    #[test]
    fn assembly_preserves_shared_guide_dependencies_and_their_stage_identity() {
        let doc = fitted_document();
        let fingerprint = inspect_spatial_document(&doc).unwrap().fingerprint;
        let input = SpatialDocumentAssemblyInput {
            documents: ["a", "b"]
                .into_iter()
                .map(|id| SpatialDocumentAssemblyDocument {
                    id: id.into(),
                    document: doc.clone(),
                    expected_fingerprint: fingerprint.clone(),
                })
                .collect(),
            assets: [
                ("product", "shared-artwork", None),
                ("guide", "shared-guide", Some("guide-v1")),
            ]
            .into_iter()
            .map(|(source, id, version)| SpatialDocumentAssemblyAsset {
                id: id.into(),
                content_version: version.map(str::to_owned),
                members: ["a", "b"]
                    .into_iter()
                    .map(|document_id| SpatialDocumentAssemblyAssetMember {
                        document_id: document_id.into(),
                        asset_id: source.into(),
                    })
                    .collect(),
            })
            .collect(),
            expressions: ["a", "b"]
                .into_iter()
                .map(|id| SpatialDocumentAssemblyExpression {
                    id: format!("{id}-fit"),
                    document_id: id.into(),
                    expression_id: "release-still".into(),
                })
                .collect(),
        };
        let assembled = plan_spatial_document_assembly(&input).unwrap();
        let inspected = inspect_spatial_document(&assembled.document).unwrap();
        assert!(inspected.unused_asset_ids.is_empty());
        for expression in &inspected.expressions {
            let SpatialDocumentExpressionInspection::Static { bindings, .. } = expression else {
                panic!()
            };
            assert_eq!(bindings[1].role, SpatialDocumentBindingRole::FittingGuide);
            assert_eq!(bindings[1].slot_id, "fit");
            assert_eq!(bindings[1].asset_id, "shared-guide");
        }
    }

    #[test]
    fn guide_local_overrides_detach_only_the_selected_expression_from_later_shared_revisions() {
        let mut doc = fitted_document();
        let mut sibling = doc.expressions[0].clone();
        let SpatialDocumentExpression::Static { id, .. } = &mut sibling else {
            panic!()
        };
        *id = "other-fit".into();
        doc.expressions.push(sibling.clone());
        let SpatialDocumentExpression::Static { bindings, .. } = &mut sibling else {
            panic!()
        };
        bindings[1].asset_id = "local-guide".into();
        let local = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: doc.clone(),
            expected_fingerprint: Some(inspect_spatial_document(&doc).unwrap().fingerprint),
            revisions: vec![],
            new_assets: vec![SpatialDocumentAsset {
                id: "local-guide".into(),
                content_version: Some("local-v1".into()),
            }],
            expressions: vec![sibling],
        })
        .unwrap();
        assert_eq!(local.affected_expressions.len(), 1);
        assert_eq!(local.affected_expressions[0].id, "other-fit");
        let shared = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: local.document,
            expected_fingerprint: Some(local.fingerprint),
            new_assets: vec![],
            expressions: vec![],
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "guide".into(),
                content_version: Some("guide-v2".into()),
            }],
        })
        .unwrap();
        // Revision impact marks the authoring dependency. The caller must
        // recapture changed geometry; updating a version does not derive it.
        assert_eq!(shared.affected_expressions.len(), 1);
        assert_eq!(shared.affected_expressions[0].id, "release-still");
        assert_eq!(
            shared.affected_expressions[0].bindings[0].role,
            SpatialDocumentBindingRole::FittingGuide
        );
        assert_eq!(shared.affected_expressions[0].bindings[0].asset_id, "guide");
        let SpatialDocumentExpression::Static { bindings, .. } = &shared.document.expressions[1]
        else {
            panic!()
        };
        assert_eq!(bindings[1].asset_id, "local-guide");
    }

    #[test]
    fn expression_local_asset_override_survives_a_later_shared_revision() {
        let original = document();
        let fingerprint = inspect_spatial_document(&original).unwrap().fingerprint;
        let mut local = original.expressions[0].clone();
        let SpatialDocumentExpression::Static {
            template, bindings, ..
        } = &mut local
        else {
            panic!()
        };
        bindings[0].asset_id = "local-product".into();
        template.output = crate::SpatialTemplateOutput::Single {
            id: "local-banner".into(),
        };
        let planned = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: original.clone(),
            expected_fingerprint: Some(fingerprint.clone()),
            revisions: vec![],
            new_assets: vec![SpatialDocumentAsset {
                id: "local-product".into(),
                content_version: Some("local-1".into()),
            }],
            expressions: vec![local.clone()],
        })
        .unwrap();
        assert!(planned.changed);
        assert_eq!(planned.expression_revisions.len(), 1);
        assert_eq!(
            planned
                .affected_expressions
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["release-still"]
        );
        assert_eq!(
            json!(planned.document.expressions[1]),
            json!(original.expressions[1])
        );
        assert_eq!(planned.document.assets[..3], original.assets);
        let later = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: planned.document.clone(),
            expected_fingerprint: Some(planned.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".into(),
                content_version: Some("shared-2".into()),
            }],
            new_assets: vec![],
            expressions: vec![],
        })
        .unwrap();
        assert_eq!(
            later
                .affected_expressions
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["interactive-hero"]
        );
        assert_eq!(json!(later.document.expressions[0]), json!(local));
        let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: later.document,
            expected_fingerprint: Some(later.fingerprint),
            expression_ids: Some(vec!["release-still".into()]),
        })
        .unwrap();
        let SpatialDocumentDelivery::Static { job, .. } = &delivery.deliveries[0] else {
            panic!()
        };
        assert_eq!(job.items[0].bindings[0].asset_id, "local-product");
        assert_eq!(
            job.template.output,
            crate::SpatialTemplateOutput::Single {
                id: "local-banner".into()
            }
        );
        assert!(
            plan_spatial_document_update(&SpatialDocumentUpdateInput {
                document: planned.document,
                expected_fingerprint: Some(fingerprint),
                revisions: vec![],
                new_assets: vec![],
                expressions: vec![local],
            })
            .is_err()
        );
    }

    #[test]
    fn expression_revision_noops_and_atomic_combined_impact_use_canonical_bindings() {
        let original = document();
        let mut reordered = original.expressions[1].clone();
        let SpatialDocumentExpression::Interactive { bindings, .. } = &mut reordered else {
            panic!()
        };
        bindings.reverse();
        let mut input = SpatialDocumentUpdateInput {
            document: original.clone(),
            expected_fingerprint: Some(inspect_spatial_document(&original).unwrap().fingerprint),
            revisions: vec![],
            new_assets: vec![],
            expressions: vec![reordered],
        };
        let noop = plan_spatial_document_update(&input).unwrap();
        assert!(!noop.changed);
        assert!(noop.affected_expressions.is_empty());
        assert!(!noop.expression_revisions[0].changed);
        assert_eq!(json!(noop.document), json!(original));
        let mut changed = original.expressions[0].clone();
        let SpatialDocumentExpression::Static { template, .. } = &mut changed else {
            panic!()
        };
        template.output = crate::SpatialTemplateOutput::Single {
            id: "new-size".into(),
        };
        input.expressions.push(changed);
        input.revisions.push(SpatialDocumentAssetRevision {
            asset_id: "product".into(),
            content_version: Some("r2".into()),
        });
        let combined = plan_spatial_document_update(&input).unwrap();
        assert_eq!(
            combined
                .affected_expressions
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["release-still", "interactive-hero"]
        );
        assert_eq!(
            combined
                .expression_revisions
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>(),
            ["release-still", "interactive-hero"]
        );
        let old_wire = serde_json::to_value(
            plan_spatial_document_update(&SpatialDocumentUpdateInput {
                document: original,
                expected_fingerprint: None,
                revisions: input.revisions,
                new_assets: vec![],
                expressions: vec![],
            })
            .unwrap(),
        )
        .unwrap();
        assert!(old_wire.get("addedAssets").is_none());
        assert!(old_wire.get("expressionRevisions").is_none());
    }

    #[test]
    fn expression_update_rejects_invalid_candidates_without_changing_the_input() {
        let original = document();
        let accepted = json!(original);
        let base = SpatialDocumentUpdateInput {
            document: original.clone(),
            expected_fingerprint: None,
            revisions: vec![],
            new_assets: vec![],
            expressions: vec![original.expressions[0].clone()],
        };
        for case in [
            "duplicate",
            "unknown",
            "missing-binding",
            "existing-asset",
            "unbound-new",
            "duplicate-new",
            "ambiguous-version",
            "capacity",
        ] {
            let mut input = base.clone();
            match case {
                "duplicate" => input.expressions.push(input.expressions[0].clone()),
                "unknown" => {
                    let SpatialDocumentExpression::Static { id, .. } = &mut input.expressions[0]
                    else {
                        panic!()
                    };
                    *id = "missing".into();
                }
                "missing-binding" => {
                    let SpatialDocumentExpression::Static { bindings, .. } =
                        &mut input.expressions[0]
                    else {
                        panic!()
                    };
                    bindings[0].asset_id = "missing".into();
                }
                "existing-asset" => input.new_assets.push(asset("product")),
                "unbound-new" => input.new_assets.push(asset("local")),
                "duplicate-new" => input.new_assets = vec![asset("local"), asset("local")],
                "ambiguous-version" => {
                    input.new_assets.push(asset("local"));
                    let SpatialDocumentExpression::Static { bindings, .. } =
                        &mut input.expressions[0]
                    else {
                        panic!()
                    };
                    bindings[0].asset_id = "local".into();
                    input.revisions.push(SpatialDocumentAssetRevision {
                        asset_id: "local".into(),
                        content_version: Some("ambiguous".into()),
                    });
                }
                "capacity" => {
                    input.new_assets = (0..64).map(|i| asset(&format!("local-{i}"))).collect()
                }
                _ => unreachable!(),
            }
            assert!(plan_spatial_document_update(&input).is_err(), "{case}");
            assert_eq!(json!(input.document), accepted);
        }
    }

    fn assembly_input() -> SpatialDocumentAssemblyInput {
        let static_document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![asset("product")],
            expressions: vec![static_expression()],
        };
        let interactive_document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![asset("backdrop"), asset("details"), asset("product")],
            expressions: vec![interactive_expression()],
        };
        let static_fingerprint = inspect_spatial_document(&static_document)
            .unwrap()
            .fingerprint;
        let interactive_fingerprint = inspect_spatial_document(&interactive_document)
            .unwrap()
            .fingerprint;
        SpatialDocumentAssemblyInput {
            documents: vec![
                SpatialDocumentAssemblyDocument {
                    id: "composition".to_owned(),
                    document: static_document,
                    expected_fingerprint: static_fingerprint,
                },
                SpatialDocumentAssemblyDocument {
                    id: "depth".to_owned(),
                    document: interactive_document,
                    expected_fingerprint: interactive_fingerprint,
                },
            ],
            assets: vec![
                SpatialDocumentAssemblyAsset {
                    id: "hero-background".to_owned(),
                    content_version: Some("figma-preview:background".to_owned()),
                    members: vec![SpatialDocumentAssemblyAssetMember {
                        document_id: "depth".to_owned(),
                        asset_id: "backdrop".to_owned(),
                    }],
                },
                SpatialDocumentAssemblyAsset {
                    id: "hero-details".to_owned(),
                    content_version: Some("figma-preview:details".to_owned()),
                    members: vec![SpatialDocumentAssemblyAssetMember {
                        document_id: "depth".to_owned(),
                        asset_id: "details".to_owned(),
                    }],
                },
                SpatialDocumentAssemblyAsset {
                    id: "hero-product".to_owned(),
                    content_version: Some("figma-preview:product".to_owned()),
                    members: vec![
                        SpatialDocumentAssemblyAssetMember {
                            document_id: "depth".to_owned(),
                            asset_id: "product".to_owned(),
                        },
                        SpatialDocumentAssemblyAssetMember {
                            document_id: "composition".to_owned(),
                            asset_id: "product".to_owned(),
                        },
                    ],
                },
            ],
            expressions: vec![
                SpatialDocumentAssemblyExpression {
                    id: "release-still".to_owned(),
                    document_id: "composition".to_owned(),
                    expression_id: "release-still".to_owned(),
                },
                SpatialDocumentAssemblyExpression {
                    id: "interactive-hero".to_owned(),
                    document_id: "depth".to_owned(),
                    expression_id: "interactive-hero".to_owned(),
                },
            ],
        }
    }

    #[test]
    fn assembly_unifies_shared_assets_and_redelivers_every_affected_expression() {
        let plan = plan_spatial_document_assembly(&assembly_input()).unwrap();
        assert_eq!(plan.schema, SPATIAL_DOCUMENT_ASSEMBLY_PLAN_SCHEMA);
        assert_eq!(
            plan.documents
                .iter()
                .map(|document| document.id.as_str())
                .collect::<Vec<_>>(),
            ["composition", "depth"]
        );
        assert_eq!(
            plan.document
                .assets
                .iter()
                .map(|asset| asset.id.as_str())
                .collect::<Vec<_>>(),
            ["hero-background", "hero-details", "hero-product"]
        );
        assert_eq!(plan.document.expressions.len(), 2);
        assert_eq!(plan.delivery_plan.deliveries.len(), 2);

        let updated = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document: plan.document,
            expected_fingerprint: Some(plan.delivery_plan.document_fingerprint),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "hero-product".to_owned(),
                content_version: Some("figma-preview:product-v2".to_owned()),
            }],
        })
        .unwrap();
        assert_eq!(
            updated
                .affected_expressions
                .iter()
                .map(|expression| (expression.id.as_str(), expression.kind))
                .collect::<Vec<_>>(),
            [
                ("release-still", SpatialDocumentExpressionKind::Static),
                (
                    "interactive-hero",
                    SpatialDocumentExpressionKind::Interactive
                ),
            ]
        );
        let redelivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: updated.document,
            expected_fingerprint: Some(updated.fingerprint),
            expression_ids: None,
        })
        .unwrap();
        assert_eq!(redelivery.deliveries.len(), 2);
    }

    #[test]
    fn assembly_normalizes_source_and_asset_presentation_order() {
        let baseline = plan_spatial_document_assembly(&assembly_input()).unwrap();
        let mut reordered = assembly_input();
        reordered.documents.reverse();
        reordered.assets.reverse();
        for asset in &mut reordered.assets {
            asset.members.reverse();
        }
        let reordered = plan_spatial_document_assembly(&reordered).unwrap();
        assert_eq!(
            reordered.delivery_plan.document_fingerprint,
            baseline.delivery_plan.document_fingerprint
        );
        assert_eq!(
            serde_json::to_value(&reordered.assets).unwrap(),
            serde_json::to_value(&baseline.assets).unwrap()
        );
        assert_eq!(reordered.documents, baseline.documents);

        let mut expression_order = assembly_input();
        expression_order.expressions.reverse();
        let expression_order = plan_spatial_document_assembly(&expression_order).unwrap();
        assert_eq!(
            expression_order
                .delivery_plan
                .deliveries
                .iter()
                .map(|delivery| match delivery {
                    SpatialDocumentDelivery::Scene3d { id, .. }
                    | SpatialDocumentDelivery::Material { id, .. }
                    | SpatialDocumentDelivery::Static { id, .. }
                    | SpatialDocumentDelivery::Interactive { id, .. }
                    | SpatialDocumentDelivery::Temporal { id, .. } => id.as_str(),
                })
                .collect::<Vec<_>>(),
            ["interactive-hero", "release-still"]
        );
        assert_ne!(
            expression_order.delivery_plan.document_fingerprint,
            baseline.delivery_plan.document_fingerprint
        );
    }

    #[test]
    fn assembly_rejects_stale_ambiguous_incomplete_and_unknown_mappings() {
        let mut stale = assembly_input();
        stale.documents[0].expected_fingerprint = format!("sha256:{}", "0".repeat(64));
        let stale = plan_spatial_document_assembly(&stale).unwrap_err();
        assert_eq!(stale.code, ErrorCode::Schema);
        assert!(stale.message.contains("planning assembly"));

        let mut duplicate_document = assembly_input();
        duplicate_document.documents[1].id = "composition".to_owned();
        assert_eq!(
            plan_spatial_document_assembly(&duplicate_document)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut missing_asset = assembly_input();
        missing_asset.assets[0].members.clear();
        assert_eq!(
            plan_spatial_document_assembly(&missing_asset)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut duplicate_asset = assembly_input();
        let duplicated_member = duplicate_asset.assets[2].members[0].clone();
        duplicate_asset.assets[0].members.push(duplicated_member);
        assert_eq!(
            plan_spatial_document_assembly(&duplicate_asset)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut missing_expression = assembly_input();
        missing_expression.expressions.pop();
        assert_eq!(
            plan_spatial_document_assembly(&missing_expression)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut duplicate_target = assembly_input();
        duplicate_target.expressions[1].id = duplicate_target.expressions[0].id.clone();
        assert_eq!(
            plan_spatial_document_assembly(&duplicate_target)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut duplicate_target_asset = assembly_input();
        duplicate_target_asset.assets[1].id = duplicate_target_asset.assets[0].id.clone();
        assert_eq!(
            plan_spatial_document_assembly(&duplicate_target_asset)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut duplicate_source_expression = assembly_input();
        duplicate_source_expression.expressions[1].document_id = "composition".to_owned();
        duplicate_source_expression.expressions[1].expression_id = "release-still".to_owned();
        assert_eq!(
            plan_spatial_document_assembly(&duplicate_source_expression)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut unknown_asset = assembly_input();
        unknown_asset.assets[0].members[0].asset_id = "missing".to_owned();
        assert_eq!(
            plan_spatial_document_assembly(&unknown_asset)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut unknown = assembly_input();
        unknown.expressions[0].expression_id = "missing".to_owned();
        assert_eq!(
            plan_spatial_document_assembly(&unknown).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut too_many_documents = assembly_input();
        let template = too_many_documents.documents[0].clone();
        for index in 0..31 {
            let mut source = template.clone();
            source.id = format!("extra-{index}");
            too_many_documents.documents.push(source);
        }
        assert_eq!(
            plan_spatial_document_assembly(&too_many_documents)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut too_many_assets = assembly_input();
        let template = too_many_assets.assets[0].clone();
        for index in 0..62 {
            let mut target = template.clone();
            target.id = format!("extra-{index}");
            too_many_assets.assets.push(target);
        }
        assert_eq!(
            plan_spatial_document_assembly(&too_many_assets)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut too_many_expressions = assembly_input();
        let template = too_many_expressions.expressions[0].clone();
        for index in 0..31 {
            let mut target = template.clone();
            target.id = format!("extra-{index}");
            too_many_expressions.expressions.push(target);
        }
        assert_eq!(
            plan_spatial_document_assembly(&too_many_expressions)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut too_many_members = assembly_input();
        let member = too_many_members.assets[0].members[0].clone();
        too_many_members.assets[0].members = vec![member; MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS];
        let error = plan_spatial_document_assembly(&too_many_members).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(error.message.contains("source asset members in total"));
    }

    #[test]
    fn document_shares_one_asset_across_static_and_interactive_expressions() {
        let inspected = inspect_spatial_document(&document()).unwrap();
        assert_eq!(inspected.expressions.len(), 2);
        assert!(inspected.unused_asset_ids.is_empty());
        let SpatialDocumentExpressionInspection::Static { bindings, .. } =
            &inspected.expressions[0]
        else {
            panic!()
        };
        let SpatialDocumentExpressionInspection::Interactive { bindings: live, .. } =
            &inspected.expressions[1]
        else {
            panic!()
        };
        assert_eq!(bindings[0].asset_id, "product");
        assert_eq!(live[2].asset_id, "product");

        let mut with_unused = document();
        with_unused.assets.push(asset("spare"));
        assert_eq!(
            inspect_spatial_document(&with_unused)
                .unwrap()
                .unused_asset_ids,
            ["spare".to_owned()]
        );
    }

    #[test]
    fn static_delivery_is_the_shared_canonical_constructor() {
        let SpatialDocumentExpression::Static {
            template, bindings, ..
        } = static_expression()
        else {
            panic!()
        };
        let delivery = prepare_spatial_static_delivery(&SpatialStaticDeliveryInput {
            expression_id: "continued-composition".to_owned(),
            template,
            assets: vec![SpatialDocumentAsset {
                id: "product".to_owned(),
                content_version: Some("sha256:accepted".to_owned()),
            }],
            bindings,
        })
        .unwrap();

        assert_eq!(delivery.schema, SPATIAL_STATIC_DELIVERY_SCHEMA);
        assert_eq!(delivery.expression_id, "continued-composition");
        assert_eq!(delivery.document.assets[0].id, "product");
        assert_eq!(delivery.delivery_plan.deliveries.len(), 1);
        let SpatialDocumentDelivery::Static { id, bindings, job } =
            &delivery.delivery_plan.deliveries[0]
        else {
            panic!()
        };
        assert_eq!(id, "continued-composition");
        assert_eq!(bindings[0].slot_id, "artwork");
        assert_eq!(job.items[0].bindings[0].asset_id, "product");
        assert_eq!(
            delivery.delivery_plan.document_fingerprint,
            inspect_spatial_document(&delivery.document)
                .unwrap()
                .fingerprint
        );
    }

    #[test]
    fn document_rejects_missing_duplicate_and_undeclared_bindings() {
        let mut missing = document();
        let SpatialDocumentExpression::Interactive { bindings, .. } = &mut missing.expressions[1]
        else {
            panic!()
        };
        bindings.pop();
        assert_eq!(
            inspect_spatial_document(&missing).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut duplicate = document();
        duplicate.expressions.push(static_expression());
        assert_eq!(
            inspect_spatial_document(&duplicate).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut rebound_twice = document();
        let SpatialDocumentExpression::Interactive { bindings, .. } =
            &mut rebound_twice.expressions[1]
        else {
            panic!()
        };
        bindings[1] = bindings[0].clone();
        assert_eq!(
            inspect_spatial_document(&rebound_twice).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut unknown_role = document();
        let SpatialDocumentExpression::Interactive { bindings, .. } =
            &mut unknown_role.expressions[1]
        else {
            panic!()
        };
        bindings[0].role = SpatialDocumentBindingRole::DepthMap;
        assert_eq!(
            inspect_spatial_document(&unknown_role).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut undeclared = document();
        let SpatialDocumentExpression::Static { bindings, .. } = &mut undeclared.expressions[0]
        else {
            panic!()
        };
        bindings[0].asset_id = "not-declared".to_owned();
        assert_eq!(
            inspect_spatial_document(&undeclared).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn binding_mismatch_diagnostics_are_bounded() {
        let mut oversized = document();
        let SpatialDocumentExpression::Static { bindings, .. } = &mut oversized.expressions[0]
        else {
            panic!()
        };
        *bindings = (0..65)
            .map(|index| SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: format!("{}-{index}", "s".repeat(256)),
                asset_id: format!("{}-{index}", "a".repeat(256)),
            })
            .collect();

        let error = inspect_spatial_document(&oversized).unwrap_err();
        let details = error.details.unwrap();
        assert_eq!(details["providedCount"], 65);
        assert_eq!(details["providedTruncated"], true);
        assert_eq!(details["provided"].as_array().unwrap().len(), 8);
        assert_eq!(
            details["provided"][0]["slotId"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_BINDING_DIAGNOSTIC_CHARS
        );
        assert_eq!(
            details["provided"][0]["assetId"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            MAX_BINDING_DIAGNOSTIC_CHARS
        );
    }

    #[test]
    fn document_fingerprint_ignores_registry_and_binding_presentation_order() {
        let original = inspect_spatial_document(&document()).unwrap();
        let mut reordered = document();
        reordered.assets.reverse();
        let SpatialDocumentExpression::Interactive { bindings, .. } = &mut reordered.expressions[1]
        else {
            panic!()
        };
        bindings.reverse();
        assert_eq!(
            inspect_spatial_document(&reordered).unwrap().fingerprint,
            original.fingerprint
        );
    }

    #[test]
    fn update_plan_revises_one_asset_and_reports_every_affected_expression() {
        let document = document();
        let fingerprint = inspect_spatial_document(&document).unwrap().fingerprint;
        let plan = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document,
            expected_fingerprint: Some(fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".to_owned(),
                content_version: Some("release-2".to_owned()),
            }],
        })
        .unwrap();

        assert!(plan.changed);
        assert_eq!(plan.previous_fingerprint, fingerprint);
        assert_ne!(plan.fingerprint, plan.previous_fingerprint);
        assert_eq!(plan.revisions.len(), 1);
        assert!(plan.revisions[0].changed);
        assert_eq!(plan.affected_expressions.len(), 2);
        assert_eq!(plan.affected_expressions[0].id, "release-still");
        assert_eq!(
            plan.affected_expressions[0].kind,
            SpatialDocumentExpressionKind::Static
        );
        assert_eq!(plan.affected_expressions[0].bindings[0].slot_id, "artwork");
        assert_eq!(plan.affected_expressions[1].id, "interactive-hero");
        assert_eq!(
            plan.affected_expressions[1].kind,
            SpatialDocumentExpressionKind::Interactive
        );
        assert_eq!(
            plan.affected_expressions[1].bindings[0].slot_id,
            "foreground"
        );
        assert_eq!(
            plan.document
                .assets
                .iter()
                .find(|asset| asset.id == "product")
                .unwrap()
                .content_version
                .as_deref(),
            Some("release-2")
        );

        let replay = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document: plan.document.clone(),
            expected_fingerprint: Some(plan.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".to_owned(),
                content_version: Some("release-2".to_owned()),
            }],
        })
        .unwrap();
        assert!(!replay.changed);
        assert_eq!(replay.fingerprint, plan.fingerprint);
        assert!(replay.affected_expressions.is_empty());

        let cleared = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document: replay.document,
            expected_fingerprint: Some(replay.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".to_owned(),
                content_version: None,
            }],
        })
        .unwrap();
        assert!(cleared.changed);
        assert_eq!(
            cleared.revisions[0].previous_content_version.as_deref(),
            Some("release-2")
        );
        assert_eq!(cleared.revisions[0].content_version, None);
        assert_eq!(cleared.affected_expressions.len(), 2);
        assert_eq!(cleared.fingerprint, fingerprint);
    }

    #[test]
    fn update_plan_rejects_stale_duplicate_and_undeclared_revisions() {
        let document = document();
        let stale = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document: document.clone(),
            expected_fingerprint: Some(format!("sha256:{}", "0".repeat(64))),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product".to_owned(),
                content_version: Some("release-2".to_owned()),
            }],
        })
        .unwrap_err();
        assert_eq!(stale.code, ErrorCode::Schema);
        assert!(stale.message.contains("fingerprint mismatch"));

        let duplicate = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document: document.clone(),
            expected_fingerprint: None,
            revisions: vec![
                SpatialDocumentAssetRevision {
                    asset_id: "product".to_owned(),
                    content_version: Some("release-2".to_owned()),
                },
                SpatialDocumentAssetRevision {
                    asset_id: "product".to_owned(),
                    content_version: None,
                },
            ],
        })
        .unwrap_err();
        assert_eq!(duplicate.code, ErrorCode::Schema);

        let undeclared = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            new_assets: vec![],
            expressions: vec![],
            document,
            expected_fingerprint: None,
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "missing".to_owned(),
                content_version: Some("release-2".to_owned()),
            }],
        })
        .unwrap_err();
        assert_eq!(undeclared.code, ErrorCode::Schema);
    }

    #[test]
    fn delivery_plan_compiles_static_and_interactive_execution_inputs() {
        let document = document();
        let fingerprint = inspect_spatial_document(&document).unwrap().fingerprint;
        let plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document,
            expected_fingerprint: Some(fingerprint.clone()),
            expression_ids: Some(vec![
                "interactive-hero".to_owned(),
                "release-still".to_owned(),
            ]),
        })
        .unwrap();

        assert_eq!(plan.document_fingerprint, fingerprint);
        assert_eq!(plan.deliveries.len(), 2);
        let SpatialDocumentDelivery::Static { id, bindings, job } = &plan.deliveries[0] else {
            panic!()
        };
        assert_eq!(id, "release-still");
        assert_eq!(bindings[0].asset_id, "product");
        let job_plan = crate::plan_variation_job(job).unwrap();
        assert_eq!(job_plan.items[0].id, "release-still");
        assert_eq!(job_plan.items[0].bindings[0].slot_id, "artwork");
        assert_eq!(job_plan.items[0].bindings[0].asset_id, "product");

        let SpatialDocumentDelivery::Interactive {
            id,
            bindings,
            recipe_fingerprint,
            recipe,
        } = &plan.deliveries[1]
        else {
            panic!()
        };
        assert_eq!(id, "interactive-hero");
        assert_eq!(bindings[2].asset_id, "product");
        assert_eq!(
            recipe_fingerprint,
            &crate::inspect_effect_recipe(recipe).unwrap().fingerprint
        );
    }

    #[test]
    fn delivery_plan_rejects_stale_duplicate_empty_and_undeclared_selection() {
        let document = document();
        for expression_ids in [
            Some(Vec::new()),
            Some(vec!["release-still".to_owned(), "release-still".to_owned()]),
            Some(vec!["missing".to_owned()]),
        ] {
            assert_eq!(
                plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
                    document: document.clone(),
                    expected_fingerprint: None,
                    expression_ids,
                })
                .unwrap_err()
                .code,
                ErrorCode::Schema
            );
        }

        let stale = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document,
            expected_fingerprint: Some(format!("sha256:{}", "0".repeat(64))),
            expression_ids: None,
        })
        .unwrap_err();
        assert_eq!(stale.code, ErrorCode::Schema);
        assert!(stale.message.contains("planning delivery"));
    }

    #[test]
    fn document_requires_explicit_depth_map_asset_when_recipe_uses_one() {
        let mut recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "3".to_owned(),
            viewport: Size::new(1200.0, 800.0),
            intensity: 0.7,
        })
        .unwrap();
        let crate::EffectSurface::CameraPlane { depth_map, .. } = &mut recipe.layers[0].surface
        else {
            panic!()
        };
        *depth_map = Some(crate::EffectDepthMap {
            near_distance: 1200.0,
            far_distance: 1800.0,
        });
        recipe.origin = None;
        let mut spec = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![
                asset("background"),
                asset("middle"),
                asset("foreground"),
                asset("background-depth"),
            ],
            expressions: vec![SpatialDocumentExpression::Interactive {
                id: "camera".to_owned(),
                recipe,
                bindings: ["background", "middle", "foreground"]
                    .into_iter()
                    .map(|slot| SpatialDocumentBinding {
                        role: SpatialDocumentBindingRole::Content,
                        slot_id: slot.to_owned(),
                        asset_id: slot.to_owned(),
                    })
                    .collect(),
            }],
        };
        assert_eq!(
            inspect_spatial_document(&spec).unwrap_err().code,
            ErrorCode::Schema
        );
        let SpatialDocumentExpression::Interactive { bindings, .. } = &mut spec.expressions[0]
        else {
            panic!()
        };
        bindings.push(SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::DepthMap,
            slot_id: "background".to_owned(),
            asset_id: "background-depth".to_owned(),
        });
        assert!(inspect_spatial_document(&spec).is_ok());
    }

    fn camera_recipe() -> EffectRecipe {
        effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "3".to_owned(),
            viewport: Size::new(1200.0, 800.0),
            intensity: 0.7,
        })
        .unwrap()
    }

    fn camera_recipe_with_layers(count: usize) -> EffectRecipe {
        let mut recipe = camera_recipe();
        if count == 3 {
            return recipe;
        }
        let template = recipe.layers[0].clone();
        recipe.origin = None;
        recipe.layers = (0..count)
            .map(|index| {
                let mut layer = template.clone();
                layer.id = format!("layer-{}", index + 1);
                let crate::EffectSurface::CameraPlane { distance, .. } = &mut layer.surface else {
                    unreachable!()
                };
                *distance = 1800.0 - index as f64 * (1000.0 / (count - 1) as f64);
                layer
            })
            .collect();
        recipe
    }

    fn camera_bindings() -> Vec<SpatialDocumentBinding> {
        ["foreground", "background", "middle"]
            .into_iter()
            .map(|slot| SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: slot.to_owned(),
                asset_id: slot.to_owned(),
            })
            .collect()
    }

    fn media(asset_id: &str, hash: char) -> SpatialInteractiveMedia {
        SpatialInteractiveMedia {
            asset_id: asset_id.to_owned(),
            format: SpatialInteractiveMediaFormat::Png,
            sha256: hash.to_string().repeat(64),
            encoded_bytes: 1024,
            width: 1200,
            height: 800,
        }
    }

    fn media_bundle_input() -> SpatialInteractiveMediaBundleInput {
        SpatialInteractiveMediaBundleInput {
            expression_id: "hero".to_owned(),
            recipe: camera_recipe(),
            initial_state: EffectState {
                progress: 1.0,
                pointer_x: 0.1,
                pointer_y: -0.2,
                reduced_motion: false,
            },
            bindings: camera_bindings(),
            media: vec![
                media("middle", 'b'),
                media("foreground", 'c'),
                media("background", 'a'),
            ],
        }
    }

    #[test]
    fn interactive_delivery_is_the_shared_canonical_constructor() {
        let input = media_bundle_input();
        let delivery = prepare_spatial_interactive_delivery(&SpatialInteractiveDeliveryInput {
            expression_id: input.expression_id,
            recipe: input.recipe,
            initial_state: input.initial_state,
            assets: input
                .media
                .iter()
                .map(|item| SpatialDocumentAsset {
                    id: item.asset_id.clone(),
                    content_version: Some(format!("sha256:{}", item.sha256)),
                })
                .collect(),
            bindings: input.bindings,
        })
        .unwrap();
        assert_eq!(delivery.schema, SPATIAL_INTERACTIVE_DELIVERY_SCHEMA);
        assert_eq!(delivery.expression_id, "hero");
        assert_eq!(
            delivery
                .document
                .assets
                .iter()
                .map(|asset| asset.id.as_str())
                .collect::<Vec<_>>(),
            ["background", "foreground", "middle"]
        );
        let SpatialDocumentExpression::Interactive { bindings, .. } =
            &delivery.document.expressions[0]
        else {
            panic!()
        };
        assert_eq!(
            bindings
                .iter()
                .map(|binding| binding.slot_id.as_str())
                .collect::<Vec<_>>(),
            ["background", "middle", "foreground"]
        );
        assert_eq!(delivery.delivery_plan.deliveries.len(), 1);
    }

    #[test]
    fn interactive_delivery_preserves_five_arbitrarily_named_camera_layers() {
        let recipe = camera_recipe_with_layers(5);
        let slots = recipe
            .layers
            .iter()
            .map(|layer| layer.id.clone())
            .collect::<Vec<_>>();
        let input = SpatialInteractiveMediaBundleInput {
            expression_id: "five-plane-scene".to_owned(),
            recipe,
            initial_state: EffectState {
                progress: 1.0,
                pointer_x: 0.0,
                pointer_y: 0.0,
                reduced_motion: false,
            },
            bindings: slots
                .iter()
                .map(|slot| SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: slot.clone(),
                    asset_id: slot.clone(),
                })
                .collect(),
            media: slots
                .iter()
                .enumerate()
                .map(|(index, slot)| media(slot, char::from(b'a' + index as u8)))
                .collect(),
        };

        let bundle = prepare_spatial_interactive_media_bundle(&input).unwrap();
        let SpatialDocumentExpression::Interactive {
            recipe, bindings, ..
        } = &bundle.document.expressions[0]
        else {
            panic!()
        };
        assert_eq!(recipe.layers.len(), 5);
        assert_eq!(
            recipe
                .layers
                .iter()
                .map(|layer| layer.id.as_str())
                .collect::<Vec<_>>(),
            ["layer-1", "layer-2", "layer-3", "layer-4", "layer-5"]
        );
        assert_eq!(bindings.len(), 5);
        assert_eq!(bundle.media.len(), 5);
    }

    #[test]
    fn media_bundle_binds_content_hashes_and_is_order_stable() {
        let input = media_bundle_input();
        let bundle = prepare_spatial_interactive_media_bundle(&input).unwrap();
        assert_eq!(bundle.schema, SPATIAL_INTERACTIVE_MEDIA_BUNDLE_SCHEMA);
        assert_eq!(bundle.version, SPATIAL_INTERACTIVE_MEDIA_BUNDLE_VERSION);
        assert!(bundle.fingerprint.starts_with("sha256:"));
        assert_eq!(
            bundle
                .media
                .iter()
                .map(|item| item.asset_id.as_str())
                .collect::<Vec<_>>(),
            ["background", "foreground", "middle"]
        );
        let expected_background_version = format!("sha256:{}", "a".repeat(64));
        assert_eq!(
            bundle.document.assets[0].content_version.as_deref(),
            Some(expected_background_version.as_str())
        );

        let mut reordered = input.clone();
        reordered.media.reverse();
        reordered.bindings.reverse();
        let replay = prepare_spatial_interactive_media_bundle(&reordered).unwrap();
        assert_eq!(replay.fingerprint, bundle.fingerprint);
        assert_eq!(
            replay.delivery_plan.document_fingerprint,
            bundle.delivery_plan.document_fingerprint
        );

        let mut revised = input;
        revised.media[0].sha256 = "d".repeat(64);
        let revised = prepare_spatial_interactive_media_bundle(&revised).unwrap();
        assert_ne!(revised.fingerprint, bundle.fingerprint);
        assert_ne!(
            revised.delivery_plan.document_fingerprint,
            bundle.delivery_plan.document_fingerprint
        );
    }

    #[test]
    fn media_bundle_rejects_incomplete_duplicate_and_unbounded_media() {
        let mut missing = media_bundle_input();
        missing.media.pop();
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&missing)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut extra = media_bundle_input();
        extra.media.push(media("spare", 'd'));
        let error = prepare_spatial_interactive_media_bundle(&extra).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(error.message.contains("unbound assets"));

        let mut duplicate = media_bundle_input();
        duplicate.media[1].asset_id = duplicate.media[0].asset_id.clone();
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&duplicate)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut invalid_hash = media_bundle_input();
        invalid_hash.media[0].sha256 = "A".repeat(64);
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&invalid_hash)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let mut empty = media_bundle_input();
        empty.media[0].encoded_bytes = 0;
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&empty)
                .unwrap_err()
                .code,
            ErrorCode::OutputLimit
        );

        let mut oversized = media_bundle_input();
        oversized.media[0].width = 8192;
        oversized.media[0].height = 8192;
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&oversized)
                .unwrap_err()
                .code,
            ErrorCode::OutputLimit
        );

        let mut legacy = media_bundle_input();
        legacy.recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::LayeredDepth,
            version: "1".to_owned(),
            viewport: Size::new(1200.0, 800.0),
            intensity: 0.7,
        })
        .unwrap();
        assert_eq!(
            prepare_spatial_interactive_media_bundle(&legacy)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn brand_brief_product_screen_entry_plans_presentation_and_social_sizes() {
        use crate::{
            CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasBackground, CanvasOperation, CanvasSetSpec,
            CanvasVariant, PixelSize, RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION,
            RasterProgramSpec, RasterProgramStage, SPATIAL_TEMPLATE_SCHEMA,
            SPATIAL_TEMPLATE_VERSION, SpatialDocumentAssetRevision, SpatialDocumentDelivery,
            SpatialDocumentDeliveryInput, SpatialDocumentUpdateInput, SpatialTemplateOperation,
            SpatialTemplateOutput, Srgb8Space,
        };

        fn brand_contain(width: u32, height: u32) -> CanvasOperation {
            CanvasOperation::Contain {
                output: PixelSize::new(width, height),
                anchor: crate::NormalizedAnchor { x: 0.5, y: 0.5 },
                // Brand style materializes as the reusable canvas background.
                background: CanvasBackground::Color {
                    space: Srgb8Space::Srgb8,
                    rgba: [244, 243, 237, 255],
                },
            }
        }

        let document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![SpatialDocumentAsset {
                id: "product-screen".to_owned(),
                content_version: Some("week-01".to_owned()),
            }],
            expressions: vec![SpatialDocumentExpression::Static {
                id: "brand-brief".to_owned(),
                template: SpatialTemplateSpec {
                    schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
                    version: SPATIAL_TEMPLATE_VERSION.to_owned(),
                    operation: SpatialTemplateOperation::RasterProgram {
                        source_slot: "artwork".to_owned(),
                        program: RasterProgramSpec {
                            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
                            version: RASTER_PROGRAM_VERSION.to_owned(),
                            // Identity pass-through stage; sizes come from canvasSet.
                            stages: vec![RasterProgramStage::Canvas {
                                id: "brand-fit".to_owned(),
                                spec: crate::CanvasSpec {
                                    schema: crate::CANVAS_SCHEMA.to_owned(),
                                    version: CANVAS_VERSION.to_owned(),
                                    operation: brand_contain(1200, 800),
                                },
                            }],
                        },
                    },
                    output: SpatialTemplateOutput::CanvasSet {
                        spec: CanvasSetSpec {
                            schema: CANVAS_SET_SCHEMA.to_owned(),
                            version: CANVAS_VERSION.to_owned(),
                            variants: vec![
                                CanvasVariant {
                                    id: "website-presentation".to_owned(),
                                    operation: brand_contain(1200, 800),
                                },
                                CanvasVariant {
                                    id: "social-square".to_owned(),
                                    operation: brand_contain(1080, 1080),
                                },
                                CanvasVariant {
                                    id: "social-wide".to_owned(),
                                    operation: brand_contain(1200, 628),
                                },
                            ],
                        },
                    },
                },
                bindings: vec![SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "artwork".to_owned(),
                    asset_id: "product-screen".to_owned(),
                }],
            }],
        };

        let inspected = inspect_spatial_document(&document).unwrap();
        assert_eq!(inspected.expressions.len(), 1);
        assert_eq!(inspected.expressions[0].id(), "brand-brief");

        let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            expression_ids: None,
        })
        .unwrap();
        assert_eq!(delivery.deliveries.len(), 1);
        let SpatialDocumentDelivery::Static { job, .. } = &delivery.deliveries[0] else {
            panic!("brand brief entry is a static Variation Job");
        };
        let SpatialTemplateOutput::CanvasSet { spec } = &job.template.output else {
            panic!("brand brief publishes a canvas set");
        };
        assert_eq!(
            spec.variants
                .iter()
                .map(|v| v.id.as_str())
                .collect::<Vec<_>>(),
            ["website-presentation", "social-square", "social-wide"]
        );

        let weekly = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product-screen".to_owned(),
                content_version: Some("week-02".to_owned()),
            }],
            new_assets: vec![],
            expressions: vec![],
        })
        .unwrap();
        assert!(weekly.changed);
        assert_eq!(weekly.affected_expressions.len(), 1);
        assert_eq!(weekly.affected_expressions[0].id, "brand-brief");
        assert_eq!(
            weekly.document.assets[0].content_version.as_deref(),
            Some("week-02")
        );

        let stale = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: weekly.document,
            expected_fingerprint: Some(inspected.fingerprint),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product-screen".to_owned(),
                content_version: Some("week-03".to_owned()),
            }],
            new_assets: vec![],
            expressions: vec![],
        });
        assert!(
            stale.is_err(),
            "fresh session must reject a stale fingerprint"
        );
    }

    #[test]
    fn brand_brief_multistage_transform_then_plate_plans_presentation_and_social_sizes() {
        use crate::{
            CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasBackground, CanvasOperation, CanvasSetSpec,
            CanvasVariant, PixelSize, Point, Quad, RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION,
            RasterProgramCanvasMode, RasterProgramSpec, RasterProgramStage,
            SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, Size, SpatialDocumentAssetRevision,
            SpatialDocumentDelivery, SpatialDocumentDeliveryInput, SpatialDocumentUpdateInput,
            SpatialTemplateOperation, SpatialTemplateOutput, Srgb8Space, TransformSpec,
        };

        fn brand_contain(width: u32, height: u32) -> CanvasOperation {
            CanvasOperation::Contain {
                output: PixelSize::new(width, height),
                anchor: crate::NormalizedAnchor { x: 0.5, y: 0.5 },
                background: CanvasBackground::Color {
                    space: Srgb8Space::Srgb8,
                    rgba: [244, 243, 237, 255],
                },
            }
        }

        let document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![SpatialDocumentAsset {
                id: "product-screen".to_owned(),
                content_version: Some("week-01".to_owned()),
            }],
            expressions: vec![SpatialDocumentExpression::Static {
                id: "brand-brief-multistage".to_owned(),
                template: SpatialTemplateSpec {
                    schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
                    version: SPATIAL_TEMPLATE_VERSION.to_owned(),
                    operation: SpatialTemplateOperation::RasterProgram {
                        source_slot: "artwork".to_owned(),
                        program: RasterProgramSpec {
                            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
                            version: RASTER_PROGRAM_VERSION.to_owned(),
                            stages: vec![
                                RasterProgramStage::Transform {
                                    id: "screen-place".to_owned(),
                                    spec: TransformSpec::normalized(Quad::new(
                                        Point::new(0.04, 0.06),
                                        Point::new(0.96, 0.05),
                                        Point::new(0.95, 0.94),
                                        Point::new(0.05, 0.95),
                                    )),
                                    canvas: RasterProgramCanvasMode::Reference,
                                    target_size: Some(Size::new(1200.0, 800.0)),
                                },
                                RasterProgramStage::Canvas {
                                    id: "brand-plate".to_owned(),
                                    spec: crate::CanvasSpec {
                                        schema: crate::CANVAS_SCHEMA.to_owned(),
                                        version: CANVAS_VERSION.to_owned(),
                                        operation: brand_contain(1200, 800),
                                    },
                                },
                            ],
                        },
                    },
                    output: SpatialTemplateOutput::CanvasSet {
                        spec: CanvasSetSpec {
                            schema: CANVAS_SET_SCHEMA.to_owned(),
                            version: CANVAS_VERSION.to_owned(),
                            variants: vec![
                                CanvasVariant {
                                    id: "website-presentation".to_owned(),
                                    operation: brand_contain(1200, 800),
                                },
                                CanvasVariant {
                                    id: "social-square".to_owned(),
                                    operation: brand_contain(1080, 1080),
                                },
                                CanvasVariant {
                                    id: "social-wide".to_owned(),
                                    operation: brand_contain(1200, 628),
                                },
                            ],
                        },
                    },
                },
                bindings: vec![SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "artwork".to_owned(),
                    asset_id: "product-screen".to_owned(),
                }],
            }],
        };

        let inspected = inspect_spatial_document(&document).unwrap();
        assert_eq!(inspected.expressions[0].id(), "brand-brief-multistage");
        let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            expression_ids: None,
        })
        .unwrap();
        let SpatialDocumentDelivery::Static { job, .. } = &delivery.deliveries[0] else {
            panic!("multistage brand brief is a static Variation Job");
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &job.template.operation
        else {
            panic!();
        };
        assert_eq!(program.stages.len(), 2);
        assert!(matches!(
            &program.stages[0],
            RasterProgramStage::Transform { id, .. } if id == "screen-place"
        ));
        assert!(matches!(
            &program.stages[1],
            RasterProgramStage::Canvas { id, .. } if id == "brand-plate"
        ));
        let SpatialTemplateOutput::CanvasSet { spec } = &job.template.output else {
            panic!();
        };
        assert_eq!(
            spec.variants
                .iter()
                .map(|v| v.id.as_str())
                .collect::<Vec<_>>(),
            ["website-presentation", "social-square", "social-wide"]
        );

        let weekly = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product-screen".to_owned(),
                content_version: Some("week-02".to_owned()),
            }],
            new_assets: vec![],
            expressions: vec![],
        })
        .unwrap();
        assert_eq!(weekly.affected_expressions[0].id, "brand-brief-multistage");
        let stale = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: weekly.document,
            expected_fingerprint: Some(inspected.fingerprint),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "product-screen".to_owned(),
                content_version: Some("week-03".to_owned()),
            }],
            new_assets: vec![],
            expressions: vec![],
        });
        assert!(
            stale.is_err(),
            "stale fingerprint still rejects on multistage brief"
        );
    }

    fn motion_quad(x: f64) -> Quad {
        Quad::new(
            Point::new(x, 0.1),
            Point::new(x + 0.5, 0.1),
            Point::new(x + 0.5, 0.8),
            Point::new(x, 0.8),
        )
    }

    fn temporal_video() -> crate::MockupVideoSpec {
        let plane = |id: &str, source: &str, end: f64| MockupMotionPlane {
            id: id.into(),
            source_id: source.into(),
            base: TransformSpec::normalized(motion_quad(0.1)),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: motion_quad(0.1),
                    easing_to_next: Some(MotionEasing::Linear),
                },
                MotionKeyframe {
                    frame: 29,
                    quad: motion_quad(end),
                    easing_to_next: None,
                },
            ],
            opacity: 1.0,
            shadow: None,
            surface: None,
            grid: None,
            measurement: None,
        };
        crate::MockupVideoSpec {
            schema: MOCKUP_VIDEO_SCHEMA.into(),
            version: VIDEO_VERSION.into(),
            encoding: VideoEncoding::Mp4H264 { crf: 18 },
            background_rgb: [16, 22, 34],
            mockup_motion: MockupMotionSpec {
                schema: MOCKUP_MOTION_SCHEMA.into(),
                version: MOCKUP_MOTION_VERSION.into(),
                canvas: PixelSize {
                    width: 640,
                    height: 480,
                },
                timebase: FrameRate {
                    numerator: 30,
                    denominator: 1,
                },
                frame_count: 30,
                planes: vec![
                    plane("backdrop", "backdrop", 0.1),
                    plane("device", "device", 0.18),
                ],
                background: CanvasBackground::Transparent {},
                seams: vec![],
                clip: None,
                presentation: None,
            },
        }
    }

    fn temporal_expression() -> SpatialDocumentExpression {
        SpatialDocumentExpression::Temporal {
            id: "device-scene-video".to_owned(),
            video: temporal_video(),
            bindings: vec![
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "backdrop".to_owned(),
                    asset_id: "backdrop".to_owned(),
                },
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "device".to_owned(),
                    asset_id: "device".to_owned(),
                },
            ],
        }
    }

    #[test]
    fn temporal_expression_inspects_updates_and_delivers_mockup_video() {
        let document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![
                SpatialDocumentAsset {
                    id: "backdrop".to_owned(),
                    content_version: Some("v1".to_owned()),
                },
                SpatialDocumentAsset {
                    id: "device".to_owned(),
                    content_version: Some("v1".to_owned()),
                },
            ],
            expressions: vec![temporal_expression()],
        };
        let inspected = inspect_spatial_document(&document).unwrap();
        let SpatialDocumentExpressionInspection::Temporal {
            source_ids,
            video_fingerprint,
            bindings,
            ..
        } = &inspected.expressions[0]
        else {
            panic!("expected temporal inspection");
        };
        assert_eq!(source_ids, &["backdrop".to_owned(), "device".to_owned()]);
        assert!(video_fingerprint.starts_with("sha256:"));
        assert_eq!(bindings.len(), 2);

        let plan = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            expression_ids: None,
        })
        .unwrap();
        let SpatialDocumentDelivery::Temporal {
            id,
            video,
            video_fingerprint: delivery_fp,
            bindings: delivery_bindings,
        } = &plan.deliveries[0]
        else {
            panic!("expected temporal delivery");
        };
        assert_eq!(id, "device-scene-video");
        assert_eq!(delivery_fp, video_fingerprint);
        assert_eq!(delivery_bindings, bindings);
        assert_eq!(video.schema, MOCKUP_VIDEO_SCHEMA);

        let updated = plan_spatial_document_update(&SpatialDocumentUpdateInput {
            document: document.clone(),
            expected_fingerprint: Some(inspected.fingerprint.clone()),
            revisions: vec![SpatialDocumentAssetRevision {
                asset_id: "device".to_owned(),
                content_version: Some("v2".to_owned()),
            }],
            new_assets: vec![],
            expressions: vec![],
        })
        .unwrap();
        assert!(updated.changed);
        assert_eq!(updated.affected_expressions.len(), 1);
        assert_eq!(updated.affected_expressions[0].id, "device-scene-video");
        assert_eq!(
            updated.affected_expressions[0].kind,
            SpatialDocumentExpressionKind::Temporal
        );

        let prepared = prepare_spatial_temporal_delivery(&SpatialTemporalDeliveryInput {
            expression_id: "device-scene-video".to_owned(),
            video: temporal_video(),
            assets: vec![
                SpatialDocumentAsset {
                    id: "backdrop".to_owned(),
                    content_version: Some("v1".to_owned()),
                },
                SpatialDocumentAsset {
                    id: "device".to_owned(),
                    content_version: Some("v1".to_owned()),
                },
            ],
            bindings: vec![
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "device".to_owned(),
                    asset_id: "device".to_owned(),
                },
                SpatialDocumentBinding {
                    role: SpatialDocumentBindingRole::Content,
                    slot_id: "backdrop".to_owned(),
                    asset_id: "backdrop".to_owned(),
                },
            ],
        })
        .unwrap();
        assert_eq!(prepared.schema, SPATIAL_TEMPORAL_DELIVERY_SCHEMA);
        assert_eq!(prepared.delivery_plan.deliveries.len(), 1);
        let SpatialDocumentDelivery::Temporal { bindings, .. } =
            &prepared.delivery_plan.deliveries[0]
        else {
            panic!("prepared temporal delivery");
        };
        // Canonical slot order follows mockup-motion source discovery order.
        assert_eq!(
            bindings
                .iter()
                .map(|b| b.slot_id.as_str())
                .collect::<Vec<_>>(),
            ["backdrop", "device"]
        );
    }

    #[test]
    fn temporal_expression_rejects_missing_or_extra_plane_bindings() {
        let mut document = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![asset("backdrop"), asset("device")],
            expressions: vec![temporal_expression()],
        };
        let SpatialDocumentExpression::Temporal { bindings, .. } = &mut document.expressions[0]
        else {
            panic!()
        };
        bindings.pop();
        assert_eq!(
            inspect_spatial_document(&document).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut extra = SpatialDocumentSpec {
            schema: SPATIAL_DOCUMENT_SCHEMA.to_owned(),
            version: SPATIAL_DOCUMENT_VERSION.to_owned(),
            assets: vec![asset("backdrop"), asset("device"), asset("orphan")],
            expressions: vec![temporal_expression()],
        };
        let SpatialDocumentExpression::Temporal { bindings, .. } = &mut extra.expressions[0] else {
            panic!()
        };
        bindings.push(SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::Content,
            slot_id: "orphan".to_owned(),
            asset_id: "orphan".to_owned(),
        });
        assert_eq!(
            inspect_spatial_document(&extra).unwrap_err().code,
            ErrorCode::Schema
        );
    }
}

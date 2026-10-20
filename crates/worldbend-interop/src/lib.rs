//! Bounded, read-only ecosystem interoperability.
//!
//! This crate translates untrusted carrier data into existing Worldbend
//! contracts. It does not put third-party document semantics into the core.

use ag_psd::{
    ReadError,
    psd::{
        ColorMode, CustomEnvelopeWarp, Layer, LayerAdditionalInfo, PlacedLayer, ReadOptions, Units,
        UnitsBounds, UnitsValue, Warp, WarpStyle,
    },
    read_psd,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    panic::{AssertUnwindSafe, catch_unwind},
};
use worldbend_core::{
    CanvasBackground, ErrorCode, MOCKUP_SCHEMA, MOCKUP_VERSION, MockupPlane, MockupSpec, PixelSize,
    Point, PsdCurveWarp, PsdCurveWarpEnvelope, PsdCurveWarpProvenance, Quad,
    SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, Size, SpatialTemplateInspection,
    SpatialTemplateOperation, SpatialTemplateOutput, SpatialTemplateSpec, TransformError,
    TransformResult, TransformSpec, adopt_psd_curve_warp, bounded_text, inspect_spatial_template,
    validate_quad,
};

pub const PSD_SMART_OBJECT_REQUEST_SCHEMA: &str = "worldbend.psd-smart-object-request";
pub const PSD_SMART_OBJECT_INSPECTION_SCHEMA: &str = "worldbend.psd-smart-object-inspection";
pub const PSD_SMART_OBJECT_TEMPLATE_PLAN_SCHEMA: &str = "worldbend.psd-smart-object-template-plan";
pub const PSD_SMART_OBJECT_CURVE_WORK_PLAN_SCHEMA: &str = "worldbend.psd-curve-work-plan";
pub const PSD_SMART_OBJECT_VERSION: &str = "0.1";
pub const MAX_PSD_SOURCE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_PSD_LAYERS: usize = 256;
pub const MAX_PSD_LAYER_DEPTH: usize = 32;
pub const MAX_PSD_SMART_OBJECTS: usize = 64;
pub const MAX_PSD_TEMPLATE_OBJECTS: usize = 16;
/// Shared budget on retained collection items (descriptor items, list and
/// reference entries, object-array items) enforced by the vendored parser
/// before each item is read. Generous for real Photoshop documents; a
/// crafted file exhausts it into a typed rejection.
pub const PARSER_ITEM_BUDGET: usize = 262_144;
/// Cumulative budget for the parser's zero-filling recovery branch on byte
/// reads past the end of the file. Recovery buffers are retained by the
/// parsed document, so the budget is never refunded.
pub const PARSER_RECOVERY_ALLOCATION_BUDGET: usize = 4 * 1024 * 1024;

const PSD_HEADER_BYTES: usize = 26;
const PARSER_BITMAP_MEMORY_LIMIT: usize = 16 * 1024 * 1024;
const MAX_LAYER_NAME_CHARS: usize = 64;
const MAX_LINKED_ID_CHARS: usize = 256;
const WARP_EPSILON: f64 = 1e-9;
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn request_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PSD_SMART_OBJECT_REQUEST_SCHEMA })
}

fn inspection_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PSD_SMART_OBJECT_INSPECTION_SCHEMA })
}

fn template_plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PSD_SMART_OBJECT_TEMPLATE_PLAN_SCHEMA })
}

fn curve_work_plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PSD_SMART_OBJECT_CURVE_WORK_PLAN_SCHEMA })
}

fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PSD_SMART_OBJECT_VERSION })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PsdContainerFormat {
    Psd,
    Psb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum PsdColorMode {
    Bitmap,
    Grayscale,
    Indexed,
    Rgb,
    Cmyk,
    Multichannel,
    Duotone,
    Lab,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSourceFacts {
    pub format: PsdContainerFormat,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub sha256: String,
    pub document: PixelSize,
    pub bits_per_channel: u16,
    pub color_mode: PsdColorMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "reason", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectRejection {
    MissingTransform,
    NonFiniteTransform,
    MissingSourceSize,
    InvalidSourceSize,
    AlternateTransform,
    InvalidQuad {
        code: ErrorCode,
    },
    NonNeutralWarp,
    QuiltWarp,
    /// The layer carries warp sources that the parser's merge precedence
    /// (`SoLd` over `PlLd`, `quiltWarp` over plain `warp`) left out of the
    /// merged record while they still describe a deformation. Worldbend
    /// rejects instead of importing the merged, silently reduced warp.
    ConflictingWarpBlocks,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectImportability {
    Eligible,
    /// Adoptable `warpCustom` 4×4 curve: template planning cannot carry the
    /// warp, but `plan_curve_work` converts it into an editable deformation
    /// work with its controls and placement retained.
    CurveEligible,
    Unsupported {
        #[schemars(length(min = 1, max = 8))]
        reasons: Vec<PsdSmartObjectRejection>,
    },
}

/// The adoptable curve facts of one smart object, already in Photoshop pixel
/// space. `adopt_psd_curve_warp` owns the canonical conversion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectCurveFacts {
    pub u_order: u32,
    pub v_order: u32,
    pub envelope: PsdCurveWarpEnvelope,
    /// Sixteen controls, rows first from top-left, in source pixels.
    #[schemars(length(min = 16, max = 16))]
    pub controls: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectRecord {
    pub id: String,
    #[schemars(length(min = 1, max = 32))]
    pub layer_path: Vec<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photoshop_layer_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_size: Option<Size>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(max = 8))]
    pub raw_transform: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quad: Option<Quad>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curve: Option<PsdSmartObjectCurveFacts>,
    pub importability: PsdSmartObjectImportability,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectInspection {
    #[schemars(schema_with = "inspection_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub source: PsdSourceFacts,
    #[schemars(range(max = 256))]
    pub visited_layer_count: usize,
    #[schemars(length(max = 64))]
    pub smart_objects: Vec<PsdSmartObjectRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectOperation {
    Inspect,
    PlanTemplate {
        #[serde(rename = "smartObjectIds")]
        #[schemars(rename = "smartObjectIds")]
        #[schemars(length(min = 1, max = 16))]
        smart_object_ids: Vec<String>,
    },
    /// Adopt one curve-eligible object's `warpCustom` deformation as an
    /// editable canonical deformation work.
    PlanCurveWork {
        #[serde(rename = "smartObjectId")]
        #[schemars(rename = "smartObjectId")]
        smart_object_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectRequest {
    #[schemars(schema_with = "request_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub action: PsdSmartObjectOperation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectTemplateBinding {
    pub smart_object_id: String,
    pub source_slot: String,
    pub plane_id: String,
    #[schemars(length(min = 1, max = 32))]
    pub layer_path: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_asset_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectTemplatePlan {
    #[schemars(schema_with = "template_plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub source: PsdSourceFacts,
    #[schemars(length(min = 1, max = 16))]
    pub bindings: Vec<PsdSmartObjectTemplateBinding>,
    pub template: SpatialTemplateSpec,
    pub template_inspection: SpatialTemplateInspection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdSmartObjectCurveWorkPlan {
    #[schemars(schema_with = "curve_work_plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub source: PsdSourceFacts,
    pub smart_object_id: String,
    #[schemars(length(min = 1, max = 32))]
    pub layer_path: Vec<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photoshop_layer_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub linked_asset_id: Option<String>,
    pub curve: PsdSmartObjectCurveFacts,
    /// The canonical, fully editable work; its sixteen controls stay live in
    /// the Pin view and its boundary carries the adopted outline mode.
    pub work: worldbend_core::DeformationWorkSpec,
    pub provenance: PsdCurveWarpProvenance,
    /// Adopted structural losses of this conversion. The supported family
    /// keeps every control, handle and the placement, so this stays empty;
    /// future narrowings must record their loss here instead of hiding it.
    #[schemars(length(max = 8))]
    pub losses: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "result", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectResponse {
    Inspection {
        inspection: Box<PsdSmartObjectInspection>,
    },
    TemplatePlan {
        plan: Box<PsdSmartObjectTemplatePlan>,
    },
    CurveWorkPlan {
        plan: Box<PsdSmartObjectCurveWorkPlan>,
    },
}

pub fn execute_psd_smart_object_request(
    bytes: &[u8],
    request: &PsdSmartObjectRequest,
) -> TransformResult<PsdSmartObjectResponse> {
    validate_request(request)?;
    let inspection = inspect_psd_smart_objects(bytes)?;
    match &request.action {
        PsdSmartObjectOperation::Inspect => Ok(PsdSmartObjectResponse::Inspection {
            inspection: Box::new(inspection),
        }),
        PsdSmartObjectOperation::PlanTemplate { smart_object_ids } => {
            Ok(PsdSmartObjectResponse::TemplatePlan {
                plan: Box::new(plan_psd_smart_object_template(
                    &inspection,
                    smart_object_ids,
                )?),
            })
        }
        PsdSmartObjectOperation::PlanCurveWork { smart_object_id } => {
            Ok(PsdSmartObjectResponse::CurveWorkPlan {
                plan: Box::new(plan_psd_curve_work(&inspection, smart_object_id)?),
            })
        }
    }
}

pub fn inspect_psd_smart_objects(bytes: &[u8]) -> TransformResult<PsdSmartObjectInspection> {
    let header = inspect_header(bytes)?;
    if smart_object_descriptor_contains_key(bytes, b"filterFX") {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD Smart Filter descriptors are unsupported",
        ));
    }
    let options = ReadOptions {
        skip_layer_image_data: Some(true),
        skip_composite_image_data: Some(true),
        skip_thumbnail: Some(true),
        skip_linked_files_data: Some(true),
        total_memory_limit: Some(PARSER_BITMAP_MEMORY_LIMIT),
        // Pre-allocation budgets enforced by the vendored reader before it
        // reserves storage or recurses: a shared cap on retained collection
        // items, and a cumulative cap on the compatibility zero-fill branch
        // of byte reads past the end of the file. Both exhaust into typed
        // rejections instead of traps or unbounded allocation.
        parse_item_budget: Some(PARSER_ITEM_BUDGET),
        recovery_allocation_budget: Some(PARSER_RECOVERY_ALLOCATION_BUDGET),
        throw_for_missing_features: Some(true),
        log_missing_features: Some(false),
        use_image_data: Some(false),
        use_raw_data: Some(false),
        use_raw_thumbnail: Some(false),
        log_dev_features: Some(false),
        // Recovery reads stay enabled for compatibility; with the budgets
        // above the recovery branch is bounded, and every declared string
        // length is checked against the remaining bytes before reservation.
        strict: Some(false),
        debug: Some(false),
    };
    let psd = catch_unwind(AssertUnwindSafe(|| read_psd(bytes, &options)))
        .map_err(|_| {
            TransformError::new(
                ErrorCode::UnsupportedMedia,
                "PSD parser aborted while inspecting the document",
            )
        })?
        .map_err(map_read_error)?;
    let parsed_document = parse_integer_size(psd.width, psd.height).ok_or_else(|| {
        TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD parser returned invalid document dimensions",
        )
    })?;
    if parsed_document != header.document {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD header and parsed document dimensions disagree",
        ));
    }
    let parsed_mode = psd.color_mode.map(map_color_mode).ok_or_else(|| {
        TransformError::new(ErrorCode::UnsupportedMedia, "PSD color mode is missing")
    })?;
    if parsed_mode != header.color_mode {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD header and parsed color mode disagree",
        ));
    }

    let mut state = VisitState::default();
    if let Some(layers) = psd.children.as_deref() {
        visit_layers(layers, &[], 1, &mut state)?;
    }
    Ok(PsdSmartObjectInspection {
        schema: PSD_SMART_OBJECT_INSPECTION_SCHEMA.to_owned(),
        version: PSD_SMART_OBJECT_VERSION.to_owned(),
        source: PsdSourceFacts {
            format: header.format,
            bytes: bytes.len() as u64,
            sha256: hex::encode(Sha256::digest(bytes)),
            document: header.document,
            bits_per_channel: header.bits_per_channel,
            color_mode: header.color_mode,
        },
        visited_layer_count: state.visited_layer_count,
        smart_objects: state.smart_objects,
    })
}

pub fn plan_psd_smart_object_template(
    inspection: &PsdSmartObjectInspection,
    smart_object_ids: &[String],
) -> TransformResult<PsdSmartObjectTemplatePlan> {
    if inspection.schema != PSD_SMART_OBJECT_INSPECTION_SCHEMA
        || inspection.version != PSD_SMART_OBJECT_VERSION
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported PSD Smart Object inspection schema or version",
        ));
    }
    if smart_object_ids.is_empty() || smart_object_ids.len() > MAX_PSD_TEMPLATE_OBJECTS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "PSD Smart Object template selection must contain 1..16 ids",
        ));
    }
    let mut seen = HashSet::new();
    let mut selected = Vec::with_capacity(smart_object_ids.len());
    for id in smart_object_ids {
        if !seen.insert(id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "PSD Smart Object template selection ids must be unique",
            ));
        }
        let record = inspection
            .smart_objects
            .iter()
            .find(|record| record.id == *id)
            .ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "PSD Smart Object template selection contains an unknown id",
                )
                .with_details(json!({ "smartObjectId": bounded_text(id, 128) }))
            })?;
        if record.importability != PsdSmartObjectImportability::Eligible {
            return Err(TransformError::new(
                ErrorCode::UnsupportedMedia,
                if record.importability == PsdSmartObjectImportability::CurveEligible {
                    "selected PSD Smart Object carries a curve warp; template planning would discard it — adopt it as a curve work instead"
                } else {
                    "selected PSD Smart Object is not template-eligible"
                },
            )
            .with_details(json!({
                "smartObjectId": record.id,
                "importability": record.importability,
            })));
        }
        selected.push(record);
    }

    let planes = selected
        .iter()
        .enumerate()
        .map(|(index, record)| {
            let quad = record.quad.ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "eligible PSD Smart Object must contain a validated quad",
                )
                .with_details(json!({ "smartObjectId": record.id }))
            })?;
            Ok(MockupPlane {
                id: format!("plane-{:04}", index + 1),
                source_id: format!("source-{:04}", index + 1),
                transform: TransformSpec::pixel(inspection.source.document.as_size(), quad),
                opacity: 1.0,
                grid: None,
                measurement: None,
                surface: None,
                shadow: None,
            })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let mockup = MockupSpec {
        schema: MOCKUP_SCHEMA.to_owned(),
        version: MOCKUP_VERSION.to_owned(),
        canvas: inspection.source.document,
        background: CanvasBackground::Transparent {},
        planes,
        seams: Vec::new(),
        clip: None,
    };
    let template = SpatialTemplateSpec {
        schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
        version: SPATIAL_TEMPLATE_VERSION.to_owned(),
        operation: SpatialTemplateOperation::Mockup { spec: mockup },
        output: SpatialTemplateOutput::Single {
            id: "composite".to_owned(),
        },
    };
    let template_inspection = inspect_spatial_template(&template)?;
    let bindings = selected
        .iter()
        .enumerate()
        .map(|(index, record)| PsdSmartObjectTemplateBinding {
            smart_object_id: record.id.clone(),
            source_slot: format!("source-{:04}", index + 1),
            plane_id: format!("plane-{:04}", index + 1),
            layer_path: record.layer_path.clone(),
            linked_asset_id: record.linked_asset_id.clone(),
        })
        .collect();
    Ok(PsdSmartObjectTemplatePlan {
        schema: PSD_SMART_OBJECT_TEMPLATE_PLAN_SCHEMA.to_owned(),
        version: PSD_SMART_OBJECT_VERSION.to_owned(),
        source: inspection.source.clone(),
        bindings,
        template,
        template_inspection,
    })
}

pub fn plan_psd_curve_work(
    inspection: &PsdSmartObjectInspection,
    smart_object_id: &str,
) -> TransformResult<PsdSmartObjectCurveWorkPlan> {
    if inspection.schema != PSD_SMART_OBJECT_INSPECTION_SCHEMA
        || inspection.version != PSD_SMART_OBJECT_VERSION
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported PSD Smart Object inspection schema or version",
        ));
    }
    let record = inspection
        .smart_objects
        .iter()
        .find(|record| record.id == smart_object_id)
        .ok_or_else(|| {
            TransformError::new(
                ErrorCode::Schema,
                "PSD curve work selection contains an unknown id",
            )
            .with_details(json!({ "smartObjectId": bounded_text(smart_object_id, 128) }))
        })?;
    if record.importability != PsdSmartObjectImportability::CurveEligible {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "selected PSD Smart Object does not carry an adoptable curve warp",
        )
        .with_details(json!({
            "smartObjectId": record.id,
            "importability": record.importability,
        })));
    }
    let curve = record.curve.clone().ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            "curve-eligible record must carry curve facts",
        )
    })?;
    let quad = record.quad.ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            "curve-eligible record must contain a quad",
        )
    })?;
    let adoption = adopt_psd_curve_warp(&PsdCurveWarp {
        u_order: curve.u_order,
        v_order: curve.v_order,
        envelope: curve.envelope,
        controls: curve.controls.clone(),
        quad,
        document: inspection.source.document.as_size(),
    })?;
    // Planning here proves the adopted work is immediately editable, not just
    // structurally valid.
    worldbend_core::plan_deformation_work(&adoption.work)?;
    Ok(PsdSmartObjectCurveWorkPlan {
        schema: PSD_SMART_OBJECT_CURVE_WORK_PLAN_SCHEMA.to_owned(),
        version: PSD_SMART_OBJECT_VERSION.to_owned(),
        source: inspection.source.clone(),
        smart_object_id: record.id.clone(),
        layer_path: record.layer_path.clone(),
        name: record.name.clone(),
        photoshop_layer_id: record.photoshop_layer_id,
        linked_asset_id: record.linked_asset_id.clone(),
        curve,
        work: adoption.work,
        provenance: adoption.provenance,
        losses: Vec::new(),
    })
}

fn validate_request(request: &PsdSmartObjectRequest) -> TransformResult<()> {
    if request.schema != PSD_SMART_OBJECT_REQUEST_SCHEMA
        || request.version != PSD_SMART_OBJECT_VERSION
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported PSD Smart Object request schema or version",
        )
        .with_details(json!({
            "expectedSchema": PSD_SMART_OBJECT_REQUEST_SCHEMA,
            "expectedVersion": PSD_SMART_OBJECT_VERSION,
        })));
    }
    Ok(())
}

struct HeaderFacts {
    format: PsdContainerFormat,
    document: PixelSize,
    bits_per_channel: u16,
    color_mode: PsdColorMode,
}

fn inspect_header(bytes: &[u8]) -> TransformResult<HeaderFacts> {
    if bytes.len() > MAX_PSD_SOURCE_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "PSD/PSB source exceeds the 64 MiB inspection limit",
        ));
    }
    if bytes.len() < PSD_HEADER_BYTES || &bytes[..4] != b"8BPS" {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source is not a complete PSD/PSB header",
        ));
    }
    let version = u16::from_be_bytes([bytes[4], bytes[5]]);
    let (format, max_axis) = match version {
        1 => (PsdContainerFormat::Psd, 30_000),
        2 => (PsdContainerFormat::Psb, 300_000),
        _ => {
            return Err(TransformError::new(
                ErrorCode::UnsupportedMedia,
                "PSD/PSB header version is unsupported",
            ));
        }
    };
    let height = u32::from_be_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]);
    let width = u32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);
    if width == 0 || height == 0 || width > max_axis || height > max_axis {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD/PSB document dimensions exceed the format boundary",
        ));
    }
    let bits_per_channel = u16::from_be_bytes([bytes[22], bytes[23]]);
    if !matches!(bits_per_channel, 1 | 8 | 16 | 32) {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD/PSB bit depth is unsupported",
        ));
    }
    let color_mode = map_color_mode_code(u16::from_be_bytes([bytes[24], bytes[25]]))?;
    Ok(HeaderFacts {
        format,
        document: PixelSize::new(width, height),
        bits_per_channel,
        color_mode,
    })
}

#[derive(Default)]
struct VisitState {
    visited_layer_count: usize,
    smart_objects: Vec<PsdSmartObjectRecord>,
}

fn visit_layers(
    layers: &[Layer],
    parent_path: &[String],
    depth: usize,
    state: &mut VisitState,
) -> TransformResult<()> {
    if depth > MAX_PSD_LAYER_DEPTH {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "PSD layer nesting exceeds 32 levels",
        ));
    }
    for layer in layers {
        state.visited_layer_count += 1;
        if state.visited_layer_count > MAX_PSD_LAYERS {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "PSD inspection exceeds 256 layers",
            ));
        }
        let name = layer
            .additional_info
            .name
            .as_deref()
            .filter(|name| !name.is_empty())
            .map(|name| bounded_text(name, MAX_LAYER_NAME_CHARS))
            .unwrap_or_else(|| format!("Layer {}", state.visited_layer_count));
        let mut path = parent_path.to_vec();
        path.push(name.clone());
        if let Some(placed) = layer.additional_info.placed_layer.as_ref() {
            if state.smart_objects.len() >= MAX_PSD_SMART_OBJECTS {
                return Err(TransformError::new(
                    ErrorCode::OutputLimit,
                    "PSD inspection exceeds 64 Smart Objects",
                ));
            }
            state.smart_objects.push(build_record(
                layer,
                placed,
                path.clone(),
                state.smart_objects.len(),
            ));
        }
        if let Some(children) = layer.children.as_deref() {
            visit_layers(children, &path, depth + 1, state)?;
        }
    }
    Ok(())
}

fn build_record(
    layer: &Layer,
    placed: &PlacedLayer,
    layer_path: Vec<String>,
    index: usize,
) -> PsdSmartObjectRecord {
    let name = layer_path.last().cloned().unwrap_or_default();
    let photoshop_layer_id = layer
        .additional_info
        .id
        .filter(|value| value.is_finite() && value.fract() == 0.0)
        .and_then(|value| {
            if value >= i64::MIN as f64 && value <= i64::MAX as f64 {
                Some(value as i64)
            } else {
                None
            }
        });
    let linked_asset_id =
        (!placed.id.is_empty()).then(|| bounded_text(&placed.id, MAX_LINKED_ID_CHARS));
    let source_size = match (placed.width, placed.height) {
        (Some(width), Some(height)) if width.is_finite() && height.is_finite() => {
            Some(Size::new(width, height))
        }
        _ => None,
    };
    let quad = quad_from_transform(&placed.transform);
    let curve = curve_warp_facts(placed, source_size);
    let reasons = import_rejections(&layer.additional_info, placed, source_size, quad);
    let importability = if reasons.is_empty() {
        PsdSmartObjectImportability::Eligible
    } else if curve.is_some() && reasons == vec![PsdSmartObjectRejection::NonNeutralWarp] {
        // The only rejection of an adoptable curve is the warp itself, which
        // template planning cannot carry but curve adoption converts.
        PsdSmartObjectImportability::CurveEligible
    } else {
        PsdSmartObjectImportability::Unsupported { reasons }
    };
    PsdSmartObjectRecord {
        id: format!("smart-object-{:04}", index + 1),
        layer_path,
        name,
        photoshop_layer_id,
        linked_asset_id,
        source_size,
        raw_transform: placed
            .transform
            .iter()
            .all(|value| value.is_finite())
            .then(|| placed.transform.iter().copied().take(8).collect()),
        quad,
        curve,
        importability,
    }
}

fn import_rejections(
    additional: &LayerAdditionalInfo,
    placed: &PlacedLayer,
    source_size: Option<Size>,
    quad: Option<Quad>,
) -> Vec<PsdSmartObjectRejection> {
    let mut reasons = Vec::new();
    if placed.transform.len() != 8 {
        reasons.push(PsdSmartObjectRejection::MissingTransform);
    } else if placed.transform.iter().any(|value| !value.is_finite()) {
        reasons.push(PsdSmartObjectRejection::NonFiniteTransform);
    }
    match source_size {
        None => reasons.push(PsdSmartObjectRejection::MissingSourceSize),
        Some(size) if size.width <= 0.0 || size.height <= 0.0 => {
            reasons.push(PsdSmartObjectRejection::InvalidSourceSize);
        }
        Some(_) => {}
    }
    if let Some(non_affine) = placed.non_affine_transform.as_ref()
        && (non_affine.len() != placed.transform.len()
            || non_affine
                .iter()
                .zip(&placed.transform)
                .any(|(left, right)| left.to_bits() != right.to_bits()))
    {
        reasons.push(PsdSmartObjectRejection::AlternateTransform);
    }
    if let Some(quad) = quad
        && let Err(error) = validate_quad(&quad)
    {
        reasons.push(PsdSmartObjectRejection::InvalidQuad { code: error.code });
    }
    if let Some(warp) = placed.warp.as_ref() {
        let warp_rejection = classify_warp(warp, source_size);
        if let Some(reason) = warp_rejection {
            reasons.push(reason);
        }
    }
    if warp_sources_conflict(additional, placed, source_size) {
        reasons.push(PsdSmartObjectRejection::ConflictingWarpBlocks);
    }
    reasons
}

/// Dual-block and shadowed-warp divergence. The parser keeps the losing warp
/// of its merge precedences (`PlLd` under `SoLd`, plain `warp` under
/// `quiltWarp`); when that warp still describes a deformation the merged
/// record does not reproduce, the sources conflict and must be reported
/// instead of silently importing the reduced merged warp.
fn warp_sources_conflict(
    additional: &LayerAdditionalInfo,
    placed: &PlacedLayer,
    source_size: Option<Size>,
) -> bool {
    let merged = placed.warp.as_ref();
    let carries_deformation = |warp: &Warp| classify_warp(warp, source_size).is_some();
    if let Some(plld) = additional.plld_warp.as_ref()
        && carries_deformation(plld)
        && !merged.is_some_and(|merged| warps_equivalent(merged, plld))
    {
        return true;
    }
    if let Some(shadowed) = additional.shadowed_warp.as_ref()
        && carries_deformation(shadowed)
        && !merged.is_some_and(|merged| warps_equivalent(merged, shadowed))
    {
        return true;
    }
    false
}

/// Exact structural equality of two parsed warps, deciding whether a losing
/// dual-block or shadowed warp still agrees with the merged one. Bit-exact
/// doubles mirror the `nonAffineTransform` precedent: near-equality would
/// silently forgive a real divergence.
fn warps_equivalent(left: &Warp, right: &Warp) -> bool {
    fn scalar(left: Option<f64>, right: Option<f64>) -> bool {
        match (left, right) {
            (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
            (None, None) => true,
            _ => false,
        }
    }
    fn scalar_list(left: Option<&Vec<f64>>, right: Option<&Vec<f64>>) -> bool {
        match (left, right) {
            (Some(left), Some(right)) => {
                left.len() == right.len()
                    && left
                        .iter()
                        .zip(right.iter())
                        .all(|(left, right)| left.to_bits() == right.to_bits())
            }
            (None, None) => true,
            _ => false,
        }
    }
    fn units_value(left: &UnitsValue, right: &UnitsValue) -> bool {
        left.units == right.units && left.value.to_bits() == right.value.to_bits()
    }
    fn bounds(left: Option<&UnitsBounds>, right: Option<&UnitsBounds>) -> bool {
        match (left, right) {
            (Some(left), Some(right)) => {
                units_value(&left.left, &right.left)
                    && units_value(&left.top, &right.top)
                    && units_value(&left.right, &right.right)
                    && units_value(&left.bottom, &right.bottom)
            }
            (None, None) => true,
            _ => false,
        }
    }
    fn envelope(left: Option<&CustomEnvelopeWarp>, right: Option<&CustomEnvelopeWarp>) -> bool {
        match (left, right) {
            (Some(left), Some(right)) => {
                scalar_list(left.quilt_slice_x.as_ref(), right.quilt_slice_x.as_ref())
                    && scalar_list(left.quilt_slice_y.as_ref(), right.quilt_slice_y.as_ref())
                    && left.mesh_points.len() == right.mesh_points.len()
                    && left
                        .mesh_points
                        .iter()
                        .zip(right.mesh_points.iter())
                        .all(|(left, right)| {
                            left.x.to_bits() == right.x.to_bits()
                                && left.y.to_bits() == right.y.to_bits()
                        })
            }
            (None, None) => true,
            _ => false,
        }
    }
    left.style == right.style
        && left.rotate == right.rotate
        && scalar(left.value, right.value)
        && scalar_list(left.values.as_ref(), right.values.as_ref())
        && scalar(left.perspective, right.perspective)
        && scalar(left.perspective_other, right.perspective_other)
        && bounds(left.bounds.as_ref(), right.bounds.as_ref())
        && scalar(left.u_order, right.u_order)
        && scalar(left.v_order, right.v_order)
        && scalar(left.deform_num_rows, right.deform_num_rows)
        && scalar(left.deform_num_cols, right.deform_num_cols)
        && envelope(
            left.custom_envelope_warp.as_ref(),
            right.custom_envelope_warp.as_ref(),
        )
}

/// The adoptable-curve facts of a placed layer, or `None` when the warp is
/// outside the measured `warpCustom` 4×4 pixel family. Everything here fails
/// closed: preset scalars, quilt slices, non-4×4 orders, non-pixel or missing
/// bounds, and non-finite or wrongly counted controls stay unsupported.
fn curve_warp_facts(
    placed: &PlacedLayer,
    source_size: Option<Size>,
) -> Option<PsdSmartObjectCurveFacts> {
    let warp = placed.warp.as_ref()?;
    let envelope = warp.custom_envelope_warp.as_ref()?;
    if warp.style != Some(WarpStyle::Custom) {
        return None;
    }
    if warp.deform_num_rows.is_some() || warp.deform_num_cols.is_some() {
        return None;
    }
    if envelope.quilt_slice_x.is_some() || envelope.quilt_slice_y.is_some() {
        return None;
    }
    let neutral_scalars = warp.value.is_none_or(near_zero)
        && warp
            .values
            .as_ref()
            .is_none_or(|values| values.iter().copied().all(near_zero))
        && warp.perspective.is_none_or(near_zero)
        && warp.perspective_other.is_none_or(near_zero);
    if !neutral_scalars {
        return None;
    }
    let u_order = warp.u_order.map(|value| value as u32);
    let v_order = warp.v_order.map(|value| value as u32);
    if warp.u_order.is_none_or(|value| !near(value, 4.0))
        || warp.v_order.is_none_or(|value| !near(value, 4.0))
    {
        return None;
    }
    if envelope.mesh_points.len() != 16 {
        return None;
    }
    let _ = (u_order, v_order);
    let bounds = warp.bounds?;
    if bounds.left.units != Units::Pixels
        || bounds.top.units != Units::Pixels
        || bounds.right.units != Units::Pixels
        || bounds.bottom.units != Units::Pixels
    {
        return None;
    }
    if ![
        bounds.left.value,
        bounds.top.value,
        bounds.right.value,
        bounds.bottom.value,
    ]
    .iter()
    .all(|value| value.is_finite())
        || bounds.right.value - bounds.left.value <= 0.0
        || bounds.bottom.value - bounds.top.value <= 0.0
    {
        return None;
    }
    if !envelope
        .mesh_points
        .iter()
        .all(|point| point.x.is_finite() && point.y.is_finite())
    {
        return None;
    }
    // The declared source size and the placement quad are required to adopt
    // the deformation onto real artwork; their absence stays unsupported.
    source_size?;
    quad_from_transform(&placed.transform)?;
    Some(PsdSmartObjectCurveFacts {
        u_order: 4,
        v_order: 4,
        envelope: PsdCurveWarpEnvelope {
            left: bounds.left.value,
            top: bounds.top.value,
            right: bounds.right.value,
            bottom: bounds.bottom.value,
        },
        controls: envelope
            .mesh_points
            .iter()
            .map(|point| Point::new(point.x, point.y))
            .collect(),
    })
}

fn classify_warp(warp: &Warp, source_size: Option<Size>) -> Option<PsdSmartObjectRejection> {
    if warp.deform_num_rows.is_some()
        || warp.deform_num_cols.is_some()
        || warp.custom_envelope_warp.as_ref().is_some_and(|envelope| {
            envelope.quilt_slice_x.is_some() || envelope.quilt_slice_y.is_some()
        })
    {
        return Some(PsdSmartObjectRejection::QuiltWarp);
    }
    let neutral_scalars = warp.value.is_none_or(near_zero)
        && warp
            .values
            .as_ref()
            .is_none_or(|values| values.iter().copied().all(near_zero))
        && warp.perspective.is_none_or(near_zero)
        && warp.perspective_other.is_none_or(near_zero);
    if !neutral_scalars {
        return Some(PsdSmartObjectRejection::NonNeutralWarp);
    }
    match warp.style {
        None | Some(WarpStyle::None) if warp.custom_envelope_warp.is_none() => None,
        Some(WarpStyle::Custom) | None | Some(WarpStyle::None) => {
            let Some(size) = source_size else {
                return Some(PsdSmartObjectRejection::NonNeutralWarp);
            };
            let Some(envelope) = warp.custom_envelope_warp.as_ref() else {
                return Some(PsdSmartObjectRejection::NonNeutralWarp);
            };
            if !warp.u_order.is_none_or(|value| near(value, 4.0))
                || !warp.v_order.is_none_or(|value| near(value, 4.0))
                || envelope.mesh_points.len() != 16
            {
                return Some(PsdSmartObjectRejection::NonNeutralWarp);
            }
            for (index, point) in envelope.mesh_points.iter().enumerate() {
                let column = index % 4;
                let row = index / 4;
                let expected_x = size.width * column as f64 / 3.0;
                let expected_y = size.height * row as f64 / 3.0;
                if !point.x.is_finite()
                    || !point.y.is_finite()
                    || !near_scaled(point.x, expected_x, size.width)
                    || !near_scaled(point.y, expected_y, size.height)
                {
                    return Some(PsdSmartObjectRejection::NonNeutralWarp);
                }
            }
            None
        }
        Some(_) => Some(PsdSmartObjectRejection::NonNeutralWarp),
    }
}

fn quad_from_transform(values: &[f64]) -> Option<Quad> {
    if values.len() != 8 || values.iter().any(|value| !value.is_finite()) {
        return None;
    }
    Some(Quad::new(
        Point::new(values[0], values[1]),
        Point::new(values[2], values[3]),
        Point::new(values[4], values[5]),
        Point::new(values[6], values[7]),
    ))
}

fn parse_integer_size(width: f64, height: f64) -> Option<PixelSize> {
    if !width.is_finite()
        || !height.is_finite()
        || width.fract() != 0.0
        || height.fract() != 0.0
        || width <= 0.0
        || height <= 0.0
        || width > u32::MAX as f64
        || height > u32::MAX as f64
    {
        return None;
    }
    Some(PixelSize::new(width as u32, height as u32))
}

fn map_color_mode(mode: ColorMode) -> PsdColorMode {
    match mode {
        ColorMode::Bitmap => PsdColorMode::Bitmap,
        ColorMode::Grayscale => PsdColorMode::Grayscale,
        ColorMode::Indexed => PsdColorMode::Indexed,
        ColorMode::Rgb => PsdColorMode::Rgb,
        ColorMode::Cmyk => PsdColorMode::Cmyk,
        ColorMode::Multichannel => PsdColorMode::Multichannel,
        ColorMode::Duotone => PsdColorMode::Duotone,
        ColorMode::Lab => PsdColorMode::Lab,
    }
}

fn map_color_mode_code(code: u16) -> TransformResult<PsdColorMode> {
    match code {
        0 => Ok(PsdColorMode::Bitmap),
        1 => Ok(PsdColorMode::Grayscale),
        2 => Ok(PsdColorMode::Indexed),
        3 => Ok(PsdColorMode::Rgb),
        4 => Ok(PsdColorMode::Cmyk),
        7 => Ok(PsdColorMode::Multichannel),
        8 => Ok(PsdColorMode::Duotone),
        9 => Ok(PsdColorMode::Lab),
        _ => Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "PSD/PSB color mode is unsupported",
        )),
    }
}

fn map_read_error(error: ReadError) -> TransformError {
    let code = match error {
        ReadError::ExceededMemoryLimit { .. }
        | ReadError::ExceededRecoveryBudget { .. }
        | ReadError::ExceededParseItemBudget
        | ReadError::ExceededDescriptorDepth => ErrorCode::Memory,
        _ => ErrorCode::UnsupportedMedia,
    };
    TransformError::new(code, "PSD parser rejected the document")
        .with_details(json!({ "reason": bounded_text(&error.to_string(), 256) }))
}

fn smart_object_descriptor_contains_key(bytes: &[u8], key: &[u8]) -> bool {
    let Ok(length) = u32::try_from(key.len()) else {
        return false;
    };
    let mut marker = Vec::with_capacity(4 + key.len());
    marker.extend_from_slice(&length.to_be_bytes());
    marker.extend_from_slice(key);
    bytes.windows(8).enumerate().any(|(offset, header)| {
        let (length_bytes, payload_signature): (usize, &[u8]) = match header {
            b"8BIMSoLd" | b"8BIMSoLE" => (4, b"soLD"),
            b"8BIMPlLd" => (4, b"plcL"),
            b"8B64SoLd" | b"8B64SoLE" => (8, b"soLD"),
            b"8B64PlLd" => (8, b"plcL"),
            _ => return false,
        };
        let length_start = offset + 8;
        let payload_start = length_start + length_bytes;
        let Some(length_slice) = bytes.get(length_start..payload_start) else {
            return false;
        };
        let payload_len = match length_bytes {
            4 => u32::from_be_bytes(length_slice.try_into().expect("length checked")) as usize,
            8 => {
                let length = u64::from_be_bytes(length_slice.try_into().expect("length checked"));
                let Ok(length) = usize::try_from(length) else {
                    return false;
                };
                length
            }
            _ => unreachable!("additional-info lengths are four or eight bytes"),
        };
        let Some(payload_end) = payload_start.checked_add(payload_len) else {
            return false;
        };
        let Some(payload) = bytes.get(payload_start..payload_end) else {
            return false;
        };
        payload.starts_with(payload_signature)
            && payload.windows(marker.len()).any(|window| window == marker)
    })
}

fn near_zero(value: f64) -> bool {
    value.is_finite() && value.abs() <= WARP_EPSILON
}

fn near(left: f64, right: f64) -> bool {
    left.is_finite() && (left - right).abs() <= WARP_EPSILON
}

fn near_scaled(left: f64, right: f64, scale: f64) -> bool {
    left.is_finite()
        && right.is_finite()
        && (left - right).abs() <= WARP_EPSILON * scale.abs().max(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ag_psd::{
        psd::{
            ColorMode, CustomEnvelopeWarp, LayerAdditionalInfo, PixelData, PlacedLayerType, Psd,
            Units, UnitsBounds, UnitsValue, WriteOptions,
        },
        write_psd,
    };

    fn fixture() -> Vec<u8> {
        let transform = vec![18.0, 18.0, 82.0, 20.0, 80.0, 82.0, 20.0, 80.0];
        let layer = Layer {
            additional_info: LayerAdditionalInfo {
                name: Some("Fixture Smart Object".to_owned()),
                id: Some(42.0),
                placed_layer: Some(PlacedLayer {
                    id: "11111111-2222-3333-4444-555555555555".to_owned(),
                    placed: Some("11111111-2222-3333-4444-555555555555".to_owned()),
                    layer_type: Some(PlacedLayerType::Raster),
                    page_number: Some(1.0),
                    total_pages: Some(1.0),
                    frame_count: Some(1.0),
                    transform: transform.clone(),
                    non_affine_transform: Some(transform),
                    width: Some(64.0),
                    height: Some(64.0),
                    warp: None,
                    ..PlacedLayer::default()
                }),
                ..LayerAdditionalInfo::default()
            },
            top: Some(18.0),
            left: Some(18.0),
            bottom: Some(82.0),
            right: Some(82.0),
            image_data: Some(PixelData {
                width: 64,
                height: 64,
                data: vec![255; 64 * 64 * 4],
            }),
            ..Layer::default()
        };
        let psd = Psd {
            width: 100.0,
            height: 100.0,
            bits_per_channel: Some(8.0),
            color_mode: Some(ColorMode::Rgb),
            children: Some(vec![layer]),
            image_data: Some(PixelData {
                width: 100,
                height: 100,
                data: vec![255; 100 * 100 * 4],
            }),
            ..Psd::default()
        };
        write_psd(&psd, &WriteOptions::default())
    }

    #[test]
    fn inspects_real_smart_object_and_projects_a_validated_template() {
        let inspection = inspect_psd_smart_objects(&fixture()).unwrap();
        assert_eq!(inspection.source.document, PixelSize::new(100, 100));
        assert_eq!(inspection.source.bits_per_channel, 8);
        assert_eq!(inspection.smart_objects.len(), 1);
        let object = &inspection.smart_objects[0];
        assert_eq!(object.name, "Fixture Smart Object");
        assert_eq!(
            object.linked_asset_id.as_deref(),
            Some("11111111-2222-3333-4444-555555555555")
        );
        assert_eq!(object.importability, PsdSmartObjectImportability::Eligible);
        assert_eq!(
            object.quad,
            Some(Quad::new(
                Point::new(18.0, 18.0),
                Point::new(82.0, 20.0),
                Point::new(80.0, 82.0),
                Point::new(20.0, 80.0),
            ))
        );
        let plan =
            plan_psd_smart_object_template(&inspection, std::slice::from_ref(&object.id)).unwrap();
        assert_eq!(plan.bindings[0].source_slot, "source-0001");
        assert_eq!(plan.template_inspection.source_slots, vec!["source-0001"]);
        assert_eq!(plan.template_inspection.outputs[0].id, "composite");
    }

    #[test]
    fn inspects_and_plans_photoshop_generated_psd_and_psb_fixtures() {
        let fixtures: [(&[u8], PsdContainerFormat, &str); 2] = [
            (
                include_bytes!("../tests/fixtures/photoshop-cc-placed-layer.psd"),
                PsdContainerFormat::Psd,
                "c5cf4d58ec42500adecca9f91c8b77fe5d6f464b8edf3609f00f042e56d3c450",
            ),
            (
                include_bytes!("../tests/fixtures/photoshop-cc-placed-layer.psb"),
                PsdContainerFormat::Psb,
                "09f67cf916b40fddcfdfa79f08fb7ea065ea8c6e262b96cfd171cdb9d6632abf",
            ),
        ];

        for (bytes, expected_format, expected_sha256) in fixtures {
            let inspection = inspect_psd_smart_objects(bytes).unwrap();
            assert_eq!(inspection.source.format, expected_format);
            assert_eq!(inspection.source.sha256, expected_sha256);
            assert_eq!(inspection.source.document, PixelSize::new(256, 256));
            assert_eq!(inspection.visited_layer_count, 4);
            assert_eq!(inspection.smart_objects.len(), 3);
            assert!(
                inspection
                    .smart_objects
                    .iter()
                    .all(|object| object.importability == PsdSmartObjectImportability::Eligible)
            );
            assert_eq!(
                inspection
                    .smart_objects
                    .iter()
                    .map(|object| object.layer_path.as_slice())
                    .collect::<Vec<_>>(),
                vec![
                    ["linked-png"].as_slice(),
                    ["linked-psd"].as_slice(),
                    ["embedded-png"].as_slice(),
                ]
            );

            let selected = inspection
                .smart_objects
                .iter()
                .map(|object| object.id.clone())
                .collect::<Vec<_>>();
            let plan = plan_psd_smart_object_template(&inspection, &selected).unwrap();
            assert_eq!(plan.bindings.len(), 3);
            assert_eq!(
                plan.template_inspection.source_slots,
                vec!["source-0001", "source-0002", "source-0003"]
            );
            assert_eq!(plan.template_inspection.outputs[0].id, "composite");
        }
    }

    #[test]
    fn malformed_and_oversized_sources_fail_before_parser_use() {
        let error = inspect_psd_smart_objects(b"not a psd").unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedMedia);
        let oversized = vec![0; MAX_PSD_SOURCE_BYTES + 1];
        let error = inspect_psd_smart_objects(&oversized).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn differing_non_affine_and_non_neutral_warp_are_explicitly_unsupported() {
        let placed = PlacedLayer {
            transform: vec![0.0, 0.0, 10.0, 0.0, 10.0, 10.0, 0.0, 10.0],
            non_affine_transform: Some(vec![0.0, 0.0, 9.0, 0.0, 10.0, 10.0, 0.0, 10.0]),
            width: Some(10.0),
            height: Some(10.0),
            warp: Some(Warp {
                style: Some(WarpStyle::Arc),
                value: Some(0.5),
                ..Warp::default()
            }),
            ..PlacedLayer::default()
        };
        let quad = quad_from_transform(&placed.transform);
        let reasons = import_rejections(
            &LayerAdditionalInfo::default(),
            &placed,
            Some(Size::new(10.0, 10.0)),
            quad,
        );
        assert!(reasons.contains(&PsdSmartObjectRejection::AlternateTransform));
        assert!(reasons.contains(&PsdSmartObjectRejection::NonNeutralWarp));
    }

    #[test]
    fn smart_filter_scan_is_limited_to_framed_smart_object_descriptors() {
        let mut source = fixture();
        source.extend_from_slice(&8_u32.to_be_bytes());
        source.extend_from_slice(b"filterFX");
        assert!(!smart_object_descriptor_contains_key(&source, b"filterFX"));
        assert!(inspect_psd_smart_objects(&source).is_ok());

        let mut payload = b"soLD".to_vec();
        payload.extend_from_slice(&4_u32.to_be_bytes());
        payload.extend_from_slice(&8_u32.to_be_bytes());
        payload.extend_from_slice(b"filterFX");
        // ag-psd reads the `SoLE` alias through the same `SoLd` reader, so the
        // guard must cover every framed key the parser can project.
        for prefix in [
            &b"8BIMSoLd"[..],
            &b"8BIMSoLE"[..],
            &b"8B64SoLd"[..],
            &b"8B64SoLE"[..],
        ] {
            let length_bytes = if prefix.starts_with(b"8B64") { 8 } else { 4 };
            let framed = frame_smart_object_block(prefix, length_bytes, &payload);
            assert!(smart_object_descriptor_contains_key(&framed, b"filterFX"));
            let mut document = fixture();
            document.extend_from_slice(&framed);
            let error = inspect_psd_smart_objects(&document).unwrap_err();
            assert_eq!(error.code, ErrorCode::UnsupportedMedia);
        }

        let mut placed_payload = b"plcL".to_vec();
        placed_payload.extend_from_slice(&4_u32.to_be_bytes());
        placed_payload.extend_from_slice(&8_u32.to_be_bytes());
        placed_payload.extend_from_slice(b"filterFX");
        for prefix in [&b"8BIMPlLd"[..], &b"8B64PlLd"[..]] {
            let length_bytes = if prefix.starts_with(b"8B64") { 8 } else { 4 };
            let framed = frame_smart_object_block(prefix, length_bytes, &placed_payload);
            assert!(smart_object_descriptor_contains_key(&framed, b"filterFX"));
        }
    }

    fn frame_smart_object_block(prefix: &[u8], length_bytes: usize, payload: &[u8]) -> Vec<u8> {
        let mut framed = prefix.to_vec();
        match length_bytes {
            4 => framed.extend_from_slice(&(payload.len() as u32).to_be_bytes()),
            _ => framed.extend_from_slice(&(payload.len() as u64).to_be_bytes()),
        }
        framed.extend_from_slice(payload);
        framed
    }

    #[test]
    fn layer_depth_and_smart_object_limits_fail_closed() {
        let layers = (0..=MAX_PSD_LAYERS)
            .map(|_| Layer::default())
            .collect::<Vec<_>>();
        let layer_error = visit_layers(&layers, &[], 1, &mut VisitState::default()).unwrap_err();
        assert_eq!(layer_error.code, ErrorCode::OutputLimit);

        let mut nested = Layer::default();
        for _ in 0..MAX_PSD_LAYER_DEPTH {
            nested = Layer {
                children: Some(vec![nested]),
                ..Layer::default()
            };
        }
        let depth_error = visit_layers(&[nested], &[], 1, &mut VisitState::default()).unwrap_err();
        assert_eq!(depth_error.code, ErrorCode::OutputLimit);

        let smart_objects = (0..=MAX_PSD_SMART_OBJECTS)
            .map(|index| Layer {
                additional_info: LayerAdditionalInfo {
                    placed_layer: Some(PlacedLayer {
                        id: format!("placed-{index}"),
                        ..PlacedLayer::default()
                    }),
                    ..LayerAdditionalInfo::default()
                },
                ..Layer::default()
            })
            .collect::<Vec<_>>();
        let smart_object_error =
            visit_layers(&smart_objects, &[], 1, &mut VisitState::default()).unwrap_err();
        assert_eq!(smart_object_error.code, ErrorCode::OutputLimit);
    }

    #[test]
    fn malformed_recognized_warp_style_fails_closed() {
        let mut source = fixture();
        let needle = b"warpCustom";
        let offset = source
            .windows(needle.len())
            .position(|window| window == needle)
            .expect("writer fixture contains the recognized warp style value");
        source[offset + needle.len() - 1] = b'X';
        let error = inspect_psd_smart_objects(&source).unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedMedia);
    }

    #[test]
    fn inconsistent_eligible_record_returns_an_error_instead_of_panicking() {
        let mut inspection = inspect_psd_smart_objects(&fixture()).unwrap();
        inspection.smart_objects[0].quad = None;
        let id = inspection.smart_objects[0].id.clone();
        let error = plan_psd_smart_object_template(&inspection, &[id]).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }

    #[test]
    fn non_finite_raw_transform_is_not_serialized_as_json_null() {
        let layer = Layer::default();
        let placed = PlacedLayer {
            transform: vec![f64::NAN; 8],
            width: Some(10.0),
            height: Some(10.0),
            ..PlacedLayer::default()
        };
        let record = build_record(&layer, &placed, vec!["bad".to_owned()], 0);
        assert_eq!(record.raw_transform, None);
        let encoded = serde_json::to_string(&record).unwrap();
        assert!(!encoded.contains("rawTransform"));
        assert!(!encoded.contains("null"));
    }

    #[test]
    fn response_schema_is_closed_and_bounded() {
        let schema = serde_json::to_value(schemars::schema_for!(PsdSmartObjectResponse)).unwrap();
        let encoded = serde_json::to_string(&schema).unwrap();
        assert!(encoded.contains("\"additionalProperties\":false"));
        assert!(encoded.len() < 48_000);
    }

    /// Sixteen controls over a 64×48 envelope, rows first, with one control
    /// optionally displaced. Written through the same `warpCustom` descriptor
    /// framing Photoshop uses.
    fn curve_controls(
        envelope: (f64, f64, f64, f64),
        moved: &[(usize, f64, f64)],
    ) -> Vec<ag_psd::psd::PointF> {
        let (left, top, right, bottom) = envelope;
        let width = right - left;
        let height = bottom - top;
        let mut points = Vec::with_capacity(16);
        for row in 0..4usize {
            for column in 0..4usize {
                let index = row * 4 + column;
                let (mut x, mut y) = (
                    left + width * column as f64 / 3.0,
                    top + height * row as f64 / 3.0,
                );
                // Photoshop's pixel quanta for 64-wide grids.
                if column == 1 && width == 64.0 {
                    x = left + width * (21.33333333333333 / 64.0);
                }
                if let Some((_, mx, my)) = moved.iter().find(|(i, _, _)| *i == index) {
                    x = *mx;
                    y = *my;
                }
                points.push(ag_psd::psd::PointF { x, y });
            }
        }
        points
    }

    fn curve_fixture(
        moved: &[(usize, f64, f64)],
        warp: impl FnOnce(ag_psd::psd::CustomEnvelopeWarp) -> ag_psd::psd::Warp,
    ) -> Vec<u8> {
        let envelope_warp = CustomEnvelopeWarp {
            quilt_slice_x: None,
            quilt_slice_y: None,
            mesh_points: curve_controls((0.0, 0.0, 64.0, 48.0), moved),
        };
        let transform = vec![18.0, 18.0, 82.0, 20.0, 80.0, 82.0, 20.0, 80.0];
        let layer = Layer {
            additional_info: LayerAdditionalInfo {
                name: Some("Curved Smart Object".to_owned()),
                id: Some(7.0),
                placed_layer: Some(PlacedLayer {
                    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_owned(),
                    placed: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_owned()),
                    layer_type: Some(PlacedLayerType::Raster),
                    transform: transform.clone(),
                    non_affine_transform: Some(transform),
                    width: Some(64.0),
                    height: Some(48.0),
                    warp: Some(warp(envelope_warp)),
                    ..PlacedLayer::default()
                }),
                ..LayerAdditionalInfo::default()
            },
            top: Some(18.0),
            left: Some(18.0),
            bottom: Some(82.0),
            right: Some(82.0),
            image_data: Some(PixelData {
                width: 64,
                height: 48,
                data: vec![255; 64 * 48 * 4],
            }),
            ..Layer::default()
        };
        let psd = Psd {
            width: 100.0,
            height: 100.0,
            bits_per_channel: Some(8.0),
            color_mode: Some(ColorMode::Rgb),
            children: Some(vec![layer]),
            image_data: Some(PixelData {
                width: 100,
                height: 100,
                data: vec![255; 100 * 100 * 4],
            }),
            ..Psd::default()
        };
        write_psd(&psd, &WriteOptions::default())
    }

    fn custom_warp(envelope: ag_psd::psd::CustomEnvelopeWarp) -> ag_psd::psd::Warp {
        ag_psd::psd::Warp {
            style: Some(WarpStyle::Custom),
            bounds: Some(UnitsBounds {
                top: UnitsValue {
                    units: Units::Pixels,
                    value: 0.0,
                },
                left: UnitsValue {
                    units: Units::Pixels,
                    value: 0.0,
                },
                right: UnitsValue {
                    units: Units::Pixels,
                    value: 64.0,
                },
                bottom: UnitsValue {
                    units: Units::Pixels,
                    value: 48.0,
                },
            }),
            u_order: Some(4.0),
            v_order: Some(4.0),
            custom_envelope_warp: Some(envelope),
            ..ag_psd::psd::Warp::default()
        }
    }

    #[test]
    fn interior_curve_warp_is_curve_eligible_and_adopts_as_editable_work() {
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], custom_warp);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        assert_eq!(inspection.smart_objects.len(), 1);
        let record = &inspection.smart_objects[0];
        assert_eq!(
            record.importability,
            PsdSmartObjectImportability::CurveEligible
        );
        let curve = record.curve.as_ref().unwrap();
        assert_eq!(curve.u_order, 4);
        assert_eq!(
            curve.envelope,
            PsdCurveWarpEnvelope {
                left: 0.0,
                top: 0.0,
                right: 64.0,
                bottom: 48.0
            }
        );
        assert_eq!(curve.controls.len(), 16);
        assert_eq!(curve.controls[5], Point::new(28.0, 14.0));
        let plan = plan_psd_curve_work(&inspection, &record.id).unwrap();
        assert_eq!(plan.losses, Vec::<String>::new());
        assert_eq!(
            plan.provenance.boundary,
            worldbend_core::MeshBoundary::Fixed
        );
        assert!(plan.provenance.bbox_matches_envelope);
        let surface = plan.work.surface.as_ref().unwrap();
        assert_eq!((surface.envelope.columns, surface.envelope.rows), (1, 1));
        assert_eq!(surface.envelope.points.len(), 16);
        // The pixel-quantum rest column normalized onto the exact third.
        assert!(
            surface
                .envelope
                .points
                .iter()
                .enumerate()
                .any(|(index, point)| { index % 4 == 1 && point.x == 1.0 / 3.0 })
        );
        // The adopted work plans through the ordinary core path unchanged.
        worldbend_core::plan_deformation_work(&plan.work).unwrap();
    }

    #[test]
    fn moved_outline_and_out_of_envelope_bulge_adopt_the_free_boundary() {
        // One bottom outline control pulls past the envelope.
        let bytes = curve_fixture(&[(13, 32.0, 52.0)], custom_warp);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let record = &inspection.smart_objects[0];
        assert_eq!(
            record.importability,
            PsdSmartObjectImportability::CurveEligible
        );
        let plan = plan_psd_curve_work(&inspection, &record.id).unwrap();
        assert_eq!(plan.provenance.boundary, worldbend_core::MeshBoundary::Free);
        assert!(!plan.provenance.bbox_matches_envelope);
        assert_eq!(plan.provenance.control_bbox.bottom, 52.0);
        worldbend_core::plan_deformation_work(&plan.work).unwrap();

        // An interior bulge beyond the envelope still converts.
        let bytes = curve_fixture(&[(5, 32.0, -4.0), (6, 58.0, 52.0)], custom_warp);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let record = &inspection.smart_objects[0];
        assert_eq!(
            record.importability,
            PsdSmartObjectImportability::CurveEligible
        );
        let plan = plan_psd_curve_work(&inspection, &record.id).unwrap();
        assert_eq!(plan.provenance.boundary, worldbend_core::MeshBoundary::Free);
        assert_eq!(plan.provenance.control_bbox.top, -4.0);
        worldbend_core::plan_deformation_work(&plan.work).unwrap();
    }

    #[test]
    fn identity_curve_warp_stays_template_eligible() {
        let bytes = curve_fixture(&[], custom_warp);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let record = &inspection.smart_objects[0];
        assert_eq!(record.importability, PsdSmartObjectImportability::Eligible);
        // The identity warp loses nothing through the four-corner template.
        plan_psd_smart_object_template(&inspection, std::slice::from_ref(&record.id)).unwrap();
    }

    #[test]
    fn curve_eligible_objects_are_refused_by_template_planning() {
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], custom_warp);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let id = inspection.smart_objects[0].id.clone();
        let error = plan_psd_smart_object_template(&inspection, &[id]).unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedMedia);
    }

    #[test]
    fn preset_quilt_non_pixel_and_non_4x4_curves_stay_unsupported() {
        // A preset warp style never becomes a curve.
        let preset = |envelope: CustomEnvelopeWarp| ag_psd::psd::Warp {
            style: Some(WarpStyle::Arc),
            value: Some(0.5),
            custom_envelope_warp: Some(envelope),
            ..ag_psd::psd::Warp::default()
        };
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], preset);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let record = &inspection.smart_objects[0];
        assert_eq!(
            record.importability,
            PsdSmartObjectImportability::Unsupported {
                reasons: vec![PsdSmartObjectRejection::NonNeutralWarp]
            }
        );
        assert!(record.curve.is_none());

        // Quilt slices stay rejected.
        let quilt = |mut envelope: CustomEnvelopeWarp| {
            envelope.quilt_slice_x = Some(vec![0.0, 0.5]);
            custom_warp(envelope)
        };
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], quilt);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        assert_eq!(
            inspection.smart_objects[0].importability,
            PsdSmartObjectImportability::Unsupported {
                reasons: vec![PsdSmartObjectRejection::QuiltWarp]
            }
        );

        // Non-4×4 orders stay rejected.
        let five_by_five = |envelope: ag_psd::psd::CustomEnvelopeWarp| ag_psd::psd::Warp {
            style: Some(WarpStyle::Custom),
            bounds: Some(UnitsBounds {
                top: UnitsValue {
                    units: Units::Pixels,
                    value: 0.0,
                },
                left: UnitsValue {
                    units: Units::Pixels,
                    value: 0.0,
                },
                right: UnitsValue {
                    units: Units::Pixels,
                    value: 64.0,
                },
                bottom: UnitsValue {
                    units: Units::Pixels,
                    value: 48.0,
                },
            }),
            u_order: Some(5.0),
            v_order: Some(5.0),
            custom_envelope_warp: Some(envelope),
            ..ag_psd::psd::Warp::default()
        };
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], five_by_five);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        assert_eq!(
            inspection.smart_objects[0].importability,
            PsdSmartObjectImportability::Unsupported {
                reasons: vec![PsdSmartObjectRejection::NonNeutralWarp]
            }
        );

        // Non-pixel envelope bounds cannot be adopted as pixels.
        let points = |mut envelope: ag_psd::psd::CustomEnvelopeWarp| {
            let _ = &mut envelope;
            ag_psd::psd::Warp {
                style: Some(WarpStyle::Custom),
                bounds: Some(UnitsBounds {
                    top: UnitsValue {
                        units: Units::Points,
                        value: 0.0,
                    },
                    left: UnitsValue {
                        units: Units::Points,
                        value: 0.0,
                    },
                    right: UnitsValue {
                        units: Units::Points,
                        value: 64.0,
                    },
                    bottom: UnitsValue {
                        units: Units::Points,
                        value: 48.0,
                    },
                }),
                u_order: Some(4.0),
                v_order: Some(4.0),
                custom_envelope_warp: Some(envelope),
                ..ag_psd::psd::Warp::default()
            }
        };
        let bytes = curve_fixture(&[(5, 28.0, 14.0)], points);
        let inspection = inspect_psd_smart_objects(&bytes).unwrap();
        let record = &inspection.smart_objects[0];
        assert!(record.curve.is_none());
        assert_ne!(
            record.importability,
            PsdSmartObjectImportability::CurveEligible
        );
    }

    // Runaway descriptor recursion and cumulative collection growth are now
    // rejected by the parser's own depth and item budgets; the end-to-end
    // verification lives in tests/psd_parse_budgets.rs.
}

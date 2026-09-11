//! Bounded, read-only ecosystem interoperability.
//!
//! This crate translates untrusted carrier data into existing Worldbend
//! contracts. It does not put third-party document semantics into the core.

use ag_psd::{
    ReadError,
    psd::{ColorMode, Layer, PlacedLayer, ReadOptions, Warp, WarpStyle},
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
    Point, Quad, SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, Size,
    SpatialTemplateInspection, SpatialTemplateOperation, SpatialTemplateOutput,
    SpatialTemplateSpec, TransformError, TransformResult, TransformSpec, bounded_text,
    inspect_spatial_template, validate_quad,
};

pub const PSD_SMART_OBJECT_REQUEST_SCHEMA: &str = "worldbend.psd-smart-object-request";
pub const PSD_SMART_OBJECT_INSPECTION_SCHEMA: &str = "worldbend.psd-smart-object-inspection";
pub const PSD_SMART_OBJECT_TEMPLATE_PLAN_SCHEMA: &str = "worldbend.psd-smart-object-template-plan";
pub const PSD_SMART_OBJECT_VERSION: &str = "0.1";
pub const MAX_PSD_SOURCE_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_PSD_LAYERS: usize = 256;
pub const MAX_PSD_LAYER_DEPTH: usize = 32;
pub const MAX_PSD_SMART_OBJECTS: usize = 64;
pub const MAX_PSD_TEMPLATE_OBJECTS: usize = 16;

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
    InvalidQuad { code: ErrorCode },
    NonNeutralWarp,
    QuiltWarp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectImportability {
    Eligible,
    Unsupported {
        #[schemars(length(min = 1, max = 8))]
        reasons: Vec<PsdSmartObjectRejection>,
    },
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
#[serde(tag = "result", rename_all = "camelCase", deny_unknown_fields)]
pub enum PsdSmartObjectResponse {
    Inspection {
        inspection: Box<PsdSmartObjectInspection>,
    },
    TemplatePlan {
        plan: Box<PsdSmartObjectTemplatePlan>,
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
        throw_for_missing_features: Some(true),
        log_missing_features: Some(false),
        use_image_data: Some(false),
        use_raw_data: Some(false),
        use_raw_thumbnail: Some(false),
        log_dev_features: Some(false),
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
                "selected PSD Smart Object is not template-eligible",
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
    let reasons = import_rejections(placed, source_size, quad);
    let importability = if reasons.is_empty() {
        PsdSmartObjectImportability::Eligible
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
        importability,
    }
}

fn import_rejections(
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
    reasons
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
        ReadError::ExceededMemoryLimit { .. } => ErrorCode::Memory,
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
        psd::{ColorMode, LayerAdditionalInfo, PixelData, PlacedLayerType, Psd, WriteOptions},
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
                "69ea01bf88cb85c48d3a78c3bb9e06ae141c9c9fc6a88267eae95c315e16180e",
            ),
            (
                include_bytes!("../tests/fixtures/photoshop-cc-placed-layer.psb"),
                PsdContainerFormat::Psb,
                "066eeb1bce9c123ffcb57f380d9a51e0687024fdd264904ed3a44c3d5666490c",
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
        let reasons = import_rejections(&placed, Some(Size::new(10.0, 10.0)), quad);
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
}

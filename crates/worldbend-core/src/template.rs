use crate::{
    CanvasSetSpec, ErrorCode, MockupSpec, RasterProgramInspection, RasterProgramSpec,
    TransformError, TransformResult, bounded_text, inspect_raster_program, plan_mockup,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const SPATIAL_TEMPLATE_SCHEMA: &str = "worldbend.spatial-template";
pub const SPATIAL_TEMPLATE_INSPECTION_SCHEMA: &str = "worldbend.spatial-template-inspection";
pub const VARIATION_JOB_SCHEMA: &str = "worldbend.variation-job";
pub const VARIATION_JOB_PLAN_SCHEMA: &str = "worldbend.variation-job-plan";
pub const SPATIAL_TEMPLATE_VERSION: &str = "0.1";
pub const MAX_SPATIAL_TEMPLATE_SLOTS: usize = 16;
pub const MAX_SPATIAL_TEMPLATE_OUTPUTS: usize = 16;
pub const MAX_VARIATION_JOB_ITEMS: usize = 64;
pub const MAX_VARIATION_JOB_OUTPUTS: usize = MAX_VARIATION_JOB_ITEMS * MAX_SPATIAL_TEMPLATE_OUTPUTS;

const MAX_HEADER_ECHO_CHARS: usize = 128;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SpatialTemplateOperation {
    RasterProgram {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        #[serde(rename = "sourceSlot")]
        source_slot: String,
        program: RasterProgramSpec,
    },
    Mockup {
        spec: MockupSpec,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SpatialTemplateOutput {
    Single {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
    },
    CanvasSet {
        spec: CanvasSetSpec,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialTemplateSpec {
    #[schemars(schema_with = "spatial_template_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_template_version_schema")]
    pub version: String,
    pub operation: SpatialTemplateOperation,
    pub output: SpatialTemplateOutput,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SpatialTemplateOperationKind {
    RasterProgram,
    Mockup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SpatialTemplateOutputKind {
    Single,
    CanvasSet,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialTemplateOutputSummary {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub filename: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SpatialTemplateInspection {
    #[schemars(schema_with = "spatial_template_inspection_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_template_version_schema")]
    pub version: String,
    pub operation: SpatialTemplateOperationKind,
    #[schemars(length(min = 1, max = 16))]
    pub source_slots: Vec<String>,
    pub output: SpatialTemplateOutputKind,
    #[schemars(length(min = 1, max = 16))]
    pub outputs: Vec<SpatialTemplateOutputSummary>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raster_program: Option<RasterProgramInspection>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationBinding {
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobItem {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    #[schemars(length(min = 1, max = 16))]
    pub bindings: Vec<VariationBinding>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum VariationFailurePolicy {
    /// Any item, decode, budget, or cancellation failure publishes nothing.
    #[default]
    AllOrNone,
    /// Item-level render or decode failures are recorded in order; successful
    /// items still publish. Job-level schema, extra assets, and destination
    /// collisions, cancellation and execution infrastructure failures abort the whole job.
    Continue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobSpec {
    #[schemars(schema_with = "variation_job_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_template_version_schema")]
    pub version: String,
    pub template: SpatialTemplateSpec,
    #[serde(default)]
    pub failure_policy: VariationFailurePolicy,
    #[schemars(length(min = 1, max = 64))]
    pub items: Vec<VariationJobItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobItemPlan {
    pub id: String,
    pub bindings: Vec<VariationBinding>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobPlan {
    #[schemars(schema_with = "variation_job_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "spatial_template_version_schema")]
    pub version: String,
    pub template: SpatialTemplateInspection,
    pub failure_policy: VariationFailurePolicy,
    #[schemars(length(min = 1, max = 64))]
    pub items: Vec<VariationJobItemPlan>,
    #[schemars(length(min = 1, max = 1024))]
    pub asset_ids: Vec<String>,
    #[schemars(range(min = 1, max = 1024))]
    pub output_count: usize,
}

pub fn inspect_spatial_template(
    spec: &SpatialTemplateSpec,
) -> TransformResult<SpatialTemplateInspection> {
    validate_header(&spec.schema, SPATIAL_TEMPLATE_SCHEMA, &spec.version)?;

    let (operation, source_slots, raster_program) = match &spec.operation {
        SpatialTemplateOperation::RasterProgram {
            source_slot,
            program,
        } => {
            validate_id(source_slot, "template source slot")?;
            (
                SpatialTemplateOperationKind::RasterProgram,
                vec![source_slot.clone()],
                Some(inspect_raster_program(program)?),
            )
        }
        SpatialTemplateOperation::Mockup { spec } => {
            let plan = plan_mockup(spec)?;
            let mut seen = HashSet::new();
            let source_slots = plan
                .planes
                .iter()
                .filter_map(|plane| {
                    if seen.insert(plane.source_id.as_str()) {
                        Some(plane.source_id.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            (SpatialTemplateOperationKind::Mockup, source_slots, None)
        }
    };

    if source_slots.is_empty() || source_slots.len() > MAX_SPATIAL_TEMPLATE_SLOTS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial Template must require 1..16 source slots",
        ));
    }

    let (output, outputs) = match &spec.output {
        SpatialTemplateOutput::Single { id } => {
            validate_id(id, "template output id")?;
            (
                SpatialTemplateOutputKind::Single,
                vec![SpatialTemplateOutputSummary {
                    id: id.clone(),
                    filename: format!("{id}.png"),
                }],
            )
        }
        SpatialTemplateOutput::CanvasSet { spec } => {
            spec.validate()?;
            (
                SpatialTemplateOutputKind::CanvasSet,
                spec.variants
                    .iter()
                    .map(|variant| SpatialTemplateOutputSummary {
                        id: variant.id.clone(),
                        filename: format!("{}.png", variant.id),
                    })
                    .collect(),
            )
        }
    };

    Ok(SpatialTemplateInspection {
        schema: SPATIAL_TEMPLATE_INSPECTION_SCHEMA.to_owned(),
        version: SPATIAL_TEMPLATE_VERSION.to_owned(),
        operation,
        source_slots,
        output,
        outputs,
        raster_program,
    })
}

pub fn plan_variation_job(spec: &VariationJobSpec) -> TransformResult<VariationJobPlan> {
    validate_header(&spec.schema, VARIATION_JOB_SCHEMA, &spec.version)?;
    if spec.items.is_empty() || spec.items.len() > MAX_VARIATION_JOB_ITEMS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Variation Job must contain 1..64 ordered items",
        )
        .with_details(json!({ "itemCount": spec.items.len() })));
    }

    let template = inspect_spatial_template(&spec.template)?;
    let required = template
        .source_slots
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut item_ids = HashSet::with_capacity(spec.items.len());
    let mut asset_ids_seen = HashSet::new();
    let mut asset_ids = Vec::new();
    let mut items = Vec::with_capacity(spec.items.len());

    for item in &spec.items {
        validate_id(&item.id, "Variation Job item id")?;
        if !item_ids.insert(item.id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                "Variation Job item ids and derived directories must be unique",
            )
            .with_details(json!({ "id": item.id })));
        }
        if item.bindings.len() != required.len() {
            return Err(binding_mismatch(
                item,
                &template.source_slots,
                "Variation Job item must bind every template source slot exactly once",
            ));
        }

        let mut by_slot = std::collections::HashMap::with_capacity(item.bindings.len());
        for binding in &item.bindings {
            validate_id(&binding.slot_id, "Variation Job slot id")?;
            validate_id(&binding.asset_id, "Variation Job asset id")?;
            if !required.contains(binding.slot_id.as_str()) {
                return Err(binding_mismatch(
                    item,
                    &template.source_slots,
                    "Variation Job item binds an unknown template source slot",
                ));
            }
            if by_slot.insert(binding.slot_id.as_str(), binding).is_some() {
                return Err(binding_mismatch(
                    item,
                    &template.source_slots,
                    "Variation Job item binds one source slot more than once",
                ));
            }
        }

        let mut canonical_bindings = Vec::with_capacity(template.source_slots.len());
        for slot in &template.source_slots {
            let Some(binding) = by_slot.get(slot.as_str()) else {
                return Err(binding_mismatch(
                    item,
                    &template.source_slots,
                    "Variation Job item is missing a template source slot",
                ));
            };
            canonical_bindings.push((*binding).clone());
            if asset_ids_seen.insert(binding.asset_id.as_str()) {
                asset_ids.push(binding.asset_id.clone());
            }
        }
        items.push(VariationJobItemPlan {
            id: item.id.clone(),
            bindings: canonical_bindings,
        });
    }

    let output_count = items
        .len()
        .checked_mul(template.outputs.len())
        .ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "Variation Job output count overflowed",
            )
        })?;
    if output_count == 0 || output_count > MAX_VARIATION_JOB_OUTPUTS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Variation Job exceeds the 1,024-file product ceiling",
        )
        .with_details(json!({ "outputCount": output_count })));
    }

    Ok(VariationJobPlan {
        schema: VARIATION_JOB_PLAN_SCHEMA.to_owned(),
        version: SPATIAL_TEMPLATE_VERSION.to_owned(),
        template,
        failure_policy: spec.failure_policy,
        items,
        asset_ids,
        output_count,
    })
}

fn binding_mismatch(
    item: &VariationJobItem,
    required: &[String],
    message: &'static str,
) -> TransformError {
    TransformError::new(ErrorCode::Schema, message).with_details(json!({
        "itemId": item.id,
        "required": required,
        "provided": item.bindings.iter().map(|binding| &binding.slot_id).collect::<Vec<_>>(),
    }))
}

fn validate_header(schema: &str, expected: &str, version: &str) -> TransformResult<()> {
    if schema != expected {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported schema {:?}; expected {expected:?}",
                bounded_text(schema, MAX_HEADER_ECHO_CHARS)
            ),
        ));
    }
    if version != SPATIAL_TEMPLATE_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported version {:?}; expected {SPATIAL_TEMPLATE_VERSION:?}",
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

fn spatial_template_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_TEMPLATE_SCHEMA })
}

fn spatial_template_inspection_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_TEMPLATE_INSPECTION_SCHEMA })
}

fn variation_job_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": VARIATION_JOB_SCHEMA })
}

fn variation_job_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": VARIATION_JOB_PLAN_SCHEMA })
}

fn spatial_template_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SPATIAL_TEMPLATE_VERSION })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasBackground, CanvasOperation, CanvasVariant,
        MOCKUP_SCHEMA, MOCKUP_VERSION, MockupPlane, PixelSize, Point, Quad, RASTER_PROGRAM_SCHEMA,
        RASTER_PROGRAM_VERSION, RasterProgramStage, Size, TransformSpec,
    };

    fn program_template(output: SpatialTemplateOutput) -> SpatialTemplateSpec {
        SpatialTemplateSpec {
            schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
            version: SPATIAL_TEMPLATE_VERSION.to_owned(),
            operation: SpatialTemplateOperation::RasterProgram {
                source_slot: "artwork".to_owned(),
                program: RasterProgramSpec {
                    schema: RASTER_PROGRAM_SCHEMA.to_owned(),
                    version: RASTER_PROGRAM_VERSION.to_owned(),
                    stages: vec![RasterProgramStage::Canvas {
                        id: "fit".to_owned(),
                        spec: crate::CanvasSpec {
                            schema: crate::CANVAS_SCHEMA.to_owned(),
                            version: CANVAS_VERSION.to_owned(),
                            operation: CanvasOperation::Contain {
                                output: PixelSize::new(64, 64),
                                anchor: crate::NormalizedAnchor { x: 0.5, y: 0.5 },
                                background: CanvasBackground::Transparent {},
                            },
                        },
                    }],
                },
            },
            output,
        }
    }

    fn single_output() -> SpatialTemplateOutput {
        SpatialTemplateOutput::Single {
            id: "hero".to_owned(),
        }
    }

    fn job(template: SpatialTemplateSpec) -> VariationJobSpec {
        VariationJobSpec {
            schema: VARIATION_JOB_SCHEMA.to_owned(),
            version: SPATIAL_TEMPLATE_VERSION.to_owned(),
            template,
            failure_policy: VariationFailurePolicy::AllOrNone,
            items: vec![VariationJobItem {
                id: "sku-1".to_owned(),
                bindings: vec![VariationBinding {
                    slot_id: "artwork".to_owned(),
                    asset_id: "asset-a".to_owned(),
                }],
            }],
        }
    }

    #[test]
    fn template_inspection_derives_slots_and_outputs_from_closed_operations() {
        let output = SpatialTemplateOutput::CanvasSet {
            spec: CanvasSetSpec {
                schema: CANVAS_SET_SCHEMA.to_owned(),
                version: CANVAS_VERSION.to_owned(),
                variants: vec![
                    CanvasVariant {
                        id: "square".to_owned(),
                        operation: CanvasOperation::Stretch {
                            output: PixelSize::new(32, 32),
                        },
                    },
                    CanvasVariant {
                        id: "wide".to_owned(),
                        operation: CanvasOperation::Contain {
                            output: PixelSize::new(64, 32),
                            anchor: crate::NormalizedAnchor { x: 0.5, y: 0.5 },
                            background: CanvasBackground::Transparent {},
                        },
                    },
                ],
            },
        };
        let inspection = inspect_spatial_template(&program_template(output)).unwrap();
        assert_eq!(inspection.source_slots, ["artwork"]);
        assert_eq!(inspection.output, SpatialTemplateOutputKind::CanvasSet);
        assert_eq!(inspection.outputs[1].filename, "wide.png");
        assert!(inspection.raster_program.is_some());
    }

    #[test]
    fn mockup_template_derives_distinct_slots_in_first_plane_order() {
        let plane = |id: &str, source_id: &str| MockupPlane {
            id: id.to_owned(),
            source_id: source_id.to_owned(),
            transform: TransformSpec::pixel(
                Size::new(4.0, 2.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(4.0, 0.0),
                    Point::new(4.0, 2.0),
                    Point::new(0.0, 2.0),
                ),
            ),
            opacity: 1.0,
            grid: None,
            measurement: None,
        };
        let template = SpatialTemplateSpec {
            schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
            version: SPATIAL_TEMPLATE_VERSION.to_owned(),
            operation: SpatialTemplateOperation::Mockup {
                spec: MockupSpec {
                    schema: MOCKUP_SCHEMA.to_owned(),
                    version: MOCKUP_VERSION.to_owned(),
                    canvas: PixelSize::new(4, 2),
                    background: CanvasBackground::Transparent {},
                    planes: vec![
                        plane("front", "artwork"),
                        plane("background", "scene"),
                        plane("reflection", "artwork"),
                    ],
                    seams: vec![],
                },
            },
            output: single_output(),
        };

        let inspection = inspect_spatial_template(&template).unwrap();
        assert_eq!(inspection.operation, SpatialTemplateOperationKind::Mockup);
        assert_eq!(inspection.source_slots, ["artwork", "scene"]);
        assert!(inspection.raster_program.is_none());
    }

    #[test]
    fn job_canonicalizes_bindings_and_preserves_asset_first_use_order() {
        let mut spec = job(program_template(single_output()));
        spec.items.push(VariationJobItem {
            id: "sku-2".to_owned(),
            bindings: vec![VariationBinding {
                slot_id: "artwork".to_owned(),
                asset_id: "asset-b".to_owned(),
            }],
        });
        let plan = plan_variation_job(&spec).unwrap();
        assert_eq!(plan.output_count, 2);
        assert_eq!(plan.asset_ids, ["asset-a", "asset-b"]);
        assert_eq!(plan.items[1].bindings[0].slot_id, "artwork");
    }

    #[test]
    fn job_rejects_missing_unknown_and_duplicate_bindings() {
        let mut missing = job(program_template(single_output()));
        missing.items[0].bindings.clear();
        assert_eq!(
            plan_variation_job(&missing).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut unknown = job(program_template(single_output()));
        unknown.items[0].bindings[0].slot_id = "other".to_owned();
        assert_eq!(
            plan_variation_job(&unknown).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut duplicate = job(program_template(single_output()));
        let repeated = duplicate.items[0].bindings[0].clone();
        duplicate.items[0].bindings.push(repeated);
        assert_eq!(
            plan_variation_job(&duplicate).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn job_rejects_duplicate_item_directories() {
        let mut spec = job(program_template(single_output()));
        spec.items.push(spec.items[0].clone());
        assert_eq!(
            plan_variation_job(&spec).unwrap_err().code,
            ErrorCode::OutputCollision
        );
    }

    #[test]
    fn transport_rejects_unknown_fields() {
        let value = serde_json::json!({
            "schema": SPATIAL_TEMPLATE_SCHEMA,
            "version": SPATIAL_TEMPLATE_VERSION,
            "operation": {
                "kind": "rasterProgram",
                "sourceSlot": "artwork",
                "program": {
                    "schema": RASTER_PROGRAM_SCHEMA,
                    "version": RASTER_PROGRAM_VERSION,
                    "stages": [{
                        "kind": "canvas",
                        "id": "fit",
                        "spec": {
                            "schema": crate::CANVAS_SCHEMA,
                            "version": CANVAS_VERSION,
                            "operation": {
                                "kind": "stretch",
                                "output": { "width": 32, "height": 32 }
                            }
                        }
                    }]
                },
                "unexpected": true
            },
            "output": { "kind": "single", "id": "hero" }
        });
        assert!(serde_json::from_value::<SpatialTemplateSpec>(value).is_err());
    }

    #[test]
    fn raster_program_source_slot_is_camel_case_on_the_wire() {
        let json = serde_json::to_value(program_template(single_output())).unwrap();
        let operation = json.get("operation").unwrap();
        assert_eq!(operation.get("sourceSlot").unwrap(), "artwork");
        assert!(operation.get("source_slot").is_none());

        let mut snake_case = json;
        let operation = snake_case
            .get_mut("operation")
            .and_then(serde_json::Value::as_object_mut)
            .unwrap();
        let value = operation.remove("sourceSlot").unwrap();
        operation.insert("source_slot".to_owned(), value);
        assert!(serde_json::from_value::<SpatialTemplateSpec>(snake_case).is_err());
    }

    #[test]
    fn omitted_failure_policy_is_all_or_none_and_continue_is_echoed() {
        let json = serde_json::json!({
            "schema": VARIATION_JOB_SCHEMA,
            "version": SPATIAL_TEMPLATE_VERSION,
            "template": program_template(single_output()),
            "items": [{
                "id": "sku-1",
                "bindings": [{ "slotId": "artwork", "assetId": "asset-a" }]
            }]
        });
        let spec: VariationJobSpec = serde_json::from_value(json).unwrap();
        assert_eq!(spec.failure_policy, VariationFailurePolicy::AllOrNone);
        let plan = plan_variation_job(&spec).unwrap();
        assert_eq!(plan.failure_policy, VariationFailurePolicy::AllOrNone);

        let mut continued = spec;
        continued.failure_policy = VariationFailurePolicy::Continue;
        assert_eq!(
            plan_variation_job(&continued).unwrap().failure_policy,
            VariationFailurePolicy::Continue
        );
    }
}

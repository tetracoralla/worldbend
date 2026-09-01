use crate::{
    CanvasSpec, CoordinateSpace, ErrorCode, RectifySpec, Size, TransformError, TransformResult,
    TransformSpec, bounded_text, rectify_plane, solve_spec,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const RASTER_PROGRAM_SCHEMA: &str = "worldbend.raster-program";
pub const RASTER_PROGRAM_INSPECTION_SCHEMA: &str = "worldbend.raster-program-inspection";
pub const RASTER_PROGRAM_VERSION: &str = "0.1";
pub const MAX_RASTER_PROGRAM_STAGES: usize = 8;
pub const MAX_RASTER_PROGRAM_PIXELS: u64 = 128 * 1024 * 1024;

const MAX_HEADER_ECHO_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RasterProgramCanvasMode {
    #[default]
    Tight,
    Reference,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum RasterProgramStage {
    Transform {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        spec: TransformSpec,
        #[serde(default)]
        canvas: RasterProgramCanvasMode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target_size: Option<Size>,
    },
    Rectify {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        spec: RectifySpec,
    },
    Canvas {
        #[schemars(
            length(min = 1, max = 64),
            regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
        )]
        id: String,
        spec: CanvasSpec,
    },
}

impl RasterProgramStage {
    pub fn id(&self) -> &str {
        match self {
            Self::Transform { id, .. } | Self::Rectify { id, .. } | Self::Canvas { id, .. } => id,
        }
    }

    pub const fn kind(&self) -> RasterProgramStageKind {
        match self {
            Self::Transform { .. } => RasterProgramStageKind::Transform,
            Self::Rectify { .. } => RasterProgramStageKind::Rectify,
            Self::Canvas { .. } => RasterProgramStageKind::Canvas,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RasterProgramSpec {
    #[schemars(schema_with = "program_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "program_version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = 8))]
    pub stages: Vec<RasterProgramStage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RasterProgramStageKind {
    Transform,
    Rectify,
    Canvas,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RasterProgramStageSummary {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub kind: RasterProgramStageKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RasterProgramInspection {
    #[schemars(schema_with = "inspection_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "program_version_schema")]
    pub version: String,
    #[schemars(range(min = 1, max = 8))]
    pub stage_count: usize,
    #[schemars(length(min = 1, max = 8))]
    pub stages: Vec<RasterProgramStageSummary>,
}

impl RasterProgramSpec {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != RASTER_PROGRAM_SCHEMA {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported schema {:?}; expected {RASTER_PROGRAM_SCHEMA:?}",
                    bounded_text(&self.schema, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        if self.version != RASTER_PROGRAM_VERSION {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported version {:?}; expected {RASTER_PROGRAM_VERSION:?}",
                    bounded_text(&self.version, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        if self.stages.is_empty() || self.stages.len() > MAX_RASTER_PROGRAM_STAGES {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "raster program must contain 1..8 ordered stages",
            )
            .with_details(json!({ "stageCount": self.stages.len() })));
        }

        let mut ids = HashSet::with_capacity(self.stages.len());
        for stage in &self.stages {
            validate_stage_id(stage.id())?;
            if !ids.insert(stage.id()) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "raster program stage ids must be unique",
                )
                .with_details(json!({ "id": stage.id() })));
            }
            match stage {
                RasterProgramStage::Transform {
                    spec, target_size, ..
                } => {
                    if spec.destination.space == CoordinateSpace::Normalized
                        && target_size.is_none()
                    {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "normalized raster-program transform requires targetSize",
                        ));
                    }
                    if let Some(size) = target_size {
                        size.validate("targetSize")?;
                    }
                    solve_spec(spec, *target_size)?;
                }
                RasterProgramStage::Rectify { spec, .. } => {
                    rectify_plane(spec)?;
                }
                RasterProgramStage::Canvas { spec, .. } => spec.validate()?,
            }
        }
        Ok(())
    }
}

pub fn inspect_raster_program(
    spec: &RasterProgramSpec,
) -> TransformResult<RasterProgramInspection> {
    spec.validate()?;
    Ok(RasterProgramInspection {
        schema: RASTER_PROGRAM_INSPECTION_SCHEMA.to_owned(),
        version: RASTER_PROGRAM_VERSION.to_owned(),
        stage_count: spec.stages.len(),
        stages: spec
            .stages
            .iter()
            .map(|stage| RasterProgramStageSummary {
                id: stage.id().to_owned(),
                kind: stage.kind(),
            })
            .collect(),
    })
}

fn validate_stage_id(id: &str) -> TransformResult<()> {
    let valid = (1..=64).contains(&id.len())
        && id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if valid {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Schema,
        "raster program stage id must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$",
    ))
}

fn program_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": RASTER_PROGRAM_SCHEMA })
}

fn inspection_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": RASTER_PROGRAM_INSPECTION_SCHEMA })
}

fn program_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": RASTER_PROGRAM_VERSION })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{CanvasOperation, CoordinateSpace, Destination, Point, Quad};

    fn transform_stage(id: &str) -> RasterProgramStage {
        RasterProgramStage::Transform {
            id: id.to_owned(),
            spec: TransformSpec::pixel(
                Size::new(8.0, 8.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(8.0, 0.0),
                    Point::new(8.0, 8.0),
                    Point::new(0.0, 8.0),
                ),
            ),
            canvas: RasterProgramCanvasMode::Reference,
            target_size: None,
        }
    }

    #[test]
    fn inspection_preserves_order_and_kinds() {
        let spec = RasterProgramSpec {
            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
            version: RASTER_PROGRAM_VERSION.to_owned(),
            stages: vec![
                transform_stage("map"),
                RasterProgramStage::Canvas {
                    id: "crop".to_owned(),
                    spec: CanvasSpec {
                        schema: crate::CANVAS_SCHEMA.to_owned(),
                        version: crate::CANVAS_VERSION.to_owned(),
                        operation: CanvasOperation::Crop {
                            rect: crate::PixelRect {
                                x: 0,
                                y: 0,
                                width: 4,
                                height: 4,
                            },
                        },
                    },
                },
            ],
        };
        let inspection = inspect_raster_program(&spec).unwrap();
        assert_eq!(inspection.stage_count, 2);
        assert_eq!(inspection.stages[0].kind, RasterProgramStageKind::Transform);
        assert_eq!(inspection.stages[1].id, "crop");
    }

    #[test]
    fn rejects_duplicate_ids_before_execution() {
        let spec = RasterProgramSpec {
            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
            version: RASTER_PROGRAM_VERSION.to_owned(),
            stages: vec![transform_stage("same"), transform_stage("same")],
        };
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn normalized_transform_requires_its_own_target_size() {
        let mut stage = transform_stage("map");
        if let RasterProgramStage::Transform {
            spec, target_size, ..
        } = &mut stage
        {
            spec.destination = Destination {
                space: CoordinateSpace::Normalized,
                reference: None,
                quad: Quad::unit(),
            };
            *target_size = None;
        }
        let spec = RasterProgramSpec {
            schema: RASTER_PROGRAM_SCHEMA.to_owned(),
            version: RASTER_PROGRAM_VERSION.to_owned(),
            stages: vec![stage],
        };
        assert_eq!(spec.validate().unwrap_err().code, ErrorCode::Schema);
    }
}

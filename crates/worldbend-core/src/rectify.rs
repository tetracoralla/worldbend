use crate::{
    Bounds, CoordinateSpace, ErrorCode, GeometryDiagnostics, Homography, MatrixDiagnostics, Point,
    Quad, ReprojectionDiagnostics, Size, TransformError, TransformResult, TransformSpec,
    solver::solve_projective_mapping, validate_quad,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

pub const RECTIFY_SCHEMA: &str = "worldbend.rectify";
pub const RECTIFY_VERSION: &str = "0.1";

const MAX_HEADER_ECHO_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PixelSize {
    #[schemars(schema_with = "positive_pixel_dimension_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_pixel_dimension_schema")]
    pub height: u32,
}

fn positive_pixel_dimension_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 1,
        "maximum": u32::MAX
    })
}

impl PixelSize {
    pub const fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }

    pub fn validate(self, field: &str) -> TransformResult<Self> {
        if self.width == 0 || self.height == 0 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!("{field} dimensions must be greater than zero"),
            ));
        }
        Ok(self)
    }

    pub const fn as_size(self) -> Size {
        Size::new(self.width as f64, self.height as f64)
    }

    pub const fn quad(self) -> Quad {
        Quad::new(
            Point::new(0.0, 0.0),
            Point::new(self.width as f64, 0.0),
            Point::new(self.width as f64, self.height as f64),
            Point::new(0.0, self.height as f64),
        )
    }
}

/// Coordinate system for the explicitly selected plane in the source image.
/// Pixel coordinates require the reference image size that authored them;
/// normalized coordinates are reusable across source resolutions.
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(schema_with = "source_plane_schema")]
pub struct SourcePlane {
    pub space: CoordinateSpace,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference: Option<Size>,
    pub quad: Quad,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SourcePlaneWire {
    space: CoordinateSpace,
    #[serde(default, deserialize_with = "deserialize_reference_presence")]
    reference: ReferencePresence,
    quad: Quad,
}

#[derive(Default)]
enum ReferencePresence {
    #[default]
    Missing,
    Present(Option<Size>),
}

fn deserialize_reference_presence<'de, D>(deserializer: D) -> Result<ReferencePresence, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<Size>::deserialize(deserializer).map(ReferencePresence::Present)
}

impl<'de> Deserialize<'de> for SourcePlane {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = SourcePlaneWire::deserialize(deserializer)?;
        let reference = match (wire.space, wire.reference) {
            (CoordinateSpace::Pixel, ReferencePresence::Present(Some(reference))) => {
                Some(reference)
            }
            (CoordinateSpace::Pixel, _) => {
                return Err(serde::de::Error::custom(
                    "pixel source requires a non-null reference",
                ));
            }
            (CoordinateSpace::Normalized, ReferencePresence::Missing) => None,
            (CoordinateSpace::Normalized, ReferencePresence::Present(_)) => {
                return Err(serde::de::Error::custom(
                    "normalized source must not include reference, including null",
                ));
            }
        };
        Ok(Self {
            space: wire.space,
            reference,
            quad: wire.quad,
        })
    }
}

fn source_plane_schema(generator: &mut SchemaGenerator) -> Schema {
    let pixel_reference = generator.subschema_for::<Size>();
    let pixel_quad = generator.subschema_for::<Quad>();
    let normalized_quad = generator.subschema_for::<Quad>();
    json_schema!({
        "oneOf": [
            {
                "type": "object",
                "properties": {
                    "space": { "const": "pixel" },
                    "reference": pixel_reference,
                    "quad": pixel_quad
                },
                "required": ["space", "reference", "quad"],
                "additionalProperties": false
            },
            {
                "type": "object",
                "properties": {
                    "space": { "const": "normalized" },
                    "quad": normalized_quad
                },
                "required": ["space", "quad"],
                "additionalProperties": false
            }
        ]
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct RectifySpec {
    #[schemars(schema_with = "rectify_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "rectify_version_schema")]
    pub version: String,
    pub source: SourcePlane,
    pub output: PixelSize,
}

fn rectify_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": RECTIFY_SCHEMA })
}

fn rectify_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": RECTIFY_VERSION })
}

impl RectifySpec {
    pub fn normalized(source_quad: Quad, output: PixelSize) -> Self {
        Self {
            schema: RECTIFY_SCHEMA.to_owned(),
            version: RECTIFY_VERSION.to_owned(),
            source: SourcePlane {
                space: CoordinateSpace::Normalized,
                reference: None,
                quad: source_quad,
            },
            output,
        }
    }

    pub fn pixel(source_reference: Size, source_quad: Quad, output: PixelSize) -> Self {
        Self {
            schema: RECTIFY_SCHEMA.to_owned(),
            version: RECTIFY_VERSION.to_owned(),
            source: SourcePlane {
                space: CoordinateSpace::Pixel,
                reference: Some(source_reference),
                quad: source_quad,
            },
            output,
        }
    }

    pub fn validate_header(&self) -> TransformResult<()> {
        if self.schema != RECTIFY_SCHEMA {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported schema {:?}; expected {RECTIFY_SCHEMA:?}",
                    crate::bounded_text(&self.schema, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        if self.version != RECTIFY_VERSION {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "unsupported version {:?}; expected {RECTIFY_VERSION:?}",
                    crate::bounded_text(&self.version, MAX_HEADER_ECHO_CHARS)
                ),
            ));
        }
        self.output.validate("output")?;
        match self.source.space {
            CoordinateSpace::Pixel => {
                self.source
                    .reference
                    .ok_or_else(|| {
                        TransformError::new(
                            ErrorCode::Schema,
                            "pixel source requires reference dimensions",
                        )
                    })?
                    .validate("source.reference")?;
            }
            CoordinateSpace::Normalized => {
                if self.source.reference.is_some() {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "normalized source must not include reference dimensions",
                    ));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RectifyDiagnostics {
    pub source_geometry: GeometryDiagnostics,
    pub matrix: MatrixDiagnostics,
    pub reprojection: ReprojectionDiagnostics,
    pub output_bounds: Bounds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RectifyPlan {
    pub spec: RectifySpec,
    pub resolved_source_quad: Quad,
    pub output_quad: Quad,
    pub output_spec: TransformSpec,
    pub homography: Homography,
    pub diagnostics: RectifyDiagnostics,
}

/// Build one deterministic plan that maps the explicitly selected source
/// quadrilateral to the complete output rectangle. No image analysis, aspect
/// inference, camera model, or rasterization happens here.
pub fn rectify_plane(spec: &RectifySpec) -> TransformResult<RectifyPlan> {
    spec.validate_header()?;
    let resolved_source_quad = match spec.source.space {
        CoordinateSpace::Normalized => spec.source.quad,
        CoordinateSpace::Pixel => {
            let reference = spec.source.reference.expect("validated above");
            spec.source
                .quad
                .map(|point| Point::new(point.x / reference.width, point.y / reference.height))
        }
    };
    let source_geometry = validate_quad(&resolved_source_quad)?;
    let output_quad = spec.output.quad();
    // Validate the output rectangle through the same geometry contract even
    // though its shape is constructed here; this keeps future type changes
    // from bypassing the solver precondition.
    validate_quad(&output_quad)?;
    let output_bounds = Bounds::from_quad(output_quad);
    let (homography, matrix, reprojection) = solve_projective_mapping(
        resolved_source_quad.points(),
        output_quad.points(),
        output_bounds.diagonal(),
    )?;
    let output_spec = TransformSpec::pixel(spec.output.as_size(), output_quad);
    Ok(RectifyPlan {
        spec: spec.clone(),
        resolved_source_quad,
        output_quad,
        output_spec,
        homography,
        diagnostics: RectifyDiagnostics {
            source_geometry,
            matrix,
            reprojection,
            output_bounds,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{inverse_transform_point, transform_point};
    use approx::assert_relative_eq;
    use schemars::schema_for;
    use serde_json::{json, to_value};

    fn trapezoid() -> Quad {
        Quad::new(
            Point::new(0.2, 0.15),
            Point::new(0.82, 0.25),
            Point::new(0.72, 0.88),
            Point::new(0.12, 0.76),
        )
    }

    #[test]
    fn maps_the_explicit_source_plane_to_the_output_rectangle() {
        let spec = RectifySpec::normalized(trapezoid(), PixelSize::new(1200, 800));
        let plan = rectify_plane(&spec).unwrap();
        for (source, expected) in trapezoid()
            .points()
            .into_iter()
            .zip(plan.output_quad.points())
        {
            let actual = transform_point(&plan.homography, source).unwrap();
            assert_relative_eq!(actual.x, expected.x, epsilon = 1.0e-8);
            assert_relative_eq!(actual.y, expected.y, epsilon = 1.0e-8);
            let restored = inverse_transform_point(&plan.homography, actual).unwrap();
            assert_relative_eq!(restored.x, source.x, epsilon = 1.0e-10);
            assert_relative_eq!(restored.y, source.y, epsilon = 1.0e-10);
        }
        assert_eq!(plan.output_spec.destination.quad, plan.output_quad);
        assert!(plan.diagnostics.reprojection.max < 1.0e-8);
    }

    #[test]
    fn pixel_and_normalized_source_spaces_produce_the_same_mapping() {
        let normalized = RectifySpec::normalized(trapezoid(), PixelSize::new(640, 480));
        let pixel = RectifySpec::pixel(
            Size::new(2000.0, 1000.0),
            trapezoid().map(|point| Point::new(point.x * 2000.0, point.y * 1000.0)),
            PixelSize::new(640, 480),
        );
        let normalized_plan = rectify_plane(&normalized).unwrap();
        let pixel_plan = rectify_plane(&pixel).unwrap();
        for (left, right) in normalized_plan
            .homography
            .matrix
            .iter()
            .zip(pixel_plan.homography.matrix)
        {
            assert_relative_eq!(*left, right, epsilon = 1.0e-9);
        }
    }

    #[test]
    fn source_plane_union_and_output_integer_constraints_are_in_the_schema() {
        let schema = to_value(schema_for!(RectifySpec)).unwrap();
        assert_eq!(schema["properties"]["schema"]["const"], RECTIFY_SCHEMA);
        assert_eq!(schema["properties"]["version"]["const"], RECTIFY_VERSION);
        assert_eq!(
            schema["$defs"]["PixelSize"]["properties"]["width"]["minimum"],
            1
        );
        let source_ref = schema["properties"]["source"]["$ref"].as_str().unwrap();
        let definition = source_ref.strip_prefix("#/$defs/").unwrap();
        let variants = schema["$defs"][definition]["oneOf"].as_array().unwrap();
        assert_eq!(variants[0]["properties"]["space"]["const"], "pixel");
        assert_eq!(variants[1]["properties"]["space"]["const"], "normalized");
        assert!(variants[1]["properties"].get("reference").is_none());
    }

    #[test]
    fn strict_wire_shape_rejects_unknowns_and_invalid_source_variants() {
        let base = json!({
            "schema": RECTIFY_SCHEMA,
            "version": RECTIFY_VERSION,
            "source": { "space": "normalized", "quad": Quad::unit() },
            "output": { "width": 640, "height": 480 }
        });
        let mut extra = base.clone();
        extra
            .as_object_mut()
            .unwrap()
            .insert("guessAspect".to_owned(), json!(true));
        assert!(serde_json::from_value::<RectifySpec>(extra).is_err());

        let mut null_reference = base;
        null_reference["source"]["reference"] = serde_json::Value::Null;
        assert!(serde_json::from_value::<RectifySpec>(null_reference).is_err());
    }

    #[test]
    fn invalid_source_quad_preserves_the_stable_geometry_error() {
        let bow_tie = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(1.0, 0.0),
            Point::new(0.0, 1.0),
        );
        let error =
            rectify_plane(&RectifySpec::normalized(bow_tie, PixelSize::new(10, 10))).unwrap_err();
        assert_eq!(error.code, ErrorCode::QuadSelfIntersect);
    }
}

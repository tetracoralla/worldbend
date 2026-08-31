use crate::{
    CanvasBackground, CoordinateSpace, ErrorCode, PixelSize, Point, Quad, RectifyPlan, RectifySpec,
    SolveOutput, TransformError, TransformResult, TransformSpec, rectify_plane, solve_spec,
    transform_point,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, HashSet};

pub const MOCKUP_SCHEMA: &str = "worldbend.mockup";
pub const MOCKUP_PLAN_SCHEMA: &str = "worldbend.mockup-plan";
pub const MOCKUP_EXTRACT_SCHEMA: &str = "worldbend.mockup-extract";
pub const MOCKUP_EXTRACT_PLAN_SCHEMA: &str = "worldbend.mockup-extract-plan";
pub const MOCKUP_VERSION: &str = "0.1";
pub const MAX_MOCKUP_PLANES: usize = 16;
pub const MAX_MOCKUP_SEAMS: usize = 32;
pub const MAX_MOCKUP_GRID_DIVISIONS: u16 = 64;
pub const MAX_MOCKUP_AXIS: u32 = 8192;
pub const MAX_MOCKUP_PIXELS: u64 = 64 * 1024 * 1024;
pub const MAX_MOCKUP_EXTRACT_PIXELS: u64 = 64 * 1024 * 1024;

const MAX_HEADER_ECHO_CHARS: usize = 128;
const MAX_ID_BYTES: usize = 64;
const DEFAULT_SEAM_TOLERANCE: f64 = 0.25;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupSpec {
    pub schema: String,
    pub version: String,
    pub canvas: PixelSize,
    #[serde(default = "transparent_background")]
    pub background: CanvasBackground,
    pub planes: Vec<MockupPlane>,
    #[serde(default)]
    pub seams: Vec<MockupSeam>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupPlane {
    pub id: String,
    pub source_id: String,
    pub transform: TransformSpec,
    #[serde(default = "full_opacity")]
    #[schemars(range(min = 0.0, max = 1.0))]
    pub opacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<MockupGrid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measurement: Option<MockupPhysicalSize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupGrid {
    #[schemars(range(min = 1, max = MAX_MOCKUP_GRID_DIVISIONS))]
    pub columns: u16,
    #[schemars(range(min = 1, max = MAX_MOCKUP_GRID_DIVISIONS))]
    pub rows: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupPhysicalSize {
    pub width: f64,
    pub height: f64,
    pub unit: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MockupEdge {
    Top,
    Right,
    Bottom,
    Left,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupEdgeRef {
    pub plane_id: String,
    pub edge: MockupEdge,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupSeam {
    pub first: MockupEdgeRef,
    pub second: MockupEdgeRef,
    #[serde(default = "default_seam_tolerance")]
    pub tolerance_pixels: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupPlan {
    pub schema: String,
    pub version: String,
    pub canvas: PixelSize,
    pub background: CanvasBackground,
    pub planes: Vec<MockupPlanePlan>,
    pub seams: Vec<MockupSeamPlan>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupPlanePlan {
    pub id: String,
    pub source_id: String,
    pub opacity: f64,
    pub transform: TransformSpec,
    pub solve: SolveOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid: Option<MockupGridPlan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measurement: Option<MockupMeasurement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupGridPlan {
    pub columns: u16,
    pub rows: u16,
    pub vertical: Vec<MockupGridLine>,
    pub horizontal: Vec<MockupGridLine>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupGridLine {
    pub start: Point,
    pub end: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMeasurement {
    pub width: f64,
    pub height: f64,
    pub unit: String,
    pub top_pixels: f64,
    pub right_pixels: f64,
    pub bottom_pixels: f64,
    pub left_pixels: f64,
    pub top_pixels_per_unit: f64,
    pub right_pixels_per_unit: f64,
    pub bottom_pixels_per_unit: f64,
    pub left_pixels_per_unit: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupSeamPlan {
    pub first: MockupEdgeRef,
    pub second: MockupEdgeRef,
    pub tolerance_pixels: f64,
    pub reversed: bool,
    pub maximum_error_pixels: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractSpec {
    pub schema: String,
    pub version: String,
    pub outputs: Vec<MockupExtractItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractItem {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub rectify: RectifySpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractPlan {
    pub schema: String,
    pub version: String,
    pub cumulative_output_pixels: u64,
    pub outputs: Vec<MockupExtractPlanItem>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupExtractPlanItem {
    pub id: String,
    pub filename: String,
    pub plan: RectifyPlan,
}

pub fn plan_mockup(spec: &MockupSpec) -> TransformResult<MockupPlan> {
    validate_header(spec)?;
    validate_canvas(spec.canvas)?;
    if spec.planes.is_empty() || spec.planes.len() > MAX_MOCKUP_PLANES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup planes must contain 1 through {MAX_MOCKUP_PLANES} items"),
        ));
    }
    if spec.seams.len() > MAX_MOCKUP_SEAMS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup seams cannot exceed {MAX_MOCKUP_SEAMS} items"),
        ));
    }

    let mut ids = HashSet::with_capacity(spec.planes.len());
    let mut plane_quads = HashMap::with_capacity(spec.planes.len());
    let mut planes = Vec::with_capacity(spec.planes.len());
    for plane in &spec.planes {
        validate_id(&plane.id, "plane id")?;
        validate_id(&plane.source_id, "source id")?;
        if !ids.insert(plane.id.clone()) {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                "mockup plane ids must be unique",
            )
            .with_details(json!({ "planeId": plane.id })));
        }
        if !plane.opacity.is_finite() || !(0.0..=1.0).contains(&plane.opacity) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "mockup plane opacity must be finite and from 0 through 1",
            )
            .with_details(json!({ "planeId": plane.id, "opacity": plane.opacity })));
        }

        let target = match plane.transform.destination.space {
            CoordinateSpace::Normalized => Some(spec.canvas.as_size()),
            CoordinateSpace::Pixel => None,
        };
        let solve = solve_spec(&plane.transform, target)?;
        if solve.resolved_destination.reference != spec.canvas.as_size() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "every pixel-space mockup transform reference must equal the declared canvas",
            )
            .with_details(json!({
                "planeId": plane.id,
                "canvas": spec.canvas,
                "reference": solve.resolved_destination.reference,
            })));
        }
        let quad = solve.resolved_destination.quad;
        plane_quads.insert(plane.id.clone(), quad);
        let grid = plane.grid.map(|grid| plan_grid(grid, &solve)).transpose()?;
        let measurement = plane
            .measurement
            .as_ref()
            .map(|measurement| plan_measurement(measurement, quad))
            .transpose()?;
        planes.push(MockupPlanePlan {
            id: plane.id.clone(),
            source_id: plane.source_id.clone(),
            opacity: plane.opacity,
            transform: plane.transform.clone(),
            solve,
            grid,
            measurement,
        });
    }

    let seams = spec
        .seams
        .iter()
        .map(|seam| plan_seam(seam, &plane_quads))
        .collect::<TransformResult<Vec<_>>>()?;
    Ok(MockupPlan {
        schema: MOCKUP_PLAN_SCHEMA.to_owned(),
        version: MOCKUP_VERSION.to_owned(),
        canvas: spec.canvas,
        background: spec.background,
        planes,
        seams,
    })
}

/// Plan an ordered set of caller-authored plane extractions from one raster.
/// Every output is independent and reads the original source; no output is
/// chained into another.
pub fn plan_mockup_extract(spec: &MockupExtractSpec) -> TransformResult<MockupExtractPlan> {
    if spec.schema != MOCKUP_EXTRACT_SCHEMA || spec.version != MOCKUP_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported mockup extraction schema or version",
        )
        .with_details(json!({
            "expectedSchema": MOCKUP_EXTRACT_SCHEMA,
            "expectedVersion": MOCKUP_VERSION,
            "receivedSchema": spec.schema.chars().take(MAX_HEADER_ECHO_CHARS).collect::<String>(),
            "receivedVersion": spec.version.chars().take(MAX_HEADER_ECHO_CHARS).collect::<String>(),
        })));
    }
    if spec.outputs.is_empty() || spec.outputs.len() > MAX_MOCKUP_PLANES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup extraction outputs must contain 1 through {MAX_MOCKUP_PLANES} items"),
        ));
    }

    let mut ids = HashSet::with_capacity(spec.outputs.len());
    let mut cumulative_output_pixels = 0_u64;
    let mut outputs = Vec::with_capacity(spec.outputs.len());
    for output in &spec.outputs {
        validate_output_id(&output.id)?;
        if !ids.insert(output.id.clone()) {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                "mockup extraction output ids and filenames must be unique",
            )
            .with_details(json!({ "id": output.id })));
        }
        let plan = rectify_plane(&output.rectify)?;
        let pixels = u64::from(output.rectify.output.width)
            .checked_mul(u64::from(output.rectify.output.height))
            .ok_or_else(|| {
                TransformError::new(
                    ErrorCode::OutputLimit,
                    "mockup extraction output pixels overflowed",
                )
            })?;
        cumulative_output_pixels =
            cumulative_output_pixels
                .checked_add(pixels)
                .ok_or_else(|| {
                    TransformError::new(
                        ErrorCode::OutputLimit,
                        "mockup extraction cumulative output pixels overflowed",
                    )
                })?;
        if output.rectify.output.width > MAX_MOCKUP_AXIS
            || output.rectify.output.height > MAX_MOCKUP_AXIS
            || cumulative_output_pixels > MAX_MOCKUP_EXTRACT_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "mockup extraction exceeds the core output limit",
            )
            .with_details(json!({
                "id": output.id,
                "cumulativePixels": cumulative_output_pixels,
                "maximumAxis": MAX_MOCKUP_AXIS,
                "maximumCumulativePixels": MAX_MOCKUP_EXTRACT_PIXELS,
            })));
        }
        outputs.push(MockupExtractPlanItem {
            id: output.id.clone(),
            filename: format!("{}.png", output.id),
            plan,
        });
    }

    Ok(MockupExtractPlan {
        schema: MOCKUP_EXTRACT_PLAN_SCHEMA.to_owned(),
        version: MOCKUP_VERSION.to_owned(),
        cumulative_output_pixels,
        outputs,
    })
}

fn validate_header(spec: &MockupSpec) -> TransformResult<()> {
    if spec.schema != MOCKUP_SCHEMA || spec.version != MOCKUP_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported mockup schema or version",
        )
        .with_details(json!({
            "expectedSchema": MOCKUP_SCHEMA,
            "expectedVersion": MOCKUP_VERSION,
            "receivedSchema": spec.schema.chars().take(MAX_HEADER_ECHO_CHARS).collect::<String>(),
            "receivedVersion": spec.version.chars().take(MAX_HEADER_ECHO_CHARS).collect::<String>(),
        })));
    }
    Ok(())
}

fn validate_canvas(canvas: PixelSize) -> TransformResult<()> {
    canvas.validate("mockup canvas")?;
    let pixels = u64::from(canvas.width) * u64::from(canvas.height);
    if canvas.width > MAX_MOCKUP_AXIS
        || canvas.height > MAX_MOCKUP_AXIS
        || pixels > MAX_MOCKUP_PIXELS
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup canvas exceeds the core output limit",
        )
        .with_details(json!({
            "canvas": canvas,
            "maximumAxis": MAX_MOCKUP_AXIS,
            "maximumPixels": MAX_MOCKUP_PIXELS,
        })));
    }
    Ok(())
}

fn validate_id(value: &str, field: &str) -> TransformResult<()> {
    let valid = !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must be 1..{MAX_ID_BYTES} ASCII letters, digits, '.', '-', or '_'"),
        ));
    }
    Ok(())
}

fn validate_output_id(value: &str) -> TransformResult<()> {
    let mut bytes = value.bytes();
    let valid = value.len() <= MAX_ID_BYTES
        && bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "mockup extraction id must be 1..{MAX_ID_BYTES} ASCII letters, digits, '-', or '_' and begin with a letter or digit"
            ),
        ));
    }
    Ok(())
}

fn plan_grid(grid: MockupGrid, solve: &SolveOutput) -> TransformResult<MockupGridPlan> {
    if grid.columns == 0
        || grid.rows == 0
        || grid.columns > MAX_MOCKUP_GRID_DIVISIONS
        || grid.rows > MAX_MOCKUP_GRID_DIVISIONS
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup grid columns and rows must be 1 through {MAX_MOCKUP_GRID_DIVISIONS}"),
        ));
    }
    let mut vertical = Vec::with_capacity(usize::from(grid.columns) + 1);
    for column in 0..=grid.columns {
        let u = f64::from(column) / f64::from(grid.columns);
        vertical.push(MockupGridLine {
            start: transform_point(&solve.homography, Point::new(u, 0.0))?,
            end: transform_point(&solve.homography, Point::new(u, 1.0))?,
        });
    }
    let mut horizontal = Vec::with_capacity(usize::from(grid.rows) + 1);
    for row in 0..=grid.rows {
        let v = f64::from(row) / f64::from(grid.rows);
        horizontal.push(MockupGridLine {
            start: transform_point(&solve.homography, Point::new(0.0, v))?,
            end: transform_point(&solve.homography, Point::new(1.0, v))?,
        });
    }
    Ok(MockupGridPlan {
        columns: grid.columns,
        rows: grid.rows,
        vertical,
        horizontal,
    })
}

fn plan_measurement(
    physical: &MockupPhysicalSize,
    quad: Quad,
) -> TransformResult<MockupMeasurement> {
    if !physical.width.is_finite()
        || !physical.height.is_finite()
        || physical.width <= 0.0
        || physical.height <= 0.0
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "mockup physical width and height must be finite and greater than zero",
        ));
    }
    validate_id(&physical.unit, "measurement unit")?;
    let top = distance(quad.tl, quad.tr);
    let right = distance(quad.tr, quad.br);
    let bottom = distance(quad.br, quad.bl);
    let left = distance(quad.bl, quad.tl);
    Ok(MockupMeasurement {
        width: physical.width,
        height: physical.height,
        unit: physical.unit.clone(),
        top_pixels: top,
        right_pixels: right,
        bottom_pixels: bottom,
        left_pixels: left,
        top_pixels_per_unit: top / physical.width,
        right_pixels_per_unit: right / physical.height,
        bottom_pixels_per_unit: bottom / physical.width,
        left_pixels_per_unit: left / physical.height,
    })
}

fn plan_seam(seam: &MockupSeam, planes: &HashMap<String, Quad>) -> TransformResult<MockupSeamPlan> {
    if !seam.tolerance_pixels.is_finite() || seam.tolerance_pixels < 0.0 {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "mockup seam tolerance must be finite and non-negative",
        ));
    }
    let first_quad = planes.get(&seam.first.plane_id).ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            "mockup seam references an unknown first plane",
        )
        .with_details(json!({ "planeId": seam.first.plane_id }))
    })?;
    let second_quad = planes.get(&seam.second.plane_id).ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            "mockup seam references an unknown second plane",
        )
        .with_details(json!({ "planeId": seam.second.plane_id }))
    })?;
    if seam.first == seam.second {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup seam must reference two different plane edges",
        ));
    }
    let first = edge_points(*first_quad, seam.first.edge);
    let second = edge_points(*second_quad, seam.second.edge);
    let same = distance(first.0, second.0).max(distance(first.1, second.1));
    let reversed = distance(first.0, second.1).max(distance(first.1, second.0));
    let (maximum_error_pixels, is_reversed) = if reversed < same {
        (reversed, true)
    } else {
        (same, false)
    };
    if maximum_error_pixels > seam.tolerance_pixels {
        return Err(TransformError::new(
            ErrorCode::SharedEdgeMismatch,
            "declared mockup edges do not share endpoints within tolerance",
        )
        .with_details(json!({
            "first": seam.first,
            "second": seam.second,
            "maximumErrorPixels": maximum_error_pixels,
            "tolerancePixels": seam.tolerance_pixels,
        })));
    }
    Ok(MockupSeamPlan {
        first: seam.first.clone(),
        second: seam.second.clone(),
        tolerance_pixels: seam.tolerance_pixels,
        reversed: is_reversed,
        maximum_error_pixels,
    })
}

const fn edge_points(quad: Quad, edge: MockupEdge) -> (Point, Point) {
    match edge {
        MockupEdge::Top => (quad.tl, quad.tr),
        MockupEdge::Right => (quad.tr, quad.br),
        MockupEdge::Bottom => (quad.br, quad.bl),
        MockupEdge::Left => (quad.bl, quad.tl),
    }
}

fn distance(first: Point, second: Point) -> f64 {
    (first.x - second.x).hypot(first.y - second.y)
}

const fn transparent_background() -> CanvasBackground {
    CanvasBackground::Transparent {}
}

const fn full_opacity() -> f64 {
    1.0
}

const fn default_seam_tolerance() -> f64 {
    DEFAULT_SEAM_TOLERANCE
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Quad, Size};

    fn plane(id: &str, source_id: &str, quad: Quad) -> MockupPlane {
        MockupPlane {
            id: id.to_owned(),
            source_id: source_id.to_owned(),
            transform: TransformSpec::pixel(Size::new(200.0, 100.0), quad),
            opacity: 1.0,
            grid: Some(MockupGrid {
                columns: 2,
                rows: 2,
            }),
            measurement: Some(MockupPhysicalSize {
                width: 10.0,
                height: 20.0,
                unit: "cm".to_owned(),
            }),
        }
    }

    fn two_face_spec() -> MockupSpec {
        MockupSpec {
            schema: MOCKUP_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            canvas: PixelSize::new(200, 100),
            background: CanvasBackground::Transparent {},
            planes: vec![
                plane(
                    "front",
                    "artwork",
                    Quad::new(
                        Point::new(0.0, 0.0),
                        Point::new(100.0, 0.0),
                        Point::new(100.0, 100.0),
                        Point::new(0.0, 100.0),
                    ),
                ),
                plane(
                    "side",
                    "artwork",
                    Quad::new(
                        Point::new(100.0, 0.0),
                        Point::new(200.0, 10.0),
                        Point::new(200.0, 90.0),
                        Point::new(100.0, 100.0),
                    ),
                ),
            ],
            seams: vec![MockupSeam {
                first: MockupEdgeRef {
                    plane_id: "front".to_owned(),
                    edge: MockupEdge::Right,
                },
                second: MockupEdgeRef {
                    plane_id: "side".to_owned(),
                    edge: MockupEdge::Left,
                },
                tolerance_pixels: 0.0,
            }],
        }
    }

    #[test]
    fn plans_connected_planes_grids_and_measurements() {
        let plan = plan_mockup(&two_face_spec()).unwrap();
        assert_eq!(plan.schema, MOCKUP_PLAN_SCHEMA);
        assert_eq!(plan.planes.len(), 2);
        assert_eq!(plan.planes[0].grid.as_ref().unwrap().vertical.len(), 3);
        assert_eq!(plan.planes[0].grid.as_ref().unwrap().horizontal.len(), 3);
        assert_eq!(
            plan.planes[0]
                .measurement
                .as_ref()
                .unwrap()
                .top_pixels_per_unit,
            10.0
        );
        assert!(plan.seams[0].reversed);
        assert_eq!(plan.seams[0].maximum_error_pixels, 0.0);
    }

    #[test]
    fn normalized_planes_resolve_against_the_declared_canvas() {
        let mut spec = two_face_spec();
        spec.planes.truncate(1);
        spec.seams.clear();
        spec.planes[0].transform = TransformSpec::normalized(Quad::unit());
        let plan = plan_mockup(&spec).unwrap();
        assert_eq!(
            plan.planes[0].solve.resolved_destination.reference,
            Size::new(200.0, 100.0)
        );
    }

    #[test]
    fn rejects_duplicate_ids_and_broken_declared_seams() {
        let mut duplicate = two_face_spec();
        duplicate.planes[1].id = "front".to_owned();
        assert_eq!(
            plan_mockup(&duplicate).unwrap_err().code,
            ErrorCode::OutputCollision
        );

        let mut broken = two_face_spec();
        broken.planes[1].transform = TransformSpec::pixel(
            Size::new(200.0, 100.0),
            Quad::new(
                Point::new(110.0, 0.0),
                Point::new(200.0, 10.0),
                Point::new(200.0, 90.0),
                Point::new(110.0, 100.0),
            ),
        );
        assert_eq!(
            plan_mockup(&broken).unwrap_err().code,
            ErrorCode::SharedEdgeMismatch
        );
    }

    #[test]
    fn plans_ordered_reverse_extraction_with_derived_safe_filenames() {
        let spec = MockupExtractSpec {
            schema: MOCKUP_EXTRACT_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            outputs: vec![
                MockupExtractItem {
                    id: "front".to_owned(),
                    rectify: RectifySpec::normalized(Quad::unit(), PixelSize::new(20, 10)),
                },
                MockupExtractItem {
                    id: "side_2".to_owned(),
                    rectify: RectifySpec::normalized(Quad::unit(), PixelSize::new(5, 6)),
                },
            ],
        };
        let plan = plan_mockup_extract(&spec).unwrap();
        assert_eq!(plan.schema, MOCKUP_EXTRACT_PLAN_SCHEMA);
        assert_eq!(plan.cumulative_output_pixels, 230);
        assert_eq!(
            plan.outputs
                .iter()
                .map(|output| output.filename.as_str())
                .collect::<Vec<_>>(),
            ["front.png", "side_2.png"]
        );
    }

    #[test]
    fn reverse_extraction_rejects_filename_collisions_and_unsafe_ids() {
        let item = MockupExtractItem {
            id: "front".to_owned(),
            rectify: RectifySpec::normalized(Quad::unit(), PixelSize::new(2, 2)),
        };
        let duplicate = MockupExtractSpec {
            schema: MOCKUP_EXTRACT_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            outputs: vec![item.clone(), item],
        };
        assert_eq!(
            plan_mockup_extract(&duplicate).unwrap_err().code,
            ErrorCode::OutputCollision
        );

        let unsafe_id = MockupExtractSpec {
            schema: MOCKUP_EXTRACT_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            outputs: vec![MockupExtractItem {
                id: "../front".to_owned(),
                rectify: RectifySpec::normalized(Quad::unit(), PixelSize::new(2, 2)),
            }],
        };
        assert_eq!(
            plan_mockup_extract(&unsafe_id).unwrap_err().code,
            ErrorCode::Schema
        );
    }
}

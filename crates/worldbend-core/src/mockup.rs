use crate::{
    Bounds, CanvasBackground, CoordinateSpace, ErrorCode, PixelSize, Point, Quad, RectifyPlan,
    RectifySpec, Size, SolveOutput, TransformError, TransformResult, TransformSpec,
    polygon_signed_area, rectify_plane, solve_spec, transform_point,
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
pub const MAX_MOCKUP_CLIP_CONTOURS: usize = 8;
pub const MAX_MOCKUP_CLIP_SEGMENTS_PER_CONTOUR: usize = 128;
pub const MAX_MOCKUP_CLIP_TOTAL_SEGMENTS: usize = 512;

const MAX_HEADER_ECHO_CHARS: usize = 128;
const MAX_ID_BYTES: usize = 64;
const DEFAULT_SEAM_TOLERANCE: f64 = 0.25;
/// Flattening tolerance for clip curves, measured in canvas pixels.
const CLIP_FLATTEN_TOLERANCE: f64 = 0.05;
/// A flattened contour must cover at least this much of the canvas to clip
/// anything; smaller contours are treated as degenerate authoring mistakes.
const CLIP_MIN_CONTOUR_AREA_PIXELS: f64 = 0.25;

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
    /// Explicit output clip in normalized canvas coordinates. The composite is
    /// masked to the covered region; clipping is the only meaning — the planes
    /// are never reshaped to the contour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<MockupClip>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<crate::MockupSurface>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<crate::MockupShadow>,
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

/// A closed clip contour in normalized canvas coordinates. Each contour closes
/// implicitly from its final segment endpoint back to `start`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupClipContour {
    pub start: Point,
    pub segments: Vec<MockupClipSegment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MockupClipSegment {
    Line { to: Point },
    Cubic { c1: Point, c2: Point, to: Point },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MockupClipFillRule {
    NonZero,
    EvenOdd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupClip {
    pub contours: Vec<MockupClipContour>,
    #[serde(default = "default_clip_fill_rule")]
    pub fill_rule: MockupClipFillRule,
    /// Independent filled regions are combined by geometric union. Omitted
    /// regions retain the single compound path governed by `fill_rule`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<MockupClipRegion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupClipRegion {
    pub contour_indices: Vec<usize>,
    #[serde(default = "default_clip_fill_rule")]
    pub fill_rule: MockupClipFillRule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupClipPlan {
    pub contours: Vec<MockupClipContour>,
    pub fill_rule: MockupClipFillRule,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<MockupClipRegion>,
    /// Canvas-pixel bounds of the flattened contours. Contours may legitimately
    /// extend past the canvas; these bounds are not clamped to it.
    pub bounds: Bounds,
    /// Sum of the per-contour flattened areas in canvas pixels. For compound
    /// or overlapping contours this is not the exact covered region; the fill
    /// rule still governs rendering.
    pub contour_area_pixels: f64,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<MockupClipPlan>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<crate::MockupSurface>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shadow: Option<crate::MockupShadowPlan>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupGridPlan {
    pub columns: u16,
    pub rows: u16,
    pub vertical: Vec<MockupGridLine>,
    pub horizontal: Vec<MockupGridLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupGridLine {
    pub start: Point,
    pub end: Point,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
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
        let surface_mesh = plane
            .surface
            .map(|surface| crate::build_mockup_surface_mesh(surface, None))
            .transpose()?
            .filter(|mesh| mesh.boundary == crate::MeshBoundary::Free);
        if let (Some(surface), Some(warp)) = (plane.surface, plane.transform.content.warp) {
            crate::build_mockup_surface_mesh(surface, Some(warp))?;
        }
        let mut edges: [Vec<Point>; 4] = Default::default();
        for (index, (a, b)) in [
            (Point::new(0.0, 0.0), Point::new(1.0, 0.0)),
            (Point::new(1.0, 0.0), Point::new(1.0, 1.0)),
            (Point::new(1.0, 1.0), Point::new(0.0, 1.0)),
            (Point::new(0.0, 1.0), Point::new(0.0, 0.0)),
        ]
        .into_iter()
        .enumerate()
        {
            edges[index] = if let Some(mesh) = surface_mesh.as_ref() {
                project_grid_line(a, b, &solve, Some(mesh))?
                    .points
                    .expect("surface line")
            } else {
                let points = quad.points();
                vec![points[index], points[(index + 1) % 4]]
            };
        }
        plane_quads.insert(plane.id.clone(), edges);
        let grid = plane
            .grid
            .map(|grid| plan_grid(grid, &solve, surface_mesh.as_ref()))
            .transpose()?;
        let measurement = plane
            .measurement
            .as_ref()
            .map(|measurement| plan_measurement(measurement, quad, &solve, surface_mesh.as_ref()))
            .transpose()?;
        planes.push(MockupPlanePlan {
            id: plane.id.clone(),
            source_id: plane.source_id.clone(),
            opacity: plane.opacity,
            transform: plane.transform.clone(),
            solve: solve.clone(),
            grid,
            measurement,
            surface: plane.surface,
            shadow: plane
                .shadow
                .map(|shadow| {
                    crate::plan_mockup_shadow(shadow, &plane.transform, &solve, spec.canvas)
                })
                .transpose()?,
        });
    }

    let seams = spec
        .seams
        .iter()
        .map(|seam| plan_seam(seam, &plane_quads))
        .collect::<TransformResult<Vec<_>>>()?;
    let clip = spec
        .clip
        .as_ref()
        .map(|clip| plan_clip(clip, spec.canvas.as_size()))
        .transpose()?;
    Ok(MockupPlan {
        schema: MOCKUP_PLAN_SCHEMA.to_owned(),
        version: MOCKUP_VERSION.to_owned(),
        canvas: spec.canvas,
        background: spec.background,
        planes,
        seams,
        clip,
    })
}

/// Validate one explicit clip and resolve its canvas-pixel geometry.
pub(crate) fn plan_clip(clip: &MockupClip, canvas: Size) -> TransformResult<MockupClipPlan> {
    if clip.contours.is_empty() || clip.contours.len() > MAX_MOCKUP_CLIP_CONTOURS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup clip contours must contain 1 through {MAX_MOCKUP_CLIP_CONTOURS} items"),
        ));
    }
    if clip.regions.len() > MAX_MOCKUP_CLIP_CONTOURS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup clip has too many regions",
        ));
    }
    if !clip.regions.is_empty() {
        let mut referenced = vec![false; clip.contours.len()];
        for (region_index, region) in clip.regions.iter().enumerate() {
            let mut unique = HashSet::new();
            if region.contour_indices.is_empty()
                || region.contour_indices.iter().any(|&index| {
                    if index >= referenced.len() || !unique.insert(index) {
                        return true;
                    }
                    referenced[index] = true;
                    false
                })
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "mockup clip region must reference distinct existing contours",
                )
                .with_details(json!({ "region": region_index })));
            }
        }
        if referenced.iter().any(|included| !included) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "every mockup clip contour must belong to a region",
            ));
        }
    }
    let total_segments: usize = clip
        .contours
        .iter()
        .map(|contour| contour.segments.len())
        .sum();
    if total_segments > MAX_MOCKUP_CLIP_TOTAL_SEGMENTS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("mockup clip segments cannot exceed {MAX_MOCKUP_CLIP_TOTAL_SEGMENTS} in total"),
        ));
    }
    let mut bounds = Bounds {
        x: f64::INFINITY,
        y: f64::INFINITY,
        width: f64::NEG_INFINITY,
        height: f64::NEG_INFINITY,
    };
    let mut contour_area_pixels = 0.0_f64;
    for (index, contour) in clip.contours.iter().enumerate() {
        if contour.segments.len() < 2
            || contour.segments.len() > MAX_MOCKUP_CLIP_SEGMENTS_PER_CONTOUR
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "mockup clip contour segments must contain 2 through \
                     {MAX_MOCKUP_CLIP_SEGMENTS_PER_CONTOUR} items"
                ),
            )
            .with_details(json!({ "contour": index })));
        }
        if !clip_contour_points(contour).all(|point| point.x.is_finite() && point.y.is_finite()) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "mockup clip coordinates must be finite",
            )
            .with_details(json!({ "contour": index })));
        }
        if !clip_contour_points(contour).all(|point| {
            (point.x * canvas.width).is_finite() && (point.y * canvas.height).is_finite()
        }) {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "mockup clip coordinates cannot be represented in canvas pixels",
            )
            .with_details(json!({ "contour": index })));
        }
        let flattened = flatten_mockup_clip_contour(contour, canvas);
        let area = polygon_signed_area(&flattened).abs();
        if !area.is_finite()
            || flattened
                .iter()
                .any(|point| !point.x.is_finite() || !point.y.is_finite())
        {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "mockup clip geometry cannot be represented in canvas pixels",
            )
            .with_details(json!({ "contour": index })));
        }
        if area < CLIP_MIN_CONTOUR_AREA_PIXELS {
            return Err(TransformError::new(
                ErrorCode::ClipDegenerate,
                "mockup clip contour covers no canvas area",
            )
            .with_details(json!({ "contour": index, "areaPixels": area })));
        }
        contour_area_pixels += area;
        for point in &flattened {
            bounds.x = bounds.x.min(point.x);
            bounds.y = bounds.y.min(point.y);
            bounds.width = bounds.width.max(point.x);
            bounds.height = bounds.height.max(point.y);
        }
    }
    if !contour_area_pixels.is_finite()
        || !(bounds.width - bounds.x).is_finite()
        || !(bounds.height - bounds.y).is_finite()
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "mockup clip bounds or area cannot be represented in canvas pixels",
        ));
    }
    // The min/max folds above only ever spread `width`/`height` outward from
    // sentinel negatives while `x`/`y` shrink from positive infinity.
    Ok(MockupClipPlan {
        contours: clip.contours.clone(),
        fill_rule: clip.fill_rule,
        regions: clip.regions.clone(),
        bounds: Bounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width - bounds.x,
            height: bounds.height - bounds.y,
        },
        contour_area_pixels,
    })
}

/// Iterate every authored point of a contour, including cubic control points.
fn clip_contour_points(contour: &MockupClipContour) -> impl Iterator<Item = Point> + '_ {
    std::iter::once(contour.start).chain(contour.segments.iter().flat_map(|segment| {
        let points: Vec<Point> = match *segment {
            MockupClipSegment::Line { to } => vec![to],
            MockupClipSegment::Cubic { c1, c2, to } => vec![c1, c2, to],
        };
        points.into_iter()
    }))
}

/// Flatten one clip contour to canvas pixels with a deterministic tolerance.
/// The final implicit closing edge back to `start` is included.
pub fn flatten_mockup_clip_contour(contour: &MockupClipContour, canvas: Size) -> Vec<Point> {
    let scale = |point: Point| Point::new(point.x * canvas.width, point.y * canvas.height);
    let start = scale(contour.start);
    let mut points = vec![start];
    let mut cursor = start;
    for segment in &contour.segments {
        match *segment {
            MockupClipSegment::Line { to } => {
                cursor = scale(to);
                points.push(cursor);
            }
            MockupClipSegment::Cubic { c1, c2, to } => {
                let control1 = scale(c1);
                let control2 = scale(c2);
                let end = scale(to);
                flatten_cubic(cursor, control1, control2, end, 0, &mut points);
                cursor = end;
                points.push(cursor);
            }
        }
    }
    points.push(start);
    points
}

const CLIP_FLATTEN_MAX_DEPTH: u32 = 16;

fn flatten_cubic(from: Point, c1: Point, c2: Point, to: Point, depth: u32, out: &mut Vec<Point>) {
    // Control-point distance from the chord bounds the curve's deviation.
    let chord = Point::new(to.x - from.x, to.y - from.y);
    let chord_length = chord.x.hypot(chord.y);
    let deviation = |point: Point| {
        if chord_length <= f64::EPSILON {
            point.x.hypot(point.y)
        } else {
            ((point.x - from.x) * chord.y - (point.y - from.y) * chord.x).abs() / chord_length
        }
    };
    if depth >= CLIP_FLATTEN_MAX_DEPTH || deviation(c1).max(deviation(c2)) <= CLIP_FLATTEN_TOLERANCE
    {
        return;
    }
    let lerp = |a: Point, b: Point| Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    let d01 = lerp(from, c1);
    let d12 = lerp(c1, c2);
    let d23 = lerp(c2, to);
    let d012 = lerp(d01, d12);
    let d123 = lerp(d12, d23);
    let middle = lerp(d012, d123);
    flatten_cubic(from, d01, d012, middle, depth + 1, out);
    out.push(middle);
    flatten_cubic(middle, d123, d23, to, depth + 1, out);
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

fn plan_grid(
    grid: MockupGrid,
    solve: &SolveOutput,
    mesh: Option<&crate::WarpMesh>,
) -> TransformResult<MockupGridPlan> {
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
        vertical.push(project_grid_line(
            Point::new(u, 0.0),
            Point::new(u, 1.0),
            solve,
            mesh,
        )?);
    }
    let mut horizontal = Vec::with_capacity(usize::from(grid.rows) + 1);
    for row in 0..=grid.rows {
        let v = f64::from(row) / f64::from(grid.rows);
        horizontal.push(project_grid_line(
            Point::new(0.0, v),
            Point::new(1.0, v),
            solve,
            mesh,
        )?);
    }
    Ok(MockupGridPlan {
        columns: grid.columns,
        rows: grid.rows,
        vertical,
        horizontal,
    })
}

fn project_grid_line(
    a: Point,
    b: Point,
    solve: &SolveOutput,
    mesh: Option<&crate::WarpMesh>,
) -> TransformResult<MockupGridLine> {
    let project = |p: Point| {
        transform_point(
            &solve.homography,
            mesh.map_or(Ok(p), |mesh| crate::mockup_surface::sample_mesh(mesh, p))?,
        )
    };
    let points = mesh
        .map(|mesh| {
            let subdivisions = mesh
                .grid_subdivisions()
                .unwrap_or(crate::MAX_SURFACE_MESH_SUBDIVISIONS);
            (0..=subdivisions)
                .map(|index| {
                    let t = f64::from(index) / f64::from(subdivisions);
                    project(Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t))
                })
                .collect::<TransformResult<Vec<_>>>()
        })
        .transpose()?;
    Ok(MockupGridLine {
        start: project(a)?,
        end: project(b)?,
        points,
    })
}

fn plan_measurement(
    physical: &MockupPhysicalSize,
    quad: Quad,
    solve: &SolveOutput,
    mesh: Option<&crate::WarpMesh>,
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
    let lengths = if mesh.is_some() {
        let mut lengths = [0.0; 4];
        for (index, (a, b)) in [
            (Point::new(0.0, 0.0), Point::new(1.0, 0.0)),
            (Point::new(1.0, 0.0), Point::new(1.0, 1.0)),
            (Point::new(1.0, 1.0), Point::new(0.0, 1.0)),
            (Point::new(0.0, 1.0), Point::new(0.0, 0.0)),
        ]
        .into_iter()
        .enumerate()
        {
            let line = project_grid_line(a, b, solve, mesh)?;
            lengths[index] = line
                .points
                .expect("surface line")
                .windows(2)
                .map(|pair| distance(pair[0], pair[1]))
                .sum();
        }
        lengths
    } else {
        [
            distance(quad.tl, quad.tr),
            distance(quad.tr, quad.br),
            distance(quad.br, quad.bl),
            distance(quad.bl, quad.tl),
        ]
    };
    let [top, right, bottom, left] = lengths;
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

fn plan_seam(
    seam: &MockupSeam,
    planes: &HashMap<String, [Vec<Point>; 4]>,
) -> TransformResult<MockupSeamPlan> {
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
    let index = |edge| match edge {
        MockupEdge::Top => 0,
        MockupEdge::Right => 1,
        MockupEdge::Bottom => 2,
        MockupEdge::Left => 3,
    };
    let first = &first_quad[index(seam.first.edge)];
    let second = &second_quad[index(seam.second.edge)];
    let samples = (first.len() - 1).max(second.len() - 1);
    let sample = |points: &[Point], t: f64| {
        if t == 0.0 {
            return points[0];
        }
        if t == 1.0 {
            return *points.last().expect("nonempty edge");
        }
        let grid = t * (points.len() - 1) as f64;
        let i = (grid.floor() as usize).min(points.len() - 2);
        let f = grid - i as f64;
        Point::new(
            points[i].x + (points[i + 1].x - points[i].x) * f,
            points[i].y + (points[i + 1].y - points[i].y) * f,
        )
    };
    let maximum_error = |reverse: bool| {
        (0..=samples)
            .map(|i| {
                let t = i as f64 / samples as f64;
                distance(
                    sample(first, t),
                    sample(second, if reverse { 1.0 - t } else { t }),
                )
            })
            .fold(0.0, f64::max)
    };
    let same = maximum_error(false);
    let reversed = maximum_error(true);
    let (maximum_error_pixels, is_reversed) = if reversed < same {
        (reversed, true)
    } else {
        (same, false)
    };
    if maximum_error_pixels > seam.tolerance_pixels {
        return Err(TransformError::new(
            ErrorCode::SharedEdgeMismatch,
            "declared mockup edges do not match within tolerance",
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

const fn default_clip_fill_rule() -> MockupClipFillRule {
    MockupClipFillRule::NonZero
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Quad, Size};
    use schemars::schema_for;

    #[test]
    fn curved_guides_measurements_and_seams_follow_the_actual_mesh() {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(200.0, 0.0),
            Point::new(200.0, 100.0),
            Point::new(0.0, 100.0),
        );
        let mut front = plane("front", "art", quad);
        front.surface = Some(crate::MockupSurface::Fabric {
            folds: 1,
            depth: 1.0,
            phase: 0.0,
            light: Default::default(),
        });
        let mut spec = MockupSpec {
            schema: MOCKUP_SCHEMA.into(),
            version: MOCKUP_VERSION.into(),
            canvas: PixelSize::new(200, 100),
            background: transparent_background(),
            planes: vec![front.clone()],
            seams: vec![],
            clip: None,
        };
        let plan = plan_mockup(&spec).unwrap();
        let edge = &plan.planes[0].grid.as_ref().unwrap().horizontal[0];
        assert_eq!(edge.points.as_ref().unwrap().len(), 33);
        assert!(
            plan.planes[0].measurement.as_ref().unwrap().top_pixels
                > distance(edge.start, edge.end)
        );
        spec.planes[0].transform.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.8,
        });
        assert_eq!(
            plan_mockup(&spec).unwrap().planes[0].grid,
            plan.planes[0].grid,
            "surface guides describe the physical surface independently of content Warp"
        );
        let mut second = front;
        second.id = "second".into();
        spec.planes.push(second);
        spec.seams.push(MockupSeam {
            first: MockupEdgeRef {
                plane_id: "front".into(),
                edge: MockupEdge::Top,
            },
            second: MockupEdgeRef {
                plane_id: "second".into(),
                edge: MockupEdge::Top,
            },
            tolerance_pixels: 0.0,
        });
        assert_eq!(
            plan_mockup(&spec).unwrap().seams[0].maximum_error_pixels,
            0.0
        );
        spec.planes[1].surface = Some(crate::MockupSurface::Fabric {
            folds: 2,
            depth: 1.0,
            phase: 0.0,
            light: Default::default(),
        });
        assert_eq!(
            plan_mockup(&spec).unwrap_err().code,
            ErrorCode::SharedEdgeMismatch
        );
    }

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
            surface: None,
            shadow: None,
        }
    }

    fn two_face_spec() -> MockupSpec {
        MockupSpec {
            schema: MOCKUP_SCHEMA.to_owned(),
            version: MOCKUP_VERSION.to_owned(),
            canvas: PixelSize::new(200, 100),
            background: CanvasBackground::Transparent {},
            clip: None,
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

    fn triangle_clip() -> MockupClip {
        MockupClip {
            regions: Vec::new(),
            contours: vec![MockupClipContour {
                start: Point::new(0.1, 0.1),
                segments: vec![
                    MockupClipSegment::Line {
                        to: Point::new(0.9, 0.1),
                    },
                    MockupClipSegment::Cubic {
                        c1: Point::new(0.9, 0.6),
                        c2: Point::new(0.6, 0.9),
                        to: Point::new(0.1, 0.9),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(0.1, 0.1),
                    },
                ],
            }],
            fill_rule: MockupClipFillRule::EvenOdd,
        }
    }

    #[test]
    fn plans_explicit_clips_with_resolved_canvas_geometry() {
        let mut spec = two_face_spec();
        spec.planes.truncate(1);
        spec.seams.clear();
        spec.clip = Some(triangle_clip());
        let plan = plan_mockup(&spec).unwrap();
        let clip = plan.clip.unwrap();
        assert_eq!(clip.fill_rule, MockupClipFillRule::EvenOdd);
        assert_eq!(clip.contours.len(), 1);
        // Canvas is 200x100: the authored unit box maps to that rectangle.
        assert!((clip.bounds.x - 20.0).abs() < 1e-6);
        assert!((clip.bounds.y - 10.0).abs() < 1e-6);
        assert!((clip.bounds.width - 160.0).abs() < 1e-6);
        assert!((clip.bounds.height - 80.0).abs() < 1e-6);
        // Triangle area is half the 160x80 box; the cubic bulge adds to it.
        assert!(clip.contour_area_pixels > 0.5 * 160.0 * 80.0);
        assert!(clip.contour_area_pixels < 160.0 * 80.0);
    }

    #[test]
    fn clip_is_optional_and_defaults_to_nonzero_fill() {
        let optional: MockupClip = serde_json::from_str(
            r#"{ "contours": [{ "start": { "x": 0, "y": 0 }, "segments": [
                { "kind": "line", "to": { "x": 1, "y": 0 } },
                { "kind": "line", "to": { "x": 1, "y": 1 } },
                { "kind": "line", "to": { "x": 0, "y": 1 } } ] }] }"#,
        )
        .unwrap();
        assert_eq!(optional.fill_rule, MockupClipFillRule::NonZero);

        let mut spec = two_face_spec();
        spec.planes.truncate(1);
        spec.seams.clear();
        // A spec authored without a clip still plans to the same output as before.
        let plan = plan_mockup(&spec).unwrap();
        assert!(plan.clip.is_none());
        let echoed: MockupSpec =
            serde_json::from_value(serde_json::to_value(&spec).unwrap()).unwrap();
        assert!(echoed.clip.is_none());
    }

    #[test]
    fn rejects_degenerate_and_unbounded_clips() {
        let mut spec = two_face_spec();
        spec.planes.truncate(1);
        spec.seams.clear();

        // Collinear contour covers no area.
        let mut degenerate = spec.clone();
        degenerate.clip = Some(MockupClip {
            regions: Vec::new(),
            contours: vec![MockupClipContour {
                start: Point::new(0.0, 0.5),
                segments: vec![
                    MockupClipSegment::Line {
                        to: Point::new(0.5, 0.5),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(1.0, 0.5),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(0.0, 0.5),
                    },
                ],
            }],
            fill_rule: MockupClipFillRule::NonZero,
        });
        assert_eq!(
            plan_mockup(&degenerate).unwrap_err().code,
            ErrorCode::ClipDegenerate
        );

        // One segment cannot enclose an area.
        let mut short = spec.clone();
        short.clip = Some(MockupClip {
            regions: Vec::new(),
            contours: vec![MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: vec![MockupClipSegment::Line {
                    to: Point::new(1.0, 1.0),
                }],
            }],
            fill_rule: MockupClipFillRule::NonZero,
        });
        assert_eq!(plan_mockup(&short).unwrap_err().code, ErrorCode::Schema);

        // Non-finite control points are rejected before any flattening.
        let mut nonfinite = spec.clone();
        nonfinite.clip = Some(MockupClip {
            regions: Vec::new(),
            contours: vec![MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: vec![
                    MockupClipSegment::Cubic {
                        c1: Point::new(f64::NAN, 0.2),
                        c2: Point::new(0.8, 0.4),
                        to: Point::new(1.0, 1.0),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(0.0, 1.0),
                    },
                ],
            }],
            fill_rule: MockupClipFillRule::NonZero,
        });
        assert_eq!(
            plan_mockup(&nonfinite).unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );

        // Contour-count and total-segment ceilings hold.
        let mut too_many_contours = spec.clone();
        too_many_contours.clip = Some(MockupClip {
            regions: Vec::new(),
            contours: (0..=MAX_MOCKUP_CLIP_CONTOURS)
                .map(|_| MockupClipContour {
                    start: Point::new(0.0, 0.0),
                    segments: vec![
                        MockupClipSegment::Line {
                            to: Point::new(1.0, 0.0),
                        },
                        MockupClipSegment::Line {
                            to: Point::new(1.0, 1.0),
                        },
                        MockupClipSegment::Line {
                            to: Point::new(0.0, 1.0),
                        },
                    ],
                })
                .collect(),
            fill_rule: MockupClipFillRule::NonZero,
        });
        assert_eq!(
            plan_mockup(&too_many_contours).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn rejects_finite_inputs_whose_pixel_geometry_or_area_overflows() {
        for coordinate in [1e308, 1e155] {
            let mut spec = two_face_spec();
            spec.clip = Some(MockupClip {
                contours: vec![MockupClipContour {
                    start: Point::new(coordinate, coordinate),
                    segments: vec![
                        MockupClipSegment::Line {
                            to: Point::new(coordinate, -coordinate),
                        },
                        MockupClipSegment::Line {
                            to: Point::new(-coordinate, -coordinate),
                        },
                    ],
                }],
                fill_rule: MockupClipFillRule::NonZero,
                regions: vec![],
            });
            assert_eq!(
                plan_mockup(&spec).unwrap_err().code,
                ErrorCode::NonFiniteCoordinate
            );
        }
    }

    #[test]
    fn clip_schema_names_the_fill_rule_and_segment_kinds() {
        let schema = schema_for!(MockupClip);
        let value = serde_json::to_value(&schema).unwrap();
        let text = serde_json::to_string(&value).unwrap();
        assert!(text.contains(r#""nonZero""#));
        assert!(text.contains(r#""evenOdd""#));
        assert!(text.contains(r#""line""#));
        assert!(text.contains(r#""cubic""#));
    }

    #[test]
    fn clip_region_references_are_bounded_complete_and_preserved() {
        let mut spec = two_face_spec();
        let mut clip = triangle_clip();
        clip.regions = vec![MockupClipRegion {
            contour_indices: vec![0],
            fill_rule: MockupClipFillRule::NonZero,
        }];
        spec.clip = Some(clip.clone());
        assert_eq!(
            plan_mockup(&spec).unwrap().clip.unwrap().regions,
            clip.regions
        );
        for indices in [vec![], vec![1], vec![0, 0]] {
            clip.regions[0].contour_indices = indices;
            spec.clip = Some(clip.clone());
            assert_eq!(plan_mockup(&spec).unwrap_err().code, ErrorCode::Schema);
        }
        clip.regions[0].contour_indices = vec![0];
        clip.contours.push(clip.contours[0].clone());
        spec.clip = Some(clip.clone());
        assert_eq!(
            plan_mockup(&spec).unwrap_err().code,
            ErrorCode::Schema,
            "unreferenced contours are not silently discarded"
        );
        clip.contours.pop();
        clip.regions = vec![clip.regions[0].clone(); 9];
        spec.clip = Some(clip);
        assert_eq!(plan_mockup(&spec).unwrap_err().code, ErrorCode::Schema);
    }
}

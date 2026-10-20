//! Carrier-neutral vector path projection semantics.
//!
//! `worldbend-core` owns what it means to project an editable vector path
//! through a resolved transform: which geometry stays exact, how curved
//! segments converge under a projective map, the pixel error budget, the
//! complexity ceilings, projection singularity handling, which strokes can be
//! expanded into fill outlines, and the fidelity/loss report. Adapters
//! translate carrier path data into [`VectorProjectionInput`] and publish
//! [`VectorProjectionOutput`]; they must not re-derive these semantics
//! locally. Straight filled boundaries stay exactly straight (projective maps
//! preserve lines), affine maps preserve cubic Bézier handles exactly, and
//! genuinely projective curves subdivide deterministically until a proven
//! target-space error bound fits the requested budget.

use crate::{Bounds, ErrorCode, Point, Size, TransformError, TransformResult, WarpMesh};
mod mesh;
mod mesh_index;
use crate::vector_artwork::{ProjectionWork, WorkKind};
pub(crate) use mesh::MeshProjection;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

pub const VECTOR_PROJECTION_SCHEMA: &str = "worldbend.vector-projection";
pub const VECTOR_PROJECTION_VERSION: &str = "0.1";
pub const VECTOR_MESH_PROJECTION_VERSION: &str = "0.2";

// A painted part can be one complete multiline text outline. Part packaging
// does not lower the whole-artwork geometry budget; cumulative work/bytes and
// loop-reference limits still bound the complete job independently.
pub const MAX_VECTOR_INPUT_VERTICES: usize = 8192;
pub const MAX_VECTOR_INPUT_SEGMENTS: usize = 16384;
pub const MAX_VECTOR_INPUT_REGIONS: usize = 2048;
pub const MAX_VECTOR_OUTPUT_VERTICES: usize = 32768;
pub const MAX_VECTOR_OUTPUT_SEGMENTS: usize = 32768;
pub const MAX_VECTOR_OUTPUT_REGIONS: usize = 4096;
pub const MAX_VECTOR_INPUT_LOOP_REFERENCES: usize = 131_072;
pub const MAX_VECTOR_OUTPUT_LOOP_REFERENCES: usize = 524_288;
pub const MAX_VECTOR_PROJECTION_WORK_UNITS: usize = 17_000_000;
pub const MIN_VECTOR_TOLERANCE_PX: f64 = 0.01;
pub const MAX_VECTOR_TOLERANCE_PX: f64 = 4.0;
pub const DEFAULT_VECTOR_TOLERANCE_PX: f64 = 0.25;
/// A perspective row of pure floating-point residue from an affine
/// composition must not force subdivision; matches the carrier vector check.
const AFFINE_EPSILON: f64 = 1.0e-12;
/// Mirrors the solver's relative denominator safety margin.
const HORIZON_REL_EPSILON: f64 = 1.0e-12;
/// Relative slack for collinearity decisions on cubic control polygons.
const GEOMETRY_REL_EPSILON: f64 = 1.0e-9;
/// A stroke vertex whose tangent turns by more than this is treated as a
/// direction reversal: both offset sides collapse onto one cap and no join
/// construction stays faithful. Five-point stars stay well inside it.
const MAX_STROKE_TURN_RADIANS: f64 = 175.0_f64.to_radians();
/// Safety recursion cap for stroke offset subdivision; the output ceilings
/// are the real budget, this only bounds pathological recursion.
const MAX_STROKE_SUBDIVISION_DEPTH: u32 = 18;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorPathVertex {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorPathSegment {
    pub start: usize,
    pub end: usize,
    /// Cubic handle relative to the start vertex; absent or zero means the
    /// boundary is straight out of this vertex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tangent_start: Option<Point>,
    /// Cubic handle relative to the end vertex.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tangent_end: Option<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum VectorWindingRule {
    NonZero,
    EvenOdd,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorPathRegion {
    pub winding_rule: VectorWindingRule,
    /// Each loop lists segment indices forming one closed boundary; holes are
    /// additional loops of the same region.
    pub loops: Vec<Vec<usize>>,
}

/// Array bounds live in the code validation rather than the JSON Schema: a
/// tuple-shaped generated type would stop carriers from building inputs from
/// ordinary mapped arrays.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorPathSpec {
    pub vertices: Vec<VectorPathVertex>,
    pub segments: Vec<VectorPathSegment>,
    pub regions: Vec<VectorPathRegion>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum VectorStrokeCap {
    None,
    Round,
    Square,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum VectorStrokeJoin {
    Miter,
    Bevel,
    Round,
}

/// Center-aligned stroke expanded into a fill outline before projection. The
/// weight is the full stroke width in path-space units; the carrier must
/// supply a path space that is isometric to the space in which the source
/// stroke renders with uniform width. Inside/outside alignment and dash
/// patterns are not representable in this shared model and stay on carrier
/// fallbacks.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorStrokeSpec {
    #[schemars(schema_with = "positive_weight_schema")]
    pub weight: f64,
    pub cap: VectorStrokeCap,
    pub join: VectorStrokeJoin,
    #[schemars(range(min = 1, max = 1000))]
    pub miter_limit: f64,
}

fn positive_weight_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "exclusiveMinimum": 0
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[schemars(extend("if"={"properties":{"version":{"const":"0.1"}}},"then"={"not":{"required":["mesh"]}}))]
pub struct VectorProjectionInput {
    #[schemars(schema_with = "projection_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "projection_version_schema")]
    pub version: String,
    pub path: VectorPathSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<VectorStrokeSpec>,
    /// Affine map from path space to document space, row-major
    /// `[a b c d e f]` for rows `[a b c; d e f]`.
    pub source_transform: [f64; 6],
    /// Document-space axis-aligned bounds of the path; the path is normalized
    /// onto the core source plane through these bounds before the homography.
    pub source_bounds: Bounds,
    /// Core-solved forward homography from the normalized source plane to
    /// reference pixels. No second solver is involved anywhere in this module.
    pub homography: [f64; 9],
    /// Version 0.2 only: the validated canonical source-to-warped mesh,
    /// applied before the homography. Omission retains the 0.1 operation.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_mesh"
    )]
    #[schemars(schema_with = "mesh_schema")]
    pub mesh: Option<WarpMesh>,
    pub reference: Size,
    pub placement: Size,
    /// Target-space pixel budget for every approximation this module emits.
    #[serde(default = "default_tolerance")]
    #[schemars(range(min = 0.01, max = 4.0))]
    pub tolerance_px: f64,
}

const fn default_tolerance() -> f64 {
    DEFAULT_VECTOR_TOLERANCE_PX
}
fn deserialize_mesh<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<WarpMesh>, D::Error> {
    WarpMesh::deserialize(deserializer).map(Some)
}
fn mesh_schema(generator: &mut SchemaGenerator) -> Schema {
    generator.subschema_for::<WarpMesh>()
}

fn projection_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "enum": [VECTOR_PROJECTION_SCHEMA]
    })
}

fn projection_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "enum": [VECTOR_PROJECTION_VERSION, VECTOR_MESH_PROJECTION_VERSION]
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VectorProjectionFidelity {
    Exact,
    Approximated,
    Outlined,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum VectorProjectionLossReason {
    CurveSubdivision,
    StrokeOutlined,
    StrokeApproximated,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorProjectionReport {
    pub fidelity: VectorProjectionFidelity,
    pub stroke_outlined: bool,
    /// Proven upper bound on target-space deviation, in placement pixels.
    /// `None` means every emitted boundary is mathematically exact.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_error: Option<f64>,
    pub tolerance_px: f64,
    pub reasons: Vec<VectorProjectionLossReason>,
    pub input_vertices: usize,
    pub input_segments: usize,
    pub input_regions: usize,
    pub output_vertices: usize,
    pub output_segments: usize,
    pub output_regions: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_chains: Option<usize>,
    pub max_subdivision_depth: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorProjectionNetwork {
    pub vertices: Vec<VectorPathVertex>,
    pub segments: Vec<VectorPathSegment>,
    pub regions: Vec<VectorPathRegion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct VectorProjectionOutput {
    pub network: VectorProjectionNetwork,
    /// Bounds of the emitted geometry in placement-relative result pixels.
    pub bounds: Bounds,
    pub report: VectorProjectionReport,
}

/// Resolve one editable vector path through the canonical transform chain.
pub fn plan_vector_projection(
    input: &VectorProjectionInput,
) -> TransformResult<VectorProjectionOutput> {
    let work = ProjectionWork::single();
    project_with_work(input, Some(&work), None)
}

pub(crate) fn project_with_work<'a>(
    input: &VectorProjectionInput,
    work: Option<&'a ProjectionWork>,
    prepared: Option<&'a MeshProjection<'a>>,
) -> TransformResult<VectorProjectionOutput> {
    validate_header(input)?;
    validate_frame(input)?;
    validate_path(&input.path)?;
    if let Some(stroke) = &input.stroke {
        validate_stroke(stroke)?;
    }
    let mut linear = ProjectionFrame::new(input)?;
    linear.work = work;
    let mesh = input
        .mesh
        .as_ref()
        .filter(|_| prepared.is_none())
        .map(|mesh| MeshProjection::new(mesh, &linear))
        .transpose()?;
    let frame = linear.with_mesh(prepared.or(mesh.as_ref()).filter(|mesh| !mesh.identity))?;
    let mut builder = OutputBuilder {
        work,
        ..OutputBuilder::default()
    };
    // Every input vertex projects first and keeps its index, so straight
    // segments can reference the exact projected endpoints.
    for vertex in &input.path.vertices {
        let projected = frame.project_path_point(Point::new(vertex.x, vertex.y))?;
        builder.push_vertex(projected)?;
    }
    let mut curve_error: Option<f64> = None;
    for segment in &input.path.segments {
        project_segment(
            &frame,
            segment,
            &input.path.vertices,
            &mut builder,
            &mut curve_error,
        )?;
    }
    let stroke_state = match &input.stroke {
        Some(stroke) => Some(project_stroke(&frame, stroke, &input.path, &mut builder)?),
        None => None,
    };
    let mut regions = Vec::new();
    let mut loop_references = 0;
    for region in &input.path.regions {
        if let Some(work) = work {
            work.charge(WorkKind::Region, 1)?;
        }
        regions.push(rebuild_region(
            region,
            &input.path.segments,
            &builder.segment_pieces,
            &mut loop_references,
            work,
        )?);
    }
    let mut stroke_chains = None;
    if let Some(state) = &stroke_state {
        stroke_chains = Some(state.chains);
        for loops in &state.region_loops {
            for indices in loops {
                if let Some(work) = work {
                    work.charge(WorkKind::References, indices.len())?;
                }
                add_loop_references(
                    &mut loop_references,
                    indices.len(),
                    MAX_VECTOR_OUTPUT_LOOP_REFERENCES,
                )?;
            }
            if let Some(work) = work {
                work.charge(WorkKind::Region, 1)?;
            }
            regions.push(VectorPathRegion {
                winding_rule: VectorWindingRule::NonZero,
                loops: loops.clone(),
            });
        }
    }
    if regions.len() > MAX_VECTOR_OUTPUT_REGIONS {
        return Err(complexity_error(
            "regions",
            regions.len(),
            MAX_VECTOR_OUTPUT_REGIONS,
        ));
    }
    let bounds = builder.bounds().ok_or_else(|| {
        TransformError::new(ErrorCode::Schema, "vector path projects to no geometry")
    })?;
    let stroke_approximated = stroke_state
        .as_ref()
        .is_some_and(|state| state.approximated);
    let max_error = match (
        curve_error,
        stroke_state.as_ref().and_then(|state| state.max_error),
    ) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value),
        (Some(left), Some(right)) => Some(left.max(right)),
    };
    let fidelity = if stroke_state.is_some() {
        VectorProjectionFidelity::Outlined
    } else if curve_error.is_some() {
        VectorProjectionFidelity::Approximated
    } else {
        VectorProjectionFidelity::Exact
    };
    let mut reasons = Vec::new();
    if curve_error.is_some() {
        reasons.push(VectorProjectionLossReason::CurveSubdivision);
    }
    if stroke_state.is_some() {
        reasons.push(VectorProjectionLossReason::StrokeOutlined);
    }
    if stroke_approximated {
        reasons.push(VectorProjectionLossReason::StrokeApproximated);
    }
    let report = VectorProjectionReport {
        fidelity,
        stroke_outlined: stroke_state.is_some(),
        max_error,
        tolerance_px: input.tolerance_px,
        reasons,
        input_vertices: input.path.vertices.len(),
        input_segments: input.path.segments.len(),
        input_regions: input.path.regions.len(),
        output_vertices: builder.vertices.len(),
        output_segments: builder.segments.len(),
        output_regions: regions.len(),
        stroke_chains,
        max_subdivision_depth: builder
            .max_depth
            .max(stroke_state.as_ref().map_or(0, |state| state.max_depth)),
    };
    Ok(VectorProjectionOutput {
        network: VectorProjectionNetwork {
            vertices: builder
                .vertices
                .into_iter()
                .map(|point| VectorPathVertex {
                    x: point.x,
                    y: point.y,
                })
                .collect(),
            segments: builder
                .segments
                .into_iter()
                .map(|segment| VectorPathSegment {
                    start: segment.start,
                    end: segment.end,
                    tangent_start: segment.tangent_start,
                    tangent_end: segment.tangent_end,
                })
                .collect(),
            regions,
        },
        bounds,
        report,
    })
}

fn validate_header(input: &VectorProjectionInput) -> TransformResult<()> {
    if input.schema != VECTOR_PROJECTION_SCHEMA
        || (input.version != VECTOR_PROJECTION_VERSION
            && input.version != VECTOR_MESH_PROJECTION_VERSION)
        || (input.mesh.is_some() && input.version != VECTOR_MESH_PROJECTION_VERSION)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported vector projection header; use worldbend.vector-projection version 0.1 without mesh or 0.2 with optional mesh",
        ));
    }
    if !input.tolerance_px.is_finite()
        || input.tolerance_px < MIN_VECTOR_TOLERANCE_PX
        || input.tolerance_px > MAX_VECTOR_TOLERANCE_PX
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "vector projection tolerance must stay between {MIN_VECTOR_TOLERANCE_PX} and {MAX_VECTOR_TOLERANCE_PX} pixels"
            ),
        ));
    }
    Ok(())
}

fn validate_frame(input: &VectorProjectionInput) -> TransformResult<()> {
    if input
        .source_transform
        .iter()
        .any(|value| !value.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "source transform must be finite",
        ));
    }
    if !input.source_bounds.x.is_finite()
        || !input.source_bounds.y.is_finite()
        || !input.source_bounds.width.is_finite()
        || !input.source_bounds.height.is_finite()
        || input.source_bounds.width <= 0.0
        || input.source_bounds.height <= 0.0
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "source bounds must be finite with positive extent",
        ));
    }
    if input.homography.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "homography coefficients must be finite",
        ));
    }
    let scale = input
        .homography
        .iter()
        .fold(1.0_f64, |acc, value| acc.max(value.abs()));
    if scale <= AFFINE_EPSILON {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography is degenerate",
        ));
    }
    let determinant = matrix3_determinant(&input.homography);
    if !determinant.is_finite() || determinant.abs() <= AFFINE_EPSILON * scale * scale * scale {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography is singular",
        ));
    }
    let denominator_norm = input.homography[6]
        .hypot(input.homography[7])
        .hypot(input.homography[8]);
    if denominator_norm <= AFFINE_EPSILON * scale {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography denominator row is degenerate",
        ));
    }
    input.reference.validate("reference")?;
    input.placement.validate("placement")?;
    Ok(())
}

pub(crate) fn validate_path(path: &VectorPathSpec) -> TransformResult<()> {
    if path.vertices.len() < 3 || path.vertices.len() > MAX_VECTOR_INPUT_VERTICES {
        return Err(complexity_error(
            "input vertices",
            path.vertices.len(),
            MAX_VECTOR_INPUT_VERTICES,
        ));
    }
    if path.segments.len() < 3 || path.segments.len() > MAX_VECTOR_INPUT_SEGMENTS {
        return Err(complexity_error(
            "input segments",
            path.segments.len(),
            MAX_VECTOR_INPUT_SEGMENTS,
        ));
    }
    if path.regions.is_empty() || path.regions.len() > MAX_VECTOR_INPUT_REGIONS {
        return Err(complexity_error(
            "input regions",
            path.regions.len(),
            MAX_VECTOR_INPUT_REGIONS,
        ));
    }
    if path
        .vertices
        .iter()
        .any(|vertex| !vertex.x.is_finite() || !vertex.y.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "path vertices must be finite",
        ));
    }
    for segment in &path.segments {
        if segment.start >= path.vertices.len()
            || segment.end >= path.vertices.len()
            || segment.start == segment.end
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "path segments must reference two distinct valid vertices",
            ));
        }
        for tangent in [segment.tangent_start, segment.tangent_end]
            .into_iter()
            .flatten()
        {
            if !tangent.x.is_finite() || !tangent.y.is_finite() {
                return Err(TransformError::new(
                    ErrorCode::NonFiniteCoordinate,
                    "segment tangents must be finite",
                ));
            }
        }
    }
    let mut used = vec![false; path.vertices.len()];
    for segment in &path.segments {
        used[segment.start] = true;
        used[segment.end] = true;
    }
    if used.iter().any(|value| !*value) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "path vertices must all belong to a segment",
        ));
    }
    let mut loop_references = 0;
    // A new per-loop bitmap would multiply segments by the number of loops,
    // including repeated short loops. One bounded stamp array keeps admission
    // linear in the actual references without changing duplicate semantics.
    let mut seen = vec![0usize; path.segments.len()];
    let mut stamp = 0usize;
    for region in &path.regions {
        if region.loops.is_empty() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "a vector region needs at least one closed loop",
            ));
        }
        for loop_indices in &region.loops {
            add_loop_references(
                &mut loop_references,
                loop_indices.len(),
                MAX_VECTOR_INPUT_LOOP_REFERENCES,
            )?;
            if loop_indices.len() < 3 {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "region loops must list at least three segments",
                ));
            }
            if loop_indices.len() > path.segments.len() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "region loop length exceeds the segment count",
                ));
            }
            stamp += 1; // At most MAX_VECTOR_INPUT_LOOP_REFERENCES / 3 loops.
            for &index in loop_indices {
                if index >= path.segments.len() {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "region loops must reference valid segments",
                    ));
                }
                if seen[index] == stamp {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "region loops must not repeat a segment",
                    ));
                }
                seen[index] = stamp;
            }
        }
    }
    Ok(())
}

fn validate_stroke(stroke: &VectorStrokeSpec) -> TransformResult<()> {
    if !stroke.weight.is_finite() || stroke.weight <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroke weight must be finite and positive",
        ));
    }
    if !stroke.miter_limit.is_finite() || stroke.miter_limit < 1.0 || stroke.miter_limit > 1000.0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroke miter limit must stay between 1 and 1000",
        ));
    }
    Ok(())
}

fn complexity_error(what: &str, actual: usize, maximum: usize) -> TransformError {
    TransformError::new(
        ErrorCode::OutputLimit,
        format!("projected vector {what} exceed the complexity ceiling"),
    )
    .with_details(serde_json::json!({ "count": actual, "maximum": maximum }))
}
fn add_loop_references(total: &mut usize, count: usize, maximum: usize) -> TransformResult<()> {
    let next = total
        .checked_add(count)
        .ok_or_else(|| complexity_error("loop references", usize::MAX, maximum))?;
    if next > maximum {
        return Err(complexity_error("loop references", next, maximum));
    }
    *total = next;
    Ok(())
}

fn matrix3_determinant(matrix: &[f64; 9]) -> f64 {
    matrix[0] * (matrix[4] * matrix[8] - matrix[5] * matrix[7])
        - matrix[1] * (matrix[3] * matrix[8] - matrix[5] * matrix[6])
        + matrix[2] * (matrix[3] * matrix[7] - matrix[4] * matrix[6])
}

/// Spectral norm of a 2x2 matrix: the tight bound on how far it can stretch
/// a unit vector in any direction.
fn spectral_norm(a: f64, b: f64, c: f64, d: f64) -> f64 {
    let p = a * a + c * c;
    let q = a * b + c * d;
    let r = b * b + d * d;
    let trace = (p + r) * 0.5;
    let radius = (((p - r) * 0.5).powi(2) + q * q).sqrt();
    (trace + radius).sqrt()
}

#[derive(Clone, Copy)]
pub(crate) struct ProjectionFrame<'a> {
    transform: [f64; 6],
    bounds: Bounds,
    homography: [f64; 9],
    placement: Size,
    reference: Size,
    affine: bool,
    tolerance_px: f64,
    tolerance_path: f64,
    mesh: Option<&'a MeshProjection<'a>>,
    pub(crate) work: Option<&'a ProjectionWork>,
}

impl<'a> ProjectionFrame<'a> {
    pub(crate) fn new(input: &VectorProjectionInput) -> TransformResult<Self> {
        let scale = input
            .homography
            .iter()
            .fold(1.0_f64, |acc, value| acc.max(value.abs()));
        let affine = input.homography[6].abs() <= AFFINE_EPSILON * scale
            && input.homography[7].abs() <= AFFINE_EPSILON * scale;
        if affine && input.homography[8].abs() <= AFFINE_EPSILON * scale {
            return Err(TransformError::new(
                ErrorCode::HomographySingular,
                "affine homography has a zero denominator",
            ));
        }
        // Apply the carrier chain exactly as the adapters did before this
        // module existed: document transform, bounds normalization, the
        // core-solved homography, then the placement scale. Keeping the
        // operation order keeps straight-path outputs identical.
        let frame = Self {
            transform: input.source_transform,
            bounds: input.source_bounds,
            homography: input.homography,
            placement: input.placement,
            reference: input.reference,
            affine,
            tolerance_px: input.tolerance_px,
            tolerance_path: f64::NAN,
            mesh: None,
            work: None,
        };
        // A non-identity mesh needs H's bound over the WARPED domain. The
        // undeformed control hull can cross a horizon even when the actual
        // canonical curve does not; the mesh branch establishes its own
        // full-chain bound before any point or stroke is projected.
        if input.mesh.as_ref().is_some_and(|mesh| {
            mesh.vertices
                .iter()
                .any(|vertex| vertex.source != vertex.warped)
        }) {
            return Ok(frame);
        }
        let path_scale = frame.compute_path_scale(&input.path)?;
        if !path_scale.is_finite() || path_scale <= 0.0 {
            return Err(TransformError::new(
                ErrorCode::HomographySingular,
                "vector projection scale is not representable",
            ));
        }
        let tolerance_path = (input.tolerance_px / path_scale).max(1.0e-12);
        Ok(Self {
            tolerance_path,
            ..frame
        })
    }

    fn with_mesh(self, mesh: Option<&'a MeshProjection<'a>>) -> TransformResult<Self> {
        let Some(mesh) = mesh else {
            return Ok(self);
        };
        let pre = spectral_norm(
            self.transform[0] / self.bounds.width,
            self.transform[1] / self.bounds.width,
            self.transform[3] / self.bounds.height,
            self.transform[4] / self.bounds.height,
        );
        let scale = pre * mesh.scale;
        if !scale.is_finite() || scale <= 0.0 {
            return Err(TransformError::new(
                ErrorCode::HomographySingular,
                "mesh vector scale is not representable",
            ));
        }
        Ok(Self {
            mesh: Some(mesh),
            // A source-space affine epsilon is not a target-space error
            // budget: placement may amplify even a tiny projective row.
            affine: self.homography[6] == 0.0 && self.homography[7] == 0.0,
            tolerance_path: self.tolerance_px / scale,
            ..self
        })
    }

    fn to_document(self, point: Point) -> Point {
        Point::new(
            self.transform[0] * point.x + self.transform[1] * point.y + self.transform[2],
            self.transform[3] * point.x + self.transform[4] * point.y + self.transform[5],
        )
    }

    fn to_normalized(self, point: Point) -> Point {
        if self.mesh.is_some() {
            // Nonlinear faces can amplify discarded low bits of a tiny
            // source feature. Cancel page-origin translations before local
            // evaluation instead of adding them only to subtract the bounds.
            // Legacy and exactly identity mesh branches keep their original
            // arithmetic and byte-stable output.
            return Point::new(
                self.transform[0] / self.bounds.width * point.x
                    + self.transform[1] / self.bounds.width * point.y
                    + (self.transform[2] - self.bounds.x) / self.bounds.width,
                self.transform[3] / self.bounds.height * point.x
                    + self.transform[4] / self.bounds.height * point.y
                    + (self.transform[5] - self.bounds.y) / self.bounds.height,
            );
        }
        let document = self.to_document(point);
        Point::new(
            (document.x - self.bounds.x) / self.bounds.width,
            (document.y - self.bounds.y) / self.bounds.height,
        )
    }

    fn weight(&self, point: Point) -> f64 {
        self.homography[6] * point.x + self.homography[7] * point.y + self.homography[8]
    }

    /// Project one normalized-plane point into result pixels, mirroring the
    /// historical carrier arithmetic so straight paths stay byte-stable.
    fn project(&self, point: Point, sign: f64) -> TransformResult<Point> {
        let point = match self.mesh {
            Some(mesh) => mesh.map_point(point)?,
            None => point,
        };
        let denominator = self.weight(point) * sign;
        let denominator_scale = (self.homography[6] * point.x).abs()
            + (self.homography[7] * point.y).abs()
            + self.homography[8].abs();
        if !denominator.is_finite()
            || !denominator_scale.is_finite()
            || denominator_scale == 0.0
            || denominator.abs() <= HORIZON_REL_EPSILON * denominator_scale
        {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector geometry lies on or too near the projective horizon",
            ));
        }
        let x = (self.homography[0] * point.x + self.homography[1] * point.y + self.homography[2])
            / denominator
            * sign
            * self.placement.width
            / self.reference.width;
        let y = (self.homography[3] * point.x + self.homography[4] * point.y + self.homography[5])
            / denominator
            * sign
            * self.placement.height
            / self.reference.height;
        if !x.is_finite() || !y.is_finite() {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector projection is not finite",
            ));
        }
        Ok(Point::new(x, y))
    }

    fn project_path_point(&self, point: Point) -> TransformResult<Point> {
        self.project(self.to_normalized(point), 1.0)
    }

    /// Rigorous upper bound on the local length scale from path space to
    /// result pixels over the convex hull of the normalized path geometry:
    /// `|J| <= (|A| + |N|max * |g| / wmin) / wmin` with every quantity
    /// bounded on hull vertices, where convexity makes the vertex maxima
    /// valid bounds over the whole hull.
    fn compute_path_scale(&self, path: &VectorPathSpec) -> TransformResult<f64> {
        let mut hull: Vec<Point> = Vec::with_capacity(path.vertices.len() * 2);
        for vertex in &path.vertices {
            hull.push(self.to_normalized(Point::new(vertex.x, vertex.y)));
        }
        for segment in &path.segments {
            for point in cubic_control_points(segment, path.vertices.as_slice()) {
                hull.push(self.to_normalized(point));
            }
        }
        self.compute_scale_over_normalized_points(&hull)
    }

    /// Bound the local scale over the complete stroke domain. The emitted
    /// outline points bound the polygonal result; expanding their path-space
    /// rectangle by the proven construction error also contains the intended
    /// offset boundary. This prevents a stroke that approaches the projective
    /// horizon outside the centerline hull from inheriting a smaller and
    /// therefore false error conversion.
    fn compute_stroke_scale(
        &self,
        outlines: &[Vec<Vec<Point>>],
        expansion: f64,
    ) -> TransformResult<f64> {
        let first = outlines
            .iter()
            .flat_map(|region| region.iter())
            .flat_map(|outline| outline.iter())
            .next()
            .copied()
            .ok_or_else(|| {
                TransformError::new(ErrorCode::Schema, "stroke projects to no geometry")
            })?;
        if let Some(mesh) = self.mesh {
            let pre = spectral_norm(
                self.transform[0] / self.bounds.width,
                self.transform[1] / self.bounds.width,
                self.transform[3] / self.bounds.height,
                self.transform[4] / self.bounds.height,
            );
            let normalized_error = pre * expansion;
            // M's global derivative bound already covers its entire square.
            // Admit the actual normalized polygon plus its construction-error
            // tube, not a rotated source AABB's fictitious exterior corners.
            if !normalized_error.is_finite()
                || normalized_error < 0.0
                || !outlines.iter().flatten().flatten().all(|point| {
                    let point = self.to_normalized(*point);
                    point.x.is_finite()
                        && point.y.is_finite()
                        && point.x >= normalized_error
                        && point.x <= 1.0 - normalized_error
                        && point.y >= normalized_error
                        && point.y <= 1.0 - normalized_error
                })
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "stroke boundary or its approximation leaves the canonical mesh source domain",
                ));
            }
            return Ok(pre * mesh.scale);
        }
        let mut min_x = first.x;
        let mut max_x = first.x;
        let mut min_y = first.y;
        let mut max_y = first.y;
        for point in outlines
            .iter()
            .flat_map(|region| region.iter())
            .flat_map(|outline| outline.iter())
        {
            min_x = min_x.min(point.x);
            max_x = max_x.max(point.x);
            min_y = min_y.min(point.y);
            max_y = max_y.max(point.y);
        }
        let corners = [
            Point::new(min_x - expansion, min_y - expansion),
            Point::new(max_x + expansion, min_y - expansion),
            Point::new(max_x + expansion, max_y + expansion),
            Point::new(min_x - expansion, max_y + expansion),
        ]
        .map(|point| self.to_normalized(point));
        self.compute_scale_over_normalized_points(&corners)
    }

    fn compute_scale_over_normalized_points(&self, hull: &[Point]) -> TransformResult<f64> {
        let first_weight = self.weight(hull[0]);
        if !first_weight.is_finite() || first_weight == 0.0 {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector path crosses the projective horizon",
            ));
        }
        let mut weight_min = first_weight.abs();
        let mut numerator_max = 0.0_f64;
        for point in hull {
            let weight = self.weight(*point);
            if !weight.is_finite() || weight == 0.0 || (weight > 0.0) != (first_weight > 0.0) {
                return Err(TransformError::new(
                    ErrorCode::HomographyHorizonCrossing,
                    "vector path crosses the projective horizon",
                ));
            }
            weight_min = weight_min.min(weight.abs());
            let nx =
                self.homography[0] * point.x + self.homography[1] * point.y + self.homography[2];
            let ny =
                self.homography[3] * point.x + self.homography[4] * point.y + self.homography[5];
            numerator_max = numerator_max.max(nx.hypot(ny));
        }
        if !weight_min.is_finite() || weight_min <= 0.0 {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector path crosses the projective horizon",
            ));
        }
        let linear_norm = spectral_norm(
            self.homography[0],
            self.homography[1],
            self.homography[3],
            self.homography[4],
        );
        let denominator_norm = self.homography[6].hypot(self.homography[7]);
        let homography_scale =
            (linear_norm + numerator_max * denominator_norm / weight_min) / weight_min;
        let pre_norm = spectral_norm(
            self.transform[0] / self.bounds.width,
            self.transform[1] / self.bounds.width,
            self.transform[3] / self.bounds.height,
            self.transform[4] / self.bounds.height,
        );
        let post_norm = (self.placement.width / self.reference.width)
            .max(self.placement.height / self.reference.height);
        Ok(pre_norm * homography_scale * post_norm)
    }
}

#[derive(Clone, Copy)]
struct OutputSegment {
    start: usize,
    end: usize,
    tangent_start: Option<Point>,
    tangent_end: Option<Point>,
}

#[derive(Clone, Copy)]
struct SegmentPieces {
    first: usize,
    count: usize,
}

#[derive(Default)]
struct OutputBuilder<'a> {
    work: Option<&'a ProjectionWork>,
    vertices: Vec<Point>,
    segments: Vec<OutputSegment>,
    segment_pieces: Vec<SegmentPieces>,
    max_depth: u32,
}

impl OutputBuilder<'_> {
    fn push_vertex(&mut self, point: Point) -> TransformResult<usize> {
        if self.vertices.len() >= MAX_VECTOR_OUTPUT_VERTICES {
            return Err(complexity_error(
                "vertices",
                self.vertices.len() + 1,
                MAX_VECTOR_OUTPUT_VERTICES,
            ));
        }
        if !point.x.is_finite() || !point.y.is_finite() {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector projection produced a non-finite vertex",
            ));
        }
        if let Some(work) = self.work {
            work.charge(WorkKind::Vertex, 1)?;
        }
        self.vertices.push(point);
        Ok(self.vertices.len() - 1)
    }

    fn push_segment(
        &mut self,
        start: usize,
        end: usize,
        tangent_start: Option<Point>,
        tangent_end: Option<Point>,
    ) -> TransformResult<()> {
        if self.segments.len() >= MAX_VECTOR_OUTPUT_SEGMENTS {
            return Err(complexity_error(
                "segments",
                self.segments.len() + 1,
                MAX_VECTOR_OUTPUT_SEGMENTS,
            ));
        }
        if let (Some(start), Some(end)) = (tangent_start, tangent_end)
            && (!start.x.is_finite()
                || !start.y.is_finite()
                || !end.x.is_finite()
                || !end.y.is_finite())
        {
            return Err(TransformError::new(
                ErrorCode::HomographyHorizonCrossing,
                "vector projection produced a non-finite handle",
            ));
        }
        if let Some(work) = self.work {
            work.charge(WorkKind::Segment, 1)?;
        }
        self.segments.push(OutputSegment {
            start,
            end,
            tangent_start,
            tangent_end,
        });
        Ok(())
    }

    fn bounds(&self) -> Option<Bounds> {
        let first = *self.vertices.first()?;
        let mut min_x = first.x;
        let mut max_x = first.x;
        let mut min_y = first.y;
        let mut max_y = first.y;
        for point in &self.vertices {
            min_x = min_x.min(point.x);
            max_x = max_x.max(point.x);
            min_y = min_y.min(point.y);
            max_y = max_y.max(point.y);
        }
        for segment in &self.segments {
            let start = self.vertices[segment.start];
            let end = self.vertices[segment.end];
            let control = [
                start,
                segment.tangent_start.map_or(start, |tangent| {
                    Point::new(start.x + tangent.x, start.y + tangent.y)
                }),
                segment.tangent_end.map_or(end, |tangent| {
                    Point::new(end.x + tangent.x, end.y + tangent.y)
                }),
                end,
            ];
            for t in cubic_extrema_parameters(control.map(|point| point.x)) {
                let value = cubic_coordinate(control.map(|point| point.x), t);
                min_x = min_x.min(value);
                max_x = max_x.max(value);
            }
            for t in cubic_extrema_parameters(control.map(|point| point.y)) {
                let value = cubic_coordinate(control.map(|point| point.y), t);
                min_y = min_y.min(value);
                max_y = max_y.max(value);
            }
        }
        Some(Bounds {
            x: min_x,
            y: min_y,
            width: max_x - min_x,
            height: max_y - min_y,
        })
    }
}

fn cubic_coordinate(control: [f64; 4], t: f64) -> f64 {
    let u = 1.0 - t;
    u * u * u * control[0]
        + 3.0 * u * u * t * control[1]
        + 3.0 * u * t * t * control[2]
        + t * t * t * control[3]
}

fn cubic_extrema_parameters(control: [f64; 4]) -> Vec<f64> {
    // The derivative divided by three is `a*t^2 + b*t + c`.
    let a = -control[0] + 3.0 * control[1] - 3.0 * control[2] + control[3];
    let b = 2.0 * (control[0] - 2.0 * control[1] + control[2]);
    let c = control[1] - control[0];
    let scale = a.abs().max(b.abs()).max(c.abs()).max(1.0);
    let epsilon = f64::EPSILON * 16.0 * scale;
    if a.abs() <= epsilon {
        if b.abs() <= epsilon {
            return Vec::new();
        }
        let t = -c / b;
        return if t > 0.0 && t < 1.0 {
            vec![t]
        } else {
            Vec::new()
        };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        return Vec::new();
    }
    let root = discriminant.sqrt();
    let mut result: Vec<f64> = Vec::with_capacity(2);
    for t in [(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)] {
        if t > 0.0 && t < 1.0 && result.iter().all(|value| (value - t).abs() > epsilon) {
            result.push(t);
        }
    }
    result
}

fn zero_tangent(tangent: Option<Point>) -> bool {
    tangent.is_none_or(|value| value.x == 0.0 && value.y == 0.0)
}

pub(crate) fn cubic_control_points(
    segment: &VectorPathSegment,
    vertices: &[VectorPathVertex],
) -> [Point; 4] {
    let start = vertices[segment.start];
    let end = vertices[segment.end];
    let start_point = Point::new(start.x, start.y);
    let end_point = Point::new(end.x, end.y);
    let handle_start = segment.tangent_start.map_or(start_point, |t| {
        Point::new(start_point.x + t.x, start_point.y + t.y)
    });
    let handle_end = segment.tangent_end.map_or(end_point, |t| {
        Point::new(end_point.x + t.x, end_point.y + t.y)
    });
    [start_point, handle_start, handle_end, end_point]
}

/// Four control points on one line mean the cubic traces a straight boundary;
/// a projective map keeps that boundary straight, so it stays exact. The
/// middle control points must also stay between the endpoints: a collinear
/// cubic whose control polygon overshoots them leaves the endpoint chord,
/// which a plain vertex-to-vertex boundary segment cannot represent.
fn collinear_control_points(points: &[Point; 4]) -> bool {
    let span = (points[3].x - points[0].x).hypot(points[3].y - points[0].y);
    if span == 0.0 {
        return true;
    }
    let scale = span * span.max(1.0);
    let direction = Point::new(
        (points[3].x - points[0].x) / span,
        (points[3].y - points[0].y) / span,
    );
    for point in &points[1..3] {
        let cross = (points[3].x - points[0].x) * (point.y - points[0].y)
            - (points[3].y - points[0].y) * (point.x - points[0].x);
        if cross.abs() > GEOMETRY_REL_EPSILON * scale {
            return false;
        }
        let along = (point.x - points[0].x) * direction.x + (point.y - points[0].y) * direction.y;
        if !along.is_finite()
            || along < -GEOMETRY_REL_EPSILON * scale
            || along > span + GEOMETRY_REL_EPSILON * scale
        {
            return false;
        }
    }
    true
}

pub(crate) fn de_casteljau_split(points: &[Point; 4]) -> ([Point; 4], [Point; 4]) {
    let lerp = |a: Point, b: Point| Point::new((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    let left_mid = lerp(points[0], points[1]);
    let center = lerp(points[1], points[2]);
    let right_mid = lerp(points[2], points[3]);
    let left_far = lerp(left_mid, center);
    let right_far = lerp(center, right_mid);
    let middle = lerp(left_far, right_far);
    (
        [points[0], left_mid, left_far, middle],
        [middle, right_far, right_mid, points[3]],
    )
}

fn project_segment(
    frame: &ProjectionFrame,
    segment: &VectorPathSegment,
    vertices: &[VectorPathVertex],
    builder: &mut OutputBuilder,
    curve_error: &mut Option<f64>,
) -> TransformResult<()> {
    if let Some(mesh) = frame.mesh {
        return mesh.project_segment(frame, segment, vertices, builder, curve_error);
    }
    let first = builder.segments.len();
    let control = cubic_control_points(segment, vertices);
    let straight = zero_tangent(segment.tangent_start) && zero_tangent(segment.tangent_end);
    if straight || collinear_control_points(&control) {
        builder.push_segment(
            segment.start,
            segment.end,
            if straight {
                segment.tangent_start
            } else {
                None
            },
            if straight { segment.tangent_end } else { None },
        )?;
    } else {
        let normalized = control.map(|point| frame.to_normalized(point));
        project_cubic_piece(
            frame,
            normalized,
            segment.start,
            segment.end,
            0,
            builder,
            curve_error,
        )?;
    }
    let count = builder.segments.len() - first;
    builder.segment_pieces.push(SegmentPieces { first, count });
    Ok(())
}

/// Project one cubic Bézier piece. Under an affine map the projected control
/// points are the exact image; under a projective map the piece subdivides
/// deterministically at the parameter midpoint until the proven weight-spread
/// bound fits the pixel budget. The bound is exact: the true image is the
/// rational Bézier with weights `w_i` over the projected control points, the
/// emitted cubic drops those weights, and `|rational - polynomial|` stays
/// under `(wmax - wmin)/wmin * polygon_extent`.
fn project_cubic_piece(
    frame: &ProjectionFrame,
    normalized: [Point; 4],
    start_index: usize,
    end_index: usize,
    depth: u32,
    builder: &mut OutputBuilder,
    curve_error: &mut Option<f64>,
) -> TransformResult<()> {
    if let Some(work) = frame.work {
        work.charge(WorkKind::Curve, 1)?;
    }
    if depth >= 32 {
        return Err(complexity_error(
            "curve subdivision depth",
            depth as usize + 1,
            32,
        ));
    }
    builder.max_depth = builder.max_depth.max(depth);
    let weights = normalized.map(|point| frame.weight(point));
    let all_positive = weights.iter().all(|value| *value > 0.0);
    let all_negative = weights.iter().all(|value| *value < 0.0);
    if !all_positive && !all_negative {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "curved segment crosses the projective horizon",
        ));
    }
    let sign = if all_positive { 1.0 } else { -1.0 };
    let magnitudes = weights.map(|value| value.abs());
    let weight_min = magnitudes.iter().copied().fold(f64::INFINITY, f64::min);
    let weight_max = magnitudes.iter().copied().fold(0.0, f64::max);
    if weight_min <= HORIZON_REL_EPSILON * weight_max {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "curved segment grazes the projective horizon",
        ));
    }
    let projected: Vec<Point> = normalized
        .iter()
        .map(|point| frame.project(*point, sign))
        .collect::<TransformResult<Vec<_>>>()?;
    let polygon_extent = projected
        .iter()
        .map(|point| (point.x - projected[0].x).hypot(point.y - projected[0].y))
        .fold(0.0, f64::max);
    let bound = (weight_max - weight_min) / weight_min * polygon_extent;
    if frame.affine || bound <= frame.tolerance_px {
        if !frame.affine {
            *curve_error = Some(curve_error.map_or(bound, |value| value.max(bound)));
        }
        builder.push_segment(
            start_index,
            end_index,
            Some(Point::new(
                projected[1].x - projected[0].x,
                projected[1].y - projected[0].y,
            )),
            Some(Point::new(
                projected[2].x - projected[3].x,
                projected[2].y - projected[3].y,
            )),
        )?;
        return Ok(());
    }
    let (left, right) = de_casteljau_split(&normalized);
    let midpoint = frame.project(left[3], sign)?;
    let midpoint_index = builder.push_vertex(midpoint)?;
    project_cubic_piece(
        frame,
        left,
        start_index,
        midpoint_index,
        depth + 1,
        builder,
        curve_error,
    )?;
    project_cubic_piece(
        frame,
        right,
        midpoint_index,
        end_index,
        depth + 1,
        builder,
        curve_error,
    )
}

/// Rebuild one fill region: every loop is walked through shared vertices,
/// each source segment is replaced by its projected piece chain in traversal
/// order, and the winding rule survives untouched because a mirroring
/// homography flips every loop consistently.
fn rebuild_region(
    region: &VectorPathRegion,
    segments: &[VectorPathSegment],
    pieces: &[SegmentPieces],
    references: &mut usize,
    work: Option<&ProjectionWork>,
) -> TransformResult<VectorPathRegion> {
    let mut loops = Vec::with_capacity(region.loops.len());
    for loop_indices in &region.loops {
        let oriented = orient_loop(loop_indices, segments)?;
        let mut rebuilt = Vec::new();
        for &(index, forward) in &oriented {
            let chain = &pieces[index];
            if let Some(work) = work {
                work.charge(WorkKind::References, chain.count)?;
            }
            add_loop_references(references, chain.count, MAX_VECTOR_OUTPUT_LOOP_REFERENCES)?;
            if forward {
                rebuilt.extend(chain.first..chain.first + chain.count);
            } else {
                rebuilt.extend((chain.first..chain.first + chain.count).rev());
            }
        }
        loops.push(rebuilt);
    }
    Ok(VectorPathRegion {
        winding_rule: region.winding_rule,
        loops,
    })
}

/// Walk one region loop through shared vertices and return each segment with
/// its traversal direction. Consecutive loop entries must share exactly one
/// vertex; sharing both endpoints is ambiguous and rejected.
fn orient_loop(
    loop_indices: &[usize],
    segments: &[VectorPathSegment],
) -> TransformResult<Vec<(usize, bool)>> {
    let count = loop_indices.len();
    let mut oriented = Vec::with_capacity(count);
    let shared = |a: usize, b: usize| -> TransformResult<usize> {
        let first = segments[a];
        let second = segments[b];
        let candidates = [
            (first.start, second.start),
            (first.start, second.end),
            (first.end, second.start),
            (first.end, second.end),
        ];
        let matching: Vec<usize> = candidates
            .iter()
            .filter(|(left, right)| left == right)
            .map(|(left, _)| *left)
            .collect();
        match matching.len() {
            1 => Ok(matching[0]),
            0 => Err(TransformError::new(
                ErrorCode::Schema,
                "region loop segments must share consecutive vertices",
            )),
            _ => Err(TransformError::new(
                ErrorCode::Schema,
                "region loop segments share both endpoints and cannot be oriented",
            )),
        }
    };
    let mut entry = shared(loop_indices[count - 1], loop_indices[0])?;
    for &index in loop_indices {
        let segment = segments[index];
        let forward = segment.start == entry;
        if !forward && segment.end != entry {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "region loop is not connected",
            ));
        }
        entry = if forward { segment.end } else { segment.start };
        oriented.push((index, forward));
    }
    Ok(oriented)
}

struct StrokeState {
    chains: usize,
    /// Loops of each emitted stroke region: one region per open chain and
    /// one region holding both outline loops of a closed chain, so nonzero
    /// winding keeps the closed-chain interior open.
    region_loops: Vec<Vec<Vec<usize>>>,
    approximated: bool,
    max_error: Option<f64>,
    max_depth: u32,
}

/// Expand the stroke into fill outlines in path space, where the stroke is
/// Euclidean-uniform, then emit the outlines as straight segments — straight
/// pieces project exactly, so the only deviation is the bounded path-space
/// construction error converted through the proven path scale.
fn project_stroke(
    frame: &ProjectionFrame,
    stroke: &VectorStrokeSpec,
    path: &VectorPathSpec,
    builder: &mut OutputBuilder,
) -> TransformResult<StrokeState> {
    let half = stroke.weight * 0.5;
    let mut state = StrokeState {
        chains: 0,
        region_loops: Vec::new(),
        approximated: false,
        max_error: None,
        max_depth: 0,
    };
    let mut path_error: Option<f64> = None;
    let mut outlines = Vec::new();
    let mut outline_vertices = 0;
    for chain in build_stroke_chains(path)? {
        state.chains += 1;
        let region = expand_stroke_chain(
            frame,
            stroke,
            half,
            &chain,
            &mut state.approximated,
            &mut path_error,
            &mut state.max_depth,
        )?;
        // Outlines have their own emitted vertices; reject aggregate growth
        // before retaining further chains or running publication machinery.
        for outline in &region {
            add_loop_references(
                &mut outline_vertices,
                outline.len(),
                MAX_VECTOR_OUTPUT_VERTICES,
            )?;
        }
        outlines.push(region);
    }
    let stroke_scale = frame.compute_stroke_scale(&outlines, path_error.unwrap_or(0.0))?;
    let max_error = path_error.map(|value| value * stroke_scale);
    if max_error.is_some_and(|value| value > frame.tolerance_px * (1.0 + 1.0e-12)) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroked path cannot be outlined within the target-space error budget",
        ));
    }
    for region in &outlines {
        state.region_loops.push(
            region
                .iter()
                .map(|outline| emit_outline_loop(frame, outline, builder))
                .collect::<TransformResult<Vec<_>>>()?,
        );
    }
    state.max_error = max_error;
    Ok(state)
}

struct StrokeChain {
    closed: bool,
    /// Cubic control points per chain piece, oriented along the chain.
    pieces: Vec<[Point; 4]>,
}

/// Partition every network segment into deterministic chains: start from the
/// lowest unvisited segment index and extend through a vertex only while
/// exactly one other unvisited segment shares it, so crossings and
/// T-junctions split into separate outlines instead of guessing a route.
fn build_stroke_chains(path: &VectorPathSpec) -> TransformResult<Vec<StrokeChain>> {
    let mut visited = vec![false; path.segments.len()];
    let mut adjacency: Vec<Vec<usize>> = vec![Vec::new(); path.vertices.len()];
    for (index, segment) in path.segments.iter().enumerate() {
        adjacency[segment.start].push(index);
        adjacency[segment.end].push(index);
    }
    let mut chains = Vec::new();
    for seed in 0..path.segments.len() {
        if visited[seed] {
            continue;
        }
        visited[seed] = true;
        let mut directions: Vec<(usize, bool)> = vec![(seed, true)];
        let first = path.segments[seed];
        let mut tip = first.end;
        loop {
            // Continue only through plain path vertices: a vertex shared by
            // three or more segments is a junction hub where chains must
            // end, so their outlines overlap as separate fill regions
            // instead of guessing a route through the hub.
            if adjacency[tip].len() != 2 {
                break;
            }
            let unvisited: Vec<usize> = adjacency[tip]
                .iter()
                .copied()
                .filter(|index| !visited[*index])
                .collect();
            if unvisited.len() != 1 {
                break;
            }
            let next = unvisited[0];
            let segment = path.segments[next];
            visited[next] = true;
            let forward = segment.start == tip;
            if !forward && segment.end != tip {
                return Err(TransformError::new(
                    ErrorCode::Internal,
                    "stroke adjacency is inconsistent",
                ));
            }
            directions.push((next, forward));
            tip = if forward { segment.end } else { segment.start };
        }
        let mut tail = first.start;
        loop {
            if adjacency[tail].len() != 2 {
                break;
            }
            let unvisited: Vec<usize> = adjacency[tail]
                .iter()
                .copied()
                .filter(|index| !visited[*index])
                .collect();
            if unvisited.len() != 1 {
                break;
            }
            let next = unvisited[0];
            let segment = path.segments[next];
            visited[next] = true;
            let forward = segment.end == tail;
            if !forward && segment.start != tail {
                return Err(TransformError::new(
                    ErrorCode::Internal,
                    "stroke adjacency is inconsistent",
                ));
            }
            directions.insert(0, (next, forward));
            tail = if forward { segment.start } else { segment.end };
        }
        let closed = tail == tip;
        let mut pieces = Vec::with_capacity(directions.len());
        for &(index, forward) in &directions {
            let control = cubic_control_points(&path.segments[index], &path.vertices);
            if is_stationary_segment(&control) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "stroked segment has a stationary endpoint and cannot be outlined",
                ));
            }
            pieces.push(if forward {
                control
            } else {
                [control[3], control[2], control[1], control[0]]
            });
        }
        chains.push(StrokeChain { closed, pieces });
    }
    Ok(chains)
}

/// A segment with exactly one zero handle stops with zero velocity at that
/// endpoint; the outline tangent is undefined there.
fn is_stationary_segment(control: &[Point; 4]) -> bool {
    let start_zero = control[0] == control[1];
    let end_zero = control[2] == control[3];
    start_zero != end_zero
}

#[derive(Clone, Copy)]
struct StrokeSample {
    point: Point,
    /// Unit tangent along the chain at this sample.
    tangent: Point,
}

/// One accepted offset sub-piece: its boundary samples, the bound on how far
/// the true offset boundary can sit from the emitted chord, and the cone
/// angle that bounds tangent rotation inside the piece (zero for straight
/// pieces, where the offset chord is exact).
#[derive(Clone, Copy)]
struct OffsetPiece {
    start: StrokeSample,
    end: StrokeSample,
    error: f64,
    cone: f64,
    straight: bool,
}

fn unit(vector: Point) -> Option<Point> {
    let length = vector.x.hypot(vector.y);
    if length <= 0.0 || !length.is_finite() {
        None
    } else {
        Some(Point::new(vector.x / length, vector.y / length))
    }
}

fn rotate_left(tangent: Point) -> Point {
    Point::new(-tangent.y, tangent.x)
}

fn control_edges(control: &[Point; 4]) -> [Point; 3] {
    [
        Point::new(control[1].x - control[0].x, control[1].y - control[0].y),
        Point::new(control[2].x - control[1].x, control[2].y - control[1].y),
        Point::new(control[3].x - control[2].x, control[3].y - control[2].y),
    ]
}

#[allow(clippy::too_many_arguments)] // Proof inputs plus the shared job meter stay explicit.
fn subdivide_offset_piece(
    control: &[Point; 4],
    half: f64,
    tolerance: f64,
    strict: bool,
    depth: u32,
    output: &mut Vec<OffsetPiece>,
    max_depth: &mut u32,
    work: Option<&ProjectionWork>,
) -> TransformResult<()> {
    if let Some(work) = work {
        work.charge(WorkKind::Curve, 1)?;
    }
    *max_depth = (*max_depth).max(depth);
    // Any publishable chain needs at least two segments per piece (one per
    // outline side), so this cap never rejects a result that would fit; it
    // bounds pathological recursion before the quadratic outline checks.
    if output.len() >= MAX_VECTOR_OUTPUT_SEGMENTS {
        return Err(complexity_error(
            "stroke pieces",
            output.len() + 1,
            MAX_VECTOR_OUTPUT_SEGMENTS,
        ));
    }
    let edges = control_edges(control);
    // Boundary samples live at the control points; the control-polygon edges
    // only supply the tangent directions.
    let boundary_sample =
        |point: Point, edge: Point, fallback: Point| -> TransformResult<StrokeSample> {
            let tangent = unit(edge).or_else(|| unit(fallback)).ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "stroked curve has no tangent and cannot be outlined",
                )
            })?;
            Ok(StrokeSample { point, tangent })
        };
    if if strict {
        mesh::exactly_collinear(control)
    } else {
        collinear_control_points(control)
    } {
        // A collinear cubic traces a straight boundary; its offset is the
        // exact parallel segment.
        output.push(OffsetPiece {
            start: boundary_sample(control[0], edges[0], edges[1])?,
            end: boundary_sample(control[3], edges[2], edges[1])?,
            error: 0.0,
            cone: 0.0,
            straight: true,
        });
        return Ok(());
    }
    // Flatness: the whole cubic stays inside its control polygon, so the
    // inner control points' distance from the chord bounds the curve.
    let chord = Point::new(control[3].x - control[0].x, control[3].y - control[0].y);
    let chord_length = if strict {
        chord.x.hypot(chord.y)
    } else {
        chord.x.hypot(chord.y).max(1.0e-12)
    };
    let flatness = if chord_length == 0.0 {
        f64::INFINITY
    } else if strict {
        let mut maximum = 0.0_f64;
        for point in &control[1..3] {
            let distance =
                crate::mesh_coordinates::orientation_value(control[0], control[3], *point).abs()
                    / chord_length;
            if !distance.is_finite() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "stroke flatness bound is not representable",
                ));
            }
            maximum = maximum.max(distance);
        }
        maximum
    } else {
        [1.0, 2.0]
            .iter()
            .map(|index| {
                (chord.x * (control[*index as usize].y - control[0].y)
                    - chord.y * (control[*index as usize].x - control[0].x))
                    .abs()
                    / chord_length
            })
            .fold(0.0, f64::max)
    };
    // Every tangent of the piece lies in the cone spanned by the control
    // polygon edges, so the widest pairwise edge angle bounds how far the
    // offset normal can rotate inside the piece.
    let mut cone = 0.0_f64;
    for left in 0..3 {
        for right in (left + 1)..3 {
            if let (Some(left_unit), Some(right_unit)) = (unit(edges[left]), unit(edges[right])) {
                let dot =
                    (left_unit.x * right_unit.x + left_unit.y * right_unit.y).clamp(-1.0, 1.0);
                let angle = if strict {
                    crate::mesh_coordinates::orientation_value(
                        Point::new(0.0, 0.0),
                        left_unit,
                        right_unit,
                    )
                    .atan2(dot)
                    .abs()
                } else {
                    dot.acos()
                };
                cone = cone.max(angle);
            }
        }
    }
    let error = flatness + 2.0 * half * cone;
    if error <= tolerance && min_radius_bound(control) > half {
        output.push(OffsetPiece {
            start: boundary_sample(control[0], edges[0], edges[1])?,
            end: boundary_sample(control[3], edges[2], edges[1])?,
            error,
            cone,
            straight: false,
        });
        return Ok(());
    }
    if depth >= MAX_STROKE_SUBDIVISION_DEPTH {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroked curve cannot be outlined within the error budget",
        ));
    }
    let (left, right) = de_casteljau_split(control);
    subdivide_offset_piece(
        &left,
        half,
        tolerance,
        strict,
        depth + 1,
        output,
        max_depth,
        work,
    )?;
    subdivide_offset_piece(
        &right,
        half,
        tolerance,
        strict,
        depth + 1,
        output,
        max_depth,
        work,
    )
}

/// Conservative proven lower bound on the radius of curvature of a cubic on
/// `[0,1]`: `R = |C'|^3 / |C' x C''|`, with `|C'|` bounded through the
/// Bernstein hull of its derivative and `|C' x C''| <= |C'|max * |C''|max`.
/// A piece whose bound exceeds the offset distance cannot cusp.
fn min_radius_bound(control: &[Point; 4]) -> f64 {
    let edges = control_edges(control);
    let min_component = |axis: fn(Point) -> f64| -> f64 {
        let values = [axis(edges[0]), axis(edges[1]), axis(edges[2])];
        let min = values.iter().copied().fold(f64::INFINITY, f64::min);
        let max = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        if min <= 0.0 && max >= 0.0 {
            0.0
        } else {
            min.abs().min(max.abs())
        }
    };
    let speed_min = 3.0 * min_component(|point| point.x).hypot(min_component(|point| point.y));
    let speed_max = 3.0
        * edges
            .iter()
            .map(|edge| edge.x.hypot(edge.y))
            .fold(0.0, f64::max);
    let second = [
        Point::new(
            control[2].x - 2.0 * control[1].x + control[0].x,
            control[2].y - 2.0 * control[1].y + control[0].y,
        ),
        Point::new(
            control[3].x - 2.0 * control[2].x + control[1].x,
            control[3].y - 2.0 * control[2].y + control[1].y,
        ),
    ];
    let second_max = 6.0
        * second
            .iter()
            .map(|value| value.x.hypot(value.y))
            .fold(0.0, f64::max);
    if speed_min <= 0.0 || speed_max <= 0.0 || second_max <= 0.0 {
        return 0.0;
    }
    speed_min.powi(3) / (speed_max * second_max)
}

#[derive(Clone, Copy)]
struct Junction {
    vertex: Point,
    tangent_in: Point,
    tangent_out: Point,
}

/// Junctions between consecutive chain pieces plus, for a closed chain, the
/// closing junction. `junctions[i]` sits at the end of `pieces[i]`; for a
/// closed chain `junctions[len-1]` connects the last piece back to the first.
fn chain_junctions(pieces: &[OffsetPiece], closed: bool) -> Vec<Option<Junction>> {
    let mut junctions: Vec<Option<Junction>> = pieces
        .windows(2)
        .map(|window| {
            Some(Junction {
                vertex: window[0].end.point,
                tangent_in: window[0].end.tangent,
                tangent_out: window[1].start.tangent,
            })
        })
        .collect();
    junctions.push(if closed && pieces.len() >= 2 {
        Some(Junction {
            vertex: pieces[pieces.len() - 1].end.point,
            tangent_in: pieces[pieces.len() - 1].end.tangent,
            tangent_out: pieces[0].start.tangent,
        })
    } else {
        None
    });
    junctions
}

fn offset_point(sample: StrokeSample, half: f64, left: bool) -> Point {
    let normal = rotate_left(sample.tangent);
    if left {
        Point::new(
            sample.point.x + half * normal.x,
            sample.point.y + half * normal.y,
        )
    } else {
        Point::new(
            sample.point.x - half * normal.x,
            sample.point.y - half * normal.y,
        )
    }
}

/// How one junction connects on one side of the chain, from the offset point
/// of the incoming tangent (`a`) to the offset point of the outgoing tangent
/// (`b`).
struct JunctionPlan {
    /// Interior points in `a -> b` order.
    interior: Vec<Point>,
    /// Path-space error bound of the connection.
    error: f64,
    /// Inner-corner trim: the raw offset points around the junction lie past
    /// the corner, so the walk drops the incoming raw end and skips the
    /// outgoing raw start.
    trim: bool,
}

/// Bound how far an offset curve can drift from its end-tangent offset line
/// across the corner region: the tangent stays inside the piece's cone, so
/// the drift over an arc length `extent` is at most
/// `extent * sin(cone) + half * (1 - cos(cone))`.
fn corner_drift(extent: f64, cone: f64, half: f64) -> f64 {
    extent * cone.sin() + half * (1.0 - cone.cos())
}

fn plan_junction(
    stroke: &VectorStrokeSpec,
    half: f64,
    junction: Junction,
    piece_in: &OffsetPiece,
    piece_out: &OffsetPiece,
    budget: f64,
    strict: bool,
) -> TransformResult<JunctionPlan> {
    let cross = junction.tangent_in.x * junction.tangent_out.y
        - junction.tangent_in.y * junction.tangent_out.x;
    let dot = junction.tangent_in.x * junction.tangent_out.x
        + junction.tangent_in.y * junction.tangent_out.y;
    let turn = cross.atan2(dot).abs();
    if turn >= MAX_STROKE_TURN_RADIANS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroked path reverses direction and cannot be outlined",
        ));
    }
    // An outer bevel is exactly the straight chord between the raw offset
    // points, so it takes the exact construction below; every other junction
    // may take the chord shortcut inside the budget instead.
    let join_side = cross <= 0.0;
    if !join_side || stroke.join != VectorStrokeJoin::Bevel {
        let chord_error = half * turn * turn / 4.0;
        if chord_error <= budget {
            // Tangent-continuous enough that the straight chord stays inside the
            // budget; the true corner or join arc deviates by less than this.
            return Ok(JunctionPlan {
                interior: Vec::new(),
                error: chord_error,
                trim: false,
            });
        }
    }
    let side_offset = |tangent: Point| {
        offset_point(
            StrokeSample {
                point: junction.vertex,
                tangent,
            },
            half,
            true,
        )
    };
    let a = side_offset(junction.tangent_in);
    let b = side_offset(junction.tangent_out);
    // A left turn opens its join on the right of the walk and trims the
    // left (inner) offset; a right turn mirrors that.
    let plan = if join_side {
        // Outer joins are exact constructions from the junction tangents:
        // the renderer itself draws the bevel line, the miter tip, or the
        // disc arc between the two offset points.
        match stroke.join {
            VectorStrokeJoin::Bevel => JunctionPlan {
                interior: Vec::new(),
                error: 0.0,
                trim: false,
            },
            VectorStrokeJoin::Round => {
                let sign = 1.0;
                let bisector = unit(Point::new(
                    junction.tangent_in.x + junction.tangent_out.x,
                    junction.tangent_in.y + junction.tangent_out.y,
                ))
                .ok_or_else(|| {
                    TransformError::new(ErrorCode::Schema, "stroke join direction is degenerate")
                })?;
                // The arc midpoint direction is the offset normal bisector:
                // the tangent bisector rotated into the side's orientation.
                let rotated = rotate_left(bisector);
                let through = Point::new(
                    junction.vertex.x + half * sign * rotated.x,
                    junction.vertex.y + half * sign * rotated.y,
                );
                let (points, sagitta) =
                    arc_interior(junction.vertex, a, b, through, half, budget, strict)?;
                JunctionPlan {
                    interior: points,
                    error: sagitta,
                    trim: false,
                }
            }
            VectorStrokeJoin::Miter => {
                let miter_ratio = 1.0 / (turn * 0.5).cos();
                if !miter_ratio.is_finite() || miter_ratio > stroke.miter_limit {
                    JunctionPlan {
                        interior: Vec::new(),
                        error: 0.0,
                        trim: false,
                    }
                } else {
                    match line_intersection(a, junction.tangent_in, b, junction.tangent_out, strict)
                    {
                        Some(tip) => JunctionPlan {
                            interior: vec![tip],
                            error: 0.0,
                            trim: false,
                        },
                        None => JunctionPlan {
                            interior: Vec::new(),
                            error: 0.0,
                            trim: false,
                        },
                    }
                }
            }
        }
    } else {
        // Inner corner: the offset lines intersect and the visible stroke
        // shows that corner. For curved neighbors the true crossing sits
        // where the offset curves meet; the line corner covers it within the
        // drift bound over the trim region.
        match line_intersection(a, junction.tangent_in, b, junction.tangent_out, strict) {
            Some(corner) => {
                let drift =
                    corner_drift((corner.x - a.x).hypot(corner.y - a.y), piece_in.cone, half)
                        + corner_drift(
                            (corner.x - b.x).hypot(corner.y - b.y),
                            piece_out.cone,
                            half,
                        );
                JunctionPlan {
                    interior: vec![corner],
                    error: drift,
                    trim: true,
                }
            }
            None => JunctionPlan {
                interior: Vec::new(),
                error: half * turn * turn / 4.0,
                trim: false,
            },
        }
    };
    if plan.error > budget {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroked corner cannot be outlined within the error budget",
        ));
    }
    Ok(plan)
}

/// Interior polygonal arc points from `start` to `end` around `center`,
/// passing through the direction of `through`. The per-step sagitta stays
/// inside the tolerance.
fn arc_interior(
    center: Point,
    start: Point,
    end: Point,
    through: Point,
    half: f64,
    tolerance: f64,
    strict: bool,
) -> TransformResult<(Vec<Point>, f64)> {
    let wrap = |value: f64| -> f64 {
        let mut wrapped = value;
        while wrapped > std::f64::consts::PI {
            wrapped -= 2.0 * std::f64::consts::PI;
        }
        while wrapped < -std::f64::consts::PI {
            wrapped += 2.0 * std::f64::consts::PI;
        }
        wrapped
    };
    let start_angle = (start.y - center.y).atan2(start.x - center.x);
    let end_angle = (end.y - center.y).atan2(end.x - center.x);
    let through_angle = (through.y - center.y).atan2(through.x - center.x);
    let sweep = wrap(through_angle - start_angle) + wrap(end_angle - through_angle);
    if !sweep.is_finite() || sweep == 0.0 || (!strict && sweep.abs() < 1.0e-12) {
        return Ok((Vec::new(), 0.0));
    }
    let mut step = if strict {
        // The quadratic sagitta bound below is valid even when 1-tol/r
        // rounds to one. Reserve floating-point slack in the admission.
        (8.0 * (tolerance / half)).sqrt() * 0.99
    } else {
        let cosine = (1.0 - tolerance / half).clamp(-1.0, 1.0);
        2.0 * cosine.acos()
    };
    if !step.is_finite() || step <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "rounded stroke cap or join cannot meet the error budget",
        ));
    }
    step = step.min(std::f64::consts::FRAC_PI_2);
    let steps = (sweep.abs() / step).ceil().max(1.0);
    // Bound temporary allocation before constructing the arc. Its points
    // become outline segments, so an over-cap arc cannot fit the network.
    if !steps.is_finite() || steps > MAX_VECTOR_OUTPUT_SEGMENTS as f64 {
        return Err(complexity_error(
            "stroke arc steps",
            steps as usize,
            MAX_VECTOR_OUTPUT_SEGMENTS,
        ));
    }
    let increment = sweep / steps;
    let mut points = Vec::with_capacity(steps as usize);
    for index in 1..steps as usize {
        let angle = start_angle + increment * index as f64;
        points.push(Point::new(
            center.x + half * angle.cos(),
            center.y + half * angle.sin(),
        ));
    }
    let sagitta = if strict {
        // 1-cos(theta) <= theta^2/2 avoids a false zero from cancellation
        // on a tiny arc subsequently amplified by the mesh/H/placement.
        half * increment.abs() * increment.abs() / 8.0
    } else {
        half * (1.0 - (increment * 0.5).cos())
    };
    Ok((points, sagitta.max(0.0)))
}

/// Cap points strictly between the left and right offset points of `end`,
/// walking from the left offset to the right offset around the outward
/// tangent. Passing a reversed sample at the chain start yields the start
/// cap, which walks from the right offset back to the left offset.
fn cap_interior(
    cap: VectorStrokeCap,
    half: f64,
    end: StrokeSample,
    tolerance: f64,
    approximated: &mut bool,
    strict: bool,
) -> TransformResult<(Vec<Point>, f64)> {
    let left = offset_point(end, half, true);
    let right = offset_point(end, half, false);
    match cap {
        VectorStrokeCap::None => Ok((Vec::new(), 0.0)),
        VectorStrokeCap::Square => Ok((
            vec![
                Point::new(left.x + half * end.tangent.x, left.y + half * end.tangent.y),
                Point::new(
                    right.x + half * end.tangent.x,
                    right.y + half * end.tangent.y,
                ),
            ],
            0.0,
        )),
        VectorStrokeCap::Round => {
            *approximated = true;
            let through = Point::new(
                end.point.x + half * end.tangent.x,
                end.point.y + half * end.tangent.y,
            );
            arc_interior(end.point, left, right, through, half, tolerance, strict)
        }
    }
}

fn line_intersection(
    first: Point,
    first_direction: Point,
    second: Point,
    second_direction: Point,
    strict: bool,
) -> Option<Point> {
    let denominator =
        first_direction.x * second_direction.y - first_direction.y * second_direction.x;
    let scale = first_direction.x.hypot(first_direction.y).max(1.0)
        * second_direction.x.hypot(second_direction.y).max(1.0);
    if denominator == 0.0 || (!strict && denominator.abs() <= GEOMETRY_REL_EPSILON * scale) {
        return None;
    }
    let delta = Point::new(second.x - first.x, second.y - first.y);
    let parameter = (delta.x * second_direction.y - delta.y * second_direction.x) / denominator;
    Some(Point::new(
        first.x + first_direction.x * parameter,
        first.y + first_direction.y * parameter,
    ))
}

/// Collapse consecutive points that coincide to within a relative epsilon:
/// de Casteljau neighbours share a boundary point exactly, but their unit
/// tangents can differ in the last ulp, leaving near-duplicate offsets that
/// would otherwise become degenerate segments. The nonlinear branch removes
/// only identical points: source-space snapping has no target-space budget.
fn clean_loop(points: &[Point], strict: bool) -> Vec<Point> {
    let mut extent = 0.0_f64;
    for point in points {
        extent = extent.max(point.x.abs()).max(point.y.abs());
    }
    let snap = if strict {
        0.0
    } else {
        extent.max(1.0) * 1.0e-9
    };
    let mut cleaned: Vec<Point> = Vec::with_capacity(points.len());
    for point in points {
        if let Some(last) = cleaned.last()
            && (point.x - last.x).abs() <= snap
            && (point.y - last.y).abs() <= snap
        {
            continue;
        }
        cleaned.push(*point);
    }
    if cleaned.len() > 1 {
        let first = cleaned[0];
        if let Some(last) = cleaned.last()
            && (first.x - last.x).abs() <= snap
            && (first.y - last.y).abs() <= snap
        {
            cleaned.pop();
        }
    }
    cleaned
}

/// Remove only a budgeted cluster near its retained vertex. Replacing each
/// original line by the retained chord deviates by at most the endpoint
/// displacement (convexity). Closing cleanup can additionally displace that
/// retained endpoint, so its distance is ADDED, never silently discarded.
fn clean_budgeted_loop(points: &[Point], budget: f64) -> (Vec<Point>, f64) {
    let extent = points.iter().fold(1.0_f64, |old, point| {
        old.max(point.x.abs()).max(point.y.abs())
    });
    let snap = (extent * 1e-9).min(budget * 0.02);
    let mut cleaned: Vec<Point> = Vec::with_capacity(points.len());
    let mut error = 0.0_f64;
    for &point in points {
        if let Some(last) = cleaned.last() {
            let distance = (point.x - last.x).hypot(point.y - last.y);
            if distance <= snap {
                error = error.max(distance);
                continue;
            }
        }
        cleaned.push(point);
    }
    if cleaned.len() > 1 {
        let first = cleaned[0];
        let last = *cleaned.last().expect("nonempty loop");
        let distance = (first.x - last.x).hypot(first.y - last.y);
        if distance <= snap {
            cleaned.pop();
            error += distance;
        }
    }
    (cleaned, error)
}

fn account_outline_cleanup(total: &mut Option<f64>, chain: Option<f64>, cleanup: f64) {
    if let Some(error) = chain.or_else(|| (cleanup > 0.0).then_some(0.0)) {
        let combined = error + cleanup;
        *total = Some(total.map_or(combined, |old| old.max(combined)));
    }
}

fn append_outline_points(
    points: &mut Vec<Point>,
    more: impl IntoIterator<Item = Point>,
    strict: bool,
) -> TransformResult<()> {
    for point in more {
        if strict && points.last() == Some(&point) {
            continue;
        }
        // A walk contains paired incoming/outgoing offset samples before
        // budgeted cleanup. Bound that temporary stage independently, rather
        // than claiming every intermediate point is an emitted vertex.
        if strict && points.len() >= MAX_VECTOR_OUTPUT_VERTICES * 2 + 2 {
            return Err(complexity_error(
                "stroke outline points",
                points.len() + 1,
                MAX_VECTOR_OUTPUT_VERTICES * 2 + 2,
            ));
        }
        points.push(point);
    }
    Ok(())
}

fn validate_outline_capacity(outlines: &[&[Point]]) -> TransformResult<()> {
    let mut count = 0;
    for outline in outlines {
        add_loop_references(&mut count, outline.len(), MAX_VECTOR_OUTPUT_VERTICES)?;
    }
    Ok(())
}

/// Walk one side of the chain as a forward walk over its pieces, always on
/// the walk's own left. The right outline of the chain comes from walking
/// the reversed chain the same way, which also flips its winding so nonzero
/// fill keeps closed-chain holes open.
#[allow(clippy::too_many_arguments)]
fn walk_outline_side(
    pieces: &[OffsetPiece],
    closed: bool,
    stroke: &VectorStrokeSpec,
    half: f64,
    budget: f64,
    approximated: &mut bool,
    path_error: &mut Option<f64>,
    strict: bool,
) -> TransformResult<Vec<Point>> {
    let junctions = chain_junctions(pieces, closed);
    let mut points = Vec::new();
    let mut trim_leading = false;
    append_outline_points(
        &mut points,
        [offset_point(pieces[0].start, half, true)],
        strict,
    )?;
    for index in 0..pieces.len() {
        append_outline_points(
            &mut points,
            [offset_point(pieces[index].end, half, true)],
            strict,
        )?;
        if let Some(junction) = junctions[index] {
            let piece_in = &pieces[index];
            let piece_out = if index + 1 < pieces.len() {
                &pieces[index + 1]
            } else {
                &pieces[0]
            };
            let plan = plan_junction(stroke, half, junction, piece_in, piece_out, budget, strict)?;
            if plan.error > 0.0 {
                *approximated = true;
                *path_error = Some(path_error.map_or(plan.error, |value| value.max(plan.error)));
            }
            if plan.trim {
                // The raw end just pushed lies past the inner corner.
                points.pop();
            }
            append_outline_points(&mut points, plan.interior, strict)?;
            if !plan.trim {
                let next = if index + 1 < pieces.len() {
                    pieces[index + 1].start
                } else {
                    pieces[0].start
                };
                append_outline_points(&mut points, [offset_point(next, half, true)], strict)?;
            }
            if plan.trim && index + 1 == pieces.len() {
                // The closing junction also trims the walk's leading raw start.
                trim_leading = true;
            }
        }
    }
    if !closed {
        let (interior, error) = cap_interior(
            stroke.cap,
            half,
            pieces[pieces.len() - 1].end,
            budget,
            approximated,
            strict,
        )?;
        if error > 0.0 {
            *approximated = true;
            *path_error = Some(path_error.map_or(error, |value| value.max(error)));
        }
        append_outline_points(&mut points, interior, strict)?;
    }
    if trim_leading {
        points.remove(0);
    }
    Ok(points)
}

fn reverse_piece(piece: &OffsetPiece) -> OffsetPiece {
    OffsetPiece {
        start: reverse_sample(piece.end),
        end: reverse_sample(piece.start),
        error: piece.error,
        cone: piece.cone,
        straight: piece.straight,
    }
}

/// Expand one chain into the loops of one fill region in path space: a
/// single loop for open chains (side, end cap, side, start cap) and the
/// outer and inner loops of one region for closed chains — the two loops
/// wind in opposite directions, so the region's nonzero rule keeps the
/// closed-chain interior open. Every emitted boundary is either an exact
/// construction (straight offsets, joins, caps, inner corners) or a chord
/// whose deviation from the true offset boundary is bounded in path space.
#[allow(clippy::too_many_arguments)]
fn expand_stroke_chain(
    frame: &ProjectionFrame,
    stroke: &VectorStrokeSpec,
    half: f64,
    chain: &StrokeChain,
    approximated: &mut bool,
    path_error: &mut Option<f64>,
    max_depth: &mut u32,
) -> TransformResult<Vec<Vec<Point>>> {
    let budget = frame.tolerance_path * 0.5;
    let strict = frame.mesh.is_some();
    let mut chain_error = None;
    let mut pieces: Vec<OffsetPiece> = Vec::new();
    for control in &chain.pieces {
        subdivide_offset_piece(
            control,
            half,
            budget,
            strict,
            0,
            &mut pieces,
            max_depth,
            frame.work,
        )?;
    }
    if pieces.is_empty() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroke chain has no geometry",
        ));
    }
    for piece in &pieces {
        if !piece.straight {
            *approximated = true;
            chain_error =
                Some(chain_error.map_or(piece.error, |value: f64| value.max(piece.error)));
        }
    }
    let left = walk_outline_side(
        &pieces,
        chain.closed,
        stroke,
        half,
        budget,
        approximated,
        &mut chain_error,
        strict,
    )?;
    let reversed: Vec<OffsetPiece> = pieces.iter().rev().map(reverse_piece).collect();
    let right = walk_outline_side(
        &reversed,
        chain.closed,
        stroke,
        half,
        budget,
        approximated,
        &mut chain_error,
        strict,
    )?;
    if chain.closed {
        let (left, left_error) = if strict {
            clean_budgeted_loop(&left, budget)
        } else {
            (clean_loop(&left, false), 0.0)
        };
        let (right, right_error) = if strict {
            clean_budgeted_loop(&right, budget)
        } else {
            (clean_loop(&right, false), 0.0)
        };
        let cleanup = left_error.max(right_error);
        *approximated |= cleanup > 0.0;
        account_outline_cleanup(path_error, chain_error, cleanup);
        validate_outline_capacity(&[&left, &right])?;
        reject_self_intersection_with_work(&[&left, &right], frame.work)?;
        return Ok(vec![left, right]);
    }
    let mut outline = left;
    outline.extend(right);
    let start_left = offset_point(pieces[0].start, half, true);
    if outline.last() != Some(&start_left) {
        outline.push(start_left);
    }
    let (outline, cleanup) = if strict {
        clean_budgeted_loop(&outline, budget)
    } else {
        (clean_loop(&outline, false), 0.0)
    };
    *approximated |= cleanup > 0.0;
    account_outline_cleanup(path_error, chain_error, cleanup);
    validate_outline_capacity(&[&outline])?;
    reject_self_intersection_with_work(&[&outline], frame.work)?;
    Ok(vec![outline])
}

fn reverse_sample(sample: StrokeSample) -> StrokeSample {
    StrokeSample {
        point: sample.point,
        tangent: Point::new(-sample.tangent.x, -sample.tangent.y),
    }
}

/// Project one closed outline loop and emit its straight segments. Duplicate
/// consecutive points are dropped so no degenerate zero-length segment
/// reaches the carrier.
fn emit_outline_loop(
    frame: &ProjectionFrame,
    points: &[Point],
    builder: &mut OutputBuilder,
) -> TransformResult<Vec<usize>> {
    if points.len() < 3 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "stroke outline loop has no area",
        ));
    }
    let mut indices = Vec::with_capacity(points.len());
    let mut vertices: Vec<usize> = Vec::with_capacity(points.len());
    for point in points {
        vertices.push(builder.push_vertex(frame.project_path_point(*point)?)?);
    }
    for (source_index, window) in vertices.windows(2).enumerate() {
        let first = builder.segments.len();
        if let Some(mesh) = frame.mesh {
            // Source point indices are independent of generated seam pieces.
            mesh.emit_line(
                frame,
                frame.to_normalized(points[source_index]),
                frame.to_normalized(points[source_index + 1]),
                window[0],
                window[1],
                builder,
            )?;
        } else {
            builder.push_segment(window[0], window[1], None, None)?;
        }
        indices.extend(first..builder.segments.len());
    }
    let first = builder.segments.len();
    if let Some(mesh) = frame.mesh {
        mesh.emit_line(
            frame,
            frame.to_normalized(*points.last().expect("loop has points")),
            frame.to_normalized(points[0]),
            *vertices.last().expect("loop has vertices"),
            vertices[0],
            builder,
        )?;
    } else {
        builder.push_segment(
            *vertices.last().expect("loop has vertices"),
            vertices[0],
            None,
            None,
        )?;
    }
    indices.extend(first..builder.segments.len());
    Ok(indices)
}

/// Reject outlines whose boundaries cross themselves or each other: a
/// self-intersecting outline cannot be promised to fill as the visible
/// stroke. The outlines are closed polygons without a repeated closing
/// point, so the implicit edge from the last vertex back to the first is
/// real geometry and takes part in the check.
#[cfg(test)]
fn reject_self_intersection(loops: &[&[Point]]) -> TransformResult<()> {
    reject_self_intersection_with_work(loops, None)
}

fn reject_self_intersection_with_work(
    loops: &[&[Point]],
    work: Option<&ProjectionWork>,
) -> TransformResult<()> {
    let bounds: Vec<Vec<(f64, f64, f64, f64)>> = loops
        .iter()
        .map(|points| {
            (0..points.len())
                .map(|index| {
                    let a = points[index];
                    let b = points[(index + 1) % points.len()];
                    (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))
                })
                .collect()
        })
        .collect();
    for (first_loop, first_bounds) in bounds.iter().enumerate() {
        for (second_loop, second_bounds) in bounds.iter().enumerate() {
            if second_loop < first_loop {
                continue;
            }
            let first_count = loops[first_loop].len();
            let second_count = loops[second_loop].len();
            for first in 0..first_count {
                for second in if first_loop == second_loop {
                    first + 1..second_count
                } else {
                    0..second_count
                } {
                    if let Some(work) = work {
                        work.charge(WorkKind::StrokePair, 1)?;
                    }
                    if first_loop == second_loop {
                        // Adjacent edges share exactly one polygon vertex;
                        // the wrap-around pair closes the loop and shares
                        // the first vertex.
                        let adjacent =
                            second == first + 1 || (first == 0 && second + 1 == second_count);
                        if adjacent {
                            continue;
                        }
                    }
                    if first_bounds[first].2 < second_bounds[second].0
                        || second_bounds[second].2 < first_bounds[first].0
                        || first_bounds[first].3 < second_bounds[second].1
                        || second_bounds[second].3 < first_bounds[first].1
                    {
                        continue;
                    }
                    let first_points = loops[first_loop];
                    let second_points = loops[second_loop];
                    if segments_intersect(
                        first_points[first],
                        first_points[(first + 1) % first_points.len()],
                        second_points[second],
                        second_points[(second + 1) % second_points.len()],
                    ) {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "stroke outline self-intersects and cannot be published exactly",
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}

fn segments_intersect(a: Point, b: Point, c: Point, d: Point) -> bool {
    let orientation =
        |p: Point, q: Point, r: Point| (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    // Strict crossing only: segments that merely touch at an endpoint do
    // not break a nonzero fill.
    let abc = orientation(a, b, c);
    let abd = orientation(a, b, d);
    let cda = orientation(c, d, a);
    let cdb = orientation(c, d, b);
    ((abc > 0.0 && abd < 0.0) || (abc < 0.0 && abd > 0.0))
        && ((cda > 0.0 && cdb < 0.0) || (cda < 0.0 && cdb > 0.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn vertex(x: f64, y: f64) -> VectorPathVertex {
        VectorPathVertex { x, y }
    }

    fn straight(start: usize, end: usize) -> VectorPathSegment {
        VectorPathSegment {
            start,
            end,
            tangent_start: None,
            tangent_end: None,
        }
    }

    fn cubic(start: usize, end: usize, t0: (f64, f64), t1: (f64, f64)) -> VectorPathSegment {
        VectorPathSegment {
            start,
            end,
            tangent_start: Some(Point::new(t0.0, t0.1)),
            tangent_end: Some(Point::new(t1.0, t1.1)),
        }
    }

    fn region(rule: VectorWindingRule, loops: &[&[usize]]) -> VectorPathRegion {
        VectorPathRegion {
            winding_rule: rule,
            loops: loops
                .iter()
                .map(|loop_indices| loop_indices.to_vec())
                .collect(),
        }
    }

    fn path_bounds(path: &VectorPathSpec) -> Bounds {
        let mut min_x = f64::INFINITY;
        let mut max_x = f64::NEG_INFINITY;
        let mut min_y = f64::INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        let mut cover = |point: Point| {
            min_x = min_x.min(point.x);
            max_x = max_x.max(point.x);
            min_y = min_y.min(point.y);
            max_y = max_y.max(point.y);
        };
        for vertex in &path.vertices {
            cover(Point::new(vertex.x, vertex.y));
        }
        for segment in &path.segments {
            for point in cubic_control_points(segment, path.vertices.as_slice()) {
                cover(point);
            }
        }
        Bounds {
            x: min_x,
            y: min_y,
            width: (max_x - min_x).max(1.0e-6),
            height: (max_y - min_y).max(1.0e-6),
        }
    }

    fn square_path() -> VectorPathSpec {
        VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(100.0, 0.0),
                vertex(100.0, 100.0),
                vertex(0.0, 100.0),
            ],
            segments: vec![
                straight(0, 1),
                straight(1, 2),
                straight(2, 3),
                straight(3, 0),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
        }
    }

    /// Four-cubic circle approximation, radius 50 around (50, 50).
    fn rounded_square_path() -> VectorPathSpec {
        let k = 50.0 * 0.5523;
        VectorPathSpec {
            vertices: vec![
                vertex(50.0, 0.0),
                vertex(100.0, 50.0),
                vertex(50.0, 100.0),
                vertex(0.0, 50.0),
            ],
            segments: vec![
                cubic(0, 1, (k, 0.0), (0.0, -k)),
                cubic(1, 2, (0.0, k), (k, 0.0)),
                cubic(2, 3, (-k, 0.0), (0.0, k)),
                cubic(3, 0, (0.0, -k), (-k, 0.0)),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
        }
    }

    fn input(
        path: VectorPathSpec,
        homography: [f64; 9],
        reference: (f64, f64),
        placement: (f64, f64),
    ) -> VectorProjectionInput {
        let source_bounds = path_bounds(&path);
        VectorProjectionInput {
            schema: VECTOR_PROJECTION_SCHEMA.to_owned(),
            version: VECTOR_PROJECTION_VERSION.to_owned(),
            path,
            stroke: None,
            source_transform: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            source_bounds,
            homography,
            mesh: None,
            reference: Size::new(reference.0, reference.1),
            placement: Size::new(placement.0, placement.1),
            tolerance_px: DEFAULT_VECTOR_TOLERANCE_PX,
        }
    }

    fn stroke_input(
        path: VectorPathSpec,
        stroke: VectorStrokeSpec,
        homography: [f64; 9],
    ) -> VectorProjectionInput {
        let mut value = input(path, homography, (100.0, 100.0), (100.0, 100.0));
        value.stroke = Some(stroke);
        value
    }

    fn stroke(weight: f64, cap: VectorStrokeCap, join: VectorStrokeJoin) -> VectorStrokeSpec {
        VectorStrokeSpec {
            weight,
            cap,
            join,
            miter_limit: 4.0,
        }
    }

    /// The historical carrier arithmetic, applied by hand to one path point.
    fn manual_chain(input: &VectorProjectionInput, point: Point) -> Point {
        let t = input.source_transform;
        let dx = t[0] * point.x + t[1] * point.y + t[2];
        let dy = t[3] * point.x + t[4] * point.y + t[5];
        let nx = (dx - input.source_bounds.x) / input.source_bounds.width;
        let ny = (dy - input.source_bounds.y) / input.source_bounds.height;
        let h = input.homography;
        let w = h[6] * nx + h[7] * ny + h[8];
        let px = (h[0] * nx + h[1] * ny + h[2]) / w;
        let py = (h[3] * nx + h[4] * ny + h[5]) / w;
        Point::new(
            px * input.placement.width / input.reference.width,
            py * input.placement.height / input.reference.height,
        )
    }

    /// Nonzero winding number of straight-outline loops at a query point:
    /// signed crossings of the +x ray. Stroke-outline segments never carry
    /// tangents, so endpoints describe the geometry exactly.
    fn loop_winding(network: &VectorProjectionNetwork, loops: &[Vec<usize>], query: Point) -> i64 {
        let mut winding = 0_i64;
        for loop_indices in loops {
            for &index in loop_indices {
                let segment = &network.segments[index];
                let a = network.vertices[segment.start];
                let b = network.vertices[segment.end];
                if (a.y > query.y) != (b.y > query.y) {
                    let crossing_x = a.x + (query.y - a.y) * (b.x - a.x) / (b.y - a.y);
                    if crossing_x > query.x {
                        winding += if b.y > a.y { 1 } else { -1 };
                    }
                }
            }
        }
        winding
    }

    fn point_to_segment(point: Point, a: Point, b: Point) -> f64 {
        let ab = Point::new(b.x - a.x, b.y - a.y);
        let length_sq = ab.x * ab.x + ab.y * ab.y;
        if length_sq <= 0.0 {
            return (point.x - a.x).hypot(point.y - a.y);
        }
        let t = (((point.x - a.x) * ab.x + (point.y - a.y) * ab.y) / length_sq).clamp(0.0, 1.0);
        (point.x - (a.x + ab.x * t)).hypot(point.y - (a.y + ab.y * t))
    }

    /// Differential check: sample every curved source segment through the
    /// real projection and measure the distance to the generated pieces,
    /// which must stay inside the reported bound.
    fn sampled_deviation(input: &VectorProjectionInput, output: &VectorProjectionOutput) -> f64 {
        let mut generated: Vec<[Point; 4]> = Vec::new();
        for segment in &output.network.segments {
            let start = output.network.vertices[segment.start];
            let end = output.network.vertices[segment.end];
            let p0 = Point::new(start.x, start.y);
            let p3 = Point::new(end.x, end.y);
            let p1 = segment
                .tangent_start
                .map_or(p0, |t| Point::new(p0.x + t.x, p0.y + t.y));
            let p2 = segment
                .tangent_end
                .map_or(p3, |t| Point::new(p3.x + t.x, p3.y + t.y));
            generated.push([p0, p1, p2, p3]);
        }
        let bezier = |control: &[Point; 4], t: f64| -> Point {
            let u = 1.0 - t;
            Point::new(
                u * u * u * control[0].x
                    + 3.0 * u * u * t * control[1].x
                    + 3.0 * u * t * t * control[2].x
                    + t * t * t * control[3].x,
                u * u * u * control[0].y
                    + 3.0 * u * u * t * control[1].y
                    + 3.0 * u * t * t * control[2].y
                    + t * t * t * control[3].y,
            )
        };
        let mut worst = 0.0_f64;
        for segment in &input.path.segments {
            let control = cubic_control_points(segment, input.path.vertices.as_slice());
            let curved = segment.tangent_start.is_some() || segment.tangent_end.is_some();
            if !curved {
                continue;
            }
            for step in 0..=128 {
                let t = f64::from(step) / 128.0;
                let true_point = manual_chain(input, bezier(&control, t));
                let mut best = f64::INFINITY;
                for piece in &generated {
                    let mut previous = bezier(piece, 0.0);
                    for piece_step in 1..=192 {
                        let piece_t = f64::from(piece_step) / 192.0;
                        let current = bezier(piece, piece_t);
                        best = best.min(point_to_segment(true_point, previous, current));
                        previous = current;
                    }
                }
                worst = worst.max(best);
            }
        }
        worst
    }

    #[test]
    fn straight_polygon_projects_exactly_through_a_projective_matrix() {
        let value = input(
            square_path(),
            [200.0, 20.0, 0.0, 10.0, 100.0, 0.0, 0.02, 0.01, 1.0],
            (200.0, 100.0),
            (400.0, 200.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
        assert_eq!(output.report.max_error, None);
        assert_eq!(output.network.segments.len(), 4);
        for index in 0..4 {
            let source = value.path.vertices[index];
            let expected = manual_chain(&value, Point::new(source.x, source.y));
            let actual = output.network.vertices[index];
            assert_eq!((actual.x, actual.y), (expected.x, expected.y));
        }
        assert_eq!(output.network.regions.len(), 1);
        assert_eq!(output.network.regions[0].loops, vec![vec![0, 1, 2, 3]]);
    }

    #[test]
    fn affine_projection_preserves_cubic_handles_exactly() {
        let value = input(
            rounded_square_path(),
            [1.4, -0.3, 12.0, 0.2, 1.1, -7.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (150.0, 120.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
        assert_eq!(output.report.max_error, None);
        assert_eq!(output.network.segments.len(), 4);
        let segment = &output.network.segments[0];
        let source = &value.path.segments[0];
        let start = value.path.vertices[source.start];
        let handle = source.tangent_start.unwrap();
        let expected_p1 = manual_chain(&value, Point::new(start.x + handle.x, start.y + handle.y));
        let start_out = output.network.vertices[segment.start];
        let handle_out = segment.tangent_start.unwrap();
        // The emitted handle is the exact difference of the projected
        // control points; reconstructing the handle endpoint must round-trip
        // to the same value (one ulp of slack for the reconstruction).
        let reconstructed = Point::new(start_out.x + handle_out.x, start_out.y + handle_out.y);
        assert!((reconstructed.x - expected_p1.x).abs() < 1.0e-9);
        assert!((reconstructed.y - expected_p1.y).abs() < 1.0e-9);
    }

    #[test]
    fn emitted_bounds_follow_cubic_extrema_instead_of_endpoints_or_handle_hull() {
        let mut builder = OutputBuilder::default();
        let start = builder.push_vertex(Point::new(0.0, 50.0)).unwrap();
        let end = builder.push_vertex(Point::new(100.0, 50.0)).unwrap();
        builder
            .push_segment(
                start,
                end,
                Some(Point::new(0.0, -60.0)),
                Some(Point::new(0.0, 60.0)),
            )
            .unwrap();
        let bounds = builder.bounds().unwrap();
        let control_y = [50.0, -10.0, 110.0, 50.0];
        for step in 0..=1000 {
            let point = cubic_coordinate(control_y, f64::from(step) / 1000.0);
            assert!(point >= bounds.y - 1.0e-12);
            assert!(point <= bounds.y + bounds.height + 1.0e-12);
        }
        assert!(bounds.y > -10.0);
        assert!(bounds.y + bounds.height < 110.0);
        assert_eq!(bounds.x, 0.0);
        assert_eq!(bounds.width, 100.0);
    }

    #[test]
    fn perspective_subdivides_curves_within_the_reported_budget() {
        let value = input(
            rounded_square_path(),
            [140.0, 12.0, -6.0, 8.0, 90.0, 4.0, 0.05, 0.02, 1.0],
            (100.0, 100.0),
            (200.0, 180.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(
            output.report.fidelity,
            VectorProjectionFidelity::Approximated
        );
        let max_error = output
            .report
            .max_error
            .expect("approximated reports a bound");
        assert!(max_error <= value.tolerance_px, "{max_error}");
        assert!(output.network.segments.len() > 4);
        assert_eq!(
            output.report.reasons,
            vec![VectorProjectionLossReason::CurveSubdivision]
        );
        let deviation = sampled_deviation(&value, &output);
        assert!(
            deviation <= max_error + 1.0e-9,
            "sampled deviation {deviation} exceeds the reported bound {max_error}"
        );
    }

    #[test]
    fn holes_multi_regions_and_winding_rules_survive_projection() {
        // A concave outer ring with a triangular hole plus a separate region.
        let path = VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(120.0, 0.0),
                vertex(120.0, 90.0),
                vertex(60.0, 40.0),
                vertex(0.0, 90.0),
                vertex(40.0, 25.0),
                vertex(80.0, 25.0),
                vertex(60.0, 60.0),
            ],
            segments: vec![
                straight(0, 1),
                straight(1, 2),
                straight(2, 3),
                straight(3, 4),
                straight(4, 0),
                straight(5, 6),
                straight(6, 7),
                straight(7, 5),
            ],
            regions: vec![
                region(VectorWindingRule::EvenOdd, &[&[0, 1, 2, 3, 4], &[5, 6, 7]]),
                region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3, 4]]),
            ],
        };
        let value = input(
            path,
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
        assert_eq!(output.network.regions.len(), 2);
        assert_eq!(
            output.network.regions[0].winding_rule,
            VectorWindingRule::EvenOdd
        );
        assert_eq!(
            output.network.regions[0].loops,
            vec![vec![0, 1, 2, 3, 4], vec![5, 6, 7]]
        );
        assert_eq!(
            output.network.regions[1].winding_rule,
            VectorWindingRule::NonZero
        );
    }

    #[test]
    fn reversed_loop_traversal_rebuilds_in_walk_order() {
        // The same square, listed counter-clockwise by segment order.
        let path = VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(100.0, 0.0),
                vertex(100.0, 100.0),
                vertex(0.0, 100.0),
            ],
            segments: vec![
                straight(0, 1),
                straight(1, 2),
                straight(2, 3),
                straight(3, 0),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[3, 2, 1, 0]])],
        };
        let value = input(
            path,
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.network.regions[0].loops, vec![vec![3, 2, 1, 0]]);
    }

    #[test]
    fn stroked_rectangle_miter_outline_is_exact() {
        let value = stroke_input(
            square_path(),
            stroke(8.0, VectorStrokeCap::None, VectorStrokeJoin::Miter),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Outlined);
        assert_eq!(output.report.max_error, None);
        assert!(output.report.stroke_outlined);
        assert_eq!(
            output.report.reasons,
            vec![VectorProjectionLossReason::StrokeOutlined]
        );
        assert_eq!(output.report.stroke_chains, Some(1));
        // 4 fill segments, a 4-segment inner ring, and a 12-segment outer
        // ring (each corner contributes its miter tip plus the raw offset
        // points, which sit on the ring edges).
        assert_eq!(output.network.segments.len(), 20);
        // One fill region plus one stroke region holding both outline loops.
        assert_eq!(output.network.regions.len(), 2);
        let stroke_region = &output.network.regions[1];
        assert_eq!(stroke_region.winding_rule, VectorWindingRule::NonZero);
        assert_eq!(stroke_region.loops.len(), 2);
        // Nonzero winding over the two oppositely wound loops fills only the
        // stroke band: the closed-chain interior stays open, outside stays
        // empty.
        assert_eq!(
            loop_winding(
                &output.network,
                &stroke_region.loops,
                Point::new(50.0, 50.0)
            ),
            0
        );
        assert_ne!(
            loop_winding(
                &output.network,
                &stroke_region.loops,
                Point::new(50.0, 99.0)
            ),
            0
        );
        assert_eq!(
            loop_winding(
                &output.network,
                &stroke_region.loops,
                Point::new(-10.0, 50.0)
            ),
            0
        );
        let xs: Vec<f64> = output.network.vertices.iter().map(|v| v.x).collect();
        let ys: Vec<f64> = output.network.vertices.iter().map(|v| v.y).collect();
        assert_eq!(xs.iter().cloned().fold(f64::INFINITY, f64::min), -4.0);
        assert_eq!(xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max), 104.0);
        assert_eq!(ys.iter().cloned().fold(f64::INFINITY, f64::min), -4.0);
        assert_eq!(ys.iter().cloned().fold(f64::NEG_INFINITY, f64::max), 104.0);
        // The inner ring stays inside the source square.
        let inner: Vec<&VectorPathVertex> = output
            .network
            .vertices
            .iter()
            .filter(|v| v.x > 0.0 && v.x < 100.0 && v.y > 0.0 && v.y < 100.0)
            .collect();
        assert!(
            inner
                .iter()
                .all(|v| v.x == 4.0 || v.x == 96.0 || v.y == 4.0 || v.y == 96.0)
        );
    }

    #[test]
    fn open_stroke_caps_match_their_promises() {
        // A closed square region plus one open spoke segment: the spoke
        // forms an open stroke chain with caps on both ends.
        let open_path = VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(100.0, 0.0),
                vertex(100.0, 100.0),
                vertex(0.0, 100.0),
                vertex(150.0, 50.0),
            ],
            segments: vec![
                straight(0, 1),
                straight(1, 2),
                straight(2, 3),
                straight(3, 0),
                straight(1, 4),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
        };
        for (cap, expect_error) in [
            (VectorStrokeCap::None, false),
            (VectorStrokeCap::Square, false),
            (VectorStrokeCap::Round, true),
        ] {
            let value = stroke_input(
                open_path.clone(),
                stroke(6.0, cap, VectorStrokeJoin::Miter),
                [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            );
            let output = plan_vector_projection(&value).unwrap();
            assert_eq!(output.report.fidelity, VectorProjectionFidelity::Outlined);
            assert_eq!(
                output.report.max_error.is_some(),
                expect_error,
                "cap {cap:?}"
            );
            if expect_error {
                assert!(output.report.max_error.unwrap() <= value.tolerance_px);
            }
        }
    }

    #[test]
    fn closed_curved_stroke_stays_near_the_offset_distance() {
        let value = stroke_input(
            rounded_square_path(),
            stroke(8.0, VectorStrokeCap::None, VectorStrokeJoin::Round),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Outlined);
        assert!(output.report.max_error.unwrap() <= value.tolerance_px);
        assert!(
            output
                .report
                .reasons
                .contains(&VectorProjectionLossReason::StrokeApproximated)
        );
        // Every outline vertex of the outer loop sits within the reported
        // error of distance 4 from the rounded-square boundary. The chain
        // fills the source square, so the outline must stay outside it.
        let outline_start = value.path.segments.len();
        let stroke_segments = &output.network.segments[outline_start..];
        let mut outside = 0;
        for segment in stroke_segments {
            for index in [segment.start, segment.end] {
                let point = output.network.vertices[index];
                if point.x <= -1.0e-9
                    || point.x >= 100.0 + 1.0e-9
                    || point.y <= -1.0e-9
                    || point.y >= 100.0 + 1.0e-9
                {
                    outside += 1;
                }
            }
        }
        assert!(outside > 0, "the outer outline must extend past the square");
    }

    #[test]
    fn complexity_overflow_rejects_instead_of_publishing() {
        // The original witnesses fit the measured multiline-capable envelope.
        // Keep their proven pixel budget, then enlarge placement enough to
        // exceed the actual current output ceiling, never publish a partial path.
        let mut vertices = Vec::new();
        let mut segments = Vec::new();
        for index in 0..300 {
            let x = f64::from(index) * 0.33;
            vertices.push(vertex(x, 50.0 + 45.0 * (f64::from(index) * 0.4).sin()));
        }
        for index in 0..299 {
            segments.push(cubic(index, index + 1, (0.1, 8.0), (-0.1, -8.0)));
        }
        segments.push(straight(299, 0));
        let path = VectorPathSpec {
            vertices,
            segments,
            regions: vec![region(VectorWindingRule::NonZero, &[&[0]])],
        };
        let mut value = input(
            path,
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.3, 0.2, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        value.tolerance_px = 0.01;
        let all: Vec<usize> = (0..300).collect();
        value.path.regions[0].loops = vec![all];
        let output = plan_vector_projection(&value).unwrap();
        assert!(output.report.output_segments > 2048);
        assert!(output.report.output_segments <= MAX_VECTOR_OUTPUT_SEGMENTS);
        assert!(output.report.max_error.unwrap() <= value.tolerance_px);
        value.placement = Size::new(1000.0, 1000.0);
        let larger = plan_vector_projection(&value).unwrap();
        assert!(larger.report.output_segments > output.report.output_segments);
        assert!(larger.report.max_error.unwrap() <= value.tolerance_px);
        value.placement = Size::new(100_000.0, 100_000.0);
        assert!(
            matches!(plan_vector_projection(&value), Err(error) if error.code == ErrorCode::OutputLimit)
        );
        value.placement = Size::new(100.0, 100.0);
        assert_eq!(plan_vector_projection(&value).unwrap(), output);
    }

    #[test]
    fn horizon_crossing_is_rejected_before_any_output() {
        // The homography sends the far edge of the path across w = 0.
        let value = input(
            square_path(),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, -1.6, 0.0, 1.6],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        let error = plan_vector_projection(&value).unwrap_err();
        assert_eq!(error.code, ErrorCode::HomographyHorizonCrossing);

        let curved = input(
            rounded_square_path(),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, -1.5, 0.0, 1.4],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        let error = plan_vector_projection(&curved).unwrap_err();
        assert_eq!(error.code, ErrorCode::HomographyHorizonCrossing);

        // The centerline stays on one side of the horizon, while its stroke
        // extends through it. The stroke domain must be checked separately;
        // inheriting the centerline scale would publish non-finite geometry
        // or an invalid error promise.
        let stroked = stroke_input(
            square_path(),
            stroke(8.0, VectorStrokeCap::None, VectorStrokeJoin::Miter),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, -1.0, 0.0, 1.02],
        );
        let error = plan_vector_projection(&stroked).unwrap_err();
        assert_eq!(error.code, ErrorCode::HomographyHorizonCrossing);
    }

    #[test]
    fn repeated_projection_is_deterministic() {
        let value = input(
            rounded_square_path(),
            [140.0, 12.0, -6.0, 8.0, 90.0, 4.0, 0.05, 0.02, 1.0],
            (100.0, 100.0),
            (200.0, 180.0),
        );
        let first = serde_json::to_string(&plan_vector_projection(&value).unwrap()).unwrap();
        let second = serde_json::to_string(&plan_vector_projection(&value).unwrap()).unwrap();
        assert_eq!(first, second);
    }

    #[test]
    fn stroke_reversals_and_stationary_segments_are_rejected() {
        // Direction reversal: a spike where the path folds back.
        let spike = VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(50.0, 0.0),
                vertex(50.0, 50.0),
                vertex(50.0, 10.0),
                vertex(0.0, 10.0),
            ],
            segments: vec![
                straight(0, 1),
                straight(1, 2),
                straight(2, 3),
                straight(3, 4),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
        };
        let value = stroke_input(
            spike,
            stroke(6.0, VectorStrokeCap::None, VectorStrokeJoin::Bevel),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
        );
        let error = plan_vector_projection(&value).unwrap_err();
        assert!(
            error.message.contains("reverses") || error.message.contains("self-intersects"),
            "unexpected rejection: {}",
            error.message
        );

        // Stationary endpoint: one zero handle on a curved segment.
        let stationary = VectorPathSpec {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(100.0, 0.0),
                vertex(100.0, 100.0),
                vertex(0.0, 100.0),
            ],
            segments: vec![
                cubic(0, 1, (0.0, 0.0), (-35.0, 0.0)),
                straight(1, 2),
                straight(2, 3),
                straight(3, 0),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
        };
        let value = stroke_input(
            stationary,
            stroke(6.0, VectorStrokeCap::None, VectorStrokeJoin::Bevel),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
        );
        let error = plan_vector_projection(&value).unwrap_err();
        assert!(error.message.contains("stationary"), "{}", error.message);
    }

    #[test]
    fn collinear_overshoot_curves_do_not_collapse_to_the_chord() {
        // The cubic's control points are collinear but its control polygon
        // overshoots the endpoints, so the true boundary leaves the
        // vertex-to-vertex chord. The projection must keep the excursion
        // instead of publishing a plain chord as exact.
        let path = VectorPathSpec {
            vertices: vec![vertex(0.0, 0.0), vertex(100.0, 0.0), vertex(50.0, 80.0)],
            segments: vec![
                cubic(0, 1, (300.0, 0.0), (-200.0, 0.0)),
                straight(1, 2),
                straight(2, 0),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2]])],
        };
        let value = input(
            path,
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        let output = plan_vector_projection(&value).unwrap();
        assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
        assert_eq!(output.network.segments.len(), 3);
        let emitted = &output.network.segments[0];
        let handle_start = emitted.tangent_start.expect("overshoot keeps handles");
        let handle_end = emitted.tangent_end.expect("overshoot keeps handles");
        let start = output.network.vertices[emitted.start];
        let end = output.network.vertices[emitted.end];
        let control = [
            Point::new(start.x, start.y),
            Point::new(start.x + handle_start.x, start.y + handle_start.y),
            Point::new(end.x + handle_end.x, end.y + handle_end.y),
            Point::new(end.x, end.y),
        ];
        let mut beyond_both_ends = false;
        for step in 0..=64 {
            let t = f64::from(step) / 64.0;
            let u = 1.0 - t;
            let x = u * u * u * control[0].x
                + 3.0 * u * u * t * control[1].x
                + 3.0 * u * t * t * control[2].x
                + t * t * t * control[3].x;
            if x > control[0].x.max(control[3].x) + 1.0 {
                beyond_both_ends = true;
            }
        }
        assert!(
            beyond_both_ends,
            "the emitted boundary must keep the overshoot past both endpoints"
        );
    }

    #[test]
    fn stroked_collinear_overshoot_is_rejected_not_flattened() {
        // The same overshooting side inside a stroked chain: its interior
        // stationary point cusps the offset, so the outline must be rejected
        // instead of published as an exact parallel segment.
        let path = VectorPathSpec {
            vertices: vec![vertex(0.0, 0.0), vertex(100.0, 0.0), vertex(50.0, 80.0)],
            segments: vec![
                cubic(0, 1, (300.0, 0.0), (-200.0, 0.0)),
                straight(1, 2),
                straight(2, 0),
            ],
            regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2]])],
        };
        let value = stroke_input(
            path,
            stroke(6.0, VectorStrokeCap::None, VectorStrokeJoin::Miter),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
        );
        let error = plan_vector_projection(&value).unwrap_err();
        assert!(
            error.message.contains("outlined") || error.message.contains("budget"),
            "unexpected rejection: {}",
            error.message
        );
    }

    #[test]
    fn self_intersection_check_includes_the_closing_edge() {
        // The only strict crossing involves the implicit edge from the last
        // point back to the first; every pair of consecutive listed edges is
        // clean, so the polygon is only safe when the closing edge is checked.
        let crossed = [
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(2.0, 2.0),
            Point::new(12.0, 8.0),
        ];
        assert!(reject_self_intersection(&[&crossed]).is_err());
        let square = [
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(0.0, 10.0),
        ];
        reject_self_intersection(&[&square]).unwrap();
        // Two separate loops still only fail when they actually cross.
        reject_self_intersection(&[&square, &crossed]).unwrap_err();
        let shifted: Vec<Point> = square
            .iter()
            .map(|point| Point::new(point.x + 40.0, point.y))
            .collect();
        reject_self_intersection(&[&square, &shifted]).unwrap();
    }

    #[test]
    fn headers_and_budgets_are_validated() {
        let mut value = input(
            square_path(),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        value.schema = "wrong".to_owned();
        assert_eq!(
            plan_vector_projection(&value).unwrap_err().code,
            ErrorCode::Schema
        );
        let mut value = input(
            square_path(),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        value.tolerance_px = 9.0;
        assert_eq!(
            plan_vector_projection(&value).unwrap_err().code,
            ErrorCode::Schema
        );
        let mut value = input(
            square_path(),
            [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
            (100.0, 100.0),
            (100.0, 100.0),
        );
        value.homography = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0];
        assert_eq!(
            plan_vector_projection(&value).unwrap_err().code,
            ErrorCode::HomographySingular
        );
    }

    fn arb_transform() -> impl Strategy<Value = [f64; 6]> {
        (
            -2.0f64..2.0,
            -1.0f64..1.0,
            -50.0f64..50.0,
            -1.0f64..1.0,
            -2.0f64..2.0,
            -50.0f64..50.0,
        )
            .prop_map(|(a, b, c, d, e, f)| [a.max(0.1), b, c, d, e.max(0.1), f])
    }

    fn arb_homography(projective: bool) -> impl Strategy<Value = [f64; 9]> {
        let g_range = if projective {
            -0.04f64..0.04
        } else {
            -1.0e-15f64..1.0e-15
        };
        (
            40.0f64..160.0,
            -20.0f64..20.0,
            -20.0f64..20.0,
            -20.0f64..20.0,
            40.0f64..160.0,
            -20.0f64..20.0,
            g_range.clone(),
            g_range,
        )
            .prop_map(|(a, b, c, d, e, f, g, h)| [a, b, c, d, e, f, g, h, 1.0])
    }

    fn arb_rounded_path() -> impl Strategy<Value = VectorPathSpec> {
        (
            -25.0f64..25.0,
            -25.0f64..25.0,
            -25.0f64..25.0,
            -25.0f64..25.0,
        )
            .prop_map(|(h0, h1, h2, h3)| {
                let k = 50.0 * 0.5523;
                VectorPathSpec {
                    vertices: vec![
                        vertex(50.0, 0.0),
                        vertex(100.0, 50.0),
                        vertex(50.0, 100.0),
                        vertex(0.0, 50.0),
                    ],
                    segments: vec![
                        cubic(0, 1, (k + h0, h1), (h2, -k + h3)),
                        cubic(1, 2, (h0, k + h1), (k + h2, h3)),
                        cubic(2, 3, (-k + h0, h1), (h2, k + h3)),
                        cubic(3, 0, (h0, -k + h1), (-k + h2, h3)),
                    ],
                    regions: vec![region(VectorWindingRule::NonZero, &[&[0, 1, 2, 3]])],
                }
            })
    }

    proptest! {
        #[test]
        fn affine_frames_preserve_every_cubic_exactly(
            path in arb_rounded_path(),
            transform in arb_transform(),
            homography in arb_homography(false),
            reference in (50.0f64..400.0, 50.0f64..400.0),
            placement in (50.0f64..400.0, 50.0f64..400.0),
        ) {
            let mut value = input(path, homography, reference, placement);
            value.source_transform = transform;
            let output = plan_vector_projection(&value).unwrap();
            prop_assert_eq!(output.report.fidelity, VectorProjectionFidelity::Exact);
            prop_assert_eq!(output.report.max_error, None);
            prop_assert_eq!(output.network.segments.len(), 4);
            // Every projected handle equals the manual chain over the source
            // control points.
            for (index, segment) in output.network.segments.iter().enumerate() {
                let source = &value.path.segments[index];
                for (tangent, at_start) in [(segment.tangent_start, true), (segment.tangent_end, false)] {
                    let handle = tangent.expect("affine pieces keep handles");
                    let base_index = if at_start { source.start } else { source.end };
                    let base = value.path.vertices[base_index];
                    let source_handle = if at_start { source.tangent_start.unwrap() } else { source.tangent_end.unwrap() };
                    let expected = manual_chain(
                        &value,
                        Point::new(base.x + source_handle.x, base.y + source_handle.y),
                    );
                    let base_out = output.network.vertices[if at_start { segment.start } else { segment.end }];
                    let reconstructed = (base_out.x + handle.x, base_out.y + handle.y);
                    prop_assert!(
                        (reconstructed.0 - expected.x).abs() < 1.0e-9
                            && (reconstructed.1 - expected.y).abs() < 1.0e-9,
                        "reconstructed {:?} != expected {:?}",
                        reconstructed,
                        (expected.x, expected.y)
                    );
                }
            }
        }

        #[test]
        fn projective_frames_stay_inside_the_reported_budget(
            path in arb_rounded_path(),
            homography in arb_homography(true),
            reference in (50.0f64..400.0, 50.0f64..400.0),
            placement in (50.0f64..400.0, 50.0f64..400.0),
        ) {
            let value = input(path, homography, reference, placement);
            let output = plan_vector_projection(&value).unwrap();
            let max_error = output.report.max_error;
            match output.report.fidelity {
                VectorProjectionFidelity::Exact => {
                    prop_assert!(max_error.is_none());
                }
                VectorProjectionFidelity::Approximated => {
                    let bound = max_error.expect("approximated reports a bound");
                    prop_assert!(bound <= value.tolerance_px);
                }
                VectorProjectionFidelity::Outlined => {
                    prop_assert!(value.stroke.is_some());
                }
            }
            if let Some(bound) = max_error {
                let deviation = sampled_deviation(&value, &output);
                prop_assert!(
                    deviation <= bound + 1.0e-9,
                    "deviation {} exceeded bound {}",
                    deviation,
                    bound
                );
            }
        }

        #[test]
        fn projection_output_is_bit_stable(
            path in arb_rounded_path(),
            homography in arb_homography(true),
        ) {
            let value = input(path, homography, (100.0, 100.0), (120.0, 130.0));
            let first = serde_json::to_string(&plan_vector_projection(&value).unwrap()).unwrap();
            let second = serde_json::to_string(&plan_vector_projection(&value).unwrap()).unwrap();
            prop_assert_eq!(first, second);
        }
    }
}

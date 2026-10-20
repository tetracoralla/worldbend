//! One authored operation, one complete vector artwork and one resource meter.
//! Carriers capture paints/paths and publish atomically; they do not resolve a
//! second deformation model or multiply per-path compute ceilings by part count.
use crate::vector_projection::{self, MeshProjection, ProjectionFrame};
use crate::{
    Bounds, ErrorCode, Size, TransformError, TransformResult, TransformSpec, VectorPathSpec,
    VectorProjectionInput, VectorProjectionOutput, VectorStrokeSpec, WarpMesh, build_warp_mesh,
    solve_spec,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::io::Write;
mod source_extent;

pub const MAX_VECTOR_ARTWORK_PARTS: usize = 64;
pub const MAX_VECTOR_ARTWORK_INPUT_VERTICES: usize = crate::MAX_VECTOR_INPUT_VERTICES;
pub const MAX_VECTOR_ARTWORK_INPUT_SEGMENTS: usize = crate::MAX_VECTOR_INPUT_SEGMENTS;
pub const MAX_VECTOR_ARTWORK_OUTPUT_VERTICES: usize = crate::MAX_VECTOR_OUTPUT_VERTICES;
pub const MAX_VECTOR_ARTWORK_OUTPUT_SEGMENTS: usize = crate::MAX_VECTOR_OUTPUT_SEGMENTS;
pub const MAX_VECTOR_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_VECTOR_ARTWORK_WORK_UNITS: usize = 8_000_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum VectorOperation {
    Transform {
        spec: TransformSpec,
    },
    #[cfg(feature = "deformation-work")]
    DeformationWork {
        spec: Box<crate::DeformationWorkSpec>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorOperationInput {
    #[schemars(schema_with = "operation_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub operation: VectorOperation,
    /// Explicit homography reference canvas, independent of logical placement.
    pub reference: Size,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorExecutionFrame {
    pub transform: TransformSpec,
    pub reference: Size,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorOperationPlan {
    pub homography: [f64; 9],
    pub reference: Size,
    /// Expanded executable plane, distinct from the complete authored operation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_frame: Option<VectorExecutionFrame>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh: Option<WarpMesh>,
    #[cfg(feature = "deformation-work")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<crate::MockupClipPlan>,
}

pub fn plan_vector_operation(input: &VectorOperationInput) -> TransformResult<VectorOperationPlan> {
    header(&input.schema, &input.version, "worldbend.vector-operation")?;
    match &input.operation {
        VectorOperation::Transform { spec } => {
            let solve = solve_spec(spec, Some(input.reference))?;
            Ok(VectorOperationPlan {
                execution_frame: None,
                homography: solve.homography.matrix,
                reference: solve.resolved_destination.reference,
                mesh: spec
                    .content
                    .warp
                    .map(|warp| build_warp_mesh(Some(warp)))
                    .transpose()?,
                #[cfg(feature = "deformation-work")]
                clip: None,
            })
        }
        #[cfg(feature = "deformation-work")]
        VectorOperation::DeformationWork { spec } => {
            if spec.target_size.is_some_and(|size| size != input.reference) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "vector work targetSize must match the explicit reference canvas",
                ));
            }
            let mut work = spec.as_ref().clone();
            work.target_size = Some(input.reference);
            let plan = crate::plan_deformation_work(&work)?;
            Ok(VectorOperationPlan {
                execution_frame: plan.authored_view.as_ref().map(|_| VectorExecutionFrame {
                    transform: plan.mesh_warp.spec.transform.clone(),
                    reference: plan.mesh_warp.solve.resolved_destination.reference,
                }),
                homography: plan.mesh_warp.solve.homography.matrix,
                reference: plan.mesh_warp.solve.resolved_destination.reference,
                mesh: Some(plan.mesh_warp.spec.mesh),
                clip: plan.clip,
            })
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorArtworkPart {
    pub path: VectorPathSpec,
    pub source_transform: [f64; 6],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stroke: Option<VectorStrokeSpec>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorArtworkProjectionInput {
    #[schemars(schema_with = "artwork_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub operation: VectorOperation,
    pub reference: Size,
    pub placement: Size,
    pub source_bounds: Bounds,
    /// Opt-in full geometry enclosure for a carrier's rounded appearance
    /// rectangle. Logical/cropped windows must leave this absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_bounds_policy: Option<VectorArtworkSourceBoundsPolicy>,
    pub parts: Vec<VectorArtworkPart>,
    #[serde(default = "tolerance")]
    #[schemars(range(min = 0.01, max = 4.0))]
    pub tolerance_px: f64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum VectorArtworkSourceBoundsPolicy {
    ExpandToGeometry,
}
fn operation_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.vector-operation"})
}
fn artwork_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.vector-artwork"})
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"0.1"})
}
fn tolerance() -> f64 {
    crate::DEFAULT_VECTOR_TOLERANCE_PX
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorArtworkUsage {
    pub parts: usize,
    pub input_vertices: usize,
    pub input_segments: usize,
    pub input_regions: usize,
    pub input_loop_references: usize,
    pub output_vertices: usize,
    pub output_segments: usize,
    pub output_regions: usize,
    pub output_loop_references: usize,
    pub face_visits: usize,
    pub curve_pieces: usize,
    pub stroke_pairs: usize,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub source_extent_nodes: usize,
    pub work_units: usize,
    pub input_bytes: usize,
    pub output_bytes: usize,
}
fn is_zero(value: &usize) -> bool {
    *value == 0
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorArtworkProjectionOutput {
    pub plan: VectorOperationPlan,
    pub outputs: Vec<VectorProjectionOutput>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_bounds: Option<Bounds>,
    /// The original target-domain mask projected at this job's placement and
    /// tolerance. It follows H, not interior M, and shares the whole job meter.
    #[cfg(feature = "deformation-work")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<VectorProjectionOutput>,
    pub usage: VectorArtworkUsage,
}

pub(crate) struct ProjectionWork(Cell<VectorArtworkUsage>, usize);
#[derive(Clone, Copy)]
pub(crate) enum WorkKind {
    Vertex,
    Segment,
    Region,
    References,
    Face,
    Curve,
    StrokePair,
    Extent,
}
impl ProjectionWork {
    fn new() -> Self {
        Self(
            Cell::new(VectorArtworkUsage::default()),
            MAX_VECTOR_ARTWORK_WORK_UNITS,
        )
    }
    pub(crate) fn single() -> Self {
        // The former 4096-output single-path envelope bounded stroke pairs
        // below 8.4M plus 8M mesh visits and smaller geometry/reference work.
        // Preserve that admitted envelope while bounding the new 32768 cap;
        // whole artworks retain their independent cumulative 8M limit.
        Self(
            Cell::new(VectorArtworkUsage::default()),
            crate::MAX_VECTOR_PROJECTION_WORK_UNITS,
        )
    }
    pub(crate) fn charge(&self, kind: WorkKind, count: usize) -> TransformResult<()> {
        let mut usage = self.0.get();
        let (value, limit, name) = match kind {
            WorkKind::Vertex => (
                &mut usage.output_vertices,
                MAX_VECTOR_ARTWORK_OUTPUT_VERTICES,
                "output vertices",
            ),
            WorkKind::Segment => (
                &mut usage.output_segments,
                MAX_VECTOR_ARTWORK_OUTPUT_SEGMENTS,
                "output segments",
            ),
            WorkKind::Region => (&mut usage.output_regions, 4096, "output regions"),
            WorkKind::References => (
                &mut usage.output_loop_references,
                crate::MAX_VECTOR_OUTPUT_LOOP_REFERENCES,
                "output loop references",
            ),
            WorkKind::Face => (
                &mut usage.face_visits,
                MAX_VECTOR_ARTWORK_WORK_UNITS,
                "face visits",
            ),
            WorkKind::Curve => (
                &mut usage.curve_pieces,
                MAX_VECTOR_ARTWORK_WORK_UNITS,
                "curve pieces",
            ),
            WorkKind::StrokePair => (&mut usage.stroke_pairs, self.1, "stroke pairs"),
            WorkKind::Extent => (
                &mut usage.source_extent_nodes,
                self.1,
                "source extent nodes",
            ),
        };
        *value = add(*value, count, limit, name)?;
        usage.work_units = add(usage.work_units, count, self.1, "work units")?;
        self.0.set(usage);
        Ok(())
    }
}

fn header(schema: &str, version: &str, expected: &str) -> TransformResult<()> {
    if schema != expected || version != "0.1" {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported vector operation/artwork header",
        ));
    }
    Ok(())
}
fn add(value: usize, count: usize, maximum: usize, name: &str) -> TransformResult<usize> {
    let next = value.saturating_add(count);
    if next > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "complete vector artwork exceeds its resource budget",
        )
        .with_details(serde_json::json!({"resource":name,"observed":next,"maximum":maximum})));
    }
    Ok(next)
}
pub(crate) fn json_bytes(value: &impl Serialize) -> TransformResult<usize> {
    struct Counter(usize);
    impl Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| std::io::Error::other("JSON size overflow"))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, value).map_err(|_| {
        TransformError::new(ErrorCode::Schema, "vector artwork serialization failed")
    })?;
    Ok(counter.0)
}

/// One complete result or one error. No partial outputs survive a late failure.
pub fn plan_vector_artwork(
    input: &VectorArtworkProjectionInput,
) -> TransformResult<VectorArtworkProjectionOutput> {
    header(&input.schema, &input.version, "worldbend.vector-artwork")?;
    if input.parts.is_empty() || input.parts.len() > MAX_VECTOR_ARTWORK_PARTS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "vector artwork part count must be in 1..64",
        ));
    }
    let work = ProjectionWork::new();
    let mut usage = work.0.get();
    for part in &input.parts {
        vector_projection::validate_path(&part.path)?;
        usage.input_vertices = add(
            usage.input_vertices,
            part.path.vertices.len(),
            MAX_VECTOR_ARTWORK_INPUT_VERTICES,
            "input vertices",
        )?;
        usage.input_segments = add(
            usage.input_segments,
            part.path.segments.len(),
            MAX_VECTOR_ARTWORK_INPUT_SEGMENTS,
            "input segments",
        )?;
        usage.input_regions = add(
            usage.input_regions,
            part.path.regions.len(),
            2048,
            "input regions",
        )?;
        for region in &part.path.regions {
            for indices in &region.loops {
                usage.input_loop_references = add(
                    usage.input_loop_references,
                    indices.len(),
                    crate::MAX_VECTOR_INPUT_LOOP_REFERENCES,
                    "input loop references",
                )?;
            }
        }
    }
    usage.input_bytes = add(
        0,
        json_bytes(input)?,
        MAX_VECTOR_ARTWORK_BYTES,
        "input bytes",
    )?;
    usage.work_units = add(
        usage.input_loop_references,
        usage.input_vertices + usage.input_segments,
        MAX_VECTOR_ARTWORK_WORK_UNITS,
        "input work",
    )?;
    work.0.set(usage);
    let source_bounds = if input.source_bounds_policy.is_some() {
        source_extent::resolve(input, &work)?
    } else {
        input.source_bounds
    };
    let plan = plan_vector_operation(&VectorOperationInput {
        schema: "worldbend.vector-operation".into(),
        version: "0.1".into(),
        operation: input.operation.clone(),
        reference: input.reference,
    })?;
    let make_input = |part: &VectorArtworkPart| VectorProjectionInput {
        schema: crate::VECTOR_PROJECTION_SCHEMA.into(),
        version: if plan.mesh.is_some() {
            crate::VECTOR_MESH_PROJECTION_VERSION
        } else {
            crate::VECTOR_PROJECTION_VERSION
        }
        .into(),
        path: part.path.clone(),
        stroke: part.stroke,
        source_transform: part.source_transform,
        source_bounds,
        homography: plan.homography,
        mesh: plan.mesh.clone(),
        reference: plan.reference,
        placement: input.placement,
        tolerance_px: input.tolerance_px,
    };
    let first = make_input(&input.parts[0]);
    let mut frame = ProjectionFrame::new(&first)?;
    frame.work = Some(&work);
    let prepared = plan
        .mesh
        .as_ref()
        .map(|mesh| MeshProjection::new(mesh, &frame))
        .transpose()?;
    let mut outputs = Vec::with_capacity(input.parts.len());
    for part in &input.parts {
        let output = vector_projection::project_with_work(
            &make_input(part),
            Some(&work),
            prepared.as_ref(),
        )?;
        let mut usage = work.0.get();
        usage.output_bytes = add(
            usage.output_bytes,
            json_bytes(&output)?,
            MAX_VECTOR_ARTWORK_BYTES,
            "output bytes",
        )?;
        usage.parts += 1;
        work.0.set(usage);
        outputs.push(output);
    }
    #[cfg(feature = "deformation-work")]
    let clip = match &input.operation {
        VectorOperation::DeformationWork { spec } => spec
            .shape_fit
            .as_ref()
            .and_then(|fit| fit.clip.as_ref())
            .map(|mask| {
                let path = crate::shape_fit_clip::compound_vector_path(mask);
                vector_projection::validate_path(&path)?;
                let mut usage = work.0.get();
                usage.input_vertices = add(
                    usage.input_vertices,
                    path.vertices.len(),
                    MAX_VECTOR_ARTWORK_INPUT_VERTICES,
                    "input vertices",
                )?;
                usage.input_segments = add(
                    usage.input_segments,
                    path.segments.len(),
                    MAX_VECTOR_ARTWORK_INPUT_SEGMENTS,
                    "input segments",
                )?;
                usage.input_regions = add(
                    usage.input_regions,
                    path.regions.len(),
                    crate::MAX_VECTOR_INPUT_REGIONS,
                    "input regions",
                )?;
                let refs = path
                    .regions
                    .iter()
                    .flat_map(|r| &r.loops)
                    .map(Vec::len)
                    .sum();
                usage.input_loop_references = add(
                    usage.input_loop_references,
                    refs,
                    crate::MAX_VECTOR_INPUT_LOOP_REFERENCES,
                    "input loop references",
                )?;
                usage.work_units = add(
                    usage.work_units,
                    path.vertices.len() + path.segments.len() + refs,
                    MAX_VECTOR_ARTWORK_WORK_UNITS,
                    "input work",
                )?;
                work.0.set(usage);
                vector_projection::project_with_work(
                    &VectorProjectionInput {
                        schema: crate::VECTOR_PROJECTION_SCHEMA.into(),
                        version: crate::VECTOR_PROJECTION_VERSION.into(),
                        path,
                        stroke: None,
                        source_transform: [1., 0., 0., 0., 1., 0.],
                        source_bounds: Bounds {
                            x: 0.,
                            y: 0.,
                            width: 1.,
                            height: 1.,
                        },
                        homography: plan.homography,
                        mesh: None,
                        reference: plan.reference,
                        placement: input.placement,
                        tolerance_px: input.tolerance_px,
                    },
                    Some(&work),
                    None,
                )
            })
            .transpose()?,
        VectorOperation::Transform { .. } => None,
    };
    let mut result = VectorArtworkProjectionOutput {
        plan,
        outputs,
        source_bounds: input.source_bounds_policy.map(|_| source_bounds),
        #[cfg(feature = "deformation-work")]
        clip,
        usage: work.0.get(),
    };
    // Include the complete result envelope, canonical mesh and usage itself.
    // Updating this decimal count can change its own serialized digit width.
    loop {
        let bytes = add(
            0,
            json_bytes(&result)?,
            MAX_VECTOR_ARTWORK_BYTES,
            "output bytes",
        )?;
        if bytes == result.usage.output_bytes {
            break;
        }
        result.usage.output_bytes = bytes;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Point, Quad, VectorPathRegion, VectorPathSegment, VectorPathVertex, VectorWindingRule,
    };
    fn polygon(count: usize) -> VectorArtworkPart {
        VectorArtworkPart {
            path: VectorPathSpec {
                vertices: (0..count)
                    .map(|i| {
                        let a = i as f64 / count as f64 * std::f64::consts::TAU;
                        VectorPathVertex {
                            x: 0.5 + 0.4 * a.cos(),
                            y: 0.5 + 0.4 * a.sin(),
                        }
                    })
                    .collect(),
                segments: (0..count)
                    .map(|i| VectorPathSegment {
                        start: i,
                        end: (i + 1) % count,
                        tangent_start: None,
                        tangent_end: None,
                    })
                    .collect(),
                regions: vec![VectorPathRegion {
                    winding_rule: VectorWindingRule::NonZero,
                    loops: vec![(0..count).collect()],
                }],
            },
            source_transform: [1., 0., 0., 0., 1., 0.],
            stroke: None,
        }
    }
    fn artwork(parts: Vec<VectorArtworkPart>) -> VectorArtworkProjectionInput {
        VectorArtworkProjectionInput {
            source_bounds_policy: None,
            schema: "worldbend.vector-artwork".into(),
            version: "0.1".into(),
            operation: VectorOperation::Transform {
                spec: TransformSpec::normalized(Quad::unit()),
            },
            reference: Size::new(100., 100.),
            placement: Size::new(100., 100.),
            source_bounds: Bounds {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            parts,
            tolerance_px: 0.25,
        }
    }
    #[cfg(feature = "deformation-work")]
    #[test]
    fn rounded_appearance_window_is_opt_in_and_keeps_full_paths_and_controls() {
        let mut part = polygon(3);
        part.path.vertices = vec![
            crate::VectorPathVertex { x: 0., y: 0. },
            crate::VectorPathVertex { x: 10., y: 0. },
            crate::VectorPathVertex {
                x: 0.,
                y: 10.000001,
            },
        ];
        part.source_transform = [1., 0., 80000., 0., 1., 20000.];
        let mut input = artwork(vec![part]);
        input.source_bounds = Bounds {
            x: 80000.,
            y: 20000.,
            width: 10.,
            height: 10.,
        };
        input.operation=VectorOperation::DeformationWork{spec:Box::new(serde_json::from_value(serde_json::json!({"schema":"worldbend.deformation-work","version":"0.1","transform":TransformSpec::normalized(Quad::unit()),"meshSubdivisions":4,"meshEdits":[{"column":2,"row":2,"warped":{"x":0.51,"y":0.5}}]})).unwrap())};
        let original = input.operation.clone();
        assert!(
            plan_vector_artwork(&input)
                .unwrap_err()
                .message
                .contains("source domain")
        );
        input.source_bounds_policy = Some(VectorArtworkSourceBoundsPolicy::ExpandToGeometry);
        let result = plan_vector_artwork(&input).unwrap();
        let bounds = result.source_bounds.unwrap();
        assert_eq!(bounds.x, 80000.);
        assert_eq!(bounds.y, 20000.);
        assert_eq!(bounds.width, 10.);
        assert!(bounds.height >= 10.000001 && bounds.height < 10.000002);
        assert_eq!(result.outputs[0].report.input_vertices, 3);
        assert!(result.usage.source_extent_nodes > 0);
        assert!(result.usage.work_units < MAX_VECTOR_ARTWORK_WORK_UNITS);
        assert_eq!(input.operation, original);
    }
    #[test]
    fn source_enclosure_keeps_interior_exterior_handles_and_bounds_true_curve_extrema() {
        let mut part = polygon(3);
        part.path.vertices = vec![
            crate::VectorPathVertex { x: 0., y: 0. },
            crate::VectorPathVertex { x: 1., y: 0. },
            crate::VectorPathVertex { x: 0.5, y: 0.5 },
        ];
        part.path.segments[0].tangent_start = Some(Point::new(0., 1.25));
        part.path.segments[0].tangent_end = Some(Point::new(0., 1.25));
        let mut input = artwork(vec![part]);
        let plain = plan_vector_artwork(&input).unwrap();
        input.source_bounds_policy = Some(VectorArtworkSourceBoundsPolicy::ExpandToGeometry);
        let same = plan_vector_artwork(&input).unwrap();
        assert_eq!(same.source_bounds, Some(input.source_bounds));
        assert_eq!(same.outputs, plain.outputs);
        input.parts[0].path.segments[0].tangent_start = Some(Point::new(0., 1.5));
        input.parts[0].path.segments[0].tangent_end = Some(Point::new(0., 1.5));
        let expanded = plan_vector_artwork(&input).unwrap().source_bounds.unwrap();
        assert_eq!(expanded.width, 1.);
        assert!(expanded.height >= 1.125 && expanded.height < 1.12500001);
        // Hull endpoints alone would miss the true interior maximum, while
        // the original handle hull would incorrectly use height1.5.
        input.parts[0].stroke = Some(VectorStrokeSpec {
            weight: 0.01,
            cap: crate::VectorStrokeCap::None,
            join: crate::VectorStrokeJoin::Miter,
            miter_limit: 4.,
        });
        assert!(
            plan_vector_artwork(&input)
                .unwrap_err()
                .message
                .contains("resolved native stroke outlines")
        );
    }
    #[test]
    fn source_enclosure_uses_the_same_aggregate_budget_and_next_call_recovers() {
        let input = artwork(vec![polygon(4)]);
        let work = ProjectionWork::new();
        work.charge(WorkKind::Face, MAX_VECTOR_ARTWORK_WORK_UNITS - 1)
            .unwrap();
        assert_eq!(
            source_extent::resolve(&input, &work).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        assert_eq!(plan_vector_artwork(&input).unwrap().outputs.len(), 1);
    }
    #[test]
    fn complete_job_keeps_legacy_geometry_and_counts_its_actual_serialized_envelope() {
        let input = artwork(vec![polygon(4), polygon(669)]);
        let result = plan_vector_artwork(&input).unwrap();
        for (part, output) in input.parts.iter().zip(&result.outputs) {
            let legacy = VectorProjectionInput {
                schema: crate::VECTOR_PROJECTION_SCHEMA.into(),
                version: "0.1".into(),
                path: part.path.clone(),
                source_transform: part.source_transform,
                stroke: None,
                source_bounds: input.source_bounds,
                homography: result.plan.homography,
                mesh: None,
                reference: input.reference,
                placement: input.placement,
                tolerance_px: input.tolerance_px,
            };
            assert_eq!(
                serde_json::to_string(output).unwrap(),
                serde_json::to_string(&crate::plan_vector_projection(&legacy).unwrap()).unwrap()
            );
        }
        assert_eq!(result.usage.parts, 2);
        assert_eq!(result.usage.input_vertices, 673);
        assert_eq!(result.usage.output_vertices, 673);
        assert_eq!(
            result.usage.input_bytes,
            serde_json::to_vec(&input).unwrap().len()
        );
        assert_eq!(
            result.usage.output_bytes,
            serde_json::to_vec(&result).unwrap().len()
        );
    }
    #[test]
    fn aggregate_input_boundary_rejects_the_whole_job_and_next_call_recovers() {
        let maximum = artwork(vec![polygon(1024); 8]);
        assert_eq!(
            plan_vector_artwork(&maximum).unwrap().usage.input_vertices,
            8192
        );
        let mut excessive = maximum;
        excessive.parts.push(polygon(3));
        let error = plan_vector_artwork(&excessive).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(error.details.unwrap()["resource"], "input vertices");
        assert_eq!(
            plan_vector_artwork(&artwork(vec![polygon(3)]))
                .unwrap()
                .usage
                .parts,
            1
        );
        assert!(plan_vector_artwork(&artwork(vec![polygon(8193)])).is_err());
        // A complete multiline outline remains one authored paint layer; the
        // carrier is not required to split it into glyphs or separate nodes.
        assert_eq!(
            plan_vector_artwork(&artwork(vec![polygon(7323)]))
                .unwrap()
                .usage
                .output_vertices,
            7323
        );
    }
    #[test]
    fn widened_single_path_capacity_cannot_enable_unbounded_quadratic_stroke_work() {
        let input = artwork(vec![polygon(8192)]);
        let make = |part: VectorArtworkPart, stroke| VectorProjectionInput {
            schema: crate::VECTOR_PROJECTION_SCHEMA.into(),
            version: "0.1".into(),
            path: part.path,
            source_transform: part.source_transform,
            source_bounds: input.source_bounds,
            homography: [100., 0., 0., 0., 100., 0., 0., 0., 1.],
            mesh: None,
            reference: input.reference,
            placement: input.placement,
            tolerance_px: 0.25,
            stroke,
        };
        let mut large = make(
            polygon(3072),
            Some(VectorStrokeSpec {
                weight: 0.1,
                cap: crate::VectorStrokeCap::None,
                join: crate::VectorStrokeJoin::Miter,
                miter_limit: 4.,
            }),
        );
        // A non-self-crossing straight open chain with separated vertices;
        // avoid testing the legacy near-collinear join ambiguity of an 8192-gon.
        for (i, point) in large.path.vertices.iter_mut().enumerate() {
            point.x = i as f64 * 10.;
            point.y = 1.;
        }
        large.path.segments.pop();
        // The wire needs a painted closed region even when the stroke also
        // includes an open chain. Keep a separate triangle, not a fake loop.
        for (x, y) in [(-100., -100.), (-90., -100.), (-95., -90.)] {
            large.path.vertices.push(VectorPathVertex { x, y });
        }
        let first = large.path.segments.len();
        for (start, end) in [(3072, 3073), (3073, 3074), (3074, 3072)] {
            large.path.segments.push(VectorPathSegment {
                start,
                end,
                tangent_start: None,
                tangent_end: None,
            });
        }
        large.path.regions[0].loops = vec![vec![first, first + 1, first + 2]];
        large.source_bounds = Bounds {
            x: -1000.,
            y: -1000.,
            width: 32000.,
            height: 2000.,
        };
        let error = crate::plan_vector_projection(&large).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit, "{error:?}");
        assert_eq!(
            error.details.as_ref().unwrap()["resource"],
            "work units",
            "{error:?}"
        );
        assert_eq!(error.details.as_ref().unwrap()["maximum"], 17_000_000);
        assert_eq!(
            crate::plan_vector_projection(&make(polygon(4), None))
                .unwrap()
                .network
                .vertices
                .len(),
            4
        );
    }
    #[test]
    fn part_and_accumulated_compute_guards_are_independent() {
        assert_eq!(
            plan_vector_artwork(&artwork(vec![polygon(3); 64]))
                .unwrap()
                .usage
                .parts,
            64
        );
        assert!(plan_vector_artwork(&artwork(vec![polygon(3); 65])).is_err());
        let meter = ProjectionWork::new();
        meter
            .charge(WorkKind::Face, MAX_VECTOR_ARTWORK_WORK_UNITS - 1)
            .unwrap();
        assert!(meter.charge(WorkKind::Curve, 2).is_err());
        assert_eq!(meter.0.get().work_units, MAX_VECTOR_ARTWORK_WORK_UNITS - 1);
        assert!(
            meter
                .charge(WorkKind::Vertex, MAX_VECTOR_ARTWORK_OUTPUT_VERTICES + 1)
                .is_err()
        );
    }
    #[test]
    fn individually_admitted_curved_strokes_cannot_reset_the_complete_job_meter() {
        let k = 0.3 * 0.552_284_749_830_793_6;
        let mut part = polygon(4);
        part.path.vertices = vec![
            VectorPathVertex { x: 0.8, y: 0.5 },
            VectorPathVertex { x: 0.5, y: 0.8 },
            VectorPathVertex { x: 0.2, y: 0.5 },
            VectorPathVertex { x: 0.5, y: 0.2 },
        ];
        let handles = [
            (Point::new(0., k), Point::new(k, 0.)),
            (Point::new(-k, 0.), Point::new(0., k)),
            (Point::new(0., -k), Point::new(-k, 0.)),
            (Point::new(k, 0.), Point::new(0., -k)),
        ];
        for (segment, (start, end)) in part.path.segments.iter_mut().zip(handles) {
            segment.tangent_start = Some(start);
            segment.tangent_end = Some(end);
        }
        part.stroke = Some(VectorStrokeSpec {
            weight: 0.01,
            cap: crate::VectorStrokeCap::None,
            join: crate::VectorStrokeJoin::Miter,
            miter_limit: 4.,
        });
        let mut input = artwork(vec![part.clone()]);
        input.reference = Size::new(700., 700.);
        input.placement = input.reference;
        let single = plan_vector_artwork(&input).unwrap();
        assert!(single.usage.stroke_pairs > 500_000);
        assert!(single.usage.output_vertices < 2048);
        assert!(single.outputs[0].report.max_error.unwrap() <= input.tolerance_px);
        input.parts = vec![part; 16];
        let error = plan_vector_artwork(&input).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(error.details.as_ref().unwrap()["resource"], "work units");
        assert_eq!(error.details.as_ref().unwrap()["observed"], 8_000_001);
        input.parts.truncate(1);
        assert_eq!(plan_vector_artwork(&input).unwrap(), single);
    }
    #[cfg(feature = "deformation-work")]
    #[test]
    fn complete_authored_pin_liquify_mesh_work_uses_the_existing_canonical_resolver() {
        let envelope = crate::BezierEnvelope {
            columns: 1,
            rows: 1,
            points: (0..4)
                .flat_map(|r| (0..4).map(move |c| Point::new(c as f64 / 3., r as f64 / 3.)))
                .collect(),
        };
        let work = crate::DeformationWorkSpec {
            boundary: Default::default(),
            schema: crate::DEFORMATION_WORK_SCHEMA.into(),
            version: "0.1".into(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: None,
            mesh_subdivisions: 4,
            surface: Some(crate::SurfaceDeformationControls {
                envelope,
                anchors: vec![crate::DeformationAnchor {
                    id: "pin".into(),
                    column: 2,
                    row: 2,
                }],
                strokes: vec![crate::DeformationStroke {
                    id: "push".into(),
                    samples: vec![crate::StrokeSample {
                        position: Point::new(0.3, 0.4),
                        delta: Point::new(0.01, 0.),
                        radius: 0.2,
                        strength: 1.,
                    }],
                }],
            }),
            liquify: Some(crate::LiquifyControls {
                strokes: vec![crate::LiquifyStroke {
                    id: "brush".into(),
                    mode: crate::LiquifyMode::Push,
                    samples: vec![crate::LiquifySample {
                        position: Point::new(0.7, 0.7),
                        delta: Some(Point::new(0., 0.01)),
                        radius: 0.2,
                        strength: 1.,
                    }],
                }],
            }),
            shape_fit: None,
            mesh_edits: vec![crate::MeshVertexEdit {
                column: 1,
                row: 1,
                warped: Point::new(0.26, 0.24),
            }],
        };
        let saved = serde_json::to_vec(&work).unwrap();
        let mut canonical = work.clone();
        canonical.target_size = Some(Size::new(100., 100.));
        let expected = crate::plan_deformation_work(&canonical).unwrap();
        let mut input = artwork(vec![polygon(4), polygon(20)]);
        input.operation = VectorOperation::DeformationWork {
            spec: Box::new(work),
        };
        let result = plan_vector_artwork(&input).unwrap();
        assert_eq!(
            result.plan.mesh.as_ref().unwrap(),
            &expected.mesh_warp.spec.mesh
        );
        assert_eq!(
            result.plan.homography,
            expected.mesh_warp.solve.homography.matrix
        );
        if let VectorOperation::DeformationWork { spec } = &input.operation {
            assert_eq!(serde_json::to_vec(spec).unwrap(), saved);
        }
        assert!(result.usage.face_visits > 0);
        assert_eq!(result.usage.parts, 2);
        let mut conflicting = canonical;
        conflicting.target_size = Some(Size::new(101., 100.));
        assert!(
            plan_vector_operation(&VectorOperationInput {
                schema: "worldbend.vector-operation".into(),
                version: "0.1".into(),
                operation: VectorOperation::DeformationWork {
                    spec: Box::new(conflicting)
                },
                reference: input.reference
            })
            .is_err()
        );
    }

    #[cfg(feature = "deformation-work")]
    #[test]
    fn original_compound_guide_mask_uses_actual_job_tolerance_h_and_the_whole_meter() {
        use crate::{
            MockupClip, MockupClipContour, MockupClipFillRule, MockupClipRegion, MockupClipSegment,
            ShapeFitControls,
        };
        let rectangle = |x: f64, y: f64, w: f64, h: f64| MockupClipContour {
            start: Point::new(x, y),
            segments: [(x + w, y), (x + w, y + h), (x, y + h)]
                .into_iter()
                .map(|(x, y)| MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .collect(),
        };
        let lens = MockupClipContour {
            start: Point::new(0.1, 0.5),
            segments: vec![
                MockupClipSegment::Cubic {
                    c1: Point::new(0.1, 0.1),
                    c2: Point::new(0.9, 0.1),
                    to: Point::new(0.9, 0.5),
                },
                MockupClipSegment::Cubic {
                    c1: Point::new(0.9, 0.9),
                    c2: Point::new(0.1, 0.9),
                    to: Point::new(0.1, 0.5),
                },
            ],
        };
        let clip = MockupClip {
            contours: vec![
                lens,
                rectangle(0.4, 0.4, 0.2, 0.2),
                rectangle(0.02, 0.02, 0.03, 0.03),
            ],
            fill_rule: MockupClipFillRule::EvenOdd,
            regions: vec![
                MockupClipRegion {
                    contour_indices: vec![0, 1],
                    fill_rule: MockupClipFillRule::EvenOdd,
                },
                MockupClipRegion {
                    contour_indices: vec![2],
                    fill_rule: MockupClipFillRule::NonZero,
                },
            ],
        };
        let mut input = artwork(vec![polygon(4)]);
        input.placement = Size::new(2000., 1800.);
        input.tolerance_px = 0.1;
        let mut transform = TransformSpec::normalized(Quad::unit());
        transform.destination.quad.br = Point::new(0.8, 1.);
        let work = crate::DeformationWorkSpec {
            boundary: Default::default(),
            schema: crate::DEFORMATION_WORK_SCHEMA.into(),
            version: "0.1".into(),
            transform,
            target_size: None,
            mesh_subdivisions: 4,
            surface: None,
            liquify: None,
            mesh_edits: vec![crate::MeshVertexEdit {
                column: 2,
                row: 2,
                warped: Point::new(0.6, 0.5),
            }],
            shape_fit: Some(ShapeFitControls {
                contour: rectangle(0., 0., 1., 1.),
                clip: Some(clip.clone()),
                corner_positions: None,
                refinement: None,
            }),
        };
        input.operation = VectorOperation::DeformationWork {
            spec: Box::new(work),
        };
        let result = plan_vector_artwork(&input).unwrap();
        let mask = result.clip.as_ref().unwrap();
        let path = crate::shape_fit_clip::compound_vector_path(&clip);
        let expected = crate::plan_vector_projection(&VectorProjectionInput {
            schema: crate::VECTOR_PROJECTION_SCHEMA.into(),
            version: "0.1".into(),
            path: path.clone(),
            stroke: None,
            source_transform: [1., 0., 0., 0., 1., 0.],
            source_bounds: Bounds {
                x: 0.,
                y: 0.,
                width: 1.,
                height: 1.,
            },
            homography: result.plan.homography,
            mesh: None,
            reference: input.reference,
            placement: input.placement,
            tolerance_px: input.tolerance_px,
        })
        .unwrap();
        assert_eq!(mask, &expected);
        assert!(mask.report.max_error.unwrap() <= input.tolerance_px);
        assert_eq!(
            mask.network.regions[0].winding_rule,
            VectorWindingRule::EvenOdd
        );
        assert_eq!(mask.network.regions[0].loops.len(), 2);
        assert_eq!(
            mask.network.regions[1].winding_rule,
            VectorWindingRule::NonZero
        );
        assert_eq!(result.usage.parts, 1);
        assert_eq!(result.usage.input_vertices, 4 + path.vertices.len());
        assert_eq!(
            result.usage.output_vertices,
            result.outputs[0].network.vertices.len() + mask.network.vertices.len()
        );
        assert_eq!(
            result.usage.output_bytes,
            serde_json::to_vec(&result).unwrap().len()
        );
        // Interior changes affect artwork but never deform the target mask.
        let mut changed = input.clone();
        if let VectorOperation::DeformationWork { spec } = &mut changed.operation {
            spec.mesh_edits[0].warped.x = 0.4;
        }
        let updated = plan_vector_artwork(&changed).unwrap();
        assert_eq!(updated.clip, result.clip);
        assert_ne!(updated.outputs, result.outputs);
        input.parts = vec![polygon(8192)];
        let error = plan_vector_artwork(&input).unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(error.details.unwrap()["resource"], "input vertices");
        assert_eq!(plan_vector_artwork(&changed).unwrap(), updated);
    }
}

use crate::{
    ErrorCode, MeshWarpPlan, MeshWarpSpec, Point, Size, TransformError, TransformResult,
    TransformSpec, WarpMesh, WarpVertex, plan_mesh_warp,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const SURFACE_DEFORMATION_SCHEMA: &str = "worldbend.surface-deformation";
pub const SURFACE_DEFORMATION_PLAN_SCHEMA: &str = "worldbend.surface-deformation-plan";
pub const SURFACE_DEFORMATION_VERSION: &str = "0.1";
pub const MAX_BEZIER_PATCHES_PER_AXIS: u8 = 4;
pub const MAX_DEFORMATION_ANCHORS: usize = 64;
pub const MAX_DEFORMATION_STROKES: usize = 64;
pub const MAX_STROKE_SAMPLES_PER_STROKE: usize = 256;
pub const MAX_DEFORMATION_STROKE_SAMPLES: usize = 1024;

const MIN_MESH_SUBDIVISIONS: u16 = 4;
const MAX_MESH_SUBDIVISIONS: u16 = 16;
const MAX_CONTROL_POINTS: usize = 169;
const MIN_STROKE_RADIUS: f64 = 0.001;
const MAX_STROKE_RADIUS: f64 = 2.0;
const MAX_CONTROL_EXTENT: f64 = 3.0;
const MIN_CONTROL_EXTENT: f64 = -2.0;
const BOUNDARY_EPSILON: f64 = 1e-12;
const MAX_ID_BYTES: usize = 64;

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SURFACE_DEFORMATION_SCHEMA })
}

fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SURFACE_DEFORMATION_PLAN_SCHEMA })
}

fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": SURFACE_DEFORMATION_VERSION })
}

fn default_subdivisions() -> u16 {
    12
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceDeformationSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub transform: TransformSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_size: Option<Size>,
    #[serde(default = "default_subdivisions")]
    #[schemars(range(min = 4, max = 16))]
    pub mesh_subdivisions: u16,
    pub envelope: BezierEnvelope,
    #[serde(default)]
    #[schemars(length(max = 64))]
    pub anchors: Vec<DeformationAnchor>,
    #[serde(default)]
    #[schemars(length(max = 64))]
    pub strokes: Vec<DeformationStroke>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BezierEnvelope {
    #[schemars(range(min = 1, max = 4))]
    pub columns: u8,
    #[schemars(range(min = 1, max = 4))]
    pub rows: u8,
    #[schemars(length(min = 16, max = 169))]
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationAnchor {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    #[schemars(range(max = 16))]
    pub column: u16,
    #[schemars(range(max = 16))]
    pub row: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationStroke {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    #[schemars(length(min = 1, max = 256))]
    pub samples: Vec<StrokeSample>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StrokeSample {
    pub position: Point,
    pub delta: Point,
    #[schemars(range(min = 0.001, max = 2.0))]
    pub radius: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub strength: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolvedDeformationAnchor {
    pub id: String,
    pub column: u16,
    pub row: u16,
    pub vertex_index: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceDeformationPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub spec: SurfaceDeformationSpec,
    pub mesh_warp: MeshWarpPlan,
    #[schemars(length(max = 64))]
    pub anchors: Vec<ResolvedDeformationAnchor>,
    #[schemars(range(max = 1024))]
    pub stroke_sample_count: usize,
}

pub fn plan_surface_deformation(
    spec: &SurfaceDeformationSpec,
) -> TransformResult<SurfaceDeformationPlan> {
    validate_header(spec)?;
    if spec.transform.content.warp.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "surface deformation transform must not also contain a preset Warp",
        ));
    }
    if !(MIN_MESH_SUBDIVISIONS..=MAX_MESH_SUBDIVISIONS).contains(&spec.mesh_subdivisions) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "surface deformation meshSubdivisions must be from 4 through 16",
        ));
    }
    validate_envelope(&spec.envelope, spec.mesh_subdivisions)?;
    let (anchors, locked) = validate_anchors(&spec.anchors, spec.mesh_subdivisions)?;
    let stroke_sample_count = validate_strokes(&spec.strokes)?;
    let mut mesh = evaluate_envelope(&spec.envelope, spec.mesh_subdivisions);
    apply_strokes(&mut mesh, &spec.strokes, &locked);
    mesh.validate()?;
    let mesh_spec = MeshWarpSpec {
        schema: crate::MESH_WARP_SCHEMA.to_owned(),
        version: crate::MESH_WARP_VERSION.to_owned(),
        transform: spec.transform.clone(),
        target_size: spec.target_size,
        mesh,
    };
    let mesh_warp = plan_mesh_warp(&mesh_spec)?;
    Ok(SurfaceDeformationPlan {
        schema: SURFACE_DEFORMATION_PLAN_SCHEMA.to_owned(),
        version: SURFACE_DEFORMATION_VERSION.to_owned(),
        spec: spec.clone(),
        mesh_warp,
        anchors,
        stroke_sample_count,
    })
}

fn validate_header(spec: &SurfaceDeformationSpec) -> TransformResult<()> {
    if spec.schema != SURFACE_DEFORMATION_SCHEMA || spec.version != SURFACE_DEFORMATION_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported surface deformation schema or version",
        )
        .with_details(json!({
            "expectedSchema": SURFACE_DEFORMATION_SCHEMA,
            "expectedVersion": SURFACE_DEFORMATION_VERSION,
        })));
    }
    Ok(())
}

fn validate_envelope(envelope: &BezierEnvelope, subdivisions: u16) -> TransformResult<()> {
    if !(1..=MAX_BEZIER_PATCHES_PER_AXIS).contains(&envelope.columns)
        || !(1..=MAX_BEZIER_PATCHES_PER_AXIS).contains(&envelope.rows)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Bezier envelope columns and rows must each be from 1 through 4",
        ));
    }
    if !subdivisions.is_multiple_of(u16::from(envelope.columns))
        || !subdivisions.is_multiple_of(u16::from(envelope.rows))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "meshSubdivisions must be divisible by both Bezier patch counts",
        ));
    }
    let control_columns = usize::from(envelope.columns) * 3 + 1;
    let control_rows = usize::from(envelope.rows) * 3 + 1;
    let expected = control_columns * control_rows;
    if envelope.points.len() != expected || expected > MAX_CONTROL_POINTS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Bezier envelope point count does not match its cubic patch lattice",
        )
        .with_details(json!({ "expected": expected, "actual": envelope.points.len() })));
    }
    for (index, point) in envelope.points.iter().copied().enumerate() {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !(MIN_CONTROL_EXTENT..=MAX_CONTROL_EXTENT).contains(&point.x)
            || !(MIN_CONTROL_EXTENT..=MAX_CONTROL_EXTENT).contains(&point.y)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Bezier envelope points must be finite and remain within [-2,3]",
            ));
        }
        let column = index % control_columns;
        let row = index / control_columns;
        if column == 0 || row == 0 || column + 1 == control_columns || row + 1 == control_rows {
            let expected = Point::new(
                column as f64 / (control_columns - 1) as f64,
                row as f64 / (control_rows - 1) as f64,
            );
            if (point.x - expected.x).abs() > BOUNDARY_EPSILON
                || (point.y - expected.y).abs() > BOUNDARY_EPSILON
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "Bezier envelope boundary controls must remain on the regular unit boundary",
                ));
            }
        }
    }
    Ok(())
}

fn validate_anchors(
    anchors: &[DeformationAnchor],
    subdivisions: u16,
) -> TransformResult<(Vec<ResolvedDeformationAnchor>, Vec<bool>)> {
    if anchors.len() > MAX_DEFORMATION_ANCHORS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "surface deformation cannot exceed 64 anchors",
        ));
    }
    let side = usize::from(subdivisions) + 1;
    let mut ids = HashSet::new();
    let mut vertices = HashSet::new();
    let mut locked = vec![false; side * side];
    let mut resolved = Vec::with_capacity(anchors.len());
    for anchor in anchors {
        validate_id(&anchor.id, "deformation anchor id")?;
        if !ids.insert(anchor.id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation anchor ids must be unique",
            ));
        }
        if anchor.column == 0
            || anchor.row == 0
            || anchor.column >= subdivisions
            || anchor.row >= subdivisions
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation anchors must address an interior mesh vertex",
            ));
        }
        if !vertices.insert((anchor.column, anchor.row)) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation anchors must not repeat a mesh vertex",
            ));
        }
        let index = usize::from(anchor.row) * side + usize::from(anchor.column);
        locked[index] = true;
        resolved.push(ResolvedDeformationAnchor {
            id: anchor.id.clone(),
            column: anchor.column,
            row: anchor.row,
            vertex_index: u16::try_from(index).expect("17 by 17 mesh index fits u16"),
        });
    }
    Ok((resolved, locked))
}

fn validate_strokes(strokes: &[DeformationStroke]) -> TransformResult<usize> {
    if strokes.len() > MAX_DEFORMATION_STROKES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "surface deformation cannot exceed 64 strokes",
        ));
    }
    let mut ids = HashSet::new();
    let mut total = 0_usize;
    for stroke in strokes {
        validate_id(&stroke.id, "deformation stroke id")?;
        if !ids.insert(stroke.id.as_str()) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation stroke ids must be unique",
            ));
        }
        if stroke.samples.is_empty() || stroke.samples.len() > MAX_STROKE_SAMPLES_PER_STROKE {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "each deformation stroke must contain 1..256 samples",
            ));
        }
        total = total.checked_add(stroke.samples.len()).ok_or_else(|| {
            TransformError::new(ErrorCode::Schema, "deformation sample count overflowed")
        })?;
        if total > MAX_DEFORMATION_STROKE_SAMPLES {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "surface deformation cannot exceed 1024 total stroke samples",
            ));
        }
        for sample in &stroke.samples {
            if !point_in_range(sample.position, 0.0, 1.0)
                || !point_in_range(sample.delta, -1.0, 1.0)
                || !sample.radius.is_finite()
                || !(MIN_STROKE_RADIUS..=MAX_STROKE_RADIUS).contains(&sample.radius)
                || !sample.strength.is_finite()
                || !(0.0..=1.0).contains(&sample.strength)
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "deformation stroke samples exceed their finite position, delta, radius, or strength bounds",
                ));
            }
        }
    }
    Ok(total)
}

fn point_in_range(point: Point, minimum: f64, maximum: f64) -> bool {
    point.x.is_finite()
        && point.y.is_finite()
        && (minimum..=maximum).contains(&point.x)
        && (minimum..=maximum).contains(&point.y)
}

fn evaluate_envelope(envelope: &BezierEnvelope, subdivisions: u16) -> WarpMesh {
    let side = usize::from(subdivisions) + 1;
    let mut vertices = Vec::with_capacity(side * side);
    for row in 0..=subdivisions {
        for column in 0..=subdivisions {
            let source = Point::new(
                f64::from(column) / f64::from(subdivisions),
                f64::from(row) / f64::from(subdivisions),
            );
            let boundary = column == 0 || row == 0 || column == subdivisions || row == subdivisions;
            let evaluated = if boundary {
                source
            } else {
                evaluate_bezier(envelope, source)
            };
            let warped = if (evaluated.x - source.x).abs() <= BOUNDARY_EPSILON
                && (evaluated.y - source.y).abs() <= BOUNDARY_EPSILON
            {
                source
            } else {
                evaluated
            };
            vertices.push(WarpVertex { source, warped });
        }
    }
    WarpMesh {
        subdivisions,
        vertices,
    }
}

fn evaluate_bezier(envelope: &BezierEnvelope, source: Point) -> Point {
    let columns = usize::from(envelope.columns);
    let rows = usize::from(envelope.rows);
    let (patch_x, local_x) = patch_coordinate(source.x, columns);
    let (patch_y, local_y) = patch_coordinate(source.y, rows);
    let bx = bernstein(local_x);
    let by = bernstein(local_y);
    let control_columns = columns * 3 + 1;
    let mut result = Point::new(0.0, 0.0);
    for (row, wy) in by.into_iter().enumerate() {
        for (column, wx) in bx.into_iter().enumerate() {
            let index = (patch_y * 3 + row) * control_columns + patch_x * 3 + column;
            let point = envelope.points[index];
            let weight = wx * wy;
            result.x += point.x * weight;
            result.y += point.y * weight;
        }
    }
    result
}

fn patch_coordinate(value: f64, patch_count: usize) -> (usize, f64) {
    if value >= 1.0 {
        return (patch_count - 1, 1.0);
    }
    let scaled = value * patch_count as f64;
    let patch = (scaled.floor() as usize).min(patch_count - 1);
    (patch, scaled - patch as f64)
}

fn bernstein(value: f64) -> [f64; 4] {
    let inverse = 1.0 - value;
    [
        inverse * inverse * inverse,
        3.0 * inverse * inverse * value,
        3.0 * inverse * value * value,
        value * value * value,
    ]
}

fn apply_strokes(mesh: &mut WarpMesh, strokes: &[DeformationStroke], locked: &[bool]) {
    let side = usize::from(mesh.subdivisions) + 1;
    for stroke in strokes {
        for sample in &stroke.samples {
            for row in 1..side - 1 {
                for column in 1..side - 1 {
                    let index = row * side + column;
                    if locked[index] {
                        continue;
                    }
                    let source = mesh.vertices[index].source;
                    let distance =
                        (source.x - sample.position.x).hypot(source.y - sample.position.y);
                    if distance >= sample.radius {
                        continue;
                    }
                    let amount = (1.0 - distance / sample.radius).clamp(0.0, 1.0);
                    let falloff = amount * amount * (3.0 - 2.0 * amount);
                    mesh.vertices[index].warped.x += sample.delta.x * sample.strength * falloff;
                    mesh.vertices[index].warped.y += sample.delta.y * sample.strength * falloff;
                }
            }
        }
    }
}

fn validate_id(value: &str, field: &str) -> TransformResult<()> {
    let valid = !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        });
    if valid {
        Ok(())
    } else {
        Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must match ^[A-Za-z0-9][A-Za-z0-9_-]{{0,63}}$"),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Quad, TransformSpec};

    fn regular_envelope(columns: u8, rows: u8) -> BezierEnvelope {
        let control_columns = usize::from(columns) * 3 + 1;
        let control_rows = usize::from(rows) * 3 + 1;
        let mut points = Vec::with_capacity(control_columns * control_rows);
        for row in 0..control_rows {
            for column in 0..control_columns {
                points.push(Point::new(
                    column as f64 / (control_columns - 1) as f64,
                    row as f64 / (control_rows - 1) as f64,
                ));
            }
        }
        BezierEnvelope {
            columns,
            rows,
            points,
        }
    }

    fn spec() -> SurfaceDeformationSpec {
        SurfaceDeformationSpec {
            schema: SURFACE_DEFORMATION_SCHEMA.to_owned(),
            version: SURFACE_DEFORMATION_VERSION.to_owned(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: Some(Size::new(64.0, 64.0)),
            mesh_subdivisions: 12,
            envelope: regular_envelope(1, 1),
            anchors: Vec::new(),
            strokes: Vec::new(),
        }
    }

    #[test]
    fn identity_bezier_resolves_to_the_canonical_identity_mesh() {
        let plan = plan_surface_deformation(&spec()).unwrap();
        let mesh = &plan.mesh_warp.spec.mesh;
        assert_eq!(mesh.subdivisions, 12);
        assert!(
            mesh.vertices
                .iter()
                .all(|vertex| vertex.source == vertex.warped)
        );
    }

    #[test]
    fn split_bezier_changes_interior_but_not_boundary() {
        let mut spec = spec();
        spec.envelope = regular_envelope(2, 1);
        spec.envelope.points[10].y += 0.08;
        let plan = plan_surface_deformation(&spec).unwrap();
        let mesh = &plan.mesh_warp.spec.mesh;
        assert!(
            mesh.vertices
                .iter()
                .any(|vertex| vertex.source != vertex.warped)
        );
        let side = usize::from(mesh.subdivisions) + 1;
        for (index, vertex) in mesh.vertices.iter().enumerate() {
            let column = index % side;
            let row = index / side;
            if column == 0 || row == 0 || column + 1 == side || row + 1 == side {
                assert_eq!(vertex.source, vertex.warped);
            }
        }
    }

    #[test]
    fn anchors_lock_envelope_positions_while_strokes_replay() {
        let mut spec = spec();
        spec.anchors.push(DeformationAnchor {
            id: "center".to_owned(),
            column: 6,
            row: 6,
        });
        spec.strokes.push(DeformationStroke {
            id: "push".to_owned(),
            samples: vec![StrokeSample {
                position: Point::new(0.5, 0.5),
                delta: Point::new(0.05, 0.0),
                radius: 0.3,
                strength: 1.0,
            }],
        });
        let plan = plan_surface_deformation(&spec).unwrap();
        let mesh = &plan.mesh_warp.spec.mesh;
        assert_eq!(mesh.vertex(6, 6).unwrap().warped, Point::new(0.5, 0.5));
        assert_ne!(
            mesh.vertex(5, 6).unwrap().source,
            mesh.vertex(5, 6).unwrap().warped
        );
        assert_eq!(plan.stroke_sample_count, 1);
        assert_eq!(plan.anchors[0].vertex_index, 84);
    }

    #[test]
    fn rejects_boundary_control_movement_and_folded_strokes() {
        let mut moved_boundary = spec();
        moved_boundary.envelope.points[1].y = 0.1;
        assert_eq!(
            plan_surface_deformation(&moved_boundary).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut folded = spec();
        folded.strokes.push(DeformationStroke {
            id: "fold".to_owned(),
            samples: vec![StrokeSample {
                position: Point::new(0.5, 0.5),
                delta: Point::new(1.0, 0.0),
                radius: 0.25,
                strength: 1.0,
            }],
        });
        assert_eq!(
            plan_surface_deformation(&folded).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn wire_shape_is_closed_and_patch_divisibility_is_enforced() {
        let mut value = serde_json::to_value(spec()).unwrap();
        value["unexpected"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<SurfaceDeformationSpec>(value).is_err());

        let mut indivisible = spec();
        indivisible.mesh_subdivisions = 10;
        indivisible.envelope = regular_envelope(3, 1);
        assert_eq!(
            plan_surface_deformation(&indivisible).unwrap_err().code,
            ErrorCode::Schema
        );

        let sample = StrokeSample {
            position: Point::new(0.5, 0.5),
            delta: Point::new(0.01, 0.0),
            radius: 0.2,
            strength: 1.0,
        };
        let mut too_many_samples = spec();
        too_many_samples.strokes = (0..5)
            .map(|index| DeformationStroke {
                id: format!("stroke-{index}"),
                samples: vec![sample; MAX_STROKE_SAMPLES_PER_STROKE],
            })
            .collect();
        assert_eq!(
            plan_surface_deformation(&too_many_samples)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }
}

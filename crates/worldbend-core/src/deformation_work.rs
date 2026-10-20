use crate::liquify::{LiquifyControls, apply_liquify, liquify_sample_count, validate_liquify};
use crate::surface_deformation::{SurfaceDeformationControls, resolve_surface_controls};
use crate::{
    ErrorCode, MeshWarpPlan, MeshWarpSpec, Point, ResolvedDeformationAnchor, ShapeFitControls,
    ShapeFitResolution, Size, SurfaceDeformationSpec, TransformError, TransformResult,
    TransformSpec, WarpMesh, WarpVertex, plan_mesh_warp, plan_surface_deformation,
    resolve_shape_fit,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const DEFORMATION_WORK_SCHEMA: &str = "worldbend.deformation-work";
pub const DEFORMATION_WORK_PLAN_SCHEMA: &str = "worldbend.deformation-work-plan";
pub const DEFORMATION_WORK_MIGRATION_SCHEMA: &str = "worldbend.deformation-work-migration";
pub const DEFORMATION_WORK_VERSION: &str = "0.1";
pub const MAX_DEFORMATION_WORK_MESH_EDITS: usize = 289;
pub const MIN_DEFORMATION_WORK_WARPED_EXTENT: f64 = -2.0;
pub const MAX_DEFORMATION_WORK_WARPED_EXTENT: f64 = 3.0;

const MIN_WORK_SUBDIVISIONS: u16 = 2;
const MAX_WORK_SUBDIVISIONS: u16 = 16;
const MIN_SURFACE_SUBDIVISIONS: u16 = 4;
const MESH_WARP_SOURCE_SCHEMA: &str = "worldbend.mesh-warp";
const MESH_WARP_SOURCE_VERSION: &str = "0.1";
const SURFACE_SOURCE_SCHEMA: &str = "worldbend.surface-deformation";
const SURFACE_SOURCE_VERSION: &str = "0.1";

fn spec_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": DEFORMATION_WORK_SCHEMA })
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": DEFORMATION_WORK_PLAN_SCHEMA })
}
fn migration_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": DEFORMATION_WORK_MIGRATION_SCHEMA })
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": DEFORMATION_WORK_VERSION })
}
fn default_subdivisions() -> u16 {
    12
}
/// One replayable deformation work. The `transform` owns the outer plane, the
/// optional `surface` controls are the Pin view, and `mesh_edits` are explicit
/// Mesh-view vertex placements. Resolution replays the pin phases first, then
/// applies mesh edits, so an explicit later edit wins over an anchored or
/// brushed position at the same vertex.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkSpec {
    #[schemars(schema_with = "spec_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub transform: TransformSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_size: Option<Size>,
    #[serde(default = "default_subdivisions")]
    #[schemars(range(min = 2, max = 16))]
    pub mesh_subdivisions: u16,
    /// Fixed keeps the original rectangular boundary; free retains authored outline controls.
    #[serde(default, skip_serializing_if = "crate::MeshBoundary::is_fixed")]
    pub boundary: crate::MeshBoundary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface: Option<SurfaceDeformationControls>,
    /// Typed brush-only Liquify controls (`worldbend.liquify@0.1`), replayed
    /// after the surface phases and before explicit mesh edits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub liquify: Option<LiquifyControls>,
    /// Replayable boundary fitting is applied after the authored interior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape_fit: Option<ShapeFitControls>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 289))]
    pub mesh_edits: Vec<MeshVertexEdit>,
}
/// One explicit Mesh-view placement. Fixed work accepts interior vertices;
/// free work also retains authored corners and edge vertices.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshVertexEdit {
    #[schemars(range(min = 0, max = 16))]
    pub column: u16,
    #[schemars(range(min = 0, max = 16))]
    pub row: u16,
    pub warped: Point,
}
/// The Pin-view projection of a planned work: resolved anchors, the replayed
/// stroke-sample count, and the mesh the pin phases resolved to before any
/// mesh edits were applied. Editors read pin positions from this mesh so
/// adapters never re-derive deformation geometry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkPinView {
    #[schemars(length(max = 64))]
    pub anchors: Vec<ResolvedDeformationAnchor>,
    #[schemars(range(max = 1024))]
    pub stroke_sample_count: usize,
    pub resolved_mesh: WarpMesh,
}

/// Editors keep their regular interior control grid; the fitted mesh is a
/// separate projection over that state, never a replacement for its recipe.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkShapeFitView {
    pub fit: ShapeFitResolution,
    pub interior_mesh: WarpMesh,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub spec: DeformationWorkSpec,
    pub mesh_warp: MeshWarpPlan,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authored_view: Option<crate::AuthoredMeshView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pin_view: Option<DeformationWorkPinView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_fit_view: Option<DeformationWorkShapeFitView>,
    /// Compound mask projected by the core into normalized reference-canvas
    /// coordinates. The original curves stay in spec.shapeFit.clip.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clip: Option<crate::MockupClipPlan>,
    /// The mesh the replay reached after the Pin phases and Liquify, before
    /// any explicit mesh edit. Mesh-view editors measure new vertex
    /// placements against this baseline so Liquify displacement is never
    /// baked into edits, and adapters never re-derive that geometry.
    pub mesh_edit_baseline: WarpMesh,
    #[schemars(range(max = 1024))]
    pub liquify_sample_count: usize,
    #[schemars(range(max = 289))]
    pub mesh_edit_count: usize,
}
/// One supported source contract for migrating persisted state into the
/// deformation-work container.
#[derive(Debug, Clone, PartialEq)]
pub enum DeformationWorkSourceSpec {
    MeshWarp(Box<MeshWarpSpec>),
    SurfaceDeformation(Box<SurfaceDeformationSpec>),
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkMigration {
    #[schemars(schema_with = "migration_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub source_schema: String,
    pub source_version: String,
    pub work: DeformationWorkSpec,
    pub plan: DeformationWorkPlan,
}
pub fn plan_deformation_work(spec: &DeformationWorkSpec) -> TransformResult<DeformationWorkPlan> {
    if spec.schema != DEFORMATION_WORK_SCHEMA || spec.version != DEFORMATION_WORK_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported deformation work schema or version",
        )
        .with_details(json!({
            "expectedSchema": DEFORMATION_WORK_SCHEMA,
            "expectedVersion": DEFORMATION_WORK_VERSION,
        })));
    }
    if spec.transform.content.warp.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "deformation work transform must not also contain a preset Warp",
        ));
    }
    let minimum = if spec.surface.is_some() {
        MIN_SURFACE_SUBDIVISIONS
    } else {
        MIN_WORK_SUBDIVISIONS
    };
    if !(minimum..=MAX_WORK_SUBDIVISIONS).contains(&spec.mesh_subdivisions) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            if spec.surface.is_some() {
                "deformation work meshSubdivisions must be from 4 through 16 when surface controls are present"
            } else {
                "deformation work meshSubdivisions must be from 2 through 16"
            },
        ));
    }
    validate_mesh_edits(&spec.mesh_edits, spec.mesh_subdivisions, spec.boundary)?;
    if let Some(controls) = &spec.liquify {
        validate_liquify(controls)
            .map_err(|message| TransformError::new(ErrorCode::Schema, message))?;
    }
    let side = usize::from(spec.mesh_subdivisions) + 1;
    let (mut mesh, pin_view, locked) = match &spec.surface {
        Some(controls) => {
            let resolution =
                resolve_surface_controls(controls, spec.mesh_subdivisions, spec.boundary)?;
            let mut locked = vec![false; resolution.mesh.vertices.len()];
            for anchor in &resolution.anchors {
                let index = usize::from(anchor.row) * side + usize::from(anchor.column);
                if let Some(slot) = locked.get_mut(index) {
                    *slot = true;
                }
            }
            let pin_view = DeformationWorkPinView {
                anchors: resolution.anchors,
                stroke_sample_count: resolution.stroke_sample_count,
                resolved_mesh: resolution.mesh.clone(),
            };
            (resolution.mesh, Some(pin_view), locked)
        }
        None => (
            identity_mesh(spec.mesh_subdivisions),
            None,
            vec![false; side * side],
        ),
    };
    mesh.boundary = spec.boundary;
    // Liquify replays after the pin phases and before explicit mesh edits,
    // with anchored vertices protected exactly as they are from pin strokes.
    if let Some(controls) = &spec.liquify {
        apply_liquify(&mut mesh, controls, &locked);
    }
    let mesh_edit_baseline = mesh.clone();
    for edit in &spec.mesh_edits {
        let index = usize::from(edit.row) * side + usize::from(edit.column);
        mesh.vertices[index].warped = edit.warped;
    }
    crate::authored_mesh::validate_authored_mesh(&mesh, "deformation work")?;
    let shape_fit_view = match &spec.shape_fit {
        Some(controls) => {
            let fit = resolve_shape_fit(controls)?;
            let interior_mesh = mesh;
            mesh = crate::shape_fit_composition::compose_shape_fit(&interior_mesh, &fit.mesh)?;
            Some(DeformationWorkShapeFitView { fit, interior_mesh })
        }
        None => None,
    };
    let (mesh_warp, authored_view) =
        crate::authored_mesh::plan_authored_mesh(&spec.transform, spec.target_size, mesh)?;
    let clip = spec
        .shape_fit
        .as_ref()
        .and_then(|fit| fit.clip.as_ref())
        .map(|clip| {
            crate::project_deformation_clip(
                clip,
                mesh_warp.solve.homography.matrix,
                mesh_warp.solve.resolved_destination.reference,
            )
        })
        .transpose()?;
    Ok(DeformationWorkPlan {
        schema: DEFORMATION_WORK_PLAN_SCHEMA.to_owned(),
        version: DEFORMATION_WORK_VERSION.to_owned(),
        spec: spec.clone(),
        mesh_warp,
        authored_view,
        pin_view,
        shape_fit_view,
        clip,
        mesh_edit_baseline,
        liquify_sample_count: spec.liquify.as_ref().map(liquify_sample_count).unwrap_or(0),
        mesh_edit_count: spec.mesh_edits.len(),
    })
}
pub fn migrate_deformation_work(
    source: &DeformationWorkSourceSpec,
) -> TransformResult<DeformationWorkMigration> {
    let (source_schema, source_version, work) = match source {
        DeformationWorkSourceSpec::MeshWarp(spec) => {
            plan_mesh_warp(spec)?;
            (
                MESH_WARP_SOURCE_SCHEMA,
                MESH_WARP_SOURCE_VERSION,
                work_from_mesh_warp(spec)?,
            )
        }
        DeformationWorkSourceSpec::SurfaceDeformation(spec) => {
            plan_surface_deformation(spec)?;
            (
                SURFACE_SOURCE_SCHEMA,
                SURFACE_SOURCE_VERSION,
                work_from_surface_deformation(spec),
            )
        }
    };
    let plan = plan_deformation_work(&work)?;
    verify_migration_equivalence(source, &plan)?;
    Ok(DeformationWorkMigration {
        schema: DEFORMATION_WORK_MIGRATION_SCHEMA.to_owned(),
        version: DEFORMATION_WORK_VERSION.to_owned(),
        source_schema: source_schema.to_owned(),
        source_version: source_version.to_owned(),
        work,
        plan,
    })
}
fn work_from_mesh_warp(spec: &MeshWarpSpec) -> TransformResult<DeformationWorkSpec> {
    let subdivisions = spec.mesh.grid_subdivisions().ok_or_else(|| TransformError::new(
        ErrorCode::Schema, "indexed shape geometry must retain its shape recipe; it cannot be migrated into an authored edit grid",
    ))?;
    let side = usize::from(subdivisions) + 1;
    let mut mesh_edits = Vec::new();
    for (index, vertex) in spec.mesh.vertices.iter().enumerate() {
        let column = index % side;
        let row = index / side;
        if spec.mesh.boundary == crate::MeshBoundary::Fixed
            && (column == 0
                || row == 0
                || column == usize::from(subdivisions)
                || row == usize::from(subdivisions))
        {
            continue;
        }
        if vertex.warped == vertex.source {
            continue;
        }
        if !vertex.warped.x.is_finite()
            || !vertex.warped.y.is_finite()
            || !(MIN_DEFORMATION_WORK_WARPED_EXTENT..=MAX_DEFORMATION_WORK_WARPED_EXTENT)
                .contains(&vertex.warped.x)
            || !(MIN_DEFORMATION_WORK_WARPED_EXTENT..=MAX_DEFORMATION_WORK_WARPED_EXTENT)
                .contains(&vertex.warped.y)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mesh warp interior vertex exceeds the deformation work warped extent [-2,3]; move the vertex into range before migrating",
            )
            .with_details(json!({
                "column": column,
                "row": row,
                "minimum": MIN_DEFORMATION_WORK_WARPED_EXTENT,
                "maximum": MAX_DEFORMATION_WORK_WARPED_EXTENT,
            })));
        }
        mesh_edits.push(MeshVertexEdit {
            column: u16::try_from(column).expect("interior column fits u16"),
            row: u16::try_from(row).expect("interior row fits u16"),
            warped: vertex.warped,
        });
    }
    Ok(DeformationWorkSpec {
        boundary: spec.mesh.boundary,
        schema: DEFORMATION_WORK_SCHEMA.to_owned(),
        version: DEFORMATION_WORK_VERSION.to_owned(),
        transform: spec.transform.clone(),
        target_size: spec.target_size,
        mesh_subdivisions: subdivisions,
        surface: None,
        liquify: None,
        shape_fit: None,
        mesh_edits,
    })
}
fn work_from_surface_deformation(spec: &SurfaceDeformationSpec) -> DeformationWorkSpec {
    DeformationWorkSpec {
        boundary: spec.boundary,
        schema: DEFORMATION_WORK_SCHEMA.to_owned(),
        version: DEFORMATION_WORK_VERSION.to_owned(),
        transform: spec.transform.clone(),
        target_size: spec.target_size,
        mesh_subdivisions: spec.mesh_subdivisions,
        surface: Some(SurfaceDeformationControls {
            envelope: spec.envelope.clone(),
            anchors: spec.anchors.clone(),
            strokes: spec.strokes.clone(),
        }),
        liquify: None,
        shape_fit: None,
        mesh_edits: Vec::new(),
    }
}
fn verify_migration_equivalence(
    source: &DeformationWorkSourceSpec,
    plan: &DeformationWorkPlan,
) -> TransformResult<()> {
    match source {
        DeformationWorkSourceSpec::MeshWarp(spec) => {
            if plan.mesh_warp.spec.mesh != spec.mesh {
                return Err(TransformError::new(
                    ErrorCode::Internal,
                    "mesh warp migration resolved a different mesh",
                ));
            }
        }
        DeformationWorkSourceSpec::SurfaceDeformation(spec) => {
            let expected = plan_surface_deformation(spec)?;
            if plan.mesh_warp != expected.mesh_warp {
                return Err(TransformError::new(
                    ErrorCode::Internal,
                    "surface deformation migration resolved a different canonical mesh plan",
                ));
            }
        }
    }
    Ok(())
}
fn validate_mesh_edits(
    edits: &[MeshVertexEdit],
    subdivisions: u16,
    boundary: crate::MeshBoundary,
) -> TransformResult<()> {
    let free = boundary == crate::MeshBoundary::Free;
    let maximum = if free {
        MAX_DEFORMATION_WORK_MESH_EDITS
    } else {
        225
    };
    if edits.len() > maximum {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("deformation work cannot exceed {maximum} mesh edits"),
        ));
    }
    let mut vertices = HashSet::new();
    for edit in edits {
        if edit.column > subdivisions || edit.row > subdivisions {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation work mesh edits must address a valid vertex",
            ));
        }
        if !free
            && (edit.column == 0
                || edit.row == 0
                || edit.column == subdivisions
                || edit.row == subdivisions)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation work fixed boundaries require an interior mesh edit vertex",
            ));
        }
        if !vertices.insert((edit.column, edit.row)) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation work mesh edits must not repeat a mesh vertex",
            ));
        }
        if !edit.warped.x.is_finite()
            || !edit.warped.y.is_finite()
            || !(MIN_DEFORMATION_WORK_WARPED_EXTENT..=MAX_DEFORMATION_WORK_WARPED_EXTENT)
                .contains(&edit.warped.x)
            || !(MIN_DEFORMATION_WORK_WARPED_EXTENT..=MAX_DEFORMATION_WORK_WARPED_EXTENT)
                .contains(&edit.warped.y)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "deformation work mesh edits must be finite and remain within [-2,3]",
            ));
        }
    }
    Ok(())
}
fn identity_mesh(subdivisions: u16) -> WarpMesh {
    let mut vertices = Vec::with_capacity(usize::from(subdivisions + 1).pow(2));
    for row in 0..=subdivisions {
        for column in 0..=subdivisions {
            let source = Point::new(
                f64::from(column) / f64::from(subdivisions),
                f64::from(row) / f64::from(subdivisions),
            );
            vertices.push(WarpVertex {
                source,
                warped: source,
            });
        }
    }
    WarpMesh {
        boundary: Default::default(),
        shading: None,
        topology: crate::WarpMeshTopology::Grid { subdivisions },
        vertices,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::liquify::{LiquifyControls, LiquifyMode, LiquifySample, LiquifyStroke};
    use crate::{
        BezierEnvelope, DeformationAnchor, DeformationStroke, MESH_WARP_SCHEMA, MESH_WARP_VERSION,
        Quad, SURFACE_DEFORMATION_SCHEMA, SURFACE_DEFORMATION_VERSION, StrokeSample,
    };

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
    fn deformed_envelope() -> BezierEnvelope {
        let mut envelope = regular_envelope(2, 2);
        for index in [17, 23, 26, 31, 32, 37, 40] {
            envelope.points[index].x += 0.04;
            envelope.points[index].y -= 0.03;
        }
        envelope
    }
    fn work() -> DeformationWorkSpec {
        DeformationWorkSpec {
            boundary: Default::default(),
            schema: DEFORMATION_WORK_SCHEMA.to_owned(),
            version: DEFORMATION_WORK_VERSION.to_owned(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: Some(Size::new(64.0, 64.0)),
            mesh_subdivisions: 8,
            surface: None,
            liquify: None,
            shape_fit: None,
            mesh_edits: Vec::new(),
        }
    }
    #[test]
    fn shape_fitting_replays_the_existing_work_without_baking_its_interior() {
        let mut value = surface_work();
        value.liquify = Some(LiquifyControls {
            strokes: vec![crate::LiquifyStroke {
                id: "fit-brush".to_owned(),
                mode: crate::LiquifyMode::Push,
                samples: vec![crate::LiquifySample {
                    position: Point::new(0.4, 0.4),
                    radius: 0.2,
                    strength: 0.05,
                    delta: Some(Point::new(0.01, 0.0)),
                }],
            }],
        });
        value.mesh_edits = vec![MeshVertexEdit {
            column: 5,
            row: 5,
            warped: Point::new(0.42, 0.42),
        }];
        let interior = plan_deformation_work(&value).unwrap();
        value.shape_fit = Some(ShapeFitControls {
            contour: crate::MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: [
                    (1.0, 0.0),
                    (1.0, 0.3333333333333333),
                    (0.6875, 0.3333333333333333),
                    (0.6875, 1.0),
                    (0.0, 1.0),
                ]
                .into_iter()
                .map(|(x, y)| crate::MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .collect(),
            },
            clip: None,
            corner_positions: None,
            refinement: None,
        });
        let fitted = plan_deformation_work(&value).unwrap();
        let view = fitted.shape_fit_view.as_ref().unwrap();
        assert_eq!(view.interior_mesh, interior.mesh_warp.spec.mesh);
        assert_eq!(fitted.pin_view, interior.pin_view);
        assert_eq!(fitted.mesh_edit_baseline, interior.mesh_edit_baseline);
        assert_eq!(fitted.mesh_edit_count, 1);
        assert_eq!(fitted.liquify_sample_count, 1);
        assert!(fitted.mesh_warp.spec.mesh.grid_subdivisions().is_none());
        let reopened: DeformationWorkSpec =
            serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
        assert_eq!(plan_deformation_work(&reopened).unwrap(), fitted);
        let mut moved = value.clone();
        moved.transform.destination.quad = Quad::new(
            Point::new(0.1, 0.1),
            Point::new(0.9, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 0.9),
        );
        let continued = plan_deformation_work(&moved).unwrap();
        assert_eq!(continued.mesh_warp.spec.mesh, fitted.mesh_warp.spec.mesh);
        assert_eq!(continued.shape_fit_view, fitted.shape_fit_view);
    }
    fn surface_work() -> DeformationWorkSpec {
        let mut value = work();
        value.mesh_subdivisions = 12;
        value.surface = Some(SurfaceDeformationControls {
            envelope: deformed_envelope(),
            anchors: vec![DeformationAnchor {
                id: "center".to_owned(),
                column: 6,
                row: 6,
            }],
            strokes: vec![DeformationStroke {
                id: "push".to_owned(),
                samples: vec![StrokeSample {
                    position: Point::new(0.35, 0.4),
                    delta: Point::new(0.02, -0.01),
                    radius: 0.2,
                    strength: 1.0,
                }],
            }],
        });
        value
    }
    fn surface_spec_from_work(value: &DeformationWorkSpec) -> SurfaceDeformationSpec {
        let surface = value.surface.as_ref().unwrap();
        SurfaceDeformationSpec {
            boundary: value.boundary,
            schema: SURFACE_DEFORMATION_SCHEMA.to_owned(),
            version: SURFACE_DEFORMATION_VERSION.to_owned(),
            transform: value.transform.clone(),
            target_size: value.target_size,
            mesh_subdivisions: value.mesh_subdivisions,
            envelope: surface.envelope.clone(),
            anchors: surface.anchors.clone(),
            strokes: surface.strokes.clone(),
        }
    }
    fn moved_mesh(subdivisions: u16) -> crate::WarpMesh {
        let mut mesh = identity_mesh(subdivisions);
        let side = usize::from(subdivisions) + 1;
        mesh.vertices[side + 1].warped = Point::new(0.2, 0.2);
        mesh.vertices[side * 2 + 2].warped = Point::new(0.4, 0.4);
        mesh
    }
    #[test]
    fn empty_work_resolves_to_the_identity_mesh_over_its_plane() {
        let mut value = work();
        value.mesh_subdivisions = 2;
        let plan = plan_deformation_work(&value).unwrap();
        assert_eq!(plan.mesh_warp.spec.mesh, identity_mesh(2));
        assert_eq!(plan.mesh_edit_count, 0);
        assert!(plan.pin_view.is_none());
    }
    #[test]
    fn surface_work_matches_the_surface_contract_exactly() {
        let value = surface_work();
        let plan = plan_deformation_work(&value).unwrap();
        let expected = plan_surface_deformation(&surface_spec_from_work(&value)).unwrap();
        assert_eq!(plan.mesh_warp, expected.mesh_warp);
        let pin_view = plan.pin_view.as_ref().unwrap();
        assert_eq!(pin_view.anchors, expected.anchors);
        assert_eq!(pin_view.stroke_sample_count, expected.stroke_sample_count);
        assert_eq!(pin_view.resolved_mesh, expected.mesh_warp.spec.mesh);
    }
    #[test]
    fn mesh_edits_replay_after_the_pin_phases_and_win_at_anchored_vertices() {
        let mut value = surface_work();
        value.mesh_edits = vec![MeshVertexEdit {
            column: 6,
            row: 6,
            warped: Point::new(0.52, 0.5),
        }];
        let plan = plan_deformation_work(&value).unwrap();
        let mesh = &plan.mesh_warp.spec.mesh;
        assert_eq!(mesh.vertex(6, 6).unwrap().warped, Point::new(0.52, 0.5));
        let pin_view = plan.pin_view.as_ref().unwrap();
        // The pin view still reports the anchored pre-edit position.
        assert_eq!(
            pin_view.resolved_mesh.vertex(6, 6).unwrap().warped,
            Point::new(0.5, 0.5)
        );
        // Outside the edited vertex the two views agree.
        assert_eq!(
            pin_view.resolved_mesh.vertex(4, 6).unwrap(),
            mesh.vertex(4, 6).unwrap()
        );
        assert_eq!(plan.mesh_edit_count, 1);
    }
    #[test]
    fn plane_view_edits_preserve_the_interior_deformation() {
        let mut value = surface_work();
        value.transform = TransformSpec::pixel(
            Size::new(100.0, 80.0),
            Quad::new(
                Point::new(10.0, 5.0),
                Point::new(90.0, 0.0),
                Point::new(100.0, 75.0),
                Point::new(5.0, 80.0),
            ),
        );
        let before = plan_deformation_work(&surface_work()).unwrap();
        let after = plan_deformation_work(&value).unwrap();
        assert_eq!(
            before.mesh_warp.spec.mesh, after.mesh_warp.spec.mesh,
            "plane edits must not disturb the normalized interior deformation"
        );
        assert_ne!(before.mesh_warp.solve, after.mesh_warp.solve);
    }
    #[test]
    fn migration_from_mesh_warp_is_vertex_exact() {
        let spec = MeshWarpSpec {
            schema: MESH_WARP_SCHEMA.to_owned(),
            version: MESH_WARP_VERSION.to_owned(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: Some(Size::new(32.0, 32.0)),
            mesh: moved_mesh(4),
        };
        let migration =
            migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(Box::new(spec.clone())))
                .unwrap();
        assert_eq!(migration.source_schema, "worldbend.mesh-warp");
        assert_eq!(migration.work.mesh_subdivisions, 4);
        assert_eq!(migration.work.mesh_edits.len(), 2);
        assert!(migration.work.surface.is_none());
        assert_eq!(migration.plan.mesh_warp.spec.mesh, spec.mesh);
        assert_eq!(migration.plan.mesh_warp, plan_mesh_warp(&spec).unwrap());
    }
    #[test]
    fn migration_from_surface_deformation_is_plan_exact() {
        let work = surface_work();
        let spec = surface_spec_from_work(&work);
        let migration = migrate_deformation_work(&DeformationWorkSourceSpec::SurfaceDeformation(
            Box::new(spec.clone()),
        ))
        .unwrap();
        assert_eq!(migration.source_schema, "worldbend.surface-deformation");
        assert!(migration.work.mesh_edits.is_empty());
        assert_eq!(
            migration.plan.mesh_warp,
            plan_surface_deformation(&spec).unwrap().mesh_warp
        );
    }
    #[test]
    fn migration_rejects_out_of_extent_mesh_vertices_without_clamping() {
        let mut mesh = moved_mesh(4);
        let side = 5_usize;
        mesh.vertices[side * 3 + 3].warped = Point::new(5.0, 0.5);
        let spec = MeshWarpSpec {
            schema: MESH_WARP_SCHEMA.to_owned(),
            version: MESH_WARP_VERSION.to_owned(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: None,
            mesh,
        };
        let error = migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(Box::new(spec)))
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }
    #[test]
    fn rejects_invalid_works_with_stable_schema_errors() {
        let mut header = work();
        header.schema = "worldbend.other".to_owned();
        assert_eq!(
            plan_deformation_work(&header).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut preset = work();
        preset.transform.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.5,
        });
        assert_eq!(
            plan_deformation_work(&preset).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut thin = work();
        thin.mesh_subdivisions = 2;
        thin.surface = Some(SurfaceDeformationControls {
            envelope: regular_envelope(1, 1),
            anchors: Vec::new(),
            strokes: Vec::new(),
        });
        assert_eq!(
            plan_deformation_work(&thin).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut boundary_edit = work();
        boundary_edit.mesh_edits = vec![MeshVertexEdit {
            column: 0,
            row: 4,
            warped: Point::new(0.5, 0.5),
        }];
        assert_eq!(
            plan_deformation_work(&boundary_edit).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut duplicate = work();
        duplicate.mesh_edits = vec![
            MeshVertexEdit {
                column: 2,
                row: 2,
                warped: Point::new(0.3, 0.3),
            },
            MeshVertexEdit {
                column: 2,
                row: 2,
                warped: Point::new(0.4, 0.4),
            },
        ];
        assert_eq!(
            plan_deformation_work(&duplicate).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut extent = work();
        extent.mesh_edits = vec![MeshVertexEdit {
            column: 2,
            row: 2,
            warped: Point::new(3.5, 0.5),
        }];
        assert_eq!(
            plan_deformation_work(&extent).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut beyond_density = work();
        beyond_density.mesh_subdivisions = 8;
        beyond_density.mesh_edits = vec![MeshVertexEdit {
            column: 8,
            row: 4,
            warped: Point::new(0.5, 0.5),
        }];
        assert_eq!(
            plan_deformation_work(&beyond_density).unwrap_err().code,
            ErrorCode::Schema
        );

        let mut folded = work();
        folded.mesh_subdivisions = 4;
        folded.mesh_edits = vec![
            MeshVertexEdit {
                column: 1,
                row: 1,
                warped: Point::new(1.5, 1.5),
            },
            MeshVertexEdit {
                column: 2,
                row: 2,
                warped: Point::new(-0.5, -0.5),
            },
        ];
        let error = plan_deformation_work(&folded).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(
            error.message,
            "deformation work folds or collapses the bounded mesh"
        );
    }
    #[test]
    fn wire_shape_is_closed() {
        let mut value = serde_json::to_value(work()).unwrap();
        value["unexpected"] = serde_json::Value::Bool(true);
        assert!(serde_json::from_value::<DeformationWorkSpec>(value).is_err());

        let serialized = serde_json::to_value(surface_work()).unwrap();
        assert!(serialized.get("meshEdits").is_none());
        let parsed: DeformationWorkSpec = serde_json::from_value(serialized).unwrap();
        assert_eq!(parsed, surface_work());
    }
    #[test]
    fn planning_is_deterministic_across_repeated_views() {
        let mut value = surface_work();
        value.mesh_edits = vec![MeshVertexEdit {
            column: 3,
            row: 3,
            warped: Point::new(0.28, 0.27),
        }];
        let first = plan_deformation_work(&value).unwrap();
        let second = plan_deformation_work(&value).unwrap();
        assert_eq!(first, second);
    }
    fn liquify_work(mode: LiquifyMode, samples: Vec<LiquifySample>) -> DeformationWorkSpec {
        let mut value = work();
        value.mesh_subdivisions = 4;
        value.liquify = Some(LiquifyControls {
            strokes: vec![LiquifyStroke {
                id: "brush".to_owned(),
                mode,
                samples,
            }],
        });
        value
    }
    fn center_samples() -> Vec<LiquifySample> {
        vec![sample_with(
            Point::new(0.5, 0.5),
            Some(Point::new(0.05, 0.0)),
        )]
    }

    fn sample_with(position: Point, delta: Option<Point>) -> LiquifySample {
        LiquifySample {
            position,
            delta,
            radius: 0.3,
            strength: 1.0,
        }
    }
    #[test]
    fn liquify_push_displaces_interior_vertices_with_the_shared_falloff() {
        let value = liquify_work(LiquifyMode::Push, center_samples());
        let plan = plan_deformation_work(&value).unwrap();
        let mesh = &plan.mesh_warp.spec.mesh;
        // The exact center vertex (0.5, 0.5) sits on the sample position.
        let side = usize::from(value.mesh_subdivisions) + 1;
        let center = &mesh.vertices[side * 2 + 2];
        assert!((center.warped.x - 0.55).abs() < 1e-12);
        assert_eq!(center.warped.y, 0.5);
        // A vertex outside the radius never moves.
        let corner_inside = &mesh.vertices[side + 1];
        let distance = (corner_inside.source.x - 0.5).hypot(corner_inside.source.y - 0.5);
        assert!(
            distance >= 0.3
                || corner_inside.warped == corner_inside.source
                || corner_inside.warped.x > corner_inside.source.x
        );
        let far = &mesh.vertices[0];
        assert_eq!(far.warped, far.source);
        assert_eq!(plan.liquify_sample_count, 1);
    }
    #[test]
    fn liquify_bloat_pucker_and_twirl_move_radially_not_translationally() {
        let samples = vec![sample_with(Point::new(0.5, 0.5), None)];
        let bloat =
            plan_deformation_work(&liquify_work(LiquifyMode::Bloat, samples.clone())).unwrap();
        let pucker =
            plan_deformation_work(&liquify_work(LiquifyMode::Pucker, samples.clone())).unwrap();
        let twirl =
            plan_deformation_work(&liquify_work(LiquifyMode::Twirl, samples.clone())).unwrap();
        // Sample a vertex off-center at (0.5, 0.25): radial is straight down.
        let side = 5;
        let index = side + 2;
        let source = bloat.mesh_warp.spec.mesh.vertices[index].source;
        assert_eq!(source, Point::new(0.5, 0.25));
        let bloat_vertex = bloat.mesh_warp.spec.mesh.vertices[index].warped;
        let pucker_vertex = pucker.mesh_warp.spec.mesh.vertices[index].warped;
        let twirl_vertex = twirl.mesh_warp.spec.mesh.vertices[index].warped;
        // Bloat pushes away from (0.5, 0.5): toward smaller y here.
        assert!(bloat_vertex.y < source.y - 1e-6);
        assert!((bloat_vertex.x - source.x).abs() < 1e-9);
        // Pucker is its exact mirror.
        assert!((bloat_vertex.y - source.y + (pucker_vertex.y - source.y)).abs() < 1e-12);
        // Twirl moves perpendicular: horizontally.
        assert!((twirl_vertex.x - source.x).abs() > 1e-6);
        assert!((twirl_vertex.y - source.y).abs() < 1e-9);
        // The sample center itself never moves in radial modes.
        let center = bloat.mesh_warp.spec.mesh.vertices[side * 2 + 2].warped;
        assert_eq!(center, Point::new(0.5, 0.5));
    }
    #[test]
    fn liquify_replays_in_order_after_surface_and_before_mesh_edits() {
        let mut value = surface_work();
        value.mesh_subdivisions = 12;
        value.liquify = Some(LiquifyControls {
            strokes: vec![LiquifyStroke {
                id: "b".to_owned(),
                mode: LiquifyMode::Push,
                samples: vec![LiquifySample {
                    position: Point::new(0.3, 0.3),
                    delta: Some(Point::new(0.05, 0.0)),
                    radius: 0.1,
                    strength: 1.0,
                }],
            }],
        });
        // An explicit mesh edit at the anchored center still wins.
        value.mesh_edits = vec![MeshVertexEdit {
            column: 6,
            row: 6,
            warped: Point::new(0.5, 0.5),
        }];
        let plan = plan_deformation_work(&value).unwrap();
        let side = 13;
        let center = plan.mesh_warp.spec.mesh.vertices[side * 6 + 6].warped;
        assert_eq!(center, Point::new(0.5, 0.5));
        assert_eq!(plan.liquify_sample_count, 1);
        // The pin view still projects only the surface controls.
        let pin_mesh = plan.pin_view.as_ref().unwrap().resolved_mesh.clone();
        let with_liquify_only = {
            let mut probe = value.clone();
            probe.mesh_edits = Vec::new();
            plan_deformation_work(&probe)
                .unwrap()
                .mesh_warp
                .spec
                .mesh
                .clone()
        };
        assert_ne!(pin_mesh, with_liquify_only);
        // The mesh-edit baseline measures after Liquify and before the edit.
        assert_eq!(plan.mesh_edit_baseline.vertices, with_liquify_only.vertices);
    }
    #[test]
    fn mesh_edit_baseline_measures_after_liquify_and_before_edits() {
        // Mesh-view editors measure new vertex placements against the baseline
        // the replay reached after Liquify, so a view switch never bakes
        // Liquify displacement into explicit mesh edits.
        let mut value = liquify_work(LiquifyMode::Push, center_samples());
        value.mesh_edits = vec![MeshVertexEdit {
            column: 1,
            row: 3,
            warped: Point::new(0.4, 0.7),
        }];
        let plan = plan_deformation_work(&value).unwrap();
        let side = 5;
        // The baseline carries the Liquify displacement at the pushed center.
        assert_eq!(
            plan.mesh_edit_baseline.vertices[side * 2 + 2].warped,
            Point::new(0.55, 0.5)
        );
        // The edited vertex sits at its pre-edit replay position there.
        assert_eq!(
            plan.mesh_edit_baseline.vertices[side * 3 + 1].warped,
            plan.mesh_edit_baseline.vertices[side * 3 + 1].source
        );
        // The final mesh carries the explicit edit exactly.
        assert_eq!(
            plan.mesh_warp.spec.mesh.vertices[side * 3 + 1].warped,
            Point::new(0.4, 0.7)
        );
        // Without surface controls the baseline is the identity mesh.
        let mut plain = value.clone();
        plain.liquify = None;
        let plain_plan = plan_deformation_work(&plain).unwrap();
        assert!(plain_plan.pin_view.is_none());
        assert!(
            plain_plan
                .mesh_edit_baseline
                .vertices
                .iter()
                .all(|vertex| vertex.warped == vertex.source)
        );
    }
    #[test]
    fn liquify_respects_surface_anchors() {
        // A bloat stroke centered exactly on the anchored center vertex of
        // surface_work must leave that vertex untouched while moving a neighbor.
        let mut value = surface_work();
        value.mesh_subdivisions = 12;
        value.liquify = Some(LiquifyControls {
            strokes: vec![LiquifyStroke {
                id: "bloat-center".to_owned(),
                mode: LiquifyMode::Bloat,
                samples: vec![LiquifySample {
                    position: Point::new(0.5, 0.5),
                    delta: None,
                    radius: 0.2,
                    strength: 1.0,
                }],
            }],
        });
        let plan = plan_deformation_work(&value).unwrap();
        let side = 13;
        let anchored = plan.mesh_warp.spec.mesh.vertices[side * 6 + 6];
        // The anchored vertex keeps whatever the surface phases placed there.
        let pin_mesh = plan.pin_view.as_ref().unwrap().resolved_mesh.clone();
        assert_eq!(anchored.warped, pin_mesh.vertices[side * 6 + 6].warped);
        let neighbor = plan.mesh_warp.spec.mesh.vertices[side * 6 + 5].warped;
        let pin_neighbor = pin_mesh.vertices[side * 6 + 5].warped;
        assert!(
            neighbor != pin_neighbor,
            "neighbor must receive the liquify displacement"
        );
    }
    #[test]
    fn liquify_rejects_bound_and_mode_violations() {
        let samples = center_samples();
        let cases: Vec<(DeformationWorkSpec, &str)> = vec![
            (
                liquify_work(LiquifyMode::Bloat, {
                    let mut s = samples.clone();
                    s[0].delta = Some(Point::new(0.1, 0.0));
                    s
                }),
                "delta outside push mode",
            ),
            (
                liquify_work(LiquifyMode::Push, {
                    let mut s = samples.clone();
                    s[0].delta = None;
                    s
                }),
                "push without delta",
            ),
            (
                liquify_work(LiquifyMode::Push, {
                    let mut s = samples.clone();
                    s[0].delta = Some(Point::new(2.0, 0.0));
                    s
                }),
                "delta beyond [-1, 1]",
            ),
            (
                liquify_work(LiquifyMode::Push, {
                    let mut s = samples.clone();
                    s[0].radius = 3.0;
                    s
                }),
                "radius beyond 2.0",
            ),
            (
                liquify_work(LiquifyMode::Push, {
                    let mut s = samples.clone();
                    s[0].position = Point::new(1.5, 0.5);
                    s
                }),
                "position outside [0, 1]",
            ),
            (
                liquify_work(LiquifyMode::Push, {
                    let mut s = samples.clone();
                    s[0].strength = 1.5;
                    s
                }),
                "strength beyond 1.0",
            ),
        ];
        for (value, label) in cases {
            let error = plan_deformation_work(&value).unwrap_err();
            assert_eq!(error.code, ErrorCode::Schema, "{label}");
            assert!(
                error.message.contains("liquify"),
                "{label}: {}",
                error.message
            );
        } // Stroke count and duplicate ids follow the family bounds.
        let mut value = work();
        value.liquify = Some(LiquifyControls {
            strokes: (0..65)
                .map(|index| LiquifyStroke {
                    id: format!("s-{index}"),
                    mode: LiquifyMode::Push,
                    samples: vec![LiquifySample {
                        position: Point::new(0.5, 0.5),
                        delta: Some(Point::new(0.01, 0.0)),
                        radius: 0.1,
                        strength: 0.5,
                    }],
                })
                .collect(),
        });
        assert!(
            plan_deformation_work(&value)
                .unwrap_err()
                .message
                .contains("64 strokes")
        );
        let mut duplicated = work();
        duplicated.liquify = Some(LiquifyControls {
            strokes: vec![
                LiquifyStroke {
                    id: "same".to_owned(),
                    mode: LiquifyMode::Twirl,
                    samples: vec![LiquifySample {
                        position: Point::new(0.5, 0.5),
                        delta: None,
                        radius: 0.1,
                        strength: 0.5,
                    }],
                },
                LiquifyStroke {
                    id: "same".to_owned(),
                    mode: LiquifyMode::Twirl,
                    samples: vec![LiquifySample {
                        position: Point::new(0.4, 0.5),
                        delta: None,
                        radius: 0.1,
                        strength: 0.5,
                    }],
                },
            ],
        });
        assert!(
            plan_deformation_work(&duplicated)
                .unwrap_err()
                .message
                .contains("unique")
        );
    }
    #[test]
    fn liquify_planning_is_deterministic_and_serializes_round_trip() {
        let value = liquify_work(
            LiquifyMode::Twirl,
            vec![sample_with(Point::new(0.5, 0.5), None)],
        );
        let first = plan_deformation_work(&value).unwrap();
        let second = plan_deformation_work(&value).unwrap();
        assert_eq!(first, second);
        let parsed: DeformationWorkSpec =
            serde_json::from_str(&serde_json::to_string(&value).unwrap()).unwrap();
        assert_eq!(parsed, value);
        // An empty liquify block is valid and changes nothing.
        let mut empty = work();
        empty.liquify = Some(LiquifyControls {
            strokes: Vec::new(),
        });
        let plan = plan_deformation_work(&empty).unwrap();
        assert_eq!(
            plan.mesh_warp.spec.mesh,
            identity_mesh(empty.mesh_subdivisions)
        );
        assert_eq!(plan.liquify_sample_count, 0);
    }
}

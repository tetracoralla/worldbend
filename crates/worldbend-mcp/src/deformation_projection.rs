//! Explicit MCP projection of a canonical deformation plan. The state view
//! retains the complete recipe and resolved output metadata without transmitting
//! generated editing meshes. Geometry and rendering still use the full core plan.
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use worldbend_core::{
    DeformationWorkPlan, DeformationWorkSpec, Point, SolveOutput, WarpMeshTopology,
};
use worldbend_render::{
    DeformationWorkFileRenderResult, FileRenderStatus, RenderDiagnostics, RenderEvidence,
};

#[derive(Debug, Default, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PlanView {
    #[default]
    Full,
    State,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub(crate) enum PlanOutput {
    Full(Box<DeformationWorkPlan>),
    State(Box<StatePlan>),
}

fn state_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.deformation-work-summary"})
}
fn state_version(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"0.1"})
}
fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"integer","minimum":0,"maximum":9_007_199_254_740_991_u64})
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct FitSummary {
    corner_positions: [f64; 4],
    #[schemars(range(min = 1, max = 2))]
    refinement: u8,
    #[schemars(range(min = 1, max = 16000))]
    iterations: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct StatePlan {
    #[schemars(schema_with = "state_schema")]
    schema: String,
    #[schemars(schema_with = "state_version")]
    version: String,
    spec: DeformationWorkSpec,
    solve: SolveOutput,
    #[serde(skip_serializing_if = "Option::is_none")]
    canvas_origin: Option<Point>,
    #[schemars(range(min = 4, max = 2048))]
    vertex_count: usize,
    #[schemars(range(min = 2, max = 4096))]
    triangle_count: usize,
    #[schemars(range(max = 289))]
    mesh_edit_count: usize,
    #[schemars(range(max = 1024))]
    liquify_sample_count: usize,
    #[schemars(range(max = 64))]
    pin_anchor_count: usize,
    #[schemars(range(max = 1024))]
    pin_stroke_sample_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    shape_fit: Option<FitSummary>,
}

pub(crate) fn project_plan(plan: DeformationWorkPlan, view: PlanView) -> PlanOutput {
    match view {
        PlanView::Full => PlanOutput::Full(Box::new(plan)),
        PlanView::State => {
            let mesh = &plan.mesh_warp.spec.mesh;
            let triangle_count = match &mesh.topology {
                WarpMeshTopology::Grid { subdivisions } => usize::from(*subdivisions).pow(2) * 2,
                WarpMeshTopology::Triangles { triangles } => triangles.len(),
            };
            PlanOutput::State(Box::new(StatePlan {
                schema: "worldbend.deformation-work-summary".to_owned(),
                version: "0.1".to_owned(),
                vertex_count: mesh.vertices.len(),
                triangle_count,
                mesh_edit_count: plan.mesh_edit_count,
                liquify_sample_count: plan.liquify_sample_count,
                pin_anchor_count: plan.pin_view.as_ref().map_or(0, |v| v.anchors.len()),
                pin_stroke_sample_count: plan
                    .pin_view
                    .as_ref()
                    .map_or(0, |v| v.stroke_sample_count),
                shape_fit: plan.shape_fit_view.map(|v| FitSummary {
                    corner_positions: v.fit.corner_positions,
                    refinement: v.fit.refinement,
                    iterations: v.fit.iterations,
                }),
                spec: plan.spec,
                canvas_origin: plan.authored_view.map(|view| view.canvas_origin),
                solve: plan.mesh_warp.solve,
            }))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RenderOutput {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub plan: PlanOutput,
    pub diagnostics: RenderDiagnostics,
}

impl RenderOutput {
    pub(crate) fn from_core(result: DeformationWorkFileRenderResult, view: PlanView) -> Self {
        Self {
            status: result.status,
            dry_run: result.dry_run,
            output: result.output,
            bytes: result.bytes,
            evidence: result.evidence,
            plan: project_plan(result.plan, view),
            diagnostics: result.diagnostics,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use worldbend_core::{Point, plan_deformation_work};

    #[test]
    fn state_view_preserves_the_complete_recipe_and_shared_output_metadata() {
        let spec: DeformationWorkSpec = serde_json::from_value(json!({
            "schema":"worldbend.deformation-work", "version":"0.1",
            "transform":worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
            "targetSize":{"width":320,"height":360}, "meshSubdivisions":12,
            "shapeFit":{"contour":{"start":Point::new(0.0,0.0),"segments":[
                {"kind":"line","to":Point::new(1.0,0.0)},
                {"kind":"line","to":Point::new(0.8,1.0)},
                {"kind":"line","to":Point::new(0.0,1.0)}
            ]}},
            "meshEdits":[{"column":6,"row":6,"warped":Point::new(0.52,0.49)}]
        }))
        .unwrap();
        let plan = plan_deformation_work(&spec).unwrap();
        let full = serde_json::to_value(project_plan(plan.clone(), PlanView::Full)).unwrap();
        assert_eq!(full, serde_json::to_value(&plan).unwrap());
        let state = serde_json::to_value(project_plan(plan.clone(), PlanView::State)).unwrap();
        assert_eq!(state["schema"], "worldbend.deformation-work-summary");
        assert_eq!(state["spec"], serde_json::to_value(&spec).unwrap());
        assert_eq!(
            state["solve"],
            serde_json::to_value(&plan.mesh_warp.solve).unwrap()
        );
        assert_eq!(
            state["vertexCount"],
            plan.mesh_warp.spec.mesh.vertices.len()
        );
        assert_eq!(
            state["shapeFit"]["cornerPositions"],
            serde_json::to_value(plan.shape_fit_view.unwrap().fit.corner_positions).unwrap()
        );
        assert!(state.get("meshWarp").is_none());
        assert!(serde_json::to_vec(&state).unwrap().len() < 16_384);
    }
    #[test]
    fn state_view_carries_every_free_grid_edit_and_advertises_the_core_capacity() {
        let edits: Vec<_> = (0..17)
            .flat_map(|row| {
                (0..17).map(move |column| json!({
            "column":column,"row":row,"warped":{"x":f64::from(column)/16.0,"y":f64::from(row)/16.0}
        }))
            })
            .collect();
        let spec: DeformationWorkSpec = serde_json::from_value(json!({
            "schema":"worldbend.deformation-work","version":"0.1","boundary":"free",
            "transform":worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
            "meshSubdivisions":16,"meshEdits":edits
        }))
        .unwrap();
        let state = serde_json::to_value(project_plan(
            plan_deformation_work(&spec).unwrap(),
            PlanView::State,
        ))
        .unwrap();
        assert_eq!(state["meshEditCount"], 289);
        assert_eq!(state["spec"], serde_json::to_value(spec).unwrap());
        let schema = serde_json::to_value(schemars::schema_for!(StatePlan)).unwrap();
        assert_eq!(
            schema["properties"]["meshEditCount"]["maximum"],
            worldbend_core::MAX_DEFORMATION_WORK_MESH_EDITS
        );
    }

    #[test]
    fn state_view_retains_the_expanded_canvas_origin_without_echoing_authoring_meshes() {
        let spec: DeformationWorkSpec = serde_json::from_value(json!({
            "schema":"worldbend.deformation-work","version":"0.1","boundary":"free",
            "transform":worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
            "targetSize":{"width":200,"height":100},"meshSubdivisions":4,
            "meshEdits":[{"column":2,"row":0,"warped":{"x":0.5,"y":-0.2}}]
        }))
        .unwrap();
        let state = serde_json::to_value(project_plan(
            plan_deformation_work(&spec).unwrap(),
            PlanView::State,
        ))
        .unwrap();
        assert_eq!(state["canvasOrigin"], json!({"x":0.0,"y":-20.0}));
        assert_eq!(
            state["solve"]["resolvedDestination"]["reference"],
            json!({"width":200.0,"height":120.0})
        );
        assert!(state.get("authoredView").is_none());
        assert_eq!(state["spec"], serde_json::to_value(spec).unwrap());
    }
}

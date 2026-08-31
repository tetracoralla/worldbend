use crate::{
    ErrorCode, Size, SolveOutput, TransformError, TransformResult, TransformSpec, WarpMesh,
    solve_spec,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const MESH_WARP_SCHEMA: &str = "worldbend.mesh-warp";
pub const MESH_WARP_PLAN_SCHEMA: &str = "worldbend.mesh-warp-plan";
pub const MESH_WARP_VERSION: &str = "0.1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshWarpSpec {
    pub schema: String,
    pub version: String,
    pub transform: TransformSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_size: Option<Size>,
    pub mesh: WarpMesh,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshWarpPlan {
    pub schema: String,
    pub version: String,
    pub spec: MeshWarpSpec,
    pub solve: SolveOutput,
}

pub fn plan_mesh_warp(spec: &MeshWarpSpec) -> TransformResult<MeshWarpPlan> {
    if spec.schema != MESH_WARP_SCHEMA || spec.version != MESH_WARP_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported mesh warp schema or version",
        )
        .with_details(json!({
            "expectedSchema": MESH_WARP_SCHEMA,
            "expectedVersion": MESH_WARP_VERSION,
        })));
    }
    if spec.transform.content.warp.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mesh warp transform must not also contain a preset Warp",
        ));
    }
    spec.mesh.validate()?;
    let solve = solve_spec(&spec.transform, spec.target_size)?;
    Ok(MeshWarpPlan {
        schema: MESH_WARP_PLAN_SCHEMA.to_owned(),
        version: MESH_WARP_VERSION.to_owned(),
        spec: spec.clone(),
        solve,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Point, Quad, WarpVertex};

    fn identity(subdivisions: u16) -> WarpMesh {
        let mut vertices = Vec::new();
        for y in 0..=subdivisions {
            for x in 0..=subdivisions {
                let point = Point::new(
                    f64::from(x) / f64::from(subdivisions),
                    f64::from(y) / f64::from(subdivisions),
                );
                vertices.push(WarpVertex {
                    source: point,
                    warped: point,
                });
            }
        }
        WarpMesh {
            subdivisions,
            vertices,
        }
    }

    #[test]
    fn plans_custom_three_by_three_through_seventeen_by_seventeen_meshes() {
        for subdivisions in [2, 4, 16] {
            let spec = MeshWarpSpec {
                schema: MESH_WARP_SCHEMA.to_owned(),
                version: MESH_WARP_VERSION.to_owned(),
                transform: TransformSpec::normalized(Quad::unit()),
                target_size: Some(Size::new(100.0, 50.0)),
                mesh: identity(subdivisions),
            };
            let plan = plan_mesh_warp(&spec).unwrap();
            assert_eq!(plan.spec.mesh.subdivisions, subdivisions);
            assert_eq!(
                plan.solve.resolved_destination.reference,
                Size::new(100.0, 50.0)
            );
        }
    }

    #[test]
    fn rejects_folded_mesh_and_double_warp_semantics() {
        let mut folded = identity(2);
        folded.vertices[4].warped = Point::new(1.0, 1.0);
        let mut spec = MeshWarpSpec {
            schema: MESH_WARP_SCHEMA.to_owned(),
            version: MESH_WARP_VERSION.to_owned(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: Some(Size::new(100.0, 50.0)),
            mesh: folded,
        };
        assert_eq!(plan_mesh_warp(&spec).unwrap_err().code, ErrorCode::Schema);
        spec.mesh = identity(2);
        spec.transform.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.5,
        });
        assert_eq!(plan_mesh_warp(&spec).unwrap_err().code, ErrorCode::Schema);
    }
}

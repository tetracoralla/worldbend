use crate::{
    FileRenderStatus, MeshWarpFileRenderResult, MeshWarpRenderOptions, RenderDiagnostics,
    RenderEvidence, RenderedMeshWarp, render_mesh_warp_file_with_cancel,
    render_mesh_warp_with_cancel,
};
use image::{DynamicImage, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::path::Path;
use worldbend_core::{
    ErrorCode, SurfaceDeformationPlan, SurfaceDeformationSpec, TransformError, TransformResult,
    plan_surface_deformation,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug)]
pub struct RenderedSurfaceDeformation {
    pub image: RgbaImage,
    pub plan: SurfaceDeformationPlan,
    pub diagnostics: RenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SurfaceDeformationFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub plan: SurfaceDeformationPlan,
    pub diagnostics: RenderDiagnostics,
}

pub fn render_surface_deformation(
    source: &DynamicImage,
    spec: &SurfaceDeformationSpec,
    options: MeshWarpRenderOptions,
) -> TransformResult<RenderedSurfaceDeformation> {
    render_surface_deformation_with_cancel(source, spec, options, &|| false)
}

pub fn render_surface_deformation_with_cancel(
    source: &DynamicImage,
    spec: &SurfaceDeformationSpec,
    options: MeshWarpRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedSurfaceDeformation> {
    let plan = plan_surface_deformation(spec)?;
    let rendered =
        render_mesh_warp_with_cancel(source, &plan.mesh_warp.spec, options, is_cancelled)?;
    verify_mesh_plan(&plan, &rendered)?;
    Ok(RenderedSurfaceDeformation {
        image: rendered.image,
        plan,
        diagnostics: rendered.diagnostics,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn render_surface_deformation_file_with_cancel(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &SurfaceDeformationSpec,
    output: &Path,
    options: MeshWarpRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<SurfaceDeformationFileRenderResult> {
    let plan = plan_surface_deformation(spec)?;
    let rendered = render_mesh_warp_file_with_cancel(
        source,
        known_source_sha256,
        &plan.mesh_warp.spec,
        output,
        options,
        overwrite,
        dry_run,
        is_cancelled,
    )?;
    if rendered.plan != plan.mesh_warp {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "surface deformation renderer returned a different mesh plan",
        ));
    }
    Ok(map_file_result(rendered, plan))
}

fn verify_mesh_plan(
    plan: &SurfaceDeformationPlan,
    rendered: &RenderedMeshWarp,
) -> TransformResult<()> {
    if rendered.plan != plan.mesh_warp {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "surface deformation renderer returned a different mesh plan",
        ));
    }
    Ok(())
}

fn map_file_result(
    rendered: MeshWarpFileRenderResult,
    plan: SurfaceDeformationPlan,
) -> SurfaceDeformationFileRenderResult {
    SurfaceDeformationFileRenderResult {
        status: rendered.status,
        dry_run: rendered.dry_run,
        output: rendered.output,
        bytes: rendered.bytes,
        evidence: rendered.evidence,
        plan,
        diagnostics: rendered.diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    use worldbend_core::{
        BezierEnvelope, DeformationStroke, Point, Quad, SURFACE_DEFORMATION_SCHEMA,
        SURFACE_DEFORMATION_VERSION, Size, StrokeSample, TransformSpec,
    };

    fn envelope() -> BezierEnvelope {
        BezierEnvelope {
            columns: 1,
            rows: 1,
            points: (0..4)
                .flat_map(|row| {
                    (0..4).map(move |column| {
                        Point::new(f64::from(column) / 3.0, f64::from(row) / 3.0)
                    })
                })
                .collect(),
        }
    }

    fn spec(strokes: Vec<DeformationStroke>) -> SurfaceDeformationSpec {
        SurfaceDeformationSpec {
            schema: SURFACE_DEFORMATION_SCHEMA.to_owned(),
            version: SURFACE_DEFORMATION_VERSION.to_owned(),
            transform: TransformSpec::pixel(
                Size::new(8.0, 8.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(8.0, 0.0),
                    Point::new(8.0, 8.0),
                    Point::new(0.0, 8.0),
                ),
            ),
            target_size: None,
            mesh_subdivisions: 4,
            envelope: envelope(),
            anchors: Vec::new(),
            strokes,
        }
    }

    #[test]
    fn identity_is_byte_identical_and_an_ordered_stroke_changes_pixels() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(8, 8, |x, y| {
            Rgba([(x * 20) as u8, (y * 20) as u8, 30, 255])
        }));
        let identity =
            render_surface_deformation(&source, &spec(Vec::new()), Default::default()).unwrap();
        assert_eq!(identity.image, source.to_rgba8());
        let moved = render_surface_deformation(
            &source,
            &spec(vec![DeformationStroke {
                id: "push".to_owned(),
                samples: vec![StrokeSample {
                    position: Point::new(0.5, 0.5),
                    delta: Point::new(0.08, 0.0),
                    radius: 0.3,
                    strength: 1.0,
                }],
            }]),
            Default::default(),
        )
        .unwrap();
        assert_ne!(moved.image, identity.image);
        assert_eq!(moved.plan.stroke_sample_count, 1);
    }

    #[test]
    fn cancellation_leaves_no_file() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, Rgba([1, 2, 3, 255])))
            .save(&source)
            .unwrap();
        let output = root.path().join("output.png");
        let error = render_surface_deformation_file_with_cancel(
            &source,
            None,
            &spec(Vec::new()),
            &output,
            Default::default(),
            false,
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }
}

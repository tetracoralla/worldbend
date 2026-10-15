use crate::{
    FileRenderStatus, MeshWarpRenderOptions, RenderDiagnostics, RenderEvidence, RenderedMeshWarp,
    render_mesh_warp_with_cancel,
};
use image::{DynamicImage, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::path::Path;
use worldbend_core::{
    DeformationWorkPlan, DeformationWorkSpec, ErrorCode, TransformError, TransformResult,
    plan_deformation_work,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug)]
pub struct RenderedDeformationWork {
    pub image: RgbaImage,
    pub plan: DeformationWorkPlan,
    pub diagnostics: RenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DeformationWorkFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub plan: DeformationWorkPlan,
    pub diagnostics: RenderDiagnostics,
}

pub fn render_deformation_work(
    source: &DynamicImage,
    spec: &DeformationWorkSpec,
    options: MeshWarpRenderOptions,
) -> TransformResult<RenderedDeformationWork> {
    render_deformation_work_with_cancel(source, spec, options, &|| false)
}

pub fn render_deformation_work_with_cancel(
    source: &DynamicImage,
    spec: &DeformationWorkSpec,
    options: MeshWarpRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedDeformationWork> {
    let plan = plan_deformation_work(spec)?;
    let mut rendered =
        render_mesh_warp_with_cancel(source, &plan.mesh_warp.spec, options, is_cancelled)?;
    verify_plan(&plan, &rendered)?;
    apply_work_clip(
        &mut rendered.image,
        &rendered.diagnostics,
        &plan,
        is_cancelled,
    )?;
    Ok(RenderedDeformationWork {
        image: rendered.image,
        plan,
        diagnostics: rendered.diagnostics,
    })
}

/// Render the complete planned reference canvas at independently chosen pixel
/// dimensions. A Figma HD snapshot keeps its authoring coordinates when its
/// pixel density changes; neither the saved work nor its plan is rewritten.
pub fn render_deformation_work_reference_with_cancel(
    source: &DynamicImage,
    spec: &DeformationWorkSpec,
    output: worldbend_core::PixelSize,
    options: MeshWarpRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedDeformationWork> {
    let plan = plan_deformation_work(spec)?;
    let reference = plan.mesh_warp.solve.resolved_destination.reference;
    let mut transform = plan.mesh_warp.spec.transform.clone();
    transform.destination = worldbend_core::Destination {
        space: worldbend_core::CoordinateSpace::Normalized,
        reference: None,
        quad: plan
            .mesh_warp
            .solve
            .resolved_destination
            .quad
            .map(|p| worldbend_core::Point::new(p.x / reference.width, p.y / reference.height)),
    };
    let raster = worldbend_core::Size::new(f64::from(output.width), f64::from(output.height));
    let mut rendered = crate::render_rgba_image_with_custom_mesh(
        source.to_rgba8(),
        &transform,
        crate::RenderOptions {
            source_view: None,
            quality: options.quality,
            canvas: crate::CanvasMode::Reference,
            target_size: Some(raster),
            limits: options.limits,
        },
        plan.mesh_warp.spec.mesh.clone(),
        is_cancelled,
    )?
    .rendered;
    if let Some(clip) = &plan.clip {
        crate::clip_mask::apply_clip_mask_in_frame(
            &mut rendered.image,
            clip,
            raster,
            worldbend_core::Point::new(0.0, 0.0),
            is_cancelled,
        )?;
    }
    Ok(RenderedDeformationWork {
        image: rendered.image,
        plan,
        diagnostics: rendered.diagnostics,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn render_deformation_work_file_with_cancel(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &DeformationWorkSpec,
    output: &Path,
    options: MeshWarpRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<DeformationWorkFileRenderResult> {
    let plan = plan_deformation_work(spec)?;
    let rendered = crate::deform::render_mesh_warp_file_with_postprocess(
        source,
        known_source_sha256,
        &plan.mesh_warp.spec,
        output,
        options,
        overwrite,
        dry_run,
        is_cancelled,
        &|image, diagnostics| apply_work_clip(image, diagnostics, &plan, is_cancelled),
    )?;
    if rendered.plan != plan.mesh_warp {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "deformation work renderer returned a different mesh plan",
        ));
    }
    Ok(DeformationWorkFileRenderResult {
        status: rendered.status,
        dry_run: rendered.dry_run,
        output: rendered.output,
        bytes: rendered.bytes,
        evidence: rendered.evidence,
        plan,
        diagnostics: rendered.diagnostics,
    })
}

fn apply_work_clip(
    image: &mut RgbaImage,
    diagnostics: &RenderDiagnostics,
    plan: &DeformationWorkPlan,
    is_cancelled: &dyn Fn() -> bool,
) -> TransformResult<()> {
    if let Some(clip) = &plan.clip {
        crate::clip_mask::apply_clip_mask_in_frame(
            image,
            clip,
            plan.mesh_warp.solve.resolved_destination.reference,
            diagnostics.placement.origin,
            is_cancelled,
        )?;
    }
    Ok(())
}

fn verify_plan(plan: &DeformationWorkPlan, rendered: &RenderedMeshWarp) -> TransformResult<()> {
    if rendered.plan != plan.mesh_warp {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "deformation work renderer returned a different mesh plan",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    use worldbend_core::{
        BezierEnvelope, DEFORMATION_WORK_SCHEMA, DEFORMATION_WORK_VERSION, DeformationAnchor,
        DeformationStroke, DeformationWorkSourceSpec, MESH_WARP_SCHEMA, MESH_WARP_VERSION,
        MeshVertexEdit, MeshWarpSpec, Point, Quad, SURFACE_DEFORMATION_SCHEMA,
        SURFACE_DEFORMATION_VERSION, Size, StrokeSample, SurfaceDeformationControls,
        SurfaceDeformationSpec, TransformSpec, WarpMesh, WarpVertex, migrate_deformation_work,
    };

    fn gradient(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |x, y| {
            Rgba([
                (x * 255 / width.max(1)) as u8,
                (y * 255 / height.max(1)) as u8,
                90,
                255,
            ])
        }))
    }

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

    fn deformed_envelope() -> BezierEnvelope {
        let mut value = envelope();
        value.points[5].x += 0.05;
        value.points[6].y -= 0.04;
        value
    }

    fn work_spec() -> DeformationWorkSpec {
        DeformationWorkSpec {
            boundary: Default::default(),
            schema: DEFORMATION_WORK_SCHEMA.to_owned(),
            version: DEFORMATION_WORK_VERSION.to_owned(),
            transform: TransformSpec::pixel(
                Size::new(96.0, 96.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(96.0, 0.0),
                    Point::new(96.0, 96.0),
                    Point::new(0.0, 96.0),
                ),
            ),
            target_size: None,
            shape_fit: None,
            mesh_subdivisions: 6,
            surface: Some(SurfaceDeformationControls {
                envelope: deformed_envelope(),
                anchors: vec![DeformationAnchor {
                    id: "hold".to_owned(),
                    column: 4,
                    row: 4,
                }],
                strokes: vec![DeformationStroke {
                    id: "push".to_owned(),
                    samples: vec![StrokeSample {
                        position: Point::new(0.4, 0.4),
                        delta: Point::new(0.03, 0.0),
                        radius: 0.25,
                        strength: 1.0,
                    }],
                }],
            }),
            liquify: None,
            mesh_edits: vec![MeshVertexEdit {
                column: 2,
                row: 2,
                warped: Point::new(0.36, 0.34),
            }],
        }
    }

    fn moved_mesh() -> WarpMesh {
        let subdivisions = 6_u16;
        let side = usize::from(subdivisions) + 1;
        let mut vertices = Vec::new();
        for row in 0..=subdivisions {
            for column in 0..=subdivisions {
                let point = Point::new(
                    f64::from(column) / f64::from(subdivisions),
                    f64::from(row) / f64::from(subdivisions),
                );
                vertices.push(WarpVertex {
                    source: point,
                    warped: point,
                });
            }
        }
        vertices[side * 3 + 3].warped = Point::new(0.56, 0.5);
        vertices[side * 2 + 2].warped = Point::new(0.36, 0.34);
        WarpMesh {
            boundary: Default::default(),
            shading: None,
            topology: worldbend_core::WarpMeshTopology::Grid { subdivisions },
            vertices,
        }
    }

    #[test]
    fn reference_pixels_preserve_the_authored_plan_and_scale_the_complete_clip() {
        let spec:DeformationWorkSpec=serde_json::from_value(serde_json::json!({
            "schema":"worldbend.deformation-work","version":"0.1","transform":TransformSpec::normalized(Quad::unit()),
            "targetSize":{"width":32,"height":24},"boundary":"free","meshSubdivisions":4,
            "meshEdits":[{"column":2,"row":0,"warped":{"x":0.5,"y":-0.25}},
                {"column":2,"row":4,"warped":{"x":0.5,"y":1.25}}]
        })).unwrap();
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(32, 24, |x, _| {
            Rgba(if x < 16 {
                [255, 0, 0, 255]
            } else {
                [0, 0, 255, 255]
            })
        }));
        let output = render_deformation_work_reference_with_cancel(
            &source,
            &spec,
            worldbend_core::PixelSize::new(64, 72),
            Default::default(),
            &|| false,
        )
        .unwrap();
        assert_eq!(output.plan, plan_deformation_work(&spec).unwrap());
        assert_eq!(output.image.dimensions(), (64, 72));
        assert_eq!(output.image.get_pixel(16, 36).0, [255, 0, 0, 255]);
        assert_eq!(output.image.get_pixel(48, 36).0, [0, 0, 255, 255]);
        assert_eq!(output.image.get_pixel(0, 0).0[3], 0);
        let clipped = render_deformation_work_reference_with_cancel(
            &source,
            &holed_fit(),
            worldbend_core::PixelSize::new(192, 288),
            Default::default(),
            &|| false,
        )
        .unwrap();
        assert_eq!(clipped.image.get_pixel(28, 202).0[3], 0);
        assert_eq!(clipped.image.get_pixel(48, 187).0[3], 255);
        assert_eq!(clipped.image.get_pixel(163, 187).0[3], 0);
        assert_eq!(clipped.image.get_pixel(10, 10).0[3], 255);
        assert_eq!(
            render_deformation_work_reference_with_cancel(
                &source,
                &spec,
                worldbend_core::PixelSize::new(64, 72),
                Default::default(),
                &|| true
            )
            .unwrap_err()
            .code,
            ErrorCode::Cancelled
        );
        for size in [
            worldbend_core::PixelSize::new(0, 72),
            worldbend_core::PixelSize::new(u32::MAX, u32::MAX),
        ] {
            assert!(
                render_deformation_work_reference_with_cancel(
                    &source,
                    &spec,
                    size,
                    Default::default(),
                    &|| false
                )
                .is_err()
            );
        }
    }

    #[test]
    fn fitted_work_renders_deformed_content_and_preserves_the_recipe_on_replacement() {
        let mut spec = work_spec();
        spec.surface = None;
        spec.mesh_edits.clear();
        spec.shape_fit = Some(worldbend_core::ShapeFitControls {
            contour: worldbend_core::MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: [
                    (1.0, 0.0),
                    (1.0, 1.0 / 3.0),
                    (0.6875, 1.0 / 3.0),
                    (0.6875, 1.0),
                    (0.0, 1.0),
                ]
                .into_iter()
                .map(|(x, y)| worldbend_core::MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .collect(),
            },
            clip: None,
            corner_positions: None,
            refinement: None,
        });
        let before = spec.clone();
        let output =
            render_deformation_work(&gradient(512, 512), &spec, MeshWarpRenderOptions::default())
                .unwrap();
        assert_eq!(output.image.dimensions(), (96, 96));
        assert_eq!(output.image.get_pixel(82, 65)[3], 0);
        assert_eq!(output.image.get_pixel(26, 65)[3], 255);
        // The fit redistributes source content; it does not merely clip the
        // ordinary plane's gradient at the outline.
        // Compare against the same source and plane, rather than coordinates
        // from a prototype triangulation. The lower arm receives the image's
        // right edge, so an interior gradient sample must move visibly right.
        let mut plane_spec = spec.clone();
        plane_spec.shape_fit = None;
        let plane = render_deformation_work(
            &gradient(512, 512),
            &plane_spec,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        let fitted_red = i16::from(output.image.get_pixel(40, 65)[0]);
        let plane_red = i16::from(plane.image.get_pixel(40, 65)[0]);
        assert!(
            fitted_red - plane_red > 15,
            "outline fitting must redistribute content: fitted red={fitted_red}, plane red={plane_red}"
        );
        let replacement = render_deformation_work(
            &gradient(1024, 768),
            &spec,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        assert_eq!(replacement.plan, output.plan);
        assert_eq!(spec, before);
        let direct = crate::render_mesh_warp(
            &gradient(512, 512),
            &output.plan.mesh_warp.spec,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        assert_eq!(output.image, direct.image);
    }

    fn holed_fit() -> DeformationWorkSpec {
        use worldbend_core::{
            MockupClip, MockupClipContour, MockupClipFillRule, MockupClipRegion, MockupClipSegment,
            ShapeFitControls,
        };
        let contour = |points: &[(f64, f64)]| MockupClipContour {
            start: Point::new(points[0].0, points[0].1),
            segments: points[1..]
                .iter()
                .map(|&(x, y)| MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .collect(),
        };
        let outer = contour(&[
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, 1.0 / 3.0),
            (0.6875, 1.0 / 3.0),
            (0.6875, 1.0),
            (0.0, 1.0),
        ]);
        let mut work = work_spec();
        work.surface = None;
        work.mesh_edits.clear();
        work.shape_fit = Some(ShapeFitControls {
            contour: outer.clone(),
            corner_positions: None,
            refinement: None,
            clip: Some(MockupClip {
                contours: vec![
                    outer,
                    contour(&[(0.1, 0.55), (0.4, 0.55), (0.4, 0.8), (0.1, 0.8)]),
                    contour(&[(0.2, 0.6), (0.3, 0.6), (0.3, 0.7), (0.2, 0.7)]),
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
            }),
        });
        work
    }

    #[test]
    fn fitted_work_keeps_holes_and_region_union_in_a_translated_tight_canvas() {
        let mut work = holed_fit();
        work.transform = TransformSpec::pixel(
            Size::new(192.0, 192.0),
            Quad::new(
                Point::new(-20.0, 15.0),
                Point::new(76.0, 15.0),
                Point::new(76.0, 111.0),
                Point::new(-20.0, 111.0),
            ),
        );
        let source = gradient(512, 512);
        let rendered =
            render_deformation_work(&source, &work, MeshWarpRenderOptions::default()).unwrap();
        assert_eq!(
            rendered.diagnostics.placement.origin,
            Point::new(-20.0, 15.0)
        );
        assert_eq!(rendered.image.dimensions(), (96, 96));
        assert_eq!(
            rendered.image.get_pixel(14, 60)[3],
            0,
            "same-winding EVENODD hole stays transparent"
        );
        assert_eq!(
            rendered.image.get_pixel(24, 62)[3],
            255,
            "independent fill restores its part of the hole"
        );
        assert_eq!(rendered.image.get_pixel(55, 62)[3], 255);
        assert_eq!(
            rendered.image.get_pixel(85, 62)[3],
            0,
            "concave notch remains empty"
        );
        let replacement = render_deformation_work(
            &gradient(1024, 768),
            &work,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        assert_eq!(replacement.plan, rendered.plan);
        assert_eq!(replacement.image.get_pixel(14, 60)[3], 0);
        assert_eq!(replacement.image.get_pixel(24, 62)[3], 255);
        let mut translucent = source.to_rgba8();
        for pixel in translucent.pixels_mut() {
            pixel[3] = 128;
        }
        let translucent = render_deformation_work(
            &DynamicImage::ImageRgba8(translucent),
            &work,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        let unmasked = render_mesh_warp_with_cancel(
            &DynamicImage::ImageRgba8({
                let mut image = source.to_rgba8();
                for pixel in image.pixels_mut() {
                    pixel[3] = 128;
                }
                image
            }),
            &translucent.plan.mesh_warp.spec,
            MeshWarpRenderOptions::default(),
            &|| false,
        )
        .unwrap();
        assert_eq!(translucent.image.get_pixel(24, 62)[3], 128);
        assert_eq!(
            &translucent.image.get_pixel(24, 62).0[..3],
            &unmasked.image.get_pixel(24, 62).0[..3]
        );
    }

    #[test]
    fn compound_mask_is_encoded_and_hashed_before_guarded_file_publication() {
        use sha2::{Digest, Sha256};
        let folder = tempfile::tempdir().unwrap();
        let source = folder.path().join("source.png");
        let output = folder.path().join("result.png");
        gradient(512, 512).save(&source).unwrap();
        let work = holed_fit();
        let expected =
            render_deformation_work(&gradient(512, 512), &work, MeshWarpRenderOptions::default())
                .unwrap();
        let receipt = render_deformation_work_file_with_cancel(
            &source,
            None,
            &work,
            &output,
            MeshWarpRenderOptions::default(),
            false,
            false,
            &|| false,
        )
        .unwrap();
        let before = std::fs::read(&output).unwrap();
        assert_eq!(
            receipt.evidence.output_sha256,
            hex::encode(Sha256::digest(&before))
        );
        assert_eq!(image::open(&output).unwrap().to_rgba8(), expected.image);
        assert_eq!(receipt.plan.spec, work);
        let mut invalid = work.clone();
        invalid
            .shape_fit
            .as_mut()
            .unwrap()
            .clip
            .as_mut()
            .unwrap()
            .regions[0]
            .contour_indices
            .push(7);
        assert!(
            render_deformation_work_file_with_cancel(
                &source,
                None,
                &invalid,
                &output,
                MeshWarpRenderOptions::default(),
                true,
                false,
                &|| false
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&output).unwrap(), before);
        let dry = render_deformation_work_file_with_cancel(
            &source,
            None,
            &work,
            &output,
            MeshWarpRenderOptions::default(),
            true,
            true,
            &|| false,
        )
        .unwrap();
        assert_eq!(dry.evidence.output_sha256, receipt.evidence.output_sha256);
        assert_eq!(std::fs::read(&output).unwrap(), before);
    }

    #[test]
    fn migrated_surface_work_renders_identical_pixels() {
        let surface_spec = SurfaceDeformationSpec {
            boundary: Default::default(),
            schema: SURFACE_DEFORMATION_SCHEMA.to_owned(),
            version: SURFACE_DEFORMATION_VERSION.to_owned(),
            transform: work_spec().transform.clone(),
            target_size: None,
            mesh_subdivisions: 6,
            envelope: deformed_envelope(),
            anchors: vec![DeformationAnchor {
                id: "hold".to_owned(),
                column: 4,
                row: 4,
            }],
            strokes: vec![DeformationStroke {
                id: "push".to_owned(),
                samples: vec![StrokeSample {
                    position: Point::new(0.4, 0.4),
                    delta: Point::new(0.03, 0.0),
                    radius: 0.25,
                    strength: 1.0,
                }],
            }],
        };
        let source = gradient(96, 96);
        let expected = crate::render_surface_deformation(
            &source,
            &surface_spec,
            MeshWarpRenderOptions::default(),
        )
        .unwrap();
        let migration = migrate_deformation_work(&DeformationWorkSourceSpec::SurfaceDeformation(
            Box::new(surface_spec.clone()),
        ))
        .unwrap();
        let rendered =
            render_deformation_work(&source, &migration.work, MeshWarpRenderOptions::default())
                .unwrap();
        assert_eq!(rendered.image, expected.image);
        assert_eq!(rendered.plan.mesh_warp, expected.plan.mesh_warp);
    }

    #[test]
    fn migrated_mesh_work_renders_identical_pixels() {
        let mesh_spec = MeshWarpSpec {
            schema: MESH_WARP_SCHEMA.to_owned(),
            version: MESH_WARP_VERSION.to_owned(),
            transform: work_spec().transform.clone(),
            target_size: None,
            mesh: moved_mesh(),
        };
        let source = gradient(96, 96);
        let expected =
            crate::render_mesh_warp(&source, &mesh_spec, MeshWarpRenderOptions::default()).unwrap();
        let migration =
            migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(Box::new(mesh_spec)))
                .unwrap();
        let rendered =
            render_deformation_work(&source, &migration.work, MeshWarpRenderOptions::default())
                .unwrap();
        assert_eq!(rendered.image, expected.image);
        assert_eq!(rendered.plan.mesh_warp, expected.plan);
    }

    #[test]
    fn mesh_edit_changes_pixels_and_pin_view_stays_available() {
        let source = gradient(96, 96);
        let mut without_edit = work_spec();
        without_edit.mesh_edits.clear();
        let before =
            render_deformation_work(&source, &without_edit, MeshWarpRenderOptions::default())
                .unwrap();
        let after =
            render_deformation_work(&source, &work_spec(), MeshWarpRenderOptions::default())
                .unwrap();
        assert_ne!(after.image, before.image);
        assert!(after.plan.pin_view.is_some());
        assert_eq!(after.plan.mesh_edit_count, 1);
        // The un-edited render reports the same pin-view resolution.
        assert_eq!(
            after.plan.pin_view.as_ref().unwrap().resolved_mesh,
            before.plan.mesh_warp.spec.mesh
        );
    }

    #[test]
    fn source_replacement_keeps_one_work_across_dimensions() {
        let small = gradient(64, 48);
        let large = gradient(200, 120);
        let spec = work_spec();
        let first =
            render_deformation_work(&small, &spec, MeshWarpRenderOptions::default()).unwrap();
        let second =
            render_deformation_work(&large, &spec, MeshWarpRenderOptions::default()).unwrap();
        assert_eq!(
            first.plan.mesh_warp.spec.mesh,
            second.plan.mesh_warp.spec.mesh
        );
        assert_eq!(first.image.dimensions(), (96, 96));
        assert_eq!(second.image.dimensions(), (96, 96));
    }

    #[test]
    fn cancellation_leaves_no_file_and_retry_publishes_identical_bytes() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        gradient(96, 96).save(&source).unwrap();
        let output = root.path().join("work.png");
        let spec = work_spec();
        let error = render_deformation_work_file_with_cancel(
            &source,
            None,
            &spec,
            &output,
            MeshWarpRenderOptions::default(),
            false,
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
        let first = render_deformation_work_file_with_cancel(
            &source,
            None,
            &spec,
            &output,
            MeshWarpRenderOptions::default(),
            false,
            false,
            &|| false,
        )
        .unwrap();
        assert!(output.exists());
        let retry = render_deformation_work_file_with_cancel(
            &source,
            None,
            &spec,
            &root.path().join("work-retry.png"),
            MeshWarpRenderOptions::default(),
            false,
            false,
            &|| false,
        )
        .unwrap();
        assert_eq!(first.bytes, retry.bytes);
        assert_eq!(first.evidence.output_sha256, retry.evidence.output_sha256);
    }
}

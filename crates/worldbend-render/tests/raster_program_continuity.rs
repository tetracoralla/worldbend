#![cfg(all(feature = "program", feature = "template"))]

use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
use std::collections::HashMap;
use worldbend_core::*;
use worldbend_render::*;

fn source() -> DynamicImage {
    DynamicImage::ImageRgba8(RgbaImage::from_fn(32, 24, |x, y| {
        Rgba([
            (x * 7) as u8,
            (y * 9) as u8,
            if (x + y) % 3 == 0 { 230 } else { 30 },
            if x < 4 { 90 } else { 255 },
        ])
    }))
}

fn work() -> DeformationWorkSpec {
    serde_json::from_value(serde_json::json!({
        "schema": "worldbend.deformation-work", "version": "0.1",
        "transform": TransformSpec::pixel(Size::new(32.0,24.0),
            Quad::new(Point::new(0.0,0.0),Point::new(32.0,0.0),Point::new(32.0,24.0),Point::new(0.0,24.0))),
        "meshSubdivisions": 4,
        "meshEdits": [{"column":2,"row":2,"warped":{"x":0.54,"y":0.47}}]
    })).unwrap()
}

fn surface() -> SurfaceDeformationSpec {
    SurfaceDeformationSpec {
        boundary: Default::default(),
        schema: SURFACE_DEFORMATION_SCHEMA.into(),
        version: SURFACE_DEFORMATION_VERSION.into(),
        transform: work().transform,
        target_size: None,
        mesh_subdivisions: 4,
        envelope: BezierEnvelope {
            columns: 1,
            rows: 1,
            points: (0..4)
                .flat_map(|y| {
                    (0..4).map(move |x| {
                        Point::new(
                            f64::from(x) / 3.0 + if x == 1 && y == 1 { 0.05 } else { 0.0 },
                            f64::from(y) / 3.0,
                        )
                    })
                })
                .collect(),
        },
        anchors: vec![],
        strokes: vec![],
    }
}

fn remap(displacement: bool) -> RemapSpec {
    RemapSpec {
        schema: REMAP_SCHEMA.into(),
        version: REMAP_VERSION.into(),
        output: PixelSize::new(32, 24),
        operation: if displacement {
            RemapOperation::DisplacementUnit {
                x_channel: RemapChannel::Red,
                y_channel: RemapChannel::Green,
                scale_x_pixels: 90.0,
                scale_y_pixels: 40.0,
                neutral: 0.5,
                boundary: RemapBoundary::Clamp,
            }
        } else {
            RemapOperation::Lens {
                coefficients: LensCoefficients {
                    k1: 0.11,
                    k2: 0.0,
                    k3: 0.0,
                    p1: 0.005,
                    p2: 0.0,
                },
                center: Point::new(0.5, 0.5),
                scale: LensScale { x: 1.0, y: 1.0 },
            }
        },
    }
}

fn map() -> DynamicImage {
    DynamicImage::ImageRgba16(ImageBuffer::from_fn(32, 24, |x, y| {
        Rgba([32768 + (x * 87) as u16, 32768 + (y * 41) as u16, 0, 65535])
    }))
}

fn program(stages: Vec<RasterProgramStage>) -> RasterProgramSpec {
    RasterProgramSpec {
        schema: RASTER_PROGRAM_SCHEMA.into(),
        version: RASTER_PROGRAM_VERSION.into(),
        stages,
    }
}

fn displacement_stage(id: &str) -> RasterProgramStage {
    RasterProgramStage::Remap {
        id: id.into(),
        spec: remap(true),
        map_slot: Some("fabric-map".into()),
    }
}

#[test]
fn replay_keeps_each_existing_family_and_stage_order_byte_identical() {
    let source = source();
    let control = map();
    let work = work();
    let surface = surface();
    let mesh = plan_deformation_work(&work).unwrap().mesh_warp.spec;
    let stages = vec![
        RasterProgramStage::MeshWarp {
            id: "mesh".into(),
            spec: mesh.clone(),
        },
        RasterProgramStage::SurfaceDeformation {
            id: "pins".into(),
            spec: surface.clone(),
        },
        RasterProgramStage::DeformationWork {
            id: "authored".into(),
            spec: work.clone(),
        },
        RasterProgramStage::Remap {
            id: "lens".into(),
            spec: remap(false),
            map_slot: None,
        },
        displacement_stage("displace"),
    ];
    let a = render_mesh_warp(&source, &mesh, Default::default()).unwrap();
    assert_ne!(a.image, source.to_rgba8());
    let b = render_surface_deformation(
        &DynamicImage::ImageRgba8(a.image),
        &surface,
        Default::default(),
    )
    .unwrap();
    let c = render_deformation_work(
        &DynamicImage::ImageRgba8(b.image),
        &work,
        Default::default(),
    )
    .unwrap();
    let d = render_remap(
        &DynamicImage::ImageRgba8(c.image),
        None,
        &remap(false),
        Default::default(),
    )
    .unwrap();
    let expected = render_remap(
        &DynamicImage::ImageRgba8(d.image),
        Some(&control),
        &remap(true),
        Default::default(),
    )
    .unwrap();
    let actual = render_raster_program_with_maps_with_cancel(
        &source,
        &HashMap::from([("fabric-map".into(), &control)]),
        &program(stages),
        Default::default(),
        &|| false,
    )
    .unwrap();
    assert_eq!(actual.image, expected.image);
    assert_eq!(
        actual
            .stages
            .iter()
            .map(|s| s.id.as_str())
            .collect::<Vec<_>>(),
        ["mesh", "pins", "authored", "lens", "displace"]
    );
    assert_eq!(actual.cumulative_pixels, 32 * 24 * 5);
}

#[test]
fn map_requirements_are_closed_and_shared_without_becoming_intermediates() {
    let spec = program(vec![
        displacement_stage("first"),
        displacement_stage("second"),
    ]);
    assert_eq!(
        inspect_raster_program(&spec).unwrap().map_slots,
        ["fabric-map"]
    );
    let source = source();
    let map = map();
    let expected1 = render_remap(&source, Some(&map), &remap(true), Default::default()).unwrap();
    let expected2 = render_remap(
        &DynamicImage::ImageRgba8(expected1.image),
        Some(&map),
        &remap(true),
        Default::default(),
    )
    .unwrap();
    let maps = HashMap::from([("fabric-map".into(), &map)]);
    assert_eq!(
        render_raster_program_with_maps_with_cancel(
            &source,
            &maps,
            &spec,
            Default::default(),
            &|| false
        )
        .unwrap()
        .image,
        expected2.image
    );
    assert_eq!(
        render_raster_program(&source, &spec, Default::default())
            .unwrap_err()
            .code,
        ErrorCode::Schema
    );
    let wrong = HashMap::from([("other-map".into(), &map)]);
    assert_eq!(
        render_raster_program_with_maps_with_cancel(
            &source,
            &wrong,
            &spec,
            Default::default(),
            &|| false
        )
        .unwrap_err()
        .code,
        ErrorCode::Schema
    );
    for (spec, map_slot) in [
        (remap(false), Some("unexpected".into())),
        (remap(true), None),
        (remap(true), Some("../bad".into())),
    ] {
        assert_eq!(
            program(vec![RasterProgramStage::Remap {
                id: "bad".into(),
                spec,
                map_slot
            }])
            .validate()
            .unwrap_err()
            .code,
            ErrorCode::Schema
        );
    }
}

fn document() -> SpatialDocumentSpec {
    let expression = |id: &str, stages| SpatialDocumentExpression::Static {
        id: id.into(),
        template: SpatialTemplateSpec {
            schema: SPATIAL_TEMPLATE_SCHEMA.into(),
            version: SPATIAL_TEMPLATE_VERSION.into(),
            operation: SpatialTemplateOperation::RasterProgram {
                source_slot: "screen".into(),
                program: program(stages),
            },
            output: SpatialTemplateOutput::Single { id: "hero".into() },
        },
        bindings: vec![
            SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: "screen".into(),
                asset_id: "weekly-screen".into(),
            },
            SpatialDocumentBinding {
                role: SpatialDocumentBindingRole::Content,
                slot_id: "fabric-map".into(),
                asset_id: "fabric".into(),
            },
        ],
    };
    let mut plain = expression(
        "plain",
        vec![RasterProgramStage::DeformationWork {
            id: "shape".into(),
            spec: work(),
        }],
    );
    if let SpatialDocumentExpression::Static { bindings, .. } = &mut plain {
        bindings.pop();
    }
    SpatialDocumentSpec {
        schema: SPATIAL_DOCUMENT_SCHEMA.into(),
        version: SPATIAL_DOCUMENT_VERSION.into(),
        assets: vec![
            SpatialDocumentAsset {
                id: "weekly-screen".into(),
                content_version: Some("week-1".into()),
            },
            SpatialDocumentAsset {
                id: "fabric".into(),
                content_version: Some("map-1".into()),
            },
        ],
        expressions: vec![
            expression("fabric-presentation", vec![displacement_stage("surface")]),
            plain,
        ],
    }
}

#[test]
fn saved_shared_assets_revise_only_their_bound_expressions_and_deliver_actual_files() {
    let document = document();
    let inspected = inspect_spatial_document(&document).unwrap();
    let plan = plan_spatial_document_update(&SpatialDocumentUpdateInput {
        new_assets: vec![],
        expressions: vec![],
        document: document.clone(),
        expected_fingerprint: Some(inspected.fingerprint.clone()),
        revisions: vec![SpatialDocumentAssetRevision {
            asset_id: "fabric".into(),
            content_version: Some("map-2".into()),
        }],
    })
    .unwrap();
    assert_eq!(plan.affected_expressions.len(), 1);
    assert_eq!(plan.affected_expressions[0].id, "fabric-presentation");
    let delivery = plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
        document: plan.document,
        expected_fingerprint: Some(plan.fingerprint),
        expression_ids: None,
    })
    .unwrap();
    let root = tempfile::tempdir().unwrap();
    let source_path = root.path().join("screen.png");
    let map_path = root.path().join("map.png");
    source().save(&source_path).unwrap();
    map().save(&map_path).unwrap();
    for entry in delivery.deliveries {
        let SpatialDocumentDelivery::Static { id, job, .. } = entry else {
            panic!()
        };
        let assets = if id == "plain" {
            HashMap::from([("weekly-screen".into(), source_path.clone())])
        } else {
            HashMap::from([
                ("weekly-screen".into(), source_path.clone()),
                ("fabric".into(), map_path.clone()),
            ])
        };
        let out = root.path().join(&id);
        render_variation_job_files(&assets, &job, &out, Default::default(), false).unwrap();
        let actual = image::open(out.join(&id).join("hero.png"))
            .unwrap()
            .to_rgba8();
        let expected = if id == "plain" {
            render_deformation_work(&source(), &work(), Default::default())
                .unwrap()
                .image
        } else {
            render_remap(&source(), Some(&map()), &remap(true), Default::default())
                .unwrap()
                .image
        };
        assert_eq!(actual, expected);
    }
    assert!(
        plan_spatial_document_delivery(&SpatialDocumentDeliveryInput {
            document: document.clone(),
            expected_fingerprint: Some("sha256:".to_owned() + &"0".repeat(64)),
            expression_ids: None
        })
        .is_err()
    );
    let mut bad = document;
    if let SpatialDocumentExpression::Static { bindings, .. } = &mut bad.expressions[0] {
        bindings.pop();
    }
    assert_eq!(
        inspect_spatial_document(&bad).unwrap_err().code,
        ErrorCode::Schema
    );
}

#[test]
fn whole_scene_postprocess_binds_maps_separately_from_planes_and_keeps_size_variants() {
    let composition = MockupSpec {
        schema: MOCKUP_SCHEMA.into(),
        version: MOCKUP_VERSION.into(),
        canvas: PixelSize::new(32, 24),
        background: CanvasBackground::Transparent {},
        planes: vec![MockupPlane {
            id: "front".into(),
            source_id: "screen".into(),
            transform: work().transform,
            opacity: 1.0,
            grid: None,
            measurement: None,
            surface: None,
            shadow: None,
        }],
        seams: vec![],
        clip: None,
    };
    let template = SpatialTemplateSpec {
        schema: SPATIAL_TEMPLATE_SCHEMA.into(),
        version: SPATIAL_TEMPLATE_VERSION.into(),
        operation: SpatialTemplateOperation::CompositionProgram {
            composition: composition.clone(),
            postprocess: program(vec![displacement_stage("fold")]),
        },
        output: SpatialTemplateOutput::CanvasSet {
            spec: CanvasSetSpec {
                schema: CANVAS_SET_SCHEMA.into(),
                version: CANVAS_VERSION.into(),
                variants: vec![
                    CanvasVariant {
                        id: "hero".into(),
                        operation: CanvasOperation::Stretch {
                            output: PixelSize::new(32, 24),
                        },
                    },
                    CanvasVariant {
                        id: "small".into(),
                        operation: CanvasOperation::Stretch {
                            output: PixelSize::new(16, 12),
                        },
                    },
                ],
            },
        },
    };
    assert_eq!(
        inspect_spatial_template(&template).unwrap().source_slots,
        ["screen", "fabric-map"]
    );
    let job = VariationJobSpec {
        schema: VARIATION_JOB_SCHEMA.into(),
        version: SPATIAL_TEMPLATE_VERSION.into(),
        template,
        failure_policy: VariationFailurePolicy::AllOrNone,
        items: vec![VariationJobItem {
            id: "weekly".into(),
            bindings: vec![
                VariationBinding {
                    slot_id: "screen".into(),
                    asset_id: "weekly-screen".into(),
                },
                VariationBinding {
                    slot_id: "fabric-map".into(),
                    asset_id: "fabric".into(),
                },
            ],
        }],
    };
    let root = tempfile::tempdir().unwrap();
    let source_path = root.path().join("screen.png");
    let map_path = root.path().join("map.png");
    source().save(&source_path).unwrap();
    map().save(&map_path).unwrap();
    let assets = HashMap::from([
        ("weekly-screen".into(), source_path),
        ("fabric".into(), map_path),
    ]);
    let out = root.path().join("delivery");
    render_variation_job_files(&assets, &job, &out, Default::default(), false).unwrap();
    let composed = render_mockup(
        &HashMap::from([("screen".into(), source())]),
        &composition,
        Default::default(),
    )
    .unwrap();
    let expected = render_remap(
        &DynamicImage::ImageRgba8(composed.image),
        Some(&map()),
        &remap(true),
        Default::default(),
    )
    .unwrap();
    let SpatialTemplateOutput::CanvasSet { spec } = &job.template.output else {
        panic!()
    };
    let expected_directory = root.path().join("standalone-size-variants");
    std::fs::create_dir(&expected_directory).unwrap();
    render_canvas_set_to_directory(
        &DynamicImage::ImageRgba8(expected.image),
        CanvasSetProgram::Spec(spec),
        &expected_directory,
        "standalone-size-variants",
        Default::default(),
        &|| false,
    )
    .unwrap();
    for (id, dimensions) in [("hero", (32, 24)), ("small", (16, 12))] {
        let actual = image::open(out.join(format!("weekly/{id}.png")))
            .unwrap()
            .to_rgba8();
        let expected = image::open(expected_directory.join(format!("{id}.png")))
            .unwrap()
            .to_rgba8();
        assert_eq!(actual.dimensions(), dimensions);
        assert_eq!(actual, expected);
    }
}

#[test]
fn bounded_or_cancelled_replay_never_replaces_an_existing_file_and_maps_keep_precision() {
    let root = tempfile::tempdir().unwrap();
    let source_path = root.path().join("source.png");
    let map_path = root.path().join("control.png");
    source().save(&source_path).unwrap();
    map().save(&map_path).unwrap();
    let output = root.path().join("output.png");
    std::fs::write(&output, b"preserved").unwrap();
    let maps = HashMap::from([(
        "fabric-map".into(),
        RemapFileMap {
            path: map_path,
            sha256: None,
        },
    )]);
    let spec = program(vec![displacement_stage("one"), displacement_stage("two")]);
    let options = RasterProgramRenderOptions {
        max_cumulative_pixels: 32 * 24,
        ..Default::default()
    };
    let error = render_raster_program_file_with_maps(
        &source_path,
        None,
        &maps,
        &spec,
        &output,
        options,
        true,
        false,
        &|| false,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::OutputLimit);
    assert_eq!(std::fs::read(&output).unwrap(), b"preserved");
    let error = render_raster_program_file_with_maps(
        &source_path,
        None,
        &maps,
        &spec,
        &output,
        Default::default(),
        true,
        false,
        &|| true,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(std::fs::read(&output).unwrap(), b"preserved");
    let result = render_raster_program_file_with_maps(
        &source_path,
        None,
        &maps,
        &spec,
        &output,
        Default::default(),
        true,
        false,
        &|| false,
    )
    .unwrap();
    let control = map();
    let expected = render_raster_program_with_maps_with_cancel(
        &source(),
        &HashMap::from([("fabric-map".into(), &control)]),
        &spec,
        Default::default(),
        &|| false,
    )
    .unwrap();
    assert_eq!(image::open(&output).unwrap().to_rgba8(), expected.image);
    assert_eq!(result.maps.len(), 1);
    assert_eq!(result.maps[0].slot_id, "fabric-map");
    assert_eq!(result.maps[0].sha256.len(), 64);
}

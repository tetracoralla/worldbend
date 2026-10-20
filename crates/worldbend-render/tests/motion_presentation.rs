use image::{DynamicImage, Rgba, RgbaImage};
use worldbend_core::*;
use worldbend_render::{
    MockupRenderOptions, RasterProgramRenderOptions, render_motion_presentation_with_cancel,
    render_raster_program,
};

#[test]
fn presented_frame_matches_the_existing_complete_raster_program() {
    let image = RgbaImage::from_fn(12, 8, |x, y| {
        Rgba([x as u8 * 15, y as u8 * 25, 80, if x < 3 { 0 } else { 255 }])
    });
    let mut transform = TransformSpec::normalized(Quad::new(
        Point::new(0.1, 0.1),
        Point::new(0.9, 0.05),
        Point::new(0.85, 0.9),
        Point::new(0.15, 0.95),
    ));
    transform.content.orientation = SourceOrientation::FlipHorizontal;
    let output = PixelSize::new(20, 14);
    let crop = CanvasOperation::Crop {
        rect: PixelRect {
            x: 2,
            y: 3,
            width: 12,
            height: 8,
        },
    };
    let presentation = MockupMotionPresentation {
        transform: transform.clone(),
        size: output,
        output: SpatialTemplateOutput::CanvasSet {
            spec: CanvasSetSpec {
                schema: CANVAS_SET_SCHEMA.into(),
                version: CANVAS_VERSION.into(),
                variants: vec![CanvasVariant {
                    id: "crop".into(),
                    operation: crop.clone(),
                }],
            },
        },
        output_id: "crop".into(),
        keyframes: vec![],
    };
    let plan = plan_mockup_motion_presentation(&presentation).unwrap();
    let actual = render_motion_presentation_with_cancel(
        image.clone(),
        Some(&plan),
        MockupRenderOptions::default(),
        &|| false,
    )
    .unwrap();
    let expected = render_raster_program(
        &DynamicImage::ImageRgba8(image),
        &RasterProgramSpec {
            schema: RASTER_PROGRAM_SCHEMA.into(),
            version: RASTER_PROGRAM_VERSION.into(),
            stages: vec![
                RasterProgramStage::Transform {
                    id: "whole".into(),
                    spec: transform,
                    canvas: RasterProgramCanvasMode::Reference,
                    target_size: Some(Size::new(20., 14.)),
                },
                RasterProgramStage::Canvas {
                    id: "crop".into(),
                    spec: CanvasSpec {
                        schema: CANVAS_SCHEMA.into(),
                        version: CANVAS_VERSION.into(),
                        operation: crop,
                    },
                },
            ],
        },
        RasterProgramRenderOptions::default(),
    )
    .unwrap();
    assert_eq!(actual.dimensions(), (12, 8));
    assert_eq!(actual, expected.image);
    let mut changed = plan.clone();
    changed.output.width += 1;
    assert!(
        render_motion_presentation_with_cancel(
            actual.clone(),
            Some(&changed),
            MockupRenderOptions::default(),
            &|| false
        )
        .is_err()
    );
    assert!(
        render_motion_presentation_with_cancel(
            actual,
            Some(&plan),
            MockupRenderOptions::default(),
            &|| true
        )
        .is_err()
    );
}

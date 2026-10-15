use crate::{
    CanvasMode, RenderOptions,
    canvas::{CanvasSetRenderOptions, render_primary_plan},
    mockup::MockupRenderOptions,
    render_rgba_image,
};
use image::RgbaImage;
use worldbend_core::{
    ErrorCode, MockupMotionPresentationPlan, Size, TransformError, TransformResult,
    plan_mockup_motion_presentation,
};

/// Execute the canonical whole-scene transform and selected framing. Shared by
/// native still/video work; no carrier computes a second framing rule.
pub fn render_motion_presentation_with_cancel(
    image: RgbaImage,
    presentation: Option<&MockupMotionPresentationPlan>,
    options: MockupRenderOptions,
    cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RgbaImage> {
    if cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "Motion presentation cancelled",
        ));
    }
    let Some(plan) = presentation else {
        return Ok(image);
    };
    if plan_mockup_motion_presentation(&plan.spec)? != *plan {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Motion presentation plan differs from its canonical spec",
        ));
    }
    let result = render_rgba_image(
        image,
        &plan.spec.transform,
        RenderOptions {
            source_view: None,
            quality: options.quality,
            canvas: CanvasMode::Reference,
            target_size: Some(Size::new(
                f64::from(plan.spec.size.width),
                f64::from(plan.spec.size.height),
            )),
            limits: options.limits,
        },
        cancelled,
    )?;
    if let Some(canvas) = &plan.canvas {
        render_primary_plan(
            &result.rendered.image,
            canvas,
            CanvasSetRenderOptions {
                quality: options.quality,
                limits: options.limits,
                max_cumulative_pixels: worldbend_core::MAX_MOCKUP_MOTION_PIXELS,
            },
            cancelled,
        )
    } else {
        Ok(result.rendered.image)
    }
}

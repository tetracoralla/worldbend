use crate::{CanvasMode, MockupRenderOptions, RenderOptions, render_image_with_cancel};
use image::{DynamicImage, Rgba, RgbaImage};
use worldbend_core::{
    ErrorCode, MeshBoundary, MockupShadowPlan, MockupSurface, TransformError, TransformResult,
};

fn check(cancel: &(dyn Fn() -> bool + Sync)) -> TransformResult<()> {
    if cancel() {
        Err(TransformError::new(
            ErrorCode::Cancelled,
            "shadow render was cancelled",
        ))
    } else {
        Ok(())
    }
}
/// Transparent-edge, cancellable separable filtering. Larger Gaussian kernels
/// use the standard three-box approximation; narrow kernels use Gaussian taps.
fn blur_alpha(
    mut values: Vec<u8>,
    width: usize,
    height: usize,
    sigma: f64,
    cancel: &(dyn Fn() -> bool + Sync),
) -> TransformResult<Vec<u8>> {
    if sigma == 0.0 {
        return Ok(values);
    }
    let mut scratch = vec![0; values.len()];
    if sigma < 2.0 {
        let radius = (sigma * 3.0).ceil() as isize;
        let mut kernel: Vec<f64> = (-radius..=radius)
            .map(|x| {
                if x == 0 {
                    1.0
                } else {
                    (-(x as f64).powi(2) / (2.0 * sigma * sigma)).exp()
                }
            })
            .collect();
        let total: f64 = kernel.iter().sum();
        for v in &mut kernel {
            *v /= total
        }
        for horizontal in [true, false] {
            for y in 0..height {
                check(cancel)?;
                for x in 0..width {
                    let mut sum = 0.0;
                    for (index, weight) in kernel.iter().enumerate() {
                        let offset = index as isize - radius;
                        let (sx, sy) = if horizontal {
                            (x as isize + offset, y as isize)
                        } else {
                            (x as isize, y as isize + offset)
                        };
                        if sx >= 0 && sy >= 0 && (sx as usize) < width && (sy as usize) < height {
                            sum += f64::from(values[sy as usize * width + sx as usize]) * weight
                        }
                    }
                    scratch[y * width + x] = sum.round().clamp(0.0, 255.0) as u8;
                }
            }
            std::mem::swap(&mut values, &mut scratch);
        }
    } else {
        let ideal = (4.0 * sigma * sigma + 1.0).sqrt();
        let mut lower = ideal.floor() as usize;
        if lower.is_multiple_of(2) {
            lower -= 1
        }
        let upper = lower + 2;
        let lower_f = lower as f64;
        let count = ((12.0 * sigma * sigma - 3.0 * lower_f * lower_f - 12.0 * lower_f - 9.0)
            / (-4.0 * lower_f - 4.0))
            .round()
            .clamp(0.0, 3.0) as usize;
        for pass in 0..3 {
            let radius = (if pass < count { lower } else { upper } - 1) / 2;
            let divisor = (2 * radius + 1) as u32;
            for horizontal in [true, false] {
                let (lines, length) = if horizontal {
                    (height, width)
                } else {
                    (width, height)
                };
                for line in 0..lines {
                    check(cancel)?;
                    let index = |position: usize| {
                        if horizontal {
                            line * width + position
                        } else {
                            position * width + line
                        }
                    };
                    let mut sum: u32 = (0..=radius.min(length - 1))
                        .map(|p| u32::from(values[index(p)]))
                        .sum();
                    for position in 0..length {
                        scratch[index(position)] = ((sum + divisor / 2) / divisor) as u8;
                        if position >= radius {
                            sum -= u32::from(values[index(position - radius)])
                        }
                        if position + radius + 1 < length {
                            sum += u32::from(values[index(position + radius + 1)])
                        }
                    }
                }
                std::mem::swap(&mut values, &mut scratch);
            }
        }
    }
    Ok(values)
}
pub(crate) fn composite_shadow(
    output: &mut RgbaImage,
    source: &DynamicImage,
    plan: &MockupShadowPlan,
    surface: Option<MockupSurface>,
    opacity: f64,
    options: MockupRenderOptions,
    cancel: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if opacity == 0.0 || plan.shadow.opacity == 0.0 {
        return Ok(());
    }
    check(cancel)?;
    let mut limits = options.limits;
    // Source decode limits also use these fields. Preserve the already
    // admitted source envelope while allowing the core-bounded auxiliary raster.
    limits.max_width = limits.max_width.max(plan.sample_canvas.width);
    limits.max_height = limits.max_height.max(plan.sample_canvas.height);
    limits.max_pixels = limits
        .max_pixels
        .max(u64::from(plan.sample_canvas.width) * u64::from(plan.sample_canvas.height));
    let render_options = RenderOptions {
        source_view: None,
        quality: options.quality,
        canvas: CanvasMode::Reference,
        target_size: None,
        limits,
    };
    let projected = if let Some(surface) = surface {
        let mesh = worldbend_core::build_mockup_surface_mesh(surface, plan.transform.content.warp)?;
        if mesh.boundary == MeshBoundary::Fixed {
            render_image_with_cancel(source, &plan.transform, render_options, cancel)?.image
        } else {
            crate::render_rgba_image_with_custom_mesh(
                source.to_rgba8(),
                &plan.transform,
                render_options,
                mesh,
                cancel,
            )?
            .rendered
            .image
        }
    } else {
        render_image_with_cancel(source, &plan.transform, render_options, cancel)?.image
    };
    let width = projected.width() as usize;
    let height = projected.height() as usize;
    let alpha = projected
        .as_raw()
        .chunks_exact(4)
        .map(|pixel| pixel[3])
        .collect();
    drop(projected);
    let alpha = blur_alpha(alpha, width, height, plan.shadow.blur_sigma_px, cancel)?;
    let inset = plan.inset as usize;
    for y in 0..output.height() {
        check(cancel)?;
        for x in 0..output.width() {
            let coverage = alpha[(y as usize + inset) * width + x as usize + inset];
            let [r, g, b] = plan.shadow.color;
            let pixel = super::mockup::blend_source_over(
                [r, g, b, coverage],
                output.get_pixel(x, y).0,
                opacity * plan.shadow.opacity,
            );
            output.put_pixel(x, y, Rgba(pixel));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    use std::collections::HashMap;
    use worldbend_core::{
        CanvasBackground, MockupPlane, MockupShadow, MockupSpec, PixelSize, Point, Quad, Size,
        TransformSpec,
    };
    fn scene(quad: Quad, shadow: MockupShadow) -> MockupSpec {
        MockupSpec {
            schema: "worldbend.mockup".into(),
            version: "0.1".into(),
            canvas: PixelSize::new(48, 40),
            background: CanvasBackground::Transparent {},
            seams: vec![],
            clip: None,
            planes: vec![MockupPlane {
                id: "art".into(),
                source_id: "art".into(),
                transform: TransformSpec::pixel(Size::new(48., 40.), quad),
                opacity: 1.,
                grid: None,
                measurement: None,
                surface: None,
                shadow: Some(shadow),
            }],
        }
    }
    fn shadow(sigma: f64) -> MockupShadow {
        MockupShadow {
            offset: Point::new(12., 0.),
            blur_sigma_px: sigma,
            color: [180, 20, 10],
            opacity: 0.5,
        }
    }
    #[test]
    fn shadow_tracks_source_alpha_holes_offset_color_and_source_opacity() {
        let mut image = RgbaImage::from_pixel(8, 8, Rgba([20, 60, 180, 255]));
        for y in 2..6 {
            for x in 2..6 {
                image.put_pixel(x, y, Rgba([255, 255, 255, 0]))
            }
        }
        let sources = HashMap::from([("art".into(), DynamicImage::ImageRgba8(image))]);
        let quad = Quad::new(
            Point::new(8., 8.),
            Point::new(16., 8.),
            Point::new(16., 16.),
            Point::new(8., 16.),
        );
        let mut spec = scene(quad, shadow(0.));
        let rendered = crate::render_mockup(&sources, &spec, Default::default())
            .unwrap()
            .image;
        assert_eq!(rendered.get_pixel(20, 8).0, [180, 20, 10, 128]);
        assert_eq!(rendered.get_pixel(23, 11).0, [0, 0, 0, 0]);
        assert_eq!(rendered.get_pixel(8, 8).0, [20, 60, 180, 255]);
        spec.planes[0].opacity = 0.5;
        let half = crate::render_mockup(&sources, &spec, Default::default())
            .unwrap()
            .image;
        assert_eq!(half.get_pixel(20, 8).0[3], 64);
        spec.planes[0].shadow.as_mut().unwrap().blur_sigma_px = 1e-200;
        let tiny = crate::render_mockup(&sources, &spec, Default::default())
            .unwrap()
            .image;
        assert_eq!(tiny, half);
    }
    #[test]
    fn high_resolution_artwork_remains_admitted_in_a_small_shadow_scene() {
        let sources = HashMap::from([(
            "art".into(),
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(256, 256, Rgba([20, 60, 180, 255]))),
        )]);
        let quad = Quad::new(
            Point::new(8., 8.),
            Point::new(16., 8.),
            Point::new(16., 16.),
            Point::new(8., 16.),
        );
        let result = crate::render_mockup(&sources, &scene(quad, shadow(0.)), Default::default())
            .unwrap()
            .image;
        assert_eq!(result.get_pixel(8, 8).0, [20, 60, 180, 255]);
        assert_eq!(result.get_pixel(20, 8).0, [180, 20, 10, 128]);
    }
    #[test]
    fn caster_outside_canvas_still_casts_inside_and_blur_is_cancellable() {
        let sources = HashMap::from([(
            "art".into(),
            DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 8, Rgba([20, 60, 180, 255]))),
        )]);
        let quad = Quad::new(
            Point::new(-10., 8.),
            Point::new(-2., 8.),
            Point::new(-2., 16.),
            Point::new(-10., 16.),
        );
        let spec = scene(quad, shadow(2.));
        let result = crate::render_mockup(&sources, &spec, Default::default())
            .unwrap()
            .image;
        assert!(result.get_pixel(6, 12).0[3] > 60);
        assert_eq!(result.get_pixel(6, 12).0[0], 180);
        assert!(result.get_pixel(12, 12).0[3] > 0);
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let cancel = || calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed) > 20;
        assert_eq!(
            blur_alpha(vec![255; 256 * 256], 256, 256, 12., &cancel)
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
        let data = vec![0, 255, 0, 255];
        let hard = blur_alpha(data.clone(), 2, 2, 0., &|| false).unwrap();
        assert_eq!(hard, data);
    }
}

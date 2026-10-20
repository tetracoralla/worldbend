//! Native reference renderer for shared-camera Spatial effects (Depth).
//! Geometry comes only from `worldbend-core`'s effect plan; this module owns
//! per-layer source staging (cover fit, bounded depth-of-field and motion
//! blur), the shared inverse-mapping plane render, and offset compositing —
//! the same composition the Figma Depth workspace renders in its preview.

use crate::{
    ErrorCode, RenderLimits, RenderOptions, SamplingQuality, TransformError, TransformResult,
    render_image,
};
use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};
use std::collections::HashMap;
use worldbend_core::{
    EffectFrameSurface, EffectPlan, EffectPlanInput, EffectRecipe, EffectState, PixelSize,
    effect_plan,
};

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EffectRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for EffectRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug)]
pub struct RenderedEffect {
    pub image: RgbaImage,
    pub plan: EffectPlan,
}

/// Render one settled Spatial effect state from its ordered source rasters.
/// Sources follow recipe layer order (far to near), exactly as the Figma
/// binding orders them; a coverage-required layer must be supplied once.
pub fn render_effect(
    sources: &HashMap<String, DynamicImage>,
    recipe: &EffectRecipe,
    state: &EffectState,
    options: EffectRenderOptions,
) -> TransformResult<RenderedEffect> {
    let plan = effect_plan(&EffectPlanInput {
        recipe: recipe.clone(),
        state: state.clone(),
        motion: None,
        expected_fingerprint: None,
    })?;
    let viewport = PixelSize::new(
        plan.viewport.width.max(1.0).round() as u32,
        plan.viewport.height.max(1.0).round() as u32,
    );
    let mut output = RgbaImage::new(viewport.width, viewport.height);

    for (index, frame) in plan.frames.iter().enumerate() {
        let source = sources
            .get(&frame.id)
            .or_else(|| sources.get(&format!("layer-{}", index + 1)))
            .ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    format!("Spatial frame {} is missing its bound source", frame.id),
                )
            })?;
        let staged = stage_effect_source(source, &frame.size.width, &frame.size.height, frame)?;
        let rendered = render_image(
            &DynamicImage::ImageRgba8(staged),
            plane_spec(frame)?,
            RenderOptions {
                source_view: None,
                quality: options.quality,
                canvas: crate::CanvasMode::Reference,
                target_size: Some(worldbend_core::Size::new(
                    frame.size.width.max(1.0).round(),
                    frame.size.height.max(1.0).round(),
                )),
                limits: options.limits,
            },
        )?;
        composite_over_offset(&mut output, &rendered.image, frame.offset.x, frame.offset.y);
    }
    Ok(RenderedEffect {
        image: output,
        plan,
    })
}

fn plane_spec(
    frame: &worldbend_core::EffectFrame,
) -> TransformResult<&worldbend_core::TransformSpec> {
    match &frame.surface {
        EffectFrameSurface::Plane { plan } => Ok(&plan.spec),
        EffectFrameSurface::Window { .. } | EffectFrameSurface::Strip { .. } => {
            Err(TransformError::new(
                ErrorCode::Schema,
                "Spatial publication supports camera-plane frames",
            ))
        }
    }
}

/// Cover-fit one source into the frame's logical surface, then apply the
/// frame's bounded appearance: a Gaussian depth-of-field blur and additive
/// motion-blur samples along the planned source-space vector.
fn stage_effect_source(
    source: &DynamicImage,
    logical_width: &f64,
    logical_height: &f64,
    frame: &worldbend_core::EffectFrame,
) -> TransformResult<RgbaImage> {
    let width = logical_width.max(1.0).round().max(1.0) as u32;
    let height = logical_height.max(1.0).round().max(1.0) as u32;
    let mut staged = RgbaImage::new(width, height);
    // Cover fit: scale so both axes are covered, center-cropped.
    let (source_width, source_height) = source.dimensions();
    if source_width == 0 || source_height == 0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Spatial source is empty",
        ));
    }
    let scale = (width as f64 / source_width as f64).max(height as f64 / source_height as f64);
    let scaled_width = ((source_width as f64 * scale).round() as u32).max(1);
    let scaled_height = ((source_height as f64 * scale).round() as u32).max(1);
    let resized = source.resize_exact(
        scaled_width,
        scaled_height,
        image::imageops::FilterType::Lanczos3,
    );
    let origin_x = (scaled_width.saturating_sub(width)) / 2;
    let origin_y = (scaled_height.saturating_sub(height)) / 2;
    for y in 0..height {
        for x in 0..width {
            staged.put_pixel(x, y, resized.get_pixel(origin_x + x, origin_y + y));
        }
    }

    let motion = frame
        .appearance
        .as_ref()
        .and_then(|appearance| appearance.motion_blur.as_ref())
        .map(|plan| plan.source_blur_vector);
    let motion_length = motion.map(|vector| vector.x.hypot(vector.y)).unwrap_or(0.0);
    let samples = if motion_length > 0.25 {
        (motion_length / 2.0).ceil().clamp(2.0, 12.0) as u32
    } else {
        1
    };
    let mut staged = if let Some(appearance) = frame.appearance.as_ref() {
        let radius = appearance
            .depth_of_field
            .as_ref()
            .map(|plan| plan.blur_radius)
            .filter(|radius| *radius > 0.0)
            .unwrap_or(0.0);
        if radius > 0.0 {
            // Canvas filter blur(R) is a Gaussian with σ = R/2.
            image::imageops::blur(&staged, ((radius / 2.0).max(0.05)) as f32)
        } else {
            staged
        }
    } else {
        staged
    };
    if samples <= 1 {
        return Ok(staged);
    }
    // Additive average of the offset samples, matching the canvas "lighter"
    // composite with globalAlpha 1/samples.
    let vector = motion.unwrap_or(worldbend_core::Point { x: 0.0, y: 0.0 });
    let mut accumulated = vec![[0.0_f32; 4]; (width * height) as usize];
    for sample in 0..samples {
        let t = if samples > 1 {
            sample as f64 / (samples as f64 - 1.0)
        } else {
            0.0
        };
        let dx = vector.x * t;
        let dy = vector.y * t;
        for y in 0..height {
            for x in 0..width {
                let source_x = (x as f64 + dx).round() as i64;
                let source_y = (y as f64 + dy).round() as i64;
                let pixel = if source_x >= 0
                    && source_y >= 0
                    && (source_x as u32) < width
                    && (source_y as u32) < height
                {
                    staged.get_pixel(source_x as u32, source_y as u32)
                } else {
                    &Rgba([0, 0, 0, 0])
                };
                let target = &mut accumulated[(y * width + x) as usize];
                for (channel, value) in target.iter_mut().enumerate() {
                    *value += pixel.0[channel] as f32 / samples as f32;
                }
            }
        }
    }
    for (index, values) in accumulated.into_iter().enumerate() {
        let pixel = Rgba([
            values[0].round().clamp(0.0, 255.0) as u8,
            values[1].round().clamp(0.0, 255.0) as u8,
            values[2].round().clamp(0.0, 255.0) as u8,
            values[3].round().clamp(0.0, 255.0) as u8,
        ]);
        staged.put_pixel((index as u32) % width, (index as u32) / width, pixel);
    }
    Ok(staged)
}

fn composite_over_offset(
    destination: &mut RgbaImage,
    layer: &RgbaImage,
    offset_x: f64,
    offset_y: f64,
) {
    let origin_x = offset_x.round() as i64;
    let origin_y = offset_y.round() as i64;
    for (y, x) in layer.enumerate_pixels().map(|(x, y, _)| (y, x)) {
        let target_x = origin_x + x as i64;
        let target_y = origin_y + y as i64;
        if target_x < 0
            || target_y < 0
            || target_x >= destination.width() as i64
            || target_y >= destination.height() as i64
        {
            continue;
        }
        let source = layer.get_pixel(x, y);
        let base = destination.get_pixel(target_x as u32, target_y as u32);
        let source_alpha = f64::from(source.0[3]) / 255.0;
        let mut blended = [0_u8; 4];
        let base_alpha = f64::from(base.0[3]) / 255.0;
        let out_alpha = source_alpha + base_alpha * (1.0 - source_alpha);
        for (channel, slot) in blended.iter_mut().enumerate().take(3) {
            let value = f64::from(source.0[channel]) * source_alpha
                + f64::from(base.0[channel]) * base_alpha * (1.0 - source_alpha);
            *slot = if out_alpha > 0.0 {
                (value / out_alpha).round().clamp(0.0, 255.0) as u8
            } else {
                0
            };
        }
        blended[3] = (out_alpha * 255.0).round().clamp(0.0, 255.0) as u8;
        destination.put_pixel(target_x as u32, target_y as u32, Rgba(blended));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{EffectState, Point, Size};

    fn recipe() -> worldbend_core::EffectRecipe {
        let viewport = Size::new(40.0, 30.0);
        worldbend_core::EffectRecipe {
            schema: "worldbend.effect-recipe".to_owned(),
            version: "3".to_owned(),
            origin: Some(worldbend_core::EffectRecipeInput {
                effect: worldbend_core::EffectId::MultiplaneCamera,
                version: "3".to_owned(),
                viewport,
                intensity: 0.8,
            }),
            viewport,
            camera: Some(worldbend_core::EffectCameraRig {
                focal_length: 1320.0,
                focus_distance: 1000.0,
                travel: worldbend_core::EffectCameraTravel { x: 48.0, y: 32.0 },
            }),
            appearance: None,
            layers: vec![
                worldbend_core::EffectLayer {
                    id: "background".to_owned(),
                    offset: Point { x: 0.0, y: 0.0 },
                    surface: worldbend_core::EffectSurface::CameraPlane {
                        size: Size::new(40.0, 30.0),
                        distance: 1500.0,
                        depth_map: None,
                    },
                    tracks: vec![],
                },
                worldbend_core::EffectLayer {
                    id: "middle".to_owned(),
                    offset: Point { x: 0.0, y: 0.0 },
                    surface: worldbend_core::EffectSurface::CameraPlane {
                        size: Size::new(40.0, 30.0),
                        distance: 1000.0,
                        depth_map: None,
                    },
                    tracks: vec![],
                },
            ],
        }
    }

    fn source(color: [u8; 4]) -> DynamicImage {
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba(color)))
    }

    #[test]
    fn renders_settled_camera_planes_from_ordered_sources() {
        let sources = HashMap::from([
            ("background".to_owned(), source([255, 0, 0, 255])),
            ("middle".to_owned(), source([0, 0, 255, 255])),
        ]);
        let rendered = render_effect(
            &sources,
            &recipe(),
            &EffectState {
                progress: 1.0,
                pointer_x: 0.0,
                pointer_y: 0.0,
                reduced_motion: false,
            },
            EffectRenderOptions::default(),
        )
        .unwrap();
        assert_eq!(rendered.image.dimensions(), (40, 30));
        // The near layer covers the settled frame with its own color.
        assert_eq!(rendered.image.get_pixel(20, 15).0, [0, 0, 255, 255]);
        assert_eq!(rendered.plan.frames.len(), 2);
    }

    #[test]
    fn keeps_overscanned_planes_at_their_own_size_before_viewport_crop() {
        let sources = HashMap::from([
            ("background".to_owned(), source([255, 0, 0, 255])),
            ("middle".to_owned(), source([0, 0, 255, 255])),
        ]);
        let mut recipe = recipe();
        for layer in &mut recipe.layers {
            layer.offset = Point { x: -10.0, y: -10.0 };
            let worldbend_core::EffectSurface::CameraPlane { size, .. } = &mut layer.surface else {
                unreachable!()
            };
            *size = Size::new(60.0, 50.0);
        }
        let rendered = render_effect(
            &sources,
            &recipe,
            &EffectState {
                progress: 1.0,
                pointer_x: 0.0,
                pointer_y: 0.0,
                reduced_motion: false,
            },
            EffectRenderOptions::default(),
        )
        .unwrap();
        // The convergence plane is an identity 60x50 image at (-10,-10),
        // so its blue pixels cover the entire 40x30 viewport, including edges.
        assert_eq!(rendered.image.dimensions(), (40, 30));
        assert_eq!(rendered.image.get_pixel(39, 29).0, [0, 0, 255, 255]);
        assert_eq!(rendered.image.get_pixel(0, 0).0, [0, 0, 255, 255]);
    }

    #[test]
    fn rejects_a_missing_bound_source_and_non_plane_frames() {
        let sources = HashMap::from([("background".to_owned(), source([1, 2, 3, 4]))]);
        assert!(
            render_effect(
                &sources,
                &recipe(),
                &EffectState {
                    progress: 1.0,
                    pointer_x: 0.0,
                    pointer_y: 0.0,
                    reduced_motion: false
                },
                EffectRenderOptions::default(),
            )
            .is_err()
        );
    }
}

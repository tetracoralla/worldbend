//! Timing probe for the raster hot loop.
//!
//! The crate ships no criterion dependency, so these are plain `#[ignore]`d
//! tests: run them in release before/after touching the sampling path and
//! compare printed wall-clock numbers. They report observations only — not
//! SLAs and not regression gates.
//!
//! ```text
//! cargo test -p worldbend-render --release --test perf_probe -- --ignored --nocapture
//! ```

use std::time::Instant;
use worldbend_core::{
    Content, CoordinateSpace, Destination, FitMode, Point, Quad, SPEC_SCHEMA, SPEC_VERSION, Size,
    SourceOrientation, TransformSpec, WarpPreset, WarpSpec,
};
use worldbend_render::{RenderOptions, SamplingQuality, render_image};

fn spec(quad: Quad, warp: Option<WarpSpec>) -> TransformSpec {
    TransformSpec {
        schema: SPEC_SCHEMA.to_string(),
        version: SPEC_VERSION.to_string(),
        destination: Destination {
            space: CoordinateSpace::Normalized,
            reference: None,
            quad,
        },
        content: Content {
            fit: FitMode::Stretch,
            orientation: SourceOrientation::Native,
            warp,
        },
    }
}

fn source(width: u32, height: u32) -> image::DynamicImage {
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_fn(width, height, |x, y| {
        image::Rgba([(x % 256) as u8, (y % 256) as u8, ((x + y) % 256) as u8, 255])
    }))
}

fn perspective_spec() -> TransformSpec {
    spec(
        Quad {
            tl: Point::new(0.0, 0.0),
            tr: Point::new(1.0, 0.1),
            br: Point::new(0.9, 1.0),
            bl: Point::new(-0.05, 0.92),
        },
        None,
    )
}

fn minified_spec() -> TransformSpec {
    spec(
        Quad {
            tl: Point::new(0.3, 0.3),
            tr: Point::new(0.7, 0.3),
            br: Point::new(0.7, 0.7),
            bl: Point::new(0.3, 0.7),
        },
        None,
    )
}

fn warped_spec() -> TransformSpec {
    spec(
        Quad::unit(),
        Some(WarpSpec {
            preset: WarpPreset::Twist,
            amount: 0.7,
        }),
    )
}

#[test]
#[ignore = "timing observation; run with --ignored --nocapture in release"]
fn print_render_timings() {
    let image = source(512, 384);
    let cases = [
        ("perspective", perspective_spec()),
        ("minify", minified_spec()),
        ("warp-twist", warped_spec()),
    ];
    for quality in [SamplingQuality::Standard, SamplingQuality::High] {
        let options = RenderOptions {
            quality,
            target_size: Some(Size::new(1024.0, 1024.0)),
            ..RenderOptions::default()
        };
        for (label, spec) in &cases {
            // Warm-up passes prime allocator and caches.
            let _ = render_image(&image, spec, options).unwrap();
            let iterations = if quality == SamplingQuality::High {
                3
            } else {
                8
            };
            let started = Instant::now();
            for _ in 0..iterations {
                let _ = render_image(&image, spec, options).unwrap();
            }
            let per_render = started.elapsed().as_secs_f64() * 1000.0 / f64::from(iterations);
            println!(
                "{label:?}/{quality:?}: {per_render:.2} ms/render (512x384 source -> 1024x1024)"
            );
        }
    }
}

//! Byte-stability harness for the raster pipeline.
//!
//! Rendering optimisations must not change output bytes. Run this before and
//! after touching sampling/culling/mip code and compare the printed digests:
//!
//! ```text
//! cargo test -p worldbend-render --release --test byte_stability -- --ignored --nocapture
//! ```
//!
//! It stays `#[ignore]`d so the normal suite never depends on printed output;
//! determinism itself is covered by the in-crate render tests.

use sha2::{Digest, Sha256};
use worldbend_core::{
    Content, CoordinateSpace, Destination, FitMode, Point, Quad, SPEC_SCHEMA, SPEC_VERSION, Size,
    SourceOrientation, TransformSpec, WarpSpec,
};
use worldbend_render::{RenderOptions, SamplingQuality, render_image};

fn normalized_spec(
    quad: Quad,
    orientation: Option<SourceOrientation>,
    warp: Option<WarpSpec>,
) -> TransformSpec {
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
            orientation: orientation.unwrap_or(SourceOrientation::Native),
            warp,
        },
    }
}

fn gradient_source(width: u32, height: u32) -> image::RgbaImage {
    image::RgbaImage::from_fn(width, height, |x, y| {
        let alpha = if (x / 3 + y / 4) % 5 == 0 { 128 } else { 255 };
        image::Rgba([
            (x * 7 % 256) as u8,
            (y * 11 % 256) as u8,
            (x * y % 256) as u8,
            alpha,
        ])
    })
}

fn quad(x: f64, y: f64) -> Quad {
    let mut quad = Quad::unit();
    quad.br.x = x;
    quad.br.y = y;
    quad
}

/// Uniformly scaled unit quad (stays convex for 0 < scale).
fn scaled_quad(scale: f64) -> Quad {
    let corner = |x: f64, y: f64| Point::new(0.5 + (x - 0.5) * scale, 0.5 + (y - 0.5) * scale);
    Quad {
        tl: corner(0.0, 0.0),
        tr: corner(1.0, 0.0),
        br: corner(1.0, 1.0),
        bl: corner(0.0, 1.0),
    }
}

fn rotated_quad(degrees: f64) -> Quad {
    let (sin, cos) = degrees.to_radians().sin_cos();
    let center = 0.5;
    let corner =
        |dx: f64, dy: f64| Point::new(center + dx * cos - dy * sin, center + dx * sin + dy * cos);
    Quad {
        tl: corner(-0.45, -0.35),
        tr: corner(0.45, -0.35),
        br: corner(0.45, 0.35),
        bl: corner(-0.45, 0.35),
    }
}

fn perspective_quad() -> Quad {
    Quad {
        tl: Point::new(0.0, 0.0),
        tr: Point::new(1.0, 0.12),
        br: Point::new(0.82, 1.0),
        bl: Point::new(-0.06, 0.88),
    }
}

fn case(name: &str, source: &image::RgbaImage, spec: &TransformSpec, quality: SamplingQuality) {
    let source = image::DynamicImage::ImageRgba8(source.clone());
    let options = RenderOptions {
        quality,
        target_size: Some(Size::new(128.0, 128.0)),
        ..RenderOptions::default()
    };
    match render_image(&source, spec, options) {
        Ok(rendered) => {
            let digest = Sha256::digest(rendered.image.as_raw());
            println!(
                "{name}: {} ({}x{})",
                hex(&digest),
                rendered.image.width(),
                rendered.image.height()
            );
        }
        Err(error) => println!("{name}: ERROR {error}"),
    }
}

fn hex(digest: &[u8]) -> String {
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
#[ignore = "byte-stability harness; run with --ignored --nocapture before/after sampling changes"]
fn print_render_hashes() {
    let source = gradient_source(64, 64);
    let small_source = gradient_source(9, 7);

    let identity = normalized_spec(Quad::unit(), None, None);
    case(
        "identity-standard",
        &source,
        &identity,
        SamplingQuality::Standard,
    );
    case("identity-high", &source, &identity, SamplingQuality::High);
    case(
        "identity-preview",
        &source,
        &identity,
        SamplingQuality::Preview,
    );

    // Minification (mipmap + trilinear territory).
    let shrunk = normalized_spec(scaled_quad(0.2), None, None);
    case(
        "minify-standard",
        &source,
        &shrunk,
        SamplingQuality::Standard,
    );
    case("minify-high", &source, &shrunk, SamplingQuality::High);

    // Magnification (bicubic territory) from a tiny source.
    let magnified = normalized_spec(quad(2.5, 2.0), None, None);
    case(
        "magnify-high-small-source",
        &small_source,
        &magnified,
        SamplingQuality::High,
    );
    case(
        "magnify-standard-small-source",
        &small_source,
        &magnified,
        SamplingQuality::Standard,
    );

    // Rotation and a genuinely projective quad.
    let rotation = normalized_spec(rotated_quad(30.0), None, None);
    case("rotate30-high", &source, &rotation, SamplingQuality::High);
    let perspective = normalized_spec(perspective_quad(), None, None);
    case(
        "perspective-high",
        &source,
        &perspective,
        SamplingQuality::High,
    );

    // Orientation flips ride outside the quad.
    let flipped = normalized_spec(Quad::unit(), Some(SourceOrientation::FlipBoth), None);
    case(
        "flip-both-standard",
        &source,
        &flipped,
        SamplingQuality::Standard,
    );

    // Active warp forces the mip pyramid and per-triangle Jacobians.
    for preset in [
        worldbend_core::WarpPreset::Arc,
        worldbend_core::WarpPreset::Twist,
        worldbend_core::WarpPreset::Fisheye,
    ] {
        let warp = normalized_spec(
            Quad::unit(),
            None,
            Some(WarpSpec {
                preset,
                amount: 0.6,
            }),
        );
        let name = format!("warp-{}-standard", format_preset(preset));
        case(&name, &source, &warp, SamplingQuality::Standard);
        case(
            &format!("warp-{}-high", format_preset(preset)),
            &source,
            &warp,
            SamplingQuality::High,
        );
        case(
            &format!("warp-{}-preview", format_preset(preset)),
            &source,
            &warp,
            SamplingQuality::Preview,
        );
    }

    // Minified warp combines both paths at depth.
    let minified_warp = normalized_spec(
        scaled_quad(0.3),
        None,
        Some(WarpSpec {
            preset: worldbend_core::WarpPreset::Wave,
            amount: -0.8,
        }),
    );
    case(
        "warp-wave-minified-high",
        &source,
        &minified_warp,
        SamplingQuality::High,
    );
}

fn format_preset(preset: worldbend_core::WarpPreset) -> &'static str {
    match preset {
        worldbend_core::WarpPreset::Arc => "arc",
        worldbend_core::WarpPreset::Arch => "arch",
        worldbend_core::WarpPreset::Flag => "flag",
        worldbend_core::WarpPreset::Wave => "wave",
        worldbend_core::WarpPreset::Fish => "fish",
        worldbend_core::WarpPreset::Rise => "rise",
        worldbend_core::WarpPreset::Fisheye => "fisheye",
        worldbend_core::WarpPreset::Inflate => "inflate",
        worldbend_core::WarpPreset::Squeeze => "squeeze",
        worldbend_core::WarpPreset::Twist => "twist",
    }
}

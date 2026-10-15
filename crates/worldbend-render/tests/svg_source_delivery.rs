#![cfg(all(feature = "svg-source", feature = "template", feature = "program"))]

use image::GenericImageView;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs};
use worldbend_core::*;
use worldbend_render::*;

fn job() -> VariationJobSpec {
    serde_json::from_value(serde_json::json!({
        "schema":"worldbend.variation-job","version":"0.1","failurePolicy":"allOrNone",
        "template":{"schema":"worldbend.spatial-template","version":"0.1",
            "operation":{"kind":"rasterProgram","sourceSlot":"artwork","program":{
                "schema":"worldbend.raster-program","version":"0.1","stages":[{
                    "kind":"transform","id":"perspective","canvas":"reference","target_size":{"width":64,"height":48},
                    "spec":TransformSpec::normalized(Quad::new(Point::new(0.08,0.03),Point::new(0.91,0.12),Point::new(0.98,0.95),Point::new(0.01,0.86)))
                }]}},"output":{"kind":"single","id":"preview"}},
        "items":[{"id":"weekly","bindings":[{"slotId":"artwork","assetId":"brand"}]}]
    })).unwrap()
}

#[test]
fn outlined_svg_and_its_decoded_pixels_execute_the_same_canonical_job_with_exact_source_evidence() {
    let temp = tempfile::tempdir().unwrap();
    let svg=b"<svg xmlns='http://www.w3.org/2000/svg' width='32' height='24'><rect width='32' height='24' fill='#234456'/><path d='M2 2H28V20H2Z M8 6V14H16V6Z' fill='#ffbc28' fill-rule='evenodd'/></svg>";
    let path = temp.path().join("native.svg");
    fs::write(&path, svg).unwrap();
    let digest = hex::encode(Sha256::digest(svg));
    let png = temp.path().join("decoded.png");
    let decoded = decode_image_with_limits(svg, RenderLimits::default()).unwrap();
    decoded.save(&png).unwrap();
    let options = VariationJobRenderOptions {
        quality: SamplingQuality::High,
        ..Default::default()
    };
    let svg_assets = HashMap::from([(
        "brand".into(),
        VariationFileAsset {
            path,
            source_sha256: Some(digest.clone()),
        },
    )]);
    let svg_dir = temp.path().join("from-svg");
    let result = render_variation_job_files_with_cancel(
        &svg_assets,
        &job(),
        &svg_dir,
        options,
        false,
        &|| false,
    )
    .unwrap();
    assert_eq!(result.sources[0].source_sha256, digest);
    assert_eq!(
        (result.sources[0].width, result.sources[0].height),
        (32, 24)
    );
    assert!(
        result.sources[0]
            .warnings
            .iter()
            .any(|w| w.contains("SVG") && w.contains("rasterized"))
    );
    let png_dir = temp.path().join("from-png");
    render_variation_job_files(
        &HashMap::from([("brand".into(), png)]),
        &job(),
        &png_dir,
        options,
        false,
    )
    .unwrap();
    let left = fs::read(svg_dir.join("weekly/preview.png")).unwrap();
    let right = fs::read(png_dir.join("weekly/preview.png")).unwrap();
    assert_eq!(left, right);
    let output = image::load_from_memory(&left).unwrap();
    assert_eq!(output.dimensions(), (64, 48));
    let untouched = temp.path().join("dry");
    render_variation_job_files_with_cancel(&svg_assets, &job(), &untouched, options, true, &|| {
        false
    })
    .unwrap();
    assert!(!untouched.exists());
    let mut stale = svg_assets.clone();
    stale.get_mut("brand").unwrap().source_sha256 = Some("0".repeat(64));
    assert!(
        render_variation_job_files_with_cancel(&stale, &job(), &untouched, options, false, &|| {
            false
        })
        .is_err()
    );
    assert!(!untouched.exists());
}

#[test]
fn rejected_svg_or_cancelled_delivery_leaves_no_partial_directory_and_preserves_other_work() {
    let temp = tempfile::tempdir().unwrap();
    let protected = temp.path().join("accepted.png");
    fs::write(&protected, b"existing work").unwrap();
    let svg = temp.path().join("bad.svg");
    fs::write(
        &svg,
        b"<svg width='32' height='24'><image href='/private/source.png'/></svg>",
    )
    .unwrap();
    let assets = HashMap::from([("brand".into(), svg)]);
    let out = temp.path().join("delivery");
    let error = render_variation_job_files(
        &assets,
        &job(),
        &out,
        VariationJobRenderOptions::default(),
        false,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::UnsupportedMedia);
    assert!(!out.exists());
    assert_eq!(fs::read(&protected).unwrap(), b"existing work");
    let error = render_variation_job_files_with_cancel(
        &HashMap::new(),
        &job(),
        &out,
        VariationJobRenderOptions::default(),
        false,
        &|| true,
    )
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert!(!out.exists());
    assert!(fs::read_dir(temp.path()).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".worldbend-")
    }));
}

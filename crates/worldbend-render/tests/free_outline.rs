#![cfg(feature = "deformation-work")]
use image::{DynamicImage, Rgba, RgbaImage};
use worldbend_core::*;
use worldbend_render::*;

#[test]
fn curved_outline_changes_pixels_and_survives_saved_work_and_source_replacement() {
    let points: Vec<Point> = (0..4)
        .flat_map(|y| {
            (0..4).map(move |x| {
                Point::new(
                    f64::from(x) / 3.0,
                    if y == 0 && (x == 1 || x == 2) {
                        0.2
                    } else {
                        f64::from(y) / 3.0
                    },
                )
            })
        })
        .collect();
    let work:DeformationWorkSpec=serde_json::from_value(serde_json::json!({
        "schema":"worldbend.deformation-work","version":"0.1","boundary":"free",
        "transform":TransformSpec::pixel(Size::new(128.0,96.0),Quad::new(Point::new(0.0,0.0),Point::new(128.0,0.0),Point::new(128.0,96.0),Point::new(0.0,96.0))),
        "meshSubdivisions":12,"surface":{"envelope":{"columns":1,"rows":1,"points":points},"anchors":[],"strokes":[]}
    })).unwrap();
    let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(64, 48, Rgba([220, 50, 80, 255])));
    let rendered =
        render_deformation_work(&source, &work, MeshWarpRenderOptions::default()).unwrap();
    assert_eq!(
        rendered.image.get_pixel(64, 2).0[3],
        0,
        "cut-away top must be transparent"
    );
    assert_eq!(rendered.image.get_pixel(64, 40).0, [220, 50, 80, 255]);
    let restored: DeformationWorkSpec =
        serde_json::from_slice(&serde_json::to_vec(&work).unwrap()).unwrap();
    let reopened =
        render_deformation_work(&source, &restored, MeshWarpRenderOptions::default()).unwrap();
    assert_eq!(reopened.image, rendered.image);
    let replacement =
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(200, 100, Rgba([40, 90, 230, 255])));
    let replaced =
        render_deformation_work(&replacement, &restored, MeshWarpRenderOptions::default()).unwrap();
    assert_eq!(replaced.plan, rendered.plan);
    assert_eq!(replaced.image.get_pixel(64, 2).0[3], 0);
    assert_eq!(replaced.image.get_pixel(64, 40).0, [40, 90, 230, 255]);
}

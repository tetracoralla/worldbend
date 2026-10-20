//! Authored Gaussian shadow of projected source alpha, with an expanded sample
//! window so an off-canvas caster can still cast into the visible scene.
use crate::{
    CoordinateSpace, Destination, ErrorCode, PixelSize, Point, Size, SolveOutput, TransformError,
    TransformResult, TransformSpec, solve_spec,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
pub const MOCKUP_SHADOW_PROFILE: &str = "worldbend.projected-alpha-shadow@0.1";
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupShadow {
    /// Offset in the authored scene canvas's pixels.
    #[schemars(schema_with = "offset_schema")]
    pub offset: Point,
    #[schemars(range(min = 0.0, max = 64.0))]
    pub blur_sigma_px: f64,
    pub color: [u8; 3],
    #[schemars(range(min = 0.0, max = 1.0))]
    pub opacity: f64,
}
fn offset_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"object","required":["x","y"],"additionalProperties":false,
    "properties":{"x":{"type":"number","minimum":-8192,"maximum":8192},"y":{"type":"number","minimum":-8192,"maximum":8192}}})
}
fn profile_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":MOCKUP_SHADOW_PROFILE})
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupShadowPlan {
    #[schemars(schema_with = "profile_schema")]
    pub profile: String,
    pub shadow: MockupShadow,
    pub sample_canvas: PixelSize,
    /// Crop the blurred expanded alpha by this inset on both axes.
    pub inset: u32,
    pub transform: TransformSpec,
    pub solve: SolveOutput,
}
impl MockupShadow {
    pub fn validate(self) -> TransformResult<Self> {
        if !self.offset.x.is_finite()
            || !self.offset.y.is_finite()
            || self.offset.x.abs() > 8192.0
            || self.offset.y.abs() > 8192.0
            || !self.blur_sigma_px.is_finite()
            || !(0.0..=64.0).contains(&self.blur_sigma_px)
            || !self.opacity.is_finite()
            || !(0.0..=1.0).contains(&self.opacity)
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "shadow offset, Gaussian sigma or opacity is outside its finite supported range",
            ));
        }
        Ok(self)
    }
}
pub fn plan_mockup_shadow(
    shadow: MockupShadow,
    transform: &TransformSpec,
    solve: &SolveOutput,
    canvas: PixelSize,
) -> TransformResult<MockupShadowPlan> {
    shadow.validate()?;
    if canvas.width == 0
        || canvas.height == 0
        || canvas.width > crate::MAX_MOCKUP_AXIS
        || canvas.height > crate::MAX_MOCKUP_AXIS
        || solve.resolved_destination.reference != canvas.as_size()
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "shadow planning requires the matching bounded scene canvas",
        ));
    }
    let inset = if shadow.opacity == 0.0 {
        0
    } else {
        (shadow.blur_sigma_px * 3.0).ceil() as u32
    };
    let sample_canvas = PixelSize::new(canvas.width + 2 * inset, canvas.height + 2 * inset);
    if u64::from(sample_canvas.width) * u64::from(sample_canvas.height) > crate::MAX_MOCKUP_PIXELS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "expanded shadow sampling window exceeds the raster pixel budget",
        ));
    }
    let shift = Point::new(
        shadow.offset.x + f64::from(inset),
        shadow.offset.y + f64::from(inset),
    );
    let mut quad = solve.resolved_destination.quad;
    for point in [&mut quad.tl, &mut quad.tr, &mut quad.br, &mut quad.bl] {
        point.x += shift.x;
        point.y += shift.y
    }
    let mut transformed = transform.clone();
    transformed.destination = Destination {
        space: CoordinateSpace::Pixel,
        reference: Some(Size::new(
            f64::from(sample_canvas.width),
            f64::from(sample_canvas.height),
        )),
        quad,
    };
    let projected = solve_spec(&transformed, None)?;
    Ok(MockupShadowPlan {
        profile: MOCKUP_SHADOW_PROFILE.into(),
        shadow,
        sample_canvas,
        inset,
        transform: transformed,
        solve: projected,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MockupSpec, plan_mockup};
    use serde_json::json;
    fn document(shadow: serde_json::Value) -> MockupSpec {
        serde_json::from_value(json!({"schema":"worldbend.mockup","version":"0.1","canvas":{"width":64,"height":48},"planes":[{"id":"art","sourceId":"art","opacity":1,"shadow":shadow,
        "transform":{"schema":"worldbend.transform","version":"0.1","destination":{"space":"normalized","quad":{"tl":{"x":0.2,"y":0.2},"tr":{"x":0.8,"y":0.2},"br":{"x":0.8,"y":0.8},"bl":{"x":0.2,"y":0.8}}},"content":{"fit":"stretch","orientation":"native"}}}]})).unwrap()
    }
    fn shadow() -> serde_json::Value {
        json!({"offset":{"x":3.5,"y":-4.25},"blurSigmaPx":2,"color":[12,24,36],"opacity":0.4})
    }
    #[test]
    fn expanded_shadow_preserves_caster_geometry_and_fractional_offset() {
        let plan = plan_mockup(&document(shadow())).unwrap();
        let plane = &plan.planes[0];
        let shadow = plane.shadow.as_ref().unwrap();
        assert_eq!(shadow.profile, MOCKUP_SHADOW_PROFILE);
        assert_eq!(shadow.inset, 6);
        assert_eq!(shadow.sample_canvas, PixelSize::new(76, 60));
        let original = plane.solve.resolved_destination.quad;
        let moved = shadow.solve.resolved_destination.quad;
        assert_eq!(
            moved.tl,
            Point::new(original.tl.x + 9.5, original.tl.y + 1.75)
        );
        assert_eq!(
            moved.br,
            Point::new(original.br.x + 9.5, original.br.y + 1.75)
        );
        assert_eq!(shadow.transform.content, plane.transform.content);
    }
    #[test]
    fn invalid_shadow_and_internal_pixel_budget_reject_without_clamping() {
        for (key, value) in [
            ("blurSigmaPx", json!(65)),
            ("opacity", json!(1.1)),
            ("offset", json!({"x":8193,"y":0})),
        ] {
            let mut s = shadow();
            s[key] = value;
            assert!(plan_mockup(&document(s)).is_err())
        }
        let mut spec = document(shadow());
        spec.canvas = PixelSize::new(8192, 8192);
        spec.planes[0].shadow.as_mut().unwrap().blur_sigma_px = 64.0;
        assert_eq!(plan_mockup(&spec).unwrap_err().code, ErrorCode::OutputLimit);
        spec.planes[0].shadow.as_mut().unwrap().opacity = 0.0;
        assert_eq!(
            plan_mockup(&spec).unwrap().planes[0]
                .shadow
                .as_ref()
                .unwrap()
                .inset,
            0
        );
        let mut s = shadow();
        s["unknown"] = json!(true);
        assert!(serde_json::from_value::<MockupShadow>(s).is_err());
    }
    #[test]
    fn omitted_shadow_keeps_legacy_wire_and_direct_helper_is_bounded() {
        let mut spec = document(shadow());
        spec.planes[0].shadow = None;
        let plan = plan_mockup(&spec).unwrap();
        assert!(
            serde_json::to_value(&spec).unwrap()["planes"][0]
                .get("shadow")
                .is_none()
        );
        assert!(
            serde_json::to_value(&plan).unwrap()["planes"][0]
                .get("shadow")
                .is_none()
        );
        assert!(
            plan_mockup_shadow(
                serde_json::from_value(shadow()).unwrap(),
                &spec.planes[0].transform,
                &plan.planes[0].solve,
                PixelSize::new(u32::MAX, u32::MAX)
            )
            .is_err()
        );
    }
}

use crate::{
    CoordinateSpace, ErrorCode, Size, TransformError, TransformResult, TransformSpec, solve_spec,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CssTransform {
    pub transform: String,
    pub matrix3d: [f64; 16],
    #[schemars(schema_with = "transform_origin_schema")]
    pub transform_origin: String,
    pub width: String,
    pub height: String,
}

fn transform_origin_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": "0 0"
    })
}

pub fn emit_css_transform(
    spec: &TransformSpec,
    element_size: Size,
    destination_size: Option<Size>,
) -> TransformResult<CssTransform> {
    let element_size = element_size.validate("elementSize")?;
    // Route the warp through shared validation first so a non-finite amount
    // reports E_NON_FINITE_COORDINATE like every other entry point instead of
    // masquerading as a schema error, then treat a non-zero warp as the only
    // genuinely non-projective case (amount zero is byte-equivalent to
    // identity; the core mesh test pins that).
    if let Some(warp) = spec.content.warp {
        warp.validate()?;
        if warp.amount != 0.0 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "CSS matrix3d cannot represent a non-projective warp; render pixels instead",
            ));
        }
    }
    if spec.destination.space == CoordinateSpace::Normalized && destination_size.is_none() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "normalized CSS emission requires destinationSize",
        ));
    }
    let solved = solve_spec(spec, destination_size)?;
    let h = solved.homography.matrix;

    // H maps normalized UV to destination coordinates. CSS receives source
    // element pixels, so compose H with (x/width, y/height).
    let a = h[0] / element_size.width;
    let b = h[1] / element_size.height;
    let c = h[2];
    let d = h[3] / element_size.width;
    let e = h[4] / element_size.height;
    let f = h[5];
    let g = h[6] / element_size.width;
    let i = h[7] / element_size.height;

    // CSS matrix3d() arguments are column-major. For z=0:
    // x' = m11*x + m21*y + m41, y' = m12*x + m22*y + m42,
    // w' = m14*x + m24*y + m44.
    let matrix3d = [
        a, d, 0.0, g, b, e, 0.0, i, 0.0, 0.0, 1.0, 0.0, c, f, 0.0, 1.0,
    ];
    let values = matrix3d
        .iter()
        .map(|value| format_float(*value))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(CssTransform {
        transform: format!("matrix3d({values})"),
        matrix3d,
        transform_origin: "0 0".to_owned(),
        width: format!("{}px", format_float(element_size.width)),
        height: format!("{}px", format_float(element_size.height)),
    })
}

fn format_float(value: f64) -> String {
    // Rust's shortest round-trip representation is valid CSS, compact, and
    // does not erase small-but-meaningful projective coefficients.
    if value == 0.0 {
        "0".to_owned()
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Point, Quad};
    use approx::assert_relative_eq;

    #[test]
    fn identity_quad_emits_source_to_destination_scale() {
        let spec = TransformSpec::pixel(
            Size::new(200.0, 100.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(200.0, 0.0),
                Point::new(200.0, 100.0),
                Point::new(0.0, 100.0),
            ),
        );
        let css = emit_css_transform(&spec, Size::new(400.0, 200.0), None).unwrap();
        assert_relative_eq!(css.matrix3d[0], 0.5, epsilon = 1.0e-12);
        assert_relative_eq!(css.matrix3d[5], 0.5, epsilon = 1.0e-12);
        assert_eq!(css.transform_origin, "0 0");
    }

    #[test]
    fn perspective_terms_are_in_css_w_slots() {
        let spec = TransformSpec::pixel(
            Size::new(500.0, 300.0),
            Quad::new(
                Point::new(40.0, 30.0),
                Point::new(450.0, 70.0),
                Point::new(400.0, 260.0),
                Point::new(80.0, 240.0),
            ),
        );
        let css = emit_css_transform(&spec, Size::new(500.0, 300.0), None).unwrap();
        assert_ne!(css.matrix3d[3], 0.0);
        assert_ne!(css.matrix3d[7], 0.0);
    }

    #[test]
    fn normalized_css_requires_concrete_destination_size() {
        let error = emit_css_transform(
            &TransformSpec::normalized(Quad::unit()),
            Size::new(100.0, 100.0),
            None,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(
            error.message,
            "normalized CSS emission requires destinationSize"
        );
    }

    #[test]
    fn css_treats_a_zero_amount_warp_as_identity() {
        let mut spec = TransformSpec::normalized(Quad::unit());
        spec.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.0,
        });
        let css = emit_css_transform(
            &spec,
            Size::new(100.0, 100.0),
            Some(Size::new(100.0, 100.0)),
        )
        .unwrap();
        assert_eq!(css.transform_origin, "0 0");
        assert_eq!(css.matrix3d[0], 1.0);
        assert_eq!(css.matrix3d[5], 1.0);
    }

    #[test]
    fn css_rejects_non_projective_warp() {
        let mut spec = TransformSpec::normalized(Quad::unit());
        spec.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Wave,
            amount: 0.5,
        });
        let error = emit_css_transform(
            &spec,
            Size::new(100.0, 100.0),
            Some(Size::new(100.0, 100.0)),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(error.message.contains("cannot represent"));
    }

    #[test]
    fn css_number_format_preserves_small_nonzero_coefficients() {
        let encoded = format_float(1.0e-18);
        assert_ne!(encoded, "0");
        assert_eq!(encoded.parse::<f64>().unwrap(), 1.0e-18);
        assert_eq!(format_float(-0.0), "0");
    }
}

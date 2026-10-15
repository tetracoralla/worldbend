//! Native carriers that normalize each matrix column need a factored affine
//! mapping. Geometry is planned here; preserving a host's styled content and
//! applying this plan transactionally remain provider responsibilities.

use crate::{
    AffineSourceMap, ErrorCode, Point, Quad, Size, SourceOrientation, TransformError,
    TransformResult, TransformSpec, solve_spec,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeFramePlanInput {
    pub spec: TransformSpec,
    /// Actual current content units, including any prior native scaling.
    pub source_size: Size,
    pub output_size: Size,
}

/// Actual protected carrier bases plus the current editable content extent.
/// A native Resize changes output clipping; a Scale changes content extent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeAffineFrameState {
    pub outer_basis: AffineSourceMap,
    pub inner_basis: AffineSourceMap,
    pub source_size: Size,
    pub output_size: Size,
    pub orientation: SourceOrientation,
}

pub fn rebase_native_affine(state: &NativeAffineFrameState) -> TransformResult<TransformSpec> {
    state.source_size.validate("native content")?;
    state.output_size.validate("native output")?;
    crate::source_sampling::validate_map(state.outer_basis)?;
    crate::source_sampling::validate_map(state.inner_basis)?;
    let map = |uv: Point| {
        let p = Point::new(
            uv.x * state.source_size.width,
            uv.y * state.source_size.height,
        );
        let m = state.inner_basis;
        let p = Point::new(
            m[0][0] * p.x + m[0][1] * p.y + m[0][2],
            m[1][0] * p.x + m[1][1] * p.y + m[1][2],
        );
        let m = state.outer_basis;
        Point::new(
            (m[0][0] * p.x + m[0][1] * p.y + m[0][2]) / state.output_size.width,
            (m[1][0] * p.x + m[1][1] * p.y + m[1][2]) / state.output_size.height,
        )
    };
    let [tl, tr, br, bl] = state.orientation.source_corners().map(map);
    let mut spec = TransformSpec::normalized(Quad::new(tl, tr, br, bl));
    spec.content.orientation = state.orientation;
    solve_spec(&spec, Some(state.output_size))?;
    Ok(spec)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum NativeFramePlan {
    #[serde(rename_all = "camelCase")]
    Affine {
        source_size: Size,
        output_size: Size,
        /// Maps current physical content units to result units.
        logical_to_output: AffineSourceMap,
        /// Legal unit-column outer transform, including result translation.
        outer_basis: AffineSourceMap,
        /// Rotation-only inner transform; translation is always zero.
        inner_basis: AffineSourceMap,
        /// Uniform native content scaling required between the two bases.
        content_scale: f64,
        /// Geometric error from dropping only numerical projective residue.
        numerical_residual: f64,
    },
    #[serde(rename_all = "camelCase")]
    Projective {
        source_size: Size,
        output_size: Size,
        inverse: [f64; 9],
    },
}

pub fn plan_native_frame(input: &NativeFramePlanInput) -> TransformResult<NativeFramePlan> {
    input.source_size.validate("native source")?;
    input.output_size.validate("native output")?;
    if input
        .spec
        .content
        .warp
        .is_some_and(|warp| warp.amount != 0.0)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "native affine/projective frames cannot represent nonlinear Warp",
        ));
    }
    let solved = solve_spec(&input.spec, Some(input.output_size))?;
    let h = solved.homography.matrix;
    let q = solved.resolved_destination.quad;
    let scale = (q.tr.x - q.tl.x)
        .hypot(q.tr.y - q.tl.y)
        .max((q.bl.x - q.tl.x).hypot(q.bl.y - q.tl.y));
    let closure = (q.br.x - q.tr.x - (q.bl.x - q.tl.x)).hypot(q.br.y - q.tr.y - (q.bl.y - q.tl.y));
    // This tolerance follows arithmetic precision and plane extent, never
    // absolute page position or an arbitrary visual approximation budget.
    let residue_limit = 32.0 * f64::EPSILON * scale;
    let numerical_residual = input
        .spec
        .content
        .orientation
        .source_corners()
        .iter()
        .map(|point| {
            let w = h[6] * point.x + h[7] * point.y + h[8];
            let x = h[0] * point.x + h[1] * point.y + h[2];
            let y = h[3] * point.x + h[4] * point.y + h[5];
            (x / w - x).hypot(y / w - y)
        })
        .fold(closure, f64::max);
    if numerical_residual > residue_limit || h[6].abs().max(h[7].abs()) > 128.0 * f64::EPSILON {
        return Ok(NativeFramePlan::Projective {
            source_size: input.source_size,
            output_size: input.output_size,
            inverse: solved.homography.inverse,
        });
    }
    let a = h[0] / input.source_size.width;
    let b = h[1] / input.source_size.height;
    let c = h[3] / input.source_size.width;
    let d = h[4] / input.source_size.height;
    let mut k = a.hypot(c).hypot(b.hypot(d)) / std::f64::consts::SQRT_2;
    if !k.is_finite() || k <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "native affine scale is not representable",
        ));
    }
    if (k - 1.0).abs() <= 8.0 * f64::EPSILON {
        k = 1.0;
    }
    let (aa, bb, cc, dd) = (a / k, b / k, c / k, d / k);
    let difference = aa * aa + cc * cc - bb * bb - dd * dd;
    let dot_twice = 2.0 * (aa * bb + cc * dd);
    let theta = if difference.abs().max(dot_twice.abs()) <= 8.0 * f64::EPSILON {
        0.0
    } else {
        (-difference).atan2(dot_twice) * 0.5
    };
    let (sin, cos) = theta.sin_cos();
    let outer = [
        [aa * cos + bb * sin, -aa * sin + bb * cos, h[2]],
        [cc * cos + dd * sin, -cc * sin + dd * cos, h[5]],
    ];
    let inner = [[cos, sin, 0.0], [-sin, cos, 0.0]];
    if !outer
        .iter()
        .chain(inner.iter())
        .flatten()
        .all(|n| n.is_finite())
        || ![input.source_size.width * k, input.source_size.height * k]
            .iter()
            .all(|n| n.is_finite() && *n > 0.0)
    {
        return Err(TransformError::new(
            ErrorCode::Capacity,
            "native affine content size is not representable",
        ));
    }
    Ok(NativeFramePlan::Affine {
        source_size: input.source_size,
        output_size: input.output_size,
        logical_to_output: [[a, b, h[2]], [c, d, h[5]]],
        outer_basis: outer,
        inner_basis: inner,
        content_scale: k,
        numerical_residual,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Point, Quad, SourceOrientation, TransformRecipe, compose_affine};

    #[test]
    fn native_factor_preserves_the_canonical_mapping_and_unit_columns() {
        let size = Size::new(700.0, 420.0);
        for orientation in [
            SourceOrientation::Native,
            SourceOrientation::FlipHorizontal,
            SourceOrientation::FlipVertical,
            SourceOrientation::FlipBoth,
        ] {
            for (x, y, rotation) in [
                (0.0, 0.0, 0.0),
                (12.0, 0.0, 0.0),
                (0.0, -35.0, 27.0),
                (48.0, 12.0, -90.0),
            ] {
                let mut spec = TransformSpec::pixel(
                    size,
                    Quad::new(
                        Point::new(0.0, 0.0),
                        Point::new(size.width, 0.0),
                        Point::new(size.width, size.height),
                        Point::new(0.0, size.height),
                    ),
                );
                spec.content.orientation = orientation;
                let mut recipe = TransformRecipe::default();
                recipe.skew.x_degrees = x;
                recipe.skew.y_degrees = y;
                recipe.rotation_degrees = rotation;
                let composed = compose_affine(&spec, None, recipe).unwrap();
                let plan = plan_native_frame(&NativeFramePlanInput {
                    spec: composed.spec,
                    source_size: size,
                    output_size: composed.canvas.size,
                })
                .unwrap();
                let NativeFramePlan::Affine {
                    logical_to_output: a,
                    outer_basis: u,
                    inner_basis: v,
                    content_scale: k,
                    ..
                } = plan
                else {
                    panic!("affine recipe classified as projective")
                };
                for col in 0..2 {
                    assert!((u[0][col].hypot(u[1][col]) - 1.0).abs() < 1e-12);
                    assert!((v[0][col].hypot(v[1][col]) - 1.0).abs() < 1e-12);
                }
                for row in 0..2 {
                    for col in 0..2 {
                        let actual = (u[row][0] * v[0][col] + u[row][1] * v[1][col]) * k;
                        assert!((actual - a[row][col]).abs() < 1e-11);
                    }
                }
                assert_eq!(u[0][2], a[0][2]);
                assert_eq!(u[1][2], a[1][2]);
            }
        }
    }

    #[test]
    fn perspective_remains_projective_and_nonlinear_work_is_not_silently_dropped() {
        let spec = TransformSpec::normalized(Quad::new(
            Point::new(0.1, 0.0),
            Point::new(1.0, 0.0),
            Point::new(0.9, 1.0),
            Point::new(0.0, 1.0),
        ));
        let input = NativeFramePlanInput {
            spec,
            source_size: Size::new(700.0, 420.0),
            output_size: Size::new(700.0, 420.0),
        };
        // This first quad is a true affine shear; make one corner genuinely projective.
        let mut input = input;
        input.spec.destination.quad.br.x = 0.8;
        assert!(matches!(
            plan_native_frame(&input).unwrap(),
            NativeFramePlan::Projective { .. }
        ));
        input.spec.content.warp = Some(crate::WarpSpec {
            preset: crate::WarpPreset::Flag,
            amount: 0.3,
        });
        assert_eq!(
            plan_native_frame(&input).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn rebasing_tracks_native_clip_resize_and_scaled_content_without_reapplying_scale() {
        let state = NativeAffineFrameState {
            outer_basis: [[1.0, 0.25, 10.0], [0.0, 1.0, 20.0]],
            inner_basis: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            source_size: Size::new(200.0, 100.0),
            output_size: Size::new(400.0, 200.0),
            orientation: SourceOrientation::Native,
        };
        let spec = rebase_native_affine(&state).unwrap();
        assert_eq!(spec.destination.quad.tl, Point::new(0.025, 0.1));
        assert_eq!(spec.destination.quad.br, Point::new(0.5875, 0.6));
        let mut grown = state.clone();
        grown.source_size.width = 400.0;
        assert_eq!(
            rebase_native_affine(&grown).unwrap().destination.quad.tr,
            Point::new(1.025, 0.1)
        );
        let mut flipped = state;
        flipped.outer_basis[0][0] = -1.0;
        flipped.orientation = SourceOrientation::FlipHorizontal;
        assert!(rebase_native_affine(&flipped).is_ok());
    }
}

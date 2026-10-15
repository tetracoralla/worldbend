use crate::{
    Bounds, CoordinateSpace, ErrorCode, Point, Quad, Size, SolveDiagnostics, SourceOrientation,
    TransformError, TransformResult, TransformSpec, WarpSpec, solve_spec, validate_quad,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};

const MIN_SCALE: f64 = 1.0e-6;
const MAX_ABS_SKEW_DEGREES: f64 = 89.0;
// Trigonometric quarter turns and equivalent pivot compensation can leave an
// otherwise integral edge a few ulps to either side of the pixel boundary.
// Normalize only that numerical residue before floor/ceil so equivalent
// affine recipes cannot gain a phantom one-pixel row or column. The residue
// grows with the plane extent, so the snap window is relative to width/height,
// not to the absolute placement. Using a translated coordinate as the scale
// makes a perfectly real half-pixel edge at x=1e12 look like numerical noise
// and can shrink the tight canvas by one pixel.
const INTEGER_EDGE_SNAP_ULPS: f64 = 16.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scale2D {
    #[schemars(schema_with = "positive_scale_schema")]
    pub x: f64,
    #[schemars(schema_with = "positive_scale_schema")]
    pub y: f64,
}

impl Default for Scale2D {
    fn default() -> Self {
        Self { x: 1.0, y: 1.0 }
    }
}

fn positive_scale_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "exclusiveMinimum": MIN_SCALE
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Skew2D {
    #[schemars(schema_with = "skew_schema")]
    pub x_degrees: f64,
    #[schemars(schema_with = "skew_schema")]
    pub y_degrees: f64,
}

impl Default for Skew2D {
    fn default() -> Self {
        Self {
            x_degrees: 0.0,
            y_degrees: 0.0,
        }
    }
}

fn skew_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "exclusiveMinimum": -MAX_ABS_SKEW_DEGREES,
        "exclusiveMaximum": MAX_ABS_SKEW_DEGREES
    })
}

/// Explicit source-orientation flips. These mirror the source plane inside
/// the destination quad; they never enter the destination-space affine
/// matrix and never reorder destination corners.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Flip2D {
    #[serde(default)]
    pub x: bool,
    #[serde(default)]
    pub y: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransformRecipe {
    /// Multipliers on the destination width and height. Omit to keep 1x scale.
    #[serde(default)]
    pub scale: Scale2D,
    /// Clockwise screen-space rotation in degrees. Omit to keep zero rotation.
    #[serde(default)]
    pub rotation_degrees: f64,
    /// Horizontal and vertical skew angles in degrees. Omit to keep zero skew.
    #[serde(default)]
    pub skew: Skew2D,
    /// Translation in resolved destination units. Omit to keep zero translation.
    #[serde(default = "default_translation")]
    pub translation: Point,
    /// Pivot relative to the current destination bounds: (0,0) is top-left,
    /// (0.5,0.5) is the default center, and (1,1) is bottom-right. These are
    /// relative values, never destination pixel coordinates. Omit unless the
    /// caller explicitly changes the pivot.
    #[serde(default = "default_pivot")]
    pub pivot: Point,
    /// Explicit source-orientation flips. Omit to preserve orientation.
    #[serde(default)]
    pub flip: Flip2D,
    /// Optional bounded preset warp. Omit to preserve the base spec's warp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warp: Option<WarpSpec>,
    /// Remove the base spec's warp. Mutually exclusive with `warp`.
    #[serde(default, skip_serializing_if = "bool_is_false")]
    pub clear_warp: bool,
}

impl Default for TransformRecipe {
    fn default() -> Self {
        Self {
            scale: Scale2D::default(),
            rotation_degrees: 0.0,
            skew: Skew2D::default(),
            translation: Point::new(0.0, 0.0),
            pivot: default_pivot(),
            flip: Flip2D::default(),
            warp: None,
            clear_warp: false,
        }
    }
}

const fn default_pivot() -> Point {
    Point::new(0.5, 0.5)
}

const fn default_translation() -> Point {
    Point::new(0.0, 0.0)
}

const fn bool_is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransformCanvas {
    pub origin: Point,
    pub size: Size,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AffineComposition {
    /// Normalized spec for the tight canvas; its quad is canvas-relative.
    pub spec: TransformSpec,
    /// Transformed destination quad in the BASE destination pixel frame.
    pub raw_quad: Quad,
    pub raw_bounds: Bounds,
    pub canvas: TransformCanvas,
    /// Affine matrix in the RAW resolved-destination frame: it maps base
    /// destination pixels to raw output pixels, while `spec`/`canvas` are
    /// canvas-relative. Chaining this composition as the next base re-pays
    /// the integer floor/ceil canvas quantization (up to one pixel per
    /// cycle); consumers who require drift-free iteration must retain the
    /// original base and the accumulated recipe instead.
    pub matrix: [f64; 9],
    pub diagnostics: SolveDiagnostics,
}

/// Compose semantic affine adjustments over a resolved `TransformSpec`.
///
/// The fixed application order is scale, horizontal/vertical skew,
/// clockwise screen-space rotation, then translation, all around a pivot
/// expressed relative to the current destination bounds. The result carries
/// the raw transformed quad, its bounds, the integer tight canvas
/// (`floor(left/top)`, `ceil(right/bottom)`), a normalized spec for that
/// canvas, the affine matrix, and solve diagnostics. Nothing is rasterized.
pub fn compose_affine(
    base: &TransformSpec,
    target_size: Option<Size>,
    recipe: TransformRecipe,
) -> TransformResult<AffineComposition> {
    if base.destination.space == CoordinateSpace::Normalized && target_size.is_none() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "normalized affine composition requires targetSize",
        ));
    }
    validate_recipe(recipe)?;
    let solved = solve_spec(base, target_size)?;
    let base_quad = solved.resolved_destination.quad;
    let base_bounds = Bounds::from_quad(base_quad);
    let pivot = Point::new(
        base_bounds.x + recipe.pivot.x * base_bounds.width,
        base_bounds.y + recipe.pivot.y * base_bounds.height,
    );
    if !pivot.x.is_finite() || !pivot.y.is_finite() {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "transform pivot is not representable",
        ));
    }

    let matrix = compose_matrix(recipe, pivot);
    if matrix.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "affine transform matrix is not representable",
        ));
    }
    let raw_quad = base_quad.map(|point| transform_point(matrix, point));
    validate_quad(&raw_quad)?;
    let raw_bounds = Bounds::from_quad(raw_quad);
    // Translation does not increase the geometric error budget. Only the
    // plane extent does; include one destination unit as the floor so small
    // planes still absorb ordinary trig residue without swallowing real
    // fractional placement.
    let snap_scale = raw_bounds.width.max(raw_bounds.height).max(1.0);
    let left = snap_integer_edge(raw_bounds.x, snap_scale).floor();
    let top = snap_integer_edge(raw_bounds.y, snap_scale).floor();
    let right = snap_integer_edge(raw_bounds.x + raw_bounds.width, snap_scale).ceil();
    let bottom = snap_integer_edge(raw_bounds.y + raw_bounds.height, snap_scale).ceil();
    let width = right - left;
    let height = bottom - top;
    if [left, top, width, height]
        .iter()
        .any(|value| !value.is_finite())
        || width <= 0.0
        || height <= 0.0
    {
        // Reuses the raster output-limit code because the composition result
        // is unrepresentable as a bounded output canvas; no configured raster
        // limit is consulted here.
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "tight affine output bounds are not representable",
        ));
    }
    let canvas = TransformCanvas {
        origin: Point::new(left, top),
        size: Size::new(width, height),
    };
    let tight_quad = raw_quad.map(|point| {
        Point::new(
            (point.x - canvas.origin.x) / canvas.size.width,
            (point.y - canvas.origin.y) / canvas.size.height,
        )
    });
    let mut spec = TransformSpec::normalized(tight_quad);
    // Flips compose as source-orientation data: XOR the recipe's flip into
    // the base orientation and leave the affine matrix and quad untouched.
    let (base_flip_x, base_flip_y) = base.content.orientation.flips();
    spec.content.orientation =
        SourceOrientation::from_flips(base_flip_x != recipe.flip.x, base_flip_y != recipe.flip.y);
    spec.content.warp = if recipe.clear_warp {
        None
    } else {
        recipe.warp.or(base.content.warp)
    };
    let diagnostics = solve_spec(&spec, Some(canvas.size))?.diagnostics;
    Ok(AffineComposition {
        spec,
        raw_quad,
        raw_bounds,
        canvas,
        matrix,
        diagnostics,
    })
}

fn validate_recipe(recipe: TransformRecipe) -> TransformResult<()> {
    if recipe.clear_warp && recipe.warp.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "transform warp and clearWarp are mutually exclusive",
        ));
    }
    let values = [
        recipe.scale.x,
        recipe.scale.y,
        recipe.rotation_degrees,
        recipe.skew.x_degrees,
        recipe.skew.y_degrees,
        recipe.translation.x,
        recipe.translation.y,
        recipe.pivot.x,
        recipe.pivot.y,
    ];
    if values.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "all transform recipe values must be finite",
        ));
    }
    if recipe.scale.x <= MIN_SCALE || recipe.scale.y <= MIN_SCALE {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("transform scale must be greater than {MIN_SCALE}"),
        ));
    }
    if recipe.skew.x_degrees.abs() >= MAX_ABS_SKEW_DEGREES
        || recipe.skew.y_degrees.abs() >= MAX_ABS_SKEW_DEGREES
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "transform skew must stay between -{MAX_ABS_SKEW_DEGREES} and {MAX_ABS_SKEW_DEGREES} degrees"
            ),
        ));
    }
    Ok(())
}

fn compose_matrix(recipe: TransformRecipe, pivot: Point) -> [f64; 9] {
    let radians = normalize_rotation_degrees(recipe.rotation_degrees).to_radians();
    let (sin, cos) = radians.sin_cos();
    let skew_x = recipe.skew.x_degrees.to_radians().tan();
    let skew_y = recipe.skew.y_degrees.to_radians().tan();
    multiply(
        translation(recipe.translation.x, recipe.translation.y),
        multiply(
            translation(pivot.x, pivot.y),
            multiply(
                [cos, -sin, 0.0, sin, cos, 0.0, 0.0, 0.0, 1.0],
                multiply(
                    [1.0, skew_x, 0.0, skew_y, 1.0, 0.0, 0.0, 0.0, 1.0],
                    multiply(
                        [
                            recipe.scale.x,
                            0.0,
                            0.0,
                            0.0,
                            recipe.scale.y,
                            0.0,
                            0.0,
                            0.0,
                            1.0,
                        ],
                        translation(-pivot.x, -pivot.y),
                    ),
                ),
            ),
        ),
    )
}

const fn translation(x: f64, y: f64) -> [f64; 9] {
    [1.0, 0.0, x, 0.0, 1.0, y, 0.0, 0.0, 1.0]
}

fn multiply(a: [f64; 9], b: [f64; 9]) -> [f64; 9] {
    let mut result = [0.0; 9];
    for row in 0..3 {
        for column in 0..3 {
            result[row * 3 + column] = (0..3)
                .map(|index| a[row * 3 + index] * b[index * 3 + column])
                .sum();
        }
    }
    result
}

fn transform_point(matrix: [f64; 9], point: Point) -> Point {
    Point::new(
        matrix[0] * point.x + matrix[1] * point.y + matrix[2],
        matrix[3] * point.x + matrix[4] * point.y + matrix[5],
    )
}

fn snap_integer_edge(value: f64, scale: f64) -> f64 {
    let integer = value.round();
    if integer == value {
        return value;
    }
    let epsilon = INTEGER_EDGE_SNAP_ULPS * f64::EPSILON * scale;
    if (value - integer).abs() <= epsilon {
        integer
    } else {
        value
    }
}

/// Canonicalize rotation into (-180, 180] before the trig calls. Equivalent
/// recipes that differ by whole turns then produce bit-identical matrices,
/// and extreme arguments cannot degrade through catastrophic reduction.
fn normalize_rotation_degrees(degrees: f64) -> f64 {
    let wrapped = degrees.rem_euclid(360.0);
    if wrapped > 180.0 {
        wrapped - 360.0
    } else {
        wrapped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(actual: f64, expected: f64) {
        assert!((actual - expected).abs() < 1.0e-9, "{actual} != {expected}");
    }

    #[test]
    fn identity_composition_preserves_the_plane_and_canvas() {
        let result = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(100.0, 50.0)),
            TransformRecipe::default(),
        )
        .unwrap();
        assert_eq!(result.spec.destination.quad, Quad::unit());
        assert_eq!(result.canvas.origin, Point::new(0.0, 0.0));
        assert_eq!(result.canvas.size, Size::new(100.0, 50.0));
    }

    #[test]
    fn warp_preserves_replaces_and_clears_explicitly() {
        let mut base = TransformSpec::normalized(Quad::unit());
        base.content.warp = Some(WarpSpec {
            preset: crate::WarpPreset::Arc,
            amount: 0.5,
        });
        let preserved = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe::default(),
        )
        .unwrap();
        assert_eq!(preserved.spec.content.warp, base.content.warp);

        let replacement = WarpSpec {
            preset: crate::WarpPreset::Twist,
            amount: -0.25,
        };
        let replaced = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                warp: Some(replacement),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(replaced.spec.content.warp, Some(replacement));
        assert_eq!(replaced.matrix, preserved.matrix);
        assert_eq!(replaced.raw_quad, preserved.raw_quad);
        // Warp is content-only: the tight canvas and the full solve
        // diagnostics stay byte-identical to the warp-free composition.
        assert_eq!(replaced.canvas, preserved.canvas);
        assert_eq!(replaced.diagnostics, preserved.diagnostics);

        let cleared = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                clear_warp: true,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(cleared.spec.content.warp, None);
        assert_eq!(cleared.matrix, preserved.matrix);

        let conflict = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                warp: Some(replacement),
                clear_warp: true,
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert_eq!(conflict.code, ErrorCode::Schema);
    }

    #[test]
    fn clockwise_rotation_returns_an_unclipped_tight_canvas() {
        let result = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                rotation_degrees: 90.0,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(result.canvas.origin, Point::new(25.0, -25.0));
        assert_eq!(result.canvas.size, Size::new(50.0, 100.0));
        let quad = result.spec.destination.quad;
        for (actual, expected) in quad.points().into_iter().zip(
            Quad::new(
                Point::new(1.0, 0.0),
                Point::new(1.0, 1.0),
                Point::new(0.0, 1.0),
                Point::new(0.0, 0.0),
            )
            .points(),
        ) {
            close(actual.x, expected.x);
            close(actual.y, expected.y);
        }
    }

    #[test]
    fn scale_skew_rotation_and_translation_compose_over_a_saved_plane() {
        let base = TransformSpec::normalized(Quad::new(
            Point::new(0.1, 0.0),
            Point::new(0.9, 0.1),
            Point::new(1.0, 0.9),
            Point::new(0.0, 1.0),
        ));
        let result = compose_affine(
            &base,
            Some(Size::new(320.0, 180.0)),
            TransformRecipe {
                scale: Scale2D { x: 1.25, y: 0.8 },
                rotation_degrees: 12.0,
                skew: Skew2D {
                    x_degrees: 8.0,
                    y_degrees: -3.0,
                },
                translation: Point::new(20.0, -10.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert!(result.canvas.size.width > 300.0);
        assert!(result.canvas.size.height > 150.0);
        assert!(result.diagnostics.geometry.convex);
        close(
            result.spec.destination.quad.tl.x.min(1.0),
            result.spec.destination.quad.tl.x,
        );
    }

    #[test]
    fn invalid_scale_and_skew_are_rejected_before_composition() {
        let spec = TransformSpec::pixel(Size::new(100.0, 100.0), Quad::unit());
        let zero_scale = compose_affine(
            &spec,
            None,
            TransformRecipe {
                scale: Scale2D { x: 0.0, y: 1.0 },
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert_eq!(zero_scale.code, ErrorCode::Schema);

        let singular_skew = compose_affine(
            &spec,
            None,
            TransformRecipe {
                skew: Skew2D {
                    x_degrees: 45.0,
                    y_degrees: 45.0,
                },
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert!(matches!(
            singular_skew.code,
            ErrorCode::QuadDegenerate | ErrorCode::EdgeTooShort
        ));
    }

    #[test]
    fn normalized_composition_requires_a_concrete_target_size() {
        let error = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            None,
            TransformRecipe::default(),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }

    #[test]
    fn composition_order_and_origin_pivot_are_fixed() {
        // Hand-computed: a 100x100 pixel-plane base with pivot (0,0), scale
        // (2,1), skewX 45deg, clockwise rotation 90deg, translation
        // (10.5,20.25) composes M = [[0,-1,10.5],[2,1,20.25],[0,0,1]],
        // sending the quad to TL(10.5,20.25) TR(10.5,220.25)
        // BR(-89.5,320.25) BL(-89.5,120.25) and the integer tight canvas to
        // origin (-90,20) size 101x301. The fractional translation keeps the
        // floor/ceil edges away from floating noise. Any change to the
        // scale -> skew -> rotation -> translation order or to the pivot
        // anchoring produces a different matrix.
        let base = TransformSpec::pixel(
            Size::new(100.0, 100.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(100.0, 0.0),
                Point::new(100.0, 100.0),
                Point::new(0.0, 100.0),
            ),
        );
        let result = compose_affine(
            &base,
            None,
            TransformRecipe {
                scale: Scale2D { x: 2.0, y: 1.0 },
                rotation_degrees: 90.0,
                skew: Skew2D {
                    x_degrees: 45.0,
                    y_degrees: 0.0,
                },
                translation: Point::new(10.5, 20.25),
                pivot: Point::new(0.0, 0.0),
                flip: Flip2D::default(),
                warp: None,
                clear_warp: false,
            },
        )
        .unwrap();
        let expected_matrix = [0.0, -1.0, 10.5, 2.0, 1.0, 20.25, 0.0, 0.0, 1.0];
        for (actual, expected) in result.matrix.into_iter().zip(expected_matrix) {
            close(actual, expected);
        }
        for (actual, expected) in result.raw_quad.points().into_iter().zip(
            Quad::new(
                Point::new(10.5, 20.25),
                Point::new(10.5, 220.25),
                Point::new(-89.5, 320.25),
                Point::new(-89.5, 120.25),
            )
            .points(),
        ) {
            close(actual.x, expected.x);
            close(actual.y, expected.y);
        }
        assert_eq!(result.canvas.origin, Point::new(-90.0, 20.0));
        assert_eq!(result.canvas.size, Size::new(101.0, 301.0));
        for (actual, expected) in result.spec.destination.quad.points().into_iter().zip(
            Quad::new(
                Point::new(100.5 / 101.0, 0.25 / 301.0),
                Point::new(100.5 / 101.0, 200.25 / 301.0),
                Point::new(0.5 / 101.0, 300.25 / 301.0),
                Point::new(0.5 / 101.0, 100.25 / 301.0),
            )
            .points(),
        ) {
            close(actual.x, expected.x);
            close(actual.y, expected.y);
        }
    }

    #[test]
    fn pivot_is_relative_to_the_resolved_destination_bounds() {
        // A 90deg rotation about the bounds-center pivot lands the canvas at
        // (25,-25) (see clockwise_rotation_returns_an_unclipped_tight_canvas);
        // anchoring the same rotation at the bounds corner pivot (0,0) with a
        // fractional translation (kept off integer floor/ceil edges) must
        // instead land it at (-50,0).
        let result = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                rotation_degrees: 90.0,
                translation: Point::new(0.5, 0.25),
                pivot: Point::new(0.0, 0.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(result.canvas.origin, Point::new(-50.0, 0.0));
        assert_eq!(result.canvas.size, Size::new(51.0, 101.0));
    }

    #[test]
    fn equivalent_pivot_recipes_keep_identical_integer_canvas_edges() {
        let base = TransformSpec::normalized(Quad::unit());
        let size = Size::new(512.0, 512.0);
        let centered = compose_affine(
            &base,
            Some(size),
            TransformRecipe {
                rotation_degrees: 90.0,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        let old_pivot = Point::new(256.0, 256.0);
        let matrix = centered.matrix;
        let compensated_translation = Point::new(
            (1.0 - matrix[0]) * old_pivot.x - matrix[1] * old_pivot.y,
            -matrix[3] * old_pivot.x + (1.0 - matrix[4]) * old_pivot.y,
        );
        let corner = compose_affine(
            &base,
            Some(size),
            TransformRecipe {
                rotation_degrees: 90.0,
                translation: compensated_translation,
                pivot: Point::new(0.0, 0.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();

        assert_eq!(corner.canvas, centered.canvas);
        for (actual, expected) in corner
            .raw_quad
            .points()
            .into_iter()
            .zip(centered.raw_quad.points())
        {
            close(actual.x, expected.x);
            close(actual.y, expected.y);
        }
    }

    #[test]
    fn composed_spec_round_trips_to_the_raw_quad() {
        let result = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(320.0, 180.0)),
            TransformRecipe {
                scale: Scale2D { x: 1.25, y: 0.8 },
                rotation_degrees: 12.0,
                skew: Skew2D {
                    x_degrees: 8.0,
                    y_degrees: -3.0,
                },
                translation: Point::new(20.0, -10.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        let round = solve_spec(&result.spec, Some(result.canvas.size)).unwrap();
        for (solved, raw) in round
            .resolved_destination
            .quad
            .points()
            .into_iter()
            .zip(result.raw_quad.points())
        {
            close(solved.x, raw.x - result.canvas.origin.x);
            close(solved.y, raw.y - result.canvas.origin.y);
        }
    }

    #[test]
    fn fractional_bounds_floor_and_ceil_into_the_integer_canvas() {
        let result = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                rotation_degrees: 30.0,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(result.canvas.origin.x, result.raw_bounds.x.floor());
        assert_eq!(result.canvas.origin.y, result.raw_bounds.y.floor());
        assert_eq!(
            result.canvas.size.width,
            (result.raw_bounds.x + result.raw_bounds.width).ceil() - result.canvas.origin.x
        );
        assert_eq!(
            result.canvas.size.height,
            (result.raw_bounds.y + result.raw_bounds.height).ceil() - result.canvas.origin.y
        );
        assert_eq!(result.canvas.origin.x.fract(), 0.0);
        assert_eq!(result.canvas.size.width.fract(), 0.0);
        for point in result.raw_quad.points() {
            assert!(point.x >= result.canvas.origin.x);
            assert!(point.y >= result.canvas.origin.y);
            assert!(point.x <= result.canvas.origin.x + result.canvas.size.width);
            assert!(point.y <= result.canvas.origin.y + result.canvas.size.height);
        }
    }

    #[test]
    fn non_finite_and_boundary_skew_recipes_are_rejected() {
        let spec = TransformSpec::pixel(Size::new(10.0, 10.0), Quad::unit());
        let non_finite = compose_affine(
            &spec,
            None,
            TransformRecipe {
                rotation_degrees: f64::NAN,
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert_eq!(non_finite.code, ErrorCode::NonFiniteCoordinate);

        let boundary_skew = compose_affine(
            &spec,
            None,
            TransformRecipe {
                skew: Skew2D {
                    x_degrees: 89.0,
                    y_degrees: 0.0,
                },
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert_eq!(boundary_skew.code, ErrorCode::Schema);
    }

    #[test]
    fn recipe_flip_records_source_orientation_without_touching_geometry() {
        let base = TransformSpec::normalized(Quad::unit());
        let flipped = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                flip: Flip2D { x: true, y: false },
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        let unflipped = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe::default(),
        )
        .unwrap();
        // The affine matrix, quad, and canvas are orientation-preserving and
        // identical; only the recorded source orientation differs.
        assert_eq!(flipped.matrix, unflipped.matrix);
        assert_eq!(flipped.raw_quad, unflipped.raw_quad);
        assert_eq!(flipped.canvas.size, unflipped.canvas.size);
        assert_eq!(
            flipped.spec.content.orientation,
            SourceOrientation::FlipHorizontal
        );
        assert_eq!(
            unflipped.spec.content.orientation,
            SourceOrientation::Native
        );
    }

    #[test]
    fn flips_xor_with_the_base_orientation() {
        let mut base = TransformSpec::normalized(Quad::unit());
        base.content.orientation = SourceOrientation::FlipHorizontal;
        let both = compose_affine(
            &base,
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                flip: Flip2D { x: true, y: true },
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(
            both.spec.content.orientation,
            SourceOrientation::FlipVertical
        );
        // Toggling the same axis twice returns to native.
        let back = compose_affine(
            &TransformSpec::normalized(Quad::unit()),
            Some(Size::new(100.0, 50.0)),
            TransformRecipe {
                flip: Flip2D { x: true, y: true },
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(back.spec.content.orientation, SourceOrientation::FlipBoth);
    }

    #[test]
    fn whole_turn_rotation_recipes_are_bit_identical() {
        let base = TransformSpec::pixel(
            Size::new(100.0, 100.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(100.0, 0.0),
                Point::new(100.0, 100.0),
                Point::new(0.0, 100.0),
            ),
        );
        let plain = compose_affine(
            &base,
            None,
            TransformRecipe {
                rotation_degrees: 30.0,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        for degrees in [30.0 + 360.0, 30.0 - 720.0, 30.0 + 360.0 * 1_000.0] {
            let wrapped = compose_affine(
                &base,
                None,
                TransformRecipe {
                    rotation_degrees: degrees,
                    ..TransformRecipe::default()
                },
            )
            .unwrap();
            assert_eq!(wrapped.matrix, plain.matrix);
            assert_eq!(wrapped.canvas, plain.canvas);
        }
    }

    #[test]
    fn quarter_turn_snap_scales_with_coordinate_magnitude() {
        // At 1e6 units the quarter-turn residue (~1e-7) already exceeds an
        // absolute 1e-9 window, so equivalent recipes used to gain a phantom
        // pixel row or column. The plane-relative window absorbs the residue
        // while staying far below genuine fractional edges.
        let scale = 1.0e6;
        let base = TransformSpec::pixel(
            Size::new(scale, scale),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(scale, 0.0),
                Point::new(scale, scale),
                Point::new(0.0, scale),
            ),
        );
        let quarter = compose_affine(
            &base,
            None,
            TransformRecipe {
                rotation_degrees: 90.0,
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(quarter.canvas.size.width.fract(), 0.0);
        assert_eq!(quarter.canvas.size.height.fract(), 0.0);
        assert_eq!(quarter.canvas.size.width, quarter.canvas.size.height);
        // A genuinely fractional edge must never snap: shift by a third of a
        // pixel and the canvas grows by the full pixel instead.
        let fractional = compose_affine(
            &base,
            None,
            TransformRecipe {
                rotation_degrees: 90.0,
                translation: Point::new(1.0 / 3.0, 0.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(
            fractional.canvas.size.width - quarter.canvas.size.width,
            1.0
        );
    }

    #[test]
    fn large_translation_keeps_real_fractional_canvas_edges() {
        let base = TransformSpec::pixel(
            Size::new(100.0, 100.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(100.0, 0.0),
                Point::new(100.0, 100.0),
                Point::new(0.0, 100.0),
            ),
        );
        let translated = compose_affine(
            &base,
            None,
            TransformRecipe {
                translation: Point::new(1.0e12 + 0.5, 0.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(translated.raw_bounds.x, 1.0e12 + 0.5);
        assert_eq!(translated.canvas.origin.x, 1.0e12);
        assert_eq!(translated.canvas.size.width, 101.0);
    }

    #[test]
    fn large_extent_keeps_real_fractional_canvas_edges() {
        let extent = 1.0e12;
        let base = TransformSpec::pixel(
            Size::new(extent, extent),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(extent, 0.0),
                Point::new(extent, extent),
                Point::new(0.0, extent),
            ),
        );
        let translated = compose_affine(
            &base,
            None,
            TransformRecipe {
                translation: Point::new(0.25, 0.0),
                ..TransformRecipe::default()
            },
        )
        .unwrap();
        assert_eq!(translated.raw_bounds.x, 0.25);
        assert_eq!(translated.canvas.origin.x, 0.0);
        assert_eq!(translated.canvas.size.width, extent + 1.0);
    }

    #[test]
    fn mirroring_skew_pair_is_rejected_as_orientation() {
        // tan(60deg)^2 > 1 mirrors the quad; the flip must surface as an
        // orientation error, never as a silently reordered destination.
        let spec = TransformSpec::pixel(
            Size::new(100.0, 100.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(100.0, 0.0),
                Point::new(100.0, 100.0),
                Point::new(0.0, 100.0),
            ),
        );
        let error = compose_affine(
            &spec,
            None,
            TransformRecipe {
                skew: Skew2D {
                    x_degrees: 60.0,
                    y_degrees: 60.0,
                },
                ..TransformRecipe::default()
            },
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::QuadOrientation);
    }
}

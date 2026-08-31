use crate::{
    Bounds, ErrorCode, GeometryDiagnostics, Point, Quad, ResolvedDestination, Size,
    SourceOrientation, TransformError, TransformResult, TransformSpec,
    geometry::resolve_destination, validate_quad,
};
use nalgebra::{Matrix3, SMatrix, SVector};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;

const MATRIX_REL_EPSILON: f64 = 1.0e-12;
const W_REL_EPSILON: f64 = 1.0e-12;
const REPROJECTION_REL_LIMIT: f64 = 1.0e-6;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Homography {
    pub matrix: [f64; 9],
    pub inverse: [f64; 9],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReprojectionPoint {
    #[schemars(schema_with = "corner_schema")]
    pub corner: String,
    pub expected: Point,
    pub actual: Point,
    pub error: f64,
}

fn corner_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "enum": ["tl", "tr", "br", "bl"]
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ReprojectionDiagnostics {
    pub points: [ReprojectionPoint; 4],
    pub max: f64,
    pub mean: f64,
    pub limit: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MatrixDiagnostics {
    pub determinant: f64,
    pub invertible: bool,
    pub min_abs_w: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SolveDiagnostics {
    pub geometry: GeometryDiagnostics,
    pub matrix: MatrixDiagnostics,
    pub reprojection: ReprojectionDiagnostics,
    pub bounds: Bounds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SolveOutput {
    pub spec: TransformSpec,
    pub resolved_destination: ResolvedDestination,
    pub homography: Homography,
    pub diagnostics: SolveDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InspectOutput {
    pub resolved_destination: ResolvedDestination,
    pub homography: Homography,
    pub diagnostics: SolveDiagnostics,
}

pub fn solve_spec(spec: &TransformSpec, target_size: Option<Size>) -> TransformResult<SolveOutput> {
    let resolved_destination = resolve_destination(spec, target_size)?;
    let (homography, diagnostics) = solve_with_source_corners(
        &resolved_destination.quad,
        spec.content.orientation.source_corners(),
        resolved_destination.reference.diagonal(),
    )?;
    Ok(SolveOutput {
        spec: spec.clone(),
        resolved_destination,
        homography,
        diagnostics,
    })
}

pub fn inspect_spec(
    spec: &TransformSpec,
    target_size: Option<Size>,
) -> TransformResult<InspectOutput> {
    let solved = solve_spec(spec, target_size)?;
    Ok(InspectOutput {
        resolved_destination: solved.resolved_destination,
        homography: solved.homography,
        diagnostics: solved.diagnostics,
    })
}

pub fn solve_quad(quad: &Quad) -> TransformResult<(Homography, SolveDiagnostics)> {
    let bounds = Bounds::from_quad(*quad);
    solve_with_source_corners(
        quad,
        SourceOrientation::Native.source_corners(),
        bounds.diagonal(),
    )
}

/// Solve the homography mapping explicit source-plane corners (in TL, TR,
/// BR, BL destination-label order) onto the destination quad. Orientation is
/// expressed only through these source corners: the destination quad keeps
/// its validated winding and corner identity, and a mirrored source simply
/// produces an orientation-reversing matrix.
fn solve_with_source_corners(
    quad: &Quad,
    source_corners: [Point; 4],
    reference_diagonal: f64,
) -> TransformResult<(Homography, SolveDiagnostics)> {
    let geometry = validate_quad(quad)?;
    let (homography, matrix, reprojection) =
        solve_projective_mapping(source_corners, quad.points(), reference_diagonal)?;
    let diagnostics = SolveDiagnostics {
        geometry,
        matrix,
        reprojection,
        bounds: Bounds::from_quad(*quad),
    };
    Ok((homography, diagnostics))
}

/// Solve one explicit four-point projective mapping. Callers own the semantic
/// validation of the source and destination quads before entering here. The
/// denominator check is performed over the supplied source quadrilateral, not
/// over an unrelated unit-square extension.
pub(crate) fn solve_projective_mapping(
    source: [Point; 4],
    destination: [Point; 4],
    reference_diagonal: f64,
) -> TransformResult<(Homography, MatrixDiagnostics, ReprojectionDiagnostics)> {
    let (source_normalization, source_points) = normalize_points(source)?;
    let (destination_normalization, destination_points) = normalize_points(destination)?;

    // Normalized eight-equation solve with h22 fixed to 1. nalgebra's LU uses
    // partial pivoting; this deliberately avoids naïve unpivoted elimination.
    let mut a = SMatrix::<f64, 8, 8>::zeros();
    let mut b = SVector::<f64, 8>::zeros();
    for index in 0..4 {
        let source = source_points[index];
        let destination = destination_points[index];
        let row = index * 2;
        a[(row, 0)] = source.x;
        a[(row, 1)] = source.y;
        a[(row, 2)] = 1.0;
        a[(row, 6)] = -source.x * destination.x;
        a[(row, 7)] = -source.y * destination.x;
        b[row] = destination.x;

        a[(row + 1, 3)] = source.x;
        a[(row + 1, 4)] = source.y;
        a[(row + 1, 5)] = 1.0;
        a[(row + 1, 6)] = -source.x * destination.y;
        a[(row + 1, 7)] = -source.y * destination.y;
        b[row + 1] = destination.y;
    }

    let h = a.lu().solve(&b).ok_or_else(|| {
        TransformError::new(
            ErrorCode::HomographySingular,
            "normalized homography equations are singular",
        )
    })?;
    let normalized_h =
        Matrix3::from_row_slice(&[h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0]);

    // Judge conditioning in Hartley-normalized coordinates. Raw H includes
    // destination translation, so determinant / ||H||^3 falsely rejects a
    // small but perfectly stable plane merely because it is far from (0, 0).
    let singular_values = normalized_h.svd(false, false).singular_values;
    let maximum_singular = singular_values.iter().copied().fold(0.0_f64, f64::max);
    let minimum_singular = singular_values
        .iter()
        .copied()
        .fold(f64::INFINITY, f64::min);
    if !maximum_singular.is_finite()
        || !minimum_singular.is_finite()
        || maximum_singular == 0.0
        || minimum_singular <= MATRIX_REL_EPSILON * maximum_singular
    {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "normalized homography is too ill-conditioned",
        )
        .with_details(json!({
            "minimumSingular": minimum_singular,
            "maximumSingular": maximum_singular
        })));
    }

    let destination_inverse = destination_normalization.try_inverse().ok_or_else(|| {
        TransformError::new(
            ErrorCode::HomographySingular,
            "destination normalization matrix is singular",
        )
    })?;
    let mut matrix = destination_inverse * normalized_h * source_normalization;
    let scale = matrix[(2, 2)];
    let denominator_norm = matrix[(2, 0)].hypot(matrix[(2, 1)]).hypot(matrix[(2, 2)]);
    if !scale.is_finite()
        || !denominator_norm.is_finite()
        || denominator_norm == 0.0
        || scale.abs() <= W_REL_EPSILON * denominator_norm
    {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography cannot be normalized to H[8] = 1",
        ));
    }
    matrix /= scale;
    if matrix.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography normalization produced non-finite coefficients",
        ));
    }

    let inverse = matrix.try_inverse().ok_or_else(|| {
        TransformError::new(
            ErrorCode::HomographySingular,
            "homography is not invertible",
        )
    })?;
    if inverse.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography inverse contains non-finite coefficients",
        ));
    }
    let determinant = matrix.determinant();
    if !determinant.is_finite() {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "homography determinant is not finite",
        ));
    }

    let w_values = source.map(|point| denominator(&matrix, point));
    let w_scale = w_values
        .iter()
        .copied()
        .map(f64::abs)
        .fold(0.0_f64, f64::max);
    let w_epsilon = W_REL_EPSILON * w_scale;
    let min_abs_w = w_values
        .iter()
        .copied()
        .map(f64::abs)
        .fold(f64::INFINITY, f64::min);
    let all_positive = w_values.iter().all(|value| *value > w_epsilon);
    let all_negative = w_values.iter().all(|value| *value < -w_epsilon);
    if !all_positive && !all_negative {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "projective denominator reaches or crosses zero inside the source plane",
        )
        .with_details(json!({ "cornerW": w_values, "minimumAbsW": min_abs_w })));
    }

    let matrix_array = matrix_to_array(&matrix);
    let inverse_array = matrix_to_array(&inverse);
    // The LU inverse is only as trustworthy as the solve's conditioning, and
    // a near-horizon case can pass the forward reprojection while carrying an
    // inverse with orders-of-magnitude worse error. Verify it with one
    // forward/back round trip per source corner (always the unit square, so
    // the budget is dimensionless) before publishing it.
    for source_point in source {
        let restored = transform_with_matrix(
            &inverse_array,
            transform_with_matrix(&matrix_array, source_point)?,
        )?;
        if (restored.x - source_point.x).hypot(restored.y - source_point.y) > REPROJECTION_REL_LIMIT
        {
            return Err(TransformError::new(
                ErrorCode::Reprojection,
                "homography inverse does not round-trip within the reprojection budget",
            )
            .with_details(json!({
                "conditionNumber": maximum_singular / minimum_singular,
                "roundTripLimit": REPROJECTION_REL_LIMIT,
            })));
        }
    }
    let homography = Homography {
        matrix: matrix_array,
        inverse: inverse_array,
    };
    let reprojection =
        reprojection_diagnostics(&homography, destination, source, reference_diagonal)?;
    Ok((
        homography,
        MatrixDiagnostics {
            determinant,
            invertible: true,
            min_abs_w,
        },
        reprojection,
    ))
}

pub fn transform_point(homography: &Homography, point: Point) -> TransformResult<Point> {
    transform_with_matrix(&homography.matrix, point)
}

pub fn inverse_transform_point(homography: &Homography, point: Point) -> TransformResult<Point> {
    transform_with_matrix(&homography.inverse, point)
}

fn transform_with_matrix(matrix: &[f64; 9], point: Point) -> TransformResult<Point> {
    if !point.x.is_finite() || !point.y.is_finite() {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "point coordinates must be finite",
        ));
    }
    let w = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
    let denominator_scale =
        (matrix[6] * point.x).abs() + (matrix[7] * point.y).abs() + matrix[8].abs();
    if !w.is_finite()
        || !denominator_scale.is_finite()
        || denominator_scale == 0.0
        || w.abs() <= W_REL_EPSILON * denominator_scale
    {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "point lies on or too near the projective horizon",
        ));
    }
    let x = (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / w;
    let y = (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / w;
    if !x.is_finite() || !y.is_finite() {
        return Err(TransformError::new(
            ErrorCode::HomographyHorizonCrossing,
            "point projection is not finite",
        ));
    }
    Ok(Point::new(x, y))
}

fn normalize_points(points: [Point; 4]) -> TransformResult<(Matrix3<f64>, [Point; 4])> {
    let min_x = points
        .iter()
        .map(|point| point.x)
        .fold(f64::INFINITY, f64::min);
    let max_x = points
        .iter()
        .map(|point| point.x)
        .fold(f64::NEG_INFINITY, f64::max);
    let min_y = points
        .iter()
        .map(|point| point.y)
        .fold(f64::INFINITY, f64::min);
    let max_y = points
        .iter()
        .map(|point| point.y)
        .fold(f64::NEG_INFINITY, f64::max);
    let centroid = Point::new(min_x + (max_x - min_x) * 0.5, min_y + (max_y - min_y) * 0.5);
    let mean_distance = points
        .iter()
        .map(|point| (point.x - centroid.x).hypot(point.y - centroid.y) / 4.0)
        .sum::<f64>();
    if !mean_distance.is_finite() || mean_distance == 0.0 {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "control points cannot be normalized",
        ));
    }
    let scale = 2.0_f64.sqrt() / mean_distance;
    let matrix = Matrix3::new(
        scale,
        0.0,
        -scale * centroid.x,
        0.0,
        scale,
        -scale * centroid.y,
        0.0,
        0.0,
        1.0,
    );
    if matrix.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "control-point normalization is not representable",
        ));
    }
    let normalized = points.map(|point| {
        Point::new(
            (point.x - centroid.x) * scale,
            (point.y - centroid.y) * scale,
        )
    });
    if normalized
        .iter()
        .any(|point| !point.x.is_finite() || !point.y.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "normalized control points are not finite",
        ));
    }
    Ok((matrix, normalized))
}

fn denominator(matrix: &Matrix3<f64>, point: Point) -> f64 {
    matrix[(2, 0)] * point.x + matrix[(2, 1)] * point.y + matrix[(2, 2)]
}

fn matrix_to_array(matrix: &Matrix3<f64>) -> [f64; 9] {
    [
        matrix[(0, 0)],
        matrix[(0, 1)],
        matrix[(0, 2)],
        matrix[(1, 0)],
        matrix[(1, 1)],
        matrix[(1, 2)],
        matrix[(2, 0)],
        matrix[(2, 1)],
        matrix[(2, 2)],
    ]
}

fn reprojection_diagnostics(
    homography: &Homography,
    destination: [Point; 4],
    source_corners: [Point; 4],
    reference_diagonal: f64,
) -> TransformResult<ReprojectionDiagnostics> {
    let source = source_corners;
    let expected = destination;
    let names = ["tl", "tr", "br", "bl"];
    let mut results = Vec::with_capacity(4);
    for index in 0..4 {
        let actual = transform_point(homography, source[index])?;
        let error = (actual.x - expected[index].x).hypot(actual.y - expected[index].y);
        results.push(ReprojectionPoint {
            corner: names[index].to_owned(),
            expected: expected[index],
            actual,
            error,
        });
    }
    let points: [ReprojectionPoint; 4] = results.try_into().expect("four points");
    let max = points.iter().map(|item| item.error).fold(0.0, f64::max);
    let mean = points.iter().map(|item| item.error).sum::<f64>() / 4.0;
    if !reference_diagonal.is_finite() || reference_diagonal <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::Reprojection,
            "reprojection reference diagonal must be finite and positive",
        ));
    }
    let limit = REPROJECTION_REL_LIMIT * reference_diagonal;
    if !max.is_finite() || max > limit {
        return Err(TransformError::new(
            ErrorCode::Reprojection,
            "solved homography does not reproduce its control points",
        )
        .with_details(json!({ "max": max, "limit": limit })));
    }
    Ok(ReprojectionDiagnostics {
        points,
        max,
        mean,
        limit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use approx::assert_relative_eq;

    fn sample_quad() -> Quad {
        Quad::new(
            Point::new(221.5, 103.0),
            Point::new(1066.0, 171.5),
            Point::new(991.0, 704.0),
            Point::new(287.0, 659.5),
        )
    }

    #[test]
    fn solves_identity() {
        let (homography, diagnostics) = solve_quad(&Quad::unit()).unwrap();
        for (actual, expected) in homography
            .matrix
            .iter()
            .zip([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0])
        {
            assert_relative_eq!(*actual, expected, epsilon = 1.0e-12);
        }
        assert!(diagnostics.reprojection.max < 1.0e-12);
    }

    #[test]
    fn reprojects_all_sample_corners() {
        let quad = sample_quad();
        let (homography, diagnostics) = solve_quad(&quad).unwrap();
        assert!(diagnostics.reprojection.max < 1.0e-8);
        for (source, expected) in Quad::unit().points().into_iter().zip(quad.points()) {
            let actual = transform_point(&homography, source).unwrap();
            assert_relative_eq!(actual.x, expected.x, epsilon = 1.0e-8);
            assert_relative_eq!(actual.y, expected.y, epsilon = 1.0e-8);
        }
    }

    #[test]
    fn inverse_round_trips_interior_point() {
        let (homography, _) = solve_quad(&sample_quad()).unwrap();
        let source = Point::new(0.37, 0.82);
        let destination = transform_point(&homography, source).unwrap();
        let actual = inverse_transform_point(&homography, destination).unwrap();
        assert_relative_eq!(actual.x, source.x, epsilon = 1.0e-10);
        assert_relative_eq!(actual.y, source.y, epsilon = 1.0e-10);
    }

    #[test]
    fn normalized_spec_scales_to_target() {
        let spec = TransformSpec::normalized(Quad::new(
            Point::new(0.1, 0.1),
            Point::new(0.9, 0.2),
            Point::new(0.8, 0.9),
            Point::new(0.2, 0.8),
        ));
        let result = solve_spec(&spec, Some(Size::new(1000.0, 500.0))).unwrap();
        assert_eq!(result.resolved_destination.quad.tl, Point::new(100.0, 50.0));
        assert_eq!(
            result.resolved_destination.quad.br,
            Point::new(800.0, 450.0)
        );
    }

    #[test]
    fn rejects_unsupported_version() {
        let mut spec = TransformSpec::pixel(Size::new(10.0, 10.0), Quad::unit());
        spec.version = "1".to_owned();
        assert_eq!(solve_spec(&spec, None).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn translated_one_pixel_plane_remains_solvable() {
        let origin = 1.0e12;
        let quad = Quad::new(
            Point::new(origin, origin),
            Point::new(origin + 1.0, origin),
            Point::new(origin + 1.0, origin + 1.0),
            Point::new(origin, origin + 1.0),
        );
        let (homography, diagnostics) = solve_quad(&quad).unwrap();
        assert_relative_eq!(diagnostics.matrix.determinant, 1.0, epsilon = 1.0e-12);
        let mapped = transform_point(&homography, Point::new(0.25, 0.75)).unwrap();
        assert_relative_eq!(mapped.x, origin + 0.25, epsilon = 1.0e-9);
        assert_relative_eq!(mapped.y, origin + 0.75, epsilon = 1.0e-9);
        let round_trip = inverse_transform_point(&homography, mapped).unwrap();
        assert_relative_eq!(round_trip.x, 0.25, epsilon = 1.0e-9);
        assert_relative_eq!(round_trip.y, 0.75, epsilon = 1.0e-9);
    }

    #[test]
    fn point_horizon_threshold_ignores_large_translation_terms() {
        let translation = 1.0e15;
        let homography = Homography {
            matrix: [1.0, 0.0, translation, 0.0, 1.0, translation, 0.0, 0.0, 1.0],
            inverse: [
                1.0,
                0.0,
                -translation,
                0.0,
                1.0,
                -translation,
                0.0,
                0.0,
                1.0,
            ],
        };
        let mapped = transform_point(&homography, Point::new(0.5, 0.5)).unwrap();
        assert_eq!(mapped, Point::new(translation + 0.5, translation + 0.5));
    }

    #[test]
    fn uniform_scale_preserves_solver_validity() {
        for scale in [1.0e-15, 1.0, 1.0e15] {
            let quad = Quad::unit().map(|point| Point::new(point.x * scale, point.y * scale));
            let (homography, diagnostics) = solve_quad(&quad).unwrap();
            let mapped = transform_point(&homography, Point::new(0.25, 0.75)).unwrap();
            assert_relative_eq!(mapped.x, 0.25 * scale, epsilon = scale * 1.0e-10);
            assert_relative_eq!(mapped.y, 0.75 * scale, epsilon = scale * 1.0e-10);
            assert_relative_eq!(
                diagnostics.reprojection.limit,
                REPROJECTION_REL_LIMIT * scale * 2.0_f64.sqrt(),
                epsilon = scale * 1.0e-15
            );
        }
    }

    #[test]
    fn flipped_orientation_solves_a_mirrored_homography() {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(100.0, 60.0),
            Point::new(0.0, 60.0),
        );
        let mut spec = TransformSpec::pixel(Size::new(100.0, 60.0), quad);
        spec.content.orientation = SourceOrientation::FlipHorizontal;
        let solved = solve_spec(&spec, None).unwrap();
        // The source's top-left (0,0) lands at the destination's TR corner.
        let mapped = transform_point(&solved.homography, Point::new(0.0, 0.0)).unwrap();
        assert_relative_eq!(mapped.x, 100.0, epsilon = 1.0e-9);
        assert_relative_eq!(mapped.y, 0.0, epsilon = 1.0e-9);
        // Mirror = orientation-reversing matrix.
        assert!(solved.diagnostics.matrix.determinant < 0.0);
        // Reprojection still validates with the mirrored source corners.
        assert!(solved.diagnostics.reprojection.max < 1.0e-9);
        // Inverse round-trips an interior point.
        let interior = Point::new(0.25, 0.75);
        let destination = transform_point(&solved.homography, interior).unwrap();
        let round = inverse_transform_point(&solved.homography, destination).unwrap();
        assert_relative_eq!(round.x, interior.x, epsilon = 1.0e-9);
        assert_relative_eq!(round.y, interior.y, epsilon = 1.0e-9);
    }

    #[test]
    fn spec_reprojection_limit_uses_reference_diagonal() {
        let spec = TransformSpec::pixel(
            Size::new(8192.0, 8192.0),
            Quad::new(
                Point::new(8000.0, 8000.0),
                Point::new(8001.0, 8000.0),
                Point::new(8001.0, 8001.0),
                Point::new(8000.0, 8001.0),
            ),
        );
        let solved = solve_spec(&spec, None).unwrap();
        assert_relative_eq!(
            solved.diagnostics.reprojection.limit,
            1.0e-6 * Size::new(8192.0, 8192.0).diagonal(),
            epsilon = 1.0e-15
        );
    }
}

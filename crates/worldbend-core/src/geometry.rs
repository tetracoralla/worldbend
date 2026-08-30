use crate::{
    CoordinateSpace, ErrorCode, Point, Quad, Size, TransformError, TransformResult, TransformSpec,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;

const AREA_REL_EPSILON: f64 = 1.0e-12;
const EDGE_REL_EPSILON: f64 = 1.0e-9;
const CROSS_REL_EPSILON: f64 = 1.0e-12;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl Bounds {
    pub fn from_quad(quad: Quad) -> Self {
        let points = quad.points();
        let min_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
        let min_y = points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
        Self {
            x: min_x,
            y: min_y,
            width: max_x - min_x,
            height: max_y - min_y,
        }
    }

    pub fn diagonal(self) -> f64 {
        self.width.hypot(self.height)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GeometryDiagnostics {
    pub convex: bool,
    pub self_intersecting: bool,
    pub signed_area: f64,
    pub edge_lengths: [f64; 4],
    #[schemars(schema_with = "orientation_schema")]
    pub orientation: String,
}

fn orientation_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": "clockwise-screen"
    })
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ResolvedDestination {
    pub quad: Quad,
    pub reference: Size,
    pub source_space: CoordinateSpace,
}

pub fn validate_quad(quad: &Quad) -> TransformResult<GeometryDiagnostics> {
    let points = quad.points();
    if points.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "all quad coordinates must be finite",
        ));
    }

    let bounds = Bounds::from_quad(*quad);
    let scale = bounds.width.max(bounds.height);
    if !scale.is_finite() {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "quad coordinate extent is not representable",
        ));
    }
    if scale == 0.0 {
        return Err(TransformError::new(
            ErrorCode::EdgeTooShort,
            "adjacent quad corners are too close",
        ));
    }
    let scale_squared = scale * scale;
    if !scale_squared.is_finite() {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "quad area cannot be represented safely",
        ));
    }
    // Run predicates after removing translation and uniform scale. This avoids
    // catastrophic cancellation for small planes placed at large coordinates
    // and makes the tolerances invariant under ordinary unit changes.
    let normalized =
        points.map(|point| Point::new((point.x - bounds.x) / scale, (point.y - bounds.y) / scale));

    let edge_lengths = [
        distance(points[0], points[1]),
        distance(points[1], points[2]),
        distance(points[2], points[3]),
        distance(points[3], points[0]),
    ];
    let normalized_edge_lengths = [
        distance(normalized[0], normalized[1]),
        distance(normalized[1], normalized[2]),
        distance(normalized[2], normalized[3]),
        distance(normalized[3], normalized[0]),
    ];
    // Classification order is part of the error contract: a quad with several
    // defects reports the category that best matches the user's intent.
    // Mirrored winding is checked before mechanical faults such as short
    // edges so a mirrored input always surfaces as E_QUAD_ORIENTATION; a
    // bow-tie is still caught first because its flat/cancelled crosses would
    // otherwise masquerade as degeneracy.
    if segments_cross(
        normalized[0],
        normalized[1],
        normalized[2],
        normalized[3],
        CROSS_REL_EPSILON,
    ) || segments_cross(
        normalized[1],
        normalized[2],
        normalized[3],
        normalized[0],
        CROSS_REL_EPSILON,
    ) {
        return Err(TransformError::new(
            ErrorCode::QuadSelfIntersect,
            "quad edges self-intersect; corner order must be TL, TR, BR, BL",
        ));
    }

    let crosses = [
        cross(normalized[0], normalized[1], normalized[2]),
        cross(normalized[1], normalized[2], normalized[3]),
        cross(normalized[2], normalized[3], normalized[0]),
        cross(normalized[3], normalized[0], normalized[1]),
    ];
    if crosses.iter().any(|value| value.abs() <= CROSS_REL_EPSILON) {
        return Err(TransformError::new(
            ErrorCode::QuadDegenerate,
            "three adjacent quad corners are effectively collinear",
        ));
    }

    let all_positive = crosses.iter().all(|value| *value > 0.0);
    let all_negative = crosses.iter().all(|value| *value < 0.0);
    if all_negative {
        return Err(TransformError::new(
            ErrorCode::QuadOrientation,
            "quad orientation is mirrored; corner order must be TL, TR, BR, BL",
        ));
    }
    if !all_positive {
        return Err(TransformError::new(
            ErrorCode::QuadConcave,
            "Worldbend accepts only a simple convex quadrilateral",
        ));
    }

    let normalized_signed_area = polygon_signed_area(&normalized);
    let signed_area = normalized_signed_area * scale_squared;
    if normalized_signed_area.abs() <= AREA_REL_EPSILON {
        return Err(TransformError::new(
            ErrorCode::QuadDegenerate,
            "quad area is too small for a stable mapping",
        )
        .with_details(json!({
            "signedArea": signed_area,
            "minimumAbsArea": AREA_REL_EPSILON * scale_squared
        })));
    }

    if let Some((index, _)) = normalized_edge_lengths
        .iter()
        .copied()
        .enumerate()
        .find(|(_, length)| *length <= EDGE_REL_EPSILON)
    {
        let length = edge_lengths[index];
        return Err(TransformError::new(
            ErrorCode::EdgeTooShort,
            "adjacent quad corners are too close",
        )
        .with_details(json!({
            "edgeIndex": index,
            "length": length,
            "minimum": EDGE_REL_EPSILON * scale
        })));
    }

    Ok(GeometryDiagnostics {
        convex: true,
        self_intersecting: false,
        signed_area,
        edge_lengths,
        orientation: "clockwise-screen".to_owned(),
    })
}

pub(crate) fn resolve_destination(
    spec: &TransformSpec,
    target_size: Option<Size>,
) -> TransformResult<ResolvedDestination> {
    spec.validate_header()?;
    match spec.destination.space {
        CoordinateSpace::Pixel => {
            let source_reference = spec.destination.reference.expect("validated above");
            let reference = target_size
                .unwrap_or(source_reference)
                .validate("targetSize")?;
            let sx = reference.width / source_reference.width;
            let sy = reference.height / source_reference.height;
            Ok(ResolvedDestination {
                quad: spec
                    .destination
                    .quad
                    .map(|point| Point::new(point.x * sx, point.y * sy)),
                reference,
                source_space: CoordinateSpace::Pixel,
            })
        }
        CoordinateSpace::Normalized => {
            let reference = target_size.unwrap_or(Size::new(1.0, 1.0));
            let reference = reference.validate("targetSize")?;
            Ok(ResolvedDestination {
                quad: spec
                    .destination
                    .quad
                    .map(|point| Point::new(point.x * reference.width, point.y * reference.height)),
                reference,
                source_space: CoordinateSpace::Normalized,
            })
        }
    }
}

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}

pub fn cross(a: Point, b: Point, c: Point) -> f64 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

pub fn polygon_signed_area(points: &[Point]) -> f64 {
    let mut twice_area = 0.0;
    for index in 0..points.len() {
        let current = points[index];
        let next = points[(index + 1) % points.len()];
        twice_area += current.x * next.y - next.x * current.y;
    }
    twice_area * 0.5
}

fn segments_cross(a: Point, b: Point, c: Point, d: Point, epsilon: f64) -> bool {
    let ab_c = cross(a, b, c);
    let ab_d = cross(a, b, d);
    let cd_a = cross(c, d, a);
    let cd_b = cross(c, d, b);
    ((ab_c > epsilon && ab_d < -epsilon) || (ab_c < -epsilon && ab_d > epsilon))
        && ((cd_a > epsilon && cd_b < -epsilon) || (cd_a < -epsilon && cd_b > epsilon))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_unit_square() {
        let diagnostics = validate_quad(&Quad::unit()).unwrap();
        assert_eq!(diagnostics.signed_area, 1.0);
        assert_eq!(diagnostics.orientation, "clockwise-screen");
    }

    #[test]
    fn rejects_bow_tie_without_reordering() {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(1.0, 0.0),
            Point::new(0.0, 1.0),
        );
        assert_eq!(
            validate_quad(&quad).unwrap_err().code,
            ErrorCode::QuadSelfIntersect
        );
    }

    #[test]
    fn rejects_concave_quad() {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(2.0, 0.0),
            Point::new(0.5, 0.5),
            Point::new(0.0, 2.0),
        );
        assert_eq!(
            validate_quad(&quad).unwrap_err().code,
            ErrorCode::QuadConcave
        );
    }

    #[test]
    fn rejects_mirrored_order() {
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
            Point::new(1.0, 1.0),
            Point::new(1.0, 0.0),
        );
        assert_eq!(
            validate_quad(&quad).unwrap_err().code,
            ErrorCode::QuadOrientation
        );
    }

    #[test]
    fn mirrored_classification_wins_over_mechanical_faults() {
        // A mirrored quad whose BL->TL edge is degenerately short must report
        // the user's actual mistake (mirrored corner order), not the
        // incidental short edge. The old check order reported EdgeTooShort.
        let quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(0.0, 1.0),
            Point::new(1.0, 1.0),
            Point::new(1.0e-10, 0.0),
        );
        assert_eq!(
            validate_quad(&quad).unwrap_err().code,
            ErrorCode::QuadOrientation
        );
    }

    #[test]
    fn translated_small_quad_preserves_area_and_validity() {
        let origin = 1.0e12;
        let quad = Quad::new(
            Point::new(origin, origin),
            Point::new(origin + 1.0, origin),
            Point::new(origin + 1.0, origin + 1.0),
            Point::new(origin, origin + 1.0),
        );
        let diagnostics = validate_quad(&quad).unwrap();
        assert_eq!(diagnostics.signed_area, 1.0);
        assert_eq!(diagnostics.edge_lengths, [1.0; 4]);
    }

    #[test]
    fn uniform_scale_does_not_change_validity() {
        for scale in [1.0e-9, 1.0, 1.0e9] {
            let quad = Quad::unit().map(|point| Point::new(point.x * scale, point.y * scale));
            assert!(validate_quad(&quad).is_ok());
        }
    }
}

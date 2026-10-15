//! Read-only authoring coordinates over a validated canonical mesh. The fit
//! stays piecewise affine; cubic controls use a local affine frame at their
//! fixed lattice anchor, since a fitted cubic control polygon is not a cubic.
#[cfg(feature = "deform")]
use crate::{ErrorCode, TransformError};
use crate::{Point, TransformResult, WarpMesh};
use std::collections::BTreeSet;

#[derive(Clone)]
pub(crate) struct Face {
    pub(crate) source: [Point; 3],
    pub(crate) target: [Point; 3],
}

pub struct MeshCoordinateMap {
    faces: Vec<Face>,
    edges: Vec<[Point; 2]>,
}

pub(crate) fn weights(triangle: [Point; 3], point: Point) -> [f64; 3] {
    // Valid indexed faces include thin slivers. Membership can be correct
    // while ordinary cross products lose several digits of their weights;
    // use the same precise determinant for both numerator and denominator.
    let denominator = orientation_value(triangle[0], triangle[1], triangle[2]);
    [
        orientation_value(triangle[1], triangle[2], point) / denominator,
        orientation_value(triangle[2], triangle[0], point) / denominator,
        orientation_value(triangle[0], triangle[1], point) / denominator,
    ]
}

pub(crate) fn blend(triangle: [Point; 3], weights: [f64; 3]) -> Point {
    Point::new(
        (0..3).map(|i| triangle[i].x * weights[i]).sum(),
        (0..3).map(|i| triangle[i].y * weights[i]).sum(),
    )
}

/// Validated faces are positively oriented. Test the sign of the actual
/// directed edge, not epsilon-expanded barycentric weights. The adaptive
/// predicate retains subtraction/product roundoff on uncertain edges: two
/// opposite edge evaluations must not both become negative through rounding.
/// An actual shared edge has agreeing affine images in its adjacent faces.
pub(crate) fn contains(triangle: [Point; 3], point: Point) -> bool {
    // Also bounds predicate arithmetic for arbitrary exterior authoring
    // queries. No edge computation is needed outside a face's exact box.
    point.x.is_finite()
        && point.y.is_finite()
        && [point.x, point.y]
            .into_iter()
            .enumerate()
            .all(|(axis, value)| {
                let coordinate = |p: Point| if axis == 0 { p.x } else { p.y };
                value
                    >= triangle
                        .map(coordinate)
                        .into_iter()
                        .fold(f64::INFINITY, f64::min)
                    && value
                        <= triangle
                            .map(coordinate)
                            .into_iter()
                            .fold(f64::NEG_INFINITY, f64::max)
            })
        && [(0, 1), (1, 2), (2, 0)]
            .into_iter()
            .all(|(a, b)| orientation(triangle[a], triangle[b], point) >= 0.0)
}

/// Sign of the f64-coordinate determinant. A fast filter handles ordinary
/// points. At cancellation, error-free differences and fused product tails
/// are summed as a bounded expansion (at most sixteen components), without
/// changing the geometry with a source-space epsilon or snapping the point.
pub(crate) fn orientation(a: Point, b: Point, p: Point) -> f64 {
    orientation_determinant(a, b, p, false)
}

/// Numeric determinant for proof distances and intersection ratios: a
/// sign-safe fast estimate is not sufficiently accurate near cancellation.
pub(crate) fn orientation_value(a: Point, b: Point, p: Point) -> f64 {
    orientation_determinant(a, b, p, true)
}

fn orientation_determinant(a: Point, b: Point, p: Point, precise: bool) -> f64 {
    let x = b.x - a.x;
    let y = b.y - a.y;
    let px = p.x - a.x;
    let py = p.y - a.y;
    let left = x * py;
    let right = y * px;
    let determinant = left - right;
    let sum = left.abs() + right.abs();
    // Standard orient2d forward-error filter; EPSILON is twice unit roundoff.
    let unit_roundoff = f64::EPSILON * 0.5;
    let bound = (3.0 + 16.0 * unit_roundoff) * unit_roundoff * sum;
    if !precise && determinant.abs() > bound {
        return determinant;
    }
    let difference = |first: f64, second: f64| {
        let head = first - second;
        let virtual_second = first - head;
        let tail = (first - (head + virtual_second)) + (virtual_second - second);
        [tail, head]
    };
    let mut expansion = [0.0; 16];
    let mut length = 0;
    for (first, second, sign) in [
        (difference(b.x, a.x), difference(p.y, a.y), 1.0),
        (difference(b.y, a.y), difference(p.x, a.x), -1.0),
    ] {
        for x in first {
            for y in second {
                let product = x * y;
                expansion_add(&mut expansion, &mut length, sign * x.mul_add(y, -product));
                expansion_add(&mut expansion, &mut length, sign * product);
            }
        }
    }
    if length == 0 {
        0.0
    } else {
        // The last component suffices for sign, not a relative-precision
        // value after cancellation. Sum the complete bounded expansion for
        // distances/ratios, retaining the leading sign on underflow.
        let value: f64 = expansion[..length].iter().sum();
        if value == 0.0 {
            expansion[length - 1]
        } else {
            value
        }
    }
}

fn expansion_add(expansion: &mut [f64; 16], length: &mut usize, value: f64) {
    let mut carry = value;
    let mut next_length = 0;
    for index in 0..*length {
        let component = expansion[index];
        let sum = carry + component;
        let virtual_component = sum - carry;
        let tail = (carry - (sum - virtual_component)) + (component - virtual_component);
        if tail != 0.0 {
            expansion[next_length] = tail;
            next_length += 1;
        }
        carry = sum;
    }
    if carry != 0.0 {
        expansion[next_length] = carry;
        next_length += 1;
    }
    *length = next_length;
}

/// Upper magnitude of a three-term linear combination. The crossing-curve
/// proof uses (3*control - 2*start - end)/3 rather than first rounding the
/// degree-elevated chord control to the same f64 and losing real curvature.
/// Six product components fit the same fixed expansion used by orientation.
pub(crate) fn linear_combination_abs_bound(terms: [(f64, f64); 3]) -> f64 {
    let mut expansion = [0.0; 16];
    let mut length = 0;
    for (value, weight) in terms {
        let product = value * weight;
        expansion_add(&mut expansion, &mut length, value.mul_add(weight, -product));
        expansion_add(&mut expansion, &mut length, product);
    }
    let mut bound = 0.0_f64;
    for &component in &expansion[..length] {
        if component != 0.0 {
            bound = (bound + component.abs()).next_up();
        }
    }
    bound
}

#[cfg(feature = "deform")]
fn finite(point: Point) -> TransformResult<()> {
    if point.x.is_finite() && point.y.is_finite() {
        Ok(())
    } else {
        Err(TransformError::new(
            ErrorCode::Schema,
            "mesh authoring point must be finite",
        ))
    }
}

impl MeshCoordinateMap {
    pub(crate) fn faces(&self) -> &[Face] {
        &self.faces
    }
    pub(crate) fn edges(&self) -> &[[Point; 2]] {
        &self.edges
    }
    pub fn new(mesh: &WarpMesh) -> TransformResult<Self> {
        mesh.validate_with_context("mesh authoring coordinates")?;
        let triangles = mesh.triangle_indices()?;
        let mut edges = BTreeSet::new();
        for &[a, b, c] in &triangles {
            for (a, b) in [(a, b), (b, c), (c, a)] {
                edges.insert((a.min(b), a.max(b)));
            }
        }
        let edges = edges
            .into_iter()
            .map(|(a, b)| [mesh.vertices[a].source, mesh.vertices[b].source])
            .collect();
        let faces = triangles
            .into_iter()
            .map(|face| Face {
                source: face.map(|i| mesh.vertices[i].source),
                target: face.map(|i| mesh.vertices[i].warped),
            })
            .collect();
        Ok(Self { faces, edges })
    }

    /// Exact declared-face forward/inverse lookup. Exterior points have no
    /// image coordinate; a concave notch must never snap to an unrelated face.
    #[cfg(feature = "deform")]
    pub fn map(&self, point: Point, inverse: bool) -> TransformResult<Option<Point>> {
        finite(point)?;
        for face in &self.faces {
            let (from, to) = if inverse {
                (face.target, face.source)
            } else {
                (face.source, face.target)
            };
            if contains(from, point) {
                let result = blend(to, weights(from, point));
                finite(result)?;
                return Ok(Some(result));
            }
        }
        Ok(None)
    }

    /// A cubic lattice control is a vector in a fixed local affine frame.
    /// Choosing the face at its unchanged nominal lattice anchor preserves
    /// outside-unit controls, exact inverse dragging and reopen stability.
    /// It does not extend the fit's image domain or alter rendered geometry.
    #[cfg(feature = "deform")]
    pub fn map_control(
        &self,
        point: Point,
        source_anchor: Point,
        inverse: bool,
    ) -> TransformResult<Point> {
        finite(point)?;
        finite(source_anchor)?;
        if !(0.0..=1.0).contains(&source_anchor.x) || !(0.0..=1.0).contains(&source_anchor.y) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mesh control anchor must be within the source square",
            ));
        }
        for face in &self.faces {
            if contains(face.source, source_anchor) {
                let (from, to) = if inverse {
                    (face.target, face.source)
                } else {
                    (face.source, face.target)
                };
                let result = blend(to, weights(from, point));
                finite(result)?;
                return Ok(result);
            }
        }
        Err(TransformError::new(
            ErrorCode::Schema,
            "mesh control anchor has no declared source face",
        ))
    }
}

#[cfg(all(test, feature = "deformation-work"))]
mod tests {
    use super::*;
    use crate::{MockupClipContour, MockupClipSegment, ShapeFitControls, resolve_shape_fit};

    fn concave() -> WarpMesh {
        resolve_shape_fit(&ShapeFitControls {
            contour: MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: [(1.0, 0.0), (1.0, 0.4), (0.4, 0.4), (0.4, 1.0), (0.0, 1.0)]
                    .into_iter()
                    .map(|(x, y)| MockupClipSegment::Line {
                        to: Point::new(x, y),
                    })
                    .collect(),
            },
            clip: None,
            corner_positions: None,
            refinement: None,
        })
        .unwrap()
        .mesh
    }

    #[test]
    fn exact_declared_faces_round_trip_and_notch_is_empty() {
        let mesh = concave();
        let map = MeshCoordinateMap::new(&mesh).unwrap();
        for face in mesh.triangle_indices().unwrap() {
            for w in [[0.2, 0.3, 0.5], [0.0, 0.5, 0.5], [1.0, 0.0, 0.0]] {
                let source = blend(face.map(|i| mesh.vertices[i].source), w);
                let target = blend(face.map(|i| mesh.vertices[i].warped), w);
                let actual = map.map(source, false).unwrap().unwrap();
                let replay = map.map(target, true).unwrap().unwrap();
                assert!((actual.x - target.x).hypot(actual.y - target.y) < 1e-9);
                assert!((replay.x - source.x).hypot(replay.y - source.y) < 1e-9);
            }
        }
        assert_eq!(map.map(Point::new(0.8, 0.8), true).unwrap(), None);
        assert_eq!(map.map(Point::new(-0.1, 0.5), false).unwrap(), None);
    }

    #[test]
    fn fixed_control_frames_keep_exterior_values_and_reopen_exactly() {
        let mesh = concave();
        let map = MeshCoordinateMap::new(&mesh).unwrap();
        let reopened = MeshCoordinateMap::new(&mesh).unwrap();
        for anchor in [
            Point::new(1.0 / 3.0, 2.0 / 3.0),
            Point::new(0.5, 0.5),
            Point::new(1.0, 0.0),
        ] {
            for point in [
                Point::new(-2.0, 3.0),
                Point::new(1.3, -0.4),
                Point::new(0.2, 0.4),
            ] {
                let target = map.map_control(point, anchor, false).unwrap();
                let back = reopened.map_control(target, anchor, true).unwrap();
                assert!((back.x - point.x).hypot(back.y - point.y) < 1e-8);
                assert_eq!(target, reopened.map_control(point, anchor, false).unwrap());
            }
        }
        assert!(
            map.map_control(Point::new(0.0, 0.0), Point::new(-0.1, 0.5), false)
                .is_err()
        );
        assert!(map.map(Point::new(f64::NAN, 0.0), false).is_err());
        assert_eq!(
            map.map_control(Point::new(f64::MAX, -f64::MAX), Point::new(0.5, 0.5), false)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
        // An unrepresentable exterior handle is a bounded per-call refusal,
        // not clamping or poisoning later ordinary authoring coordinates.
        let exterior = map
            .map_control(Point::new(-2.0, 3.0), Point::new(0.5, 0.5), false)
            .unwrap();
        let recovered = map
            .map_control(exterior, Point::new(0.5, 0.5), true)
            .unwrap();
        assert!((recovered.x + 2.0).hypot(recovered.y - 3.0) < 1e-8);
        let mut invalid = mesh;
        invalid.vertices[0].warped = Point::new(f64::INFINITY, 0.0);
        assert!(MeshCoordinateMap::new(&invalid).is_err());
    }
}

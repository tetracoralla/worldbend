//! Exact piecewise-affine composition. Intersect the interior's target faces
//! with the fitted mesh's source faces; do not sample the fit onto a new grid.
use crate::{
    ErrorCode, MeshBoundary, Point, TransformError, TransformResult, WarpMesh, WarpMeshTopology,
    WarpVertex,
};
use std::collections::BTreeMap;

const INTERSECTION_EPSILON: f64 = 1e-12;
const MERGE_DISTANCE: f64 = 1e-10;

fn invalid(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn area(a: Point, b: Point, c: Point) -> f64 {
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}
fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn blend(points: [Point; 3], w: [f64; 3]) -> Point {
    Point::new(
        (0..3).map(|i| points[i].x * w[i]).sum(),
        (0..3).map(|i| points[i].y * w[i]).sum(),
    )
}
fn square_edges(point: Point) -> Point {
    let exact = |v: f64| {
        if v.abs() <= INTERSECTION_EPSILON {
            0.0
        } else if (v - 1.0).abs() <= INTERSECTION_EPSILON {
            1.0
        } else {
            v
        }
    };
    Point::new(exact(point.x), exact(point.y))
}
fn weights(triangle: [Point; 3], point: Point) -> [f64; 3] {
    let denominator = area(triangle[0], triangle[1], triangle[2]);
    [
        area(triangle[1], triangle[2], point) / denominator,
        area(triangle[2], triangle[0], point) / denominator,
        area(triangle[0], triangle[1], point) / denominator,
    ]
}
fn append(points: &mut Vec<Point>, point: Point) {
    if points
        .last()
        .is_none_or(|&p| distance(p, point) > MERGE_DISTANCE)
    {
        points.push(point);
    }
}
fn intersect(subject: [Point; 3], clip: [Point; 3]) -> Vec<Point> {
    let mut polygon = subject.to_vec();
    for edge in 0..3 {
        if polygon.is_empty() {
            break;
        }
        let a = clip[edge];
        let b = clip[(edge + 1) % 3];
        let mut next = Vec::with_capacity(6);
        let mut previous = *polygon.last().expect("nonempty intersection");
        let mut previous_area = area(a, b, previous);
        for point in polygon {
            let current_area = area(a, b, point);
            let previous_inside = previous_area >= -INTERSECTION_EPSILON;
            let current_inside = current_area >= -INTERSECTION_EPSILON;
            if previous_inside != current_inside {
                let t = previous_area / (previous_area - current_area);
                append(
                    &mut next,
                    Point::new(
                        previous.x + (point.x - previous.x) * t,
                        previous.y + (point.y - previous.y) * t,
                    ),
                );
            }
            if current_inside {
                append(&mut next, point);
            }
            previous = point;
            previous_area = current_area;
        }
        if next.len() > 1 && distance(next[0], *next.last().expect("nonempty")) <= MERGE_DISTANCE {
            next.pop();
        }
        polygon = next;
    }
    polygon
}

struct VertexIndex {
    buckets: BTreeMap<(i64, i64), Vec<usize>>,
    intermediate: Vec<Point>,
    vertices: Vec<WarpVertex>,
    shading: Option<Vec<f64>>,
}
impl VertexIndex {
    fn insert(
        &mut self,
        intermediate: Point,
        vertex: WarpVertex,
        shade: f64,
    ) -> TransformResult<u16> {
        let key = (
            (intermediate.x / MERGE_DISTANCE).round() as i64,
            (intermediate.y / MERGE_DISTANCE).round() as i64,
        );
        for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(indices) = self.buckets.get(&(key.0 + dx, key.1 + dy)) {
                    for &i in indices {
                        if distance(self.intermediate[i], intermediate) <= MERGE_DISTANCE {
                            let existing = self.vertices[i];
                            if distance(existing.source, vertex.source) > 1e-8
                                || distance(existing.warped, vertex.warped) > 1e-8
                                || self
                                    .shading
                                    .as_ref()
                                    .is_some_and(|values| (values[i] - shade).abs() > 1e-8)
                            {
                                return Err(invalid(
                                    "shape fitting composition is discontinuous at a shared vertex",
                                ));
                            }
                            return Ok(i as u16);
                        }
                    }
                }
            }
        }
        if self.vertices.len() >= crate::warp_topology::MAX_INDEXED_MESH_VERTICES {
            return Err(invalid(
                "shape fitting composition exceeds the shared vertex bound",
            ));
        }
        let index = self.vertices.len();
        self.buckets.entry(key).or_default().push(index);
        self.intermediate.push(intermediate);
        self.vertices.push(vertex);
        if let Some(shading) = &mut self.shading {
            shading.push(shade);
        }
        Ok(index as u16)
    }
}

pub(crate) fn compose_shape_fit(interior: &WarpMesh, fit: &WarpMesh) -> TransformResult<WarpMesh> {
    if interior
        .vertices
        .iter()
        .any(|v| v.warped.x < 0.0 || v.warped.x > 1.0 || v.warped.y < 0.0 || v.warped.y > 1.0)
    {
        return Err(invalid(
            "shape fitting edits must stay inside the fitted domain",
        ));
    }
    interior.validate_with_context("shape fitting interior")?;
    fit.validate_with_context("shape fitting boundary")?;
    // Fixed and free authored grids both retain the canonical source square.
    // Free placement is already bounded to the fit map's unit source domain
    // by mesh validation; the triangle overlay preserves both maps exactly.
    if fit.shading.is_some() {
        return Err(invalid(
            "shape fitting requires an unshaded fitted boundary",
        ));
    }
    if interior.shading.is_none() && interior.vertices.iter().all(|v| v.source == v.warped) {
        return Ok(fit.clone());
    }
    let mut index = VertexIndex {
        buckets: BTreeMap::new(),
        intermediate: Vec::new(),
        vertices: Vec::new(),
        shading: interior.shading.as_ref().map(|_| Vec::new()),
    };
    let mut triangles = Vec::new();
    let fit_faces = fit.triangle_indices()?;
    for face in interior.triangle_indices()? {
        let inner = face.map(|i| interior.vertices[i]);
        let intermediate = inner.map(|v| v.warped);
        let source = inner.map(|v| v.source);
        let shades = interior
            .shading
            .as_ref()
            .map(|values| face.map(|i| values[i]));
        for &outer_face in &fit_faces {
            let outer = outer_face.map(|i| fit.vertices[i]);
            let outer_source = outer.map(|v| v.source);
            // Cheap AABB rejection keeps the bounded face-pair overlay useful
            // at the normal authoring densities.
            if (0..2).any(|axis| {
                let coordinate = |p: Point| if axis == 0 { p.x } else { p.y };
                let (imin, imax) = intermediate
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &p| {
                        (lo.min(coordinate(p)), hi.max(coordinate(p)))
                    });
                let (omin, omax) = outer_source
                    .iter()
                    .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &p| {
                        (lo.min(coordinate(p)), hi.max(coordinate(p)))
                    });
                imax < omin - INTERSECTION_EPSILON || omax < imin - INTERSECTION_EPSILON
            }) {
                continue;
            }
            let polygon = intersect(intermediate, outer_source);
            if polygon.len() < 3 {
                continue;
            }
            let polygon_area: f64 = (1..polygon.len() - 1)
                .map(|i| area(polygon[0], polygon[i], polygon[i + 1]))
                .sum();
            if polygon_area <= INTERSECTION_EPSILON {
                continue;
            }
            let mut ids = Vec::with_capacity(polygon.len());
            for &point in &polygon {
                let inner_weights = weights(intermediate, point);
                let outer_weights = weights(outer_source, point);
                let vertex = WarpVertex {
                    // The authored source boundary is exactly the square.
                    // Restore those canonical coordinates after floating
                    // barycentric arithmetic, without moving interior points.
                    source: square_edges(blend(source, inner_weights)),
                    warped: square_edges(blend(outer.map(|v| v.warped), outer_weights)),
                };
                let shade = shades.map_or(1.0, |values| {
                    (0..3).map(|i| values[i] * inner_weights[i]).sum()
                });
                ids.push(index.insert(point, vertex, shade)?);
            }
            for i in 1..ids.len() - 1 {
                if area(polygon[0], polygon[i], polygon[i + 1]) <= INTERSECTION_EPSILON {
                    continue;
                }
                if triangles.len() >= crate::warp_topology::MAX_INDEXED_MESH_TRIANGLES {
                    return Err(invalid(
                        "shape fitting composition exceeds the shared triangle bound",
                    ));
                }
                triangles.push([ids[0], ids[i], ids[i + 1]]);
            }
        }
    }
    let mesh = WarpMesh {
        topology: WarpMeshTopology::Triangles { triangles },
        vertices: index.vertices,
        boundary: MeshBoundary::Free,
        shading: index.shading,
    };
    mesh.validate_with_context("shape fitting composition")?;
    Ok(mesh)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MockupClipContour, MockupClipSegment, ShapeFitControls, resolve_shape_fit};

    fn interior(n: u16) -> WarpMesh {
        WarpMesh {
            topology: WarpMeshTopology::Grid { subdivisions: n },
            boundary: MeshBoundary::Fixed,
            shading: None,
            vertices: (0..=n)
                .flat_map(|y| {
                    (0..=n).map(move |x| {
                        let p =
                            Point::new(f64::from(x) / f64::from(n), f64::from(y) / f64::from(n));
                        WarpVertex {
                            source: p,
                            warped: p,
                        }
                    })
                })
                .collect(),
        }
    }
    fn fitted() -> WarpMesh {
        resolve_shape_fit(&ShapeFitControls {
            contour: MockupClipContour {
                start: Point::new(0.0, 0.0),
                segments: [
                    (1.0, 0.0),
                    (1.0, 1.0 / 3.0),
                    (0.6875, 1.0 / 3.0),
                    (0.6875, 1.0),
                    (0.0, 1.0),
                ]
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
    fn sample(mesh: &WarpMesh, point: Point) -> Point {
        crate::mockup_surface::sample_mesh(mesh, point).unwrap()
    }
    #[test]
    fn composes_the_actual_piecewise_maps_without_grid_resampling() {
        let fit = fitted();
        for n in [2, 4, 8, 12] {
            let mut inner = interior(n);
            let side = usize::from(n) + 1;
            let at = (usize::from(n) / 2) * side + usize::from(n) / 2;
            inner.vertices[at].warped = Point::new(0.52, 0.49);
            let composed = compose_shape_fit(&inner, &fit)
                .unwrap_or_else(|error| panic!("density {n}: {error:?}"));
            for y in 1..20 {
                for x in 1..20 {
                    let p = Point::new(f64::from(x) / 20.0, f64::from(y) / 20.0);
                    let expected = sample(&fit, sample(&inner, p));
                    assert!(
                        distance(sample(&composed, p), expected) < 1e-8,
                        "density {n}, point {p:?}"
                    );
                }
            }
        }
    }
    #[test]
    fn keeps_identity_topology_and_authored_vertex_shading() {
        let fit = fitted();
        let mut inner = interior(4);
        assert_eq!(compose_shape_fit(&inner, &fit).unwrap(), fit);
        inner.shading = Some(inner.vertices.iter().map(|v| 0.5 + v.source.x).collect());
        let composed = compose_shape_fit(&inner, &fit).unwrap();
        for (vertex, &shade) in composed
            .vertices
            .iter()
            .zip(composed.shading.as_ref().unwrap())
        {
            assert!((shade - (0.5 + vertex.source.x)).abs() < 1e-8);
        }
    }
}

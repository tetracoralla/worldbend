//! Bounded conforming triangle meshes. A single source-square boundary, an
//! oriented disk topology and positive source/target faces preserve a bijective
//! piecewise-linear mapping; a disconnected island or non-manifold fan cannot
//! pass merely by having individually positive triangles.
use crate::{
    ErrorCode, MeshBoundary, Point, TransformError, TransformResult, WarpMesh, WarpMeshTopology,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_INDEXED_MESH_VERTICES: usize = 2048;
pub const MAX_INDEXED_MESH_TRIANGLES: usize = 4096;
// Face overlays create legitimate subpixel slivers. Keep a numerical floor,
// rather than treating a positive face below a raster pixel as a fold.
const MIN_AREA: f64 = 1.0e-12;
type EdgeMap = BTreeMap<(usize, usize), Vec<(usize, usize, usize)>>;

fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

pub(crate) fn check_size(vertices: usize, triangles: usize) -> TransformResult<()> {
    if !(4..=MAX_INDEXED_MESH_VERTICES).contains(&vertices)
        || !(2..=MAX_INDEXED_MESH_TRIANGLES).contains(&triangles)
    {
        return Err(error(
            "indexed mesh exceeds its bounded vertex or triangle domain",
        ));
    }
    Ok(())
}

fn edges(mesh: &WarpMesh) -> TransformResult<EdgeMap> {
    let WarpMeshTopology::Triangles { triangles } = &mesh.topology else {
        return Err(error("indexed mesh topology is required"));
    };
    check_size(mesh.vertices.len(), triangles.len())?;
    let mut edges = EdgeMap::new();
    let mut faces = BTreeSet::new();
    for (face, triangle) in triangles.iter().enumerate() {
        let [a, b, c] = triangle.map(usize::from);
        if a == b || b == c || a == c || [a, b, c].iter().any(|&i| i >= mesh.vertices.len()) {
            return Err(error(
                "indexed mesh triangle has a repeated or missing vertex",
            ));
        }
        let mut sorted = [a, b, c];
        sorted.sort_unstable();
        if !faces.insert(sorted) {
            return Err(error("indexed mesh repeats a triangle"));
        }
        for (from, to) in [(a, b), (b, c), (c, a)] {
            let adjacent = edges.entry((from.min(to), from.max(to))).or_default();
            adjacent.push((from, to, face));
            if adjacent.len() > 2 {
                return Err(error("indexed mesh has a non-manifold edge"));
            }
        }
    }
    for adjacent in edges.values() {
        if adjacent.len() == 2 && (adjacent[0].0 != adjacent[1].1 || adjacent[0].1 != adjacent[1].0)
        {
            return Err(error(
                "indexed mesh interior faces must use opposite edge directions",
            ));
        }
    }
    Ok(edges)
}

fn ring(edges: &EdgeMap) -> TransformResult<Vec<usize>> {
    let mut outgoing = BTreeMap::new();
    let mut incoming = BTreeSet::new();
    for adjacent in edges.values().filter(|v| v.len() == 1) {
        let (a, b, _) = adjacent[0];
        if outgoing.insert(a, b).is_some() || !incoming.insert(b) {
            return Err(error("indexed mesh boundary is non-manifold"));
        }
    }
    let Some(&start) = outgoing.keys().next() else {
        return Err(error("indexed mesh must have a boundary"));
    };
    let mut result = vec![start];
    let mut visited = BTreeSet::from([start]);
    let mut at = start;
    loop {
        at = *outgoing
            .get(&at)
            .ok_or_else(|| error("indexed mesh boundary is open"))?;
        if at == start {
            break;
        }
        if !visited.insert(at) {
            return Err(error("indexed mesh boundary is not one closed ring"));
        }
        result.push(at);
    }
    if result.len() != outgoing.len() {
        return Err(error(
            "indexed mesh must contain one connected boundary without holes",
        ));
    }
    Ok(result)
}

pub(crate) fn boundary_indices(mesh: &WarpMesh) -> TransformResult<Vec<usize>> {
    ring(&edges(mesh)?)
}

pub(crate) fn validate(mesh: &WarpMesh, context: &str) -> TransformResult<()> {
    let edges = edges(mesh)?;
    let boundary = ring(&edges)?;
    let WarpMeshTopology::Triangles { triangles } = &mesh.topology else {
        unreachable!()
    };
    if mesh.vertices.len() + triangles.len() != edges.len() + 1 {
        return Err(error("indexed mesh topology must be a triangulated disk"));
    }
    if let Some(shading) = &mesh.shading
        && (shading.len() != mesh.vertices.len()
            || shading
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=2.0).contains(v)))
    {
        return Err(error(
            "mesh shading must contain one finite 0..2 multiplier per vertex",
        ));
    }
    let boundary_set: BTreeSet<_> = boundary.iter().copied().collect();
    for (index, vertex) in mesh.vertices.iter().enumerate() {
        if !unit(vertex.source)
            || !finite(vertex.warped)
            || (mesh.boundary == MeshBoundary::Free && !unit(vertex.warped))
        {
            return Err(error(
                "indexed mesh vertices must have finite unit-square sources and bounded placement",
            ));
        }
        if !boundary_set.contains(&index)
            && (vertex.source.x == 0.0
                || vertex.source.x == 1.0
                || vertex.source.y == 0.0
                || vertex.source.y == 1.0)
        {
            return Err(error(
                "indexed mesh interior sources must be strictly inside the square",
            ));
        }
        if boundary_set.contains(&index)
            && mesh.boundary == MeshBoundary::Fixed
            && vertex.source != vertex.warped
        {
            return Err(error("warp mesh boundary vertices must stay fixed"));
        }
    }
    validate_source_boundary(mesh, &boundary)?;
    let target: Vec<_> = boundary.iter().map(|&i| mesh.vertices[i].warped).collect();
    for i in 0..target.len() {
        let a = target[i];
        let b = target[(i + 1) % target.len()];
        let c = target[(i + 2) % target.len()];
        if area(a, b, c).abs() <= 1e-12
            && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0.0
        {
            return Err(error("indexed mesh boundary doubles back on itself"));
        }
        for j in i + 1..target.len() {
            if j == i + 1 || (i == 0 && j == target.len() - 1) {
                continue;
            }
            if crate::warp::segments_touch(a, b, target[j], target[(j + 1) % target.len()]) {
                return Err(error("free mesh boundary crosses or touches itself"));
            }
        }
    }
    let mut links: Vec<BTreeMap<usize, Vec<usize>>> = vec![BTreeMap::new(); mesh.vertices.len()];
    let mut source_area = 0.0;
    for triangle in triangles {
        let [a, b, c] = triangle.map(usize::from);
        let s = [a, b, c].map(|i| mesh.vertices[i].source);
        let w = [a, b, c].map(|i| mesh.vertices[i].warped);
        let source = area(s[0], s[1], s[2]);
        let warped_area = area(w[0], w[1], w[2]);
        if source <= MIN_AREA || warped_area <= MIN_AREA {
            return Err(error(&format!(
                "{context} folds or collapses the bounded mesh"
            )).with_details(json!({"triangle":triangle,"sourceArea":source,"warpedArea":warped_area,"minimumArea":MIN_AREA})));
        }
        source_area += source;
        for (vertex, left, right) in [(a, b, c), (b, c, a), (c, a, b)] {
            links[vertex].entry(left).or_default().push(right);
            links[vertex].entry(right).or_default().push(left);
        }
    }
    if (source_area - 1.0).abs() > 1e-8 {
        return Err(error(
            "indexed mesh sources must cover the unit square exactly once",
        ));
    }
    for (index, link) in links.iter().enumerate() {
        if link.is_empty() {
            return Err(error("indexed mesh contains an unused vertex"));
        }
        let ends = link.values().filter(|v| v.len() == 1).count();
        if link.values().any(|v| v.is_empty() || v.len() > 2)
            || ends != if boundary_set.contains(&index) { 2 } else { 0 }
        {
            return Err(error("indexed mesh vertex fan is non-manifold"));
        }
        let mut visited = BTreeSet::new();
        let mut pending = vec![*link.keys().next().expect("nonempty link")];
        while let Some(at) = pending.pop() {
            if visited.insert(at) {
                pending.extend(&link[&at]);
            }
        }
        if visited.len() != link.len() {
            return Err(error("indexed mesh vertex fan is disconnected"));
        }
    }
    Ok(())
}

fn validate_source_boundary(mesh: &WarpMesh, boundary: &[usize]) -> TransformResult<()> {
    let points: Vec<_> = boundary.iter().map(|&i| mesh.vertices[i].source).collect();
    let corners = [
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ];
    if corners.iter().any(|p| !points.contains(p)) {
        return Err(error(
            "indexed mesh source boundary must retain all square corners",
        ));
    }
    let start = points
        .iter()
        .position(|p| *p == corners[0])
        .expect("corner checked");
    let parameter = |p: Point| -> Option<f64> {
        if p.y == 0.0 {
            Some(p.x)
        } else if p.x == 1.0 {
            Some(1.0 + p.y)
        } else if p.y == 1.0 {
            Some(3.0 - p.x)
        } else if p.x == 0.0 {
            Some(4.0 - p.y)
        } else {
            None
        }
    };
    let mut previous = 0.0;
    for offset in 1..points.len() {
        let a = points[(start + offset - 1) % points.len()];
        let b = points[(start + offset) % points.len()];
        let t =
            parameter(b).ok_or_else(|| error("indexed mesh source boundary leaves the square"))?;
        if t <= previous || !square_edge(a, b) {
            return Err(error(
                "indexed mesh source boundary must traverse the square once in order",
            ));
        }
        previous = t;
    }
    if !square_edge(
        points[(start + points.len() - 1) % points.len()],
        points[start],
    ) {
        return Err(error("indexed mesh source boundary skips a square corner"));
    }
    Ok(())
}
fn square_edge(a: Point, b: Point) -> bool {
    (a.x == b.x && (a.x == 0.0 || a.x == 1.0)) || (a.y == b.y && (a.y == 0.0 || a.y == 1.0))
}
fn finite(p: Point) -> bool {
    p.x.is_finite() && p.y.is_finite()
}
fn unit(p: Point) -> bool {
    finite(p) && (0.0..=1.0).contains(&p.x) && (0.0..=1.0).contains(&p.y)
}
fn area(a: Point, b: Point, c: Point) -> f64 {
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WarpVertex;

    fn concave() -> WarpMesh {
        let sources = [
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, 0.5),
            (1.0, 1.0),
            (0.0, 1.0),
            (0.4, 0.5),
        ];
        let targets = [
            (0.0, 0.0),
            (1.0, 0.0),
            (0.65, 0.5),
            (1.0, 1.0),
            (0.0, 1.0),
            (0.3, 0.5),
        ];
        WarpMesh {
            topology: WarpMeshTopology::Triangles {
                triangles: vec![[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 4, 5], [4, 0, 5]],
            },
            vertices: sources
                .into_iter()
                .zip(targets)
                .map(|((x, y), (u, v))| WarpVertex {
                    source: Point::new(x, y),
                    warped: Point::new(u, v),
                })
                .collect(),
            boundary: MeshBoundary::Free,
            shading: None,
        }
    }

    #[test]
    fn preserves_declared_concave_topology_and_round_trips_without_grid_dimensions() {
        let mesh = concave();
        mesh.validate().unwrap();
        assert_eq!(mesh.boundary_points().len(), 5);
        assert_eq!(mesh.triangle_indices().unwrap().len(), 5);
        assert!(mesh.vertex(0, 0).is_none());
        let value = serde_json::to_value(&mesh).unwrap();
        assert!(value.get("subdivisions").is_none());
        assert_eq!(serde_json::from_value::<WarpMesh>(value).unwrap(), mesh);
        let old = WarpMesh::identity();
        assert!(old.vertex(17, 0).is_none());
        assert!(old.vertex(0, 17).is_none());
        let value = serde_json::to_value(&old).unwrap();
        assert_eq!(value["subdivisions"], 16);
        assert!(value.get("triangles").is_none());
        assert!(value.get("topology").is_none());
        assert_eq!(serde_json::from_value::<WarpMesh>(value).unwrap(), old);
    }

    #[cfg(feature = "place")]
    #[test]
    fn projected_guides_follow_the_declared_indexed_faces() {
        let mesh = concave();
        mesh.validate().unwrap();
        let point = crate::mockup_surface::sample_mesh(&mesh, Point::new(0.4, 0.5)).unwrap();
        assert!((point.x - 0.3).abs() < 1e-12 && (point.y - 0.5).abs() < 1e-12);
    }

    #[test]
    fn rejects_mixed_topology_and_unknown_fields_instead_of_ignoring_them() {
        let mut value = serde_json::to_value(concave()).unwrap();
        value["subdivisions"] = serde_json::json!(4);
        assert!(serde_json::from_value::<WarpMesh>(value).is_err());
        let mut value = serde_json::to_value(WarpMesh::identity()).unwrap();
        value["unrecognizedTopology"] = serde_json::json!([]);
        assert!(serde_json::from_value::<WarpMesh>(value).is_err());
    }

    #[test]
    fn rejects_damaged_faces_coverage_folds_and_vertex_sources() {
        for mutation in 0..9 {
            let mut mesh = concave();
            let WarpMeshTopology::Triangles { triangles } = &mut mesh.topology else {
                unreachable!()
            };
            match mutation {
                0 => triangles[0][0] = u16::MAX,
                1 => triangles[0][0] = triangles[0][1],
                2 => triangles.push(triangles[0]),
                3 => triangles.pop().map(|_| ()).unwrap(),
                4 => triangles[0].swap(0, 1),
                5 => mesh.vertices.push(mesh.vertices[5]),
                6 => mesh.vertices[5].warped = Point::new(0.9, 0.5),
                7 => mesh.vertices[5].source = Point::new(0.0, 0.5),
                8 => mesh.vertices[3].source = Point::new(0.95, 1.0),
                _ => unreachable!(),
            }
            assert_eq!(
                mesh.validate().unwrap_err().code,
                ErrorCode::Schema,
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn fixed_boundary_and_shading_follow_the_same_vertex_topology() {
        let mut mesh = concave();
        mesh.shading = Some(vec![1.0; mesh.vertices.len()]);
        mesh.validate().unwrap();
        mesh.shading.as_mut().unwrap().pop();
        assert!(mesh.validate().is_err());
        mesh.shading = None;
        mesh.boundary = MeshBoundary::Fixed;
        assert!(mesh.validate().is_err());
        for v in &mut mesh.vertices {
            v.warped = v.source;
        }
        mesh.validate().unwrap();
    }

    #[test]
    fn rejects_oversized_topology_before_building_adjacency() {
        let mut mesh = concave();
        mesh.vertices
            .resize(MAX_INDEXED_MESH_VERTICES + 1, mesh.vertices[5]);
        assert!(mesh.validate().unwrap_err().message.contains("bounded"));
        assert!(mesh.triangle_indices().is_err());
    }
}

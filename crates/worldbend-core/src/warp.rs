use crate::{ErrorCode, Point, TransformError, TransformResult};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// Presets resolve to the regular grid shared by native and Web renderers.
/// Presets may change their formula only with a schema/version review; adapters
/// consume these vertices and never derive their own deformation.
pub const WARP_MESH_SUBDIVISIONS: u16 = 16;
pub const MIN_CUSTOM_MESH_SUBDIVISIONS: u16 = 2;
pub const MAX_CUSTOM_MESH_SUBDIVISIONS: u16 = 16;
const MAX_ABS_WARP_AMOUNT: f64 = 1.0;
const MIN_TRIANGLE_AREA: f64 = 1.0e-8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum WarpPreset {
    Arc,
    Arch,
    Flag,
    Wave,
    Fish,
    Rise,
    Fisheye,
    Inflate,
    Squeeze,
    Twist,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WarpSpec {
    pub preset: WarpPreset,
    /// Signed preset strength. Zero is identity; the closed supported domain
    /// is [-1, 1]. Negative values reverse the preset's direction.
    #[schemars(schema_with = "warp_amount_schema")]
    pub amount: f64,
}

fn warp_amount_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "minimum": -MAX_ABS_WARP_AMOUNT,
        "maximum": MAX_ABS_WARP_AMOUNT
    })
}

impl WarpSpec {
    pub fn validate(self) -> TransformResult<Self> {
        if !self.amount.is_finite() {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "warp amount must be finite",
            ));
        }
        if self.amount.abs() > MAX_ABS_WARP_AMOUNT {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "warp amount must be between -1 and 1 inclusive",
            ));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WarpVertex {
    pub source: Point,
    pub warped: Point,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarpMesh {
    #[serde(flatten)]
    pub topology: WarpMeshTopology,
    pub vertices: Vec<WarpVertex>,
    #[serde(default, skip_serializing_if = "MeshBoundary::is_fixed")]
    pub boundary: MeshBoundary,
    /// Per-vertex multiplier of encoded, premultiplied RGB; alpha is unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shading: Option<Vec<f64>>,
}

/// The source square can use a regular grid or a conforming triangulation.
/// Indexed triangles retain concave fits without resampling them into a grid.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum WarpMeshTopology {
    Grid { subdivisions: u16 },
    Triangles { triangles: Vec<[u16; 3]> },
}

#[derive(Deserialize, JsonSchema)]
#[serde(untagged)]
enum WireWarpMesh {
    Grid(GridWarpMesh),
    Triangles(TriangleWarpMesh),
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GridWarpMesh {
    subdivisions: u16,
    vertices: Vec<WarpVertex>,
    #[serde(default)]
    boundary: MeshBoundary,
    #[serde(default)]
    shading: Option<Vec<f64>>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TriangleWarpMesh {
    #[schemars(length(min = 2, max = 4096))]
    triangles: Vec<[u16; 3]>,
    #[schemars(length(min = 4, max = 2048))]
    vertices: Vec<WarpVertex>,
    #[serde(default)]
    boundary: MeshBoundary,
    #[serde(default)]
    shading: Option<Vec<f64>>,
}

impl<'de> Deserialize<'de> for WarpMesh {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match WireWarpMesh::deserialize(deserializer)? {
            WireWarpMesh::Grid(mesh) => Self {
                topology: WarpMeshTopology::Grid {
                    subdivisions: mesh.subdivisions,
                },
                vertices: mesh.vertices,
                boundary: mesh.boundary,
                shading: mesh.shading,
            },
            WireWarpMesh::Triangles(mesh) => Self {
                topology: WarpMeshTopology::Triangles {
                    triangles: mesh.triangles,
                },
                vertices: mesh.vertices,
                boundary: mesh.boundary,
                shading: mesh.shading,
            },
        })
    }
}

impl JsonSchema for WarpMesh {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "WarpMesh".into()
    }
    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        WireWarpMesh::json_schema(generator)
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MeshBoundary {
    #[default]
    Fixed,
    Free,
}

impl MeshBoundary {
    pub(crate) fn is_fixed(&self) -> bool {
        *self == Self::Fixed
    }
}

pub const MAX_SURFACE_MESH_SUBDIVISIONS: u16 = 32;

impl WarpMesh {
    pub fn grid_subdivisions(&self) -> Option<u16> {
        match self.topology {
            WarpMeshTopology::Grid { subdivisions } => Some(subdivisions),
            WarpMeshTopology::Triangles { .. } => None,
        }
    }

    /// Renderer topology after validation; source and target use the same faces.
    pub fn triangle_indices(&self) -> TransformResult<Vec<[usize; 3]>> {
        match &self.topology {
            WarpMeshTopology::Triangles { triangles } => {
                crate::warp_topology::check_size(self.vertices.len(), triangles.len())?;
                Ok(triangles.iter().map(|t| t.map(usize::from)).collect())
            }
            WarpMeshTopology::Grid { subdivisions } => {
                if !(MIN_CUSTOM_MESH_SUBDIVISIONS..=MAX_SURFACE_MESH_SUBDIVISIONS)
                    .contains(subdivisions)
                {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "mesh resolution is outside its bounded carrier domain",
                    ));
                }
                let n = usize::from(*subdivisions);
                let side = n + 1;
                let mut triangles = Vec::with_capacity(n * n * 2);
                for y in 0..n {
                    for x in 0..n {
                        let tl = y * side + x;
                        triangles
                            .extend([[tl, tl + 1, tl + side + 1], [tl, tl + side + 1, tl + side]]);
                    }
                }
                Ok(triangles)
            }
        }
    }
    pub fn identity() -> Self {
        build_mesh(None).expect("identity mesh is valid")
    }

    /// Bounds-checked vertex access. Prefer `validate` once and index the
    /// `vertices` slice directly in hot loops; this accessor exists so
    /// unvalidated callers cannot panic.
    pub fn vertex(&self, x: u16, y: u16) -> Option<WarpVertex> {
        let n = self.grid_subdivisions()?;
        if x > n || y > n {
            return None;
        }
        let width = usize::from(n) + 1;
        let index = usize::from(y) * width + usize::from(x);
        self.vertices.get(index).copied()
    }

    /// Full cross-field validation for meshes built outside `build_warp_mesh`
    /// (for example deserialized from a carrier). A malformed mesh must surface
    /// a stable schema error, never an index panic deeper in the pipeline.
    pub fn validate(&self) -> TransformResult<()> {
        self.validate_with_context("warp preset")
    }

    /// Same validation with the owning contract named in the fold message, so
    /// layered deformations report which surface folded instead of claiming a
    /// preset was applied.
    pub fn validate_with_context(&self, context: &str) -> TransformResult<()> {
        let Some(subdivisions_count) = self.grid_subdivisions() else {
            return crate::warp_topology::validate(self, context);
        };
        let maximum = if self.boundary == MeshBoundary::Free {
            MAX_SURFACE_MESH_SUBDIVISIONS
        } else {
            MAX_CUSTOM_MESH_SUBDIVISIONS
        };
        if subdivisions_count < MIN_CUSTOM_MESH_SUBDIVISIONS || subdivisions_count > maximum {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mesh resolution is outside its bounded carrier domain",
            ));
        }
        let side = usize::from(subdivisions_count) + 1;
        let Some(expected_vertices) = side.checked_mul(side) else {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "warp mesh vertex count is not representable",
            ));
        };
        if self.vertices.len() != expected_vertices {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "warp mesh vertex count does not match its subdivisions",
            )
            .with_details(json!({
                "expected": side, "expectedVertices": expected_vertices,
                "actual": self.vertices.len(),
            })));
        }
        if let Some(shading) = &self.shading
            && (shading.len() != expected_vertices
                || shading
                    .iter()
                    .any(|value| !value.is_finite() || !(0.0..=2.0).contains(value)))
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mesh shading must contain one finite 0..2 multiplier per vertex",
            ));
        }
        let subdivisions = f64::from(subdivisions_count);
        for y in 0..side {
            for x in 0..side {
                let vertex = self.vertices[y * side + x];
                let expected = Point::new((x as f64) / subdivisions, (y as f64) / subdivisions);
                if vertex.source != expected {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "warp mesh source grid does not match its subdivisions",
                    ));
                }
                if !finite_point(vertex.source) || !finite_point(vertex.warped) {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "warp mesh contains a non-finite point",
                    ));
                }
                if self.boundary == MeshBoundary::Free
                    && (!(0.0..=1.0).contains(&vertex.warped.x)
                        || !(0.0..=1.0).contains(&vertex.warped.y))
                {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "free mesh vertices must stay inside the unit placement bounds",
                    ));
                }
            }
        }
        for index in 0..self.vertices.len() {
            let vertex = self.vertices[index];
            let x = index % side;
            let y = index / side;
            if self.boundary == MeshBoundary::Fixed
                && (x == 0 || x == side - 1 || y == 0 || y == side - 1)
                && vertex.source != vertex.warped
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "warp mesh boundary vertices must stay fixed",
                ));
            }
        }
        for y in 0..subdivisions_count {
            for x in 0..subdivisions_count {
                let tl = self.vertex(x, y).expect("length validated above").warped;
                let tr = self
                    .vertex(x + 1, y)
                    .expect("length validated above")
                    .warped;
                let br = self
                    .vertex(x + 1, y + 1)
                    .expect("length validated above")
                    .warped;
                let bl = self
                    .vertex(x, y + 1)
                    .expect("length validated above")
                    .warped;
                for area in [
                    signed_triangle_area(tl, tr, br),
                    signed_triangle_area(tl, br, bl),
                ] {
                    if area <= MIN_TRIANGLE_AREA {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            format!("{context} folds or collapses the bounded mesh"),
                        ));
                    }
                }
            }
        }
        if self.boundary == MeshBoundary::Free {
            let ring = self.boundary_points();
            for i in 0..ring.len() {
                for j in (i + 1)..ring.len() {
                    if j == i + 1 || (i == 0 && j == ring.len() - 1) {
                        continue;
                    }
                    if segments_touch(
                        ring[i],
                        ring[(i + 1) % ring.len()],
                        ring[j],
                        ring[(j + 1) % ring.len()],
                    ) {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "free mesh boundary crosses or touches itself",
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    /// Clockwise outline, without repeating its first vertex; call after validation.
    pub fn boundary_points(&self) -> Vec<Point> {
        let Some(n) = self.grid_subdivisions() else {
            return crate::warp_topology::boundary_indices(self)
                .unwrap_or_default()
                .into_iter()
                .filter_map(|i| self.vertices.get(i).map(|v| v.warped))
                .collect();
        };
        (0..n)
            .map(|x| (x, 0))
            .chain((0..n).map(|y| (n, y)))
            .chain((1..=n).rev().map(|x| (x, n)))
            .chain((1..=n).rev().map(|y| (0, y)))
            .filter_map(|(x, y)| self.vertex(x, y).map(|v| v.warped))
            .collect()
    }
}

pub(crate) fn segments_touch(a: Point, b: Point, c: Point, d: Point) -> bool {
    if a.x.max(b.x) < c.x.min(d.x)
        || c.x.max(d.x) < a.x.min(b.x)
        || a.y.max(b.y) < c.y.min(d.y)
        || c.y.max(d.y) < a.y.min(b.y)
    {
        return false;
    }
    let orient = |a, b, c| signed_triangle_area(a, b, c);
    orient(a, b, c) * orient(a, b, d) <= 0.0 && orient(c, d, a) * orient(c, d, b) <= 0.0
}

fn finite_point(point: Point) -> bool {
    point.x.is_finite() && point.y.is_finite()
}

/// Build the single bounded deformation mesh used by every raster adapter.
/// The mesh keeps the unit-square boundary fixed, which preserves the
/// TransformSpec destination/canvas contract and makes out-of-mesh samples
/// unambiguously transparent.
pub fn build_warp_mesh(warp: Option<WarpSpec>) -> TransformResult<WarpMesh> {
    build_mesh(warp.map(WarpSpec::validate).transpose()?)
}

fn build_mesh(warp: Option<WarpSpec>) -> TransformResult<WarpMesh> {
    let subdivisions = WARP_MESH_SUBDIVISIONS;
    let side = usize::from(subdivisions) + 1;
    let mut vertices = Vec::with_capacity(side * side);
    for y in 0..=subdivisions {
        for x in 0..=subdivisions {
            let source = Point::new(
                f64::from(x) / f64::from(subdivisions),
                f64::from(y) / f64::from(subdivisions),
            );
            let warped = warp.map_or(source, |value| warp_point(source, value));
            if !warped.x.is_finite() || !warped.y.is_finite() {
                return Err(TransformError::new(
                    ErrorCode::HomographySingular,
                    "warp mesh contains an unrepresentable point",
                ));
            }
            vertices.push(WarpVertex { source, warped });
        }
    }
    let mesh = WarpMesh {
        boundary: Default::default(),
        shading: None,
        topology: WarpMeshTopology::Grid { subdivisions },
        vertices,
    };
    mesh.validate()?;
    Ok(mesh)
}

fn signed_triangle_area(a: Point, b: Point, c: Point) -> f64 {
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}

fn warp_point(point: Point, warp: WarpSpec) -> Point {
    if warp.amount == 0.0 || on_boundary(point) {
        return point;
    }
    let x = point.x * 2.0 - 1.0;
    let y = point.y * 2.0 - 1.0;
    let edge_x = 1.0 - x * x;
    let edge_y = 1.0 - y * y;
    let a = warp.amount;
    let (next_x, next_y) = match warp.preset {
        WarpPreset::Arc => (x, y - 0.34 * a * edge_x * edge_y),
        WarpPreset::Arch => (x, y - 0.28 * a * edge_x * edge_y * (1.0 - 0.45 * y)),
        WarpPreset::Flag => (x, y + 0.24 * a * (std::f64::consts::PI * x).sin() * edge_y),
        WarpPreset::Wave => (
            x,
            y + 0.18 * a * (std::f64::consts::TAU * point.x).sin() * edge_y,
        ),
        WarpPreset::Fish => (x + 0.24 * a * x * edge_x * edge_y, y),
        WarpPreset::Rise => (x, y - 0.25 * a * point.x * edge_x * edge_y),
        WarpPreset::Fisheye => {
            let radial = 0.22 * a * edge_x * edge_y;
            (x + x * radial, y + y * radial)
        }
        WarpPreset::Inflate => (
            x + 0.20 * a * x * edge_x * edge_y,
            y + 0.20 * a * y * edge_x * edge_y,
        ),
        WarpPreset::Squeeze => (
            x - 0.20 * a * x * edge_x * edge_y,
            y - 0.20 * a * y * edge_x * edge_y,
        ),
        WarpPreset::Twist => {
            let angle = 0.48 * a * edge_x * edge_y;
            let (sin, cos) = angle.sin_cos();
            (x * cos - y * sin, x * sin + y * cos)
        }
    };
    Point::new((next_x + 1.0) * 0.5, (next_y + 1.0) * 0.5)
}

fn on_boundary(point: Point) -> bool {
    point.x == 0.0 || point.x == 1.0 || point.y == 0.0 || point.y == 1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRESETS: [WarpPreset; 10] = [
        WarpPreset::Arc,
        WarpPreset::Arch,
        WarpPreset::Flag,
        WarpPreset::Wave,
        WarpPreset::Fish,
        WarpPreset::Rise,
        WarpPreset::Fisheye,
        WarpPreset::Inflate,
        WarpPreset::Squeeze,
        WarpPreset::Twist,
    ];

    #[test]
    fn every_preset_is_fold_free_across_the_supported_amount_domain() {
        for preset in PRESETS {
            for step in -40..=40 {
                let amount = f64::from(step) / 40.0;
                let mesh = build_warp_mesh(Some(WarpSpec { preset, amount })).unwrap();
                assert_eq!(mesh.grid_subdivisions(), Some(WARP_MESH_SUBDIVISIONS));
                assert_eq!(mesh.vertices.len(), 17 * 17);
            }
        }
    }

    #[test]
    fn zero_amount_is_byte_equivalent_to_identity() {
        let identity = WarpMesh::identity();
        for preset in PRESETS {
            assert_eq!(
                build_warp_mesh(Some(WarpSpec {
                    preset,
                    amount: 0.0
                }))
                .unwrap(),
                identity
            );
        }
    }

    #[test]
    fn presets_keep_the_unit_boundary_fixed() {
        for preset in PRESETS {
            let mesh = build_warp_mesh(Some(WarpSpec {
                preset,
                amount: 1.0,
            }))
            .unwrap();
            let subdivisions = mesh.grid_subdivisions().unwrap();
            for index in 0..=subdivisions {
                let top = mesh.vertex(index, 0).unwrap();
                let bottom = mesh.vertex(index, subdivisions).unwrap();
                let left = mesh.vertex(0, index).unwrap();
                let right = mesh.vertex(subdivisions, index).unwrap();
                assert_eq!(top.source, top.warped);
                assert_eq!(bottom.source, bottom.warped);
                assert_eq!(left.source, left.warped);
                assert_eq!(right.source, right.warped);
            }
        }
    }

    #[test]
    fn malformed_meshes_validate_to_stable_errors_not_panics() {
        let valid = build_warp_mesh(Some(WarpSpec {
            preset: WarpPreset::Arc,
            amount: 0.5,
        }))
        .unwrap();

        let mut truncated = valid.clone();
        truncated.vertices.truncate(truncated.vertices.len() - 1);
        assert_eq!(truncated.validate().unwrap_err().code, ErrorCode::Schema);

        let mut folded = valid.clone();
        let interior = folded.vertices.len() / 2 + 1;
        folded.vertices[interior].warped = folded.vertices[interior].source;
        assert_eq!(folded.validate().unwrap_err().code, ErrorCode::Schema);

        let mut moved_boundary = valid.clone();
        moved_boundary.vertices[1].warped.x += 0.25;
        assert_eq!(
            moved_boundary.validate().unwrap_err().code,
            ErrorCode::Schema
        );

        let mut non_finite = valid.clone();
        let middle = non_finite.vertices.len() / 2;
        non_finite.vertices[middle].warped.x = f64::NAN;
        assert_eq!(non_finite.validate().unwrap_err().code, ErrorCode::Schema);

        let mut zero_subdivisions = valid;
        zero_subdivisions.topology = WarpMeshTopology::Grid { subdivisions: 0 };
        assert_eq!(
            zero_subdivisions.validate().unwrap_err().code,
            ErrorCode::Schema
        );

        let mut custom_subdivisions = WarpMesh::identity();
        custom_subdivisions.topology = WarpMeshTopology::Grid { subdivisions: 2 };
        custom_subdivisions.vertices.truncate(9);
        assert_eq!(
            custom_subdivisions.validate().unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn amount_domain_is_closed_and_finite() {
        assert!(
            WarpSpec {
                preset: WarpPreset::Arc,
                amount: -1.0
            }
            .validate()
            .is_ok()
        );
        assert!(
            WarpSpec {
                preset: WarpPreset::Arc,
                amount: 1.0
            }
            .validate()
            .is_ok()
        );
        assert_eq!(
            WarpSpec {
                preset: WarpPreset::Arc,
                amount: 1.000_001
            }
            .validate()
            .unwrap_err()
            .code,
            ErrorCode::Schema
        );
        assert_eq!(
            WarpSpec {
                preset: WarpPreset::Arc,
                amount: f64::NAN
            }
            .validate()
            .unwrap_err()
            .code,
            ErrorCode::NonFiniteCoordinate
        );
    }
}

use crate::{ErrorCode, Point, TransformError, TransformResult};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;

/// The fixed grid is the canonical carrier shared by native and Web renderers.
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WarpMesh {
    pub subdivisions: u16,
    pub vertices: Vec<WarpVertex>,
}

impl WarpMesh {
    pub fn identity() -> Self {
        build_mesh(None).expect("identity mesh is valid")
    }

    /// Bounds-checked vertex access. Prefer `validate` once and index the
    /// `vertices` slice directly in hot loops; this accessor exists so
    /// unvalidated callers cannot panic.
    pub fn vertex(&self, x: u16, y: u16) -> Option<WarpVertex> {
        let width = usize::from(self.subdivisions) + 1;
        let index = usize::from(y) * width + usize::from(x);
        self.vertices.get(index).copied()
    }

    /// Full cross-field validation for meshes built outside `build_warp_mesh`
    /// (for example deserialized from a carrier). A malformed mesh must surface
    /// a stable schema error, never an index panic deeper in the pipeline.
    pub fn validate(&self) -> TransformResult<()> {
        if self.subdivisions < MIN_CUSTOM_MESH_SUBDIVISIONS
            || self.subdivisions > MAX_CUSTOM_MESH_SUBDIVISIONS
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "warp mesh subdivisions must be from 2 through 16",
            ));
        }
        let side = usize::from(self.subdivisions) + 1;
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
        let subdivisions = f64::from(self.subdivisions);
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
            }
        }
        for index in 0..self.vertices.len() {
            let vertex = self.vertices[index];
            let x = index % side;
            let y = index / side;
            if (x == 0 || x == side - 1 || y == 0 || y == side - 1)
                && vertex.source != vertex.warped
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "warp mesh boundary vertices must stay fixed",
                ));
            }
        }
        for y in 0..self.subdivisions {
            for x in 0..self.subdivisions {
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
                            "warp preset folds or collapses the bounded mesh",
                        ));
                    }
                }
            }
        }
        Ok(())
    }
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
        subdivisions,
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
                assert_eq!(mesh.subdivisions, WARP_MESH_SUBDIVISIONS);
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
            for index in 0..=mesh.subdivisions {
                let top = mesh.vertex(index, 0).unwrap();
                let bottom = mesh.vertex(index, mesh.subdivisions).unwrap();
                let left = mesh.vertex(0, index).unwrap();
                let right = mesh.vertex(mesh.subdivisions, index).unwrap();
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
        zero_subdivisions.subdivisions = 0;
        assert_eq!(
            zero_subdivisions.validate().unwrap_err().code,
            ErrorCode::Schema
        );

        let mut custom_subdivisions = WarpMesh::identity();
        custom_subdivisions.subdivisions = 2;
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

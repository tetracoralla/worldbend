use crate::{
    ErrorCode, MeshBoundary, Point, TransformError, TransformResult, WarpMesh, WarpSpec,
    WarpVertex, build_warp_mesh,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// An authored surface inside one plane's placement bounds. These are compact
/// scene controls, not a reconstruction of a photographed object.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MockupSurface {
    Cylinder {
        #[schemars(range(min = 0.0, max = 1.0))]
        curvature: f64,
        #[serde(default)]
        #[schemars(range(min = -1.0, max = 1.0))]
        tilt: f64,
        #[serde(default)]
        light: MockupSurfaceLight,
    },
    Fabric {
        #[schemars(range(min = 1, max = 4))]
        folds: u16,
        #[schemars(range(min = 0.0, max = 1.0))]
        depth: f64,
        #[serde(default)]
        #[schemars(range(min = 0.0, max = 1.0))]
        phase: f64,
        #[serde(default)]
        light: MockupSurfaceLight,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MockupSurfaceLight {
    #[schemars(range(min = 0.0, max = 1.0))]
    pub strength: f64,
    /// -1 illuminates from the left, +1 from the right, 0 from the front.
    #[schemars(range(min = -1.0, max = 1.0))]
    pub direction: f64,
}

impl Default for MockupSurfaceLight {
    fn default() -> Self {
        Self {
            strength: 0.65,
            direction: -0.45,
        }
    }
}

impl MockupSurface {
    pub fn validate(self) -> TransformResult<Self> {
        let unit = |v: f64| v.is_finite() && (0.0..=1.0).contains(&v);
        let signed = |v: f64| v.is_finite() && (-1.0..=1.0).contains(&v);
        let (shape_valid, light) = match self {
            Self::Cylinder {
                curvature,
                tilt,
                light,
            } => (unit(curvature) && signed(tilt), light),
            Self::Fabric {
                folds,
                depth,
                phase,
                light,
            } => (
                (1..=4).contains(&folds) && unit(depth) && unit(phase),
                light,
            ),
        };
        if !shape_valid || !unit(light.strength) || !signed(light.direction) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mockup surface controls are outside their finite bounded domains",
            ));
        }
        Ok(self)
    }

    fn amount(self) -> f64 {
        match self {
            Self::Cylinder { curvature, .. } => curvature,
            Self::Fabric { depth, .. } => depth,
        }
    }

    fn light(self) -> MockupSurfaceLight {
        match self {
            Self::Cylinder { light, .. } | Self::Fabric { light, .. } => light,
        }
    }

    fn project(self, point: Point) -> (Point, f64, f64) {
        let u = point.x;
        let v = point.y;
        match self {
            Self::Cylinder {
                curvature, tilt, ..
            } => {
                let half = curvature * 1.3; // visible front remains short of a half cylinder
                let theta = (u * 2.0 - 1.0) * half;
                let x = if u == 0.0 || u == 1.0 {
                    u
                } else {
                    0.5 + (u - 0.5) * sinc(theta) / sinc(half)
                };
                // Edges turn away from the viewer; the middle retains the full
                // height. Tilt moves the receding edges without cropping them.
                let recession = ((2.0 * u - 1.0) * sinc(theta * 0.5) / sinc(half * 0.5)).powi(2);
                let y = 0.5
                    + (v - 0.5) * (1.0 - 0.24 * curvature * recession)
                    + 0.10 * curvature * tilt * recession;
                (Point::new(x, y), theta.sin(), theta.cos())
            }
            Self::Fabric {
                folds,
                depth,
                phase,
                ..
            } => {
                let omega = std::f64::consts::TAU * f64::from(folds);
                let offset = std::f64::consts::TAU * phase;
                let wave = omega * u + offset;
                let x = if u == 0.0 || u == 1.0 {
                    u
                } else {
                    u + 0.06 * depth * (wave.sin() - offset.sin()) / omega
                };
                let y = 0.07 * depth + v * (1.0 - 0.14 * depth) + 0.035 * depth * wave.sin();
                let nx = -0.8 * depth * wave.cos();
                let length = nx.hypot(1.0);
                (Point::new(x, y), nx / length, 1.0 / length)
            }
        }
    }
}

fn sinc(value: f64) -> f64 {
    if value.abs() < 1.0e-4 {
        1.0 - value * value / 6.0 + value.powi(4) / 120.0
    } else {
        value.sin() / value
    }
}

/// Compose the existing, piecewise-linear Warp first, then the authored
/// surface. All carriers consume this mesh and its per-vertex light values.
pub fn build_mockup_surface_mesh(
    surface: MockupSurface,
    warp: Option<WarpSpec>,
) -> TransformResult<WarpMesh> {
    let surface = surface.validate()?;
    let prior = build_warp_mesh(warp)?;
    if surface.amount() == 0.0 {
        return Ok(prior);
    }
    let subdivisions = crate::MAX_SURFACE_MESH_SUBDIVISIONS;
    let side = usize::from(subdivisions) + 1;
    let light = surface.light();
    let light_x = 0.75 * light.direction;
    let light_z = (1.0 - light_x * light_x).sqrt();
    let mut vertices = Vec::with_capacity(side * side);
    let mut shading = Vec::with_capacity(side * side);
    for y in 0..=subdivisions {
        for x in 0..=subdivisions {
            let source = Point::new(
                f64::from(x) / f64::from(subdivisions),
                f64::from(y) / f64::from(subdivisions),
            );
            let warped_before = sample_mesh(&prior, source)?;
            let (projected, normal_x, normal_z) = surface.project(warped_before);
            let warped = Point::new(projected.x.clamp(0.0, 1.0), projected.y.clamp(0.0, 1.0));
            vertices.push(WarpVertex { source, warped });
            let diffuse = (normal_x * light_x + normal_z * light_z).max(0.0) / light_z;
            let multiplier = 1.0 + light.strength * (0.35 + 0.65 * diffuse - 1.0);
            shading.push(multiplier.clamp(0.0, 2.0));
        }
    }
    let mesh = WarpMesh {
        topology: crate::WarpMeshTopology::Grid { subdivisions },
        vertices,
        boundary: MeshBoundary::Free,
        shading: (light.strength != 0.0).then_some(shading),
    };
    mesh.validate_with_context("mockup surface")?;
    Ok(mesh)
}

/// Forward lookup on the canonical TL/TR/BR + TL/BR/BL triangles. It also
/// resolves curved guides, seam samples and projected edge measurements.
pub(crate) fn sample_mesh(mesh: &WarpMesh, point: Point) -> TransformResult<Point> {
    let Some(subdivisions) = mesh.grid_subdivisions() else {
        let point = Point::new(point.x.clamp(0.0, 1.0), point.y.clamp(0.0, 1.0));
        let area = |a: Point, b: Point, c: Point| {
            ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
        };
        for indices in mesh.triangle_indices()? {
            let vertices = indices.map(|i| mesh.vertices[i]);
            let [a, b, c] = vertices.map(|v| v.source);
            let denominator = area(a, b, c);
            let weights = [
                area(b, c, point) / denominator,
                area(c, a, point) / denominator,
                area(a, b, point) / denominator,
            ];
            if weights.iter().all(|w| *w >= -1e-9) {
                return Ok(Point::new(
                    vertices
                        .iter()
                        .zip(weights)
                        .map(|(v, w)| v.warped.x * w)
                        .sum(),
                    vertices
                        .iter()
                        .zip(weights)
                        .map(|(v, w)| v.warped.y * w)
                        .sum(),
                ));
            }
        }
        return Err(TransformError::new(
            ErrorCode::Schema,
            "indexed mesh does not cover the requested source point",
        ));
    };
    let n = f64::from(subdivisions);
    let gx = point.x.clamp(0.0, 1.0) * n;
    let gy = point.y.clamp(0.0, 1.0) * n;
    let x = (gx.floor() as u16).min(subdivisions - 1);
    let y = (gy.floor() as u16).min(subdivisions - 1);
    let u = gx - f64::from(x);
    let v = gy - f64::from(y);
    let tl = mesh.vertex(x, y).expect("validated mesh").warped;
    let br = mesh.vertex(x + 1, y + 1).expect("validated mesh").warped;
    let (points, weights) = if u >= v {
        (
            [
                tl,
                mesh.vertex(x + 1, y).expect("validated mesh").warped,
                br,
            ],
            [1.0 - u, u - v, v],
        )
    } else {
        (
            [
                tl,
                br,
                mesh.vertex(x, y + 1).expect("validated mesh").warped,
            ],
            [1.0 - v, u, v - u],
        )
    };
    Ok(Point::new(
        points.iter().zip(weights).map(|(p, w)| p.x * w).sum(),
        points.iter().zip(weights).map(|(p, w)| p.y * w).sum(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WarpPreset;

    #[test]
    fn all_supported_shapes_compose_with_every_warp_without_folding() {
        for amount in [0.0, 0.25, 0.5, 1.0] {
            for phase in [0.0, 0.125, 0.5, 1.0] {
                let shapes = [
                    MockupSurface::Cylinder {
                        curvature: amount,
                        tilt: -1.0,
                        light: Default::default(),
                    },
                    MockupSurface::Cylinder {
                        curvature: amount,
                        tilt: 1.0,
                        light: Default::default(),
                    },
                    MockupSurface::Fabric {
                        folds: 4,
                        depth: amount,
                        phase,
                        light: Default::default(),
                    },
                ];
                for shape in shapes {
                    for preset in [
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
                    ] {
                        for strength in [-1.0, 0.0, 1.0] {
                            build_mockup_surface_mesh(
                                shape,
                                Some(WarpSpec {
                                    preset,
                                    amount: strength,
                                }),
                            )
                            .unwrap();
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn zero_is_exact_prior_mesh_and_old_mesh_json_remains_unchanged() {
        let warp = Some(WarpSpec {
            preset: WarpPreset::Arc,
            amount: 0.333333,
        });
        let surface = MockupSurface::Cylinder {
            curvature: 0.0,
            tilt: 1.0,
            light: Default::default(),
        };
        let mesh = build_mockup_surface_mesh(surface, warp).unwrap();
        assert_eq!(mesh, build_warp_mesh(warp).unwrap());
        let json = serde_json::to_value(mesh).unwrap();
        assert!(json.get("boundary").is_none());
        assert!(json.get("shading").is_none());
        for curvature in [f64::from_bits(1), 1.0e-20, 1.0e-8] {
            build_mockup_surface_mesh(
                MockupSurface::Cylinder {
                    curvature,
                    tilt: 1.0,
                    light: Default::default(),
                },
                None,
            )
            .unwrap();
        }
    }

    #[test]
    fn cylinder_compresses_edge_text_and_lights_without_changing_alpha_geometry() {
        let shape = MockupSurface::Cylinder {
            curvature: 1.0,
            tilt: 0.0,
            light: Default::default(),
        };
        let mesh = build_mockup_surface_mesh(shape, None).unwrap();
        let n = mesh.grid_subdivisions().unwrap();
        assert!(mesh.vertex(1, n / 2).unwrap().warped.x < 1.0 / f64::from(n));
        assert!(mesh.vertex(0, 0).unwrap().warped.y > 0.1);
        assert_eq!(mesh.vertex(n / 2, 0).unwrap().warped.y, 0.0);
        let shading = mesh.shading.as_ref().unwrap();
        assert!(shading[0] > shading[usize::from(n)]);
        assert_eq!(shading[usize::from(n / 2)], 1.0);
        let unlit = build_mockup_surface_mesh(
            MockupSurface::Cylinder {
                curvature: 1.0,
                tilt: 0.0,
                light: MockupSurfaceLight {
                    strength: 0.0,
                    direction: 0.0,
                },
            },
            None,
        )
        .unwrap();
        assert_eq!(mesh.vertices, unlit.vertices);
        assert!(unlit.shading.is_none());
    }

    #[test]
    fn fabric_has_a_moving_silhouette_and_rejects_invalid_controls_and_unknown_fields() {
        let shape = MockupSurface::Fabric {
            folds: 3,
            depth: 0.8,
            phase: 0.0,
            light: Default::default(),
        };
        let mesh = build_mockup_surface_mesh(shape, None).unwrap();
        assert_ne!(
            mesh.vertex(0, 0).unwrap().warped.y,
            mesh.vertex(2, 0).unwrap().warped.y
        );
        for bad in [
            MockupSurface::Fabric {
                folds: 0,
                depth: 0.5,
                phase: 0.0,
                light: Default::default(),
            },
            MockupSurface::Cylinder {
                curvature: f64::NAN,
                tilt: 0.0,
                light: Default::default(),
            },
            MockupSurface::Cylinder {
                curvature: 1.0,
                tilt: 0.0,
                light: MockupSurfaceLight {
                    strength: 1.1,
                    direction: 0.0,
                },
            },
        ] {
            assert_eq!(
                build_mockup_surface_mesh(bad, None).unwrap_err().code,
                ErrorCode::Schema
            );
        }
        assert!(
            serde_json::from_str::<MockupSurface>(
                r#"{"kind":"fabric","folds":2,"depth":0.5,"curvature":1}"#
            )
            .is_err()
        );
    }
}

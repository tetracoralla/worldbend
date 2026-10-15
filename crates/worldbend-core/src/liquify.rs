//! Typed Liquify controls for the shared deformation work: an ordered,
//! bounded brush family (`worldbend.liquify@0.1`) that displaces interior
//! vertices of the work's regular mesh. See `docs/LIQUIFY_CONTRACT.md`.

use crate::{Point, WarpMesh};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const MAX_LIQUIFY_STROKES: usize = 64;
pub const MAX_LIQUIFY_SAMPLES_PER_STROKE: usize = 256;
pub const MAX_LIQUIFY_STROKE_SAMPLES: usize = 1024;

const MIN_STROKE_RADIUS: f64 = 0.001;
const MAX_STROKE_RADIUS: f64 = 2.0;
const MAX_ID_BYTES: usize = 64;
/// Below this distance the radial direction is undefined; the kernel's
/// distance-scaled magnitude keeps the displacement negligible anyway.
const RADIAL_EPSILON: f64 = 1e-12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LiquifyControls {
    #[serde(default)]
    #[schemars(length(max = 64))]
    pub strokes: Vec<LiquifyStroke>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LiquifyStroke {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub mode: LiquifyMode,
    #[schemars(length(min = 1, max = 256))]
    pub samples: Vec<LiquifySample>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub enum LiquifyMode {
    Push,
    Bloat,
    Pucker,
    Twirl,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LiquifySample {
    pub position: Point,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delta: Option<Point>,
    #[schemars(range(min = 0.001, max = 2.0))]
    pub radius: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub strength: f64,
}

/// Replay sample bound errors are `E_SCHEMA` through the work's stable error
/// classes; the caller maps them with its own context.
pub(crate) fn validate_liquify(controls: &LiquifyControls) -> Result<(), String> {
    if controls.strokes.len() > MAX_LIQUIFY_STROKES {
        return Err("liquify cannot exceed 64 strokes".to_owned());
    }
    let mut ids = HashSet::new();
    let mut total = 0_usize;
    for stroke in &controls.strokes {
        if !valid_id(&stroke.id) {
            return Err("liquify stroke id must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$".to_owned());
        }
        if !ids.insert(stroke.id.as_str()) {
            return Err("liquify stroke ids must be unique".to_owned());
        }
        if stroke.samples.is_empty() || stroke.samples.len() > MAX_LIQUIFY_SAMPLES_PER_STROKE {
            return Err("each liquify stroke must contain 1..256 samples".to_owned());
        }
        total = total
            .checked_add(stroke.samples.len())
            .ok_or_else(|| "liquify sample count overflowed".to_owned())?;
        if total > MAX_LIQUIFY_STROKE_SAMPLES {
            return Err("liquify cannot exceed 1024 total stroke samples".to_owned());
        }
        for sample in &stroke.samples {
            let push_delta_ok = match (stroke.mode, sample.delta) {
                (LiquifyMode::Push, Some(delta)) => point_in_range(delta, -1.0, 1.0),
                (LiquifyMode::Push, None) => false,
                (_, None) => true,
                (_, Some(_)) => false,
            };
            if !point_in_range(sample.position, 0.0, 1.0)
                || !push_delta_ok
                || !sample.radius.is_finite()
                || !(MIN_STROKE_RADIUS..=MAX_STROKE_RADIUS).contains(&sample.radius)
                || !sample.strength.is_finite()
                || !(0.0..=1.0).contains(&sample.strength)
            {
                return Err(
                    "liquify stroke samples exceed their finite position, delta, radius, or strength bounds"
                        .to_owned(),
                );
            }
        }
    }
    Ok(())
}

pub(crate) fn liquify_sample_count(controls: &LiquifyControls) -> usize {
    controls
        .strokes
        .iter()
        .map(|stroke| stroke.samples.len())
        .sum()
}

/// Applies every stroke in listed order to the interior (non-locked) vertices
/// using the shared smoothstep falloff of the surface brush. Radial and
/// twirl magnitudes scale with the vertex distance from the sample position,
/// so the sample center never moves and no direction is invented.
pub(crate) fn apply_liquify(mesh: &mut WarpMesh, controls: &LiquifyControls, locked: &[bool]) {
    let side = usize::from(mesh.grid_subdivisions().expect("deformation work grid")) + 1;
    for stroke in &controls.strokes {
        for sample in &stroke.samples {
            for row in 1..side - 1 {
                for column in 1..side - 1 {
                    let index = row * side + column;
                    if locked[index] {
                        continue;
                    }
                    let source = mesh.vertices[index].source;
                    let offset_x = source.x - sample.position.x;
                    let offset_y = source.y - sample.position.y;
                    let distance = offset_x.hypot(offset_y);
                    if distance >= sample.radius {
                        continue;
                    }
                    let amount = (1.0 - distance / sample.radius).clamp(0.0, 1.0);
                    let falloff = amount * amount * (3.0 - 2.0 * amount) * sample.strength;
                    if stroke.mode == LiquifyMode::Push {
                        let delta = sample.delta.unwrap_or(Point::new(0.0, 0.0));
                        mesh.vertices[index].warped.x += delta.x * falloff;
                        mesh.vertices[index].warped.y += delta.y * falloff;
                        continue;
                    }
                    if distance < RADIAL_EPSILON {
                        continue;
                    }
                    let unit_x = offset_x / distance;
                    let unit_y = offset_y / distance;
                    let (direction_x, direction_y, scale) = match stroke.mode {
                        LiquifyMode::Push => unreachable!("push handled above"),
                        LiquifyMode::Bloat => (unit_x, unit_y, falloff * distance),
                        LiquifyMode::Pucker => (unit_x, unit_y, -falloff * distance),
                        LiquifyMode::Twirl => (-unit_y, unit_x, falloff * distance),
                    };
                    mesh.vertices[index].warped.x += direction_x * scale;
                    mesh.vertices[index].warped.y += direction_y * scale;
                }
            }
        }
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_ID_BYTES
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'_' | b'-'))
        })
}

fn point_in_range(point: Point, minimum: f64, maximum: f64) -> bool {
    point.x.is_finite()
        && point.y.is_finite()
        && (minimum..=maximum).contains(&point.x)
        && (minimum..=maximum).contains(&point.y)
}

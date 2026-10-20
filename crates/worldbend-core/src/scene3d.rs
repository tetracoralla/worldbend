//! Durable selection and timing over an adopted glTF scene. Standard glTF
//! geometry/material/animation evaluation stays with the renderer, not a
//! second Worldbend projective kernel.
use crate::{ErrorCode, FrameRate, PixelSize, TransformError, TransformResult};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SceneArtworkFit {
    Stretch,
    Contain,
    Cover,
}
fn scene_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.scene3d"})
}
fn scene_version(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"0.1"})
}
fn plan_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"type":"string","const":"worldbend.scene3d-plan"})
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scene3dArtwork {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub slot_id: String,
    #[schemars(length(min = 1, max = 128))]
    pub material: String,
    pub surface_size: PixelSize,
    pub fit: SceneArtworkFit,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scene3dSpec {
    #[schemars(schema_with = "scene_schema")]
    pub schema: String,
    #[schemars(schema_with = "scene_version")]
    pub version: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub scene_slot: String,
    /// Exact exported camera object name; ambiguity is a receiving error.
    #[schemars(length(min = 1, max = 128))]
    pub camera: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 128))]
    pub animation: Option<String>,
    pub canvas: PixelSize,
    pub timebase: FrameRate,
    #[schemars(range(min = 1, max = 240))]
    pub frame_count: u32,
    #[serde(default)]
    #[schemars(length(max = 16))]
    pub artworks: Vec<Scene3dArtwork>,
    pub background_rgb: [u8; 3],
    #[schemars(range(min = 0.1, max = 8.0))]
    pub exposure: f64,
    #[schemars(range(min = 0.0, max = 8.0))]
    pub ambient_intensity: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scene3dSample {
    pub frame: u32,
    pub milliseconds: f64,
    /// Normalized imported clip progress. The last authored pose remains
    /// displayed until the complete encoded duration; no implicit loop.
    pub progress: f64,
}
#[derive(Debug, Clone, PartialEq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Scene3dPlan {
    #[schemars(schema_with = "plan_schema")]
    pub schema: String,
    #[schemars(schema_with = "scene_version")]
    pub version: String,
    pub fingerprint: String,
    pub spec: Scene3dSpec,
    pub duration_ms: f64,
    pub samples: Vec<Scene3dSample>,
}
fn id(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 64
        && v.as_bytes()[0].is_ascii_alphanumeric()
        && v.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
fn name(v: &str) -> bool {
    !v.is_empty() && v.chars().count() <= 128 && !v.chars().any(char::is_control)
}
fn error() -> TransformError {
    TransformError::new(
        ErrorCode::Schema,
        "Use a bounded scene, exact camera/clip names and distinct artwork slots",
    )
}
pub fn plan_scene3d(spec: &Scene3dSpec) -> TransformResult<Scene3dPlan> {
    if spec.schema != "worldbend.scene3d"
        || spec.version != "0.1"
        || !id(&spec.scene_slot)
        || !name(&spec.camera)
        || spec.animation.as_ref().is_some_and(|v| !name(v))
        || spec.frame_count == 0
        || spec.frame_count > crate::MAX_TIMELINE_FRAMES as u32
        || spec.artworks.len() > 16
        || !spec.exposure.is_finite()
        || !(0.1..=8.0).contains(&spec.exposure)
        || !spec.ambient_intensity.is_finite()
        || !(0.0..=8.0).contains(&spec.ambient_intensity)
    {
        return Err(error());
    }
    crate::motion::validate_motion_frame_rate(spec.timebase)?;
    let valid_size = |s: PixelSize| {
        s.width > 0
            && s.height > 0
            && s.width <= 8192
            && s.height <= 8192
            && u64::from(s.width) * u64::from(s.height) <= 16_777_216
    };
    if !valid_size(spec.canvas)
        || u64::from(spec.canvas.width)
            * u64::from(spec.canvas.height)
            * u64::from(spec.frame_count)
            > 256 * 1024 * 1024
    {
        return Err(error());
    }
    let mut slots = HashSet::from([spec.scene_slot.as_str()]);
    let mut materials = HashSet::new();
    for art in &spec.artworks {
        if !id(&art.slot_id)
            || !slots.insert(art.slot_id.as_str())
            || !name(&art.material)
            || !materials.insert(art.material.as_str())
            || !valid_size(art.surface_size)
        {
            return Err(error());
        }
    }
    let frame_ms =
        1000.0 * f64::from(spec.timebase.denominator) / f64::from(spec.timebase.numerator);
    let samples = (0..spec.frame_count)
        .map(|frame| Scene3dSample {
            frame,
            milliseconds: frame_ms * f64::from(frame),
            progress: if spec.frame_count == 1 {
                0.0
            } else {
                f64::from(frame) / f64::from(spec.frame_count - 1)
            },
        })
        .collect();
    Ok(Scene3dPlan {
        schema: "worldbend.scene3d-plan".into(),
        version: "0.1".into(),
        fingerprint: crate::canonical::fingerprint_json_value(
            &serde_json::to_value(spec).map_err(|_| error())?,
        )
        .map_err(|_| error())?,
        spec: spec.clone(),
        duration_ms: frame_ms * f64::from(spec.frame_count),
        samples,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn scene() -> Scene3dSpec {
        serde_json::from_value(serde_json::json!({"schema":"worldbend.scene3d","version":"0.1","sceneSlot":"scene","camera":"RevealCamera","animation":"RevealCamera","canvas":{"width":960,"height":720},"timebase":{"numerator":24,"denominator":1},"frameCount":96,"artworks":[{"slotId":"cover","material":"CoverPrint","surfaceSize":{"width":840,"height":1120},"fit":"contain"}],"backgroundRgb":[222,216,193],"exposure":1,"ambientIntensity":1})).unwrap()
    }
    #[test]
    fn retime_preserves_imported_clip_end_and_changes_guard() {
        let a = plan_scene3d(&scene()).unwrap();
        let mut s = a.spec.clone();
        s.frame_count = 144;
        let b = plan_scene3d(&s).unwrap();
        assert_eq!(a.duration_ms, 4000.0);
        assert_eq!(b.duration_ms, 6000.0);
        assert_eq!(
            a.samples.last().unwrap().progress,
            b.samples.last().unwrap().progress
        );
        assert_ne!(a.fingerprint, b.fingerprint);
    }
    #[test]
    fn refuses_duplicate_slots_materials_unbounded_sizes_and_invalid_time() {
        let original = scene();
        for edit in 0..5 {
            let mut s = original.clone();
            match edit {
                0 => s.artworks[0].slot_id = "scene".into(),
                1 => s.artworks.push(s.artworks[0].clone()),
                2 => s.canvas.width = 8193,
                3 => s.exposure = f64::NAN,
                _ => s.timebase.denominator = 0,
            };
            assert!(plan_scene3d(&s).is_err());
        }
    }
}

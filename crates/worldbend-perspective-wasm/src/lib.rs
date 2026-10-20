//! Focused delivery of the existing core; no adapter-owned geometry.
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;
use worldbend_core::{
    CardIdleInput, CardPointerInput, CardPoseInput, CardTurnInput, ErrorCode, PlanePoseInput,
    PlaneStripInput, Size, TransformError, TransformSpec, emit_css_transform, project_card_pose,
    project_plane_pose, project_plane_strip, sample_card_idle, sample_card_pointer,
    sample_card_turn,
};

fn error_js(error: TransformError) -> JsValue {
    JsValue::from_str(&serde_json::to_string(&error).unwrap_or_else(|_| {
        "{\"code\":\"E_INTERNAL\",\"message\":\"failed to encode error\"}".into()
    }))
}
fn input<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, JsValue> {
    serde_json::from_str(json).map_err(|error| {
        error_js(TransformError::new(
            ErrorCode::Schema,
            format!("invalid perspective input: {error}"),
        ))
    })
}
fn output<T: Serialize>(value: Result<T, TransformError>) -> Result<String, JsValue> {
    let value = value.map_err(error_js)?;
    serde_json::to_string(&value).map_err(|_| {
        error_js(TransformError::new(
            ErrorCode::Internal,
            "failed to encode perspective output",
        ))
    })
}

#[wasm_bindgen]
pub fn pose_json(json: &str) -> Result<String, JsValue> {
    output(project_plane_pose(&input::<PlanePoseInput>(json)?))
}
#[wasm_bindgen]
pub fn card_pose_json(json: &str) -> Result<String, JsValue> {
    output(project_card_pose(&input::<CardPoseInput>(json)?))
}
#[wasm_bindgen]
pub fn card_pointer_json(json: &str) -> Result<String, JsValue> {
    output(sample_card_pointer(&input::<CardPointerInput>(json)?))
}
#[wasm_bindgen]
pub fn card_idle_json(json: &str) -> Result<String, JsValue> {
    output(sample_card_idle(&input::<CardIdleInput>(json)?))
}
#[wasm_bindgen]
pub fn card_turn_json(json: &str) -> Result<String, JsValue> {
    output(sample_card_turn(&input::<CardTurnInput>(json)?))
}
#[wasm_bindgen]
pub fn strip_json(json: &str) -> Result<String, JsValue> {
    output(project_plane_strip(&input::<PlaneStripInput>(json)?))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CssInput {
    spec: TransformSpec,
    element_size: Size,
    destination_size: Option<Size>,
}
#[wasm_bindgen]
pub fn css_json(json: &str) -> Result<String, JsValue> {
    let value: CssInput = input(json)?;
    output(emit_css_transform(
        &value.spec,
        value.element_size,
        value.destination_size,
    ))
}

#[cfg(feature = "surface-window")]
#[wasm_bindgen]
pub fn window_plan_json(json: &str) -> Result<String, JsValue> {
    output(worldbend_core::plan_surface_window(&input::<
        worldbend_core::SurfaceWindowSpec,
    >(json)?))
}

#[cfg(feature = "spatial-effects")]
#[wasm_bindgen]
pub fn effect_catalog_json(json: &str) -> Result<String, JsValue> {
    output(worldbend_core::effect_catalog(&input::<
        worldbend_core::EffectCatalogInput,
    >(json)?))
}

#[cfg(feature = "spatial-effects")]
#[wasm_bindgen]
pub fn effect_recipe_json(json: &str) -> Result<String, JsValue> {
    output(worldbend_core::effect_recipe(&input::<
        worldbend_core::EffectRecipeInput,
    >(json)?))
}

#[cfg(feature = "spatial-effects")]
#[wasm_bindgen]
pub fn effect_plan_json(json: &str) -> Result<String, JsValue> {
    output(worldbend_core::effect_plan(&input::<
        worldbend_core::EffectPlanInput,
    >(json)?))
}

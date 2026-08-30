//! WASM bridge over the canonical Rust geometry core.

use serde::Serialize;
use wasm_bindgen::prelude::*;
use worldbend_core::{
    Size, TransformError, TransformRecipe, TransformSpec, WarpSpec, build_warp_mesh,
    compose_affine, emit_css_transform, solve_spec,
};

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn error(message: String);
}

/// Version marker prepended to every compact binary payload. A future layout
/// change bumps this so adapters reject mismatches instead of silently
/// misreading coefficients.
pub const COMPACT_ABI_VERSION: f64 = 1.0;

#[wasm_bindgen(start)]
fn install_panic_reporter() {
    // Without a hook an uncaught panic traps as a bare RuntimeError with no
    // diagnostics; route panic text to the console so failures stay
    // diagnosable across the bridge.
    std::panic::set_hook(Box::new(|panic_info| {
        error(format!("worldbend-wasm panic: {panic_info}"));
    }));
}

#[wasm_bindgen]
pub fn solve_json(
    spec_json: &str,
    target_width: Option<f64>,
    target_height: Option<f64>,
) -> Result<String, JsValue> {
    let spec = parse_spec(spec_json)?;
    let target = optional_size(target_width, target_height)?;
    serialize_result(solve_spec(&spec, target))
}

/// Compact binary preview ABI: [abi version, reference width, reference
/// height, 9 forward homography coefficients]. The JSON solve path remains
/// the contract and diagnostics surface; interactive adapters use this fixed
/// versioned layout to avoid serializing the echoed spec, inverse matrix,
/// and diagnostics each paint.
#[wasm_bindgen]
pub fn solve_preview_f64(
    spec_json: &str,
    target_width: Option<f64>,
    target_height: Option<f64>,
) -> Result<Vec<f64>, JsValue> {
    let spec = parse_spec(spec_json)?;
    let target = optional_size(target_width, target_height)?;
    let solved = solve_spec(&spec, target).map_err(error_js)?;
    let mut output = Vec::with_capacity(12);
    output.push(COMPACT_ABI_VERSION);
    output.push(solved.resolved_destination.reference.width);
    output.push(solved.resolved_destination.reference.height);
    output.extend_from_slice(&solved.homography.matrix);
    Ok(output)
}

#[wasm_bindgen]
pub fn compose_json(
    spec_json: &str,
    transform_json: &str,
    target_width: Option<f64>,
    target_height: Option<f64>,
) -> Result<String, JsValue> {
    let spec = parse_spec(spec_json)?;
    let transform = serde_json::from_str::<TransformRecipe>(transform_json).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid TransformRecipe JSON: {error}"),
        ))
    })?;
    let target = optional_size(target_width, target_height)?;
    serialize_result(compose_affine(&spec, target, transform))
}

#[wasm_bindgen]
pub fn css_json(
    spec_json: &str,
    element_width: f64,
    element_height: f64,
    destination_width: Option<f64>,
    destination_height: Option<f64>,
) -> Result<String, JsValue> {
    let spec = parse_spec(spec_json)?;
    let destination = optional_size(destination_width, destination_height)?;
    serialize_result(emit_css_transform(
        &spec,
        Size::new(element_width, element_height),
        destination,
    ))
}

/// Serialized core-owned mesh for the WarpSpec. Takes the warp directly: the
/// destination quad plays no part in the deformation, so accepting a whole
/// spec would suggest coupling that does not exist.
#[wasm_bindgen]
pub fn warp_mesh_json(warp_json: &str) -> Result<String, JsValue> {
    let warp = parse_warp(warp_json)?;
    serialize_result(build_warp_mesh(Some(warp)))
}

/// Compact binary preview mesh ABI: [abi version, subdivisions, then source
/// x/y and warped x/y for every core-owned vertex in row-major order].
#[wasm_bindgen]
pub fn warp_mesh_f64(warp_json: &str) -> Result<Vec<f64>, JsValue> {
    let warp = parse_warp(warp_json)?;
    let mesh = build_warp_mesh(Some(warp)).map_err(error_js)?;
    let mut output = Vec::with_capacity(2 + mesh.vertices.len() * 4);
    output.push(COMPACT_ABI_VERSION);
    output.push(f64::from(mesh.subdivisions));
    for vertex in mesh.vertices {
        output.extend_from_slice(&[
            vertex.source.x,
            vertex.source.y,
            vertex.warped.x,
            vertex.warped.y,
        ]);
    }
    Ok(output)
}

fn parse_warp(value: &str) -> Result<WarpSpec, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid WarpSpec JSON: {error}"),
        ))
    })
}

fn parse_spec(value: &str) -> Result<TransformSpec, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid TransformSpec JSON: {error}"),
        ))
    })
}

fn optional_size(width: Option<f64>, height: Option<f64>) -> Result<Option<Size>, JsValue> {
    match (width, height) {
        (None, None) => Ok(None),
        (Some(width), Some(height)) => Ok(Some(Size::new(width, height))),
        _ => Err(error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            "width and height must either both be supplied or both be omitted",
        ))),
    }
}

fn serialize_result<T: Serialize>(result: Result<T, TransformError>) -> Result<String, JsValue> {
    match result {
        Ok(value) => serde_json::to_string(&value).map_err(|error| {
            error_js(TransformError::new(
                worldbend_core::ErrorCode::Internal,
                format!("failed to serialize WASM result: {error}"),
            ))
        }),
        Err(error) => Err(error_js(error)),
    }
}

fn error_js(error: TransformError) -> JsValue {
    JsValue::from_str(&serde_json::to_string(&error).unwrap_or_else(|_| {
        "{\"code\":\"E_INTERNAL\",\"message\":\"failed to serialize error\"}".to_owned()
    }))
}

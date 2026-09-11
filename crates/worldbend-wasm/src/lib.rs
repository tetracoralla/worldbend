//! WASM bridge over the canonical Rust geometry core.

use serde::Serialize;
use wasm_bindgen::prelude::*;
use worldbend_core::{
    CanvasOperation, CanvasSetSpec, CanvasSpec, PixelSize, RectifySpec, Size, TransformError,
    TransformRecipe, TransformSpec, WarpSpec, build_warp_mesh, compose_affine, plan_canvas,
    plan_canvas_set, rectify_plane, resolve_canvas_set, resolve_trim_rect_rgba, solve_spec,
};
#[cfg(feature = "designer")]
use worldbend_core::{
    MeshWarpSpec, MockupSpec, RemapSpec, SurfaceDeformationSpec, plan_mesh_warp, plan_mockup,
    plan_remap, plan_surface_deformation,
};
#[cfg(feature = "css")]
use worldbend_core::{PlanePoseInput, emit_css_transform, project_plane_pose};
#[cfg(feature = "template")]
use worldbend_core::{
    SpatialTemplateSpec, VariationJobSpec, inspect_spatial_template, plan_variation_job,
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
pub fn rectify_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_rectify_spec(spec_json)?;
    serialize_result(rectify_plane(&spec))
}

#[wasm_bindgen]
pub fn canvas_plan_json(
    spec_json: &str,
    source_width: u32,
    source_height: u32,
) -> Result<String, JsValue> {
    let spec = parse_canvas_spec(spec_json)?;
    serialize_result(plan_canvas(
        &spec,
        PixelSize::new(source_width, source_height),
    ))
}

#[wasm_bindgen]
pub fn canvas_set_plan_json(
    spec_json: &str,
    source_width: u32,
    source_height: u32,
) -> Result<String, JsValue> {
    let spec = parse_canvas_set_spec(spec_json)?;
    serialize_result(plan_canvas_set(
        &spec,
        PixelSize::new(source_width, source_height),
    ))
}

#[wasm_bindgen]
pub fn canvas_set_plan_rgba_json(
    spec_json: &str,
    source_width: u32,
    source_height: u32,
    rgba: &[u8],
) -> Result<String, JsValue> {
    let spec = parse_canvas_set_spec(spec_json)?;
    let source_size = PixelSize::new(source_width, source_height);
    let resolved_trims = spec
        .variants
        .iter()
        .map(|variant| match variant.operation {
            CanvasOperation::Trim { alpha_threshold } => {
                resolve_trim_rect_rgba(rgba, source_size, alpha_threshold).map(Some)
            }
            _ => Ok(None),
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_js)?;
    serialize_result(resolve_canvas_set(&spec, source_size, &resolved_trims))
}

/// Validate and summarize a reusable Spatial Template through the canonical
/// core. Human carriers use this before persisting or opening a template; the
/// bridge deliberately returns the compact inspection instead of re-encoding
/// carrier-local conclusions.
#[wasm_bindgen]
#[cfg(feature = "template")]
pub fn spatial_template_inspect_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_spatial_template_spec(spec_json)?;
    serialize_result(inspect_spatial_template(&spec))
}

/// Resolve ordered item bindings and output topology without reading assets
/// or rendering pixels.
#[wasm_bindgen]
#[cfg(feature = "template")]
pub fn variation_job_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_variation_job_spec(spec_json)?;
    serialize_result(plan_variation_job(&spec))
}

#[wasm_bindgen]
#[cfg(feature = "designer")]
pub fn mockup_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_mockup_spec(spec_json)?;
    serialize_result(plan_mockup(&spec))
}

#[wasm_bindgen]
#[cfg(feature = "designer")]
pub fn mesh_warp_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_mesh_warp_spec(spec_json)?;
    serialize_result(plan_mesh_warp(&spec))
}

#[wasm_bindgen]
#[cfg(feature = "designer")]
pub fn remap_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_remap_spec(spec_json)?;
    serialize_result(plan_remap(&spec))
}

#[wasm_bindgen]
#[cfg(feature = "designer")]
pub fn surface_deformation_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_surface_deformation_spec(spec_json)?;
    serialize_result(plan_surface_deformation(&spec))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
pub fn pose_json(input_json: &str) -> Result<String, JsValue> {
    let input = serde_json::from_str::<PlanePoseInput>(input_json).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid plane pose JSON: {error}"),
        ))
    })?;
    serialize_result(project_plane_pose(&input))
}

// Preserve bridge imports in the no-CSS Figma carrier without linking projection.
#[wasm_bindgen]
#[cfg(not(feature = "css"))]
pub fn pose_json(_input_json: &str) -> Result<String, JsValue> {
    Err(error_js(TransformError::new(
        worldbend_core::ErrorCode::Schema,
        "Plane pose is not included in this carrier build",
    )))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
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

/// Figma uses the shared Web bridge but has no CSS-emission product route.
/// Retain the generated ABI entry so that bridge imports remain stable while
/// excluding the CSS implementation from the Figma carrier build.
#[wasm_bindgen]
#[cfg(not(feature = "css"))]
pub fn css_json(
    _spec_json: &str,
    _element_width: f64,
    _element_height: f64,
    _destination_width: Option<f64>,
    _destination_height: Option<f64>,
) -> Result<String, JsValue> {
    Err(error_js(TransformError::new(
        worldbend_core::ErrorCode::Schema,
        "CSS embedding is not included in this carrier build",
    )))
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

fn parse_rectify_spec(value: &str) -> Result<RectifySpec, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid RectifySpec JSON: {error}"),
        ))
    })
}

fn parse_canvas_spec(value: &str) -> Result<CanvasSpec, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid CanvasSpec JSON: {error}"),
        ))
    })
}

fn parse_canvas_set_spec(value: &str) -> Result<CanvasSetSpec, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid CanvasSetSpec JSON: {error}"),
        ))
    })
}

#[cfg(feature = "template")]
fn parse_spatial_template_spec(value: &str) -> Result<SpatialTemplateSpec, JsValue> {
    parse_json(value, "SpatialTemplateSpec")
}

#[cfg(feature = "template")]
fn parse_variation_job_spec(value: &str) -> Result<VariationJobSpec, JsValue> {
    parse_json(value, "VariationJobSpec")
}

#[cfg(feature = "designer")]
fn parse_mockup_spec(value: &str) -> Result<MockupSpec, JsValue> {
    parse_json(value, "MockupSpec")
}

#[cfg(feature = "designer")]
fn parse_mesh_warp_spec(value: &str) -> Result<MeshWarpSpec, JsValue> {
    parse_json(value, "MeshWarpSpec")
}

#[cfg(feature = "designer")]
fn parse_remap_spec(value: &str) -> Result<RemapSpec, JsValue> {
    parse_json(value, "RemapSpec")
}

#[cfg(feature = "designer")]
fn parse_surface_deformation_spec(value: &str) -> Result<SurfaceDeformationSpec, JsValue> {
    parse_json(value, "SurfaceDeformationSpec")
}

#[cfg(any(feature = "designer", feature = "template"))]
fn parse_json<T: serde::de::DeserializeOwned>(value: &str, label: &str) -> Result<T, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!("invalid {label} JSON: {error}"),
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

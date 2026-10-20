//! WASM bridge over the canonical Rust geometry core.

use serde::Serialize;
use wasm_bindgen::prelude::*;
use worldbend_core::{
    CanvasOperation, CanvasSetSpec, CanvasSpec, PixelSize, RectifySpec, Size, TransformError,
    TransformRecipe, TransformSpec, VectorProjectionInput, WarpSpec, build_warp_mesh,
    compose_affine, plan_canvas, plan_canvas_set, plan_vector_projection, rectify_plane,
    resolve_canvas_set, resolve_trim_rect_rgba, solve_spec,
};
#[cfg(feature = "css")]
use worldbend_core::{
    CardIdleInput, CardPointerInput, CardPoseInput, CardTurnInput, PlanePoseInput,
    emit_css_transform, project_card_pose, project_plane_pose, sample_card_idle,
    sample_card_pointer, sample_card_turn,
};
#[cfg(feature = "deformation-work")]
use worldbend_core::{DeformationWorkSourceSpec, migrate_deformation_work};
#[cfg(feature = "deformation-work-plan")]
use worldbend_core::{DeformationWorkSpec, plan_deformation_work};
#[cfg(feature = "spatial-effects")]
use worldbend_core::{EffectPlanInput, EffectRecipeInput, effect_plan, effect_recipe};
#[cfg(any(feature = "deformation-work", feature = "designer"))]
use worldbend_core::{MeshWarpSpec, SurfaceDeformationSpec};
#[cfg(feature = "motion")]
use worldbend_core::{MockupMotionSpec, plan_mockup_motion};
#[cfg(any(feature = "designer", feature = "motion"))]
use worldbend_core::{MockupSpec, plan_mockup};
#[cfg(any(feature = "designer", feature = "template"))]
use worldbend_core::{MockupSurface, build_mockup_surface_mesh};
#[cfg(feature = "designer")]
use worldbend_core::{RemapSpec, plan_mesh_warp, plan_remap, plan_surface_deformation};
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

/// Convert provider capture facts to a reusable logical-source sampling view.
#[wasm_bindgen]
pub fn source_capture_plan_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_small_geometry_json::<worldbend_core::SourceCaptureFacts>(
        input_json,
        "source sampling",
    )?;
    serialize_result(worldbend_core::plan_source_capture(&input))
}

#[wasm_bindgen]
pub fn source_sampling_validate_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_small_geometry_json::<worldbend_core::SourceSamplingFrame>(
        input_json,
        "source sampling",
    )?;
    input.validate().map_err(error_js)?;
    serialize_result(Ok(input))
}

/// Plan the canonical affine/native-sampler split before provider writes.
#[wasm_bindgen]
pub fn native_frame_plan_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_small_geometry_json::<worldbend_core::NativeFramePlanInput>(
        input_json,
        "native frame",
    )?;
    serialize_result(worldbend_core::plan_native_frame(&input))
}

#[wasm_bindgen]
pub fn native_affine_rebase_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_small_geometry_json::<worldbend_core::NativeAffineFrameState>(
        input_json,
        "native affine state",
    )?;
    serialize_result(worldbend_core::rebase_native_affine(&input))
}

/// Execute one bounded PSD Smart Object request — inspection, template
/// planning, or curve-work adoption — over local PSD/PSB bytes. The request
/// JSON stays small; the source bytes arrive separately so large documents
/// never round-trip through strings.
#[cfg(feature = "psd-import")]
#[wasm_bindgen]
pub fn psd_smart_objects_json(bytes: &[u8], request_json: &str) -> Result<String, JsValue> {
    let request = parse_small_geometry_json::<worldbend_interop::PsdSmartObjectRequest>(
        request_json,
        "psd smart object request",
    )?;
    serialize_result(worldbend_interop::execute_psd_smart_object_request(
        bytes, &request,
    ))
}

fn parse_small_geometry_json<T: serde::de::DeserializeOwned>(
    input: &str,
    label: &str,
) -> Result<T, JsValue> {
    if input.len() > 8192 {
        return Err(error_js(TransformError::new(
            worldbend_core::ErrorCode::OutputLimit,
            format!("{label} input exceeds 8192 bytes"),
        )));
    }
    parse_json(input, label)
}

/// Explicit consumer intent is evaluated locally through the canonical core.
#[wasm_bindgen]
#[cfg(feature = "material-preference")]
pub fn material_preference_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<worldbend_core::MaterialPreferenceInput>(
        input_json,
        "MaterialPreferenceInput",
    )?;
    serialize_result(worldbend_core::resolve_material_preference(&input))
}

/// Compile durable work through the ordinary canonical document planner.
#[wasm_bindgen]
#[cfg(feature = "document")]
pub fn spatial_document_delivery_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<worldbend_core::SpatialDocumentDeliveryInput>(
        input_json,
        "SpatialDocumentDeliveryInput",
    )?;
    serialize_result(worldbend_core::plan_spatial_document_delivery(&input))
}

#[wasm_bindgen]
#[cfg(feature = "document")]
pub fn spatial_document_inspect_json(input_json: &str) -> Result<String, JsValue> {
    let document =
        parse_json::<worldbend_core::SpatialDocumentSpec>(input_json, "SpatialDocumentSpec")?;
    serialize_result(worldbend_core::inspect_spatial_document(&document))
}

#[wasm_bindgen]
#[cfg(feature = "document")]
pub fn spatial_document_update_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<worldbend_core::SpatialDocumentUpdateInput>(
        input_json,
        "SpatialDocumentUpdateInput",
    )?;
    serialize_result(worldbend_core::plan_spatial_document_update(&input))
}

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
    let transform = parse_json::<TransformRecipe>(transform_json, "TransformRecipe")?;
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
#[cfg(any(feature = "designer", feature = "motion"))]
pub fn mockup_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_mockup_spec(spec_json)?;
    serialize_result(plan_mockup(&spec))
}

/// Canonical authored times and frame geometry, shared with native video.
#[wasm_bindgen]
#[cfg(feature = "motion")]
pub fn mockup_motion_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_json::<MockupMotionSpec>(spec_json, "MockupMotionSpec")?;
    serialize_result(plan_mockup_motion(&spec))
}
#[wasm_bindgen]
#[cfg(feature = "motion")]
pub fn mockup_motion_authoring_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<worldbend_core::MockupMotionAuthoringInput>(
        input_json,
        "MockupMotionAuthoringInput",
    )?;
    serialize_result(worldbend_core::author_mockup_motion(&input))
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

/// Plan one replayable deformation work and return its canonical mesh plan plus
/// the pin-view projection. Plane, Pin, and Mesh editing views read this one
/// result; adapters never re-derive deformation geometry.
#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
pub fn deformation_work_plan_json(spec_json: &str) -> Result<String, JsValue> {
    let spec = parse_deformation_work_spec(spec_json)?;
    serialize_result(plan_deformation_work(&spec))
}

/// Offer connected fitting domains for a complete normalized compound mask.
#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
pub fn shape_fit_domains_json(clip_json: &str) -> Result<String, JsValue> {
    let clip = parse_json::<worldbend_core::MockupClip>(clip_json, "MockupClip")?;
    serialize_result(worldbend_core::shape_fit_domains(&clip))
}

/// Refresh a fitting recipe from current guide curves through the core.
#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
pub fn shape_fit_refresh_json(input_json: &str) -> Result<String, JsValue> {
    let input =
        parse_json::<worldbend_core::ShapeFitRefreshInput>(input_json, "ShapeFitRefreshInput")?;
    serialize_result(worldbend_core::refresh_shape_fit(&input))
}

/// An immutable validated fit map. Hot pointer queries reuse the same faces
/// rather than reparsing or re-solving a complete work for every sample.
#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
pub struct MeshCoordinateMap {
    inner: worldbend_core::MeshCoordinateMap,
}

#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
impl MeshCoordinateMap {
    #[wasm_bindgen(constructor)]
    pub fn new(mesh_json: &str) -> Result<MeshCoordinateMap, JsValue> {
        let mesh = parse_json::<worldbend_core::WarpMesh>(mesh_json, "WarpMesh")?;
        Ok(Self {
            inner: worldbend_core::MeshCoordinateMap::new(&mesh).map_err(error_js)?,
        })
    }

    pub fn map(&self, x: f64, y: f64, inverse: bool) -> Result<Vec<f64>, JsValue> {
        Ok(self
            .inner
            .map(worldbend_core::Point::new(x, y), inverse)
            .map_err(error_js)?
            .map(|point| vec![point.x, point.y])
            .unwrap_or_default())
    }

    pub fn map_control(
        &self,
        x: f64,
        y: f64,
        anchor_x: f64,
        anchor_y: f64,
        inverse: bool,
    ) -> Result<Vec<f64>, JsValue> {
        let point = self
            .inner
            .map_control(
                worldbend_core::Point::new(x, y),
                worldbend_core::Point::new(anchor_x, anchor_y),
                inverse,
            )
            .map_err(error_js)?;
        Ok(vec![point.x, point.y])
    }
}

/// Project the original compound fill through a core-solved plane without
/// re-solving fitting or resampling the authored interior on every plane edit.
#[wasm_bindgen]
#[cfg(feature = "deformation-work-plan")]
pub fn deformation_clip_json(
    clip_json: &str,
    homography: &[f64],
    width: f64,
    height: f64,
) -> Result<String, JsValue> {
    let clip = parse_json::<worldbend_core::MockupClip>(clip_json, "MockupClip")?;
    let matrix: [f64; 9] = homography.try_into().map_err(|_| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            "deformation clip homography requires nine coefficients",
        ))
    })?;
    serialize_result(worldbend_core::project_deformation_clip(
        &clip,
        matrix,
        Size::new(width, height),
    ))
}

/// Migrate one persisted mesh-warp or surface-deformation document into the
/// deformation work. The input is `{"meshWarp": <spec>}` or
/// `{"surfaceDeformation": <spec>}`; exactly one source is accepted.
#[wasm_bindgen]
#[cfg(feature = "deformation-work")]
pub fn deformation_work_migrate_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_deformation_migrate_input(input_json)?;
    serialize_result(migrate_deformation_work(&input))
}

#[wasm_bindgen]
#[cfg(feature = "spatial-effects")]
pub fn effect_recipe_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<EffectRecipeInput>(input_json, "EffectRecipeInput")?;
    serialize_result(effect_recipe(&input))
}

#[wasm_bindgen]
#[cfg(feature = "spatial-effects")]
pub fn effect_plan_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<EffectPlanInput>(input_json, "EffectPlanInput")?;
    serialize_result(effect_plan(&input))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
pub fn pose_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<PlanePoseInput>(input_json, "plane pose")?;
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
pub fn card_pose_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<CardPoseInput>(input_json, "card pose")?;
    serialize_result(project_card_pose(&input))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
pub fn card_pointer_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<CardPointerInput>(input_json, "card pointer")?;
    serialize_result(sample_card_pointer(&input))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
pub fn card_idle_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<CardIdleInput>(input_json, "card idle")?;
    serialize_result(sample_card_idle(&input))
}

#[wasm_bindgen]
#[cfg(feature = "css")]
pub fn card_turn_json(input_json: &str) -> Result<String, JsValue> {
    let input = parse_json::<CardTurnInput>(input_json, "card turn")?;
    serialize_result(sample_card_turn(&input))
}

#[wasm_bindgen]
#[cfg(not(feature = "css"))]
pub fn card_pose_json(_input_json: &str) -> Result<String, JsValue> {
    Err(error_js(TransformError::new(
        worldbend_core::ErrorCode::Schema,
        "Card pose is not included in this carrier build",
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

#[wasm_bindgen]
#[cfg(any(feature = "designer", feature = "template"))]
pub fn mockup_surface_mesh_json(surface_json: &str, warp_json: &str) -> Result<String, JsValue> {
    let surface = parse_json::<MockupSurface>(surface_json, "MockupSurface")?;
    let warp = parse_json::<Option<WarpSpec>>(warp_json, "optional WarpSpec")?;
    serialize_result(build_mockup_surface_mesh(surface, warp))
}

/// Full authored operation resolution; the mesh is execution data, not another recipe.
#[wasm_bindgen]
pub fn vector_operation_json(input_json: &str) -> Result<String, JsValue> {
    bounded_vector_json(input_json)?;
    let input =
        parse_json::<worldbend_core::VectorOperationInput>(input_json, "VectorOperationInput")?;
    serialize_result(worldbend_core::plan_vector_operation(&input))
}

/// One complete artwork and one cumulative geometry/compute budget.
#[wasm_bindgen]
pub fn vector_artwork_json(input_json: &str) -> Result<String, JsValue> {
    bounded_vector_json(input_json)?;
    let input = parse_json::<worldbend_core::VectorArtworkProjectionInput>(
        input_json,
        "VectorArtworkProjectionInput",
    )?;
    serialize_result(worldbend_core::plan_vector_artwork(&input))
}
fn bounded_vector_json(input: &str) -> Result<(), JsValue> {
    if input.len() > worldbend_core::MAX_VECTOR_ARTWORK_BYTES {
        return Err(error_js(TransformError::new(
            worldbend_core::ErrorCode::OutputLimit,
            "vector JSON exceeds 8 MiB",
        )));
    }
    Ok(())
}

/// Project one editable vector path through the canonical core: the shared
/// curve/stroke fidelity semantics live in `worldbend-core`, never in carriers.
#[wasm_bindgen]
pub fn vector_projection_json(input_json: &str) -> Result<String, JsValue> {
    if input_json.len() > 8 * 1024 * 1024 {
        return Err(error_js(TransformError::new(
            worldbend_core::ErrorCode::OutputLimit,
            "vector projection JSON exceeds the 8 MiB admission capacity",
        )));
    }
    let input = parse_json::<VectorProjectionInput>(input_json, "VectorProjectionInput")?;
    serialize_result(plan_vector_projection(&input))
}

/// Compact binary preview mesh ABI: [abi version, subdivisions, then source
/// x/y and warped x/y for every core-owned vertex in row-major order].
#[wasm_bindgen]
pub fn warp_mesh_f64(warp_json: &str) -> Result<Vec<f64>, JsValue> {
    let warp = parse_warp(warp_json)?;
    let mesh = build_warp_mesh(Some(warp)).map_err(error_js)?;
    let mut output = Vec::with_capacity(2 + mesh.vertices.len() * 4);
    output.push(COMPACT_ABI_VERSION);
    output.push(f64::from(mesh.grid_subdivisions().expect("preset grid")));
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
    parse_json(value, "WarpSpec")
}

fn parse_spec(value: &str) -> Result<TransformSpec, JsValue> {
    parse_json(value, "TransformSpec")
}

fn parse_rectify_spec(value: &str) -> Result<RectifySpec, JsValue> {
    parse_json(value, "RectifySpec")
}

fn parse_canvas_spec(value: &str) -> Result<CanvasSpec, JsValue> {
    parse_json(value, "CanvasSpec")
}

fn parse_canvas_set_spec(value: &str) -> Result<CanvasSetSpec, JsValue> {
    parse_json(value, "CanvasSetSpec")
}

#[cfg(feature = "template")]
fn parse_spatial_template_spec(value: &str) -> Result<SpatialTemplateSpec, JsValue> {
    parse_json(value, "SpatialTemplateSpec")
}

#[cfg(feature = "template")]
fn parse_variation_job_spec(value: &str) -> Result<VariationJobSpec, JsValue> {
    parse_json(value, "VariationJobSpec")
}

#[cfg(any(feature = "designer", feature = "motion"))]
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

#[cfg(feature = "deformation-work-plan")]
fn parse_deformation_work_spec(value: &str) -> Result<DeformationWorkSpec, JsValue> {
    parse_json(value, "DeformationWorkSpec")
}

#[cfg(feature = "deformation-work")]
fn parse_deformation_migrate_input(value: &str) -> Result<DeformationWorkSourceSpec, JsValue> {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct DeformationMigrateWire {
        mesh_warp: Option<MeshWarpSpec>,
        surface_deformation: Option<SurfaceDeformationSpec>,
    }
    let wire = parse_json::<DeformationMigrateWire>(value, "deformation migration")?;
    match (wire.mesh_warp, wire.surface_deformation) {
        (Some(spec), None) => Ok(DeformationWorkSourceSpec::MeshWarp(Box::new(spec))),
        (None, Some(spec)) => Ok(DeformationWorkSourceSpec::SurfaceDeformation(Box::new(
            spec,
        ))),
        _ => Err(error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            "deformation migration requires exactly one meshWarp or surfaceDeformation source",
        ))),
    }
}

fn parse_json<T: serde::de::DeserializeOwned>(value: &str, label: &str) -> Result<T, JsValue> {
    serde_json::from_str(value).map_err(|error| {
        error_js(TransformError::new(
            worldbend_core::ErrorCode::Schema,
            format!(
                "invalid {label} JSON: {}",
                worldbend_core::bounded_text(&error.to_string(), 256)
            ),
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

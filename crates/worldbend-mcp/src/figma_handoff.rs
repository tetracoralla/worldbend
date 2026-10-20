//! Prepare bounded Figma-tool requests and deterministic projections from
//! already-inspected Figma state. This module never contacts Figma.
use base64::Engine as _;
use image::ImageEncoder as _;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::io::Write;
use worldbend_core::{
    AppearanceRecipeSpec, CanvasOperation, CoordinateSpace, EffectPlanInput, EffectRecipe,
    EffectState, EffectSurface, ErrorCode, GlassField, GlassMaterial, MockupSpec, PixelSize,
    RasterProgramCanvasMode, RasterProgramStage, Size, SpatialDocumentAsset,
    SpatialDocumentBinding, SpatialDocumentBindingRole, SpatialDocumentDeliveryPlan,
    SpatialDocumentSpec, SpatialInteractiveDeliveryInput, SpatialStaticDeliveryInput,
    SpatialTemplateOperation, SpatialTemplateOutput, SpatialTemplateSpec, TextureField,
    TextureMaterial, TextureRecipeSpec, TransformError, TransformResult, TransformSpec,
    effect_plan, inspect_spatial_template, plan_canvas_set, plan_mockup,
    prepare_spatial_interactive_delivery, prepare_spatial_static_delivery, solve_spec,
};

const RUNTIME: &str = include_str!("figma-runtime.js");
const TRANSFORM_RUNTIME: &str = include_str!("figma-runtime-transform.js");
const NATIVE_CREATE_RUNTIME: &str = include_str!("figma-runtime-native-create.js");
const IMAGE_RUNTIME: &str = include_str!("figma-runtime-image-publishers.js");
const SCENE_RUNTIME: &str = include_str!("figma-runtime-scenes.js");
const SCENE_CREATE_RUNTIME: &str = include_str!("figma-runtime-scene-create.js");
const EFFECT_CREATE_RUNTIME: &str = include_str!("figma-runtime-effect-create.js");
const EFFECT_SOURCES_RUNTIME: &str = include_str!("figma-runtime-effect-sources.js");
/// The material families travel without the document publishers, so a
/// family packet stays small as both surfaces grow.
const MATERIALS_RUNTIME: &str = include_str!("figma-runtime-materials.js");
const MAX_PACKET_BYTES: usize = 48 * 1024;
/// A publication request embeds the rendered PNG as base64, so it needs its
/// own bounded ceiling; the standard packet stays at 48 KiB.
const MAX_PUBLISH_PACKET_BYTES: usize = 2 * 1024 * 1024;
const FIGMA_EFFECT_CONTINUATION_SCHEMA: &str = "worldbend.figma-effect-continuation";
const FIGMA_EFFECT_CONTINUATION_VERSION: &str = "0.1";
const FIGMA_EFFECT_EXPRESSION_ID: &str = "figma-depth";
const FIGMA_COMPOSITION_CONTINUATION_SCHEMA: &str = "worldbend.figma-composition-continuation";
const FIGMA_COMPOSITION_CONTINUATION_VERSION: &str = "0.1";
const FIGMA_COMPOSITION_EXPRESSION_ID: &str = "figma-composition";

/// Exact private argument projection. Intern repeated strings/keys only when
/// the complete JSON-escaped expression is smaller than the ordinary literal.
/// Executable publisher code and public contracts remain unchanged.
pub(crate) fn packet_literal(value: &serde_json::Value) -> TransformResult<String> {
    fn count(value: &serde_json::Value, counts: &mut std::collections::HashMap<String, usize>) {
        match value {
            serde_json::Value::String(value) => *counts.entry(value.clone()).or_default() += 1,
            serde_json::Value::Array(values) => values.iter().for_each(|v| count(v, counts)),
            serde_json::Value::Object(values) => values.iter().for_each(|(key, value)| {
                *counts.entry(key.clone()).or_default() += 1;
                count(value, counts);
            }),
            _ => (),
        }
    }
    fn intern(value: &str, strings: &mut Vec<String>) -> usize {
        if let Some(index) = strings.iter().position(|item| item == value) {
            index
        } else {
            strings.push(value.into());
            strings.len() - 1
        }
    }
    fn encode(
        value: &serde_json::Value,
        strings: &mut Vec<String>,
        selected: &std::collections::HashSet<String>,
    ) -> serde_json::Value {
        match value {
            serde_json::Value::String(value) if selected.contains(value) => {
                json!([2, intern(value, strings)])
            }
            serde_json::Value::Array(values) => {
                let mut out = vec![json!(1)];
                out.extend(values.iter().map(|v| encode(v, strings, selected)));
                json!(out)
            }
            serde_json::Value::Object(values) => {
                let mut out = vec![json!(0)];
                out.extend(values.iter().map(|(key, value)| {
                    json!([
                        if selected.contains(key) {
                            json!(intern(key, strings))
                        } else {
                            json!(key)
                        },
                        encode(value, strings, selected)
                    ])
                }));
                json!(out)
            }
            _ => value.clone(),
        }
    }
    let literal = serde_json::to_string(value)
        .map_err(|_| input_error("Figma argument serialization failed"))?;
    let mut strings = Vec::new();
    let mut counts = std::collections::HashMap::new();
    count(value, &mut counts);
    let selected = counts
        .into_iter()
        .filter_map(|(value, count)| {
            let literal_bytes = serde_json::to_string(&value).ok()?;
            let wire_bytes = serde_json::to_vec(&literal_bytes).ok()?.len();
            // Conservatively allow three decimal digits per dictionary index.
            (wire_bytes.saturating_sub(8) * count > value.len().div_ceil(3) * 4 + 4)
                .then_some(value)
        })
        .collect();
    let tree = encode(value, &mut strings, &selected);
    let dictionary = strings
        .iter()
        .map(|s| base64::engine::general_purpose::STANDARD.encode(s.as_bytes()))
        .collect::<Vec<_>>();
    let packed = format!(
        "((d,t)=>{{d=d.map(s=>decodeURIComponent(Array.from(figma.base64Decode(s),b=>'%'+b.toString(16).padStart(2,'0')).join('')));const r=v=>!Array.isArray(v)?v:v[0]===2?d[v[1]]:v[0]===1?v.slice(1).map(r):Object.fromEntries(v.slice(1).map(([k,x])=>[typeof k==='number'?d[k]:k,r(x)]));return r(t)}})({},{tree})",
        json!(dictionary)
    );
    let encoded_size = |s: &str| {
        serde_json::to_vec(s)
            .map(|v| v.len())
            .map_err(|_| input_error("Figma argument serialization failed"))
    };
    Ok(if encoded_size(&packed)? < encoded_size(&literal)? {
        packed
    } else {
        literal
    })
}

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
enum FigmaRasterTransport {
    #[default]
    Inline,
    Artifact,
}
impl FigmaRasterTransport {
    fn name(self) -> &'static str {
        match self {
            Self::Inline => "inline",
            Self::Artifact => "artifact",
        }
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaInspectInput {
    #[schemars(
        length(min = 1, max = 256),
        description = "Explicitly granted Figma file key"
    )]
    file_key: String,
    #[schemars(
        default,
        description = "For Spatial results: also export every bound source at the recipe's viewport scale (base64 PNG per ordered slot)"
    )]
    #[serde(default)]
    include_source_rasters: bool,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(
        length(min = 1, max = 256),
        description = "Selected Worldbend editable result or its duplicate"
    )]
    node_id: String,
    #[serde(default)]
    #[schemars(
        description = "inline returns base64 in text for small images; artifact emits named PNG image artifacts through supported Figma io.write without large text fields"
    )]
    source_raster_transport: FigmaRasterTransport,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaPlacement {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaSource {
    pub(crate) node_id: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaSnapshot {
    pub(crate) schema: String,
    pub(crate) version: String,
    pub(crate) file_key: String,
    pub(crate) page_id: String,
    pub(crate) node_id: String,
    /// Zero denotes a native duplicate which has not yet been independently updated.
    pub(crate) revision: u64,
    pub(crate) spec: TransformSpec,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) affine_state: Option<worldbend_core::NativeAffineFrameState>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) component_frame: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(crate) source_editing: bool,
    pub(crate) source: FigmaSource,
    pub(crate) placement: FigmaPlacement,
    #[schemars(
        length(min = 1, max = 8192),
        description = "Opaque expected-state fingerprint from the actual Figma inspect result"
    )]
    pub(crate) expected: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaApplyInput {
    snapshot: FigmaSnapshot,
    #[schemars(
        description = "Normalized affine/projective TransformSpec; native output excludes Warp"
    )]
    spec: TransformSpec,
    #[serde(default)]
    #[schemars(
        range(min = 1, max = 4096),
        description = "Requested logical frame width; omission preserves the current fractional width. Core solving uses the ceiling in pixels."
    )]
    width: Option<u32>,
    #[serde(default)]
    #[schemars(range(min = 1, max = 4096))]
    height: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaNativeSourceFacts {
    pub(crate) source_node_id: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
    #[schemars(length(min = 1, max = 256))]
    pub(crate) expected: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaNativeCreateInput {
    #[schemars(length(min = 1, max = 256))]
    file_key: String,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(
        length(min = 1, max = 256),
        description = "Existing clipped, axis-aligned native Frame; creation keeps the original and owns an independent editable Content clone"
    )]
    source_node_id: String,
    /// Omit on the first call to read actual host facts. Repeat the same request
    /// with the returned sourceFacts to obtain a core-planned publication.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_facts: Option<FigmaNativeSourceFacts>,
    #[schemars(
        length(min = 1, max = 80),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    )]
    request_id: String,
    spec: TransformSpec,
    #[schemars(range(min = 0.01, max = 4096))]
    width: f64,
    #[schemars(range(min = 0.01, max = 4096))]
    height: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 80))]
    name: Option<String>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaRequest {
    pub(crate) file_key: String,
    pub(crate) skill_names: &'static str,
    pub(crate) description: &'static str,
    #[schemars(
        length(max = 49152),
        description = "Pass this complete request to the available Figma use_figma tool after loading its required skill. Preparing it performs no Figma read or write."
    )]
    pub(crate) code: String,
    #[serde(skip)]
    #[schemars(skip)]
    pub(crate) publication: Option<PublicationData>,
}

#[derive(Debug, Clone)]
pub(crate) struct PublicationData {
    pub force_transport: bool,
    pub page_id: String,
    pub node_id: String,
    pub publisher: &'static str,
    pub arguments: serde_json::Value,
    pub runtime: Option<&'static str>,
    /// A combined transport/publisher bundle owned by the source, never input.
    pub finalizer: Option<(&'static str, &'static str)>,
    /// Optional current-host capture validation before a guarded finalizer.
    pub preflight: Option<(&'static str, &'static str)>,
}

pub(crate) fn bounded_request(mut request: FigmaRequest) -> TransformResult<FigmaRequest> {
    let measure = |request: &FigmaRequest| {
        serde_json::to_vec(request)
            .map(|v| v.len())
            .map_err(|_| input_error("Figma request serialization failed"))
    };
    let mut bytes = measure(&request)?;
    if bytes > MAX_PACKET_BYTES && request.code.len() <= 128 * 1024 {
        // FigmaRequest is source-produced only (not Deserialize/tool input).
        // Compress exact executable source; never promote argument data into
        // code or read an executable program from mutable document staging.
        let raw = serde_json::to_vec(&request.code)
            .map_err(|_| input_error("Trusted source serialization failed"))?;
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&raw)
            .map_err(|_| input_error("Trusted source compression failed"))?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(
            gzip.finish()
                .map_err(|_| input_error("Trusted source compression failed"))?,
        );
        let envelope = json!({"encoding":"gzip-base64","decodedBytes":raw.len(),"digest":hex::encode(Sha256::digest(encoded.as_bytes())),"data":encoded});
        let compressed = format!(
            "{}\nreturn await WorldbendFigmaEmbedded.executeEmbeddedRuntime({envelope});",
            include_str!("figma-runtime-embedded.js")
        );
        let previous = std::mem::replace(&mut request.code, compressed);
        let compressed_bytes = measure(&request)?;
        if compressed_bytes < bytes {
            bytes = compressed_bytes;
        } else {
            request.code = previous;
        }
    }
    if bytes > MAX_PACKET_BYTES {
        return Err(
            TransformError::new(ErrorCode::OutputLimit, "Figma request exceeds 48 KiB")
                .with_details(json!({"bytes":bytes,"maxBytes":MAX_PACKET_BYTES})),
        );
    }
    Ok(request)
}

#[cfg(test)]
pub(crate) fn test_code(request: &FigmaRequest) -> String {
    if let Some((_, tail)) = request
        .code
        .rsplit_once("\nreturn await WorldbendFigmaEmbedded.executeEmbeddedRuntime(")
    {
        let envelope = serde_json::from_str(tail.strip_suffix(");").expect("embedded invocation"))
            .expect("exact executable envelope");
        return crate::figma_exact_json::decode(envelope)
            .expect("exact source bytes")
            .as_str()
            .expect("source string")
            .to_owned();
    }
    request.code.clone()
}

fn publication_request(
    file_key: String,
    page_id: String,
    node_id: String,
    publisher: &'static str,
    arguments: serde_json::Value,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    publication_request_runtime(
        file_key,
        page_id,
        node_id,
        publisher,
        arguments,
        description,
        Some(IMAGE_RUNTIME),
    )
}

pub(crate) fn publication_request_runtime(
    file_key: String,
    page_id: String,
    node_id: String,
    publisher: &'static str,
    arguments: serde_json::Value,
    description: &'static str,
    runtime: Option<&'static str>,
) -> TransformResult<FigmaRequest> {
    let file = json!(file_key);
    let page = json!(page_id);
    let argument_bytes = serde_json::to_vec(&arguments)
        .map_err(|_| input_error("Publication serialization failed"))?
        .len();
    if argument_bytes > 16 * 1024 * 1024 {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Complete publication exceeds decoded capacity",
        ));
    }
    let force_transport = argument_bytes > 128 * 1024;
    let request = FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description,
        code: if force_transport {
            String::new()
        } else {
            format!(
                "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{}\nconst state=await WorldbendFigmaHandoff.{publisher}({arguments});const result=await figma.getNodeByIdAsync(state.previewNodeId||state.nodeId);await result.screenshot({{scale:Math.min(1,1024/Math.max(result.width||state.placement.width,result.height||state.placement.height))}});return state;",
                runtime.unwrap_or(RUNTIME)
            )
        },
        publication: Some(PublicationData {
            force_transport,
            page_id,
            node_id,
            publisher,
            arguments,
            runtime,
            finalizer: None,
            preflight: None,
        }),
    };
    if serde_json::to_vec(&request)
        .map_err(|_| input_error("Figma request serialization failed"))?
        .len()
        > MAX_PUBLISH_PACKET_BYTES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Figma publication exceeds 2 MiB; use a smaller raster",
        ));
    }
    Ok(request)
}

fn input_error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

pub(crate) fn identity(value: &str) -> TransformResult<()> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(input_error(
            "Figma identities must contain 1..256 bytes without control characters",
        ));
    }
    Ok(())
}

fn axis(value: f64) -> TransformResult<u32> {
    if !value.is_finite() || !(0.01..=4096.0).contains(&value) {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Editable Figma axes must be in 0.01..4096 logical units",
        ));
    }
    Ok(value.ceil() as u32)
}

fn native_spec(spec: &TransformSpec) -> TransformResult<()> {
    if spec.destination.space != CoordinateSpace::Normalized || spec.content.warp.is_some() {
        return Err(input_error(
            "Editable Figma output requires a normalized TransformSpec without Warp",
        ));
    }
    Ok(())
}

fn packet(
    file_key: String,
    page_id: &str,
    call: String,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    packet_runtime(file_key, page_id, call, description, RUNTIME)
}

/// A material-family packet embeds only the families' runtime variant.
fn materials_packet(
    file_key: String,
    page_id: &str,
    call: String,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    packet_runtime(file_key, page_id, call, description, MATERIALS_RUNTIME)
}

pub(crate) fn packet_runtime(
    file_key: String,
    page_id: &str,
    call: String,
    description: &'static str,
    runtime: &str,
) -> TransformResult<FigmaRequest> {
    identity(&file_key)?;
    identity(page_id)?;
    let page = json!(page_id);
    let file = json!(file_key);
    let code = format!(
        "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{runtime}\nconst state=await WorldbendFigmaHandoff.{call};const result=await figma.getNodeByIdAsync(state.previewNodeId||state.nodeId);await result.screenshot({{scale:Math.min(1,1024/Math.max(result.width||state.placement.width,result.height||state.placement.height))}});return state;"
    );
    let request = FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description,
        code,
        publication: None,
    };
    bounded_request(request)
}

/// Scoped state/source reads do not publish or request an output screenshot.
pub(crate) fn read_request_runtime(
    file_key: String,
    page_id: &str,
    call: String,
    description: &'static str,
    runtime: &str,
) -> TransformResult<FigmaRequest> {
    identity(&file_key)?;
    identity(page_id)?;
    let file = json!(file_key);
    let page = json!(page_id);
    bounded_request(FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description,
        publication: None,
        code: format!(
            "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const page=await figma.getNodeByIdAsync({page});if(!page||page.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(page);\n{runtime}\nreturn await WorldbendFigmaHandoff.{call};"
        ),
    })
}

pub fn inspect(input: FigmaInspectInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    let call = format!(
        "inspect({},{},{})",
        json!(input.node_id),
        json!(input.file_key),
        json!(input.page_id)
    );
    packet_runtime(
        input.file_key,
        &input.page_id,
        call,
        "Read a Worldbend editable result and its visual preview",
        TRANSFORM_RUNTIME,
    )
}

pub fn create_native(input: FigmaNativeCreateInput) -> TransformResult<FigmaRequest> {
    for id in [&input.file_key, &input.page_id, &input.source_node_id] {
        identity(id)?;
    }
    if input.request_id.is_empty()
        || input.request_id.len() > 80
        || !input
            .request_id
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || matches!(v, b'-' | b'_'))
        || !input.request_id.as_bytes()[0].is_ascii_alphanumeric()
        || input
            .name
            .as_ref()
            .is_some_and(|v| v.trim().is_empty() || v.chars().count() > 80)
    {
        return Err(input_error(
            "Choose a bounded native creation identity and name",
        ));
    }
    native_spec(&input.spec)?;
    let width = axis(input.width)?;
    let height = axis(input.height)?;
    let solved = solve_spec(
        &input.spec,
        Some(Size {
            width: f64::from(width),
            height: f64::from(height),
        }),
    )?;
    let mut arguments = serde_json::to_value(&input)
        .map_err(|_| input_error("Native creation serialization failed"))?;
    arguments["inverse"] = json!(solved.homography.inverse);
    arguments["renderWidth"] = json!(width);
    arguments["renderHeight"] = json!(height);
    if let Some(facts) = &input.source_facts {
        if facts.source_node_id != input.source_node_id
            || facts.expected.is_empty()
            || facts.expected.len() > 256
        {
            return Err(input_error(
                "Use the returned source facts for this native source",
            ));
        }
        arguments["nativePlan"] = json!(worldbend_core::plan_native_frame(
            &worldbend_core::NativeFramePlanInput {
                spec: input.spec.clone(),
                source_size: Size::new(facts.width, facts.height),
                output_size: Size::new(input.width, input.height),
            }
        )?);
    }
    let method = if input.source_facts.is_some() {
        "createNative"
    } else {
        "probeNativeSource"
    };
    let prepare = if input.source_facts.is_some() {
        packet_runtime
    } else {
        read_request_runtime
    };
    prepare(
        input.file_key,
        &input.page_id,
        format!("{method}({arguments})"),
        "Create an independent editable native Perspective result; preserve the original Frame and recover the same work on retry",
        NATIVE_CREATE_RUNTIME,
    )
}

pub(crate) fn validate_native_snapshot(saved: &FigmaSnapshot) -> TransformResult<()> {
    for value in [
        &saved.file_key,
        &saved.page_id,
        &saved.node_id,
        &saved.source.node_id,
    ] {
        identity(value)?;
    }
    if saved.schema != "worldbend.figma.handoff"
        || !["0.1", "0.2"].contains(&saved.version.as_str())
        || (saved.version == "0.2") != saved.component_frame
        || (saved.affine_state.is_some() && !saved.component_frame)
        || (saved.source_editing && (!saved.component_frame || saved.affine_state.is_some()))
        || saved.revision > 9_007_199_254_740_991
        || saved.expected.is_empty()
        || saved.expected.len() > 8192
        || !saved.placement.x.is_finite()
        || !saved.placement.y.is_finite()
    {
        return Err(input_error("Invalid bounded Figma handoff snapshot"));
    }
    Size::new(saved.source.width, saved.source.height).validate("native logical source")?;
    if !saved.component_frame {
        axis(saved.source.width)?;
        axis(saved.source.height)?;
    }
    if let Some(state) = &saved.affine_state {
        if state.source_size != Size::new(saved.source.width, saved.source.height)
            || state.output_size != Size::new(saved.placement.width, saved.placement.height)
        {
            return Err(input_error(
                "Native affine state dimensions disagree with its snapshot",
            ));
        }
        worldbend_core::rebase_native_affine(state)?;
    }
    axis(saved.placement.width)?;
    axis(saved.placement.height)?;
    native_spec(&saved.spec)?;
    Ok(())
}

pub fn apply(input: FigmaApplyInput) -> TransformResult<FigmaRequest> {
    let saved = input.snapshot;
    validate_native_snapshot(&saved)?;
    native_spec(&input.spec)?;
    let width = input.width.map(f64::from).unwrap_or(saved.placement.width);
    let height = input
        .height
        .map(f64::from)
        .unwrap_or(saved.placement.height);
    let render_width = axis(width)?;
    let render_height = axis(height)?;
    let solved = solve_spec(
        &input.spec,
        Some(Size {
            width: f64::from(render_width),
            height: f64::from(render_height),
        }),
    )?;
    let mut arguments = json!({
        "fileKey": saved.file_key, "pageId": saved.page_id, "nodeId": saved.node_id,
        "expected": saved.expected, "spec": input.spec,
        "inverse": solved.homography.inverse, "width": width, "height": height,
        "renderWidth": render_width, "renderHeight": render_height,
    });
    if saved.component_frame {
        arguments["nativePlan"] = json!(worldbend_core::plan_native_frame(
            &worldbend_core::NativeFramePlanInput {
                spec: input.spec,
                source_size: Size::new(saved.source.width, saved.source.height),
                output_size: Size::new(width, height),
            }
        )?);
    }
    let call = format!("apply({arguments})");
    packet_runtime(
        saved.file_key,
        &saved.page_id,
        call,
        "Apply a core-validated transform to the same editable Figma result",
        TRANSFORM_RUNTIME,
    )
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum FigmaEffectTaskKind {
    Effect,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FigmaEffectTask {
    kind: FigmaEffectTaskKind,
    pub(crate) recipe: EffectRecipe,
    pub(crate) state: EffectState,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectCreateInput {
    file_key: String,
    page_id: String,
    #[schemars(length(min = 2, max = 8))]
    source_node_ids: Vec<String>,
    task: FigmaEffectTask,
    #[schemars(
        length(min = 1, max = 80),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    )]
    request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 80))]
    name: Option<String>,
}

pub fn effect_create(input: FigmaEffectCreateInput) -> TransformResult<FigmaRequest> {
    identity(&input.file_key)?;
    identity(&input.page_id)?;
    figma_effect_task(&input.task)?;
    if input.source_node_ids.len() != input.task.recipe.layers.len()
        || input
            .source_node_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.source_node_ids.len()
        || input
            .name
            .as_ref()
            .is_some_and(|name| name.trim().is_empty() || name.chars().count() > 80)
        || input.request_id.is_empty()
        || input.request_id.len() > 80
        || !input
            .request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        || !input.request_id.as_bytes()[0].is_ascii_alphanumeric()
    {
        return Err(input_error(
            "Choose distinct Depth sources matching the recipe and a bounded creation identity/name",
        ));
    }
    for id in &input.source_node_ids {
        identity(id)?;
    }
    let arguments = serde_json::to_value(&input)
        .map_err(|_| input_error("Depth creation serialization failed"))?;
    let file = json!(input.file_key);
    let page = json!(input.page_id);
    bounded_request(FigmaRequest {
        file_key: input.file_key,
        skill_names: "figma-use",
        description: "Create an editable linked Depth task beside existing artwork; export the returned sources, then core-render and publish through figma_effect_publish",
        code: format!(
            "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{EFFECT_CREATE_RUNTIME}\nreturn await WorldbendFigmaHandoff.createEffect({arguments});"
        ),
        publication: None,
    })
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectDraft {
    schema: String,
    version: String,
    base_revision: u64,
    fingerprint: String,
    task: FigmaEffectTask,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectSnapshot {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    /// Legacy snapshots predate cold creation and only described published results.
    #[serde(default = "legacy_effect_published")]
    published: bool,
    task: FigmaEffectTask,
    #[schemars(length(min = 2, max = 8))]
    source_node_ids: Vec<String>,
    #[serde(default)]
    #[schemars(length(max = 8))]
    sources: Vec<FigmaMockupSource>,
    placement: FigmaPlacement,
    #[serde(default)]
    draft: Option<FigmaEffectDraft>,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

fn legacy_effect_published() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectSourcesInput {
    snapshot: FigmaEffectSnapshot,
    #[schemars(length(min = 2, max = 8))]
    source_node_ids: Vec<String>,
    #[serde(default)]
    include_source_rasters: bool,
    #[serde(default)]
    source_raster_transport: FigmaRasterTransport,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectSourceSet {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    result_expected: String,
    #[schemars(length(min = 2, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(min = 2, max = 8))]
    sources: Vec<FigmaMockupSource>,
}

fn effect_source_ids(ids: &[String], target: &str) -> TransformResult<()> {
    if !(2..=8).contains(&ids.len())
        || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        || ids.iter().any(|id| id == target)
    {
        return Err(input_error(
            "Choose 2..8 distinct Depth sources excluding the result",
        ));
    }
    for id in ids {
        identity(id)?;
    }
    Ok(())
}

fn effect_source_set(
    set: &FigmaEffectSourceSet,
    saved: &FigmaEffectSnapshot,
) -> TransformResult<()> {
    effect_source_ids(&set.source_node_ids, &saved.node_id)?;
    if set.schema != "worldbend.figma.effect-sources"
        || set.version != "0.1"
        || set.file_key != saved.file_key
        || set.page_id != saved.page_id
        || set.node_id != saved.node_id
        || set.revision != saved.revision
        || set.result_expected != saved.expected
        || set.sources.len() != set.source_node_ids.len()
    {
        return Err(input_error(
            "Depth source proposal must match the inspected result and revision",
        ));
    }
    for (index, source) in set.sources.iter().enumerate() {
        if source.node_id != set.source_node_ids[index]
            || source.slot_id != format!("source-{}", index + 1)
            || !source.width.is_finite()
            || source.width <= 0.0
            || !source.height.is_finite()
            || source.height <= 0.0
            || source.name.chars().count() > 128
            || !valid_preview_fingerprint(&source.preview_fingerprint)
        {
            return Err(input_error("Invalid Depth source proposal summary"));
        }
    }
    Ok(())
}

pub fn effect_sources(input: FigmaEffectSourcesInput) -> TransformResult<FigmaRequest> {
    figma_effect_snapshot(&input.snapshot)?;
    effect_source_ids(&input.source_node_ids, &input.snapshot.node_id)?;
    let saved = input.snapshot;
    packet_runtime(
        saved.file_key.clone(),
        &saved.page_id,
        format!(
            "inspectEffectSources({})",
            json!({"fileKey":saved.file_key,"pageId":saved.page_id,"nodeId":saved.node_id,
            "revision":saved.revision,"expected":saved.expected,"sourceNodeIds":input.source_node_ids,
            "includeSourceRasters":input.include_source_rasters,"sourceRasterTransport":input.source_raster_transport.name()})
        ),
        "Read proposed Depth sources and their current pixels without changing the saved work; reject stale state and cyclic dependencies",
        EFFECT_SOURCES_RUNTIME,
    )
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectStageInput {
    snapshot: FigmaEffectSnapshot,
    task: FigmaEffectTask,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectContinuationInput {
    snapshot: FigmaEffectSnapshot,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectContinuationOrigin {
    #[schemars(length(min = 1, max = 256))]
    file_key: String,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(length(min = 1, max = 256))]
    node_id: String,
    revision: u64,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectContinuationBinding {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    role: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    asset_id: String,
    #[schemars(length(min = 1, max = 256))]
    source_node_id: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum FigmaEffectContinuationLoss {
    /// The caller still resolves or exports decoded media for each asset ID.
    SourceMediaNotEmbedded,
    /// Figma canvas coordinates do not become Web layout coordinates.
    FigmaPlacementNotTransferred,
    /// A staged, unpublished Agent draft is intentionally not continued.
    StagedDraftExcluded,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectContinuation {
    #[schemars(schema_with = "figma_effect_continuation_schema_schema")]
    schema: String,
    #[schemars(schema_with = "figma_effect_continuation_version_schema")]
    version: String,
    origin: FigmaEffectContinuationOrigin,
    #[schemars(length(min = 2, max = 8))]
    source_bindings: Vec<FigmaEffectContinuationBinding>,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    expression_id: String,
    initial_state: EffectState,
    document: SpatialDocumentSpec,
    delivery_plan: SpatialDocumentDeliveryPlan,
    #[schemars(length(min = 2, max = 3))]
    losses: Vec<FigmaEffectContinuationLoss>,
}

pub(crate) fn figma_effect_task(task: &FigmaEffectTask) -> TransformResult<()> {
    if task.recipe.version != "3" || !(2..=8).contains(&task.recipe.layers.len()) {
        return Err(input_error(
            "Figma Spatial requires one version-3 effect task with 2..8 ordered planes",
        ));
    }
    if !figma_integer_axis(task.recipe.viewport.width)
        || !figma_integer_axis(task.recipe.viewport.height)
    {
        return Err(input_error(
            "Figma Depth viewport axes must be integers in 1..4096",
        ));
    }
    for layer in &task.recipe.layers {
        let EffectSurface::CameraPlane {
            depth_map, size, ..
        } = &layer.surface
        else {
            return Err(input_error("Figma Spatial supports camera planes only"));
        };
        if depth_map.is_some() || !layer.tracks.is_empty() {
            return Err(input_error(
                "Figma Spatial requires ordered named camera planes without depth maps or layer tracks",
            ));
        }
        if ![size.width, size.height]
            .into_iter()
            .all(|axis| axis.is_finite() && (1.0..=4096.0).contains(&axis))
        {
            return Err(input_error(
                "Figma Depth logical plane axes must be finite in 1..4096",
            ));
        }
    }
    effect_plan(&EffectPlanInput {
        recipe: task.recipe.clone(),
        state: task.state.clone(),
        motion: None,
        expected_fingerprint: None,
    })?;
    Ok(())
}

fn figma_effect_snapshot(saved: &FigmaEffectSnapshot) -> TransformResult<()> {
    if saved.source_node_ids.len() != saved.task.recipe.layers.len()
        || !(2..=8).contains(&saved.source_node_ids.len())
    {
        return Err(input_error(
            "Figma Spatial source bindings must match its 2..8 ordered recipe layers",
        ));
    }
    for value in [&saved.file_key, &saved.page_id, &saved.node_id]
        .into_iter()
        .chain(saved.source_node_ids.iter())
    {
        identity(value)?;
    }
    if saved.schema != "worldbend.figma.effect-handoff"
        || saved.version != "0.1"
        || saved.revision < 1
        || saved.revision > 9_007_199_254_740_991
        || saved.expected.is_empty()
        || saved.expected.len() > 8192
        || !saved.placement.x.is_finite()
        || !saved.placement.y.is_finite()
        || saved
            .source_node_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != saved.source_node_ids.len()
    {
        return Err(input_error(
            "Invalid bounded Figma Spatial handoff snapshot",
        ));
    }
    axis(saved.placement.width)?;
    axis(saved.placement.height)?;
    if !saved.sources.is_empty() {
        if saved.sources.len() != saved.source_node_ids.len() {
            return Err(input_error(
                "Depth source summaries must match the ordered binding",
            ));
        }
        for (index, source) in saved.sources.iter().enumerate() {
            if source.slot_id != format!("source-{}", index + 1)
                || source.node_id != saved.source_node_ids[index]
                || !source.width.is_finite()
                || source.width <= 0.0
                || !source.height.is_finite()
                || source.height <= 0.0
                || source.name.chars().count() > 128
                || !valid_preview_fingerprint(&source.preview_fingerprint)
            {
                return Err(input_error("Invalid Depth source summary"));
            }
        }
    }
    figma_effect_task(&saved.task)?;
    if let Some(draft) = &saved.draft {
        if draft.schema != "worldbend.figma.effect-draft"
            || draft.version != "0.1"
            || draft.base_revision != saved.revision
            || !draft.fingerprint.starts_with("sha256:")
            || draft.fingerprint.len() != 71
            || !draft.fingerprint[7..]
                .chars()
                .all(|value| value.is_ascii_digit() || ('a'..='f').contains(&value))
        {
            return Err(input_error("Invalid staged Figma Spatial draft"));
        }
        figma_effect_task(&draft.task)?;
    }
    Ok(())
}

pub fn effect_inspect(input: FigmaInspectInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    let call = if input.include_source_rasters {
        format!(
            "inspectEffectWithSources({},{},{},{})",
            json!(input.node_id),
            json!(input.file_key),
            json!(input.page_id),
            json!(input.source_raster_transport.name())
        )
    } else {
        format!(
            "inspectEffect({},{},{})",
            json!(input.node_id),
            json!(input.file_key),
            json!(input.page_id)
        )
    };
    packet(
        input.file_key,
        &input.page_id,
        call,
        if input.include_source_rasters {
            "Read a published Figma Spatial recipe with its bound sources' viewport-scale rasters, source-role order and any staged Agent draft"
        } else {
            "Read a published Figma Spatial recipe, its source-role order and any staged Agent draft"
        },
    )
}

pub fn effect_stage(input: FigmaEffectStageInput) -> TransformResult<FigmaRequest> {
    figma_effect_snapshot(&input.snapshot)?;
    figma_effect_task(&input.task)?;
    if input.task.recipe.layers.len() != input.snapshot.source_node_ids.len() {
        return Err(input_error(
            "Depth edits must retain the inspected source count",
        ));
    }
    let plan = effect_plan(&EffectPlanInput {
        recipe: input.task.recipe.clone(),
        state: input.task.state.clone(),
        motion: None,
        expected_fingerprint: None,
    })?;
    let saved = input.snapshot;
    let call = format!(
        "stageEffect({})",
        json!({
            "fileKey": saved.file_key,
            "pageId": saved.page_id,
            "nodeId": saved.node_id,
            "expected": saved.expected,
            "task": input.task,
            "fingerprint": plan.fingerprint,
        })
    );
    packet(
        saved.file_key,
        &saved.page_id,
        call,
        "Stage a core-validated Spatial recipe for visual review and publication in the Figma plugin; published pixels are unchanged",
    )
}

/// Continue the published Figma relationship through the existing durable
/// document and Web delivery contracts. This is a pure projection of the
/// inspected snapshot: it does not read Figma, export media, or publish Web UI.
pub fn effect_continuation(
    input: FigmaEffectContinuationInput,
) -> TransformResult<FigmaEffectContinuation> {
    figma_effect_snapshot(&input.snapshot)?;
    if !input.snapshot.published {
        return Err(input_error(
            "Publish the created Depth image before continuing its published relationship",
        ));
    }
    let saved = input.snapshot;
    let source_bindings = saved
        .task
        .recipe
        .layers
        .iter()
        .map(|layer| layer.id.clone())
        .zip(saved.source_node_ids.iter())
        .map(|(role, source_node_id)| FigmaEffectContinuationBinding {
            asset_id: role.clone(),
            role,
            source_node_id: source_node_id.clone(),
        })
        .collect::<Vec<_>>();
    let assets = source_bindings
        .iter()
        .map(|binding| SpatialDocumentAsset {
            id: binding.asset_id.clone(),
            content_version: None,
        })
        .collect::<Vec<_>>();
    let bindings = source_bindings
        .iter()
        .map(|binding| SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::Content,
            slot_id: binding.role.clone(),
            asset_id: binding.asset_id.clone(),
        })
        .collect::<Vec<_>>();
    let delivery = prepare_spatial_interactive_delivery(&SpatialInteractiveDeliveryInput {
        expression_id: FIGMA_EFFECT_EXPRESSION_ID.to_owned(),
        recipe: saved.task.recipe.clone(),
        initial_state: saved.task.state.clone(),
        assets,
        bindings,
    })?;
    let mut losses = vec![
        FigmaEffectContinuationLoss::SourceMediaNotEmbedded,
        FigmaEffectContinuationLoss::FigmaPlacementNotTransferred,
    ];
    if saved.draft.is_some() {
        losses.push(FigmaEffectContinuationLoss::StagedDraftExcluded);
    }
    Ok(FigmaEffectContinuation {
        schema: FIGMA_EFFECT_CONTINUATION_SCHEMA.to_owned(),
        version: FIGMA_EFFECT_CONTINUATION_VERSION.to_owned(),
        origin: FigmaEffectContinuationOrigin {
            file_key: saved.file_key,
            page_id: saved.page_id,
            node_id: saved.node_id,
            revision: saved.revision,
            expected: saved.expected,
        },
        source_bindings,
        expression_id: FIGMA_EFFECT_EXPRESSION_ID.to_owned(),
        initial_state: delivery.initial_state,
        document: delivery.document,
        delivery_plan: delivery.delivery_plan,
        losses,
    })
}

fn figma_effect_continuation_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": FIGMA_EFFECT_CONTINUATION_SCHEMA })
}

fn figma_effect_continuation_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": FIGMA_EFFECT_CONTINUATION_VERSION })
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupInspectInput {
    #[schemars(
        length(min = 1, max = 2048),
        description = "Figma design link to one selected Worldbend Composition result; must include node-id"
    )]
    url: String,
    #[schemars(
        default,
        description = "Also export every bound source at the result's stored raster size (base64 PNG per slot) so the Agent can render a complete publication"
    )]
    #[serde(default)]
    include_source_rasters: bool,
    #[serde(default)]
    #[schemars(
        description = "inline returns base64 in text for small images; artifact emits named PNG image artifacts through supported Figma io.write without large text fields"
    )]
    source_raster_transport: FigmaRasterTransport,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaTemplatesInspectInput {
    #[schemars(
        length(min = 1, max = 2048),
        description = "Figma design link of the granted file; node-id is not required"
    )]
    url: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum FigmaReadySceneId {
    StudioPoster,
    DesktopScreen,
    CartonLabel,
    StudioCan,
    HangingFabric,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FigmaSceneChoice {
    Ready { id: FigmaReadySceneId },
    Native { snapshot: Box<FigmaMockupSnapshot> },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum FigmaSceneFit {
    #[default]
    Cover,
    Contain,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaSceneCreateInput {
    url: String,
    page_id: String,
    scene: FigmaSceneChoice,
    #[schemars(length(min = 1, max = 8))]
    artwork_node_ids: Vec<String>,
    #[serde(default)]
    fit: FigmaSceneFit,
    #[serde(default)]
    #[schemars(length(min = 1, max = 80))]
    name: Option<String>,
    #[serde(default)]
    #[schemars(
        length(min = 1, max = 80),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$"),
        description = "Optional stable creation identity for retrying preparation across Agent sessions. Each prepared request already carries a stable generated identity; executing that request again returns its existing scene."
    )]
    request_id: Option<String>,
}

pub fn scene_create(input: FigmaSceneCreateInput) -> TransformResult<FigmaRequest> {
    let file_key = figma_file_link(&input.url)?;
    identity(&input.page_id)?;
    if input.artwork_node_ids.is_empty()
        || input.artwork_node_ids.len() > 8
        || input
            .artwork_node_ids
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != input.artwork_node_ids.len()
        || input
            .name
            .as_ref()
            .is_some_and(|name| name.trim().is_empty() || name.chars().count() > 80)
    {
        return Err(input_error(
            "Choose bounded distinct artwork slots and a nonempty scene name",
        ));
    }
    for id in &input.artwork_node_ids {
        identity(id)?;
    }
    if input.request_id.as_ref().is_some_and(|id| {
        id.is_empty()
            || id.len() > 80
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
            || !id.as_bytes()[0].is_ascii_alphanumeric()
    }) {
        return Err(input_error("Invalid bounded scene creation identity"));
    }
    static NEXT_SCENE_REQUEST: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let request_id = input.request_id.unwrap_or_else(|| {
        format!(
            "scene-{:x}-{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            NEXT_SCENE_REQUEST.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        )
    });
    let (scene, runtime) = match input.scene {
        FigmaSceneChoice::Ready { id } => {
            if input.artwork_node_ids.len() != 1 {
                return Err(input_error("Ready scenes need one artwork slot"));
            }
            let (id, runtime) = match id {
                FigmaReadySceneId::StudioPoster => (
                    "studio-poster",
                    include_str!("figma-runtime-scene-ready-create-studio-poster.js"),
                ),
                FigmaReadySceneId::DesktopScreen => (
                    "desktop-screen",
                    include_str!("figma-runtime-scene-ready-create-desktop-screen.js"),
                ),
                FigmaReadySceneId::CartonLabel => (
                    "carton-label",
                    include_str!("figma-runtime-scene-ready-create-carton-label.js"),
                ),
                FigmaReadySceneId::StudioCan => (
                    "studio-can",
                    include_str!("figma-runtime-scene-ready-create-studio-can.js"),
                ),
                FigmaReadySceneId::HangingFabric => (
                    "hanging-fabric",
                    include_str!("figma-runtime-scene-ready-create-hanging-fabric.js"),
                ),
            };
            (json!({ "kind": "ready", "id": id }), runtime)
        }
        FigmaSceneChoice::Native { snapshot } => {
            figma_mockup_snapshot(&snapshot)?;
            if snapshot.file_key != file_key || snapshot.page_id != input.page_id {
                return Err(input_error(
                    "The native scene snapshot must match the granted file and page",
                ));
            }
            (
                json!({ "kind": "native", "nodeId": snapshot.node_id, "revision": snapshot.revision, "expected": snapshot.expected }),
                SCENE_CREATE_RUNTIME,
            )
        }
    };
    let has_name = input.name.is_some();
    let mut arguments = json!({ "fileKey": file_key, "pageId": input.page_id, "scene": scene,
        "artworkNodeIds": input.artwork_node_ids, "fit": input.fit, "name": input.name, "requestId": request_id });
    if !has_name {
        arguments.as_object_mut().unwrap().remove("name");
    }
    let arguments = packet_literal(&arguments)?;
    bounded_request(FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description: "Create an independent editable native scene with current artwork; export the returned snapshot sources and render/publish through figma_mockup_publish",
        code: format!(
            "const sceneInput={arguments};if(figma.fileKey!==sceneInput.fileKey)throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync(sceneInput.pageId);if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{runtime}\nreturn await WorldbendFigmaHandoff.createScene(sceneInput);"
        ),
        publication: None,
    })
}

/// File-level link: same shape as a result link without the node-id demand.
fn figma_file_link(url: &str) -> TransformResult<String> {
    if url.len() > 2048 {
        return Err(input_error("Expected a bounded Figma design link"));
    }
    let url = url.split_once('#').map_or(url, |(before, _)| before);
    let path_and_query = url
        .strip_prefix("https://www.figma.com/")
        .or_else(|| url.strip_prefix("https://figma.com/"))
        .ok_or_else(|| input_error("Expected an HTTPS Figma design link"))?;
    let path = path_and_query.split('?').next().unwrap_or_default();
    let mut path_parts = path.split('/');
    if !matches!(path_parts.next(), Some("design" | "file")) {
        return Err(input_error("Expected a Figma design or file link"));
    }
    let file_key = path_parts.next().unwrap_or_default();
    if file_key.is_empty()
        || file_key.len() > 256
        || !file_key.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(input_error("Invalid Figma file key"));
    }
    Ok(file_key.to_owned())
}

/// Read the client's reusable scene templates with slot and appearance
/// boundaries; read-only and node-independent.
pub fn templates_inspect(input: FigmaTemplatesInspectInput) -> TransformResult<FigmaRequest> {
    let file_key = figma_file_link(&input.url)?;
    let file = json!(file_key);
    let code = format!(
        "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');\n{SCENE_RUNTIME}\nreturn await WorldbendFigmaHandoff.inspectTemplates({file});"
    );
    let request = FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description: "List the saved reusable scene templates with their editable slots and appearance boundaries",
        code,
        publication: None,
    };
    bounded_request(request)
}

fn decode_query_value(value: &str) -> TransformResult<String> {
    let mut bytes = Vec::with_capacity(value.len());
    let source = value.as_bytes();
    let mut index = 0;
    while index < source.len() {
        if source[index] == b'%' {
            let hex = source
                .get(index + 1..index + 3)
                .ok_or_else(|| input_error("Invalid Figma link encoding"))?;
            let decoded = u8::from_str_radix(
                std::str::from_utf8(hex).map_err(|_| input_error("Invalid Figma link encoding"))?,
                16,
            )
            .map_err(|_| input_error("Invalid Figma link encoding"))?;
            bytes.push(decoded);
            index += 3;
        } else {
            bytes.push(source[index]);
            index += 1;
        }
    }
    String::from_utf8(bytes).map_err(|_| input_error("Invalid Figma link encoding"))
}

fn figma_result_link(url: &str) -> TransformResult<(String, String)> {
    if url.len() > 2048 {
        return Err(input_error(
            "Expected a bounded Figma design link with node-id",
        ));
    }
    let url = url.split_once('#').map_or(url, |(before, _)| before);
    let path_and_query = url
        .strip_prefix("https://www.figma.com/")
        .or_else(|| url.strip_prefix("https://figma.com/"))
        .ok_or_else(|| input_error("Expected an HTTPS Figma design link"))?;
    let (path, query) = path_and_query
        .split_once('?')
        .ok_or_else(|| input_error("Figma result link must contain node-id"))?;
    let mut path_parts = path.split('/');
    if !matches!(path_parts.next(), Some("design" | "file")) {
        return Err(input_error("Expected a Figma design or file link"));
    }
    let file_key = path_parts.next().unwrap_or_default();
    if file_key.is_empty()
        || file_key.len() > 256
        || !file_key.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(input_error("Invalid Figma file key"));
    }
    let raw_node = query
        .split('&')
        .find_map(|part| part.strip_prefix("node-id="))
        .ok_or_else(|| input_error("Figma result link must contain node-id"))?;
    let node_id = decode_query_value(raw_node)?.replace('-', ":");
    identity(&node_id)?;
    Ok((file_key.to_owned(), node_id))
}

pub fn mockup_inspect(input: FigmaMockupInspectInput) -> TransformResult<FigmaRequest> {
    let (file_key, node_id) = figma_result_link(&input.url)?;
    let file = json!(file_key);
    let node = json!(node_id);
    let call = if input.include_source_rasters {
        format!(
            "inspectMockupWithSources({node},{file},grantedPage.id,{})",
            json!(input.source_raster_transport.name())
        )
    } else {
        format!("inspectMockup({node},{file},grantedPage.id)")
    };
    let code = format!(
        "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const selected=await figma.getNodeByIdAsync({node});let grantedPage=selected;while(grantedPage&&grantedPage.type!=='PAGE')grantedPage=grantedPage.parent;if(!grantedPage)throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{RUNTIME}\nconst state=await WorldbendFigmaHandoff.{call};const result=await figma.getNodeByIdAsync(state.previewNodeId||state.nodeId);await result.screenshot({{scale:Math.min(1,1024/Math.max(result.width||state.placement.width,result.height||state.placement.height))}});return state;"
    );
    let request = FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description: if input.include_source_rasters {
            "Read a linked Composition result with its bound sources' full rasters, source roles and any staged Agent draft from the Figma file"
        } else {
            "Read a linked Composition result, its source roles and any staged Agent draft from the Figma file"
        },
        code,
        publication: None,
    };
    bounded_request(request)
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum FigmaCompositionTask {
    Mockup {
        spec: MockupSpec,
    },
    Composition {
        template: Box<SpatialTemplateSpec>,
        #[serde(rename = "previewOutputId")]
        #[schemars(rename = "previewOutputId")]
        preview_output_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        motion: Option<FigmaCompositionMotion>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct FigmaCompositionMotion {
    pub spec: worldbend_core::MockupMotionSpec,
    #[schemars(range(min = 0, max = 239))]
    pub frame: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupSource {
    pub(crate) slot_id: String,
    pub(crate) node_id: String,
    pub(crate) name: String,
    pub(crate) width: f64,
    pub(crate) height: f64,
    #[schemars(
        length(min = 30, max = 48),
        regex(pattern = r"^preview32x2:[1-9][0-9]*:[0-9a-f]{16}$")
    )]
    pub(crate) preview_fingerprint: String,
    /// Exact capture coordinates paired with preview_fingerprint, when owned.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_capture: Option<worldbend_core::SourceCaptureFacts>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupDraft {
    schema: String,
    version: String,
    base_revision: u64,
    task: FigmaCompositionTask,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupSnapshot {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    task: FigmaCompositionTask,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(min = 1, max = 8))]
    sources: Vec<FigmaMockupSource>,
    placement: FigmaPlacement,
    #[serde(default)]
    draft: Option<FigmaMockupDraft>,
    #[serde(default)]
    draft_issue: Option<String>,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupStageInput {
    snapshot: FigmaMockupSnapshot,
    task: FigmaCompositionTask,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaCompositionContinuationInput {
    snapshot: FigmaMockupSnapshot,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaCompositionContinuationOrigin {
    #[schemars(length(min = 1, max = 256))]
    file_key: String,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(length(min = 1, max = 256))]
    node_id: String,
    revision: u64,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaCompositionContinuationBinding {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    slot_id: String,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    asset_id: String,
    #[schemars(length(min = 1, max = 256))]
    source_node_id: String,
    #[schemars(length(max = 128))]
    source_name: String,
    width: f64,
    height: f64,
    #[schemars(
        length(min = 30, max = 48),
        regex(pattern = r"^preview32x2:[1-9][0-9]*:[0-9a-f]{16}$")
    )]
    preview_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum FigmaCompositionContinuationLoss {
    /// The caller still exports and resolves the original source bytes.
    SourceMediaNotEmbedded,
    /// Figma canvas coordinates do not become downstream layout coordinates.
    FigmaPlacementNotTransferred,
    /// The bounded Figma preview fingerprint is a change token, not a content digest.
    PreviewFingerprintNotContentDigest,
    /// A staged, unpublished Agent draft is intentionally not continued.
    StagedDraftExcluded,
    /// Figma reported a stale or invalid staged draft that could not be loaded.
    StagedDraftUnavailable,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaCompositionContinuation {
    #[schemars(schema_with = "figma_composition_continuation_schema_schema")]
    schema: String,
    #[schemars(schema_with = "figma_composition_continuation_version_schema")]
    version: String,
    origin: FigmaCompositionContinuationOrigin,
    #[schemars(length(min = 2, max = 8))]
    source_bindings: Vec<FigmaCompositionContinuationBinding>,
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    expression_id: String,
    document: SpatialDocumentSpec,
    delivery_plan: SpatialDocumentDeliveryPlan,
    #[schemars(length(min = 3, max = 5))]
    losses: Vec<FigmaCompositionContinuationLoss>,
}

pub(crate) fn composition_presentation(
    template: &SpatialTemplateSpec,
    output_id: &str,
) -> TransformResult<worldbend_core::MockupMotionPresentation> {
    let SpatialTemplateOperation::CompositionProgram { postprocess, .. } = &template.operation
    else {
        return Err(input_error("Select Composition work"));
    };
    let [
        RasterProgramStage::Transform {
            spec,
            canvas: RasterProgramCanvasMode::Reference,
            target_size: Some(size),
            ..
        },
    ] = postprocess.stages.as_slice()
    else {
        return Err(input_error(
            "Composition motion needs its supported whole transform",
        ));
    };
    if !figma_integer_axis(size.width) || !figma_integer_axis(size.height) {
        return Err(input_error(
            "Composition motion viewport must use integer raster axes",
        ));
    }
    let value = worldbend_core::MockupMotionPresentation {
        transform: spec.clone(),
        size: PixelSize::new(size.width as u32, size.height as u32),
        output: template.output.clone(),
        output_id: output_id.into(),
        keyframes: vec![],
    };
    worldbend_core::plan_mockup_motion_presentation(&value)?;
    Ok(value)
}

pub(crate) fn figma_mockup_task(
    task: &FigmaCompositionTask,
    source_count: usize,
) -> TransformResult<()> {
    if serde_json::to_vec(task)
        .map_err(|_| input_error("Figma task serialization failed"))?
        .len()
        > 90 * 1024
    {
        return Err(input_error(
            "This animated Composition exceeds the Figma shared-entry storage envelope",
        ));
    }
    let spec = match task {
        FigmaCompositionTask::Mockup { spec } => spec,
        FigmaCompositionTask::Composition {
            template,
            preview_output_id,
            motion,
        } => {
            inspect_spatial_template(template)?;
            let SpatialTemplateOperation::CompositionProgram {
                composition,
                postprocess,
            } = &template.operation
            else {
                return Err(input_error(
                    "A continued Figma Composition must contain one Composition Program",
                ));
            };
            if let Some(motion) = motion {
                let planned = worldbend_core::plan_mockup_motion(&motion.spec)?;
                let sampled = planned
                    .frame_specs
                    .get(motion.frame as usize)
                    .ok_or_else(|| input_error("Select a frame inside the saved animation"))?;
                if sampled != composition {
                    return Err(input_error(
                        "The saved animation frame must match the published Composition pose",
                    ));
                }
            }
            let [
                RasterProgramStage::Transform {
                    spec,
                    canvas,
                    target_size: Some(target_size),
                    ..
                },
            ] = postprocess.stages.as_slice()
            else {
                return Err(input_error(
                    "Figma whole-result processing requires one bounded Transform stage",
                ));
            };
            if *canvas != RasterProgramCanvasMode::Reference
                || spec.destination.space != CoordinateSpace::Normalized
                || !figma_integer_axis(target_size.width)
                || !figma_integer_axis(target_size.height)
            {
                return Err(input_error(
                    "Figma whole-result processing requires a normalized reference canvas from 1..4096 pixels",
                ));
            }
            let source_size = PixelSize::new(target_size.width as u32, target_size.height as u32);
            if let Some(motion) = motion.as_ref().filter(|m| m.spec.presentation.is_some()) {
                let plan = worldbend_core::plan_mockup_motion(&motion.spec)?;
                let mut presentation = plan
                    .presentation_at(motion.frame as usize)
                    .expect("validated motion frame")
                    .spec
                    .clone();
                presentation.keyframes.clear();
                let expected = worldbend_core::MockupMotionPresentation {
                    transform: spec.clone(),
                    size: source_size,
                    output: template.output.clone(),
                    output_id: preview_output_id.clone(),
                    keyframes: vec![],
                };
                if presentation != expected {
                    return Err(input_error(
                        "Saved motion presentation must match the Composition whole transform and selected output",
                    ));
                }
            }
            match &template.output {
                SpatialTemplateOutput::Single { id } if id == preview_output_id => {}
                SpatialTemplateOutput::CanvasSet { spec } => {
                    if spec.variants.is_empty()
                        || spec.variants.len() > 8
                        || !spec
                            .variants
                            .iter()
                            .any(|variant| &variant.id == preview_output_id)
                        || spec.variants.iter().any(|variant| {
                            !matches!(
                                variant.operation,
                                CanvasOperation::Crop { .. }
                                    | CanvasOperation::Contain { .. }
                                    | CanvasOperation::Cover { .. }
                                    | CanvasOperation::Stretch { .. }
                            )
                        })
                    {
                        return Err(input_error(
                            "Figma Composition outputs require 1..8 supported named outputs and one selected preview",
                        ));
                    }
                    let plan = plan_canvas_set(spec, source_size)?;
                    if plan.variants.iter().any(|variant| {
                        variant.plan.output_size.width > 4096
                            || variant.plan.output_size.height > 4096
                    }) {
                        return Err(input_error(
                            "Figma Composition output axes must be within 1..4096 pixels",
                        ));
                    }
                }
                _ => {
                    return Err(input_error(
                        "The selected Figma Composition preview must name a declared output",
                    ));
                }
            }
            composition
        }
    };
    if !(1..=8).contains(&source_count)
        || spec.planes.is_empty()
        || spec.planes.len() > 8
        || !spec.seams.is_empty()
        || spec.canvas.width > 4096
        || spec.canvas.height > 4096
        || spec.planes.iter().any(|plane| {
            plane.measurement.is_some()
                || plane.transform.destination.space != CoordinateSpace::Normalized
        })
    {
        return Err(input_error(
            "Composition task exceeds the Figma carrier profile",
        ));
    }
    let slots: std::collections::HashSet<_> = spec
        .planes
        .iter()
        .map(|plane| plane.source_id.as_str())
        .collect();
    if slots.len() != source_count
        || (1..=source_count).any(|index| !slots.contains(format!("source-{index}").as_str()))
    {
        return Err(input_error(
            "Composition source slots must match the linked Figma sources",
        ));
    }
    plan_mockup(spec)?;
    Ok(())
}

fn figma_integer_axis(value: f64) -> bool {
    value.is_finite() && (1.0..=4096.0).contains(&value) && value.fract() == 0.0
}

fn figma_mockup_snapshot(saved: &FigmaMockupSnapshot) -> TransformResult<()> {
    for value in [&saved.file_key, &saved.page_id, &saved.node_id] {
        identity(value)?;
    }
    if saved.schema != "worldbend.figma.mockup-handoff"
        || saved.version != "0.1"
        || saved.revision == 0
        || saved.revision > 9_007_199_254_740_991
        || saved.source_node_ids.len() != saved.sources.len()
        || saved.source_node_ids.is_empty()
        || saved.source_node_ids.len() > 8
        || saved.expected.is_empty()
        || saved.expected.len() > 8192
        || (saved.draft.is_some() && saved.draft_issue.is_some())
        || saved
            .draft_issue
            .as_deref()
            .is_some_and(|issue| issue != "invalid-or-stale")
        || !saved.placement.x.is_finite()
        || !saved.placement.y.is_finite()
    {
        return Err(input_error("Invalid bounded Figma Composition snapshot"));
    }
    axis(saved.placement.width)?;
    axis(saved.placement.height)?;
    if saved
        .source_node_ids
        .iter()
        .collect::<std::collections::HashSet<_>>()
        .len()
        != saved.source_node_ids.len()
    {
        return Err(input_error("Duplicate Composition source binding"));
    }
    for (index, source) in saved.sources.iter().enumerate() {
        identity(&source.node_id)?;
        if source.slot_id != format!("source-{}", index + 1)
            || source.node_id != saved.source_node_ids[index]
            || !source.width.is_finite()
            || !source.height.is_finite()
            || source.width <= 0.0
            || source.height <= 0.0
            || source.name.chars().count() > 128
            || !valid_preview_fingerprint(&source.preview_fingerprint)
        {
            return Err(input_error("Invalid Composition source binding"));
        }
    }
    figma_mockup_task(&saved.task, saved.source_node_ids.len())?;
    if let Some(draft) = &saved.draft {
        if draft.schema != "worldbend.figma.mockup-draft"
            || draft.version != "0.1"
            || draft.base_revision != saved.revision
        {
            return Err(input_error("Invalid staged Composition draft"));
        }
        figma_mockup_task(&draft.task, saved.source_node_ids.len())?;
    }
    Ok(())
}

pub(crate) fn valid_preview_fingerprint(value: &str) -> bool {
    let mut parts = value.split(':');
    matches!(parts.next(), Some("preview32x2"))
        && parts
            .next()
            .is_some_and(|length| !length.starts_with('0') && length.parse::<usize>().is_ok())
        && parts.next().is_some_and(|hash| {
            hash.len() == 16
                && hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        && parts.next().is_none()
}

pub use crate::figma_source_raster::FigmaMockupSourceRaster;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaMockupPublishInput {
    snapshot: FigmaMockupSnapshot,
    task: FigmaCompositionTask,
    sources: Vec<FigmaMockupSourceRaster>,
}
impl FigmaMockupPublishInput {
    pub fn with_workspace(
        mut self,
        root: Option<&worldbend_agent_fs::WorkspaceRoot>,
    ) -> TransformResult<Self> {
        crate::figma_source_raster::hydrate_sources(&mut self.sources, root)?;
        Ok(self)
    }
}

/// Render the task through the shared core renderer and prepare one guarded
/// request that publishes the pixels onto the linked Figma result in place,
/// replacing the manual designer Apply for this run.
pub(crate) fn render_composition_image(
    task: &FigmaCompositionTask,
    sources: &[FigmaMockupSourceRaster],
) -> TransformResult<image::RgbaImage> {
    // Which MockupSpec the renderer consumes, and the bounded whole-result
    // stage a continued Composition applies afterwards. A linked result names
    // one output while preserving every authored sibling output in its task.
    let (composition_spec, whole_result): (
        &worldbend_core::MockupSpec,
        Option<(&worldbend_core::TransformSpec, worldbend_core::Size)>,
    ) = match task {
        FigmaCompositionTask::Mockup { spec } => (spec, None),
        FigmaCompositionTask::Composition {
            template,
            preview_output_id,
            ..
        } => {
            let worldbend_core::SpatialTemplateOperation::CompositionProgram {
                composition,
                postprocess,
            } = &template.operation
            else {
                return Err(input_error(
                    "A continued Figma Composition must contain one Composition Program",
                ));
            };
            match &template.output {
                worldbend_core::SpatialTemplateOutput::Single { id } if id == preview_output_id => {
                }
                worldbend_core::SpatialTemplateOutput::CanvasSet { spec }
                    if spec.variants.iter().any(|v| &v.id == preview_output_id) => {}
                _ => return Err(input_error("Select an existing Composition output")),
            }
            let [
                worldbend_core::RasterProgramStage::Transform {
                    spec,
                    canvas,
                    target_size: Some(target_size),
                    ..
                },
            ] = postprocess.stages.as_slice()
            else {
                return Err(input_error(
                    "Figma whole-result processing requires one bounded Transform stage",
                ));
            };
            if *canvas != worldbend_core::RasterProgramCanvasMode::Reference {
                return Err(input_error(
                    "Figma whole-result processing requires a reference canvas",
                ));
            }
            let size = worldbend_core::Size::new(target_size.width, target_size.height);
            (composition, Some((spec, size)))
        }
    };

    // Every distinct task slot must be supplied exactly once, no extras.
    let mut slots: Vec<String> = Vec::new();
    for plane in &composition_spec.planes {
        if !slots.contains(&plane.source_id) {
            slots.push(plane.source_id.clone());
        }
    }
    slots.sort_by_key(|slot| {
        slot.strip_prefix("source-")
            .and_then(|index| index.parse::<usize>().ok())
            .unwrap_or(0)
    });
    if sources.len() != slots.len()
        || sources
            .iter()
            .map(|source| source.slot_id())
            .ne(slots.iter())
    {
        return Err(input_error(
            "Publish sources must match the task's ordered source slots exactly",
        ));
    }

    let engine = base64::engine::general_purpose::STANDARD;
    let mut decoded = std::collections::HashMap::<String, image::DynamicImage>::new();
    for source in sources {
        let bytes = engine
            .decode(source.base64()?)
            .map_err(|_| input_error("Publish source base64 is invalid"))?;
        let raster = crate::figma_source_raster::logical_source_image(
            crate::figma_source_raster::decode_source_image(&bytes)?,
            source.source_capture(),
        )?;
        let width = raster.width();
        let height = raster.height();
        if width < 1 || height < 1 || width > 8192 || height > 8192 {
            return Err(input_error(
                "Publish source dimensions must stay in 1..8192 pixels",
            ));
        }
        decoded.insert(source.slot_id().to_owned(), raster);
    }

    let rendered = worldbend_render::render_mockup(
        &decoded,
        composition_spec,
        worldbend_render::MockupRenderOptions::default(),
    )
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Render,
            format!("Composition render failed: {}", error.message),
        )
    })?;
    let final_image = match whole_result {
        None => rendered.image,
        Some((spec, size)) => {
            let options = worldbend_render::RenderOptions {
                source_view: None,
                quality: worldbend_render::SamplingQuality::Standard,
                canvas: worldbend_render::CanvasMode::Reference,
                target_size: Some(size),
                limits: worldbend_render::RenderLimits::default(),
            };
            worldbend_render::render_image(
                &image::DynamicImage::ImageRgba8(rendered.image),
                spec,
                options,
            )
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Render,
                    format!("Whole-result render failed: {}", error.message),
                )
            })?
            .image
        }
    };
    if let FigmaCompositionTask::Composition {
        template,
        preview_output_id,
        ..
    } = task
        && let worldbend_core::SpatialTemplateOutput::CanvasSet { spec } = &template.output
    {
        let selected = spec
            .variants
            .iter()
            .find(|v| &v.id == preview_output_id)
            .ok_or_else(|| input_error("Select an existing Composition output"))?;
        let program = worldbend_core::RasterProgramSpec {
            schema: worldbend_core::RASTER_PROGRAM_SCHEMA.into(),
            version: worldbend_core::RASTER_PROGRAM_VERSION.into(),
            stages: vec![worldbend_core::RasterProgramStage::Canvas {
                id: selected.id.clone(),
                spec: worldbend_core::CanvasSpec {
                    schema: worldbend_core::CANVAS_SCHEMA.into(),
                    version: worldbend_core::CANVAS_VERSION.into(),
                    operation: selected.operation.clone(),
                },
            }],
        };
        return worldbend_render::render_raster_program(
            &image::DynamicImage::ImageRgba8(final_image),
            &program,
            worldbend_render::RasterProgramRenderOptions::default(),
        )
        .map(|result| result.image);
    }
    Ok(final_image)
}

pub fn mockup_publish(input: FigmaMockupPublishInput) -> TransformResult<FigmaRequest> {
    figma_mockup_snapshot(&input.snapshot)?;
    let source_count = input.snapshot.source_node_ids.len();
    figma_mockup_task(&input.task, source_count)?;
    let saved = input.snapshot;
    if input.sources.len() != saved.sources.len() {
        return Err(input_error(
            "Composition rasters must match the inspected sources",
        ));
    }
    for (raster, source) in input.sources.iter().zip(&saved.sources) {
        raster.validate_capture(source.source_capture)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(raster.base64()?)
            .map_err(|_| input_error("Publish source base64 is invalid"))?;
        if raster.slot_id() != source.slot_id
            || source_preview_fingerprint(&bytes) != source.preview_fingerprint
        {
            return Err(input_error(
                "Composition source raster differs from the inspected PNG",
            ));
        }
    }
    let final_image = render_composition_image(&input.task, &input.sources)?;
    let engine = base64::engine::general_purpose::STANDARD;
    let mut png = Vec::<u8>::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut png,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        final_image.as_raw(),
        final_image.width(),
        final_image.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|_| input_error("Rendering the publication PNG failed"))?;
    let image_base64 = engine.encode(&png);
    let render_width = final_image.width();
    let render_height = final_image.height();

    let arguments = json!({"fileKey": saved.file_key, "pageId": saved.page_id, "nodeId": saved.node_id, "expected": saved.expected, "revision": saved.revision, "renderWidth": render_width, "renderHeight": render_height, "imageBase64": image_base64, "task": input.task});
    publication_request(
        saved.file_key,
        saved.page_id,
        saved.node_id,
        "publishMockupImage",
        arguments,
        "Publish core-rendered pixels onto the linked Composition result in place, guarded by the inspected state and revision",
    )
}

/// Match the bounded Figma source-read fingerprint; it detects stale media,
/// not cryptographic authenticity. Hash every exported PNG byte in order.
pub(crate) fn source_preview_fingerprint(bytes: &[u8]) -> String {
    let mut left = 0x811c9dc5u32;
    let mut right = 0x9e3779b9u32;
    for (index, value) in bytes.iter().enumerate() {
        left = (left ^ u32::from(*value)).wrapping_mul(0x01000193);
        right = (right ^ u32::from(*value).wrapping_add(index as u32)).wrapping_mul(0x85ebca6b);
    }
    format!("preview32x2:{}:{left:08x}{right:08x}", bytes.len())
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaEffectPublishInput {
    snapshot: FigmaEffectSnapshot,
    recipe: EffectRecipe,
    state: EffectState,
    sources: Vec<FigmaMockupSourceRaster>,
    /// Far-to-near source roles for the edited recipe. Raster slots remain in
    /// the inspected order; the renderer remaps them through these identities.
    #[serde(default)]
    #[schemars(length(min = 2, max = 8))]
    source_node_ids: Option<Vec<String>>,
    /// Fresh read-only proposal from figma_effect_sources. Raster slots use
    /// the proposal order when replacing, adding or removing bound sources.
    #[serde(default)]
    source_set: Option<FigmaEffectSourceSet>,
}
impl FigmaEffectPublishInput {
    pub fn with_workspace(
        mut self,
        root: Option<&worldbend_agent_fs::WorkspaceRoot>,
    ) -> TransformResult<Self> {
        crate::figma_source_raster::hydrate_sources(&mut self.sources, root)?;
        Ok(self)
    }
}

/// Render one inspected Spatial (Depth) recipe state through the shared core
/// effect renderer and prepare the guarded in-place publication request.
pub fn effect_publish(input: FigmaEffectPublishInput) -> TransformResult<FigmaRequest> {
    figma_effect_snapshot(&input.snapshot)?;
    let task = FigmaEffectTask {
        kind: input.snapshot.task.kind,
        recipe: input.recipe.clone(),
        state: input.state.clone(),
    };
    figma_effect_task(&task)?;
    if let Some(set) = &input.source_set {
        effect_source_set(set, &input.snapshot)?;
    }
    let available = input
        .source_set
        .as_ref()
        .map(|set| &set.source_node_ids)
        .unwrap_or(&input.snapshot.source_node_ids);
    let summaries = input
        .source_set
        .as_ref()
        .map(|set| &set.sources)
        .unwrap_or(&input.snapshot.sources);
    let order = input.source_node_ids.as_ref().unwrap_or(available);
    if order.len() != input.recipe.layers.len()
        || order.len() != available.len()
        || order.iter().collect::<std::collections::HashSet<_>>().len() != order.len()
        || order.iter().any(|id| !available.contains(id))
    {
        return Err(input_error(
            "Depth roles must use every inspected or proposed source exactly once",
        ));
    }
    let order = order.clone();
    let changed = serde_json::to_value(&input.snapshot.task)
        .map_err(|_| input_error("Snapshot serialization failed"))?
        != serde_json::to_value(&task).map_err(|_| input_error("Task serialization failed"))?
        || order != input.snapshot.source_node_ids;
    let available = available.clone();
    let summaries = summaries.clone();
    let saved = input.snapshot;
    let layer_count = input.recipe.layers.len();
    if input.sources.len() != layer_count {
        return Err(input_error(
            "Publish sources must match the recipe's ordered layers exactly",
        ));
    }

    let engine = base64::engine::general_purpose::STANDARD;
    let mut decoded = std::collections::HashMap::<String, image::DynamicImage>::new();
    for (index, source) in input.sources.iter().enumerate() {
        if source.slot_id() != format!("source-{}", index + 1) {
            return Err(input_error(
                "Publish sources must be ordered source-1..source-N over the recipe layers",
            ));
        }
        let bytes = engine
            .decode(source.base64()?)
            .map_err(|_| input_error("Publish source base64 is invalid"))?;
        if let Some(summary) = summaries.get(index) {
            source.validate_capture(summary.source_capture)?;
            if source_preview_fingerprint(&bytes) != summary.preview_fingerprint {
                return Err(input_error(
                    "Depth publication rasters must match the inspected source bytes; inspect again",
                ));
            }
        } else {
            source.validate_capture(None)?;
        }
        let raster = crate::figma_source_raster::logical_source_image(
            crate::figma_source_raster::decode_source_image(&bytes)?,
            source.source_capture(),
        )?;
        let width = raster.width();
        let height = raster.height();
        if width < 1 || height < 1 || width > 8192 || height > 8192 {
            return Err(input_error(
                "Publish source dimensions must stay in 1..8192 pixels",
            ));
        }
        let layer_index = order.iter().position(|id| id == &available[index]).unwrap();
        let layer = &input.recipe.layers[layer_index];
        decoded.insert(layer.id.clone(), raster);
    }

    let rendered = worldbend_render::render_effect(
        &decoded,
        &input.recipe,
        &input.state,
        worldbend_render::EffectRenderOptions::default(),
    )
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Render,
            format!("Spatial render failed: {}", error.message),
        )
    })?;
    let mut png = Vec::<u8>::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut png,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Adaptive,
    )
    .write_image(
        rendered.image.as_raw(),
        rendered.image.width(),
        rendered.image.height(),
        image::ExtendedColorType::Rgba8,
    )
    .map_err(|_| input_error("Rendering the publication PNG failed"))?;
    let image_base64 = engine.encode(&png);
    let render_width = rendered.image.width();
    let render_height = rendered.image.height();

    let mut arguments = json!({"fileKey": saved.file_key, "pageId": saved.page_id, "nodeId": saved.node_id, "expected": saved.expected, "revision": saved.revision, "renderWidth": render_width, "renderHeight": render_height, "imageBase64": image_base64});
    if changed {
        arguments["task"] =
            serde_json::to_value(task).map_err(|_| input_error("Task serialization failed"))?;
        arguments["sourceNodeIds"] = json!(order);
        if let Some(set) = input.source_set {
            arguments["sourceSet"] = serde_json::to_value(set)
                .map_err(|_| input_error("Source proposal serialization failed"))?;
        }
    }
    publication_request(
        saved.file_key,
        saved.page_id,
        saved.node_id,
        "publishEffectImage",
        arguments,
        "Publish core-rendered settled Depth pixels and an edited recipe/state/source-role order in place, guarded by the inspected result and sources; unchanged refreshes preserve pending edits",
    )
}

pub fn mockup_stage(input: FigmaMockupStageInput) -> TransformResult<FigmaRequest> {
    figma_mockup_snapshot(&input.snapshot)?;
    figma_mockup_task(&input.task, input.snapshot.source_node_ids.len())?;
    let saved = input.snapshot;
    let call = format!(
        "stageMockup({})",
        json!({
            "fileKey": saved.file_key, "pageId": saved.page_id, "nodeId": saved.node_id,
            "expected": saved.expected, "task": input.task,
        })
    );
    packet(
        saved.file_key,
        &saved.page_id,
        call,
        "Stage a core-validated Composition change on the same Figma result for designer preview and publication; published pixels are unchanged",
    )
}

/// Project one published Figma Composition into the standard reusable static
/// document and executable delivery plan. The Figma Provider still exports the
/// exact source bytes; this pure operation owns only deterministic semantics.
pub fn composition_continuation(
    input: FigmaCompositionContinuationInput,
) -> TransformResult<FigmaCompositionContinuation> {
    figma_mockup_snapshot(&input.snapshot)?;
    let saved = input.snapshot;
    if saved.sources.len() < 2 {
        return Err(input_error(
            "Composition continuation requires 2..8 ordered Figma sources",
        ));
    }
    let source_bindings = saved
        .sources
        .iter()
        .map(|source| FigmaCompositionContinuationBinding {
            slot_id: source.slot_id.clone(),
            asset_id: source.slot_id.clone(),
            source_node_id: source.node_id.clone(),
            source_name: source.name.clone(),
            width: source.width,
            height: source.height,
            preview_fingerprint: source.preview_fingerprint.clone(),
        })
        .collect::<Vec<_>>();
    let assets = source_bindings
        .iter()
        .map(|binding| SpatialDocumentAsset {
            id: binding.asset_id.clone(),
            content_version: Some(format!("figma-preview:{}", binding.preview_fingerprint)),
        })
        .collect::<Vec<_>>();
    let bindings = source_bindings
        .iter()
        .map(|binding| SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::Content,
            slot_id: binding.slot_id.clone(),
            asset_id: binding.asset_id.clone(),
        })
        .collect::<Vec<_>>();
    let template = match &saved.task {
        FigmaCompositionTask::Mockup { spec } => SpatialTemplateSpec {
            schema: "worldbend.spatial-template".to_owned(),
            version: "0.1".to_owned(),
            operation: SpatialTemplateOperation::Mockup { spec: spec.clone() },
            output: SpatialTemplateOutput::Single {
                id: "output".to_owned(),
            },
        },
        FigmaCompositionTask::Composition { template, .. } => template.as_ref().clone(),
    };
    let delivery = prepare_spatial_static_delivery(&SpatialStaticDeliveryInput {
        expression_id: FIGMA_COMPOSITION_EXPRESSION_ID.to_owned(),
        template,
        assets,
        bindings,
    })?;
    let mut losses = vec![
        FigmaCompositionContinuationLoss::SourceMediaNotEmbedded,
        FigmaCompositionContinuationLoss::FigmaPlacementNotTransferred,
        FigmaCompositionContinuationLoss::PreviewFingerprintNotContentDigest,
    ];
    if saved.draft.is_some() {
        losses.push(FigmaCompositionContinuationLoss::StagedDraftExcluded);
    }
    if saved.draft_issue.is_some() {
        losses.push(FigmaCompositionContinuationLoss::StagedDraftUnavailable);
    }
    Ok(FigmaCompositionContinuation {
        schema: FIGMA_COMPOSITION_CONTINUATION_SCHEMA.to_owned(),
        version: FIGMA_COMPOSITION_CONTINUATION_VERSION.to_owned(),
        origin: FigmaCompositionContinuationOrigin {
            file_key: saved.file_key,
            page_id: saved.page_id,
            node_id: saved.node_id,
            revision: saved.revision,
            expected: saved.expected,
        },
        source_bindings,
        expression_id: FIGMA_COMPOSITION_EXPRESSION_ID.to_owned(),
        document: delivery.document,
        delivery_plan: delivery.delivery_plan,
        losses,
    })
}

fn figma_composition_continuation_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": FIGMA_COMPOSITION_CONTINUATION_SCHEMA })
}

fn figma_composition_continuation_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": FIGMA_COMPOSITION_CONTINUATION_VERSION })
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{EffectId, EffectRecipeInput, effect_recipe};

    #[test]
    fn native_creation_solves_fractional_geometry_and_bounds_the_complete_request() {
        let mut value = json!({"fileKey":"granted-file","pageId":"37:7","sourceNodeId":"48:5",
            "requestId":"native-brand","spec":input()["spec"],"width":520.5,"height":606.25,"name":"Weekly native work"});
        let probe = create_native(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(test_code(&probe).contains(".probeNativeSource("));
        assert!(!test_code(&probe).contains(".screenshot("));
        value["sourceFacts"] = json!({"sourceNodeId":"48:5","width":520,"height":606,"expected":"hash32x2:12:0123456789abcdef"});
        let request = create_native(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let code = test_code(&request);
        let call = code.rsplit_once("createNative(").unwrap().1;
        let arguments: serde_json::Value =
            serde_json::from_str(call.split_once(");const result=").unwrap().0).unwrap();
        assert_eq!(arguments["renderWidth"], 521);
        assert_eq!(arguments["renderHeight"], 607);
        assert_eq!(arguments["width"], 520.5);
        assert_eq!(
            arguments["nativePlan"],
            json!(
                worldbend_core::plan_native_frame(&worldbend_core::NativeFramePlanInput {
                    spec: serde_json::from_value(value["spec"].clone()).unwrap(),
                    source_size: Size::new(520., 606.),
                    output_size: Size::new(520.5, 606.25),
                })
                .unwrap()
            )
        );
        let spec: TransformSpec = serde_json::from_value(value["spec"].clone()).unwrap();
        assert_eq!(
            arguments["inverse"],
            json!(
                solve_spec(
                    &spec,
                    Some(Size {
                        width: 521.0,
                        height: 607.0
                    })
                )
                .unwrap()
                .homography
                .inverse
            )
        );
        value["fileKey"] = json!("\"\\".repeat(128));
        value["pageId"] = value["fileKey"].clone();
        value["sourceNodeId"] = value["fileKey"].clone();
        value["sourceFacts"]["sourceNodeId"] = value["sourceNodeId"].clone();
        value["name"] = json!("界".repeat(80));
        value["requestId"] = json!("n".repeat(80));
        let request = create_native(serde_json::from_value(value).unwrap()).unwrap();
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        assert!(test_code(&request).contains(NATIVE_CREATE_RUNTIME));
    }

    #[test]
    fn native_creation_refuses_unsupported_geometry_and_invalid_identity() {
        let base = json!({"fileKey":"granted-file","pageId":"37:7","sourceNodeId":"48:5",
            "requestId":"native-brand","spec":input()["spec"],"width":520,"height":606});
        for (key, invalid) in [
            ("requestId", json!("")),
            ("requestId", json!("-bad")),
            ("width", json!(0)),
            ("height", json!(4096.1)),
            ("name", json!("  ")),
            ("name", json!("a".repeat(81))),
        ] {
            let mut value = base.clone();
            value[key] = invalid;
            assert!(create_native(serde_json::from_value(value).unwrap()).is_err());
        }
        let mut value = base.clone();
        value["spec"]["content"]["warp"] = json!({"preset":"arch","amount":0.2});
        assert!(create_native(serde_json::from_value(value).unwrap()).is_err());
        let mut value = base;
        value["spec"]["destination"]["space"] = json!("pixel");
        value["spec"]["destination"]["reference"] = json!({"width":520,"height":606});
        assert!(create_native(serde_json::from_value(value).unwrap()).is_err());
    }

    fn input() -> serde_json::Value {
        let spec = json!({"schema":"worldbend.transform","version":"0.1","destination":{"space":"normalized","quad":{
            "tl":{"x":0.04,"y":0.03},"tr":{"x":0.93,"y":0.12},"br":{"x":0.98,"y":0.95},"bl":{"x":0.12,"y":0.99}
        }},"content":{"fit":"stretch"}});
        json!({"snapshot":{"schema":"worldbend.figma.handoff","version":"0.1","fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","revision":4,
            "source":{"nodeId":"48:5","width":520,"height":606},"placement":{"x":900,"y":3240,"width":560,"height":640},"spec":spec,"expected":"opaque"},"spec":spec})
    }

    fn effect_input() -> serde_json::Value {
        let recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "3".into(),
            viewport: Size {
                width: 600.0,
                height: 400.0,
            },
            intensity: 0.8,
        })
        .unwrap();
        let task = json!({
            "kind": "effect",
            "recipe": recipe,
            "state": {"progress":1.0,"pointerX":0.25,"pointerY":-0.2,"reducedMotion":false}
        });
        json!({
            "snapshot": {
                "schema":"worldbend.figma.effect-handoff","version":"0.1",
                "fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","revision":2,
                "task":task,"sourceNodeIds":["48:5","48:6","48:7"],
                "placement":{"x":900.0,"y":3240.0,"width":600.0,"height":400.0},
                "expected":"opaque"
            },
            "task":task
        })
    }

    fn effect_input_with_layers(count: usize) -> serde_json::Value {
        let mut value = effect_input();
        let template = value["task"]["recipe"]["layers"][0].clone();
        let layers = (0..count)
            .map(|index| {
                let mut layer = template.clone();
                layer["id"] = json!(format!("layer-{}", index + 1));
                layer["surface"]["distance"] =
                    json!(1800.0 - index as f64 * (1000.0 / (count - 1) as f64));
                layer
            })
            .collect::<Vec<_>>();
        value["task"]["recipe"]["origin"] = serde_json::Value::Null;
        value["task"]["recipe"]["layers"] = json!(layers);
        value["snapshot"]["task"] = value["task"].clone();
        value["snapshot"]["sourceNodeIds"] = json!(
            (0..count)
                .map(|index| format!("48:{}", index + 5))
                .collect::<Vec<_>>()
        );
        value
    }

    fn mockup_input() -> serde_json::Value {
        let transform = input()["spec"].clone();
        let task = json!({
            "kind":"mockup",
            "spec":{
                "schema":"worldbend.mockup","version":"0.1",
                "canvas":{"width":600,"height":400},
                "background":{"kind":"transparent"},
                "planes":[
                    {"id":"artwork","sourceId":"source-1","transform":transform,"opacity":1.0},
                    {"id":"scene","sourceId":"source-2","transform":transform,"opacity":1.0}
                ],"seams":[]
            }
        });
        json!({
            "snapshot":{
                "schema":"worldbend.figma.mockup-handoff","version":"0.1",
                "fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","revision":2,
                "task":task,"sourceNodeIds":["48:5","48:6"],
                "sources":[
                    {"slotId":"source-1","nodeId":"48:5","name":"Artwork","width":520.0,"height":606.0,"previewFingerprint":"preview32x2:128:aabbccddeeff0011"},
                    {"slotId":"source-2","nodeId":"48:6","name":"Scene","width":600.0,"height":400.0,"previewFingerprint":"preview32x2:256:1122334455667788"}
                ],
                "placement":{"x":900.0,"y":3240.0,"width":600.0,"height":400.0},
                "expected":"opaque"
            },"task":task
        })
    }

    fn continued_composition_input(source_count: usize) -> serde_json::Value {
        let mut value = mockup_input();
        let perspective = value["task"]["spec"]["planes"][0]["transform"].clone();
        let planes = (0..source_count)
            .map(|index| {
                let mut transform = perspective.clone();
                let offset = index as f64 / (source_count as f64 * 20.0);
                transform["destination"]["quad"]["tl"]["x"] = json!(0.04 + offset);
                json!({
                    "id": format!("panel-{}", index + 1),
                    "sourceId": format!("source-{}", index + 1),
                    "transform": transform,
                    "opacity": 1.0
                })
            })
            .collect::<Vec<_>>();
        let composition = json!({
            "schema":"worldbend.mockup","version":"0.1",
            "canvas":{"width":600,"height":400},
            "background":{"kind":"transparent"},
            "planes":planes,"seams":[]
        });
        let task = json!({
            "kind":"composition",
            "previewOutputId":"hero",
            "template":{
                "schema":"worldbend.spatial-template","version":"0.1",
                "operation":{
                    "kind":"compositionProgram",
                    "composition":composition,
                    "postprocess":{
                        "schema":"worldbend.raster-program","version":"0.1",
                        "stages":[{
                            "kind":"transform","id":"whole-result","canvas":"reference",
                            "target_size":{"width":600,"height":400},
                            "spec":{
                                "schema":"worldbend.transform","version":"0.1",
                                "destination":{"space":"normalized","quad":{
                                    "tl":{"x":0.04,"y":0.03},"tr":{"x":0.93,"y":0.12},
                                    "br":{"x":0.98,"y":0.95},"bl":{"x":0.12,"y":0.99}
                                }},
                                "content":{"fit":"stretch","warp":{"preset":"arch","amount":0.42}}
                            }
                        }]
                    }
                },
                "output":{"kind":"canvasSet","spec":{
                    "schema":"worldbend.canvas-set","version":"0.1","variants":[
                        {"id":"hero","operation":{"kind":"cover","output":{"width":1200,"height":628},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"transparent"}}},
                        {"id":"square","operation":{"kind":"contain","output":{"width":1080,"height":1080},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"transparent"}}}
                    ]
                }}
            }
        });
        let node_ids = (0..source_count)
            .map(|index| format!("48:{}", index + 5))
            .collect::<Vec<_>>();
        let sources = node_ids
            .iter()
            .enumerate()
            .map(|(index, node_id)| {
                json!({
                    "slotId":format!("source-{}", index + 1),
                    "nodeId":node_id,
                    "name":format!("Imported layer {} / arbitrary", index + 1),
                    "width":500.0 + index as f64 * 17.0,
                    "height":320.0 + index as f64 * 11.0,
                    "previewFingerprint":format!("preview32x2:{}:{:016x}", 128 + index, index + 1)
                })
            })
            .collect::<Vec<_>>();
        value["task"] = task.clone();
        value["snapshot"]["task"] = task;
        value["snapshot"]["sourceNodeIds"] = json!(node_ids);
        value["snapshot"]["sources"] = json!(sources);
        value
    }

    #[test]
    fn builds_bounded_request_with_the_canonical_inverse() {
        let parsed: FigmaApplyInput = serde_json::from_value(input()).unwrap();
        let solved = solve_spec(
            &parsed.spec,
            Some(Size {
                width: 560.0,
                height: 640.0,
            }),
        )
        .unwrap();
        let request = apply(parsed).unwrap();
        let code = test_code(&request);
        assert!(code.contains(&format!("\"inverse\":{}", json!(solved.homography.inverse))));
        assert!(code.contains("1024/Math.max"));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        assert_eq!(request.file_key, "granted-file");
    }

    #[test]
    fn rejects_invalid_geometry_limits_and_unknown_fields_before_producing_a_request() {
        let mut value = input();
        value["width"] = json!(4097);
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["spec"]["destination"]["quad"]["tr"] =
            value["spec"]["destination"]["quad"]["bl"].clone();
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["snapshot"]["expected"] = json!("x".repeat(8193));
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
        let mut value = input();
        value["silentOverwrite"] = json!(true);
        assert!(serde_json::from_value::<FigmaApplyInput>(value).is_err());
        let mut value = input();
        value["snapshot"]["placement"]["width"] = json!(0.001);
        assert!(apply(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn escapes_identities_as_data_and_accepts_a_fresh_duplicate() {
        let request = inspect(FigmaInspectInput {
            file_key: "granted-file".into(),
            page_id: "37:7".into(),
            node_id: "node');throw Error('injected".into(),
            include_source_rasters: false,
            source_raster_transport: FigmaRasterTransport::default(),
        })
        .unwrap();
        assert!(test_code(&request).contains("inspect(\"node');throw Error('injected\""));
        let mut value = input();
        value["snapshot"]["revision"] = json!(0);
        assert!(apply(serde_json::from_value(value).unwrap()).is_ok());
    }

    #[test]
    fn preserves_fractional_placement_when_dimensions_are_omitted() {
        let mut value = input();
        value["snapshot"]["placement"]["width"] = json!(560.25);
        value["snapshot"]["placement"]["height"] = json!(640.5);
        let request = apply(serde_json::from_value(value).unwrap()).unwrap();
        let code = test_code(&request);
        assert!(code.contains("\"width\":560.25"));
        assert!(code.contains("\"height\":640.5"));
        assert!(code.contains("\"renderWidth\":561"));
        assert!(code.contains("\"renderHeight\":641"));
    }

    #[test]
    fn stages_a_validated_effect_recipe_without_claiming_pixel_publication() {
        let parsed: FigmaEffectStageInput = serde_json::from_value(effect_input()).unwrap();
        let request = effect_stage(parsed).unwrap();
        let code = test_code(&request);
        assert!(code.contains("WorldbendFigmaHandoff.stageEffect"));
        assert!(code.contains("sha256:"));
        assert!(
            request
                .description
                .contains("published pixels are unchanged")
        );
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        let five: FigmaEffectStageInput =
            serde_json::from_value(effect_input_with_layers(5)).unwrap();
        assert!(effect_stage(five).is_ok());
    }

    #[test]
    fn rejects_non_camera_or_unknown_effect_handoff_fields() {
        let mut value = effect_input();
        value["task"]["recipe"]["layers"][0]["id"] = json!("middle");
        assert!(effect_stage(serde_json::from_value(value).unwrap()).is_err());
        let mut value = effect_input();
        value["snapshot"]["allowOverwrite"] = json!(true);
        assert!(serde_json::from_value::<FigmaEffectStageInput>(value).is_err());
    }

    #[test]
    fn effect_stage_schema_exposes_the_only_constructible_task_kind() {
        let schema = serde_json::to_value(schemars::schema_for!(FigmaEffectStageInput)).unwrap();
        assert_eq!(
            schema["$defs"]["FigmaEffectTaskKind"]["enum"],
            json!(["effect"])
        );
    }

    #[test]
    fn continues_only_the_published_figma_relationship_into_web_delivery() {
        let value = effect_input();
        let input: FigmaEffectContinuationInput = serde_json::from_value(json!({
            "snapshot": value["snapshot"].clone()
        }))
        .unwrap();
        let continuation = effect_continuation(input).unwrap();
        let output = serde_json::to_value(&continuation).unwrap();
        assert_eq!(output["schema"], FIGMA_EFFECT_CONTINUATION_SCHEMA);
        assert_eq!(output["version"], FIGMA_EFFECT_CONTINUATION_VERSION);
        assert_eq!(output["origin"]["revision"], 2);
        assert_eq!(output["expressionId"], FIGMA_EFFECT_EXPRESSION_ID);
        assert_eq!(
            output["sourceBindings"],
            json!([
                {"role":"background","assetId":"background","sourceNodeId":"48:5"},
                {"role":"middle","assetId":"middle","sourceNodeId":"48:6"},
                {"role":"foreground","assetId":"foreground","sourceNodeId":"48:7"}
            ])
        );
        assert_eq!(
            output["document"]["expressions"][0]["recipe"],
            value["snapshot"]["task"]["recipe"]
        );
        assert_eq!(output["initialState"], value["snapshot"]["task"]["state"]);
        assert_eq!(
            output["deliveryPlan"]["deliveries"][0]["bindings"],
            json!([
                {"role":"content","slotId":"background","assetId":"background"},
                {"role":"content","slotId":"middle","assetId":"middle"},
                {"role":"content","slotId":"foreground","assetId":"foreground"}
            ])
        );
        assert_eq!(
            output["deliveryPlan"]["documentFingerprint"],
            worldbend_core::inspect_spatial_document(&continuation.document)
                .unwrap()
                .fingerprint
        );
        assert_eq!(
            output["losses"],
            json!(["sourceMediaNotEmbedded", "figmaPlacementNotTransferred"])
        );
    }

    #[test]
    fn continues_five_named_layers_in_recipe_order() {
        let value = effect_input_with_layers(5);
        let input: FigmaEffectContinuationInput = serde_json::from_value(json!({
            "snapshot": value["snapshot"].clone()
        }))
        .unwrap();
        let continuation = effect_continuation(input).unwrap();
        let output = serde_json::to_value(&continuation).unwrap();
        assert_eq!(
            output["sourceBindings"],
            json!([
                {"role":"layer-1","assetId":"layer-1","sourceNodeId":"48:5"},
                {"role":"layer-2","assetId":"layer-2","sourceNodeId":"48:6"},
                {"role":"layer-3","assetId":"layer-3","sourceNodeId":"48:7"},
                {"role":"layer-4","assetId":"layer-4","sourceNodeId":"48:8"},
                {"role":"layer-5","assetId":"layer-5","sourceNodeId":"48:9"}
            ])
        );
        assert_eq!(output["document"]["assets"].as_array().unwrap().len(), 5);
        assert_eq!(
            output["deliveryPlan"]["deliveries"][0]["bindings"]
                .as_array()
                .unwrap()
                .len(),
            5
        );
    }

    #[test]
    fn excludes_staged_drafts_and_rejects_invalid_snapshots_during_continuation() {
        let mut value = effect_input();
        value["snapshot"]["draft"] = json!({
            "schema":"worldbend.figma.effect-draft","version":"0.1","baseRevision":2,
            "fingerprint":format!("sha256:{}", "a".repeat(64)),
            "task":value["snapshot"]["task"].clone()
        });
        value["snapshot"]["draft"]["task"]["state"]["pointerX"] = json!(0.9);
        let continuation = effect_continuation(
            serde_json::from_value(json!({"snapshot": value["snapshot"].clone()})).unwrap(),
        )
        .unwrap();
        let output = serde_json::to_value(continuation).unwrap();
        assert_eq!(output["initialState"]["pointerX"], 0.25);
        assert_eq!(output["losses"][2], "stagedDraftExcluded");

        value["snapshot"]["sourceNodeIds"][2] = value["snapshot"]["sourceNodeIds"][1].clone();
        let invalid: FigmaEffectContinuationInput =
            serde_json::from_value(json!({"snapshot": value["snapshot"].clone()})).unwrap();
        assert!(effect_continuation(invalid).is_err());
    }

    #[test]
    fn resolves_a_bounded_figma_result_link_without_manual_page_ids() {
        let request = mockup_inspect(FigmaMockupInspectInput {
            url: "https://www.figma.com/design/AbC123/Scene?node-id=48-3&t=abc".into(),
            include_source_rasters: false,
            source_raster_transport: FigmaRasterTransport::default(),
        })
        .unwrap();
        assert_eq!(request.file_key, "AbC123");
        let code = test_code(&request);
        assert!(code.contains("inspectMockup(\"48:3\""));
        assert!(code.contains("grantedPage=selected"));
        // The runtime must be interpolated as source, not left as a literal
        // `{RUNTIME}` placeholder by the format string.
        assert!(code.contains("var WorldbendFigmaHandoff="));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        let encoded =
            figma_result_link("https://figma.com/file/AbC123/Scene?node-id=48%3A3").unwrap();
        assert_eq!(encoded, ("AbC123".into(), "48:3".into()));
        for url in [
            "http://www.figma.com/design/AbC123/X?node-id=48-3",
            "https://www.figma.com.evil.example/design/AbC123/X?node-id=48-3",
            "https://www.figma.com/design/AbC123/X",
            "https://www.figma.com/design/AbC123/X?node-id=%0A",
        ] {
            assert!(figma_result_link(url).is_err(), "{url}");
        }
    }

    fn tiny_png_base64() -> String {
        color_png_base64([10, 40, 90, 255])
    }

    fn color_png_base64(color: [u8; 4]) -> String {
        use base64::Engine as _;
        use image::ImageEncoder as _;
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&color, 1, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(png)
    }

    #[test]
    fn effect_publish_renders_settled_depth_and_prepares_a_guarded_request() {
        let mut value = effect_input_with_layers(2);
        // Publish takes recipe/state at the top level beside the snapshot.
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        let input: FigmaEffectPublishInput = serde_json::from_value(value).unwrap();
        let request = effect_publish(input).unwrap();
        assert_eq!(request.file_key, "granted-file");
        assert!(
            request
                .code
                .contains("WorldbendFigmaHandoff.publishEffectImage")
        );
        assert!(request.code.contains("\"renderWidth\":600"));
        assert!(request.code.contains("\"renderHeight\":400"));
        assert!(request.code.contains("\"revision\":2"));
        assert!(request.code.contains("\"imageBase64\":\""));
        assert!(request.code.contains("var WorldbendFigmaHandoff="));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PUBLISH_PACKET_BYTES);
        assert!(request.publication.unwrap().arguments.get("task").is_none());
    }

    #[test]
    fn effect_publish_accepts_edits_and_remaps_source_roles_in_rendered_pixels() {
        let mut value = effect_input_with_layers(2);
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["recipe"]["camera"]["focalLength"] = json!(1400.0);
        value["state"]["pointerX"] = json!(0.4);
        value["sourceNodeIds"] = json!(["48:6", "48:5"]);
        value["sources"] = json!([
            {"slotId":"source-1","base64":color_png_base64([240,10,20,255])},
            {"slotId":"source-2","base64":color_png_base64([10,20,240,255])}
        ]);
        let request = effect_publish(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let arguments = request.publication.unwrap().arguments;
        assert_eq!(arguments["task"]["recipe"], value["recipe"]);
        assert_eq!(arguments["task"]["state"], value["state"]);
        assert_eq!(arguments["sourceNodeIds"], value["sourceNodeIds"]);
        use base64::Engine as _;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(arguments["imageBase64"].as_str().unwrap())
            .unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        // The near layer now uses source-1's red pixels, not source-2's blue.
        assert_eq!(image.get_pixel(300, 200).0, [240, 10, 20, 255]);
    }

    #[test]
    fn effect_publish_rejects_invalid_recipes_and_source_correlations() {
        let mut value = effect_input_with_layers(2);
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["recipe"]["layers"][0]["surface"]["distance"] = json!(0);
        value["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        assert!(effect_publish(serde_json::from_value(value).unwrap()).is_err());

        for order in [
            json!(["48:5", "48:5"]),
            json!(["48:5", "foreign"]),
            json!(["48:5"]),
        ] {
            let mut value = effect_input_with_layers(2);
            value["recipe"] = value["task"]["recipe"].clone();
            value["state"] = value["task"]["state"].clone();
            value.as_object_mut().unwrap().remove("task");
            value["sourceNodeIds"] = order;
            value["sources"] = json!([
                {"slotId":"source-1","base64":tiny_png_base64()},
                {"slotId":"source-2","base64":tiny_png_base64()}
            ]);
            assert!(effect_publish(serde_json::from_value(value).unwrap()).is_err());
        }

        let mut value = effect_input_with_layers(3);
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        assert!(effect_publish(serde_json::from_value(value).unwrap()).is_err());

        let mut value = effect_input_with_layers(2);
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["sources"] = json!([
            {"slotId":"source-2","base64":tiny_png_base64()},
            {"slotId":"source-1","base64":tiny_png_base64()}
        ]);
        assert!(effect_publish(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn effect_publication_checks_the_actual_inspected_raster_bytes() {
        use base64::Engine as _;
        let mut value = effect_input_with_layers(2);
        value["recipe"] = value["task"]["recipe"].clone();
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        let raster = tiny_png_base64();
        let fingerprint = source_preview_fingerprint(
            &base64::engine::general_purpose::STANDARD
                .decode(&raster)
                .unwrap(),
        );
        value["sources"] = json!([
            {"slotId":"source-1","base64":raster},
            {"slotId":"source-2","base64":raster}
        ]);
        value["snapshot"]["sources"] = json!([
            {"slotId":"source-1","nodeId":"48:5","name":"Far","width":600,"height":400,"previewFingerprint":fingerprint},
            {"slotId":"source-2","nodeId":"48:6","name":"Near","width":600,"height":400,"previewFingerprint":fingerprint}
        ]);
        assert!(effect_publish(serde_json::from_value(value.clone()).unwrap()).is_ok());
        value["sources"][0]["base64"] = json!(color_png_base64([240, 0, 0, 255]));
        assert!(
            effect_publish(serde_json::from_value(value).unwrap())
                .unwrap_err()
                .message
                .contains("inspected source bytes")
        );
    }

    #[test]
    fn effect_source_proposals_are_scoped_and_render_variable_source_sets() {
        use base64::Engine as _;
        let mut value = effect_input();
        let proposal = json!({"snapshot":value["snapshot"],"sourceNodeIds":["48:5","80:2"],"includeSourceRasters":true,"sourceRasterTransport":"artifact"});
        let request = effect_sources(serde_json::from_value(proposal.clone()).unwrap()).unwrap();
        assert!(
            request
                .code
                .contains("WorldbendFigmaHandoff.inspectEffectSources(")
        );
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        let mut invalid = proposal.clone();
        invalid["sourceNodeIds"][1] = json!("48:3");
        assert!(effect_sources(serde_json::from_value(invalid).unwrap()).is_err());
        let raster = tiny_png_base64();
        let fingerprint = source_preview_fingerprint(
            &base64::engine::general_purpose::STANDARD
                .decode(&raster)
                .unwrap(),
        );
        value["recipe"] = value["task"]["recipe"].clone();
        value["recipe"]["layers"].as_array_mut().unwrap().remove(1);
        value["recipe"]["origin"] = serde_json::Value::Null;
        value["state"] = value["task"]["state"].clone();
        value.as_object_mut().unwrap().remove("task");
        value["sourceSet"] = json!({"schema":"worldbend.figma.effect-sources","version":"0.1",
            "fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","revision":2,"resultExpected":"opaque",
            "sourceNodeIds":["48:5","80:2"],"sources":[
            {"slotId":"source-1","nodeId":"48:5","name":"Far","width":600,"height":400,"previewFingerprint":fingerprint},
            {"slotId":"source-2","nodeId":"80:2","name":"New Near","width":600,"height":400,"previewFingerprint":fingerprint}]});
        value["sources"] =
            json!([{"slotId":"source-1","base64":raster},{"slotId":"source-2","base64":raster}]);
        let published = effect_publish(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(published.code.contains("sourceSet"));
        assert!(published.code.contains("80:2"));
        for (field, changed) in [
            ("fileKey", json!("other-file")),
            ("revision", json!(3)),
            ("resultExpected", json!("stale")),
        ] {
            let mut invalid = value.clone();
            invalid["sourceSet"][field] = changed;
            assert!(effect_publish(serde_json::from_value(invalid).unwrap()).is_err());
        }
        let mut stale = value.clone();
        stale["sources"][1]["base64"] = json!(color_png_base64([250, 0, 0, 255]));
        assert!(effect_publish(serde_json::from_value(stale).unwrap()).is_err());
        let mut missing = value;
        missing.as_object_mut().unwrap().remove("sourceSet");
        assert!(effect_publish(serde_json::from_value(missing).unwrap()).is_err());
    }

    #[test]
    fn effect_creation_preserves_fractional_logical_planes_from_phone_presets() {
        let recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "3".into(),
            viewport: Size {
                width: 375.0,
                height: 812.0,
            },
            intensity: 0.8,
        })
        .unwrap();
        let mut value = effect_input();
        value["task"]["recipe"] = serde_json::to_value(recipe).unwrap();
        let task = serde_json::from_value::<FigmaEffectTask>(value["task"].clone()).unwrap();
        assert!(figma_effect_task(&task).is_ok());
        for axis in [0.0, 0.9, 4096.1] {
            value["task"]["recipe"]["layers"][0]["surface"]["size"]["height"] = json!(axis);
            assert!(
                figma_effect_task(&serde_json::from_value(value["task"].clone()).unwrap()).is_err()
            );
        }
        value["task"]["recipe"]["layers"][0]["surface"]["size"]["height"] = json!(4095.6);
        assert!(figma_effect_task(&serde_json::from_value(value["task"].clone()).unwrap()).is_ok());
        value["task"]["recipe"]["viewport"]["height"] = json!(812.5);
        assert!(
            figma_effect_task(&serde_json::from_value(value["task"].clone()).unwrap()).is_err()
        );
    }

    #[test]
    fn effect_creation_is_closed_scoped_bounded_and_supports_variable_source_counts() {
        for count in [2, 3, 8] {
            let saved = effect_input_with_layers(count);
            let value = json!({"fileKey":"granted-file","pageId":"12:3","sourceNodeIds":saved["snapshot"]["sourceNodeIds"],
                "task":saved["task"],"requestId":"cold-depth-request","name":"Editable Depth"});
            let request = effect_create(serde_json::from_value(value.clone()).unwrap()).unwrap();
            assert_eq!(request.file_key, "granted-file");
            assert!(request.code.contains("WorldbendFigmaHandoff.createEffect("));
            assert!(request.code.contains("cold-depth-request"));
            assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
            let mut bad = value.clone();
            bad["sourceNodeIds"][1] = bad["sourceNodeIds"][0].clone();
            assert!(effect_create(serde_json::from_value(bad).unwrap()).is_err());
            let mut bad = value.clone();
            bad["task"]["recipe"]["viewport"]["width"] = json!(4097);
            assert!(effect_create(serde_json::from_value(bad).unwrap()).is_err());
            let mut bad = value.clone();
            bad["requestId"] = json!("-bad-request");
            assert!(effect_create(serde_json::from_value(bad).unwrap()).is_err());
            let mut bad = value.clone();
            bad["autoPublish"] = json!(true);
            assert!(serde_json::from_value::<FigmaEffectCreateInput>(bad).is_err());
        }
    }

    #[test]
    fn effect_continuation_requires_a_published_image_for_new_snapshots() {
        let mut value = effect_input();
        value["snapshot"]["published"] = json!(false);
        value.as_object_mut().unwrap().remove("task");
        assert!(
            effect_continuation(serde_json::from_value(value).unwrap())
                .unwrap_err()
                .message
                .contains("Publish the created Depth image")
        );
    }

    #[test]
    fn composition_source_identity_is_independent_of_plane_declaration_order() {
        let mut value = mockup_input();
        value["task"]["spec"]["canvas"] = json!({"width":4,"height":4});
        for plane in value["task"]["spec"]["planes"].as_array_mut().unwrap() {
            plane["transform"] = json!(worldbend_core::TransformSpec::normalized(
                worldbend_core::Quad::unit()
            ));
        }
        // The second declaration paints on top. It is source-1 after reversal,
        // even though source PNGs always remain in binding order source-1/2.
        value["task"]["spec"]["planes"]
            .as_array_mut()
            .unwrap()
            .reverse();
        let task = serde_json::from_value(value["task"].clone()).unwrap();
        let sources: Vec<FigmaMockupSourceRaster> = serde_json::from_value(json!([
            {"slotId":"source-1","base64":color_png_base64([240,10,20,255])},
            {"slotId":"source-2","base64":color_png_base64([10,20,240,255])}
        ]))
        .unwrap();
        assert_eq!(
            render_composition_image(&task, &sources)
                .unwrap()
                .get_pixel(1, 1)
                .0,
            [240, 10, 20, 255]
        );
    }

    #[test]
    fn composition_publication_rejects_mixed_snapshot_raster_bytes() {
        let mut value = mockup_input();
        let raster = tiny_png_base64();
        let fingerprint = source_preview_fingerprint(
            &base64::engine::general_purpose::STANDARD
                .decode(&raster)
                .unwrap(),
        );
        for source in value["snapshot"]["sources"].as_array_mut().unwrap() {
            source["previewFingerprint"] = json!(fingerprint);
        }
        value["sources"] = json!([
            {"slotId":"source-1","base64":raster},
            {"slotId":"source-2","base64":raster}
        ]);
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_ok());
        value["sources"][0]["base64"] = json!(color_png_base64([240, 0, 0, 255]));
        assert!(mockup_publish(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn composition_publication_rejects_uninspected_capture_mapping() {
        let mut value = mockup_input();
        let raster = tiny_png_base64();
        let fingerprint = source_preview_fingerprint(
            &base64::engine::general_purpose::STANDARD
                .decode(&raster)
                .unwrap(),
        );
        for source in value["snapshot"]["sources"].as_array_mut().unwrap() {
            source["previewFingerprint"] = json!(fingerprint);
        }
        value["sources"] = json!([
            {"slotId":"source-1","base64":raster},
            {"slotId":"source-2","base64":raster}
        ]);
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_ok());
        value["sources"][0]["sourceCapture"] = json!({
            "logicalSize":{"width":600,"height":400},
            "logicalToCaptureSpace":[[-1,0,600],[0,1,0]],
            "captureOrigin":{"x":0,"y":0},"captureScale":0.001,
            "pixelSize":{"width":1,"height":1},"convention":"fixedDensityFromOrigin"
        });
        assert!(
            mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_err(),
            "A matching PNG digest must not admit an uninspected sampling map"
        );
        value["snapshot"]["sources"][0]["sourceCapture"] =
            value["sources"][0]["sourceCapture"].clone();
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_ok());
        value["sources"][0]
            .as_object_mut()
            .unwrap()
            .remove("sourceCapture");
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_err());
        value["sources"][0]["sourceCapture"] =
            value["snapshot"]["sources"][0]["sourceCapture"].clone();
        value["sources"][0]["sourceCapture"]["logicalToCaptureSpace"][0][0] = json!(1);
        assert!(mockup_publish(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn publish_renders_and_prepares_a_guarded_in_place_request() {
        let mut value = mockup_input();
        value["task"]["spec"]["planes"][0]["opacity"] = json!(0.45);
        value["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        for source in value["snapshot"]["sources"].as_array_mut().unwrap() {
            source["previewFingerprint"] = json!(source_preview_fingerprint(
                &base64::engine::general_purpose::STANDARD
                    .decode(tiny_png_base64())
                    .unwrap()
            ));
        }
        let input: FigmaMockupPublishInput = serde_json::from_value(value).unwrap();
        let request = mockup_publish(input).unwrap();
        assert_eq!(request.file_key, "granted-file");
        assert!(
            request
                .code
                .contains("WorldbendFigmaHandoff.publishMockupImage")
        );
        assert!(request.code.contains("\"renderWidth\":600"));
        assert!(request.code.contains("\"renderHeight\":400"));
        assert!(request.code.contains("\"revision\":2"));
        // The rendered PNG travels as base64 inside the bounded publish packet.
        assert!(request.code.contains("\"task\":{\"kind\":\"mockup\""));
        assert!(request.code.contains("\"opacity\":0.45"));
        assert!(request.code.contains("\"imageBase64\":\""));
        assert!(request.code.contains("var WorldbendFigmaHandoff="));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PUBLISH_PACKET_BYTES);
    }

    #[test]
    fn publish_rejects_wrong_slots_bad_rasters_and_variant_outputs() {
        let mut value = mockup_input();
        value["sources"] = json!([{"slotId":"source-1","base64":tiny_png_base64()}]);
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_err());

        let mut value = mockup_input();
        value["sources"] = json!([
            {"slotId":"source-1","base64":"!!not base64!!"},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        assert!(mockup_publish(serde_json::from_value(value.clone()).unwrap()).is_err());

        // A Canvas Set selected output is not publishable as one linked image.
        let mut variant = continued_composition_input(2);
        variant["task"]["previewOutputId"] = json!("wide");
        variant["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        assert!(mockup_publish(serde_json::from_value(variant).unwrap()).is_err());
        // The single output of the same program publishes through the whole-result stage.
        let mut single = continued_composition_input(2);
        single["task"]["previewOutputId"] = json!("hero");
        single["task"]["template"]["output"] = json!({"kind":"single","id":"hero"});
        single["sources"] = json!([
            {"slotId":"source-1","base64":tiny_png_base64()},
            {"slotId":"source-2","base64":tiny_png_base64()}
        ]);
        for source in single["snapshot"]["sources"].as_array_mut().unwrap() {
            source["previewFingerprint"] = json!(source_preview_fingerprint(
                &base64::engine::general_purpose::STANDARD
                    .decode(tiny_png_base64())
                    .unwrap()
            ));
        }
        assert!(mockup_publish(serde_json::from_value(single).unwrap()).is_ok());
    }

    #[test]
    fn scene_creation_is_closed_scoped_and_bounded() {
        let ready = json!({"url":"https://www.figma.com/design/AbC123/Scene", "pageId":"118:2",
            "scene":{"kind":"ready","id":"studio-poster"},"artworkNodeIds":["292:2"]});
        let request = scene_create(serde_json::from_value(ready.clone()).unwrap()).unwrap();
        assert!(test_code(&request).contains("WorldbendFigmaHandoff.createScene"));
        let poster_runtime = include_str!("figma-runtime-scene-ready-create-studio-poster.js");
        assert!(test_code(&request).contains(poster_runtime));
        assert!(!test_code(&request).contains(SCENE_CREATE_RUNTIME));
        assert!(test_code(&request).contains("\"fit\":\"cover\""));
        assert!(!test_code(&request).contains("\"name\":null"));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        let mut snapshot = mockup_input()["snapshot"].clone();
        snapshot["fileKey"] = json!("AbC123");
        let mut native = ready.clone();
        native["pageId"] = snapshot["pageId"].clone();
        native["scene"] = json!({"kind":"native","snapshot":snapshot});
        let native_request = scene_create(serde_json::from_value(native.clone()).unwrap()).unwrap();
        assert!(test_code(&native_request).contains(SCENE_CREATE_RUNTIME));
        assert!(!test_code(&native_request).contains(poster_runtime));
        assert!(serde_json::to_vec(&native_request).unwrap().len() <= MAX_PACKET_BYTES);
        native["pageId"] = json!("other-page");
        assert!(scene_create(serde_json::from_value(native).unwrap()).is_err());
        for (key, value) in [
            ("artworkNodeIds", json!([])),
            ("artworkNodeIds", json!(["a", "a"])),
            ("artworkNodeIds", json!(["a", "b"])),
            ("name", json!("  ")),
        ] {
            let mut bad = ready.clone();
            bad[key] = value;
            assert!(scene_create(serde_json::from_value(bad).unwrap()).is_err());
        }
        for extra in [
            json!({"kind":"ready","id":"studio-poster","snapshot":snapshot}),
            json!({"kind":"native","snapshot":snapshot,"id":"studio-poster"}),
            json!({"kind":"ready","id":"other"}),
        ] {
            let mut bad = ready.clone();
            bad["scene"] = extra;
            assert!(serde_json::from_value::<FigmaSceneCreateInput>(bad).is_err());
        }
    }

    #[test]
    fn ready_scene_requests_fit_with_longest_supported_arguments() {
        // Exercise complete wire packets, including runtime escaping, the
        // wrapper, UTF-8 names and a stable retry identity. The generator's
        // reserved headroom is not a substitute for this actual boundary.
        for scene in [
            "studio-poster",
            "desktop-screen",
            "carton-label",
            "studio-can",
            "hanging-fabric",
        ] {
            for name in [
                "🖼".repeat(80),
                "\\\"\n".repeat(26) + "\\\"",
                "\u{0000}".repeat(80),
            ] {
                let request = scene_create(
                    serde_json::from_value(json!({
                        "url": format!("https://www.figma.com/design/{}/Scene", "K".repeat(256)),
                        "pageId": "\\\"".repeat(128),
                        "scene": {"kind": "ready", "id": scene},
                        "artworkNodeIds": ["\\\"".repeat(128)],
                        "fit": "contain", "name": name, "requestId": "R".repeat(80)
                    }))
                    .unwrap(),
                )
                .unwrap();
                assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
            }
        }
    }

    #[test]
    fn templates_inspect_reads_only_the_granted_file() {
        let request = templates_inspect(FigmaTemplatesInspectInput {
            url: "https://www.figma.com/design/AbC123/Scene".into(),
        })
        .unwrap();
        assert_eq!(request.file_key, "AbC123");
        assert!(
            request
                .code
                .contains("WorldbendFigmaHandoff.inspectTemplates")
        );
        assert!(request.code.contains("var WorldbendFigmaHandoff="));
        assert!(request.skill_names.contains("figma-use"));
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);
        // node-id links stay accepted; the file key is what matters here.
        let with_node = templates_inspect(FigmaTemplatesInspectInput {
            url: "https://www.figma.com/design/AbC123/Scene?node-id=48-3".into(),
        })
        .unwrap();
        assert_eq!(with_node.file_key, "AbC123");
        for url in [
            "https://www.figma.com/",
            "https://example.com/design/AbC123/Scene",
            "https://www.figma.com/design//Scene",
        ] {
            assert!(
                templates_inspect(FigmaTemplatesInspectInput { url: url.into() }).is_err(),
                "{url}"
            );
        }
    }

    #[test]
    fn stages_only_a_valid_composition_with_matching_source_slots() {
        let input: FigmaMockupStageInput = serde_json::from_value(mockup_input()).unwrap();
        let request = mockup_stage(input).unwrap();
        assert!(test_code(&request).contains("WorldbendFigmaHandoff.stageMockup"));
        assert!(
            request
                .description
                .contains("published pixels are unchanged")
        );
        assert!(serde_json::to_vec(&request).unwrap().len() <= MAX_PACKET_BYTES);

        let mut bad = mockup_input();
        bad["task"]["spec"]["planes"][1]["sourceId"] = json!("source-3");
        assert!(mockup_stage(serde_json::from_value(bad).unwrap()).is_err());
        let mut bad = mockup_input();
        bad["task"]["spec"]["canvas"]["width"] = json!(4097);
        assert!(mockup_stage(serde_json::from_value(bad).unwrap()).is_err());
        let mut bad = mockup_input();
        bad["snapshot"]["allowOverwrite"] = json!(true);
        assert!(serde_json::from_value::<FigmaMockupStageInput>(bad).is_err());
    }

    #[test]
    fn stages_and_continues_two_five_and_eight_source_compositions() {
        for count in [2, 5, 8] {
            let value = continued_composition_input(count);
            let stage: FigmaMockupStageInput = serde_json::from_value(value.clone()).unwrap();
            assert!(mockup_stage(stage).is_ok(), "stage {count} sources");
            let continuation = composition_continuation(
                serde_json::from_value(json!({"snapshot": value["snapshot"].clone()})).unwrap(),
            )
            .unwrap();
            let output = serde_json::to_value(continuation).unwrap();
            assert_eq!(output["sourceBindings"].as_array().unwrap().len(), count);
            assert_eq!(
                output["sourceBindings"][0]["sourceName"],
                "Imported layer 1 / arbitrary"
            );
            assert_eq!(
                output["document"]["assets"].as_array().unwrap().len(),
                count
            );
            assert_eq!(
                output["document"]["expressions"][0]["template"]["operation"]["kind"],
                "compositionProgram"
            );
            assert_eq!(
                output["document"]["expressions"][0]["template"]["operation"]["postprocess"]["stages"]
                    [0]["spec"]["content"]["warp"]["preset"],
                "arch"
            );
            assert_eq!(
                output["deliveryPlan"]["deliveries"][0]["job"]["items"][0]["bindings"]
                    .as_array()
                    .unwrap()
                    .len(),
                count
            );
            assert_eq!(output["deliveryPlan"]["deliveries"][0]["job"]["template"]["output"]["spec"]["variants"].as_array().unwrap().len(), 2);
        }
    }

    #[test]
    fn source_replacement_changes_provenance_without_losing_the_composition_relationship() {
        let original = continued_composition_input(5);
        let first = composition_continuation(
            serde_json::from_value(json!({"snapshot": original["snapshot"].clone()})).unwrap(),
        )
        .unwrap();
        let mut replacement = original;
        replacement["snapshot"]["sourceNodeIds"][2] = json!("91:44");
        replacement["snapshot"]["sources"][2]["nodeId"] = json!("91:44");
        replacement["snapshot"]["sources"][2]["name"] = json!("Replacement, not a fixed role name");
        replacement["snapshot"]["sources"][2]["width"] = json!(777.0);
        replacement["snapshot"]["sources"][2]["previewFingerprint"] =
            json!("preview32x2:333:fedcba9876543210");
        replacement["snapshot"]["expected"] = json!("fresh-after-replacement");
        let second = composition_continuation(
            serde_json::from_value(json!({"snapshot": replacement["snapshot"].clone()})).unwrap(),
        )
        .unwrap();
        let first = serde_json::to_value(first).unwrap();
        let second = serde_json::to_value(second).unwrap();
        assert_eq!(
            first["sourceBindings"][2]["slotId"],
            second["sourceBindings"][2]["slotId"]
        );
        assert_eq!(
            first["sourceBindings"][2]["assetId"],
            second["sourceBindings"][2]["assetId"]
        );
        assert_ne!(
            first["sourceBindings"][2]["sourceNodeId"],
            second["sourceBindings"][2]["sourceNodeId"]
        );
        assert_eq!(
            first["document"]["expressions"],
            second["document"]["expressions"]
        );
        assert_ne!(
            first["document"]["assets"][2]["contentVersion"],
            second["document"]["assets"][2]["contentVersion"]
        );
        assert_ne!(
            first["deliveryPlan"]["documentFingerprint"],
            second["deliveryPlan"]["documentFingerprint"]
        );
    }

    #[test]
    fn continuation_excludes_drafts_and_rejects_stale_or_unsupported_carrier_state() {
        let mut value = continued_composition_input(2);
        value["snapshot"]["draft"] = json!({
            "schema":"worldbend.figma.mockup-draft","version":"0.1","baseRevision":2,
            "task":value["task"].clone()
        });
        value["snapshot"]["draft"]["task"]["template"]["operation"]["postprocess"]["stages"][0]["spec"]
            ["content"]["warp"]["amount"] = json!(-0.8);
        let continued = composition_continuation(
            serde_json::from_value(json!({"snapshot": value["snapshot"].clone()})).unwrap(),
        )
        .unwrap();
        let output = serde_json::to_value(continued).unwrap();
        assert_eq!(
            output["document"]["expressions"][0]["template"]["operation"]["postprocess"]["stages"]
                [0]["spec"]["content"]["warp"]["amount"],
            0.42
        );
        assert!(
            output["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("stagedDraftExcluded"))
        );

        let mut stale = continued_composition_input(2);
        stale["snapshot"]["draftIssue"] = json!("invalid-or-stale");
        let output = serde_json::to_value(
            composition_continuation(
                serde_json::from_value(json!({"snapshot": stale["snapshot"].clone()})).unwrap(),
            )
            .unwrap(),
        )
        .unwrap();
        assert!(
            output["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("stagedDraftUnavailable"))
        );

        let mut missing = continued_composition_input(2);
        missing["snapshot"]["sources"].as_array_mut().unwrap().pop();
        assert!(
            composition_continuation(
                serde_json::from_value(json!({"snapshot": missing["snapshot"].clone()})).unwrap(),
            )
            .is_err()
        );

        let mut unsupported = continued_composition_input(2);
        unsupported["task"]["template"]["operation"]["postprocess"]["stages"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "kind":"canvas","id":"extra","spec":{"schema":"worldbend.canvas","version":"0.1","operation":{"kind":"stretch","output":{"width":600,"height":400}}}
            }));
        assert!(mockup_stage(serde_json::from_value(unsupported).unwrap()).is_err());
    }

    fn texture_recipe() -> worldbend_core::TextureRecipeSpec {
        serde_json::from_value(json!({
            "schema":"worldbend.texture@0.1","version":"0.1","recipeId":"warm-paper","recipeVersion":1,
            "material":{"visible":true,"grain":0.35,"grainSize":3,"grainColor":"#8a7f72","etch":1.5,"etchSize":4,"clipToShape":true}
        }))
        .unwrap()
    }

    #[test]
    fn texture_packets_carry_the_materials_runtime_and_stay_bounded() {
        let inspect = texture_inspect(
            serde_json::from_value(json!({
                "fileKey":"granted-file","pageId":"37:7","nodeId":"48:3"
            }))
            .unwrap(),
        )
        .unwrap();
        assert!(inspect.code.contains("inspectTexture"));
        // The family packet embeds the materials variant, not the publishers.
        assert!(inspect.code.contains("applyTexture"));
        assert!(!inspect.code.contains("publishMockupImage"));
        assert!(serde_json::to_vec(&inspect).unwrap().len() <= MAX_PACKET_BYTES);

        let apply = texture_apply(FigmaTextureApplyInput {
            file_key: "granted-file".to_string(),
            page_id: "37:7".to_string(),
            node_id: "48:3".to_string(),
            expected: "opaque".to_string(),
            recipe: texture_recipe(),
            material: None,
            fields: None,
            retain_untagged: false,
        })
        .unwrap();
        assert!(apply.code.contains("\"recipeId\":\"warm-paper\""));
        assert!(serde_json::to_vec(&apply).unwrap().len() <= MAX_PACKET_BYTES);
    }

    #[test]
    fn texture_apply_rejects_invalid_recipes_and_bounds_before_producing_a_request() {
        let mut recipe = texture_recipe();
        recipe.material.grain_size = 0.1;
        assert!(
            texture_apply(FigmaTextureApplyInput {
                file_key: "granted-file".to_string(),
                page_id: "37:7".to_string(),
                node_id: "48:3".to_string(),
                expected: "opaque".to_string(),
                recipe,
                material: None,
                fields: None,
                retain_untagged: false,
            })
            .is_err()
        );
        let mut value = json!({
            "fileKey":"granted-file","pageId":"37:7","nodeId":"48:3","expected":"x".repeat(8193),
            "recipe":{ "schema":"worldbend.texture@0.1","version":"0.1","recipeId":"warm-paper","recipeVersion":1,
              "material":{"visible":true,"grain":0.35,"grainSize":3,"grainColor":"#8a7f72","etch":1.5,"etchSize":4,"clipToShape":true} }
        });
        let parsed: FigmaTextureApplyInput = serde_json::from_value(value.clone()).unwrap();
        assert!(texture_apply(parsed).is_err());
        value["expected"] = json!("opaque");
        value["material"] = json!({ "visible":true,"grain":2,"grainSize":3,"grainColor":"#8a7f72","etch":1.5,"etchSize":4,"clipToShape":true });
        let parsed: FigmaTextureApplyInput = serde_json::from_value(value).unwrap();
        assert!(texture_apply(parsed).is_err());
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaAppearanceApplyInput {
    file_key: String,
    page_id: String,
    node_id: String,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
    recipe: AppearanceRecipeSpec,
    #[serde(default)]
    material: Option<GlassMaterial>,
    /// Omission retains the existing full seed/application operation.
    #[serde(default)]
    #[schemars(length(min = 1, max = 7))]
    fields: Option<Vec<GlassField>>,
    #[serde(default)]
    retain_untagged: bool,
}

pub fn appearance_inspect(input: FigmaInspectInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    let call = format!(
        "inspectAppearance({},{},{})",
        json!(input.node_id),
        json!(input.file_key),
        json!(input.page_id)
    );
    materials_packet(
        input.file_key,
        &input.page_id,
        call,
        "Read native Figma appearance and shared provenance",
    )
}

pub fn appearance_apply(input: FigmaAppearanceApplyInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    input.recipe.validate()?;
    if input.expected.is_empty() || input.expected.len() > 8192 {
        return Err(input_error(
            "Appearance expected state must be 1..8192 bytes",
        ));
    }
    if let Some(material) = input.material {
        material.validate()?;
    }
    let mut args = json!({ "fileKey": input.file_key, "pageId": input.page_id, "nodeId": input.node_id, "expected": input.expected, "material": input.material.unwrap_or(input.recipe.material), "recipe": input.recipe });
    if let Some(fields) = input.fields {
        validate_material_fields(&fields)?;
        args["fields"] = json!(fields);
        args["retainUntagged"] = json!(input.retain_untagged);
    } else if input.retain_untagged {
        return Err(input_error(
            "retainUntagged requires an explicit selective edit",
        ));
    }
    let call = format!("applyAppearance({args})");
    materials_packet(
        input.file_key,
        &input.page_id,
        call,
        "Update native Figma appearance with a current-state guard",
    )
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct FigmaTextureApplyInput {
    file_key: String,
    page_id: String,
    node_id: String,
    #[schemars(length(min = 1, max = 8192))]
    expected: String,
    recipe: TextureRecipeSpec,
    #[serde(default)]
    material: Option<TextureMaterial>,
    #[serde(default)]
    #[schemars(length(min = 1, max = 7))]
    fields: Option<Vec<TextureField>>,
    #[serde(default)]
    retain_untagged: bool,
}

pub fn texture_inspect(input: FigmaInspectInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    let call = format!(
        "inspectTexture({},{},{})",
        json!(input.node_id),
        json!(input.file_key),
        json!(input.page_id)
    );
    materials_packet(
        input.file_key,
        &input.page_id,
        call,
        "Read native Figma texture and shared provenance",
    )
}

pub fn texture_apply(input: FigmaTextureApplyInput) -> TransformResult<FigmaRequest> {
    identity(&input.node_id)?;
    input.recipe.validate()?;
    if input.expected.is_empty() || input.expected.len() > 8192 {
        return Err(input_error("Texture expected state must be 1..8192 bytes"));
    }
    if let Some(material) = &input.material {
        material.validate()?;
    }
    let mut args = json!({ "fileKey": input.file_key, "pageId": input.page_id, "nodeId": input.node_id, "expected": input.expected, "material": input.material.clone().unwrap_or_else(|| input.recipe.material.clone()), "recipe": input.recipe });
    if let Some(fields) = input.fields {
        validate_material_fields(&fields)?;
        args["fields"] = json!(fields);
        args["retainUntagged"] = json!(input.retain_untagged);
    } else if input.retain_untagged {
        return Err(input_error(
            "retainUntagged requires an explicit selective edit",
        ));
    }
    let call = format!("applyTexture({args})");
    materials_packet(
        input.file_key,
        &input.page_id,
        call,
        "Update native Figma texture with a current-state guard",
    )
}

fn validate_material_fields<F: PartialEq>(fields: &[F]) -> TransformResult<()> {
    if fields.is_empty()
        || fields.len() > 7
        || fields
            .iter()
            .enumerate()
            .any(|(index, field)| fields[..index].contains(field))
    {
        return Err(input_error("Select 1..7 distinct owned material fields"));
    }
    Ok(())
}

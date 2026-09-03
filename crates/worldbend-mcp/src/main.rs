mod worker_limits;

use clap::{Parser, ValueEnum};
use rmcp::{
    ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, tool::IntoCallToolResult, wrapper::Parameters},
    model::{
        CallToolResponse, CallToolResult, ContentBlock, Implementation, ServerCapabilities,
        ServerInfo,
    },
    tool, tool_handler, tool_router,
    transport::stdio,
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::{OwnedSemaphorePermit, Semaphore},
    time::timeout,
};
use tokio_util::sync::CancellationToken;
use worker_limits::apply_worker_self_limits;
use worldbend_agent_fs::{
    DirectoryOutputTarget, OutputTarget, StagedDirectoryCommit, WorkspaceRoot,
    copy_source_to_private_staging,
};
use worldbend_core::{
    AffineComposition, CanvasBackground, CanvasSetPlan, CanvasSetSpec, Content, Destination,
    ErrorCode, InspectOutput, MeshWarpPlan, MeshWarpSpec, MockupExtractPlan, MockupExtractSpec,
    MockupPlan, MockupSpec, MotionPlan, MotionSpec, RasterProgramInspection, RasterProgramSpec,
    RectifyPlan, RectifySpec, RemapPlan, RemapSpec, Size, SolveOutput, SpatialTemplateInspection,
    SpatialTemplateSpec, SurfaceDeformationPlan, SurfaceDeformationSpec, TimelinePlan,
    TimelineSpec, TransformError, TransformRecipe, TransformResult, TransformSpec,
    VariationJobPlan, VariationJobSpec, bounded_text, compose_affine, emit_css_transform,
    inspect_raster_program, inspect_spatial_template, inspect_spec, plan_mesh_warp, plan_mockup,
    plan_mockup_extract, plan_motion, plan_remap, plan_surface_deformation, plan_timeline,
    plan_variation_job, rectify_plane, solve_spec,
};
use worldbend_interop::{
    MAX_PSD_SOURCE_BYTES, PsdSmartObjectRequest, PsdSmartObjectResponse,
    execute_psd_smart_object_request,
};
use worldbend_perception::{
    PlaneCandidateRequest, PlaneCandidateResponse, analyze_plane_candidates_file,
};
use worldbend_render::{
    CanvasMode, CanvasReplayOptions, CanvasReplaySampling, CanvasSetFileRenderResult,
    CanvasSetProgram, CanvasSetRenderOptions, CanvasSetRenderStatus, DEFAULT_MAX_AXIS,
    DEFAULT_MAX_SOURCE_BYTES, FileRenderResult, FileRenderStatus, MAX_MEDIA_PIXELS,
    MAX_TILED_ENCODED_BYTES, MAX_TILED_OUTPUT_PIXELS, MAX_TILED_TILE_PIXELS, MAX_TILED_TILES,
    MAX_VECTOR_SOURCE_BYTES, MediaFileRenderResult, MediaFormat, MediaOutput, MediaRenderOptions,
    MediaSourceInfo, MeshWarpFileRenderResult, MeshWarpRenderOptions,
    MockupExtractFileRenderResult, MockupExtractRenderOptions, MockupExtractRenderStatus,
    MockupFileRenderResult, MockupFileSource, MockupRenderOptions, MotionFileRenderResult,
    RasterProgramFileRenderResult, RasterProgramRenderOptions, RectifyFileRenderResult,
    RectifyRenderOptions, RemapFileMap, RemapFileRenderResult, RemapRenderOptions, RenderLimits,
    RenderOptions, SamplingQuality, SurfaceDeformationFileRenderResult, TILED_MEDIA_SCHEMA,
    TILED_MEDIA_VERSION, TiledMediaRenderOptions, TiledMediaRenderResult, TiledMediaStatus,
    TimelineFileRenderResult, TimelineFileSource, TimelineRenderOptions, TimelineRenderStatus,
    VariationFileAsset, VariationJobFileRenderResult, VariationJobRenderOptions,
    VariationJobRenderStatus, VectorCarrier, VectorFileResult, VectorRenderOptions,
    inspect_media_file, media_output_accepts_extension, media_output_extension,
    rectify_file_with_source_sha256, render_canvas_set_file, render_file_with_source_sha256,
    render_media_file, render_mesh_warp_file_with_cancel, render_mockup_extract_files_with_cancel,
    render_mockup_files_with_cancel, render_motion_files_with_cancel,
    render_raster_program_file_with_source_sha256, render_remap_file_with_cancel,
    render_surface_deformation_file_with_cancel, render_tiled_media_directory,
    render_timeline_files_with_cancel, render_variation_job_files_with_cancel, render_vector_file,
};

const MAX_WORKER_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_WORKER_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_TOOL_RESPONSE_BYTES: usize = 256 * 1024;
#[cfg(test)]
const MAX_TOOL_CATALOG_BYTES: usize = 81_920;
#[cfg(test)]
const MAX_PROGRESSIVE_TOOL_CATALOG_BYTES: usize = 16_384;
const MAX_TOOL_ARGUMENT_BYTES: usize = 1024 * 1024;
const MAX_SCHEMA_ERROR_CHARS: usize = 1024;
const MAX_CONCURRENT_RENDERS: usize = 2;
const MAX_IN_FLIGHT_RENDERS: usize = 4;
const MAX_THREADS_PER_RENDER: usize = 4;
const WORKER_TIMEOUT: Duration = Duration::from_secs(20);
const WORKER_MEMORY_BYTES: u64 = 768 * 1024 * 1024;
const MCP_MAX_AXIS: u32 = DEFAULT_MAX_AXIS;
// Worst case one render holds the decoded source, its mip pyramid (4/3 of the
// source), the output canvas, and one decode working copy: 4 bytes/px times
// roughly 13/3 px-equivalents. This budget keeps that below the 768 MiB
// per-worker ceiling so size-legal requests fail fast with E_OUTPUT_LIMIT
// instead of always dying later under E_MEMORY.
const MCP_MAX_PIXELS: u64 = 32 * 1024 * 1024;
const MCP_MAX_MEDIA_PIXELS: u64 = MAX_MEDIA_PIXELS;
const MCP_MAX_CANVAS_SET_PIXELS: u64 = 32 * 1024 * 1024;
const MCP_MAX_RASTER_PROGRAM_PIXELS: u64 = 64 * 1024 * 1024;
// Agent Canvas output is an atomic set, so bound the sum of its encoded PNGs
// before same-parent staging or commit. This is intentionally separate from
// the pixel and 256 KiB response ceilings.
const MCP_MAX_CANVAS_ENCODED_BYTES: u64 = 128 * 1024 * 1024;
const MCP_MAX_MOCKUP_EXTRACT_PIXELS: u64 = 32 * 1024 * 1024;
const MCP_MAX_MOCKUP_EXTRACT_ENCODED_BYTES: u64 = 128 * 1024 * 1024;
const MCP_MAX_TIMELINE_PIXELS: u64 = 64 * 1024 * 1024;
const MCP_MAX_TIMELINE_ENCODED_BYTES: u64 = 256 * 1024 * 1024;
const MCP_MAX_VARIATION_SOURCE_PIXELS: u64 = 32 * 1024 * 1024;
const MCP_MAX_VARIATION_PROCESSED_PIXELS: u64 = 64 * 1024 * 1024;
const MCP_MAX_VARIATION_OUTPUTS: usize = 128;
const MCP_MAX_VARIATION_ENCODED_BYTES: u64 = 256 * 1024 * 1024;
const MCP_MAX_SOURCE_BYTES: u64 = DEFAULT_MAX_SOURCE_BYTES;
const MCP_MAX_TILED_PIXELS: u64 = 64 * 1024 * 1024;
const MCP_MAX_TILED_ENCODED_BYTES: u64 = 512 * 1024 * 1024;
const MCP_MAX_TILED_TILES: u32 = 512;
static PRIVATE_STAGING_ROOT: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Parser)]
#[command(name = "worldbend-mcp", version, about = "Worldbend MCP server")]
struct Args {
    /// Explicit workspace root granted to Agent-authored render paths.
    #[arg(long)]
    root: Option<PathBuf>,
    /// MCP tool projection. `direct` preserves the stable one-tool-per-task API;
    /// `catalog` keeps tools/list compact and resolves exact schemas on demand.
    #[arg(long, value_enum, default_value_t = ToolSurface::Direct)]
    surface: ToolSurface,
    /// Internal bounded render worker mode.
    #[arg(long, hide = true)]
    worker_render: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum ToolSurface {
    Direct,
    Catalog,
}

const DIRECT_TOOL_NAMES: [&str; 8] = [
    "worldbend.compose",
    "worldbend.solve",
    "worldbend.inspect",
    "worldbend.render",
    "worldbend.rectify",
    "worldbend.rectify_render",
    "worldbend.canvas_render",
    "worldbend.css",
];

const CATALOG_TOOL_NAMES: [&str; 3] = ["worldbend.search", "worldbend.describe", "worldbend.run"];

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, untagged)]
enum ToolEnvelope<T>
where
    T: JsonSchema,
{
    Success {
        #[schemars(schema_with = "true_schema")]
        ok: bool,
        result: T,
    },
    Failure {
        #[schemars(schema_with = "false_schema")]
        ok: bool,
        error: TransformError,
    },
}

impl<T> ToolEnvelope<T>
where
    T: JsonSchema,
{
    fn from_result(result: Result<T, TransformError>) -> Self {
        match result {
            Ok(result) => Self::Success { ok: true, result },
            Err(mut error) => {
                // The structured message is as bounded as the text summary:
                // error construction sites echo Agent input, and the byte
                // backstop below must never become the only bound.
                error.message = bounded_text(&error.message, MAX_SCHEMA_ERROR_CHARS);
                Self::Failure { ok: false, error }
            }
        }
    }

    fn is_error(&self) -> bool {
        matches!(self, Self::Failure { .. })
    }
}

impl<T> ToolEnvelope<T>
where
    T: Serialize + JsonSchema,
{
    fn into_value(self) -> ToolEnvelope<Value> {
        match self {
            Self::Success { result, .. } => match serde_json::to_value(result) {
                Ok(result) => ToolEnvelope::Success { ok: true, result },
                Err(error) => ToolEnvelope::from_result(Err(TransformError::new(
                    ErrorCode::Internal,
                    format!("failed to serialize catalog operation result: {error}"),
                ))),
            },
            Self::Failure { error, .. } => ToolEnvelope::Failure { ok: false, error },
        }
    }
}

impl<T> ToolEnvelope<T>
where
    T: Serialize + JsonSchema + 'static,
{
    /// Build the complete `CallToolResult` exactly as the client will receive
    /// it. Shared by the final response path and the render preflight so both
    /// measure the same framing.
    fn build_complete_result(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let value = serde_json::to_value(self).map_err(|error| {
            rmcp::ErrorData::internal_error(
                format!("failed to serialize Worldbend tool result: {error}"),
                None,
            )
        })?;
        let summary = match self {
            Self::Success { .. } => success_summary(&value["result"]),
            Self::Failure { error, .. } => format!(
                "{}: {}",
                error.code.as_str(),
                bounded_text(&error.message, MAX_SCHEMA_ERROR_CHARS)
            ),
        };
        Ok(build_call_tool_result(value, summary, self.is_error()))
    }
}

fn success_summary(result: &Value) -> String {
    if let Some(kind) = result.get("result").and_then(Value::as_str) {
        match kind {
            "inspection" => {
                let count = result
                    .get("inspection")
                    .and_then(|value| value.get("smartObjects"))
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                return bounded_text(
                    &format!(
                        "PSD inspection ready: {count} Smart Object{}; source unchanged.",
                        if count == 1 { "" } else { "s" }
                    ),
                    MAX_SCHEMA_ERROR_CHARS,
                );
            }
            "templatePlan" => {
                let count = result
                    .get("plan")
                    .and_then(|value| value.get("bindings"))
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len);
                return bounded_text(
                    &format!(
                        "PSD template plan ready: {count} selected Smart Object{}; source unchanged.",
                        if count == 1 { "" } else { "s" }
                    ),
                    MAX_SCHEMA_ERROR_CHARS,
                );
            }
            _ => {}
        }
    }
    if let (Some(outcome), Some(candidates), Some(provider)) = (
        result.get("outcome").and_then(Value::as_str),
        result.get("candidates").and_then(Value::as_array),
        result
            .get("provider")
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str),
    ) {
        return bounded_text(
            &format!(
                "Plane assessment {outcome}: {} candidate{} from {provider}; no transform applied.",
                candidates.len(),
                if candidates.len() == 1 { "" } else { "s" }
            ),
            MAX_SCHEMA_ERROR_CHARS,
        );
    }
    if let (Some(status), Some(output), Some(evidence)) = (
        result.get("status").and_then(Value::as_str),
        result.get("output").and_then(Value::as_str),
        result.get("evidence"),
    ) {
        let width = evidence.get("outputWidth").and_then(Value::as_u64);
        let height = evidence.get("outputHeight").and_then(Value::as_u64);
        let bytes = result.get("bytes").and_then(Value::as_u64);
        if let (Some(width), Some(height), Some(bytes)) = (width, height, bytes) {
            return bounded_text(
                &format!("Render {status}: {output} ({width}x{height}, {bytes} bytes)."),
                MAX_SCHEMA_ERROR_CHARS,
            );
        }
    }
    if let (Some(status), Some(directory), Some(items)) = (
        result.get("status").and_then(Value::as_str),
        result.get("outputDirectory").and_then(Value::as_str),
        result.get("items").and_then(Value::as_array),
    ) {
        if let Some(output_count) = result
            .get("plan")
            .and_then(|plan| plan.get("outputCount"))
            .and_then(Value::as_u64)
        {
            return bounded_text(
                &format!(
                    "Variation Job {status}: {} item{} and {output_count} output{} in {directory}.",
                    items.len(),
                    if items.len() == 1 { "" } else { "s" },
                    if output_count == 1 { "" } else { "s" }
                ),
                MAX_SCHEMA_ERROR_CHARS,
            );
        }
        let plan_schema = result
            .get("plan")
            .and_then(|plan| plan.get("schema"))
            .and_then(Value::as_str);
        let family = match plan_schema {
            Some("worldbend.motion-plan") => "Motion",
            Some("worldbend.timeline-plan") => "Timeline",
            Some("worldbend.mockup-extract-plan") => "Mockup extraction",
            _ => "Canvas Set",
        };
        return bounded_text(
            &format!(
                "{family} {status}: {} ordered output{} in {directory}.",
                items.len(),
                if items.len() == 1 { "" } else { "s" }
            ),
            MAX_SCHEMA_ERROR_CHARS,
        );
    }
    if let (Some(width), Some(height)) = (
        result.get("width").and_then(Value::as_str),
        result.get("height").and_then(Value::as_str),
    ) {
        return format!("CSS transform ready for a {width} x {height} element.");
    }
    if let Some(output) = result.get("outputSpec")
        && let Some(reference) = output
            .get("destination")
            .and_then(|value| value.get("reference"))
        && let (Some(width), Some(height)) = (
            reference.get("width").and_then(Value::as_f64),
            reference.get("height").and_then(Value::as_f64),
        )
    {
        return format!("Rectification plan ready for {width}x{height} output.");
    }
    if let Some(size) = result.get("canvas").and_then(|value| value.get("size"))
        && let (Some(width), Some(height)) = (
            size.get("width").and_then(Value::as_f64),
            size.get("height").and_then(Value::as_f64),
        )
    {
        return format!("Transform composed into a {width}x{height} canvas.");
    }
    if result.get("resolvedDestination").is_some() {
        return if result.get("spec").is_some() {
            "Projective plane solved and validated.".to_owned()
        } else {
            "TransformSpec inspected and validated.".to_owned()
        };
    }
    "Worldbend operation completed.".to_owned()
}

impl<T> IntoCallToolResult for ToolEnvelope<T>
where
    T: Serialize + JsonSchema + 'static,
{
    fn into_call_tool_result(self) -> Result<CallToolResponse, rmcp::ErrorData> {
        let result = self.build_complete_result()?;
        if serialized_call_result_bytes(&result)? > MAX_TOOL_RESPONSE_BYTES {
            let bounded = json!({
                "ok": false,
                "error": {
                    "code": "E_OUTPUT_LIMIT",
                    "message": "serialized MCP tool response exceeds the response byte limit",
                    "details": {
                        "maximum": MAX_TOOL_RESPONSE_BYTES
                    }
                }
            });
            let bounded_result = build_call_tool_result(
                bounded,
                "E_OUTPUT_LIMIT: serialized MCP tool response exceeds the response byte limit"
                    .to_owned(),
                true,
            );
            debug_assert!(
                serialized_call_result_bytes(&bounded_result)
                    .is_ok_and(|bytes| bytes <= MAX_TOOL_RESPONSE_BYTES)
            );
            return Ok(bounded_result.into());
        }
        Ok(result.into())
    }
}

fn build_call_tool_result(value: Value, summary: String, is_error: bool) -> CallToolResult {
    let mut result = if is_error {
        CallToolResult::structured_error(value)
    } else {
        CallToolResult::structured(value)
    };
    result.content = vec![ContentBlock::text(summary)];
    result
}

fn serialized_call_result_bytes(result: &CallToolResult) -> Result<usize, rmcp::ErrorData> {
    serde_json::to_vec(result)
        .map(|bytes| bytes.len())
        .map_err(|error| {
            rmcp::ErrorData::internal_error(
                format!("failed to size Worldbend MCP tool response: {error}"),
                None,
            )
        })
}

fn true_schema(_generator: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "boolean", "const": true })
}

fn false_schema(_generator: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "boolean", "const": false })
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SolveInput {
    #[schemars(description = "Explicit destination plane; corners are strict TL, TR, BR, BL")]
    destination: Destination,
    #[serde(default)]
    content: Content,
    #[serde(default)]
    #[schemars(
        description = "Required to resolve normalized coordinates; omit for pixel coordinates"
    )]
    target_size: Option<Size>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ComposeInput {
    #[schemars(description = "Saved worldbend.transform document to compose")]
    spec: TransformSpec,
    #[serde(default)]
    #[schemars(description = "Required when spec.destination.space is normalized")]
    target_size: Option<Size>,
    #[serde(default)]
    transform: TransformRecipe,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InspectInput {
    #[schemars(description = "Saved worldbend.transform document to validate and inspect")]
    spec: TransformSpec,
    #[serde(default)]
    #[schemars(description = "Required when spec.destination.space is normalized")]
    target_size: Option<Size>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenderInput {
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
    spec: TransformSpec,
    #[schemars(description = "Relative PNG output path under the granted workspace root")]
    output: String,
    #[serde(default)]
    options: RenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Replace an existing regular PNG atomically")]
    overwrite: bool,
    #[serde(default)]
    #[schemars(
        description = "Run solve, render, encode, and destination preflight without publishing"
    )]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MediaInspectInput {
    #[schemars(
        description = "Relative PNG, JPEG, WebP, or TIFF path under the granted workspace root"
    )]
    source: String,
    #[serde(default)]
    limits: MediaLimitsInput,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PlaneCandidatesInput {
    #[schemars(
        description = "Relative PNG, JPEG, WebP, or TIFF path under the granted workspace root"
    )]
    source: String,
    request: PlaneCandidateRequest,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PsdSmartObjectsInput {
    #[schemars(description = "Relative PSD or PSB path under the granted workspace root")]
    source: String,
    request: PsdSmartObjectRequest,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MediaRenderInput {
    #[schemars(
        description = "Relative PNG, JPEG, WebP, or TIFF path under the granted workspace root"
    )]
    source: String,
    spec: TransformSpec,
    #[schemars(description = "Relative output path whose extension matches options.output.format")]
    output: String,
    options: MediaRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Replace an existing regular output file atomically")]
    overwrite: bool,
    #[serde(default)]
    #[schemars(description = "Decode, solve, render, encode, and hash without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VectorRenderInput {
    #[schemars(description = "Relative UTF-8 SVG path under the granted workspace root")]
    source: String,
    spec: TransformSpec,
    #[schemars(description = "Relative .svg or .html output matching options.carrier")]
    output: String,
    options: VectorRenderOptions,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TiledMediaRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    canvas: CanvasMode,
    #[serde(default)]
    target_size: Option<Size>,
    #[serde(default)]
    source_limits: MediaLimitsInput,
    #[schemars(range(min = 1, max = 4096))]
    tile_width: u32,
    #[schemars(range(min = 1, max = 4096))]
    tile_height: u32,
    #[serde(default = "default_mcp_tiled_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_TILED_PIXELS))]
    max_output_pixels: u64,
    #[serde(default = "default_mcp_tiled_encoded_bytes")]
    #[schemars(range(min = 1, max = MCP_MAX_TILED_ENCODED_BYTES))]
    max_encoded_bytes: u64,
    output: MediaOutput,
}

const fn default_mcp_tiled_pixels() -> u64 {
    MCP_MAX_TILED_PIXELS
}

const fn default_mcp_tiled_encoded_bytes() -> u64 {
    MCP_MAX_TILED_ENCODED_BYTES
}

impl TryFrom<TiledMediaRenderOptionsInput> for TiledMediaRenderOptions {
    type Error = TransformError;

    fn try_from(value: TiledMediaRenderOptionsInput) -> Result<Self, Self::Error> {
        if value.tile_width == 0
            || value.tile_height == 0
            || value.tile_width > 4096
            || value.tile_height > 4096
            || u64::from(value.tile_width) * u64::from(value.tile_height) > MAX_TILED_TILE_PIXELS
            || value.max_output_pixels == 0
            || value.max_output_pixels > MCP_MAX_TILED_PIXELS
            || value.max_encoded_bytes == 0
            || value.max_encoded_bytes > MCP_MAX_TILED_ENCODED_BYTES
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "tiled media options exceed the Agent resource ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            canvas: value.canvas,
            target_size: value.target_size,
            source_limits: value.source_limits.try_into()?,
            tile_width: value.tile_width,
            tile_height: value.tile_height,
            max_output_pixels: value.max_output_pixels,
            max_encoded_bytes: value.max_encoded_bytes,
            max_tiles: MCP_MAX_TILED_TILES,
            output: value.output,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TiledMediaRenderInput {
    #[schemars(
        description = "Relative PNG, JPEG, WebP, or TIFF source under the granted workspace root"
    )]
    source: String,
    spec: TransformSpec,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    options: TiledMediaRenderOptionsInput,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Default)]
enum OptionalInput<T> {
    #[default]
    Missing,
    Value(T),
}

impl<'de, T> Deserialize<'de> for OptionalInput<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        T::deserialize(deserializer).map(Self::Value)
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
#[schemars(
    description = "Provide exactly one of spec or plan; plan requires sampling and outsideFill."
)]
struct CanvasRenderInput {
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    #[serde(default)]
    #[schemars(with = "CanvasSetSpec")]
    spec: OptionalInput<CanvasSetSpec>,
    #[serde(default)]
    #[schemars(with = "CanvasSetPlan")]
    plan: OptionalInput<CanvasSetPlan>,
    #[serde(default)]
    #[schemars(with = "SamplingQuality")]
    quality: OptionalInput<SamplingQuality>,
    #[serde(default)]
    #[schemars(with = "CanvasReplaySampling")]
    sampling: OptionalInput<CanvasReplaySampling>,
    #[serde(default)]
    #[schemars(with = "CanvasBackground")]
    outside_fill: OptionalInput<CanvasBackground>,
    #[serde(default)]
    #[schemars(description = "Render and preflight the Canvas Set without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RectifyInput {
    spec: RectifySpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RectifyRenderInput {
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
    spec: RectifySpec,
    #[schemars(description = "Relative PNG output path under the granted workspace root")]
    output: String,
    #[serde(default)]
    options: RectifyRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Replace an existing regular PNG atomically")]
    overwrite: bool,
    #[serde(default)]
    #[schemars(
        description = "Run rectify, render, encode, and destination preflight without publishing"
    )]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProgramInspectInput {
    spec: RasterProgramSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProgramRenderInput {
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
    spec: RasterProgramSpec,
    #[schemars(description = "Relative PNG output path under the granted workspace root")]
    output: String,
    #[serde(default)]
    options: ProgramRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Replace an existing regular PNG atomically")]
    overwrite: bool,
    #[serde(default)]
    #[schemars(description = "Execute every stage and encode the final PNG without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TemplateInspectInput {
    spec: SpatialTemplateSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VariationPlanInput {
    spec: VariationJobSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VariationAssetInput {
    #[schemars(description = "Exact assetId referenced by one or more Variation Job bindings")]
    id: String,
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VariationRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
    #[serde(default = "default_mcp_variation_source_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_VARIATION_SOURCE_PIXELS))]
    max_source_pixels: u64,
    #[serde(default = "default_mcp_variation_processed_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_VARIATION_PROCESSED_PIXELS))]
    max_processed_pixels: u64,
}

impl Default for VariationRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
            max_source_pixels: MCP_MAX_VARIATION_SOURCE_PIXELS,
            max_processed_pixels: MCP_MAX_VARIATION_PROCESSED_PIXELS,
        }
    }
}

const fn default_mcp_variation_source_pixels() -> u64 {
    MCP_MAX_VARIATION_SOURCE_PIXELS
}

const fn default_mcp_variation_processed_pixels() -> u64 {
    MCP_MAX_VARIATION_PROCESSED_PIXELS
}

impl TryFrom<VariationRenderOptionsInput> for VariationJobRenderOptions {
    type Error = TransformError;

    fn try_from(value: VariationRenderOptionsInput) -> Result<Self, Self::Error> {
        if value.max_source_pixels == 0
            || value.max_source_pixels > MCP_MAX_VARIATION_SOURCE_PIXELS
            || value.max_processed_pixels == 0
            || value.max_processed_pixels > MCP_MAX_VARIATION_PROCESSED_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Variation Job limits exceed the Agent ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
            max_source_pixels: value.max_source_pixels,
            max_processed_pixels: value.max_processed_pixels,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VariationRenderInput {
    #[schemars(description = "One unique entry for every distinct assetId in the job")]
    assets: Vec<VariationAssetInput>,
    spec: VariationJobSpec,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    #[serde(default)]
    options: VariationRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Render, encode, hash, and same-parent stage without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CssInput {
    #[schemars(description = "worldbend.transform document to express as CSS matrix3d")]
    spec: TransformSpec,
    #[schemars(description = "Untransformed element border-box size in CSS pixels")]
    element_size: Size,
    #[serde(default)]
    #[schemars(description = "Required for normalized specs; omit for pixel-space specs")]
    destination_size: Option<Size>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
enum OperationId {
    Compose,
    Solve,
    Inspect,
    Render,
    MediaInspect,
    PlaneCandidates,
    PsdSmartObjects,
    MediaRender,
    VectorRender,
    TiledMediaRender,
    Rectify,
    RectifyRender,
    ProgramInspect,
    ProgramRender,
    TemplateInspect,
    VariationPlan,
    VariationRender,
    CanvasRender,
    MockupPlan,
    MockupRender,
    MockupExtractPlan,
    MockupExtractRender,
    MeshPlan,
    MeshRender,
    SurfacePlan,
    SurfaceRender,
    RemapPlan,
    RemapRender,
    TimelinePlan,
    TimelineRender,
    MotionPlan,
    MotionRender,
    Css,
}

impl OperationId {
    const ALL: [Self; 33] = [
        Self::Compose,
        Self::Solve,
        Self::Inspect,
        Self::Render,
        Self::MediaInspect,
        Self::PlaneCandidates,
        Self::PsdSmartObjects,
        Self::MediaRender,
        Self::VectorRender,
        Self::TiledMediaRender,
        Self::Rectify,
        Self::RectifyRender,
        Self::ProgramInspect,
        Self::ProgramRender,
        Self::TemplateInspect,
        Self::VariationPlan,
        Self::VariationRender,
        Self::CanvasRender,
        Self::MockupPlan,
        Self::MockupRender,
        Self::MockupExtractPlan,
        Self::MockupExtractRender,
        Self::MeshPlan,
        Self::MeshRender,
        Self::SurfacePlan,
        Self::SurfaceRender,
        Self::RemapPlan,
        Self::RemapRender,
        Self::TimelinePlan,
        Self::TimelineRender,
        Self::MotionPlan,
        Self::MotionRender,
        Self::Css,
    ];

    const fn id(self) -> &'static str {
        match self {
            Self::Compose => "compose",
            Self::Solve => "solve",
            Self::Inspect => "inspect",
            Self::Render => "render",
            Self::MediaInspect => "media_inspect",
            Self::PlaneCandidates => "plane_candidates",
            Self::PsdSmartObjects => "psd_smart_objects",
            Self::MediaRender => "media_render",
            Self::VectorRender => "vector_render",
            Self::TiledMediaRender => "tiled_media_render",
            Self::Rectify => "rectify",
            Self::RectifyRender => "rectify_render",
            Self::ProgramInspect => "program_inspect",
            Self::ProgramRender => "program_render",
            Self::TemplateInspect => "template_inspect",
            Self::VariationPlan => "variation_plan",
            Self::VariationRender => "variation_render",
            Self::CanvasRender => "canvas_render",
            Self::MockupPlan => "mockup_plan",
            Self::MockupRender => "mockup_render",
            Self::MockupExtractPlan => "mockup_extract_plan",
            Self::MockupExtractRender => "mockup_extract_render",
            Self::MeshPlan => "mesh_plan",
            Self::MeshRender => "mesh_render",
            Self::SurfacePlan => "surface_plan",
            Self::SurfaceRender => "surface_render",
            Self::RemapPlan => "remap_plan",
            Self::RemapRender => "remap_render",
            Self::TimelinePlan => "timeline_plan",
            Self::TimelineRender => "timeline_render",
            Self::MotionPlan => "motion_plan",
            Self::MotionRender => "motion_render",
            Self::Css => "css",
        }
    }

    const fn title(self) -> &'static str {
        match self {
            Self::Compose => "Compose transform",
            Self::Solve => "Solve projective plane",
            Self::Inspect => "Inspect projective plane",
            Self::Render => "Render projective raster",
            Self::MediaInspect => "Inspect production raster",
            Self::PlaneCandidates => "Suggest source-plane candidates",
            Self::PsdSmartObjects => "Inspect PSD Smart Objects",
            Self::MediaRender => "Render production raster",
            Self::VectorRender => "Preserve vector placement",
            Self::TiledMediaRender => "Render tiled production raster",
            Self::Rectify => "Plan plane rectification",
            Self::RectifyRender => "Render plane rectification",
            Self::ProgramInspect => "Inspect raster program",
            Self::ProgramRender => "Render raster program",
            Self::TemplateInspect => "Inspect Spatial Template",
            Self::VariationPlan => "Plan Variation Job",
            Self::VariationRender => "Render Variation Job",
            Self::CanvasRender => "Render Canvas Set",
            Self::MockupPlan => "Plan multi-plane mockup",
            Self::MockupRender => "Render multi-plane mockup",
            Self::MockupExtractPlan => "Plan multi-plane extraction",
            Self::MockupExtractRender => "Render multi-plane extraction",
            Self::MeshPlan => "Plan custom mesh warp",
            Self::MeshRender => "Render custom mesh warp",
            Self::SurfacePlan => "Plan cubic surface deformation",
            Self::SurfaceRender => "Render cubic surface deformation",
            Self::RemapPlan => "Plan lens or displacement remap",
            Self::RemapRender => "Render lens or displacement remap",
            Self::TimelinePlan => "Plan ordered transform timeline",
            Self::TimelineRender => "Render ordered transform timeline",
            Self::MotionPlan => "Plan eased motion keyframes",
            Self::MotionRender => "Render eased motion keyframes",
            Self::Css => "Emit projective CSS",
        }
    }

    const fn summary(self) -> &'static str {
        match self {
            Self::Compose => {
                "Compose explicit affine, flip, and bounded Warp values over a saved plane without rasterizing."
            }
            Self::Solve => {
                "Validate an explicit destination quadrilateral and solve its reusable projective mapping."
            }
            Self::Inspect => {
                "Validate a saved TransformSpec and return bounds and numerical diagnostics."
            }
            Self::Render => {
                "Render a local raster through a saved plane under the granted workspace root."
            }
            Self::MediaInspect => {
                "Inspect one production raster's format, precision, alpha, orientation, digest, and ICC metadata."
            }
            Self::PlaneCandidates => {
                "Ask one explicit local Provider for source-plane candidates, uncalibrated confidence, uncertainty, and source facts without applying a transform."
            }
            Self::PsdSmartObjects => {
                "Read bounded PSD/PSB Smart Object placement metadata and optionally project selected eligible objects into a Spatial Template without modifying the document."
            }
            Self::MediaRender => {
                "Render PNG, JPEG, WebP, or TIFF with explicit output precision, ICC policy, and loss disclosure."
            }
            Self::VectorRender => {
                "Preserve an SVG source in an affine SVG or projective HTML matrix3d carrier without rasterizing it."
            }
            Self::TiledMediaRender => {
                "Render a large destination as an atomic tile directory and deterministic manifest without allocating one full output canvas."
            }
            Self::Rectify => {
                "Plan flattening of one explicit source quadrilateral into a declared output rectangle."
            }
            Self::RectifyRender => {
                "Render an explicit planar rectification to a local PNG under the granted root."
            }
            Self::ProgramInspect => {
                "Validate one ordered single-raster Transform, Rectify, and Canvas program without decoding pixels."
            }
            Self::ProgramRender => {
                "Execute ordered single-raster stages in memory and atomically publish only the final PNG."
            }
            Self::TemplateInspect => {
                "Validate one reusable Spatial Template and derive its exact source slots and outputs."
            }
            Self::VariationPlan => {
                "Validate an ordered Variation Job and canonicalize its slot-to-asset bindings without decoding pixels."
            }
            Self::VariationRender => {
                "Render every item in one Variation Job and atomically publish the complete nested PNG directory."
            }
            Self::CanvasRender => {
                "Render one ordered explicit Canvas Set atomically, or replay its resolved plan."
            }
            Self::MockupPlan => {
                "Validate and plan explicit ordered planes, connected edges, grids, and measurements."
            }
            Self::MockupRender => {
                "Composite explicit local source rasters onto an ordered multi-plane mockup canvas."
            }
            Self::MockupExtractPlan => {
                "Validate and plan ordered explicit source-plane extractions from one raster."
            }
            Self::MockupExtractRender => {
                "Extract ordered explicit source planes into one atomically published PNG directory."
            }
            Self::MeshPlan => {
                "Validate and solve a caller-authored bounded custom deformation mesh."
            }
            Self::MeshRender => {
                "Render one caller-authored bounded custom mesh through the native rasterizer."
            }
            Self::SurfacePlan => {
                "Resolve a bounded cubic Bezier envelope plus explicit anchors and ordered strokes into the canonical custom mesh contract."
            }
            Self::SurfaceRender => {
                "Render a bounded cubic Bezier envelope plus explicit ordered deformation strokes through the native rasterizer."
            }
            Self::RemapPlan => {
                "Validate and plan explicit Brown-Conrady lens or channel displacement remapping."
            }
            Self::RemapRender => {
                "Render an explicit lens remap or displacement-map program through the native rasterizer."
            }
            Self::TimelinePlan => {
                "Validate and expand explicit frames or linearly interpolated corner keyframes."
            }
            Self::TimelineRender => {
                "Render an ordered frame set into one atomically published PNG directory."
            }
            Self::MotionPlan => {
                "Expand explicit keyframes, rational frame timing, and declared easing into the canonical Timeline contract."
            }
            Self::MotionRender => {
                "Render explicit eased motion keyframes into one atomically published PNG directory."
            }
            Self::Css => "Emit CSS matrix3d values for a non-Warp live element mapping.",
        }
    }

    const fn search_terms(self) -> &'static str {
        match self {
            Self::Compose => {
                "compose transform scale rotate rotation skew translate pivot flip warp affine"
            }
            Self::Solve => "solve perspective homography corner pin quadrilateral plane",
            Self::Inspect => {
                "inspect validate diagnostics bounds reprojection horizon transform spec"
            }
            Self::Render => "render raster png jpeg webp apply replace image",
            Self::MediaInspect => {
                "media inspect production raster png jpeg webp tiff icc color precision bit depth alpha orientation digest"
            }
            Self::PlaneCandidates => {
                "perception plane candidates suggest detect quad quadrilateral confidence uncertainty alpha contrast source facts no auto apply"
            }
            Self::PsdSmartObjects => {
                "psd psb photoshop smart object placed layer inspect template import source replacement read only"
            }
            Self::MediaRender => {
                "media render production raster png jpeg webp tiff icc preserve discard u16 f32 quality loss"
            }
            Self::VectorRender => {
                "vector svg preserve affine projective html matrix3d placement no raster"
            }
            Self::TiledMediaRender => {
                "tiled media large huge canvas render tiles manifest streaming bounded memory png tiff"
            }
            Self::Rectify => "rectify flatten extract source plane quadrilateral plan",
            Self::RectifyRender => "rectify render flatten extract source plane png image",
            Self::ProgramInspect => {
                "program pipeline ordered transform rectify canvas inspect validate single raster"
            }
            Self::ProgramRender => {
                "program pipeline ordered transform rectify canvas render in memory atomic png"
            }
            Self::TemplateInspect => {
                "template reusable spatial project source slots outputs non destructive inspect"
            }
            Self::VariationPlan => {
                "variation job batch replace source bindings assets plan reusable template"
            }
            Self::VariationRender => {
                "variation job batch replace source bindings assets render atomic directory"
            }
            Self::CanvasRender => {
                "canvas crop trim pad contain cover stretch multi output resize variants"
            }
            Self::MockupPlan => {
                "mockup place plane connected shared edge seam grid measurement packaging screen billboard"
            }
            Self::MockupRender => {
                "mockup place composite render packaging faces screen replacement billboard sources"
            }
            Self::MockupExtractPlan => {
                "mockup extract reverse rectify flatten planes packaging faces screen billboard plan"
            }
            Self::MockupExtractRender => {
                "mockup extract reverse rectify flatten planes packaging faces screen billboard render"
            }
            Self::MeshPlan => "mesh warp envelope grid control points deform plan",
            Self::MeshRender => "mesh warp envelope grid control points deform render raster",
            Self::SurfacePlan => {
                "surface deformation cubic bezier envelope anchors strokes liquify mesh plan"
            }
            Self::SurfaceRender => {
                "surface deformation cubic bezier envelope anchors strokes liquify mesh render"
            }
            Self::RemapPlan => {
                "remap lens correction barrel pincushion distortion displacement map channels plan"
            }
            Self::RemapRender => {
                "remap lens correction barrel pincushion distortion displacement map channels render"
            }
            Self::TimelinePlan => {
                "timeline animation frames keyframes linear interpolation corner pin plan"
            }
            Self::TimelineRender => {
                "timeline animation frames keyframes sequence png atomic directory render"
            }
            Self::MotionPlan => {
                "motion animation keyframes easing cubic bezier hold rational timebase timeline plan"
            }
            Self::MotionRender => {
                "motion animation keyframes easing frame rate sequence png atomic directory render"
            }
            Self::Css => "css matrix3d live element iframe video canvas dom",
        }
    }

    const fn mutates_files(self) -> bool {
        matches!(
            self,
            Self::Render
                | Self::MediaRender
                | Self::VectorRender
                | Self::TiledMediaRender
                | Self::RectifyRender
                | Self::ProgramRender
                | Self::VariationRender
                | Self::CanvasRender
                | Self::MockupRender
                | Self::MockupExtractRender
                | Self::MeshRender
                | Self::SurfaceRender
                | Self::RemapRender
                | Self::TimelineRender
                | Self::MotionRender
        )
    }

    const fn requires_workspace(self) -> bool {
        self.mutates_files()
            || matches!(
                self,
                Self::MediaInspect | Self::PlaneCandidates | Self::PsdSmartObjects
            )
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SearchInput {
    #[serde(default)]
    #[schemars(
        description = "Case-insensitive operation terms; empty returns the compact catalog"
    )]
    query: String,
    #[serde(default = "default_search_limit")]
    #[schemars(range(min = 1, max = 20))]
    limit: u8,
}

const fn default_search_limit() -> u8 {
    8
}

#[derive(Debug, Clone, Serialize, JsonSchema, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OperationSummary {
    operation: OperationId,
    title: &'static str,
    summary: &'static str,
    mutates_files: bool,
    requires_workspace: bool,
}

impl From<OperationId> for OperationSummary {
    fn from(operation: OperationId) -> Self {
        Self {
            operation,
            title: operation.title(),
            summary: operation.summary(),
            mutates_files: operation.mutates_files(),
            requires_workspace: operation.requires_workspace(),
        }
    }
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SearchResult {
    operations: Vec<OperationSummary>,
    total_matches: u32,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DescribeInput {
    operation: OperationId,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OperationDescriptor {
    operation: OperationId,
    title: &'static str,
    summary: &'static str,
    mutates_files: bool,
    requires_workspace: bool,
    input_schema: Value,
    output_schema: Value,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RunInput {
    operation: OperationId,
    #[schemars(
        description = "Closed operation arguments; call worldbend.describe only when the exact schema is not already known"
    )]
    arguments: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupPlanInput {
    spec: MockupSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupSourceInput {
    #[schemars(description = "Exact sourceId referenced by one or more mockup planes")]
    id: String,
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
}

impl Default for MockupRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
        }
    }
}

impl TryFrom<MockupRenderOptionsInput> for MockupRenderOptions {
    type Error = TransformError;

    fn try_from(value: MockupRenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupRenderInput {
    #[schemars(description = "One unique entry for every distinct sourceId in the mockup spec")]
    sources: Vec<MockupSourceInput>,
    spec: MockupSpec,
    #[schemars(description = "Relative PNG output path under the granted workspace root")]
    output: String,
    #[serde(default)]
    options: MockupRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Replace an existing regular PNG atomically")]
    overwrite: bool,
    #[serde(default)]
    #[schemars(description = "Render and encode the complete mockup without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupExtractPlanInput {
    spec: MockupExtractSpec,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupExtractRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
    #[serde(default = "default_mcp_mockup_extract_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_MOCKUP_EXTRACT_PIXELS))]
    max_cumulative_pixels: u64,
}

impl Default for MockupExtractRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
            max_cumulative_pixels: MCP_MAX_MOCKUP_EXTRACT_PIXELS,
        }
    }
}

impl TryFrom<MockupExtractRenderOptionsInput> for MockupExtractRenderOptions {
    type Error = TransformError;

    fn try_from(value: MockupExtractRenderOptionsInput) -> Result<Self, Self::Error> {
        if value.max_cumulative_pixels == 0
            || value.max_cumulative_pixels > MCP_MAX_MOCKUP_EXTRACT_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "mockup extraction cumulative pixel limit exceeds the Agent ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
            max_cumulative_pixels: value.max_cumulative_pixels,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MockupExtractRenderInput {
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
    spec: MockupExtractSpec,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    #[serde(default)]
    options: MockupExtractRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Render, encode, hash, and same-parent stage without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeshPlanInput {
    spec: MeshWarpSpec,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeshRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
}

impl Default for MeshRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
        }
    }
}

impl TryFrom<MeshRenderOptionsInput> for MeshWarpRenderOptions {
    type Error = TransformError;

    fn try_from(value: MeshRenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MeshRenderInput {
    source: String,
    spec: MeshWarpSpec,
    output: String,
    #[serde(default)]
    options: MeshRenderOptionsInput,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SurfacePlanInput {
    spec: SurfaceDeformationSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SurfaceRenderInput {
    source: String,
    spec: SurfaceDeformationSpec,
    output: String,
    #[serde(default)]
    options: MeshRenderOptionsInput,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RemapPlanInput {
    spec: RemapSpec,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RemapRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
}

impl Default for RemapRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
        }
    }
}

impl TryFrom<RemapRenderOptionsInput> for RemapRenderOptions {
    type Error = TransformError;

    fn try_from(value: RemapRenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RemapRenderInput {
    source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    map: Option<String>,
    spec: RemapSpec,
    output: String,
    #[serde(default)]
    options: RemapRenderOptionsInput,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TimelinePlanInput {
    spec: TimelineSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TimelineSourceInput {
    #[schemars(description = "Exact sourceId referenced by one or more planned frames")]
    id: String,
    #[schemars(description = "Relative PNG, JPEG, or WebP path under the granted workspace root")]
    source: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TimelineRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
    #[serde(default = "default_mcp_timeline_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_TIMELINE_PIXELS))]
    max_cumulative_pixels: u64,
}

const fn default_mcp_timeline_pixels() -> u64 {
    MCP_MAX_TIMELINE_PIXELS
}

impl Default for TimelineRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
            max_cumulative_pixels: MCP_MAX_TIMELINE_PIXELS,
        }
    }
}

impl TryFrom<TimelineRenderOptionsInput> for TimelineRenderOptions {
    type Error = TransformError;

    fn try_from(value: TimelineRenderOptionsInput) -> Result<Self, Self::Error> {
        if value.max_cumulative_pixels == 0 || value.max_cumulative_pixels > MCP_MAX_TIMELINE_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "timeline cumulative pixel limit exceeds the Agent ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
            max_cumulative_pixels: value.max_cumulative_pixels,
        })
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TimelineRenderInput {
    sources: Vec<TimelineSourceInput>,
    spec: TimelineSpec,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    #[serde(default)]
    options: TimelineRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Render, encode, hash, and same-parent stage without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MotionPlanInput {
    spec: MotionSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MotionRenderInput {
    sources: Vec<TimelineSourceInput>,
    spec: MotionSpec,
    #[schemars(description = "New relative output directory under the granted workspace root")]
    output_directory: String,
    #[serde(default)]
    options: TimelineRenderOptionsInput,
    #[serde(default)]
    #[schemars(description = "Render, encode, hash, and same-parent stage without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenderLimitsInput {
    #[serde(default = "default_mcp_max_axis")]
    #[schemars(range(min = 1, max = MCP_MAX_AXIS))]
    max_width: u32,
    #[serde(default = "default_mcp_max_axis")]
    #[schemars(range(min = 1, max = MCP_MAX_AXIS))]
    max_height: u32,
    #[serde(default = "default_mcp_max_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_PIXELS))]
    max_pixels: u64,
    #[serde(default = "default_mcp_max_source_bytes")]
    #[schemars(range(min = 1, max = MCP_MAX_SOURCE_BYTES))]
    max_source_bytes: u64,
}

const fn default_mcp_max_axis() -> u32 {
    MCP_MAX_AXIS
}

const fn default_mcp_max_pixels() -> u64 {
    MCP_MAX_PIXELS
}

const fn default_mcp_max_source_bytes() -> u64 {
    MCP_MAX_SOURCE_BYTES
}

const fn default_mcp_mockup_extract_pixels() -> u64 {
    MCP_MAX_MOCKUP_EXTRACT_PIXELS
}

impl Default for RenderLimitsInput {
    fn default() -> Self {
        Self {
            max_width: MCP_MAX_AXIS,
            max_height: MCP_MAX_AXIS,
            max_pixels: MCP_MAX_PIXELS,
            max_source_bytes: MCP_MAX_SOURCE_BYTES,
        }
    }
}

impl TryFrom<RenderLimitsInput> for RenderLimits {
    type Error = TransformError;

    fn try_from(value: RenderLimitsInput) -> Result<Self, Self::Error> {
        if value.max_width == 0
            || value.max_height == 0
            || value.max_pixels == 0
            || value.max_source_bytes == 0
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "render limits must be positive integers",
            ));
        }
        if value.max_width > MCP_MAX_AXIS
            || value.max_height > MCP_MAX_AXIS
            || value.max_pixels > MCP_MAX_PIXELS
            || value.max_source_bytes > MCP_MAX_SOURCE_BYTES
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "requested render limits exceed the MCP server resource ceiling",
            )
            .with_details(json!({
                "maximum": {
                    "maxWidth": MCP_MAX_AXIS,
                    "maxHeight": MCP_MAX_AXIS,
                    "maxPixels": MCP_MAX_PIXELS,
                    "maxSourceBytes": MCP_MAX_SOURCE_BYTES,
                }
            })));
        }
        Ok(Self {
            max_width: value.max_width,
            max_height: value.max_height,
            max_pixels: value.max_pixels,
            max_source_bytes: value.max_source_bytes,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MediaLimitsInput {
    #[serde(default = "default_mcp_max_axis")]
    #[schemars(range(min = 1, max = MCP_MAX_AXIS))]
    max_width: u32,
    #[serde(default = "default_mcp_max_axis")]
    #[schemars(range(min = 1, max = MCP_MAX_AXIS))]
    max_height: u32,
    #[serde(default = "default_mcp_media_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_MEDIA_PIXELS))]
    max_pixels: u64,
    #[serde(default = "default_mcp_max_source_bytes")]
    #[schemars(range(min = 1, max = MCP_MAX_SOURCE_BYTES))]
    max_source_bytes: u64,
}

const fn default_mcp_media_pixels() -> u64 {
    MCP_MAX_MEDIA_PIXELS
}

impl Default for MediaLimitsInput {
    fn default() -> Self {
        Self {
            max_width: MCP_MAX_AXIS,
            max_height: MCP_MAX_AXIS,
            max_pixels: MCP_MAX_MEDIA_PIXELS,
            max_source_bytes: MCP_MAX_SOURCE_BYTES,
        }
    }
}

impl TryFrom<MediaLimitsInput> for RenderLimits {
    type Error = TransformError;

    fn try_from(value: MediaLimitsInput) -> Result<Self, Self::Error> {
        if value.max_width == 0
            || value.max_height == 0
            || value.max_pixels == 0
            || value.max_source_bytes == 0
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "media limits must be positive integers",
            ));
        }
        if value.max_width > MCP_MAX_AXIS
            || value.max_height > MCP_MAX_AXIS
            || value.max_pixels > MCP_MAX_MEDIA_PIXELS
            || value.max_source_bytes > MCP_MAX_SOURCE_BYTES
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "requested media limits exceed the MCP server resource ceiling",
            )
            .with_details(json!({
                "maximum": {
                    "maxWidth": MCP_MAX_AXIS,
                    "maxHeight": MCP_MAX_AXIS,
                    "maxPixels": MCP_MAX_MEDIA_PIXELS,
                    "maxSourceBytes": MCP_MAX_SOURCE_BYTES,
                }
            })));
        }
        Ok(Self {
            max_width: value.max_width,
            max_height: value.max_height,
            max_pixels: value.max_pixels,
            max_source_bytes: value.max_source_bytes,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MediaRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    canvas: CanvasMode,
    #[serde(default)]
    #[schemars(description = "Required when spec.destination.space is normalized")]
    target_size: Option<Size>,
    #[serde(default)]
    limits: MediaLimitsInput,
    output: MediaOutput,
}

impl TryFrom<MediaRenderOptionsInput> for MediaRenderOptions {
    type Error = TransformError;

    fn try_from(value: MediaRenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            render: RenderOptions {
                quality: value.quality,
                canvas: value.canvas,
                target_size: value.target_size,
                limits: value.limits.try_into()?,
            },
            output: value.output,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    canvas: CanvasMode,
    #[serde(default)]
    #[schemars(description = "Required when spec.destination.space is normalized")]
    target_size: Option<Size>,
    #[serde(default)]
    limits: RenderLimitsInput,
}

impl Default for RenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            canvas: CanvasMode::Tight,
            target_size: None,
            limits: RenderLimitsInput::default(),
        }
    }
}

impl TryFrom<RenderOptionsInput> for RenderOptions {
    type Error = TransformError;

    fn try_from(value: RenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            quality: value.quality,
            canvas: value.canvas,
            target_size: value.target_size,
            limits: value.limits.try_into()?,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RectifyRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
}

impl Default for RectifyRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
        }
    }
}

impl TryFrom<RectifyRenderOptionsInput> for RectifyRenderOptions {
    type Error = TransformError;

    fn try_from(value: RectifyRenderOptionsInput) -> Result<Self, Self::Error> {
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
        })
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProgramRenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    limits: RenderLimitsInput,
    #[serde(default = "default_mcp_raster_program_pixels")]
    #[schemars(range(min = 1, max = MCP_MAX_RASTER_PROGRAM_PIXELS))]
    max_cumulative_pixels: u64,
}

const fn default_mcp_raster_program_pixels() -> u64 {
    MCP_MAX_RASTER_PROGRAM_PIXELS
}

impl Default for ProgramRenderOptionsInput {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimitsInput::default(),
            max_cumulative_pixels: MCP_MAX_RASTER_PROGRAM_PIXELS,
        }
    }
}

impl TryFrom<ProgramRenderOptionsInput> for RasterProgramRenderOptions {
    type Error = TransformError;

    fn try_from(value: ProgramRenderOptionsInput) -> Result<Self, Self::Error> {
        if value.max_cumulative_pixels == 0
            || value.max_cumulative_pixels > MCP_MAX_RASTER_PROGRAM_PIXELS
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "raster-program cumulative pixel limit exceeds the Agent ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
            max_cumulative_pixels: value.max_cumulative_pixels,
        })
    }
}

#[derive(Debug)]
struct RenderRequest {
    source: String,
    spec: TransformSpec,
    output: String,
    options: RenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct MediaInspectRequest {
    source: String,
    limits: RenderLimits,
}

#[derive(Debug)]
struct PlaneCandidatesRequest {
    source: String,
    request: PlaneCandidateRequest,
}

#[derive(Debug)]
struct PsdSmartObjectsRequest {
    source: String,
    request: PsdSmartObjectRequest,
}

#[derive(Debug)]
struct MediaRenderRequest {
    source: String,
    spec: TransformSpec,
    output: String,
    options: MediaRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct VectorRenderRequest {
    source: String,
    spec: TransformSpec,
    output: String,
    options: VectorRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct TiledMediaRenderRequest {
    source: String,
    spec: TransformSpec,
    output_directory: String,
    options: TiledMediaRenderOptions,
    dry_run: bool,
}

#[derive(Debug)]
struct RectifyRenderRequest {
    source: String,
    spec: RectifySpec,
    output: String,
    options: RectifyRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct ProgramRenderRequest {
    source: String,
    spec: RasterProgramSpec,
    output: String,
    options: RasterProgramRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct VariationRenderRequest {
    assets: Vec<VariationAssetInput>,
    spec: VariationJobSpec,
    output_directory: String,
    options: VariationJobRenderOptions,
    dry_run: bool,
}

#[derive(Debug)]
struct MockupRenderRequest {
    sources: Vec<MockupSourceInput>,
    spec: MockupSpec,
    output: String,
    options: MockupRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct MockupExtractRenderRequest {
    source: String,
    spec: MockupExtractSpec,
    output_directory: String,
    options: MockupExtractRenderOptions,
    dry_run: bool,
}

#[derive(Debug)]
struct MeshRenderRequest {
    source: String,
    spec: MeshWarpSpec,
    output: String,
    options: MeshWarpRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct SurfaceRenderRequest {
    source: String,
    spec: SurfaceDeformationSpec,
    output: String,
    options: MeshWarpRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct RemapRenderRequest {
    source: String,
    map: Option<String>,
    spec: RemapSpec,
    output: String,
    options: RemapRenderOptions,
    overwrite: bool,
    dry_run: bool,
}

#[derive(Debug)]
struct TimelineRenderRequest {
    sources: Vec<TimelineSourceInput>,
    spec: TimelineSpec,
    output_directory: String,
    options: TimelineRenderOptions,
    dry_run: bool,
}

#[derive(Debug)]
struct MotionRenderRequest {
    sources: Vec<TimelineSourceInput>,
    spec: MotionSpec,
    output_directory: String,
    options: TimelineRenderOptions,
    dry_run: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum CanvasWorkerProgram {
    Spec {
        spec: CanvasSetSpec,
        quality: SamplingQuality,
    },
    Plan {
        plan: CanvasSetPlan,
        sampling: CanvasReplaySampling,
        outside_fill: CanvasBackground,
    },
}

#[derive(Debug)]
struct CanvasRenderRequest {
    source: String,
    output_directory: String,
    program: CanvasWorkerProgram,
    dry_run: bool,
}

#[derive(Debug)]
struct PreparedDirectoryResult<T> {
    result: T,
    commit: Option<StagedDirectoryCommit>,
}

#[derive(Debug)]
struct PreparedRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: RenderRequest,
}

#[derive(Debug)]
struct PreparedMediaInspectRequest {
    source: std::fs::File,
    request: MediaInspectRequest,
}

#[derive(Debug)]
struct PreparedPlaneCandidatesRequest {
    source: std::fs::File,
    request: PlaneCandidatesRequest,
}

#[derive(Debug)]
struct PreparedPsdSmartObjectsRequest {
    source: std::fs::File,
    request: PsdSmartObjectsRequest,
}

#[derive(Debug)]
struct PreparedMediaRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: MediaRenderRequest,
}

#[derive(Debug)]
struct PreparedVectorRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: VectorRenderRequest,
}

#[derive(Debug)]
struct PreparedTiledMediaRenderRequest {
    source: std::fs::File,
    output: DirectoryOutputTarget,
    request: TiledMediaRenderRequest,
}

#[derive(Debug)]
struct PreparedRectifyRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: RectifyRenderRequest,
}

#[derive(Debug)]
struct PreparedProgramRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: ProgramRenderRequest,
}

#[derive(Debug)]
struct PreparedVariationRenderRequest {
    assets: Vec<(String, std::fs::File)>,
    output: DirectoryOutputTarget,
    request: VariationRenderRequest,
}

#[derive(Debug)]
struct PreparedMockupRenderRequest {
    sources: Vec<(String, std::fs::File)>,
    output: OutputTarget,
    request: MockupRenderRequest,
}

#[derive(Debug)]
struct PreparedMockupExtractRenderRequest {
    source: std::fs::File,
    output: DirectoryOutputTarget,
    request: MockupExtractRenderRequest,
}

#[derive(Debug)]
struct PreparedMeshRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: MeshRenderRequest,
}

#[derive(Debug)]
struct PreparedSurfaceRenderRequest {
    source: std::fs::File,
    output: OutputTarget,
    request: SurfaceRenderRequest,
}

#[derive(Debug)]
struct PreparedRemapRenderRequest {
    source: std::fs::File,
    map: Option<std::fs::File>,
    output: OutputTarget,
    request: RemapRenderRequest,
}

#[derive(Debug)]
struct PreparedTimelineRenderRequest {
    sources: Vec<(String, std::fs::File)>,
    output: DirectoryOutputTarget,
    request: TimelineRenderRequest,
}

#[derive(Debug)]
struct PreparedMotionRenderRequest {
    sources: Vec<(String, std::fs::File)>,
    output: DirectoryOutputTarget,
    request: MotionRenderRequest,
}

#[derive(Debug)]
struct PreparedCanvasRenderRequest {
    source: std::fs::File,
    output: DirectoryOutputTarget,
    request: CanvasRenderRequest,
}

impl TryFrom<RenderInput> for RenderRequest {
    type Error = TransformError;

    fn try_from(value: RenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<MediaInspectInput> for MediaInspectRequest {
    type Error = TransformError;

    fn try_from(value: MediaInspectInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            limits: value.limits.try_into()?,
        })
    }
}

impl TryFrom<PlaneCandidatesInput> for PlaneCandidatesRequest {
    type Error = TransformError;

    fn try_from(value: PlaneCandidatesInput) -> Result<Self, Self::Error> {
        value.request.validate()?;
        Ok(Self {
            source: value.source,
            request: value.request,
        })
    }
}

impl From<PsdSmartObjectsInput> for PsdSmartObjectsRequest {
    fn from(value: PsdSmartObjectsInput) -> Self {
        Self {
            source: value.source,
            request: value.request,
        }
    }
}

impl TryFrom<MediaRenderInput> for MediaRenderRequest {
    type Error = TransformError;

    fn try_from(value: MediaRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<VectorRenderInput> for VectorRenderRequest {
    type Error = TransformError;

    fn try_from(value: VectorRenderInput) -> Result<Self, Self::Error> {
        if value.options.max_source_bytes == 0
            || value.options.max_source_bytes > MAX_VECTOR_SOURCE_BYTES
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "vector source byte limit exceeds the Agent ceiling",
            ));
        }
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<TiledMediaRenderInput> for TiledMediaRenderRequest {
    type Error = TransformError;

    fn try_from(value: TiledMediaRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output_directory: value.output_directory,
            options: value.options.try_into()?,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<RectifyRenderInput> for RectifyRenderRequest {
    type Error = TransformError;

    fn try_from(value: RectifyRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<ProgramRenderInput> for ProgramRenderRequest {
    type Error = TransformError;

    fn try_from(value: ProgramRenderInput) -> Result<Self, Self::Error> {
        inspect_raster_program(&value.spec)?;
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<VariationRenderInput> for VariationRenderRequest {
    type Error = TransformError;

    fn try_from(value: VariationRenderInput) -> Result<Self, Self::Error> {
        let plan = plan_variation_job(&value.spec)?;
        if plan.output_count > MCP_MAX_VARIATION_OUTPUTS {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Variation Job output count exceeds the Agent response ceiling",
            )
            .with_details(json!({
                "outputCount": plan.output_count,
                "maximum": MCP_MAX_VARIATION_OUTPUTS,
            })));
        }
        if value.assets.is_empty() || value.assets.len() > worldbend_core::MAX_VARIATION_JOB_ITEMS {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Variation Job assets must contain between 1 and 64 entries",
            ));
        }
        let mut ids = HashSet::with_capacity(value.assets.len());
        for asset in &value.assets {
            if !ids.insert(asset.id.as_str()) {
                return Err(TransformError::new(
                    ErrorCode::OutputCollision,
                    "Variation Job asset ids must be unique",
                )
                .with_details(json!({ "assetId": asset.id })));
            }
        }
        Ok(Self {
            assets: value.assets,
            spec: value.spec,
            output_directory: value.output_directory,
            options: value.options.try_into()?,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<MockupRenderInput> for MockupRenderRequest {
    type Error = TransformError;

    fn try_from(value: MockupRenderInput) -> Result<Self, Self::Error> {
        if value.sources.is_empty() || value.sources.len() > worldbend_core::MAX_MOCKUP_PLANES {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!(
                    "mockup sources must contain 1 through {} entries",
                    worldbend_core::MAX_MOCKUP_PLANES
                ),
            ));
        }
        let mut ids = std::collections::HashSet::with_capacity(value.sources.len());
        for source in &value.sources {
            if !ids.insert(source.id.as_str()) {
                return Err(TransformError::new(
                    ErrorCode::OutputCollision,
                    "mockup source ids must be unique",
                )
                .with_details(json!({ "sourceId": source.id })));
            }
        }
        Ok(Self {
            sources: value.sources,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<MockupExtractRenderInput> for MockupExtractRenderRequest {
    type Error = TransformError;

    fn try_from(value: MockupExtractRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output_directory: value.output_directory,
            options: value.options.try_into()?,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<MeshRenderInput> for MeshRenderRequest {
    type Error = TransformError;

    fn try_from(value: MeshRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<SurfaceRenderInput> for SurfaceRenderRequest {
    type Error = TransformError;

    fn try_from(value: SurfaceRenderInput) -> Result<Self, Self::Error> {
        plan_surface_deformation(&value.spec)?;
        Ok(Self {
            source: value.source,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<RemapRenderInput> for RemapRenderRequest {
    type Error = TransformError;

    fn try_from(value: RemapRenderInput) -> Result<Self, Self::Error> {
        Ok(Self {
            source: value.source,
            map: value.map,
            spec: value.spec,
            output: value.output,
            options: value.options.try_into()?,
            overwrite: value.overwrite,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<TimelineRenderInput> for TimelineRenderRequest {
    type Error = TransformError;

    fn try_from(value: TimelineRenderInput) -> Result<Self, Self::Error> {
        if value.sources.is_empty() || value.sources.len() > worldbend_core::MAX_TIMELINE_FRAMES {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "timeline sources must contain between 1 and 240 entries",
            ));
        }
        let mut ids = std::collections::HashSet::with_capacity(value.sources.len());
        for source in &value.sources {
            if !ids.insert(source.id.as_str()) {
                return Err(TransformError::new(
                    ErrorCode::OutputCollision,
                    "timeline source ids must be unique",
                )
                .with_details(json!({ "sourceId": source.id })));
            }
        }
        Ok(Self {
            sources: value.sources,
            spec: value.spec,
            output_directory: value.output_directory,
            options: value.options.try_into()?,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<MotionRenderInput> for MotionRenderRequest {
    type Error = TransformError;

    fn try_from(value: MotionRenderInput) -> Result<Self, Self::Error> {
        let plan = plan_motion(&value.spec)?;
        if value.sources.len() != 1 || value.sources[0].id != plan.source_id {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "motion sources must contain exactly the planned sourceId",
            )
            .with_details(json!({
                "required": [plan.source_id],
                "provided": value.sources.iter().map(|source| &source.id).collect::<Vec<_>>(),
            })));
        }
        Ok(Self {
            sources: value.sources,
            spec: value.spec,
            output_directory: value.output_directory,
            options: value.options.try_into()?,
            dry_run: value.dry_run,
        })
    }
}

impl TryFrom<CanvasRenderInput> for CanvasRenderRequest {
    type Error = TransformError;

    fn try_from(value: CanvasRenderInput) -> Result<Self, Self::Error> {
        match (
            value.spec,
            value.plan,
            value.quality,
            value.sampling,
            value.outside_fill,
        ) {
            (
                OptionalInput::Value(spec),
                OptionalInput::Missing,
                quality,
                OptionalInput::Missing,
                OptionalInput::Missing,
            ) => Ok(Self {
                source: value.source,
                output_directory: value.output_directory,
                program: CanvasWorkerProgram::Spec {
                    spec,
                    quality: match quality {
                        OptionalInput::Missing => SamplingQuality::default(),
                        OptionalInput::Value(quality) => quality,
                    },
                },
                dry_run: value.dry_run,
            }),
            (
                OptionalInput::Missing,
                OptionalInput::Value(plan),
                OptionalInput::Missing,
                OptionalInput::Value(sampling),
                OptionalInput::Value(outside_fill),
            ) => Ok(Self {
                source: value.source,
                output_directory: value.output_directory,
                program: CanvasWorkerProgram::Plan {
                    plan,
                    sampling,
                    outside_fill,
                },
                dry_run: value.dry_run,
            }),
            _ => Err(TransformError::new(
                ErrorCode::Schema,
                "canvas_render requires exactly one spec or plan; spec accepts only quality, while plan requires sampling and outsideFill",
            )),
        }
    }
}

#[derive(Debug, Clone)]
struct WorldbendServer {
    root: Arc<Option<WorkspaceRoot>>,
    render_admissions: Arc<Semaphore>,
    render_slots: Arc<Semaphore>,
    surface: ToolSurface,
    tool_router: ToolRouter<Self>,
}

#[tool_router(router = tool_router)]
impl WorldbendServer {
    #[cfg(test)]
    fn new(root: Option<WorkspaceRoot>) -> Self {
        Self::new_with_surface(root, ToolSurface::Direct)
    }

    fn new_with_surface(root: Option<WorkspaceRoot>, surface: ToolSurface) -> Self {
        let mut tool_router = Self::tool_router();
        set_input_schema::<ComposeInput>(&mut tool_router, "worldbend.compose");
        set_input_schema::<SolveInput>(&mut tool_router, "worldbend.solve");
        set_input_schema::<InspectInput>(&mut tool_router, "worldbend.inspect");
        set_input_schema::<RenderInput>(&mut tool_router, "worldbend.render");
        set_input_schema::<RectifyInput>(&mut tool_router, "worldbend.rectify");
        set_input_schema::<RectifyRenderInput>(&mut tool_router, "worldbend.rectify_render");
        set_canvas_render_input_schema(&mut tool_router);
        set_input_schema::<CssInput>(&mut tool_router, "worldbend.css");
        set_output_schema::<ToolEnvelope<AffineComposition>>(&mut tool_router, "worldbend.compose");
        set_output_schema::<ToolEnvelope<SolveOutput>>(&mut tool_router, "worldbend.solve");
        set_output_schema::<ToolEnvelope<InspectOutput>>(&mut tool_router, "worldbend.inspect");
        set_output_schema::<ToolEnvelope<FileRenderResult>>(&mut tool_router, "worldbend.render");
        set_output_schema::<ToolEnvelope<RectifyPlan>>(&mut tool_router, "worldbend.rectify");
        set_output_schema::<ToolEnvelope<RectifyFileRenderResult>>(
            &mut tool_router,
            "worldbend.rectify_render",
        );
        set_output_schema::<ToolEnvelope<CanvasSetFileRenderResult>>(
            &mut tool_router,
            "worldbend.canvas_render",
        );
        set_output_schema::<ToolEnvelope<worldbend_core::CssTransform>>(
            &mut tool_router,
            "worldbend.css",
        );
        set_input_schema::<SearchInput>(&mut tool_router, "worldbend.search");
        set_input_schema::<DescribeInput>(&mut tool_router, "worldbend.describe");
        set_input_schema::<RunInput>(&mut tool_router, "worldbend.run");
        set_output_schema::<ToolEnvelope<SearchResult>>(&mut tool_router, "worldbend.search");
        set_output_schema::<ToolEnvelope<OperationDescriptor>>(
            &mut tool_router,
            "worldbend.describe",
        );
        set_output_schema::<ToolEnvelope<Value>>(&mut tool_router, "worldbend.run");

        let hidden = match surface {
            ToolSurface::Direct => CATALOG_TOOL_NAMES.as_slice(),
            ToolSurface::Catalog => DIRECT_TOOL_NAMES.as_slice(),
        };
        for name in hidden {
            tool_router.remove_route(name);
        }
        Self {
            root: Arc::new(root),
            render_admissions: Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS)),
            render_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS)),
            surface,
            tool_router,
        }
    }

    /// Search the compact deterministic operation catalog.
    #[tool(
        name = "worldbend.search",
        description = "Search Worldbend operation IDs by deterministic terms. Skip this call when the operation ID is already known.",
        annotations(
            title = "Search Worldbend operations",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn search(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<SearchResult> {
        let result = parse_tool_input::<SearchInput>(Value::Object(arguments))
            .and_then(search_operation_catalog);
        ToolEnvelope::from_result(result)
    }

    /// Return the exact current input and output schemas for one operation.
    #[tool(
        name = "worldbend.describe",
        description = "Return the exact closed input and output schemas for one Worldbend operation. Use only when the schema is not already known.",
        annotations(
            title = "Describe Worldbend operation",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn describe(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<OperationDescriptor> {
        let result = parse_tool_input::<DescribeInput>(Value::Object(arguments))
            .map(|input| describe_operation(input.operation));
        ToolEnvelope::from_result(result)
    }

    /// Execute one known operation through the same closed parser and handler
    /// used by its direct compatibility tool.
    #[tool(
        name = "worldbend.run",
        description = "Run one known Worldbend operation. Arguments are validated against that operation's exact closed schema; use describe only when needed. Assisted assessments never apply transforms implicitly.",
        annotations(
            title = "Run Worldbend operation",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn run(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<Value> {
        let input = match parse_tool_input::<RunInput>(Value::Object(arguments)) {
            Ok(input) => input,
            Err(error) => return ToolEnvelope::from_result(Err(error)),
        };
        let arguments = Parameters(input.arguments);
        match input.operation {
            OperationId::Compose => self.compose(arguments).into_value(),
            OperationId::Solve => self.solve(arguments).into_value(),
            OperationId::Inspect => self.inspect(arguments).into_value(),
            OperationId::Render => self.render(arguments, cancellation).await.into_value(),
            OperationId::MediaInspect => self
                .media_inspect(arguments, cancellation)
                .await
                .into_value(),
            OperationId::PlaneCandidates => self
                .plane_candidates(arguments, cancellation)
                .await
                .into_value(),
            OperationId::PsdSmartObjects => self
                .psd_smart_objects(arguments, cancellation)
                .await
                .into_value(),
            OperationId::MediaRender => self
                .media_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::VectorRender => self
                .vector_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::TiledMediaRender => self
                .tiled_media_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::Rectify => self.rectify(arguments).into_value(),
            OperationId::RectifyRender => self
                .rectify_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::ProgramInspect => self.program_inspect(arguments).into_value(),
            OperationId::ProgramRender => self
                .program_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::TemplateInspect => self.template_inspect(arguments).into_value(),
            OperationId::VariationPlan => self.variation_plan(arguments).into_value(),
            OperationId::VariationRender => self
                .variation_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::CanvasRender => self
                .canvas_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::MockupPlan => self.mockup_plan(arguments).into_value(),
            OperationId::MockupRender => self
                .mockup_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::MockupExtractPlan => self.mockup_extract_plan(arguments).into_value(),
            OperationId::MockupExtractRender => self
                .mockup_extract_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::MeshPlan => self.mesh_plan(arguments).into_value(),
            OperationId::MeshRender => self.mesh_render(arguments, cancellation).await.into_value(),
            OperationId::SurfacePlan => self.surface_plan(arguments).into_value(),
            OperationId::SurfaceRender => self
                .surface_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::RemapPlan => self.remap_plan(arguments).into_value(),
            OperationId::RemapRender => self
                .remap_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::TimelinePlan => self.timeline_plan(arguments).into_value(),
            OperationId::TimelineRender => self
                .timeline_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::MotionPlan => self.motion_plan(arguments).into_value(),
            OperationId::MotionRender => self
                .motion_render(arguments, cancellation)
                .await
                .into_value(),
            OperationId::Css => self.css(arguments).into_value(),
        }
    }

    fn mockup_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<MockupPlan> {
        let result = parse_tool_input::<MockupPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_mockup(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn mockup_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MockupFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<MockupRenderInput>(Value::Object(arguments))
            .and_then(MockupRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "mockup_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_mockup_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Mockup render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_mockup_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn mockup_extract_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<MockupExtractPlan> {
        let result = parse_tool_input::<MockupExtractPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_mockup_extract(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn mockup_extract_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MockupExtractFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<MockupExtractRenderInput>(Value::Object(arguments))
            .and_then(MockupExtractRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "mockup_extract_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_mockup_extract_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "Mockup extraction",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_mockup_extract_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn mesh_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<MeshWarpPlan> {
        let result = parse_tool_input::<MeshPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_mesh_warp(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn mesh_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MeshWarpFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<MeshRenderInput>(Value::Object(arguments))
            .and_then(MeshRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "mesh_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_mesh_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Mesh render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_mesh_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn surface_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<SurfaceDeformationPlan> {
        let result = parse_tool_input::<SurfacePlanInput>(Value::Object(arguments))
            .and_then(|input| plan_surface_deformation(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn surface_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<SurfaceDeformationFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<SurfaceRenderInput>(Value::Object(arguments))
            .and_then(SurfaceRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "surface_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_surface_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Surface Deformation render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_surface_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn remap_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<RemapPlan> {
        let result = parse_tool_input::<RemapPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_remap(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn remap_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<RemapFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<RemapRenderInput>(Value::Object(arguments))
            .and_then(RemapRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "remap_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_remap_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Remap render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_remap_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn timeline_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<TimelinePlan> {
        let result = parse_tool_input::<TimelinePlanInput>(Value::Object(arguments))
            .and_then(|input| plan_timeline(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn timeline_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<TimelineFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<TimelineRenderInput>(Value::Object(arguments))
            .and_then(TimelineRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "timeline_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_timeline_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "Timeline",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_timeline_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn motion_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<MotionPlan> {
        let result = parse_tool_input::<MotionPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_motion(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn motion_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MotionFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<MotionRenderInput>(Value::Object(arguments))
            .and_then(MotionRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "motion_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_motion_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "Motion",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_motion_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    /// Compose semantic transform adjustments over a saved plane without rasterizing.
    #[tool(
        name = "worldbend.compose",
        description = "Compose scale, clockwise rotation, skew, translation, a bounds-relative pivot, source flips, or one bounded Warp preset over a saved TransformSpec without rasterizing. Omit pivot for the default center (0.5,0.5). Returns updated geometry and diagnostics.",
        annotations(
            title = "Compose transform",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn compose(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<AffineComposition> {
        let result = parse_tool_input::<ComposeInput>(Value::Object(arguments))
            .and_then(|input| compose_affine(&input.spec, input.target_size, input.transform));
        ToolEnvelope::from_result(result)
    }

    /// Solve and validate a projective transform from an explicit destination quadrilateral.
    #[tool(
        name = "worldbend.solve",
        description = "Solve and validate an explicit perspective or corner-pin plane. Use instead of manually calculating a homography or CSS matrix3d.",
        annotations(
            title = "Solve projective plane",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn solve(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<SolveOutput> {
        let result = parse_tool_input::<SolveInput>(Value::Object(arguments)).and_then(|input| {
            let spec = TransformSpec {
                schema: worldbend_core::SPEC_SCHEMA.to_owned(),
                version: worldbend_core::SPEC_VERSION.to_owned(),
                destination: input.destination,
                content: input.content,
            };
            solve_spec(&spec, input.target_size)
        });
        ToolEnvelope::from_result(result)
    }

    /// Inspect a saved TransformSpec and report current geometry and numerical diagnostics.
    #[tool(
        name = "worldbend.inspect",
        description = "Inspect and validate a saved TransformSpec, including bounds, reprojection, invertibility, and horizon safety.",
        annotations(
            title = "Inspect projective plane",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn inspect(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<InspectOutput> {
        let result = parse_tool_input::<InspectInput>(Value::Object(arguments))
            .and_then(|input| inspect_spec(&input.spec, input.target_size));
        ToolEnvelope::from_result(result)
    }

    /// Render a local raster through a saved plane using a bounded isolated worker.
    #[tool(
        name = "worldbend.render",
        description = "Render or replace a PNG, JPEG, or WebP source through a TransformSpec. Paths stay inside the granted workspace. dryRun performs the full solve, rasterization, and PNG encode but does not publish.",
        annotations(
            title = "Render projective raster",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<FileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<RenderInput>(Value::Object(arguments))
            .and_then(RenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Transform render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_render_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn media_inspect(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MediaSourceInfo> {
        let started = Instant::now();
        let input = parse_tool_input::<MediaInspectInput>(Value::Object(arguments))
            .and_then(MediaInspectRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "media_inspect requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_media_inspect_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        execute_bounded_render(
                            "media inspection",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_media_inspect_worker(prepared),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn media_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<MediaFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<MediaRenderInput>(Value::Object(arguments))
            .and_then(MediaRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "media_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_media_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "media render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_media_render_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn plane_candidates(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<PlaneCandidateResponse> {
        let started = Instant::now();
        let input = parse_tool_input::<PlaneCandidatesInput>(Value::Object(arguments))
            .and_then(PlaneCandidatesRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "plane_candidates requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_plane_candidates_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "perception capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        execute_bounded_render(
                            "plane candidate assessment",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_plane_candidates_worker(prepared),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn psd_smart_objects(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<PsdSmartObjectResponse> {
        let started = Instant::now();
        let input = parse_tool_input::<PsdSmartObjectsInput>(Value::Object(arguments))
            .map(PsdSmartObjectsRequest::from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "psd_smart_objects requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_psd_smart_objects_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "interoperability capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        execute_bounded_render(
                            "PSD Smart Object interoperability",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_psd_smart_objects_worker(prepared),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn vector_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<VectorFileResult> {
        let started = Instant::now();
        let input = parse_tool_input::<VectorRenderInput>(Value::Object(arguments))
            .and_then(VectorRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "vector_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_vector_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "vector render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_vector_render_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    async fn tiled_media_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<TiledMediaRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<TiledMediaRenderInput>(Value::Object(arguments))
            .and_then(TiledMediaRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "tiled_media_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_tiled_media_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "tiled media output",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_tiled_media_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    /// Solve an explicit source-plane quadrilateral into a declared output rectangle.
    #[tool(
        name = "worldbend.rectify",
        description = "Validate and solve one explicit source quadrilateral into an explicit integer output rectangle. This deterministic operation does not detect a plane, infer aspect ratio, inspect pixels, or estimate a camera.",
        annotations(
            title = "Plan plane rectification",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn rectify(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<RectifyPlan> {
        let result = parse_tool_input::<RectifyInput>(Value::Object(arguments))
            .and_then(|input| rectify_plane(&input.spec));
        ToolEnvelope::from_result(result)
    }

    /// Render an explicitly selected source plane through a bounded isolated worker.
    #[tool(
        name = "worldbend.rectify_render",
        description = "Flatten one caller-specified source quadrilateral into its declared PNG output rectangle. Paths stay inside the granted workspace; no plane detection, aspect inference, or camera estimation is performed. dryRun renders and encodes without publishing.",
        annotations(
            title = "Render plane rectification",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn rectify_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<RectifyFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<RectifyRenderInput>(Value::Object(arguments))
            .and_then(RectifyRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "rectify_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_rectify_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Rectification render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_rectify_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn program_inspect(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<RasterProgramInspection> {
        let result = parse_tool_input::<ProgramInspectInput>(Value::Object(arguments))
            .and_then(|input| inspect_raster_program(&input.spec));
        ToolEnvelope::from_result(result)
    }

    async fn program_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<RasterProgramFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<ProgramRenderInput>(Value::Object(arguments))
            .and_then(ProgramRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "program_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_program_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_render(
                            "Raster Program render",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            run_program_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    fn template_inspect(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<SpatialTemplateInspection> {
        let result = parse_tool_input::<TemplateInspectInput>(Value::Object(arguments))
            .and_then(|input| inspect_spatial_template(&input.spec));
        ToolEnvelope::from_result(result)
    }

    fn variation_plan(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<VariationJobPlan> {
        let result = parse_tool_input::<VariationPlanInput>(Value::Object(arguments))
            .and_then(|input| plan_variation_job(&input.spec))
            .and_then(|plan| {
                if plan.output_count > MCP_MAX_VARIATION_OUTPUTS {
                    return Err(TransformError::new(
                        ErrorCode::OutputLimit,
                        "Variation Job output count exceeds the Agent response ceiling",
                    )
                    .with_details(json!({
                        "outputCount": plan.output_count,
                        "maximum": MCP_MAX_VARIATION_OUTPUTS,
                    })));
                }
                Ok(plan)
            });
        ToolEnvelope::from_result(result)
    }

    async fn variation_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<VariationJobFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<VariationRenderInput>(Value::Object(arguments))
            .and_then(VariationRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "variation_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_variation_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "Variation Job",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_variation_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    /// Render one ordered Canvas Set atomically through a bounded isolated worker.
    #[tool(
        name = "worldbend.canvas_render",
        description = "Render one source into an ordered Canvas Set from either an explicit spec or a resolved plan. Every variant reads the original source. The new output directory is committed atomically; dryRun fully renders and hashes without publishing. Plan replay requires explicit sampling and outside fill.",
        annotations(
            title = "Render Canvas Set",
            read_only_hint = false,
            destructive_hint = false,
            idempotent_hint = false,
            open_world_hint = false
        )
    )]
    async fn canvas_render(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
        cancellation: CancellationToken,
    ) -> ToolEnvelope<CanvasSetFileRenderResult> {
        let started = Instant::now();
        let input = parse_tool_input::<CanvasRenderInput>(Value::Object(arguments))
            .and_then(CanvasRenderRequest::try_from);
        let result = match (self.root.as_ref(), input) {
            (_, Err(error)) => Err(error),
            (None, Ok(_)) => Err(TransformError::new(
                ErrorCode::PathOutsideRoot,
                "canvas_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT",
            )),
            (Some(root), Ok(input)) => match prepare_canvas_render_request(root, input) {
                Err(error) => Err(error),
                Ok(prepared) => match self.render_admissions.clone().try_acquire_owned() {
                    Err(_) => Err(TransformError::new(
                        ErrorCode::Capacity,
                        "render capacity is full; retry after current work completes",
                    )
                    .with_details(json!({
                        "retryable": true,
                        "maximumInFlight": MAX_IN_FLIGHT_RENDERS,
                        "maximumConcurrent": MAX_CONCURRENT_RENDERS
                    }))),
                    Ok(admission) => {
                        let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                        let work_cancellation = cancellation.child_token();
                        execute_bounded_directory(
                            "Canvas Set",
                            admission,
                            self.render_slots.clone(),
                            remaining,
                            cancellation,
                            work_cancellation.clone(),
                            run_canvas_worker(prepared, work_cancellation),
                        )
                        .await
                    }
                },
            },
        };
        ToolEnvelope::from_result(result)
    }

    /// Emit CSS matrix3d values for a live image, video, iframe, canvas, or DOM element.
    #[tool(
        name = "worldbend.css",
        description = "Emit CSS matrix3d for a TransformSpec plane. Supply destinationSize for normalized specs. Non-zero Warp requires raster or WebGL output.",
        annotations(
            title = "Emit projective CSS",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    fn css(
        &self,
        Parameters(arguments): Parameters<Map<String, Value>>,
    ) -> ToolEnvelope<worldbend_core::CssTransform> {
        let result = parse_tool_input::<CssInput>(Value::Object(arguments)).and_then(|input| {
            emit_css_transform(&input.spec, input.element_size, input.destination_size)
        });
        ToolEnvelope::from_result(result)
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for WorldbendServer {
    async fn call_tool(
        &self,
        request: rmcp::model::CallToolRequestParams,
        context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<CallToolResponse, rmcp::ErrorData> {
        let tcc = rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
        guard_tool_call(self.tool_router.call(tcc)).await
    }

    fn get_info(&self) -> ServerInfo {
        let instructions = match self.surface {
            ToolSurface::Direct => {
                "Use one direct Worldbend tool for semantic transform composition, explicit destination geometry, explicit source-plane rectification, ordered Canvas Set rendering, bounded common Warp presets, inspection, render, or CSS. Canvas operations and variants are caller-chosen; Worldbend does not choose crops or infer content. Rectification requires caller-supplied source corners and output dimensions. Plane detection, aspect inference, and custom mesh warp are not provided. Corner order is always TL, TR, BR, BL."
            }
            ToolSurface::Catalog => {
                "Call worldbend.run directly when the operation ID and arguments are known. Use worldbend.search only to find an unfamiliar operation and worldbend.describe only to fetch its exact closed schema. Worldbend executes caller-supplied deterministic geometry and Canvas programs; it does not choose crops, detect planes, infer dimensions, or plan creative work. Corner order is always TL, TR, BR, BL."
            }
        };
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("worldbend", env!("CARGO_PKG_VERSION")))
            .with_instructions(instructions)
    }
}

/// Run one admitted render while honoring queue fairness, the whole-call
/// deadline, and client cancellation. The admission permit is dropped with the
/// future on every exit path; the worker permit and its process (via
/// `kill_on_drop`) and staging directory follow the same drop.
async fn execute_bounded_render<T, F>(
    operation: &'static str,
    admission: OwnedSemaphorePermit,
    slots: Arc<Semaphore>,
    deadline_remaining: Duration,
    cancellation: CancellationToken,
    work: F,
) -> TransformResult<T>
where
    T: Send,
    F: Future<Output = TransformResult<T>> + Send,
{
    tokio::select! {
        _ = cancellation.cancelled() => Err(TransformError::new(
            ErrorCode::Cancelled,
            format!("{operation} was cancelled by the client before completion"),
        )),
        outcome = timeout(deadline_remaining, async move {
            let _admission = admission;
            let _permit = slots.acquire_owned().await.map_err(|_| {
                TransformError::new(
                    ErrorCode::Internal,
                    "render concurrency gate is unavailable",
                )
            })?;
            work.await
        }) => match outcome {
            Ok(inner) => inner,
            Err(_) => Err(render_timeout_error(
                &format!("queued for or executing {operation}"),
                deadline_remaining,
            )),
        },
    }
}

/// Keep one atomic-directory admission and execution slot through the commit
/// point. All cancellable/timeout-bound work, including same-parent staging,
/// completes first. The final token/deadline check is followed by exactly one
/// synchronous no-replace directory rename and no await.
async fn execute_bounded_directory<T, F>(
    operation: &'static str,
    admission: OwnedSemaphorePermit,
    slots: Arc<Semaphore>,
    deadline_remaining: Duration,
    cancellation: CancellationToken,
    work_cancellation: CancellationToken,
    work: F,
) -> TransformResult<T>
where
    T: Send,
    F: Future<Output = TransformResult<PreparedDirectoryResult<T>>> + Send,
{
    let started = Instant::now();
    let _admission = admission;
    let slot_remaining = deadline_remaining.saturating_sub(started.elapsed());
    let _slot = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "atomic directory render was cancelled by the client before completion",
        )),
        outcome = timeout(slot_remaining, slots.acquire_owned()) => match outcome {
            Ok(Ok(permit)) => permit,
            Ok(Err(_)) => return Err(TransformError::new(
                ErrorCode::Internal,
                "render concurrency gate is unavailable",
            )),
            Err(_) => return Err(render_timeout_error(
                "queued for an atomic directory execution slot",
                deadline_remaining,
            )),
        }
    };

    let work_remaining = deadline_remaining.saturating_sub(started.elapsed());
    tokio::pin!(work);
    let mut prepared = tokio::select! {
        _ = cancellation.cancelled() => {
            // The work future may currently own a running spawn_blocking copy.
            // Signal its chunked copier, then await the future so cleanup is
            // complete instead of detaching a hidden same-parent directory.
            work_cancellation.cancel();
            let _ = work.await;
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "atomic directory render was cancelled by the client before completion",
            ));
        },
        _ = tokio::time::sleep(work_remaining) => {
            work_cancellation.cancel();
            let _ = work.await;
            return Err(render_timeout_error(
                &format!("executing {operation}"),
                deadline_remaining,
            ));
        },
        result = &mut work => result?,
    };

    if cancellation.is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "atomic directory render was cancelled by the client before commit",
        ));
    }
    if started.elapsed() >= deadline_remaining {
        return Err(render_timeout_error(
            &format!("preflighting the {operation} commit"),
            deadline_remaining,
        ));
    }
    if let Some(commit) = prepared.commit.take() {
        commit.commit()?;
    }
    Ok(prepared.result)
}

fn render_timeout_error(stage: &str, deadline: Duration) -> TransformError {
    TransformError::new(
        ErrorCode::Timeout,
        format!(
            "render exceeded its {} ms whole-call deadline while {stage}; reduce target dimensions, sampling quality, or Canvas variant count before retrying",
            deadline.as_millis()
        ),
    )
    .with_details(json!({
        "deadlineMs": u64::try_from(deadline.as_millis()).unwrap_or(u64::MAX),
        "stage": stage,
        "retryableAfterReducingWork": true
    }))
}

/// Classify the observable worker exit rather than turning every missing
/// envelope into E_MEMORY. A protocol failure or ordinary crash is internal;
/// only the signals/messages tied to an enforced resource ceiling use the
/// timeout or memory contracts.
fn classify_worker_death(status: &ExitStatus, stderr: &str) -> (ErrorCode, &'static str) {
    classify_worker_failure(status.success(), worker_exit_signal(status), stderr)
}

fn classify_worker_failure(
    success: bool,
    signal: Option<i32>,
    stderr: &str,
) -> (ErrorCode, &'static str) {
    #[cfg(not(unix))]
    let _ = signal;
    if stderr.contains("panicked at") {
        return (
            ErrorCode::Internal,
            "render worker panicked before returning a structured result",
        );
    }
    #[cfg(unix)]
    if signal == Some(libc::SIGXCPU) {
        return (
            ErrorCode::Timeout,
            "render worker exhausted its CPU-time ceiling",
        );
    }
    let memory_message = stderr.contains("memory allocation")
        || stderr.to_ascii_lowercase().contains("out of memory");
    #[cfg(unix)]
    let resource_kill = signal == Some(libc::SIGKILL);
    #[cfg(not(unix))]
    let resource_kill = false;
    if memory_message || resource_kill {
        return (
            ErrorCode::Memory,
            "render worker terminated under its resource ceiling",
        );
    }
    if success {
        return (
            ErrorCode::Internal,
            "render worker exited successfully without returning a structured result",
        );
    }
    (
        ErrorCode::Internal,
        "render worker exited without returning a structured result",
    )
}

#[cfg(unix)]
fn worker_exit_signal(status: &ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn worker_exit_signal(_status: &ExitStatus) -> Option<i32> {
    None
}

/// A panic inside a tool handler must surface as a bounded structured
/// `E_INTERNAL` result instead of silently dropping the request.
async fn guard_tool_call<F>(future: F) -> Result<CallToolResponse, rmcp::ErrorData>
where
    F: Future<Output = Result<CallToolResponse, rmcp::ErrorData>>,
{
    match futures::FutureExt::catch_unwind(std::panic::AssertUnwindSafe(future)).await {
        Ok(result) => result,
        Err(_) => {
            let envelope: ToolEnvelope<FileRenderResult> = ToolEnvelope::Failure {
                ok: false,
                error: TransformError::new(
                    ErrorCode::Internal,
                    "tool handler panicked while processing the request",
                ),
            };
            envelope.into_call_tool_result()
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkerMockupSource {
    id: String,
    source: PathBuf,
    source_sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkerVariationAsset {
    id: String,
    source: PathBuf,
    source_sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct WorkerRemapMap {
    path: PathBuf,
    sha256: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase")]
enum WorkerRequest {
    Transform {
        source: PathBuf,
        source_sha256: String,
        spec: TransformSpec,
        output: PathBuf,
        options: RenderOptions,
    },
    MediaInspect {
        source: PathBuf,
        limits: RenderLimits,
    },
    PlaneCandidates {
        source: PathBuf,
        request: PlaneCandidateRequest,
    },
    PsdSmartObjects {
        source: PathBuf,
        request: PsdSmartObjectRequest,
    },
    Media {
        source: PathBuf,
        spec: TransformSpec,
        output: PathBuf,
        options: MediaRenderOptions,
    },
    Vector {
        source: PathBuf,
        spec: TransformSpec,
        output: PathBuf,
        options: VectorRenderOptions,
    },
    TiledMedia {
        source: PathBuf,
        spec: TransformSpec,
        output_directory: PathBuf,
        options: TiledMediaRenderOptions,
    },
    Rectify {
        source: PathBuf,
        source_sha256: String,
        spec: RectifySpec,
        output: PathBuf,
        options: RectifyRenderOptions,
    },
    RasterProgram {
        source: PathBuf,
        source_sha256: String,
        spec: RasterProgramSpec,
        output: PathBuf,
        options: RasterProgramRenderOptions,
    },
    VariationJob {
        assets: Vec<WorkerVariationAsset>,
        spec: VariationJobSpec,
        output_directory: PathBuf,
        options: VariationJobRenderOptions,
    },
    CanvasSet {
        source: PathBuf,
        program: CanvasWorkerProgram,
        output_directory: PathBuf,
        options: CanvasSetRenderOptions,
    },
    Mockup {
        sources: Vec<WorkerMockupSource>,
        spec: MockupSpec,
        output: PathBuf,
        options: MockupRenderOptions,
    },
    MockupExtract {
        source: PathBuf,
        source_sha256: String,
        spec: MockupExtractSpec,
        output_directory: PathBuf,
        options: MockupExtractRenderOptions,
    },
    Mesh {
        source: PathBuf,
        source_sha256: String,
        spec: MeshWarpSpec,
        output: PathBuf,
        options: MeshWarpRenderOptions,
    },
    Surface {
        source: PathBuf,
        source_sha256: String,
        spec: SurfaceDeformationSpec,
        output: PathBuf,
        options: MeshWarpRenderOptions,
    },
    Remap {
        source: PathBuf,
        source_sha256: String,
        map: Option<WorkerRemapMap>,
        spec: RemapSpec,
        output: PathBuf,
        options: RemapRenderOptions,
    },
    Timeline {
        sources: Vec<WorkerMockupSource>,
        spec: TimelineSpec,
        output_directory: PathBuf,
        options: TimelineRenderOptions,
    },
    Motion {
        sources: Vec<WorkerMockupSource>,
        spec: MotionSpec,
        output_directory: PathBuf,
        options: TimelineRenderOptions,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum WorkerEnvelope<T> {
    Success { ok: bool, result: Box<T> },
    Failure { ok: bool, error: TransformError },
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();
    if args.worker_render {
        run_worker_process();
        return Ok(());
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run_server(args))
}

async fn run_server(args: Args) -> anyhow::Result<()> {
    let root = args
        .root
        .or_else(|| std::env::var_os("WORLDBEND_WORKSPACE_ROOT").map(PathBuf::from))
        .as_deref()
        .map(WorkspaceRoot::open_with_canonical_path)
        .transpose()?;
    let configured_staging_root =
        std::env::var_os("WORLDBEND_PRIVATE_STAGING_ROOT").map(PathBuf::from);
    let private_staging_root = resolve_private_staging_root(
        configured_staging_root.as_deref(),
        root.as_ref().map(|(_, path)| path.as_path()),
    )?;
    PRIVATE_STAGING_ROOT
        .set(private_staging_root)
        .map_err(|_| anyhow::anyhow!("private staging root was already initialized"))?;
    let root = root.map(|(workspace, _)| workspace);
    let service = WorldbendServer::new_with_surface(root, args.surface)
        .serve(stdio())
        .await?;
    service.waiting().await?;
    Ok(())
}

fn resolve_private_staging_root(
    configured: Option<&Path>,
    workspace_root: Option<&Path>,
) -> anyhow::Result<PathBuf> {
    let candidate = configured
        .map(Path::to_path_buf)
        .unwrap_or_else(std::env::temp_dir);
    if !candidate.is_absolute() {
        anyhow::bail!("WORLDBEND_PRIVATE_STAGING_ROOT must be an absolute path");
    }
    let canonical = fs::canonicalize(&candidate).map_err(|error| {
        anyhow::anyhow!("WORLDBEND_PRIVATE_STAGING_ROOT is not accessible: {error}")
    })?;
    if !fs::metadata(&canonical)?.is_dir() {
        anyhow::bail!("WORLDBEND_PRIVATE_STAGING_ROOT must resolve to a directory");
    }
    if workspace_root.is_some_and(|root| canonical.starts_with(root)) {
        anyhow::bail!("WORLDBEND_PRIVATE_STAGING_ROOT must be outside the granted workspace root");
    }
    tempfile::Builder::new()
        .prefix(".worldbend-private-root-check-")
        .tempdir_in(&canonical)
        .map_err(|error| {
            anyhow::anyhow!("WORLDBEND_PRIVATE_STAGING_ROOT is not writable: {error}")
        })?;
    Ok(canonical)
}

fn create_private_staging(
    prefix: &str,
    error_message: &'static str,
) -> TransformResult<tempfile::TempDir> {
    let root = PRIVATE_STAGING_ROOT.get().ok_or_else(|| {
        TransformError::new(
            ErrorCode::Internal,
            "private staging root was not initialized",
        )
    })?;
    tempfile::Builder::new()
        .prefix(prefix)
        .tempdir_in(root)
        .map_err(|error| {
            TransformError::new(ErrorCode::Render, error_message)
                .with_details(json!({ "reason": error.to_string() }))
        })
}

fn run_worker_process() {
    let mut bytes = Vec::new();
    let result =
        apply_worker_self_limits(WORKER_MEMORY_BYTES, WORKER_TIMEOUT, worker_render_threads())
            .and_then(|_| {
                std::io::stdin()
                    .take((MAX_WORKER_REQUEST_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|error| TransformError::new(ErrorCode::Internal, error.to_string()))
            })
            .and_then(|_| {
                if bytes.len() > MAX_WORKER_REQUEST_BYTES {
                    return Err(TransformError::new(
                        ErrorCode::OutputLimit,
                        "worker request exceeds byte limit",
                    ));
                }
                serde_json::from_slice::<WorkerRequest>(&bytes).map_err(|error| {
                    TransformError::new(
                        ErrorCode::Schema,
                        format!("invalid worker request: {error}"),
                    )
                })
            });
    match result {
        Ok(WorkerRequest::Transform {
            source,
            source_sha256,
            spec,
            output,
            options,
        }) => write_worker_result(render_file_with_source_sha256(
            &source,
            &source_sha256,
            &spec,
            &output,
            options,
            true,
            false,
        )),
        Ok(WorkerRequest::MediaInspect { source, limits }) => {
            write_worker_result(inspect_media_file(&source, limits))
        }
        Ok(WorkerRequest::PlaneCandidates { source, request }) => {
            write_worker_result(analyze_plane_candidates_file(&source, &request))
        }
        Ok(WorkerRequest::PsdSmartObjects { source, request }) => {
            let result = fs::File::open(&source)
                .map_err(|error| {
                    TransformError::new(ErrorCode::Render, "failed to open staged PSD/PSB source")
                        .with_details(json!({ "reason": error.to_string() }))
                })
                .and_then(|file| read_bounded_worker_source(file, MAX_PSD_SOURCE_BYTES))
                .and_then(|bytes| execute_psd_smart_object_request(&bytes, &request));
            write_worker_result(result);
        }
        Ok(WorkerRequest::Media {
            source,
            spec,
            output,
            options,
        }) => write_worker_result(render_media_file(
            &source, &spec, &output, options, true, false,
        )),
        Ok(WorkerRequest::Vector {
            source,
            spec,
            output,
            options,
        }) => write_worker_result(render_vector_file(
            &source, &spec, &output, options, true, false,
        )),
        Ok(WorkerRequest::TiledMedia {
            source,
            spec,
            output_directory,
            options,
        }) => write_worker_result(render_tiled_media_directory(
            &source,
            &spec,
            &output_directory,
            options,
            false,
        )),
        Ok(WorkerRequest::Rectify {
            source,
            source_sha256,
            spec,
            output,
            options,
        }) => write_worker_result(rectify_file_with_source_sha256(
            &source,
            &source_sha256,
            &spec,
            &output,
            options,
            true,
            false,
        )),
        Ok(WorkerRequest::RasterProgram {
            source,
            source_sha256,
            spec,
            output,
            options,
        }) => write_worker_result(render_raster_program_file_with_source_sha256(
            &source,
            &source_sha256,
            &spec,
            &output,
            options,
            true,
            false,
        )),
        Ok(WorkerRequest::VariationJob {
            assets,
            spec,
            output_directory,
            options,
        }) => {
            let assets = assets
                .into_iter()
                .map(|asset| {
                    (
                        asset.id,
                        VariationFileAsset {
                            path: asset.source,
                            source_sha256: Some(asset.source_sha256),
                        },
                    )
                })
                .collect();
            write_worker_result(render_variation_job_files_with_cancel(
                &assets,
                &spec,
                &output_directory,
                options,
                false,
                &|| false,
            ));
        }
        Ok(WorkerRequest::CanvasSet {
            source,
            program,
            output_directory,
            options,
        }) => write_worker_result(run_canvas_set_worker_process(
            &source,
            program,
            &output_directory,
            options,
        )),
        Ok(WorkerRequest::Mockup {
            sources,
            spec,
            output,
            options,
        }) => {
            let sources = sources
                .into_iter()
                .map(|source| {
                    (
                        source.id,
                        MockupFileSource {
                            path: source.source,
                            source_sha256: Some(source.source_sha256),
                        },
                    )
                })
                .collect();
            write_worker_result(render_mockup_files_with_cancel(
                &sources,
                &spec,
                &output,
                options,
                true,
                false,
                &|| false,
            ));
        }
        Ok(WorkerRequest::MockupExtract {
            source,
            source_sha256,
            spec,
            output_directory,
            options,
        }) => write_worker_result(render_mockup_extract_files_with_cancel(
            &source,
            Some(&source_sha256),
            &spec,
            &output_directory,
            options,
            false,
            &|| false,
        )),
        Ok(WorkerRequest::Mesh {
            source,
            source_sha256,
            spec,
            output,
            options,
        }) => write_worker_result(render_mesh_warp_file_with_cancel(
            &source,
            Some(&source_sha256),
            &spec,
            &output,
            options,
            true,
            false,
            &|| false,
        )),
        Ok(WorkerRequest::Surface {
            source,
            source_sha256,
            spec,
            output,
            options,
        }) => write_worker_result(render_surface_deformation_file_with_cancel(
            &source,
            Some(&source_sha256),
            &spec,
            &output,
            options,
            true,
            false,
            &|| false,
        )),
        Ok(WorkerRequest::Remap {
            source,
            source_sha256,
            map,
            spec,
            output,
            options,
        }) => {
            let map = map.map(|map| RemapFileMap {
                path: map.path,
                sha256: Some(map.sha256),
            });
            write_worker_result(render_remap_file_with_cancel(
                &source,
                Some(&source_sha256),
                map.as_ref(),
                &spec,
                &output,
                options,
                true,
                false,
                &|| false,
            ));
        }
        Ok(WorkerRequest::Timeline {
            sources,
            spec,
            output_directory,
            options,
        }) => {
            let sources = sources
                .into_iter()
                .map(|source| {
                    (
                        source.id,
                        TimelineFileSource {
                            path: source.source,
                            source_sha256: Some(source.source_sha256),
                        },
                    )
                })
                .collect();
            write_worker_result(render_timeline_files_with_cancel(
                &sources,
                &spec,
                &output_directory,
                options,
                false,
                &|| false,
            ));
        }
        Ok(WorkerRequest::Motion {
            sources,
            spec,
            output_directory,
            options,
        }) => {
            let sources = sources
                .into_iter()
                .map(|source| {
                    (
                        source.id,
                        TimelineFileSource {
                            path: source.source,
                            source_sha256: Some(source.source_sha256),
                        },
                    )
                })
                .collect();
            write_worker_result(render_motion_files_with_cancel(
                &sources,
                &spec,
                &output_directory,
                options,
                false,
                &|| false,
            ));
        }
        Err(error) => write_worker_result::<FileRenderResult>(Err(error)),
    }
}

fn read_bounded_worker_source(file: fs::File, maximum: usize) -> TransformResult<Vec<u8>> {
    let mut bytes = Vec::new();
    file.take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            TransformError::new(ErrorCode::Render, "failed to read staged PSD/PSB source")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
    if bytes.len() > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "PSD/PSB source exceeds the Agent byte ceiling",
        ));
    }
    Ok(bytes)
}

fn run_canvas_set_worker_process(
    source: &std::path::Path,
    program: CanvasWorkerProgram,
    output_directory: &std::path::Path,
    options: CanvasSetRenderOptions,
) -> TransformResult<CanvasSetFileRenderResult> {
    match program {
        CanvasWorkerProgram::Spec { spec, quality } => {
            let options = CanvasSetRenderOptions { quality, ..options };
            render_canvas_set_file(
                source,
                CanvasSetProgram::Spec(&spec),
                output_directory,
                options,
                false,
            )
        }
        CanvasWorkerProgram::Plan {
            plan,
            sampling,
            outside_fill,
        } => render_canvas_set_file(
            source,
            CanvasSetProgram::Plan {
                plan: &plan,
                replay: CanvasReplayOptions {
                    sampling,
                    outside_fill: canvas_background_rgba(outside_fill),
                },
            },
            output_directory,
            options,
            false,
        ),
    }
}

fn canvas_background_rgba(background: CanvasBackground) -> [u8; 4] {
    match background {
        CanvasBackground::Transparent {} => [0, 0, 0, 0],
        CanvasBackground::Color { rgba, .. } => rgba,
    }
}

fn write_worker_result<T: Serialize>(result: TransformResult<T>) {
    let envelope = match result {
        Ok(result) => WorkerEnvelope::Success {
            ok: true,
            result: Box::new(result),
        },
        Err(error) => WorkerEnvelope::Failure { ok: false, error },
    };
    if let Ok(serialized) = serde_json::to_vec(&envelope) {
        let _ = std::io::stdout().write_all(&serialized);
    }
}

fn prepare_render_request(
    root: &WorkspaceRoot,
    request: RenderRequest,
) -> TransformResult<PreparedRenderRequest> {
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_media_inspect_request(
    root: &WorkspaceRoot,
    request: MediaInspectRequest,
) -> TransformResult<PreparedMediaInspectRequest> {
    let source = root.open_source(&request.source)?;
    Ok(PreparedMediaInspectRequest { source, request })
}

fn prepare_plane_candidates_request(
    root: &WorkspaceRoot,
    request: PlaneCandidatesRequest,
) -> TransformResult<PreparedPlaneCandidatesRequest> {
    let source = root.open_source(&request.source)?;
    Ok(PreparedPlaneCandidatesRequest { source, request })
}

fn prepare_psd_smart_objects_request(
    root: &WorkspaceRoot,
    request: PsdSmartObjectsRequest,
) -> TransformResult<PreparedPsdSmartObjectsRequest> {
    let source = root.open_source(&request.source)?;
    Ok(PreparedPsdSmartObjectsRequest { source, request })
}

fn prepare_media_render_request(
    root: &WorkspaceRoot,
    request: MediaRenderRequest,
) -> TransformResult<PreparedMediaRenderRequest> {
    validate_media_output_extension(&request.output, &request.options.output)?;
    let source = root.open_source(&request.source)?;
    let output = root.prepare_file_output(&request.output, request.overwrite)?;
    Ok(PreparedMediaRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_vector_render_request(
    root: &WorkspaceRoot,
    request: VectorRenderRequest,
) -> TransformResult<PreparedVectorRenderRequest> {
    validate_vector_output_extension(&request.output, request.options.carrier)?;
    let source = root.open_source(&request.source)?;
    let output = root.prepare_file_output(&request.output, request.overwrite)?;
    Ok(PreparedVectorRenderRequest {
        source,
        output,
        request,
    })
}

fn validate_media_output_extension(output: &str, format: &MediaOutput) -> TransformResult<()> {
    let extension = Path::new(output)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let valid = extension
        .as_deref()
        .is_some_and(|extension| media_output_accepts_extension(format, extension));
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "media output extension must match the requested format",
        ));
    }
    Ok(())
}

fn validate_vector_output_extension(output: &str, carrier: VectorCarrier) -> TransformResult<()> {
    let extension = Path::new(output)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let valid = matches!(
        (carrier, extension.as_deref()),
        (VectorCarrier::Svg, Some("svg")) | (VectorCarrier::Html, Some("html" | "htm"))
    );
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "vector output extension must match the requested carrier",
        ));
    }
    Ok(())
}

fn prepare_tiled_media_render_request(
    root: &WorkspaceRoot,
    request: TiledMediaRenderRequest,
) -> TransformResult<PreparedTiledMediaRenderRequest> {
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedTiledMediaRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_rectify_render_request(
    root: &WorkspaceRoot,
    request: RectifyRenderRequest,
) -> TransformResult<PreparedRectifyRenderRequest> {
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedRectifyRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_program_render_request(
    root: &WorkspaceRoot,
    request: ProgramRenderRequest,
) -> TransformResult<PreparedProgramRenderRequest> {
    inspect_raster_program(&request.spec)?;
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedProgramRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_variation_render_request(
    root: &WorkspaceRoot,
    request: VariationRenderRequest,
) -> TransformResult<PreparedVariationRenderRequest> {
    let plan = plan_variation_job(&request.spec)?;
    if plan.output_count > MCP_MAX_VARIATION_OUTPUTS {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Variation Job output count exceeds the Agent response ceiling",
        ));
    }
    let required = plan.asset_ids.iter().collect::<HashSet<_>>();
    let provided = request
        .assets
        .iter()
        .map(|asset| &asset.id)
        .collect::<HashSet<_>>();
    if required != provided {
        let mut required = required.into_iter().cloned().collect::<Vec<_>>();
        let mut provided = provided.into_iter().cloned().collect::<Vec<_>>();
        required.sort_unstable();
        provided.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Variation Job assets must exactly match the planned assetId values",
        )
        .with_details(json!({ "required": required, "provided": provided })));
    }
    let assets = request
        .assets
        .iter()
        .map(|asset| {
            root.open_source(&asset.source)
                .map(|file| (asset.id.clone(), file))
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedVariationRenderRequest {
        assets,
        output,
        request,
    })
}

fn prepare_mockup_render_request(
    root: &WorkspaceRoot,
    request: MockupRenderRequest,
) -> TransformResult<PreparedMockupRenderRequest> {
    let plan = plan_mockup(&request.spec)?;
    let required = plan
        .planes
        .iter()
        .map(|plane| plane.source_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let provided = request
        .sources
        .iter()
        .map(|source| source.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    if required != provided {
        let mut required = required.into_iter().collect::<Vec<_>>();
        let mut provided = provided.into_iter().collect::<Vec<_>>();
        required.sort_unstable();
        provided.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup sources must exactly match the distinct sourceId values",
        )
        .with_details(json!({ "required": required, "provided": provided })));
    }
    let sources = request
        .sources
        .iter()
        .map(|source| {
            root.open_source(&source.source)
                .map(|file| (source.id.clone(), file))
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedMockupRenderRequest {
        sources,
        output,
        request,
    })
}

fn prepare_mockup_extract_render_request(
    root: &WorkspaceRoot,
    request: MockupExtractRenderRequest,
) -> TransformResult<PreparedMockupExtractRenderRequest> {
    let plan = plan_mockup_extract(&request.spec)?;
    if plan.cumulative_output_pixels > request.options.max_cumulative_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup extraction exceeds the configured cumulative output pixel limit",
        )
        .with_details(json!({
            "pixels": plan.cumulative_output_pixels,
            "maximum": request.options.max_cumulative_pixels,
        })));
    }
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedMockupExtractRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_mesh_render_request(
    root: &WorkspaceRoot,
    request: MeshRenderRequest,
) -> TransformResult<PreparedMeshRenderRequest> {
    plan_mesh_warp(&request.spec)?;
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedMeshRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_surface_render_request(
    root: &WorkspaceRoot,
    request: SurfaceRenderRequest,
) -> TransformResult<PreparedSurfaceRenderRequest> {
    plan_surface_deformation(&request.spec)?;
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedSurfaceRenderRequest {
        source,
        output,
        request,
    })
}

fn prepare_remap_render_request(
    root: &WorkspaceRoot,
    request: RemapRenderRequest,
) -> TransformResult<PreparedRemapRenderRequest> {
    let plan = plan_remap(&request.spec)?;
    if plan.requires_map != request.map.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            if plan.requires_map {
                "displacement remap requires exactly one map raster"
            } else {
                "lens remap must not include a map raster"
            },
        ));
    }
    let source = root.open_source(&request.source)?;
    let map = request
        .map
        .as_deref()
        .map(|path| root.open_source(path))
        .transpose()?;
    let output = root.prepare_output(&request.output, request.overwrite)?;
    Ok(PreparedRemapRenderRequest {
        source,
        map,
        output,
        request,
    })
}

fn prepare_timeline_render_request(
    root: &WorkspaceRoot,
    request: TimelineRenderRequest,
) -> TransformResult<PreparedTimelineRenderRequest> {
    let plan = plan_timeline(&request.spec)?;
    if plan.cumulative_output_pixels > request.options.max_cumulative_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "timeline exceeds the configured cumulative output pixel limit",
        ));
    }
    let required = plan
        .source_ids
        .iter()
        .collect::<std::collections::HashSet<_>>();
    let provided = request
        .sources
        .iter()
        .map(|source| &source.id)
        .collect::<std::collections::HashSet<_>>();
    if required != provided {
        let mut required = required.into_iter().cloned().collect::<Vec<_>>();
        let mut provided = provided.into_iter().cloned().collect::<Vec<_>>();
        required.sort_unstable();
        provided.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "timeline sources must exactly match the planned sourceId values",
        )
        .with_details(json!({ "required": required, "provided": provided })));
    }
    let sources = request
        .sources
        .iter()
        .map(|source| {
            root.open_source(&source.source)
                .map(|file| (source.id.clone(), file))
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedTimelineRenderRequest {
        sources,
        output,
        request,
    })
}

fn prepare_motion_render_request(
    root: &WorkspaceRoot,
    request: MotionRenderRequest,
) -> TransformResult<PreparedMotionRenderRequest> {
    let plan = plan_motion(&request.spec)?;
    if plan.timeline.cumulative_output_pixels > request.options.max_cumulative_pixels {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "motion exceeds the configured cumulative output pixel limit",
        ));
    }
    if request.sources.len() != 1 || request.sources[0].id != plan.source_id {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion sources must exactly match the planned sourceId",
        ));
    }
    let sources = request
        .sources
        .iter()
        .map(|source| {
            root.open_source(&source.source)
                .map(|file| (source.id.clone(), file))
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedMotionRenderRequest {
        sources,
        output,
        request,
    })
}

fn prepare_canvas_render_request(
    root: &WorkspaceRoot,
    request: CanvasRenderRequest,
) -> TransformResult<PreparedCanvasRenderRequest> {
    let source = root.open_source(&request.source)?;
    let output = root.prepare_output_directory(&request.output_directory)?;
    Ok(PreparedCanvasRenderRequest {
        source,
        output,
        request,
    })
}

async fn run_render_worker(
    prepared: PreparedRenderRequest,
    cancellation: CancellationToken,
) -> Result<FileRenderResult, TransformError> {
    let PreparedRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    // The worker sees only a private copy and a private output path. Agent-
    // controlled path components are opened once through the workspace
    // capability and are never re-resolved inside the child process.
    let staging = create_private_staging(
        ".worldbend-stage-",
        "private render staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let max_source_bytes = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, max_source_bytes)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Transform {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: FileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Transform worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;

    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_media_inspect_worker(
    prepared: PreparedMediaInspectRequest,
) -> Result<MediaSourceInfo, TransformError> {
    let PreparedMediaInspectRequest { source, request } = prepared;
    let staging = create_private_staging(
        ".worldbend-media-inspect-",
        "private media staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let max_source_bytes = request.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, max_source_bytes)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private source staging task failed: {error}"),
        )
    })??;
    let worker = WorkerRequest::MediaInspect {
        source: staged_source,
        limits: request.limits,
    };
    let result: MediaSourceInfo = execute_worker_request(&worker).await?;
    if !result.source_sha256.eq_ignore_ascii_case(&source_sha256) {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "media inspection digest does not match the staged source",
        ));
    }
    preflight_render_result(&result)?;
    Ok(result)
}

async fn run_plane_candidates_worker(
    prepared: PreparedPlaneCandidatesRequest,
) -> Result<PlaneCandidateResponse, TransformError> {
    let PreparedPlaneCandidatesRequest { source, request } = prepared;
    let staging = create_private_staging(
        ".worldbend-perception-stage-",
        "private perception staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let maximum = request.request.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private perception source staging task failed: {error}"),
        )
    })??;
    let worker = WorkerRequest::PlaneCandidates {
        source: staged_source,
        request: request.request,
    };
    let result: PlaneCandidateResponse = execute_worker_request(&worker).await?;
    if !result
        .source
        .source_sha256
        .eq_ignore_ascii_case(&source_sha256)
    {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "perception source digest does not match the staged source",
        ));
    }
    preflight_render_result(&result)?;
    Ok(result)
}

async fn run_psd_smart_objects_worker(
    prepared: PreparedPsdSmartObjectsRequest,
) -> Result<PsdSmartObjectResponse, TransformError> {
    let PreparedPsdSmartObjectsRequest { source, request } = prepared;
    let staging = create_private_staging(
        ".worldbend-psd-stage-",
        "private PSD interoperability staging is not writable",
    )?;
    let staged_source = staging.path().join("source.psd");
    let staged_source_for_copy = staged_source.clone();
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, MAX_PSD_SOURCE_BYTES as u64)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private PSD source staging task failed: {error}"),
        )
    })??;
    let worker = WorkerRequest::PsdSmartObjects {
        source: staged_source,
        request: request.request,
    };
    let result: PsdSmartObjectResponse = execute_worker_request(&worker).await?;
    let reported_sha256 = match &result {
        PsdSmartObjectResponse::Inspection { inspection } => &inspection.source.sha256,
        PsdSmartObjectResponse::TemplatePlan { plan } => &plan.source.sha256,
    };
    if !reported_sha256.eq_ignore_ascii_case(&source_sha256) {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "PSD interoperability source digest does not match the staged source",
        ));
    }
    preflight_render_result(&result)?;
    Ok(result)
}

async fn run_media_render_worker(
    prepared: PreparedMediaRenderRequest,
    cancellation: CancellationToken,
) -> Result<MediaFileRenderResult, TransformError> {
    let PreparedMediaRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-media-stage-",
        "private media staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let max_source_bytes = input.options.render.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, max_source_bytes)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join(format!(
        "result.{}",
        media_output_extension(&input.options.output)
    ));
    let worker = WorkerRequest::Media {
        source: staged_source,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: MediaFileRenderResult = execute_worker_request(&worker).await?;
    if !result
        .source
        .source_sha256
        .eq_ignore_ascii_case(&source_sha256)
    {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "media render source digest does not match the staged source",
        ));
    }
    verify_worker_output(
        staged_output.clone(),
        "media render worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;
    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_vector_render_worker(
    prepared: PreparedVectorRenderRequest,
    cancellation: CancellationToken,
) -> Result<VectorFileResult, TransformError> {
    let PreparedVectorRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-vector-stage-",
        "private vector staging is not writable",
    )?;
    let staged_source = staging.path().join("source.svg");
    let staged_source_for_copy = staged_source.clone();
    let maximum = input.options.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private vector source staging task failed: {error}"),
        )
    })??;
    let extension = match input.options.carrier {
        VectorCarrier::Svg => "svg",
        VectorCarrier::Html => "html",
    };
    let staged_output = staging.path().join(format!("result.{extension}"));
    let request = WorkerRequest::Vector {
        source: staged_source,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: VectorFileResult = execute_worker_request(&request).await?;
    if !result.source_sha256.eq_ignore_ascii_case(&source_sha256) {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "vector worker source digest does not match the staged source",
        ));
    }
    verify_worker_output(
        staged_output.clone(),
        "vector worker",
        result.bytes,
        result.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;
    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("vector output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_tiled_media_worker(
    prepared: PreparedTiledMediaRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<TiledMediaRenderResult>, TransformError> {
    let PreparedTiledMediaRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let tile_extension = media_output_extension(&input.options.output);
    let staging = create_private_staging(
        ".worldbend-tiled-stage-",
        "private tiled staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let maximum = input.options.source_limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private tiled source staging task failed: {error}"),
        )
    })??;
    if cancellation.is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "tiled media render was cancelled while staging its source",
        ));
    }
    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::TiledMedia {
        source: staged_source,
        spec: input.spec,
        output_directory: staged_output.clone(),
        options: input.options,
    };
    let mut result: TiledMediaRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "tiled media render was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let source_sha256_for_normalize = source_sha256.clone();
    let normalize_cancellation = cancellation.clone();
    result = tokio::task::spawn_blocking(move || {
        normalize_tiled_media_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &source_sha256_for_normalize,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("tiled media verification task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;
    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_flat_files_from_with_cancel(
            &staged_output_for_copy,
            MCP_MAX_TILED_TILES as usize + 1,
            &[tile_extension, "json"],
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("tiled media output staging task failed: {error}"),
        )
    })??;
    let commit = if dry_run {
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_tiled_media_worker_result(
    result: &mut TiledMediaRenderResult,
    staged_output: &Path,
    output_directory: &str,
    dry_run: bool,
    source_sha256: &str,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    let manifest = &mut result.manifest;
    let expected_count = manifest.rows.checked_mul(manifest.columns).ok_or_else(|| {
        TransformError::new(ErrorCode::Internal, "tiled worker tile count overflowed")
    })?;
    if manifest.schema != TILED_MEDIA_SCHEMA
        || manifest.version != TILED_MEDIA_VERSION
        || !manifest
            .source
            .source_sha256
            .eq_ignore_ascii_case(source_sha256)
        || expected_count == 0
        || expected_count > MCP_MAX_TILED_TILES.min(MAX_TILED_TILES)
        || manifest.tiles.len() != expected_count as usize
        || manifest.tile_width == 0
        || manifest.tile_height == 0
        || manifest.placement.width == 0
        || manifest.placement.height == 0
        || manifest.columns != manifest.placement.width.div_ceil(manifest.tile_width)
        || manifest.rows != manifest.placement.height.div_ceil(manifest.tile_height)
        || manifest.output_pixels > MCP_MAX_TILED_PIXELS.min(MAX_TILED_OUTPUT_PIXELS)
        || manifest.encoded_bytes > MCP_MAX_TILED_ENCODED_BYTES.min(MAX_TILED_ENCODED_BYTES)
    {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "tiled worker result exceeds its correlated Agent limits",
        ));
    }
    let extension = match manifest.media.format {
        MediaFormat::Png => "png",
        MediaFormat::Tiff => "tiff",
        MediaFormat::Jpeg => "jpg",
        MediaFormat::Webp => "webp",
    };
    let mut expected_files = Vec::with_capacity(manifest.tiles.len() + 1);
    let mut encoded_bytes = 0_u64;
    for (index, tile) in manifest.tiles.iter_mut().enumerate() {
        let row = u32::try_from(index).unwrap_or(u32::MAX) / manifest.columns;
        let column = u32::try_from(index).unwrap_or(u32::MAX) % manifest.columns;
        let expected_x = column.saturating_mul(manifest.tile_width);
        let expected_y = row.saturating_mul(manifest.tile_height);
        let expected_width = manifest
            .tile_width
            .min(manifest.placement.width - expected_x);
        let expected_height = manifest
            .tile_height
            .min(manifest.placement.height - expected_y);
        let filename = format!("tile-r{row:04}-c{column:04}.{extension}");
        if tile.row != row
            || tile.column != column
            || tile.x != expected_x
            || tile.y != expected_y
            || tile.width != expected_width
            || tile.height != expected_height
            || tile.filename != filename
            || !valid_sha256(&tile.sha256)
        {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "tiled worker tile does not match its manifest geometry",
            ));
        }
        let path = staged_output.join(&filename);
        let (bytes, sha256) = hash_regular_file(&path, "tiled worker", is_cancelled)?;
        if bytes != tile.bytes || !sha256.eq_ignore_ascii_case(&tile.sha256) {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "tiled worker tile bytes do not match its manifest",
            ));
        }
        encoded_bytes = encoded_bytes.checked_add(bytes).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "tiled encoded byte count overflowed",
            )
        })?;
        expected_files.push(filename);
    }
    if encoded_bytes != manifest.encoded_bytes {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "tiled worker encoded byte count does not match its manifest",
        ));
    }
    let manifest_path = staged_output.join("worldbend.tiled-media.json");
    let (_, manifest_sha256) =
        hash_regular_file(&manifest_path, "tiled worker manifest", is_cancelled)?;
    if !valid_sha256(&result.manifest_sha256)
        || !manifest_sha256.eq_ignore_ascii_case(&result.manifest_sha256)
    {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "tiled worker manifest digest does not match the manifest file",
        ));
    }
    expected_files.push("worldbend.tiled-media.json".to_owned());
    let mut actual_files = read_entry_names(staged_output)?;
    expected_files.sort_unstable();
    actual_files.sort_unstable();
    if actual_files != expected_files {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "tiled worker directory contains unexpected entries",
        ));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        TiledMediaStatus::Ready
    } else {
        TiledMediaStatus::Written
    };
    Ok(())
}

async fn run_rectify_worker(
    prepared: PreparedRectifyRenderRequest,
    cancellation: CancellationToken,
) -> Result<RectifyFileRenderResult, TransformError> {
    let PreparedRectifyRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-stage-",
        "private render staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let max_source_bytes = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, max_source_bytes)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Rectify {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: RectifyFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Rectification worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;

    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_program_worker(
    prepared: PreparedProgramRenderRequest,
    cancellation: CancellationToken,
) -> Result<RasterProgramFileRenderResult, TransformError> {
    let PreparedProgramRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-program-stage-",
        "private program staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let max_source_bytes = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, max_source_bytes)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private program source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::RasterProgram {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: RasterProgramFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Raster Program worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;

    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("program output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_variation_worker(
    prepared: PreparedVariationRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<VariationJobFileRenderResult>, TransformError> {
    let PreparedVariationRenderRequest {
        assets,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-variation-stage-",
        "private Variation Job staging is not writable",
    )?;
    let mut staged_assets = Vec::with_capacity(assets.len());
    for (index, (id, asset)) in assets.into_iter().enumerate() {
        if cancellation.is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "Variation Job was cancelled while staging its assets",
            ));
        }
        let staged_source = staging.path().join(format!("asset-{index}.raster"));
        let staged_source_for_copy = staged_source.clone();
        let maximum = input.options.limits.max_source_bytes;
        let source_sha256 = tokio::task::spawn_blocking(move || {
            copy_source_to_private_staging(asset, &staged_source_for_copy, maximum)
        })
        .await
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("private Variation Job asset staging task failed: {error}"),
            )
        })??;
        staged_assets.push(WorkerVariationAsset {
            id,
            source: staged_source,
            source_sha256,
        });
    }
    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::VariationJob {
        assets: staged_assets,
        spec: input.spec,
        output_directory: staged_output.clone(),
        options: input.options,
    };
    let result: VariationJobFileRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "Variation Job was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let normalize_cancellation = cancellation.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut result = result;
        normalize_variation_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("Variation Job result validation task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;

    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let maximum_directories = result.plan.items.len();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_one_level_tree_from_with_cancel(
            &staged_output_for_copy,
            maximum_directories,
            MCP_MAX_VARIATION_OUTPUTS,
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("Variation Job output staging task failed: {error}"),
        )
    })??;
    let commit = if input.dry_run {
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_variation_worker_result(
    result: &mut VariationJobFileRenderResult,
    staged_output: &std::path::Path,
    output_directory: &str,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if result.plan.items.len() != result.items.len()
        || result.plan.output_count > MCP_MAX_VARIATION_OUTPUTS
        || result.cumulative_source_pixels > MCP_MAX_VARIATION_SOURCE_PIXELS
        || result.cumulative_processed_pixels > MCP_MAX_VARIATION_PROCESSED_PIXELS
    {
        return Err(invalid_variation_worker_result(
            "Variation Job worker result exceeds its correlated plan or Agent limits",
        ));
    }
    if result.plan.asset_ids.len() != result.sources.len()
        || result
            .plan
            .asset_ids
            .iter()
            .zip(&result.sources)
            .any(|(planned, source)| {
                planned != &source.asset_id
                    || source.width == 0
                    || source.height == 0
                    || !valid_sha256(&source.source_sha256)
            })
    {
        return Err(invalid_variation_worker_result(
            "Variation Job worker source result does not match its plan",
        ));
    }

    let expected_directories = result
        .plan
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let mut encoded_bytes = 0_u64;
    for (planned, item) in result.plan.items.iter().zip(&mut result.items) {
        if planned.id != item.id
            || planned.bindings != item.bindings
            || item.root_width == 0
            || item.root_height == 0
            || item.outputs.len() != result.plan.template.outputs.len()
        {
            return Err(invalid_variation_worker_result(
                "Variation Job worker item does not match its ordered plan",
            ));
        }
        let item_directory = staged_output.join(&item.id);
        let metadata = fs::symlink_metadata(&item_directory).map_err(|error| {
            invalid_variation_worker_result("Variation Job worker item directory is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(invalid_variation_worker_result(
                "Variation Job worker item output is not a real directory",
            ));
        }
        let mut expected_files = Vec::with_capacity(item.outputs.len());
        for (planned_output, output) in result.plan.template.outputs.iter().zip(&mut item.outputs) {
            if planned_output.id != output.id
                || output.width == 0
                || output.height == 0
                || !valid_sha256(&output.sha256)
            {
                return Err(invalid_variation_worker_result(
                    "Variation Job worker output does not match its template",
                ));
            }
            let path = item_directory.join(&planned_output.filename);
            let (bytes, sha256) = hash_regular_file(&path, "Variation Job worker", is_cancelled)?;
            if bytes != output.bytes || !sha256.eq_ignore_ascii_case(&output.sha256) {
                return Err(invalid_variation_worker_result(
                    "Variation Job worker output bytes do not match its result",
                ));
            }
            encoded_bytes = encoded_bytes.checked_add(bytes).ok_or_else(|| {
                TransformError::new(
                    ErrorCode::OutputLimit,
                    "Variation Job encoded output byte count overflowed",
                )
            })?;
            expected_files.push(planned_output.filename.clone());
            output.output =
                variation_output_label(output_directory, &item.id, &planned_output.filename);
        }
        let mut actual_files = read_entry_names(&item_directory)?;
        expected_files.sort_unstable();
        actual_files.sort_unstable();
        if actual_files != expected_files {
            return Err(invalid_variation_worker_result(
                "Variation Job worker item directory contains unexpected entries",
            ));
        }
    }
    let mut expected_directories = expected_directories;
    let mut actual_directories = read_entry_names(staged_output)?;
    expected_directories.sort_unstable();
    actual_directories.sort_unstable();
    if actual_directories != expected_directories {
        return Err(invalid_variation_worker_result(
            "Variation Job worker directory contains unexpected entries",
        ));
    }
    if encoded_bytes > MCP_MAX_VARIATION_ENCODED_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Variation Job encoded output set exceeds the Agent byte ceiling",
        )
        .with_details(json!({
            "actual": encoded_bytes,
            "maximum": MCP_MAX_VARIATION_ENCODED_BYTES,
        })));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        VariationJobRenderStatus::Ready
    } else {
        VariationJobRenderStatus::Written
    };
    Ok(())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn hash_regular_file(
    path: &std::path::Path,
    context: &'static str,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<(u64, String)> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("{context} output file is missing"),
        )
        .with_details(json!({ "reason": error.to_string() }))
    })?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(TransformError::new(
            ErrorCode::Internal,
            format!("{context} output is not a regular file"),
        ));
    }
    let mut file = fs::File::open(path).map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("{context} output is not readable"),
        )
        .with_details(json!({ "reason": error.to_string() }))
    })?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                format!("{context} output validation was cancelled"),
            ));
        }
        let count = file.read(&mut buffer).map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("{context} output could not be hashed"),
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok((metadata.len(), format!("{:x}", digest.finalize())))
}

fn verify_reported_output_file(
    path: &std::path::Path,
    context: &'static str,
    reported_bytes: u64,
    reported_sha256: &str,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    let (actual_bytes, actual_sha256) = hash_regular_file(path, context, is_cancelled)?;
    if actual_bytes != reported_bytes || !actual_sha256.eq_ignore_ascii_case(reported_sha256) {
        return Err(TransformError::new(
            ErrorCode::Internal,
            format!("{context} output does not match its reported digest and byte count"),
        ));
    }
    Ok(())
}

async fn verify_worker_output(
    path: PathBuf,
    context: &'static str,
    reported_bytes: u64,
    reported_sha256: String,
    cancellation: CancellationToken,
) -> TransformResult<()> {
    tokio::task::spawn_blocking(move || {
        verify_reported_output_file(&path, context, reported_bytes, &reported_sha256, &|| {
            cancellation.is_cancelled()
        })
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("{context} output verification task failed: {error}"),
        )
    })?
}

fn read_entry_names(directory: &std::path::Path) -> TransformResult<Vec<String>> {
    fs::read_dir(directory)
        .map_err(|error| {
            invalid_variation_worker_result("Variation Job output directory is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .map_err(|error| {
                    invalid_variation_worker_result(
                        "Variation Job output directory could not be inspected",
                    )
                    .with_details(json!({ "reason": error.to_string() }))
                })
        })
        .collect()
}

fn invalid_variation_worker_result(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Internal, message)
}

async fn run_mockup_worker(
    prepared: PreparedMockupRenderRequest,
    cancellation: CancellationToken,
) -> Result<MockupFileRenderResult, TransformError> {
    let PreparedMockupRenderRequest {
        sources,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-mockup-stage-",
        "private mockup staging is not writable",
    )?;
    let mut staged_sources = Vec::with_capacity(sources.len());
    for (index, (id, source)) in sources.into_iter().enumerate() {
        let staged_source = staging.path().join(format!("source-{index}.raster"));
        let staged_source_for_copy = staged_source.clone();
        let maximum = input.options.limits.max_source_bytes;
        let source_sha256 = tokio::task::spawn_blocking(move || {
            copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
        })
        .await
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("private mockup source staging task failed: {error}"),
            )
        })??;
        staged_sources.push(WorkerMockupSource {
            id,
            source: staged_source,
            source_sha256,
        });
    }
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Mockup {
        sources: staged_sources,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: MockupFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Mockup worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;

    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("mockup output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_mesh_worker(
    prepared: PreparedMeshRenderRequest,
    cancellation: CancellationToken,
) -> Result<MeshWarpFileRenderResult, TransformError> {
    let PreparedMeshRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-mesh-stage-",
        "private mesh staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let maximum = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private mesh source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Mesh {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: MeshWarpFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Mesh worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;
    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("mesh output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_surface_worker(
    prepared: PreparedSurfaceRenderRequest,
    cancellation: CancellationToken,
) -> Result<SurfaceDeformationFileRenderResult, TransformError> {
    let PreparedSurfaceRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-surface-stage-",
        "private surface deformation staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let maximum = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private surface source staging task failed: {error}"),
        )
    })??;
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Surface {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: SurfaceDeformationFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Surface Deformation worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;
    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("surface output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_remap_worker(
    prepared: PreparedRemapRenderRequest,
    cancellation: CancellationToken,
) -> Result<RemapFileRenderResult, TransformError> {
    let PreparedRemapRenderRequest {
        source,
        map,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-remap-stage-",
        "private remap staging is not writable",
    )?;
    let maximum = input.options.limits.max_source_bytes;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private remap source staging task failed: {error}"),
        )
    })??;
    let map = match map {
        Some(map) => {
            let staged_map = staging.path().join("map.raster");
            let staged_map_for_copy = staged_map.clone();
            let map_sha256 = tokio::task::spawn_blocking(move || {
                copy_source_to_private_staging(map, &staged_map_for_copy, maximum)
            })
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("private remap map staging task failed: {error}"),
                )
            })??;
            Some(WorkerRemapMap {
                path: staged_map,
                sha256: map_sha256,
            })
        }
        None => None,
    };
    let staged_output = staging.path().join("result.png");
    let request = WorkerRequest::Remap {
        source: staged_source,
        source_sha256,
        map,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
    let mut result: RemapFileRenderResult = execute_worker_request(&request).await?;
    verify_worker_output(
        staged_output.clone(),
        "Remap worker",
        result.bytes,
        result.evidence.output_sha256.clone(),
        cancellation,
    )
    .await?;
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };
    preflight_render_result(&result)?;
    if !input.dry_run {
        tokio::task::spawn_blocking(move || output.publish_from(&staged_output))
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("remap output publication task failed: {error}"),
                )
            })??;
    }
    Ok(result)
}

async fn run_mockup_extract_worker(
    prepared: PreparedMockupExtractRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<MockupExtractFileRenderResult>, TransformError> {
    let PreparedMockupExtractRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-mockup-extract-stage-",
        "private mockup extraction staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    let maximum = input.options.limits.max_source_bytes;
    let source_sha256 = tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private mockup extraction source staging task failed: {error}"),
        )
    })??;
    if cancellation.is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "mockup extraction was cancelled while staging its source",
        ));
    }

    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::MockupExtract {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output_directory: staged_output.clone(),
        options: input.options,
    };
    let result: MockupExtractFileRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "mockup extraction was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let normalize_cancellation = cancellation.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut result = result;
        normalize_mockup_extract_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("mockup extraction result validation task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;

    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_from_with_cancel(
            &staged_output_for_copy,
            worldbend_core::MAX_MOCKUP_PLANES,
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("mockup extraction output staging task failed: {error}"),
        )
    })??;
    let commit = if input.dry_run {
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_mockup_extract_worker_result(
    result: &mut MockupExtractFileRenderResult,
    staged_output: &std::path::Path,
    output_directory: &str,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if result.plan.outputs.len() != result.items.len() {
        return Err(invalid_mockup_extract_worker_result(
            "mockup extraction worker result count does not match its plan",
        ));
    }
    let mut expected_files = Vec::with_capacity(result.items.len());
    let mut encoded_bytes = 0_u64;
    for (planned, item) in result.plan.outputs.iter().zip(&mut result.items) {
        if planned.id != item.id
            || planned.filename != format!("{}.png", item.id)
            || planned.plan.spec.output.width != item.width
            || planned.plan.spec.output.height != item.height
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid_mockup_extract_worker_result(
                "mockup extraction worker result does not match its ordered plan",
            ));
        }
        encoded_bytes = encoded_bytes.checked_add(item.bytes).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "mockup extraction encoded output byte count overflowed",
            )
        })?;
        if encoded_bytes > MCP_MAX_MOCKUP_EXTRACT_ENCODED_BYTES {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "mockup extraction encoded output set exceeds the Agent byte ceiling",
            )
            .with_details(json!({
                "actual": encoded_bytes,
                "maximum": MCP_MAX_MOCKUP_EXTRACT_ENCODED_BYTES,
            })));
        }
        let path = staged_output.join(&planned.filename);
        let (bytes, sha256) = hash_regular_file(&path, "mockup extraction worker", is_cancelled)?;
        if bytes != item.bytes || !sha256.eq_ignore_ascii_case(&item.sha256) {
            return Err(invalid_mockup_extract_worker_result(
                "mockup extraction worker output bytes do not match its result",
            ));
        }
        expected_files.push(planned.filename.clone());
        item.output = canvas_output_label(output_directory, &item.id);
    }
    let mut actual_files = fs::read_dir(staged_output)
        .map_err(|error| {
            invalid_mockup_extract_worker_result(
                "mockup extraction worker output directory is missing",
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .map_err(|error| {
                    invalid_mockup_extract_worker_result(
                        "mockup extraction worker output could not be inspected",
                    )
                    .with_details(json!({ "reason": error.to_string() }))
                })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    expected_files.sort_unstable();
    actual_files.sort_unstable();
    if actual_files != expected_files {
        return Err(invalid_mockup_extract_worker_result(
            "mockup extraction worker output directory contains unexpected entries",
        ));
    }
    if encoded_bytes > MCP_MAX_MOCKUP_EXTRACT_ENCODED_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup extraction encoded output set exceeds the Agent byte ceiling",
        )
        .with_details(json!({
            "actual": encoded_bytes,
            "maximum": MCP_MAX_MOCKUP_EXTRACT_ENCODED_BYTES,
        })));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        MockupExtractRenderStatus::Ready
    } else {
        MockupExtractRenderStatus::Written
    };
    Ok(())
}

fn invalid_mockup_extract_worker_result(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Internal, message)
}

async fn run_timeline_worker(
    prepared: PreparedTimelineRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<TimelineFileRenderResult>, TransformError> {
    let PreparedTimelineRenderRequest {
        sources,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-timeline-stage-",
        "private timeline staging is not writable",
    )?;
    let mut staged_sources = Vec::with_capacity(sources.len());
    for (index, (id, source)) in sources.into_iter().enumerate() {
        if cancellation.is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "timeline render was cancelled while staging its sources",
            ));
        }
        let staged_source = staging.path().join(format!("source-{index}.raster"));
        let staged_source_for_copy = staged_source.clone();
        let maximum = input.options.limits.max_source_bytes;
        let source_sha256 = tokio::task::spawn_blocking(move || {
            copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
        })
        .await
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("private timeline source staging task failed: {error}"),
            )
        })??;
        staged_sources.push(WorkerMockupSource {
            id,
            source: staged_source,
            source_sha256,
        });
    }
    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::Timeline {
        sources: staged_sources,
        spec: input.spec,
        output_directory: staged_output.clone(),
        options: input.options,
    };
    let result: TimelineFileRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "timeline render was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let normalize_cancellation = cancellation.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut result = result;
        normalize_timeline_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("timeline result validation task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;

    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_from_with_cancel(
            &staged_output_for_copy,
            worldbend_core::MAX_TIMELINE_FRAMES,
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("timeline output staging task failed: {error}"),
        )
    })??;
    let commit = if input.dry_run {
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_timeline_worker_result(
    result: &mut TimelineFileRenderResult,
    staged_output: &std::path::Path,
    output_directory: &str,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if result.plan.frames.len() != result.items.len() {
        return Err(invalid_timeline_worker_result(
            "timeline worker result count does not match its plan",
        ));
    }
    let mut expected_files = Vec::with_capacity(result.items.len());
    let mut encoded_bytes = 0_u64;
    for (planned, item) in result.plan.frames.iter().zip(&mut result.items) {
        if planned.index != item.index
            || planned.id != item.id
            || planned.source_id != item.source_id
            || result.plan.output.width != item.width
            || result.plan.output.height != item.height
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid_timeline_worker_result(
                "timeline worker result does not match its ordered plan",
            ));
        }
        encoded_bytes = encoded_bytes.checked_add(item.bytes).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "timeline encoded output byte count overflowed",
            )
        })?;
        let filename = format!("{}.png", item.id);
        let path = staged_output.join(&filename);
        let (bytes, sha256) = hash_regular_file(&path, "timeline worker", is_cancelled)?;
        if bytes != item.bytes || !sha256.eq_ignore_ascii_case(&item.sha256) {
            return Err(invalid_timeline_worker_result(
                "timeline worker output bytes do not match its result",
            ));
        }
        expected_files.push(filename);
        item.output = canvas_output_label(output_directory, &item.id);
    }
    let mut actual_files = fs::read_dir(staged_output)
        .map_err(|error| {
            invalid_timeline_worker_result("timeline worker output directory is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .map_err(|error| {
                    invalid_timeline_worker_result("timeline worker output could not be inspected")
                        .with_details(json!({ "reason": error.to_string() }))
                })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    expected_files.sort_unstable();
    actual_files.sort_unstable();
    if actual_files != expected_files {
        return Err(invalid_timeline_worker_result(
            "timeline worker output directory contains unexpected entries",
        ));
    }
    if encoded_bytes > MCP_MAX_TIMELINE_ENCODED_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "timeline encoded output set exceeds the Agent byte ceiling",
        )
        .with_details(json!({
            "actual": encoded_bytes,
            "maximum": MCP_MAX_TIMELINE_ENCODED_BYTES,
        })));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        TimelineRenderStatus::Ready
    } else {
        TimelineRenderStatus::Written
    };
    Ok(())
}

fn invalid_timeline_worker_result(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Internal, message)
}

async fn run_motion_worker(
    prepared: PreparedMotionRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<MotionFileRenderResult>, TransformError> {
    let PreparedMotionRenderRequest {
        sources,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-motion-stage-",
        "private motion staging is not writable",
    )?;
    let mut staged_sources = Vec::with_capacity(sources.len());
    for (index, (id, source)) in sources.into_iter().enumerate() {
        if cancellation.is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "motion render was cancelled while staging its sources",
            ));
        }
        let staged_source = staging.path().join(format!("source-{index}.raster"));
        let staged_source_for_copy = staged_source.clone();
        let maximum = input.options.limits.max_source_bytes;
        let source_sha256 = tokio::task::spawn_blocking(move || {
            copy_source_to_private_staging(source, &staged_source_for_copy, maximum)
        })
        .await
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("private motion source staging task failed: {error}"),
            )
        })??;
        staged_sources.push(WorkerMockupSource {
            id,
            source: staged_source,
            source_sha256,
        });
    }
    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::Motion {
        sources: staged_sources,
        spec: input.spec,
        output_directory: staged_output.clone(),
        options: input.options,
    };
    let result: MotionFileRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "motion render was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let normalize_cancellation = cancellation.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut result = result;
        normalize_motion_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("motion result validation task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;

    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_from_with_cancel(
            &staged_output_for_copy,
            worldbend_core::MAX_TIMELINE_FRAMES,
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("motion output staging task failed: {error}"),
        )
    })??;
    let commit = if input.dry_run {
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_motion_worker_result(
    result: &mut MotionFileRenderResult,
    staged_output: &std::path::Path,
    output_directory: &str,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if result.plan.frames.len() != result.items.len()
        || result.plan.timeline.frames.len() != result.items.len()
    {
        return Err(invalid_motion_worker_result(
            "motion worker result count does not match its plan",
        ));
    }
    let mut expected_files = Vec::with_capacity(result.items.len());
    let mut encoded_bytes = 0_u64;
    for ((timing, planned), item) in result
        .plan
        .frames
        .iter()
        .zip(&result.plan.timeline.frames)
        .zip(&mut result.items)
    {
        if timing.index != item.index
            || timing.id != item.id
            || timing.presentation_time != item.presentation_time
            || planned.index != item.index
            || planned.id != item.id
            || planned.source_id != item.source_id
            || result.plan.output.width != item.width
            || result.plan.output.height != item.height
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid_motion_worker_result(
                "motion worker result does not match its ordered plan",
            ));
        }
        encoded_bytes = encoded_bytes.checked_add(item.bytes).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "motion encoded output byte count overflowed",
            )
        })?;
        let filename = format!("{}.png", item.id);
        let path = staged_output.join(&filename);
        let (bytes, sha256) = hash_regular_file(&path, "motion worker", is_cancelled)?;
        if bytes != item.bytes || !sha256.eq_ignore_ascii_case(&item.sha256) {
            return Err(invalid_motion_worker_result(
                "motion worker output bytes do not match its result",
            ));
        }
        expected_files.push(filename);
        item.output = canvas_output_label(output_directory, &item.id);
    }
    let mut actual_files = fs::read_dir(staged_output)
        .map_err(|error| {
            invalid_motion_worker_result("motion worker output directory is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .map_err(|error| {
                    invalid_motion_worker_result("motion worker output could not be inspected")
                        .with_details(json!({ "reason": error.to_string() }))
                })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    expected_files.sort_unstable();
    actual_files.sort_unstable();
    if actual_files != expected_files {
        return Err(invalid_motion_worker_result(
            "motion worker output directory contains unexpected entries",
        ));
    }
    if encoded_bytes > MCP_MAX_TIMELINE_ENCODED_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "motion encoded output set exceeds the Agent byte ceiling",
        )
        .with_details(json!({
            "actual": encoded_bytes,
            "maximum": MCP_MAX_TIMELINE_ENCODED_BYTES,
        })));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        TimelineRenderStatus::Ready
    } else {
        TimelineRenderStatus::Written
    };
    Ok(())
}

fn invalid_motion_worker_result(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Internal, message)
}

async fn run_canvas_worker(
    prepared: PreparedCanvasRenderRequest,
    cancellation: CancellationToken,
) -> Result<PreparedDirectoryResult<CanvasSetFileRenderResult>, TransformError> {
    let PreparedCanvasRenderRequest {
        source,
        output,
        request: input,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-canvas-stage-",
        "private Canvas staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let staged_source_for_copy = staged_source.clone();
    tokio::task::spawn_blocking(move || {
        copy_source_to_private_staging(source, &staged_source_for_copy, MCP_MAX_SOURCE_BYTES)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("private Canvas source staging task failed: {error}"),
        )
    })??;
    if cancellation.is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "Canvas Set render was cancelled while staging its source",
        ));
    }

    let staged_output = staging.path().join("result-set");
    let request = WorkerRequest::CanvasSet {
        source: staged_source,
        program: input.program,
        output_directory: staged_output.clone(),
        options: CanvasSetRenderOptions {
            quality: SamplingQuality::Standard,
            limits: RenderLimits {
                max_width: MCP_MAX_AXIS,
                max_height: MCP_MAX_AXIS,
                max_pixels: MCP_MAX_PIXELS,
                max_source_bytes: MCP_MAX_SOURCE_BYTES,
            },
            max_cumulative_pixels: MCP_MAX_CANVAS_SET_PIXELS,
        },
    };
    let result: CanvasSetFileRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(
            ErrorCode::Cancelled,
            "Canvas Set render was cancelled while its worker was running",
        )),
        result = execute_worker_request(&request) => result?,
    };
    let staged_output_for_normalize = staged_output.clone();
    let output_directory = input.output_directory.clone();
    let dry_run = input.dry_run;
    let normalize_cancellation = cancellation.clone();
    let result = tokio::task::spawn_blocking(move || {
        let mut result = result;
        normalize_canvas_worker_result(
            &mut result,
            &staged_output_for_normalize,
            &output_directory,
            dry_run,
            &|| normalize_cancellation.is_cancelled(),
        )?;
        Ok::<_, TransformError>(result)
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("Canvas result validation task failed: {error}"),
        )
    })??;
    preflight_render_result(&result)?;

    let staged_output_for_copy = staged_output.clone();
    let staging_cancellation = cancellation.clone();
    let staged = tokio::task::spawn_blocking(move || {
        output.stage_from_with_cancel(
            &staged_output_for_copy,
            worldbend_core::MAX_CANVAS_VARIANTS,
            &|| staging_cancellation.is_cancelled(),
        )
    })
    .await
    .map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("Canvas output staging task failed: {error}"),
        )
    })??;
    let commit = if input.dry_run {
        // Dry-run exercises the same same-parent copy and sync path, then
        // removes the hidden directory instead of exposing a final name.
        drop(staged);
        None
    } else {
        Some(staged)
    };
    Ok(PreparedDirectoryResult { result, commit })
}

fn normalize_canvas_worker_result(
    result: &mut CanvasSetFileRenderResult,
    staged_output: &std::path::Path,
    output_directory: &str,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<()> {
    if result.plan.variants.len() != result.items.len() {
        return Err(invalid_canvas_worker_result(
            "Canvas worker result count does not match its plan",
        ));
    }
    let mut expected_files = Vec::with_capacity(result.items.len());
    let mut encoded_bytes = 0_u64;
    for (variant, item) in result.plan.variants.iter().zip(&mut result.items) {
        if variant.id != item.id
            || variant.plan.output_size.width != item.width
            || variant.plan.output_size.height != item.height
            || item.sha256.len() != 64
            || !item.sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(invalid_canvas_worker_result(
                "Canvas worker result does not match its ordered plan",
            ));
        }
        item.output = canvas_output_label(output_directory, &item.id);
        encoded_bytes = encoded_bytes.checked_add(item.bytes).ok_or_else(|| {
            TransformError::new(
                ErrorCode::OutputLimit,
                "Canvas encoded output byte count overflowed",
            )
        })?;
        if encoded_bytes > MCP_MAX_CANVAS_ENCODED_BYTES {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Canvas encoded output set exceeds the Agent byte ceiling",
            )
            .with_details(json!({
                "actual": encoded_bytes,
                "maximum": MCP_MAX_CANVAS_ENCODED_BYTES,
            })));
        }
        let filename = format!("{}.png", item.id);
        let path = staged_output.join(&filename);
        let (bytes, sha256) = hash_regular_file(&path, "Canvas worker", is_cancelled)?;
        if bytes != item.bytes || !sha256.eq_ignore_ascii_case(&item.sha256) {
            return Err(invalid_canvas_worker_result(
                "Canvas worker output bytes do not match its result",
            ));
        }
        expected_files.push(filename);
    }
    let mut actual_files = fs::read_dir(staged_output)
        .map_err(|error| {
            invalid_canvas_worker_result("Canvas worker output directory is missing")
                .with_details(json!({ "reason": error.to_string() }))
        })?
        .map(|entry| {
            entry
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .map_err(|error| {
                    invalid_canvas_worker_result("Canvas worker output could not be inspected")
                        .with_details(json!({ "reason": error.to_string() }))
                })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    expected_files.sort_unstable();
    actual_files.sort_unstable();
    if actual_files != expected_files {
        return Err(invalid_canvas_worker_result(
            "Canvas worker output directory contains unexpected entries",
        ));
    }
    if encoded_bytes > MCP_MAX_CANVAS_ENCODED_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Canvas encoded output set exceeds the Agent byte ceiling",
        )
        .with_details(json!({
            "actual": encoded_bytes,
            "maximum": MCP_MAX_CANVAS_ENCODED_BYTES,
        })));
    }
    result.output_directory = output_directory.to_owned();
    result.dry_run = dry_run;
    result.status = if dry_run {
        CanvasSetRenderStatus::Ready
    } else {
        CanvasSetRenderStatus::Written
    };
    Ok(())
}

fn invalid_canvas_worker_result(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::Internal, message)
}

/// MCP paths are root-relative logical labels, not host-native display paths.
/// Normalize separators so an Agent receives the same portable path contract
/// on Unix and Windows.
fn canvas_output_label(output_directory: &str, id: &str) -> String {
    let mut segments = std::path::Path::new(output_directory)
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            std::path::Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>();
    segments.push(format!("{id}.png"));
    segments.join("/")
}

fn variation_output_label(output_directory: &str, item_id: &str, filename: &str) -> String {
    let mut segments = std::path::Path::new(output_directory)
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            std::path::Component::CurDir => None,
            _ => None,
        })
        .collect::<Vec<_>>();
    segments.push(item_id.to_owned());
    segments.push(filename.to_owned());
    segments.join("/")
}

async fn execute_worker_request<T>(request: &WorkerRequest) -> TransformResult<T>
where
    T: DeserializeOwned,
{
    let request_bytes = serde_json::to_vec(&request).map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to encode worker request: {error}"),
        )
    })?;
    if request_bytes.len() > MAX_WORKER_REQUEST_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "worker request exceeds byte limit",
        ));
    }

    let executable = std::env::current_exe().map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to locate render worker: {error}"),
        )
    })?;
    let mut command = Command::new(executable);
    command
        .arg("--worker-render")
        .env("RAYON_NUM_THREADS", worker_render_threads().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to start render worker: {error}"),
        )
    })?;
    let mut stdin = child.stdin.take().ok_or_else(|| {
        TransformError::new(ErrorCode::Internal, "render worker stdin was not available")
    })?;
    stdin.write_all(&request_bytes).await.map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to send render request: {error}"),
        )
    })?;
    drop(stdin);

    let worker_pid = child.id();
    let (stdout_bytes, stderr_bytes, worker_status) = timeout(WORKER_TIMEOUT, async move {
        tokio::select! {
            result = read_worker_output(&mut child) => result,
            memory_error = monitor_worker_memory(worker_pid) => Err(memory_error),
        }
    })
    .await
    .map_err(|_| render_timeout_error("waiting for the isolated worker", WORKER_TIMEOUT))??;
    if stdout_bytes.len() > MAX_WORKER_RESPONSE_BYTES
        || stderr_bytes.len() > MAX_WORKER_RESPONSE_BYTES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "render worker response exceeds byte limit",
        ));
    }
    let envelope: WorkerEnvelope<T> = serde_json::from_slice(&stdout_bytes).map_err(|_| {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        let (code, message) = classify_worker_death(&worker_status, stderr.as_ref());
        TransformError::new(code, message)
            .with_details(json!({ "stderr": bounded_text(&stderr, 2048) }))
    })?;
    match envelope {
        WorkerEnvelope::Success { ok: _, result } => Ok(*result),
        WorkerEnvelope::Failure { ok: _, error } => Err(error),
    }
}

fn preflight_render_result<T>(result: &T) -> TransformResult<()>
where
    T: Serialize + JsonSchema + Clone + 'static,
{
    // Measure the exact shape the client will receive: framing differences
    // between the worker envelope and the final CallToolResult would otherwise
    // let a file publish and then have the response swap to E_OUTPUT_LIMIT.
    let preflight_envelope: ToolEnvelope<T> = ToolEnvelope::Success {
        ok: true,
        result: result.clone(),
    };
    let preflight_response = preflight_envelope
        .build_complete_result()
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Internal,
                format!("failed to preflight response: {error}"),
            )
        })?;
    let preflight_bytes = serialized_call_result_bytes(&preflight_response).map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to size the render response: {error}"),
        )
    })?;
    if preflight_bytes > MAX_TOOL_RESPONSE_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "render result exceeds response byte limit",
        ));
    }
    Ok(())
}

fn worker_render_threads() -> usize {
    let logical_cpus = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(MAX_CONCURRENT_RENDERS);
    logical_cpus
        .div_ceil(MAX_CONCURRENT_RENDERS)
        .clamp(1, MAX_THREADS_PER_RENDER)
}

async fn read_worker_output(
    child: &mut tokio::process::Child,
) -> Result<(Vec<u8>, Vec<u8>, ExitStatus), TransformError> {
    // Bound both pipes before waiting: a runaway worker must not be able to
    // grow the server's memory through unbounded stdout or stderr.
    let mut stdout = child.stdout.take().ok_or_else(|| {
        TransformError::new(
            ErrorCode::Internal,
            "render worker stdout was not available",
        )
    })?;
    let mut stderr = child.stderr.take().ok_or_else(|| {
        TransformError::new(
            ErrorCode::Internal,
            "render worker stderr was not available",
        )
    })?;
    let output = tokio::try_join!(
        read_bounded_worker_stream(&mut stdout, MAX_WORKER_RESPONSE_BYTES),
        read_bounded_worker_stream(&mut stderr, MAX_WORKER_RESPONSE_BYTES),
    );
    let (stdout_bytes, stderr_bytes) = match output {
        Ok(output) => output,
        Err(error) => {
            // Stop the producer before waiting. Merely taking N+1 bytes leaves
            // the rest of an oversized pipe unread, which can block the worker
            // and misreport a deterministic output-limit failure as a timeout.
            let _ = child.start_kill();
            let _ = child.wait().await;
            return Err(error);
        }
    };
    let status = child.wait().await.map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("render worker failed: {error}"),
        )
    })?;
    Ok((stdout_bytes, stderr_bytes, status))
}

async fn read_bounded_worker_stream<R>(
    reader: &mut R,
    maximum: usize,
) -> Result<Vec<u8>, TransformError>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut bytes = Vec::with_capacity(maximum.min(64 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let remaining = maximum.saturating_sub(bytes.len());
        let read_limit = remaining.saturating_add(1).min(chunk.len());
        let count = reader
            .read(&mut chunk[..read_limit])
            .await
            .map_err(|error| {
                TransformError::new(
                    ErrorCode::Internal,
                    format!("failed to read render worker output: {error}"),
                )
            })?;
        if count == 0 {
            return Ok(bytes);
        }
        if count > remaining {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "render worker response exceeds byte limit",
            ));
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
}

#[cfg(target_os = "macos")]
async fn monitor_worker_memory(pid: Option<u32>) -> TransformError {
    let Some(pid) = pid else {
        return TransformError::new(
            ErrorCode::Memory,
            "render worker PID was not available for memory monitoring",
        );
    };
    let mut interval = tokio::time::interval(Duration::from_millis(10));
    loop {
        interval.tick().await;
        let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
        let status = unsafe {
            libc::proc_pid_rusage(
                pid as libc::c_int,
                libc::RUSAGE_INFO_V2,
                usage.as_mut_ptr().cast(),
            )
        };
        if status != 0 {
            continue;
        }
        let usage = unsafe { usage.assume_init() };
        if usage.ri_phys_footprint > WORKER_MEMORY_BYTES {
            return TransformError::new(
                ErrorCode::Memory,
                "render worker exceeded the memory limit",
            )
            .with_details(json!({
                "limitBytes": WORKER_MEMORY_BYTES,
                "observedBytes": usage.ri_phys_footprint
            }));
        }
    }
}

#[cfg(not(target_os = "macos"))]
async fn monitor_worker_memory(_pid: Option<u32>) -> TransformError {
    std::future::pending().await
}

fn search_operation_catalog(input: SearchInput) -> TransformResult<SearchResult> {
    if !(1..=20).contains(&input.limit) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "search limit must be an integer from 1 through 20",
        ));
    }
    let terms = input
        .query
        .split_whitespace()
        .map(str::to_ascii_lowercase)
        .collect::<Vec<_>>();
    let matches = OperationId::ALL
        .into_iter()
        .filter(|operation| {
            let haystack = format!(
                "{} {} {} {}",
                operation.id(),
                operation.title(),
                operation.summary(),
                operation.search_terms()
            )
            .to_ascii_lowercase();
            terms.iter().all(|term| haystack.contains(term))
        })
        .collect::<Vec<_>>();
    Ok(SearchResult {
        operations: matches
            .iter()
            .copied()
            .take(usize::from(input.limit))
            .map(OperationSummary::from)
            .collect(),
        total_matches: u32::try_from(matches.len()).unwrap_or(u32::MAX),
    })
}

fn describe_operation(operation: OperationId) -> OperationDescriptor {
    let (input_schema, output_schema) = match operation {
        OperationId::Compose => operation_schemas::<ComposeInput, AffineComposition>(),
        OperationId::Solve => operation_schemas::<SolveInput, SolveOutput>(),
        OperationId::Inspect => operation_schemas::<InspectInput, InspectOutput>(),
        OperationId::Render => operation_schemas::<RenderInput, FileRenderResult>(),
        OperationId::MediaInspect => operation_schemas::<MediaInspectInput, MediaSourceInfo>(),
        OperationId::PlaneCandidates => {
            operation_schemas::<PlaneCandidatesInput, PlaneCandidateResponse>()
        }
        OperationId::PsdSmartObjects => {
            operation_schemas::<PsdSmartObjectsInput, PsdSmartObjectResponse>()
        }
        OperationId::MediaRender => operation_schemas::<MediaRenderInput, MediaFileRenderResult>(),
        OperationId::VectorRender => operation_schemas::<VectorRenderInput, VectorFileResult>(),
        OperationId::TiledMediaRender => {
            operation_schemas::<TiledMediaRenderInput, TiledMediaRenderResult>()
        }
        OperationId::Rectify => operation_schemas::<RectifyInput, RectifyPlan>(),
        OperationId::RectifyRender => {
            operation_schemas::<RectifyRenderInput, RectifyFileRenderResult>()
        }
        OperationId::ProgramInspect => {
            operation_schemas::<ProgramInspectInput, RasterProgramInspection>()
        }
        OperationId::ProgramRender => {
            operation_schemas::<ProgramRenderInput, RasterProgramFileRenderResult>()
        }
        OperationId::TemplateInspect => {
            operation_schemas::<TemplateInspectInput, SpatialTemplateInspection>()
        }
        OperationId::VariationPlan => operation_schemas::<VariationPlanInput, VariationJobPlan>(),
        OperationId::VariationRender => {
            operation_schemas::<VariationRenderInput, VariationJobFileRenderResult>()
        }
        OperationId::CanvasRender => (
            Value::Object(canvas_render_input_schema()),
            Value::Object(generated_output_schema::<
                ToolEnvelope<CanvasSetFileRenderResult>,
            >()),
        ),
        OperationId::MockupPlan => operation_schemas::<MockupPlanInput, MockupPlan>(),
        OperationId::MockupRender => {
            operation_schemas::<MockupRenderInput, MockupFileRenderResult>()
        }
        OperationId::MockupExtractPlan => {
            operation_schemas::<MockupExtractPlanInput, MockupExtractPlan>()
        }
        OperationId::MockupExtractRender => {
            operation_schemas::<MockupExtractRenderInput, MockupExtractFileRenderResult>()
        }
        OperationId::MeshPlan => operation_schemas::<MeshPlanInput, MeshWarpPlan>(),
        OperationId::MeshRender => operation_schemas::<MeshRenderInput, MeshWarpFileRenderResult>(),
        OperationId::SurfacePlan => operation_schemas::<SurfacePlanInput, SurfaceDeformationPlan>(),
        OperationId::SurfaceRender => {
            operation_schemas::<SurfaceRenderInput, SurfaceDeformationFileRenderResult>()
        }
        OperationId::RemapPlan => operation_schemas::<RemapPlanInput, RemapPlan>(),
        OperationId::RemapRender => operation_schemas::<RemapRenderInput, RemapFileRenderResult>(),
        OperationId::TimelinePlan => operation_schemas::<TimelinePlanInput, TimelinePlan>(),
        OperationId::TimelineRender => {
            operation_schemas::<TimelineRenderInput, TimelineFileRenderResult>()
        }
        OperationId::MotionPlan => operation_schemas::<MotionPlanInput, MotionPlan>(),
        OperationId::MotionRender => {
            operation_schemas::<MotionRenderInput, MotionFileRenderResult>()
        }
        OperationId::Css => operation_schemas::<CssInput, worldbend_core::CssTransform>(),
    };
    OperationDescriptor {
        operation,
        title: operation.title(),
        summary: operation.summary(),
        mutates_files: operation.mutates_files(),
        requires_workspace: operation.requires_workspace(),
        input_schema,
        output_schema,
    }
}

fn operation_schemas<I, O>() -> (Value, Value)
where
    I: JsonSchema + 'static,
    O: Serialize + JsonSchema + 'static,
{
    (
        Value::Object(generated_input_schema::<I>()),
        Value::Object(generated_output_schema::<ToolEnvelope<O>>()),
    )
}

fn parse_tool_input<T: DeserializeOwned>(arguments: Value) -> Result<T, TransformError> {
    let mut counter = CountingWriter::default();
    serde_json::to_writer(&mut counter, &arguments).map_err(|error| {
        TransformError::new(ErrorCode::Schema, "tool arguments are not valid JSON").with_details(
            json!({ "reason": bounded_text(&error.to_string(), MAX_SCHEMA_ERROR_CHARS) }),
        )
    })?;
    if counter.bytes > MAX_TOOL_ARGUMENT_BYTES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "tool arguments exceed the request byte limit",
        )
        .with_details(json!({
            "bytes": counter.bytes,
            "maximum": MAX_TOOL_ARGUMENT_BYTES,
        })));
    }
    serde_json::from_value(arguments).map_err(|error| {
        TransformError::new(
            ErrorCode::Schema,
            "tool arguments do not match the published schema",
        )
        .with_details(json!({
            "reason": bounded_text(&error.to_string(), MAX_SCHEMA_ERROR_CHARS)
        }))
    })
}

#[derive(Default)]
struct CountingWriter {
    bytes: usize,
}

impl std::io::Write for CountingWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.bytes += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn set_input_schema<T>(tool_router: &mut ToolRouter<WorldbendServer>, name: &str)
where
    T: JsonSchema + 'static,
{
    let route = tool_router
        .map
        .get_mut(name)
        .unwrap_or_else(|| panic!("missing generated tool route {name}"));
    route.attr.input_schema = Arc::new(generated_input_schema::<T>());
}

fn generated_input_schema<T>() -> Map<String, Value>
where
    T: JsonSchema + 'static,
{
    rmcp::handler::server::tool::schema_for_input::<T>()
        .unwrap_or_else(|error| panic!("invalid generated input schema: {error}"))
        .as_ref()
        .clone()
}

fn set_canvas_render_input_schema(tool_router: &mut ToolRouter<WorldbendServer>) {
    const NAME: &str = "worldbend.canvas_render";
    set_input_schema::<CanvasRenderInput>(tool_router, NAME);
    let route = tool_router
        .map
        .get_mut(NAME)
        .unwrap_or_else(|| panic!("missing generated tool route {NAME}"));
    route.attr.input_schema = Arc::new(canvas_render_input_schema());
}

fn canvas_render_input_schema() -> Map<String, Value> {
    let mut schema = generated_input_schema::<CanvasRenderInput>();
    schema.insert(
        "oneOf".to_owned(),
        json!([
            {
                "required": ["source", "outputDirectory", "spec"],
                "not": {
                    "anyOf": [
                        { "required": ["plan"] },
                        { "required": ["sampling"] },
                        { "required": ["outsideFill"] }
                    ]
                }
            },
            {
                "required": [
                    "source",
                    "outputDirectory",
                    "plan",
                    "sampling",
                    "outsideFill"
                ],
                "not": {
                    "anyOf": [
                        { "required": ["spec"] },
                        { "required": ["quality"] }
                    ]
                }
            }
        ]),
    );
    schema
}

fn set_output_schema<T>(tool_router: &mut ToolRouter<WorldbendServer>, name: &str)
where
    T: JsonSchema + 'static,
{
    let route = tool_router
        .map
        .get_mut(name)
        .unwrap_or_else(|| panic!("missing generated tool route {name}"));
    let output_schema = generated_output_schema::<T>();
    route.attr.output_schema = Some(Arc::new(output_schema));
}

fn generated_output_schema<T>() -> Map<String, Value>
where
    T: JsonSchema + 'static,
{
    let mut output_schema = rmcp::handler::server::tool::schema_for_output::<T>()
        .as_ref()
        .clone();
    // ToolEnvelope is always a JSON object. Keep that fact explicit for MCP
    // clients that validate outputSchema as an object schema before accepting
    // tools/list, while retaining schemars' success/failure union below it.
    output_schema.insert("type".to_owned(), json!("object"));
    output_schema
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use std::collections::HashMap;
    use worldbend_core::{
        CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasOperation, CanvasSetSpec, CanvasSpec,
        CanvasVariant, FrameRate, MOTION_SCHEMA, MOTION_VERSION, MotionEasing, MotionKeyframe,
        MotionSpec, PixelSize, Point, Quad, RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION,
        RasterProgramStage, SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, Size,
        SourceOrientation, SpatialTemplateOperation, SpatialTemplateOutput, TIMELINE_SCHEMA,
        TIMELINE_VERSION, TimelineFrame, TimelineProgram, TimelineSpec, TransformSpec,
        VARIATION_JOB_SCHEMA, VariationBinding, VariationJobItem, plan_canvas_set,
    };
    use worldbend_render::{
        CanvasSetRenderedItem, TimelineRenderOptions, render_motion_files, render_timeline_files,
        render_variation_job_files,
    };

    fn variation_spec(item_ids: &[&str]) -> VariationJobSpec {
        VariationJobSpec {
            schema: VARIATION_JOB_SCHEMA.to_owned(),
            version: SPATIAL_TEMPLATE_VERSION.to_owned(),
            template: SpatialTemplateSpec {
                schema: SPATIAL_TEMPLATE_SCHEMA.to_owned(),
                version: SPATIAL_TEMPLATE_VERSION.to_owned(),
                operation: SpatialTemplateOperation::RasterProgram {
                    source_slot: "artwork".to_owned(),
                    program: RasterProgramSpec {
                        schema: RASTER_PROGRAM_SCHEMA.to_owned(),
                        version: RASTER_PROGRAM_VERSION.to_owned(),
                        stages: vec![RasterProgramStage::Canvas {
                            id: "fit".to_owned(),
                            spec: CanvasSpec {
                                schema: worldbend_core::CANVAS_SCHEMA.to_owned(),
                                version: CANVAS_VERSION.to_owned(),
                                operation: CanvasOperation::Stretch {
                                    output: PixelSize::new(4, 4),
                                },
                            },
                        }],
                    },
                },
                output: SpatialTemplateOutput::Single {
                    id: "hero".to_owned(),
                },
            },
            items: item_ids
                .iter()
                .map(|id| VariationJobItem {
                    id: (*id).to_owned(),
                    bindings: vec![VariationBinding {
                        slot_id: "artwork".to_owned(),
                        asset_id: "asset-a".to_owned(),
                    }],
                })
                .collect(),
        }
    }

    fn timeline_spec() -> TimelineSpec {
        TimelineSpec {
            schema: TIMELINE_SCHEMA.to_owned(),
            version: TIMELINE_VERSION.to_owned(),
            output: PixelSize::new(2, 2),
            program: TimelineProgram::Frames {
                frames: vec![TimelineFrame {
                    id: "frame-1".to_owned(),
                    source_id: "still".to_owned(),
                    transform: TransformSpec::normalized(Quad::unit()),
                }],
            },
        }
    }

    fn motion_spec() -> MotionSpec {
        MotionSpec {
            schema: MOTION_SCHEMA.to_owned(),
            version: MOTION_VERSION.to_owned(),
            output: PixelSize::new(2, 2),
            timebase: FrameRate {
                numerator: 24,
                denominator: 1,
            },
            source_id: "still".to_owned(),
            frame_count: 2,
            base: TransformSpec::pixel(Size::new(2.0, 2.0), Quad::unit()),
            keyframes: vec![
                MotionKeyframe {
                    frame: 0,
                    quad: Quad::new(
                        Point::new(0.0, 0.0),
                        Point::new(2.0, 0.0),
                        Point::new(2.0, 2.0),
                        Point::new(0.0, 2.0),
                    ),
                    easing_to_next: Some(MotionEasing::Linear),
                },
                MotionKeyframe {
                    frame: 1,
                    quad: Quad::new(
                        Point::new(0.25, 0.0),
                        Point::new(2.0, 0.0),
                        Point::new(2.0, 2.0),
                        Point::new(0.25, 2.0),
                    ),
                    easing_to_next: None,
                },
            ],
        }
    }

    #[test]
    fn private_staging_root_accepts_only_a_writable_absolute_directory_outside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let workspace_root = fs::canonicalize(workspace.path()).unwrap();
        let private = tempfile::tempdir().unwrap();
        let private_root = fs::canonicalize(private.path()).unwrap();

        assert_eq!(
            resolve_private_staging_root(Some(private.path()), Some(&workspace_root)).unwrap(),
            private_root
        );

        let relative_error = resolve_private_staging_root(
            Some(Path::new("relative-staging")),
            Some(&workspace_root),
        )
        .unwrap_err();
        assert!(relative_error.to_string().contains("absolute path"));

        let nested = workspace.path().join("private-staging");
        fs::create_dir(&nested).unwrap();
        let nested_error =
            resolve_private_staging_root(Some(&nested), Some(&workspace_root)).unwrap_err();
        assert!(
            nested_error
                .to_string()
                .contains("outside the granted workspace")
        );

        let file = private.path().join("not-a-directory");
        fs::write(&file, b"file").unwrap();
        let file_error =
            resolve_private_staging_root(Some(&file), Some(&workspace_root)).unwrap_err();
        assert!(file_error.to_string().contains("directory"));

        let missing = private.path().join("missing-directory");
        let missing_error =
            resolve_private_staging_root(Some(&missing), Some(&workspace_root)).unwrap_err();
        assert!(missing_error.to_string().contains("not accessible"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            let unwritable = private.path().join("unwritable-directory");
            fs::create_dir(&unwritable).unwrap();
            fs::set_permissions(&unwritable, fs::Permissions::from_mode(0o500)).unwrap();
            let unwritable_error =
                resolve_private_staging_root(Some(&unwritable), Some(&workspace_root)).unwrap_err();
            fs::set_permissions(&unwritable, fs::Permissions::from_mode(0o700)).unwrap();
            assert!(unwritable_error.to_string().contains("not writable"));
        }
    }

    #[test]
    fn private_staging_root_is_read_once_at_server_startup() {
        let source = include_str!("main.rs");
        let environment_read = [
            "std::env::var_os(",
            "\"WORLDBEND_PRIVATE_STAGING_ROOT\"",
            ")",
        ]
        .concat();
        assert_eq!(source.matches(&environment_read).count(), 1);
    }

    #[test]
    fn public_tool_registry_has_eight_direct_bounded_tools() {
        let server = WorldbendServer::new(None);
        let tools = server.tool_router.list_all();
        let mut names = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>();
        names.sort_unstable();
        assert_eq!(
            names,
            [
                "worldbend.canvas_render",
                "worldbend.compose",
                "worldbend.css",
                "worldbend.inspect",
                "worldbend.rectify",
                "worldbend.rectify_render",
                "worldbend.render",
                "worldbend.solve"
            ]
        );
        let complete_tools_list = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "tools": &tools }
        });
        let catalog_bytes = serde_json::to_vec(&complete_tools_list).unwrap().len();
        assert!(
            catalog_bytes <= MAX_TOOL_CATALOG_BYTES,
            "complete tools/list is {catalog_bytes} bytes; budget is {MAX_TOOL_CATALOG_BYTES}"
        );
        for tool in tools {
            assert!(tool.input_schema.contains_key("properties"));
            assert_eq!(
                tool.output_schema
                    .as_ref()
                    .and_then(|schema| schema.get("type")),
                Some(&json!("object"))
            );
            assert_eq!(
                tool.annotations.as_ref().and_then(|a| a.open_world_hint),
                Some(false)
            );
        }
    }

    #[test]
    fn progressive_catalog_is_small_closed_and_exactly_describable() {
        let server = WorldbendServer::new_with_surface(None, ToolSurface::Catalog);
        let tools = server.tool_router.list_all();
        let mut names = tools
            .iter()
            .map(|tool| tool.name.as_ref())
            .collect::<Vec<_>>();
        names.sort_unstable();
        assert_eq!(
            names,
            ["worldbend.describe", "worldbend.run", "worldbend.search"]
        );
        let complete_tools_list = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "tools": &tools }
        });
        let catalog_bytes = serde_json::to_vec(&complete_tools_list).unwrap().len();
        assert!(
            catalog_bytes <= MAX_PROGRESSIVE_TOOL_CATALOG_BYTES,
            "progressive tools/list is {catalog_bytes} bytes; budget is {MAX_PROGRESSIVE_TOOL_CATALOG_BYTES}"
        );
        for tool in tools {
            assert_eq!(
                tool.annotations.as_ref().and_then(|a| a.open_world_hint),
                Some(false)
            );
        }

        let search = search_operation_catalog(SearchInput {
            query: "flatten plane".to_owned(),
            limit: 8,
        })
        .unwrap();
        assert_eq!(search.total_matches, 4);
        assert_eq!(
            search
                .operations
                .iter()
                .map(|operation| operation.operation)
                .collect::<Vec<_>>(),
            [
                OperationId::Rectify,
                OperationId::RectifyRender,
                OperationId::MockupExtractPlan,
                OperationId::MockupExtractRender
            ]
        );

        let canvas = describe_operation(OperationId::CanvasRender);
        assert_eq!(canvas.operation, OperationId::CanvasRender);
        assert_eq!(canvas.input_schema["type"], "object");
        assert!(canvas.input_schema.get("oneOf").is_some());
        assert_eq!(canvas.output_schema["type"], "object");

        let program = describe_operation(OperationId::ProgramRender);
        assert_eq!(program.operation, OperationId::ProgramRender);
        let program_schema = serde_json::to_string(&program.input_schema).unwrap();
        assert!(program_schema.contains(r#""const":"worldbend.raster-program""#));
        assert!(program_schema.contains(r#""maximum":67108864"#));
        assert!(program_schema.contains(r#""transform""#));
        assert!(program_schema.contains(r#""rectify""#));
        assert!(program_schema.contains(r#""canvas""#));
        assert_eq!(program.output_schema["type"], "object");
    }

    #[test]
    fn variation_operations_are_searchable_and_publish_closed_agent_limits() {
        let search = search_operation_catalog(SearchInput {
            query: "variation job".to_owned(),
            limit: 8,
        })
        .unwrap();
        assert_eq!(search.total_matches, 2);
        assert_eq!(
            search
                .operations
                .iter()
                .map(|operation| operation.operation)
                .collect::<Vec<_>>(),
            [OperationId::VariationPlan, OperationId::VariationRender]
        );

        let descriptor = describe_operation(OperationId::VariationRender);
        let schema = serde_json::to_string(&descriptor.input_schema).unwrap();
        assert!(schema.contains(r#""const":"worldbend.variation-job""#));
        assert!(schema.contains(r#""const":"worldbend.spatial-template""#));
        assert!(schema.contains(r#""maximum":33554432"#));
        assert!(schema.contains(r#""maximum":67108864"#));
        assert!(schema.contains("outputDirectory"));
        assert_eq!(descriptor.output_schema["type"], "object");
    }

    #[test]
    fn production_media_operations_publish_precision_vector_and_tiling_boundaries() {
        let inspect = describe_operation(OperationId::MediaInspect);
        let inspect_schema = serde_json::to_string(&inspect.input_schema).unwrap();
        assert!(inspect.requires_workspace);
        assert!(!inspect.mutates_files);
        assert!(inspect_schema.contains(&format!(r#""maximum":{MCP_MAX_MEDIA_PIXELS}"#)));

        let media = describe_operation(OperationId::MediaRender);
        let media_schema = serde_json::to_string(&media.input_schema).unwrap();
        for value in [
            "png",
            "jpeg",
            "webpLossless",
            "tiff",
            "u16",
            "f32",
            "preserve",
            "discard",
        ] {
            assert!(
                media_schema.contains(value),
                "media schema is missing {value}"
            );
        }

        let vector = describe_operation(OperationId::VectorRender);
        let vector_schema = serde_json::to_string(&vector.input_schema).unwrap();
        assert!(vector_schema.contains(r#""enum":["svg","html"]"#));
        assert!(vector_schema.contains(&MAX_VECTOR_SOURCE_BYTES.to_string()));

        let tiled = describe_operation(OperationId::TiledMediaRender);
        let tiled_schema = serde_json::to_string(&tiled.input_schema).unwrap();
        assert!(tiled_schema.contains(&MCP_MAX_TILED_PIXELS.to_string()));
        assert!(tiled_schema.contains(&MCP_MAX_TILED_ENCODED_BYTES.to_string()));
        assert!(tiled_schema.contains(r#""maximum":4096"#));
        assert_eq!(tiled.output_schema["type"], "object");

        assert!(
            validate_media_output_extension(
                "out/result.jpeg",
                &MediaOutput::Jpeg {
                    quality: 90,
                    matte: [255, 255, 255],
                    icc: worldbend_render::IccPolicy::Discard,
                },
            )
            .is_ok()
        );
        assert_eq!(
            validate_media_output_extension(
                "out/result.png",
                &MediaOutput::Jpeg {
                    quality: 90,
                    matte: [255, 255, 255],
                    icc: worldbend_render::IccPolicy::Discard,
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Schema
        );
        assert!(validate_vector_output_extension("out/result.htm", VectorCarrier::Html).is_ok());
        assert_eq!(
            validate_vector_output_extension("out/result.svg", VectorCarrier::Html)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );

        let perception = describe_operation(OperationId::PlaneCandidates);
        assert!(perception.requires_workspace);
        assert!(!perception.mutates_files);
        let perception_input = serde_json::to_string(&perception.input_schema).unwrap();
        let perception_output = serde_json::to_string(&perception.output_schema).unwrap();
        for value in [
            "worldbend.perception-plane-request",
            "contrastQuadV1",
            "alphaQuadV1",
            "analysisMaxAxis",
        ] {
            assert!(
                perception_input.contains(value),
                "perception input schema is missing {value}"
            );
        }
        assert!(perception_input.contains(r#""maximum":3"#));
        for value in [
            "worldbend.perception-plane-candidates",
            "confidence",
            "uncertainty",
            "automaticExecution",
            "sourcePlane",
        ] {
            assert!(
                perception_output.contains(value),
                "perception output schema is missing {value}"
            );
        }
    }

    #[test]
    fn variation_agent_projection_rejects_a_response_set_above_128_outputs() {
        let mut spec = variation_spec(&[
            "sku-1", "sku-2", "sku-3", "sku-4", "sku-5", "sku-6", "sku-7", "sku-8", "sku-9",
        ]);
        spec.template.output = SpatialTemplateOutput::CanvasSet {
            spec: CanvasSetSpec {
                schema: CANVAS_SET_SCHEMA.to_owned(),
                version: CANVAS_VERSION.to_owned(),
                variants: (0..16)
                    .map(|index| CanvasVariant {
                        id: format!("out-{index}"),
                        operation: CanvasOperation::Stretch {
                            output: PixelSize::new(1, 1),
                        },
                    })
                    .collect(),
            },
        };
        let error = VariationRenderRequest::try_from(VariationRenderInput {
            assets: vec![VariationAssetInput {
                id: "asset-a".to_owned(),
                source: "asset.png".to_owned(),
            }],
            spec,
            output_directory: "outputs/job".to_owned(),
            options: VariationRenderOptionsInput::default(),
            dry_run: false,
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(error.details.unwrap()["outputCount"], json!(144));
    }

    #[test]
    fn variation_controller_rehashes_nested_outputs_and_rewrites_portable_labels() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("asset.png");
        RgbaImage::from_pixel(2, 2, Rgba([12, 34, 56, 255]))
            .save(&source)
            .unwrap();
        let staged_output = directory.path().join("worker-result");
        let assets = HashMap::from([("asset-a".to_owned(), source)]);
        let mut result = render_variation_job_files(
            &assets,
            &variation_spec(&["sku-a", "sku-b"]),
            &staged_output,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap();

        normalize_variation_worker_result(
            &mut result,
            &staged_output,
            "outputs/job",
            false,
            &|| false,
        )
        .unwrap();
        assert_eq!(
            result.items[0].outputs[0].output,
            "outputs/job/sku-a/hero.png"
        );

        fs::write(staged_output.join("sku-a/hero.png"), b"tampered").unwrap();
        let error = normalize_variation_worker_result(
            &mut result,
            &staged_output,
            "outputs/job",
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[test]
    fn sequence_controllers_rehash_outputs_instead_of_trusting_reported_digests() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.png");
        RgbaImage::from_pixel(2, 2, Rgba([12, 34, 56, 255]))
            .save(&source)
            .unwrap();
        let sources = HashMap::from([("still".to_owned(), source)]);

        let timeline_output = directory.path().join("timeline-worker-result");
        let mut timeline = render_timeline_files(
            &sources,
            &timeline_spec(),
            &timeline_output,
            TimelineRenderOptions::default(),
            false,
        )
        .unwrap();
        normalize_timeline_worker_result(
            &mut timeline,
            &timeline_output,
            "outputs/timeline",
            false,
            &|| false,
        )
        .unwrap();
        corrupt_file_without_changing_length(&timeline_output.join("frame-1.png"));
        let timeline_error = normalize_timeline_worker_result(
            &mut timeline,
            &timeline_output,
            "outputs/timeline",
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(timeline_error.code, ErrorCode::Internal);

        let motion_output = directory.path().join("motion-worker-result");
        let mut motion = render_motion_files(
            &sources,
            &motion_spec(),
            &motion_output,
            TimelineRenderOptions::default(),
            false,
        )
        .unwrap();
        normalize_motion_worker_result(
            &mut motion,
            &motion_output,
            "outputs/motion",
            false,
            &|| false,
        )
        .unwrap();
        corrupt_file_without_changing_length(&motion_output.join("frame-000001.png"));
        let motion_error = normalize_motion_worker_result(
            &mut motion,
            &motion_output,
            "outputs/motion",
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(motion_error.code, ErrorCode::Internal);
    }

    #[tokio::test]
    async fn single_output_controller_rejects_same_length_digest_mismatch() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("result.png");
        fs::write(&output, b"first").unwrap();
        let reported_sha256 = format!("{:x}", Sha256::digest(b"first"));

        verify_worker_output(
            output.clone(),
            "test worker",
            5,
            reported_sha256.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();

        fs::write(&output, b"other").unwrap();
        let error = verify_worker_output(
            output,
            "test worker",
            5,
            reported_sha256,
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
    }

    #[test]
    fn canvas_controller_rejects_same_length_digest_mismatch() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("square.png");
        fs::write(&output, b"first").unwrap();
        let spec: CanvasSetSpec = serde_json::from_value(json!({
            "schema": "worldbend.canvas-set",
            "version": "0.1",
            "variants": [{
                "id": "square",
                "operation": {
                    "kind": "stretch",
                    "output": { "width": 2, "height": 2 }
                }
            }]
        }))
        .unwrap();
        let mut result = CanvasSetFileRenderResult {
            status: CanvasSetRenderStatus::Ready,
            dry_run: true,
            output_directory: directory.path().to_string_lossy().into_owned(),
            plan: plan_canvas_set(&spec, PixelSize::new(2, 2)).unwrap(),
            items: vec![CanvasSetRenderedItem {
                id: "square".to_owned(),
                output: output.to_string_lossy().into_owned(),
                bytes: 5,
                sha256: format!("{:x}", Sha256::digest(b"first")),
                width: 2,
                height: 2,
            }],
        };

        normalize_canvas_worker_result(
            &mut result,
            directory.path(),
            "sets/social",
            false,
            &|| false,
        )
        .unwrap();
        fs::write(output, b"other").unwrap();
        let error = normalize_canvas_worker_result(
            &mut result,
            directory.path(),
            "sets/social",
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Internal);
    }

    fn corrupt_file_without_changing_length(path: &Path) {
        let mut bytes = fs::read(path).unwrap();
        let index = bytes.len() / 2;
        bytes[index] ^= 0x01;
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn output_verification_hashing_honors_cancellation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("output.png");
        fs::write(&path, vec![0_u8; 256 * 1024]).unwrap();
        let error = hash_regular_file(&path, "test worker", &|| true).unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        hash_regular_file(&path, "test worker", &|| false).unwrap();
    }

    #[test]
    fn published_schemas_express_canonical_variants_limits_and_result_state() {
        let server = WorldbendServer::new(None);
        let tools = server.tool_router.list_all();
        let solve = tools
            .iter()
            .find(|tool| tool.name == "worldbend.solve")
            .unwrap();
        let solve_schema = serde_json::to_string(&solve.input_schema).unwrap();
        assert!(solve_schema.contains(r#""const":"pixel""#));
        assert!(solve_schema.contains(r#""const":"normalized""#));

        let inspect = tools
            .iter()
            .find(|tool| tool.name == "worldbend.inspect")
            .unwrap();
        let inspect_schema = serde_json::to_string(&inspect.input_schema).unwrap();
        assert!(inspect_schema.contains(r#""const":"worldbend.transform""#));
        assert!(inspect_schema.contains(r#""const":"0.1""#));

        let rectify = tools
            .iter()
            .find(|tool| tool.name == "worldbend.rectify")
            .unwrap();
        let rectify_schema = serde_json::to_string(&rectify.input_schema).unwrap();
        assert!(rectify_schema.contains(r#""const":"worldbend.rectify""#));
        assert!(rectify_schema.contains(r#""const":"pixel""#));
        assert!(rectify_schema.contains(r#""const":"normalized""#));
        assert!(rectify_schema.contains(r#""minimum":1"#));

        let compose = tools
            .iter()
            .find(|tool| tool.name == "worldbend.compose")
            .unwrap();
        let compose_defs = &compose.input_schema["$defs"];
        assert_eq!(
            compose_defs["Scale2D"]["properties"]["x"]["exclusiveMinimum"],
            json!(1.0e-6)
        );
        assert_eq!(
            compose_defs["Skew2D"]["properties"]["xDegrees"]["exclusiveMinimum"],
            json!(-89.0)
        );
        assert_eq!(
            compose_defs["Skew2D"]["properties"]["yDegrees"]["exclusiveMaximum"],
            json!(89.0)
        );
        let pivot = &compose_defs["TransformRecipe"]["properties"]["pivot"];
        assert_eq!(pivot["default"], json!({ "x": 0.5, "y": 0.5 }));
        assert!(
            pivot["description"]
                .as_str()
                .is_some_and(|description| description.contains("never destination pixel"))
        );
        assert!(
            compose.description.as_deref().is_some_and(
                |description| description.contains("Omit pivot for the default center")
            )
        );
        let compose_output =
            serde_json::to_string(compose.output_schema.as_ref().unwrap()).unwrap();
        for artifact in [
            "rawQuad",
            "rawBounds",
            "canvas",
            "spec",
            "matrix",
            "diagnostics",
        ] {
            assert!(
                compose_output.contains(artifact),
                "compose output schema is missing {artifact}"
            );
        }

        let render = tools
            .iter()
            .find(|tool| tool.name == "worldbend.render")
            .unwrap();
        let render_schema = serde_json::to_string(&render.input_schema).unwrap();
        assert!(render_schema.contains(&format!(r#""maximum":{MCP_MAX_AXIS}"#)));
        assert!(render_schema.contains(&format!(r#""maximum":{MCP_MAX_PIXELS}"#)));
        for field in ["overwrite", "dryRun"] {
            assert!(
                render.input_schema["properties"][field]["description"]
                    .as_str()
                    .is_some_and(|description| !description.is_empty()),
                "render.{field} must explain its side-effect contract"
            );
        }
        assert!(
            render.input_schema["$defs"]["RenderOptionsInput"]["properties"]["targetSize"]
                ["description"]
                .as_str()
                .is_some_and(|description| description.contains("normalized"))
        );
        let render_limits = &render.input_schema["$defs"]["RenderLimitsInput"];
        assert!(render_limits.get("required").is_none());

        let rectify_render = tools
            .iter()
            .find(|tool| tool.name == "worldbend.rectify_render")
            .unwrap();
        let rectify_render_schema = serde_json::to_string(&rectify_render.input_schema).unwrap();
        assert!(rectify_render_schema.contains(&format!(r#""maximum":{MCP_MAX_PIXELS}"#)));
        assert!(!rectify_render_schema.contains(r#""canvas""#));
        assert!(!rectify_render_schema.contains(r#""targetSize""#));

        let canvas_render = tools
            .iter()
            .find(|tool| tool.name == "worldbend.canvas_render")
            .unwrap();
        let canvas_render_schema = serde_json::to_string(&canvas_render.input_schema).unwrap();
        assert!(canvas_render_schema.contains(r#""const":"worldbend.canvas-set""#));
        assert!(canvas_render_schema.contains(r#""const":"worldbend.canvas-set-plan""#));
        assert!(canvas_render_schema.contains(r#""outputDirectory""#));
        assert!(canvas_render_schema.contains(r#""sampling""#));
        assert!(canvas_render_schema.contains(r#""outsideFill""#));
        assert!(!canvas_render_schema.contains(r#""overwrite""#));
        assert_eq!(
            canvas_render.input_schema["oneOf"][0]["required"],
            json!(["source", "outputDirectory", "spec"])
        );
        assert_eq!(
            canvas_render.input_schema["oneOf"][0]["not"]["anyOf"],
            json!([
                { "required": ["plan"] },
                { "required": ["sampling"] },
                { "required": ["outsideFill"] }
            ])
        );
        assert_eq!(
            canvas_render.input_schema["oneOf"][1]["required"],
            json!([
                "source",
                "outputDirectory",
                "plan",
                "sampling",
                "outsideFill"
            ])
        );
        assert_eq!(
            canvas_render.input_schema["oneOf"][1]["not"]["anyOf"],
            json!([
                { "required": ["spec"] },
                { "required": ["quality"] }
            ])
        );
        assert_eq!(
            canvas_render
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.read_only_hint),
            Some(false)
        );
        assert_eq!(
            canvas_render
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.destructive_hint),
            Some(false)
        );
        assert_eq!(
            canvas_render
                .annotations
                .as_ref()
                .and_then(|annotations| annotations.idempotent_hint),
            Some(false)
        );
        let canvas_output =
            serde_json::to_string(canvas_render.output_schema.as_ref().unwrap()).unwrap();
        for field in [
            "outputDirectory",
            "plan",
            "items",
            "sha256",
            "width",
            "height",
        ] {
            assert!(
                canvas_output.contains(field),
                "canvas output schema is missing {field}"
            );
        }

        let render_output = render.output_schema.as_ref().unwrap();
        let render_output_defs = &render_output["$defs"];
        for field in [
            &render_output_defs["CanvasPlacement"]["properties"]["width"],
            &render_output_defs["CanvasPlacement"]["properties"]["height"],
            &render_output_defs["RenderDiagnostics"]["properties"]["sourceWidth"],
            &render_output_defs["RenderDiagnostics"]["properties"]["sourceHeight"],
            &render_output_defs["RenderEvidence"]["properties"]["outputWidth"],
            &render_output_defs["RenderEvidence"]["properties"]["outputHeight"],
        ] {
            assert_eq!(field["type"], json!("integer"));
            assert_eq!(field["minimum"], json!(1));
            assert_eq!(field["maximum"], json!(u32::MAX));
            assert!(field.get("format").is_none());
        }
        let output_bytes = &render_output_defs["FileRenderResult"]["properties"]["bytes"];
        assert_eq!(output_bytes["type"], json!("integer"));
        assert_eq!(output_bytes["minimum"], json!(0));
        assert_eq!(output_bytes["maximum"], json!(9_007_199_254_740_991_u64));
        assert!(output_bytes.get("format").is_none());

        let css = tools
            .iter()
            .find(|tool| tool.name == "worldbend.css")
            .unwrap();
        assert!(
            css.description
                .as_deref()
                .is_some_and(|description| description.contains("destinationSize"))
        );
        assert!(
            css.input_schema["properties"]["destinationSize"]["description"]
                .as_str()
                .is_some_and(|description| description.contains("normalized"))
        );

        for tool in tools {
            let output_schema =
                serde_json::to_string(tool.output_schema.as_ref().unwrap()).unwrap();
            assert!(output_schema.contains(r#""const":true"#));
            assert!(output_schema.contains(r#""const":false"#));
        }
    }

    #[test]
    fn compose_input_accepts_explicit_flips_in_the_recipe() {
        // The recipe surface carries orientation flips as explicit booleans;
        // unknown orientation spellings stay rejected at the tool boundary.
        let input: ComposeInput = serde_json::from_value(json!({
            "spec": {
                "schema": "worldbend.transform",
                "version": "0.1",
                "destination": {
                    "space": "normalized",
                    "quad": {
                        "tl": { "x": 0.0, "y": 0.0 },
                        "tr": { "x": 1.0, "y": 0.0 },
                        "br": { "x": 1.0, "y": 1.0 },
                        "bl": { "x": 0.0, "y": 1.0 }
                    }
                }
            },
            "targetSize": { "width": 100, "height": 50 },
            "transform": {
                "flip": { "x": true, "y": false },
                "warp": { "preset": "arc", "amount": 0.75 }
            }
        }))
        .unwrap();
        assert!(input.transform.flip.x);
        assert!(!input.transform.flip.y);
        assert_eq!(input.transform.warp.map(|warp| warp.amount), Some(0.75));

        let composed = compose_affine(&input.spec, input.target_size, input.transform).unwrap();
        assert_eq!(
            composed.spec.content.orientation,
            SourceOrientation::FlipHorizontal
        );
        assert_eq!(
            composed.spec.content.warp.map(|warp| warp.preset),
            Some(worldbend_core::WarpPreset::Arc)
        );

        let bad: Result<ComposeInput, _> = serde_json::from_value(json!({
            "spec": {
                "schema": "worldbend.transform",
                "version": "0.1",
                "destination": {
                    "space": "normalized",
                    "quad": {
                        "tl": { "x": 0.0, "y": 0.0 },
                        "tr": { "x": 1.0, "y": 0.0 },
                        "br": { "x": 1.0, "y": 1.0 },
                        "bl": { "x": 0.0, "y": 1.0 }
                    }
                }
            },
            "transform": { "flip": { "x": true, "diagonal": true } }
        }));
        assert!(bad.is_err());
    }

    #[test]
    fn compose_input_clears_warp_only_when_explicit() {
        let base = json!({
            "schema": "worldbend.transform",
            "version": "0.1",
            "destination": {
                "space": "normalized",
                "quad": {
                    "tl": { "x": 0.0, "y": 0.0 },
                    "tr": { "x": 1.0, "y": 0.0 },
                    "br": { "x": 1.0, "y": 1.0 },
                    "bl": { "x": 0.0, "y": 1.0 }
                }
            },
            "content": {
                "fit": "stretch",
                "warp": { "preset": "wave", "amount": 0.5 }
            }
        });
        let input: ComposeInput = serde_json::from_value(json!({
            "spec": base.clone(),
            "targetSize": { "width": 100, "height": 50 },
            "transform": { "clearWarp": true }
        }))
        .unwrap();
        let composed = compose_affine(&input.spec, input.target_size, input.transform).unwrap();
        assert_eq!(composed.spec.content.warp, None);

        let conflicting: ComposeInput = serde_json::from_value(json!({
            "spec": base,
            "targetSize": { "width": 100, "height": 50 },
            "transform": {
                "clearWarp": true,
                "warp": { "preset": "arc", "amount": 0.5 }
            }
        }))
        .unwrap();
        assert_eq!(
            compose_affine(
                &conflicting.spec,
                conflicting.target_size,
                conflicting.transform
            )
            .unwrap_err()
            .code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn successful_text_summaries_name_the_usable_result() {
        assert_eq!(
            success_summary(&json!({
                "status": "written",
                "output": "out/result.png",
                "bytes": 1234,
                "evidence": { "outputWidth": 640, "outputHeight": 360 }
            })),
            "Render written: out/result.png (640x360, 1234 bytes)."
        );
        assert_eq!(
            success_summary(&json!({
                "status": "ready",
                "outputDirectory": "out/social",
                "items": [{}, {}]
            })),
            "Canvas Set ready: 2 ordered outputs in out/social."
        );
        assert_eq!(
            success_summary(&json!({
                "outcome": "noCandidate",
                "provider": { "id": "worldbend.alpha-quad-v1" },
                "candidates": []
            })),
            "Plane assessment noCandidate: 0 candidates from worldbend.alpha-quad-v1; no transform applied."
        );
    }

    #[tokio::test]
    async fn filesystem_preflight_returns_stable_errors_before_capacity() {
        let root = tempfile::tempdir().unwrap();
        fs::write(
            root.path().join("source.png"),
            b"not decoded during preflight",
        )
        .unwrap();
        fs::write(root.path().join("existing.png"), b"existing").unwrap();
        let server = WorldbendServer::new(Some(WorkspaceRoot::open(root.path()).unwrap()));
        let _held = (0..MAX_IN_FLIGHT_RENDERS)
            .map(|_| {
                server
                    .render_admissions
                    .clone()
                    .try_acquire_owned()
                    .unwrap()
            })
            .collect::<Vec<_>>();
        let spec = TransformSpec::pixel(
            Size::new(2.0, 2.0),
            Quad::new(
                Point::new(0.0, 0.0),
                Point::new(2.0, 0.0),
                Point::new(2.0, 2.0),
                Point::new(0.0, 2.0),
            ),
        );
        let arguments = |source: &str, output: &str| {
            json!({ "source": source, "spec": spec, "output": output })
                .as_object()
                .unwrap()
                .clone()
        };

        let escaped = server
            .render(
                Parameters(arguments("../source.png", "out.png")),
                CancellationToken::new(),
            )
            .await;
        assert!(matches!(
            escaped,
            ToolEnvelope::Failure {
                error: TransformError {
                    code: ErrorCode::PathOutsideRoot,
                    ..
                },
                ..
            }
        ));

        let exists = server
            .render(
                Parameters(arguments("source.png", "existing.png")),
                CancellationToken::new(),
            )
            .await;
        match exists {
            ToolEnvelope::Failure { error, .. } => {
                assert_eq!(error.code, ErrorCode::DestinationExists);
                assert!(error.message.contains("overwrite"));
            }
            ToolEnvelope::Success { .. } => panic!("existing destination must fail preflight"),
        }

        let capacity = server
            .render(
                Parameters(arguments("source.png", "new.png")),
                CancellationToken::new(),
            )
            .await;
        match capacity {
            ToolEnvelope::Failure { error, .. } => {
                assert_eq!(error.code, ErrorCode::Capacity);
                assert_eq!(error.details.unwrap()["retryable"], json!(true));
            }
            ToolEnvelope::Success { .. } => panic!("full admission must fail"),
        }
    }

    #[test]
    fn malformed_arguments_are_bounded_stable_schema_errors() {
        let unknown = "x".repeat(MAX_SCHEMA_ERROR_CHARS * 2);
        let error = parse_tool_input::<SolveInput>(json!({ unknown: true })).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(
            error.message,
            "tool arguments do not match the published schema"
        );
        let details = error.details.unwrap().to_string();
        assert!(details.chars().count() <= MAX_SCHEMA_ERROR_CHARS + 32);
    }

    #[test]
    fn complete_call_tool_result_is_bounded_and_not_json_duplicated() {
        let envelope: ToolEnvelope<SolveOutput> = ToolEnvelope::Failure {
            ok: false,
            error: TransformError::new(ErrorCode::Schema, "x".repeat(MAX_TOOL_RESPONSE_BYTES)),
        };
        let response = envelope.into_call_tool_result().unwrap();
        let CallToolResponse::Complete(result) = response else {
            panic!("expected a complete tool response")
        };
        assert!(serde_json::to_vec(&result).unwrap().len() <= MAX_TOOL_RESPONSE_BYTES);
        assert_eq!(result.is_error, Some(true));
        assert_eq!(
            result.structured_content.as_ref().unwrap()["error"]["code"],
            "E_OUTPUT_LIMIT"
        );
        let ContentBlock::Text(text) = &result.content[0] else {
            panic!("expected a concise text summary")
        };
        assert!(text.text.len() < 256);
    }

    #[test]
    fn render_limit_runtime_errors_match_schema_and_resource_boundaries() {
        let partial: RenderLimitsInput =
            serde_json::from_value(json!({ "maxWidth": 2048 })).unwrap();
        assert_eq!(partial.max_width, 2048);
        assert_eq!(partial.max_height, MCP_MAX_AXIS);
        assert_eq!(partial.max_pixels, MCP_MAX_PIXELS);
        assert_eq!(partial.max_source_bytes, MCP_MAX_SOURCE_BYTES);

        let zero = RenderLimitsInput {
            max_width: 0,
            ..RenderLimitsInput::default()
        };
        assert_eq!(
            RenderLimits::try_from(zero).unwrap_err().code,
            ErrorCode::Schema
        );

        let excessive = RenderLimitsInput {
            max_width: MCP_MAX_AXIS + 1,
            ..RenderLimitsInput::default()
        };
        assert_eq!(
            RenderLimits::try_from(excessive).unwrap_err().code,
            ErrorCode::OutputLimit
        );
    }

    #[test]
    fn canvas_render_input_is_a_closed_exactly_one_program_union() {
        let spec_value = json!({
            "schema": "worldbend.canvas-set",
            "version": "0.1",
            "variants": [{
                "id": "square",
                "operation": {
                    "kind": "stretch",
                    "output": { "width": 2, "height": 2 }
                }
            }]
        });
        let spec: CanvasSetSpec = serde_json::from_value(spec_value.clone()).unwrap();
        let plan = plan_canvas_set(&spec, PixelSize::new(3, 2)).unwrap();

        let spec_input = parse_tool_input::<CanvasRenderInput>(json!({
            "source": "input.png",
            "spec": spec_value,
            "outputDirectory": "outputs",
            "quality": "high",
            "dryRun": true
        }))
        .and_then(CanvasRenderRequest::try_from)
        .unwrap();
        assert!(matches!(
            spec_input.program,
            CanvasWorkerProgram::Spec {
                quality: SamplingQuality::High,
                ..
            }
        ));

        let plan_input = parse_tool_input::<CanvasRenderInput>(json!({
            "source": "control.png",
            "plan": plan,
            "outputDirectory": "control-outputs",
            "sampling": "nearest",
            "outsideFill": { "kind": "transparent" }
        }))
        .and_then(CanvasRenderRequest::try_from)
        .unwrap();
        assert!(matches!(
            plan_input.program,
            CanvasWorkerProgram::Plan {
                sampling: CanvasReplaySampling::Nearest,
                ..
            }
        ));

        for invalid in [
            json!({
                "source": "input.png",
                "spec": spec_value,
                "plan": plan_canvas_set(&spec, PixelSize::new(3, 2)).unwrap(),
                "outputDirectory": "outputs",
                "sampling": "nearest",
                "outsideFill": { "kind": "transparent" }
            }),
            json!({
                "source": "input.png",
                "plan": plan_canvas_set(&spec, PixelSize::new(3, 2)).unwrap(),
                "outputDirectory": "outputs",
                "sampling": "nearest"
            }),
            json!({
                "source": "input.png",
                "spec": spec,
                "outputDirectory": "outputs",
                "sampling": "nearest"
            }),
            json!({
                "source": "input.png",
                "spec": {
                    "schema": "worldbend.canvas-set",
                    "version": "0.1",
                    "variants": [{
                        "id": "square",
                        "operation": {
                            "kind": "stretch",
                            "output": { "width": 2, "height": 2 }
                        }
                    }]
                },
                "quality": null,
                "outputDirectory": "outputs"
            }),
            json!({
                "source": "input.png",
                "plan": null,
                "outputDirectory": "outputs",
                "sampling": "nearest",
                "outsideFill": { "kind": "transparent" }
            }),
        ] {
            assert_eq!(
                parse_tool_input::<CanvasRenderInput>(invalid)
                    .and_then(CanvasRenderRequest::try_from)
                    .unwrap_err()
                    .code,
                ErrorCode::Schema
            );
        }
    }

    #[test]
    fn canvas_encoded_set_ceiling_fails_before_publication() {
        let private = tempfile::tempdir().unwrap();
        let output = private.path().join("square.png");
        fs::File::create(&output)
            .unwrap()
            .set_len(MCP_MAX_CANVAS_ENCODED_BYTES + 1)
            .unwrap();
        let spec: CanvasSetSpec = serde_json::from_value(json!({
            "schema": "worldbend.canvas-set",
            "version": "0.1",
            "variants": [{
                "id": "square",
                "operation": {
                    "kind": "stretch",
                    "output": { "width": 2, "height": 2 }
                }
            }]
        }))
        .unwrap();
        let plan = plan_canvas_set(&spec, PixelSize::new(2, 2)).unwrap();
        let mut result = CanvasSetFileRenderResult {
            status: CanvasSetRenderStatus::Ready,
            dry_run: true,
            output_directory: private.path().to_string_lossy().into_owned(),
            plan,
            items: vec![CanvasSetRenderedItem {
                id: "square".to_owned(),
                output: output.to_string_lossy().into_owned(),
                bytes: MCP_MAX_CANVAS_ENCODED_BYTES + 1,
                sha256: "0".repeat(64),
                width: 2,
                height: 2,
            }],
        };

        let error = normalize_canvas_worker_result(
            &mut result,
            private.path(),
            "sets/social",
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(
            error.details.unwrap()["maximum"],
            json!(MCP_MAX_CANVAS_ENCODED_BYTES)
        );
        assert_eq!(result.items[0].output, "sets/social/square.png");
    }

    #[tokio::test]
    async fn bounded_worker_stream_accepts_the_limit_and_rejects_the_next_byte() {
        let mut exact = &b"1234"[..];
        assert_eq!(
            read_bounded_worker_stream(&mut exact, 4).await.unwrap(),
            b"1234"
        );

        let mut oversized = &b"12345"[..];
        let error = read_bounded_worker_stream(&mut oversized, 4)
            .await
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }

    #[tokio::test]
    async fn bounded_render_deadline_covers_queue_wait_and_releases_permits() {
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(0));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let started = Instant::now();
        let error = execute_bounded_render::<(), _>(
            "test render",
            admission,
            slots.clone(),
            Duration::from_millis(80),
            CancellationToken::new(),
            std::future::pending(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Timeout);
        assert!(error.message.contains("80 ms"));
        assert!(error.message.contains("test render"));
        assert_eq!(error.details.as_ref().unwrap()["deadlineMs"], json!(80));
        assert!(started.elapsed() >= Duration::from_millis(70));
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), 0);
    }

    #[tokio::test]
    async fn bounded_render_deadline_covers_executing_work() {
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let error = execute_bounded_render(
            "test render",
            admission,
            slots.clone(),
            Duration::from_millis(60),
            CancellationToken::new(),
            async {
                tokio::time::sleep(Duration::from_secs(30)).await;
                Ok::<(), TransformError>(())
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Timeout);
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), MAX_CONCURRENT_RENDERS);
    }

    #[tokio::test]
    async fn client_cancellation_releases_the_admission_without_waiting_for_the_deadline() {
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let cancellation = CancellationToken::new();
        let cancel_switch = cancellation.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            cancel_switch.cancel();
        });
        let started = Instant::now();
        let error = execute_bounded_render::<(), _>(
            "test render",
            admission,
            slots.clone(),
            Duration::from_secs(30),
            cancellation,
            std::future::pending(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(error.message.contains("test render"));
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), MAX_CONCURRENT_RENDERS);
    }

    #[tokio::test]
    async fn admitted_work_completes_normally() {
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let value = execute_bounded_render(
            "test render",
            admission,
            slots,
            Duration::from_secs(5),
            CancellationToken::new(),
            async { Ok::<_, TransformError>(7_u32) },
        )
        .await
        .unwrap();
        assert_eq!(value, 7);
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
    }

    #[tokio::test]
    async fn canvas_commit_is_one_sync_step_after_cancellable_work() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("square.png"), b"png").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let commit = workspace
            .prepare_output_directory("set")
            .unwrap()
            .stage_from(private.path(), worldbend_core::MAX_CANVAS_VARIANTS)
            .unwrap();
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let cancellation = CancellationToken::new();
        let work_cancellation = cancellation.child_token();

        let value = execute_bounded_directory(
            "test directory output",
            admission,
            slots.clone(),
            Duration::from_secs(5),
            cancellation,
            work_cancellation,
            async move {
                Ok::<_, TransformError>(PreparedDirectoryResult {
                    result: 7_u32,
                    commit: Some(commit),
                })
            },
        )
        .await
        .unwrap();

        assert_eq!(value, 7);
        assert_eq!(
            fs::read(root.path().join("set/square.png")).unwrap(),
            b"png"
        );
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), MAX_CONCURRENT_RENDERS);
    }

    #[tokio::test]
    async fn canvas_cancellation_before_commit_publishes_nothing_and_cleans_staging() {
        let root = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(private.path().join("square.png"), b"png").unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let commit = workspace
            .prepare_output_directory("set")
            .unwrap()
            .stage_from(private.path(), worldbend_core::MAX_CANVAS_VARIANTS)
            .unwrap();
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let cancellation = CancellationToken::new();
        let work_cancellation = cancellation.child_token();
        let cancel_before_return = cancellation.clone();

        let error = execute_bounded_directory(
            "test directory output",
            admission,
            slots.clone(),
            Duration::from_secs(5),
            cancellation,
            work_cancellation,
            async move {
                cancel_before_return.cancel();
                Ok::<_, TransformError>(PreparedDirectoryResult {
                    result: (),
                    commit: Some(commit),
                })
            },
        )
        .await
        .unwrap_err();

        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!root.path().join("set").exists());
        let residues = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|name| name.starts_with(".worldbend-directory-"))
            .collect::<Vec<_>>();
        assert!(
            residues.is_empty(),
            "unexpected Canvas staging: {residues:?}"
        );
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), MAX_CONCURRENT_RENDERS);
    }

    #[tokio::test]
    async fn canvas_cancellation_during_same_parent_copy_waits_for_cleanup() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("outputs")).unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::File::create(private.path().join("large.png"))
            .unwrap()
            .set_len(64 * 1024 * 1024)
            .unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        let target = workspace.prepare_output_directory("outputs/final").unwrap();
        let source = private.path().to_path_buf();
        let output_parent = root.path().join("outputs");
        let admissions = Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS));
        let slots = Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS));
        let admission = admissions.clone().try_acquire_owned().unwrap();
        let cancellation = CancellationToken::new();
        let work_cancellation = cancellation.child_token();
        let staging_token = work_cancellation.clone();
        let copy_observed_cancellation = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let observed_in_work = copy_observed_cancellation.clone();
        let cancel_when_hidden = cancellation.clone();

        let watcher = tokio::spawn(async move {
            loop {
                let hidden_exists = fs::read_dir(&output_parent)
                    .unwrap()
                    .flatten()
                    .any(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with(".worldbend-")
                    });
                if hidden_exists {
                    cancel_when_hidden.cancel();
                    return;
                }
                tokio::task::yield_now().await;
            }
        });
        let error = execute_bounded_directory(
            "test directory output",
            admission,
            slots.clone(),
            Duration::from_secs(5),
            cancellation,
            work_cancellation,
            async move {
                let staged = tokio::task::spawn_blocking(move || {
                    target.stage_from_with_cancel(
                        &source,
                        worldbend_core::MAX_CANVAS_VARIANTS,
                        &|| staging_token.is_cancelled(),
                    )
                })
                .await
                .unwrap();
                match staged {
                    Err(error) if error.code == ErrorCode::Cancelled => {
                        observed_in_work.store(true, std::sync::atomic::Ordering::SeqCst);
                        Err(error)
                    }
                    Err(error) => Err(error),
                    Ok(commit) => Ok(PreparedDirectoryResult {
                        result: (),
                        commit: Some(commit),
                    }),
                }
            },
        )
        .await
        .unwrap_err();
        watcher.await.unwrap();

        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(copy_observed_cancellation.load(std::sync::atomic::Ordering::SeqCst));
        assert!(!root.path().join("outputs/final").exists());
        assert!(
            fs::read_dir(root.path().join("outputs"))
                .unwrap()
                .flatten()
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".worldbend-"))
        );
        assert_eq!(admissions.available_permits(), MAX_IN_FLIGHT_RENDERS);
        assert_eq!(slots.available_permits(), MAX_CONCURRENT_RENDERS);
    }

    #[test]
    fn admission_exhaustion_is_a_fail_fast_capacity_error() {
        let server = WorldbendServer::new(None);
        let mut permits = Vec::new();
        for _ in 0..MAX_IN_FLIGHT_RENDERS {
            permits.push(
                server
                    .render_admissions
                    .clone()
                    .try_acquire_owned()
                    .unwrap(),
            );
        }
        assert!(
            server
                .render_admissions
                .clone()
                .try_acquire_owned()
                .is_err()
        );
        drop(permits);
        assert!(server.render_admissions.clone().try_acquire_owned().is_ok());
    }

    #[test]
    fn structured_error_messages_are_bounded_before_serialization() {
        let envelope: ToolEnvelope<SolveOutput> = ToolEnvelope::from_result(Err(
            TransformError::new(ErrorCode::Schema, "x".repeat(MAX_TOOL_RESPONSE_BYTES)),
        ));
        let value = serde_json::to_value(&envelope).unwrap();
        let message = value["error"]["message"].as_str().unwrap();
        assert_eq!(message.chars().count(), MAX_SCHEMA_ERROR_CHARS);
        // The stable code survives instead of flipping to the byte backstop.
        let response = envelope.into_call_tool_result().unwrap();
        let CallToolResponse::Complete(result) = response else {
            panic!("expected a complete tool response");
        };
        let structured = serde_json::to_value(&result).unwrap();
        assert_eq!(structured["structuredContent"]["error"]["code"], "E_SCHEMA");
        assert!(serde_json::to_vec(&structured).unwrap().len() <= MAX_TOOL_RESPONSE_BYTES);
    }

    #[test]
    fn worker_death_classification_separates_protocol_panic_and_memory_failures() {
        assert_eq!(
            classify_worker_failure(
                false,
                None,
                "thread 'main' panicked at src/lib.rs:1:1:\nboom",
            )
            .0,
            ErrorCode::Internal
        );
        assert_eq!(
            classify_worker_failure(false, None, "memory allocation of 1024 bytes failed").0,
            ErrorCode::Memory
        );
        assert_eq!(
            classify_worker_failure(true, None, "").0,
            ErrorCode::Internal,
            "a successful exit with a missing envelope is a protocol defect, not memory exhaustion",
        );
        assert_eq!(
            classify_worker_failure(false, None, "worker aborted").0,
            ErrorCode::Internal
        );
        #[cfg(unix)]
        {
            assert_eq!(
                classify_worker_failure(false, Some(libc::SIGXCPU), "").0,
                ErrorCode::Timeout
            );
            assert_eq!(
                classify_worker_failure(false, Some(libc::SIGKILL), "").0,
                ErrorCode::Memory
            );
        }
    }

    #[tokio::test]
    async fn panicking_tool_handler_returns_a_structured_internal_error() {
        let response = guard_tool_call(async {
            if true {
                panic!("simulated handler panic");
            }
            unreachable!()
        })
        .await
        .unwrap();
        let CallToolResponse::Complete(result) = response else {
            panic!("expected a complete tool response");
        };
        assert_eq!(result.is_error, Some(true));
        let structured = serde_json::to_value(&result).unwrap();
        assert_eq!(
            structured["structuredContent"]["error"]["code"],
            "E_INTERNAL"
        );
    }

    #[test]
    fn mcp_pixel_budget_stays_under_the_worker_memory_ceiling() {
        // Ordinary u8 source + 4/3 mip pyramid + output + one decode working
        // copy, all RGBA.
        let worst_case_bytes = MCP_MAX_PIXELS * 4 * (1 + 4 + 3 + 3) / 3;
        assert!(
            worst_case_bytes < WORKER_MEMORY_BYTES,
            "MCP_MAX_PIXELS={MCP_MAX_PIXELS} needs {worst_case_bytes} bytes worst case, above the {WORKER_MEMORY_BYTES}-byte worker ceiling"
        );

        // Production f32 source pyramid (4/3), one RGBA-f32 output, and one
        // RGBA-f32 encoder working buffer. The tiled source and tile ceilings
        // leave the same 128 MiB minimum headroom for process/runtime overhead.
        let production_media_bytes = MAX_MEDIA_PIXELS * 16 * (4 + 3 + 3) / 3;
        let tiled_media_bytes = MAX_MEDIA_PIXELS * 16 * 4 / 3 + MAX_TILED_TILE_PIXELS * 16 * 2;
        let reserved_headroom = 128 * 1024 * 1024;
        for required in [production_media_bytes, tiled_media_bytes] {
            assert!(
                required + reserved_headroom <= WORKER_MEMORY_BYTES,
                "f32 media path needs {required} bytes plus {reserved_headroom} bytes headroom, above the {WORKER_MEMORY_BYTES}-byte worker ceiling"
            );
        }
    }
}

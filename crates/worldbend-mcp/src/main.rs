mod worker_limits;

use clap::Parser;
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
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{ExitStatus, Stdio},
    sync::Arc,
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
use worldbend_agent_fs::{WorkspaceRoot, copy_source_to_private_staging};
use worldbend_core::{
    AffineComposition, Content, Destination, ErrorCode, InspectOutput, Size, SolveOutput,
    TransformError, TransformRecipe, TransformResult, TransformSpec, bounded_text, compose_affine,
    emit_css_transform, inspect_spec, solve_spec,
};
use worldbend_render::{
    CanvasMode, DEFAULT_MAX_AXIS, DEFAULT_MAX_SOURCE_BYTES, FileRenderResult, FileRenderStatus,
    RenderLimits, RenderOptions, SamplingQuality, render_file_with_source_sha256,
};

const MAX_WORKER_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_WORKER_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_TOOL_RESPONSE_BYTES: usize = 256 * 1024;
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
const MCP_MAX_SOURCE_BYTES: u64 = DEFAULT_MAX_SOURCE_BYTES;

#[derive(Debug, Parser)]
#[command(name = "worldbend-mcp", version, about = "Worldbend MCP server")]
struct Args {
    /// Explicit workspace root granted to Agent-authored render paths.
    #[arg(long)]
    root: Option<PathBuf>,
    /// Internal bounded render worker mode.
    #[arg(long, hide = true)]
    worker_render: bool,
}

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
    T: Serialize + JsonSchema + 'static,
{
    /// Build the complete `CallToolResult` exactly as the client will receive
    /// it. Shared by the final response path and the render preflight so both
    /// measure the same framing.
    fn build_complete_result(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let summary = match self {
            Self::Success { .. } => "Worldbend operation completed.".to_owned(),
            Self::Failure { error, .. } => format!(
                "{}: {}",
                error.code.as_str(),
                bounded_text(&error.message, MAX_SCHEMA_ERROR_CHARS)
            ),
        };
        let value = serde_json::to_value(self).map_err(|error| {
            rmcp::ErrorData::internal_error(
                format!("failed to serialize Worldbend tool result: {error}"),
                None,
            )
        })?;
        Ok(build_call_tool_result(value, summary, self.is_error()))
    }
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
    target_size: Option<Size>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ComposeInput {
    spec: TransformSpec,
    #[serde(default)]
    target_size: Option<Size>,
    #[serde(default)]
    transform: TransformRecipe,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct InspectInput {
    spec: TransformSpec,
    #[serde(default)]
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
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CssInput {
    spec: TransformSpec,
    element_size: Size,
    #[serde(default)]
    destination_size: Option<Size>,
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
struct RenderOptionsInput {
    #[serde(default)]
    quality: SamplingQuality,
    #[serde(default)]
    canvas: CanvasMode,
    #[serde(default)]
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

#[derive(Debug)]
struct RenderRequest {
    source: String,
    spec: TransformSpec,
    output: String,
    options: RenderOptions,
    overwrite: bool,
    dry_run: bool,
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

#[derive(Debug, Clone)]
struct WorldbendServer {
    root: Arc<Option<WorkspaceRoot>>,
    render_admissions: Arc<Semaphore>,
    render_slots: Arc<Semaphore>,
    tool_router: ToolRouter<Self>,
}

#[tool_router(router = tool_router)]
impl WorldbendServer {
    fn new(root: Option<WorkspaceRoot>) -> Self {
        let mut tool_router = Self::tool_router();
        set_input_schema::<ComposeInput>(&mut tool_router, "worldbend.compose");
        set_input_schema::<SolveInput>(&mut tool_router, "worldbend.solve");
        set_input_schema::<InspectInput>(&mut tool_router, "worldbend.inspect");
        set_input_schema::<RenderInput>(&mut tool_router, "worldbend.render");
        set_input_schema::<CssInput>(&mut tool_router, "worldbend.css");
        set_output_schema::<ToolEnvelope<AffineComposition>>(&mut tool_router, "worldbend.compose");
        set_output_schema::<ToolEnvelope<SolveOutput>>(&mut tool_router, "worldbend.solve");
        set_output_schema::<ToolEnvelope<InspectOutput>>(&mut tool_router, "worldbend.inspect");
        set_output_schema::<ToolEnvelope<FileRenderResult>>(&mut tool_router, "worldbend.render");
        set_output_schema::<ToolEnvelope<worldbend_core::CssTransform>>(
            &mut tool_router,
            "worldbend.css",
        );
        Self {
            root: Arc::new(root),
            render_admissions: Arc::new(Semaphore::new(MAX_IN_FLIGHT_RENDERS)),
            render_slots: Arc::new(Semaphore::new(MAX_CONCURRENT_RENDERS)),
            tool_router,
        }
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
            (Some(root), Ok(input)) => match self.render_admissions.clone().try_acquire_owned() {
                Err(_) => Err(TransformError::new(
                    ErrorCode::Capacity,
                    "render capacity is full; retry after current work completes",
                )),
                Ok(admission) => {
                    let remaining = WORKER_TIMEOUT.saturating_sub(started.elapsed());
                    execute_bounded_render(
                        admission,
                        self.render_slots.clone(),
                        remaining,
                        cancellation,
                        run_render_worker(root, input),
                    )
                    .await
                }
            },
        };
        ToolEnvelope::from_result(result)
    }

    /// Emit CSS matrix3d values for a live image, video, iframe, canvas, or DOM element.
    #[tool(
        name = "worldbend.css",
        description = "Emit a frontend-native CSS matrix3d transform for a live element using the same explicit TransformSpec plane geometry. Non-projective Warp specs are rejected; render pixels or use the WebGL mesh path instead.",
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
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("worldbend", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Use one direct Worldbend tool for semantic transform composition, explicit plane geometry, bounded common Warp presets, inspection, render, or CSS. Plane detection and custom mesh warp are not provided. Corner order is always TL, TR, BR, BL.",
            )
    }
}

/// Run one admitted render while honoring queue fairness, the whole-call
/// deadline, and client cancellation. The admission permit is dropped with the
/// future on every exit path; the worker permit and its process (via
/// `kill_on_drop`) and staging directory follow the same drop.
async fn execute_bounded_render<T, F>(
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
            "render was cancelled by the client before completion",
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
            Err(_) => Err(TransformError::new(
                ErrorCode::Timeout,
                "render exceeded the whole-call deadline while queued or executing",
            )),
        },
    }
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
struct WorkerRenderRequest {
    source: PathBuf,
    source_sha256: String,
    spec: TransformSpec,
    output: PathBuf,
    options: RenderOptions,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
enum WorkerEnvelope {
    Success {
        ok: bool,
        result: Box<FileRenderResult>,
    },
    Failure {
        ok: bool,
        error: TransformError,
    },
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
        .map(|path| WorkspaceRoot::open(&path))
        .transpose()?;
    let service = WorldbendServer::new(root).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
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
                serde_json::from_slice::<WorkerRenderRequest>(&bytes).map_err(|error| {
                    TransformError::new(
                        ErrorCode::Schema,
                        format!("invalid worker request: {error}"),
                    )
                })
            })
            .and_then(|request| {
                render_file_with_source_sha256(
                    &request.source,
                    &request.source_sha256,
                    &request.spec,
                    &request.output,
                    request.options,
                    true,
                    false,
                )
            });
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

async fn run_render_worker(
    root: &WorkspaceRoot,
    input: RenderRequest,
) -> Result<FileRenderResult, TransformError> {
    let source = root.open_source(&input.source)?;
    let output = root.prepare_output(&input.output, input.overwrite)?;
    // The worker sees only a private copy and a private output path. Agent-
    // controlled path components are opened once through the workspace
    // capability and are never re-resolved inside the child process.
    let mut staging_builder = tempfile::Builder::new();
    staging_builder.prefix(".worldbend-stage-");
    let staging = match std::env::var_os("WORLDBEND_PRIVATE_STAGING_ROOT") {
        Some(directory) => staging_builder.tempdir_in(directory),
        None => staging_builder.tempdir(),
    }
    .map_err(|error| {
        TransformError::new(ErrorCode::Render, "private render staging is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
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
    let request = WorkerRenderRequest {
        source: staged_source,
        source_sha256,
        spec: input.spec,
        output: staged_output.clone(),
        options: input.options,
    };
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
    .map_err(|_| {
        TransformError::new(
            ErrorCode::Timeout,
            "render worker exceeded the whole-call deadline",
        )
    })??;
    if stdout_bytes.len() > MAX_WORKER_RESPONSE_BYTES
        || stderr_bytes.len() > MAX_WORKER_RESPONSE_BYTES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "render worker response exceeds byte limit",
        ));
    }
    let envelope: WorkerEnvelope = serde_json::from_slice(&stdout_bytes).map_err(|_| {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        let (code, message) = classify_worker_death(&worker_status, stderr.as_ref());
        TransformError::new(code, message)
            .with_details(json!({ "stderr": bounded_text(&stderr, 2048) }))
    })?;
    let mut result = match envelope {
        WorkerEnvelope::Success { ok: _, result } => *result,
        WorkerEnvelope::Failure { ok: _, error } => return Err(error),
    };
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        FileRenderStatus::Ready
    } else {
        FileRenderStatus::Written
    };

    // Measure the exact shape the client will receive: framing differences
    // between the envelope and the final CallToolResult would otherwise let a
    // file publish and then have the response swap to E_OUTPUT_LIMIT.
    let preflight_envelope: ToolEnvelope<FileRenderResult> = ToolEnvelope::Success {
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
    route.attr.input_schema = rmcp::handler::server::tool::schema_for_input::<T>()
        .unwrap_or_else(|error| panic!("invalid generated input schema for {name}: {error}"));
}

fn set_output_schema<T>(tool_router: &mut ToolRouter<WorldbendServer>, name: &str)
where
    T: JsonSchema + 'static,
{
    let route = tool_router
        .map
        .get_mut(name)
        .unwrap_or_else(|| panic!("missing generated tool route {name}"));
    let mut output_schema = rmcp::handler::server::tool::schema_for_output::<T>()
        .as_ref()
        .clone();
    // ToolEnvelope is always a JSON object. Keep that fact explicit for MCP
    // clients that validate outputSchema as an object schema before accepting
    // tools/list, while retaining schemars' success/failure union below it.
    output_schema.insert("type".to_owned(), json!("object"));
    route.attr.output_schema = Some(Arc::new(output_schema));
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::SourceOrientation;

    #[test]
    fn public_tool_registry_has_five_direct_bounded_tools() {
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
                "worldbend.compose",
                "worldbend.css",
                "worldbend.inspect",
                "worldbend.render",
                "worldbend.solve"
            ]
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
        let render_limits = &render.input_schema["$defs"]["RenderLimitsInput"];
        assert!(render_limits.get("required").is_none());

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
            admission,
            slots.clone(),
            Duration::from_millis(80),
            CancellationToken::new(),
            std::future::pending(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Timeout);
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
            admission,
            slots.clone(),
            Duration::from_secs(30),
            cancellation,
            std::future::pending(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
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
        // source + 4/3 mip pyramid + output + one decode working copy, RGBA.
        let worst_case_bytes = MCP_MAX_PIXELS * 4 * (1 + 4 + 3 + 3) / 3;
        assert!(
            worst_case_bytes < WORKER_MEMORY_BYTES,
            "MCP_MAX_PIXELS={MCP_MAX_PIXELS} needs {worst_case_bytes} bytes worst case, above the {WORKER_MEMORY_BYTES}-byte worker ceiling"
        );
    }
}

use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    env, fs,
    io::{self, BufRead, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, ExitCode, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use worldbend_agent_fs::{WorkspaceRoot, copy_source_to_private_staging};
use worldbend_core::{
    Content, CoordinateSpace, Destination, ErrorCode, FitMode, Point, Quad, SPEC_SCHEMA,
    SPEC_VERSION, Size, SourceOrientation, TransformError, TransformSpec,
};
use worldbend_render::{CanvasMode, DEFAULT_MAX_SOURCE_BYTES, SamplingQuality};

const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_PROCESS_SECONDS: u64 = 25;
const CAPABILITY_SPEC_SCHEMA: &str = "projective.transform";
const CAPABILITY_SPEC_VERSION: &str = "0.1";

#[derive(Debug)]
struct AdapterError {
    code: &'static str,
    message: String,
}

impl AdapterError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RequestEnvelope {
    id: String,
    #[serde(rename = "operationId")]
    operation_id: String,
    input: Value,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct InspectInput {
    spec: CapabilityProjectiveSpec,
    #[serde(default)]
    target_size: StrictOption<CapabilitySize>,
}

/// The Profile snapshots type optional fields as bare `$ref`s without a null
/// union, so an explicit `null` is invalid while an absent field is fine.
/// `Option` cannot express that distinction at the serde boundary.
#[derive(Debug, Clone, Copy, Default)]
enum StrictOption<T> {
    #[default]
    Absent,
    Present(T),
}

impl<T> StrictOption<T> {
    fn into_option(self) -> Option<T> {
        match self {
            Self::Absent => None,
            Self::Present(value) => Some(value),
        }
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for StrictOption<T> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct Visitor<T>(PhantomData<T>);
        impl<T> Visitor<T> {
            #[allow(dead_code)]
            const fn assert() {}
        }
        impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for Visitor<T> {
            type Value = StrictOption<T>;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a present value or an absent field")
            }
            fn visit_unit<E>(self) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Err(E::custom("explicit null is not accepted here"))
            }
            fn visit_none<E>(self) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                Err(E::custom("explicit null is not accepted here"))
            }
            fn visit_some<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
            where
                D: serde::Deserializer<'de>,
            {
                T::deserialize(deserializer).map(StrictOption::Present)
            }
        }
        deserializer.deserialize_option(Visitor(PhantomData))
    }
}

impl<T: JsonSchema> JsonSchema for StrictOption<T> {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        format!("StrictOption<{}>", T::schema_name()).into()
    }

    fn json_schema(generator: &mut SchemaGenerator) -> Schema {
        generator.subschema_for::<T>()
    }
}

use std::marker::PhantomData;

// The experimental Capability Profile deliberately projects a narrower spec
// than the product contract. Every nested shape below is a local mirror of
// the Profile snapshot, not the richer core model, so a future product-side
// field or enum variant cannot silently widen this acceptance surface before
// the central Profile adopts it. A drift test pins these mirrors to
// capabilities/schemas/*.json field-for-field.

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityProjectiveSpec {
    #[schemars(schema_with = "spec_schema_schema")]
    schema: String,
    #[schemars(schema_with = "spec_version_schema")]
    version: String,
    destination: CapabilityDestination,
    content: CapabilityContent,
}

fn spec_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": CAPABILITY_SPEC_SCHEMA
    })
}

fn spec_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "const": CAPABILITY_SPEC_VERSION
    })
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityContent {
    fit: CapabilityFit,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum CapabilityFit {
    #[default]
    Stretch,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityPoint {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilitySize {
    #[schemars(schema_with = "positive_dimension_schema")]
    width: f64,
    #[schemars(schema_with = "positive_dimension_schema")]
    height: f64,
}

fn positive_dimension_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "number",
        "exclusiveMinimum": 0
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityQuad {
    tl: CapabilityPoint,
    tr: CapabilityPoint,
    br: CapabilityPoint,
    bl: CapabilityPoint,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum CapabilityPixelSpace {
    Pixel,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum CapabilityNormalizedSpace {
    Normalized,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityPixelDestination {
    space: CapabilityPixelSpace,
    reference: CapabilitySize,
    quad: CapabilityQuad,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityNormalizedDestination {
    space: CapabilityNormalizedSpace,
    quad: CapabilityQuad,
}

#[derive(Deserialize, JsonSchema)]
#[serde(untagged)]
enum CapabilityDestination {
    Pixel(CapabilityPixelDestination),
    Normalized(CapabilityNormalizedDestination),
}

impl CapabilityProjectiveSpec {
    fn into_transform_spec(self) -> Result<TransformSpec, AdapterError> {
        if self.schema != CAPABILITY_SPEC_SCHEMA || self.version != CAPABILITY_SPEC_VERSION {
            return Err(AdapterError::new(
                "INVALID_INPUT",
                "Capability transform identity is unsupported",
            ));
        }
        Ok(TransformSpec {
            schema: SPEC_SCHEMA.to_owned(),
            version: SPEC_VERSION.to_owned(),
            destination: self.destination.into(),
            content: Content {
                fit: self.content.fit.into(),
                orientation: SourceOrientation::Native,
                warp: None,
            },
        })
    }
}

impl From<CapabilityFit> for FitMode {
    fn from(value: CapabilityFit) -> Self {
        match value {
            CapabilityFit::Stretch => FitMode::Stretch,
        }
    }
}

impl From<CapabilityPoint> for Point {
    fn from(value: CapabilityPoint) -> Self {
        Self::new(value.x, value.y)
    }
}

impl From<CapabilitySize> for Size {
    fn from(value: CapabilitySize) -> Self {
        Self::new(value.width, value.height)
    }
}

impl From<CapabilityQuad> for Quad {
    fn from(value: CapabilityQuad) -> Self {
        Self::new(
            value.tl.into(),
            value.tr.into(),
            value.br.into(),
            value.bl.into(),
        )
    }
}

impl From<CapabilityDestination> for Destination {
    fn from(value: CapabilityDestination) -> Self {
        match value {
            CapabilityDestination::Pixel(destination) => {
                // Exhaustiveness keeps the tag meaningful: a future second
                // pixel space variant must be mapped deliberately.
                let CapabilityPixelSpace::Pixel = destination.space;
                Self {
                    space: CoordinateSpace::Pixel,
                    reference: Some(destination.reference.into()),
                    quad: destination.quad.into(),
                }
            }
            CapabilityDestination::Normalized(destination) => {
                let CapabilityNormalizedSpace::Normalized = destination.space;
                Self {
                    space: CoordinateSpace::Normalized,
                    reference: None,
                    quad: destination.quad.into(),
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum CapabilityQuality {
    Preview,
    #[default]
    Standard,
    High,
}

impl From<CapabilityQuality> for SamplingQuality {
    fn from(value: CapabilityQuality) -> Self {
        match value {
            CapabilityQuality::Preview => SamplingQuality::Preview,
            CapabilityQuality::Standard => SamplingQuality::Standard,
            CapabilityQuality::High => SamplingQuality::High,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum CapabilityCanvas {
    #[default]
    Tight,
    Reference,
}

impl From<CapabilityCanvas> for CanvasMode {
    fn from(value: CapabilityCanvas) -> Self {
        match value {
            CapabilityCanvas::Tight => CanvasMode::Tight,
            CapabilityCanvas::Reference => CanvasMode::Reference,
        }
    }
}

fn path_field_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "minLength": 1,
        "maxLength": 4096
    })
}

fn png_output_field_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "string",
        "minLength": 1,
        "maxLength": 4096,
        "pattern": "\\.[Pp][Nn][Gg]$"
    })
}

#[derive(Default, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct CapabilityRenderOptions {
    #[serde(default)]
    quality: CapabilityQuality,
    #[serde(default)]
    canvas: CapabilityCanvas,
    #[serde(default)]
    target_size: StrictOption<CapabilitySize>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct RenderInput {
    #[schemars(schema_with = "path_field_schema")]
    source: String,
    spec: CapabilityProjectiveSpec,
    #[schemars(schema_with = "png_output_field_schema")]
    output: String,
    #[serde(default)]
    options: CapabilityRenderOptions,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    dry_run: bool,
}

struct TemporaryFile {
    path: PathBuf,
    file: fs::File,
}

impl TemporaryFile {
    fn create(label: &str) -> Result<Self, AdapterError> {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for attempt in 0..16_u8 {
            let path = env::temp_dir().join(format!(
                "worldbend-capability-{label}-{}-{stamp}-{attempt}",
                std::process::id()
            ));
            match fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(file) => return Ok(Self { path, file }),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => {
                    return Err(AdapterError::new(
                        "PROVIDER_FAILED",
                        "Worldbend temporary storage is unavailable",
                    ));
                }
            }
        }
        Err(AdapterError::new(
            "PROVIDER_FAILED",
            "Worldbend temporary storage is unavailable",
        ))
    }
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    match (arguments.next(), arguments.next()) {
        (Some(argument), None) if argument == "--version" => {
            println!("worldbend-capability {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        (Some(_), _) => return ExitCode::from(2),
        (None, None) => {}
        (None, Some(_)) => unreachable!(),
    }
    let input = io::stdin();
    let mut reader = input.lock();
    let output = io::stdout();
    let mut writer = output.lock();
    loop {
        let mut bytes = Vec::new();
        match reader
            .by_ref()
            .take((MAX_REQUEST_BYTES + 2) as u64)
            .read_until(b'\n', &mut bytes)
        {
            Ok(0) => return ExitCode::SUCCESS,
            Ok(_) => {}
            Err(_) => return ExitCode::from(2),
        }
        if bytes.len() > MAX_REQUEST_BYTES + 1 || !bytes.ends_with(b"\n") {
            return ExitCode::from(2);
        }
        if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
            continue;
        }
        bytes.pop();
        let response = handle(&bytes);
        let encoded = serde_json::to_vec(&response).unwrap_or_else(|_| {
            br#"{"id":null,"ok":false,"error":{"code":"PROVIDER_FAILED","message":"Provider response serialization failed"}}"#.to_vec()
        });
        let bounded = if encoded.len() <= MAX_RESPONSE_BYTES {
            encoded
        } else {
            br#"{"id":null,"ok":false,"error":{"code":"PROVIDER_FAILED","message":"Response exceeded its bound"}}"#.to_vec()
        };
        if writer.write_all(&bounded).is_err()
            || writer.write_all(b"\n").is_err()
            || writer.flush().is_err()
        {
            return ExitCode::from(2);
        }
    }
}

fn handle(line: &[u8]) -> Value {
    let request = match serde_json::from_slice::<RequestEnvelope>(line) {
        Ok(request)
            if !request.id.is_empty()
                && request.id.len() <= 128
                && matches!(request.operation_id.as_str(), "inspect" | "render") =>
        {
            request
        }
        _ => {
            return failure(
                Value::Null,
                "INVALID_INPUT",
                "Invalid Capability request envelope",
            );
        }
    };
    let identifier = Value::String(request.id.clone());
    let result = match request.operation_id.as_str() {
        "inspect" => serde_json::from_value::<InspectInput>(request.input)
            .map_err(|_| AdapterError::new("INVALID_INPUT", "Inspect input is invalid"))
            .and_then(execute_inspect),
        "render" => serde_json::from_value::<RenderInput>(request.input)
            .map_err(|_| AdapterError::new("INVALID_INPUT", "Render input is invalid"))
            .and_then(execute_render),
        _ => unreachable!(),
    };
    match result {
        Ok(result) => json!({ "id": request.id, "ok": true, "result": result }),
        Err(error) => failure(identifier, error.code, &error.message),
    }
}

fn execute_inspect(input: InspectInput) -> Result<Value, AdapterError> {
    let spec = input.spec.into_transform_spec()?;
    spec.validate_header().map_err(map_transform_error)?;
    let target_size = input.target_size.into_option().map(Size::from);
    if let Some(size) = target_size {
        size.validate("target_size").map_err(map_transform_error)?;
    }
    let result = worldbend_core::inspect_spec(&spec, target_size).map_err(map_transform_error)?;
    Ok(json!({
        "homography": result.homography,
        "bounds": result.diagnostics.bounds,
        "geometry": {
            "orientation": result.diagnostics.geometry.orientation,
            "signed_area": result.diagnostics.geometry.signed_area,
            "edge_lengths": result.diagnostics.geometry.edge_lengths,
        },
        "max_reprojection_error": result.diagnostics.reprojection.max,
    }))
}

fn execute_render(input: RenderInput) -> Result<Value, AdapterError> {
    let spec = input.spec.into_transform_spec()?;
    spec.validate_header().map_err(map_transform_error)?;
    // The snapshot bound counts characters, so measure characters here rather
    // than bytes; a multibyte path must not diverge from its schema.
    if input.source.chars().count() > 4096
        || input.output.chars().count() > 4096
        || input.source.is_empty()
        || input.output.is_empty()
        || !input.output.to_ascii_lowercase().ends_with(".png")
    {
        return Err(AdapterError::new(
            "INVALID_INPUT",
            "Render source or PNG output path is invalid",
        ));
    }
    let target_size = input.options.target_size.into_option().map(Size::from);
    if let Some(size) = target_size {
        size.validate("options.target_size")
            .map_err(map_transform_error)?;
    }
    let root = workspace_root()?;
    let workspace = WorkspaceRoot::open(&root)
        .map_err(|_| AdapterError::new("PATH_FORBIDDEN", "Capability workspace is unavailable"))?;
    let source = workspace
        .open_source(&input.source)
        .map_err(map_source_workspace_error)?;
    let output = workspace
        .prepare_output(&input.output, input.overwrite)
        .map_err(map_output_workspace_error)?;
    let staging = tempfile::tempdir().map_err(|_| {
        AdapterError::new(
            "PROVIDER_FAILED",
            "Worldbend temporary storage is unavailable",
        )
    })?;
    let staged_source = staging.path().join("source.raster");
    let staged_output = staging.path().join("output.png");
    let _source_sha256 =
        copy_source_to_private_staging(source, &staged_source, DEFAULT_MAX_SOURCE_BYTES)
            .map_err(map_source_workspace_error)?;
    let spec = write_spec(&spec)?;
    let quality: SamplingQuality = input.options.quality.into();
    let canvas: CanvasMode = input.options.canvas.into();
    let mut arguments = vec![
        "render".to_owned(),
        "--source".to_owned(),
        staged_source.to_string_lossy().into_owned(),
        "--spec".to_owned(),
        spec.path.to_string_lossy().into_owned(),
        "--output".to_owned(),
        staged_output.to_string_lossy().into_owned(),
        "--quality".to_owned(),
        enum_json(&quality)?,
        "--canvas".to_owned(),
        enum_json(&canvas)?,
        "--json".to_owned(),
    ];
    if let Some(size) = target_size {
        arguments.extend([
            "--target-size".to_owned(),
            format!("{}x{}", size.width, size.height),
        ]);
    }
    if input.dry_run {
        arguments.push("--dry-run".to_owned());
    }
    let result = run_cli(&arguments, Some(&root))?;
    if !input.dry_run {
        output
            .publish_from(&staged_output)
            .map_err(map_output_workspace_error)?;
    }
    let evidence = required_object(&result, "evidence")?;
    let diagnostics = required_object(&result, "diagnostics")?;
    Ok(json!({
        "status": "ok",
        "dry_run": required(&result, "dryRun")?,
        "output": input.output,
        "bytes": required(&result, "bytes")?,
        "evidence": {
            "source_sha256": required(evidence, "sourceSha256")?,
            "output_sha256": required(evidence, "outputSha256")?,
            "output_width": required(evidence, "outputWidth")?,
            "output_height": required(evidence, "outputHeight")?,
            "output_format": required(evidence, "outputFormat")?,
            "warnings": required(evidence, "warnings")?,
        },
        "placement": required(diagnostics, "placement")?,
        "quality": required(diagnostics, "quality")?,
        "canvas": required(diagnostics, "canvas")?,
    }))
}

fn write_spec(spec: &TransformSpec) -> Result<TemporaryFile, AdapterError> {
    let mut temporary = TemporaryFile::create("spec.json")?;
    serde_json::to_writer(&mut temporary.file, spec)
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "TransformSpec could not be staged"))?;
    temporary
        .file
        .flush()
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "TransformSpec could not be staged"))?;
    Ok(temporary)
}

fn run_cli(arguments: &[String], root: Option<&Path>) -> Result<Value, AdapterError> {
    let mut capture = TemporaryFile::create("stdout.json")?;
    let (executable, prefix) = worldbend_command()?;
    let mut command = Command::new(executable);
    command
        .args(&prefix)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::from(capture.file.try_clone().map_err(|_| {
            AdapterError::new("PROVIDER_FAILED", "Worldbend output capture is unavailable")
        })?))
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        // The cargo-run fallback's grandchild must die with its parent on the
        // adapter deadline, not leak past the timeout kill.
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "Worldbend executable is unavailable"))?;
    let deadline = Instant::now() + Duration::from_secs(MAX_PROCESS_SECONDS);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                kill_process_tree(&mut child);
                return Err(AdapterError::new(
                    "TIMEOUT",
                    "Worldbend operation exceeded its deadline",
                ));
            }
            Err(_) => {
                kill_process_tree(&mut child);
                return Err(AdapterError::new(
                    "PROVIDER_FAILED",
                    "Worldbend process could not be observed",
                ));
            }
        }
    }
    capture
        .file
        .seek(SeekFrom::Start(0))
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "Worldbend output is unavailable"))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut capture.file)
        .take((MAX_RESPONSE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "Worldbend output is unavailable"))?;
    if bytes.len() > MAX_RESPONSE_BYTES {
        return Err(AdapterError::new(
            "PROVIDER_FAILED",
            "Worldbend response exceeded its bound",
        ));
    }
    let response: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AdapterError::new("PROVIDER_FAILED", "Worldbend returned invalid JSON"))?;
    if response.get("ok") == Some(&Value::Bool(true)) {
        return response
            .get("result")
            .cloned()
            .ok_or_else(|| AdapterError::new("PROVIDER_FAILED", "Worldbend result is missing"));
    }
    let error = response.get("error").and_then(Value::as_object);
    let code = error
        .and_then(|value| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or("E_INTERNAL");
    let message = error
        .and_then(|value| value.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("Worldbend could not complete the operation");
    Err(AdapterError::new(
        map_error(code),
        bounded(&redact_host_paths(message, root), 4096),
    ))
}

/// The delegated CLI reports resolved absolute paths; the Agent only needs the
/// request-relative view, so the granted root and the adapter's own staging
/// directory never leak host layout into Capability messages.
fn redact_host_paths(message: &str, root: Option<&Path>) -> String {
    let mut redacted = message.to_owned();
    if let Some(root) = root
        && let Some(raw) = root.to_str()
    {
        redacted = redacted.replace(raw, "<workspace>");
    }
    if let Some(temp) = env::temp_dir().to_str() {
        // Match the canonicalized prefix the resolver actually reports.
        let canonical = fs::canonicalize(env::temp_dir())
            .ok()
            .and_then(|path| path.into_os_string().into_string().ok());
        if let Some(canonical) = canonical {
            redacted = redacted.replace(&canonical, "<tmp>");
        }
        redacted = redacted.replace(temp.trim_end_matches('/'), "<tmp>");
    }
    redacted
}

#[cfg(unix)]
fn kill_process_tree(child: &mut std::process::Child) {
    let pid = child.id();
    // Negative PID signals the whole process group created at spawn.
    unsafe {
        libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(not(unix))]
fn kill_process_tree(child: &mut std::process::Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn worldbend_command() -> Result<(PathBuf, Vec<String>), AdapterError> {
    if let Some(raw) = env::var_os("OPENADAM_WORLDBEND_CLI") {
        let path = PathBuf::from(raw);
        if path.is_file() {
            return Ok((path, Vec::new()));
        }
        return Err(AdapterError::new(
            "PROVIDER_FAILED",
            "Configured Worldbend executable is unavailable",
        ));
    }
    if let Ok(current) = env::current_exe()
        && let Some(parent) = current.parent()
    {
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let sibling = parent.join(format!("worldbend{suffix}"));
        if sibling.is_file() {
            return Ok((sibling, Vec::new()));
        }
    }
    if let Some(provider_root) = env::var_os("OPENADAM_PROVIDER_ROOT") {
        let root = PathBuf::from(provider_root);
        if root.join("Cargo.toml").is_file() {
            return Ok((
                PathBuf::from("cargo"),
                vec![
                    "run".to_owned(),
                    "--quiet".to_owned(),
                    "-p".to_owned(),
                    "worldbend-cli".to_owned(),
                    "--bin".to_owned(),
                    "worldbend".to_owned(),
                    "--".to_owned(),
                ],
            ));
        }
    }
    Ok((PathBuf::from("worldbend"), Vec::new()))
}

fn workspace_root() -> Result<PathBuf, AdapterError> {
    let raw = env::var_os("OPENADAM_CAPABILITY_WORKSPACE_ROOT")
        .or_else(|| env::var_os("OPENADAM_PROVIDER_ROOT"))
        .ok_or_else(|| {
            AdapterError::new("PATH_FORBIDDEN", "A Capability workspace root is required")
        })?;
    let root = fs::canonicalize(raw)
        .map_err(|_| AdapterError::new("PATH_FORBIDDEN", "Capability workspace is unavailable"))?;
    if !root.is_dir() {
        return Err(AdapterError::new(
            "PATH_FORBIDDEN",
            "Capability workspace is unavailable",
        ));
    }
    Ok(root)
}

fn map_source_workspace_error(error: TransformError) -> AdapterError {
    if error.code == ErrorCode::PathOutsideRoot
        && error
            .details
            .as_ref()
            .and_then(|details| details.get("ioKind"))
            .and_then(Value::as_str)
            == Some("notFound")
    {
        return AdapterError::new("SOURCE_NOT_FOUND", "Source file does not exist");
    }
    map_workspace_error(error)
}

fn map_output_workspace_error(error: TransformError) -> AdapterError {
    map_workspace_error(error)
}

fn map_workspace_error(error: TransformError) -> AdapterError {
    let code = match error.code {
        ErrorCode::Schema | ErrorCode::NonFiniteCoordinate => "INVALID_INPUT",
        ErrorCode::PathOutsideRoot | ErrorCode::PathSymlink => "PATH_FORBIDDEN",
        ErrorCode::DestinationExists => "OUTPUT_EXISTS",
        ErrorCode::OutputLimit | ErrorCode::Memory => "LIMIT_EXCEEDED",
        ErrorCode::Render => "OUTPUT_INVALID",
        _ => "PROVIDER_FAILED",
    };
    AdapterError::new(code, error.message)
}

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a Value, AdapterError> {
    value
        .get(key)
        .ok_or_else(|| AdapterError::new("PROVIDER_FAILED", "Worldbend result is incomplete"))
}

fn required_object<'a>(value: &'a Value, key: &str) -> Result<&'a Value, AdapterError> {
    let field = required(value, key)?;
    if field.is_object() {
        Ok(field)
    } else {
        Err(AdapterError::new(
            "PROVIDER_FAILED",
            "Worldbend result is incomplete",
        ))
    }
}

fn enum_json(value: &impl serde::Serialize) -> Result<String, AdapterError> {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| AdapterError::new("PROVIDER_FAILED", "Worldbend option is invalid"))
}

fn map_transform_error(error: TransformError) -> AdapterError {
    AdapterError::new(map_error_code(error.code), error.message)
}

fn map_error(code: &str) -> &'static str {
    match code {
        "E_SCHEMA" | "E_NON_FINITE_COORDINATE" => "INVALID_INPUT",
        "E_QUAD_SELF_INTERSECT"
        | "E_QUAD_CONCAVE"
        | "E_QUAD_ORIENTATION"
        | "E_QUAD_DEGENERATE"
        | "E_EDGE_TOO_SHORT"
        | "E_HOMOGRAPHY_SINGULAR"
        | "E_HOMOGRAPHY_HORIZON_CROSSING"
        | "E_REPROJECTION" => "INVALID_GEOMETRY",
        "E_UNSUPPORTED_MEDIA" => "IMAGE_INVALID",
        "E_PATH_OUTSIDE_ROOT" | "E_PATH_SYMLINK" => "PATH_FORBIDDEN",
        "E_DESTINATION_EXISTS" => "OUTPUT_EXISTS",
        "E_OUTPUT_LIMIT" | "E_MEMORY" => "LIMIT_EXCEEDED",
        "E_TIMEOUT" => "TIMEOUT",
        // Capacity is provider-operational and intentionally outside the
        // portable Capability Profile. Narrow it to the Profile's retryable
        // provider failure rather than misreporting elapsed-time exhaustion.
        "E_CAPACITY" => "PROVIDER_FAILED",
        "E_RENDER" => "OUTPUT_INVALID",
        _ => "PROVIDER_FAILED",
    }
}

fn map_error_code(code: ErrorCode) -> &'static str {
    let encoded = serde_json::to_value(code).unwrap_or(Value::Null);
    map_error(encoded.as_str().unwrap_or("E_INTERNAL"))
}

fn failure(id: Value, code: &str, message: &str) -> Value {
    json!({ "id": id, "ok": false, "error": { "code": code, "message": bounded(message, 4096) } })
}

fn bounded(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Map;
    use std::collections::BTreeSet;

    #[test]
    fn capability_identity_maps_to_product_identity_without_accepting_product_headers() {
        let capability: CapabilityProjectiveSpec = serde_json::from_value(json!({
            "schema": CAPABILITY_SPEC_SCHEMA,
            "version": CAPABILITY_SPEC_VERSION,
            "destination": {
                "space": "normalized",
                "quad": {
                    "tl": { "x": 0, "y": 0 },
                    "tr": { "x": 1, "y": 0 },
                    "br": { "x": 1, "y": 1 },
                    "bl": { "x": 0, "y": 1 }
                }
            },
            "content": { "fit": "stretch" }
        }))
        .unwrap();
        let product = capability.into_transform_spec().unwrap();
        assert_eq!(product.schema, SPEC_SCHEMA);
        assert_eq!(product.version, SPEC_VERSION);

        let product_header: CapabilityProjectiveSpec = serde_json::from_value(json!({
            "schema": SPEC_SCHEMA,
            "version": SPEC_VERSION,
            "destination": {
                "space": "normalized",
                "quad": {
                    "tl": { "x": 0, "y": 0 },
                    "tr": { "x": 1, "y": 0 },
                    "br": { "x": 1, "y": 1 },
                    "bl": { "x": 0, "y": 1 }
                }
            },
            "content": { "fit": "stretch" }
        }))
        .unwrap();
        assert_eq!(
            product_header.into_transform_spec().unwrap_err().code,
            "INVALID_INPUT"
        );
    }

    #[test]
    fn rejects_non_png_output_before_execution() {
        let response = handle(
            br#"{"id":"x","operationId":"render","input":{"source":"a.png","output":"b.jpg","spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch"}}}}"#,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_INPUT");
    }

    #[test]
    fn rejects_product_only_orientation_outside_the_capability_profile() {
        let response = handle(
            br#"{"id":"x","operationId":"inspect","input":{"spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch","orientation":"flipHorizontal"}}}}"#,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_INPUT");
    }

    #[test]
    fn rejects_product_only_warp_outside_the_capability_profile() {
        let response = handle(
            br#"{"id":"x","operationId":"inspect","input":{"spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch","warp":{"preset":"arc","amount":0.75}}}}}"#,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_INPUT");
    }

    #[test]
    fn rejects_parent_and_uri_paths() {
        let root = tempfile::tempdir().unwrap();
        let workspace = WorkspaceRoot::open(root.path()).unwrap();
        for raw in ["../source.png", "https://example.com/source.png"] {
            assert_eq!(
                map_source_workspace_error(workspace.open_source(raw).unwrap_err()).code,
                "PATH_FORBIDDEN"
            );
        }
    }

    #[test]
    fn nested_missing_source_is_not_misreported_as_forbidden() {
        let root = env::temp_dir().join(format!(
            "worldbend-capability-missing-source-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let workspace = WorkspaceRoot::open(&root).unwrap();
        let error =
            map_source_workspace_error(workspace.open_source("missing/source.png").unwrap_err());
        fs::remove_dir(&root).unwrap();
        assert_eq!(error.code, "SOURCE_NOT_FOUND");
    }

    #[test]
    fn transient_product_capacity_narrows_without_becoming_a_timeout() {
        assert_eq!(map_error("E_CAPACITY"), "PROVIDER_FAILED");
        assert_eq!(map_error_code(ErrorCode::Capacity), "PROVIDER_FAILED");
        assert_eq!(map_error("E_CANCELLED"), "PROVIDER_FAILED");
        assert_eq!(map_error_code(ErrorCode::Cancelled), "PROVIDER_FAILED");
    }

    #[test]
    fn rejects_product_only_fields_inside_nested_destination_shapes() {
        let response = handle(
            br#"{"id":"x","operationId":"inspect","input":{"spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1,"dpi":72},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch"}}}}"#,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_INPUT");
    }

    #[test]
    fn rejects_product_only_fit_variants_and_future_quality_levels() {
        for body in [
            r#"{"id":"x","operationId":"inspect","input":{"spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"contain"}}}}"#,
            r#"{"id":"x","operationId":"render","input":{"source":"a.png","spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch"}},"output":"b.png","options":{"quality":"ultra"}}}"#,
        ] {
            let response = handle(body.as_bytes());
            assert_eq!(response["ok"], false, "input was accepted: {body}");
            assert_eq!(response["error"]["code"], "INVALID_INPUT");
        }
    }

    #[test]
    fn explicit_null_target_size_is_rejected_like_the_profile_snapshot() {
        let response = handle(
            br#"{"id":"x","operationId":"inspect","input":{"spec":{"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch"}},"target_size":null}}"#,
        );
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "INVALID_INPUT");
    }

    #[test]
    fn path_length_bound_counts_characters_like_the_snapshot() {
        let multibyte = "图".repeat(3_000);
        assert!(multibyte.len() > 4096);
        assert!(multibyte.chars().count() <= 4096);
        let input: RenderInput = serde_json::from_value(json!({
            "source": multibyte,
            "spec": {"schema":"projective.transform","version":"0.1","destination":{"space":"pixel","reference":{"width":1,"height":1},"quad":{"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0,"y":1}}},"content":{"fit":"stretch"}},
            "output": "b.png"
        }))
        .unwrap();
        // Acceptance is decided later by the descriptor-scoped workspace; the length
        // gate itself must not have rejected a schema-valid multibyte path.
        assert!(input.source.chars().count() <= 4096);
    }

    #[test]
    fn host_paths_are_redacted_from_mapped_cli_messages() {
        let root = env::temp_dir();
        let message = format!("destination already exists: {}/out.png", root.display());
        let redacted = redact_host_paths(&message, Some(&root));
        assert!(
            !redacted.contains(&root.display().to_string()),
            "{redacted}"
        );
        assert!(redacted.contains("<workspace>/out.png"), "{redacted}");
    }

    /// Compare the adapter's schemars-generated acceptance surface with the
    /// Profile snapshot field-for-field: allowed properties, required sets,
    /// consts/enums, unions, and scalar bounds. Vocabulary keys that carry no
    /// acceptance meaning (titles, descriptions, defaults) are ignored.
    #[test]
    fn adapter_acceptance_surface_matches_the_profile_snapshots() {
        let cases = [
            (
                "inspect",
                serde_json::to_value(schemars::schema_for!(InspectInput)).unwrap(),
                read_snapshot("projective.inspect.input.schema.json"),
            ),
            (
                "render",
                serde_json::to_value(schemars::schema_for!(RenderInput)).unwrap(),
                read_snapshot("projective.render.input.schema.json"),
            ),
        ];
        for (name, generated, snapshot) in cases {
            let generated_surface = schema_surface(&generated);
            let snapshot_surface = schema_surface(&snapshot);
            assert_eq!(
                generated_surface, snapshot_surface,
                "{name} acceptance surface drifted from its Profile snapshot"
            );
        }
    }

    fn read_snapshot(name: &str) -> Value {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../capabilities/schemas")
            .join(name);
        let bytes = fs::read(path).unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    fn schema_surface(document: &Value) -> BTreeSet<String> {
        let empty = Map::new();
        let defs = document
            .get("$defs")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let mut surface = BTreeSet::new();
        walk_surface(document, defs, "", &mut surface, 0);
        surface
    }

    fn walk_surface(
        node: &Value,
        defs: &Map<String, Value>,
        path: &str,
        surface: &mut BTreeSet<String>,
        depth: usize,
    ) {
        if depth > 32 {
            return;
        }
        let Some(object) = node.as_object() else {
            return;
        };
        let has_const_or_enum = object.contains_key("const") || object.contains_key("enum");
        for (key, value) in object {
            match key.as_str() {
                "$ref" => {
                    let Some(raw) = value.as_str() else {
                        continue;
                    };
                    let name = raw.rsplit('/').next().unwrap_or(raw);
                    let decoded = name
                        .replace("%3C", "<")
                        .replace("%3E", ">")
                        .replace("%2C", ",");
                    if let Some(target) = defs.get(name).or_else(|| defs.get(&decoded)) {
                        walk_surface(target, defs, path, surface, depth + 1);
                    }
                }
                "type" if has_const_or_enum => {}
                "type" => {
                    surface.insert(format!("{path}type={value}"));
                }
                "const" => {
                    surface.insert(format!("{path}enum=[{value}]"));
                }
                "enum" => {
                    let mut variants = value
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .map(|item| item.to_string())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    variants.sort();
                    surface.insert(format!("{path}enum=[{}]", variants.join(",")));
                }
                "properties" => {
                    let Some(properties) = value.as_object() else {
                        continue;
                    };
                    let mut names = properties.keys().cloned().collect::<Vec<_>>();
                    names.sort();
                    surface.insert(format!("{path}properties={}", names.join(",")));
                    for (name, property) in properties {
                        walk_surface(
                            property,
                            defs,
                            &format!("{path}.{name}."),
                            surface,
                            depth + 1,
                        );
                    }
                }
                "required" => {
                    let mut names = value
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter_map(Value::as_str)
                                .map(str::to_owned)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default();
                    names.sort();
                    surface.insert(format!("{path}required={}", names.join(",")));
                }
                "oneOf" | "anyOf" => {
                    let Some(variants) = value.as_array() else {
                        continue;
                    };
                    let mut variant_surfaces = variants
                        .iter()
                        .map(|variant| {
                            let mut sub_surface = BTreeSet::new();
                            walk_surface(variant, defs, "", &mut sub_surface, depth + 1);
                            sub_surface.into_iter().collect::<Vec<_>>().join(";")
                        })
                        .collect::<Vec<_>>();
                    variant_surfaces.sort();
                    surface.insert(format!("{path}variants={}", variant_surfaces.join(" | ")));
                }
                "items" => {
                    walk_surface(value, defs, &format!("{path}[]"), surface, depth + 1);
                }
                "minLength" | "maxLength" | "pattern" | "exclusiveMinimum" | "minimum"
                | "minItems" | "maxItems" => {
                    surface.insert(format!("{path}{key}={value}"));
                }
                "additionalProperties" if value.is_boolean() => {
                    surface.insert(format!("{path}additionalProperties={value}"));
                }
                // Titles, descriptions, defaults, and other non-acceptance
                // vocabulary never change what the adapter accepts.
                _ => {}
            }
        }
    }
}

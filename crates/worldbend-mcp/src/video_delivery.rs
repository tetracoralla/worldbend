//! Workspace-granted video adapter. Authored geometry and encoding semantics
//! stay in the core/native renderer; host paths never enter tool schemas.
use super::*;
use worldbend_core::{MAX_VIDEO_PIXELS, VideoPlan, VideoSpec, plan_video};
use worldbend_render::{
    FfmpegEncoder, MAX_VIDEO_ENCODED_BYTES, MAX_VIDEO_STAGING_BYTES, VideoRenderOptions,
    VideoRenderResult, VideoRenderStatus, render_video_file_with_cancel,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EncoderPaths {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

impl EncoderPaths {
    pub(super) fn configured(
        ffmpeg: Option<PathBuf>,
        ffprobe: Option<PathBuf>,
    ) -> TransformResult<Option<Self>> {
        let ffmpeg = ffmpeg.or_else(|| std::env::var_os("WORLDBEND_FFMPEG").map(PathBuf::from));
        let ffprobe = ffprobe.or_else(|| std::env::var_os("WORLDBEND_FFPROBE").map(PathBuf::from));
        match (ffmpeg, ffprobe) {
            (None, None) => Ok(None),
            (Some(ffmpeg), Some(ffprobe)) => {
                FfmpegEncoder::new(&ffmpeg, &ffprobe)?;
                Ok(Some(Self { ffmpeg, ffprobe }))
            }
            _ => Err(TransformError::new(
                ErrorCode::Schema,
                "host video configuration requires both FFmpeg and FFprobe absolute paths",
            )),
        }
    }
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct PlanInput {
    spec: VideoSpec,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SourceInput {
    id: String,
    source: String,
    #[schemars(
        description = "Optional digest assertion over the actual current source bytes; 64 hexadecimal characters"
    )]
    source_sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(super) struct RenderInput {
    #[schemars(length(min = 1, max = 1))]
    sources: Vec<SourceInput>,
    spec: VideoSpec,
    #[schemars(
        description = "Relative .mp4 destination under the explicitly granted workspace; separate from the source"
    )]
    output: String,
    #[serde(default)]
    options: OptionsInput,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    #[schemars(description = "Encode, decode, verify and stage without publishing")]
    dry_run: bool,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(default, deny_unknown_fields, rename_all = "camelCase")]
struct OptionsInput {
    quality: SamplingQuality,
    limits: RenderLimitsInput,
    #[schemars(range(min = 1, max = MAX_VIDEO_PIXELS))]
    max_cumulative_pixels: u64,
    #[schemars(range(min = 1, max = MAX_VIDEO_STAGING_BYTES))]
    max_staging_bytes: u64,
    #[schemars(range(min = 1, max = MAX_VIDEO_ENCODED_BYTES))]
    max_encoded_bytes: u64,
    #[schemars(range(min = 1, max = 120000))]
    timeout_millis: u64,
}

impl Default for OptionsInput {
    fn default() -> Self {
        let options = VideoRenderOptions::default();
        Self {
            quality: options.quality,
            limits: RenderLimitsInput::default(),
            max_cumulative_pixels: options.max_cumulative_pixels,
            max_staging_bytes: options.max_staging_bytes,
            max_encoded_bytes: options.max_encoded_bytes,
            timeout_millis: options.timeout_millis,
        }
    }
}

impl TryFrom<OptionsInput> for VideoRenderOptions {
    type Error = TransformError;
    fn try_from(value: OptionsInput) -> TransformResult<Self> {
        if value.max_cumulative_pixels == 0
            || value.max_staging_bytes == 0
            || value.max_encoded_bytes == 0
            || value.timeout_millis == 0
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "video limits must be positive",
            ));
        }
        if value.max_cumulative_pixels > MAX_VIDEO_PIXELS
            || value.max_staging_bytes > MAX_VIDEO_STAGING_BYTES
            || value.max_encoded_bytes > MAX_VIDEO_ENCODED_BYTES
            || value.timeout_millis > 120_000
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "video limits exceed the host ceiling",
            ));
        }
        Ok(Self {
            quality: value.quality,
            limits: value.limits.try_into()?,
            max_cumulative_pixels: value.max_cumulative_pixels,
            max_staging_bytes: value.max_staging_bytes,
            max_encoded_bytes: value.max_encoded_bytes,
            timeout_millis: value.timeout_millis,
        })
    }
}

pub(super) fn plan(
    Parameters(arguments): Parameters<Map<String, Value>>,
) -> ToolEnvelope<VideoPlan> {
    ToolEnvelope::from_result(
        parse_tool_input::<PlanInput>(Value::Object(arguments))
            .and_then(|input| plan_video(&input.spec)),
    )
}

struct Prepared {
    input: RenderInput,
    source: fs::File,
    output: OutputTarget,
    options: VideoRenderOptions,
    plan: VideoPlan,
}

fn prepare(root: &WorkspaceRoot, input: RenderInput) -> TransformResult<Prepared> {
    let options: VideoRenderOptions = input.options.try_into()?;
    let plan = plan_video(&input.spec)?;
    if input.sources.len() != 1 || input.sources[0].id != plan.motion.source_id {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "video sources must exactly match the planned sourceId",
        ));
    }
    if input.sources[0]
        .source_sha256
        .as_ref()
        .is_some_and(|sha| !valid_sha256(sha))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "sourceSha256 must be 64 hexadecimal characters",
        ));
    }
    if !Path::new(&input.output)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "video output requires an .mp4 extension",
        ));
    }
    if plan.motion.timeline.cumulative_output_pixels > options.max_cumulative_pixels
        || plan.motion.output.width > options.limits.max_width
        || plan.motion.output.height > options.limits.max_height
        || u64::from(plan.motion.output.width) * u64::from(plan.motion.output.height)
            > options.limits.max_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "video exceeds configured raster limits",
        ));
    }
    let source = root.open_source(&input.sources[0].source)?;
    // Descriptor identity covers aliases and case-insensitive filesystem names.
    if Path::new(&input.sources[0].source) == Path::new(&input.output)
        || root
            .open_source(&input.output)
            .ok()
            .map(|destination| same_file(&source, &destination))
            .transpose()?
            .unwrap_or(false)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "video destination must be separate from its source",
        ));
    }
    let output = root.prepare_file_output(&input.output, input.overwrite)?;
    Ok(Prepared {
        input,
        source,
        output,
        options,
        plan,
    })
}

fn same_file(source: &fs::File, destination: &fs::File) -> TransformResult<bool> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let left = source.metadata().map_err(worker_process_error)?;
        let right = destination.metadata().map_err(worker_process_error)?;
        Ok(left.dev() == right.dev() && left.ino() == right.ino())
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
        };
        let identity = |file: &fs::File| -> TransformResult<_> {
            let mut info = BY_HANDLE_FILE_INFORMATION::default();
            if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
                return Err(worker_process_error(std::io::Error::last_os_error()));
            }
            Ok((
                info.dwVolumeSerialNumber,
                info.nFileIndexHigh,
                info.nFileIndexLow,
            ))
        };
        Ok(identity(source)? == identity(destination)?)
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (source, destination);
        Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "host file identity is unsupported",
        ))
    }
}

pub(super) async fn render(
    server: &WorldbendServer,
    Parameters(arguments): Parameters<Map<String, Value>>,
    cancellation: CancellationToken,
) -> ToolEnvelope<VideoRenderResult> {
    let started = Instant::now();
    let result = async {
        let input = parse_tool_input::<RenderInput>(Value::Object(arguments))?;
        let root = server.root.as_ref().as_ref().ok_or_else(|| TransformError::new(ErrorCode::PathOutsideRoot,
            "video_render requires an explicit workspace grant via --root or WORLDBEND_WORKSPACE_ROOT"))?;
        let prepared = prepare(root, input)?;
        let encoder = server.video_encoder.clone().ok_or_else(|| TransformError::new(ErrorCode::UnsupportedMedia,
            "video encoder is unavailable; configure both FFmpeg and FFprobe on the host"))?;
        let admission = server.render_admissions.clone().try_acquire_owned().map_err(|_|
            TransformError::new(ErrorCode::Capacity, "render capacity is full; retry after current work completes")
                .with_details(json!({"retryable":true,"maximumInFlight":MAX_IN_FLIGHT_RENDERS,"maximumConcurrent":MAX_CONCURRENT_RENDERS})))?;
        let remaining = Duration::from_millis(prepared.options.timeout_millis).saturating_sub(started.elapsed());
        let work_cancellation = cancellation.child_token();
        execute_bounded_output("Video", admission, server.render_slots.clone(), remaining,
            cancellation, work_cancellation.clone(), run(prepared, encoder, work_cancellation)).await
    }.await;
    ToolEnvelope::from_result(result)
}

async fn run(
    prepared: Prepared,
    encoder: EncoderPaths,
    cancellation: CancellationToken,
) -> TransformResult<PreparedFileResult<VideoRenderResult>> {
    let Prepared {
        input,
        source,
        output,
        options,
        plan,
    } = prepared;
    let staging = create_private_staging(
        ".worldbend-video-worker-",
        "private video staging is not writable",
    )?;
    let staged_source = staging.path().join("source.raster");
    let copy_path = staged_source.clone();
    let copy_cancel = cancellation.clone();
    let source_sha256 = tokio::task::spawn_blocking(move || {
        worldbend_agent_fs::copy_source_to_private_staging_with_cancel(
            source,
            &copy_path,
            options.limits.max_source_bytes,
            &|| copy_cancel.is_cancelled(),
        )
    })
    .await
    .map_err(|error| blocking_error("source staging", error))??;
    if input.sources[0]
        .source_sha256
        .as_ref()
        .is_some_and(|expected| !expected.eq_ignore_ascii_case(&source_sha256))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "sourceSha256 does not match the actual current source bytes",
        ));
    }
    let staged_output = staging.path().join("result.mp4");
    let request = WorkerRequest::Video {
        source: WorkerMockupSource {
            id: input.sources[0].id.clone(),
            source: staged_source,
            source_sha256: source_sha256.clone(),
        },
        spec: input.spec.clone(),
        output: staged_output.clone(),
        options,
        encoder,
    };
    let mut result: VideoRenderResult = tokio::select! {
        _ = cancellation.cancelled() => return Err(TransformError::new(ErrorCode::Cancelled,
            "video was cancelled while its worker was running")),
        result = execute_worker_request(&request) => result?,
    };
    validate_receipt(&result, &plan, &source_sha256, &staged_output, options)?;
    let bytes = result.bytes;
    let sha256 = result.sha256.clone();
    result.output = input.output;
    result.dry_run = input.dry_run;
    result.status = if input.dry_run {
        VideoRenderStatus::Ready
    } else {
        VideoRenderStatus::Written
    };
    preflight_render_result(&result)?;
    let stage_cancel = cancellation.clone();
    // This bounded copier both verifies the exact movie receipt and stages it;
    // no separate unbounded hashing pass can race a detached publication.
    let commit = tokio::task::spawn_blocking(move || {
        output.stage_from_with_cancel(
            &staged_output,
            bytes,
            &sha256,
            options.max_encoded_bytes,
            &|| stage_cancel.is_cancelled(),
        )
    })
    .await
    .map_err(|error| blocking_error("output staging", error))??;
    let commit = if input.dry_run {
        drop(commit);
        None
    } else {
        Some(commit)
    };
    Ok(PreparedFileResult { result, commit })
}

fn blocking_error(stage: &str, error: tokio::task::JoinError) -> TransformError {
    TransformError::new(
        ErrorCode::Internal,
        format!("video {stage} task failed: {error}"),
    )
}

fn validate_receipt(
    result: &VideoRenderResult,
    plan: &VideoPlan,
    source_sha256: &str,
    output: &Path,
    options: VideoRenderOptions,
) -> TransformResult<()> {
    let source_valid = result.sources.len() == 1
        && result.sources[0].source_id == plan.motion.source_id
        && result.sources[0].source_sha256 == source_sha256
        && result.sources[0].width > 0
        && result.sources[0].height > 0
        && result.sources[0].width <= options.limits.max_width
        && result.sources[0].height <= options.limits.max_height
        && u64::from(result.sources[0].width) * u64::from(result.sources[0].height)
            <= options.limits.max_pixels;
    if result.plan != *plan
        || !source_valid
        || result.status != VideoRenderStatus::Written
        || result.dry_run
        || Path::new(&result.output) != output
        || !valid_sha256(&result.sha256)
        || result.bytes == 0
        || result.bytes > options.max_encoded_bytes
        || result.staging_bytes == 0
        || result.staging_bytes > options.max_staging_bytes
        || result.decoded_frame_count as usize != plan.motion.frames.len()
        || result.frames.len() != plan.motion.frames.len()
        || result.encoder.backend != "ffmpeg"
        || result.encoder.codec != "libx264"
        || !result.encoder.version.starts_with("ffmpeg version ")
        || !result.encoder.probe_version.starts_with("ffprobe version ")
        || result
            .frames
            .iter()
            .zip(&plan.motion.frames)
            .any(|(actual, expected)| {
                actual.index != expected.index
                    || actual.presentation_time != expected.presentation_time
                    || !valid_sha256(&actual.raster_sha256)
            })
    {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "video worker returned an inconsistent delivery receipt",
        ));
    }
    Ok(())
}

pub(super) fn run_worker(
    source: WorkerMockupSource,
    spec: VideoSpec,
    output: PathBuf,
    options: VideoRenderOptions,
    encoder: EncoderPaths,
) -> TransformResult<VideoRenderResult> {
    // Worker startup already acquired Unix group / Windows resource-job scope.
    let encoder = FfmpegEncoder::new(&encoder.ffmpeg, &encoder.ffprobe)?.in_supervised_worker()?;
    let sources = [(
        source.id,
        TimelineFileSource {
            path: source.source,
            source_sha256: Some(source.source_sha256),
        },
    )]
    .into_iter()
    .collect();
    render_video_file_with_cancel(
        &sources,
        &spec,
        &output,
        &encoder,
        options,
        false,
        false,
        &|| false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> VideoSpec {
        serde_json::from_str(include_str!(
            "../../../examples/video-motion.worldbend.json"
        ))
        .unwrap()
    }
    fn input(source: &str, output: &str) -> RenderInput {
        RenderInput {
            sources: vec![SourceInput {
                id: spec().motion.source_id,
                source: source.into(),
                source_sha256: None,
            }],
            spec: spec(),
            output: output.into(),
            options: OptionsInput::default(),
            overwrite: true,
            dry_run: false,
        }
    }

    #[test]
    fn request_boundaries_are_closed_and_preserve_source_aliases() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("source.mp4"), b"source").unwrap();
        let root = WorkspaceRoot::open(directory.path()).unwrap();
        let same = prepare(&root, input("source.mp4", "source.mp4"));
        assert!(matches!(
            same,
            Err(TransformError {
                code: ErrorCode::Schema,
                ..
            })
        ));
        fs::hard_link(
            directory.path().join("source.mp4"),
            directory.path().join("alias.mp4"),
        )
        .unwrap();
        assert!(matches!(
            prepare(&root, input("source.mp4", "alias.mp4")),
            Err(TransformError {
                code: ErrorCode::Schema,
                ..
            })
        ));
        assert!(prepare(&root, input("source.mp4", "other.mp4")).is_ok());
        assert!(prepare(&root, input("source.mp4", "../escape.mp4")).is_err());
        let mut invalid = input("source.mp4", "other.mp4");
        invalid.options.timeout_millis = 120_001;
        assert!(matches!(
            prepare(&root, invalid),
            Err(TransformError {
                code: ErrorCode::OutputLimit,
                ..
            })
        ));
        let mut invalid = input("source.mp4", "other.mp4");
        invalid.sources[0].source_sha256 = Some("bad-secret-digest".into());
        let error = prepare(&root, invalid).err().unwrap();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(!error.message.contains("bad-secret-digest"));
        let encoded = json!({"sources":[{"id":"artwork","source":"source.mp4"}],
            "spec":spec(),"output":"other.mp4","ffmpeg":"/arbitrary/program"});
        assert!(parse_tool_input::<RenderInput>(encoded).is_err());
        assert_eq!(
            fs::read(directory.path().join("source.mp4")).unwrap(),
            b"source"
        );
    }

    #[test]
    fn complete_receipt_rejects_source_timing_decode_and_size_drift() {
        let plan = plan_video(&spec()).unwrap();
        let sha = "1".repeat(64);
        let output = Path::new("private.mp4");
        let result = VideoRenderResult {
            status: VideoRenderStatus::Written,
            dry_run: false,
            output: "private.mp4".into(),
            bytes: 128,
            sha256: "2".repeat(64),
            plan: plan.clone(),
            sources: vec![worldbend_render::TimelineSourceEvidence {
                source_id: plan.motion.source_id.clone(),
                source_sha256: sha.clone(),
                width: 2,
                height: 2,
                warnings: vec![],
            }],
            frames: plan
                .motion
                .frames
                .iter()
                .map(|frame| worldbend_render::VideoRenderedFrame {
                    index: frame.index,
                    presentation_time: frame.presentation_time,
                    raster_sha256: "3".repeat(64),
                })
                .collect(),
            encoder: worldbend_render::VideoEncoderEvidence {
                backend: "ffmpeg".into(),
                version: "ffmpeg version actual".into(),
                probe_version: "ffprobe version actual".into(),
                codec: "libx264".into(),
            },
            decoded_frame_count: plan.motion.frames.len() as u32,
            staging_bytes: 1024,
            warnings: vec![],
        };
        let options = OptionsInput::default().try_into().unwrap();
        validate_receipt(&result, &plan, &sha, output, options).unwrap();
        for change in 0..7 {
            let mut changed = result.clone();
            match change {
                0 => changed.sources[0].source_sha256 = "0".repeat(64),
                1 => changed.frames[1].presentation_time = changed.frames[0].presentation_time,
                2 => changed.decoded_frame_count -= 1,
                3 => changed.bytes = MAX_VIDEO_ENCODED_BYTES + 1,
                4 => changed.plan.background_rgb[0] += 1,
                5 => changed.output = "other.mp4".into(),
                _ => changed.encoder.codec = "other".into(),
            }
            assert!(validate_receipt(&changed, &plan, &sha, output, options).is_err());
        }
    }

    #[tokio::test]
    async fn cancellation_at_final_barrier_preserves_existing_movie_and_cleans_staging() {
        let directory = tempfile::tempdir().unwrap();
        let private = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("movie.mp4"), b"existing").unwrap();
        let bytes = b"verified-new-movie";
        let source = private.path().join("movie.mp4");
        fs::write(&source, bytes).unwrap();
        let root = WorkspaceRoot::open(directory.path()).unwrap();
        let target = root.prepare_file_output("movie.mp4", true).unwrap();
        let commit = target
            .stage_from_with_cancel(
                &source,
                bytes.len() as u64,
                &hex::encode(Sha256::digest(bytes)),
                1024,
                &|| false,
            )
            .unwrap();
        let cancellation = CancellationToken::new();
        let trigger = cancellation.clone();
        let admissions = Arc::new(Semaphore::new(1));
        let slots = Arc::new(Semaphore::new(1));
        let result = execute_bounded_output(
            "Video",
            admissions.clone().acquire_owned().await.unwrap(),
            slots.clone(),
            Duration::from_secs(1),
            cancellation.clone(),
            cancellation.child_token(),
            async move {
                trigger.cancel();
                Ok(PreparedFileResult {
                    result: 1_u32,
                    commit: Some(commit),
                })
            },
        )
        .await;
        assert_eq!(result.unwrap_err().code, ErrorCode::Cancelled);
        assert_eq!(
            fs::read(directory.path().join("movie.mp4")).unwrap(),
            b"existing"
        );
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
        assert_eq!(admissions.available_permits(), 1);
        assert_eq!(slots.available_permits(), 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn worker_exit_retires_descendants_holding_pipes_before_reaping() {
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 30 & echo $!"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .kill_on_drop(true);
        let mut worker = OwnedWorker::new(command.spawn().unwrap()).unwrap();
        let group = worker.group.id();
        let started = Instant::now();
        let (stdout, _, status) = timeout(Duration::from_secs(5), read_worker_output(&mut worker))
            .await
            .unwrap()
            .unwrap();
        assert!(status.success());
        assert!(
            String::from_utf8(stdout)
                .unwrap()
                .trim()
                .parse::<u32>()
                .unwrap()
                > 0
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        #[cfg(target_os = "macos")]
        assert_eq!(worldbend_process::group_memory_bytes(group).unwrap(), 0);
        #[cfg(not(target_os = "macos"))]
        let _ = group;
    }
}

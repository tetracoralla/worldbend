use crate::{
    CanvasMode, RenderLimits, RenderOptions, SamplingQuality, TimelineFileSource,
    TimelineSourceEvidence,
    file_io::{
        decode_file_with_limits, output_parent, preflight_file_destination,
        publish_staged_media_file, write_png,
    },
    mockup::{MockupRenderOptions, render_mockup_with_cancel},
    render_image_with_cancel, validate_limits,
};
use image::{DynamicImage, RgbaImage};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};
use worldbend_core::{
    ErrorCode, MAX_VIDEO_PIXELS, MockupVideoPlan, MockupVideoSpec, RationalTime, TransformError,
    TransformResult, VideoEncoding, VideoPlan, VideoSpec, bounded_text, plan_mockup_video,
    plan_video,
};

pub const MAX_VIDEO_ENCODED_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_VIDEO_STAGING_BYTES: u64 = 512 * 1024 * 1024;
const MAX_TOOL_OUTPUT_BYTES: usize = 128 * 1024;
const MAX_TOOL_ERROR_BYTES: usize = 16 * 1024;

/// Host-selected installed executables, separate from portable authored state.
/// Neither the VideoSpec nor an Agent request may select arbitrary programs.
#[derive(Debug, Clone)]
pub struct FfmpegEncoder {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
    externally_supervised: bool,
}
impl FfmpegEncoder {
    pub fn new(ffmpeg: &Path, ffprobe: &Path) -> TransformResult<Self> {
        Ok(Self {
            ffmpeg: executable(ffmpeg)?,
            ffprobe: executable(ffprobe)?,
            externally_supervised: false,
        })
    }

    /// Run inside a one-job worker whose controller retires all descendants
    /// on completion/cancellation/death. Unix requires an owned leader group;
    /// Windows callers must hold the worker's kill-on-close resource job.
    /// This host-only configuration never enters portable authored state.
    pub fn in_supervised_worker(mut self) -> TransformResult<Self> {
        #[cfg(unix)]
        if unsafe { libc::getpgrp() } != unsafe { libc::getpid() } {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "supervised video execution requires an owned worker process group",
            ));
        }
        self.externally_supervised = true;
        Ok(self)
    }
}
fn executable(path: &Path) -> TransformResult<PathBuf> {
    if !path.is_absolute() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "video encoder paths must be explicit absolute host paths",
        ));
    }
    let path = fs::canonicalize(path).map_err(io_error("video encoder is unavailable"))?;
    if !fs::metadata(&path)
        .map_err(io_error("video encoder is unavailable"))?
        .is_file()
    {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "video encoder must be a regular executable",
        ));
    }
    Ok(path)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[schemars(range(min = 1, max = MAX_VIDEO_PIXELS))]
    pub max_cumulative_pixels: u64,
    #[schemars(range(min = 1, max = MAX_VIDEO_STAGING_BYTES))]
    pub max_staging_bytes: u64,
    #[schemars(range(min = 1, max = MAX_VIDEO_ENCODED_BYTES))]
    pub max_encoded_bytes: u64,
    #[schemars(range(min = 1, max = 120000))]
    pub timeout_millis: u64,
}
impl Default for VideoRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
            max_cumulative_pixels: MAX_VIDEO_PIXELS,
            max_staging_bytes: MAX_VIDEO_STAGING_BYTES,
            max_encoded_bytes: MAX_VIDEO_ENCODED_BYTES,
            timeout_millis: 90_000,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VideoRenderStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoEncoderEvidence {
    pub backend: String,
    pub version: String,
    pub probe_version: String,
    pub codec: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoRenderedFrame {
    pub index: u32,
    pub presentation_time: RationalTime,
    /// Digest of the opaque pre-encode PNG, not of a lossy decoded frame.
    pub raster_sha256: String,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VideoRenderResult {
    pub status: VideoRenderStatus,
    pub dry_run: bool,
    pub output: String,
    pub bytes: u64,
    pub sha256: String,
    pub plan: VideoPlan,
    pub sources: Vec<TimelineSourceEvidence>,
    pub frames: Vec<VideoRenderedFrame>,
    pub encoder: VideoEncoderEvidence,
    pub decoded_frame_count: u32,
    pub staging_bytes: u64,
    pub warnings: Vec<String>,
}

pub fn render_video_file(
    sources: &HashMap<String, PathBuf>,
    spec: &VideoSpec,
    output: &Path,
    encoder: &FfmpegEncoder,
    options: VideoRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<VideoRenderResult> {
    let sources = sources
        .iter()
        .map(|(id, path)| {
            (
                id.clone(),
                TimelineFileSource {
                    path: path.clone(),
                    source_sha256: None,
                },
            )
        })
        .collect();
    render_video_file_with_cancel(
        &sources,
        spec,
        output,
        encoder,
        options,
        overwrite,
        dry_run,
        &|| false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn render_video_file_with_cancel(
    sources: &HashMap<String, TimelineFileSource>,
    spec: &VideoSpec,
    output: &Path,
    encoder: &FfmpegEncoder,
    options: VideoRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<VideoRenderResult> {
    validate_options(options)?;
    let plan = plan_video(spec)?;
    if !output
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "MP4 video output requires an .mp4 extension",
        ));
    }
    let control = Control {
        started: Instant::now(),
        timeout: Duration::from_millis(options.timeout_millis),
        is_cancelled,
    };
    control.check()?;
    if sources.len() != 1 || !sources.contains_key(&plan.motion.source_id) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "video sources must exactly match the authored sourceId",
        ));
    }
    let size = plan.motion.output;
    if size.width > options.limits.max_width
        || size.height > options.limits.max_height
        || u64::from(size.width) * u64::from(size.height) > options.limits.max_pixels
        || plan.motion.timeline.cumulative_output_pixels > options.max_cumulative_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "video exceeds configured raster limits",
        ));
    }
    preflight_file_destination(output, overwrite)?;
    let input = &sources[&plan.motion.source_id];
    if let (Ok(source), Ok(destination)) = (fs::canonicalize(&input.path), fs::canonicalize(output))
        && source == destination
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "lossy video delivery must use a destination separate from its source",
        ));
    }
    let evidence = VideoEncoderEvidence {
        backend: "ffmpeg".into(),
        version: tool_version(
            &encoder.ffmpeg,
            "ffmpeg version ",
            &control,
            encoder.externally_supervised,
        )?,
        probe_version: tool_version(
            &encoder.ffprobe,
            "ffprobe version ",
            &control,
            encoder.externally_supervised,
        )?,
        codec: "libx264".into(),
    };
    let (image, source_sha256, source_warnings) =
        decode_file_with_limits(&input.path, options.limits, input.source_sha256.as_deref())?;
    control.check()?;
    let source = TimelineSourceEvidence {
        source_id: plan.motion.source_id.clone(),
        source_sha256,
        width: image.width(),
        height: image.height(),
        warnings: source_warnings,
    };
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-video-stage-")
        .tempdir_in(output_parent(output))
        .map_err(io_error("failed to create private video staging"))?;
    let mut staging_bytes = 0;
    let mut frames = Vec::with_capacity(plan.motion.frames.len());
    for (frame, timing) in plan.motion.timeline.frames.iter().zip(&plan.motion.frames) {
        control.check()?;
        let rendered = render_image_with_cancel(
            &image,
            &frame.transform,
            RenderOptions {
                source_view: None,
                quality: options.quality,
                canvas: CanvasMode::Reference,
                target_size: Some(size.as_size()),
                limits: options.limits,
            },
            &|| control.check().is_err(),
        )
        .map_err(|error| control.check().err().unwrap_or(error))?;
        if rendered.image.width() != size.width || rendered.image.height() != size.height {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "video renderer returned a different frame size",
            ));
        }
        let mut opaque = rendered.image;
        matte(&mut opaque, plan.background_rgb, &control)?;
        let frame_path = staging.path().join(format!("frame-{:06}.png", frame.index));
        let file = fs::File::create(&frame_path)
            .map_err(io_error("failed to create staged video frame"))?;
        let mut writer = StagedWriter {
            file,
            hasher: Sha256::new(),
            bytes: 0,
            maximum: options.max_staging_bytes - staging_bytes,
            exceeded: false,
            control: &control,
        };
        if let Err(error) = write_png(&opaque, &mut writer) {
            return Err(if let Err(stopped) = control.check() {
                stopped
            } else if writer.exceeded {
                TransformError::new(
                    ErrorCode::OutputLimit,
                    "video frames exceed the encoded staging byte limit",
                )
            } else {
                error
            });
        }
        writer
            .flush()
            .map_err(io_error("failed to flush staged video frame"))?;
        staging_bytes += writer.bytes;
        frames.push(VideoRenderedFrame {
            index: frame.index,
            presentation_time: timing.presentation_time,
            raster_sha256: hex::encode(writer.hasher.finalize()),
        });
    }
    control.check()?;
    let rate = plan.motion.timebase;
    let encoded = staging.path().join("video.mp4");
    let VideoEncoding::Mp4H264 { crf } = plan.encoding;
    let mut command = Command::new(&encoder.ffmpeg);
    command.current_dir(staging.path()).args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-threads",
        "2",
        "-framerate",
        &format!("{}/{}", rate.numerator, rate.denominator),
        "-f",
        "image2",
        "-pattern_type",
        "sequence",
        "-start_number",
        "0",
        "-i",
        "frame-%06d.png",
        "-map",
        "0:v:0",
        "-an",
        "-frames:v",
        &frames.len().to_string(),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        &crf.to_string(),
        "-threads",
        "2",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv,setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-fps_mode",
        "cfr",
        "-video_track_timescale",
        &rate.numerator.to_string(),
        "-movie_timescale",
        &rate.numerator.to_string(),
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-fs",
        &(options.max_encoded_bytes + 1).to_string(),
        "-f",
        "mp4",
        "video.mp4",
    ]);
    run_tool(
        &mut command,
        &control,
        Some((&encoded, options.max_encoded_bytes)),
        encoder.externally_supervised,
    )?;
    control.check()?;
    let bytes = fs::metadata(&encoded)
        .map_err(io_error("video encoder produced no output"))?
        .len();
    if bytes == 0 || bytes > options.max_encoded_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded video exceeds the byte limit or is empty",
        ));
    }
    let mut probe = Command::new(&encoder.ffprobe);
    probe.args(["-v","error","-show_streams","-show_frames","-show_format","-show_entries",
        "stream=codec_name,codec_type,width,height,pix_fmt,time_base,nb_frames,duration_ts,color_range,color_space,color_transfer,color_primaries,sample_aspect_ratio:frame=best_effort_timestamp:format=format_name,duration",
        "-of","json"]).arg(&encoded);
    let decoded = run_tool(&mut probe, &control, None, encoder.externally_supervised)?;
    let decoded_frame_count = validate_probe(&decoded, &plan)?;
    let mut file = fs::File::open(&encoded).map_err(io_error("failed to read staged video"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        control.check()?;
        let count = file
            .read(&mut buffer)
            .map_err(io_error("failed to hash staged video"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    file.sync_all()
        .map_err(io_error("failed to sync staged video"))?;
    let sha256 = hex::encode(hasher.finalize());
    control.check()?;
    if !dry_run {
        publish_staged_media_file(&encoded, output, overwrite)?;
    }
    Ok(VideoRenderResult {status:if dry_run {VideoRenderStatus::Ready}else {VideoRenderStatus::Written},dry_run,
        output:output.display().to_string(),bytes,sha256,plan,sources:vec![source],frames,
        encoder:evidence,decoded_frame_count,staging_bytes,
        warnings:vec!["MP4 H.264 delivery is opaque and lossy: alpha is composited onto the explicit sRGB8 matte, then converted to limited-range yuv420p; decoded pixels are not exact PNG pixels".into()]})
}

fn validate_options(options: VideoRenderOptions) -> TransformResult<()> {
    validate_limits(options.limits)?;
    if options.max_cumulative_pixels == 0
        || options.max_cumulative_pixels > MAX_VIDEO_PIXELS
        || options.max_staging_bytes == 0
        || options.max_staging_bytes > MAX_VIDEO_STAGING_BYTES
        || options.max_encoded_bytes == 0
        || options.max_encoded_bytes > MAX_VIDEO_ENCODED_BYTES
        || options.timeout_millis == 0
        || options.timeout_millis > 120_000
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "video execution limits exceed the supported bounded profile",
        ));
    }
    Ok(())
}
struct Control<'a> {
    started: Instant,
    timeout: Duration,
    is_cancelled: &'a (dyn Fn() -> bool + Sync),
}
impl Control<'_> {
    fn check(&self) -> TransformResult<()> {
        if (self.is_cancelled)() {
            Err(TransformError::new(
                ErrorCode::Cancelled,
                "video delivery was cancelled",
            ))
        } else if self.started.elapsed() >= self.timeout {
            Err(TransformError::new(
                ErrorCode::Timeout,
                "video delivery exceeded its execution deadline",
            ))
        } else {
            Ok(())
        }
    }
}
fn matte(image: &mut RgbaImage, rgb: [u8; 3], control: &Control<'_>) -> TransformResult<()> {
    for (index, pixel) in image.pixels_mut().enumerate() {
        if index % 4096 == 0 {
            control.check()?;
        }
        let alpha = u32::from(pixel[3]);
        for channel in 0..3 {
            pixel[channel] = ((u32::from(pixel[channel]) * alpha
                + u32::from(rgb[channel]) * (255 - alpha)
                + 127)
                / 255) as u8;
        }
        pixel[3] = 255;
    }
    Ok(())
}
struct StagedWriter<'a, 'b> {
    file: fs::File,
    hasher: Sha256,
    bytes: u64,
    maximum: u64,
    exceeded: bool,
    control: &'a Control<'b>,
}
impl Write for StagedWriter<'_, '_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.control
            .check()
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        if bytes.len() as u64 > self.maximum - self.bytes {
            self.exceeded = true;
            return Err(std::io::Error::other("video staging byte limit"));
        }
        let count = self.file.write(bytes)?;
        self.bytes += count as u64;
        self.hasher.update(&bytes[..count]);
        Ok(count)
    }
    fn flush(&mut self) -> std::io::Result<()> {
        self.file.flush()
    }
}
fn tool_version(
    path: &Path,
    prefix: &str,
    control: &Control<'_>,
    externally_supervised: bool,
) -> TransformResult<String> {
    let bytes = run_tool(
        Command::new(path).arg("-version"),
        control,
        None,
        externally_supervised,
    )?;
    let line = String::from_utf8_lossy(&bytes)
        .lines()
        .next()
        .unwrap_or("")
        .to_owned();
    if !line.starts_with(prefix) {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "host executable is not the selected FFmpeg tool",
        ));
    }
    Ok(bounded_text(&line, 200))
}
struct OwnedChild {
    child: Child,
    #[cfg(unix)]
    group: Option<worldbend_process::OwnedProcessGroup>,
}
impl OwnedChild {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        #[cfg(unix)]
        {
            if !worldbend_process::child_exit_ready(self.child.id())? {
                return Ok(None);
            }
            if let Some(group) = &mut self.group {
                group.retire()?;
            }
        }
        self.child.try_wait()
    }
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        // Isolated group also retires descendants of a host wrapper on cancellation.
        #[cfg(unix)]
        if let Some(group) = &mut self.group {
            let _ = group.retire();
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
fn read_bounded(
    mut reader: impl Read + Send + 'static,
    maximum: usize,
    overflow: Arc<AtomicBool>,
) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut buffer = [0; 4096];
        loop {
            let count = reader.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            if bytes.len() + count > maximum {
                overflow.store(true, Ordering::SeqCst);
            } else {
                bytes.extend_from_slice(&buffer[..count]);
            }
        }
        Ok(bytes)
    })
}
fn run_tool(
    command: &mut Command,
    control: &Control<'_>,
    watched: Option<(&Path, u64)>,
    externally_supervised: bool,
) -> TransformResult<Vec<u8>> {
    control.check()?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        if !externally_supervised {
            command.process_group(0);
        }
    }
    let mut child = OwnedChild {
        child: command
            .spawn()
            .map_err(io_error("failed to launch configured video tool"))?,
        #[cfg(unix)]
        group: None,
    };
    #[cfg(unix)]
    if !externally_supervised {
        child.group = Some(
            worldbend_process::OwnedProcessGroup::from_child(child.child.id())
                .map_err(io_error("video child process-group ownership failed"))?,
        );
    }
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = read_bounded(
        child.child.stdout.take().expect("piped stdout"),
        MAX_TOOL_OUTPUT_BYTES,
        overflow.clone(),
    );
    let stderr = read_bounded(
        child.child.stderr.take().expect("piped stderr"),
        MAX_TOOL_ERROR_BYTES,
        overflow.clone(),
    );
    let status = loop {
        let condition = control.check().and_then(|()| {
            if overflow.load(Ordering::SeqCst) {
                return Err(TransformError::new(
                    ErrorCode::OutputLimit,
                    "video tool output exceeds the bounded response",
                ));
            }
            if let Some((path, maximum)) = watched
                && let Ok(meta) = fs::metadata(path)
                && meta.len() > maximum
            {
                return Err(TransformError::new(
                    ErrorCode::OutputLimit,
                    "encoded video exceeds the byte limit",
                ));
            }
            Ok(())
        });
        if let Err(error) = condition {
            drop(child);
            // An externally supervised worker cannot kill its own whole
            // group: its controller must first receive this typed failure.
            // A wrapper descendant may still hold either pipe. Do not block
            // the failure on it; worker completion retires those descendants
            // and its reader threads through the controller-owned group.
            if externally_supervised {
                return Err(error);
            }
            let _ = stdout.join();
            let _ = stderr.join();
            return Err(error);
        }
        match child
            .try_wait()
            .map_err(io_error("failed to wait for video tool"))?
        {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(10)),
        }
    };
    drop(child);
    // Even after the configured program exits, a descendant can retain its
    // pipes. Reader completion is part of the same deadline, and output
    // overflow must keep its own failure instead of becoming a later timeout.
    while !stdout.is_finished() || !stderr.is_finished() {
        control.check()?;
        if overflow.load(Ordering::SeqCst) {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "video tool output exceeds the bounded response",
            ));
        }
        thread::sleep(Duration::from_millis(5));
    }
    let stdout = stdout
        .join()
        .map_err(|_| TransformError::new(ErrorCode::Internal, "video stdout reader failed"))?
        .map_err(io_error("failed to read video tool output"))?;
    let stderr = stderr
        .join()
        .map_err(|_| TransformError::new(ErrorCode::Internal, "video stderr reader failed"))?
        .map_err(io_error("failed to read video tool diagnostics"))?;
    control.check()?;
    if overflow.load(Ordering::SeqCst) {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "video tool output exceeds the bounded response",
        ));
    }
    if !status.success() {
        return Err(TransformError::new(ErrorCode::Render,"configured video tool failed")
            .with_details(json!({"exitCode":status.code(),"reason":bounded_text(&String::from_utf8_lossy(&stderr),2048)})));
    }
    Ok(stdout)
}
fn number(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}
fn validate_probe(bytes: &[u8], plan: &VideoPlan) -> TransformResult<u32> {
    let fail = || {
        TransformError::new(
            ErrorCode::Render,
            "encoded video failed decoded frame, format or exact timing validation",
        )
    };
    let value: Value = serde_json::from_slice(bytes).map_err(|_| fail())?;
    let streams = value["streams"].as_array().ok_or_else(fail)?;
    let frames = value["frames"].as_array().ok_or_else(fail)?;
    if !value["format"]["format_name"]
        .as_str()
        .is_some_and(|name| name.split(',').any(|format| format == "mp4"))
        || !value["format"]["duration"]
            .as_str()
            .and_then(|duration| duration.parse::<f64>().ok())
            .is_some_and(|duration| {
                duration.is_finite()
                    && (duration
                        - plan.duration.numerator as f64 / plan.duration.denominator as f64)
                        .abs()
                        <= 0.000001
            })
    {
        return Err(fail());
    }
    if streams.len() != 1 || frames.len() != plan.motion.frames.len() {
        return Err(fail());
    }
    let stream = &streams[0];
    let rate = plan.motion.timebase;
    let expected_duration = frames.len() as u64 * u64::from(rate.denominator);
    if stream["codec_name"] != "h264"
        || stream["codec_type"] != "video"
        || stream["pix_fmt"] != "yuv420p"
        || number(&stream["width"]) != Some(u64::from(plan.motion.output.width))
        || number(&stream["height"]) != Some(u64::from(plan.motion.output.height))
        || stream["time_base"] != format!("1/{}", rate.numerator)
        || number(&stream["duration_ts"]) != Some(expected_duration)
        || number(&stream["nb_frames"]) != Some(frames.len() as u64)
        || stream["color_space"] != "bt709"
        || stream["color_range"] != "tv"
        || stream["color_transfer"] != "iec61966-2-1"
        || stream["color_primaries"] != "bt709"
        || stream["sample_aspect_ratio"] != "1:1"
        || frames.iter().enumerate().any(|(index, frame)| {
            number(&frame["best_effort_timestamp"])
                != Some(index as u64 * u64::from(rate.denominator))
        })
    {
        return Err(fail());
    }
    Ok(frames.len() as u32)
}
fn io_error(message: &'static str) -> impl FnOnce(std::io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, message)
            .with_details(json!({"reason":error.to_string()}))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupVideoRenderResult {
    pub status: VideoRenderStatus,
    pub dry_run: bool,
    pub output: String,
    pub bytes: u64,
    pub sha256: String,
    pub plan: MockupVideoPlan,
    pub sources: Vec<TimelineSourceEvidence>,
    pub frames: Vec<VideoRenderedFrame>,
    pub encoder: VideoEncoderEvidence,
    pub decoded_frame_count: u32,
    pub staging_bytes: u64,
    pub warnings: Vec<String>,
}

pub fn render_mockup_video_file(
    sources: &HashMap<String, TimelineFileSource>,
    spec: &MockupVideoSpec,
    output: &Path,
    encoder: &FfmpegEncoder,
    options: VideoRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<MockupVideoRenderResult> {
    render_mockup_video_file_with_cancel(
        sources,
        spec,
        output,
        encoder,
        options,
        overwrite,
        dry_run,
        &|| false,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn render_mockup_video_file_with_cancel(
    sources: &HashMap<String, TimelineFileSource>,
    spec: &MockupVideoSpec,
    output: &Path,
    encoder: &FfmpegEncoder,
    options: VideoRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MockupVideoRenderResult> {
    validate_options(options)?;
    let plan = plan_mockup_video(spec)?;
    if !output
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("mp4"))
    {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "MP4 video output requires an .mp4 extension",
        ));
    }
    let control = Control {
        started: Instant::now(),
        timeout: Duration::from_millis(options.timeout_millis),
        is_cancelled,
    };
    control.check()?;
    let expected: HashSet<_> = plan.mockup_motion.source_ids.iter().cloned().collect();
    let provided: HashSet<_> = sources.keys().cloned().collect();
    if expected != provided {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mockup-video sources must exactly match the authored plane sourceIds",
        ));
    }
    let size = plan.mockup_motion.output_size();
    if size.width > options.limits.max_width
        || size.height > options.limits.max_height
        || u64::from(size.width) * u64::from(size.height) > options.limits.max_pixels
        || plan.mockup_motion.cumulative_output_pixels > options.max_cumulative_pixels
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "mockup-video exceeds configured raster limits",
        ));
    }
    preflight_file_destination(output, overwrite)?;
    for source in sources.values() {
        if let (Ok(src), Ok(destination)) =
            (fs::canonicalize(&source.path), fs::canonicalize(output))
            && src == destination
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "lossy video delivery must use a destination separate from its source",
            ));
        }
    }
    let evidence = VideoEncoderEvidence {
        backend: "ffmpeg".into(),
        version: tool_version(
            &encoder.ffmpeg,
            "ffmpeg version ",
            &control,
            encoder.externally_supervised,
        )?,
        probe_version: tool_version(
            &encoder.ffprobe,
            "ffprobe version ",
            &control,
            encoder.externally_supervised,
        )?,
        codec: "libx264".into(),
    };

    let mut decoded: HashMap<String, DynamicImage> = HashMap::new();
    let mut source_evidence = Vec::with_capacity(sources.len());
    for source_id in &plan.mockup_motion.source_ids {
        control.check()?;
        let input = &sources[source_id];
        let (image, source_sha256, source_warnings) =
            decode_file_with_limits(&input.path, options.limits, input.source_sha256.as_deref())?;
        source_evidence.push(TimelineSourceEvidence {
            source_id: source_id.clone(),
            source_sha256,
            width: image.width(),
            height: image.height(),
            warnings: source_warnings,
        });
        decoded.insert(source_id.clone(), image);
    }

    let staging = tempfile::Builder::new()
        .prefix(".worldbend-mockup-video-stage-")
        .tempdir_in(output_parent(output))
        .map_err(io_error("failed to create private mockup-video staging"))?;
    let mut staging_bytes = 0u64;
    let mut frames = Vec::with_capacity(plan.mockup_motion.frames.len());
    let mockup_options = MockupRenderOptions {
        quality: options.quality,
        limits: options.limits,
    };
    for (index, (frame_spec, timing)) in plan
        .mockup_motion
        .frame_specs
        .iter()
        .zip(&plan.mockup_motion.frames)
        .enumerate()
    {
        control.check()?;
        let rendered = render_mockup_with_cancel(&decoded, frame_spec, mockup_options, &|| {
            control.check().is_err()
        })
        .map_err(|error| control.check().err().unwrap_or(error))?;
        let image = crate::mockup_motion_presentation::render_motion_presentation_with_cancel(
            rendered.image,
            plan.mockup_motion.presentation_at(index),
            mockup_options,
            &|| control.check().is_err(),
        )
        .map_err(|error| control.check().err().unwrap_or(error))?;
        if image.width() != size.width || image.height() != size.height {
            return Err(TransformError::new(
                ErrorCode::Internal,
                "mockup-video renderer returned a different frame size",
            ));
        }
        let mut opaque = image;
        matte(&mut opaque, plan.background_rgb, &control)?;
        let frame_path = staging
            .path()
            .join(format!("frame-{:06}.png", timing.index));
        let file = fs::File::create(&frame_path)
            .map_err(io_error("failed to create staged mockup-video frame"))?;
        let mut writer = StagedWriter {
            file,
            hasher: Sha256::new(),
            bytes: 0,
            maximum: options.max_staging_bytes.saturating_sub(staging_bytes),
            exceeded: false,
            control: &control,
        };
        if let Err(error) = write_png(&opaque, &mut writer) {
            return Err(if let Err(stopped) = control.check() {
                stopped
            } else if writer.exceeded {
                TransformError::new(
                    ErrorCode::OutputLimit,
                    "mockup-video frames exceed the encoded staging byte limit",
                )
            } else {
                error
            });
        }
        writer
            .flush()
            .map_err(io_error("failed to flush staged mockup-video frame"))?;
        staging_bytes += writer.bytes;
        frames.push(VideoRenderedFrame {
            index: timing.index,
            presentation_time: timing.presentation_time,
            raster_sha256: hex::encode(writer.hasher.finalize()),
        });
    }
    control.check()?;
    let rate = plan.mockup_motion.timebase;
    let encoded = staging.path().join("video.mp4");
    let VideoEncoding::Mp4H264 { crf } = plan.encoding;
    let mut command = Command::new(&encoder.ffmpeg);
    command.current_dir(staging.path()).args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-n",
        "-threads",
        "2",
        "-framerate",
        &format!("{}/{}", rate.numerator, rate.denominator),
        "-f",
        "image2",
        "-pattern_type",
        "sequence",
        "-start_number",
        "0",
        "-i",
        "frame-%06d.png",
        "-map",
        "0:v:0",
        "-an",
        "-frames:v",
        &frames.len().to_string(),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        &crf.to_string(),
        "-threads",
        "2",
        "-bf",
        "0",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale=out_color_matrix=bt709:out_range=tv,setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=iec61966-2-1:colorspace=bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "iec61966-2-1",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        "-fps_mode",
        "cfr",
        "-video_track_timescale",
        &rate.numerator.to_string(),
        "-movie_timescale",
        &rate.numerator.to_string(),
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        "-fs",
        &(options.max_encoded_bytes + 1).to_string(),
        "-f",
        "mp4",
        "video.mp4",
    ]);
    run_tool(
        &mut command,
        &control,
        Some((&encoded, options.max_encoded_bytes)),
        encoder.externally_supervised,
    )?;
    control.check()?;
    let bytes = fs::metadata(&encoded)
        .map_err(io_error("mockup-video encoder produced no output"))?
        .len();
    if bytes == 0 || bytes > options.max_encoded_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded mockup-video exceeds the byte limit or is empty",
        ));
    }
    let mut probe = Command::new(&encoder.ffprobe);
    probe.args([
        "-v",
        "error",
        "-show_streams",
        "-show_frames",
        "-show_format",
        "-show_entries",
        "stream=codec_name,codec_type,width,height,pix_fmt,time_base,nb_frames,duration_ts,color_range,color_space,color_transfer,color_primaries,sample_aspect_ratio:frame=best_effort_timestamp:format=format_name,duration",
        "-of",
        "json",
    ])
    .arg(&encoded);
    let decoded_bytes = run_tool(&mut probe, &control, None, encoder.externally_supervised)?;
    let decoded_frame_count = validate_mockup_probe(&decoded_bytes, &plan)?;
    let mut file =
        fs::File::open(&encoded).map_err(io_error("failed to read staged mockup-video"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        control.check()?;
        let count = file
            .read(&mut buffer)
            .map_err(io_error("failed to hash staged mockup-video"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    file.sync_all()
        .map_err(io_error("failed to sync staged mockup-video"))?;
    let sha256 = hex::encode(hasher.finalize());
    control.check()?;
    if !dry_run {
        publish_staged_media_file(&encoded, output, overwrite)?;
    }
    Ok(MockupVideoRenderResult {
        status: if dry_run {
            VideoRenderStatus::Ready
        } else {
            VideoRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        bytes,
        sha256,
        plan,
        sources: source_evidence,
        frames,
        encoder: evidence,
        decoded_frame_count,
        staging_bytes,
        warnings: vec![
            "MP4 H.264 mockup-video delivery is opaque and lossy: multi-plane mockup frames are composited, alpha is matted onto the explicit sRGB8 background, then converted to limited-range yuv420p; decoded pixels are not exact PNG pixels".into(),
        ],
    })
}

fn validate_mockup_probe(bytes: &[u8], plan: &MockupVideoPlan) -> TransformResult<u32> {
    // Reuse ordinary video probe rules by synthesizing a VideoPlan-shaped view.
    let synthetic = VideoPlan {
        schema: worldbend_core::VIDEO_PLAN_SCHEMA.into(),
        version: worldbend_core::VIDEO_VERSION.into(),
        encoding: plan.encoding,
        background_rgb: plan.background_rgb,
        duration: plan.duration,
        motion: worldbend_core::MotionPlan {
            schema: worldbend_core::MOTION_PLAN_SCHEMA.into(),
            version: worldbend_core::MOTION_VERSION.into(),
            output: plan.mockup_motion.output_size(),
            timebase: plan.mockup_motion.timebase,
            duration: plan.mockup_motion.duration,
            source_id: plan
                .mockup_motion
                .source_ids
                .first()
                .cloned()
                .unwrap_or_else(|| "mockup".into()),
            frames: plan.mockup_motion.frames.clone(),
            timeline: worldbend_core::TimelinePlan {
                schema: worldbend_core::TIMELINE_PLAN_SCHEMA.into(),
                version: worldbend_core::TIMELINE_VERSION.into(),
                output: plan.mockup_motion.output_size(),
                frames: plan
                    .mockup_motion
                    .frames
                    .iter()
                    .map(|timing| worldbend_core::TimelinePlanFrame {
                        index: timing.index,
                        id: timing.id.clone(),
                        source_id: plan
                            .mockup_motion
                            .source_ids
                            .first()
                            .cloned()
                            .unwrap_or_else(|| "mockup".into()),
                        transform: plan.mockup_motion.frame_specs[timing.index as usize].planes[0]
                            .transform
                            .clone(),
                    })
                    .collect(),
                source_ids: plan.mockup_motion.source_ids.clone(),
                cumulative_output_pixels: plan.mockup_motion.cumulative_output_pixels,
            },
        },
    };
    validate_probe(bytes, &synthetic)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba};
    use worldbend_core::{
        FrameRate, MOTION_SCHEMA, MOTION_VERSION, MotionKeyframe, MotionSpec, PixelSize, Point,
        Quad, Size, TransformSpec, VIDEO_SCHEMA, VIDEO_VERSION,
    };
    fn spec() -> VideoSpec {
        let q = Quad::new(
            Point::new(0., 0.),
            Point::new(8., 0.),
            Point::new(8., 6.),
            Point::new(0., 6.),
        );
        VideoSpec {
            schema: VIDEO_SCHEMA.into(),
            version: VIDEO_VERSION.into(),
            background_rgb: [0, 0, 255],
            encoding: VideoEncoding::Mp4H264 { crf: 18 },
            motion: MotionSpec {
                schema: MOTION_SCHEMA.into(),
                version: MOTION_VERSION.into(),
                output: PixelSize::new(8, 6),
                timebase: FrameRate {
                    numerator: 30000,
                    denominator: 1001,
                },
                source_id: "art".into(),
                frame_count: 3,
                base: TransformSpec::pixel(Size::new(8., 6.), q),
                keyframes: vec![
                    MotionKeyframe {
                        frame: 0,
                        quad: q,
                        easing_to_next: None,
                    },
                    MotionKeyframe {
                        frame: 2,
                        quad: q,
                        easing_to_next: None,
                    },
                ],
            },
        }
    }
    fn probe(plan: &VideoPlan) -> Value {
        json!({"format":{"format_name":"mov,mp4,m4a,3gp,3g2,mj2","duration":"0.100100"},"streams":[{"codec_name":"h264","codec_type":"video","width":8,"height":6,"pix_fmt":"yuv420p",
            "time_base":"1/30000","nb_frames":"3","duration_ts":3003,
            "color_range":"tv","color_space":"bt709","color_transfer":"iec61966-2-1","color_primaries":"bt709","sample_aspect_ratio":"1:1"}],
            "frames":(0..plan.motion.frames.len()).map(|i|json!({"best_effort_timestamp":i*1001})).collect::<Vec<_>>()})
    }
    #[test]
    fn matte_owns_alpha_without_leaking_transparent_rgb() {
        let control = Control {
            started: Instant::now(),
            timeout: Duration::from_secs(1),
            is_cancelled: &|| false,
        };
        let mut image =
            RgbaImage::from_raw(3, 1, vec![255, 0, 0, 0, 255, 0, 0, 128, 255, 0, 0, 255]).unwrap();
        matte(&mut image, [0, 0, 255], &control).unwrap();
        assert_eq!(
            image.as_raw(),
            &[0, 0, 255, 255, 128, 0, 127, 255, 255, 0, 0, 255]
        );
    }
    #[test]
    fn validation_requires_decoded_frames_and_exact_track_timing() {
        let plan = plan_video(&spec()).unwrap();
        let valid = probe(&plan);
        assert_eq!(
            validate_probe(&serde_json::to_vec(&valid).unwrap(), &plan).unwrap(),
            3
        );
        for mutate in [
            ("duration_ts", json!(2002)),
            ("width", json!(10)),
            ("pix_fmt", json!("yuv444p")),
            ("time_base", json!("1/1000")),
            ("color_transfer", json!("bt709")),
            ("color_range", json!("pc")),
            ("sample_aspect_ratio", json!("2:1")),
            ("codec_name", json!("mpeg4")),
        ] {
            let mut bad = valid.clone();
            bad["streams"][0][mutate.0] = mutate.1;
            assert!(validate_probe(&serde_json::to_vec(&bad).unwrap(), &plan).is_err());
        }
        let mut bad = valid.clone();
        bad["frames"][1]["best_effort_timestamp"] = 1000.into();
        assert!(validate_probe(&serde_json::to_vec(&bad).unwrap(), &plan).is_err());
        let mut bad = valid.clone();
        bad["frames"].as_array_mut().unwrap().pop();
        assert!(validate_probe(&serde_json::to_vec(&bad).unwrap(), &plan).is_err());
        let mut bad = valid;
        bad["streams"]
            .as_array_mut()
            .unwrap()
            .push(json!({"codec_type":"audio"}));
        assert!(validate_probe(&serde_json::to_vec(&bad).unwrap(), &plan).is_err());
    }
    #[test]
    fn execution_profile_rejects_unbounded_options_and_relative_programs() {
        let options = VideoRenderOptions {
            timeout_millis: 120001,
            ..VideoRenderOptions::default()
        };
        assert_eq!(
            validate_options(options).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        assert_eq!(
            FfmpegEncoder::new(Path::new("ffmpeg"), Path::new("ffprobe"))
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }
    #[cfg(unix)]
    fn tools(root: &Path, encode: &str, probe: &str) -> FfmpegEncoder {
        use std::os::unix::fs::PermissionsExt;
        for (name, body) in [("ffmpeg", encode), ("ffprobe", probe)] {
            let path = root.join(name);
            fs::write(&path,format!("#!/bin/sh\nif [ \"$1\" = -version ]; then echo '{name} version fixture'; exit 0; fi\n{body}\n")).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        }
        FfmpegEncoder::new(&root.join("ffmpeg"), &root.join("ffprobe")).unwrap()
    }
    #[cfg(unix)]
    fn source(root: &Path) -> HashMap<String, TimelineFileSource> {
        let path = root.join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(8, 6, Rgba([255, 0, 0, 128])))
            .save(&path)
            .unwrap();
        HashMap::from([(
            "art".into(),
            TimelineFileSource {
                path,
                source_sha256: None,
            },
        )])
    }
    #[cfg(unix)]
    fn no_staging(root: &Path) -> bool {
        !fs::read_dir(root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".worldbend-video-stage-")
        })
    }
    #[cfg(unix)]
    #[test]
    fn trusted_probe_publication_accepts_mp4_and_preserves_collision_and_dry_run() {
        let root = tempfile::tempdir().unwrap();
        let specification = spec();
        let plan = plan_video(&specification).unwrap();
        // The stub isolates publication mechanics; real decoding is covered by
        // the separately configured FFmpeg/browser runtime check.
        let tools = tools(
            root.path(),
            "printf 'fixture encoded bytes' > video.mp4",
            &format!("cat <<'PROBE'\n{}\nPROBE", probe(&plan)),
        );
        let sources = source(root.path());
        let output = root.path().join("output.mp4");
        let execute = |dry_run| {
            render_video_file_with_cancel(
                &sources,
                &specification,
                &output,
                &tools,
                VideoRenderOptions::default(),
                false,
                dry_run,
                &|| false,
            )
        };
        assert_eq!(execute(true).unwrap().status, VideoRenderStatus::Ready);
        assert!(!output.exists());
        assert!(no_staging(root.path()));
        assert_eq!(execute(false).unwrap().status, VideoRenderStatus::Written);
        assert_eq!(fs::read(&output).unwrap(), b"fixture encoded bytes");
        assert_eq!(
            execute(false).unwrap_err().code,
            ErrorCode::DestinationExists
        );
        assert_eq!(fs::read(&output).unwrap(), b"fixture encoded bytes");
        assert!(no_staging(root.path()));
    }
    #[cfg(unix)]
    #[test]
    fn video_output_cannot_replace_its_original_source_bytes() {
        let root = tempfile::tempdir().unwrap();
        let mut sources = source(root.path());
        let output = root.path().join("source.mp4");
        fs::rename(&sources["art"].path, &output).unwrap();
        sources.get_mut("art").unwrap().path = output.clone();
        let before = fs::read(&output).unwrap();
        let tools = tools(root.path(), "exit 99", "exit 99");
        let error = render_video_file_with_cancel(
            &sources,
            &spec(),
            &output,
            &tools,
            VideoRenderOptions::default(),
            true,
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(fs::read(output).unwrap(), before);
        assert!(no_staging(root.path()));
    }
    #[cfg(unix)]
    #[test]
    fn fake_success_missing_decode_proof_publishes_nothing_and_preserves_source() {
        let root = tempfile::tempdir().unwrap();
        let tools = tools(
            root.path(),
            "printf 'not a movie' > video.mp4",
            "printf '{}'",
        );
        let sources = source(root.path());
        let before = fs::read(&sources["art"].path).unwrap();
        let output = root.path().join("output.mp4");
        let error = render_video_file_with_cancel(
            &sources,
            &spec(),
            &output,
            &tools,
            VideoRenderOptions::default(),
            false,
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Render);
        assert!(!output.exists());
        assert!(no_staging(root.path()));
        assert_eq!(fs::read(&sources["art"].path).unwrap(), before);
        let mut stale = sources;
        stale.get_mut("art").unwrap().source_sha256 = Some("00".repeat(32));
        assert_eq!(
            render_video_file_with_cancel(
                &stale,
                &spec(),
                &output,
                &tools,
                VideoRenderOptions::default(),
                false,
                false,
                &|| false
            )
            .unwrap_err()
            .code,
            ErrorCode::Render
        );
        assert!(!output.exists());
        assert!(no_staging(root.path()));
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_during_encoding_retires_owned_process_group_and_staging() {
        let root = tempfile::tempdir().unwrap();
        let tools = tools(
            root.path(),
            "printf started > started\nsleep 30",
            "printf '{}'",
        );
        let sources = source(root.path());
        let output = root.path().join("output.mp4");
        let cancelled_at = std::sync::Mutex::new(None);
        let cancelled = || {
            let requested = fs::read_dir(root.path())
                .unwrap()
                .any(|entry| entry.unwrap().path().join("started").exists());
            if requested {
                cancelled_at
                    .lock()
                    .unwrap()
                    .get_or_insert_with(Instant::now);
            }
            requested
        };
        let error = render_video_file_with_cancel(
            &sources,
            &spec(),
            &output,
            &tools,
            VideoRenderOptions::default(),
            false,
            false,
            &cancelled,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(cancelled_at.lock().unwrap().unwrap().elapsed() < Duration::from_millis(500));
        assert!(!output.exists());
        assert!(no_staging(root.path()));
    }
    #[cfg(unix)]
    #[test]
    fn deadline_tool_output_and_staging_limits_leave_no_publication() {
        let root = tempfile::tempdir().unwrap();
        let tools = tools(root.path(), "sleep 30", "printf '{}'");
        let sources = source(root.path());
        let output = root.path().join("output.mp4");
        let error = render_video_file_with_cancel(
            &sources,
            &spec(),
            &output,
            &tools,
            VideoRenderOptions {
                timeout_millis: 100,
                ..Default::default()
            },
            false,
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Timeout);
        assert!(!output.exists());
        assert!(no_staging(root.path()));
        let error = render_video_file_with_cancel(
            &sources,
            &spec(),
            &output,
            &tools,
            VideoRenderOptions {
                max_staging_bytes: 1,
                ..Default::default()
            },
            false,
            false,
            &|| false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert!(no_staging(root.path()));
        let control = Control {
            started: Instant::now(),
            timeout: Duration::from_secs(1),
            is_cancelled: &|| false,
        };
        let error = run_tool(
            Command::new("/bin/sh").args(["-c", "yes overflow"]),
            &control,
            None,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::OutputLimit);
    }
}

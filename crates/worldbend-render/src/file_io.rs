use super::{
    FileRenderResult, FileRenderStatus, RenderEvidence, RenderLimits, RenderOptions, RenderedImage,
    decode_reader_with_limits, render_rgba_image, validate_limits, validate_render_target,
};
use image::{
    DynamicImage, ExtendedColorType, ImageEncoder, ImageReader,
    codecs::png::{CompressionType, FilterType, PngEncoder},
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};
use worldbend_core::{ErrorCode, TransformError, TransformResult, TransformSpec};

fn decode_file_with_limits(
    source: &Path,
    limits: RenderLimits,
    known_source_sha256: Option<&str>,
) -> TransformResult<(DynamicImage, String, Vec<String>)> {
    validate_limits(limits)?;
    let mut file = fs::File::open(source).map_err(|error| {
        TransformError::new(
            ErrorCode::UnsupportedMedia,
            format!("failed to open source image {}", source.display()),
        )
        .with_details(json!({ "reason": error.to_string() }))
    })?;
    let metadata = file.metadata().map_err(|error| {
        TransformError::new(
            ErrorCode::UnsupportedMedia,
            format!("failed to inspect source image {}", source.display()),
        )
        .with_details(json!({ "reason": error.to_string() }))
    })?;
    if !metadata.is_file() {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source image must be a regular file",
        ));
    }
    if metadata.len() > limits.max_source_bytes {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "encoded source exceeds configured byte limit",
        )
        .with_details(json!({
            "sourceBytes": metadata.len(),
            "maximum": limits.max_source_bytes,
        })));
    }

    // One read feeds both the digest and the decoder. The digest is always
    // computed over the bytes actually rendered; a caller-provided digest is
    // verified against it instead of being echoed as evidence.
    let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
    file.read_to_end(&mut bytes).map_err(|error| {
        TransformError::new(ErrorCode::UnsupportedMedia, "failed to read source image")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let source_sha256 = format!("{:x}", Sha256::digest(&bytes));
    if let Some(claimed) = known_source_sha256
        && !claimed.eq_ignore_ascii_case(&source_sha256)
    {
        return Err(TransformError::new(
            ErrorCode::Render,
            "provided source sha256 does not match the source bytes",
        )
        .with_details(json!({
            "provided": claimed,
            "actual": source_sha256,
        })));
    }

    let reader = ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| {
            TransformError::new(
                ErrorCode::UnsupportedMedia,
                "source raster format is not recognized",
            )
            .with_details(json!({ "reason": error.to_string() }))
        })?;
    if reader.format().is_none() {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source raster format is not recognized",
        ));
    }
    let (image, orientation_applied) = decode_reader_with_limits(reader, limits)?;
    let mut warnings = Vec::new();
    if orientation_applied {
        warnings.push("source EXIF orientation was applied before rendering".to_owned());
    }
    Ok((image, source_sha256, warnings))
}

fn write_png(rendered: &RenderedImage, writer: impl Write) -> TransformResult<()> {
    PngEncoder::new_with_quality(writer, CompressionType::Fast, FilterType::Adaptive)
        .write_image(
            rendered.image.as_raw(),
            rendered.image.width(),
            rendered.image.height(),
            ExtendedColorType::Rgba8,
        )
        .map_err(|error| {
            TransformError::new(ErrorCode::Render, "failed to encode rendered PNG")
                .with_details(json!({ "reason": error.to_string() }))
        })
}

struct EvidenceWriter<W> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}

impl<W> EvidenceWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
            bytes: 0,
        }
    }

    fn finish(self) -> (u64, String) {
        (self.bytes, format!("{:x}", self.hasher.finalize()))
    }
}

impl<W: Write> Write for EvidenceWriter<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let written = self.inner.write(bytes)?;
        self.hasher.update(&bytes[..written]);
        self.bytes = self.bytes.saturating_add(written as u64);
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

pub fn render_file(
    source: &Path,
    spec: &TransformSpec,
    output: &Path,
    options: RenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<FileRenderResult> {
    render_file_internal(source, None, spec, output, options, overwrite, dry_run)
}

pub fn render_file_with_source_sha256(
    source: &Path,
    source_sha256: &str,
    spec: &TransformSpec,
    output: &Path,
    options: RenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<FileRenderResult> {
    validate_claimed_source_sha256(source_sha256)?;
    render_file_internal(
        source,
        Some(source_sha256),
        spec,
        output,
        options,
        overwrite,
        dry_run,
    )
}

fn validate_claimed_source_sha256(claimed: &str) -> TransformResult<()> {
    if claimed.len() == 64 && claimed.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Ok(());
    }
    Err(TransformError::new(
        ErrorCode::Render,
        "provided source sha256 is not a 64-character hexadecimal digest",
    ))
}

fn render_file_internal(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &TransformSpec,
    output: &Path,
    options: RenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<FileRenderResult> {
    let total_started = std::time::Instant::now();
    validate_render_target(spec, options.target_size)?;
    preflight_destination(output, overwrite)?;
    let parent = output_parent(output);
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let decode_started = std::time::Instant::now();
    let (source_image, source_sha256, warnings) =
        decode_file_with_limits(source, options.limits, known_source_sha256)?;
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let execution = render_rgba_image(source_image.into_rgba8(), spec, options, &|| false)?;
    let encode_started = std::time::Instant::now();
    let mut evidence = EvidenceWriter::new(temporary.as_file_mut());
    write_png(&execution.rendered, &mut evidence)?;
    evidence.flush().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to flush temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = evidence.finish();
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync temporary output file")
            .with_details(json!({ "reason": error.to_string() }))
    })?;

    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }

    let output_width = execution.rendered.image.width();
    let output_height = execution.rendered.image.height();
    let total_ms = total_started.elapsed().as_secs_f64() * 1000.0;
    Ok(FileRenderResult {
        status: if dry_run {
            FileRenderStatus::Ready
        } else {
            FileRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        bytes,
        evidence: RenderEvidence {
            source_sha256,
            output_sha256,
            output_width,
            output_height,
            output_format: "png".to_owned(),
            solve_ms: execution.solve_ms,
            decode_ms,
            render_ms: execution.render_ms,
            encode_ms,
            total_ms,
            warnings,
        },
        diagnostics: execution.rendered.diagnostics,
    })
}

fn output_parent(output: &Path) -> &Path {
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    }
}

pub fn preflight_destination(output: &Path, overwrite: bool) -> TransformResult<()> {
    let is_png = output
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("png"));
    if !is_png {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "render output path must use a .png extension",
        ));
    }
    let parent = output_parent(output);
    let metadata = fs::metadata(parent).map_err(|error| {
        TransformError::new(
            ErrorCode::Render,
            format!("output directory does not exist: {}", parent.display()),
        )
        .with_details(json!({ "reason": error.to_string() }))
    })?;
    if !metadata.is_dir() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "output parent must be a directory",
        ));
    }
    match fs::symlink_metadata(output) {
        Ok(output_metadata) => {
            if output_metadata.is_dir() {
                return Err(TransformError::new(
                    ErrorCode::Render,
                    "output destination must be a file, not a directory",
                ));
            }
            if !overwrite {
                return Err(TransformError::new(
                    ErrorCode::DestinationExists,
                    format!("destination already exists: {}", output.display()),
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(TransformError::new(
                ErrorCode::Render,
                "failed to inspect output destination",
            )
            .with_details(json!({ "reason": error.to_string() })));
        }
    }
    let probe = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    drop(probe);
    Ok(())
}

fn persist_temporary(
    temporary: tempfile::NamedTempFile,
    output: &Path,
    overwrite: bool,
) -> TransformResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = temporary
            .as_file()
            .metadata()
            .map_err(|error| {
                TransformError::new(ErrorCode::Render, "failed to inspect temporary output")
                    .with_details(json!({ "reason": error.to_string() }))
            })?
            .permissions();
        if permissions.mode() & 0o777 != 0o644 {
            permissions.set_mode(0o644);
            temporary
                .as_file()
                .set_permissions(permissions)
                .map_err(|error| {
                    TransformError::new(ErrorCode::Render, "failed to set output permissions")
                        .with_details(json!({ "reason": error.to_string() }))
                })?;
        }
    }
    let persisted: Result<_, tempfile::PersistError> = if overwrite {
        temporary.persist(output)
    } else {
        temporary.persist_noclobber(output)
    };
    persisted.map_err(|error| {
        let code = if !overwrite && fs::symlink_metadata(output).is_ok() {
            ErrorCode::DestinationExists
        } else {
            ErrorCode::Render
        };
        TransformError::new(code, "failed to publish rendered output")
            .with_details(json!({ "reason": error.error.to_string() }))
    })?;
    sync_parent_directory(output);
    Ok(())
}

pub fn publish_staged_file(staged: &Path, output: &Path, overwrite: bool) -> TransformResult<()> {
    preflight_destination(output, overwrite)?;
    let metadata = fs::metadata(staged).map_err(|error| {
        TransformError::new(ErrorCode::Render, "staged render is missing")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if !metadata.is_file() {
        return Err(TransformError::new(
            ErrorCode::Render,
            "staged render must be a regular file",
        ));
    }
    if overwrite {
        fs::rename(staged, output).map_err(|error| {
            TransformError::new(ErrorCode::Render, "failed to publish staged render")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
    } else {
        fs::hard_link(staged, output).map_err(|error| {
            let code = if output.exists() {
                ErrorCode::DestinationExists
            } else {
                ErrorCode::Render
            };
            TransformError::new(code, "failed to publish staged render without overwrite")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
        let _ = fs::remove_file(staged);
    }
    sync_parent_directory(output);
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) {
    if let Some(parent) = path.parent()
        && let Ok(directory) = fs::File::open(parent)
    {
        let _ = directory.sync_all();
    }
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{RenderOptions, render_file_with_source_sha256};
    use worldbend_core::{Size, TransformSpec};

    fn write_png_source(directory: &Path, name: &str) -> std::path::PathBuf {
        let image = image::RgbaImage::from_fn(8, 8, |x, y| {
            image::Rgba([(x * 9 % 256) as u8, (y * 7 % 256) as u8, 64, 255])
        });
        let path = directory.join(name);
        image
            .save_with_format(&path, image::ImageFormat::Png)
            .unwrap();
        path
    }

    fn unit_spec() -> TransformSpec {
        serde_json::from_str(
            "{\"schema\":\"worldbend.transform\",\"version\":\"0.1\",\"destination\":{\"space\":\"normalized\",\"quad\":{\"tl\":{\"x\":0,\"y\":0},\"tr\":{\"x\":1,\"y\":0},\"br\":{\"x\":1,\"y\":1},\"bl\":{\"x\":0,\"y\":1}}},\"content\":{\"fit\":\"stretch\"}}",
        )
        .unwrap()
    }

    #[test]
    fn a_claimed_source_digest_that_does_not_match_fails_the_render() {
        let directory = tempfile::tempdir().unwrap();
        let source = write_png_source(directory.path(), "source.png");
        let output = directory.path().join("out.png");
        let spec = unit_spec();
        let error = render_file_with_source_sha256(
            &source,
            "0000000000000000000000000000000000000000000000000000000000000000",
            &spec,
            &output,
            RenderOptions {
                target_size: Some(Size::new(8.0, 8.0)),
                ..RenderOptions::default()
            },
            false,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Render);
        // And the wrong-digest render must not have published anything.
        assert!(!output.exists());
    }

    #[test]
    fn an_invalid_claimed_digest_is_rejected_without_echoing_it() {
        let directory = tempfile::tempdir().unwrap();
        // A malformed claim is an input failure and must win before source I/O.
        let source = directory.path().join("missing.png");
        let output = directory.path().join("out.png");
        let error = render_file_with_source_sha256(
            &source,
            &"x".repeat(1024 * 1024),
            &unit_spec(),
            &output,
            RenderOptions {
                target_size: Some(Size::new(8.0, 8.0)),
                ..RenderOptions::default()
            },
            false,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Render);
        assert!(error.details.is_none());
        assert!(!output.exists());
    }

    #[test]
    fn a_matching_claimed_digest_renders_and_echoes_the_verified_digest() {
        let directory = tempfile::tempdir().unwrap();
        let source = write_png_source(directory.path(), "source.png");
        let bytes = fs::read(&source).unwrap();
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let output = directory.path().join("out.png");
        let spec = unit_spec();
        let result = render_file_with_source_sha256(
            &source,
            &digest,
            &spec,
            &output,
            RenderOptions {
                target_size: Some(Size::new(8.0, 8.0)),
                ..RenderOptions::default()
            },
            false,
            false,
        )
        .unwrap();
        assert_eq!(result.evidence.source_sha256, digest);
        assert_eq!(result.status, crate::FileRenderStatus::Written);
    }
}

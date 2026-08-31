use crate::{
    FileRenderStatus, RenderDiagnostics, RenderEvidence, RenderLimits, RenderOptions,
    RenderedImage, SamplingQuality,
    file_io::{decode_file_with_limits, persist_temporary, write_png},
    preflight_destination, render_rgba_image_with_custom_mesh, validate_limits,
};
use image::{DynamicImage, RgbaImage};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{io::Write, path::Path, time::Instant};
use worldbend_core::{
    ErrorCode, MeshWarpPlan, MeshWarpSpec, TransformError, TransformResult, plan_mesh_warp,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 0, "maximum": MAX_EXACT_JSON_INTEGER })
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshWarpRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
}

impl Default for MeshWarpRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
        }
    }
}

#[derive(Debug)]
pub struct RenderedMeshWarp {
    pub image: RgbaImage,
    pub plan: MeshWarpPlan,
    pub diagnostics: RenderDiagnostics,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MeshWarpFileRenderResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub evidence: RenderEvidence,
    pub plan: MeshWarpPlan,
    pub diagnostics: RenderDiagnostics,
}

pub fn render_mesh_warp(
    source: &DynamicImage,
    spec: &MeshWarpSpec,
    options: MeshWarpRenderOptions,
) -> TransformResult<RenderedMeshWarp> {
    render_mesh_warp_with_cancel(source, spec, options, &|| false)
}

pub fn render_mesh_warp_with_cancel(
    source: &DynamicImage,
    spec: &MeshWarpSpec,
    options: MeshWarpRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<RenderedMeshWarp> {
    validate_limits(options.limits)?;
    let plan = plan_mesh_warp(spec)?;
    let rendered = render_rgba_image_with_custom_mesh(
        source.to_rgba8(),
        &spec.transform,
        RenderOptions {
            quality: options.quality,
            canvas: crate::CanvasMode::Tight,
            target_size: spec.target_size,
            limits: options.limits,
        },
        spec.mesh.clone(),
        is_cancelled,
    )?
    .rendered;
    Ok(RenderedMeshWarp {
        image: rendered.image,
        diagnostics: rendered.diagnostics,
        plan,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn render_mesh_warp_file_with_cancel(
    source: &Path,
    known_source_sha256: Option<&str>,
    spec: &MeshWarpSpec,
    output: &Path,
    options: MeshWarpRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<MeshWarpFileRenderResult> {
    let total_started = Instant::now();
    let plan = plan_mesh_warp(spec)?;
    preflight_destination(output, overwrite)?;
    let parent = output.parent().unwrap_or_else(|| Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let decode_started = Instant::now();
    let (source, source_sha256, warnings) =
        decode_file_with_limits(source, options.limits, known_source_sha256)?;
    let decode_ms = decode_started.elapsed().as_secs_f64() * 1000.0;
    let execution = render_rgba_image_with_custom_mesh(
        source.to_rgba8(),
        &spec.transform,
        RenderOptions {
            quality: options.quality,
            canvas: crate::CanvasMode::Tight,
            target_size: spec.target_size,
            limits: options.limits,
        },
        spec.mesh.clone(),
        is_cancelled,
    )?;
    let encode_started = Instant::now();
    let mut writer = HashingWriter::new(temporary.as_file_mut());
    write_png(&execution.rendered.image, &mut writer)?;
    writer.flush().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to flush mesh warp output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    let (bytes, output_sha256) = writer.finish();
    let encode_ms = encode_started.elapsed().as_secs_f64() * 1000.0;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync mesh warp output")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "mesh warp render was cancelled",
        ));
    }
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }
    let rendered: RenderedImage = execution.rendered;
    Ok(MeshWarpFileRenderResult {
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
            output_width: rendered.image.width(),
            output_height: rendered.image.height(),
            output_format: "png".to_owned(),
            solve_ms: execution.solve_ms,
            decode_ms,
            render_ms: execution.render_ms,
            encode_ms,
            total_ms: total_started.elapsed().as_secs_f64() * 1000.0,
            warnings,
        },
        plan,
        diagnostics: rendered.diagnostics,
    })
}

struct HashingWriter<W> {
    inner: W,
    hasher: Sha256,
    bytes: u64,
}

impl<W> HashingWriter<W> {
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

impl<W: Write> Write for HashingWriter<W> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;
    use worldbend_core::{
        MESH_WARP_SCHEMA, MESH_WARP_VERSION, Point, Quad, Size, TransformSpec, WarpMesh, WarpVertex,
    };

    fn spec(center: Point) -> MeshWarpSpec {
        let subdivisions = 2;
        let mut vertices = Vec::new();
        for y in 0..=subdivisions {
            for x in 0..=subdivisions {
                let source = Point::new(x as f64 / 2.0, y as f64 / 2.0);
                vertices.push(WarpVertex {
                    source,
                    warped: if x == 1 && y == 1 { center } else { source },
                });
            }
        }
        MeshWarpSpec {
            schema: MESH_WARP_SCHEMA.to_owned(),
            version: MESH_WARP_VERSION.to_owned(),
            transform: TransformSpec::pixel(
                Size::new(4.0, 4.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(4.0, 0.0),
                    Point::new(4.0, 4.0),
                    Point::new(0.0, 4.0),
                ),
            ),
            target_size: None,
            mesh: WarpMesh {
                subdivisions,
                vertices,
            },
        }
    }

    #[test]
    fn custom_mesh_identity_is_byte_identical_and_moved_center_changes_pixels() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(4, 4, |x, y| {
            Rgba([(x * 50) as u8, (y * 50) as u8, 10, 255])
        }));
        let identity =
            render_mesh_warp(&source, &spec(Point::new(0.5, 0.5)), Default::default()).unwrap();
        assert_eq!(identity.image, source.to_rgba8());
        let moved =
            render_mesh_warp(&source, &spec(Point::new(0.6, 0.5)), Default::default()).unwrap();
        assert_ne!(moved.image, identity.image);
    }
}

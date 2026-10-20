//! Exact Figma-exported PNGs may arrive inline or as workspace files. File
//! authority is resolved once before the existing fingerprint/renderer path.
use base64::Engine as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::io::Read;
use worldbend_agent_fs::WorkspaceRoot;
use worldbend_core::{ErrorCode, SourceCaptureFacts, TransformError, TransformResult};

const MAX_PNG_BYTES: usize = 1_200_000;

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum FigmaMockupSourceRaster {
    Inline(InlinePng),
    File(WorkspacePng),
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct InlinePng {
    #[schemars(length(min = 8, max = 16), regex(pattern = r"^source-[1-8]$"))]
    pub(crate) slot_id: String,
    #[schemars(length(min = 1, max = 1_600_000))]
    pub(crate) base64: String,
    /// Native parent capture for owned Content. Absent for ordinary artwork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_capture: Option<SourceCaptureFacts>,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkspacePng {
    #[schemars(length(min = 8, max = 16), regex(pattern = r"^source-[1-8]$"))]
    slot_id: String,
    /// Relative PNG path under the MCP's explicitly granted workspace.
    #[schemars(length(min = 1, max = 4096))]
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_capture: Option<SourceCaptureFacts>,
}

impl FigmaMockupSourceRaster {
    pub(crate) fn slot_id(&self) -> &str {
        match self {
            Self::Inline(v) => &v.slot_id,
            Self::File(v) => &v.slot_id,
        }
    }
    pub(crate) fn source_capture(&self) -> Option<SourceCaptureFacts> {
        match self {
            Self::Inline(v) => v.source_capture,
            Self::File(v) => v.source_capture,
        }
    }
    pub(crate) fn validate_capture(
        &self,
        expected: Option<SourceCaptureFacts>,
    ) -> TransformResult<()> {
        if self.source_capture() != expected {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "PNG source capture differs from the inspected sampling coordinates; inspect again",
            ));
        }
        Ok(())
    }
    pub(crate) fn base64(&self) -> TransformResult<&str> {
        match self {
            Self::Inline(v) if !v.base64.is_empty() && v.base64.len() <= 1_600_000 => Ok(&v.base64),
            _ => Err(TransformError::new(
                ErrorCode::Schema,
                "Resolve an exact bounded PNG through its granted workspace before rendering",
            )),
        }
    }
    pub(crate) fn hydrate(&mut self, root: Option<&WorkspaceRoot>) -> TransformResult<()> {
        let Self::File(v) = self else {
            return self.base64().map(|_| ());
        };
        if v.path.is_empty() || v.path.len() > 4096 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Use a bounded relative workspace PNG path",
            ));
        }
        let root = root.ok_or_else(|| {
            TransformError::new(
                ErrorCode::Render,
                "File-backed Figma source requires an explicitly granted workspace root",
            )
        })?;
        let file = root.open_source(&v.path)?;
        let mut bytes = Vec::new();
        file.take((MAX_PNG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| {
                TransformError::new(
                    ErrorCode::Render,
                    "Unable to read the granted Figma PNG source",
                )
            })?;
        if bytes.is_empty() || bytes.len() > MAX_PNG_BYTES {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "Figma source PNG exceeds the existing 1200000-byte decoded source ceiling",
            ));
        }
        *self = Self::Inline(InlinePng {
            slot_id: v.slot_id.clone(),
            base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            source_capture: v.source_capture,
        });
        Ok(())
    }
}

pub(crate) fn hydrate_sources(
    sources: &mut [FigmaMockupSourceRaster],
    root: Option<&WorkspaceRoot>,
) -> TransformResult<()> {
    if sources.is_empty() || sources.len() > 8 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Use 1..8 exact bound Figma PNG sources",
        ));
    }
    for source in sources {
        source.hydrate(root)?;
    }
    Ok(())
}

fn validate_source_dimensions(width: u32, height: u32) -> TransformResult<()> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || u64::from(width) * u64::from(height) > 32 * 1024 * 1024
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Figma source capture exceeds 8192 pixels per edge / 32 Mi pixels",
        ));
    }
    Ok(())
}

/// Check the encoded PNG before decoding or materializing its logical view.
pub(crate) fn decode_source_image(bytes: &[u8]) -> TransformResult<image::DynamicImage> {
    let reader =
        || image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
    let (width, height) = reader()
        .into_dimensions()
        .map_err(|_| TransformError::new(ErrorCode::Schema, "Supply real PNG source artifacts"))?;
    validate_source_dimensions(width, height)?;
    reader()
        .decode()
        .map_err(|_| TransformError::new(ErrorCode::Schema, "Supply real PNG source artifacts"))
}

/// Materialize owned Content once at the ingress boundary, like the human UI.
/// The original capture coordinates must not be attached to the new pixels.
/// An identity parent
/// keeps the exported pixels. Callers must not attach this view again.
pub(crate) fn logical_source_image(
    image: image::DynamicImage,
    facts: Option<SourceCaptureFacts>,
) -> TransformResult<image::DynamicImage> {
    validate_source_dimensions(image.width(), image.height())?;
    let Some(facts) = facts else {
        return Ok(image);
    };
    let view = worldbend_core::plan_source_capture(&facts)?;
    view.validate_pixels(image.width(), image.height())?;
    if view.is_identity() {
        return Ok(image);
    }
    let longest = facts.logical_size.width.max(facts.logical_size.height);
    let scale = facts.capture_scale.min(4096.0 / longest);
    let width = (facts.logical_size.width * scale).round().max(1.0) as u32;
    let height = (facts.logical_size.height * scale).round().max(1.0) as u32;
    let rendered = worldbend_render::render_image(
        &image,
        &worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
        worldbend_render::RenderOptions {
            source_view: Some(view),
            quality: worldbend_render::SamplingQuality::High,
            canvas: worldbend_render::CanvasMode::Reference,
            target_size: Some(worldbend_core::Size::new(
                f64::from(width),
                f64::from(height),
            )),
            limits: worldbend_render::RenderLimits::default(),
        },
    )?;
    Ok(image::DynamicImage::ImageRgba8(rendered.image))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn file(path: &str) -> FigmaMockupSourceRaster {
        serde_json::from_value(json!({"slotId":"source-1","path":path})).unwrap()
    }
    #[test]
    fn file_source_retains_exact_bytes_after_the_visible_path_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("source.png"), b"exact-exported-bytes").unwrap();
        let root = WorkspaceRoot::open(dir.path()).unwrap();
        let mut source = file("source.png");
        source.hydrate(Some(&root)).unwrap();
        fs::rename(dir.path().join("source.png"), dir.path().join("old.png")).unwrap();
        fs::write(dir.path().join("source.png"), b"changed").unwrap();
        assert_eq!(source.slot_id(), "source-1");
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(source.base64().unwrap())
                .unwrap(),
            b"exact-exported-bytes"
        );
    }
    #[test]
    fn source_authority_and_existing_byte_ceiling_are_not_widened() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let root = WorkspaceRoot::open(dir.path()).unwrap();
        assert!(file("source.png").hydrate(None).is_err());
        for path in [
            "../source.png",
            outside.path().join("source.png").to_str().unwrap(),
            "missing.png",
        ] {
            assert!(file(path).hydrate(Some(&root)).is_err());
        }
        fs::write(dir.path().join("large.png"), vec![0; MAX_PNG_BYTES + 1]).unwrap();
        assert_eq!(
            file("large.png").hydrate(Some(&root)).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        #[cfg(unix)]
        {
            fs::write(outside.path().join("source.png"), b"outside").unwrap();
            std::os::unix::fs::symlink(
                outside.path().join("source.png"),
                dir.path().join("linked.png"),
            )
            .unwrap();
            assert_eq!(
                file("linked.png").hydrate(Some(&root)).unwrap_err().code,
                ErrorCode::PathSymlink
            );
        }
    }
    #[test]
    fn transport_variants_are_closed_and_unresolved_files_cannot_enter_a_renderer() {
        for value in [
            json!({"slotId":"source-1"}),
            json!({"slotId":"source-1","path":"s.png","base64":"aA=="}),
            json!({"slotId":"source-1","path":"s.png","url":"https://example.com"}),
        ] {
            assert!(serde_json::from_value::<FigmaMockupSourceRaster>(value).is_err());
        }
        assert!(file("source.png").base64().is_err());
        let mut inline: FigmaMockupSourceRaster =
            serde_json::from_value(json!({"slotId":"source-1","base64":"aA=="})).unwrap();
        inline.hydrate(None).unwrap();
        assert_eq!(inline.base64().unwrap(), "aA==");
        assert!(inline.source_capture().is_none());
        let wire = serde_json::to_value(&inline).unwrap();
        assert!(wire.get("sourceCapture").is_none());
    }

    #[test]
    fn logical_normalization_does_not_hide_an_oversized_capture() {
        let captured = image::DynamicImage::new_rgba8(8193, 1);
        let mut bytes = std::io::Cursor::new(Vec::new());
        captured
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        assert_eq!(
            decode_source_image(bytes.get_ref()).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        let mut valid = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(8192, 1)
            .write_to(&mut valid, image::ImageFormat::Png)
            .unwrap();
        assert_eq!(decode_source_image(valid.get_ref()).unwrap().width(), 8192);
        let facts = SourceCaptureFacts {
            logical_size: worldbend_core::Size::new(1., 1.),
            logical_to_capture_space: [[8193., 0., 0.], [0., 1., 0.]],
            capture_origin: worldbend_core::Point::new(0., 0.),
            capture_scale: 1.,
            pixel_size: worldbend_core::PixelSize::new(8193, 1),
            convention: worldbend_core::SourceCaptureConvention::FixedDensityFromOrigin,
        };
        assert!(
            logical_source_image(captured, Some(facts)).is_err(),
            "Normalization cannot turn an oversized capture into an admissible source"
        );
    }

    #[test]
    fn owned_capture_is_sampled_once_and_a_second_pass_rejects_the_logical_image() {
        use image::{DynamicImage, Rgba, RgbaImage};
        use worldbend_core::{PixelSize, Point, Size, SourceCaptureConvention};

        let source = RgbaImage::from_fn(4, 8, |x, y| Rgba([x as u8 * 40, y as u8 * 20, 30, 255]));
        let captured = DynamicImage::ImageRgba8(source);
        let facts = SourceCaptureFacts {
            logical_size: Size::new(8.0, 4.0),
            logical_to_capture_space: [[0.0, -1.0, 4.0], [1.0, 0.0, 0.0]],
            capture_origin: Point::new(0.0, 0.0),
            capture_scale: 1.0,
            pixel_size: PixelSize::new(4, 8),
            convention: SourceCaptureConvention::FixedDensityFromOrigin,
        };
        let view = worldbend_core::plan_source_capture(&facts).unwrap();
        assert!(!view.is_identity());
        assert_eq!(
            view.logical_uv_to_texture_uv,
            [[0.0, -1.0, 1.0], [1.0, 0.0, 0.0]]
        );
        let once = logical_source_image(captured.clone(), Some(facts)).unwrap();
        let direct = worldbend_render::render_image(
            &captured,
            &worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
            worldbend_render::RenderOptions {
                source_view: Some(view),
                quality: worldbend_render::SamplingQuality::High,
                canvas: worldbend_render::CanvasMode::Reference,
                target_size: Some(Size::new(8.0, 4.0)),
                limits: worldbend_render::RenderLimits::default(),
            },
        )
        .unwrap()
        .image;
        assert_eq!(once.width(), 8);
        assert_eq!(once.height(), 4);
        assert_eq!(once, DynamicImage::ImageRgba8(direct));
        assert_ne!(once.as_bytes(), captured.as_bytes());
        assert_eq!(
            logical_source_image(once, Some(facts)).unwrap_err().code,
            ErrorCode::RasterShapeMismatch
        );
        let identity = SourceCaptureFacts {
            logical_size: Size::new(4.0, 8.0),
            logical_to_capture_space: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            capture_origin: Point::new(0.0, 0.0),
            capture_scale: 1.0,
            pixel_size: PixelSize::new(4, 8),
            convention: SourceCaptureConvention::FixedDensityFromOrigin,
        };
        assert_eq!(
            logical_source_image(captured.clone(), Some(identity)).unwrap(),
            captured
        );
        assert_eq!(
            logical_source_image(captured.clone(), None).unwrap(),
            captured
        );
        let mut with_facts: FigmaMockupSourceRaster = serde_json::from_value(json!({
            "slotId": "source-1",
            "base64": "aA==",
            "sourceCapture": {
                "logicalSize": {"width": 8.0, "height": 4.0},
                "logicalToCaptureSpace": [[0.0, -1.0, 4.0], [1.0, 0.0, 0.0]],
                "captureOrigin": {"x": 0.0, "y": 0.0},
                "captureScale": 1.0,
                "pixelSize": {"width": 4, "height": 8},
                "convention": "fixedDensityFromOrigin"
            }
        }))
        .unwrap();
        assert_eq!(with_facts.source_capture(), Some(facts));
        with_facts.hydrate(None).unwrap();
        assert_eq!(with_facts.source_capture(), Some(facts));
    }
}

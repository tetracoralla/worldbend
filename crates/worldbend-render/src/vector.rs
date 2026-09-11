use super::file_io::{output_parent, persist_temporary, preflight_file_destination};
use super::{CanvasMode, CanvasPlacement, FileRenderStatus, validate_render_target};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};
use worldbend_core::{
    Bounds, ErrorCode, Point, Size, SolveDiagnostics, TransformError, TransformResult,
    TransformSpec, solve_spec,
};

pub const MAX_VECTOR_SOURCE_BYTES: u64 = 8 * 1024 * 1024;
pub const MAX_VECTOR_OUTPUT_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_VECTOR_AXIS: u32 = 1_000_000;
const PROJECTIVE_EPSILON: f64 = 1.0e-12;
const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VectorCarrier {
    Svg,
    Html,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorRenderOptions {
    pub carrier: VectorCarrier,
    pub element_size: Size,
    #[serde(default)]
    pub canvas: CanvasMode,
    #[serde(default)]
    pub target_size: Option<Size>,
    #[serde(default = "default_vector_source_bytes")]
    #[schemars(range(min = 1, max = MAX_VECTOR_SOURCE_BYTES))]
    pub max_source_bytes: u64,
}

const fn default_vector_source_bytes() -> u64 {
    MAX_VECTOR_SOURCE_BYTES
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorFileResult {
    pub status: FileRenderStatus,
    pub dry_run: bool,
    pub output: String,
    pub carrier: VectorCarrier,
    pub projective: bool,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub source_bytes: u64,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub bytes: u64,
    pub source_sha256: String,
    pub output_sha256: String,
    pub placement: CanvasPlacement,
    pub destination_bounds: Bounds,
    pub matrix3d: [f64; 16],
    pub solve: SolveDiagnostics,
    pub warnings: Vec<String>,
}

pub fn render_vector_file(
    source: &Path,
    spec: &TransformSpec,
    output: &Path,
    options: VectorRenderOptions,
    overwrite: bool,
    dry_run: bool,
) -> TransformResult<VectorFileResult> {
    render_vector_file_with_cancel(source, spec, output, options, overwrite, dry_run, &|| false)
}

pub fn render_vector_file_with_cancel(
    source: &Path,
    spec: &TransformSpec,
    output: &Path,
    options: VectorRenderOptions,
    overwrite: bool,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<VectorFileResult> {
    validate_options(output, options)?;
    preflight_file_destination(output, overwrite)?;
    if is_cancelled() {
        return Err(cancelled_error());
    }
    validate_render_target(spec, options.target_size)?;
    let source_bytes = read_svg(source, options.max_source_bytes)?;
    let source_sha256 = hex::encode(Sha256::digest(&source_bytes));
    let solved = solve_spec(spec, options.target_size)?;
    if let Some(warp) = spec.content.warp {
        warp.validate()?;
        if warp.amount != 0.0 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "vector preservation cannot represent a non-projective Warp",
            ));
        }
    }
    let placement = vector_placement(
        solved.diagnostics.bounds,
        solved.resolved_destination.reference,
        options.canvas,
    )?;
    let adjusted = adjusted_homography(
        solved.homography.matrix,
        options.element_size,
        placement.origin,
    );
    let projective = is_projective(adjusted);
    if options.carrier == VectorCarrier::Svg && projective {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "SVG vector output supports affine transforms only; use the HTML carrier for projective matrix3d",
        ));
    }
    let matrix3d = css_matrix3d(adjusted);
    let encoded = BASE64.encode(&source_bytes);
    let document = match options.carrier {
        VectorCarrier::Svg => svg_document(&encoded, options.element_size, placement, adjusted),
        VectorCarrier::Html => html_document(&encoded, options.element_size, placement, matrix3d),
    };
    let document = document.into_bytes();
    if document.len() as u64 > MAX_VECTOR_OUTPUT_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "vector carrier output exceeds the encoded byte ceiling",
        )
        .with_details(json!({
            "bytes": document.len(),
            "maximum": MAX_VECTOR_OUTPUT_BYTES,
        })));
    }
    if is_cancelled() {
        return Err(cancelled_error());
    }
    let output_sha256 = hex::encode(Sha256::digest(&document));
    let parent = output_parent(output);
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|error| {
        TransformError::new(ErrorCode::Render, "output directory is not writable")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    std::io::Write::write_all(temporary.as_file_mut(), &document).map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to write vector carrier")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    temporary.as_file_mut().sync_all().map_err(|error| {
        TransformError::new(ErrorCode::Render, "failed to sync vector carrier")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if is_cancelled() {
        return Err(cancelled_error());
    }
    if !dry_run {
        persist_temporary(temporary, output, overwrite)?;
    }
    Ok(VectorFileResult {
        status: if dry_run {
            FileRenderStatus::Ready
        } else {
            FileRenderStatus::Written
        },
        dry_run,
        output: output.display().to_string(),
        carrier: options.carrier,
        projective,
        source_bytes: source_bytes.len() as u64,
        bytes: document.len() as u64,
        source_sha256,
        output_sha256,
        placement,
        destination_bounds: solved.diagnostics.bounds,
        matrix3d,
        solve: solved.diagnostics,
        warnings: vec![
            "the SVG source is preserved byte-for-byte inside a data URL; external SVG resources are not resolved or bundled"
                .to_owned(),
        ],
    })
}

fn validate_options(output: &Path, options: VectorRenderOptions) -> TransformResult<()> {
    options.element_size.validate("elementSize")?;
    if options.element_size.width > f64::from(MAX_VECTOR_AXIS)
        || options.element_size.height > f64::from(MAX_VECTOR_AXIS)
        || options.max_source_bytes == 0
        || options.max_source_bytes > MAX_VECTOR_SOURCE_BYTES
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "vector dimensions or source byte limit exceed the engine ceiling",
        ));
    }
    let extension = output
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);
    let valid = matches!(
        (options.carrier, extension.as_deref()),
        (VectorCarrier::Svg, Some("svg")) | (VectorCarrier::Html, Some("html" | "htm"))
    );
    if !valid {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "vector output extension must match the requested svg or html carrier",
        ));
    }
    Ok(())
}

fn read_svg(source: &Path, maximum: u64) -> TransformResult<Vec<u8>> {
    let metadata = fs::metadata(source).map_err(|error| {
        TransformError::new(ErrorCode::UnsupportedMedia, "failed to inspect SVG source")
            .with_details(json!({ "reason": error.to_string() }))
    })?;
    if !metadata.is_file() || metadata.len() > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "SVG source is not a regular file within the byte limit",
        ));
    }
    let mut bytes = Vec::new();
    fs::File::open(source)
        .and_then(|file| file.take(maximum.saturating_add(1)).read_to_end(&mut bytes))
        .map_err(|error| {
            TransformError::new(ErrorCode::UnsupportedMedia, "failed to read SVG source")
                .with_details(json!({ "reason": error.to_string() }))
        })?;
    if bytes.len() as u64 > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "SVG source exceeds the byte limit",
        ));
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| {
        TransformError::new(ErrorCode::UnsupportedMedia, "SVG source must be UTF-8 XML")
    })?;
    let lower = text
        .trim_start_matches('\u{feff}')
        .trim_start()
        .to_ascii_lowercase();
    if !lower.contains("<svg") {
        return Err(TransformError::new(
            ErrorCode::UnsupportedMedia,
            "source does not contain an SVG root element",
        ));
    }
    Ok(bytes)
}

fn vector_placement(
    bounds: Bounds,
    reference: Size,
    canvas: CanvasMode,
) -> TransformResult<CanvasPlacement> {
    let (origin_x, origin_y, width, height) = match canvas {
        CanvasMode::Tight => {
            let left = bounds.x.floor();
            let top = bounds.y.floor();
            let right = (bounds.x + bounds.width).ceil();
            let bottom = (bounds.y + bounds.height).ceil();
            (left, top, right - left, bottom - top)
        }
        CanvasMode::Reference => (0.0, 0.0, reference.width.ceil(), reference.height.ceil()),
    };
    if !origin_x.is_finite()
        || !origin_y.is_finite()
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= 0.0
        || width > f64::from(MAX_VECTOR_AXIS)
        || height > f64::from(MAX_VECTOR_AXIS)
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "vector canvas is empty, non-finite, or exceeds the vector axis ceiling",
        ));
    }
    Ok(CanvasPlacement {
        origin: Point::new(origin_x, origin_y),
        width: width as u32,
        height: height as u32,
    })
}

fn adjusted_homography(matrix: [f64; 9], element: Size, origin: Point) -> [f64; 9] {
    let a = matrix[0] / element.width;
    let b = matrix[1] / element.height;
    let c = matrix[2];
    let d = matrix[3] / element.width;
    let e = matrix[4] / element.height;
    let f = matrix[5];
    let g = matrix[6] / element.width;
    let h = matrix[7] / element.height;
    [
        a - origin.x * g,
        b - origin.x * h,
        c - origin.x,
        d - origin.y * g,
        e - origin.y * h,
        f - origin.y,
        g,
        h,
        1.0,
    ]
}

fn is_projective(matrix: [f64; 9]) -> bool {
    let scale = matrix.iter().copied().map(f64::abs).fold(1.0, f64::max);
    matrix[6].abs() > PROJECTIVE_EPSILON * scale || matrix[7].abs() > PROJECTIVE_EPSILON * scale
}

fn css_matrix3d(matrix: [f64; 9]) -> [f64; 16] {
    [
        matrix[0], matrix[3], 0.0, matrix[6], matrix[1], matrix[4], 0.0, matrix[7], 0.0, 0.0, 1.0,
        0.0, matrix[2], matrix[5], 0.0, 1.0,
    ]
}

fn svg_document(
    source: &str,
    element: Size,
    placement: CanvasPlacement,
    matrix: [f64; 9],
) -> String {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\" viewBox=\"0 0 {} {}\"><image width=\"{}\" height=\"{}\" preserveAspectRatio=\"none\" href=\"data:image/svg+xml;base64,{}\" transform=\"matrix({} {} {} {} {} {})\"/></svg>\n",
        placement.width,
        placement.height,
        placement.width,
        placement.height,
        format_number(element.width),
        format_number(element.height),
        source,
        format_number(matrix[0]),
        format_number(matrix[3]),
        format_number(matrix[1]),
        format_number(matrix[4]),
        format_number(matrix[2]),
        format_number(matrix[5]),
    )
}

fn html_document(
    source: &str,
    element: Size,
    placement: CanvasPlacement,
    matrix3d: [f64; 16],
) -> String {
    let values = matrix3d
        .iter()
        .map(|value| format_number(*value))
        .collect::<Vec<_>>()
        .join(",");
    format!(
        "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Worldbend vector placement</title><style>html,body{{margin:0;background:transparent}}.worldbend-canvas{{position:relative;overflow:hidden;width:{}px;height:{}px}}.worldbend-source{{position:absolute;left:0;top:0;width:{}px;height:{}px;transform-origin:0 0;transform:matrix3d({})}}</style><div class=\"worldbend-canvas\"><img class=\"worldbend-source\" alt=\"\" src=\"data:image/svg+xml;base64,{}\"></div>\n",
        placement.width,
        placement.height,
        format_number(element.width),
        format_number(element.height),
        values,
        source,
    )
}

fn format_number(value: f64) -> String {
    if value == 0.0 {
        "0".to_owned()
    } else {
        value.to_string()
    }
}

fn cancelled_error() -> TransformError {
    TransformError::new(
        ErrorCode::Cancelled,
        "vector carrier generation was cancelled",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    use worldbend_core::{Quad, SourceOrientation};

    fn source_svg(path: &Path) -> Vec<u8> {
        let bytes = b"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><path d=\"M0 0h10v10z\"/></svg>".to_vec();
        fs::write(path, &bytes).unwrap();
        bytes
    }

    #[test]
    fn affine_svg_preserves_exact_source_bytes_and_orientation() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.svg");
        let output = directory.path().join("output.svg");
        let bytes = source_svg(&source);
        let mut spec = TransformSpec::pixel(
            Size::new(200.0, 100.0),
            Quad::new(
                Point::new(10.0, 20.0),
                Point::new(190.0, 20.0),
                Point::new(190.0, 80.0),
                Point::new(10.0, 80.0),
            ),
        );
        spec.content.orientation = SourceOrientation::FlipHorizontal;
        let result = render_vector_file(
            &source,
            &spec,
            &output,
            VectorRenderOptions {
                carrier: VectorCarrier::Svg,
                element_size: Size::new(10.0, 10.0),
                canvas: CanvasMode::Reference,
                target_size: None,
                max_source_bytes: MAX_VECTOR_SOURCE_BYTES,
            },
            false,
            false,
        )
        .unwrap();
        assert!(!result.projective);
        assert_eq!(result.source_sha256, hex::encode(Sha256::digest(bytes)));
        assert!(
            fs::read_to_string(output)
                .unwrap()
                .contains("data:image/svg+xml;base64,")
        );
        assert!(result.matrix3d[0] < 0.0);
    }

    #[test]
    fn perspective_requires_html_and_html_retains_projective_terms() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.svg");
        source_svg(&source);
        let spec = TransformSpec::pixel(
            Size::new(200.0, 100.0),
            Quad::new(
                Point::new(10.0, 10.0),
                Point::new(190.0, 20.0),
                Point::new(170.0, 90.0),
                Point::new(20.0, 80.0),
            ),
        );
        let options = VectorRenderOptions {
            carrier: VectorCarrier::Svg,
            element_size: Size::new(10.0, 10.0),
            canvas: CanvasMode::Tight,
            target_size: None,
            max_source_bytes: MAX_VECTOR_SOURCE_BYTES,
        };
        let error = render_vector_file(
            &source,
            &spec,
            &directory.path().join("output.svg"),
            options,
            false,
            true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);

        let result = render_vector_file(
            &source,
            &spec,
            &directory.path().join("output.html"),
            VectorRenderOptions {
                carrier: VectorCarrier::Html,
                ..options
            },
            false,
            false,
        )
        .unwrap();
        assert!(result.projective);
        assert_ne!(result.matrix3d[3], 0.0);
        assert_ne!(result.matrix3d[7], 0.0);
    }

    #[test]
    fn normalized_destination_requires_an_explicit_target_size() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.svg");
        source_svg(&source);
        let error = render_vector_file(
            &source,
            &TransformSpec::normalized(Quad::unit()),
            &directory.path().join("output.svg"),
            VectorRenderOptions {
                carrier: VectorCarrier::Svg,
                element_size: Size::new(10.0, 10.0),
                canvas: CanvasMode::Reference,
                target_size: None,
                max_source_bytes: MAX_VECTOR_SOURCE_BYTES,
            },
            false,
            true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }

    #[test]
    fn nonzero_warp_and_cancellation_publish_nothing() {
        let directory = tempdir().unwrap();
        let source = directory.path().join("source.svg");
        source_svg(&source);
        let mut spec = TransformSpec::normalized(Quad::unit());
        spec.content.warp = Some(worldbend_core::WarpSpec {
            preset: worldbend_core::WarpPreset::Wave,
            amount: 0.5,
        });
        let output = directory.path().join("output.html");
        let error = render_vector_file(
            &source,
            &spec,
            &output,
            VectorRenderOptions {
                carrier: VectorCarrier::Html,
                element_size: Size::new(10.0, 10.0),
                canvas: CanvasMode::Reference,
                target_size: Some(Size::new(100.0, 100.0)),
                max_source_bytes: MAX_VECTOR_SOURCE_BYTES,
            },
            false,
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(!output.exists());

        let error = render_vector_file_with_cancel(
            &source,
            &TransformSpec::normalized(Quad::unit()),
            &output,
            VectorRenderOptions {
                carrier: VectorCarrier::Html,
                element_size: Size::new(10.0, 10.0),
                canvas: CanvasMode::Reference,
                target_size: Some(Size::new(100.0, 100.0)),
                max_source_bytes: MAX_VECTOR_SOURCE_BYTES,
            },
            false,
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }
}

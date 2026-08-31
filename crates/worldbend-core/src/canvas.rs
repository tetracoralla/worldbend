use crate::{ErrorCode, PixelSize, TransformError, TransformResult};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;

pub const CANVAS_SCHEMA: &str = "worldbend.canvas";
pub const CANVAS_SET_SCHEMA: &str = "worldbend.canvas-set";
pub const CANVAS_PLAN_SCHEMA: &str = "worldbend.canvas-plan";
pub const CANVAS_SET_PLAN_SCHEMA: &str = "worldbend.canvas-set-plan";
pub const CANVAS_VERSION: &str = "0.1";
pub const MAX_CANVAS_VARIANTS: usize = 16;
pub const MAX_CANVAS_AXIS: u32 = 8192;
pub const MAX_CANVAS_PIXELS: u64 = 32 * 1024 * 1024;
pub const MAX_CANVAS_SET_PIXELS: u64 = 128 * 1024 * 1024;

const MAX_HEADER_ECHO_CHARS: usize = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PixelRect {
    pub x: u32,
    pub y: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub width: u32,
    #[schemars(schema_with = "positive_u32_schema")]
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasInsets {
    pub top: u32,
    pub right: u32,
    pub bottom: u32,
    pub left: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NormalizedAnchor {
    #[schemars(range(min = 0.0, max = 1.0))]
    pub x: f64,
    #[schemars(range(min = 0.0, max = 1.0))]
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum Srgb8Space {
    #[serde(rename = "srgb8")]
    Srgb8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CanvasBackground {
    Transparent {},
    Color { space: Srgb8Space, rgba: [u8; 4] },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum CanvasOperation {
    Crop {
        rect: PixelRect,
    },
    Trim {
        #[serde(rename = "alphaThreshold")]
        #[schemars(rename = "alphaThreshold")]
        #[schemars(range(min = 0, max = 254))]
        alpha_threshold: u8,
    },
    Pad {
        insets: CanvasInsets,
        background: CanvasBackground,
    },
    Contain {
        #[schemars(schema_with = "canvas_output_size_schema")]
        output: PixelSize,
        anchor: NormalizedAnchor,
        background: CanvasBackground,
    },
    Cover {
        #[schemars(schema_with = "canvas_output_size_schema")]
        output: PixelSize,
        anchor: NormalizedAnchor,
        background: CanvasBackground,
    },
    Stretch {
        #[schemars(schema_with = "canvas_output_size_schema")]
        output: PixelSize,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum CanvasOperationKind {
    Crop,
    Trim,
    Pad,
    Contain,
    Cover,
    Stretch,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CanvasSpec {
    #[schemars(schema_with = "canvas_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "canvas_version_schema")]
    pub version: String,
    pub operation: CanvasOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasVariant {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub operation: CanvasOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CanvasSetSpec {
    #[schemars(schema_with = "canvas_set_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "canvas_version_schema")]
    pub version: String,
    #[schemars(length(min = 1, max = 16))]
    pub variants: Vec<CanvasVariant>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasPlacement {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasScale {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasPlan {
    #[schemars(schema_with = "canvas_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "canvas_version_schema")]
    pub version: String,
    pub source_size: PixelSize,
    pub source_rect: PixelRect,
    #[schemars(schema_with = "canvas_output_size_schema")]
    pub output_size: PixelSize,
    pub placement: CanvasPlacement,
    pub scale: CanvasScale,
    pub operation: CanvasOperationKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<CanvasBackground>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasVariantPlan {
    #[schemars(
        length(min = 1, max = 64),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    )]
    pub id: String,
    pub plan: CanvasPlan,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CanvasSetPlan {
    #[schemars(schema_with = "canvas_set_plan_schema_schema")]
    pub schema: String,
    #[schemars(schema_with = "canvas_version_schema")]
    pub version: String,
    pub source_size: PixelSize,
    #[schemars(length(min = 1, max = 16))]
    pub variants: Vec<CanvasVariantPlan>,
}

fn positive_u32_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "integer", "minimum": 1, "maximum": MAX_CANVAS_AXIS })
}

fn canvas_output_size_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "object",
        "additionalProperties": false,
        "required": ["width", "height"],
        "properties": {
            "width": { "type": "integer", "minimum": 1, "maximum": MAX_CANVAS_AXIS },
            "height": { "type": "integer", "minimum": 1, "maximum": MAX_CANVAS_AXIS }
        }
    })
}

fn canvas_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CANVAS_SCHEMA })
}

fn canvas_set_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CANVAS_SET_SCHEMA })
}

fn canvas_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CANVAS_PLAN_SCHEMA })
}

fn canvas_set_plan_schema_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CANVAS_SET_PLAN_SCHEMA })
}

fn canvas_version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": CANVAS_VERSION })
}

impl CanvasSpec {
    pub fn validate_header(&self) -> TransformResult<()> {
        validate_header(&self.schema, CANVAS_SCHEMA, &self.version)
    }

    pub fn validate(&self) -> TransformResult<()> {
        self.validate_header()?;
        validate_operation_shape(&self.operation)
    }
}

impl CanvasSetSpec {
    pub fn validate(&self) -> TransformResult<()> {
        validate_header(&self.schema, CANVAS_SET_SCHEMA, &self.version)?;
        validate_variant_ids(self.variants.iter().map(|variant| variant.id.as_str()))?;
        for variant in &self.variants {
            validate_operation_shape(&variant.operation)?;
        }
        Ok(())
    }
}

impl CanvasPlan {
    pub fn validate_for_source(&self, source_size: PixelSize) -> TransformResult<()> {
        validate_header(&self.schema, CANVAS_PLAN_SCHEMA, &self.version)?;
        source_size.validate("sourceSize")?;
        if self.source_size != source_size {
            return Err(TransformError::new(
                ErrorCode::RasterShapeMismatch,
                "Canvas plan source dimensions do not match the replay raster",
            )
            .with_details(json!({ "expected": self.source_size, "actual": source_size })));
        }
        validate_rect(self.source_rect, source_size)?;
        validate_output(self.output_size)?;
        validate_placement(self.placement, self.scale)?;
        validate_canonical_plan(self)?;
        Ok(())
    }
}

impl CanvasSetPlan {
    pub fn validate_for_source(&self, source_size: PixelSize) -> TransformResult<()> {
        validate_header(&self.schema, CANVAS_SET_PLAN_SCHEMA, &self.version)?;
        if self.source_size != source_size {
            return Err(TransformError::new(
                ErrorCode::RasterShapeMismatch,
                "Canvas Set plan source dimensions do not match the replay raster",
            )
            .with_details(json!({ "expected": self.source_size, "actual": source_size })));
        }
        validate_variant_ids(self.variants.iter().map(|variant| variant.id.as_str()))?;
        let mut cumulative = 0_u64;
        for variant in &self.variants {
            variant.plan.validate_for_source(source_size)?;
            cumulative = cumulative
                .checked_add(pixel_count(variant.plan.output_size)?)
                .ok_or_else(output_limit_overflow)?;
        }
        if cumulative > MAX_CANVAS_SET_PIXELS {
            return Err(output_limit(
                "Canvas Set exceeds the cumulative output pixel ceiling",
            ));
        }
        Ok(())
    }
}

pub fn plan_canvas(spec: &CanvasSpec, source_size: PixelSize) -> TransformResult<CanvasPlan> {
    resolve_canvas(spec, source_size, None)
}

pub fn resolve_canvas(
    spec: &CanvasSpec,
    source_size: PixelSize,
    resolved_trim: Option<PixelRect>,
) -> TransformResult<CanvasPlan> {
    spec.validate()?;
    resolve_operation(&spec.operation, source_size, resolved_trim)
}

pub fn plan_canvas_set(
    spec: &CanvasSetSpec,
    source_size: PixelSize,
) -> TransformResult<CanvasSetPlan> {
    resolve_canvas_set(spec, source_size, &vec![None; spec.variants.len()])
}

/// Resolve the alpha-dependent Trim rectangle from one decoded 8-bit RGBA
/// raster. Browser and native adapters share this function so neither carrier
/// owns a second Trim predicate or off-by-one convention.
pub fn resolve_trim_rect_rgba(
    rgba: &[u8],
    source_size: PixelSize,
    alpha_threshold: u8,
) -> TransformResult<PixelRect> {
    resolve_trim_rect_rgba_with_cancel(rgba, source_size, alpha_threshold, &|| false)
}

pub fn resolve_trim_rect_rgba_with_cancel(
    rgba: &[u8],
    source_size: PixelSize,
    alpha_threshold: u8,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<PixelRect> {
    source_size.validate("sourceSize")?;
    if alpha_threshold > 254 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "alphaThreshold must be in 0..254",
        ));
    }
    let expected = usize::try_from(
        u64::from(source_size.width)
            .checked_mul(u64::from(source_size.height))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(output_limit_overflow)?,
    )
    .map_err(|_| output_limit_overflow())?;
    if rgba.len() != expected {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "decoded RGBA byte length does not match the declared Canvas source",
        ));
    }
    let mut minimum_x = source_size.width;
    let mut minimum_y = source_size.height;
    let mut maximum_x = 0_u32;
    let mut maximum_y = 0_u32;
    let mut occupied = false;
    for y in 0..source_size.height {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "Canvas Trim was cancelled",
            ));
        }
        for x in 0..source_size.width {
            let pixel = u64::from(y)
                .checked_mul(u64::from(source_size.width))
                .and_then(|offset| offset.checked_add(u64::from(x)))
                .and_then(|offset| offset.checked_mul(4))
                .and_then(|offset| offset.checked_add(3))
                .and_then(|offset| usize::try_from(offset).ok())
                .ok_or_else(output_limit_overflow)?;
            if rgba[pixel] > alpha_threshold {
                occupied = true;
                minimum_x = minimum_x.min(x);
                minimum_y = minimum_y.min(y);
                maximum_x = maximum_x.max(x);
                maximum_y = maximum_y.max(y);
            }
        }
    }
    if !occupied {
        return Err(TransformError::new(
            ErrorCode::TrimEmpty,
            "Trim found no primary-image alpha above alphaThreshold",
        ));
    }
    Ok(PixelRect {
        x: minimum_x,
        y: minimum_y,
        width: maximum_x - minimum_x + 1,
        height: maximum_y - minimum_y + 1,
    })
}

pub fn resolve_canvas_set(
    spec: &CanvasSetSpec,
    source_size: PixelSize,
    resolved_trims: &[Option<PixelRect>],
) -> TransformResult<CanvasSetPlan> {
    spec.validate()?;
    source_size.validate("sourceSize")?;
    if resolved_trims.len() != spec.variants.len() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "resolved Trim entries must correspond one-to-one with Canvas variants",
        ));
    }
    let mut cumulative = 0_u64;
    let mut variants = Vec::with_capacity(spec.variants.len());
    for (variant, resolved_trim) in spec.variants.iter().zip(resolved_trims) {
        let plan = resolve_operation(&variant.operation, source_size, *resolved_trim)?;
        cumulative = cumulative
            .checked_add(pixel_count(plan.output_size)?)
            .ok_or_else(output_limit_overflow)?;
        if cumulative > MAX_CANVAS_SET_PIXELS {
            return Err(output_limit(
                "Canvas Set exceeds the cumulative output pixel ceiling",
            ));
        }
        variants.push(CanvasVariantPlan {
            id: variant.id.clone(),
            plan,
        });
    }
    Ok(CanvasSetPlan {
        schema: CANVAS_SET_PLAN_SCHEMA.to_owned(),
        version: CANVAS_VERSION.to_owned(),
        source_size,
        variants,
    })
}

fn resolve_operation(
    operation: &CanvasOperation,
    source_size: PixelSize,
    resolved_trim: Option<PixelRect>,
) -> TransformResult<CanvasPlan> {
    source_size.validate("sourceSize")?;
    if !matches!(operation, CanvasOperation::Trim { .. }) && resolved_trim.is_some() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "resolved Trim bounds are only valid for a Trim operation",
        ));
    }
    let full = PixelRect {
        x: 0,
        y: 0,
        width: source_size.width,
        height: source_size.height,
    };
    let (source_rect, output_size, placement, scale, kind, background) = match operation {
        CanvasOperation::Crop { rect } => {
            validate_rect(*rect, source_size)?;
            let output = PixelSize::new(rect.width, rect.height);
            (
                *rect,
                output,
                placement(0.0, 0.0, rect.width as f64, rect.height as f64),
                scale(1.0, 1.0),
                CanvasOperationKind::Crop,
                None,
            )
        }
        CanvasOperation::Trim { alpha_threshold } => {
            if *alpha_threshold > 254 {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "alphaThreshold must be in 0..254",
                ));
            }
            let rect = resolved_trim.ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "Trim planning requires an explicit alpha-resolved source rectangle",
                )
            })?;
            validate_rect(rect, source_size)?;
            let output = PixelSize::new(rect.width, rect.height);
            (
                rect,
                output,
                placement(0.0, 0.0, rect.width as f64, rect.height as f64),
                scale(1.0, 1.0),
                CanvasOperationKind::Trim,
                None,
            )
        }
        CanvasOperation::Pad { insets, background } => {
            let width = source_size
                .width
                .checked_add(insets.left)
                .and_then(|value| value.checked_add(insets.right))
                .ok_or_else(output_limit_overflow)?;
            let height = source_size
                .height
                .checked_add(insets.top)
                .and_then(|value| value.checked_add(insets.bottom))
                .ok_or_else(output_limit_overflow)?;
            let output = PixelSize::new(width, height);
            validate_output(output)?;
            (
                full,
                output,
                placement(
                    insets.left as f64,
                    insets.top as f64,
                    source_size.width as f64,
                    source_size.height as f64,
                ),
                scale(1.0, 1.0),
                CanvasOperationKind::Pad,
                Some(*background),
            )
        }
        CanvasOperation::Contain {
            output,
            anchor,
            background,
        } => {
            validate_output(*output)?;
            validate_anchor(*anchor)?;
            let factor = (output.width as f64 / source_size.width as f64)
                .min(output.height as f64 / source_size.height as f64);
            let width = source_size.width as f64 * factor;
            let height = source_size.height as f64 * factor;
            (
                full,
                *output,
                placement(
                    (output.width as f64 - width) * anchor.x,
                    (output.height as f64 - height) * anchor.y,
                    width,
                    height,
                ),
                scale(factor, factor),
                CanvasOperationKind::Contain,
                Some(*background),
            )
        }
        CanvasOperation::Cover {
            output,
            anchor,
            background,
        } => {
            validate_output(*output)?;
            validate_anchor(*anchor)?;
            let factor = (output.width as f64 / source_size.width as f64)
                .max(output.height as f64 / source_size.height as f64);
            let width = source_size.width as f64 * factor;
            let height = source_size.height as f64 * factor;
            (
                full,
                *output,
                placement(
                    (output.width as f64 - width) * anchor.x,
                    (output.height as f64 - height) * anchor.y,
                    width,
                    height,
                ),
                scale(factor, factor),
                CanvasOperationKind::Cover,
                Some(*background),
            )
        }
        CanvasOperation::Stretch { output } => {
            validate_output(*output)?;
            let sx = output.width as f64 / source_size.width as f64;
            let sy = output.height as f64 / source_size.height as f64;
            (
                full,
                *output,
                placement(0.0, 0.0, output.width as f64, output.height as f64),
                scale(sx, sy),
                CanvasOperationKind::Stretch,
                None,
            )
        }
    };
    Ok(CanvasPlan {
        schema: CANVAS_PLAN_SCHEMA.to_owned(),
        version: CANVAS_VERSION.to_owned(),
        source_size,
        source_rect,
        output_size,
        placement,
        scale,
        operation: kind,
        background,
    })
}

fn validate_header(schema: &str, expected: &str, version: &str) -> TransformResult<()> {
    if schema != expected {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported schema {:?}; expected {expected:?}",
                crate::bounded_text(schema, MAX_HEADER_ECHO_CHARS)
            ),
        ));
    }
    if version != CANVAS_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!(
                "unsupported version {:?}; expected {CANVAS_VERSION:?}",
                crate::bounded_text(version, MAX_HEADER_ECHO_CHARS)
            ),
        ));
    }
    Ok(())
}

fn validate_variant_ids<'a>(ids: impl Iterator<Item = &'a str>) -> TransformResult<()> {
    let ids: Vec<_> = ids.collect();
    if ids.is_empty() || ids.len() > MAX_CANVAS_VARIANTS {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Canvas Set must contain 1..16 variants",
        ));
    }
    let mut seen = HashSet::with_capacity(ids.len());
    for id in ids {
        let valid = id.len() <= 64
            && id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
            && id
                .as_bytes()
                .iter()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
        if !valid {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Canvas variant id must match [A-Za-z0-9][A-Za-z0-9_-]{0,63}",
            ));
        }
        if !seen.insert(id) {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                "Canvas variant ids and derived filenames must be unique",
            ));
        }
    }
    Ok(())
}

fn validate_rect(rect: PixelRect, source: PixelSize) -> TransformResult<()> {
    if rect.width == 0
        || rect.height == 0
        || rect
            .x
            .checked_add(rect.width)
            .is_none_or(|right| right > source.width)
        || rect
            .y
            .checked_add(rect.height)
            .is_none_or(|bottom| bottom > source.height)
    {
        return Err(TransformError::new(
            ErrorCode::CropBounds,
            "Canvas source rectangle must be non-empty and wholly inside the source raster",
        )
        .with_details(json!({ "rect": rect, "sourceSize": source })));
    }
    Ok(())
}

fn validate_anchor(anchor: NormalizedAnchor) -> TransformResult<()> {
    if !anchor.x.is_finite() || !anchor.y.is_finite() {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "Canvas anchor must be finite",
        ));
    }
    if !(0.0..=1.0).contains(&anchor.x) || !(0.0..=1.0).contains(&anchor.y) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Canvas anchor must stay in the closed [0,1] range",
        ));
    }
    Ok(())
}

fn validate_operation_shape(operation: &CanvasOperation) -> TransformResult<()> {
    match operation {
        CanvasOperation::Crop { rect } => {
            if rect.width == 0
                || rect.height == 0
                || rect.x.checked_add(rect.width).is_none()
                || rect.y.checked_add(rect.height).is_none()
            {
                return Err(TransformError::new(
                    ErrorCode::CropBounds,
                    "Canvas crop rectangle must be non-empty and use non-overflowing coordinates",
                ));
            }
            validate_output(PixelSize::new(rect.width, rect.height))?;
        }
        CanvasOperation::Trim { alpha_threshold } => {
            if *alpha_threshold > 254 {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "alphaThreshold must be in 0..254",
                ));
            }
        }
        CanvasOperation::Pad { insets, .. } => {
            let minimum_width = 1_u32
                .checked_add(insets.left)
                .and_then(|value| value.checked_add(insets.right))
                .ok_or_else(output_limit_overflow)?;
            let minimum_height = 1_u32
                .checked_add(insets.top)
                .and_then(|value| value.checked_add(insets.bottom))
                .ok_or_else(output_limit_overflow)?;
            validate_output(PixelSize::new(minimum_width, minimum_height))?;
        }
        CanvasOperation::Contain { output, anchor, .. }
        | CanvasOperation::Cover { output, anchor, .. } => {
            validate_output(*output)?;
            validate_anchor(*anchor)?;
        }
        CanvasOperation::Stretch { output } => validate_output(*output)?,
    }
    Ok(())
}

fn validate_output(output: PixelSize) -> TransformResult<()> {
    output.validate("output")?;
    if output.width > MAX_CANVAS_AXIS
        || output.height > MAX_CANVAS_AXIS
        || pixel_count(output)? > MAX_CANVAS_PIXELS
    {
        return Err(output_limit("Canvas output exceeds the product ceiling"));
    }
    Ok(())
}

fn validate_placement(value: CanvasPlacement, scale: CanvasScale) -> TransformResult<()> {
    if !value.x.is_finite()
        || !value.y.is_finite()
        || !value.width.is_finite()
        || !value.height.is_finite()
        || !scale.x.is_finite()
        || !scale.y.is_finite()
    {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "Canvas plan placement and scale must be finite",
        ));
    }
    if value.width <= 0.0 || value.height <= 0.0 || scale.x <= 0.0 || scale.y <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Canvas plan placement and scale must be positive",
        ));
    }
    Ok(())
}

fn validate_canonical_plan(plan: &CanvasPlan) -> TransformResult<()> {
    let full = PixelRect {
        x: 0,
        y: 0,
        width: plan.source_size.width,
        height: plan.source_size.height,
    };
    let source_width = plan.source_size.width as f64;
    let source_height = plan.source_size.height as f64;
    let output_width = plan.output_size.width as f64;
    let output_height = plan.output_size.height as f64;
    let invalid = || {
        TransformError::new(
            ErrorCode::Schema,
            "Canvas plan is not a canonical core-generated plan",
        )
    };
    match plan.operation {
        CanvasOperationKind::Crop | CanvasOperationKind::Trim => {
            if plan.output_size != PixelSize::new(plan.source_rect.width, plan.source_rect.height)
                || !placement_matches(
                    plan.placement,
                    placement(
                        0.0,
                        0.0,
                        plan.source_rect.width as f64,
                        plan.source_rect.height as f64,
                    ),
                )
                || !scale_matches(plan.scale, scale(1.0, 1.0))
                || plan.background.is_some()
            {
                return Err(invalid());
            }
        }
        CanvasOperationKind::Pad => {
            let left = exact_nonnegative_integer(plan.placement.x).ok_or_else(invalid)?;
            let top = exact_nonnegative_integer(plan.placement.y).ok_or_else(invalid)?;
            let minimum_width = plan
                .source_size
                .width
                .checked_add(left)
                .ok_or_else(output_limit_overflow)?;
            let minimum_height = plan
                .source_size
                .height
                .checked_add(top)
                .ok_or_else(output_limit_overflow)?;
            if plan.source_rect != full
                || plan.output_size.width < minimum_width
                || plan.output_size.height < minimum_height
                || !placement_matches(
                    plan.placement,
                    placement(left as f64, top as f64, source_width, source_height),
                )
                || !scale_matches(plan.scale, scale(1.0, 1.0))
                || plan.background.is_none()
            {
                return Err(invalid());
            }
        }
        CanvasOperationKind::Contain | CanvasOperationKind::Cover => {
            let expected_scale = match plan.operation {
                CanvasOperationKind::Contain => {
                    (output_width / source_width).min(output_height / source_height)
                }
                CanvasOperationKind::Cover => {
                    (output_width / source_width).max(output_height / source_height)
                }
                _ => unreachable!(),
            };
            let expected_width = source_width * expected_scale;
            let expected_height = source_height * expected_scale;
            let remaining_x = output_width - expected_width;
            let remaining_y = output_height - expected_height;
            if plan.source_rect != full
                || !approx(plan.scale.x, expected_scale)
                || !approx(plan.scale.y, expected_scale)
                || !approx(plan.placement.width, expected_width)
                || !approx(plan.placement.height, expected_height)
                || !anchored_offset_is_reachable(plan.placement.x, remaining_x)
                || !anchored_offset_is_reachable(plan.placement.y, remaining_y)
                || plan.background.is_none()
            {
                return Err(invalid());
            }
        }
        CanvasOperationKind::Stretch => {
            if plan.source_rect != full
                || !placement_matches(
                    plan.placement,
                    placement(0.0, 0.0, output_width, output_height),
                )
                || !scale_matches(
                    plan.scale,
                    scale(output_width / source_width, output_height / source_height),
                )
                || plan.background.is_some()
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}

fn exact_nonnegative_integer(value: f64) -> Option<u32> {
    if value >= 0.0 && value <= u32::MAX as f64 && value.fract() == 0.0 {
        Some(value as u32)
    } else {
        None
    }
}

fn anchored_offset_is_reachable(offset: f64, remaining: f64) -> bool {
    if approx(remaining, 0.0) {
        approx(offset, 0.0)
    } else {
        let anchor = offset / remaining;
        (-1.0e-12..=1.0 + 1.0e-12).contains(&anchor)
    }
}

fn placement_matches(left: CanvasPlacement, right: CanvasPlacement) -> bool {
    approx(left.x, right.x)
        && approx(left.y, right.y)
        && approx(left.width, right.width)
        && approx(left.height, right.height)
}

fn scale_matches(left: CanvasScale, right: CanvasScale) -> bool {
    approx(left.x, right.x) && approx(left.y, right.y)
}

fn approx(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= 1.0e-10 * scale
}

fn pixel_count(size: PixelSize) -> TransformResult<u64> {
    u64::from(size.width)
        .checked_mul(u64::from(size.height))
        .ok_or_else(output_limit_overflow)
}

fn output_limit(message: &'static str) -> TransformError {
    TransformError::new(ErrorCode::OutputLimit, message)
}

fn output_limit_overflow() -> TransformError {
    output_limit("Canvas dimensions or cumulative pixels overflowed")
}

const fn placement(x: f64, y: f64, width: f64, height: f64) -> CanvasPlacement {
    CanvasPlacement {
        x: canonical_zero(x),
        y: canonical_zero(y),
        width: canonical_zero(width),
        height: canonical_zero(height),
    }
}

const fn scale(x: f64, y: f64) -> CanvasScale {
    CanvasScale {
        x: canonical_zero(x),
        y: canonical_zero(y),
    }
}

const fn canonical_zero(value: f64) -> f64 {
    if value == 0.0 { 0.0 } else { value }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn set(variants: Vec<CanvasVariant>) -> CanvasSetSpec {
        CanvasSetSpec {
            schema: CANVAS_SET_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            variants,
        }
    }

    fn variant(id: &str, operation: CanvasOperation) -> CanvasVariant {
        CanvasVariant {
            id: id.to_owned(),
            operation,
        }
    }

    fn transparent() -> CanvasBackground {
        CanvasBackground::Transparent {}
    }

    #[test]
    fn contain_and_cover_follow_the_declared_anchor_equations() {
        let source = PixelSize::new(400, 200);
        let contain = CanvasSpec {
            schema: CANVAS_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            operation: CanvasOperation::Contain {
                output: PixelSize::new(300, 300),
                anchor: NormalizedAnchor { x: 1.0, y: 0.25 },
                background: transparent(),
            },
        };
        let plan = plan_canvas(&contain, source).unwrap();
        assert_eq!(plan.scale, CanvasScale { x: 0.75, y: 0.75 });
        assert_eq!(
            plan.placement,
            CanvasPlacement {
                x: 0.0,
                y: 37.5,
                width: 300.0,
                height: 150.0
            }
        );
        plan.validate_for_source(source).unwrap();

        let cover = CanvasSpec {
            operation: CanvasOperation::Cover {
                output: PixelSize::new(300, 300),
                anchor: NormalizedAnchor { x: 1.0, y: 0.25 },
                background: transparent(),
            },
            ..contain
        };
        let plan = plan_canvas(&cover, source).unwrap();
        assert_eq!(plan.scale, CanvasScale { x: 1.5, y: 1.5 });
        assert_eq!(
            plan.placement,
            CanvasPlacement {
                x: -300.0,
                y: 0.0,
                width: 600.0,
                height: 300.0
            }
        );
        plan.validate_for_source(source).unwrap();
    }

    #[test]
    fn crop_bounds_reject_empty_outside_and_overflowing_rectangles() {
        let source = PixelSize::new(20, 10);
        for rect in [
            PixelRect {
                x: 0,
                y: 0,
                width: 0,
                height: 1,
            },
            PixelRect {
                x: 19,
                y: 0,
                width: 2,
                height: 1,
            },
            PixelRect {
                x: u32::MAX,
                y: 0,
                width: 2,
                height: 1,
            },
        ] {
            let spec = CanvasSpec {
                schema: CANVAS_SCHEMA.to_owned(),
                version: CANVAS_VERSION.to_owned(),
                operation: CanvasOperation::Crop { rect },
            };
            assert_eq!(
                plan_canvas(&spec, source).unwrap_err().code,
                ErrorCode::CropBounds
            );
        }
    }

    #[test]
    fn trim_requires_bounds_and_other_operations_reject_them() {
        let source = PixelSize::new(20, 10);
        let trim = CanvasSpec {
            schema: CANVAS_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            operation: CanvasOperation::Trim { alpha_threshold: 0 },
        };
        assert_eq!(
            plan_canvas(&trim, source).unwrap_err().code,
            ErrorCode::Schema
        );
        let bounds = PixelRect {
            x: 2,
            y: 3,
            width: 4,
            height: 5,
        };
        assert_eq!(
            resolve_canvas(&trim, source, Some(bounds))
                .unwrap()
                .source_rect,
            bounds
        );

        let crop = CanvasSpec {
            operation: CanvasOperation::Crop { rect: bounds },
            ..trim
        };
        assert_eq!(
            resolve_canvas(&crop, source, Some(bounds))
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn set_preserves_order_and_rejects_duplicate_ids() {
        let source = PixelSize::new(10, 10);
        let spec = set(vec![
            variant(
                "story",
                CanvasOperation::Stretch {
                    output: PixelSize::new(9, 16),
                },
            ),
            variant(
                "square",
                CanvasOperation::Stretch {
                    output: PixelSize::new(10, 10),
                },
            ),
        ]);
        let plan = plan_canvas_set(&spec, source).unwrap();
        assert_eq!(
            plan.variants
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["story", "square"]
        );

        let duplicate = set(vec![
            variant("same", CanvasOperation::Stretch { output: source }),
            variant("same", CanvasOperation::Stretch { output: source }),
        ]);
        assert_eq!(
            duplicate.validate().unwrap_err().code,
            ErrorCode::OutputCollision
        );
    }

    #[test]
    fn spec_validation_rejects_invalid_operation_values_without_a_source() {
        let invalid_anchor = set(vec![variant(
            "bad",
            CanvasOperation::Contain {
                output: PixelSize::new(10, 10),
                anchor: NormalizedAnchor { x: 1.1, y: 0.5 },
                background: transparent(),
            },
        )]);
        assert_eq!(
            invalid_anchor.validate().unwrap_err().code,
            ErrorCode::Schema
        );

        let invalid_trim = set(vec![variant(
            "bad",
            CanvasOperation::Trim {
                alpha_threshold: 255,
            },
        )]);
        assert_eq!(invalid_trim.validate().unwrap_err().code, ErrorCode::Schema);

        let invalid_crop = set(vec![variant(
            "bad",
            CanvasOperation::Crop {
                rect: PixelRect {
                    x: u32::MAX,
                    y: 0,
                    width: 2,
                    height: 1,
                },
            },
        )]);
        assert_eq!(
            invalid_crop.validate().unwrap_err().code,
            ErrorCode::CropBounds
        );

        for operation in [
            CanvasOperation::Stretch {
                output: PixelSize::new(0, 10),
            },
            CanvasOperation::Contain {
                output: PixelSize::new(MAX_CANVAS_AXIS + 1, 10),
                anchor: NormalizedAnchor { x: 0.5, y: 0.5 },
                background: transparent(),
            },
            CanvasOperation::Pad {
                insets: CanvasInsets {
                    top: 0,
                    right: 0,
                    bottom: 0,
                    left: MAX_CANVAS_AXIS,
                },
                background: transparent(),
            },
        ] {
            assert!(set(vec![variant("bad", operation)]).validate().is_err());
        }
    }

    #[test]
    fn background_wire_objects_are_closed() {
        for invalid in [
            json!({ "kind": "transparent", "extra": true }),
            json!({
                "kind": "color",
                "space": "srgb8",
                "rgba": [0, 0, 0, 255],
                "extra": true
            }),
        ] {
            assert!(serde_json::from_value::<CanvasBackground>(invalid).is_err());
        }
    }

    #[test]
    fn replay_rejects_shape_mismatch_and_noncanonical_plan_geometry() {
        let source = PixelSize::new(40, 20);
        let spec = CanvasSpec {
            schema: CANVAS_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            operation: CanvasOperation::Stretch {
                output: PixelSize::new(80, 80),
            },
        };
        let mut plan = plan_canvas(&spec, source).unwrap();
        assert_eq!(
            plan.validate_for_source(PixelSize::new(41, 20))
                .unwrap_err()
                .code,
            ErrorCode::RasterShapeMismatch
        );
        plan.placement.x = 1.0;
        assert_eq!(
            plan.validate_for_source(source).unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn operation_union_rejects_fields_from_other_variants() {
        let invalid = json!({
            "schema": CANVAS_SCHEMA,
            "version": CANVAS_VERSION,
            "operation": {
                "kind": "stretch",
                "output": { "width": 10, "height": 10 },
                "anchor": { "x": 0.5, "y": 0.5 }
            }
        });
        assert!(serde_json::from_value::<CanvasSpec>(invalid).is_err());
    }

    #[test]
    fn operation_wire_and_schema_use_camel_case_trim_field() {
        let spec = CanvasSpec {
            schema: CANVAS_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            operation: CanvasOperation::Trim {
                alpha_threshold: 17,
            },
        };
        let wire = serde_json::to_value(&spec).unwrap();
        assert_eq!(wire["operation"]["alphaThreshold"], 17);
        assert!(wire["operation"].get("alpha_threshold").is_none());
        let schema = serde_json::to_string(&schemars::schema_for!(CanvasSpec)).unwrap();
        assert!(schema.contains("alphaThreshold"));
        assert!(!schema.contains("alpha_threshold"));
    }

    #[test]
    fn decoded_rgba_trim_uses_the_canonical_strict_alpha_predicate() {
        let source = PixelSize::new(3, 2);
        let mut rgba = vec![0_u8; 3 * 2 * 4];
        rgba[15] = 7;
        rgba[11] = 8;
        assert_eq!(
            resolve_trim_rect_rgba(&rgba, source, 7).unwrap(),
            PixelRect {
                x: 2,
                y: 0,
                width: 1,
                height: 1,
            }
        );
        assert_eq!(
            resolve_trim_rect_rgba(&rgba, source, 8).unwrap_err().code,
            ErrorCode::TrimEmpty
        );
        assert_eq!(
            resolve_trim_rect_rgba(&rgba[..rgba.len() - 1], source, 0)
                .unwrap_err()
                .code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn set_and_anchor_schema_expose_runtime_bounds() {
        let schema = serde_json::to_value(schemars::schema_for!(CanvasSetSpec)).unwrap();
        assert_eq!(schema["properties"]["variants"]["minItems"], 1);
        assert_eq!(schema["properties"]["variants"]["maxItems"], 16);
        assert_eq!(
            schema["$defs"]["CanvasVariant"]["properties"]["id"]["maxLength"],
            64
        );
        assert_eq!(
            schema["$defs"]["CanvasVariant"]["properties"]["id"]["pattern"],
            "^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
        );
        assert_eq!(
            schema["$defs"]["NormalizedAnchor"]["properties"]["x"]["minimum"],
            0.0
        );
        assert_eq!(
            schema["$defs"]["NormalizedAnchor"]["properties"]["x"]["maximum"],
            1.0
        );
        let contain = schema["$defs"]["CanvasOperation"]["oneOf"]
            .as_array()
            .unwrap()
            .iter()
            .find(|variant| variant["properties"]["kind"]["const"] == "contain")
            .unwrap();
        assert_eq!(
            contain["properties"]["output"]["properties"]["width"]["maximum"],
            MAX_CANVAS_AXIS
        );
    }

    #[test]
    fn generated_plans_canonicalize_signed_zero_for_json_replay_identity() {
        let spec = CanvasSpec {
            schema: CANVAS_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            operation: CanvasOperation::Cover {
                output: PixelSize::new(1, 1),
                anchor: NormalizedAnchor { x: 0.5, y: 1.0 },
                background: transparent(),
            },
        };
        let plan = plan_canvas(&spec, PixelSize::new(2, 1)).unwrap();
        let encoded = serde_json::to_string(&plan).unwrap();
        assert!(!encoded.contains("-0.0"), "{encoded}");
        let decoded: CanvasPlan = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, plan);
        assert_eq!(decoded.placement.y.to_bits(), 0.0_f64.to_bits());
    }
}

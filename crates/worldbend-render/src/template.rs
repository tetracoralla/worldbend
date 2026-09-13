use crate::{
    CanvasSetProgram, CanvasSetRenderOptions, CanvasSetRenderedItem, MockupRenderOptions,
    RasterProgramRenderOptions, RenderLimits, SamplingQuality,
    canvas::{preflight_output_directory, publish_directory_noreplace},
    file_io::{EvidenceWriter, decode_file_with_limits, write_png},
    render_canvas_set_to_directory, render_mockup_with_cancel, render_raster_program_with_cancel,
    resolve_canvas_set_for_image, validate_limits,
};
use image::DynamicImage;
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use worldbend_core::{
    ErrorCode, SpatialTemplateOperation, SpatialTemplateOutput, TransformError, TransformResult,
    VariationBinding, VariationFailurePolicy, VariationJobPlan, VariationJobSpec,
    plan_variation_job,
};

const MAX_EXACT_JSON_INTEGER: u64 = 9_007_199_254_740_991;
pub const MAX_VARIATION_JOB_SOURCE_PIXELS: u64 = 64 * 1024 * 1024;
pub const MAX_VARIATION_JOB_PROCESSED_PIXELS: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobRenderOptions {
    #[serde(default)]
    pub quality: SamplingQuality,
    #[serde(default)]
    pub limits: RenderLimits,
    #[serde(default = "default_max_source_pixels")]
    #[schemars(schema_with = "source_pixels_schema")]
    pub max_source_pixels: u64,
    #[serde(default = "default_max_processed_pixels")]
    #[schemars(schema_with = "processed_pixels_schema")]
    pub max_processed_pixels: u64,
}

impl Default for VariationJobRenderOptions {
    fn default() -> Self {
        Self {
            quality: SamplingQuality::Standard,
            limits: RenderLimits::default(),
            max_source_pixels: MAX_VARIATION_JOB_SOURCE_PIXELS,
            max_processed_pixels: MAX_VARIATION_JOB_PROCESSED_PIXELS,
        }
    }
}

const fn default_max_source_pixels() -> u64 {
    MAX_VARIATION_JOB_SOURCE_PIXELS
}

const fn default_max_processed_pixels() -> u64 {
    MAX_VARIATION_JOB_PROCESSED_PIXELS
}

#[derive(Debug, Clone)]
pub struct VariationFileAsset {
    pub path: PathBuf,
    pub source_sha256: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum VariationJobRenderStatus {
    Ready,
    Written,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationSourceEvidence {
    pub asset_id: String,
    pub source_sha256: String,
    pub width: u32,
    pub height: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum VariationJobItemOutcome {
    Rendered {
        index: u32,
        id: String,
        bindings: Vec<VariationBinding>,
        root_width: u32,
        root_height: u32,
        #[schemars(schema_with = "json_safe_u64_schema")]
        operation_pixels: u64,
        outputs: Vec<CanvasSetRenderedItem>,
    },
    Failed {
        index: u32,
        id: String,
        bindings: Vec<VariationBinding>,
        error: TransformError,
    },
}

impl VariationJobItemOutcome {
    pub fn id(&self) -> &str {
        match self {
            Self::Rendered { id, .. } | Self::Failed { id, .. } => id,
        }
    }

    pub fn bindings(&self) -> &[VariationBinding] {
        match self {
            Self::Rendered { bindings, .. } | Self::Failed { bindings, .. } => bindings,
        }
    }

    pub fn outputs_mut(&mut self) -> Option<&mut Vec<CanvasSetRenderedItem>> {
        match self {
            Self::Rendered { outputs, .. } => Some(outputs),
            Self::Failed { .. } => None,
        }
    }

    pub fn rendered_size(&self) -> Option<(u32, u32)> {
        match self {
            Self::Rendered {
                root_width,
                root_height,
                ..
            } => Some((*root_width, *root_height)),
            Self::Failed { .. } => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VariationJobFileRenderResult {
    pub status: VariationJobRenderStatus,
    pub dry_run: bool,
    pub output_directory: String,
    pub plan: VariationJobPlan,
    pub sources: Vec<VariationSourceEvidence>,
    pub items: Vec<VariationJobItemOutcome>,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub cumulative_source_pixels: u64,
    #[schemars(schema_with = "json_safe_u64_schema")]
    pub cumulative_processed_pixels: u64,
}

pub fn render_variation_job_files(
    assets: &HashMap<String, PathBuf>,
    spec: &VariationJobSpec,
    output_directory: &Path,
    options: VariationJobRenderOptions,
    dry_run: bool,
) -> TransformResult<VariationJobFileRenderResult> {
    let assets = assets
        .iter()
        .map(|(id, path)| {
            (
                id.clone(),
                VariationFileAsset {
                    path: path.clone(),
                    source_sha256: None,
                },
            )
        })
        .collect();
    render_variation_job_files_with_cancel(
        &assets,
        spec,
        output_directory,
        options,
        dry_run,
        &|| false,
    )
}

pub fn render_variation_job_files_with_cancel(
    assets: &HashMap<String, VariationFileAsset>,
    spec: &VariationJobSpec,
    output_directory: &Path,
    options: VariationJobRenderOptions,
    dry_run: bool,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<VariationJobFileRenderResult> {
    validate_options(options)?;
    let plan = plan_variation_job(spec)?;
    preflight_output_directory(output_directory)?;
    check_cancelled(is_cancelled)?;

    let parent = output_directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let staging = tempfile::Builder::new()
        .prefix(".worldbend-variation-")
        .tempdir_in(parent)
        .map_err(render_io(
            "failed to create Variation Job staging directory",
        ))?;

    let continue_on_item_failure = spec.failure_policy == VariationFailurePolicy::Continue;
    validate_assets(assets, &plan, continue_on_item_failure)?;
    let (decoded, source_evidence, cumulative_source_pixels, decode_errors) = decode_assets(
        assets,
        &plan,
        options,
        is_cancelled,
        continue_on_item_failure,
    )?;
    let mut items = Vec::with_capacity(plan.items.len());
    let mut budget = ProcessedBudget::new(options.max_processed_pixels);
    let mut rendered_count = 0_usize;

    for (index, item) in plan.items.iter().enumerate() {
        let index = u32::try_from(index).map_err(|_| {
            TransformError::new(ErrorCode::Internal, "Variation Job index overflowed")
        })?;
        match render_one_item(
            index,
            item,
            &decoded,
            &decode_errors,
            spec,
            &plan,
            staging.path(),
            output_directory,
            options,
            &mut budget,
            is_cancelled,
        ) {
            Ok(rendered) => {
                rendered_count += 1;
                items.push(rendered);
            }
            Err(error) if continue_on_item_failure => {
                let _ = fs::remove_dir_all(staging.path().join(&item.id));
                items.push(VariationJobItemOutcome::Failed {
                    index,
                    id: item.id.clone(),
                    bindings: item.bindings.clone(),
                    error,
                });
            }
            Err(error) => return Err(error),
        }
    }

    let mut result = VariationJobFileRenderResult {
        status: VariationJobRenderStatus::Ready,
        dry_run,
        output_directory: output_directory.display().to_string(),
        plan,
        sources: source_evidence,
        items,
        cumulative_source_pixels,
        cumulative_processed_pixels: budget.used,
    };
    // Publication stays one no-replace rename in every policy; a continue job
    // with zero successful items publishes an empty directory so downstream
    // controllers can stage and commit it like any other result.
    if !dry_run && (rendered_count > 0 || continue_on_item_failure) {
        publish_directory_noreplace(staging.path(), output_directory)?;
        result.status = VariationJobRenderStatus::Written;
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn render_one_item(
    index: u32,
    item: &worldbend_core::VariationJobItemPlan,
    decoded: &HashMap<String, DynamicImage>,
    decode_errors: &HashMap<String, TransformError>,
    spec: &VariationJobSpec,
    plan: &VariationJobPlan,
    staging: &Path,
    output_directory: &Path,
    options: VariationJobRenderOptions,
    budget: &mut ProcessedBudget,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<VariationJobItemOutcome> {
    check_cancelled(is_cancelled)?;
    for binding in &item.bindings {
        if let Some(error) = decode_errors.get(&binding.asset_id) {
            return Err(error.clone());
        }
        if !decoded.contains_key(&binding.asset_id) {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Variation Job item is missing a decoded asset",
            )
            .with_details(json!({ "itemId": item.id, "assetId": binding.asset_id })));
        }
    }
    let operation_budget = budget
        .remaining()
        .ok_or_else(|| processed_limit_error(options.max_processed_pixels))?;
    let (root, operation_pixels) = match render_root(
        decoded,
        &spec.template.operation,
        &item.bindings,
        options,
        operation_budget,
        is_cancelled,
    ) {
        Ok(rendered) => rendered,
        // Every item shares one template, so a pixel-ceiling failure inside an
        // item render is systematic: latch the budget so remaining items fail
        // fast instead of each repeating the same doomed render.
        Err(error) => {
            if error.code == ErrorCode::OutputLimit {
                budget.force_exhausted();
            }
            return Err(error);
        }
    };
    let output_pixels = match planned_output_pixels(&root, &spec.template.output) {
        Ok(pixels) => pixels,
        Err(error) => {
            if error.code == ErrorCode::OutputLimit {
                budget.force_exhausted();
            }
            return Err(error);
        }
    };
    budget.charge(operation_pixels, output_pixels)?;

    let item_directory = staging.join(&item.id);
    fs::create_dir(&item_directory)
        .map_err(render_io("failed to create Variation Job item directory"))?;
    let output_label = output_directory.join(&item.id).display().to_string();
    let outputs = match render_outputs(
        &root,
        &spec.template.output,
        &item_directory,
        &output_label,
        options,
        is_cancelled,
    ) {
        Ok(outputs) => outputs,
        Err(error) => {
            if error.code == ErrorCode::OutputLimit {
                budget.force_exhausted();
            }
            return Err(error);
        }
    };
    if outputs.len() != plan.template.outputs.len() {
        return Err(TransformError::new(
            ErrorCode::Internal,
            "Variation Job renderer returned the wrong output count",
        ));
    }
    Ok(VariationJobItemOutcome::Rendered {
        index,
        id: item.id.clone(),
        bindings: item.bindings.clone(),
        root_width: root.width(),
        root_height: root.height(),
        operation_pixels,
        outputs,
    })
}

/// Cumulative processed-pixel accounting with an exhaustion latch. The first
/// charge that does not fit (or the first pixel-ceiling render failure) marks
/// the budget exhausted, so under `continue` the remaining items fail fast at
/// the budget check instead of each re-rendering a root that cannot fit.
struct ProcessedBudget {
    used: u64,
    maximum: u64,
    exhausted: bool,
}

impl ProcessedBudget {
    fn new(maximum: u64) -> Self {
        Self {
            used: 0,
            maximum,
            exhausted: false,
        }
    }

    fn remaining(&self) -> Option<u64> {
        if self.exhausted {
            None
        } else {
            Some(self.maximum - self.used).filter(|remaining| *remaining > 0)
        }
    }

    fn force_exhausted(&mut self) {
        self.exhausted = true;
    }

    fn charge(&mut self, operation: u64, output: u64) -> TransformResult<()> {
        let total = self
            .used
            .checked_add(operation)
            .and_then(|value| value.checked_add(output));
        match total {
            Some(total) if total <= self.maximum => {
                self.used = total;
                Ok(())
            }
            Some(total) => {
                self.exhausted = true;
                Err(processed_limit_error_with_actual(self.maximum, total))
            }
            None => {
                self.exhausted = true;
                Err(pixel_overflow())
            }
        }
    }
}

fn render_root(
    decoded: &HashMap<String, DynamicImage>,
    operation: &SpatialTemplateOperation,
    bindings: &[VariationBinding],
    options: VariationJobRenderOptions,
    operation_budget: u64,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<(DynamicImage, u64)> {
    match operation {
        SpatialTemplateOperation::RasterProgram {
            source_slot,
            program,
        } => {
            let binding = binding_for(bindings, source_slot)?;
            let source = decoded.get(&binding.asset_id).ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Internal,
                    "Variation Job asset disappeared after preflight",
                )
            })?;
            let rendered = render_raster_program_with_cancel(
                source,
                program,
                RasterProgramRenderOptions {
                    quality: options.quality,
                    limits: options.limits,
                    max_cumulative_pixels: operation_budget
                        .min(worldbend_core::MAX_RASTER_PROGRAM_PIXELS),
                },
                is_cancelled,
            )?;
            Ok((
                DynamicImage::ImageRgba8(rendered.image),
                rendered.cumulative_pixels,
            ))
        }
        SpatialTemplateOperation::Mockup { spec } => {
            let operation_pixels = u64::from(spec.canvas.width)
                .checked_mul(u64::from(spec.canvas.height))
                .and_then(|pixels| pixels.checked_mul(spec.planes.len() as u64))
                .ok_or_else(pixel_overflow)?;
            if operation_pixels > operation_budget {
                return Err(processed_limit_error(options.max_processed_pixels));
            }
            let mut sources = HashMap::with_capacity(bindings.len());
            for binding in bindings {
                let source = decoded.get(&binding.asset_id).ok_or_else(|| {
                    TransformError::new(
                        ErrorCode::Internal,
                        "Variation Job asset disappeared after preflight",
                    )
                })?;
                sources.insert(binding.slot_id.clone(), source.clone());
            }
            let rendered = render_mockup_with_cancel(
                &sources,
                spec,
                MockupRenderOptions {
                    quality: options.quality,
                    limits: options.limits,
                },
                is_cancelled,
            )?;
            Ok((DynamicImage::ImageRgba8(rendered.image), operation_pixels))
        }
    }
}

fn planned_output_pixels(
    root: &DynamicImage,
    output: &SpatialTemplateOutput,
) -> TransformResult<u64> {
    match output {
        SpatialTemplateOutput::Single { .. } => Ok(0),
        SpatialTemplateOutput::CanvasSet { spec } => {
            let plan = resolve_canvas_set_for_image(root, spec)?;
            plan.variants.iter().try_fold(0_u64, |total, variant| {
                let pixels = u64::from(variant.plan.output_size.width)
                    .checked_mul(u64::from(variant.plan.output_size.height))
                    .ok_or_else(pixel_overflow)?;
                total.checked_add(pixels).ok_or_else(pixel_overflow)
            })
        }
    }
}

fn render_outputs(
    root: &DynamicImage,
    output: &SpatialTemplateOutput,
    item_directory: &Path,
    output_label: &str,
    options: VariationJobRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<Vec<CanvasSetRenderedItem>> {
    match output {
        SpatialTemplateOutput::Single { id } => {
            check_cancelled(is_cancelled)?;
            let filename = format!("{id}.png");
            let path = item_directory.join(&filename);
            let file = fs::File::create(&path)
                .map_err(render_io("failed to create Variation Job output"))?;
            let mut writer = EvidenceWriter::new(file);
            let image = root.as_rgba8().ok_or_else(|| {
                TransformError::new(ErrorCode::Internal, "Variation Job root was not RGBA8")
            })?;
            write_png(image, &mut writer)?;
            writer
                .flush()
                .map_err(render_io("failed to flush Variation Job output"))?;
            writer
                .sync_all()
                .map_err(render_io("failed to sync Variation Job output"))?;
            check_cancelled(is_cancelled)?;
            let (bytes, sha256) = writer.finish();
            Ok(vec![CanvasSetRenderedItem {
                id: id.clone(),
                output: Path::new(output_label).join(filename).display().to_string(),
                bytes,
                sha256,
                width: image.width(),
                height: image.height(),
            }])
        }
        SpatialTemplateOutput::CanvasSet { spec } => {
            let result = render_canvas_set_to_directory(
                root,
                CanvasSetProgram::Spec(spec),
                item_directory,
                output_label,
                CanvasSetRenderOptions {
                    quality: options.quality,
                    limits: options.limits,
                    max_cumulative_pixels: options
                        .max_processed_pixels
                        .min(worldbend_core::MAX_CANVAS_SET_PIXELS),
                },
                is_cancelled,
            )?;
            Ok(result.items)
        }
    }
}

type DecodedAssetSet = (
    HashMap<String, DynamicImage>,
    Vec<VariationSourceEvidence>,
    u64,
    HashMap<String, TransformError>,
);

fn decode_assets(
    assets: &HashMap<String, VariationFileAsset>,
    plan: &VariationJobPlan,
    options: VariationJobRenderOptions,
    is_cancelled: &(dyn Fn() -> bool + Sync),
    continue_on_item_failure: bool,
) -> TransformResult<DecodedAssetSet> {
    let mut decoded = HashMap::with_capacity(plan.asset_ids.len());
    let mut evidence = Vec::with_capacity(plan.asset_ids.len());
    let mut errors = HashMap::new();
    let mut cumulative = 0_u64;
    for asset_id in &plan.asset_ids {
        check_cancelled(is_cancelled)?;
        let Some(asset) = assets.get(asset_id) else {
            let error = TransformError::new(
                ErrorCode::Schema,
                "Variation Job item is missing a planned asset",
            )
            .with_details(json!({ "assetId": asset_id }));
            if continue_on_item_failure {
                errors.insert(asset_id.clone(), error);
                continue;
            }
            return Err(error);
        };
        match decode_file_with_limits(&asset.path, options.limits, asset.source_sha256.as_deref()) {
            Ok((image, sha256, warnings)) => {
                let pixels = u64::from(image.width())
                    .checked_mul(u64::from(image.height()))
                    .ok_or_else(pixel_overflow)?;
                let next = cumulative.checked_add(pixels).ok_or_else(pixel_overflow)?;
                if next > options.max_source_pixels {
                    let error = TransformError::new(
                        ErrorCode::OutputLimit,
                        "Variation Job assets exceed the cumulative decoded-pixel limit",
                    )
                    .with_details(json!({
                        "pixels": next,
                        "maximum": options.max_source_pixels,
                    }));
                    if continue_on_item_failure {
                        errors.insert(asset_id.clone(), error);
                        continue;
                    }
                    return Err(error);
                }
                cumulative = next;
                evidence.push(VariationSourceEvidence {
                    asset_id: asset_id.clone(),
                    source_sha256: sha256,
                    width: image.width(),
                    height: image.height(),
                    warnings,
                });
                decoded.insert(asset_id.clone(), image);
            }
            Err(error) if continue_on_item_failure => {
                errors.insert(asset_id.clone(), error);
            }
            Err(error) => return Err(error),
        }
    }
    Ok((decoded, evidence, cumulative, errors))
}

fn validate_assets(
    assets: &HashMap<String, VariationFileAsset>,
    plan: &VariationJobPlan,
    continue_on_item_failure: bool,
) -> TransformResult<()> {
    let required = plan.asset_ids.iter().collect::<HashSet<_>>();
    let provided = assets.keys().collect::<HashSet<_>>();
    if provided.iter().any(|id| !required.contains(id)) {
        let mut required = required.into_iter().cloned().collect::<Vec<_>>();
        let mut provided = provided.into_iter().cloned().collect::<Vec<_>>();
        required.sort_unstable();
        provided.sort_unstable();
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Variation Job assets must not include unknown assetId values",
        )
        .with_details(json!({ "required": required, "provided": provided })));
    }
    if continue_on_item_failure || required == provided {
        return Ok(());
    }
    let mut required = required.into_iter().cloned().collect::<Vec<_>>();
    let mut provided = provided.into_iter().cloned().collect::<Vec<_>>();
    required.sort_unstable();
    provided.sort_unstable();
    Err(TransformError::new(
        ErrorCode::Schema,
        "Variation Job assets must exactly match the planned assetId values",
    )
    .with_details(json!({ "required": required, "provided": provided })))
}

fn validate_options(options: VariationJobRenderOptions) -> TransformResult<()> {
    validate_limits(options.limits)?;
    if options.max_source_pixels == 0
        || options.max_source_pixels > MAX_VARIATION_JOB_SOURCE_PIXELS
        || options.max_processed_pixels == 0
        || options.max_processed_pixels > MAX_VARIATION_JOB_PROCESSED_PIXELS
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Variation Job limits exceed the product ceiling",
        )
        .with_details(json!({
            "maximumSourcePixels": MAX_VARIATION_JOB_SOURCE_PIXELS,
            "maximumProcessedPixels": MAX_VARIATION_JOB_PROCESSED_PIXELS,
            "configuredSourcePixels": options.max_source_pixels,
            "configuredProcessedPixels": options.max_processed_pixels,
        })));
    }
    Ok(())
}

fn binding_for<'a>(
    bindings: &'a [VariationBinding],
    slot: &str,
) -> TransformResult<&'a VariationBinding> {
    bindings
        .iter()
        .find(|binding| binding.slot_id == slot)
        .ok_or_else(|| {
            TransformError::new(
                ErrorCode::Internal,
                "Variation Job binding disappeared after preflight",
            )
        })
}

fn check_cancelled(is_cancelled: &(dyn Fn() -> bool + Sync)) -> TransformResult<()> {
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "Variation Job render was cancelled",
        ));
    }
    Ok(())
}

fn pixel_overflow() -> TransformError {
    TransformError::new(
        ErrorCode::OutputLimit,
        "Variation Job pixel accounting overflowed",
    )
}

fn processed_limit_error(maximum: u64) -> TransformError {
    TransformError::new(
        ErrorCode::OutputLimit,
        "Variation Job exceeds the cumulative processed-pixel limit",
    )
    .with_details(json!({ "maximum": maximum }))
}

fn processed_limit_error_with_actual(maximum: u64, pixels: u64) -> TransformError {
    TransformError::new(
        ErrorCode::OutputLimit,
        "Variation Job exceeds the cumulative processed-pixel limit",
    )
    .with_details(json!({ "pixels": pixels, "maximum": maximum }))
}

fn render_io(context: &'static str) -> impl FnOnce(std::io::Error) -> TransformError {
    move |error| {
        TransformError::new(ErrorCode::Render, context)
            .with_details(json!({ "reason": error.to_string() }))
    }
}

fn source_pixels_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 1,
        "maximum": MAX_VARIATION_JOB_SOURCE_PIXELS
    })
}

fn processed_pixels_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 1,
        "maximum": MAX_VARIATION_JOB_PROCESSED_PIXELS
    })
}

fn json_safe_u64_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({
        "type": "integer",
        "minimum": 0,
        "maximum": MAX_EXACT_JSON_INTEGER
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use worldbend_core::{
        CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasOperation, CanvasSetSpec, CanvasVariant,
        PixelSize, RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION, RasterProgramSpec,
        RasterProgramStage, SPATIAL_TEMPLATE_SCHEMA, SPATIAL_TEMPLATE_VERSION, SpatialTemplateSpec,
        VARIATION_JOB_SCHEMA, VariationJobItem,
    };

    fn write_source(directory: &Path) -> PathBuf {
        let path = directory.join("source.png");
        RgbaImage::from_pixel(3, 2, Rgba([18, 52, 86, 255]))
            .save(&path)
            .unwrap();
        path
    }

    fn spec(output: SpatialTemplateOutput) -> VariationJobSpec {
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
                            spec: worldbend_core::CanvasSpec {
                                schema: worldbend_core::CANVAS_SCHEMA.to_owned(),
                                version: CANVAS_VERSION.to_owned(),
                                operation: CanvasOperation::Stretch {
                                    output: PixelSize::new(4, 4),
                                },
                            },
                        }],
                    },
                },
                output,
            },
            failure_policy: VariationFailurePolicy::AllOrNone,
            items: ["sku-a", "sku-b"]
                .into_iter()
                .map(|id| VariationJobItem {
                    id: id.to_owned(),
                    bindings: vec![VariationBinding {
                        slot_id: "artwork".to_owned(),
                        asset_id: "asset-a".to_owned(),
                    }],
                })
                .collect(),
        }
    }

    #[test]
    fn publishes_all_items_as_one_directory_transaction() {
        let directory = tempfile::tempdir().unwrap();
        let source = write_source(directory.path());
        let output = directory.path().join("job");
        let assets = HashMap::from([("asset-a".to_owned(), source)]);
        let result = render_variation_job_files(
            &assets,
            &spec(SpatialTemplateOutput::Single {
                id: "hero".to_owned(),
            }),
            &output,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap();

        assert_eq!(result.status, VariationJobRenderStatus::Written);
        assert!(!result.dry_run);
        assert_eq!(result.items.len(), 2);
        let VariationJobItemOutcome::Rendered { outputs, .. } = &result.items[0] else {
            panic!("expected rendered item");
        };
        assert_eq!(outputs[0].width, 4);
        assert!(output.join("sku-a/hero.png").is_file());
        assert!(output.join("sku-b/hero.png").is_file());
    }

    #[test]
    fn canvas_set_outputs_are_correlated_under_each_item() {
        let directory = tempfile::tempdir().unwrap();
        let source = write_source(directory.path());
        let output = directory.path().join("job");
        let assets = HashMap::from([("asset-a".to_owned(), source)]);
        let result = render_variation_job_files(
            &assets,
            &spec(SpatialTemplateOutput::CanvasSet {
                spec: CanvasSetSpec {
                    schema: CANVAS_SET_SCHEMA.to_owned(),
                    version: CANVAS_VERSION.to_owned(),
                    variants: vec![
                        CanvasVariant {
                            id: "square".to_owned(),
                            operation: CanvasOperation::Stretch {
                                output: PixelSize::new(2, 2),
                            },
                        },
                        CanvasVariant {
                            id: "wide".to_owned(),
                            operation: CanvasOperation::Stretch {
                                output: PixelSize::new(4, 2),
                            },
                        },
                    ],
                },
            }),
            &output,
            VariationJobRenderOptions::default(),
            true,
        )
        .unwrap();

        assert_eq!(result.status, VariationJobRenderStatus::Ready);
        assert!(result.dry_run);
        assert_eq!(result.plan.output_count, 4);
        let VariationJobItemOutcome::Rendered { outputs, .. } = &result.items[0] else {
            panic!("expected rendered item");
        };
        assert_eq!(outputs[1].id, "wide");
        assert!(!output.exists());
    }

    #[test]
    fn missing_asset_and_cancellation_leave_no_destination() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("job");
        let spec = spec(SpatialTemplateOutput::Single {
            id: "hero".to_owned(),
        });
        let missing = render_variation_job_files(
            &HashMap::new(),
            &spec,
            &output,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap_err();
        assert_eq!(missing.code, ErrorCode::Schema);
        assert!(!output.exists());

        let source = write_source(directory.path());
        let assets = HashMap::from([(
            "asset-a".to_owned(),
            VariationFileAsset {
                path: source,
                source_sha256: None,
            },
        )]);
        let cancelled = render_variation_job_files_with_cancel(
            &assets,
            &spec,
            &output,
            VariationJobRenderOptions::default(),
            false,
            &|| true,
        )
        .unwrap_err();
        assert_eq!(cancelled.code, ErrorCode::Cancelled);
        assert!(!output.exists());
    }

    #[test]
    fn continue_publishes_successes_and_records_item_failures() {
        let directory = tempfile::tempdir().unwrap();
        let good = write_source(directory.path());
        let output = directory.path().join("job");
        let mut spec = spec(SpatialTemplateOutput::Single {
            id: "hero".to_owned(),
        });
        spec.failure_policy = VariationFailurePolicy::Continue;
        spec.items[1].bindings[0].asset_id = "asset-b".to_owned();
        let assets = HashMap::from([("asset-a".to_owned(), good)]);
        let result = render_variation_job_files(
            &assets,
            &spec,
            &output,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap();

        assert_eq!(result.status, VariationJobRenderStatus::Written);
        assert!(output.join("sku-a/hero.png").is_file());
        assert!(!output.join("sku-b").exists());
        assert!(matches!(
            result.items[0],
            VariationJobItemOutcome::Rendered { .. }
        ));
        let VariationJobItemOutcome::Failed { id, error, .. } = &result.items[1] else {
            panic!("expected failed item");
        };
        assert_eq!(id, "sku-b");
        assert_eq!(error.code, ErrorCode::Schema);

        spec.failure_policy = VariationFailurePolicy::AllOrNone;
        let blocked = directory.path().join("blocked");
        let error = render_variation_job_files(
            &assets,
            &spec,
            &blocked,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert!(!blocked.exists());
    }

    #[test]
    fn continue_with_zero_successful_items_publishes_an_empty_directory() {
        let directory = tempfile::tempdir().unwrap();
        let output = directory.path().join("job");
        let mut spec = spec(SpatialTemplateOutput::Single {
            id: "hero".to_owned(),
        });
        spec.failure_policy = VariationFailurePolicy::Continue;
        let corrupt = directory.path().join("corrupt.png");
        fs::write(&corrupt, b"not a raster").unwrap();
        let assets = HashMap::from([("asset-a".to_owned(), corrupt)]);
        let result = render_variation_job_files(
            &assets,
            &spec,
            &output,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap();

        assert_eq!(result.status, VariationJobRenderStatus::Written);
        assert!(!result.dry_run);
        assert!(output.is_dir());
        assert_eq!(fs::read_dir(&output).unwrap().count(), 0);
        assert!(
            result
                .items
                .iter()
                .all(|item| matches!(item, VariationJobItemOutcome::Failed { .. }))
        );

        let blocked = directory.path().join("blocked");
        spec.failure_policy = VariationFailurePolicy::AllOrNone;
        let error = render_variation_job_files(
            &assets,
            &spec,
            &blocked,
            VariationJobRenderOptions::default(),
            false,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::UnsupportedMedia);
        assert!(!blocked.exists());
    }

    #[test]
    fn processed_budget_exhaustion_fails_remaining_items_without_rendering() {
        let directory = tempfile::tempdir().unwrap();
        let source = write_source(directory.path());
        let output = directory.path().join("job");
        let mut spec = spec(SpatialTemplateOutput::Single {
            id: "hero".to_owned(),
        });
        spec.failure_policy = VariationFailurePolicy::Continue;
        let assets = HashMap::from([("asset-a".to_owned(), source)]);
        // Measure one item's exact processed-pixel cost with a dry run, then
        // cap the budget at exactly one item.
        let probe = render_variation_job_files(
            &assets,
            &spec,
            &directory.path().join("probe"),
            VariationJobRenderOptions::default(),
            true,
        )
        .unwrap();
        let per_item = probe.cumulative_processed_pixels / 2;
        assert!(per_item > 0);
        let options = VariationJobRenderOptions {
            max_processed_pixels: per_item,
            ..VariationJobRenderOptions::default()
        };
        let result = render_variation_job_files(&assets, &spec, &output, options, false).unwrap();

        assert!(matches!(
            result.items[0],
            VariationJobItemOutcome::Rendered { .. }
        ));
        let VariationJobItemOutcome::Failed { id, error, .. } = &result.items[1] else {
            panic!("expected failed item");
        };
        assert_eq!(id, "sku-b");
        assert_eq!(error.code, ErrorCode::OutputLimit);
        assert_eq!(result.cumulative_processed_pixels, per_item);
        assert!(output.join("sku-a/hero.png").is_file());
        assert!(!output.join("sku-b").exists());
    }

    #[test]
    fn processed_budget_charge_overflow_latches_exhaustion() {
        let mut budget = ProcessedBudget::new(20);
        assert_eq!(budget.remaining(), Some(20));
        budget.charge(16, 0).unwrap();
        assert_eq!(budget.remaining(), Some(4));
        assert_eq!(
            budget.charge(16, 0).unwrap_err().code,
            ErrorCode::OutputLimit
        );
        assert_eq!(budget.remaining(), None);
        assert_eq!(budget.used, 16, "only successful charges are accounted");
        budget.force_exhausted();
        assert_eq!(budget.remaining(), None);
    }
}

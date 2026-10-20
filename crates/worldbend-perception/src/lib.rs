//! Typed, bounded assisted-perception providers for Worldbend.
//!
//! Provider output is an assessment, never a transform instruction. A caller
//! must explicitly select a returned candidate before copying its source plane
//! into a deterministic RectifySpec or another closed operation.

use image::{RgbaImage, imageops::FilterType};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, path::Path};
use worldbend_core::{
    ErrorCode, Point, Quad, Size, TransformError, TransformResult, polygon_signed_area,
    validate_quad,
};
use worldbend_render::{
    DEFAULT_MAX_AXIS, DEFAULT_MAX_SOURCE_BYTES, MAX_MEDIA_PIXELS, MediaFormat, MediaSampleFormat,
    RenderLimits, decode_media_analysis_file_with_cancel,
};

pub const PLANE_CANDIDATE_REQUEST_SCHEMA: &str = "worldbend.perception-plane-request";
pub const PLANE_CANDIDATE_RESPONSE_SCHEMA: &str = "worldbend.perception-plane-candidates";
pub const PERCEPTION_VERSION: &str = "0.1";
pub const MIN_ANALYSIS_AXIS: u32 = 64;
pub const MAX_ANALYSIS_AXIS: u32 = 1024;
pub const MAX_PLANE_CANDIDATES: u8 = 3;
const PROVIDER_VERSION: &str = "0.1.0";
const WIRE_DECIMAL_SCALE: f64 = 1_000_000_000_000.0;

fn request_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PLANE_CANDIDATE_REQUEST_SCHEMA })
}

fn response_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PLANE_CANDIDATE_RESPONSE_SCHEMA })
}

fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "string", "const": PERCEPTION_VERSION })
}

fn confidence_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "number", "minimum": 0, "maximum": 1 })
}

fn fraction_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({ "type": "number", "minimum": 0, "maximum": 1 })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PlaneCandidateProviderId {
    ContrastQuadV1,
    AlphaQuadV1,
}

impl PlaneCandidateProviderId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ContrastQuadV1 => "worldbend.contrast-quad-v1",
            Self::AlphaQuadV1 => "worldbend.alpha-quad-v1",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    LocalDeterministicHeuristic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ScoreCalibration {
    UncalibratedRankingScore,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum PerceptionOutcome {
    Candidates,
    NoCandidate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum UncertaintyLevel {
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum UncertaintyReasonCode {
    UncalibratedProviderScore,
    LowContrast,
    SmallSupport,
    DominantSupport,
    BorderContact,
    NonQuadrilateralSupport,
    ThresholdSensitive,
    NoStableQuadrilateral,
    OpaqueSourceForAlphaProvider,
    MultiplePlausibleCandidates,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PerceptionLimits {
    #[schemars(range(min = 1, max = DEFAULT_MAX_AXIS))]
    pub max_width: u32,
    #[schemars(range(min = 1, max = DEFAULT_MAX_AXIS))]
    pub max_height: u32,
    #[schemars(range(min = 1, max = MAX_MEDIA_PIXELS))]
    pub max_pixels: u64,
    #[schemars(range(min = 1, max = DEFAULT_MAX_SOURCE_BYTES))]
    pub max_source_bytes: u64,
}

impl Default for PerceptionLimits {
    fn default() -> Self {
        Self {
            max_width: DEFAULT_MAX_AXIS,
            max_height: DEFAULT_MAX_AXIS,
            max_pixels: MAX_MEDIA_PIXELS,
            max_source_bytes: DEFAULT_MAX_SOURCE_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneCandidateRequest {
    #[schemars(schema_with = "request_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub provider: PlaneCandidateProviderId,
    #[serde(default = "default_max_candidates")]
    #[schemars(range(min = 1, max = MAX_PLANE_CANDIDATES))]
    pub max_candidates: u8,
    #[serde(default = "default_analysis_axis")]
    #[schemars(range(min = MIN_ANALYSIS_AXIS, max = MAX_ANALYSIS_AXIS))]
    pub analysis_max_axis: u32,
    #[serde(default)]
    pub limits: PerceptionLimits,
}

const fn default_max_candidates() -> u8 {
    MAX_PLANE_CANDIDATES
}

const fn default_analysis_axis() -> u32 {
    512
}

impl PlaneCandidateRequest {
    pub fn validate(&self) -> TransformResult<()> {
        if self.schema != PLANE_CANDIDATE_REQUEST_SCHEMA || self.version != PERCEPTION_VERSION {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "unsupported perception plane request schema or version",
            ));
        }
        if !(1..=MAX_PLANE_CANDIDATES).contains(&self.max_candidates)
            || !(MIN_ANALYSIS_AXIS..=MAX_ANALYSIS_AXIS).contains(&self.analysis_max_axis)
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "perception candidate count or analysis axis exceeds the provider ceiling",
            ));
        }
        let limits = self.limits;
        if limits.max_width == 0
            || limits.max_width > DEFAULT_MAX_AXIS
            || limits.max_height == 0
            || limits.max_height > DEFAULT_MAX_AXIS
            || limits.max_pixels == 0
            || limits.max_pixels > MAX_MEDIA_PIXELS
            || limits.max_source_bytes == 0
            || limits.max_source_bytes > DEFAULT_MAX_SOURCE_BYTES
        {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "perception source limits exceed the provider ceiling",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ProviderFacts {
    pub id: String,
    pub version: String,
    pub kind: ProviderKind,
    pub score_calibration: ScoreCalibration,
    pub deterministic_for_same_decoded_pixels: bool,
    pub automatic_execution: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PerceptionSourceFacts {
    pub format: MediaFormat,
    pub sample_format: MediaSampleFormat,
    pub width: u32,
    pub height: u32,
    pub orientation_applied: bool,
    pub encoded_bytes: u64,
    pub source_sha256: String,
    pub analysis_width: u32,
    pub analysis_height: u32,
    pub analysis_sample_format: MediaSampleFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CandidateSupport {
    #[schemars(schema_with = "fraction_schema")]
    pub threshold: f64,
    #[schemars(schema_with = "fraction_schema")]
    pub component_fraction: f64,
    #[schemars(schema_with = "fraction_schema")]
    pub quadrilateral_fill: f64,
    #[schemars(schema_with = "fraction_schema")]
    pub border_contact_fraction: f64,
    #[schemars(schema_with = "fraction_schema")]
    pub mean_signal: f64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UncertaintyReason {
    pub code: UncertaintyReasonCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UncertaintyAssessment {
    pub level: UncertaintyLevel,
    #[schemars(length(max = 10))]
    pub reasons: Vec<UncertaintyReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CandidateCoordinateSpace {
    Pixel,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CandidateSourcePlane {
    pub space: CandidateCoordinateSpace,
    pub reference: Size,
    pub quad: Quad,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneCandidate {
    pub id: String,
    pub source_plane: CandidateSourcePlane,
    pub normalized_quad: Quad,
    #[schemars(schema_with = "confidence_schema")]
    pub confidence: f64,
    pub support: CandidateSupport,
    pub uncertainty: UncertaintyAssessment,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneCandidateResponse {
    #[schemars(schema_with = "response_schema")]
    pub schema: String,
    #[schemars(schema_with = "version_schema")]
    pub version: String,
    pub provider: ProviderFacts,
    pub source: PerceptionSourceFacts,
    pub outcome: PerceptionOutcome,
    #[schemars(length(max = MAX_PLANE_CANDIDATES))]
    pub candidates: Vec<PlaneCandidate>,
    pub uncertainty: UncertaintyAssessment,
}

trait PlaneCandidateProvider: Send + Sync {
    fn facts(&self) -> ProviderFacts;

    fn analyze(
        &self,
        pixels: &RgbaImage,
        max_candidates: usize,
        is_cancelled: &(dyn Fn() -> bool + Sync),
    ) -> TransformResult<ProviderAssessment>;
}

#[derive(Debug)]
struct ContrastQuadProvider;

#[derive(Debug)]
struct AlphaQuadProvider;

#[derive(Debug)]
struct ProviderAssessment {
    candidates: Vec<RawCandidate>,
    reasons: Vec<UncertaintyReasonCode>,
}

pub fn analyze_plane_candidates_file(
    source: &Path,
    request: &PlaneCandidateRequest,
) -> TransformResult<PlaneCandidateResponse> {
    analyze_plane_candidates_file_with_cancel(source, request, &|| false)
}

pub fn analyze_plane_candidates_file_with_cancel(
    source: &Path,
    request: &PlaneCandidateRequest,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<PlaneCandidateResponse> {
    request.validate()?;
    let limits = RenderLimits {
        max_width: request.limits.max_width,
        max_height: request.limits.max_height,
        max_pixels: request.limits.max_pixels,
        max_source_bytes: request.limits.max_source_bytes,
    };
    let decoded = decode_media_analysis_file_with_cancel(source, limits, is_cancelled)?;
    check_cancelled(is_cancelled)?;
    let pixels = resize_for_analysis(&decoded.pixels, request.analysis_max_axis);
    check_cancelled(is_cancelled)?;
    let provider: Box<dyn PlaneCandidateProvider> = match request.provider {
        PlaneCandidateProviderId::ContrastQuadV1 => Box::new(ContrastQuadProvider),
        PlaneCandidateProviderId::AlphaQuadV1 => Box::new(AlphaQuadProvider),
    };
    let mut assessment =
        provider.analyze(&pixels, usize::from(request.max_candidates), is_cancelled)?;
    assessment.candidates.sort_by(|a, b| {
        b.confidence
            .total_cmp(&a.confidence)
            .then_with(|| b.area.total_cmp(&a.area))
    });
    assessment
        .candidates
        .truncate(usize::from(request.max_candidates));
    if assessment.candidates.len() > 1 {
        push_unique(
            &mut assessment.reasons,
            UncertaintyReasonCode::MultiplePlausibleCandidates,
        );
    }
    let source_width = decoded.source.width;
    let source_height = decoded.source.height;
    let analysis_width = pixels.width();
    let analysis_height = pixels.height();
    let scale_x = f64::from(source_width) / f64::from(analysis_width);
    let scale_y = f64::from(source_height) / f64::from(analysis_height);
    let reference = Size::new(f64::from(source_width), f64::from(source_height));
    let candidates = assessment
        .candidates
        .into_iter()
        .enumerate()
        .map(|(index, candidate)| {
            let source_quad = candidate.quad.map(|point| {
                Point::new(
                    stable_wire_float((point.x * scale_x).clamp(0.0, reference.width)),
                    stable_wire_float((point.y * scale_y).clamp(0.0, reference.height)),
                )
            });
            let normalized_quad = source_quad.map(|point| {
                Point::new(
                    stable_wire_float(point.x / reference.width),
                    stable_wire_float(point.y / reference.height),
                )
            });
            PlaneCandidate {
                id: format!("plane-{:02}", index + 1),
                source_plane: CandidateSourcePlane {
                    space: CandidateCoordinateSpace::Pixel,
                    reference,
                    quad: source_quad,
                },
                normalized_quad,
                confidence: stable_wire_float(candidate.confidence),
                support: candidate.support.stable_wire(),
                uncertainty: uncertainty(candidate.reasons),
            }
        })
        .collect::<Vec<_>>();
    let outcome = if candidates.is_empty() {
        push_unique(
            &mut assessment.reasons,
            UncertaintyReasonCode::NoStableQuadrilateral,
        );
        PerceptionOutcome::NoCandidate
    } else {
        PerceptionOutcome::Candidates
    };
    let source_info = decoded.source;
    Ok(PlaneCandidateResponse {
        schema: PLANE_CANDIDATE_RESPONSE_SCHEMA.to_owned(),
        version: PERCEPTION_VERSION.to_owned(),
        provider: provider.facts(),
        source: PerceptionSourceFacts {
            format: source_info.format,
            sample_format: source_info.sample_format,
            width: source_width,
            height: source_height,
            orientation_applied: source_info.orientation_applied,
            encoded_bytes: source_info.encoded_bytes,
            source_sha256: source_info.source_sha256,
            analysis_width,
            analysis_height,
            analysis_sample_format: MediaSampleFormat::U8,
        },
        outcome,
        candidates,
        uncertainty: uncertainty(assessment.reasons),
    })
}

impl CandidateSupport {
    fn stable_wire(self) -> Self {
        Self {
            threshold: stable_wire_float(self.threshold),
            component_fraction: stable_wire_float(self.component_fraction),
            quadrilateral_fill: stable_wire_float(self.quadrilateral_fill),
            border_contact_fraction: stable_wire_float(self.border_contact_fraction),
            mean_signal: stable_wire_float(self.mean_signal),
        }
    }
}

fn stable_wire_float(value: f64) -> f64 {
    (value * WIRE_DECIMAL_SCALE).round() / WIRE_DECIMAL_SCALE
}

impl PlaneCandidateProvider for ContrastQuadProvider {
    fn facts(&self) -> ProviderFacts {
        provider_facts(PlaneCandidateProviderId::ContrastQuadV1)
    }

    fn analyze(
        &self,
        pixels: &RgbaImage,
        max_candidates: usize,
        is_cancelled: &(dyn Fn() -> bool + Sync),
    ) -> TransformResult<ProviderAssessment> {
        let background = median_border_color(pixels);
        let signal = pixels
            .pixels()
            .map(|pixel| premultiplied_distance(*pixel, background))
            .collect::<Vec<_>>();
        analyze_signal(
            pixels.width(),
            pixels.height(),
            &signal,
            max_candidates,
            is_cancelled,
        )
    }
}

impl PlaneCandidateProvider for AlphaQuadProvider {
    fn facts(&self) -> ProviderFacts {
        provider_facts(PlaneCandidateProviderId::AlphaQuadV1)
    }

    fn analyze(
        &self,
        pixels: &RgbaImage,
        max_candidates: usize,
        is_cancelled: &(dyn Fn() -> bool + Sync),
    ) -> TransformResult<ProviderAssessment> {
        let signal = pixels
            .pixels()
            .map(|pixel| f64::from(pixel.0[3]) / 255.0)
            .collect::<Vec<_>>();
        if signal.iter().all(|alpha| *alpha >= 1.0) {
            return Ok(ProviderAssessment {
                candidates: Vec::new(),
                reasons: vec![UncertaintyReasonCode::OpaqueSourceForAlphaProvider],
            });
        }
        analyze_signal(
            pixels.width(),
            pixels.height(),
            &signal,
            max_candidates,
            is_cancelled,
        )
    }
}

fn provider_facts(id: PlaneCandidateProviderId) -> ProviderFacts {
    ProviderFacts {
        id: id.as_str().to_owned(),
        version: PROVIDER_VERSION.to_owned(),
        kind: ProviderKind::LocalDeterministicHeuristic,
        score_calibration: ScoreCalibration::UncalibratedRankingScore,
        deterministic_for_same_decoded_pixels: true,
        automatic_execution: false,
    }
}

fn resize_for_analysis(source: &RgbaImage, maximum: u32) -> RgbaImage {
    let largest = source.width().max(source.height());
    if largest <= maximum {
        return source.clone();
    }
    let scale = f64::from(maximum) / f64::from(largest);
    let width = (f64::from(source.width()) * scale).round().max(1.0) as u32;
    let height = (f64::from(source.height()) * scale).round().max(1.0) as u32;
    image::imageops::resize(source, width, height, FilterType::Triangle)
}

fn median_border_color(image: &RgbaImage) -> [u8; 4] {
    let mut channels = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    let width = image.width();
    let height = image.height();
    for y in 0..height {
        for x in 0..width {
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                let pixel = image.get_pixel(x, y).0;
                for channel in 0..4 {
                    channels[channel].push(pixel[channel]);
                }
            }
        }
    }
    std::array::from_fn(|channel| {
        channels[channel].sort_unstable();
        channels[channel][channels[channel].len() / 2]
    })
}

fn premultiplied_distance(pixel: image::Rgba<u8>, background: [u8; 4]) -> f64 {
    let alpha = f64::from(pixel.0[3]) / 255.0;
    let background_alpha = f64::from(background[3]) / 255.0;
    let mut sum = (alpha - background_alpha).powi(2);
    for (channel, background_channel) in background.iter().enumerate().take(3) {
        let value = f64::from(pixel.0[channel]) / 255.0 * alpha;
        let base = f64::from(*background_channel) / 255.0 * background_alpha;
        sum += (value - base).powi(2);
    }
    (sum / 4.0).sqrt().clamp(0.0, 1.0)
}

fn analyze_signal(
    width: u32,
    height: u32,
    signal: &[f64],
    max_candidates: usize,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<ProviderAssessment> {
    let mut sorted = signal.to_vec();
    sorted.sort_by(f64::total_cmp);
    let percentile = |fraction: f64| {
        let index = ((sorted.len() - 1) as f64 * fraction).round() as usize;
        sorted[index]
    };
    let p90 = percentile(0.90);
    let p98 = percentile(0.98);
    let thresholds = [
        (p90 * 0.45).max(0.06),
        (p90 * 0.65).max(0.10),
        (p98 * 0.75).max(0.16),
    ];
    let mut candidates = Vec::new();
    for threshold in thresholds {
        check_cancelled(is_cancelled)?;
        for candidate in component_candidates(width, height, signal, threshold, is_cancelled)? {
            if candidates.iter().any(|existing: &RawCandidate| {
                quads_near(existing.quad, candidate.quad, width, height)
            }) {
                continue;
            }
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    candidates.truncate(max_candidates);
    let mut reasons = vec![UncertaintyReasonCode::UncalibratedProviderScore];
    if p98 < 0.16 {
        reasons.push(UncertaintyReasonCode::LowContrast);
    }
    if candidates.len() > 1 {
        reasons.push(UncertaintyReasonCode::ThresholdSensitive);
    }
    Ok(ProviderAssessment {
        candidates,
        reasons,
    })
}

fn component_candidates(
    width: u32,
    height: u32,
    signal: &[f64],
    threshold: f64,
    is_cancelled: &(dyn Fn() -> bool + Sync),
) -> TransformResult<Vec<RawCandidate>> {
    let len = usize::try_from(u64::from(width) * u64::from(height))
        .map_err(|_| TransformError::new(ErrorCode::OutputLimit, "analysis raster is too large"))?;
    let mut visited = vec![false; len];
    let minimum = (len / 1000).max(16);
    let mut candidates = Vec::new();
    for index in 0..len {
        if index % 4096 == 0 {
            check_cancelled(is_cancelled)?;
        }
        if visited[index] || signal[index] < threshold {
            continue;
        }
        let mut queue = VecDeque::from([index]);
        visited[index] = true;
        let mut points = Vec::new();
        let mut sum_signal = 0.0;
        let mut border_count = 0_usize;
        while let Some(current) = queue.pop_front() {
            if points.len() % 4096 == 0 {
                check_cancelled(is_cancelled)?;
            }
            let x = current as u32 % width;
            let y = current as u32 / width;
            points.push((x, y));
            sum_signal += signal[current];
            if x == 0 || y == 0 || x + 1 == width || y + 1 == height {
                border_count += 1;
            }
            for (nx, ny) in neighbors(x, y, width, height) {
                let neighbor = (ny * width + nx) as usize;
                if !visited[neighbor] && signal[neighbor] >= threshold {
                    visited[neighbor] = true;
                    queue.push_back(neighbor);
                }
            }
        }
        if points.len() < minimum {
            continue;
        }
        if let Some(candidate) =
            candidate_from_component(&points, width, height, threshold, sum_signal, border_count)
        {
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|a, b| b.confidence.total_cmp(&a.confidence));
    candidates.truncate(MAX_PLANE_CANDIDATES as usize);
    Ok(candidates)
}

fn neighbors(x: u32, y: u32, width: u32, height: u32) -> impl Iterator<Item = (u32, u32)> {
    let values = [
        x.checked_sub(1).map(|nx| (nx, y)),
        (x + 1 < width).then_some((x + 1, y)),
        y.checked_sub(1).map(|ny| (x, ny)),
        (y + 1 < height).then_some((x, y + 1)),
    ];
    values.into_iter().flatten()
}

fn candidate_from_component(
    points: &[(u32, u32)],
    width: u32,
    height: u32,
    threshold: f64,
    sum_signal: f64,
    border_count: usize,
) -> Option<RawCandidate> {
    let point = |(x, y): (u32, u32)| Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5);
    let tl = points
        .iter()
        .copied()
        .min_by(|a, b| (a.0 + a.1).cmp(&(b.0 + b.1)).then_with(|| a.cmp(b)))?;
    let br = points
        .iter()
        .copied()
        .max_by(|a, b| (a.0 + a.1).cmp(&(b.0 + b.1)).then_with(|| a.cmp(b)))?;
    let tr = points.iter().copied().max_by(|a, b| {
        (i64::from(a.0) - i64::from(a.1))
            .cmp(&(i64::from(b.0) - i64::from(b.1)))
            .then_with(|| a.cmp(b))
    })?;
    let bl = points.iter().copied().min_by(|a, b| {
        (i64::from(a.0) - i64::from(a.1))
            .cmp(&(i64::from(b.0) - i64::from(b.1)))
            .then_with(|| a.cmp(b))
    })?;
    let quad = Quad::new(point(tl), point(tr), point(br), point(bl));
    validate_quad(&quad).ok()?;
    let area = polygon_signed_area(&quad.points()).abs();
    let image_area = f64::from(width) * f64::from(height);
    let component_fraction = points.len() as f64 / image_area;
    let fill = (points.len() as f64 / area.max(1.0)).clamp(0.0, 1.0);
    let border_contact = border_count as f64 / points.len() as f64;
    let mean_signal = (sum_signal / points.len() as f64).clamp(0.0, 1.0);
    let coverage_quality = (1.0 - ((component_fraction - 0.35).abs() / 0.55)).clamp(0.0, 1.0);
    let confidence = (mean_signal * 0.45 + fill * 0.35 + coverage_quality * 0.20)
        * (1.0 - border_contact.min(0.5));
    let mut reasons = vec![UncertaintyReasonCode::UncalibratedProviderScore];
    if mean_signal < 0.20 {
        reasons.push(UncertaintyReasonCode::LowContrast);
    }
    if component_fraction < 0.01 {
        reasons.push(UncertaintyReasonCode::SmallSupport);
    }
    if component_fraction > 0.90 {
        reasons.push(UncertaintyReasonCode::DominantSupport);
    }
    if border_contact > 0.02 {
        reasons.push(UncertaintyReasonCode::BorderContact);
    }
    if fill < 0.55 {
        reasons.push(UncertaintyReasonCode::NonQuadrilateralSupport);
    }
    Some(RawCandidate {
        quad,
        confidence: confidence.clamp(0.0, 1.0),
        area,
        support: CandidateSupport {
            threshold: threshold.clamp(0.0, 1.0),
            component_fraction: component_fraction.clamp(0.0, 1.0),
            quadrilateral_fill: fill,
            border_contact_fraction: border_contact.clamp(0.0, 1.0),
            mean_signal,
        },
        reasons,
    })
}

#[derive(Debug)]
struct RawCandidate {
    quad: Quad,
    confidence: f64,
    area: f64,
    support: CandidateSupport,
    reasons: Vec<UncertaintyReasonCode>,
}

fn quads_near(a: Quad, b: Quad, width: u32, height: u32) -> bool {
    let diagonal = f64::from(width).hypot(f64::from(height)).max(1.0);
    let mean = a
        .points()
        .into_iter()
        .zip(b.points())
        .map(|(left, right)| (left.x - right.x).hypot(left.y - right.y))
        .sum::<f64>()
        / 4.0;
    mean / diagonal <= 0.015
}

fn uncertainty(reasons: Vec<UncertaintyReasonCode>) -> UncertaintyAssessment {
    let high = reasons.iter().any(|reason| {
        !matches!(
            reason,
            UncertaintyReasonCode::UncalibratedProviderScore
                | UncertaintyReasonCode::MultiplePlausibleCandidates
        )
    });
    UncertaintyAssessment {
        level: if high {
            UncertaintyLevel::High
        } else {
            UncertaintyLevel::Medium
        },
        reasons: reasons
            .into_iter()
            .map(|code| UncertaintyReason { code })
            .collect(),
    }
}

fn push_unique(values: &mut Vec<UncertaintyReasonCode>, value: UncertaintyReasonCode) {
    if !values.contains(&value) {
        values.push(value);
    }
}

fn check_cancelled(is_cancelled: &(dyn Fn() -> bool + Sync)) -> TransformResult<()> {
    if is_cancelled() {
        return Err(TransformError::new(
            ErrorCode::Cancelled,
            "perception analysis was cancelled",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba};
    use sha2::{Digest, Sha256};
    use std::fs;

    fn request(provider: PlaneCandidateProviderId) -> PlaneCandidateRequest {
        PlaneCandidateRequest {
            schema: PLANE_CANDIDATE_REQUEST_SCHEMA.to_owned(),
            version: PERCEPTION_VERSION.to_owned(),
            provider,
            max_candidates: 3,
            analysis_max_axis: 512,
            limits: PerceptionLimits::default(),
        }
    }

    #[test]
    fn contrast_provider_returns_explicit_valid_candidate_and_source_facts() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.png");
        let mut image = ImageBuffer::from_pixel(200, 160, Rgba([245_u8, 245, 245, 255]));
        let quad = Quad::new(
            Point::new(38.0, 28.0),
            Point::new(168.0, 38.0),
            Point::new(154.0, 132.0),
            Point::new(48.0, 124.0),
        );
        for y in 0..160 {
            for x in 0..200 {
                if point_in_quad(Point::new(f64::from(x) + 0.5, f64::from(y) + 0.5), quad) {
                    image.put_pixel(x, y, Rgba([30, 80, 210, 255]));
                }
            }
        }
        image.save(&source).unwrap();
        let response = analyze_plane_candidates_file(
            &source,
            &request(PlaneCandidateProviderId::ContrastQuadV1),
        )
        .unwrap();
        assert_eq!(response.outcome, PerceptionOutcome::Candidates);
        assert!(!response.candidates.is_empty());
        validate_quad(&response.candidates[0].source_plane.quad).unwrap();
        let found = response.candidates[0].source_plane.quad;
        assert!((found.tl.x - 38.5).abs() <= 1.0);
        assert!((found.tl.y - 28.5).abs() <= 1.0);
        assert!((found.br.x - 153.5).abs() <= 1.0);
        assert!((found.br.y - 131.5).abs() <= 1.0);
        assert_eq!(response.source.width, 200);
        assert_eq!(response.source.height, 160);
        assert_eq!(
            response.source.source_sha256,
            hex::encode(Sha256::digest(fs::read(&source).unwrap()))
        );
        assert!(!response.provider.automatic_execution);
        assert_eq!(
            response.provider.score_calibration,
            ScoreCalibration::UncalibratedRankingScore
        );
    }

    #[test]
    fn alpha_provider_reports_no_candidate_for_opaque_source() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("opaque.png");
        ImageBuffer::from_pixel(80, 80, Rgba([40_u8, 50, 60, 255]))
            .save(&source)
            .unwrap();
        let response =
            analyze_plane_candidates_file(&source, &request(PlaneCandidateProviderId::AlphaQuadV1))
                .unwrap();
        assert_eq!(response.outcome, PerceptionOutcome::NoCandidate);
        assert!(response.candidates.is_empty());
        assert!(
            response.uncertainty.reasons.iter().any(|reason| {
                reason.code == UncertaintyReasonCode::OpaqueSourceForAlphaProvider
            })
        );
    }

    #[test]
    fn contrast_provider_returns_no_candidate_for_a_uniform_image() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("uniform.png");
        ImageBuffer::from_pixel(80, 80, Rgba([40_u8, 50, 60, 255]))
            .save(&source)
            .unwrap();
        let response = analyze_plane_candidates_file(
            &source,
            &request(PlaneCandidateProviderId::ContrastQuadV1),
        )
        .unwrap();
        assert_eq!(response.outcome, PerceptionOutcome::NoCandidate);
        assert!(response.candidates.is_empty());
        assert!(
            response
                .uncertainty
                .reasons
                .iter()
                .any(|reason| { reason.code == UncertaintyReasonCode::NoStableQuadrilateral })
        );
    }

    #[test]
    fn alpha_provider_finds_a_transparent_supported_quad_and_observes_cancellation() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("alpha.png");
        let mut image = ImageBuffer::from_pixel(96, 72, Rgba([0_u8, 0, 0, 0]));
        for y in 16..58 {
            for x in 18..80 {
                image.put_pixel(x, y, Rgba([200, 40, 90, 255]));
            }
        }
        image.save(&source).unwrap();
        let response =
            analyze_plane_candidates_file(&source, &request(PlaneCandidateProviderId::AlphaQuadV1))
                .unwrap();
        assert_eq!(response.outcome, PerceptionOutcome::Candidates);
        assert_eq!(
            response.candidates[0].uncertainty.level,
            UncertaintyLevel::Medium
        );
        let error = analyze_plane_candidates_file_with_cancel(
            &source,
            &request(PlaneCandidateProviderId::AlphaQuadV1),
            &|| true,
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Cancelled);
    }

    #[test]
    fn request_header_and_bounds_are_closed() {
        let mut invalid = request(PlaneCandidateProviderId::ContrastQuadV1);
        invalid.schema = "other".to_owned();
        assert_eq!(invalid.validate().unwrap_err().code, ErrorCode::Schema);
        invalid = request(PlaneCandidateProviderId::ContrastQuadV1);
        invalid.max_candidates = 4;
        assert_eq!(invalid.validate().unwrap_err().code, ErrorCode::OutputLimit);
        let schema = serde_json::to_value(schemars::schema_for!(PlaneCandidateRequest)).unwrap();
        assert_eq!(
            schema["properties"]["schema"]["const"],
            PLANE_CANDIDATE_REQUEST_SCHEMA
        );
        assert_eq!(schema["properties"]["version"]["const"], PERCEPTION_VERSION);
    }

    fn point_in_quad(point: Point, quad: Quad) -> bool {
        let points = quad.points();
        (0..4).all(|index| {
            let a = points[index];
            let b = points[(index + 1) % 4];
            (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) >= 0.0
        })
    }
}

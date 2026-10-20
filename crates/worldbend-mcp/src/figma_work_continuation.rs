//! Project published Figma controls into the existing document and execution
//! contracts. Inspection and source acquisition stay in the authorized host;
//! this adapter does not reinterpret geometry or publish a canvas revision.
use crate::{
    figma_handoff::{self, FigmaCompositionTask, FigmaMockupSource, FigmaPlacement, FigmaRequest},
    figma_linked::{
        self, DeformationTask, LinkedOperation, LinkedTask, RasterTransport, RemapTask,
    },
};
use schemars::{JsonSchema, Schema, SchemaGenerator, json_schema};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use worldbend_core::*;
use worldbend_render::SamplingQuality;

mod material;
mod native;
mod revision;
pub use material::{
    MaterialContinuation, MaterialDocumentRevision, MaterialDocumentRevisionInput,
    MaterialProjectionInput,
};
pub use native::{
    NativeCarrier, NativeContinuation, NativeDocumentRevision, NativeDocumentRevisionInput,
    NativeSnapshot,
};
pub use revision::{DocumentRevision, DocumentRevisionInput};

const RUNTIME: &str = include_str!("figma-runtime-work-revise-read.js");
const SNAPSHOT_SCHEMA: &str = "worldbend.figma.work-continuation-snapshot";
const CONTINUATION_SCHEMA: &str = "worldbend.figma.work-continuation";
const DIRECT_BYTES: usize = 128 * 1024;
const PART_BYTES: usize = 32 * 1024;
const MAX_CONTINUATION_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum DraftStatus {
    Absent,
    Pending,
    Unusable,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublishedSnapshot {
    #[schemars(schema_with = "snapshot_schema")]
    schema: String,
    #[schemars(schema_with = "version_schema")]
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    #[schemars(range(min = 1, max = 9007199254740990_u64))]
    revision: u64,
    target_expected: String,
    source_graph_expected: String,
    operation: LinkedOperation,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(min = 1, max = 8))]
    sources: Vec<FigmaMockupSource>,
    #[schemars(range(min = 1, max = 4096))]
    render_width: u32,
    #[schemars(range(min = 1, max = 4096))]
    render_height: u32,
    placement: FigmaPlacement,
    draft_status: DraftStatus,
}

fn default_expression() -> String {
    "figma-work".into()
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
#[schemars(extend("type"="object"))]
pub enum Input {
    #[serde(rename = "projectMaterial")]
    ProjectMaterial {
        input: Box<MaterialProjectionInput>,
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: Option<u16>,
        #[serde(default)]
        token: Option<String>,
    },
    #[serde(rename = "reviseMaterial")]
    ReviseMaterial {
        input: Box<MaterialDocumentRevisionInput>,
    },
    #[serde(rename = "reviseNative")]
    ReviseNative {
        input: Box<NativeDocumentRevisionInput>,
    },
    #[serde(rename = "inspectNative")]
    InspectNative {
        carrier: NativeCarrier,
        #[serde(rename = "fileKey")]
        file_key: String,
        #[serde(rename = "pageId")]
        page_id: String,
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: u16,
        #[serde(default)]
        token: Option<String>,
    },
    #[serde(rename = "nativeSource")]
    NativeSource {
        snapshot: Box<NativeSnapshot>,
        #[serde(default)]
        #[schemars(range(min = 0, max = 1023))]
        part: u16,
        #[serde(default)]
        token: Option<String>,
    },
    #[serde(rename = "projectNative")]
    ProjectNative {
        snapshot: Box<NativeSnapshot>,
        #[serde(default = "default_expression", rename = "expressionId")]
        expression_id: String,
        #[serde(default)]
        output: Option<SpatialTemplateOutput>,
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: Option<u16>,
        #[serde(default)]
        token: Option<String>,
    },
    Inspect {
        #[serde(rename = "fileKey")]
        file_key: String,
        #[serde(rename = "pageId")]
        page_id: String,
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: u16,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
        #[serde(default, rename = "includeSourceRasters")]
        include_source_rasters: bool,
        #[serde(default, rename = "sourceRasterTransport")]
        source_raster_transport: RasterTransport,
    },
    Project {
        snapshot: Box<PublishedSnapshot>,
        #[serde(default = "default_expression", rename = "expressionId")]
        expression_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<SpatialTemplateOutput>,
        /// Large projections return exact JSON parts. Repeat the same input
        /// with the returned whole-value token to obtain later parts.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(range(min = 0, max = 255))]
        part: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
    /// Project published Mockup composition into a temporal Spatial Document
    /// bound to an authored mockup-video Spec (N5 write target).
    #[serde(rename = "projectTemporal")]
    ProjectTemporal {
        snapshot: Box<PublishedSnapshot>,
        video: Box<MockupVideoSpec>,
        #[serde(default = "default_expression", rename = "expressionId")]
        expression_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schemars(range(min = 0, max = 255))]
        part: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
    /// Prepare an authoring revision from a fingerprint-guarded document.
    /// The returned request reads current Figma media; ordinary work publication
    /// subsequently checks the captured target and sources before writing.
    Revise { input: Box<DocumentRevisionInput> },
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
// Built once per response; continuation payloads stay inline in the wire shape.
#[allow(clippy::large_enum_variant)]
pub enum Output {
    Material(MaterialContinuation),
    MaterialRevision(MaterialDocumentRevision),
    NativeRevision(NativeDocumentRevision),
    Request(FigmaRequest),
    Continuation(Continuation),
    Page(ContinuationPage),
    Revision(DocumentRevision),
    Native(NativeContinuation),
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ContinuationPage {
    #[schemars(schema_with = "page_schema")]
    schema: String,
    #[schemars(schema_with = "version_schema")]
    version: String,
    token: String,
    part: u16,
    part_count: u16,
    bytes: usize,
    byte_start: usize,
    byte_end: usize,
    json: String,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Origin {
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    target_expected: String,
    source_graph_expected: String,
    render_width: u32,
    render_height: u32,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum SourceRole {
    Content,
    DisplacementMap,
    FittingGuide,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SourceBinding {
    slot_id: String,
    asset_id: String,
    role: SourceRole,
    source: FigmaMockupSource,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Loss {
    SourceMediaNotEmbedded,
    FigmaPlacementNotTransferred,
    PreviewFingerprintNotContentDigest,
    PublishedPixelsNotCarried,
    NativeResultAppearanceNotTransferred,
    StagedDraftExcluded,
    StagedDraftUnavailable,
    FittingGuideRetainedAsBakedGeometry,
    GuideGeometryChangesRequireRecapture,
    /// Key poses return through Mockup authoring; timed motion stays document-side.
    MotionProgramNotHostedInFigma,
    /// Encoded MP4 is mockup-video delivery, not a Figma host publish.
    EncodedVideoNotProducedByFigma,
    AnimatedCompositionProjectsItsPoster,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Continuation {
    #[schemars(schema_with = "continuation_schema")]
    schema: String,
    #[schemars(schema_with = "version_schema")]
    version: String,
    origin: Origin,
    expression_id: String,
    #[schemars(length(min = 1, max = 8))]
    source_bindings: Vec<SourceBinding>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 1))]
    authoring_dependencies: Vec<FigmaMockupSource>,
    /// Formal document dependencies, kept separate from raster media slots.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[schemars(length(max = 1))]
    guide_bindings: Vec<SourceBinding>,
    document: SpatialDocumentSpec,
    delivery_plan: SpatialDocumentDeliveryPlan,
    #[serde(skip_serializing_if = "Option::is_none")]
    initial_state: Option<EffectState>,
    render_quality: SamplingQuality,
    #[serde(skip_serializing_if = "Option::is_none")]
    authoring_motion: Option<figma_handoff::FigmaCompositionMotion>,
    losses: Vec<Loss>,
}

fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn bounded_token(value: &str) -> TransformResult<()> {
    figma_linked::fingerprint(value)?;
    let parts = value.split(':').collect::<Vec<_>>();
    if parts.len() != 3
        || parts[1].parse::<u32>().ok().is_none_or(|n| n == 0)
        || parts[2].len() != 16
        || !parts[2]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(error("Use the complete current hash32x2 state token"));
    }
    Ok(())
}
fn validate(saved: &PublishedSnapshot) -> TransformResult<()> {
    for id in [&saved.file_key, &saved.page_id, &saved.node_id] {
        figma_handoff::identity(id)?;
    }
    bounded_token(&saved.target_expected)?;
    bounded_token(&saved.source_graph_expected)?;
    if saved.schema != SNAPSHOT_SCHEMA
        || saved.version != "0.1"
        || saved.revision == 0
        || saved.revision >= 9_007_199_254_740_991
        || !(1..=8).contains(&saved.sources.len())
        || saved.sources.len() != saved.source_node_ids.len()
        || saved.source_node_ids.iter().collect::<HashSet<_>>().len() != saved.source_node_ids.len()
        || !(1..=4096).contains(&saved.render_width)
        || !(1..=4096).contains(&saved.render_height)
        || [
            saved.placement.x,
            saved.placement.y,
            saved.placement.width,
            saved.placement.height,
        ]
        .iter()
        .any(|v| !v.is_finite())
        || saved.placement.width <= 0.0
        || saved.placement.height <= 0.0
    {
        return Err(error(
            "Use the complete current published-work continuation snapshot",
        ));
    }
    for (index, source) in saved.sources.iter().enumerate() {
        figma_handoff::identity(&source.node_id)?;
        if source.node_id != saved.source_node_ids[index]
            || source.node_id == saved.node_id
            || source.slot_id != format!("source-{}", index + 1)
            || source.name.chars().count() > 128
            || !source.width.is_finite()
            || !source.height.is_finite()
            || source.width <= 0.0
            || source.height <= 0.0
            || !figma_handoff::valid_preview_fingerprint(&source.preview_fingerprint)
        {
            return Err(error(
                "Source facts must retain the inspected ordered slot and node identity",
            ));
        }
    }
    figma_linked::validate_work_operation(
        &saved.operation,
        saved.sources.len(),
        saved.render_width,
        saved.render_height,
    )
}

impl Output {
    pub(crate) fn prepare_publication(
        mut self,
        cache: &crate::figma_publication::PublicationCache,
    ) -> TransformResult<Self> {
        if let Self::NativeRevision(value) = &mut self
            && let crate::figma_publication::PublicationOutput::Inline(request) = &value.request
        {
            value.request = cache.prepare(request.clone())?;
        }
        Ok(self)
    }
}

pub fn prepare(input: Input) -> TransformResult<Output> {
    match input {
        Input::ProjectMaterial { input, part, token } => {
            let value = material::project(*input)?;
            Ok(match project_page(&value, part, token)? {
                Some(page) => Output::Page(page),
                None => Output::Material(value),
            })
        }
        Input::ReviseMaterial { input } => material::revise(*input).map(Output::MaterialRevision),
        Input::ReviseNative { input } => native::revise(*input).map(Output::NativeRevision),
        Input::InspectNative {
            carrier,
            file_key,
            page_id,
            node_id,
            part,
            token,
        } => native::inspect(carrier, file_key, page_id, node_id, part, token).map(Output::Request),
        Input::NativeSource {
            snapshot,
            part,
            token,
        } => native::source(*snapshot, part, token).map(Output::Request),
        Input::ProjectNative {
            snapshot,
            expression_id,
            output,
            part,
            token,
        } => {
            let value = native::project(*snapshot, expression_id, output)?;
            Ok(match project_page(&value, part, token)? {
                Some(page) => Output::Page(page),
                None => Output::Native(value),
            })
        }
        Input::Inspect {
            file_key,
            page_id,
            node_id,
            part,
            token,
            include_source_rasters,
            source_raster_transport,
        } => {
            for id in [&file_key, &page_id, &node_id] {
                figma_handoff::identity(id)?;
            }
            if part > 255 || (part > 0 && token.is_none()) {
                return Err(error(
                    "Use the token from the same complete continuation read",
                ));
            }
            if let Some(v) = &token {
                bounded_token(v)?;
            }
            let args = json!({"fileKey":file_key,"pageId":page_id,"nodeId":node_id,"part":part,"includeSourceRasters":include_source_rasters,"sourceRasterTransport":source_raster_transport});
            let mut args = args;
            if let Some(token) = token {
                args["token"] = json!(token);
            }
            let file = json!(file_key);
            let page = json!(page_id);
            Ok(Output::Request(figma_handoff::bounded_request(
                FigmaRequest {
                    file_key,
                    skill_names: "figma-use",
                    description: "Read published raster work and current bound media in exact tokened parts; no proposal or canvas revision",
                    publication: None,
                    code: format!(
                        "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const page=await figma.getNodeByIdAsync({page});if(!page||page.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(page);\n{RUNTIME}\nreturn await WorldbendFigmaHandoff.readWorkContinuation({args});"
                    ),
                },
            )?))
        }
        Input::Project {
            snapshot,
            expression_id,
            output,
            part,
            token,
        } => project(*snapshot, expression_id, output)
            .and_then(|value| project_response(value, part, token)),
        Input::ProjectTemporal {
            snapshot,
            video,
            expression_id,
            part,
            token,
        } => project_temporal(*snapshot, *video, expression_id)
            .and_then(|value| project_response(value, part, token)),
        Input::Revise { input } => revision::prepare(*input).map(Output::Revision),
    }
}

fn project_response(
    value: Continuation,
    part: Option<u16>,
    expected: Option<String>,
) -> TransformResult<Output> {
    Ok(match project_page(&value, part, expected)? {
        Some(page) => Output::Page(page),
        None => Output::Continuation(value),
    })
}

fn project_page<T: Serialize>(
    value: &T,
    part: Option<u16>,
    expected: Option<String>,
) -> TransformResult<Option<ContinuationPage>> {
    let json = serde_json::to_string(value)
        .map_err(|_| TransformError::new(ErrorCode::Internal, "Cannot serialize continuation"))?;
    if json.len() > MAX_CONTINUATION_BYTES {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "Continuation exceeds the bounded complete-read capacity",
        ));
    }
    let token = format!("sha256:{}", hex::encode(Sha256::digest(json.as_bytes())));
    if expected.as_ref().is_some_and(|v| v != &token) {
        return Err(error(
            "Projection changed between parts; restart the complete read",
        ));
    }
    if part.is_none() && expected.is_none() && json.len() <= DIRECT_BYTES {
        return Ok(None);
    }
    let mut ranges = Vec::new();
    let mut start = 0;
    while start < json.len() {
        let mut end = (start + PART_BYTES).min(json.len());
        while !json.is_char_boundary(end) {
            end -= 1;
        }
        ranges.push(start..end);
        start = end;
    }
    let part = part.unwrap_or(0);
    if part > 255 || (part > 0 && expected.is_none()) {
        return Err(error(
            "Use a valid projection part and its whole-value token",
        ));
    }
    let range = ranges
        .get(usize::from(part))
        .ok_or_else(|| error("Projection part is outside this complete value"))?;
    Ok(Some(ContinuationPage {
        schema: "worldbend.figma.work-continuation-page".into(),
        version: "0.1".into(),
        token,
        part,
        part_count: ranges.len() as u16,
        bytes: json.len(),
        byte_start: range.start,
        byte_end: range.end,
        json: json[range.clone()].to_owned(),
    }))
}

fn project_temporal(
    saved: PublishedSnapshot,
    mut video: MockupVideoSpec,
    expression_id: String,
) -> TransformResult<Continuation> {
    validate(&saved)?;
    let published = match &saved.operation {
        LinkedOperation::Task {
            task: LinkedTask::Composition(FigmaCompositionTask::Mockup { spec }),
        } => spec,
        LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    template,
                    preview_output_id,
                    ..
                }),
        } => {
            let SpatialTemplateOperation::CompositionProgram { composition, .. } =
                &template.operation
            else {
                unreachable!()
            };
            let presentation =
                figma_handoff::composition_presentation(template, preview_output_id)?;
            if video.mockup_motion.presentation.is_some() {
                let motion_plan = worldbend_core::plan_mockup_motion(&video.mockup_motion)?;
                let frame = if let LinkedOperation::Task {
                    task:
                        LinkedTask::Composition(FigmaCompositionTask::Composition {
                            motion: Some(motion),
                            ..
                        }),
                } = &saved.operation
                {
                    ((u64::from(motion.frame) * u64::from(video.mockup_motion.frame_count - 1)
                        + u64::from(motion.spec.frame_count.saturating_sub(1).max(1)) / 2)
                        / u64::from(motion.spec.frame_count.saturating_sub(1).max(1)))
                        as usize
                } else {
                    0
                };
                let mut sampled = motion_plan
                    .presentation_at(frame)
                    .expect("validated presentation")
                    .spec
                    .clone();
                sampled.keyframes.clear();
                if sampled != presentation {
                    return Err(error(
                        "Temporal presentation differs from the published Composition pose",
                    ));
                }
            } else {
                video.mockup_motion.presentation = Some(Box::new(presentation));
            }
            composition
        }
        _ => {
            return Err(error(
                "Temporal projection requires published Mockup or Composition work",
            ));
        }
    };
    let plan = plan_mockup_video(&video)?;
    let output = plan.mockup_motion.output_size();
    if output.width != saved.render_width || output.height != saved.render_height {
        return Err(error(
            "Mockup-video canvas must match the published Mockup raster size",
        ));
    }
    if published.canvas != plan.mockup_motion.canvas {
        return Err(error(
            "Published Mockup canvas must match the temporal mockup-motion canvas",
        ));
    }
    let published_sources: HashSet<_> = published
        .planes
        .iter()
        .map(|plane| plane.source_id.as_str())
        .collect();
    for source_id in &plan.mockup_motion.source_ids {
        if !published_sources.contains(source_id.as_str()) {
            return Err(error(
                "Every temporal plane sourceId must exist on the published Mockup",
            ));
        }
    }
    let slot_index: HashMap<&str, usize> = saved
        .sources
        .iter()
        .enumerate()
        .map(|(index, source)| (source.slot_id.as_str(), index))
        .collect();
    if slot_index.len() != saved.sources.len() {
        return Err(error("Published source slots must be unique"));
    }
    let mut source_bindings = Vec::new();
    for source_id in &plan.mockup_motion.source_ids {
        let index = *slot_index.get(source_id.as_str()).ok_or_else(|| {
            error("Temporal plane sourceId must match an inspected Mockup source slot")
        })?;
        let source = saved.sources[index].clone();
        source_bindings.push(SourceBinding {
            slot_id: source_id.clone(),
            asset_id: source.slot_id.clone(),
            role: SourceRole::Content,
            source,
        });
    }
    if source_bindings.len() != saved.sources.len() {
        return Err(error(
            "Bind every published Mockup source slot required by the temporal planes",
        ));
    }
    let assets = source_bindings
        .iter()
        .map(|binding| SpatialDocumentAsset {
            id: binding.asset_id.clone(),
            content_version: Some(format!(
                "figma-preview:{}",
                binding.source.preview_fingerprint
            )),
        })
        .collect();
    let bindings = source_bindings
        .iter()
        .map(|binding| SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::Content,
            slot_id: binding.slot_id.clone(),
            asset_id: binding.asset_id.clone(),
        })
        .collect();
    let hosted = match &saved.operation {
        LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    motion: Some(motion),
                    template,
                    preview_output_id,
                }),
        } => {
            let mut spec = motion.spec.clone();
            if spec.presentation.is_none() {
                spec.presentation = Some(Box::new(figma_handoff::composition_presentation(
                    template,
                    preview_output_id,
                )?));
            }
            spec == video.mockup_motion
        }
        _ => false,
    };
    let ready = prepare_spatial_temporal_delivery(&SpatialTemporalDeliveryInput {
        expression_id: expression_id.clone(),
        video,
        assets,
        bindings,
    })?;
    let quality = figma_linked::work_render_quality(&saved.operation);
    let mut losses = vec![
        Loss::SourceMediaNotEmbedded,
        Loss::FigmaPlacementNotTransferred,
        Loss::PreviewFingerprintNotContentDigest,
        Loss::PublishedPixelsNotCarried,
        Loss::NativeResultAppearanceNotTransferred,
        Loss::EncodedVideoNotProducedByFigma,
    ];
    if !hosted {
        losses.push(Loss::MotionProgramNotHostedInFigma);
    }
    match saved.draft_status {
        DraftStatus::Pending => losses.push(Loss::StagedDraftExcluded),
        DraftStatus::Unusable => losses.push(Loss::StagedDraftUnavailable),
        DraftStatus::Absent => {}
    }
    Ok(Continuation {
        schema: CONTINUATION_SCHEMA.into(),
        version: "0.1".into(),
        origin: Origin {
            file_key: saved.file_key,
            page_id: saved.page_id,
            node_id: saved.node_id,
            revision: saved.revision,
            target_expected: saved.target_expected,
            source_graph_expected: saved.source_graph_expected,
            render_width: saved.render_width,
            render_height: saved.render_height,
        },
        expression_id,
        source_bindings,
        authoring_dependencies: Vec::new(),
        guide_bindings: Vec::new(),
        document: ready.document,
        delivery_plan: ready.delivery_plan,
        initial_state: None,
        render_quality: quality,
        authoring_motion: None,
        losses,
    })
}

fn project(
    saved: PublishedSnapshot,
    expression_id: String,
    output: Option<SpatialTemplateOutput>,
) -> TransformResult<Continuation> {
    validate(&saved)?;
    let mut source_bindings = Vec::new();
    let mut dependencies = Vec::new();
    macro_rules! bind {
        ($index:expr, $slot:expr, $role:expr $(,)?) => {{
            let source = saved.sources[$index].clone();
            source_bindings.push(SourceBinding {
                slot_id: $slot,
                asset_id: source.slot_id.clone(),
                role: $role,
                source,
            });
        }};
    }
    let mut stage = None;
    let mut template = None;
    let mut effect = None;
    let quality = figma_linked::work_render_quality(&saved.operation);
    match &saved.operation {
        LinkedOperation::Transform { spec } => {
            stage = Some(RasterProgramStage::Transform {
                id: "output".into(),
                spec: spec.clone(),
                canvas: RasterProgramCanvasMode::Reference,
                target_size: Some(Size::new(
                    f64::from(saved.render_width),
                    f64::from(saved.render_height),
                )),
            })
        }
        LinkedOperation::Rectify { spec } => {
            stage = Some(RasterProgramStage::Rectify {
                id: "output".into(),
                spec: spec.clone(),
            })
        }
        LinkedOperation::Canvas { spec } => {
            stage = Some(RasterProgramStage::Canvas {
                id: "output".into(),
                spec: spec.clone(),
            });
        }
        LinkedOperation::Task {
            task: LinkedTask::Remap(RemapTask::Remap { spec }),
        } => {
            let map_slot = plan_remap(spec)?
                .requires_map
                .then(|| "source-2".to_owned());
            stage = Some(RasterProgramStage::Remap {
                id: "output".into(),
                spec: spec.clone(),
                map_slot,
            });
            bind!(0, "source-1".into(), SourceRole::Content);
            if saved.sources.len() == 2 {
                bind!(1, "source-2".into(), SourceRole::DisplacementMap);
            }
        }
        LinkedOperation::Task {
            task: LinkedTask::Deformation(task),
        } => match task.as_ref() {
            DeformationTask::Mesh { spec } => {
                stage = Some(RasterProgramStage::MeshWarp {
                    id: "output".into(),
                    spec: spec.clone(),
                })
            }
            DeformationTask::Surface { spec } => {
                stage = Some(RasterProgramStage::SurfaceDeformation {
                    id: "output".into(),
                    spec: spec.clone(),
                })
            }
            DeformationTask::Deformation {
                spec,
                shape_guide_source_index,
                ..
            } => {
                stage = Some(RasterProgramStage::DeformationWork {
                    id: "output".into(),
                    spec: spec.as_ref().clone(),
                });
                if let Some(guide) = shape_guide_source_index {
                    let artwork = 1 - usize::from(*guide);
                    bind!(
                        artwork,
                        saved.sources[artwork].slot_id.clone(),
                        SourceRole::Content,
                    );
                    dependencies.push(saved.sources[usize::from(*guide)].clone());
                }
            }
        },
        LinkedOperation::Task {
            task: LinkedTask::Composition(task),
        } => {
            template = Some(match task {
                FigmaCompositionTask::Mockup { spec } => SpatialTemplateSpec {
                    schema: SPATIAL_TEMPLATE_SCHEMA.into(),
                    version: SPATIAL_TEMPLATE_VERSION.into(),
                    operation: SpatialTemplateOperation::Mockup { spec: spec.clone() },
                    output: SpatialTemplateOutput::Single {
                        id: "output".into(),
                    },
                },
                FigmaCompositionTask::Composition { template, .. } => template.as_ref().clone(),
            });
            for (i, source) in saved.sources.iter().enumerate() {
                bind!(i, source.slot_id.clone(), SourceRole::Content);
            }
        }
        LinkedOperation::Task {
            task: LinkedTask::Effect(task),
        } => {
            if output.is_some() {
                return Err(error(
                    "Interactive work retains its recipe viewport; static output overrides require a raster expression",
                ));
            }
            for (i, layer) in task.recipe.layers.iter().enumerate() {
                bind!(i, layer.id.clone(), SourceRole::Content);
            }
            effect = Some(task);
        }
    }
    if source_bindings.is_empty() {
        bind!(0, "source-1".into(), SourceRole::Content);
    }
    let guide_bindings = dependencies
        .iter()
        .map(|source| SourceBinding {
            slot_id: "output".into(),
            asset_id: source.slot_id.clone(),
            role: SourceRole::FittingGuide,
            source: source.clone(),
        })
        .collect::<Vec<_>>();
    let assets = source_bindings
        .iter()
        .chain(guide_bindings.iter())
        .map(|b| SpatialDocumentAsset {
            id: b.asset_id.clone(),
            content_version: Some(format!("figma-preview:{}", b.source.preview_fingerprint)),
        })
        .collect();
    let bindings = source_bindings
        .iter()
        .chain(guide_bindings.iter())
        .map(|b| SpatialDocumentBinding {
            role: if matches!(b.role, SourceRole::FittingGuide) {
                SpatialDocumentBindingRole::FittingGuide
            } else {
                SpatialDocumentBindingRole::Content
            },
            slot_id: b.slot_id.clone(),
            asset_id: b.asset_id.clone(),
        })
        .collect();
    let (document, delivery_plan, initial_state) = if let Some(task) = effect {
        let ready = prepare_spatial_interactive_delivery(&SpatialInteractiveDeliveryInput {
            expression_id: expression_id.clone(),
            recipe: task.recipe.clone(),
            initial_state: task.state.clone(),
            assets,
            bindings,
        })?;
        (
            ready.document,
            ready.delivery_plan,
            Some(ready.initial_state),
        )
    } else {
        let mut template = template.unwrap_or_else(|| SpatialTemplateSpec {
            schema: SPATIAL_TEMPLATE_SCHEMA.into(),
            version: SPATIAL_TEMPLATE_VERSION.into(),
            operation: SpatialTemplateOperation::RasterProgram {
                source_slot: source_bindings[0].slot_id.clone(),
                program: RasterProgramSpec {
                    schema: RASTER_PROGRAM_SCHEMA.into(),
                    version: RASTER_PROGRAM_VERSION.into(),
                    stages: vec![stage.expect("static family has a stage")],
                },
            },
            output: SpatialTemplateOutput::Single {
                id: "output".into(),
            },
        });
        if let Some(output) = output {
            template.output = output;
        }
        let ready = prepare_spatial_static_delivery(&SpatialStaticDeliveryInput {
            expression_id: expression_id.clone(),
            template,
            assets,
            bindings,
        })?;
        (ready.document, ready.delivery_plan, None)
    };
    let authoring_motion = match &saved.operation {
        LinkedOperation::Task {
            task: LinkedTask::Composition(FigmaCompositionTask::Composition { motion, .. }),
        } => motion.clone(),
        _ => None,
    };
    let mut losses = vec![
        Loss::SourceMediaNotEmbedded,
        Loss::FigmaPlacementNotTransferred,
        Loss::PreviewFingerprintNotContentDigest,
        Loss::PublishedPixelsNotCarried,
        Loss::NativeResultAppearanceNotTransferred,
    ];
    match saved.draft_status {
        DraftStatus::Pending => losses.push(Loss::StagedDraftExcluded),
        DraftStatus::Unusable => losses.push(Loss::StagedDraftUnavailable),
        DraftStatus::Absent => {}
    }
    if authoring_motion.is_some() {
        losses.push(Loss::AnimatedCompositionProjectsItsPoster);
    }
    if !dependencies.is_empty() {
        losses.push(Loss::FittingGuideRetainedAsBakedGeometry);
        losses.push(Loss::GuideGeometryChangesRequireRecapture);
    }
    Ok(Continuation {
        schema: CONTINUATION_SCHEMA.into(),
        version: "0.1".into(),
        origin: Origin {
            file_key: saved.file_key,
            page_id: saved.page_id,
            node_id: saved.node_id,
            revision: saved.revision,
            target_expected: saved.target_expected,
            source_graph_expected: saved.source_graph_expected,
            render_width: saved.render_width,
            render_height: saved.render_height,
        },
        expression_id,
        source_bindings,
        authoring_dependencies: dependencies,
        guide_bindings,
        document,
        delivery_plan,
        initial_state,
        render_quality: quality,
        authoring_motion,
        losses,
    })
}
fn snapshot_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"const":SNAPSHOT_SCHEMA,"type":"string"})
}
fn continuation_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"const":CONTINUATION_SCHEMA,"type":"string"})
}
fn page_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"const":"worldbend.figma.work-continuation-page","type":"string"})
}
fn version_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"const":"0.1","type":"string"})
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::figma_handoff::FigmaMockupSourceRaster;
    use base64::Engine as _;
    use image::{DynamicImage, ImageEncoder as _, Rgba, RgbaImage};
    use std::collections::HashMap;

    fn transform() -> TransformSpec {
        TransformSpec::normalized(Quad::new(
            Point::new(0.02, 0.03),
            Point::new(0.97, 0.02),
            Point::new(0.98, 0.96),
            Point::new(0.04, 0.98),
        ))
    }
    fn work() -> DeformationWorkSpec {
        serde_json::from_value(json!({"schema":"worldbend.deformation-work","version":"0.1",
            "transform":transform(),"targetSize":{"width":32,"height":24},"meshSubdivisions":4,
            "meshEdits":[{"column":2,"row":2,"warped":{"x":0.54,"y":0.48}}],
            "liquify":{"strokes":[{"id":"brush","mode":"push","samples":[{"position":{"x":0.5,"y":0.5},"delta":{"x":0.03,"y":0},"radius":0.3,"strength":0.4}]}]}})).unwrap()
    }
    fn sources(
        count: usize,
    ) -> (
        Vec<FigmaMockupSource>,
        Vec<FigmaMockupSourceRaster>,
        Vec<DynamicImage>,
    ) {
        let mut facts = Vec::new();
        let mut rasters = Vec::new();
        let mut images = Vec::new();
        for index in 0..count {
            let image = RgbaImage::from_fn(32, 24, |x, y| {
                Rgba([
                    (x * 7 + index as u32 * 3) as u8,
                    (y * 9) as u8,
                    if (x + y) % 3 == 0 { 230 } else { 30 },
                    if x < 4 { 90 } else { 255 },
                ])
            });
            let mut bytes = Vec::new();
            image::codecs::png::PngEncoder::new(&mut bytes)
                .write_image(image.as_raw(), 32, 24, image::ExtendedColorType::Rgba8)
                .unwrap();
            let slot_id = format!("source-{}", index + 1);
            facts.push(FigmaMockupSource {
                source_capture: None,
                slot_id: slot_id.clone(),
                node_id: format!("art-{index}"),
                name: format!("Artwork {index}"),
                width: 32.,
                height: 24.,
                preview_fingerprint: figma_handoff::source_preview_fingerprint(&bytes),
            });
            rasters.push(serde_json::from_value(json!({"slotId":slot_id,"base64":base64::engine::general_purpose::STANDARD.encode(bytes)})).unwrap());
            images.push(DynamicImage::ImageRgba8(image));
        }
        (facts, rasters, images)
    }
    fn snapshot(operation: LinkedOperation, sources: Vec<FigmaMockupSource>) -> PublishedSnapshot {
        PublishedSnapshot {
            schema: SNAPSHOT_SCHEMA.into(),
            version: "0.1".into(),
            file_key: "file".into(),
            page_id: "page".into(),
            node_id: "result".into(),
            revision: 3,
            target_expected: "hash32x2:1000:0123456789abcdef".into(),
            source_graph_expected: "hash32x2:2000:0123456789abcdef".into(),
            operation,
            source_node_ids: sources.iter().map(|s| s.node_id.clone()).collect(),
            sources,
            render_width: 32,
            render_height: 24,
            placement: FigmaPlacement {
                x: 200.,
                y: 400.,
                width: 64.,
                height: 48.,
            },
            draft_status: DraftStatus::Absent,
        }
    }
    fn mockup() -> MockupSpec {
        serde_json::from_value(json!({"schema":"worldbend.mockup","version":"0.1","canvas":{"width":32,"height":24},"background":{"kind":"transparent"},
            "planes":[{"id":"front","sourceId":"source-1","transform":transform(),"opacity":1},
            {"id":"back","sourceId":"source-2","transform":TransformSpec::normalized(Quad::unit()),"opacity":0.4}],"seams":[]})).unwrap()
    }
    fn family_cases() -> Vec<(LinkedOperation, usize)> {
        let work = work();
        let mesh = plan_deformation_work(&work).unwrap().mesh_warp.spec;
        let surface = SurfaceDeformationSpec {
            boundary: Default::default(),
            schema: SURFACE_DEFORMATION_SCHEMA.into(),
            version: SURFACE_DEFORMATION_VERSION.into(),
            transform: transform(),
            target_size: Some(Size::new(32., 24.)),
            mesh_subdivisions: 4,
            envelope: BezierEnvelope {
                columns: 1,
                rows: 1,
                points: (0..4)
                    .flat_map(|y| {
                        (0..4).map(move |x| {
                            Point::new(
                                f64::from(x) / 3. + if x == 1 && y == 1 { 0.03 } else { 0. },
                                f64::from(y) / 3.,
                            )
                        })
                    })
                    .collect(),
            },
            anchors: vec![],
            strokes: vec![],
        };
        let remap = |displace| {
            serde_json::from_value::<LinkedOperation>(json!({"kind":"task","task":{"kind":"remap","spec":{"schema":"worldbend.remap","version":"0.1","output":{"width":32,"height":24},"operation":if displace{json!({"kind":"displacement","xChannel":"red","yChannel":"green","scaleXPixels":6,"scaleYPixels":3,"neutral":128,"boundary":"clamp"})}else{json!({"kind":"lens","coefficients":{"k1":0.12,"k2":0,"k3":0,"p1":0.005,"p2":0},"center":{"x":0.5,"y":0.5},"scale":{"x":0.5,"y":0.5}})}}}})).unwrap()
        };
        let composition = SpatialTemplateSpec {
            schema: SPATIAL_TEMPLATE_SCHEMA.into(),
            version: SPATIAL_TEMPLATE_VERSION.into(),
            operation: SpatialTemplateOperation::CompositionProgram {
                composition: mockup(),
                postprocess: RasterProgramSpec {
                    schema: RASTER_PROGRAM_SCHEMA.into(),
                    version: RASTER_PROGRAM_VERSION.into(),
                    stages: vec![RasterProgramStage::Transform {
                        id: "whole".into(),
                        spec: transform(),
                        canvas: RasterProgramCanvasMode::Reference,
                        target_size: Some(Size::new(32., 24.)),
                    }],
                },
            },
            output: SpatialTemplateOutput::Single {
                id: "output".into(),
            },
        };
        vec![
            (LinkedOperation::Transform{spec:transform()},1),
            (LinkedOperation::Rectify{spec:RectifySpec::normalized(transform().destination.quad,PixelSize::new(32,24))},1),
            (serde_json::from_value(json!({"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1","operation":{"kind":"pad","insets":{"top":2,"right":3,"bottom":4,"left":1},"background":{"kind":"transparent"}}}})).unwrap(),1),
            (serde_json::from_value(json!({"kind":"task","task":{"kind":"mesh","spec":mesh}})).unwrap(),1),
            (serde_json::from_value(json!({"kind":"task","task":{"kind":"surface","spec":surface}})).unwrap(),1),
            (serde_json::from_value(json!({"kind":"task","task":{"kind":"deformation","view":"pin","spec":work}})).unwrap(),1),
            (remap(false),1),(remap(true),2),
            (serde_json::from_value(json!({"kind":"task","task":{"kind":"mockup","spec":mockup()}})).unwrap(),2),
            (serde_json::from_value(json!({"kind":"task","task":{"kind":"composition","template":composition,"previewOutputId":"output"}})).unwrap(),2),
        ]
    }
    #[test]
    fn every_static_family_replays_exactly_as_the_existing_figma_kernel() {
        for (index, (operation, count)) in family_cases().into_iter().enumerate() {
            let (facts, rasters, images) = sources(count);
            let original = figma_linked::render_work_revision(
                operation.clone(),
                facts.clone(),
                &rasters,
                32,
                24,
                None,
            )
            .unwrap()
            .0;
            let continued = project(snapshot(operation, facts), "same-work".into(), None).unwrap();
            let SpatialDocumentDelivery::Static { job, .. } =
                &continued.delivery_plan.deliveries[0]
            else {
                panic!()
            };
            let directory = tempfile::tempdir().unwrap();
            let mut paths = HashMap::new();
            for (binding, image) in continued.source_bindings.iter().zip(&images) {
                let file = directory.path().join(format!("{}.png", binding.asset_id));
                image.save(&file).unwrap();
                paths.insert(binding.asset_id.clone(), file);
            }
            let output = directory.path().join("output");
            worldbend_render::render_variation_job_files(
                &paths,
                job,
                &output,
                worldbend_render::VariationJobRenderOptions {
                    quality: continued.render_quality,
                    ..Default::default()
                },
                false,
            )
            .unwrap();
            let actual = image::open(output.join("same-work/output.png"))
                .unwrap()
                .to_rgba8();
            assert_eq!(actual, original, "family {index}");
            assert!(continued.initial_state.is_none());
            assert_eq!(continued.origin.revision, 3);
        }
    }

    fn revision_input(saved: &PublishedSnapshot, continued: &Continuation) -> serde_json::Value {
        let preview = match &saved.operation {
            LinkedOperation::Task {
                task:
                    LinkedTask::Composition(FigmaCompositionTask::Composition {
                        preview_output_id, ..
                    }),
            } => Some(preview_output_id),
            _ => None,
        };
        json!({"action":"revise","input":{
            "base":saved,"document":continued.document,"expectedFingerprint":continued.delivery_plan.document_fingerprint,
            "expressionId":continued.expression_id,"assets":continued.source_bindings.iter().chain(continued.guide_bindings.iter()).rev().map(|b|json!({"assetId":b.asset_id,"nodeId":b.source.node_id})).collect::<Vec<_>>(),
            "renderWidth":32,"renderHeight":24,"previewOutputId":preview,"state":continued.initial_state,
            "includeSourceRasters":true,"sourceRasterTransport":"artifact"
        }})
    }

    #[test]
    fn animated_composition_read_and_static_revision_keep_the_other_key_poses() {
        let (mut operation, _) = family_cases().pop().unwrap();
        let LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    template, motion, ..
                }),
        } = &mut operation
        else {
            panic!()
        };
        let SpatialTemplateOperation::CompositionProgram { composition, .. } =
            &mut template.operation
        else {
            panic!()
        };
        let initial = worldbend_core::author_mockup_motion(
            &worldbend_core::MockupMotionAuthoringInput::Create {
                scene: composition.clone(),
                timebase: worldbend_core::FrameRate {
                    numerator: 24,
                    denominator: 1,
                },
                frame_count: 96,
            },
        )
        .unwrap();
        let mut pose = composition.clone();
        pose.planes[0].transform.destination.quad.tl.x += 0.01;
        let revised = worldbend_core::author_mockup_motion(
            &worldbend_core::MockupMotionAuthoringInput::Revise {
                spec: initial.spec,
                expected_fingerprint: initial.fingerprint,
                edit: Box::new(worldbend_core::MockupMotionEdit::SetScenePose {
                    frame: 60,
                    scene: Box::new(pose),
                }),
            },
        )
        .unwrap();
        *composition = worldbend_core::plan_mockup_motion(&revised.spec)
            .unwrap()
            .frame_specs[60]
            .clone();
        *motion = Some(figma_handoff::FigmaCompositionMotion {
            spec: revised.spec.clone(),
            frame: 60,
        });
        let (facts, _, _) = sources(2);
        let saved = snapshot(operation, facts);
        figma_linked::validate_work_operation(&saved.operation, 2, 32, 24).unwrap();
        let continued = project(saved.clone(), "animated".into(), None).unwrap();
        assert_eq!(
            continued.authoring_motion.as_ref().unwrap().spec,
            revised.spec
        );
        assert!(
            continued
                .losses
                .iter()
                .any(|loss| matches!(loss, Loss::AnimatedCompositionProjectsItsPoster))
        );
        let input: Input = serde_json::from_value(revision_input(&saved, &continued)).unwrap();
        let output = serde_json::to_value(prepare(input).unwrap()).unwrap();
        assert_eq!(
            output["operation"]["task"]["motion"]["spec"]["planes"],
            json!(revised.spec.planes)
        );
        assert!(output["operation"]["task"]["motion"]["spec"]["presentation"].is_object());
        let mut bad = saved;
        if let LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    motion: Some(motion),
                    ..
                }),
        } = &mut bad.operation
        {
            motion.frame = 0;
        }
        assert!(figma_linked::validate_work_operation(&bad.operation, 2, 32, 24).is_err());
    }
    #[test]
    fn selected_composition_output_renders_without_discarding_sibling_outputs() {
        let (operation, _) = family_cases().pop().unwrap();
        let LinkedOperation::Task {
            task: LinkedTask::Composition(mut task),
        } = operation
        else {
            panic!()
        };
        let (_, rasters, _) = sources(2);
        let full = figma_handoff::render_composition_image(&task, &rasters).unwrap();
        let FigmaCompositionTask::Composition {
            template,
            preview_output_id,
            ..
        } = &mut task
        else {
            panic!()
        };
        template.output=serde_json::from_value(json!({"kind":"canvasSet","spec":{"schema":"worldbend.canvas-set","version":"0.1","variants":[
            {"id":"square","operation":{"kind":"crop","rect":{"x":4,"y":2,"width":16,"height":16}}},
            {"id":"wide","operation":{"kind":"contain","output":{"width":48,"height":24},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"transparent"}}}
        ]}})).unwrap();
        *preview_output_id = "square".into();
        figma_handoff::figma_mockup_task(&task, 2).unwrap();
        let cropped = figma_handoff::render_composition_image(&task, &rasters).unwrap();
        assert_eq!(cropped.dimensions(), (16, 16));
        for y in 0..16 {
            for x in 0..16 {
                assert_eq!(cropped.get_pixel(x, y), full.get_pixel(x + 4, y + 2));
            }
        }
        let FigmaCompositionTask::Composition {
            preview_output_id, ..
        } = &mut task
        else {
            panic!()
        };
        *preview_output_id = "wide".into();
        let wide = figma_handoff::render_composition_image(&task, &rasters).unwrap();
        assert_eq!(wide.dimensions(), (48, 24));
        assert_eq!(
            json!(task)["template"]["output"]["spec"]["variants"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn document_revision_forwards_captured_source_proofs_for_later_parts() {
        let (facts, _, _) = sources(1);
        let saved = snapshot(family_cases().remove(0).0, facts);
        let continued = project(saved.clone(), "same-work".into(), None).unwrap();
        let mut input = revision_input(&saved, &continued);
        input["input"]["part"] = json!(1);
        input["input"]["token"] = json!("hash32x2:900:0123456789abcdef");
        input["input"]["sourceFingerprints"] = json!(["preview32x2:100:0123456789abcdef"]);
        input["input"]["includeSourceRasters"] = json!(false);
        let Output::Revision(revision) =
            prepare(serde_json::from_value(input.clone()).unwrap()).unwrap()
        else {
            panic!()
        };
        assert!(
            crate::figma_handoff::test_code(&revision.request)
                .contains("\"sourceFingerprints\":[\"preview32x2:100:0123456789abcdef\"]")
        );
        input["input"]["includeSourceRasters"] = json!(true);
        assert!(prepare(serde_json::from_value(input).unwrap()).is_err());
    }

    #[test]
    fn document_revision_retains_all_static_family_controls_and_exact_kernel_pixels() {
        for (index, (operation, count)) in family_cases().into_iter().enumerate() {
            let (facts, rasters, _) = sources(count);
            let saved = snapshot(operation.clone(), facts.clone());
            let continued = project(saved.clone(), "same-work".into(), None).unwrap();
            let before = json!(continued.document);
            let Output::Revision(revision) =
                prepare(serde_json::from_value(revision_input(&saved, &continued)).unwrap())
                    .unwrap()
            else {
                panic!()
            };
            let request_code = figma_handoff::test_code(revision.request());
            let revised = json!(revision);
            assert_eq!(revised["operation"], json!(operation), "family {index}");
            assert_eq!(
                revised["sources"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|s| s["nodeId"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                saved
                    .source_node_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
            );
            assert!(request_code.contains("readWorkRevision("));
            assert!(request_code.contains("\"sourceRasterTransport\":\"artifact\""));
            let actual: LinkedOperation =
                serde_json::from_value(revised["operation"].clone()).unwrap();
            assert_eq!(
                figma_linked::render_work_revision(actual, facts.clone(), &rasters, 32, 24, None)
                    .unwrap()
                    .0,
                figma_linked::render_work_revision(operation, facts, &rasters, 32, 24, None)
                    .unwrap()
                    .0,
                "family {index}"
            );
            assert_eq!(json!(continued.document), before);
        }
    }

    #[test]
    fn revision_rebinds_arbitrary_slots_and_reports_retained_named_delivery() {
        let (facts, _, _) = sources(2);
        let saved = snapshot(family_cases().pop().unwrap().0, facts);
        let mut c = project(saved.clone(), "combined".into(), None).unwrap();
        let SpatialDocumentExpression::Static {
            template, bindings, ..
        } = &mut c.document.expressions[0]
        else {
            panic!()
        };
        let SpatialTemplateOperation::CompositionProgram { composition, .. } =
            &mut template.operation
        else {
            panic!()
        };
        for (index, plane) in composition.planes.iter_mut().enumerate() {
            plane.source_id = format!("layer-{index}");
            bindings[index].slot_id = plane.source_id.clone();
        }
        let repeated = composition.planes[0].clone();
        composition.planes.push(MockupPlane {
            id: "repeated".into(),
            ..repeated
        });
        c.delivery_plan.document_fingerprint =
            inspect_spatial_document(&c.document).unwrap().fingerprint;
        let Output::Revision(revision) =
            prepare(serde_json::from_value(revision_input(&saved, &c)).unwrap()).unwrap()
        else {
            panic!()
        };
        let revised = json!(revision);
        let planes = revised["operation"]["task"]["template"]["operation"]["composition"]["planes"]
            .as_array()
            .unwrap();
        assert_eq!(
            planes
                .iter()
                .map(|p| p["sourceId"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["source-1", "source-2", "source-1"]
        );
        assert_eq!(revised["sources"].as_array().unwrap().len(), 2);

        let (facts, _, _) = sources(1);
        let saved = snapshot(family_cases()[6].0.clone(), facts);
        let output: SpatialTemplateOutput=serde_json::from_value(json!({"kind":"canvasSet","spec":{"schema":"worldbend.canvas-set","version":"0.1","variants":[{"id":"square","operation":{"kind":"stretch","output":{"width":40,"height":40}}}]}})).unwrap();
        let c = project(saved.clone(), "lens".into(), Some(output.clone())).unwrap();
        let Output::Revision(revision) =
            prepare(serde_json::from_value(revision_input(&saved, &c)).unwrap()).unwrap()
        else {
            panic!()
        };
        let revised = json!(revision);
        assert_eq!(revised["output"], json!(output));
        assert!(
            revised["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("namedDeliveryOutputsRemainInDocument"))
        );
    }

    #[test]
    fn document_revision_maps_leading_authoring_stage_and_retains_trailing_canvas() {
        let (facts, rasters, _) = sources(1);
        let saved = snapshot(LinkedOperation::Transform { spec: transform() }, facts);
        let mut continued = project(saved.clone(), "brand-brief".into(), None).unwrap();
        let canvas_set: SpatialTemplateOutput = serde_json::from_value(json!({
            "kind":"canvasSet",
            "spec":{"schema":"worldbend.canvas-set","version":"0.1","variants":[
                {"id":"website-presentation","operation":{"kind":"contain","output":{"width":1200,"height":800},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"color","space":"srgb8","rgba":[244,243,237,255]}}},
                {"id":"social-square","operation":{"kind":"contain","output":{"width":1080,"height":1080},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"color","space":"srgb8","rgba":[244,243,237,255]}}},
                {"id":"social-wide","operation":{"kind":"contain","output":{"width":1200,"height":628},"anchor":{"x":0.5,"y":0.5},"background":{"kind":"color","space":"srgb8","rgba":[244,243,237,255]}}}
            ]}
        })).unwrap();
        let SpatialDocumentExpression::Static { template, .. } =
            &mut continued.document.expressions[0]
        else {
            panic!();
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &mut template.operation
        else {
            panic!();
        };
        assert_eq!(program.stages.len(), 1);
        program.stages.push(RasterProgramStage::Canvas {
            id: "brand-plate".into(),
            spec: serde_json::from_value(json!({
                "schema":"worldbend.canvas","version":"0.1",
                "operation":{"kind":"contain","output":{"width":32,"height":24},"anchor":{"x":0.5,"y":0.5},
                    "background":{"kind":"color","space":"srgb8","rgba":[244,243,237,255]}}
            }))
            .unwrap(),
        });
        template.output = canvas_set.clone();
        continued.delivery_plan.document_fingerprint =
            inspect_spatial_document(&continued.document)
                .unwrap()
                .fingerprint;

        let Output::Revision(revision) =
            prepare(serde_json::from_value(revision_input(&saved, &continued)).unwrap()).unwrap()
        else {
            panic!();
        };
        let revised = json!(revision);
        assert_eq!(revised["operation"]["kind"], json!("transform"));
        assert_eq!(revised["operation"]["spec"], json!(transform()));
        assert_eq!(revised["output"], json!(canvas_set));
        assert!(
            revised["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("trailingCanvasStagesRemainInDocument")),
            "{:?}",
            revised["losses"]
        );
        assert!(
            revised["losses"]
                .as_array()
                .unwrap()
                .contains(&json!("namedDeliveryOutputsRemainInDocument")),
            "{:?}",
            revised["losses"]
        );
        let actual: LinkedOperation = serde_json::from_value(revised["operation"].clone()).unwrap();
        assert_eq!(
            figma_linked::render_work_revision(
                actual,
                saved.sources.clone(),
                &rasters,
                32,
                24,
                None
            )
            .unwrap()
            .0,
            figma_linked::render_work_revision(
                LinkedOperation::Transform { spec: transform() },
                saved.sources.clone(),
                &rasters,
                32,
                24,
                None
            )
            .unwrap()
            .0
        );

        // Canvas then Transform is not the closed trailing-Canvas pattern.
        let SpatialDocumentExpression::Static { template, .. } =
            &mut continued.document.expressions[0]
        else {
            panic!();
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &mut template.operation
        else {
            panic!();
        };
        program.stages.reverse();
        continued.delivery_plan.document_fingerprint =
            inspect_spatial_document(&continued.document)
                .unwrap()
                .fingerprint;
        let mut bad = revision_input(&saved, &continued);
        bad["input"]["expectedFingerprint"] =
            json!(continued.delivery_plan.document_fingerprint.clone());
        assert!(
            prepare(serde_json::from_value(bad).unwrap()).is_err(),
            "non-trailing authoring after Canvas must reject"
        );
    }

    #[test]
    fn document_revision_rejects_stale_ambiguous_or_unrepresentable_work_before_host_request() {
        let (facts, _, _) = sources(1);
        let saved = snapshot(LinkedOperation::Transform { spec: transform() }, facts);
        let c = project(saved.clone(), "poster".into(), None).unwrap();
        let valid = revision_input(&saved, &c);
        for case in [
            "stale",
            "unknown-expression",
            "missing",
            "extra",
            "duplicate",
            "target-node",
            "size",
            "tight",
            "multiple",
            "unexpected-state",
            "named-preview",
        ] {
            let mut value = valid.clone();
            match case {
                "stale" => {
                    value["input"]["expectedFingerprint"] =
                        json!(format!("sha256:{}", "0".repeat(64)))
                }
                "unknown-expression" => value["input"]["expressionId"] = json!("missing"),
                "missing" => value["input"]["assets"] = json!([]),
                "extra" => value["input"]["assets"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"assetId":"extra","nodeId":"extra-node"})),
                "duplicate" => {
                    let b = value["input"]["assets"][0].clone();
                    value["input"]["assets"].as_array_mut().unwrap().push(b);
                }
                "target-node" => value["input"]["assets"][0]["nodeId"] = json!(saved.node_id),
                "size" => value["input"]["renderWidth"] = json!(31),
                "tight" => {
                    value["input"]["document"]["expressions"][0]["template"]["operation"]["program"]
                        ["stages"][0]["canvas"] = json!("tight")
                }
                "multiple" => {
                    let mut stage=value["input"]["document"]["expressions"][0]["template"]["operation"]["program"]["stages"][0].clone();
                    stage["id"] = json!("second");
                    value["input"]["document"]["expressions"][0]["template"]["operation"]["program"]["stages"].as_array_mut().unwrap().push(stage);
                }
                "unexpected-state" => {
                    value["input"]["state"] =
                        json!({"progress":1,"pointerX":0,"pointerY":0,"reducedMotion":false})
                }
                "named-preview" => value["input"]["previewOutputId"] = json!("output"),
                _ => unreachable!(),
            }
            if matches!(case, "tight" | "multiple") {
                let doc: SpatialDocumentSpec =
                    serde_json::from_value(value["input"]["document"].clone()).unwrap();
                value["input"]["expectedFingerprint"] =
                    json!(inspect_spatial_document(&doc).unwrap().fingerprint);
            }
            assert!(
                prepare(serde_json::from_value(value).unwrap()).is_err(),
                "{case}"
            );
        }
        let mut unknown = valid.clone();
        unknown["input"]["lostControls"] = json!(true);
        assert!(serde_json::from_value::<Input>(unknown).is_err());
        assert_eq!(json!(c.document), valid["input"]["document"]);
    }
    #[test]
    fn fitted_guides_remain_explicit_dependencies_in_both_source_orders() {
        let contour = json!({"start":{"x":0,"y":0},"segments":[{"kind":"line","to":{"x":1,"y":0}},{"kind":"line","to":{"x":1,"y":1}},{"kind":"line","to":{"x":0,"y":1}}]});
        for guide in [0, 1] {
            let operation:LinkedOperation=serde_json::from_value(json!({"kind":"task","task":{"kind":"deformation","view":"mesh","shapeGuideSourceIndex":guide,
                "spec":{"schema":"worldbend.deformation-work","version":"0.1","transform":TransformSpec::normalized(Quad::unit()),"targetSize":{"width":32,"height":24},"meshSubdivisions":4,"shapeFit":{"contour":contour,"clip":{"contours":[contour],"fillRule":"nonZero"}}}}})).unwrap();
            let (facts, rasters, images) = sources(2);
            let LinkedOperation::Task {
                task: LinkedTask::Deformation(ref task),
            } = operation
            else {
                panic!()
            };
            let DeformationTask::Deformation { spec, .. } = task.as_ref() else {
                panic!()
            };
            let clip = spec.shape_fit.as_ref().unwrap().clip.clone();
            let expected = figma_linked::render_work_revision(
                operation.clone(),
                facts.clone(),
                &rasters,
                32,
                24,
                clip,
            )
            .unwrap()
            .0;
            let saved = snapshot(operation.clone(), facts);
            let c = project(saved.clone(), "fit".into(), None).unwrap();
            let Output::Revision(revision) =
                prepare(serde_json::from_value(revision_input(&saved, &c)).unwrap()).unwrap()
            else {
                panic!()
            };
            let revised = json!(revision);
            assert_eq!(revised["operation"], json!(operation));
            assert_eq!(revised["sources"][guide as usize]["role"], "fittingGuide");
            assert_eq!(
                revised["sources"][guide as usize]["assetId"],
                format!("source-{}", guide + 1)
            );
            assert_eq!(
                revised["sources"][guide as usize]["nodeId"],
                format!("art-{guide}")
            );
            assert!(
                revised["losses"]
                    .as_array()
                    .unwrap()
                    .contains(&json!("fittingGuideRecapturedFromCurrentFigma"))
            );
            assert_eq!(c.source_bindings.len(), 1);
            assert_eq!(
                c.source_bindings[0].source.node_id,
                format!("art-{}", 1 - guide)
            );
            assert_eq!(c.authoring_dependencies[0].node_id, format!("art-{guide}"));
            assert_eq!(c.guide_bindings.len(), 1);
            assert_eq!(c.guide_bindings[0].slot_id, "output");
            assert_eq!(c.guide_bindings[0].source.node_id, format!("art-{guide}"));
            let mut replacement = revision_input(&saved, &c);
            let guide_asset = c.guide_bindings[0].asset_id.clone();
            for asset in replacement["input"]["assets"].as_array_mut().unwrap() {
                if asset["assetId"] == guide_asset {
                    asset["nodeId"] = json!("replacement-guide");
                }
            }
            let Output::Revision(replacement) =
                prepare(serde_json::from_value(replacement).unwrap()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                json!(replacement)["sources"][guide as usize]["nodeId"],
                "replacement-guide"
            );
            assert_eq!(
                json!(replacement)["sources"][(1 - guide) as usize]["nodeId"],
                format!("art-{}", 1 - guide)
            );
            // Older baked documents have no guide asset. Their original
            // bound guide remains an explicit host dependency on revision.
            let mut legacy = revision_input(&saved, &c);
            let mut doc = c.document.clone();
            doc.assets.retain(|asset| asset.id != guide_asset);
            let SpatialDocumentExpression::Static { bindings, .. } = &mut doc.expressions[0] else {
                panic!()
            };
            bindings.retain(|binding| binding.role != SpatialDocumentBindingRole::FittingGuide);
            legacy["input"]["assets"]
                .as_array_mut()
                .unwrap()
                .retain(|asset| asset["assetId"] != guide_asset);
            legacy["input"]["expectedFingerprint"] =
                json!(inspect_spatial_document(&doc).unwrap().fingerprint);
            legacy["input"]["document"] = json!(doc);
            let Output::Revision(legacy) =
                prepare(serde_json::from_value(legacy).unwrap()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                json!(legacy)["sources"][guide as usize]["nodeId"],
                format!("art-{guide}")
            );
            assert!(
                json!(legacy)["sources"][guide as usize]
                    .get("assetId")
                    .is_none()
            );
            assert!(
                c.losses
                    .iter()
                    .any(|l| matches!(l, Loss::FittingGuideRetainedAsBakedGeometry))
            );
            let SpatialDocumentDelivery::Static { job, .. } = &c.delivery_plan.deliveries[0] else {
                panic!()
            };
            let dir = tempfile::tempdir().unwrap();
            let source = dir.path().join("source.png");
            images[(1 - guide) as usize].save(&source).unwrap();
            worldbend_render::render_variation_job_files(
                &HashMap::from([(c.source_bindings[0].asset_id.clone(), source)]),
                job,
                &dir.path().join("out"),
                worldbend_render::VariationJobRenderOptions {
                    quality: c.render_quality,
                    ..Default::default()
                },
                false,
            )
            .unwrap();
            assert_eq!(
                image::open(dir.path().join("out/fit/output.png"))
                    .unwrap()
                    .to_rgba8(),
                expected
            );
        }
    }
    #[test]
    fn depth_retains_initial_state_and_uses_recipe_slots_with_physical_source_provenance() {
        let recipe = effect_recipe(&EffectRecipeInput {
            effect: EffectId::MultiplaneCamera,
            version: "3".into(),
            viewport: Size::new(32., 24.),
            intensity: 0.8,
        })
        .unwrap();
        let operation:LinkedOperation=serde_json::from_value(json!({"kind":"task","task":{"kind":"effect","recipe":recipe,"state":{"progress":1,"pointerX":0.3,"pointerY":-0.2,"reducedMotion":false}}})).unwrap();
        let (facts, _, _) = sources(recipe.layers.len());
        let saved = snapshot(operation.clone(), facts);
        assert!(
            project(
                saved.clone(),
                "depth".into(),
                Some(SpatialTemplateOutput::Single { id: "image".into() })
            )
            .is_err()
        );
        let c = project(saved.clone(), "depth".into(), None).unwrap();
        let value = revision_input(&saved, &c);
        let Output::Revision(revision) =
            prepare(serde_json::from_value(value.clone()).unwrap()).unwrap()
        else {
            panic!()
        };
        assert_eq!(json!(revision)["operation"], json!(operation));
        let mut missing_state = value;
        missing_state["input"]["state"] = serde_json::Value::Null;
        assert!(prepare(serde_json::from_value(missing_state).unwrap()).is_err());
        assert_eq!(c.initial_state.as_ref().unwrap().pointer_x, 0.3);
        assert_eq!(c.source_bindings[0].slot_id, recipe.layers[0].id);
        assert_eq!(c.source_bindings[0].asset_id, "source-1");
        assert!(
            matches!(&c.delivery_plan.deliveries[0],SpatialDocumentDelivery::Interactive{recipe:r,..} if json!(r)==json!(recipe))
        );
    }
    #[test]
    fn admission_rejects_proposals_malformed_tokens_and_changed_slot_identity() {
        let (facts, _, _) = sources(1);
        let saved = snapshot(LinkedOperation::Transform { spec: transform() }, facts);
        for variant in [
            "schema",
            "token",
            "source",
            "dimensions",
            "revision",
            "preview",
        ] {
            let mut invalid = saved.clone();
            match variant {
                "schema" => invalid.schema = "worldbend.figma.work-revision".into(),
                "token" => invalid.target_expected = "hash32x2:bad".into(),
                "source" => invalid.sources[0].slot_id = "source-2".into(),
                "dimensions" => invalid.render_width = 0,
                "revision" => invalid.revision = 9_007_199_254_740_991,
                "preview" => {
                    invalid.sources[0].preview_fingerprint = "digest-is-not-preview".into()
                }
                _ => unreachable!(),
            }
            assert!(project(invalid, "work".into(), None).is_err(), "{variant}");
        }
        let mut proposal = json!({"action":"project","snapshot":saved});
        proposal["snapshot"]["preserveDraft"] = json!(true);
        assert!(serde_json::from_value::<Input>(proposal).is_err());
        let request=prepare(serde_json::from_value(json!({"action":"inspect","fileKey":"file","pageId":"page","nodeId":"result","sourceRasterTransport":"artifact","includeSourceRasters":true})).unwrap()).unwrap();
        let Output::Request(request) = request else {
            panic!()
        };
        assert!(figma_handoff::test_code(&request).contains("readWorkContinuation("));
        assert!(serde_json::to_vec(&request).unwrap().len() < 48 * 1024);
        assert!(prepare(serde_json::from_value(json!({"action":"inspect","fileKey":"file","pageId":"page","nodeId":"result","part":1})).unwrap()).is_err());
    }

    #[test]
    fn legal_large_mesh_reads_losslessly_under_the_complete_mcp_response_budget() {
        let n = 44_u16;
        let vertices = (0..=n)
            .flat_map(|row| {
                (0..=n).map(move |column| {
                    let point = Point::new(
                        f64::from(column) / f64::from(n),
                        f64::from(row) / f64::from(n),
                    );
                    WarpVertex {
                        source: point,
                        warped: point,
                    }
                })
            })
            .collect();
        let mut triangles = Vec::new();
        for row in 0..n {
            for column in 0..n {
                let i = row * (n + 1) + column;
                triangles.extend([[i, i + 1, i + n + 2], [i, i + n + 2, i + n + 1]]);
            }
        }
        let operation = serde_json::from_value(json!({"kind":"task","task":{"kind":"mesh","spec":{
            "schema":"worldbend.mesh-warp","version":"0.1","transform":TransformSpec::normalized(Quad::unit()),
            "targetSize":{"width":32,"height":24},"mesh":WarpMesh {
                topology:WarpMeshTopology::Triangles {triangles}, vertices, boundary:MeshBoundary::Fixed, shading:None
            }}}})).unwrap();
        let (facts, _, _) = sources(1);
        let continued = project(snapshot(operation, facts), "large".into(), None).unwrap();
        let original = serde_json::to_value(&continued).unwrap();
        let Output::Page(first) = project_response(continued.clone(), None, None).unwrap() else {
            panic!("large work must return parts")
        };
        assert!(first.part_count > 1);
        let mut joined = String::new();
        for part in 0..first.part_count {
            let output =
                project_response(continued.clone(), Some(part), Some(first.token.clone())).unwrap();
            let complete = crate::ToolEnvelope::from_result(Ok(output.clone()))
                .build_complete_result()
                .unwrap();
            assert!(
                crate::serialized_call_result_bytes(&complete).unwrap()
                    < crate::MAX_TOOL_RESPONSE_BYTES
            );
            let Output::Page(page) = output else { panic!() };
            assert_eq!(page.byte_start, joined.len());
            joined.push_str(&page.json);
            assert_eq!(page.byte_end, joined.len());
        }
        assert_eq!(joined.len(), first.bytes);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&joined).unwrap(),
            original
        );
        assert!(project_response(continued.clone(), Some(1), None).is_err());
        assert!(
            project_response(
                continued.clone(),
                Some(first.part_count),
                Some(first.token.clone())
            )
            .is_err()
        );
        let mut changed = continued.clone();
        changed.origin.revision += 1;
        assert!(project_response(changed, Some(1), Some(first.token)).is_err());
    }

    fn mockup_video_for_published_mockup() -> MockupVideoSpec {
        let published = mockup();
        let planes = published
            .planes
            .iter()
            .map(|plane| {
                json!({
                    "id": plane.id,
                    "sourceId": plane.source_id,
                    "opacity": plane.opacity,
                    "base": plane.transform,
                    "keyframes": [
                        {"frame": 0, "quad": plane.transform.destination.quad, "easingToNext": {"kind": "linear"}},
                        {"frame": 3, "quad": {
                            "tl": {"x": plane.transform.destination.quad.tl.x + 0.01, "y": plane.transform.destination.quad.tl.y},
                            "tr": {"x": plane.transform.destination.quad.tr.x + 0.01, "y": plane.transform.destination.quad.tr.y},
                            "br": {"x": plane.transform.destination.quad.br.x + 0.01, "y": plane.transform.destination.quad.br.y},
                            "bl": {"x": plane.transform.destination.quad.bl.x + 0.01, "y": plane.transform.destination.quad.bl.y}
                        }}
                    ]
                })
            })
            .collect::<Vec<_>>();
        serde_json::from_value(json!({
            "schema": "worldbend.mockup-video",
            "version": "0.1",
            "backgroundRgb": [16, 22, 34],
            "encoding": {"format": "mp4H264", "crf": 18},
            "mockupMotion": {
                "schema": "worldbend.mockup-motion",
                "version": "0.1",
                "canvas": {"width": 32, "height": 24},
                "timebase": {"numerator": 4, "denominator": 1},
                "frameCount": 4,
                "background": {"kind": "transparent"},
                "seams": [],
                "planes": planes
            }
        }))
        .unwrap()
    }

    #[test]
    fn project_temporal_builds_temporal_document_and_reports_motion_video_losses() {
        let (facts, _, _) = sources(2);
        let saved = snapshot(
            serde_json::from_value(json!({"kind":"task","task":{"kind":"mockup","spec":mockup()}}))
                .unwrap(),
            facts,
        );
        let video = mockup_video_for_published_mockup();
        let continued =
            project_temporal(saved.clone(), video.clone(), "device-scene-video".into()).unwrap();
        assert_eq!(continued.expression_id, "device-scene-video");
        assert!(matches!(
            &continued.document.expressions[0],
            SpatialDocumentExpression::Temporal { .. }
        ));
        let delivery = json!(continued.delivery_plan);
        assert_eq!(
            delivery["deliveries"][0]["kind"],
            json!("temporal"),
            "{delivery}"
        );
        let losses = json!(continued.losses);
        assert!(
            losses
                .as_array()
                .unwrap()
                .iter()
                .any(|loss| loss == "motionProgramNotHostedInFigma"),
            "{losses}"
        );
        assert!(
            losses
                .as_array()
                .unwrap()
                .iter()
                .any(|loss| loss == "encodedVideoNotProducedByFigma"),
            "{losses}"
        );
        let inspection = inspect_spatial_document(&continued.document).unwrap();
        assert!(inspection.fingerprint.starts_with("sha256:"));
        let SpatialDocumentDelivery::Temporal {
            video: delivered, ..
        } = &continued.delivery_plan.deliveries[0]
        else {
            panic!("expected temporal delivery");
        };
        assert_eq!(delivered, &video);
    }

    #[test]
    fn framed_animation_document_and_return_keep_full_motion_and_sibling_outputs() {
        let mut video = mockup_video_for_published_mockup();
        let mut presentation = MockupMotionPresentation {
            transform: TransformSpec::normalized(Quad::unit()),
            size: PixelSize::new(64, 48),
            output: SpatialTemplateOutput::CanvasSet {
                spec: CanvasSetSpec {
                    schema: CANVAS_SET_SCHEMA.into(),
                    version: CANVAS_VERSION.into(),
                    variants: vec![
                        CanvasVariant {
                            id: "square".into(),
                            operation: CanvasOperation::Crop {
                                rect: PixelRect {
                                    x: 16,
                                    y: 8,
                                    width: 32,
                                    height: 32,
                                },
                            },
                        },
                        CanvasVariant {
                            id: "wide".into(),
                            operation: CanvasOperation::Stretch {
                                output: PixelSize::new(64, 32),
                            },
                        },
                    ],
                },
            },
            output_id: "square".into(),
            keyframes: vec![],
        };
        let mut final_view = Quad::unit();
        final_view.tr.x = 0.82;
        final_view.br.x = 0.9;
        presentation.keyframes = vec![
            MotionKeyframe {
                frame: 0,
                quad: Quad::unit(),
                easing_to_next: None,
            },
            MotionKeyframe {
                frame: video.mockup_motion.frame_count - 1,
                quad: final_view,
                easing_to_next: None,
            },
        ];
        video.mockup_motion.presentation = Some(Box::new(presentation.clone()));
        let frame = 1;
        let scene = plan_mockup_motion(&video.mockup_motion)
            .unwrap()
            .frame_specs[frame]
            .clone();
        let poster = plan_mockup_motion(&video.mockup_motion)
            .unwrap()
            .presentation_at(frame)
            .unwrap()
            .spec
            .transform
            .clone();
        let operation:LinkedOperation=serde_json::from_value(json!({"kind":"task","task":{"kind":"composition","previewOutputId":"square",
            "template":{"schema":"worldbend.spatial-template","version":"0.1","operation":{"kind":"compositionProgram","composition":scene,
                "postprocess":{"schema":"worldbend.raster-program","version":"0.1","stages":[{"kind":"transform","id":"whole-result","spec":poster,"canvas":"reference","target_size":{"width":64,"height":48}}]}},"output":presentation.output},
            "motion":{"spec":video.mockup_motion,"frame":frame}}})).unwrap();
        let (facts, _, _) = sources(2);
        let mut saved = snapshot(operation, facts);
        saved.render_width = 32;
        saved.render_height = 32;
        let mut continued =
            project_temporal(saved.clone(), video.clone(), "animated-cover".into()).unwrap();
        assert!(
            !continued
                .losses
                .iter()
                .any(|l| matches!(l, Loss::MotionProgramNotHostedInFigma))
        );
        let SpatialDocumentExpression::Temporal {
            video: document_video,
            ..
        } = &mut continued.document.expressions[0]
        else {
            panic!()
        };
        assert_eq!(
            document_video.mockup_motion.presentation,
            Some(Box::new(presentation.clone()))
        );
        let current = author_mockup_motion(&MockupMotionAuthoringInput::Inspect {
            spec: document_video.mockup_motion.clone(),
        })
        .unwrap();
        document_video.mockup_motion = author_mockup_motion(&MockupMotionAuthoringInput::Revise {
            spec: current.spec,
            expected_fingerprint: current.fingerprint,
            edit: Box::new(MockupMotionEdit::Retime {
                timebase: video.mockup_motion.timebase,
                frame_count: 8,
            }),
        })
        .unwrap()
        .spec;
        let expected_presentation = document_video.mockup_motion.presentation.clone().unwrap();
        let expected_view = plan_mockup_motion(&document_video.mockup_motion)
            .unwrap()
            .presentation_at(2)
            .unwrap()
            .spec
            .transform
            .clone();
        let inspection = inspect_spatial_document(&continued.document).unwrap();
        let assets = continued
            .source_bindings
            .iter()
            .map(|b| json!({"assetId":b.asset_id,"nodeId":b.source.node_id}))
            .collect::<Vec<_>>();
        let result=prepare(serde_json::from_value(json!({"action":"revise","input":{"base":saved,"document":continued.document,
            "expectedFingerprint":inspection.fingerprint,"expressionId":"animated-cover","assets":assets,"renderWidth":32,"renderHeight":32}})).unwrap()).unwrap();
        let body = serde_json::to_value(result).unwrap();
        assert_eq!(
            body["operation"]["task"]["motion"]["spec"]["frameCount"],
            json!(8)
        );
        assert_eq!(body["operation"]["task"]["motion"]["frame"], json!(2));
        assert_eq!(
            body["operation"]["task"]["motion"]["spec"]["presentation"],
            json!(expected_presentation)
        );
        assert_eq!(
            body["operation"]["task"]["template"]["operation"]["postprocess"]["stages"][0]["spec"],
            json!(expected_view)
        );
        assert_eq!(
            body["operation"]["task"]["template"]["output"],
            json!(video.mockup_motion.presentation.unwrap().output)
        );
        assert!(
            body["losses"]
                .as_array()
                .unwrap()
                .iter()
                .all(|l| l != "temporalMotionProgramRemainsInDocument")
        );
    }

    #[test]
    fn project_temporal_rejects_non_mockup_or_mismatched_sources() {
        let (facts, _, _) = sources(1);
        let transform = snapshot(LinkedOperation::Transform { spec: transform() }, facts);
        let video = mockup_video_for_published_mockup();
        assert!(project_temporal(transform, video.clone(), "video".into()).is_err());

        let (facts, _, _) = sources(2);
        let saved = snapshot(
            serde_json::from_value(json!({"kind":"task","task":{"kind":"mockup","spec":mockup()}}))
                .unwrap(),
            facts,
        );
        let mut bad = video.clone();
        bad.mockup_motion.planes[0].source_id = "missing".into();
        assert!(project_temporal(saved.clone(), bad, "video".into()).is_err());

        let mut wrong_canvas = video;
        wrong_canvas.mockup_motion.canvas = PixelSize::new(64, 48);
        assert!(project_temporal(saved, wrong_canvas, "video".into()).is_err());
    }

    #[test]
    fn document_revision_returns_complete_temporal_authoring_program() {
        let (facts, _, _) = sources(2);
        let saved = snapshot(
            serde_json::from_value(json!({"kind":"task","task":{"kind":"mockup","spec":mockup()}}))
                .unwrap(),
            facts,
        );
        let video = mockup_video_for_published_mockup();
        let continued =
            project_temporal(saved.clone(), video, "device-scene-video".into()).unwrap();
        let inspection = inspect_spatial_document(&continued.document).unwrap();
        let assets = continued
            .source_bindings
            .iter()
            .map(|binding| {
                json!({
                    "assetId": binding.asset_id,
                    "nodeId": binding.source.node_id
                })
            })
            .collect::<Vec<_>>();
        let value = json!({
            "action": "revise",
            "input": {
                "base": saved,
                "document": continued.document,
                "expectedFingerprint": inspection.fingerprint,
                "expressionId": continued.expression_id,
                "assets": assets,
                "renderWidth": 32,
                "renderHeight": 24
            }
        });
        let Output::Revision(revised) = prepare(serde_json::from_value(value).unwrap()).unwrap()
        else {
            panic!("expected document revision");
        };
        let body = json!(revised);
        assert_eq!(body["operation"]["kind"], json!("task"));
        assert_eq!(body["operation"]["task"]["kind"], json!("composition"));
        assert_eq!(
            body["operation"]["task"]["motion"]["spec"]["planes"][0]["sourceId"],
            json!("source-1")
        );
        let losses = body["losses"].as_array().unwrap();
        assert!(
            losses
                .iter()
                .all(|loss| loss != "temporalMotionProgramRemainsInDocument"),
            "{losses:?}"
        );
        assert!(
            losses
                .iter()
                .any(|loss| loss == "temporalVideoDeliveryRemainsInDocument"),
            "{losses:?}"
        );
        assert_eq!(body["output"], json!({"kind":"single","id":"output"}));
        assert_eq!(
            body["operation"]["task"]["motion"]["spec"]["frameCount"],
            json!(4)
        );
    }
}

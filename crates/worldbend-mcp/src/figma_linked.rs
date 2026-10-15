//! Source-linked refresh planning and rendering. Host reads/writes remain
//! prepared Figma requests; geometry belongs to the existing core operations.
use crate::figma_handoff::{
    self, FigmaCompositionTask, FigmaEffectTask, FigmaMockupSource, FigmaMockupSourceRaster,
    FigmaPlacement, FigmaRequest,
};
use base64::Engine as _;
use image::ImageEncoder as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use std::io::Cursor;
use worldbend_core::{
    CanvasOperation, CanvasSpec, DeformationWorkSourceSpec, DeformationWorkSpec, ErrorCode,
    MeshWarpSpec, MockupClip, Point, RasterProgramSpec, RasterProgramStage, RectifySpec,
    RemapOperation, RemapSpec, ShapeFitDomainChoice, ShapeFitRefreshInput, Size,
    SurfaceDeformationSpec, TransformError, TransformResult, TransformSpec,
};

const RUNTIME: &str = include_str!("figma-runtime-linked-update.js");
const PUBLISH_RUNTIME: &str = include_str!("figma-runtime-linked-publish.js");
const FINALIZE_RUNTIME: &str = include_str!("figma-runtime-linked-finalize.js");
const CREATE_RUNTIME: &str = include_str!("figma-runtime-work-create.js");
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum LinkedKind {
    Transform,
    Rectify,
    Canvas,
    Mesh,
    Surface,
    Deformation,
    Mockup,
    Composition,
    Effect,
    Remap,
    Invalid,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkedItem {
    node_id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    #[schemars(length(max = 128))]
    name: String,
    kind: LinkedKind,
    revision: u64,
    expected: String,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(max = 64))]
    dependency_node_ids: Vec<String>,
    updatable: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkedPlan {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    source_node_id: String,
    #[schemars(length(max = 64))]
    items: Vec<LinkedItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Completion {
    node_id: String,
    revision: u64,
    expected: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum DeformationView {
    Pin,
    Mesh,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum DeformationTask {
    Mesh {
        spec: MeshWarpSpec,
    },
    Surface {
        spec: SurfaceDeformationSpec,
    },
    Deformation {
        view: DeformationView,
        spec: Box<DeformationWorkSpec>,
        #[serde(
            default,
            rename = "shapeGuideSourceIndex",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(range(min = 0, max = 1))]
        shape_guide_source_index: Option<u8>,
        #[serde(
            default,
            rename = "shapeGuideDomain",
            skip_serializing_if = "Option::is_none"
        )]
        shape_guide_domain: Option<ShapeFitDomainChoice>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum LinkedTask {
    Composition(FigmaCompositionTask),
    Effect(FigmaEffectTask),
    Deformation(Box<DeformationTask>),
    Remap(RemapTask),
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum RemapTask {
    Remap { spec: RemapSpec },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum LinkedOperation {
    Transform { spec: TransformSpec },
    Rectify { spec: RectifySpec },
    Canvas { spec: CanvasSpec },
    Task { task: LinkedTask },
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkCreateInput {
    file_key: String,
    page_id: String,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    operation: LinkedOperation,
    #[schemars(range(min = 1, max = 4096))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    render_width: Option<u32>,
    #[schemars(range(min = 1, max = 4096))]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    render_height: Option<u32>,
    #[schemars(
        length(min = 1, max = 80),
        regex(pattern = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
    )]
    request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(length(min = 1, max = 80))]
    name: Option<String>,
}

/// Create the same closed operation stored by the human raster authoring
/// entries. No geometry is reconstructed inside the Figma adapter.
pub fn create_work(input: WorkCreateInput) -> TransformResult<FigmaRequest> {
    for id in [&input.file_key, &input.page_id] {
        figma_handoff::identity(id)?;
    }
    if !(1..=8).contains(&input.source_node_ids.len())
        || input.source_node_ids.iter().collect::<HashSet<_>>().len() != input.source_node_ids.len()
        || input.render_width.is_some_and(|v| !(1..=4096).contains(&v))
        || input
            .render_height
            .is_some_and(|v| !(1..=4096).contains(&v))
        || input.request_id.is_empty()
        || input.request_id.len() > 80
        || !input
            .request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        || !input.request_id.as_bytes()[0].is_ascii_alphanumeric()
        || input
            .name
            .as_ref()
            .is_some_and(|v| v.trim().is_empty() || v.chars().count() > 80)
    {
        return Err(error(
            "Choose distinct bounded sources, dimensions and creation identity",
        ));
    }
    for id in &input.source_node_ids {
        figma_handoff::identity(id)?;
    }
    let (width, height) = match (input.render_width, input.render_height) {
        (Some(width), Some(height)) => (width, height),
        (None, None) if dynamic_canvas(&input.operation) => (1, 1),
        _ => {
            return Err(error(
                "Declare both output dimensions, or omit both for source-resolved Canvas",
            ));
        }
    };
    validate_work_operation(&input.operation, input.source_node_ids.len(), width, height)?;
    let file = json!(input.file_key);
    let page = json!(input.page_id);
    let arguments = json!(input);
    figma_handoff::bounded_request(FigmaRequest {
        file_key: input.file_key,
        skill_names: "figma-use",
        description: "Create linked raster work beside existing editable artwork; export the returned sources and finish core publication before claiming an image",
        code: format!(
            "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{CREATE_RUNTIME}\nreturn await WorldbendFigmaHandoff.createWork({arguments});"
        ),
        publication: None,
    })
}

pub(crate) fn dynamic_canvas(operation: &LinkedOperation) -> bool {
    matches!(operation, LinkedOperation::Canvas {spec} if matches!(spec.operation,
        CanvasOperation::Crop {..} | CanvasOperation::Trim {..} | CanvasOperation::Pad {..}))
}

pub(crate) fn validate_work_operation(
    operation: &LinkedOperation,
    source_count: usize,
    width: u32,
    height: u32,
) -> TransformResult<()> {
    use worldbend_core::{
        CoordinateSpace, PixelSize, SpatialTemplateOperation, SpatialTemplateOutput,
    };
    let size = Size::new(f64::from(width), f64::from(height));
    let validate_plane = |spec: &TransformSpec| {
        if spec.destination.space != CoordinateSpace::Normalized
            || spec.content.fit != worldbend_core::FitMode::Stretch
        {
            return Err(error("Figma work uses normalized authored coordinates"));
        }
        worldbend_core::solve_spec(spec, Some(size)).map(|_| ())
    };
    let single = || {
        if source_count == 1 {
            Ok(())
        } else {
            Err(error("This work requires one artwork source"))
        }
    };
    let target = |declared: Option<Size>| {
        if declared.is_none_or(|reference| {
            reference.width.is_finite()
                && reference.height.is_finite()
                && (0.01..=4096.0).contains(&reference.width)
                && (0.01..=4096.0).contains(&reference.height)
        }) {
            Ok(())
        } else {
            Err(error(
                "Use a valid deformation authoring reference independently from the output pixels",
            ))
        }
    };
    match operation {
        LinkedOperation::Transform { spec } => {
            single()?;
            validate_plane(spec)?;
        }
        LinkedOperation::Rectify { spec } => {
            single()?;
            if spec.source.space != CoordinateSpace::Normalized
                || spec.output != PixelSize::new(width, height)
            {
                return Err(error(
                    "Figma rectification uses normalized source corners and the declared output raster",
                ));
            }
            worldbend_core::rectify_plane(spec)?;
        }
        LinkedOperation::Task {
            task: LinkedTask::Remap(RemapTask::Remap { spec }),
        } => {
            let plan = worldbend_core::plan_remap(spec)?;
            if matches!(spec.operation, RemapOperation::DisplacementUnit { .. }) {
                return Err(error(
                    "Figma's saved remap controls use the eight-bit displacement family",
                ));
            }
            if spec.output != PixelSize::new(width, height)
                || source_count != if plan.requires_map { 2 } else { 1 }
            {
                return Err(error(
                    "Remap output and artwork/map source slots must match the declared work",
                ));
            }
        }
        LinkedOperation::Canvas { spec } => {
            single()?;
            spec.validate()?;
            if !dynamic_canvas(operation)
                && worldbend_core::plan_canvas(spec, PixelSize::new(1, 1))?.output_size
                    != PixelSize::new(width, height)
            {
                return Err(error("Canvas output must match the declared raster"));
            }
        }
        LinkedOperation::Task {
            task: LinkedTask::Effect(task),
        } => {
            figma_handoff::figma_effect_task(task)?;
            if task.recipe.layers.len() != source_count || task.recipe.viewport != size {
                return Err(error("Depth sources and viewport must match this work"));
            }
        }
        LinkedOperation::Task {
            task: LinkedTask::Composition(task),
        } => {
            figma_handoff::figma_mockup_task(task, source_count)?;
            let output = match task {
                FigmaCompositionTask::Mockup { spec } => {
                    Size::new(f64::from(spec.canvas.width), f64::from(spec.canvas.height))
                }
                FigmaCompositionTask::Composition {
                    template,
                    preview_output_id,
                    ..
                } => {
                    let SpatialTemplateOperation::CompositionProgram { postprocess, .. } =
                        &template.operation
                    else {
                        unreachable!()
                    };
                    let RasterProgramStage::Transform {
                        target_size: Some(base),
                        ..
                    } = &postprocess.stages[0]
                    else {
                        unreachable!()
                    };
                    match &template.output {
                        SpatialTemplateOutput::Single { .. } => *base,
                        SpatialTemplateOutput::CanvasSet { spec } => {
                            let p = worldbend_core::plan_canvas_set(
                                spec,
                                PixelSize::new(base.width as u32, base.height as u32),
                            )?;
                            let s = p
                                .variants
                                .iter()
                                .find(|v| &v.id == preview_output_id)
                                .ok_or_else(|| error("Missing selected output"))?
                                .plan
                                .output_size;
                            Size::new(f64::from(s.width), f64::from(s.height))
                        }
                    }
                }
            };
            if output != size {
                return Err(error(
                    "Selected Composition output must match the declared raster",
                ));
            }
        }
        LinkedOperation::Task {
            task: LinkedTask::Deformation(task),
        } => match task.as_ref() {
            DeformationTask::Mesh { spec } => {
                single()?;
                target(spec.target_size)?;
                validate_plane(&spec.transform)?;
                worldbend_core::plan_mesh_warp(spec)?;
            }
            DeformationTask::Surface { spec } => {
                single()?;
                target(spec.target_size)?;
                validate_plane(&spec.transform)?;
                worldbend_core::plan_surface_deformation(spec)?;
            }
            DeformationTask::Deformation {
                spec,
                shape_guide_source_index,
                shape_guide_domain,
                ..
            } => {
                target(spec.target_size)?;
                validate_plane(&spec.transform)?;
                if let Some(index) = shape_guide_source_index {
                    if *index > 1
                        || source_count != 2
                        || spec.shape_fit.as_ref().is_none_or(|fit| fit.clip.is_none())
                    {
                        return Err(error(
                            "Native fitting requires ordered artwork, guide and saved clip",
                        ));
                    }
                } else {
                    single()?;
                    if shape_guide_domain.is_some() {
                        return Err(error("A guide domain requires a bound native guide"));
                    }
                }
                worldbend_core::plan_deformation_work(spec)?;
            }
        },
    }
    Ok(())
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LinkedSnapshot {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    operation: LinkedOperation,
    #[schemars(length(min = 1, max = 200_000))]
    operation_json: String,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(min = 1, max = 8))]
    sources: Vec<FigmaMockupSource>,
    #[schemars(range(min = 1, max = 4096))]
    render_width: u32,
    #[schemars(range(min = 1, max = 4096))]
    render_height: u32,
    placement: FigmaPlacement,
    target_expected: String,
    expected: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape_guide_clip: Option<MockupClip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(
        length(min = 27, max = 48),
        regex(pattern = r"^hash32x2:[1-9][0-9]*:[0-9a-f]{16}$")
    )]
    source_state: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RasterTransport {
    #[default]
    Inline,
    Artifact,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
// Every action accepts a JSON object. Declare it at the root as required by
// the MCP schema helper; oneOf still supplies the closed action properties.
#[schemars(extend("type" = "object"))]
pub enum LinkedInput {
    Inspect {
        #[serde(rename = "fileKey")]
        file_key: String,
        #[serde(rename = "pageId")]
        page_id: String,
        #[serde(rename = "sourceNodeId")]
        source_node_id: String,
    },
    Read {
        plan: LinkedPlan,
        #[serde(rename = "nodeId")]
        node_id: String,
        #[serde(default)]
        #[schemars(length(max = 64))]
        completed: Vec<Completion>,
        #[serde(default, rename = "includeSourceRasters")]
        include_source_rasters: bool,
        #[serde(default, rename = "sourceRasterTransport")]
        source_raster_transport: RasterTransport,
    },
    Publish {
        plan: LinkedPlan,
        snapshot: Box<LinkedSnapshot>,
        #[serde(default)]
        #[schemars(length(max = 64))]
        completed: Vec<Completion>,
        #[schemars(length(min = 1, max = 8))]
        sources: Vec<FigmaMockupSourceRaster>,
    },
}

impl LinkedInput {
    pub fn with_workspace(
        mut self,
        root: Option<&worldbend_agent_fs::WorkspaceRoot>,
    ) -> TransformResult<Self> {
        if let Self::Publish { sources, .. } = &mut self {
            crate::figma_source_raster::hydrate_sources(sources, root)?;
        }
        Ok(self)
    }
}

fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
pub(crate) fn fingerprint(value: &str) -> TransformResult<()> {
    if !value.starts_with("hash32x2:") || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(error(
            "Use the actual bounded expected state from linked inspection",
        ));
    }
    Ok(())
}

fn validate_plan(
    plan: &LinkedPlan,
    node_id: &str,
    completed: &[Completion],
) -> TransformResult<()> {
    for id in [&plan.file_key, &plan.page_id, &plan.source_node_id, node_id] {
        figma_handoff::identity(id)?;
    }
    if plan.schema != "worldbend.figma.linked-update"
        || plan.version != "0.1"
        || plan.items.len() > 64
        || completed.len() > 64
    {
        return Err(error("Invalid bounded linked-update plan"));
    }
    let mut prior = HashSet::new();
    for item in &plan.items {
        figma_handoff::identity(&item.node_id)?;
        fingerprint(&item.expected)?;
        if item.revision == 0
            || item.revision >= MAX_REVISION
            || item.name.chars().count() > 128
            || item.source_node_ids.is_empty()
            || item.source_node_ids.len() > 8
            || item.source_node_ids.iter().collect::<HashSet<_>>().len()
                != item.source_node_ids.len()
            || item.source_node_ids.iter().any(|id| id == &item.node_id)
            || item
                .dependency_node_ids
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != item.dependency_node_ids.len()
            || item
                .dependency_node_ids
                .iter()
                .any(|id| !prior.contains(id))
            || !prior.insert(&item.node_id)
        {
            return Err(error(
                "Linked items require distinct sources and earlier prerequisites",
            ));
        }
        for id in &item.source_node_ids {
            figma_handoff::identity(id)?;
        }
    }
    let mut done = HashSet::new();
    for completion in completed {
        let item = plan
            .items
            .iter()
            .find(|item| item.node_id == completion.node_id)
            .ok_or_else(|| error("A completion must belong to this update"))?;
        fingerprint(&completion.expected)?;
        if completion.node_id == node_id
            || !done.insert(&completion.node_id)
            || !item.updatable
            || completion.revision != item.revision + 1
        {
            return Err(error(
                "Completion must identify one successful next revision of a prerequisite",
            ));
        }
    }
    if !plan
        .items
        .iter()
        .any(|item| item.node_id == node_id && item.updatable)
    {
        return Err(error("Choose an updatable item in this plan"));
    }
    Ok(())
}

fn compact_plan(plan: &LinkedPlan) -> TransformResult<serde_json::Value> {
    let mut value = serde_json::to_value(plan).map_err(|_| error("Plan serialization failed"))?;
    // Preserve all guard and dependency facts while omitting display labels
    // and repeated field names in the private prepared-request projection.
    value["rows"] = json!(
        plan.items
            .iter()
            .map(|item| json!([
                item.node_id,
                item.kind,
                item.revision,
                item.expected,
                item.source_node_ids,
                item.dependency_node_ids,
                item.updatable
            ]))
            .collect::<Vec<_>>()
    );
    value.as_object_mut().unwrap().remove("items");
    let rows = value["rows"].as_array().unwrap();
    let columns: Vec<_> = (0..7)
        .map(|column| {
            let values: Vec<_> = rows.iter().map(|row| row[column].clone()).collect();
            if column != 0 && !values.is_empty() && values.iter().all(|v| v == &values[0]) {
                json!({"constant": values[0]})
            } else {
                json!(values)
            }
        })
        .collect();
    let mut columnar = value.clone();
    columnar.as_object_mut().unwrap().remove("rows");
    columnar["columns"] = json!(columns);
    let wire_size = |v: &serde_json::Value| {
        serde_json::to_vec(&v.to_string())
            .map(|b| b.len())
            .map_err(|_| error("Plan serialization failed"))
    };
    Ok(if wire_size(&columnar)? < wire_size(&value)? {
        columnar
    } else {
        value
    })
}

pub fn prepare(input: LinkedInput) -> TransformResult<FigmaRequest> {
    match input {
        LinkedInput::Inspect {
            file_key,
            page_id,
            source_node_id,
        } => {
            for id in [&file_key, &page_id, &source_node_id] {
                figma_handoff::identity(id)?;
            }
            figma_handoff::bounded_request(FigmaRequest {
                file_key: file_key.clone(),
                skill_names: "figma-use",
                description: "Read all affected linked results in dependency order; no artwork or selection changes",
                code: format!(
                    "if(figma.fileKey!=={})throw Error('E_FIGMA_SCOPE');const page=await figma.getNodeByIdAsync({});if(!page||page.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(page);\n{RUNTIME}\nreturn await WorldbendFigmaHandoff.inspectLinkedResults({});",
                    json!(file_key),
                    json!(page_id),
                    json!({"fileKey":file_key,"pageId":page_id,"sourceNodeId":source_node_id})
                ),
                publication: None,
            })
        }
        LinkedInput::Read {
            plan,
            node_id,
            completed,
            include_source_rasters,
            source_raster_transport,
        } => {
            validate_plan(&plan, &node_id, &completed)?;
            let input = json!({"plan":compact_plan(&plan)?,"nodeId":node_id,"completed":completed,
                "includeSourceRasters":include_source_rasters,"sourceRasterTransport":source_raster_transport});
            let input = figma_handoff::packet_literal(&input)?;
            figma_handoff::read_request_runtime(
                plan.file_key,
                &plan.page_id,
                format!("inspectLinkedResult({input})"),
                "Read fresh source PNGs for one linked result after its verified prerequisites; preserve published work",
                RUNTIME,
            )
        }
        LinkedInput::Publish {
            plan,
            snapshot,
            completed,
            sources,
        } => {
            validate_plan(&plan, &snapshot.node_id, &completed)?;
            validate_snapshot(&plan, &snapshot)?;
            let image = render(&snapshot, &sources)?;
            if !dynamic_canvas(&snapshot.operation)
                && (image.width() != snapshot.render_width
                    || image.height() != snapshot.render_height)
            {
                return Err(error(
                    "The canonical refreshed raster must preserve this result's requested dimensions",
                ));
            }
            let mut png = Vec::new();
            image::codecs::png::PngEncoder::new_with_quality(
                &mut png,
                image::codecs::png::CompressionType::Fast,
                image::codecs::png::FilterType::Adaptive,
            )
            .write_image(
                image.as_raw(),
                image.width(),
                image.height(),
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|_| error("Unable to encode the refreshed PNG"))?;
            let mut arguments = json!({"plan":compact_plan(&plan)?,"completed":completed,"fileKey":snapshot.file_key,
                "pageId":snapshot.page_id,"nodeId":snapshot.node_id,"revision":snapshot.revision,"expected":snapshot.expected,
                "renderWidth":image.width(),"renderHeight":image.height(),
                "operationJson":snapshot.operation_json,"sources":snapshot.sources,
                "imageBase64":base64::engine::general_purpose::STANDARD.encode(png)});
            if let Some(clip) = &snapshot.shape_guide_clip {
                arguments["shapeGuideClip"] = json!(clip);
            }
            if let Some(state) = &snapshot.source_state {
                arguments["sourceState"] = json!(state);
            }
            let refreshed = refreshed_operation(&snapshot)?;
            if serde_json::to_value(&refreshed).ok()
                != serde_json::to_value(&snapshot.operation).ok()
            {
                arguments["refreshedTask"] = json!(refreshed)["task"].clone();
            }
            let mut request = figma_handoff::publication_request_runtime(
                snapshot.file_key,
                snapshot.page_id,
                snapshot.node_id,
                "publishLinkedImage",
                arguments,
                "Refresh one result through its saved canonical operation, preserving edits and verified dependency order",
                Some(PUBLISH_RUNTIME),
            )?;
            request
                .publication
                .as_mut()
                .expect("publication metadata")
                .finalizer = Some((FINALIZE_RUNTIME, "finishLinkedPublication"));
            Ok(request)
        }
    }
}

fn validate_snapshot(plan: &LinkedPlan, saved: &LinkedSnapshot) -> TransformResult<()> {
    fingerprint(&saved.expected)?;
    fingerprint(&saved.target_expected)?;
    if let Some(state) = &saved.source_state {
        fingerprint(state)?;
    }
    let item = plan
        .items
        .iter()
        .find(|item| item.node_id == saved.node_id)
        .unwrap();
    if saved.operation_json.len() > 200_000 {
        return Err(error(
            "Saved operation exceeds the bounded continuation size",
        ));
    }
    let original: LinkedOperation = serde_json::from_str(&saved.operation_json)
        .map_err(|_| error("Use the original operation JSON from inspection"))?;
    if serde_json::to_value(original).map_err(|_| error("Operation serialization failed"))?
        != serde_json::to_value(&saved.operation)
            .map_err(|_| error("Operation serialization failed"))?
    {
        return Err(error(
            "The typed operation must match the exact saved operation being refreshed",
        ));
    }
    if saved.schema != "worldbend.figma.linked-result"
        || saved.version != "0.1"
        || saved.file_key != plan.file_key
        || saved.page_id != plan.page_id
        || saved.revision != item.revision
        || saved.target_expected != item.expected
        || saved.source_node_ids != item.source_node_ids
        || saved.sources.len() != saved.source_node_ids.len()
        || !(1..=4096).contains(&saved.render_width)
        || !(1..=4096).contains(&saved.render_height)
        || ![
            saved.placement.x,
            saved.placement.y,
            saved.placement.width,
            saved.placement.height,
        ]
        .iter()
        .all(|x| x.is_finite())
        || saved.placement.width <= 0.0
        || saved.placement.height <= 0.0
    {
        return Err(error("Snapshot must match the current planned result"));
    }
    for (index, source) in saved.sources.iter().enumerate() {
        if source.node_id != saved.source_node_ids[index]
            || source.slot_id != format!("source-{}", index + 1)
            || !source.width.is_finite()
            || source.width <= 0.0
            || !source.height.is_finite()
            || source.height <= 0.0
            || source.name.chars().count() > 128
        {
            return Err(error(
                "Source summaries must match the bound slot identities",
            ));
        }
    }
    Ok(())
}

fn refreshed_operation(saved: &LinkedSnapshot) -> TransformResult<LinkedOperation> {
    refresh_operation(&saved.operation, saved.shape_guide_clip.as_ref())
}

pub(crate) fn refresh_operation(
    saved: &LinkedOperation,
    guide: Option<&MockupClip>,
) -> TransformResult<LinkedOperation> {
    let mut operation = saved.clone();
    if let LinkedOperation::Task {
        task: LinkedTask::Deformation(task),
    } = &mut operation
        && let DeformationTask::Deformation {
            spec,
            shape_guide_source_index,
            shape_guide_domain,
            ..
        } = task.as_mut()
        && shape_guide_source_index.is_some()
    {
        let clip = guide
            .cloned()
            .ok_or_else(|| error("Read the current bound native shape before refreshing"))?;
        let shape_fit = spec
            .shape_fit
            .clone()
            .ok_or_else(|| error("A bound native shape requires fitting controls"))?;
        let refreshed = worldbend_core::refresh_shape_fit(&ShapeFitRefreshInput {
            shape_fit,
            clip,
            domain: shape_guide_domain.clone(),
        })?;
        spec.shape_fit = Some(refreshed.shape_fit);
        *shape_guide_domain = Some(refreshed.domain);
        return Ok(operation);
    }
    if guide.is_some() {
        return Err(error(
            "Only a bound fitting task accepts current guide geometry",
        ));
    }
    Ok(operation)
}

fn render(
    saved: &LinkedSnapshot,
    sources: &[FigmaMockupSourceRaster],
) -> TransformResult<image::RgbaImage> {
    Ok(render_work_pixels(
        &saved.operation,
        &saved.sources,
        sources,
        saved.render_width,
        saved.render_height,
        saved.shape_guide_clip.as_ref(),
    )?
    .0)
}

fn deformation_work(task: &DeformationTask) -> TransformResult<DeformationWorkSpec> {
    Ok(match task {
        DeformationTask::Deformation { spec, .. } => spec.as_ref().clone(),
        DeformationTask::Mesh { spec } => {
            worldbend_core::migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(
                Box::new(spec.clone()),
            ))?
            .work
        }
        DeformationTask::Surface { spec } => {
            worldbend_core::migrate_deformation_work(
                &DeformationWorkSourceSpec::SurfaceDeformation(Box::new(spec.clone())),
            )?
            .work
        }
    })
}

#[derive(Debug, PartialEq, Serialize)]
pub(crate) struct DeformationCanvasFrame {
    origin: Point,
    reference: Size,
}
#[derive(Debug, Serialize)]
pub(crate) struct DeformationCanvasFrames {
    from: DeformationCanvasFrame,
    to: DeformationCanvasFrame,
}

pub(crate) fn deformation_canvas_frames(
    previous: Option<&LinkedOperation>,
    next: &LinkedOperation,
) -> TransformResult<Option<DeformationCanvasFrames>> {
    let (
        Some(previous),
        LinkedOperation::Task {
            task: LinkedTask::Deformation(next),
        },
    ) = (previous, next)
    else {
        return Ok(None);
    };
    let next = deformation_work(next)?;
    let frame = |work: &DeformationWorkSpec| -> TransformResult<DeformationCanvasFrame> {
        let plan = worldbend_core::plan_deformation_work(work)?;
        Ok(DeformationCanvasFrame {
            origin: plan
                .authored_view
                .map_or(Point::new(0.0, 0.0), |v| v.canvas_origin),
            reference: plan.mesh_warp.solve.resolved_destination.reference,
        })
    };
    let from = if let LinkedOperation::Task {
        task: LinkedTask::Deformation(task),
    } = previous
    {
        frame(&deformation_work(task)?)?
    } else {
        DeformationCanvasFrame {
            origin: Point::new(0.0, 0.0),
            reference: worldbend_core::solve_spec(&next.transform, next.target_size)?
                .resolved_destination
                .reference,
        }
    };
    let to = frame(&next)?;
    Ok((from != to).then_some(DeformationCanvasFrames { from, to }))
}

fn render_work_pixels(
    operation: &LinkedOperation,
    inspected_sources: &[FigmaMockupSource],
    sources: &[FigmaMockupSourceRaster],
    width: u32,
    height: u32,
    guide: Option<&MockupClip>,
) -> TransformResult<(image::RgbaImage, LinkedOperation)> {
    let refreshed = refresh_operation(operation, guide)?;
    let quality = work_render_quality(&refreshed);
    if sources.len() != inspected_sources.len() {
        return Err(error("Supply every inspected PNG once in slot order"));
    }
    let mut decoded = Vec::new();
    let mut total_pixels = 0_u64;
    let needs_decoded = !matches!(
        operation,
        LinkedOperation::Task {
            task: LinkedTask::Composition(_)
        }
    );
    for (index, source) in sources.iter().enumerate() {
        if source.slot_id() != inspected_sources[index].slot_id {
            return Err(error("PNG slots must follow the inspected binding order"));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(source.base64()?)
            .map_err(|_| error("Invalid PNG base64"))?;
        if figma_handoff::source_preview_fingerprint(&bytes)
            != inspected_sources[index].preview_fingerprint
        {
            return Err(error("PNG bytes differ from the actual inspected sources"));
        }
        let (width, height) =
            image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png)
                .into_dimensions()
                .map_err(|_| error("Supply real PNG source artifacts"))?;
        total_pixels += u64::from(width) * u64::from(height);
        if width == 0
            || height == 0
            || width > 8192
            || height > 8192
            || total_pixels > 32 * 1024 * 1024
        {
            return Err(error("Source rasters exceed the bounded refresh capacity"));
        }
        if needs_decoded {
            decoded.push(
                image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                    .map_err(|_| error("Supply real PNG source artifacts"))?,
            );
        }
    }
    let single = || {
        decoded
            .first()
            .filter(|_| decoded.len() == 1)
            .ok_or_else(|| error("This operation requires one bound source"))
    };
    let image = match &refreshed {
        LinkedOperation::Transform { spec } => Ok(worldbend_render::render_image(
            single()?,
            spec,
            worldbend_render::RenderOptions {
                quality,
                canvas: worldbend_render::CanvasMode::Reference,
                target_size: Some(Size::new(f64::from(width), f64::from(height))),
                ..Default::default()
            },
        )?
        .image),
        LinkedOperation::Rectify { spec } => {
            if spec.source.space != worldbend_core::CoordinateSpace::Normalized {
                return Err(error("Figma rectification uses normalized source corners"));
            }
            Ok(worldbend_render::rectify_image(
                single()?,
                spec,
                worldbend_render::RectifyRenderOptions {
                    quality,
                    ..Default::default()
                },
            )?
            .image)
        }
        LinkedOperation::Task {
            task: LinkedTask::Remap(RemapTask::Remap { spec }),
        } => {
            validate_work_operation(&refreshed, decoded.len(), width, height)?;
            Ok(worldbend_render::render_remap(
                &decoded[0],
                decoded.get(1),
                spec,
                worldbend_render::RemapRenderOptions {
                    quality,
                    ..Default::default()
                },
            )?
            .image)
        }
        LinkedOperation::Canvas { spec } => Ok(worldbend_render::render_raster_program(
            single()?,
            &RasterProgramSpec {
                schema: worldbend_core::RASTER_PROGRAM_SCHEMA.into(),
                version: worldbend_core::RASTER_PROGRAM_VERSION.into(),
                stages: vec![RasterProgramStage::Canvas {
                    id: "output".into(),
                    spec: spec.clone(),
                }],
            },
            Default::default(),
        )?
        .image),
        LinkedOperation::Task {
            task: LinkedTask::Composition(task),
        } => {
            figma_handoff::figma_mockup_task(task, sources.len())?;
            figma_handoff::render_composition_image(task, sources)
        }
        LinkedOperation::Task {
            task: LinkedTask::Effect(task),
        } => {
            figma_handoff::figma_effect_task(task)?;
            if task.recipe.layers.len() != decoded.len() {
                return Err(error("Depth layers must match all bound sources"));
            }
            let images = task
                .recipe
                .layers
                .iter()
                .zip(decoded)
                .map(|(layer, image)| (layer.id.clone(), image))
                .collect();
            Ok(worldbend_render::render_effect(
                &images,
                &task.recipe,
                &task.state,
                Default::default(),
            )?
            .image)
        }
        LinkedOperation::Task {
            task: LinkedTask::Deformation(task),
        } => {
            let work = deformation_work(task)?;
            let artwork = match task.as_ref() {
                DeformationTask::Deformation {
                    shape_guide_source_index: Some(index),
                    ..
                } => {
                    if *index > 1
                        || decoded.len() != 2
                        || work.shape_fit.as_ref().is_none_or(|fit| fit.clip.is_none())
                    {
                        return Err(error(
                            "A native fitted work requires one artwork, one guide and its complete saved mask",
                        ));
                    }
                    &decoded[1 - usize::from(*index)]
                }
                _ => single()?,
            };
            Ok(
                worldbend_render::render_deformation_work_reference_with_cancel(
                    artwork,
                    &work,
                    worldbend_core::PixelSize::new(width, height),
                    worldbend_render::MeshWarpRenderOptions {
                        quality,
                        ..Default::default()
                    },
                    &|| false,
                )?
                .image,
            )
        }
    }?;
    if image.width() > 4096 || image.height() > 4096 {
        return Err(error("Resolved Figma work exceeds the 4096 px output axis"));
    }
    if !dynamic_canvas(operation) && (image.width() != width || image.height() != height) {
        return Err(error(
            "Rendered work must match the saved or proposed raster dimensions",
        ));
    }
    Ok((image, refreshed))
}

/// Sampling of published work, shared with portable continuation.
pub(crate) fn work_render_quality(
    operation: &LinkedOperation,
) -> worldbend_render::SamplingQuality {
    match operation {
        LinkedOperation::Canvas { .. }
        | LinkedOperation::Task {
            task: LinkedTask::Composition(_) | LinkedTask::Effect(_),
        } => worldbend_render::SamplingQuality::Standard,
        _ => worldbend_render::SamplingQuality::High,
    }
}

/// Render the actual proposed operation/media through the shared linked kernel.
pub(crate) fn render_work_revision(
    operation: LinkedOperation,
    inspected_sources: Vec<FigmaMockupSource>,
    sources: &[FigmaMockupSourceRaster],
    width: u32,
    height: u32,
    guide: Option<MockupClip>,
) -> TransformResult<(image::RgbaImage, LinkedOperation)> {
    validate_work_operation(&operation, inspected_sources.len(), width, height)?;
    let (image, refreshed) = render_work_pixels(
        &operation,
        &inspected_sources,
        sources,
        width,
        height,
        guide.as_ref(),
    )?;
    Ok((image, refreshed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{Point, Quad, WarpMesh, WarpVertex};

    fn png(color: [u8; 4]) -> String {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba(color));
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(image.as_raw(), 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }

    fn input() -> serde_json::Value {
        let encoded = png([200, 40, 20, 255]);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        let operation = json!({"kind":"transform","spec":TransformSpec::normalized(Quad::unit())});
        let expected = "hash32x2:1200:0123456789abcdef";
        json!({"action":"publish","plan":{"schema":"worldbend.figma.linked-update","version":"0.1",
            "fileKey":"file","pageId":"page","sourceNodeId":"source","items":[
                {"nodeId":"result","name":"Result","kind":"transform","revision":1,"expected":expected,
                 "sourceNodeIds":["source"],"dependencyNodeIds":[],"updatable":true}]},
            "snapshot":{"schema":"worldbend.figma.linked-result","version":"0.1","fileKey":"file","pageId":"page","nodeId":"result",
                "revision":1,"operation":operation,"operationJson":operation.to_string(),"sourceNodeIds":["source"],
                "sources":[{"slotId":"source-1","nodeId":"source","name":"Original","width":4,"height":4,
                    "previewFingerprint":figma_handoff::source_preview_fingerprint(&bytes)}],
                "renderWidth":4,"renderHeight":4,"placement":{"x":0,"y":0,"width":4,"height":4},
                "targetExpected":expected,"expected":expected},"completed":[],"sources":[{"slotId":"source-1","base64":encoded}]})
    }

    fn replace_operation(value: &mut serde_json::Value, operation: serde_json::Value) {
        value["snapshot"]["operationJson"] = json!(operation.to_string());
        value["snapshot"]["operation"] = operation;
    }

    #[test]
    fn rectification_and_both_remap_families_use_actual_ordered_pixels_and_core_controls() {
        let image = image::RgbaImage::from_fn(4, 4, |x, y| {
            image::Rgba([x as u8 * 40, y as u8 * 30, 9, 255])
        });
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(image.as_raw(), 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let rect = json!({"kind":"rectify","spec":{"schema":"worldbend.rectify","version":"0.1",
            "source":{"space":"normalized","quad":{"tl":{"x":0.5,"y":0},"tr":{"x":1,"y":0},"br":{"x":1,"y":1},"bl":{"x":0.5,"y":1}}},
            "output":{"width":2,"height":4}}});
        let lens = json!({"kind":"task","task":{"kind":"remap","spec":{"schema":"worldbend.remap","version":"0.1","output":{"width":4,"height":4},
            "operation":{"kind":"lens","coefficients":{"k1":0,"k2":0,"k3":0,"p1":0,"p2":0},"center":{"x":0.5,"y":0.5},"scale":{"x":0.5,"y":0.5}}}}});
        let displacement = json!({"kind":"task","task":{"kind":"remap","spec":{"schema":"worldbend.remap","version":"0.1","output":{"width":4,"height":4},
            "operation":{"kind":"displacement","xChannel":"red","yChannel":"green","scaleXPixels":2,"scaleYPixels":0,"neutral":128,"boundary":"clamp"}}}});
        for (operation, count, width) in [(rect, 1, 2), (lens, 1, 4), (displacement, 2, 4)] {
            let create = json!({"fileKey":"file","pageId":"page","sourceNodeIds":if count==1 {vec!["source"]} else {vec!["source","map"]},
                "operation":operation,"renderWidth":width,"renderHeight":4,"requestId":"new-family"});
            assert!(create_work(serde_json::from_value(create.clone()).unwrap()).is_ok());
            let mut mismatch = create.clone();
            mismatch["renderWidth"] = json!(width + 1);
            assert!(create_work(serde_json::from_value(mismatch).unwrap()).is_err());
            let mut mismatch = create;
            mismatch["sourceNodeIds"] = json!(if count == 1 {
                vec!["source", "map"]
            } else {
                vec!["source"]
            });
            assert!(create_work(serde_json::from_value(mismatch).unwrap()).is_err());
            let mut value = input();
            replace_operation(&mut value, operation.clone());
            value["sources"][0]["base64"] = json!(encoded);
            value["snapshot"]["sources"][0]["previewFingerprint"] =
                json!(figma_handoff::source_preview_fingerprint(&bytes));
            if count == 2 {
                let neutral = png([128, 128, 128, 255]);
                let map_bytes = base64::engine::general_purpose::STANDARD
                    .decode(&neutral)
                    .unwrap();
                value["sources"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"slotId":"source-2","base64":neutral}));
                value["snapshot"]["sources"].as_array_mut().unwrap().push(
                    json!({"slotId":"source-2","nodeId":"map","name":"Map","width":4,"height":4,
                    "previewFingerprint":figma_handoff::source_preview_fingerprint(&map_bytes)}),
                );
            }
            let LinkedInput::Publish {
                snapshot, sources, ..
            } = serde_json::from_value(value).unwrap()
            else {
                panic!()
            };
            let op: LinkedOperation = serde_json::from_value(operation).unwrap();
            let (rendered, _) = render_work_revision(
                op.clone(),
                snapshot.sources.clone(),
                &sources,
                width,
                4,
                None,
            )
            .unwrap();
            if width == 2 {
                assert_eq!(rendered.get_pixel(0, 2).0, [80, 60, 9, 255]);
                assert_eq!(rendered.get_pixel(1, 3).0, [120, 90, 9, 255]);
            } else {
                assert_eq!(rendered, image);
            }
            if count == 2 {
                let mut shifted_sources = sources.clone();
                shifted_sources[1] = serde_json::from_value(
                    json!({"slotId":"source-2","base64":png([255, 128, 128, 255])}),
                )
                .unwrap();
                assert!(
                    render_work_revision(
                        op.clone(),
                        snapshot.sources.clone(),
                        &shifted_sources,
                        width,
                        4,
                        None
                    )
                    .is_err()
                );
                let mut facts = snapshot.sources;
                let map_bytes = base64::engine::general_purpose::STANDARD
                    .decode(shifted_sources[1].base64().unwrap())
                    .unwrap();
                facts[1].preview_fingerprint =
                    figma_handoff::source_preview_fingerprint(&map_bytes);
                let (shifted, _) =
                    render_work_revision(op, facts, &shifted_sources, width, 4, None).unwrap();
                assert_ne!(shifted, rendered);
            }
        }
    }

    #[test]
    fn dynamic_canvas_resolves_actual_alpha_crop_and_padding_without_output_guesses() {
        let source = image::RgbaImage::from_fn(4, 4, |x, y| {
            image::Rgba(if (x, y) == (1, 1) {
                [100, 20, 30, 80]
            } else if (x, y) == (2, 2) {
                [200, 40, 50, 255]
            } else {
                [0, 0, 0, 0]
            })
        });
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(source.as_raw(), 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        for (operation, expected) in [
            (json!({"kind":"trim","alphaThreshold":0}), (2, 2)),
            (json!({"kind":"trim","alphaThreshold":128}), (1, 1)),
            (
                json!({"kind":"crop","rect":{"x":1,"y":1,"width":2,"height":2}}),
                (2, 2),
            ),
            (
                json!({"kind":"pad","insets":{"top":1,"right":2,"bottom":3,"left":4},"background":{"kind":"color","space":"srgb8","rgba":[20,30,40,255]}}),
                (10, 8),
            ),
        ] {
            let op = json!({"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1","operation":operation}});
            let create = json!({"fileKey":"file","pageId":"page","sourceNodeIds":["source"],"requestId":"dynamic-canvas","operation":op});
            assert!(create_work(serde_json::from_value(create.clone()).unwrap()).is_ok());
            let mut incomplete = create;
            incomplete["renderWidth"] = json!(4);
            assert!(create_work(serde_json::from_value(incomplete).unwrap()).is_err());
            let mut value = input();
            replace_operation(&mut value, op);
            value["sources"][0]["base64"] = json!(encoded);
            value["snapshot"]["sources"][0]["previewFingerprint"] =
                json!(figma_handoff::source_preview_fingerprint(&bytes));
            let snapshot: LinkedSnapshot =
                serde_json::from_value(value["snapshot"].clone()).unwrap();
            let rasters: Vec<FigmaMockupSourceRaster> =
                serde_json::from_value(value["sources"].clone()).unwrap();
            let image = render(&snapshot, &rasters).unwrap();
            assert_eq!((image.width(), image.height()), expected);
            if operation["kind"] == "pad" {
                assert_eq!(image.get_pixel(0, 0).0, [20, 30, 40, 255]);
                assert_eq!(image.get_pixel(6, 3).0, [200, 40, 50, 255]);
            } else {
                assert_eq!(
                    image.get_pixel(expected.0 - 1, expected.1 - 1).0,
                    [200, 40, 50, 255]
                );
            }
            let request = prepare(serde_json::from_value(value).unwrap()).unwrap();
            assert_eq!(
                request.publication.unwrap().arguments["renderWidth"],
                json!(expected.0)
            );
        }
    }

    #[test]
    fn cold_work_uses_core_geometry_and_closed_creation_arguments() {
        let base = json!({"fileKey":"file","pageId":"page","sourceNodeIds":["source"],
            "operation":input()["snapshot"]["operation"],"renderWidth":4,"renderHeight":4,"requestId":"weekly-screen"});
        let request = create_work(serde_json::from_value(base.clone()).unwrap()).unwrap();
        assert!(figma_handoff::test_code(&request).contains("createWork("));
        assert!(figma_handoff::test_code(&request).contains("setCurrentPageAsync"));
        for key in ["requestId", "renderWidth", "sourceNodeIds", "quad"] {
            let mut invalid = base.clone();
            match key {
                "requestId" => invalid[key] = json!("bad identity"),
                "renderWidth" => invalid[key] = json!(4097),
                "sourceNodeIds" => invalid[key] = json!(["source", "source"]),
                "quad" => {
                    invalid["operation"]["spec"]["destination"]["quad"]["tr"] = json!({"x":0,"y":0})
                }
                _ => unreachable!(),
            }
            assert!(
                create_work(serde_json::from_value(invalid).unwrap()).is_err(),
                "{key}"
            );
        }
        let mut invalid = base.clone();
        invalid["extra"] = json!(true);
        assert!(serde_json::from_value::<WorkCreateInput>(invalid).is_err());
        let mut canvas = base.clone();
        canvas["operation"] = json!({"kind":"canvas","spec":{
            "schema":"worldbend.canvas","version":"0.1","operation":{"kind":"stretch","output":{"width":5,"height":4}}}});
        assert!(create_work(serde_json::from_value(canvas.clone()).unwrap()).is_err());
        canvas["renderWidth"] = json!(5);
        assert!(create_work(serde_json::from_value(canvas).unwrap()).is_ok());
    }

    #[test]
    fn linked_refresh_rejects_output_pixels_that_disagree_with_the_saved_binding() {
        for operation in [
            json!({"kind":"rectify","spec":RectifySpec::normalized(Quad::unit(),worldbend_core::PixelSize::new(2,4))}),
            json!({"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1","operation":{"kind":"stretch","output":{"width":2,"height":4}}}}),
        ] {
            let mut value = input();
            replace_operation(&mut value, operation);
            assert!(prepare(serde_json::from_value(value).unwrap()).is_err());
        }
    }

    #[test]
    fn longest_transform_creation_arguments_fit_without_relaxing_the_packet_limit() {
        let value = json!({"fileKey":"f".repeat(256),"pageId":"p".repeat(256),"sourceNodeIds":["s".repeat(256)],
            "operation":input()["snapshot"]["operation"],"renderWidth":4096,"renderHeight":4096,
            "requestId":"r".repeat(80),"name":"界".repeat(80)});
        let request = create_work(serde_json::from_value(value).unwrap()).unwrap();
        assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
    }

    #[test]
    fn refreshes_saved_pixels_and_carries_exact_operation_and_png_proof_into_the_guarded_request() {
        let value = input();
        let LinkedInput::Publish {
            snapshot, sources, ..
        } = serde_json::from_value(value.clone()).unwrap()
        else {
            panic!()
        };
        assert_eq!(
            render(&snapshot, &sources).unwrap().get_pixel(1, 1).0,
            [200, 40, 20, 255]
        );
        let request = prepare(serde_json::from_value(value).unwrap()).unwrap();
        let data = request.publication.unwrap();
        assert_eq!(data.publisher, "publishLinkedImage");
        assert_eq!(data.arguments["operationJson"], snapshot.operation_json);
        assert_eq!(
            data.arguments["sources"][0]["previewFingerprint"],
            snapshot.sources[0].preview_fingerprint
        );
        assert!(data.runtime.unwrap().contains("publishLinkedImage"));
    }

    #[test]
    fn workspace_png_publication_matches_inline_and_rejects_a_changed_file() {
        let inline = input();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(inline["sources"][0]["base64"].as_str().unwrap())
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("source.png"), bytes).unwrap();
        let root = worldbend_agent_fs::WorkspaceRoot::open(dir.path()).unwrap();
        let mut file = inline.clone();
        file["sources"][0] = json!({"slotId":"source-1","path":"source.png"});
        let prepare_file = || {
            prepare(
                serde_json::from_value::<LinkedInput>(file.clone())
                    .unwrap()
                    .with_workspace(Some(&root))
                    .unwrap(),
            )
        };
        let expected = prepare(serde_json::from_value(inline).unwrap())
            .unwrap()
            .publication
            .unwrap()
            .arguments;
        assert_eq!(
            prepare_file().unwrap().publication.unwrap().arguments,
            expected
        );
        let changed = base64::engine::general_purpose::STANDARD
            .decode(png([0, 0, 200, 255]))
            .unwrap();
        std::fs::write(dir.path().join("source.png"), changed).unwrap();
        assert!(prepare_file().is_err());
    }

    #[test]
    fn native_state_freshness_chooses_its_bounded_projection_without_weakening_png_correlation() {
        let mut value = input();
        let state = "hash32x2:70147:23c12f94cc81d29b";
        value["snapshot"]["sourceState"] = json!(state);
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let publication = request.publication.unwrap();
        assert_eq!(publication.arguments["sourceState"], state);
        assert_eq!(publication.finalizer.unwrap().0, FINALIZE_RUNTIME);
        value["sources"][0]["base64"] = json!(png([0, 0, 200, 255]));
        assert!(prepare(serde_json::from_value(value.clone()).unwrap()).is_err());
        value["snapshot"]["sourceState"] = json!("not-a-proof");
        assert!(prepare(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn closes_all_action_variants_and_rejects_changed_operation_bytes_and_source_correlations() {
        let base = input();
        for mutate in [
            "scope",
            "revision",
            "operation",
            "png",
            "slot",
            "completion",
        ] {
            let mut value = base.clone();
            match mutate {
                "scope" => value["snapshot"]["fileKey"] = json!("another-file"),
                "revision" => value["snapshot"]["revision"] = json!(2),
                "operation" => {
                    value["snapshot"]["operation"]["spec"]["destination"]["quad"]["tl"]["x"] =
                        json!(0.1)
                }
                "png" => value["sources"][0]["base64"] = json!(png([0, 0, 200, 255])),
                "slot" => value["sources"][0]["slotId"] = json!("source-2"),
                "completion" => {
                    value["completed"] = json!([{"nodeId":"result","revision":2,"expected":"hash32x2:1:0123456789abcdef"}])
                }
                _ => unreachable!(),
            }
            assert!(
                prepare(serde_json::from_value(value).unwrap()).is_err(),
                "{mutate}"
            );
        }
        for mut value in [
            base,
            json!({"action":"inspect","fileKey":"file","pageId":"page","sourceNodeId":"source"}),
        ] {
            value["extra"] = json!(true);
            assert!(serde_json::from_value::<LinkedInput>(value).is_err());
        }
    }

    #[test]
    fn runs_fixed_sizes_and_loss_free_mesh_lifts_through_the_canonical_renderers() {
        let mut value = input();
        replace_operation(
            &mut value,
            json!({"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1",
            "operation":{"kind":"stretch","output":{"width":4,"height":4}}}}),
        );
        assert!(prepare(serde_json::from_value(value.clone()).unwrap()).is_ok());
        let spec = MeshWarpSpec {
            schema: "worldbend.mesh-warp".into(),
            version: "0.1".into(),
            transform: TransformSpec::normalized(Quad::unit()),
            target_size: Some(Size::new(4.0, 4.0)),
            mesh: WarpMesh {
                boundary: Default::default(),
                shading: None,
                topology: worldbend_core::WarpMeshTopology::Grid { subdivisions: 2 },
                vertices: (0..=2)
                    .flat_map(|y| {
                        (0..=2).map(move |x| {
                            let p = Point::new(f64::from(x) / 2.0, f64::from(y) / 2.0);
                            WarpVertex {
                                source: p,
                                warped: p,
                            }
                        })
                    })
                    .collect(),
            },
        };
        replace_operation(
            &mut value,
            json!({"kind":"task","task":{"kind":"mesh","spec":spec}}),
        );
        assert!(prepare(serde_json::from_value(value.clone()).unwrap()).is_ok());
        let work = worldbend_core::migrate_deformation_work(&DeformationWorkSourceSpec::MeshWarp(
            Box::new(spec),
        ))
        .unwrap()
        .work;
        replace_operation(
            &mut value,
            json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":work}}),
        );
        assert!(prepare(serde_json::from_value(value).unwrap()).is_ok());
    }

    #[test]
    fn hd_deformation_refresh_keeps_authored_coordinates_and_complete_saved_raster() {
        let points: Vec<_> = (0..4)
            .flat_map(|row| {
                (0..4).map(move |column| {
                    Point::new(
                        f64::from(column) / 3.0,
                        match (row, column) {
                            (0, 1 | 2) => -0.2,
                            (3, 1 | 2) => 1.2,
                            _ => f64::from(row) / 3.0,
                        },
                    )
                })
            })
            .collect();
        let operation = json!({"kind":"task","task":{"kind":"deformation","view":"pin","spec":{
            "schema":"worldbend.deformation-work","version":"0.1","transform":TransformSpec::normalized(Quad::unit()),
            "targetSize":{"width":4,"height":4},"boundary":"free","meshSubdivisions":4,
            "surface":{"envelope":{"columns":1,"rows":1,"points":points}}
        }}});
        let mut value = input();
        replace_operation(&mut value, operation.clone());
        value["snapshot"]["renderWidth"] = json!(8);
        value["snapshot"]["renderHeight"] = json!(12);
        let LinkedInput::Publish {
            snapshot, sources, ..
        } = serde_json::from_value(value).unwrap()
        else {
            panic!()
        };
        let (image, retained) =
            render_work_revision(snapshot.operation, snapshot.sources, &sources, 8, 12, None)
                .unwrap();
        assert_eq!(image.dimensions(), (8, 12));
        let canonical: LinkedOperation = serde_json::from_value(operation).unwrap();
        assert_eq!(
            serde_json::to_value(retained).unwrap(),
            serde_json::to_value(canonical).unwrap()
        );
        assert_eq!(image.get_pixel(4, 6).0, [200, 40, 20, 255]);
        assert!(image.get_pixel(0, 0).0[3] < 255);
    }

    #[test]
    fn native_fit_roles_render_the_artwork_in_both_binding_orders_and_reject_bad_provenance() {
        let contour = json!({"start":{"x":0,"y":0},"segments":[
            {"kind":"line","to":{"x":1,"y":0}},{"kind":"line","to":{"x":1,"y":1}},
            {"kind":"line","to":{"x":0,"y":1}}]});
        let work = json!({"schema":"worldbend.deformation-work","version":"0.1",
            "transform":TransformSpec::normalized(Quad::unit()),"targetSize":{"width":4,"height":4},
            "meshSubdivisions":4,"shapeFit":{"contour":contour,"clip":{"contours":[contour],"fillRule":"nonZero"}}});
        for guide in [0, 1] {
            let mut value = input();
            replace_operation(
                &mut value,
                json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":work,"shapeGuideSourceIndex":guide}}),
            );
            let ids = if guide == 0 {
                vec!["guide", "source"]
            } else {
                vec!["source", "guide"]
            };
            value["plan"]["items"][0]["sourceNodeIds"] = json!(ids);
            value["snapshot"]["sourceNodeIds"] = json!(ids);
            value["snapshot"]["shapeGuideClip"] =
                value["snapshot"]["operation"]["task"]["spec"]["shapeFit"]["clip"].clone();
            let rasters:Vec<_>=ids.iter().enumerate().map(|(index,id)| {
                let encoded=png(if *id=="source" {[200,40,20,255]} else {[0,0,200,255]});
                let bytes=base64::engine::general_purpose::STANDARD.decode(&encoded).unwrap();
                (json!({"slotId":format!("source-{}",index+1),"nodeId":id,"name":id,"width":4,"height":4,
                    "previewFingerprint":figma_handoff::source_preview_fingerprint(&bytes)}),
                 json!({"slotId":format!("source-{}",index+1),"base64":encoded}))
            }).collect();
            value["snapshot"]["sources"] =
                json!(rasters.iter().map(|pair| &pair.0).collect::<Vec<_>>());
            value["sources"] = json!(rasters.iter().map(|pair| &pair.1).collect::<Vec<_>>());
            let LinkedInput::Publish {
                snapshot, sources, ..
            } = serde_json::from_value(value.clone()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                render(&snapshot, &sources).unwrap().get_pixel(1, 1).0,
                [200, 40, 20, 255]
            );
            let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
            assert_eq!(
                request.publication.unwrap().arguments["operationJson"],
                snapshot.operation_json
            );
            let mut changed = value.clone();
            changed["snapshot"]["shapeGuideClip"]["contours"][0]["segments"][1]["to"]["x"] =
                json!(0.5);
            let LinkedInput::Publish {
                snapshot: changed_snapshot,
                sources: changed_sources,
                ..
            } = serde_json::from_value(changed.clone()).unwrap()
            else {
                panic!()
            };
            assert_eq!(
                render(&changed_snapshot, &changed_sources)
                    .unwrap()
                    .get_pixel(3, 3)
                    .0[3],
                0
            );
            let refreshed = prepare(serde_json::from_value(changed).unwrap())
                .unwrap()
                .publication
                .unwrap()
                .arguments;
            assert_eq!(refreshed["operationJson"], snapshot.operation_json);
            assert_eq!(
                refreshed["refreshedTask"]["spec"]["shapeFit"]["contour"]["segments"][1]["to"]["x"],
                json!(0.5)
            );
            assert_eq!(
                refreshed["refreshedTask"]["shapeGuideDomain"],
                json!({"kind":"nativeContour","contourIndex":0})
            );
            for mutation in ["index", "mask", "binding"] {
                let mut bad = value.clone();
                if mutation == "index" {
                    bad["snapshot"]["operation"]["task"]["shapeGuideSourceIndex"] = json!(2);
                }
                if mutation == "mask" {
                    bad["snapshot"]["operation"]["task"]["spec"]["shapeFit"]
                        .as_object_mut()
                        .unwrap()
                        .remove("clip");
                }
                bad["snapshot"]["operationJson"] = json!(bad["snapshot"]["operation"].to_string());
                if mutation == "binding" {
                    bad["snapshot"]["sourceNodeIds"] = json!(["source"]);
                }
                assert!(
                    prepare(serde_json::from_value(bad).unwrap()).is_err(),
                    "{mutation}"
                );
            }
        }
    }

    #[test]
    fn handles_all_64_results_without_transmitting_long_unicode_labels_in_each_read() {
        let mut value = input()["plan"].clone();
        let first = value["items"][0].clone();
        value["items"] = json!(
            (0..64)
                .map(|index| {
                    let mut item = first.clone();
                    item["nodeId"] = json!(format!("result-{index}"));
                    item["name"] = json!("😀".repeat(128));
                    item["expected"] = json!(format!(
                        "hash32x2:{}:{:08x}{:08x}",
                        1200 + index,
                        (index as u32).wrapping_mul(2_654_435_761),
                        (index as u32).wrapping_mul(2_246_822_519)
                    ));
                    item
                })
                .collect::<Vec<_>>()
        );
        let request = prepare(
            serde_json::from_value(json!({"action":"read","plan":value,"nodeId":"result-0",
            "includeSourceRasters":true,"sourceRasterTransport":"artifact"}))
            .unwrap(),
        )
        .unwrap();
        assert!(serde_json::to_vec(&request).unwrap().len() <= 49152);
        assert!(!request.code.contains('😀'));
        assert!(figma_handoff::test_code(&request).contains("sourceRasterTransport"));
    }
}

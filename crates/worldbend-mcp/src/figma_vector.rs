//! Native capture stays with the host; full canonical projection stays in core.
use crate::{
    figma_exact_json::{self, ExactJsonEnvelope},
    figma_handoff::{self, FigmaPlacement, FigmaRequest},
    figma_linked::{self, DeformationTask, LinkedOperation, LinkedTask},
};
use base64::Engine as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use worldbend_core::{
    Bounds, CoordinateSpace, ErrorCode, MAX_VECTOR_ARTWORK_PARTS, Size, TransformError,
    TransformResult, TransformSpec, VectorArtworkPart, VectorArtworkProjectionInput,
    VectorOperation, VectorOperationInput, VectorPathRegion, VectorPathSegment, VectorPathSpec,
    VectorPathVertex, VectorStrokeCap, VectorStrokeJoin, VectorStrokeSpec, plan_vector_artwork,
    plan_vector_operation,
};
const CREATE: &str = include_str!("figma-runtime-vector-create.js");
const INITIALIZE: &str = include_str!("figma-runtime-vector-initialize.js");
const STATE: &str = include_str!("figma-runtime-vector-state.js");
const READ: &str = include_str!("figma-runtime-vector-read.js");
const READ_PAGE: &str = include_str!("figma-runtime-vector-read-page.js");
const PUBLISH: &str = include_str!("figma-runtime-vector-publish.js");
const VALIDATE: &str = include_str!("figma-runtime-vector-validate.js");
const FINALIZE: &str = include_str!("figma-runtime-vector-finalize.js");
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
enum VectorSourceSelection {
    Automatic,
    Explicit,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorSourceView {
    policy: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selection: Option<VectorSourceSelection>,
    bounds: Bounds,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    reported_bounds: Option<Bounds>,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorSnapshot {
    pub(crate) schema: String,
    pub(crate) version: String,
    pub(crate) file_key: String,
    pub(crate) page_id: String,
    pub(crate) node_id: String,
    #[schemars(range(min = 0, max = 9007199254740990_u64))]
    pub(crate) revision: u64,
    pub(crate) published: bool,
    pub(crate) spec: TransformSpec,
    pub(crate) source_node_id: String,
    pub(crate) placement: FigmaPlacement,
    pub(crate) target_expected: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) operation: Option<LinkedOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_expected: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_node_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_view: Option<VectorSourceView>,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorReference {
    pub file_key: String,
    pub page_id: String,
    pub node_id: String,
    pub revision: u64,
    pub target_expected: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum VectorBase {
    Snapshot(Box<VectorSnapshot>),
    Reference(VectorReference),
}
impl VectorBase {
    fn reference(&self) -> VectorReference {
        match self {
            Self::Reference(v) => v.clone(),
            Self::Snapshot(v) => VectorReference {
                file_key: v.file_key.clone(),
                page_id: v.page_id.clone(),
                node_id: v.node_id.clone(),
                revision: v.revision,
                target_expected: v.target_expected.clone(),
            },
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorProposal {
    schema: String,
    version: String,
    base: VectorBase,
    source_node_id: String,
    source_expected: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    spec: Option<TransformSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation: Option<LinkedOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation_expected: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_node_ids: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_view: Option<VectorSourceView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape_guide_clip: Option<worldbend_core::MockupClip>,
    // Complete captures carry actual native binary32 size readback.
    #[schemars(range(min = 0.009999999776482582, max = 4096))]
    width: f64,
    #[schemars(range(min = 0.009999999776482582, max = 4096))]
    height: f64,
    bounds: Bounds,
    #[schemars(
        length(min = 1, max = 8388608),
        description = "Exact complete captured geometry; use the lossless encoded proposal for large artwork. Never truncate layers or contours."
    )]
    geometry_json: String,
}
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VectorCreation {
    file_key: String,
    page_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_node_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_node_ids: Option<Vec<String>>,
    request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    spec: Option<TransformSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation: Option<LinkedOperation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_view_policy: Option<String>,
    #[schemars(range(min = 0.01, max = 4096))]
    width: f64,
    #[schemars(range(min = 0.01, max = 4096))]
    height: f64,
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
#[schemars(extend("type"="object"))]
#[allow(clippy::large_enum_variant)]
pub enum VectorInput {
    Create {
        #[serde(flatten)]
        creation: VectorCreation,
    },
    Initialize {
        #[serde(rename = "nodeId")]
        node_id: String,
        creation: VectorCreation,
    },
    State {
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
    Read {
        base: VectorBase,
        #[serde(default, rename = "sourceNodeId")]
        source_node_id: Option<String>,
        #[serde(default, rename = "sourceNodeIds")]
        source_node_ids: Option<Vec<String>>,
        #[serde(default)]
        spec: Option<TransformSpec>,
        #[serde(default)]
        operation: Option<LinkedOperation>,
        #[serde(default, rename = "sourceViewPolicy")]
        source_view_policy: Option<String>,
        #[serde(default)]
        width: Option<f64>,
        #[serde(default)]
        height: Option<f64>,
        #[serde(default)]
        #[schemars(range(min = 0, max = 255))]
        part: u16,
        #[serde(default)]
        token: Option<String>,
    },
    Publish {
        #[serde(default)]
        proposal: Option<Box<VectorProposal>>,
        #[serde(default)]
        encoded: Option<ExactJsonEnvelope>,
    },
}
fn error(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn scope(file: &str, page: &str, node: &str) -> TransformResult<()> {
    for id in [file, page, node] {
        figma_handoff::identity(id)?;
    }
    Ok(())
}
fn reference(base: &VectorReference) -> TransformResult<()> {
    scope(&base.file_key, &base.page_id, &base.node_id)?;
    if base.revision >= 9007199254740991 {
        return Err(error("Use the actual current Vector revision"));
    }
    let token = base
        .target_expected
        .strip_prefix("source32x2:")
        .and_then(|v| v.split_once(':'));
    if base.target_expected.len() > 256
        || !token.is_some_and(|(length, hash)| {
            !length.is_empty()
                && length.bytes().all(|b| b.is_ascii_digit())
                && hash.len() == 16
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        })
    {
        return Err(error("Use the actual native Vector target fingerprint"));
    }
    Ok(())
}
fn dimensions(width: f64, height: f64) -> TransformResult<Size> {
    if ![width, height]
        .iter()
        .all(|v| v.is_finite() && (f64::from(0.01_f32)..=4096.).contains(v))
    {
        return Err(error("Vector logical axes must be in 0.01..4096"));
    }
    Ok(Size::new(width.ceil(), height.ceil()))
}
pub(crate) fn native_operation(
    operation: &LinkedOperation,
) -> TransformResult<(VectorOperation, usize, usize)> {
    match operation {
        LinkedOperation::Transform { spec } => {
            if spec.destination.space != CoordinateSpace::Normalized {
                return Err(error("Native Vector requires normalized coordinates"));
            }
            Ok((VectorOperation::Transform { spec: spec.clone() }, 0, 1))
        }
        LinkedOperation::Task {
            task: LinkedTask::Deformation(task),
        } => match task.as_ref() {
            DeformationTask::Deformation {
                spec,
                shape_guide_source_index,
                shape_guide_domain,
                ..
            } => {
                if spec.transform.destination.space != CoordinateSpace::Normalized {
                    return Err(error("Native Vector work requires normalized coordinates"));
                }
                if let Some(i) = shape_guide_source_index {
                    if *i > 1 || spec.shape_fit.as_ref().is_none_or(|f| f.clip.is_none()) {
                        return Err(error("Preserve complete native guide roles and clip"));
                    }
                    Ok((
                        VectorOperation::DeformationWork { spec: spec.clone() },
                        1 - *i as usize,
                        2,
                    ))
                } else {
                    if shape_guide_domain.is_some() {
                        return Err(error("A native guide domain requires its source role"));
                    }
                    Ok((
                        VectorOperation::DeformationWork { spec: spec.clone() },
                        0,
                        1,
                    ))
                }
            }
            _ => Err(error(
                "Migrate complete legacy Mesh/Surface through the canonical work before native Vector publication",
            )),
        },
        _ => Err(error(
            "This complete operation requires its existing carrier",
        )),
    }
}
fn controls(operation: &LinkedOperation, width: f64, height: f64) -> TransformResult<()> {
    let (operation, ..) = native_operation(operation)?;
    let reference = operation_reference(&operation, width, height)?;
    plan_vector_operation(&VectorOperationInput {
        schema: "worldbend.vector-operation".into(),
        version: "0.1".into(),
        operation,
        reference,
    })?;
    Ok(())
}
fn operation_reference(
    operation: &VectorOperation,
    width: f64,
    height: f64,
) -> TransformResult<Size> {
    let fallback = dimensions(width, height)?;
    let reference = match operation {
        VectorOperation::DeformationWork { spec } => spec.target_size.unwrap_or(fallback),
        _ => fallback,
    };
    dimensions(reference.width, reference.height)?;
    Ok(reference)
}
pub(crate) fn snapshot(base: &VectorSnapshot) -> TransformResult<()> {
    reference(&VectorBase::Snapshot(Box::new(base.clone())).reference())?;
    figma_handoff::identity(&base.source_node_id)?;
    if base.schema != "worldbend.figma.vector-state"
        || !["0.1", "0.3"].contains(&base.version.as_str())
        || base.source_node_id == base.node_id
        || !base.placement.x.is_finite()
        || !base.placement.y.is_finite()
        || (!base.published && base.revision != 0)
    {
        return Err(error("Use the actual current Vector snapshot"));
    }
    let operation = base
        .operation
        .clone()
        .unwrap_or(LinkedOperation::Transform {
            spec: base.spec.clone(),
        });
    if base.version == "0.3" {
        let (_, art, count) = native_operation(&operation)?;
        if base.operation.is_none()
            || base
                .operation_expected
                .as_ref()
                .is_none_or(|v| v.len() != 64)
            || base
                .source_node_ids
                .as_ref()
                .is_none_or(|ids| ids.len() != count || ids.get(art) != Some(&base.source_node_id))
            || base.source_view.is_none()
        {
            return Err(error(
                "Preserve complete modern Vector operation/view/source roles",
            ));
        }
    }
    controls(&operation, base.placement.width, base.placement.height)
}
fn parts(part: u16, token: &Option<String>) -> TransformResult<()> {
    if part > 255 || (part > 0 && token.is_none()) {
        return Err(error("Use this Vector read's part token"));
    }
    if let Some(token) = token {
        figma_linked::fingerprint(token)?;
    }
    Ok(())
}
fn request(
    file_key: String,
    page_id: &str,
    runtime: &str,
    call: String,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    let file = json!(file_key);
    let page = json!(page_id);
    figma_handoff::bounded_request(FigmaRequest {
        file_key,
        skill_names: "figma-use",
        description,
        publication: None,
        code: format!(
            "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const p=await figma.getNodeByIdAsync({page});if(p?.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(p);\n{runtime}\nreturn await WorldbendFigmaHandoff.{call};"
        ),
    })
}
fn creation(creation: VectorCreation) -> TransformResult<(Value, String, usize)> {
    if ![creation.width, creation.height]
        .iter()
        .all(|v| v.is_finite() && (0.01..=4096.).contains(v))
    {
        return Err(error(
            "Requested Vector creation axes must be in 0.01..4096",
        ));
    }
    if creation.spec.is_some() && creation.operation.is_some() {
        return Err(error("Provide one complete Vector operation"));
    }
    let operation = creation
        .operation
        .or(creation
            .spec
            .map(|spec| LinkedOperation::Transform { spec }))
        .ok_or_else(|| error("Complete Vector operation required"))?;
    let (_, art, count) = native_operation(&operation)?;
    controls(&operation, creation.width, creation.height)?;
    let ids = creation
        .source_node_ids
        .or(creation.source_node_id.map(|id| vec![id]))
        .ok_or_else(|| error("Ordered Vector source roles required"))?;
    if ids.len() != count || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
    {
        return Err(error("Preserve all distinct ordered Vector source roles"));
    }
    for id in &ids {
        scope(&creation.file_key, &creation.page_id, id)?;
    }
    if creation.request_id.is_empty()
        || creation.request_id.len() > 80
        || !creation.request_id.as_bytes()[0].is_ascii_alphanumeric()
        || !creation
            .request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
        || creation
            .name
            .as_ref()
            .is_some_and(|v| v.trim().is_empty() || v.chars().count() > 80)
        || creation
            .source_view_policy
            .as_ref()
            .is_some_and(|p| p != "logical" && p != "appearance")
    {
        return Err(error("Choose bounded Vector creation identity/view"));
    }
    let mut value = json!({"fileKey":creation.file_key,"pageId":creation.page_id,"sourceNodeIds":ids,"requestId":creation.request_id,"operation":operation,"width":creation.width,"height":creation.height});
    if let Some(name) = creation.name {
        value["name"] = json!(name);
    }
    if let Some(policy) = creation.source_view_policy {
        value["sourceViewPolicy"] = json!(policy);
    }
    let raw =
        serde_json::to_string(&value).map_err(|_| error("Vector creation serialization failed"))?;
    if raw.len() > 8 * 1024 * 1024 {
        return Err(error("Complete Vector creation exceeds capacity"));
    }
    let identity = hex::encode(Sha256::digest(
        base64::engine::general_purpose::STANDARD
            .encode(raw.as_bytes())
            .as_bytes(),
    ));
    Ok((value, identity, art))
}
pub fn prepare(input: VectorInput) -> TransformResult<FigmaRequest> {
    match input {
        VectorInput::Create { creation: input } => {
            let (creation, identity, art) = creation(input)?;
            let mut args = creation.clone();
            let source = creation["sourceNodeIds"][art].clone();
            args.as_object_mut().unwrap().remove("operation");
            args.as_object_mut().unwrap().remove("sourceViewPolicy");
            args["identity"] = json!(identity);
            args["sourceNodeId"] = source;
            request(
                creation["fileKey"].as_str().unwrap().into(),
                creation["pageId"].as_str().unwrap(),
                CREATE,
                format!("createVectorWork({args})"),
                "Reserve the same recoverable native Vector candidate; initialize this node with the exact same creation inputs before projection",
            )
        }
        VectorInput::Initialize {
            node_id,
            creation: input,
        } => {
            let (creation, _, _) = creation(input)?;
            let file = creation["fileKey"].as_str().unwrap().to_owned();
            let page = creation["pageId"].as_str().unwrap().to_owned();
            scope(&file, &page, &node_id)?;
            let args = json!({"fileKey":file,"pageId":page,"nodeId":node_id,"creationJson":serde_json::to_string(&creation).map_err(|_|error("Vector initialization failed"))?});
            let mut candidate = figma_handoff::publication_request_runtime(
                file,
                page,
                node_id,
                "initializeVectorWork",
                args,
                "Initialize reserved Vector with exact complete operation; retain recoverable candidate on failure",
                Some(INITIALIZE),
            )?;
            let p = candidate.publication.as_mut().unwrap();
            p.force_transport = true;
            p.finalizer = Some((INITIALIZE, "initializeVectorWork"));
            Ok(candidate)
        }
        VectorInput::State {
            file_key,
            page_id,
            node_id,
            part,
            token,
        } => {
            scope(&file_key, &page_id, &node_id)?;
            parts(part, &token)?;
            let mut args =
                json!({"fileKey":file_key,"pageId":page_id,"nodeId":node_id,"part":part});
            if let Some(token) = token {
                args["token"] = json!(token);
            }
            request(
                file_key.clone(),
                &page_id,
                STATE,
                format!("readVectorState({})", args),
                "Read complete current native Vector controls/view/source roles in exact bounded parts",
            )
        }
        VectorInput::Read {
            base,
            source_node_id,
            source_node_ids,
            spec,
            operation,
            source_view_policy,
            width,
            height,
            part,
            token,
        } => {
            let scope = base.reference();
            reference(&scope)?;
            if let VectorBase::Snapshot(s) = &base {
                snapshot(s)?;
            }
            parts(part, &token)?;
            if part > 0 {
                return request(
                    scope.file_key.clone(),
                    &scope.page_id,
                    READ_PAGE,
                    format!(
                        "readCachedVectorRevision({})",
                        json!({"fileKey":scope.file_key,"pageId":scope.page_id,"nodeId":scope.node_id,"part":part,"token":token})
                    ),
                    "Read the next exact cached Vector capture part; revalidate complete source/work freshness without repeated native outlining",
                );
            }
            if spec.is_some() && operation.is_some() {
                return Err(error("Provide one complete Vector operation"));
            }
            if let Some(op) = operation.as_ref() {
                native_operation(op)?;
            }
            if let Some(spec) = spec.as_ref() {
                native_operation(&LinkedOperation::Transform { spec: spec.clone() })?;
            }
            if let Some(ids) = source_node_ids.as_ref() {
                if ids.len() > 2 || ids.is_empty() {
                    return Err(error("Preserve ordered artwork/guide roles"));
                }
                for id in ids {
                    figma_handoff::identity(id)?;
                }
            }
            if let Some(id) = source_node_id.as_ref() {
                figma_handoff::identity(id)?;
                if id == &scope.node_id {
                    return Err(error("Vector source cannot be its result"));
                }
            }
            if source_view_policy
                .as_ref()
                .is_some_and(|p| p != "logical" && p != "appearance")
            {
                return Err(error("Use logical or appearance source view"));
            }
            let mut args = json!({"fileKey":scope.file_key,"pageId":scope.page_id,"nodeId":scope.node_id,"base":scope,"part":0});
            for (k, v) in [
                ("sourceNodeId", json!(source_node_id)),
                ("sourceNodeIds", json!(source_node_ids)),
                ("spec", json!(spec)),
                ("operation", json!(operation)),
                ("sourceViewPolicy", json!(source_view_policy)),
                ("width", json!(width)),
                ("height", json!(height)),
            ] {
                if !v.is_null() {
                    args[k] = v;
                }
            }
            let mut candidate = figma_handoff::publication_request_runtime(
                scope.file_key,
                scope.page_id,
                scope.node_id,
                "readTransferredVectorRevision",
                args,
                "Capture complete native Vector proposal once; retain bounded exact pages on the owned candidate, not original artwork",
                Some(READ),
            )?;
            let p = candidate.publication.as_mut().unwrap();
            p.force_transport = true;
            p.finalizer = Some((READ, "readTransferredVectorRevision"));
            Ok(candidate)
        }
        VectorInput::Publish { proposal, encoded } => {
            let saved = match (proposal, encoded) {
                (Some(p), None) => *p,
                (None, Some(e)) => serde_json::from_value(figma_exact_json::decode(e)?)
                    .map_err(|_| error("Use a complete exact Vector proposal"))?,
                _ => {
                    return Err(error(
                        "Provide exactly one proposal or lossless encoded proposal",
                    ));
                }
            };
            publish(saved)
        }
    }
}
// Figma permits extra carrier appearance and corner fields. Keep the original
// opaque JSON for exact host equality; extract only core-owned path semantics.
#[derive(Deserialize)]
struct Vertex {
    x: f64,
    y: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Segment {
    start: usize,
    end: usize,
    #[serde(default)]
    tangent_start: Option<worldbend_core::Point>,
    #[serde(default)]
    tangent_end: Option<worldbend_core::Point>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Region {
    winding_rule: worldbend_core::VectorWindingRule,
    loops: Vec<Vec<usize>>,
}
#[derive(Deserialize)]
struct Network {
    vertices: Vec<Vertex>,
    segments: Vec<Segment>,
    regions: Vec<Region>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Geometry {
    vector_network: Network,
    absolute_transform: [[f64; 3]; 2],
    strokes: Vec<Value>,
    #[serde(default)]
    stroke_weight: Option<f64>,
    #[serde(default)]
    stroke_cap: Option<VectorStrokeCap>,
    #[serde(default)]
    stroke_join: Option<VectorStrokeJoin>,
    #[serde(default)]
    stroke_miter_limit: Option<f64>,
}

fn publish(saved: VectorProposal) -> TransformResult<FigmaRequest> {
    let base = saved.base.reference();
    reference(&base)?;
    figma_handoff::identity(&saved.source_node_id)?;
    figma_linked::fingerprint(&saved.source_expected)?;
    if saved.schema != "worldbend.figma.vector-proposal"
        || !["0.1", "0.3"].contains(&saved.version.as_str())
        || saved.source_node_id == base.node_id
        || saved.geometry_json.is_empty()
        || saved.geometry_json.len() > 8 * 1024 * 1024
    {
        return Err(error("Use the exact complete native Vector proposal"));
    }
    let operation = saved
        .operation
        .clone()
        .or(saved
            .spec
            .clone()
            .map(|spec| LinkedOperation::Transform { spec }))
        .ok_or_else(|| error("Complete Vector operation required"))?;
    let (_, art, count) = native_operation(&operation)?;
    if saved.version == "0.3"
        && (saved.spec.is_some()
            || saved
                .operation_expected
                .as_ref()
                .is_none_or(|v| v.len() != 64)
            || saved.source_node_ids.as_ref().is_none_or(|ids| {
                ids.len() != count || ids.get(art) != Some(&saved.source_node_id)
            })
            || saved.source_view.as_ref().is_none_or(|view| {
                view.bounds != saved.bounds
                    || !["logical", "appearance"].contains(&view.policy.as_str())
            }))
    {
        return Err(error(
            "Preserve whole operation witness, source roles and input view",
        ));
    }
    let rendered_operation =
        figma_linked::refresh_operation(&operation, saved.shape_guide_clip.as_ref())?;
    let (core, ..) = native_operation(&rendered_operation)?;
    let geometries: Vec<Geometry> = serde_json::from_str(&saved.geometry_json)
        .map_err(|_| error("Unreadable captured native Vector geometry"))?;
    if !(1..=MAX_VECTOR_ARTWORK_PARTS).contains(&geometries.len()) {
        return Err(error(
            "Use one through sixty-four captured native Vector parts",
        ));
    }
    let parts = geometries
        .into_iter()
        .map(|g| {
            let visible: Vec<_> = g
                .strokes
                .iter()
                .filter(|v| {
                    v.get("visible") != Some(&json!(false)) && v.get("opacity") != Some(&json!(0))
                })
                .collect();
            if visible.len() > 1 {
                return Err(error(
                    "Native capture must resolve multiple strokes before projection",
                ));
            }
            let stroke = if visible.is_empty() {
                None
            } else {
                if visible[0].get("type") != Some(&json!("SOLID")) {
                    return Err(error("Native capture must resolve non-solid strokes"));
                }
                Some(VectorStrokeSpec {
                    weight: g
                        .stroke_weight
                        .ok_or_else(|| error("Missing native stroke width"))?,
                    cap: g
                        .stroke_cap
                        .ok_or_else(|| error("Missing native stroke cap"))?,
                    join: g
                        .stroke_join
                        .ok_or_else(|| error("Missing native stroke join"))?,
                    miter_limit: g
                        .stroke_miter_limit
                        .ok_or_else(|| error("Missing native stroke miter limit"))?,
                })
            };
            let [[a, b, c], [d, e, f]] = g.absolute_transform;
            Ok(VectorArtworkPart {
                path: VectorPathSpec {
                    vertices: g
                        .vector_network
                        .vertices
                        .into_iter()
                        .map(|v| VectorPathVertex { x: v.x, y: v.y })
                        .collect(),
                    segments: g
                        .vector_network
                        .segments
                        .into_iter()
                        .map(|v| VectorPathSegment {
                            start: v.start,
                            end: v.end,
                            tangent_start: v.tangent_start,
                            tangent_end: v.tangent_end,
                        })
                        .collect(),
                    regions: g
                        .vector_network
                        .regions
                        .into_iter()
                        .map(|v| VectorPathRegion {
                            winding_rule: v.winding_rule,
                            loops: v.loops,
                        })
                        .collect(),
                },
                stroke,
                source_transform: [a, b, c, d, e, f],
            })
        })
        .collect::<TransformResult<Vec<_>>>()?;
    let reference = operation_reference(&core, saved.width, saved.height)?;
    let output = plan_vector_artwork(&VectorArtworkProjectionInput {
        source_bounds_policy: saved
            .source_view
            .as_ref()
            .filter(|v| v.policy == "appearance")
            .map(|_| worldbend_core::VectorArtworkSourceBoundsPolicy::ExpandToGeometry),
        schema: "worldbend.vector-artwork".into(),
        version: "0.1".into(),
        operation: core,
        reference,
        placement: Size::new(saved.width, saved.height),
        source_bounds: saved.bounds,
        parts,
        tolerance_px: 0.25,
    })?;
    let refreshed = serde_json::to_value(&rendered_operation)
        .map_err(|_| error("Vector operation serialization failed"))?;
    let changed = refreshed
        != serde_json::to_value(&operation)
            .map_err(|_| error("Vector operation serialization failed"))?;
    let rendered_view = output.source_bounds.and_then(|bounds| {
        saved
            .source_view
            .as_ref()
            .filter(|view| view.bounds != bounds)
            .map(|view| VectorSourceView {
                policy: view.policy.clone(),
                selection: view.selection.clone(),
                bounds,
                reported_bounds: Some(view.reported_bounds.unwrap_or(view.bounds)),
            })
    });
    let mut args = json!({"fileKey":base.file_key,"pageId":base.page_id,"nodeId":base.node_id,"proposal":saved,
        "matrix":output.plan.homography,"outputs":output.outputs,"clip":output.clip});
    if let Some(frame) = output.plan.execution_frame {
        args["executionFrame"] = json!(frame);
    }
    if let Some(view) = rendered_view {
        args["renderedSourceView"] = json!(view);
    }
    if changed {
        args["renderedOperation"] = refreshed;
    }
    let mut candidate = figma_handoff::publication_request_runtime(
        base.file_key,
        base.page_id,
        base.node_id,
        "publishVectorRevision",
        args,
        "Publish all core-projected native paths and original guide mask; retain complete work controls, source roles and stable identity",
        Some(PUBLISH),
    )?;
    let p = candidate.publication.as_mut().unwrap();
    p.preflight = Some((VALIDATE, "validateVectorPublication"));
    p.finalizer = Some((FINALIZE, "finalizeVectorPublication"));
    Ok(candidate)
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::figma_publication::{
        PublicationCache, PublicationOutput, PublicationStepInput, PublicationStepOutput,
    };
    fn spec() -> Value {
        json!({"schema":"worldbend.transform","version":"0.1","destination":{"space":"normalized","quad":
        {"tl":{"x":0,"y":0},"tr":{"x":1,"y":0},"br":{"x":0.8,"y":1},"bl":{"x":0.1,"y":1}}},"content":{"fit":"stretch"}})
    }
    fn base() -> Value {
        json!({"schema":"worldbend.figma.vector-state","version":"0.1","fileKey":"file","pageId":"page","nodeId":"work",
        "revision":0,"published":false,"sourceNodeId":"source","targetExpected":"source32x2:100:0123456789abcdef","spec":spec(),"placement":{"x":148,"y":0,"width":200.5,"height":100.5}})
    }
    fn geometry() -> Value {
        json!({"absoluteTransform":[[1,0,10],[0,1,20]],"strokes":[],"vectorNetwork":{
        "vertices":[{"x":0,"y":0,"cornerRadius":0},{"x":100,"y":0},{"x":100,"y":50},{"x":0,"y":50}],
        "segments":[{"start":0,"end":1},{"start":1,"end":2},{"start":2,"end":3},{"start":3,"end":0}],
        "regions":[{"windingRule":"NONZERO","loops":[[0,1,2,3]],"fills":[{"type":"SOLID","color":{"r":0.3,"g":0.5,"b":0.2}}]}]}})
    }
    fn proposal() -> Value {
        json!({"schema":"worldbend.figma.vector-proposal","version":"0.1","base":base(),"sourceNodeId":"source","sourceExpected":"hash32x2:source",
        "spec":spec(),"width":200.5,"height":100.5,"bounds":{"x":10,"y":20,"width":100,"height":50},"geometryJson":json!([geometry()]).to_string()})
    }
    fn input(value: Value) -> VectorInput {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn reads_and_creation_are_closed_and_bounded_without_claiming_publication() {
        let create = json!({"action":"create","fileKey":"file","pageId":"page","sourceNodeId":"source","requestId":"same-work","spec":spec(),"width":200.5,"height":100.5});
        let request = prepare(input(create.clone())).unwrap();
        assert!(request.code.contains("createVectorWork"));
        assert!(request.publication.is_none());
        let first = prepare(input(
            json!({"action":"state","fileKey":"file","pageId":"page","nodeId":"work"}),
        ))
        .unwrap();
        let first_code = figma_handoff::test_code(&first);
        assert!(first_code.contains("readVectorState({\"fileKey\":\"file\",\"nodeId\":\"work\",\"pageId\":\"page\",\"part\":0})"));
        assert!(!first_code.contains("\"token\":null"));
        assert!(serde_json::to_vec(&first).unwrap().len() <= 48 * 1024);
        let mut invalid = create;
        invalid["imageBase64"] = json!("caller output");
        assert!(serde_json::from_value::<VectorInput>(invalid).is_err());
        let read = json!({"action":"read","base":base(),"part":1,"token":"hash32x2:part"});
        assert!(
            figma_handoff::test_code(&prepare(input(read.clone())).unwrap())
                .contains("readCachedVectorRevision")
        );
        let mut invalid = read;
        invalid.as_object_mut().unwrap().remove("token");
        assert!(prepare(input(invalid)).is_err());
        let mut invalid = base();
        invalid["revision"] = json!(1);
        assert!(prepare(input(json!({"action":"read","base":invalid}))).is_err());
    }
    #[test]
    fn publish_projects_the_actual_captured_paths_through_core_and_rejects_bad_geometry() {
        let candidate = prepare(input(json!({"action":"publish","proposal":proposal()}))).unwrap();
        let publication = candidate.publication.unwrap();
        let matrix: [f64; 9] =
            serde_json::from_value(publication.arguments["matrix"].clone()).unwrap();
        assert!(matrix[6] != 0.0 || matrix[7] != 0.0);
        let output = &publication.arguments["outputs"][0];
        assert_eq!(output["report"]["fidelity"], "exact");
        assert_eq!(output["network"]["vertices"].as_array().unwrap().len(), 4);
        assert!((output["bounds"]["width"].as_f64().unwrap() - 200.5).abs() < 0.000001);
        let mut invalid = proposal();
        let mut g = geometry();
        g["vectorNetwork"]["segments"][0]["end"] = json!(99);
        invalid["geometryJson"] = json!(json!([g]).to_string());
        assert!(prepare(input(json!({"action":"publish","proposal":invalid}))).is_err());
        let mut invalid = proposal();
        invalid["geometryJson"] = json!(json!(vec![geometry(); 65]).to_string());
        assert!(prepare(input(json!({"action":"publish","proposal":invalid}))).is_err());
    }
    #[test]
    fn fractional_work_reference_is_preserved_separately_from_native_placement_and_pixels() {
        let operation = json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":{
            "schema":"worldbend.deformation-work","version":"0.1","transform":spec(),
            "targetSize":{"width":100.1,"height":80.3},"meshSubdivisions":4,"meshEdits":[{"column":2,"row":2,"warped":{"x":0.51,"y":0.5}}]}}});
        let created=prepare(input(json!({"action":"create","fileKey":"file","pageId":"page","sourceNodeId":"source","requestId":"fractional","operation":operation,"width":100.1,"height":80.3}))).unwrap();
        assert!(figma_handoff::test_code(&created).contains("100.1"));
        let mut p = proposal();
        p["version"] = json!("0.3");
        p.as_object_mut().unwrap().remove("spec");
        p["operation"] = operation.clone();
        p["operationExpected"] = json!("a".repeat(64));
        p["sourceNodeIds"] = json!(["source"]);
        p["sourceView"] = json!({"policy":"logical","bounds":p["bounds"]});
        // Physical placement changes independently of the retained solve axes.
        p["width"] = json!(240.5);
        p["height"] = json!(120.5);
        let published = prepare(input(json!({"action":"publish","proposal":p})))
            .unwrap()
            .publication
            .unwrap();
        let authored: LinkedOperation = serde_json::from_value(operation).unwrap();
        let retained: LinkedOperation =
            serde_json::from_value(published.arguments["proposal"]["operation"].clone()).unwrap();
        assert_eq!(
            serde_json::to_value(retained).unwrap(),
            serde_json::to_value(authored).unwrap()
        );
        let matrix: [f64; 9] =
            serde_json::from_value(published.arguments["matrix"].clone()).unwrap();
        let expected = worldbend_core::solve_spec(
            &serde_json::from_value(spec()).unwrap(),
            Some(Size::new(100.1, 80.3)),
        )
        .unwrap();
        assert_eq!(matrix, expected.homography.matrix);
        assert!(
            (published.arguments["outputs"][0]["bounds"]["width"]
                .as_f64()
                .unwrap()
                - 240.5)
                .abs()
                < 1e-6
        );
        assert!(dimensions(f64::from(0.01_f32), f64::from(0.01_f32)).is_ok());
        assert!(dimensions(f64::from(0.01_f32).next_down(), 1.).is_err());
        assert!(prepare(input(json!({"action":"create","fileKey":"file","pageId":"page","sourceNodeId":"source","requestId":"below-requested-minimum","spec":spec(),"width":f64::from(0.01_f32),"height":1}))).is_err());
    }
    #[test]
    fn transferred_vector_has_bounded_capture_validation_then_guarded_finalization() {
        let mut p = proposal();
        // Exactly 256 bytes, including a non-ASCII identity, with worst escaping.
        let escaped = format!("{}é", "\\".repeat(254));
        p["base"]["fileKey"] = json!(escaped);
        p["base"]["pageId"] = json!(escaped);
        p["base"]["nodeId"] = json!(escaped);
        p["geometryJson"] = json!(json!(vec![geometry(); 16]).to_string());
        let cache = PublicationCache::default();
        let PublicationOutput::Transfer(plan) = cache
            .prepare(prepare(input(json!({"action":"publish","proposal":p}))).unwrap())
            .unwrap()
        else {
            panic!("expected transfer")
        };
        let json_plan = serde_json::to_value(plan).unwrap();
        let count = json_plan["chunkCount"].as_u64().unwrap() as usize;
        let steps = json_plan["stepCount"].as_u64().unwrap() as usize;
        assert_eq!(steps, count + 2);
        for step in 0..steps {
            let args = json!({"transferId":json_plan["transferId"],"step":step});
            let PublicationStepOutput::Request(request) = cache
                .step(serde_json::from_value::<PublicationStepInput>(args).unwrap())
                .unwrap()
            else {
                panic!()
            };
            assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
            let code = figma_handoff::test_code(&request);
            if step == count {
                assert!(code.contains("validateVectorPublication(q)"));
                assert!(code.contains("payloadDigest:"));
            }
            if step == count + 1 {
                assert!(code.contains("finalizeVectorPublication(q)"));
                assert!(code.contains("payloadDigest:"));
            }
        }
    }
}

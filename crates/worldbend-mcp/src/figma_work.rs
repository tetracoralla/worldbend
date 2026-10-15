//! Selective revisions use current native state, actual replacement media and
//! the same core rendering as ordinary linked work. Reads return exact bounded
//! JSON parts so a complex authored operation does not exceed the connector.
use crate::{
    figma_handoff::{
        self, FigmaMockupSource, FigmaMockupSourceRaster, FigmaPlacement, FigmaRequest,
    },
    figma_linked::{self, LinkedOperation, RasterTransport},
};
use base64::Engine as _;
use image::ImageEncoder as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashSet;
use worldbend_core::{ErrorCode, MockupClip, TransformError, TransformResult};

const READ_RUNTIME: &str = include_str!("figma-runtime-work-revision-read.js");
const STATE_RUNTIME: &str = include_str!("figma-runtime-work-state.js");
const PUBLISH_RUNTIME: &str = include_str!("figma-runtime-work-revise-publish.js");
const FINALIZE_RUNTIME: &str = include_str!("figma-runtime-work-revise-finalize.js");

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkReference {
    pub(crate) file_key: String,
    pub(crate) page_id: String,
    pub(crate) node_id: String,
    #[schemars(range(min = 1, max = 9007199254740990_u64))]
    pub(crate) revision: u64,
    pub(crate) target_expected: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct WorkRevisionSnapshot {
    schema: String,
    version: String,
    file_key: String,
    page_id: String,
    node_id: String,
    revision: u64,
    target_expected: String,
    // Preserve explicit empty/default fields from the actual read proof.
    // Geometry still passes the same closed typed contract before execution.
    #[serde(deserialize_with = "preserved_operation")]
    #[schemars(with = "LinkedOperation")]
    operation: serde_json::Value,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "preserved_previous_operation"
    )]
    #[schemars(with = "Option<LinkedOperation>")]
    previous_operation: Option<serde_json::Value>,
    #[schemars(length(min = 1, max = 8))]
    source_node_ids: Vec<String>,
    #[schemars(length(min = 1, max = 8))]
    sources: Vec<FigmaMockupSource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_state: Option<String>,
    #[schemars(range(min = 1, max = 4096))]
    render_width: u32,
    #[schemars(range(min = 1, max = 4096))]
    render_height: u32,
    placement: FigmaPlacement,
    preserve_draft: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    draft_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape_guide_clip: Option<MockupClip>,
    expected: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
#[schemars(extend("type"="object"))]
// Parsed once per request; the read variant keeps its full revision options inline.
#[allow(clippy::large_enum_variant)]
pub enum WorkInput {
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        token: Option<String>,
    },
    Read {
        base: WorkReference,
        #[serde(
            default,
            rename = "sourceFingerprints",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(length(min = 1, max = 8))]
        source_fingerprints: Option<Vec<String>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        operation: Option<LinkedOperation>,
        #[serde(
            default,
            rename = "sourceNodeIds",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(length(min = 1, max = 8))]
        source_node_ids: Option<Vec<String>>,
        #[serde(
            default,
            rename = "renderWidth",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(range(min = 1, max = 4096))]
        render_width: Option<u32>,
        #[serde(
            default,
            rename = "renderHeight",
            skip_serializing_if = "Option::is_none"
        )]
        #[schemars(range(min = 1, max = 4096))]
        render_height: Option<u32>,
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
    Publish {
        snapshot: Box<WorkRevisionSnapshot>,
        #[schemars(length(min = 1, max = 8))]
        sources: Vec<FigmaMockupSourceRaster>,
    },
}

impl WorkInput {
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

fn preserved_operation<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<serde_json::Value, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    serde_json::from_value::<LinkedOperation>(value.clone()).map_err(serde::de::Error::custom)?;
    Ok(value)
}
fn preserved_previous_operation<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<serde_json::Value>, D::Error> {
    let value = Option::<serde_json::Value>::deserialize(deserializer)?;
    if let Some(value) = &value {
        serde_json::from_value::<LinkedOperation>(value.clone())
            .map_err(serde::de::Error::custom)?;
    }
    Ok(value)
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
fn reference(base: &WorkReference) -> TransformResult<()> {
    scope(&base.file_key, &base.page_id, &base.node_id)?;
    figma_linked::fingerprint(&base.target_expected)?;
    if base.revision == 0 || base.revision >= 9_007_199_254_740_991 {
        return Err(error("Use the current bounded work revision"));
    }
    Ok(())
}
fn page(part: u16, token: &Option<String>) -> TransformResult<()> {
    if part > 255 || (part > 0 && token.is_none()) {
        return Err(error("Use the part token from the same current work read"));
    }
    if let Some(token) = token {
        figma_linked::fingerprint(token)?;
    }
    Ok(())
}
fn ids(values: &[String], node: &str) -> TransformResult<()> {
    if !(1..=8).contains(&values.len())
        || values.iter().collect::<HashSet<_>>().len() != values.len()
        || values.iter().any(|id| id == node)
    {
        return Err(error("Use distinct current source slots"));
    }
    for id in values {
        figma_handoff::identity(id)?;
    }
    Ok(())
}

fn read_request(
    file_key: String,
    page_id: &str,
    call: String,
    description: &'static str,
    runtime: &str,
) -> TransformResult<FigmaRequest> {
    figma_handoff::read_request_runtime(file_key, page_id, call, description, runtime)
}

pub fn prepare(input: WorkInput) -> TransformResult<FigmaRequest> {
    match input {
        WorkInput::State {
            file_key,
            page_id,
            node_id,
            part,
            token,
        } => {
            scope(&file_key, &page_id, &node_id)?;
            page(part, &token)?;
            let args = json!({"fileKey":file_key,"pageId":page_id,"nodeId":node_id,"part":part});
            let mut args = args;
            if let Some(token) = token {
                args["token"] = json!(token);
            }
            read_request(
                file_key,
                &page_id,
                format!("readWorkState({args})"),
                "Read exact saved work in bounded parts, including missing-source recovery and pending human edits",
                STATE_RUNTIME,
            )
        }
        WorkInput::Read {
            base,
            source_fingerprints,
            operation,
            source_node_ids,
            render_width,
            render_height,
            part,
            token,
            include_source_rasters,
            source_raster_transport,
        } => {
            reference(&base)?;
            page(part, &token)?;
            if let Some(proofs) = &source_fingerprints {
                if part == 0 || include_source_rasters || proofs.is_empty() || proofs.len() > 8 {
                    return Err(error(
                        "Use captured source fingerprints only for subsequent state parts",
                    ));
                }
                if proofs
                    .iter()
                    .any(|proof| !figma_handoff::valid_preview_fingerprint(proof))
                {
                    return Err(error("Use the exact captured source fingerprints"));
                }
            }
            if let Some(v) = &source_node_ids {
                ids(v, &base.node_id)?;
            }
            if [render_width, render_height]
                .iter()
                .flatten()
                .any(|v| !(1..=4096).contains(v))
            {
                return Err(error("Use bounded output dimensions"));
            }
            if let (Some(op), Some(sources), Some(w), Some(h)) =
                (&operation, &source_node_ids, render_width, render_height)
            {
                figma_linked::validate_work_operation(op, sources.len(), w, h)?;
            }
            let mut args = json!(base);
            for (key, value) in [
                ("operation", json!(operation)),
                ("sourceNodeIds", json!(source_node_ids)),
                ("renderWidth", json!(render_width)),
                ("renderHeight", json!(render_height)),
                ("token", json!(token)),
                ("sourceFingerprints", json!(source_fingerprints)),
            ] {
                if !value.is_null() {
                    args[key] = value;
                }
            }
            args["part"] = json!(part);
            args["includeSourceRasters"] = json!(include_source_rasters);
            args["sourceRasterTransport"] = json!(source_raster_transport);
            let args = figma_handoff::packet_literal(&args)?;
            read_request(
                base.file_key,
                &base.page_id,
                format!("readWorkRevision({args})"),
                "Read a guarded selective revision and actual proposed source media without changing the published work",
                READ_RUNTIME,
            )
        }
        WorkInput::Publish { snapshot, sources } => {
            let saved = *snapshot;
            reference(&WorkReference {
                file_key: saved.file_key.clone(),
                page_id: saved.page_id.clone(),
                node_id: saved.node_id.clone(),
                revision: saved.revision,
                target_expected: saved.target_expected.clone(),
            })?;
            figma_linked::fingerprint(&saved.expected)?;
            if let Some(state) = &saved.source_state {
                figma_linked::fingerprint(state)?;
            }
            ids(&saved.source_node_ids, &saved.node_id)?;
            if saved.schema != "worldbend.figma.work-revision"
                || saved.version != "0.1"
                || saved.sources.len() != saved.source_node_ids.len()
                || saved
                    .draft_key
                    .as_ref()
                    .is_some_and(|v| v != "mockupDraft" && v != "effectDraft")
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
                return Err(error("Use the complete actual revision snapshot"));
            }
            for (i, s) in saved.sources.iter().enumerate() {
                if s.slot_id != format!("source-{}", i + 1)
                    || s.node_id != saved.source_node_ids[i]
                    || s.name.chars().count() > 128
                    || !s.width.is_finite()
                    || !s.height.is_finite()
                    || s.width <= 0.0
                    || s.height <= 0.0
                {
                    return Err(error("Source slots must match the actual revision read"));
                }
            }
            let operation: LinkedOperation = serde_json::from_value(saved.operation.clone())
                .map_err(|_| error("Use a valid saved operation"))?;
            let previous = saved
                .previous_operation
                .clone()
                .map(serde_json::from_value::<LinkedOperation>)
                .transpose()
                .map_err(|_| error("Use the actual previous operation"))?;
            let (image, rendered) = figma_linked::render_work_revision(
                operation.clone(),
                saved.sources.clone(),
                &sources,
                saved.render_width,
                saved.render_height,
                saved.shape_guide_clip.clone(),
            )?;
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
            .map_err(|_| error("Unable to encode revised work"))?;
            let mut args = json!({"fileKey":saved.file_key,"pageId":saved.page_id,"nodeId":saved.node_id,
                "snapshot":saved,"imageBase64":base64::engine::general_purpose::STANDARD.encode(png)});
            if let Some(frames) =
                figma_linked::deformation_canvas_frames(previous.as_ref(), &rendered)?
            {
                args["canvasFrames"] = json!(frames);
            }
            if figma_linked::dynamic_canvas(&operation) {
                args["renderedSize"] = json!({"width":image.width(),"height":image.height()});
            }
            if serde_json::to_value(&rendered).ok() != serde_json::to_value(&operation).ok() {
                args["renderedOperation"] = json!(rendered);
            }
            let mut request = figma_handoff::publication_request_runtime(
                saved.file_key,
                saved.page_id,
                saved.node_id,
                "publishWorkRevision",
                args,
                "Publish revised controls, source binding, raster and display size together; reject newer native/source edits",
                Some(PUBLISH_RUNTIME),
            )?;
            request
                .publication
                .as_mut()
                .expect("publication metadata")
                .finalizer = Some((FINALIZE_RUNTIME, "finishWorkRevision"));
            Ok(request)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn png(color: [u8; 4]) -> String {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba(color));
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes)
            .write_image(image.as_raw(), 4, 4, image::ExtendedColorType::Rgba8)
            .unwrap();
        base64::engine::general_purpose::STANDARD.encode(bytes)
    }
    fn publication() -> serde_json::Value {
        let encoded = png([200, 40, 20, 255]);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        let expected = "hash32x2:1000:0123456789abcdef";
        json!({"action":"publish","snapshot":{"schema":"worldbend.figma.work-revision","version":"0.1",
            "fileKey":"file","pageId":"page","nodeId":"result","revision":2,"targetExpected":expected,"expected":expected,
            "operation":{"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1","operation":{"kind":"stretch","output":{"width":8,"height":4}}}},
            "sourceNodeIds":["replacement"],"sources":[{"slotId":"source-1","nodeId":"replacement","name":"新源 🌐","width":4,"height":4,
            "previewFingerprint":figma_handoff::source_preview_fingerprint(&bytes)}],"renderWidth":8,"renderHeight":4,
            "placement":{"x":100,"y":200,"width":4,"height":2},"preserveDraft":true},"sources":[{"slotId":"source-1","base64":encoded}]})
    }
    #[test]
    fn native_source_state_does_not_relax_captured_png_correlation() {
        let mut value = publication();
        value["snapshot"]["sourceState"] = json!("hash32x2:900:0123456789abcdef");
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert_eq!(
            request.publication.unwrap().arguments["snapshot"]["sourceState"],
            value["snapshot"]["sourceState"]
        );
        let mut mismatched = value.clone();
        mismatched["sources"][0]["base64"] = json!(png([0, 0, 0, 255]));
        assert!(prepare(serde_json::from_value(mismatched).unwrap()).is_err());
        value["snapshot"]["sourceState"] = json!("invalid");
        assert!(prepare(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn deformation_revision_preserves_explicit_read_defaults_and_plans_canvas_independently_from_hd_pixels()
     {
        let mut value = publication();
        let previous = json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":{
            "schema":"worldbend.deformation-work","version":"0.1","transform":worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
            "targetSize":{"width":4,"height":4},"meshSubdivisions":4,"boundary":"free","meshEdits":[]
        }}});
        let mut operation = previous.clone();
        operation["task"]["spec"]["meshEdits"] = json!([
            {"column":2,"row":0,"warped":{"x":0.5,"y":-0.25}},
            {"column":2,"row":4,"warped":{"x":0.5,"y":1.25}}
        ]);
        value["snapshot"]["previousOperation"] = previous.clone();
        value["snapshot"]["operation"] = operation.clone();
        value["snapshot"]["renderWidth"] = json!(8);
        value["snapshot"]["renderHeight"] = json!(12);
        let request = prepare(serde_json::from_value(value).unwrap()).unwrap();
        let args = request.publication.unwrap().arguments;
        assert_eq!(args["snapshot"]["operation"], operation);
        assert_eq!(args["snapshot"]["previousOperation"], previous);
        assert_eq!(
            args["canvasFrames"],
            json!({"from":{"origin":{"x":0.0,"y":0.0},"reference":{"width":4.0,"height":4.0}},
            "to":{"origin":{"x":0.0,"y":-1.0},"reference":{"width":4.0,"height":6.0}}})
        );
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(args["imageBase64"].as_str().unwrap())
            .unwrap();
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert_eq!((image.width(), image.height()), (8, 12));
        let mut invalid = args["snapshot"].clone();
        invalid["operation"]["task"]["extra"] = json!(true);
        assert!(serde_json::from_value::<WorkRevisionSnapshot>(invalid).is_err());
    }

    #[test]
    fn later_parts_carry_only_bounded_captured_source_fingerprints() {
        let proof = "preview32x2:100:0123456789abcdef";
        let mut value = json!({"action":"read","base":{"fileKey":"file","pageId":"page","nodeId":"result",
            "revision":2,"targetExpected":"hash32x2:100:0123456789abcdef"},"part":1,
            "token":"hash32x2:900:0123456789abcdef","sourceFingerprints":[proof]});
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let code = crate::figma_handoff::test_code(&request);
        assert!(code.contains("sourceFingerprints"));
        assert!(code.contains(proof));
        let mut invalid = value.clone();
        invalid["part"] = json!(0);
        assert!(prepare(serde_json::from_value(invalid).unwrap()).is_err());
        let mut invalid = value.clone();
        invalid["includeSourceRasters"] = json!(true);
        assert!(prepare(serde_json::from_value(invalid).unwrap()).is_err());
        value["sourceFingerprints"] = json!(["invalid"]);
        assert!(prepare(serde_json::from_value(value).unwrap()).is_err());
    }

    #[test]
    fn bounded_state_reads_use_exact_parts_and_closed_inputs() {
        let id = "\\\"".repeat(128);
        let value = json!({"action":"state","fileKey":id,"pageId":id,"nodeId":id});
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        assert!(request.code.contains("readWorkState("));
        assert!(!request.code.contains(".screenshot("));
        assert!(serde_json::to_vec(&request).unwrap().len() < 48 * 1024);
        let mut invalid = value.clone();
        invalid["part"] = json!(1);
        assert!(prepare(serde_json::from_value(invalid).unwrap()).is_err());
        let mut invalid = value.clone();
        invalid["extra"] = json!(true);
        assert!(serde_json::from_value::<WorkInput>(invalid).is_err());
        let mut invalid = value;
        invalid["part"] = json!(256);
        invalid["token"] = json!("hash32x2:1:0123456789abcdef");
        assert!(prepare(serde_json::from_value(invalid).unwrap()).is_err());
    }
    #[test]
    fn dynamic_revision_preserves_the_read_proof_and_carries_only_core_resolved_size() {
        let mut value = publication();
        value["snapshot"]["operation"] = json!({"kind":"canvas","spec":{"schema":"worldbend.canvas","version":"0.1","operation":{
            "kind":"pad","insets":{"top":1,"right":2,"bottom":3,"left":4},"background":{"kind":"transparent"}}}});
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let args = request.publication.unwrap().arguments;
        let expected: WorkRevisionSnapshot =
            serde_json::from_value(value["snapshot"].clone()).unwrap();
        assert_eq!(args["snapshot"], json!(expected));
        assert_eq!(args["renderedSize"], json!({"width":10,"height":8}));
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(args["imageBase64"].as_str().unwrap())
            .unwrap();
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert_eq!((image.width(), image.height()), (10, 8));
        assert_eq!(image.to_rgba8().get_pixel(0, 0).0, [0, 0, 0, 0]);
        assert_eq!(image.to_rgba8().get_pixel(4, 1).0, [200, 40, 20, 255]);
    }

    #[test]
    fn renders_actual_replacement_media_and_preserves_the_revision_snapshot() {
        let value = publication();
        let request = prepare(serde_json::from_value(value.clone()).unwrap()).unwrap();
        let data = request.publication.unwrap();
        assert_eq!(data.publisher, "publishWorkRevision");
        for key in ["fileKey", "pageId", "nodeId"] {
            assert_eq!(data.arguments[key], data.arguments["snapshot"][key]);
        }
        let expected: WorkRevisionSnapshot =
            serde_json::from_value(value["snapshot"].clone()).unwrap();
        // f64 fields preserve their numerical value through typed serialization.
        assert_eq!(data.arguments["snapshot"], json!(expected));
        assert!(data.finalizer.is_some());
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.arguments["imageBase64"].as_str().unwrap())
            .unwrap();
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        assert_eq!((image.width(), image.height()), (8, 4));
        assert_eq!(image.to_rgba8().get_pixel(4, 2).0, [200, 40, 20, 255]);
    }
    #[test]
    fn rejects_unmatched_media_geometry_slots_and_partial_references() {
        for field in [
            "pixels",
            "dimensions",
            "slot",
            "source",
            "draft",
            "revision",
        ] {
            let mut value = publication();
            match field {
                "pixels" => value["sources"][0]["base64"] = json!(png([0, 0, 255, 255])),
                "dimensions" => value["snapshot"]["renderWidth"] = json!(7),
                "slot" => value["snapshot"]["sources"][0]["slotId"] = json!("source-2"),
                "source" => value["snapshot"]["sourceNodeIds"] = json!(["result"]),
                "draft" => value["snapshot"]["draftKey"] = json!("unrelated"),
                "revision" => value["snapshot"]["revision"] = json!(9007199254740991_u64),
                _ => unreachable!(),
            }
            assert!(
                prepare(serde_json::from_value(value).unwrap()).is_err(),
                "{field}"
            );
        }
        let mut invalid = publication();
        invalid["snapshot"]["operation"]["extra"] = json!(true);
        assert!(serde_json::from_value::<WorkInput>(invalid).is_err());
    }
}

//! Session-local preparation of bounded Figma requests. No Figma access here.
use crate::figma_handoff::{FigmaRequest, bounded_request};
use base64::Engine as _;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Write,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use worldbend_core::{ErrorCode, TransformError, TransformResult};

const STAGE_RUNTIME: &str = include_str!("figma-runtime-publication-stage.js");
const MEDIA_RUNTIME: &str = include_str!("figma-runtime-media.js");
const RUNTIME_TRANSPORT: &str = include_str!("figma-runtime-publication-runtime.js");
const MAX_RUNTIME_BYTES: usize = 128 * 1024;
const PUBLISH_RUNTIME: &str = include_str!("figma-runtime-image-publishers.js");
const CHUNK_LENGTH: usize = 32768;
const MAX_CHUNKS: usize = 64;
const MAX_TRANSFERS: usize = 8;
const MAX_STORED_BYTES: usize = 16 * 1024 * 1024;
const TTL: Duration = Duration::from_secs(600);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TransferPlan {
    schema: &'static str,
    version: &'static str,
    transfer_id: String,
    file_key: String,
    page_id: String,
    node_id: String,
    chunk_count: usize,
    /// Fetch and run every step in order. The final receipt states the effect.
    step_count: usize,
    expires_in_seconds: u64,
    next_operation: &'static str,
    effect: &'static str,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
pub enum PublicationOutput {
    Inline(FigmaRequest),
    Transfer(TransferPlan),
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublicationScope {
    #[schemars(length(min = 1, max = 256))]
    file_key: String,
    #[schemars(length(min = 1, max = 256))]
    page_id: String,
    #[schemars(length(min = 1, max = 256))]
    node_id: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PublicationStepInput {
    #[serde(default)]
    #[schemars(length(min = 64, max = 64))]
    transfer_id: Option<String>,
    #[serde(default)]
    #[schemars(
        description = "Explicit granted target for inspecting or cancelling staged transport across Agent/server sessions. Omit for cached steps."
    )]
    scope: Option<PublicationScope>,
    #[serde(default)]
    #[schemars(
        description = "Prepare a read-only Figma request for this scope's staged transfer identity and received chunks. Requires scope, without transferId."
    )]
    inspect: bool,
    #[serde(default)]
    #[schemars(
        range(min = 0, max = 79),
        description = "Fetch one prepared request. Run every step in order, including any capture validation before the final publication. Fetching performs no Figma write."
    )]
    step: Option<usize>,
    #[serde(default)]
    #[schemars(
        description = "Instead of a step, prepare cancellation of this exact transfer on Figma. Execute the returned request to clear staged chunks."
    )]
    cancel: bool,
    #[serde(default)]
    #[schemars(
        description = "Release the session's prepared media after successful publication or cancellation. This only frees the local cache and returns a receipt; it does not access Figma."
    )]
    release: bool,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(untagged)]
// Built once per response; the carried Figma packet stays inline by contract.
#[allow(clippy::large_enum_variant)]
pub enum PublicationStepOutput {
    Request(FigmaRequest),
    Released {
        #[serde(rename = "transferId")]
        transfer_id: String,
        released: bool,
    },
}

#[derive(Debug)]
struct StoredTransfer {
    created: Instant,
    steps: Vec<FigmaRequest>,
    cancel: FigmaRequest,
    bytes: usize,
}

#[derive(Debug, Default)]
pub struct PublicationCache(Mutex<HashMap<String, StoredTransfer>>);

fn error(code: ErrorCode, message: &str) -> TransformError {
    TransformError::new(code, message)
}

fn checksum(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(2166136261_u32, |hash, byte| {
        (hash ^ u32::from(*byte)).wrapping_mul(16777619)
    });
    format!("{hash:08x}")
}

fn request(
    file_key: &str,
    page_id: &str,
    body: String,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    request_runtime(file_key, page_id, body, description, STAGE_RUNTIME)
}

fn request_runtime(
    file_key: &str,
    page_id: &str,
    body: String,
    description: &'static str,
    runtime: &str,
) -> TransformResult<FigmaRequest> {
    let file = json!(file_key);
    let page = json!(page_id);
    bounded_request(FigmaRequest {
        file_key: file_key.into(),
        skill_names: "figma-use",
        description,
        code: format!(
            "if(figma.fileKey!=={file})throw Error('E_FIGMA_SCOPE');const grantedPage=await figma.getNodeByIdAsync({page});if(!grantedPage||grantedPage.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(grantedPage);\n{runtime}\n{body}"
        ),
        publication: None,
    })
}

// Mechanical packet fields are serialized once rather than nested/re-escaped.
#[allow(clippy::too_many_arguments)]
fn trusted_step(
    file_key: &str,
    page_id: &str,
    node_id: &str,
    transfer_id: &str,
    payload_digest: &str,
    runtime: &str,
    method: &str,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    for id in [file_key, page_id, node_id] {
        crate::figma_handoff::identity(id)?;
    }
    let [file, page, node] = [file_key, page_id, node_id]
        .map(|id| json!(base64::engine::general_purpose::STANDARD.encode(id.as_bytes())));
    let runtime = if runtime.starts_with("// Generated by ") {
        runtime.split_once('\n').map_or(runtime, |(_, code)| code)
    } else {
        runtime
    };
    bounded_request(FigmaRequest {
        file_key: file_key.into(),
        skill_names: "figma-use",
        description,
        code: format!(
            "const d=v=>decodeURIComponent(atob(v).replace(/./g,c=>'%'+c.charCodeAt(0).toString(16)));const q={{fileKey:d({file}),pageId:d({page}),nodeId:d({node}),transferId:{},payloadDigest:{}}};if(figma.fileKey!==q.fileKey)throw Error('E_FIGMA_SCOPE');const p=await figma.getNodeByIdAsync(q.pageId);if(p?.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(p);\n{runtime}\nreturn await WorldbendFigmaHandoff.{method}(q);",
            json!(transfer_id),
            json!(payload_digest)
        ),
        publication: None,
    })
}

// A phase may capture, initialize, or publish. Every executable byte comes
// from this binary's owning generated runtime, bound independently of mutable
// document staging. A phase releases only its own runtime bank before the next.
#[allow(clippy::too_many_arguments)]
fn append_trusted_phase(
    steps: &mut Vec<FigmaRequest>,
    file: &str,
    page: &str,
    node: &str,
    id: &str,
    payload_digest: &str,
    scope: &Value,
    runtime: &str,
    method: &str,
    description: &'static str,
) -> TransformResult<()> {
    match trusted_step(
        file,
        page,
        node,
        id,
        payload_digest,
        runtime,
        method,
        description,
    ) {
        Ok(request) => steps.push(request),
        Err(issue) if issue.code == ErrorCode::OutputLimit => {
            if runtime.len() > MAX_RUNTIME_BYTES {
                return Err(error(
                    ErrorCode::OutputLimit,
                    "Trusted runtime exceeds 128 KiB",
                ));
            }
            let encoded = base64::engine::general_purpose::STANDARD.encode(runtime.as_bytes());
            let digest = hex::encode(Sha256::digest(encoded.as_bytes()));
            let count = encoded.len().div_ceil(CHUNK_LENGTH);
            for (index, chunk) in encoded.as_bytes().chunks(CHUNK_LENGTH).enumerate() {
                let mut input = scope.clone();
                input["digest"] = json!(digest);
                input["count"] = json!(count);
                input["length"] = json!(encoded.len());
                input["index"] = json!(index);
                input["chunk"] = json!(std::str::from_utf8(chunk).expect("runtime base64"));
                steps.push(request_runtime(
                    file,
                    page,
                    format!(
                        "return await WorldbendFigmaRuntimeTransport.stageRuntimeChunk({input});"
                    ),
                    "Stage bounded first-party runtime bytes; do not execute or change artwork",
                    RUNTIME_TRANSPORT,
                )?);
            }
            let mut input = scope.clone();
            input["digest"] = json!(digest);
            input["method"] = json!(method);
            steps.push(request_runtime(
                file,
                page,
                format!(
                    "return await WorldbendFigmaRuntimeTransport.executeTrustedRuntime({input});"
                ),
                description,
                RUNTIME_TRANSPORT,
            )?);
        }
        Err(issue) => return Err(issue),
    }
    Ok(())
}

impl PublicationCache {
    pub fn prepare(&self, mut candidate: FigmaRequest) -> TransformResult<PublicationOutput> {
        if !candidate
            .publication
            .as_ref()
            .is_some_and(|p| p.force_transport)
            && let Ok(mut bounded) = bounded_request(candidate.clone())
        {
            bounded.publication = None;
            return Ok(PublicationOutput::Inline(bounded));
        }
        let publication = candidate
            .publication
            .take()
            .ok_or_else(|| error(ErrorCode::OutputLimit, "Figma request exceeds 48 KiB"))?;
        let raw = serde_json::to_vec(&publication.arguments)
            .map_err(|_| error(ErrorCode::Schema, "Publication serialization failed"))?;
        if raw.len() > 16 * 1024 * 1024 {
            return Err(error(
                ErrorCode::OutputLimit,
                "Publication exceeds decoded capacity",
            ));
        }
        let bytes = if raw.len() > 128 * 1024 {
            let mut gzip =
                flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            gzip.write_all(&raw)
                .map_err(|_| error(ErrorCode::Schema, "Exact publication compression failed"))?;
            gzip.finish()
                .map_err(|_| error(ErrorCode::Schema, "Exact publication compression failed"))?
        } else {
            raw
        };
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        let count = encoded.len().div_ceil(CHUNK_LENGTH);
        if count == 0 || count > MAX_CHUNKS {
            return Err(error(
                ErrorCode::OutputLimit,
                "Publication transport exceeds 2 MiB; reduce the publication's media or geometry",
            ));
        }
        let id = hex::encode(Sha256::digest(format!(
            "{}:{}:{encoded}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        )));
        let payload_digest = hex::encode(Sha256::digest(encoded.as_bytes()));
        let scope = json!({"fileKey": candidate.file_key, "pageId": publication.page_id, "nodeId": publication.node_id, "transferId": id,"payloadDigest":payload_digest});
        let digest = checksum(encoded.as_bytes());
        let mut steps = Vec::with_capacity(count + 1);
        for (index, chunk) in encoded.as_bytes().chunks(CHUNK_LENGTH).enumerate() {
            let mut input = scope.clone();
            input["index"] = json!(index);
            input["count"] = json!(count);
            input["length"] = json!(encoded.len());
            input["checksum"] = json!(digest);
            input["chunk"] = json!(std::str::from_utf8(chunk).expect("base64 is ASCII"));
            steps.push(request(&candidate.file_key, &publication.page_id,
                format!("return await WorldbendFigmaMedia.stagePublicationChunk({input});"),
                "Stage one bounded publication chunk; the existing artwork and recipe stay unchanged")?);
        }
        if let Some((runtime, method)) = publication.preflight {
            append_trusted_phase(
                &mut steps,
                &candidate.file_key,
                &publication.page_id,
                &publication.node_id,
                &id,
                &payload_digest,
                &scope,
                runtime,
                method,
                "Validate transferred native geometry against the current artwork before guarded publication",
            )?;
        }
        let effect = match publication.finalizer.map(|(_, method)| method) {
            Some("initializeVectorWork") => "initialization",
            Some("readTransferredVectorRevision" | "readTransferredNativeVectorRevision") => {
                "capture"
            }
            _ => "publication",
        };
        let description = match effect {
            "capture" => {
                "Capture exact current source/work data on the owned candidate; preserve visible artwork and clear transfer data"
            }
            "initialization" => {
                "Save complete controls on the recoverable empty candidate; no artwork publication occurs"
            }
            _ => "Publish transferred content after checking live state; clear transport data",
        };
        if let Some((runtime, method)) = publication.finalizer {
            append_trusted_phase(
                &mut steps,
                &candidate.file_key,
                &publication.page_id,
                &publication.node_id,
                &id,
                &payload_digest,
                &scope,
                runtime,
                method,
                description,
            )?;
        } else {
            // Both libraries remain first-party source bytes. Data never selects
            // executable source. Transport the composed finalizer when needed.
            let runtime = format!(
                "{MEDIA_RUNTIME}\n{}\nWorldbendFigmaHandoff.__finish=q=>WorldbendFigmaMedia.finishPublication(q,(data,lease)=>WorldbendFigmaHandoff.{}(data,lease.validate));",
                publication.runtime.unwrap_or(PUBLISH_RUNTIME),
                publication.publisher
            );
            append_trusted_phase(
                &mut steps,
                &candidate.file_key,
                &publication.page_id,
                &publication.node_id,
                &id,
                &payload_digest,
                &scope,
                &runtime,
                "__finish",
                description,
            )?;
        }
        let cancel = request(
            &candidate.file_key,
            &publication.page_id,
            format!("return await WorldbendFigmaMedia.cancelPublication({scope});"),
            "Cancel this exact publication transfer and clear its staged chunks; preserve the current artwork",
        )?;
        let step_count = steps.len();
        let bytes = steps
            .iter()
            .map(|request| request.code.len())
            .sum::<usize>()
            + cancel.code.len();
        let mut cache = self
            .0
            .lock()
            .map_err(|_| error(ErrorCode::Internal, "Publication cache unavailable"))?;
        cache.retain(|_, transfer| transfer.created.elapsed() < TTL);
        if cache.len() >= MAX_TRANSFERS
            || cache.values().map(|transfer| transfer.bytes).sum::<usize>() + bytes
                > MAX_STORED_BYTES
        {
            return Err(error(
                ErrorCode::OutputLimit,
                "Publication cache is full; finish an active transfer or retry after its ten-minute expiry",
            ));
        }
        cache.insert(
            id.clone(),
            StoredTransfer {
                created: Instant::now(),
                steps,
                cancel,
                bytes,
            },
        );
        Ok(PublicationOutput::Transfer(TransferPlan {
            schema: "worldbend.figma.publication-transfer",
            version: "0.1",
            transfer_id: id,
            file_key: candidate.file_key,
            page_id: publication.page_id,
            node_id: publication.node_id,
            chunk_count: count,
            step_count,
            expires_in_seconds: TTL.as_secs(),
            next_operation: "figma_publication_step",
            effect,
        }))
    }

    pub fn step(&self, input: PublicationStepInput) -> TransformResult<PublicationStepOutput> {
        let valid_id = input.transfer_id.as_ref().is_some_and(|id| {
            id.len() == 64
                && id
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        });
        if usize::from(input.inspect)
            + usize::from(input.cancel)
            + usize::from(input.release)
            + usize::from(input.step.is_some())
            != 1
            || (input.inspect && (input.transfer_id.is_some() || input.scope.is_none()))
            || (!input.inspect && !valid_id)
            || (input.scope.is_some() && !input.inspect && !input.cancel)
        {
            return Err(error(
                ErrorCode::Schema,
                "Provide exactly one action: inspect=true with scope, or transferId with step, cancel=true or release=true; scope is also allowed for cross-session cancellation",
            ));
        }
        if let Some(scope) = input.scope {
            if [&scope.file_key, &scope.page_id, &scope.node_id]
                .iter()
                .any(|value| value.is_empty() || value.len() > 256)
            {
                return Err(error(
                    ErrorCode::Schema,
                    "Publication scope fields must contain 1..256 bytes",
                ));
            }
            let mut target =
                json!({"fileKey":scope.file_key,"pageId":scope.page_id,"nodeId":scope.node_id});
            let (operation, description) = if input.inspect {
                (
                    "inspectPublication",
                    "Inspect staged publication identity and progress on the granted target; preserve the artwork",
                )
            } else {
                target["transferId"] = json!(input.transfer_id);
                (
                    "cancelPublication",
                    "Cancel the inspected publication transfer across Agent sessions; preserve the artwork",
                )
            };
            return request(
                &scope.file_key,
                &scope.page_id,
                format!("return await WorldbendFigmaMedia.{operation}({target});"),
                description,
            )
            .map(PublicationStepOutput::Request);
        }
        let transfer_id = input.transfer_id.expect("validated transfer identity");
        let mut cache = self
            .0
            .lock()
            .map_err(|_| error(ErrorCode::Internal, "Publication cache unavailable"))?;
        cache.retain(|_, transfer| transfer.created.elapsed() < TTL);
        if input.release {
            cache.remove(&transfer_id);
            return Ok(PublicationStepOutput::Released {
                transfer_id,
                released: true,
            });
        }
        let transfer = cache.get(&transfer_id).ok_or_else(|| error(ErrorCode::Schema, "Publication transfer is missing or expired; inspect its scoped Figma transport, cancel any prior staging, then inspect the result and prepare it again"))?;
        if input.cancel {
            return Ok(PublicationStepOutput::Request(transfer.cancel.clone()));
        }
        transfer
            .steps
            .get(input.step.expect("validated step"))
            .cloned()
            .map(PublicationStepOutput::Request)
            .ok_or_else(|| error(ErrorCode::Schema, "Publication step is out of range"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::figma_handoff::PublicationData;

    fn candidate() -> FigmaRequest {
        FigmaRequest {
            file_key: "file".into(),
            skill_names: "figma-use",
            description: "test",
            code: "x".repeat(60000),
            publication: Some(PublicationData {
                force_transport: true,
                page_id: "page".into(),
                node_id: "result".into(),
                publisher: "publishMockupImage",
                runtime: None,
                finalizer: None,
                preflight: None,
                arguments: json!({"fileKey":"file","pageId":"page","nodeId":"result","imageBase64":"x".repeat(90000),"label":"新稿 🌀"}),
            }),
        }
    }
    #[test]
    fn prepared_steps_bind_the_original_payload_digest_not_document_metadata() {
        let request = candidate();
        let encoded = base64::engine::general_purpose::STANDARD
            .encode(serde_json::to_vec(&request.publication.as_ref().unwrap().arguments).unwrap());
        let expected = hex::encode(Sha256::digest(encoded.as_bytes()));
        let cache = PublicationCache::default();
        let PublicationOutput::Transfer(plan) = cache.prepare(request).unwrap() else {
            panic!("expected transfer")
        };
        let PublicationStepOutput::Request(finalizer) = cache
            .step(step(&plan.transfer_id, plan.step_count - 1))
            .unwrap()
        else {
            panic!("expected request")
        };
        let code = crate::figma_handoff::test_code(&finalizer);
        assert!(code.contains("payloadDigest"));
        assert!(code.contains(&format!("\"{expected}\"")));
    }
    fn plan(cache: &PublicationCache) -> TransferPlan {
        let PublicationOutput::Transfer(plan) = cache.prepare(candidate()).unwrap() else {
            panic!("expected transfer")
        };
        plan
    }
    fn step(transfer_id: &str, index: usize) -> PublicationStepInput {
        PublicationStepInput {
            transfer_id: Some(transfer_id.into()),
            scope: None,
            inspect: false,
            step: Some(index),
            cancel: false,
            release: false,
        }
    }

    #[test]
    fn chunk_finalization_uses_only_the_publishers_trusted_runtime() {
        let cache = PublicationCache::default();
        let mut request = candidate();
        let publication = request.publication.as_mut().unwrap();
        publication.publisher = "publishLinkedImage";
        publication.runtime =
            Some("var WorldbendFigmaHandoff={publishLinkedImage: trustedLinkedPublisher};");
        let PublicationOutput::Transfer(plan) = cache.prepare(request).unwrap() else {
            panic!()
        };
        let PublicationStepOutput::Request(finalize) = cache
            .step(step(&plan.transfer_id, plan.chunk_count))
            .unwrap()
        else {
            panic!()
        };
        assert!(
            crate::figma_handoff::test_code(&finalize)
                .contains("publishLinkedImage: trustedLinkedPublisher")
        );
        // A slow optional screenshot must not withhold the completed write's
        // receipt. The ordinary inspector supplies the subsequent visual.
        assert!(!crate::figma_handoff::test_code(&finalize).contains(".screenshot("));
        assert!(
            crate::figma_handoff::test_code(&finalize)
                .contains("WorldbendFigmaHandoff.publishLinkedImage(data,lease.validate)")
        );
        assert!(
            !crate::figma_handoff::test_code(&finalize).contains("function publishMockupImage")
        );
        assert!(serde_json::to_vec(&finalize).unwrap().len() <= 48 * 1024);
    }

    #[test]
    fn real_linked_and_revision_finalizers_fit_with_maximum_escaped_scope() {
        for (publisher, runtime, finalizer, finish) in [
            (
                "publishLinkedImage",
                include_str!("figma-runtime-linked-publish.js"),
                include_str!("figma-runtime-linked-finalize.js"),
                "finishLinkedPublication",
            ),
            (
                "publishWorkRevision",
                include_str!("figma-runtime-work-revise-publish.js"),
                include_str!("figma-runtime-work-revise-finalize.js"),
                "finishWorkRevision",
            ),
        ] {
            let cache = PublicationCache::default();
            let mut request = candidate();
            let id = "\\\"".repeat(128);
            request.file_key = id.clone();
            let publication = request.publication.as_mut().unwrap();
            publication.page_id = id.clone();
            publication.node_id = id.clone();
            publication.arguments["fileKey"] = json!(id);
            publication.arguments["pageId"] = json!(id);
            publication.arguments["nodeId"] = json!(id);
            publication.publisher = publisher;
            publication.runtime = Some(runtime);
            publication.finalizer = Some((finalizer, finish));
            let PublicationOutput::Transfer(plan) = cache.prepare(request).unwrap() else {
                panic!("expected large-image transport")
            };
            for index in 0..plan.step_count {
                let PublicationStepOutput::Request(request) =
                    cache.step(step(&plan.transfer_id, index)).unwrap()
                else {
                    panic!()
                };
                assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
                if index == plan.step_count - 1 {
                    assert!(
                        crate::figma_handoff::test_code(&request)
                            .contains(&format!("WorldbendFigmaHandoff.{finish}("))
                            || (crate::figma_handoff::test_code(&request)
                                .contains("executeTrustedRuntime")
                                && crate::figma_handoff::test_code(&request).contains(finish))
                    );
                    assert!(!request.code.contains("var WorldbendFigmaMedia="));
                    assert!(!request.code.contains(".screenshot("));
                }
            }
        }
    }

    #[test]
    fn ordinary_media_roundtrips_through_bounded_requests_and_a_small_receipt() {
        let cache = PublicationCache::default();
        let plan = plan(&cache);
        assert!(serde_json::to_vec(&plan).unwrap().len() < 1024);
        let mut encoded = String::new();
        for index in 0..plan.chunk_count {
            let PublicationStepOutput::Request(request) =
                cache.step(step(&plan.transfer_id, index)).unwrap()
            else {
                panic!()
            };
            assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
            let raw = request
                .code
                .split("WorldbendFigmaMedia.stagePublicationChunk(")
                .nth(1)
                .unwrap()
                .strip_suffix(");")
                .unwrap();
            let chunk: serde_json::Value = serde_json::from_str(raw).unwrap();
            encoded.push_str(chunk["chunk"].as_str().unwrap());
            assert_eq!(chunk["index"], index);
        }
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&decoded).unwrap(),
            candidate().publication.unwrap().arguments
        );
        let PublicationStepOutput::Request(finalize) = cache
            .step(step(&plan.transfer_id, plan.chunk_count))
            .unwrap()
        else {
            panic!()
        };
        assert!(serde_json::to_vec(&finalize).unwrap().len() <= 48 * 1024);
        assert!(
            crate::figma_handoff::test_code(&finalize)
                .contains("WorldbendFigmaHandoff.publishMockupImage(data,lease.validate)")
        );
        assert!(
            crate::figma_handoff::test_code(&finalize)
                .contains("WorldbendFigmaMedia.finishPublication(")
        );
        assert_eq!(
            cache
                .step(step(&plan.transfer_id, 0))
                .unwrap()
                .clone()
                .request_code(),
            cache
                .step(step(&plan.transfer_id, 0))
                .unwrap()
                .request_code()
        );
    }

    impl PublicationStepOutput {
        fn request_code(self) -> String {
            match self {
                Self::Request(request) => request.code,
                _ => panic!(),
            }
        }
    }

    #[test]
    fn capacity_failure_preserves_active_transfers_and_release_allows_continued_work() {
        let cache = PublicationCache::default();
        let plans: Vec<_> = (0..MAX_TRANSFERS).map(|_| plan(&cache)).collect();
        assert!(cache.prepare(candidate()).is_err());
        assert!(cache.step(step(&plans[0].transfer_id, 0)).is_ok());
        let release = PublicationStepInput {
            transfer_id: Some(plans[0].transfer_id.clone()),
            scope: None,
            inspect: false,
            step: None,
            cancel: false,
            release: true,
        };
        assert!(matches!(
            cache.step(release.clone()).unwrap(),
            PublicationStepOutput::Released { released: true, .. }
        ));
        assert!(cache.step(release).is_ok());
        assert!(cache.prepare(candidate()).is_ok());
    }

    #[test]
    fn expired_or_invalid_steps_fail_before_a_request_is_returned() {
        let cache = PublicationCache::default();
        let plan = plan(&cache);
        assert!(
            cache
                .step(step(&plan.transfer_id, plan.step_count))
                .is_err()
        );
        let mut ambiguous = step(&plan.transfer_id, 0);
        ambiguous.cancel = true;
        assert!(cache.step(ambiguous).is_err());
        cache
            .0
            .lock()
            .unwrap()
            .get_mut(&plan.transfer_id)
            .unwrap()
            .created = Instant::now() - TTL;
        assert!(cache.step(step(&plan.transfer_id, 0)).is_err());
        assert!(cache.0.lock().unwrap().is_empty());
        let mut oversized = candidate();
        oversized.publication.as_mut().unwrap().arguments["imageBase64"] =
            json!("x".repeat(17 * 1024 * 1024));
        assert!(cache.prepare(oversized).is_err());
        assert!(cache.0.lock().unwrap().is_empty());
    }

    #[test]
    fn cross_session_inspection_and_exact_cancellation_need_no_preparing_cache() {
        let cache = PublicationCache::default();
        let scope = json!({"fileKey":"file","pageId":"page","nodeId":"result"});
        let inspect = serde_json::from_value(json!({"scope":scope,"inspect":true})).unwrap();
        let PublicationStepOutput::Request(request) = cache.step(inspect).unwrap() else {
            panic!()
        };
        assert!(
            request
                .code
                .contains("WorldbendFigmaMedia.inspectPublication(")
        );
        assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
        let cancel = serde_json::from_value(
            json!({"scope":scope,"cancel":true,"transferId":"a".repeat(64)}),
        )
        .unwrap();
        let PublicationStepOutput::Request(request) = cache.step(cancel).unwrap() else {
            panic!()
        };
        assert!(
            request
                .code
                .contains("WorldbendFigmaMedia.cancelPublication(")
        );
        assert!(request.code.contains(&"a".repeat(64)));
        for invalid in [
            json!({"inspect":true}),
            json!({"scope":scope,"inspect":true,"transferId":"a".repeat(64)}),
            json!({"scope":scope,"step":0,"transferId":"a".repeat(64)}),
            json!({"scope":{"fileKey":"","pageId":"page","nodeId":"result"},"inspect":true}),
        ] {
            assert!(
                cache
                    .step(serde_json::from_value(invalid).unwrap())
                    .is_err()
            );
        }
        assert!(cache.0.lock().unwrap().is_empty());
    }

    #[test]
    fn small_publications_keep_the_existing_inline_request_shape() {
        let cache = PublicationCache::default();
        let mut small = candidate();
        small.publication.as_mut().unwrap().force_transport = false;
        small.code = "return {};".into();
        let PublicationOutput::Inline(request) = cache.prepare(small).unwrap() else {
            panic!()
        };
        assert!(request.publication.is_none());
        assert!(serde_json::to_value(request).unwrap().get("code").is_some());
        assert!(cache.0.lock().unwrap().is_empty());
    }
}

//! Project the selected document expression into the existing native publishers.
//! No path capture, projective arithmetic or implicit asset lookup lives here.
use super::*;
const FRAME_REVISION: &str =
    include_str!("../../figma-runtime-native-continuation-revise-frame.js");
const VECTOR_REVISION: &str =
    include_str!("../../figma-runtime-native-continuation-revise-vector.js");

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeAssetNode {
    #[schemars(length(min = 1, max = 64))]
    asset_id: String,
    node_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_facts: Option<figma_handoff::FigmaNativeSourceFacts>,
}
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeDocumentRevisionInput {
    base: NativeSnapshot,
    document: SpatialDocumentSpec,
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    expected_fingerprint: String,
    expression_id: String,
    source: NativeAssetNode,
    #[serde(default)]
    #[schemars(range(min = 0, max = 255))]
    part: u16,
    #[serde(default)]
    token: Option<String>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NativeRevisionExecution {
    FramePublication,
    FrameSourceProbe,
    VectorProposal,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NativeRevisionLoss {
    NamedDeliveryOutputsRemainInDocument,
    AssetContentVersionsAreCallerOwned,
    IndependentNativeContentCopy,
    PreviousNativeContentRetainedOnPage,
    NativeResolvedVariableModesLocalized,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeDocumentRevision {
    schema: String,
    version: String,
    document_fingerprint: String,
    expression_id: String,
    carrier: NativeCarrier,
    execution: NativeRevisionExecution,
    source: NativeAssetNode,
    output: SpatialTemplateOutput,
    spec: TransformSpec,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation: Option<LinkedOperation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    operation_encoded: Option<crate::figma_exact_json::ExactJsonEnvelope>,
    canvas: Size,
    losses: Vec<NativeRevisionLoss>,
    pub(crate) request: crate::figma_publication::PublicationOutput,
}
pub(super) fn prepare(
    input: NativeDocumentRevisionInput,
) -> TransformResult<NativeDocumentRevision> {
    input.base.validate()?;
    let inspected = inspect_spatial_document(&input.document)?;
    if inspected.fingerprint != input.expected_fingerprint {
        return Err(error(
            "Document changed; inspect its current fingerprint before native revision",
        ));
    }
    figma_handoff::identity(&input.source.node_id)?;
    let expression = input
        .document
        .expressions
        .iter()
        .find(|expression| expression.id() == input.expression_id)
        .ok_or_else(|| error("Select an existing document expression"))?;
    let SpatialDocumentExpression::Static {
        template, bindings, ..
    } = expression
    else {
        return Err(error(
            "Native Perspective authoring requires a static transform expression; temporal mockup-video revises through raster Mockup authoring",
        ));
    };
    let SpatialTemplateOperation::RasterProgram {
        source_slot,
        program,
    } = &template.operation
    else {
        return Err(error(
            "Native Perspective authoring requires the expression's transform program",
        ));
    };
    let [stage] = program.stages.as_slice() else {
        return Err(error(
            "Keep unsupported multi-stage authoring in the document instead of dropping stages",
        ));
    };
    let (spec, size, operation) = match stage {
        RasterProgramStage::Transform {
            spec,
            canvas: RasterProgramCanvasMode::Reference,
            target_size: Some(size),
            ..
        } => {
            if input.base.carrier == NativeCarrier::Frame && spec.content.warp.is_some() {
                return Err(error(
                    "Native Frame cannot represent nonlinear Warp; use Vector or linked HD",
                ));
            }
            (
                spec.clone(),
                *size,
                LinkedOperation::Transform { spec: spec.clone() },
            )
        }
        RasterProgramStage::DeformationWork { spec, .. }
            if input.base.carrier == NativeCarrier::Vector =>
        {
            let NativeBase::Vector(origin) = &input.base.base else {
                return Err(error("Complete native Vector origin required"));
            };
            let (view, index, domain) = match origin.operation.as_ref() {
                Some(LinkedOperation::Task {
                    task: LinkedTask::Deformation(task),
                }) => match task.as_ref() {
                    DeformationTask::Deformation {
                        view,
                        shape_guide_source_index,
                        shape_guide_domain,
                        ..
                    } => (
                        view.clone(),
                        *shape_guide_source_index,
                        shape_guide_domain.clone(),
                    ),
                    _ => return Err(error("Preserve native deformation work origin")),
                },
                _ => (figma_linked::DeformationView::Mesh, None, None),
            };
            let size = spec
                .target_size
                .ok_or_else(|| error("Resolve the portable work's explicit output canvas"))?;
            (
                spec.transform.clone(),
                size,
                LinkedOperation::Task {
                    task: LinkedTask::Deformation(Box::new(DeformationTask::Deformation {
                        view,
                        spec: Box::new(spec.clone()),
                        shape_guide_source_index: index,
                        shape_guide_domain: domain,
                    })),
                },
            )
        }
        _ => {
            return Err(error(
                "Keep unsupported stages in the document; native Vector returns complete Transform/Warp or DeformationWork, never a projection-only approximation",
            ));
        }
    };
    if spec.destination.space != CoordinateSpace::Normalized
        || ![size.width, size.height]
            .iter()
            .all(|v| v.is_finite() && (0.01..=4096.).contains(v))
    {
        return Err(error(
            "Use normalized native controls and logical axes in 0.01..4096",
        ));
    }
    let [binding] = bindings.as_slice() else {
        return Err(error("Bind exactly this native expression's content asset"));
    };
    if binding.slot_id != *source_slot
        || binding.asset_id != input.source.asset_id
        || binding.role != SpatialDocumentBindingRole::Content
    {
        return Err(error(
            "Bind exactly the selected expression's content asset to its current native source",
        ));
    }
    let facts = input.base.facts();
    if input.source.node_id == facts.node {
        return Err(error("Native source cannot be its own result"));
    }
    let solved = solve_spec(
        &spec,
        Some(Size::new(size.width.ceil(), size.height.ceil())),
    )?;
    let mut args = json!({"carrier":input.base.carrier,"fileKey":facts.file,"pageId":facts.page,"nodeId":facts.node,
        "targetExpected":input.base.target_expected,"sourceExpected":input.base.source_expected,"svgExpected":input.base.source.preview_fingerprint,
        "sourceNodeId":input.source.node_id,"spec":spec,"width":size.width,"height":size.height});
    let (execution, runtime, call, description) = match input.base.carrier {
        NativeCarrier::Frame => {
            if input.part != 0 || input.token.is_some() {
                return Err(error(
                    "Native Frame publication is a whole guarded operation, not a paged read",
                ));
            }
            args["inverse"] = json!(solved.homography.inverse);
            args["renderWidth"] = json!(size.width.ceil() as u32);
            args["renderHeight"] = json!(size.height.ceil() as u32);
            let component =
                matches!(&input.base.base,NativeBase::Frame(base) if base.component_frame);
            let replacing = input.source.node_id != facts.source;
            if component && replacing && input.source.source_facts.is_none() {
                (
                    NativeRevisionExecution::FrameSourceProbe,
                    FRAME_REVISION,
                    "readNativeReplacementSource",
                    "Read the replacement Frame's actual source facts before core planning; repeat reviseNative with the returned sourceFacts",
                )
            } else {
                if component {
                    let source_size = if let Some(source) = &input.source.source_facts {
                        if source.source_node_id != input.source.node_id
                            || source.expected.is_empty()
                            || source.expected.len() > 256
                        {
                            return Err(error(
                                "Use current native source facts for the selected replacement",
                            ));
                        }
                        args["sourceFacts"] = json!(source);
                        Size::new(source.width, source.height)
                    } else {
                        Size::new(input.base.source.width, input.base.source.height)
                    };
                    args["nativePlan"] = json!(worldbend_core::plan_native_frame(
                        &worldbend_core::NativeFramePlanInput {
                            spec: spec.clone(),
                            source_size,
                            output_size: size,
                        }
                    )?);
                }
                (
                    NativeRevisionExecution::FramePublication,
                    FRAME_REVISION,
                    "reviseNativeFrame",
                    "Apply this document's core-solved controls to the guarded native Frame; explicit source replacement creates independent editable Content and retains its previous source",
                )
            }
        }
        NativeCarrier::Vector => {
            page_guard(input.part, input.token.as_ref(), 255)?;
            args["part"] = json!(input.part);
            if let Some(token) = input.token {
                args["token"] = json!(token);
            }
            (
                NativeRevisionExecution::VectorProposal,
                VECTOR_REVISION,
                "readNativeVectorRevision",
                "Read a guarded native Vector proposal for the selected document expression; project and publish it through figma_vector_work",
            )
        }
    };
    let request = if input.base.carrier == NativeCarrier::Vector && input.part == 0 {
        args["operation"] = json!(operation);
        args.as_object_mut().unwrap().remove("spec");
        let mut candidate = figma_handoff::publication_request_runtime(
            facts.file.into(),
            facts.page.into(),
            facts.node.into(),
            "readTransferredNativeVectorRevision",
            args.clone(),
            description,
            Some(runtime),
        )?;
        let p = candidate.publication.as_mut().unwrap();
        p.force_transport = true;
        p.finalizer = Some((VECTOR_REVISION, "readTransferredNativeVectorRevision"));
        candidate
    } else {
        // Retain publication metadata until the shared cache can choose the
        // ordinary packet or its existing bounded argument/runtime transport.
        // Checking the whole native runtime here rejects valid Frame edits
        // before that fallback is reachable.
        let mut candidate = packet_candidate(
            input.base.carrier,
            facts.file.into(),
            facts.page,
            format!("{call}({args})"),
            Some(runtime),
            description,
        )?;
        candidate.publication = Some(figma_handoff::PublicationData {
            force_transport: false,
            page_id: facts.page.into(),
            node_id: facts.node.into(),
            publisher: call,
            arguments: args,
            runtime: Some(runtime),
            finalizer: None,
            preflight: None,
        });
        candidate
    };
    let mut losses = vec![
        NativeRevisionLoss::NamedDeliveryOutputsRemainInDocument,
        NativeRevisionLoss::AssetContentVersionsAreCallerOwned,
    ];
    if input.base.carrier == NativeCarrier::Frame && input.source.node_id != facts.source {
        losses.extend([
            NativeRevisionLoss::IndependentNativeContentCopy,
            NativeRevisionLoss::PreviousNativeContentRetainedOnPage,
            NativeRevisionLoss::NativeResolvedVariableModesLocalized,
        ]);
    }
    let large = serde_json::to_vec(&operation)
        .map_err(|_| error("Complete native operation serialization failed"))?
        .len()
        > 64 * 1024;
    let operation_encoded = large
        .then(|| crate::figma_exact_json::encode(&operation))
        .transpose()?;
    Ok(NativeDocumentRevision {
        schema: "worldbend.figma.native-document-revision".into(),
        version: if large { "0.3" } else { "0.1" }.into(),
        document_fingerprint: inspected.fingerprint,
        expression_id: input.expression_id,
        carrier: input.base.carrier,
        execution,
        source: input.source,
        output: template.output.clone(),
        spec,
        operation: (!large).then_some(operation),
        operation_encoded,
        canvas: size,
        losses,
        request: crate::figma_publication::PublicationOutput::Inline(request),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_large_native_work_returns_lossless_controls_with_bounded_real_requests() {
        let mut saved = json!(super::super::tests::snapshot(NativeCarrier::Vector));
        let samples=(0..256).map(|i|json!({"position":{"x":((i%16)+1) as f64/17.,"y":((i/16)+1) as f64/17.},
            "delta":{"x":(i as f64).sin()*0.00001,"y":(i as f64).cos()*0.00001},"radius":0.08,"strength":0.01})).collect::<Vec<_>>();
        let operation = json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":{
            "schema":"worldbend.deformation-work","version":"0.1","transform":saved["base"]["spec"],"meshSubdivisions":16,
            "surface":{"envelope":{"columns":1,"rows":1,"points":(0..16).map(|i|json!({"x":(i%4) as f64/3.,"y":(i/4) as f64/3.})).collect::<Vec<_>>()},
                "anchors":[],"strokes":(0..4).map(|i|json!({"id":format!("pin-{i}"),"samples":samples})).collect::<Vec<_>>()},
            "liquify":{"strokes":(0..4).map(|i|json!({"id":format!("brush-{i}"),"mode":"push","samples":samples})).collect::<Vec<_>>()},"meshEdits":[]}}});
        saved["version"] = json!("0.3");
        saved["base"]["version"] = json!("0.3");
        saved["base"]["operation"] = operation;
        saved["base"]["operationExpected"] = json!("a".repeat(64));
        saved["base"]["sourceNodeIds"] = json!(["artwork"]);
        saved["base"]["sourceView"] =
            json!({"policy":"logical","bounds":{"x":0,"y":0,"width":850,"height":500}});
        let base: NativeSnapshot = serde_json::from_value(saved).unwrap();
        let continued = project(base.clone(), "native".into(), None).unwrap();
        let expected = match &continued.document.expressions[0] {
            SpatialDocumentExpression::Static { template, .. } => {
                let SpatialTemplateOperation::RasterProgram { program, .. } = &template.operation
                else {
                    panic!()
                };
                let RasterProgramStage::DeformationWork { spec, .. } = &program.stages[0] else {
                    panic!()
                };
                json!({"kind":"task","task":{"kind":"deformation","view":"mesh","spec":spec}})
            }
            _ => panic!(),
        };
        let value = prepare(NativeDocumentRevisionInput {
            base,
            expected_fingerprint: inspect_spatial_document(&continued.document)
                .unwrap()
                .fingerprint,
            document: continued.document,
            expression_id: "native".into(),
            source: NativeAssetNode {
                asset_id: "source-1".into(),
                node_id: "artwork".into(),
                source_facts: None,
            },
            part: 0,
            token: None,
        })
        .unwrap();
        assert!(value.operation.is_none());
        assert_eq!(value.version, "0.3");
        assert_eq!(
            crate::figma_exact_json::decode(value.operation_encoded.clone().unwrap()).unwrap(),
            expected
        );
        assert_packet_limits(&value);
        let response = crate::figma_work_continuation::Output::NativeRevision(value)
            .prepare_publication(&crate::figma_publication::PublicationCache::default())
            .unwrap();
        assert!(serde_json::to_vec(&response).unwrap().len() < 128 * 1024);
    }
    fn source_code(value: &NativeDocumentRevision) -> String {
        let crate::figma_publication::PublicationOutput::Inline(request) = &value.request else {
            panic!("pure preparation request")
        };
        figma_handoff::test_code(request)
    }
    fn assert_packet_limits(value: &NativeDocumentRevision) {
        use crate::figma_publication::{
            PublicationCache, PublicationOutput, PublicationStepOutput,
        };
        let PublicationOutput::Inline(candidate) = &value.request else {
            panic!("pure preparation request")
        };
        let cache = PublicationCache::default();
        match cache.prepare(candidate.clone()).unwrap() {
            PublicationOutput::Inline(request) => {
                assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024)
            }
            PublicationOutput::Transfer(plan) => {
                let plan = serde_json::to_value(plan).unwrap();
                for step in 0..plan["stepCount"].as_u64().unwrap() {
                    let PublicationStepOutput::Request(request) = cache
                        .step(
                            serde_json::from_value(
                                json!({"transferId":plan["transferId"],"step":step}),
                            )
                            .unwrap(),
                        )
                        .unwrap()
                    else {
                        panic!()
                    };
                    assert!(serde_json::to_vec(&request).unwrap().len() <= 48 * 1024);
                }
            }
        }
    }
    fn input(carrier: NativeCarrier) -> NativeDocumentRevisionInput {
        let base = super::super::tests::snapshot(carrier);
        let mut document = project(base.clone(), "native".into(), None)
            .unwrap()
            .document;
        let SpatialDocumentExpression::Static { template, .. } = &mut document.expressions[0]
        else {
            panic!()
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &mut template.operation
        else {
            panic!()
        };
        let RasterProgramStage::Transform {
            target_size, spec, ..
        } = &mut program.stages[0]
        else {
            panic!()
        };
        *target_size = Some(Size::new(700.5, 480.25));
        spec.destination.quad.tr.x = 0.9;
        NativeDocumentRevisionInput {
            base,
            expected_fingerprint: inspect_spatial_document(&document).unwrap().fingerprint,
            document,
            expression_id: "native".into(),
            source: NativeAssetNode {
                asset_id: "source-1".into(),
                node_id: "artwork".into(),
                source_facts: None,
            },
            part: 0,
            token: None,
        }
    }
    #[test]
    fn revised_documents_keep_fractional_native_canvas_and_the_core_solved_controls() {
        for carrier in [NativeCarrier::Frame, NativeCarrier::Vector] {
            let i = input(carrier);
            let fingerprint = i.expected_fingerprint.clone();
            let value = prepare(i).unwrap();
            assert_eq!(value.document_fingerprint, fingerprint);
            assert_eq!(value.canvas, Size::new(700.5, 480.25));
            assert_eq!(value.spec.destination.quad.tr.x, 0.9);
            assert!(source_code(&value).contains("\"width\":700.5"));
            assert!(source_code(&value).contains("\"height\":480.25"));
            assert_packet_limits(&value);
            if carrier == NativeCarrier::Frame {
                let core = solve_spec(&value.spec, Some(Size::new(701., 481.))).unwrap();
                assert!(
                    source_code(&value)
                        .contains(&format!("\"inverse\":{}", json!(core.homography.inverse)))
                );
                assert!(source_code(&value).contains("\"renderWidth\":701"));
                assert!(source_code(&value).contains("reviseNativeFrame"));
            } else {
                assert!(source_code(&value).contains("readTransferredNativeVectorRevision"));
            }
        }
    }
    #[test]
    fn later_vector_pages_keep_the_same_bounded_transport_route() {
        let mut i = input(NativeCarrier::Vector);
        i.part = 1;
        i.token = Some("hash32x2:1000:0123456789abcdef".into());
        let value = prepare(i).unwrap();
        assert!(source_code(&value).contains("readNativeVectorRevision"));
        assert_packet_limits(&value);
    }

    #[test]
    fn native_authoring_rejects_changed_documents_binding_drift_and_unsupported_programs() {
        for index in 0..7 {
            let mut i = input(NativeCarrier::Frame);
            match index {
                0 => i.expected_fingerprint = format!("sha256:{}", "0".repeat(64)),
                1 => i.expression_id = "missing".into(),
                2 => i.source.asset_id = "different".into(),
                3 => i.source.node_id = "result".into(),
                4 => i.part = 1,
                5 => i.base.source.node_id = "changed-snapshot-source".into(),
                _ => {
                    let SpatialDocumentExpression::Static { template, .. } =
                        &mut i.document.expressions[0]
                    else {
                        panic!()
                    };
                    let SpatialTemplateOperation::RasterProgram { program, .. } =
                        &mut template.operation
                    else {
                        panic!()
                    };
                    program.stages.push(program.stages[0].clone());
                    i.expected_fingerprint = inspect_spatial_document(&i.document)
                        .map(|v| v.fingerprint)
                        .unwrap_or_default();
                }
            }
            assert!(prepare(i).is_err(), "{index}");
        }
        let mut i = input(NativeCarrier::Vector);
        i.source.node_id = "replacement-artwork".into();
        let value = prepare(i).unwrap();
        assert!(source_code(&value).contains("replacement-artwork"));
        let mut i = input(NativeCarrier::Vector);
        i.part = 1;
        assert!(prepare(i).is_err());
        let i = input(NativeCarrier::Frame);
        let mut value = serde_json::to_value(i.base).unwrap();
        value["unknown"] = json!(true);
        assert!(serde_json::from_value::<NativeSnapshot>(value).is_err());
    }
    #[test]
    fn native_frame_replacement_keeps_explicit_asset_origin_and_reports_independent_content_identity()
     {
        let mut i = input(NativeCarrier::Frame);
        i.source.node_id = "external-frame".into();
        let value = prepare(i).unwrap();
        assert_eq!(value.source.node_id, "external-frame");
        assert!(source_code(&value).contains("\"sourceNodeId\":\"external-frame\""));
        let losses = serde_json::to_value(&value.losses).unwrap();
        assert!(
            losses
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "independentNativeContentCopy")
        );
        assert!(
            losses
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "previousNativeContentRetainedOnPage")
        );
        assert_packet_limits(&value);
    }
}

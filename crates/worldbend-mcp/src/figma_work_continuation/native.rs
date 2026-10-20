//! Native carriers retain their own editable source; the portable expression
//! reuses the existing Transform stage and explicit source-media loss receipt.
use super::*;
use crate::figma_handoff::FigmaSnapshot;
use crate::figma_vector::{self, VectorSnapshot};

const FRAME: &str = include_str!("../figma-runtime-native-continuation-frame.js");
const VECTOR: &str = include_str!("../figma-runtime-native-continuation-vector.js");
mod revision;
pub use revision::{NativeDocumentRevision, NativeDocumentRevisionInput};
#[derive(Debug, Clone, Copy, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NativeCarrier {
    Frame,
    Vector,
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum NativeBase {
    Frame(Box<FigmaSnapshot>),
    Vector(Box<VectorSnapshot>),
}
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeSnapshot {
    schema: String,
    version: String,
    carrier: NativeCarrier,
    base: NativeBase,
    target_expected: String,
    source_expected: String,
    source: FigmaMockupSource,
    #[schemars(range(min = 1, max = 8388608))]
    svg_bytes: usize,
    #[schemars(length(max = 32))]
    source_effects: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_capture: Option<worldbend_core::SourceCaptureFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_view: Option<figma_vector::VectorSourceView>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    shape_guide_clip: Option<worldbend_core::MockupClip>,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum NativeLoss {
    SourceMediaNotEmbedded,
    FigmaPlacementNotTransferred,
    PreviewFingerprintNotContentDigest,
    NativeResultAppearanceNotTransferred,
    PublishedPixelsNotCarried,
    NativeLayoutAndTextEditingRemainInFigma,
    SourceSvgRasterizedForStaticDelivery,
    SourceEffectsRequireCarrierFidelityReview,
    FractionalCanvasRoundedToRasterPixels,
    NativeGuideEditingRemainsInFigma,
}
#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NativeContinuation {
    schema: String,
    version: String,
    origin: NativeSnapshot,
    expression_id: String,
    source_bindings: Vec<SourceBinding>,
    document: SpatialDocumentSpec,
    delivery_plan: SpatialDocumentDeliveryPlan,
    render_quality: SamplingQuality,
    losses: Vec<NativeLoss>,
}
struct Facts<'a> {
    file: &'a str,
    page: &'a str,
    node: &'a str,
    source: &'a str,
    spec: &'a TransformSpec,
    placement: &'a FigmaPlacement,
}
impl NativeSnapshot {
    fn facts(&self) -> Facts<'_> {
        match &self.base {
            NativeBase::Frame(b) => Facts {
                file: &b.file_key,
                page: &b.page_id,
                node: &b.node_id,
                source: &b.source.node_id,
                spec: &b.spec,
                placement: &b.placement,
            },
            NativeBase::Vector(b) => Facts {
                file: &b.file_key,
                page: &b.page_id,
                node: &b.node_id,
                source: &b.source_node_id,
                spec: &b.spec,
                placement: &b.placement,
            },
        }
    }
    fn validate(&self) -> TransformResult<()> {
        match (&self.carrier, &self.base) {
            (NativeCarrier::Frame, NativeBase::Frame(b)) => {
                figma_handoff::validate_native_snapshot(b)?;
                if b.source.width != self.source.width || b.source.height != self.source.height {
                    return Err(error("Native Frame source bounds changed"));
                }
            }
            (NativeCarrier::Vector, NativeBase::Vector(b)) => {
                figma_vector::snapshot(b)?;
                if !b.published {
                    return Err(error(
                        "Publish the native Vector before document continuation",
                    ));
                }
            }
            _ => return Err(error("Native carrier and inspected base must agree")),
        }
        let is_component = matches!(&self.base,NativeBase::Frame(b) if b.component_frame);
        if is_component != self.source_capture.is_some() {
            return Err(error("Component source needs exact SVG capture facts"));
        }
        if let Some(capture) = &self.source_capture {
            if capture.logical_size != Size::new(self.source.width, self.source.height) {
                return Err(error("Native SVG logical source size changed"));
            }
            worldbend_core::source_capture_to_logical(capture)?;
        }
        let f = self.facts();
        for id in [f.file, f.page, f.node, f.source] {
            figma_handoff::identity(id)?;
        }
        for token in [&self.target_expected, &self.source_expected] {
            bounded_token(token)?;
        }
        let preview = self
            .source
            .preview_fingerprint
            .strip_prefix("preview32x2:")
            .and_then(|v| v.split_once(':'));
        if !preview.is_some_and(|(length, hash)| {
            length.parse::<usize>().ok() == Some(self.svg_bytes)
                && hash.len() == 16
                && hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) {
            return Err(error(
                "Use the native SVG byte preview token matching svgBytes",
            ));
        }
        if self.schema != "worldbend.figma.native-continuation-snapshot"
            || !["0.1", "0.3"].contains(&self.version.as_str())
            || self.source.slot_id != "source-1"
            || self.source.node_id != f.source
            || f.source == f.node
            || self.source.name.chars().count() > 128
            || self.svg_bytes == 0
            || self.svg_bytes > 8 * 1024 * 1024
            || ![self.source.width, self.source.height].iter().all(|n| {
                n.is_finite()
                    && *n >= 0.01
                    && (matches!(&self.base,NativeBase::Frame(b) if b.component_frame)
                        || *n <= 4096.0)
            })
            || self.source_effects.len() > 32
            || self
                .source_effects
                .iter()
                .any(|v| v.is_empty() || v.len() > 64)
            || self.source_effects.iter().collect::<HashSet<_>>().len() != self.source_effects.len()
        {
            return Err(error(
                "Use the complete current native continuation snapshot",
            ));
        }
        Ok(())
    }
}
fn packet_runtime(
    carrier: NativeCarrier,
    file: String,
    page: &str,
    call: String,
    override_runtime: Option<&str>,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    figma_handoff::bounded_request(packet_candidate(
        carrier,
        file,
        page,
        call,
        override_runtime,
        description,
    )?)
}

// Native state/source pages have no published result for a screenshot.
// Retain that wrapper when a revision enters the shared publication cache.
fn packet_candidate(
    carrier: NativeCarrier,
    file: String,
    page: &str,
    call: String,
    override_runtime: Option<&str>,
    description: &'static str,
) -> TransformResult<FigmaRequest> {
    figma_handoff::identity(&file)?;
    figma_handoff::identity(page)?;
    let runtime = override_runtime.unwrap_or(match carrier {
        NativeCarrier::Frame => FRAME,
        NativeCarrier::Vector => VECTOR,
    });
    let encoded_file = json!(file);
    let encoded_page = json!(page);
    // State/media parts have no result nodeId. Do not use the older handoff
    // wrapper which takes a screenshot from a whole-result snapshot.
    Ok(FigmaRequest {
        file_key: file,
        skill_names: "figma-use",
        publication: None,
        description,
        code: format!(
            "if(figma.fileKey!=={encoded_file})throw Error('E_FIGMA_SCOPE');const p=await figma.getNodeByIdAsync({encoded_page});if(p?.type!=='PAGE')throw Error('E_FIGMA_SCOPE');await figma.setCurrentPageAsync(p);\n{runtime}\nreturn await WorldbendFigmaHandoff.{call};"
        ),
    })
}
fn packet(
    carrier: NativeCarrier,
    file: String,
    page: &str,
    call: String,
) -> TransformResult<FigmaRequest> {
    packet_runtime(
        carrier,
        file,
        page,
        call,
        None,
        "Read current native work and exact unprojected source bytes without changing the canvas",
    )
}
pub(super) fn revise(
    input: NativeDocumentRevisionInput,
) -> TransformResult<NativeDocumentRevision> {
    revision::prepare(input)
}
pub(super) fn inspect(
    carrier: NativeCarrier,
    file: String,
    page: String,
    node: String,
    part: u16,
    token: Option<String>,
) -> TransformResult<FigmaRequest> {
    for id in [&file, &page, &node] {
        figma_handoff::identity(id)?;
    }
    page_guard(part, token.as_ref(), 255)?;
    let args = json!({"carrier":carrier,"fileKey":file,"pageId":page,"nodeId":node,"part":part,"token":token});
    // Optional token must be omitted: the host distinguishes absent from null.
    let mut args = args;
    if token.is_none() {
        args.as_object_mut().unwrap().remove("token");
    }
    packet(
        carrier,
        file,
        &page,
        format!("readNativeContinuation({args})"),
    )
}
fn page_guard(part: u16, token: Option<&String>, max: u16) -> TransformResult<()> {
    if part > max || (part > 0 && token.is_none()) {
        return Err(error("Use this native read's complete part token"));
    }
    if let Some(token) = token {
        bounded_token(token)?;
    }
    Ok(())
}
pub(super) fn source(
    snapshot: NativeSnapshot,
    part: u16,
    token: Option<String>,
) -> TransformResult<FigmaRequest> {
    snapshot.validate()?;
    page_guard(part, token.as_ref(), 1023)?;
    let f = snapshot.facts();
    let mut args = json!({"carrier":snapshot.carrier,"fileKey":f.file,"pageId":f.page,"nodeId":f.node,
        "targetExpected":snapshot.target_expected,"sourceExpected":snapshot.source_expected,"svgExpected":snapshot.source.preview_fingerprint,"part":part});
    if let Some(token) = token {
        args["token"] = json!(token);
    }
    if let Some(capture) = &snapshot.source_capture {
        args["sourceProjection"] =
            json!({"capture":capture,"matrix":worldbend_core::source_capture_to_logical(capture)?});
    }
    packet(
        snapshot.carrier,
        f.file.into(),
        f.page,
        format!("readNativeSource({args})"),
    )
}
pub(super) fn project(
    snapshot: NativeSnapshot,
    expression_id: String,
    output: Option<SpatialTemplateOutput>,
) -> TransformResult<NativeContinuation> {
    snapshot.validate()?;
    let f = snapshot.facts();
    let (stage, guided) = match &snapshot.base {
        NativeBase::Vector(base) if base.operation.is_some() => {
            let operation = figma_linked::refresh_operation(
                base.operation.as_ref().unwrap(),
                snapshot.shape_guide_clip.as_ref(),
            )?;
            match operation {
                LinkedOperation::Transform { spec } => (
                    RasterProgramStage::Transform {
                        id: "output".into(),
                        spec,
                        canvas: RasterProgramCanvasMode::Reference,
                        target_size: Some(Size::new(f.placement.width, f.placement.height)),
                    },
                    false,
                ),
                LinkedOperation::Task {
                    task: LinkedTask::Deformation(task),
                } => match *task {
                    DeformationTask::Deformation {
                        mut spec,
                        shape_guide_source_index,
                        ..
                    } => {
                        // The original owning value survives in origin. Bind a
                        // previously implicit output canvas for portable media.
                        spec.target_size = Some(Size::new(
                            f.placement.width.ceil(),
                            f.placement.height.ceil(),
                        ));
                        (
                            RasterProgramStage::DeformationWork {
                                id: "output".into(),
                                spec: *spec,
                            },
                            shape_guide_source_index.is_some(),
                        )
                    }
                    _ => return Err(error("Preserve complete canonical deformation work")),
                },
                _ => return Err(error("Use this native operation's existing carrier")),
            }
        }
        _ => (
            RasterProgramStage::Transform {
                id: "output".into(),
                spec: match &snapshot.base {
                    NativeBase::Frame(base) => match &base.affine_state {
                        Some(state) => worldbend_core::rebase_native_affine(state)?,
                        None => base.spec.clone(),
                    },
                    NativeBase::Vector(_) => f.spec.clone(),
                },
                canvas: RasterProgramCanvasMode::Reference,
                target_size: Some(Size::new(f.placement.width, f.placement.height)),
            },
            false,
        ),
    };
    let template = SpatialTemplateSpec {
        schema: SPATIAL_TEMPLATE_SCHEMA.into(),
        version: SPATIAL_TEMPLATE_VERSION.into(),
        operation: SpatialTemplateOperation::RasterProgram {
            source_slot: "source-1".into(),
            program: RasterProgramSpec {
                schema: RASTER_PROGRAM_SCHEMA.into(),
                version: RASTER_PROGRAM_VERSION.into(),
                stages: vec![stage],
            },
        },
        output: output.unwrap_or(SpatialTemplateOutput::Single {
            id: "output".into(),
        }),
    };
    let ready = prepare_spatial_static_delivery(&SpatialStaticDeliveryInput {
        expression_id: expression_id.clone(),
        template,
        assets: vec![SpatialDocumentAsset {
            id: "source-1".into(),
            content_version: Some(format!(
                "figma-svg-preview:{}",
                snapshot.source.preview_fingerprint
            )),
        }],
        bindings: vec![SpatialDocumentBinding {
            role: SpatialDocumentBindingRole::Content,
            slot_id: "source-1".into(),
            asset_id: "source-1".into(),
        }],
    })?;
    let mut losses = vec![
        NativeLoss::SourceMediaNotEmbedded,
        NativeLoss::FigmaPlacementNotTransferred,
        NativeLoss::PreviewFingerprintNotContentDigest,
        NativeLoss::NativeResultAppearanceNotTransferred,
        NativeLoss::PublishedPixelsNotCarried,
        NativeLoss::NativeLayoutAndTextEditingRemainInFigma,
        NativeLoss::SourceSvgRasterizedForStaticDelivery,
    ];
    if guided {
        losses.push(NativeLoss::NativeGuideEditingRemainsInFigma);
    }
    if !snapshot.source_effects.is_empty() {
        losses.push(NativeLoss::SourceEffectsRequireCarrierFidelityReview);
    }
    if [
        snapshot.source.width,
        snapshot.source.height,
        f.placement.width,
        f.placement.height,
    ]
    .iter()
    .any(|v| v.fract() != 0.0)
    {
        losses.push(NativeLoss::FractionalCanvasRoundedToRasterPixels);
    }
    Ok(NativeContinuation {
        schema: "worldbend.figma.native-work-continuation".into(),
        version: "0.1".into(),
        expression_id,
        source_bindings: vec![SourceBinding {
            slot_id: "source-1".into(),
            asset_id: "source-1".into(),
            role: SourceRole::Content,
            source: snapshot.source.clone(),
        }],
        origin: snapshot,
        document: ready.document,
        delivery_plan: ready.delivery_plan,
        render_quality: SamplingQuality::High,
        losses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn snapshot(carrier: NativeCarrier) -> NativeSnapshot {
        let spec = TransformSpec::normalized(Quad::new(
            Point::new(0.04, 0.03),
            Point::new(0.98, 0.0),
            Point::new(0.91, 0.95),
            Point::new(0.0, 1.0),
        ));
        let base = match carrier {
            NativeCarrier::Frame => {
                json!({"schema":"worldbend.figma.handoff","version":"0.1","fileKey":"file","pageId":"page","nodeId":"result","revision":3,"spec":spec,"source":{"nodeId":"artwork","width":850,"height":500},"placement":{"x":1000,"y":1200,"width":700,"height":480},"expected":"complete geometry state"})
            }
            NativeCarrier::Vector => {
                json!({"schema":"worldbend.figma.vector-state","version":"0.1","fileKey":"file","pageId":"page","nodeId":"result","revision":0,"published":true,"spec":spec,"sourceNodeId":"artwork","placement":{"x":1000,"y":1200,"width":700,"height":480},"targetExpected":"source32x2:12:0123456789abcdef"})
            }
        };
        serde_json::from_value(json!({"schema":"worldbend.figma.native-continuation-snapshot","version":"0.1","carrier":carrier,"base":base,
            "targetExpected":"hash32x2:12:0123456789abcdef","sourceExpected":"hash32x2:24:123456789abcdef0",
            "source":{"slotId":"source-1","nodeId":"artwork","name":"工作","width":850,"height":500,"previewFingerprint":"preview32x2:120:0123456789abcdef"},
            "svgBytes":120,"sourceEffects":[]})).unwrap()
    }
    #[test]
    fn component_native_continuation_rebases_actual_bases_and_unprojects_source_svg() {
        let mut saved = snapshot(NativeCarrier::Frame);
        let NativeBase::Frame(base) = &mut saved.base else {
            panic!()
        };
        base.version = "0.2".into();
        base.component_frame = true;
        let state = worldbend_core::NativeAffineFrameState {
            outer_basis: [[1., 0.25, 10.], [0., 1., 20.]],
            inner_basis: [[1., 0., 0.], [0., 1., 0.]],
            source_size: Size::new(850., 500.),
            output_size: Size::new(700., 480.),
            orientation: worldbend_core::SourceOrientation::Native,
        };
        base.affine_state = Some(state.clone());
        saved.source_capture = Some(worldbend_core::SourceCaptureFacts {
            logical_size: state.source_size,
            logical_to_capture_space: state.outer_basis,
            capture_origin: Point::new(10., 20.),
            capture_scale: 1.,
            pixel_size: worldbend_core::PixelSize::new(975, 500),
            convention: worldbend_core::SourceCaptureConvention::FixedDensityFromOrigin,
        });
        let request = source(saved.clone(), 0, None).unwrap();
        assert!(figma_handoff::test_code(&request).contains("sourceProjection"));
        let projected = project(saved, "native-component".into(), None).unwrap();
        let SpatialDocumentExpression::Static { template, .. } = &projected.document.expressions[0]
        else {
            panic!()
        };
        let SpatialTemplateOperation::RasterProgram { program, .. } = &template.operation else {
            panic!()
        };
        let RasterProgramStage::Transform { spec, .. } = &program.stages[0] else {
            panic!()
        };
        assert_eq!(*spec, worldbend_core::rebase_native_affine(&state).unwrap());
    }

    #[test]
    fn both_native_carriers_compile_their_actual_transform_through_the_same_document_constructor() {
        for carrier in [NativeCarrier::Frame, NativeCarrier::Vector] {
            let saved = snapshot(carrier);
            let controls = saved.facts().spec.clone();
            let value = project(saved, "native-work".into(), None).unwrap();
            let SpatialDocumentExpression::Static {
                template, bindings, ..
            } = &value.document.expressions[0]
            else {
                panic!()
            };
            let SpatialTemplateOperation::RasterProgram {
                program,
                source_slot,
            } = &template.operation
            else {
                panic!()
            };
            let [
                RasterProgramStage::Transform {
                    spec,
                    target_size,
                    canvas,
                    ..
                },
            ] = program.stages.as_slice()
            else {
                panic!()
            };
            assert_eq!(
                serde_json::to_value(spec).unwrap(),
                serde_json::to_value(controls).unwrap()
            );
            assert_eq!(*target_size, Some(Size::new(700., 480.)));
            assert_eq!(*canvas, RasterProgramCanvasMode::Reference);
            assert_eq!(source_slot, "source-1");
            assert_eq!(bindings[0].asset_id, "source-1");
            assert_eq!(
                value.delivery_plan.document_fingerprint,
                inspect_spatial_document(&value.document)
                    .unwrap()
                    .fingerprint
            );
            assert!(
                serde_json::to_value(&value.losses)
                    .unwrap()
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|v| v == "nativeLayoutAndTextEditingRemainInFigma")
            );
            assert!(
                super::super::project_page(&value, None, None)
                    .unwrap()
                    .is_none()
            );
            let page = super::super::project_page(&value, Some(0), None)
                .unwrap()
                .unwrap();
            assert!(
                super::super::project_page(
                    &value,
                    Some(0),
                    Some(format!("sha256:{}", "0".repeat(64)))
                )
                .is_err()
            );
            assert_eq!(page.json, serde_json::to_string(&value).unwrap());
        }
    }
    #[test]
    fn native_inspection_and_source_packets_keep_exact_scope_and_bounded_tokens() {
        for carrier in [NativeCarrier::Frame, NativeCarrier::Vector] {
            let saved = snapshot(carrier);
            let packet = source(saved.clone(), 0, None).unwrap();
            let code = figma_handoff::test_code(&packet);
            assert!(code.contains("readNativeSource"));
            assert!(!code.contains("screenshot"));
            assert!(!code.contains("\"token\":null"));
            assert!(serde_json::to_vec(&packet).unwrap().len() <= 48 * 1024);
            assert!(source(saved, 1, None).is_err());
            assert!(
                figma_handoff::test_code(
                    &inspect(
                        carrier,
                        "file".into(),
                        "page".into(),
                        "result".into(),
                        0,
                        None
                    )
                    .unwrap()
                )
                .contains("readNativeContinuation")
            );
        }
    }
    #[test]
    fn changed_or_unpublished_native_facts_and_unknown_fields_reject() {
        for index in 0..8 {
            let mut saved = snapshot(NativeCarrier::Frame);
            match index {
                0 => saved.carrier = NativeCarrier::Vector,
                1 => saved.schema = "old".into(),
                2 => saved.svg_bytes = 0,
                3 => saved.svg_bytes = 8 * 1024 * 1024 + 1,
                4 => saved.source.preview_fingerprint = "hash32x2:120:0123456789abcdef".into(),
                5 => saved.source.node_id = "different".into(),
                6 => saved.source.width = 851.,
                _ => saved.target_expected = "hash32x2:0:0123456789abcdef".into(),
            }
            assert!(project(saved, "native".into(), None).is_err(), "{index}");
        }
        let mut v = serde_json::to_value(snapshot(NativeCarrier::Vector)).unwrap();
        v["base"]["published"] = json!(false);
        assert!(project(serde_json::from_value(v).unwrap(), "native".into(), None).is_err());
        let mut v = serde_json::to_value(snapshot(NativeCarrier::Frame)).unwrap();
        v["extra"] = json!(1);
        assert!(serde_json::from_value::<NativeSnapshot>(v).is_err());
    }
}

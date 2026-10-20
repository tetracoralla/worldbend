//! Carrier projection only: keep canonical operations and bind explicit assets
//! to current Figma nodes. The existing work read/publisher owns host conflict
//! checks, source capture, rendering, rollback and large-image transport.
use super::*;
use crate::figma_work::{self, WorkInput, WorkReference};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AssetNode {
    #[schemars(length(min = 1, max = 64))]
    asset_id: String,
    #[schemars(length(min = 1, max = 256))]
    node_id: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DocumentRevisionInput {
    base: PublishedSnapshot,
    document: SpatialDocumentSpec,
    #[schemars(length(min = 71, max = 71), regex(pattern = r"^sha256:[0-9a-f]{64}$"))]
    expected_fingerprint: String,
    #[schemars(length(min = 1, max = 64))]
    expression_id: String,
    #[schemars(length(min = 1, max = 8))]
    assets: Vec<AssetNode>,
    #[schemars(range(min = 1, max = 4096))]
    render_width: u32,
    #[schemars(range(min = 1, max = 4096))]
    render_height: u32,
    /// Composition retains its named outputs and requires the selected preview.
    #[serde(default)]
    preview_output_id: Option<String>,
    /// Interactive state belongs to the receiving execution, not the document.
    #[serde(default)]
    state: Option<EffectState>,
    #[serde(default)]
    #[schemars(range(min = 0, max = 255))]
    part: u16,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    #[schemars(length(min = 1, max = 8))]
    source_fingerprints: Option<Vec<String>>,
    #[serde(default)]
    include_source_rasters: bool,
    #[serde(default)]
    source_raster_transport: RasterTransport,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RevisionSource {
    slot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    asset_id: Option<String>,
    node_id: String,
    role: RevisionSourceRole,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RevisionSourceRole {
    Content,
    DisplacementMap,
    FittingGuide,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum RevisionLoss {
    /// Single-family work returns to its authoring canvas. The exact named
    /// delivery outputs stay in the supplied document for ordinary delivery.
    NamedDeliveryOutputsRemainInDocument,
    /// Multi-stage brand / plate programs keep trailing Canvas stages in the
    /// document. Only the leading authoring stage returns to the Figma carrier.
    TrailingCanvasStagesRemainInDocument,
    /// Temporal mockup-video keyframes/timebase stay in the Spatial Document;
    /// Figma receives the Mockup authoring poses only.
    TemporalMotionProgramRemainsInDocument,
    /// Encoded stills+MP4 remain document delivery through mockup-video, not a
    /// Figma image publish.
    TemporalVideoDeliveryRemainsInDocument,
    AssetContentVersionsAreCallerOwned,
    FittingGuideRecapturedFromCurrentFigma,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct DocumentRevision {
    #[schemars(schema_with = "revision_schema")]
    schema: String,
    #[schemars(schema_with = "version_schema")]
    version: String,
    document_fingerprint: String,
    expression_id: String,
    sources: Vec<RevisionSource>,
    /// Exact retained local outputs, independent of the Figma authoring preview.
    output: Option<SpatialTemplateOutput>,
    operation: LinkedOperation,
    losses: Vec<RevisionLoss>,
    pub(super) request: FigmaRequest,
}
#[cfg(test)]
impl DocumentRevision {
    pub(super) fn request(&self) -> &FigmaRequest {
        &self.request
    }
}

fn revision_schema(_: &mut SchemaGenerator) -> Schema {
    json_schema!({"const":"worldbend.figma.document-revision","type":"string"})
}

pub(super) fn prepare(input: DocumentRevisionInput) -> TransformResult<DocumentRevision> {
    validate(&input.base)?;
    let inspection = inspect_spatial_document(&input.document)?;
    if inspection.fingerprint != input.expected_fingerprint {
        return Err(error(
            "Document changed; inspect its current fingerprint before Figma revision",
        ));
    }
    if input.assets.is_empty() || input.assets.len() > 8 {
        return Err(error(
            "Bind the selected expression's exact assets to current same-page nodes",
        ));
    }
    let mut assets = HashMap::new();
    for binding in &input.assets {
        figma_handoff::identity(&binding.node_id)?;
        if assets
            .insert(binding.asset_id.as_str(), binding.node_id.as_str())
            .is_some()
        {
            return Err(error("Duplicate asset-to-node binding"));
        }
    }
    let expression = input
        .document
        .expressions
        .iter()
        .find(|e| e.id() == input.expression_id)
        .ok_or_else(|| error("Select an existing document expression"))?;
    let mut sources = Vec::new();
    let mut bind = |slot: &str, bindings: &[SpatialDocumentBinding]| -> TransformResult<String> {
        let binding = bindings
            .iter()
            .find(|b| b.slot_id == slot && b.role == SpatialDocumentBindingRole::Content)
            .ok_or_else(|| {
                error("Figma authoring requires a content binding for each source slot")
            })?;
        let node_id = assets
            .get(binding.asset_id.as_str())
            .ok_or_else(|| error("Missing explicit asset-to-node binding"))?;
        let carrier_slot = format!("source-{}", sources.len() + 1);
        sources.push(RevisionSource {
            slot_id: carrier_slot.clone(),
            asset_id: Some(binding.asset_id.clone()),
            node_id: (*node_id).into(),
            role: RevisionSourceRole::Content,
        });
        Ok(carrier_slot)
    };
    let (mut operation, output, carries_outputs, trailing_canvas_stages) = match expression {
        SpatialDocumentExpression::Scene3d { .. } => {
            return Err(error(
                "Three-dimensional scene continuation uses its owning scene carrier",
            ));
        }
        SpatialDocumentExpression::Material { .. } => {
            return Err(error(
                "This raster-work revision entry cannot publish native material; continue through the guarded family material entry",
            ));
        }
        SpatialDocumentExpression::Static {
            template, bindings, ..
        } => {
            if input.state.is_some() {
                return Err(error("Static authoring does not accept interactive state"));
            }
            let mut template = template.clone();
            let mut trailing_canvas_stages = false;
            let operation = match &mut template.operation {
                SpatialTemplateOperation::RasterProgram {
                    source_slot,
                    program,
                } => {
                    if input.preview_output_id.is_some() {
                        return Err(error(
                            "Single-family authoring uses its raw canvas; deliver named outputs from the document",
                        ));
                    }
                    bind(source_slot, bindings)?;
                    let (stage, trailing_canvas) =
                        split_authoring_and_trailing_canvas(&program.stages)?;
                    trailing_canvas_stages = trailing_canvas;
                    match stage {
                        RasterProgramStage::Transform {
                            spec,
                            canvas: RasterProgramCanvasMode::Reference,
                            target_size: Some(size),
                            ..
                        } if *size
                            == Size::new(
                                f64::from(input.render_width),
                                f64::from(input.render_height),
                            ) =>
                        {
                            LinkedOperation::Transform { spec: spec.clone() }
                        }
                        RasterProgramStage::Transform { .. } => {
                            return Err(error(
                                "Figma Transform requires a reference canvas matching the authoring raster; tight canvases are not transferable",
                            ));
                        }
                        RasterProgramStage::Rectify { spec, .. } => {
                            LinkedOperation::Rectify { spec: spec.clone() }
                        }
                        RasterProgramStage::Canvas { spec, .. } => {
                            LinkedOperation::Canvas { spec: spec.clone() }
                        }
                        RasterProgramStage::MeshWarp { spec, .. } => LinkedOperation::Task {
                            task: LinkedTask::Deformation(Box::new(DeformationTask::Mesh {
                                spec: spec.clone(),
                            })),
                        },
                        RasterProgramStage::SurfaceDeformation { spec, .. } => {
                            LinkedOperation::Task {
                                task: LinkedTask::Deformation(Box::new(DeformationTask::Surface {
                                    spec: spec.clone(),
                                })),
                            }
                        }
                        RasterProgramStage::DeformationWork { id, spec } => {
                            // Preserve the human editing view and a live fitting guide.
                            // A baked clip never silently becomes an unrelated guide.
                            let (view, guide, domain) = match &input.base.operation {
                                LinkedOperation::Task {
                                    task: LinkedTask::Deformation(task),
                                } => match task.as_ref() {
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
                                    _ => (figma_linked::DeformationView::Mesh, None, None),
                                },
                                _ => (figma_linked::DeformationView::Mesh, None, None),
                            };
                            let guide_binding = bindings.iter().find(|binding| {
                                binding.role == SpatialDocumentBindingRole::FittingGuide
                                    && binding.slot_id == *id
                            });
                            let guide = guide_binding.map(|_| guide.unwrap_or(1)).or(guide);
                            if let Some(index) = guide {
                                if spec.shape_fit.as_ref().is_none_or(|fit| fit.clip.is_none()) {
                                    return Err(error(
                                        "Preserve the bound guide's fitting controls and clip",
                                    ));
                                }
                                let (node, asset_id) = if let Some(binding) = guide_binding {
                                    let node = assets.get(binding.asset_id.as_str()).ok_or_else(|| {
                                        error("Missing explicit fitting-guide asset-to-node binding")
                                    })?;
                                    ((*node).to_owned(), Some(binding.asset_id.clone()))
                                } else {
                                    (input.base.source_node_ids[usize::from(index)].clone(), None)
                                };
                                sources.insert(
                                    usize::from(index),
                                    RevisionSource {
                                        slot_id: String::new(),
                                        asset_id,
                                        node_id: node,
                                        role: RevisionSourceRole::FittingGuide,
                                    },
                                );
                                for (index, source) in sources.iter_mut().enumerate() {
                                    source.slot_id = format!("source-{}", index + 1);
                                }
                            }
                            LinkedOperation::Task {
                                task: LinkedTask::Deformation(Box::new(
                                    DeformationTask::Deformation {
                                        view,
                                        spec: Box::new(spec.clone()),
                                        shape_guide_source_index: guide,
                                        shape_guide_domain: domain,
                                    },
                                )),
                            }
                        }
                        RasterProgramStage::Remap { spec, map_slot, .. } => {
                            if let Some(slot) = map_slot {
                                bind(slot, bindings)?;
                                sources.last_mut().expect("map binding").role =
                                    RevisionSourceRole::DisplacementMap;
                            }
                            LinkedOperation::Task {
                                task: LinkedTask::Remap(RemapTask::Remap { spec: spec.clone() }),
                            }
                        }
                    }
                }
                SpatialTemplateOperation::Mockup { spec } => {
                    if input.preview_output_id.is_some() {
                        return Err(error(
                            "Mockup authoring uses its scene canvas; named delivery stays in the document",
                        ));
                    }
                    rebind_planes(spec, bindings, &mut bind)?;
                    LinkedOperation::Task {
                        task: LinkedTask::Composition(FigmaCompositionTask::Mockup {
                            spec: spec.clone(),
                        }),
                    }
                }
                SpatialTemplateOperation::CompositionProgram { composition, .. } => {
                    rebind_planes(composition, bindings, &mut bind)?;
                    let preview = input
                        .preview_output_id
                        .clone()
                        .ok_or_else(|| error("Select the declared Composition preview output"))?;
                    LinkedOperation::Task {
                        task: LinkedTask::Composition(FigmaCompositionTask::Composition {
                            template: Box::new(template.clone()),
                            preview_output_id: preview,
                            motion: None,
                        }),
                    }
                }
            };
            let carries_outputs = matches!(
                &operation,
                LinkedOperation::Task {
                    task: LinkedTask::Composition(FigmaCompositionTask::Composition { .. })
                }
            );
            (
                operation,
                Some(template.output),
                carries_outputs,
                trailing_canvas_stages,
            )
        }
        SpatialDocumentExpression::Interactive {
            recipe, bindings, ..
        } => {
            if input.preview_output_id.is_some() {
                return Err(error("Interactive work uses its recipe viewport"));
            }
            if bindings
                .iter()
                .any(|b| b.role != SpatialDocumentBindingRole::Content)
            {
                return Err(error(
                    "The Figma Depth carrier does not accept additional depth-map bindings",
                ));
            }
            for layer in &recipe.layers {
                bind(&layer.id, bindings)?;
            }
            let state = input
                .state
                .clone()
                .ok_or_else(|| error("Provide the interactive state to publish"))?;
            let task =
                serde_json::from_value(json!({"kind":"effect", "recipe":recipe, "state":state}))
                    .map_err(|_| error("Cannot form the existing Depth task"))?;
            (
                LinkedOperation::Task {
                    task: LinkedTask::Effect(task),
                },
                None,
                true,
                false,
            )
        }
        SpatialDocumentExpression::Temporal {
            video, bindings, ..
        } => {
            if input.state.is_some() {
                return Err(error(
                    "Temporal authoring does not accept interactive state",
                ));
            }
            if bindings
                .iter()
                .any(|b| b.role != SpatialDocumentBindingRole::Content)
            {
                return Err(error(
                    "Temporal Figma authoring accepts only content plane bindings",
                ));
            }
            let mut motion = video.mockup_motion.clone();
            if let Some(presentation) = motion.presentation.as_mut() {
                if let Some(output) = &input.preview_output_id {
                    presentation.output_id = output.clone();
                }
            } else if input.preview_output_id.is_some() {
                return Err(error("Unframed temporal work uses its scene canvas"));
            }
            let frame = if let LinkedOperation::Task {
                task:
                    LinkedTask::Composition(FigmaCompositionTask::Composition {
                        motion: Some(previous),
                        ..
                    }),
            } = &input.base.operation
            {
                let denominator = u64::from(previous.spec.frame_count.saturating_sub(1).max(1));
                ((u64::from(previous.frame) * u64::from(motion.frame_count - 1) + denominator / 2)
                    / denominator) as u32
            } else {
                0
            };
            let plan = worldbend_core::plan_mockup_motion(&motion)?;
            let mut mockup = plan.frame_specs[frame as usize].clone();
            let expected = plan.output_size();
            if expected.width != input.render_width || expected.height != input.render_height {
                return Err(error(
                    "Temporal authoring raster must match its selected presentation output",
                ));
            }
            let original_sources: Vec<_> =
                mockup.planes.iter().map(|p| p.source_id.clone()).collect();
            rebind_planes(&mut mockup, bindings, &mut bind)?;
            let slots: HashMap<_, _> = original_sources
                .into_iter()
                .zip(mockup.planes.iter().map(|p| p.source_id.clone()))
                .collect();
            for plane in &mut motion.planes {
                plane.source_id = slots[&plane.source_id].clone();
            }
            let identity = MockupMotionPresentation {
                transform: TransformSpec::normalized(Quad::unit()),
                size: motion.canvas,
                output: SpatialTemplateOutput::Single {
                    id: "output".into(),
                },
                output_id: "output".into(),
                keyframes: vec![],
            };
            let presentation = plan
                .presentation_at(frame as usize)
                .map(|p| &p.spec)
                .unwrap_or(&identity);
            let template = SpatialTemplateSpec {
                schema: SPATIAL_TEMPLATE_SCHEMA.into(),
                version: SPATIAL_TEMPLATE_VERSION.into(),
                operation: SpatialTemplateOperation::CompositionProgram {
                    composition: mockup,
                    postprocess: RasterProgramSpec {
                        schema: RASTER_PROGRAM_SCHEMA.into(),
                        version: RASTER_PROGRAM_VERSION.into(),
                        stages: vec![RasterProgramStage::Transform {
                            id: "whole-result".into(),
                            spec: presentation.transform.clone(),
                            canvas: RasterProgramCanvasMode::Reference,
                            target_size: Some(Size::new(
                                f64::from(presentation.size.width),
                                f64::from(presentation.size.height),
                            )),
                        }],
                    },
                },
                output: presentation.output.clone(),
            };
            let output = template.output.clone();
            let preview = presentation.output_id.clone();
            (
                LinkedOperation::Task {
                    task: LinkedTask::Composition(FigmaCompositionTask::Composition {
                        template: Box::new(template),
                        preview_output_id: preview,
                        motion: Some(figma_handoff::FigmaCompositionMotion {
                            spec: motion,
                            frame,
                        }),
                    }),
                },
                Some(output),
                true,
                false,
            )
        }
    };
    let used: HashSet<_> = sources
        .iter()
        .filter_map(|s| s.asset_id.as_deref())
        .collect();
    if used.len() != assets.len() || assets.keys().any(|id| !used.contains(id)) {
        return Err(error("Bind only and all assets of the selected expression"));
    }
    if matches!(expression, SpatialDocumentExpression::Static { .. })
        && let LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    motion: Some(previous),
                    ..
                }),
        } = &input.base.operation
    {
        let LinkedOperation::Task {
            task:
                LinkedTask::Composition(FigmaCompositionTask::Composition {
                    template,
                    motion,
                    preview_output_id,
                    ..
                }),
        } = &mut operation
        else {
            return Err(error(
                "Retain the animated Composition when revising this work",
            ));
        };
        let SpatialTemplateOperation::CompositionProgram { composition, .. } = &template.operation
        else {
            unreachable!()
        };
        let inspected = worldbend_core::author_mockup_motion(
            &worldbend_core::MockupMotionAuthoringInput::Inspect {
                spec: previous.spec.clone(),
            },
        )?;
        let revised = worldbend_core::author_mockup_motion(
            &worldbend_core::MockupMotionAuthoringInput::Revise {
                spec: inspected.spec,
                expected_fingerprint: inspected.fingerprint,
                edit: Box::new(worldbend_core::MockupMotionEdit::SetScenePose {
                    frame: previous.frame,
                    scene: Box::new(composition.clone()),
                }),
            },
        )?;
        let whole = worldbend_core::author_mockup_motion(
            &worldbend_core::MockupMotionAuthoringInput::Revise {
                spec: revised.spec,
                expected_fingerprint: revised.fingerprint,
                edit: Box::new(worldbend_core::MockupMotionEdit::SetPresentationAtFrame {
                    frame: previous.frame,
                    presentation: Box::new(figma_handoff::composition_presentation(
                        template,
                        preview_output_id,
                    )?),
                }),
            },
        )?;
        let spec = whole.spec;
        worldbend_core::plan_mockup_motion(&spec)?;
        *motion = Some(figma_handoff::FigmaCompositionMotion {
            spec,
            frame: previous.frame,
        });
    }
    let source_node_ids: Vec<_> = sources.iter().map(|s| s.node_id.clone()).collect();
    figma_linked::validate_work_operation(
        &operation,
        source_node_ids.len(),
        input.render_width,
        input.render_height,
    )?;
    let request = figma_work::prepare(WorkInput::Read {
        base: WorkReference {
            file_key: input.base.file_key,
            page_id: input.base.page_id,
            node_id: input.base.node_id,
            revision: input.base.revision,
            target_expected: input.base.target_expected,
        },
        operation: Some(operation.clone()),
        source_node_ids: Some(source_node_ids),
        render_width: Some(input.render_width),
        render_height: Some(input.render_height),
        part: input.part,
        token: input.token,
        source_fingerprints: input.source_fingerprints,
        include_source_rasters: input.include_source_rasters,
        source_raster_transport: input.source_raster_transport,
    })?;
    let mut losses = vec![RevisionLoss::AssetContentVersionsAreCallerOwned];
    if sources
        .iter()
        .any(|source| matches!(source.role, RevisionSourceRole::FittingGuide))
    {
        losses.push(RevisionLoss::FittingGuideRecapturedFromCurrentFigma);
    }
    if !carries_outputs && matches!(output, Some(SpatialTemplateOutput::CanvasSet { .. })) {
        losses.push(RevisionLoss::NamedDeliveryOutputsRemainInDocument);
    }
    if trailing_canvas_stages {
        losses.push(RevisionLoss::TrailingCanvasStagesRemainInDocument);
    }
    if matches!(expression, SpatialDocumentExpression::Temporal { .. }) {
        if !matches!(
            &operation,
            LinkedOperation::Task {
                task: LinkedTask::Composition(FigmaCompositionTask::Composition {
                    motion: Some(_),
                    ..
                })
            }
        ) {
            losses.push(RevisionLoss::TemporalMotionProgramRemainsInDocument);
        }
        losses.push(RevisionLoss::TemporalVideoDeliveryRemainsInDocument);
    }
    Ok(DocumentRevision {
        schema: "worldbend.figma.document-revision".into(),
        version: "0.1".into(),
        document_fingerprint: inspection.fingerprint,
        expression_id: input.expression_id,
        sources,
        output,
        operation,
        losses,
        request,
    })
}

/// Closed multi-stage authoring slice: one leading authoring stage, then only
/// trailing Canvas stages that stay document-side (brand plate / letterbox).
/// Other multi-stage shapes remain document-only and reject here.
fn split_authoring_and_trailing_canvas(
    stages: &[RasterProgramStage],
) -> TransformResult<(&RasterProgramStage, bool)> {
    match stages {
        [] => Err(error("Raster program requires at least one stage")),
        [stage] => Ok((stage, false)),
        [authoring, trailing @ ..] => {
            if trailing
                .iter()
                .any(|stage| !matches!(stage, RasterProgramStage::Canvas { .. }))
            {
                return Err(error(
                    "Figma authoring accepts one leading authoring stage plus trailing Canvas stages only; retain other multi-stage programs in the document",
                ));
            }
            Ok((authoring, true))
        }
    }
}

fn rebind_planes(
    spec: &mut MockupSpec,
    bindings: &[SpatialDocumentBinding],
    bind: &mut impl FnMut(&str, &[SpatialDocumentBinding]) -> TransformResult<String>,
) -> TransformResult<()> {
    let mut slots: HashMap<String, String> = HashMap::new();
    for plane in &mut spec.planes {
        let slot = if let Some(existing) = slots.get(&plane.source_id) {
            existing.clone()
        } else {
            let slot = bind(&plane.source_id, bindings)?;
            slots.insert(plane.source_id.clone(), slot.clone());
            slot
        };
        plane.source_id = slot;
    }
    Ok(())
}

#[cfg(test)]
mod shadow_continuation_tests {
    use super::*;
    #[test]
    fn temporal_return_keeps_authored_surface_and_shadow() {
        let q = json!({"tl":{"x":0.1,"y":0.1},"tr":{"x":0.9,"y":0.1},"br":{"x":0.9,"y":0.9},"bl":{"x":0.1,"y":0.9}});
        let video: MockupVideoSpec = serde_json::from_value(json!({
            "schema":"worldbend.mockup-video","version":"0.1","backgroundRgb":[255,255,255],
            "encoding":{"format":"mp4H264","crf":18},"mockupMotion":{
                "schema":"worldbend.mockup-motion","version":"0.1","canvas":{"width":32,"height":24},
                "timebase":{"numerator":2,"denominator":1},"frameCount":2,"seams":[],"planes":[{
                    "id":"cover","sourceId":"cover","opacity":0.8,
                    "surface":{"kind":"cylinder","curvature":0.4},
                    "shadow":{"offset":{"x":3,"y":4},"blurSigmaPx":2,"color":[12,24,36],"opacity":0.25},
                    "base":{"schema":"worldbend.transform","version":"0.1","destination":{"space":"normalized","quad":q},"content":{"fit":"stretch"}},
                    "keyframes":[{"frame":0,"quad":q},{"frame":1,"quad":q}]
                }]
            }
        })).unwrap();
        let returned = plan_mockup_video(&video).unwrap().mockup_motion.frame_specs[0].clone();
        assert_eq!(
            returned.planes[0].surface,
            video.mockup_motion.planes[0].surface
        );
        assert_eq!(
            returned.planes[0].shadow,
            video.mockup_motion.planes[0].shadow
        );
        let planned = worldbend_core::plan_mockup(&returned).unwrap();
        assert_eq!(
            planned.planes[0].shadow.as_ref().unwrap().shadow.opacity,
            0.25
        );
    }
}

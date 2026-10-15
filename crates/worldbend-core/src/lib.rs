//! Canonical projective plane-mapping semantics.
//!
//! The source is always the normalized unit square. Platform adapters may
//! resolve destination coordinates, but they must not replace this solver or
//! silently reorder corners.

#[cfg(feature = "appearance")]
mod appearance;
#[cfg(feature = "appearance")]
mod appearance_exposure;
#[cfg(feature = "appearance")]
mod appearance_preference;
#[cfg(feature = "surface-deformation")]
mod authored_mesh;
#[cfg(any(
    feature = "appearance",
    feature = "spatial-effects",
    feature = "motion"
))]
mod canonical;
mod canvas;
#[cfg(feature = "css")]
mod card;
#[cfg(feature = "css")]
mod css;
#[cfg(feature = "deform")]
mod deform;
#[cfg(feature = "surface-deformation")]
pub use authored_mesh::AuthoredMeshView;
#[cfg(feature = "deformation-work")]
mod deformation_work;
#[cfg(any(feature = "css", feature = "motion"))]
mod easing;
#[cfg(feature = "spatial-effects")]
mod effects;
mod error;
mod geometry;
#[cfg(feature = "deformation-work")]
mod liquify;
#[cfg(feature = "appearance")]
mod material_preference;
#[cfg(feature = "place")]
mod mockup;
#[cfg(feature = "motion")]
mod mockup_motion_authoring;
#[cfg(feature = "place")]
mod mockup_shadow;
#[cfg(feature = "motion")]
pub use mockup_motion_authoring::{
    MockupMotionAuthoringInput, MockupMotionAuthoringOutput, MockupMotionEdit,
    MockupMotionPosePlane, author_mockup_motion,
};
#[cfg(feature = "place")]
pub use mockup_shadow::{
    MOCKUP_SHADOW_PROFILE, MockupShadow, MockupShadowPlan, plan_mockup_shadow,
};
#[cfg(feature = "motion")]
mod mockup_motion;
#[cfg(feature = "motion")]
mod mockup_motion_presentation;
#[cfg(feature = "motion")]
pub use mockup_motion_presentation::{
    MockupMotionPresentation, MockupMotionPresentationPlan, plan_mockup_motion_presentation,
};
#[cfg(feature = "place")]
mod mockup_surface;
mod model;
mod native_frame;
pub use native_frame::{
    NativeAffineFrameState, NativeFramePlan, NativeFramePlanInput, plan_native_frame,
    rebase_native_affine,
};
#[cfg(feature = "motion")]
mod motion;
#[cfg(feature = "css")]
mod pose;
#[cfg(feature = "program")]
mod raster_program;
mod rectify;
#[cfg(feature = "remap")]
mod remap;
#[cfg(feature = "deformation-work")]
mod shape_fit;
#[cfg(feature = "deformation-work")]
mod shape_fit_clip;
#[cfg(feature = "video")]
mod video;
#[cfg(feature = "deformation-work")]
pub use shape_fit_clip::project_deformation_clip;
#[cfg(feature = "appearance")]
mod foil;
mod mesh_coordinates;
#[cfg(feature = "appearance")]
mod mesh_gradient;
#[cfg(feature = "deformation-work")]
mod shape_fit_composition;
mod solver;
mod source_sampling;
pub use source_sampling::{
    AffineSourceMap, SourceCaptureConvention, SourceCaptureFacts, SourceSamplingFrame,
    SourceSamplingSchema, SourceSamplingVersion, plan_source_capture, source_capture_to_logical,
};
#[cfg(feature = "document")]
mod spatial_document;
#[cfg(feature = "document")]
mod spatial_material;
#[cfg(feature = "css")]
mod strip;
#[cfg(feature = "surface-deformation")]
mod surface_deformation;
#[cfg(feature = "surface-window")]
mod surface_window;
#[cfg(feature = "template")]
mod template;
#[cfg(feature = "appearance")]
mod texture;
#[cfg(feature = "timeline")]
mod timeline;
mod transform;
mod vector_artwork;
mod vector_projection;
mod warp;
mod warp_topology;
#[cfg(feature = "deform")]
pub use mesh_coordinates::MeshCoordinateMap;

#[cfg(feature = "appearance")]
pub use appearance::{
    APPEARANCE_DELIVERY_SCHEMA, APPEARANCE_INSPECTION_SCHEMA, APPEARANCE_SCHEMA,
    APPEARANCE_VERSION, AppearanceDeliveryInput, AppearanceDeliveryPlan, AppearanceDeliveryTarget,
    AppearanceFieldDelivery, AppearanceFieldMapping, AppearanceInspection,
    AppearanceInspectionInput, AppearanceInstanceState, AppearanceLossReceipt,
    AppearanceProfileCatalog, AppearanceProfileDescriptor, AppearanceProfileQuery,
    AppearanceRecipeSpec, AppearanceRevisionInput, AppearanceRevisionPlan, AppearanceUpdateInput,
    AppearanceUpdatePlan, GLASS_FIELDS, GlassDisplacementFilter, GlassField, GlassMaterial,
    LightAxisReceipt, MAX_APPEARANCE_RECIPE_ID, MAX_GLASS_DEPTH, MAX_GLASS_RADIUS,
    OpticalGlassDelivery, ParameterCoupling, ParameterRangeReceipt, SwiftUIGlassDelivery,
    WEB_DEPTH_EFFECTIVE_MAX, WEB_DEPTH_LINEAR_END, WEB_DISPLACEMENT_SCALE_MAX,
    WEB_RIM_EFFECTIVE_MAX, WEB_RIM_LINEAR_END, WebGlassDelivery, discover_appearance_profiles,
    inspect_appearance, light_direction_screen, plan_appearance_delivery, plan_appearance_revision,
    plan_appearance_update, web_depth_factor, web_rim_depth,
};
#[cfg(feature = "appearance")]
pub use appearance_exposure::{
    APPEARANCE_EXPOSURE_POLICY_SCHEMA, APPEARANCE_EXPOSURE_REPORT_SCHEMA,
    APPEARANCE_EXPOSURE_VERSION, AppearanceChangeCost, AppearanceControlDefault,
    AppearanceControlKind, AppearanceControlState, AppearanceExposedControl,
    AppearanceExposureInput, AppearanceExposurePolicy, AppearanceExposureReport,
    AppearanceExposureRow, AppearanceOpticsMode, AppearanceRuntimeState, CLARITY_CONTROL_ID,
    CLARITY_MAPPING_VERSION, ClarityMappingReceipt, DEFAULT_CLARITY_RADIUS_MAX,
    exposure_report_fingerprint, map_clarity_to_radius, resolve_appearance_exposure,
    validate_appearance_exposure_policy,
};
#[cfg(feature = "appearance")]
pub use appearance_preference::{
    APPEARANCE_PREFERENCE_PLAN_SCHEMA, APPEARANCE_PREFERENCE_SCHEMA, APPEARANCE_PREFERENCE_VERSION,
    AppearanceOverrideActor, AppearanceOverrideValue, AppearancePreferenceFieldReceipt,
    AppearancePreferenceFieldState, AppearancePreferenceInput, AppearancePreferencePlan,
    AppearancePreferenceRecord, EMPTY_PREFERENCE_REVISION, effective_override_fields,
    resolve_appearance_preference,
};
pub use canvas::{
    CANVAS_PLAN_SCHEMA, CANVAS_SCHEMA, CANVAS_SET_PLAN_SCHEMA, CANVAS_SET_SCHEMA, CANVAS_VERSION,
    CanvasBackground, CanvasInsets, CanvasOperation, CanvasOperationKind, CanvasPlacement,
    CanvasPlan, CanvasScale, CanvasSetPlan, CanvasSetSpec, CanvasSpec, CanvasVariant,
    CanvasVariantPlan, MAX_CANVAS_AXIS, MAX_CANVAS_PIXELS, MAX_CANVAS_SET_PIXELS,
    MAX_CANVAS_VARIANTS, NormalizedAnchor, PixelRect, Srgb8Space, plan_canvas, plan_canvas_set,
    resolve_canvas, resolve_canvas_set, resolve_trim_rect_rgba, resolve_trim_rect_rgba_with_cancel,
};
#[cfg(feature = "css")]
pub use card::{
    CARD_SCHEMA, CARD_VERSION, CardAction, CardAxis, CardBack, CardFace, CardGeometry, CardIdle,
    CardIdleInput, CardInterruption, CardPointerInput, CardPointerOutput, CardPoseInput,
    CardPoseOutput, CardRegion, CardRig, CardTilt, CardTurnInput, CardTurnOutput, CardView,
    project_card_pose, sample_card_idle, sample_card_pointer, sample_card_turn,
};
#[cfg(feature = "css")]
pub use css::{CssTransform, emit_css_transform};
#[cfg(feature = "deform")]
pub use deform::{
    MESH_WARP_PLAN_SCHEMA, MESH_WARP_SCHEMA, MESH_WARP_VERSION, MeshWarpPlan, MeshWarpSpec,
    plan_mesh_warp,
};
#[cfg(feature = "deformation-work")]
pub use deformation_work::{
    DEFORMATION_WORK_MIGRATION_SCHEMA, DEFORMATION_WORK_PLAN_SCHEMA, DEFORMATION_WORK_SCHEMA,
    DEFORMATION_WORK_VERSION, DeformationWorkMigration, DeformationWorkPinView,
    DeformationWorkPlan, DeformationWorkShapeFitView, DeformationWorkSourceSpec,
    DeformationWorkSpec, MAX_DEFORMATION_WORK_MESH_EDITS, MAX_DEFORMATION_WORK_WARPED_EXTENT,
    MIN_DEFORMATION_WORK_WARPED_EXTENT, MeshVertexEdit, migrate_deformation_work,
    plan_deformation_work,
};
#[cfg(feature = "spatial-effects")]
pub use effects::{
    EFFECT_RECIPE_INSPECTION_SCHEMA, EFFECT_VERSION, EffectAxis, EffectCameraRig,
    EffectCameraTravel, EffectCarrier, EffectCatalog, EffectCatalogInput, EffectContent,
    EffectCoverage, EffectCurve, EffectDepthMap, EffectDepthOfField, EffectDepthOfFieldPlan,
    EffectDescriptor, EffectFrame, EffectFrameAppearance, EffectFrameSurface, EffectId,
    EffectIntent, EffectLayer, EffectMotionBlur, EffectMotionBlurPlan, EffectMotionSample,
    EffectPlan, EffectPlanInput, EffectProperty, EffectRecipe, EffectRecipeInput,
    EffectRecipeInspection, EffectSourcePadding, EffectSpatialAppearance, EffectState,
    EffectSurface, EffectTrack, effect_catalog, effect_plan, effect_recipe, inspect_effect_recipe,
};
pub use error::{ErrorCode, TransformError, TransformResult, bounded_text};
#[cfg(feature = "appearance")]
pub use foil::{
    FOIL_FIELDS, FOIL_KERNEL_ID, FOIL_KERNEL_SOURCE, FOIL_SCHEMA, FOIL_VERSION, FoilColor,
    FoilDeliveryInput, FoilDeliveryPlan, FoilDeliveryTarget, FoilField, FoilInspection,
    FoilInspectionInput, FoilKernelResource, FoilMaterial, FoilRecipeSpec, FoilRevisionInput,
    FoilRevisionPlan, FoilUpdateInput, FoilUpdatePlan, inspect_foil, plan_foil_delivery,
    plan_foil_revision, plan_foil_update,
};
pub use geometry::{
    Bounds, GeometryDiagnostics, ResolvedDestination, cross, polygon_signed_area, validate_quad,
};
#[cfg(feature = "deformation-work")]
pub use liquify::{
    LiquifyControls, LiquifyMode, LiquifySample, LiquifyStroke, MAX_LIQUIFY_SAMPLES_PER_STROKE,
    MAX_LIQUIFY_STROKE_SAMPLES, MAX_LIQUIFY_STROKES,
};
#[cfg(feature = "appearance")]
pub use material_preference::{
    MATERIAL_POLICY_SCHEMA, MATERIAL_PREFERENCE_PLAN_SCHEMA, MATERIAL_PREFERENCE_SCHEMA,
    MaterialExposedControl, MaterialExposurePolicy, MaterialFieldPreference,
    MaterialPreferenceControl, MaterialPreferenceFieldState, MaterialPreferenceInput,
    MaterialPreferenceOutput, MaterialPreferencePlan, MaterialPreferenceReceipt,
    MaterialPreferenceRecord, MaterialPreferenceRuntime, MaterialPreferenceValue, MaterialRgba,
    native_material_preference_rules, resolve_material_preference,
};
#[cfg(feature = "appearance")]
pub use mesh_gradient::{
    MESH_GRADIENT_FIELDS, MESH_GRADIENT_KERNEL_ID, MESH_GRADIENT_KERNEL_SOURCE,
    MESH_GRADIENT_SCHEMA, MESH_GRADIENT_UNIFORM_BYTES, MESH_GRADIENT_VERSION, MeshGradientColor,
    MeshGradientDeliveryInput, MeshGradientDeliveryPlan, MeshGradientDeliveryTarget,
    MeshGradientField, MeshGradientInspection, MeshGradientInspectionInput,
    MeshGradientKernelProfile, MeshGradientKernelResource, MeshGradientMaterial,
    MeshGradientRecipeSpec, MeshGradientRevisionInput, MeshGradientRevisionPlan,
    MeshGradientUpdateInput, MeshGradientUpdatePlan, inspect_mesh_gradient,
    plan_mesh_gradient_delivery, plan_mesh_gradient_revision, plan_mesh_gradient_update,
};
#[cfg(feature = "place")]
pub use mockup::{
    MAX_MOCKUP_AXIS, MAX_MOCKUP_CLIP_CONTOURS, MAX_MOCKUP_CLIP_SEGMENTS_PER_CONTOUR,
    MAX_MOCKUP_CLIP_TOTAL_SEGMENTS, MAX_MOCKUP_EXTRACT_PIXELS, MAX_MOCKUP_GRID_DIVISIONS,
    MAX_MOCKUP_PIXELS, MAX_MOCKUP_PLANES, MAX_MOCKUP_SEAMS, MOCKUP_EXTRACT_PLAN_SCHEMA,
    MOCKUP_EXTRACT_SCHEMA, MOCKUP_PLAN_SCHEMA, MOCKUP_SCHEMA, MOCKUP_VERSION, MockupClip,
    MockupClipContour, MockupClipFillRule, MockupClipPlan, MockupClipRegion, MockupClipSegment,
    MockupEdge, MockupEdgeRef, MockupExtractItem, MockupExtractPlan, MockupExtractPlanItem,
    MockupExtractSpec, MockupGrid, MockupGridLine, MockupGridPlan, MockupMeasurement,
    MockupPhysicalSize, MockupPlan, MockupPlane, MockupPlanePlan, MockupSeam, MockupSeamPlan,
    MockupSpec, flatten_mockup_clip_contour, plan_mockup, plan_mockup_extract,
};
#[cfg(feature = "motion")]
pub use mockup_motion::{
    MAX_MOCKUP_MOTION_PIXELS, MOCKUP_MOTION_PLAN_SCHEMA, MOCKUP_MOTION_SCHEMA,
    MOCKUP_MOTION_VERSION, MockupMotionPlan, MockupMotionPlane, MockupMotionSpec,
    mockup_motion_display_duration, plan_mockup_motion,
};
#[cfg(feature = "place")]
pub use mockup_surface::{MockupSurface, MockupSurfaceLight, build_mockup_surface_mesh};
pub use model::{
    Content, CoordinateSpace, Destination, FitMode, Point, Quad, SPEC_SCHEMA, SPEC_VERSION, Size,
    SourceOrientation, TransformSpec,
};
#[cfg(feature = "motion")]
pub use motion::{
    FrameRate, MOTION_PLAN_SCHEMA, MOTION_SCHEMA, MOTION_VERSION, MotionEasing, MotionFrameTiming,
    MotionKeyframe, MotionPlan, MotionSpec, RationalTime, motion_timeline_spec, plan_motion,
};
#[cfg(feature = "css")]
pub use pose::{PlanePose, PlanePoseInput, PlanePoseOutput, project_plane_pose};
#[cfg(feature = "program")]
pub use raster_program::{
    MAX_RASTER_PROGRAM_PIXELS, MAX_RASTER_PROGRAM_STAGES, RASTER_PROGRAM_INSPECTION_SCHEMA,
    RASTER_PROGRAM_SCHEMA, RASTER_PROGRAM_VERSION, RasterProgramCanvasMode,
    RasterProgramInspection, RasterProgramSpec, RasterProgramStage, RasterProgramStageKind,
    RasterProgramStageSummary, inspect_raster_program,
};
pub use rectify::{
    PixelSize, RECTIFY_SCHEMA, RECTIFY_VERSION, RectifyDiagnostics, RectifyPlan, RectifySpec,
    SourcePlane, rectify_plane,
};
#[cfg(feature = "remap")]
pub use remap::{
    LensCoefficients, LensScale, MAX_REMAP_AXIS, MAX_REMAP_PIXELS, REMAP_PLAN_SCHEMA, REMAP_SCHEMA,
    REMAP_VERSION, RemapBoundary, RemapChannel, RemapOperation, RemapPlan, RemapSpec, plan_remap,
};
#[cfg(feature = "deformation-work")]
pub use shape_fit::{
    ShapeFitControls, ShapeFitDomain, ShapeFitDomainChoice, ShapeFitDomainKind,
    ShapeFitRefreshInput, ShapeFitRefreshOutput, ShapeFitResolution, refresh_shape_fit,
    resolve_shape_fit, shape_fit_domains,
};
pub use solver::{
    Homography, InspectOutput, MatrixDiagnostics, ReprojectionDiagnostics, ReprojectionPoint,
    SolveDiagnostics, SolveOutput, inspect_spec, inverse_transform_point, solve_quad, solve_spec,
    transform_point,
};
#[cfg(feature = "document")]
pub use spatial_document::{
    MAX_SPATIAL_DOCUMENT_ASSEMBLY_DOCUMENTS, MAX_SPATIAL_DOCUMENT_ASSEMBLY_MEMBERS,
    MAX_SPATIAL_DOCUMENT_ASSETS, MAX_SPATIAL_DOCUMENT_BINDINGS, MAX_SPATIAL_DOCUMENT_EXPRESSIONS,
    MAX_SPATIAL_DOCUMENT_REVISIONS, MAX_SPATIAL_MEDIA_AXIS, MAX_SPATIAL_MEDIA_ENCODED_BYTES,
    MAX_SPATIAL_MEDIA_PIXELS, SPATIAL_DOCUMENT_ASSEMBLY_PLAN_SCHEMA,
    SPATIAL_DOCUMENT_DELIVERY_PLAN_SCHEMA, SPATIAL_DOCUMENT_INSPECTION_SCHEMA,
    SPATIAL_DOCUMENT_SCHEMA, SPATIAL_DOCUMENT_UPDATE_PLAN_SCHEMA, SPATIAL_DOCUMENT_VERSION,
    SPATIAL_INTERACTIVE_DELIVERY_SCHEMA, SPATIAL_INTERACTIVE_DELIVERY_VERSION,
    SPATIAL_INTERACTIVE_MEDIA_BUNDLE_SCHEMA, SPATIAL_INTERACTIVE_MEDIA_BUNDLE_VERSION,
    SPATIAL_STATIC_DELIVERY_SCHEMA, SPATIAL_STATIC_DELIVERY_VERSION,
    SPATIAL_TEMPORAL_DELIVERY_SCHEMA, SPATIAL_TEMPORAL_DELIVERY_VERSION,
    SpatialDocumentAffectedExpression, SpatialDocumentAssemblyAsset,
    SpatialDocumentAssemblyAssetMember, SpatialDocumentAssemblyDocument,
    SpatialDocumentAssemblyDocumentResult, SpatialDocumentAssemblyExpression,
    SpatialDocumentAssemblyInput, SpatialDocumentAssemblyPlan, SpatialDocumentAsset,
    SpatialDocumentAssetRevision, SpatialDocumentAssetRevisionResult, SpatialDocumentBinding,
    SpatialDocumentBindingRole, SpatialDocumentDelivery, SpatialDocumentDeliveryInput,
    SpatialDocumentDeliveryPlan, SpatialDocumentExpression, SpatialDocumentExpressionInspection,
    SpatialDocumentExpressionKind, SpatialDocumentExpressionRevisionResult,
    SpatialDocumentInspection, SpatialDocumentSpec, SpatialDocumentUpdateInput,
    SpatialDocumentUpdatePlan, SpatialInteractiveDelivery, SpatialInteractiveDeliveryInput,
    SpatialInteractiveMedia, SpatialInteractiveMediaBundle, SpatialInteractiveMediaBundleInput,
    SpatialInteractiveMediaFormat, SpatialStaticDelivery, SpatialStaticDeliveryInput,
    SpatialTemporalDelivery, SpatialTemporalDeliveryInput, inspect_spatial_document,
    plan_spatial_document_assembly, plan_spatial_document_delivery, plan_spatial_document_update,
    prepare_spatial_interactive_delivery, prepare_spatial_interactive_media_bundle,
    prepare_spatial_static_delivery, prepare_spatial_temporal_delivery,
};
#[cfg(feature = "document")]
pub use spatial_material::{SpatialMaterialDelivery, SpatialMaterialFamily, SpatialMaterialInput};
#[cfg(feature = "css")]
pub use strip::{
    PlaneStripInput, PlaneStripItem, PlaneStripOutput, PlaneStripPanel, project_plane_strip,
};
#[cfg(feature = "surface-deformation")]
pub use surface_deformation::{
    BezierEnvelope, DeformationAnchor, DeformationStroke, MAX_BEZIER_PATCHES_PER_AXIS,
    MAX_DEFORMATION_ANCHORS, MAX_DEFORMATION_STROKE_SAMPLES, MAX_DEFORMATION_STROKES,
    MAX_STROKE_SAMPLES_PER_STROKE, ResolvedDeformationAnchor, SURFACE_DEFORMATION_PLAN_SCHEMA,
    SURFACE_DEFORMATION_SCHEMA, SURFACE_DEFORMATION_VERSION, StrokeSample,
    SurfaceDeformationControls, SurfaceDeformationPlan, SurfaceDeformationSpec,
    plan_surface_deformation,
};
#[cfg(feature = "surface-window")]
pub use surface_window::{
    SurfaceVisibility, SurfaceWindowMapping, SurfaceWindowPlan, SurfaceWindowSpec, WindowFrost,
    plan_surface_window,
};
#[cfg(feature = "template")]
pub use template::{
    MAX_SPATIAL_TEMPLATE_OUTPUTS, MAX_SPATIAL_TEMPLATE_SLOTS, MAX_VARIATION_JOB_ITEMS,
    MAX_VARIATION_JOB_OUTPUTS, SPATIAL_TEMPLATE_INSPECTION_SCHEMA, SPATIAL_TEMPLATE_SCHEMA,
    SPATIAL_TEMPLATE_VERSION, SpatialTemplateInspection, SpatialTemplateOperation,
    SpatialTemplateOperationKind, SpatialTemplateOutput, SpatialTemplateOutputKind,
    SpatialTemplateOutputSummary, SpatialTemplateSpec, VARIATION_JOB_PLAN_SCHEMA,
    VARIATION_JOB_SCHEMA, VariationBinding, VariationFailurePolicy, VariationJobItem,
    VariationJobItemPlan, VariationJobPlan, VariationJobSpec, inspect_spatial_template,
    plan_variation_job,
};
#[cfg(feature = "appearance")]
pub use texture::{
    MAX_TEXTURE_ETCH_RADIUS, MAX_TEXTURE_RECIPE_ID, TEXTURE_DELIVERY_SCHEMA, TEXTURE_FIELDS,
    TEXTURE_INSPECTION_SCHEMA, TEXTURE_SCHEMA, TEXTURE_VERSION, TextureDeliveryInput,
    TextureDeliveryPlan, TextureDeliveryTarget, TextureEtchFilter, TextureField,
    TextureFieldDelivery, TextureInspection, TextureInspectionInput, TextureMaterial,
    TextureOverlayBlend, TextureRecipeSpec, TextureRevisionInput, TextureRevisionPlan,
    WEB_ETCH_EFFECTIVE_MAX, WEB_ETCH_LINEAR_END, inspect_texture, parse_hex_color,
    plan_texture_delivery, plan_texture_revision, web_etch_surface_scale,
};
#[cfg(feature = "timeline")]
pub use timeline::{
    MAX_TIMELINE_FRAMES, MAX_TIMELINE_PIXELS, TIMELINE_PLAN_SCHEMA, TIMELINE_SCHEMA,
    TIMELINE_VERSION, TimelineFrame, TimelineInterpolation, TimelineKeyframe, TimelinePlan,
    TimelinePlanFrame, TimelineProgram, TimelineSpec, plan_timeline,
};
pub use transform::{
    AffineComposition, Flip2D, Scale2D, Skew2D, TransformCanvas, TransformRecipe, compose_affine,
};
pub use vector_projection::{
    DEFAULT_VECTOR_TOLERANCE_PX, MAX_VECTOR_INPUT_LOOP_REFERENCES, MAX_VECTOR_INPUT_REGIONS,
    MAX_VECTOR_INPUT_SEGMENTS, MAX_VECTOR_INPUT_VERTICES, MAX_VECTOR_OUTPUT_LOOP_REFERENCES,
    MAX_VECTOR_OUTPUT_REGIONS, MAX_VECTOR_OUTPUT_SEGMENTS, MAX_VECTOR_OUTPUT_VERTICES,
    MAX_VECTOR_PROJECTION_WORK_UNITS, MAX_VECTOR_TOLERANCE_PX, MIN_VECTOR_TOLERANCE_PX,
    VECTOR_MESH_PROJECTION_VERSION, VECTOR_PROJECTION_SCHEMA, VECTOR_PROJECTION_VERSION,
    VectorPathRegion, VectorPathSegment, VectorPathSpec, VectorPathVertex,
    VectorProjectionFidelity, VectorProjectionInput, VectorProjectionLossReason,
    VectorProjectionNetwork, VectorProjectionOutput, VectorProjectionReport, VectorStrokeCap,
    VectorStrokeJoin, VectorStrokeSpec, VectorWindingRule, plan_vector_projection,
};
#[cfg(feature = "video")]
pub use video::{
    MAX_VIDEO_PIXELS, MOCKUP_VIDEO_PLAN_SCHEMA, MOCKUP_VIDEO_SCHEMA, MockupVideoPlan,
    MockupVideoSpec, VIDEO_PLAN_SCHEMA, VIDEO_SCHEMA, VIDEO_VERSION, VideoEncoding, VideoPlan,
    VideoSpec, plan_mockup_video, plan_video,
};
pub use warp::{
    MAX_CUSTOM_MESH_SUBDIVISIONS, MAX_SURFACE_MESH_SUBDIVISIONS, MIN_CUSTOM_MESH_SUBDIVISIONS,
    MeshBoundary, WARP_MESH_SUBDIVISIONS, WarpMesh, WarpMeshTopology, WarpPreset, WarpSpec,
    WarpVertex, build_warp_mesh,
};
pub use warp_topology::{MAX_INDEXED_MESH_TRIANGLES, MAX_INDEXED_MESH_VERTICES};

#[cfg(feature = "document")]
mod scene3d;
#[cfg(feature = "document")]
pub use scene3d::{
    Scene3dArtwork, Scene3dPlan, Scene3dSample, Scene3dSpec, SceneArtworkFit, plan_scene3d,
};

pub use vector_artwork::{
    MAX_VECTOR_ARTWORK_BYTES, MAX_VECTOR_ARTWORK_INPUT_SEGMENTS, MAX_VECTOR_ARTWORK_INPUT_VERTICES,
    MAX_VECTOR_ARTWORK_OUTPUT_SEGMENTS, MAX_VECTOR_ARTWORK_OUTPUT_VERTICES,
    MAX_VECTOR_ARTWORK_PARTS, MAX_VECTOR_ARTWORK_WORK_UNITS, VectorArtworkPart,
    VectorArtworkProjectionInput, VectorArtworkProjectionOutput, VectorArtworkSourceBoundsPolicy,
    VectorArtworkUsage, VectorExecutionFrame, VectorOperation, VectorOperationInput,
    VectorOperationPlan, plan_vector_artwork, plan_vector_operation,
};

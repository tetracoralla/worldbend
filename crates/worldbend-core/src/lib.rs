//! Canonical projective plane-mapping semantics.
//!
//! The source is always the normalized unit square. Platform adapters may
//! resolve destination coordinates, but they must not replace this solver or
//! silently reorder corners.

mod canvas;
#[cfg(feature = "css")]
mod css;
#[cfg(feature = "deform")]
mod deform;
mod error;
mod geometry;
#[cfg(feature = "place")]
mod mockup;
mod model;
mod rectify;
#[cfg(feature = "remap")]
mod remap;
mod solver;
#[cfg(feature = "timeline")]
mod timeline;
mod transform;
mod warp;

pub use canvas::{
    CANVAS_PLAN_SCHEMA, CANVAS_SCHEMA, CANVAS_SET_PLAN_SCHEMA, CANVAS_SET_SCHEMA, CANVAS_VERSION,
    CanvasBackground, CanvasInsets, CanvasOperation, CanvasOperationKind, CanvasPlacement,
    CanvasPlan, CanvasScale, CanvasSetPlan, CanvasSetSpec, CanvasSpec, CanvasVariant,
    CanvasVariantPlan, MAX_CANVAS_AXIS, MAX_CANVAS_PIXELS, MAX_CANVAS_SET_PIXELS,
    MAX_CANVAS_VARIANTS, NormalizedAnchor, PixelRect, Srgb8Space, plan_canvas, plan_canvas_set,
    resolve_canvas, resolve_canvas_set, resolve_trim_rect_rgba, resolve_trim_rect_rgba_with_cancel,
};
#[cfg(feature = "css")]
pub use css::{CssTransform, emit_css_transform};
#[cfg(feature = "deform")]
pub use deform::{
    MESH_WARP_PLAN_SCHEMA, MESH_WARP_SCHEMA, MESH_WARP_VERSION, MeshWarpPlan, MeshWarpSpec,
    plan_mesh_warp,
};
pub use error::{ErrorCode, TransformError, TransformResult, bounded_text};
pub use geometry::{
    Bounds, GeometryDiagnostics, ResolvedDestination, cross, polygon_signed_area, validate_quad,
};
#[cfg(feature = "place")]
pub use mockup::{
    MAX_MOCKUP_AXIS, MAX_MOCKUP_EXTRACT_PIXELS, MAX_MOCKUP_GRID_DIVISIONS, MAX_MOCKUP_PIXELS,
    MAX_MOCKUP_PLANES, MAX_MOCKUP_SEAMS, MOCKUP_EXTRACT_PLAN_SCHEMA, MOCKUP_EXTRACT_SCHEMA,
    MOCKUP_PLAN_SCHEMA, MOCKUP_SCHEMA, MOCKUP_VERSION, MockupEdge, MockupEdgeRef,
    MockupExtractItem, MockupExtractPlan, MockupExtractPlanItem, MockupExtractSpec, MockupGrid,
    MockupGridLine, MockupGridPlan, MockupMeasurement, MockupPhysicalSize, MockupPlan, MockupPlane,
    MockupPlanePlan, MockupSeam, MockupSeamPlan, MockupSpec, plan_mockup, plan_mockup_extract,
};
pub use model::{
    Content, CoordinateSpace, Destination, FitMode, Point, Quad, SPEC_SCHEMA, SPEC_VERSION, Size,
    SourceOrientation, TransformSpec,
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
pub use solver::{
    Homography, InspectOutput, MatrixDiagnostics, ReprojectionDiagnostics, ReprojectionPoint,
    SolveDiagnostics, SolveOutput, inspect_spec, inverse_transform_point, solve_quad, solve_spec,
    transform_point,
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
pub use warp::{
    MAX_CUSTOM_MESH_SUBDIVISIONS, MIN_CUSTOM_MESH_SUBDIVISIONS, WARP_MESH_SUBDIVISIONS, WarpMesh,
    WarpPreset, WarpSpec, WarpVertex, build_warp_mesh,
};

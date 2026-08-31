//! Canonical projective plane-mapping semantics.
//!
//! The source is always the normalized unit square. Platform adapters may
//! resolve destination coordinates, but they must not replace this solver or
//! silently reorder corners.

mod canvas;
#[cfg(feature = "css")]
mod css;
mod error;
mod geometry;
mod model;
mod rectify;
mod solver;
mod transform;
mod warp;

pub use canvas::{
    CANVAS_PLAN_SCHEMA, CANVAS_SCHEMA, CANVAS_SET_PLAN_SCHEMA, CANVAS_SET_SCHEMA, CANVAS_VERSION,
    CanvasBackground, CanvasInsets, CanvasOperation, CanvasOperationKind, CanvasPlacement,
    CanvasPlan, CanvasScale, CanvasSetPlan, CanvasSetSpec, CanvasSpec, CanvasVariant,
    CanvasVariantPlan, MAX_CANVAS_AXIS, MAX_CANVAS_PIXELS, MAX_CANVAS_SET_PIXELS,
    MAX_CANVAS_VARIANTS, NormalizedAnchor, PixelRect, Srgb8Space, plan_canvas, plan_canvas_set,
    resolve_canvas, resolve_canvas_set,
};
#[cfg(feature = "css")]
pub use css::{CssTransform, emit_css_transform};
pub use error::{ErrorCode, TransformError, TransformResult, bounded_text};
pub use geometry::{
    Bounds, GeometryDiagnostics, ResolvedDestination, cross, polygon_signed_area, validate_quad,
};
pub use model::{
    Content, CoordinateSpace, Destination, FitMode, Point, Quad, SPEC_SCHEMA, SPEC_VERSION, Size,
    SourceOrientation, TransformSpec,
};
pub use rectify::{
    PixelSize, RECTIFY_SCHEMA, RECTIFY_VERSION, RectifyDiagnostics, RectifyPlan, RectifySpec,
    SourcePlane, rectify_plane,
};
pub use solver::{
    Homography, InspectOutput, MatrixDiagnostics, ReprojectionDiagnostics, ReprojectionPoint,
    SolveDiagnostics, SolveOutput, inspect_spec, inverse_transform_point, solve_quad, solve_spec,
    transform_point,
};
pub use transform::{
    AffineComposition, Flip2D, Scale2D, Skew2D, TransformCanvas, TransformRecipe, compose_affine,
};
pub use warp::{
    WARP_MESH_SUBDIVISIONS, WarpMesh, WarpPreset, WarpSpec, WarpVertex, build_warp_mesh,
};

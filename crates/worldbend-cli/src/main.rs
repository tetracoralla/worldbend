#![recursion_limit = "256"]

use clap::{Parser, Subcommand, ValueEnum, error::ErrorKind};
#[cfg(feature = "full")]
use schemars::{JsonSchema, schema_for};
use serde::Serialize;
use serde_json::{Value, json};
#[cfg(feature = "full")]
use std::collections::HashMap;
use std::{
    fs,
    io::{self, Read, Write},
    path::PathBuf,
    process::ExitCode,
};
#[cfg(feature = "full")]
use worldbend_core::{
    AffineComposition, CanvasPlan, CanvasSpec, CssTransform, Flip2D, MeshWarpPlan, MeshWarpSpec,
    MockupExtractPlan, MockupExtractSpec, MockupPlan, MockupSpec, MotionPlan, MotionSpec,
    PlanePoseInput, PlanePoseOutput, PlaneStripInput, PlaneStripOutput, Point, Quad,
    RasterProgramInspection, RasterProgramSpec, RectifyPlan, RemapPlan, Scale2D, Skew2D,
    SolveOutput, SpatialTemplateInspection, SpatialTemplateSpec, SurfaceDeformationPlan,
    SurfaceDeformationSpec, TimelinePlan, TimelineSpec, TransformRecipe, VariationJobPlan,
    VariationJobSpec, WarpMesh, WarpPreset, WarpSpec, compose_affine, emit_css_transform,
    inspect_raster_program, inspect_spatial_template, plan_mesh_warp, plan_mockup,
    plan_mockup_extract, plan_motion, plan_surface_deformation, plan_timeline, plan_variation_job,
    project_plane_pose, project_plane_strip, solve_spec,
};
use worldbend_core::{
    CanvasBackground, CanvasSetPlan, CanvasSetSpec, ErrorCode, MAX_CANVAS_PIXELS,
    MAX_CANVAS_SET_PIXELS, RectifySpec, Size, Srgb8Space, TransformError, TransformSpec,
    bounded_text, inspect_spec, rectify_plane,
};
#[cfg(any(feature = "full", feature = "comfy"))]
use worldbend_core::{RemapSpec, plan_remap};
#[cfg(feature = "full")]
use worldbend_interop::{
    MAX_PSD_SOURCE_BYTES, PsdSmartObjectRequest, execute_psd_smart_object_request,
};
#[cfg(feature = "full")]
use worldbend_perception::{PlaneCandidateRequest, analyze_plane_candidates_file};
use worldbend_render::{
    CanvasMode, CanvasReplayOptions, CanvasReplaySampling, CanvasSetProgram,
    CanvasSetRenderOptions, DEFAULT_MAX_AXIS, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SOURCE_BYTES,
    RectifyRenderOptions, RenderLimits, RenderOptions, SamplingQuality, rectify_file,
    render_canvas_set_file, render_file,
};
#[cfg(feature = "full")]
use worldbend_render::{
    IccPolicy, MAX_MEDIA_PIXELS, MAX_TILED_ENCODED_BYTES, MAX_TILED_OUTPUT_PIXELS,
    MAX_VECTOR_SOURCE_BYTES, MediaOutput, MediaRenderOptions, MeshWarpRenderOptions,
    MockupExtractRenderOptions, MockupRenderOptions, OutputPrecision, RasterProgramRenderOptions,
    TiledMediaRenderOptions, TimelineRenderOptions, VariationJobRenderOptions, VectorCarrier,
    VectorRenderOptions, inspect_media_file, render_media_file, render_mesh_warp_file_with_cancel,
    render_mockup_extract_files, render_mockup_files, render_motion_files,
    render_raster_program_file, render_surface_deformation_file_with_cancel,
    render_tiled_media_directory, render_timeline_files, render_variation_job_files,
    render_vector_file,
};
#[cfg(any(feature = "full", feature = "comfy"))]
use worldbend_render::{RemapFileMap, RemapRenderOptions, render_remap_file_with_cancel};

const MAX_SPEC_BYTES: usize = 1024 * 1024;
const MAX_CLI_ERROR_CHARS: usize = 4096;

#[cfg(not(any(feature = "full", feature = "comfy")))]
compile_error!("worldbend-cli requires either the full or comfy carrier feature");

#[derive(Debug, Parser)]
#[command(
    name = "worldbend",
    version,
    about = "Deterministic 2D transforms and explicit assisted plane candidates"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Compose scale, rotation, skew, translation, and flips over a saved mapping.
    #[cfg(feature = "full")]
    Compose {
        #[arg(long)]
        spec: PathBuf,
        /// Concrete output size used to resolve the saved mapping.
        #[arg(long)]
        target_size: Option<String>,
        /// X,Y scale factors; each must be greater than 1e-6.
        #[arg(long, default_value = "1,1")]
        scale: String,
        /// Clockwise rotation in degrees.
        #[arg(long, default_value_t = 0.0)]
        rotate: f64,
        /// Horizontal,vertical skew in degrees; x-skew shifts x by y*tan(x), matching CSS skew(x, y).
        #[arg(long, default_value = "0,0")]
        skew: String,
        /// X,Y translation in resolved destination units.
        #[arg(long, default_value = "0,0")]
        translate: String,
        /// X,Y pivot relative to the current destination bounds.
        #[arg(long, default_value = "0.5,0.5")]
        pivot: String,
        /// Mirror the source horizontally in the composed result.
        #[arg(long)]
        flip_x: bool,
        /// Mirror the source vertically in the composed result.
        #[arg(long)]
        flip_y: bool,
        /// Apply one bounded common warp preset.
        #[arg(long, value_enum)]
        warp: Option<WarpArg>,
        /// Signed warp strength in [-1,1]. Used only with --warp. Defaults to 0.5 when --warp is given without a value.
        #[arg(long, requires = "warp")]
        warp_amount: Option<f64>,
        /// Remove an existing Warp from the composed result.
        #[arg(long, conflicts_with = "warp")]
        clear_warp: bool,
        /// Accepted for explicit Agent scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Solve and validate a homography from four explicit corners.
    #[cfg(feature = "full")]
    Solve {
        /// Four points in strict TL TR BR BL order: "x,y x,y x,y x,y".
        #[arg(long)]
        quad: String,
        /// Destination coordinate space.
        #[arg(long, value_enum, default_value_t = SpaceArg::Pixel)]
        space: SpaceArg,
        /// Pixel reference as WIDTHxHEIGHT. Required for pixel space.
        #[arg(long)]
        reference: Option<String>,
        /// Concrete destination size for normalized space or responsive scaling.
        #[arg(long)]
        target_size: Option<String>,
        /// Accepted for explicit Agent scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Inspect and re-solve an existing TransformSpec.
    Inspect {
        /// Path to a worldbend.transform JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Concrete destination size as WIDTHxHEIGHT for a normalized spec.
        #[arg(long)]
        target_size: Option<String>,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Render a raster source through a saved TransformSpec.
    Render {
        /// PNG, JPEG, or WebP source path.
        #[arg(long)]
        source: PathBuf,
        /// Path to a worldbend.transform JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// PNG output path.
        #[arg(long)]
        output: PathBuf,
        /// Sampling quality used by the native renderer.
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        /// Tight crops to transformed bounds; reference preserves the resolved destination frame.
        #[arg(long, value_enum, default_value_t = CanvasArg::Tight)]
        canvas: CanvasArg,
        /// Concrete destination size as WIDTHxHEIGHT for a normalized spec.
        #[arg(long)]
        target_size: Option<String>,
        /// Maximum permitted output width in pixels.
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        /// Maximum permitted output height in pixels.
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        /// Maximum permitted decoded source or output pixel count.
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        /// Maximum permitted encoded source bytes.
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        /// Atomically replace an existing regular PNG output file.
        #[arg(long)]
        overwrite: bool,
        /// Execute the same preflight and render without publishing the output.
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Inspect format, precision, alpha, orientation, digest, and ICC metadata.
    #[cfg(feature = "full")]
    MediaInspect {
        /// PNG, JPEG, WebP, or TIFF source path.
        #[arg(long)]
        source: PathBuf,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = MAX_MEDIA_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        json: bool,
    },
    /// Ask one explicit local Provider for plane candidates without applying any transform.
    #[cfg(feature = "full")]
    PlaneCandidates {
        /// PNG, JPEG, WebP, or TIFF source path.
        #[arg(long)]
        source: PathBuf,
        /// Path to a worldbend.perception-plane-request JSON document.
        #[arg(long)]
        request: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Inspect PSD/PSB Smart Objects or project selected eligible objects into a Spatial Template.
    #[cfg(feature = "full")]
    PsdSmartObjects {
        /// PSD or PSB source path. The file is read only and limited to 64 MiB.
        #[arg(long)]
        source: PathBuf,
        /// Path to a worldbend.psd-smart-object-request JSON document.
        #[arg(long)]
        request: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render a production raster with explicit format, precision, ICC, and loss disclosure.
    #[cfg(feature = "full")]
    MediaRender {
        /// PNG, JPEG, WebP, or TIFF source path.
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum)]
        format: MediaFormatArg,
        /// PNG/TIFF output precision. Omit to preserve source precision where supported.
        #[arg(long, value_enum)]
        precision: Option<PrecisionArg>,
        #[arg(long, value_enum, default_value_t = IccArg::Preserve)]
        icc: IccArg,
        /// Required for JPEG and rejected for other formats.
        #[arg(long)]
        jpeg_quality: Option<u8>,
        /// Required for JPEG as R,G,B and rejected for other formats.
        #[arg(long)]
        matte: Option<String>,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, value_enum, default_value_t = CanvasArg::Tight)]
        canvas: CanvasArg,
        #[arg(long)]
        target_size: Option<String>,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = MAX_MEDIA_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Preserve an SVG source through an affine SVG wrapper or projective HTML matrix3d carrier.
    #[cfg(feature = "full")]
    VectorRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum)]
        carrier: VectorCarrierArg,
        /// Intrinsic source element size as WIDTHxHEIGHT.
        #[arg(long)]
        element_size: String,
        #[arg(long, value_enum, default_value_t = CanvasArg::Tight)]
        canvas: CanvasArg,
        #[arg(long)]
        target_size: Option<String>,
        #[arg(long, default_value_t = MAX_VECTOR_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Render a large target as an atomic directory of independently encoded tiles and a manifest.
    #[cfg(feature = "full")]
    TiledMediaRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long, value_enum)]
        format: MediaFormatArg,
        #[arg(long, value_enum)]
        precision: Option<PrecisionArg>,
        #[arg(long, value_enum, default_value_t = IccArg::Preserve)]
        icc: IccArg,
        #[arg(long)]
        jpeg_quality: Option<u8>,
        #[arg(long)]
        matte: Option<String>,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, value_enum, default_value_t = CanvasArg::Tight)]
        canvas: CanvasArg,
        #[arg(long)]
        target_size: Option<String>,
        #[arg(long, default_value_t = 2048)]
        tile_width: u32,
        #[arg(long, default_value_t = 2048)]
        tile_height: u32,
        #[arg(long, default_value_t = MAX_TILED_OUTPUT_PIXELS)]
        max_output_pixels: u64,
        #[arg(long, default_value_t = MAX_TILED_ENCODED_BYTES)]
        max_encoded_bytes: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_source_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_source_height: u32,
        #[arg(long, default_value_t = MAX_MEDIA_PIXELS)]
        max_source_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Validate and solve one explicit source quadrilateral into an output rectangle.
    Rectify {
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Render one explicit source quadrilateral into its declared output rectangle.
    RectifyRender {
        /// PNG, JPEG, or WebP source path.
        #[arg(long)]
        source: PathBuf,
        /// Path to a worldbend.rectify JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// PNG output path.
        #[arg(long)]
        output: PathBuf,
        /// Sampling quality used by the native renderer.
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        /// Maximum permitted output width in pixels.
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        /// Maximum permitted output height in pixels.
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        /// Maximum permitted decoded source or output pixel count.
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        /// Maximum permitted encoded source bytes.
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        /// Atomically replace an existing regular PNG output file.
        #[arg(long)]
        overwrite: bool,
        /// Execute the same preflight and rectification without publishing the output.
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate one ordered single-raster program without decoding a source.
    #[cfg(feature = "full")]
    ProgramInspect {
        /// Path to a worldbend.raster-program JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Execute ordered Transform, Rectify, and Canvas stages in memory, then publish one PNG.
    #[cfg(feature = "full")]
    ProgramRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = worldbend_core::MAX_RASTER_PROGRAM_PIXELS)]
        max_cumulative_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        /// Run all stages and PNG encoding without publishing the output.
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Validate one reusable Spatial Template without decoding assets.
    #[cfg(feature = "full")]
    TemplateInspect {
        /// Path to a worldbend.spatial-template JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit Agent scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Render an ordered Variation Job and atomically publish its output
    /// directory; failurePolicy continue records per-item failures in order.
    #[cfg(feature = "full")]
    VariationRender {
        /// Repeat ASSET_ID=PATH once for every distinct assetId in the job.
        #[arg(long, required = true)]
        asset: Vec<String>,
        /// Path to a worldbend.variation-job JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// New output directory; existing paths are rejected.
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long, default_value_t = worldbend_render::MAX_VARIATION_JOB_SOURCE_PIXELS)]
        max_source_pixels: u64,
        #[arg(long, default_value_t = worldbend_render::MAX_VARIATION_JOB_PROCESSED_PIXELS)]
        max_processed_pixels: u64,
        /// Execute all decoding, rendering, and encoding without publishing the directory.
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit Agent scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate one ordered Canvas Set document without rendering it.
    CanvasInspect {
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Render one ordered Canvas Set or replay one resolved Canvas Set plan.
    CanvasRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long, required_unless_present = "plan", conflicts_with = "plan")]
        spec: Option<PathBuf>,
        #[arg(
            long,
            required_unless_present = "spec",
            conflicts_with = "spec",
            requires_all = ["sampling", "outside_fill"]
        )]
        plan: Option<PathBuf>,
        #[arg(long)]
        output_directory: PathBuf,
        /// Primary-image sampling quality. Accepted only with --spec.
        #[arg(long, value_enum)]
        quality: Option<QualityArg>,
        /// Replay sampling. Required with --plan and rejected with --spec.
        #[arg(long, value_enum, requires = "plan")]
        sampling: Option<ReplaySamplingArg>,
        /// JSON file containing an explicit transparent or srgb8 color background.
        #[arg(long, requires = "plan")]
        outside_fill: Option<PathBuf>,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = MAX_CANVAS_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = MAX_CANVAS_SET_PIXELS)]
        max_cumulative_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate and plan one explicit ordered multi-plane mockup.
    #[cfg(feature = "full")]
    MockupInspect {
        /// Path to a worldbend.mockup JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Composite explicit source rasters onto an ordered multi-plane mockup.
    #[cfg(feature = "full")]
    MockupRender {
        /// Repeat SOURCE_ID=PATH once for every distinct sourceId in the spec.
        #[arg(long, required = true)]
        source: Vec<String>,
        /// Path to a worldbend.mockup JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// PNG output path.
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate and plan ordered reverse extraction of explicit source planes.
    #[cfg(feature = "full")]
    MockupExtractInspect {
        /// Path to a worldbend.mockup-extract JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Extract explicit source planes into one atomically published PNG directory.
    #[cfg(feature = "full")]
    MockupExtractRender {
        /// PNG, JPEG, or WebP source path.
        #[arg(long)]
        source: PathBuf,
        /// Path to a worldbend.mockup-extract JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// New output directory; existing paths are rejected.
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long, default_value_t = worldbend_core::MAX_MOCKUP_EXTRACT_PIXELS)]
        max_cumulative_pixels: u64,
        #[arg(long)]
        dry_run: bool,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Validate and plan one explicit custom deformation mesh.
    #[cfg(feature = "full")]
    MeshInspect {
        /// Path to a worldbend.mesh-warp JSON document.
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render one explicit custom deformation mesh.
    #[cfg(feature = "full")]
    MeshRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Resolve one bounded cubic surface envelope plus ordered deformation strokes to a mesh.
    #[cfg(feature = "full")]
    SurfaceInspect {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render one bounded cubic surface envelope plus ordered deformation strokes.
    #[cfg(feature = "full")]
    SurfaceRender {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Validate and plan one explicit lens or displacement remap.
    #[cfg(any(feature = "full", feature = "comfy"))]
    RemapInspect {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render one explicit lens or displacement remap.
    #[cfg(any(feature = "full", feature = "comfy"))]
    RemapRender {
        #[arg(long)]
        source: PathBuf,
        /// Required only for displacement and rejected for lens remaps.
        #[arg(long)]
        map: Option<PathBuf>,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long)]
        overwrite: bool,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Validate and expand one explicit frame or linear-keyframe timeline.
    #[cfg(feature = "full")]
    TimelineInspect {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render an ordered timeline into one atomically published PNG directory.
    #[cfg(feature = "full")]
    TimelineRender {
        /// Repeat SOURCE_ID=PATH once for every distinct sourceId in the timeline.
        #[arg(long, required = true)]
        source: Vec<String>,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long, default_value_t = worldbend_core::MAX_TIMELINE_PIXELS)]
        max_cumulative_pixels: u64,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Validate and expand explicit motion keyframes with rational frame timing and easing.
    #[cfg(feature = "full")]
    MotionInspect {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Render explicit motion keyframes into one atomically published PNG directory.
    #[cfg(feature = "full")]
    MotionRender {
        /// Repeat SOURCE_ID=PATH once for the exact sourceId in the motion document.
        #[arg(long, required = true)]
        source: Vec<String>,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output_directory: PathBuf,
        #[arg(long, value_enum, default_value_t = QualityArg::Standard)]
        quality: QualityArg,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_width: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_AXIS)]
        max_height: u32,
        #[arg(long, default_value_t = DEFAULT_MAX_PIXELS)]
        max_pixels: u64,
        #[arg(long, default_value_t = DEFAULT_MAX_SOURCE_BYTES)]
        max_source_bytes: u64,
        #[arg(long, default_value_t = worldbend_core::MAX_TIMELINE_PIXELS)]
        max_cumulative_pixels: u64,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        json: bool,
    },
    /// Pose a live card, video or plane using explicit angles and perspective.
    #[cfg(feature = "full")]
    Pose {
        /// JSON request containing elementSize and pose (same as MCP pose arguments).
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Divide a shared perspective plane into panels with collinear top/bottom edges.
    #[cfg(feature = "full")]
    PlaneStrip {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        json: bool,
    },
    /// Emit a live-element CSS matrix3d transform.
    #[cfg(feature = "full")]
    Css {
        /// Path to a projective worldbend.transform JSON document.
        #[arg(long)]
        spec: PathBuf,
        /// Untransformed element border-box size as WIDTHxHEIGHT in CSS pixels.
        #[arg(long)]
        element_size: String,
        /// Concrete destination container size as WIDTHxHEIGHT; required for normalized specs.
        #[arg(long)]
        container_size: Option<String>,
        /// Accepted for explicit scripting; command output is always JSON.
        #[arg(long)]
        json: bool,
    },
    /// Emit canonical core JSON Schemas for drift checks and integrations.
    #[cfg(feature = "full")]
    Schema,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, ValueEnum)]
enum SpaceArg {
    Pixel,
    Normalized,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum QualityArg {
    Preview,
    Standard,
    High,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CanvasArg {
    Tight,
    Reference,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, ValueEnum)]
enum MediaFormatArg {
    Png,
    Tiff,
    Jpeg,
    Webp,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, ValueEnum)]
enum PrecisionArg {
    Preserve,
    U8,
    U16,
    F32,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, ValueEnum)]
enum IccArg {
    Preserve,
    Discard,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, ValueEnum)]
enum VectorCarrierArg {
    Svg,
    Html,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum ReplaySamplingArg {
    Linear,
    Nearest,
}

#[cfg(feature = "full")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
enum WarpArg {
    Arc,
    Arch,
    Flag,
    Wave,
    Fish,
    Rise,
    Fisheye,
    Inflate,
    Squeeze,
    Twist,
}

#[cfg(feature = "full")]
impl From<WarpArg> for WarpPreset {
    fn from(value: WarpArg) -> Self {
        match value {
            WarpArg::Arc => Self::Arc,
            WarpArg::Arch => Self::Arch,
            WarpArg::Flag => Self::Flag,
            WarpArg::Wave => Self::Wave,
            WarpArg::Fish => Self::Fish,
            WarpArg::Rise => Self::Rise,
            WarpArg::Fisheye => Self::Fisheye,
            WarpArg::Inflate => Self::Inflate,
            WarpArg::Squeeze => Self::Squeeze,
            WarpArg::Twist => Self::Twist,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Success<T: Serialize> {
    ok: bool,
    operation: &'static str,
    result: T,
}

/// One mechanically generated schema surface for the Web/WASM carrier. The
/// wrapper is never serialized at runtime; it makes the Rust-owned input,
/// normalized output, mesh, CSS, and structured-error contracts available to
/// the TypeScript generator without a second handwritten semantic model.
#[allow(dead_code)]
#[cfg(feature = "full")]
#[derive(JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WebContract {
    plane_strip_input: PlaneStripInput,
    plane_strip_output: PlaneStripOutput,
    plane_pose_input: PlanePoseInput,
    plane_pose_output: PlanePoseOutput,
    transform_spec_input: TransformSpec,
    transform_recipe_input: TransformRecipe,
    affine_composition_output: AffineComposition,
    solve_output: SolveOutput,
    rectify_spec_input: RectifySpec,
    rectify_plan_output: RectifyPlan,
    canvas_spec_input: CanvasSpec,
    canvas_set_spec_input: CanvasSetSpec,
    canvas_plan_output: CanvasPlan,
    canvas_set_plan_output: CanvasSetPlan,
    mockup_spec_input: MockupSpec,
    mockup_plan_output: MockupPlan,
    mesh_warp_spec_input: MeshWarpSpec,
    mesh_warp_plan_output: MeshWarpPlan,
    surface_deformation_spec_input: SurfaceDeformationSpec,
    surface_deformation_plan_output: SurfaceDeformationPlan,
    remap_spec_input: RemapSpec,
    remap_plan_output: RemapPlan,
    spatial_template_spec_input: SpatialTemplateSpec,
    spatial_template_inspection_output: SpatialTemplateInspection,
    variation_job_spec_input: VariationJobSpec,
    variation_job_plan_output: VariationJobPlan,
    warp_mesh_output: WarpMesh,
    css_transform_output: CssTransform,
    transform_error: TransformError,
}

fn main() -> ExitCode {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(error) => {
            if matches!(
                error.kind(),
                ErrorKind::DisplayHelp | ErrorKind::DisplayVersion
            ) {
                return finish_write(write_text(&error.to_string()), ExitCode::SUCCESS);
            }
            let transform_error = TransformError::new(
                ErrorCode::Schema,
                bounded_text(&error.to_string(), MAX_CLI_ERROR_CHARS),
            );
            return finish_write(
                write_json(&json!({ "ok": false, "error": transform_error })),
                ExitCode::from(2),
            );
        }
    };

    match run(cli.command) {
        Ok(value) => finish_write(write_json(&value), ExitCode::SUCCESS),
        Err(error) => {
            let exit = exit_code(error.code);
            finish_write(
                write_json(&json!({ "ok": false, "error": error })),
                ExitCode::from(exit),
            )
        }
    }
}

fn run(command: Command) -> Result<Value, TransformError> {
    match command {
        #[cfg(feature = "full")]
        Command::Compose {
            spec,
            target_size,
            scale,
            rotate,
            skew,
            translate,
            pivot,
            flip_x,
            flip_y,
            warp,
            warp_amount,
            clear_warp,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let scale = parse_point(&scale, "scale")?;
            let skew = parse_point(&skew, "skew")?;
            let result = compose_affine(
                &spec,
                parse_optional_size(target_size, "targetSize")?,
                TransformRecipe {
                    scale: Scale2D {
                        x: scale.x,
                        y: scale.y,
                    },
                    rotation_degrees: rotate,
                    skew: Skew2D {
                        x_degrees: skew.x,
                        y_degrees: skew.y,
                    },
                    translation: parse_point(&translate, "translate")?,
                    pivot: parse_point(&pivot, "pivot")?,
                    flip: Flip2D {
                        x: flip_x,
                        y: flip_y,
                    },
                    warp: warp.map(|preset| WarpSpec {
                        preset: preset.into(),
                        amount: warp_amount.unwrap_or(0.5),
                    }),
                    clear_warp,
                },
            )?;
            to_value(Success {
                ok: true,
                operation: "compose",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::Solve {
            quad,
            space,
            reference,
            target_size,
            json: _,
        } => {
            let quad = parse_quad(&quad)?;
            let spec = match space {
                SpaceArg::Pixel => {
                    let reference = reference.ok_or_else(|| {
                        TransformError::new(
                            ErrorCode::Schema,
                            "--reference is required for pixel space",
                        )
                    })?;
                    TransformSpec::pixel(parse_size(&reference, "reference")?, quad)
                }
                SpaceArg::Normalized => {
                    if reference.is_some() {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "--reference is not allowed for normalized space",
                        ));
                    }
                    TransformSpec::normalized(quad)
                }
            };
            let result = solve_spec(&spec, parse_optional_size(target_size, "targetSize")?)?;
            to_value(Success {
                ok: true,
                operation: "solve",
                result,
            })
        }
        Command::Inspect {
            spec,
            target_size,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let result = inspect_spec(&spec, parse_optional_size(target_size, "targetSize")?)?;
            to_value(Success {
                ok: true,
                operation: "inspect",
                result,
            })
        }
        Command::Render {
            source,
            spec,
            output,
            quality,
            canvas,
            target_size,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let options = RenderOptions {
                quality: match quality {
                    QualityArg::Preview => SamplingQuality::Preview,
                    QualityArg::Standard => SamplingQuality::Standard,
                    QualityArg::High => SamplingQuality::High,
                },
                canvas: match canvas {
                    CanvasArg::Tight => CanvasMode::Tight,
                    CanvasArg::Reference => CanvasMode::Reference,
                },
                target_size: parse_optional_size(target_size, "targetSize")?,
                limits: RenderLimits {
                    max_width,
                    max_height,
                    max_pixels,
                    max_source_bytes,
                },
            };
            let result = render_file(&source, &spec, &output, options, overwrite, dry_run)?;
            to_value(Success {
                ok: true,
                operation: "render",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MediaInspect {
            source,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            json: _,
        } => {
            let result = inspect_media_file(
                &source,
                RenderLimits {
                    max_width,
                    max_height,
                    max_pixels,
                    max_source_bytes,
                },
            )?;
            to_value(Success {
                ok: true,
                operation: "mediaInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::PlaneCandidates {
            source,
            request,
            json: _,
        } => {
            let request: PlaneCandidateRequest = read_json_file(&request, "perception request")?;
            let result = analyze_plane_candidates_file(&source, &request)?;
            to_value(Success {
                ok: true,
                operation: "planeCandidates",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::PsdSmartObjects {
            source,
            request,
            json: _,
        } => {
            let request: PsdSmartObjectRequest = read_json_file(&request, "PsdSmartObjectRequest")?;
            let bytes = read_bounded_binary(&source, "PSD/PSB source", MAX_PSD_SOURCE_BYTES)?;
            let result = execute_psd_smart_object_request(&bytes, &request)?;
            to_value(Success {
                ok: true,
                operation: "psdSmartObjects",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MediaRender {
            source,
            spec,
            output,
            format,
            precision,
            icc,
            jpeg_quality,
            matte,
            quality,
            canvas,
            target_size,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let media_output =
                parse_media_output(format, precision, icc, jpeg_quality, matte.as_deref())?;
            let result = render_media_file(
                &source,
                &spec,
                &output,
                MediaRenderOptions {
                    render: RenderOptions {
                        quality: quality.into(),
                        canvas: match canvas {
                            CanvasArg::Tight => CanvasMode::Tight,
                            CanvasArg::Reference => CanvasMode::Reference,
                        },
                        target_size: parse_optional_size(target_size, "targetSize")?,
                        limits: RenderLimits {
                            max_width,
                            max_height,
                            max_pixels,
                            max_source_bytes,
                        },
                    },
                    output: media_output,
                },
                overwrite,
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "mediaRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::VectorRender {
            source,
            spec,
            output,
            carrier,
            element_size,
            canvas,
            target_size,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let result = render_vector_file(
                &source,
                &spec,
                &output,
                VectorRenderOptions {
                    carrier: match carrier {
                        VectorCarrierArg::Svg => VectorCarrier::Svg,
                        VectorCarrierArg::Html => VectorCarrier::Html,
                    },
                    element_size: parse_size(&element_size, "elementSize")?,
                    canvas: match canvas {
                        CanvasArg::Tight => CanvasMode::Tight,
                        CanvasArg::Reference => CanvasMode::Reference,
                    },
                    target_size: parse_optional_size(target_size, "targetSize")?,
                    max_source_bytes,
                },
                overwrite,
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "vectorRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::TiledMediaRender {
            source,
            spec,
            output_directory,
            format,
            precision,
            icc,
            jpeg_quality,
            matte,
            quality,
            canvas,
            target_size,
            tile_width,
            tile_height,
            max_output_pixels,
            max_encoded_bytes,
            max_source_width,
            max_source_height,
            max_source_pixels,
            max_source_bytes,
            dry_run,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let media_output =
                parse_media_output(format, precision, icc, jpeg_quality, matte.as_deref())?;
            let result = render_tiled_media_directory(
                &source,
                &spec,
                &output_directory,
                TiledMediaRenderOptions {
                    quality: quality.into(),
                    canvas: match canvas {
                        CanvasArg::Tight => CanvasMode::Tight,
                        CanvasArg::Reference => CanvasMode::Reference,
                    },
                    target_size: parse_optional_size(target_size, "targetSize")?,
                    source_limits: RenderLimits {
                        max_width: max_source_width,
                        max_height: max_source_height,
                        max_pixels: max_source_pixels,
                        max_source_bytes,
                    },
                    tile_width,
                    tile_height,
                    max_output_pixels,
                    max_encoded_bytes,
                    max_tiles: worldbend_render::MAX_TILED_TILES,
                    output: media_output,
                },
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "tiledMediaRender",
                result,
            })
        }
        Command::Rectify { spec, json: _ } => {
            let spec = read_rectify_spec(&spec)?;
            let result = rectify_plane(&spec)?;
            to_value(Success {
                ok: true,
                operation: "rectify",
                result,
            })
        }
        Command::RectifyRender {
            source,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec = read_rectify_spec(&spec)?;
            let options = RectifyRenderOptions {
                quality: quality.into(),
                limits: RenderLimits {
                    max_width,
                    max_height,
                    max_pixels,
                    max_source_bytes,
                },
            };
            let result = rectify_file(&source, &spec, &output, options, overwrite, dry_run)?;
            to_value(Success {
                ok: true,
                operation: "rectifyRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::ProgramInspect { spec, json: _ } => {
            let spec: RasterProgramSpec = read_json_file(&spec, "RasterProgramSpec")?;
            let result = inspect_raster_program(&spec)?;
            to_value(Success {
                ok: true,
                operation: "programInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::ProgramRender {
            source,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_cumulative_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec: RasterProgramSpec = read_json_file(&spec, "RasterProgramSpec")?;
            let result = render_raster_program_file(
                &source,
                &spec,
                &output,
                RasterProgramRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                    max_cumulative_pixels,
                },
                overwrite,
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "programRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::TemplateInspect { spec, json: _ } => {
            let spec: SpatialTemplateSpec = read_json_file(&spec, "SpatialTemplateSpec")?;
            let result = inspect_spatial_template(&spec)?;
            to_value(Success {
                ok: true,
                operation: "templateInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::VariationRender {
            asset,
            spec,
            output_directory,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            max_source_pixels,
            max_processed_pixels,
            dry_run,
            json: _,
        } => {
            let spec: VariationJobSpec = read_json_file(&spec, "VariationJobSpec")?;
            plan_variation_job(&spec)?;
            let assets = parse_variation_assets(asset)?;
            let result = render_variation_job_files(
                &assets,
                &spec,
                &output_directory,
                VariationJobRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                    max_source_pixels,
                    max_processed_pixels,
                },
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "variationRender",
                result,
            })
        }
        Command::CanvasInspect { spec, json: _ } => {
            let spec: CanvasSetSpec = read_json_file(&spec, "CanvasSetSpec")?;
            spec.validate()?;
            to_value(Success {
                ok: true,
                operation: "canvasInspect",
                result: spec,
            })
        }
        Command::CanvasRender {
            source,
            spec,
            plan,
            output_directory,
            quality,
            sampling,
            outside_fill,
            max_width,
            max_height,
            max_pixels,
            max_cumulative_pixels,
            max_source_bytes,
            dry_run,
            json: _,
        } => {
            let options = CanvasSetRenderOptions {
                quality: quality.unwrap_or(QualityArg::Standard).into(),
                limits: RenderLimits {
                    max_width,
                    max_height,
                    max_pixels,
                    max_source_bytes,
                },
                max_cumulative_pixels,
            };
            let result = match (spec, plan) {
                (Some(spec_path), None) => {
                    if sampling.is_some() || outside_fill.is_some() {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "--sampling and --outside-fill are accepted only with --plan",
                        ));
                    }
                    let spec: CanvasSetSpec = read_json_file(&spec_path, "CanvasSetSpec")?;
                    render_canvas_set_file(
                        &source,
                        CanvasSetProgram::Spec(&spec),
                        &output_directory,
                        options,
                        dry_run,
                    )?
                }
                (None, Some(plan_path)) => {
                    if quality.is_some() {
                        return Err(TransformError::new(
                            ErrorCode::Schema,
                            "--quality is accepted only with --spec",
                        ));
                    }
                    let plan: CanvasSetPlan = read_json_file(&plan_path, "CanvasSetPlan")?;
                    let sampling = sampling.ok_or_else(|| {
                        TransformError::new(ErrorCode::Schema, "--sampling is required with --plan")
                    })?;
                    let outside_fill = outside_fill.ok_or_else(|| {
                        TransformError::new(
                            ErrorCode::Schema,
                            "--outside-fill is required with --plan",
                        )
                    })?;
                    let outside_fill: CanvasBackground =
                        read_json_file(&outside_fill, "CanvasBackground")?;
                    render_canvas_set_file(
                        &source,
                        CanvasSetProgram::Plan {
                            plan: &plan,
                            replay: CanvasReplayOptions {
                                sampling: sampling.into(),
                                outside_fill: background_rgba(outside_fill),
                            },
                        },
                        &output_directory,
                        options,
                        dry_run,
                    )?
                }
                _ => {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "canvas-render requires exactly one --spec or --plan",
                    ));
                }
            };
            to_value(Success {
                ok: true,
                operation: "canvasRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MockupInspect { spec, json: _ } => {
            let spec: MockupSpec = read_json_file(&spec, "MockupSpec")?;
            let result = plan_mockup(&spec)?;
            to_value(Success {
                ok: true,
                operation: "mockupInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MockupRender {
            source,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec: MockupSpec = read_json_file(&spec, "MockupSpec")?;
            let sources = parse_mockup_sources(source)?;
            let result = render_mockup_files(
                &sources,
                &spec,
                &output,
                MockupRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                },
                overwrite,
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "mockupRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MockupExtractInspect { spec, json: _ } => {
            let spec: MockupExtractSpec = read_json_file(&spec, "MockupExtractSpec")?;
            let result = plan_mockup_extract(&spec)?;
            to_value(Success {
                ok: true,
                operation: "mockupExtractInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MockupExtractRender {
            source,
            spec,
            output_directory,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            max_cumulative_pixels,
            dry_run,
            json: _,
        } => {
            let spec: MockupExtractSpec = read_json_file(&spec, "MockupExtractSpec")?;
            let result = render_mockup_extract_files(
                &source,
                &spec,
                &output_directory,
                MockupExtractRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                    max_cumulative_pixels,
                },
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "mockupExtractRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MeshInspect { spec, json: _ } => {
            let spec: MeshWarpSpec = read_json_file(&spec, "MeshWarpSpec")?;
            let result = plan_mesh_warp(&spec)?;
            to_value(Success {
                ok: true,
                operation: "meshInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MeshRender {
            source,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec: MeshWarpSpec = read_json_file(&spec, "MeshWarpSpec")?;
            let result = render_mesh_warp_file_with_cancel(
                &source,
                None,
                &spec,
                &output,
                MeshWarpRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                },
                overwrite,
                dry_run,
                &|| false,
            )?;
            to_value(Success {
                ok: true,
                operation: "meshRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::SurfaceInspect { spec, json: _ } => {
            let spec: SurfaceDeformationSpec = read_json_file(&spec, "SurfaceDeformationSpec")?;
            let result = plan_surface_deformation(&spec)?;
            to_value(Success {
                ok: true,
                operation: "surfaceInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::SurfaceRender {
            source,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec: SurfaceDeformationSpec = read_json_file(&spec, "SurfaceDeformationSpec")?;
            let result = render_surface_deformation_file_with_cancel(
                &source,
                None,
                &spec,
                &output,
                MeshWarpRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                },
                overwrite,
                dry_run,
                &|| false,
            )?;
            to_value(Success {
                ok: true,
                operation: "surfaceRender",
                result,
            })
        }
        #[cfg(any(feature = "full", feature = "comfy"))]
        Command::RemapInspect { spec, json: _ } => {
            let spec: RemapSpec = read_json_file(&spec, "RemapSpec")?;
            let result = plan_remap(&spec)?;
            to_value(Success {
                ok: true,
                operation: "remapInspect",
                result,
            })
        }
        #[cfg(any(feature = "full", feature = "comfy"))]
        Command::RemapRender {
            source,
            map,
            spec,
            output,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            overwrite,
            dry_run,
            json: _,
        } => {
            let spec: RemapSpec = read_json_file(&spec, "RemapSpec")?;
            let map = map.map(|path| RemapFileMap { path, sha256: None });
            let result = render_remap_file_with_cancel(
                &source,
                None,
                map.as_ref(),
                &spec,
                &output,
                RemapRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                },
                overwrite,
                dry_run,
                &|| false,
            )?;
            to_value(Success {
                ok: true,
                operation: "remapRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::TimelineInspect { spec, json: _ } => {
            let spec: TimelineSpec = read_json_file(&spec, "TimelineSpec")?;
            let result = plan_timeline(&spec)?;
            to_value(Success {
                ok: true,
                operation: "timelineInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::TimelineRender {
            source,
            spec,
            output_directory,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            max_cumulative_pixels,
            dry_run,
            json: _,
        } => {
            let spec: TimelineSpec = read_json_file(&spec, "TimelineSpec")?;
            let sources = parse_mockup_sources(source)?;
            let result = render_timeline_files(
                &sources,
                &spec,
                &output_directory,
                TimelineRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                    max_cumulative_pixels,
                },
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "timelineRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MotionInspect { spec, json: _ } => {
            let spec: MotionSpec = read_json_file(&spec, "MotionSpec")?;
            let result = plan_motion(&spec)?;
            to_value(Success {
                ok: true,
                operation: "motionInspect",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::MotionRender {
            source,
            spec,
            output_directory,
            quality,
            max_width,
            max_height,
            max_pixels,
            max_source_bytes,
            max_cumulative_pixels,
            dry_run,
            json: _,
        } => {
            let spec: MotionSpec = read_json_file(&spec, "MotionSpec")?;
            let sources = parse_mockup_sources(source)?;
            let result = render_motion_files(
                &sources,
                &spec,
                &output_directory,
                TimelineRenderOptions {
                    quality: quality.into(),
                    limits: RenderLimits {
                        max_width,
                        max_height,
                        max_pixels,
                        max_source_bytes,
                    },
                    max_cumulative_pixels,
                },
                dry_run,
            )?;
            to_value(Success {
                ok: true,
                operation: "motionRender",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::PlaneStrip { input, json: _ } => {
            let input: PlaneStripInput = read_json_file(&input, "plane strip")?;
            to_value(Success {
                ok: true,
                operation: "plane_strip",
                result: project_plane_strip(&input)?,
            })
        }
        #[cfg(feature = "full")]
        Command::Pose { input, json: _ } => {
            let input: PlanePoseInput = read_json_file(&input, "plane pose")?;
            to_value(Success {
                ok: true,
                operation: "pose",
                result: project_plane_pose(&input)?,
            })
        }
        #[cfg(feature = "full")]
        Command::Css {
            spec,
            element_size,
            container_size,
            json: _,
        } => {
            let spec = read_spec(&spec)?;
            let result = emit_css_transform(
                &spec,
                parse_size(&element_size, "elementSize")?,
                parse_optional_size(container_size, "containerSize")?,
            )?;
            to_value(Success {
                ok: true,
                operation: "css",
                result,
            })
        }
        #[cfg(feature = "full")]
        Command::Schema => Ok(json!({
            "ok": true,
            "operation": "schema",
            "result": {
                "transformSpec": schema_for!(TransformSpec),
                "transformRecipe": schema_for!(TransformRecipe),
                "affineComposition": schema_for!(worldbend_core::AffineComposition),
                "solveOutput": schema_for!(worldbend_core::SolveOutput),
                "rectifySpec": schema_for!(RectifySpec),
                "rectifyPlan": schema_for!(RectifyPlan),
                "canvasSpec": schema_for!(CanvasSpec),
                "canvasSetSpec": schema_for!(CanvasSetSpec),
                "canvasPlan": schema_for!(CanvasPlan),
                "canvasSetPlan": schema_for!(CanvasSetPlan),
                "canvasReplayOptions": schema_for!(CanvasReplayOptions),
                "canvasSetRenderOptions": schema_for!(CanvasSetRenderOptions),
                "canvasSetFileRenderResult": schema_for!(worldbend_render::CanvasSetFileRenderResult),
                "mockupSpec": schema_for!(MockupSpec),
                "mockupPlan": schema_for!(MockupPlan),
                "mockupRenderOptions": schema_for!(MockupRenderOptions),
                "mockupFileRenderResult": schema_for!(worldbend_render::MockupFileRenderResult),
                "mockupExtractSpec": schema_for!(MockupExtractSpec),
                "mockupExtractPlan": schema_for!(MockupExtractPlan),
                "mockupExtractRenderOptions": schema_for!(MockupExtractRenderOptions),
                "mockupExtractFileRenderResult": schema_for!(worldbend_render::MockupExtractFileRenderResult),
                "meshWarpSpec": schema_for!(MeshWarpSpec),
                "meshWarpPlan": schema_for!(MeshWarpPlan),
                "meshWarpRenderOptions": schema_for!(MeshWarpRenderOptions),
                "meshWarpFileRenderResult": schema_for!(worldbend_render::MeshWarpFileRenderResult),
                "surfaceDeformationSpec": schema_for!(SurfaceDeformationSpec),
                "surfaceDeformationPlan": schema_for!(SurfaceDeformationPlan),
                "surfaceDeformationFileRenderResult": schema_for!(worldbend_render::SurfaceDeformationFileRenderResult),
                "remapSpec": schema_for!(RemapSpec),
                "remapPlan": schema_for!(RemapPlan),
                "remapRenderOptions": schema_for!(RemapRenderOptions),
                "remapFileRenderResult": schema_for!(worldbend_render::RemapFileRenderResult),
                "timelineSpec": schema_for!(TimelineSpec),
                "timelinePlan": schema_for!(TimelinePlan),
                "timelineRenderOptions": schema_for!(TimelineRenderOptions),
                "timelineFileRenderResult": schema_for!(worldbend_render::TimelineFileRenderResult),
                "motionSpec": schema_for!(MotionSpec),
                "motionPlan": schema_for!(MotionPlan),
                "motionFileRenderResult": schema_for!(worldbend_render::MotionFileRenderResult),
                "renderOptions": schema_for!(RenderOptions),
                "fileRenderResult": schema_for!(worldbend_render::FileRenderResult),
                "rectifyRenderOptions": schema_for!(RectifyRenderOptions),
                "rectifyFileRenderResult": schema_for!(worldbend_render::RectifyFileRenderResult),
                "rasterProgramSpec": schema_for!(RasterProgramSpec),
                "rasterProgramInspection": schema_for!(RasterProgramInspection),
                "rasterProgramRenderOptions": schema_for!(RasterProgramRenderOptions),
                "rasterProgramFileRenderResult": schema_for!(worldbend_render::RasterProgramFileRenderResult),
                "spatialTemplateSpec": schema_for!(SpatialTemplateSpec),
                "spatialTemplateInspection": schema_for!(SpatialTemplateInspection),
                "variationJobSpec": schema_for!(VariationJobSpec),
                "variationJobPlan": schema_for!(VariationJobPlan),
                "variationJobRenderOptions": schema_for!(VariationJobRenderOptions),
                "variationJobFileRenderResult": schema_for!(worldbend_render::VariationJobFileRenderResult),
                "mediaOutput": schema_for!(MediaOutput),
                "mediaRenderOptions": schema_for!(MediaRenderOptions),
                "mediaSourceInfo": schema_for!(worldbend_render::MediaSourceInfo),
                "mediaFileRenderResult": schema_for!(worldbend_render::MediaFileRenderResult),
                "planeCandidateRequest": schema_for!(PlaneCandidateRequest),
                "planeCandidateResponse": schema_for!(worldbend_perception::PlaneCandidateResponse),
                "psdSmartObjectRequest": schema_for!(PsdSmartObjectRequest),
                "psdSmartObjectResponse": schema_for!(worldbend_interop::PsdSmartObjectResponse),
                "vectorRenderOptions": schema_for!(VectorRenderOptions),
                "vectorFileResult": schema_for!(worldbend_render::VectorFileResult),
                "tiledMediaRenderOptions": schema_for!(TiledMediaRenderOptions),
                "tiledMediaManifest": schema_for!(worldbend_render::TiledMediaManifest),
                "tiledMediaRenderResult": schema_for!(worldbend_render::TiledMediaRenderResult),
                "planeStripInput": schema_for!(PlaneStripInput),
                "planeStripOutput": schema_for!(PlaneStripOutput),
                "planePoseInput": schema_for!(PlanePoseInput),
                "planePoseOutput": schema_for!(PlanePoseOutput),
                "cssTransform": schema_for!(CssTransform),
                "transformError": schema_for!(TransformError),
                "webContract": schema_for!(WebContract)
            }
        })),
    }
}

#[cfg(feature = "full")]
fn parse_mockup_sources(values: Vec<String>) -> Result<HashMap<String, PathBuf>, TransformError> {
    parse_named_paths(values, "--source", "SOURCE_ID")
}

#[cfg(feature = "full")]
fn parse_variation_assets(values: Vec<String>) -> Result<HashMap<String, PathBuf>, TransformError> {
    parse_named_paths(values, "--asset", "ASSET_ID")
}

#[cfg(feature = "full")]
fn parse_media_output(
    format: MediaFormatArg,
    precision: Option<PrecisionArg>,
    icc: IccArg,
    jpeg_quality: Option<u8>,
    matte: Option<&str>,
) -> Result<MediaOutput, TransformError> {
    let icc = match icc {
        IccArg::Preserve => IccPolicy::Preserve,
        IccArg::Discard => IccPolicy::Discard,
    };
    let precision = precision.map(|value| match value {
        PrecisionArg::Preserve => OutputPrecision::Preserve,
        PrecisionArg::U8 => OutputPrecision::U8,
        PrecisionArg::U16 => OutputPrecision::U16,
        PrecisionArg::F32 => OutputPrecision::F32,
    });
    match format {
        MediaFormatArg::Png | MediaFormatArg::Tiff => {
            if jpeg_quality.is_some() || matte.is_some() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "--jpeg-quality and --matte are accepted only with --format jpeg",
                ));
            }
            let precision = precision.unwrap_or(OutputPrecision::Preserve);
            Ok(match format {
                MediaFormatArg::Png => MediaOutput::Png { precision, icc },
                MediaFormatArg::Tiff => MediaOutput::Tiff { precision, icc },
                _ => unreachable!("matched above"),
            })
        }
        MediaFormatArg::Jpeg => {
            if precision.is_some() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "--precision is not accepted with JPEG; JPEG output is always u8",
                ));
            }
            let quality = jpeg_quality.ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "--jpeg-quality is required with --format jpeg",
                )
            })?;
            if !(1..=100).contains(&quality) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "--jpeg-quality must be in 1..100",
                ));
            }
            let matte = matte.ok_or_else(|| {
                TransformError::new(
                    ErrorCode::Schema,
                    "--matte R,G,B is required with --format jpeg",
                )
            })?;
            Ok(MediaOutput::Jpeg {
                quality,
                matte: parse_rgb8(matte, "matte")?,
                icc,
            })
        }
        MediaFormatArg::Webp => {
            if precision.is_some() || jpeg_quality.is_some() || matte.is_some() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "WebP lossless does not accept --precision, --jpeg-quality, or --matte",
                ));
            }
            Ok(MediaOutput::WebpLossless { icc })
        }
    }
}

#[cfg(feature = "full")]
fn parse_rgb8(value: &str, label: &str) -> Result<[u8; 3], TransformError> {
    let channels = value
        .split(',')
        .map(str::trim)
        .map(|channel| channel.parse::<u8>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| {
            TransformError::new(
                ErrorCode::Schema,
                format!("{label} must contain three integer channels in 0..255"),
            )
        })?;
    channels.try_into().map_err(|_| {
        TransformError::new(ErrorCode::Schema, format!("{label} must use R,G,B syntax"))
    })
}

#[cfg(feature = "full")]
fn parse_named_paths(
    values: Vec<String>,
    argument: &'static str,
    id_label: &'static str,
) -> Result<HashMap<String, PathBuf>, TransformError> {
    let mut sources = HashMap::with_capacity(values.len());
    for value in values {
        let (id, path) = value.split_once('=').ok_or_else(|| {
            TransformError::new(
                ErrorCode::Schema,
                format!("{argument} must use {id_label}=PATH syntax"),
            )
        })?;
        if id.is_empty() || path.is_empty() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                format!("{argument} requires a non-empty {id_label} and PATH"),
            ));
        }
        if sources.insert(id.to_owned(), PathBuf::from(path)).is_some() {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                format!("{argument} ids must be unique"),
            )
            .with_details(json!({ "id": id })));
        }
    }
    Ok(sources)
}

#[cfg(feature = "full")]
fn parse_quad(value: &str) -> Result<Quad, TransformError> {
    let values = value
        .split_whitespace()
        .map(|pair| {
            let mut coordinates = pair.split(',');
            let x = coordinates.next().and_then(|part| part.parse::<f64>().ok());
            let y = coordinates.next().and_then(|part| part.parse::<f64>().ok());
            if coordinates.next().is_some() || x.is_none() || y.is_none() {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "--quad must contain four comma-separated x,y points",
                ));
            }
            Ok(Point::new(x.unwrap(), y.unwrap()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let points: [Point; 4] = values.try_into().map_err(|_| {
        TransformError::new(
            ErrorCode::Schema,
            "--quad must contain exactly four points in TL TR BR BL order",
        )
    })?;
    Ok(Quad::new(points[0], points[1], points[2], points[3]))
}

fn parse_size(value: &str, field: &str) -> Result<Size, TransformError> {
    let separator = value.find(['x', 'X']).ok_or_else(|| {
        TransformError::new(
            ErrorCode::Schema,
            format!("{field} must use WIDTHxHEIGHT syntax"),
        )
    })?;
    let width = value[..separator]
        .parse::<f64>()
        .map_err(|_| TransformError::new(ErrorCode::Schema, format!("{field} width is invalid")))?;
    let height = value[separator + 1..].parse::<f64>().map_err(|_| {
        TransformError::new(ErrorCode::Schema, format!("{field} height is invalid"))
    })?;
    Size::new(width, height).validate(field)
}

#[cfg(feature = "full")]
fn parse_point(value: &str, field: &str) -> Result<Point, TransformError> {
    let mut coordinates = value.split(',');
    let x = coordinates.next().and_then(|part| part.parse::<f64>().ok());
    let y = coordinates.next().and_then(|part| part.parse::<f64>().ok());
    if coordinates.next().is_some() || x.is_none() || y.is_none() {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("{field} must use X,Y syntax"),
        ));
    }
    Ok(Point::new(x.unwrap(), y.unwrap()))
}

fn parse_optional_size(value: Option<String>, field: &str) -> Result<Option<Size>, TransformError> {
    value.map(|value| parse_size(&value, field)).transpose()
}

fn read_spec(path: &PathBuf) -> Result<TransformSpec, TransformError> {
    read_json_file(path, "TransformSpec")
}

fn read_rectify_spec(path: &PathBuf) -> Result<RectifySpec, TransformError> {
    read_json_file(path, "RectifySpec")
}

fn read_json_file<T: serde::de::DeserializeOwned>(
    path: &PathBuf,
    kind: &str,
) -> Result<T, TransformError> {
    let file = fs::File::open(path).map_err(|error| {
        TransformError::new(
            ErrorCode::Render,
            format!("failed to open {kind} file {}: {error}", path.display()),
        )
    })?;
    let mut bytes = Vec::new();
    file.take((MAX_SPEC_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Render,
                format!("failed to read {kind} file {}: {error}", path.display()),
            )
        })?;
    if bytes.len() > MAX_SPEC_BYTES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            format!("{kind} exceeds the input byte limit"),
        )
        .with_details(json!({ "maximum": MAX_SPEC_BYTES })));
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        TransformError::new(
            ErrorCode::Schema,
            format!(
                "failed to parse spec {}: {}",
                path.display(),
                bounded_text(&error.to_string(), MAX_CLI_ERROR_CHARS)
            ),
        )
    })
}

#[cfg(feature = "full")]
fn read_bounded_binary(
    path: &PathBuf,
    kind: &str,
    maximum: usize,
) -> Result<Vec<u8>, TransformError> {
    let file = fs::File::open(path).map_err(|error| {
        TransformError::new(
            ErrorCode::Render,
            format!("failed to open {kind} {}: {error}", path.display()),
        )
    })?;
    let mut bytes = Vec::new();
    file.take((maximum + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Render,
                format!("failed to read {kind} {}: {error}", path.display()),
            )
        })?;
    if bytes.len() > maximum {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            format!("{kind} exceeds its input byte limit"),
        )
        .with_details(json!({ "maximum": maximum })));
    }
    Ok(bytes)
}

impl From<QualityArg> for SamplingQuality {
    fn from(value: QualityArg) -> Self {
        match value {
            QualityArg::Preview => Self::Preview,
            QualityArg::Standard => Self::Standard,
            QualityArg::High => Self::High,
        }
    }
}

impl From<ReplaySamplingArg> for CanvasReplaySampling {
    fn from(value: ReplaySamplingArg) -> Self {
        match value {
            ReplaySamplingArg::Linear => Self::Linear,
            ReplaySamplingArg::Nearest => Self::Nearest,
        }
    }
}

fn background_rgba(background: CanvasBackground) -> [u8; 4] {
    match background {
        CanvasBackground::Transparent {} => [0, 0, 0, 0],
        CanvasBackground::Color {
            space: Srgb8Space::Srgb8,
            rgba,
        } => rgba,
    }
}

fn to_value(value: impl Serialize) -> Result<Value, TransformError> {
    serde_json::to_value(value).map_err(|error| {
        TransformError::new(
            ErrorCode::Internal,
            format!("failed to serialize result: {error}"),
        )
    })
}

fn write_json(value: &Value) -> io::Result<()> {
    let stdout = io::stdout();
    write_json_to(&mut stdout.lock(), value)
}

fn write_json_to(writer: &mut impl Write, value: &Value) -> io::Result<()> {
    let serialized = serde_json::to_string(value).unwrap_or_else(|error| {
        format!(
            "{{\"ok\":false,\"error\":{{\"code\":\"E_INTERNAL\",\"message\":{}}}}}",
            serde_json::to_string(&error.to_string())
                .unwrap_or_else(|_| "\"serialization failure\"".to_owned())
        )
    });
    writeln!(writer, "{serialized}")
}

fn write_text(text: &str) -> io::Result<()> {
    let stdout = io::stdout();
    stdout.lock().write_all(text.as_bytes())
}

fn finish_write(result: io::Result<()>, intended_exit: ExitCode) -> ExitCode {
    match result {
        Ok(()) => intended_exit,
        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("worldbend: failed to write stdout: {error}");
            ExitCode::from(6)
        }
    }
}

fn exit_code(code: ErrorCode) -> u8 {
    match code {
        ErrorCode::Schema | ErrorCode::NonFiniteCoordinate => 2,
        ErrorCode::QuadSelfIntersect
        | ErrorCode::QuadConcave
        | ErrorCode::QuadOrientation
        | ErrorCode::QuadDegenerate
        | ErrorCode::EdgeTooShort
        | ErrorCode::HomographySingular
        | ErrorCode::HomographyHorizonCrossing
        | ErrorCode::Reprojection
        | ErrorCode::CropBounds
        | ErrorCode::TrimEmpty
        | ErrorCode::RasterShapeMismatch
        | ErrorCode::OutputCollision
        | ErrorCode::SharedEdgeMismatch => 3,
        ErrorCode::UnsupportedMedia => 4,
        ErrorCode::OutputLimit
        | ErrorCode::PathOutsideRoot
        | ErrorCode::PathSymlink
        | ErrorCode::DestinationExists
        | ErrorCode::Render
        | ErrorCode::Capacity
        | ErrorCode::Cancelled
        | ErrorCode::Timeout
        | ErrorCode::Memory => 5,
        ErrorCode::Internal => 6,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, Rgba, RgbaImage};
    use worldbend_core::{
        CANVAS_SET_SCHEMA, CANVAS_VERSION, CanvasOperation, CanvasVariant, NormalizedAnchor,
        PixelSize,
    };

    #[test]
    #[cfg(feature = "full")]
    fn parses_quad_in_strict_order() {
        let quad = parse_quad("0,0 2,0 2,1 0,1").unwrap();
        assert_eq!(quad.tr, Point::new(2.0, 0.0));
        assert_eq!(quad.bl, Point::new(0.0, 1.0));
    }

    #[test]
    #[cfg(feature = "full")]
    fn rejects_extra_quad_point() {
        assert_eq!(
            parse_quad("0,0 1,0 1,1 0,1 2,2").unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    fn parses_case_insensitive_size_separator() {
        assert_eq!(
            parse_size("1440X900", "size").unwrap(),
            Size::new(1440.0, 900.0)
        );
    }

    #[test]
    #[cfg(feature = "full")]
    fn parses_transform_point_pairs() {
        assert_eq!(
            parse_point("1.25,-8", "scale").unwrap(),
            Point::new(1.25, -8.0)
        );
        assert_eq!(
            parse_point("1,2,3", "scale").unwrap_err().code,
            ErrorCode::Schema
        );
    }

    #[test]
    #[cfg(feature = "full")]
    fn media_format_options_are_a_closed_matrix() {
        assert!(matches!(
            parse_media_output(
                MediaFormatArg::Png,
                Some(PrecisionArg::U16),
                IccArg::Preserve,
                None,
                None,
            )
            .unwrap(),
            MediaOutput::Png {
                precision: OutputPrecision::U16,
                icc: IccPolicy::Preserve,
            }
        ));
        assert!(matches!(
            parse_media_output(
                MediaFormatArg::Jpeg,
                None,
                IccArg::Discard,
                Some(90),
                Some("255,255,255"),
            )
            .unwrap(),
            MediaOutput::Jpeg {
                quality: 90,
                matte: [255, 255, 255],
                icc: IccPolicy::Discard,
            }
        ));
        for error in [
            parse_media_output(MediaFormatArg::Png, None, IccArg::Discard, Some(90), None)
                .unwrap_err(),
            parse_media_output(
                MediaFormatArg::Jpeg,
                Some(PrecisionArg::U8),
                IccArg::Discard,
                Some(90),
                Some("0,0,0"),
            )
            .unwrap_err(),
            parse_media_output(
                MediaFormatArg::Webp,
                Some(PrecisionArg::U8),
                IccArg::Discard,
                None,
                None,
            )
            .unwrap_err(),
        ] {
            assert_eq!(error.code, ErrorCode::Schema);
        }
    }

    #[test]
    #[cfg(feature = "full")]
    fn warp_amount_requires_a_warp_preset() {
        let error = Cli::try_parse_from([
            "worldbend",
            "compose",
            "--spec",
            "plane.json",
            "--warp-amount",
            "0.75",
        ])
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);

        let command = Cli::try_parse_from([
            "worldbend",
            "compose",
            "--spec",
            "plane.json",
            "--warp",
            "arc",
        ])
        .unwrap()
        .command;
        let Command::Compose {
            warp, warp_amount, ..
        } = command
        else {
            panic!("expected compose command");
        };
        assert_eq!(warp, Some(WarpArg::Arc));
        assert_eq!(warp_amount, None);

        let conflict = Cli::try_parse_from([
            "worldbend",
            "compose",
            "--spec",
            "plane.json",
            "--warp",
            "arc",
            "--clear-warp",
        ])
        .unwrap_err();
        assert_eq!(conflict.kind(), ErrorKind::ArgumentConflict);
    }

    #[test]
    fn canvas_cli_union_requires_replay_behavior_only_for_plans() {
        Cli::try_parse_from([
            "worldbend",
            "canvas-render",
            "--source",
            "source.png",
            "--spec",
            "set.json",
            "--output-directory",
            "outputs",
        ])
        .unwrap();

        let error = Cli::try_parse_from([
            "worldbend",
            "canvas-render",
            "--source",
            "source.png",
            "--plan",
            "plan.json",
            "--output-directory",
            "outputs",
        ])
        .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::MissingRequiredArgument);

        Cli::try_parse_from([
            "worldbend",
            "canvas-render",
            "--source",
            "source.png",
            "--plan",
            "plan.json",
            "--sampling",
            "nearest",
            "--outside-fill",
            "fill.json",
            "--output-directory",
            "outputs",
        ])
        .unwrap();
    }

    #[test]
    fn canvas_inspect_rejects_source_independent_invalid_operations() {
        let root = tempfile::tempdir().unwrap();
        let spec_path = root.path().join("invalid.json");
        let invalid = CanvasSetSpec {
            schema: CANVAS_SET_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            variants: vec![CanvasVariant {
                id: "bad".to_owned(),
                operation: CanvasOperation::Contain {
                    output: PixelSize::new(10, 10),
                    anchor: NormalizedAnchor { x: -0.1, y: 0.5 },
                    background: CanvasBackground::Transparent {},
                },
            }],
        };
        fs::write(&spec_path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        let error = run(Command::CanvasInspect {
            spec: spec_path,
            json: true,
        })
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
    }

    #[test]
    fn canvas_cli_renders_and_replays_the_returned_ordered_plan() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 1, Rgba([12, 34, 56, 255])))
            .save(&source)
            .unwrap();
        let spec = CanvasSetSpec {
            schema: CANVAS_SET_SCHEMA.to_owned(),
            version: CANVAS_VERSION.to_owned(),
            variants: vec![
                CanvasVariant {
                    id: "square".to_owned(),
                    operation: CanvasOperation::Contain {
                        output: PixelSize::new(2, 2),
                        anchor: NormalizedAnchor { x: 0.5, y: 0.5 },
                        background: CanvasBackground::Transparent {},
                    },
                },
                CanvasVariant {
                    id: "wide".to_owned(),
                    operation: CanvasOperation::Stretch {
                        output: PixelSize::new(3, 1),
                    },
                },
            ],
        };
        let spec_path = root.path().join("set.json");
        fs::write(&spec_path, serde_json::to_vec(&spec).unwrap()).unwrap();
        let output = root.path().join("outputs");
        let value = run(Command::CanvasRender {
            source: source.clone(),
            spec: Some(spec_path),
            plan: None,
            output_directory: output.clone(),
            quality: None,
            sampling: None,
            outside_fill: None,
            max_width: DEFAULT_MAX_AXIS,
            max_height: DEFAULT_MAX_AXIS,
            max_pixels: DEFAULT_MAX_PIXELS,
            max_cumulative_pixels: MAX_CANVAS_SET_PIXELS,
            max_source_bytes: DEFAULT_MAX_SOURCE_BYTES,
            dry_run: false,
            json: true,
        })
        .unwrap();
        assert_eq!(value["operation"], "canvasRender");
        assert_eq!(value["result"]["status"], "written");
        assert_eq!(value["result"]["items"][0]["id"], "square");
        assert_eq!(value["result"]["items"][1]["id"], "wide");
        assert!(output.join("square.png").is_file());
        assert!(output.join("wide.png").is_file());
        let original_plan = value["result"]["plan"].clone();

        let plan_path = root.path().join("plan.json");
        fs::write(&plan_path, serde_json::to_vec(&original_plan).unwrap()).unwrap();
        let fill_path = root.path().join("fill.json");
        fs::write(&fill_path, br#"{"kind":"transparent"}"#).unwrap();
        let replay = root.path().join("replay");
        let value = run(Command::CanvasRender {
            source,
            spec: None,
            plan: Some(plan_path),
            output_directory: replay.clone(),
            quality: None,
            sampling: Some(ReplaySamplingArg::Nearest),
            outside_fill: Some(fill_path),
            max_width: DEFAULT_MAX_AXIS,
            max_height: DEFAULT_MAX_AXIS,
            max_pixels: DEFAULT_MAX_PIXELS,
            max_cumulative_pixels: MAX_CANVAS_SET_PIXELS,
            max_source_bytes: DEFAULT_MAX_SOURCE_BYTES,
            dry_run: false,
            json: true,
        })
        .unwrap();
        assert_eq!(value["result"]["plan"], original_plan);
        assert_eq!(value["result"]["items"][0]["id"], "square");
        assert!(replay.join("square.png").is_file());
    }

    #[test]
    fn rejects_oversized_spec_before_unbounded_allocation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("oversized.projective.json");
        fs::write(&path, vec![b' '; MAX_SPEC_BYTES + 1]).unwrap();
        let error = read_spec(&path).unwrap_err();
        assert_eq!(error.code, ErrorCode::Schema);
        assert_eq!(error.message, "TransformSpec exceeds the input byte limit");
    }

    #[test]
    fn serializes_one_json_line_to_an_explicit_writer() {
        let mut output = Vec::new();
        write_json_to(&mut output, &json!({ "ok": true })).unwrap();
        assert_eq!(output, b"{\"ok\":true}\n");
    }

    #[test]
    fn treats_a_closed_pipeline_as_a_clean_exit() {
        struct ClosedPipe;

        impl Write for ClosedPipe {
            fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
                Err(io::Error::new(io::ErrorKind::BrokenPipe, "closed"))
            }

            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }

        let error = write_json_to(&mut ClosedPipe, &json!({ "ok": true }));
        assert_eq!(finish_write(error, ExitCode::from(3)), ExitCode::SUCCESS);
    }
}

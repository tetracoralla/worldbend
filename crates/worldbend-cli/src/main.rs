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
    MockupExtractPlan, MockupExtractSpec, MockupPlan, MockupSpec, Point, Quad, RectifyPlan,
    RemapPlan, Scale2D, Skew2D, SolveOutput, TimelinePlan, TimelineSpec, TransformRecipe, WarpMesh,
    WarpPreset, WarpSpec, compose_affine, emit_css_transform, plan_mesh_warp, plan_mockup,
    plan_mockup_extract, plan_timeline, solve_spec,
};
use worldbend_core::{
    CanvasBackground, CanvasSetPlan, CanvasSetSpec, ErrorCode, MAX_CANVAS_PIXELS,
    MAX_CANVAS_SET_PIXELS, RectifySpec, Size, Srgb8Space, TransformError, TransformSpec,
    bounded_text, inspect_spec, rectify_plane,
};
#[cfg(any(feature = "full", feature = "comfy"))]
use worldbend_core::{RemapSpec, plan_remap};
use worldbend_render::{
    CanvasMode, CanvasReplayOptions, CanvasReplaySampling, CanvasSetProgram,
    CanvasSetRenderOptions, DEFAULT_MAX_AXIS, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SOURCE_BYTES,
    RectifyRenderOptions, RenderLimits, RenderOptions, SamplingQuality, rectify_file,
    render_canvas_set_file, render_file,
};
#[cfg(feature = "full")]
use worldbend_render::{
    MeshWarpRenderOptions, MockupExtractRenderOptions, MockupRenderOptions, TimelineRenderOptions,
    render_mesh_warp_file_with_cancel, render_mockup_extract_files, render_mockup_files,
    render_timeline_files,
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
    about = "Deterministic transforms for explicit 2D planes"
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
    remap_spec_input: RemapSpec,
    remap_plan_output: RemapPlan,
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
                "remapSpec": schema_for!(RemapSpec),
                "remapPlan": schema_for!(RemapPlan),
                "remapRenderOptions": schema_for!(RemapRenderOptions),
                "remapFileRenderResult": schema_for!(worldbend_render::RemapFileRenderResult),
                "timelineSpec": schema_for!(TimelineSpec),
                "timelinePlan": schema_for!(TimelinePlan),
                "timelineRenderOptions": schema_for!(TimelineRenderOptions),
                "timelineFileRenderResult": schema_for!(worldbend_render::TimelineFileRenderResult),
                "renderOptions": schema_for!(RenderOptions),
                "fileRenderResult": schema_for!(worldbend_render::FileRenderResult),
                "rectifyRenderOptions": schema_for!(RectifyRenderOptions),
                "rectifyFileRenderResult": schema_for!(worldbend_render::RectifyFileRenderResult),
                "cssTransform": schema_for!(CssTransform),
                "transformError": schema_for!(TransformError),
                "webContract": schema_for!(WebContract)
            }
        })),
    }
}

#[cfg(feature = "full")]
fn parse_mockup_sources(values: Vec<String>) -> Result<HashMap<String, PathBuf>, TransformError> {
    let mut sources = HashMap::with_capacity(values.len());
    for value in values {
        let (id, path) = value.split_once('=').ok_or_else(|| {
            TransformError::new(ErrorCode::Schema, "--source must use SOURCE_ID=PATH syntax")
        })?;
        if id.is_empty() || path.is_empty() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "--source requires a non-empty SOURCE_ID and PATH",
            ));
        }
        if sources.insert(id.to_owned(), PathBuf::from(path)).is_some() {
            return Err(TransformError::new(
                ErrorCode::OutputCollision,
                "--source ids must be unique",
            )
            .with_details(json!({ "sourceId": id })));
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

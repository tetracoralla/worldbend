use clap::{Parser, Subcommand, ValueEnum, error::ErrorKind};
use schemars::{JsonSchema, schema_for};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::{self, Read, Write},
    path::PathBuf,
    process::ExitCode,
};
use worldbend_core::{
    AffineComposition, CssTransform, ErrorCode, Flip2D, Point, Quad, Scale2D, Size, Skew2D,
    SolveOutput, TransformError, TransformRecipe, TransformSpec, WarpMesh, WarpPreset, WarpSpec,
    bounded_text, compose_affine, emit_css_transform, inspect_spec, solve_spec,
};
use worldbend_render::{
    CanvasMode, DEFAULT_MAX_AXIS, DEFAULT_MAX_PIXELS, DEFAULT_MAX_SOURCE_BYTES, RenderLimits,
    RenderOptions, SamplingQuality, render_file,
};

const MAX_SPEC_BYTES: usize = 1024 * 1024;
const MAX_CLI_ERROR_CHARS: usize = 4096;

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
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        target_size: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Render a raster source through a saved TransformSpec.
    Render {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        output: PathBuf,
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
    /// Emit a live-element CSS matrix3d transform.
    Css {
        #[arg(long)]
        spec: PathBuf,
        #[arg(long)]
        element_size: String,
        #[arg(long)]
        container_size: Option<String>,
        #[arg(long)]
        json: bool,
    },
    /// Emit canonical core JSON Schemas for drift checks and integrations.
    Schema,
}

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
#[derive(JsonSchema)]
#[serde(rename_all = "camelCase")]
struct WebContract {
    transform_spec_input: TransformSpec,
    transform_recipe_input: TransformRecipe,
    affine_composition_output: AffineComposition,
    solve_output: SolveOutput,
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
        Command::Schema => Ok(json!({
            "ok": true,
            "operation": "schema",
            "result": {
                "transformSpec": schema_for!(TransformSpec),
                "transformRecipe": schema_for!(TransformRecipe),
                "affineComposition": schema_for!(worldbend_core::AffineComposition),
                "solveOutput": schema_for!(worldbend_core::SolveOutput),
                "renderOptions": schema_for!(RenderOptions),
                "fileRenderResult": schema_for!(worldbend_render::FileRenderResult),
                "cssTransform": schema_for!(CssTransform),
                "transformError": schema_for!(TransformError),
                "webContract": schema_for!(WebContract)
            }
        })),
    }
}

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
    let file = fs::File::open(path).map_err(|error| {
        TransformError::new(
            ErrorCode::Schema,
            format!("failed to read spec {}: {error}", path.display()),
        )
    })?;
    let mut bytes = Vec::new();
    file.take((MAX_SPEC_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            TransformError::new(
                ErrorCode::Schema,
                format!("failed to read spec {}: {error}", path.display()),
            )
        })?;
    if bytes.len() > MAX_SPEC_BYTES {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "TransformSpec exceeds the input byte limit",
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
            eprintln!("projective: failed to write stdout: {error}");
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
        | ErrorCode::Reprojection => 3,
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

    #[test]
    fn parses_quad_in_strict_order() {
        let quad = parse_quad("0,0 2,0 2,1 0,1").unwrap();
        assert_eq!(quad.tr, Point::new(2.0, 0.0));
        assert_eq!(quad.bl, Point::new(0.0, 1.0));
    }

    #[test]
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

use crate::{ErrorCode, PixelSize, Point, TransformError, TransformResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const REMAP_SCHEMA: &str = "worldbend.remap";
pub const REMAP_PLAN_SCHEMA: &str = "worldbend.remap-plan";
pub const REMAP_VERSION: &str = "0.1";
pub const MAX_REMAP_AXIS: u32 = 8192;
pub const MAX_REMAP_PIXELS: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemapSpec {
    pub schema: String,
    pub version: String,
    pub output: PixelSize,
    pub operation: RemapOperation,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RemapOperation {
    Lens {
        coefficients: LensCoefficients,
        #[serde(default = "default_center")]
        center: Point,
        #[serde(default = "default_lens_scale")]
        scale: LensScale,
    },
    Displacement {
        x_channel: RemapChannel,
        y_channel: RemapChannel,
        scale_x_pixels: f64,
        scale_y_pixels: f64,
        #[serde(default = "default_neutral")]
        neutral: u8,
        #[serde(default)]
        boundary: RemapBoundary,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LensCoefficients {
    #[serde(default)]
    pub k1: f64,
    #[serde(default)]
    pub k2: f64,
    #[serde(default)]
    pub k3: f64,
    #[serde(default)]
    pub p1: f64,
    #[serde(default)]
    pub p2: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LensScale {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemapChannel {
    Red,
    Green,
    Blue,
    Alpha,
    Luminance,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RemapBoundary {
    #[default]
    Transparent,
    Clamp,
    Wrap,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct RemapPlan {
    pub schema: String,
    pub version: String,
    pub spec: RemapSpec,
    pub requires_map: bool,
    pub output_pixels: u64,
}

pub fn plan_remap(spec: &RemapSpec) -> TransformResult<RemapPlan> {
    if spec.schema != REMAP_SCHEMA || spec.version != REMAP_VERSION {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "unsupported remap schema or version",
        ));
    }
    spec.output.validate("remap output")?;
    let output_pixels = u64::from(spec.output.width) * u64::from(spec.output.height);
    if spec.output.width > MAX_REMAP_AXIS
        || spec.output.height > MAX_REMAP_AXIS
        || output_pixels > MAX_REMAP_PIXELS
    {
        return Err(TransformError::new(
            ErrorCode::OutputLimit,
            "remap output exceeds the core limit",
        ));
    }
    let requires_map = match spec.operation {
        RemapOperation::Lens {
            coefficients,
            center,
            scale,
        } => {
            let values = [
                coefficients.k1,
                coefficients.k2,
                coefficients.k3,
                coefficients.p1,
                coefficients.p2,
                center.x,
                center.y,
                scale.x,
                scale.y,
            ];
            if values.iter().any(|value| !value.is_finite())
                || [
                    coefficients.k1,
                    coefficients.k2,
                    coefficients.k3,
                    coefficients.p1,
                    coefficients.p2,
                ]
                .iter()
                .any(|value| value.abs() > 4.0)
                || !(-1.0..=2.0).contains(&center.x)
                || !(-1.0..=2.0).contains(&center.y)
                || !(1.0e-6..=10.0).contains(&scale.x)
                || !(1.0e-6..=10.0).contains(&scale.y)
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "lens coefficients, center, or scale exceed the supported finite domain",
                ));
            }
            false
        }
        RemapOperation::Displacement {
            scale_x_pixels,
            scale_y_pixels,
            ..
        } => {
            if !scale_x_pixels.is_finite()
                || !scale_y_pixels.is_finite()
                || scale_x_pixels.abs() > f64::from(MAX_REMAP_AXIS)
                || scale_y_pixels.abs() > f64::from(MAX_REMAP_AXIS)
            {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "displacement scales must be finite and within the remap axis limit",
                ));
            }
            true
        }
    };
    Ok(RemapPlan {
        schema: REMAP_PLAN_SCHEMA.to_owned(),
        version: REMAP_VERSION.to_owned(),
        spec: spec.clone(),
        requires_map,
        output_pixels,
    })
}

const fn default_center() -> Point {
    Point::new(0.5, 0.5)
}

const fn default_lens_scale() -> LensScale {
    LensScale { x: 0.5, y: 0.5 }
}

const fn default_neutral() -> u8 {
    128
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lens_and_displacement_have_explicit_map_requirements() {
        let lens = RemapSpec {
            schema: REMAP_SCHEMA.to_owned(),
            version: REMAP_VERSION.to_owned(),
            output: PixelSize::new(10, 10),
            operation: RemapOperation::Lens {
                coefficients: LensCoefficients {
                    k1: 0.1,
                    k2: 0.0,
                    k3: 0.0,
                    p1: 0.0,
                    p2: 0.0,
                },
                center: default_center(),
                scale: default_lens_scale(),
            },
        };
        assert!(!plan_remap(&lens).unwrap().requires_map);
        let displacement = RemapSpec {
            operation: RemapOperation::Displacement {
                x_channel: RemapChannel::Red,
                y_channel: RemapChannel::Green,
                scale_x_pixels: 20.0,
                scale_y_pixels: -10.0,
                neutral: 128,
                boundary: RemapBoundary::Clamp,
            },
            ..lens
        };
        assert!(plan_remap(&displacement).unwrap().requires_map);
    }

    #[test]
    fn rejects_non_finite_or_excessive_parameters() {
        let spec = RemapSpec {
            schema: REMAP_SCHEMA.to_owned(),
            version: REMAP_VERSION.to_owned(),
            output: PixelSize::new(10, 10),
            operation: RemapOperation::Displacement {
                x_channel: RemapChannel::Red,
                y_channel: RemapChannel::Green,
                scale_x_pixels: f64::NAN,
                scale_y_pixels: 0.0,
                neutral: 128,
                boundary: RemapBoundary::Transparent,
            },
        };
        assert_eq!(plan_remap(&spec).unwrap_err().code, ErrorCode::Schema);
    }

    #[test]
    fn rejects_unknown_fields_inside_the_tagged_operation() {
        let error = serde_json::from_value::<RemapSpec>(serde_json::json!({
            "schema": REMAP_SCHEMA,
            "version": REMAP_VERSION,
            "output": { "width": 10, "height": 10 },
            "operation": {
                "kind": "lens",
                "coefficients": { "k1": 0, "k2": 0, "k3": 0, "p1": 0, "p2": 0 },
                "center": { "x": 0.5, "y": 0.5 },
                "scale": { "x": 0.5, "y": 0.5 },
                "unexpected": true
            }
        }))
        .unwrap_err();

        assert!(error.to_string().contains("unknown field `unexpected`"));
    }
}

//! A source view belongs to an input-plane binding, never to the image asset.
//! Native hosts can export an affine plane into an axis-aligned bitmap. Keep
//! its logical coordinates intact and sample that bitmap only at the final
//! raster boundary, rather than baking an inverse transform into new pixels.

use crate::{ErrorCode, PixelSize, Point, Size, TransformError, TransformResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub type AffineSourceMap = [[f64; 3]; 2];
const IDENTITY: AffineSourceMap = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum SourceCaptureConvention {
    /// Pixel-edge coordinates are measured at fixed density from captureOrigin.
    #[serde(rename = "fixedDensityFromOrigin")]
    FixedDensityFromOrigin,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SourceCaptureFacts {
    pub logical_size: Size,
    /// Logical source units -> the provider's capture coordinate space.
    pub logical_to_capture_space: AffineSourceMap,
    pub capture_origin: Point,
    pub capture_scale: f64,
    /// Actual decoded header dimensions, not dimensions inferred from bounds.
    pub pixel_size: PixelSize,
    pub convention: SourceCaptureConvention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum SourceSamplingSchema {
    #[serde(rename = "worldbend.source-sampling")]
    SourceSampling,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum SourceSamplingVersion {
    #[serde(rename = "0.1")]
    V01,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SourceSamplingFrame {
    pub schema: SourceSamplingSchema,
    pub version: SourceSamplingVersion,
    pub logical_size: Size,
    pub pixel_size: PixelSize,
    /// Logical normalized UV -> encoded texture normalized UV (pixel edges).
    pub logical_uv_to_texture_uv: AffineSourceMap,
}

impl SourceSamplingFrame {
    pub fn identity(logical_size: Size, pixel_size: PixelSize) -> TransformResult<Self> {
        let frame = Self {
            schema: SourceSamplingSchema::SourceSampling,
            version: SourceSamplingVersion::V01,
            logical_size,
            pixel_size,
            logical_uv_to_texture_uv: IDENTITY,
        };
        frame.validate()?;
        Ok(frame)
    }

    pub fn validate(&self) -> TransformResult<()> {
        self.logical_size.validate("source logical size")?;
        self.pixel_size.validate("source pixel size")?;
        validate_map(self.logical_uv_to_texture_uv)
    }

    pub fn validate_pixels(&self, width: u32, height: u32) -> TransformResult<()> {
        self.validate()?;
        if self.pixel_size != PixelSize::new(width, height) {
            return Err(TransformError::new(
                ErrorCode::RasterShapeMismatch,
                "source view dimensions do not match the decoded image",
            ));
        }
        Ok(())
    }

    pub fn map_uv(&self, point: Point) -> Point {
        let m = self.logical_uv_to_texture_uv;
        Point::new(
            m[0][0] * point.x + m[0][1] * point.y + m[0][2],
            m[1][0] * point.x + m[1][1] * point.y + m[1][2],
        )
    }

    /// The same linear map must enter filtering footprints; translation must not.
    pub fn map_uv_vector(&self, vector: Point) -> Point {
        let m = self.logical_uv_to_texture_uv;
        Point::new(
            m[0][0] * vector.x + m[0][1] * vector.y,
            m[1][0] * vector.x + m[1][1] * vector.y,
        )
    }

    pub fn is_identity(&self) -> bool {
        self.logical_uv_to_texture_uv == IDENTITY
    }
}

pub fn plan_source_capture(facts: &SourceCaptureFacts) -> TransformResult<SourceSamplingFrame> {
    facts.logical_size.validate("source logical size")?;
    facts.pixel_size.validate("source pixel size")?;
    validate_map(facts.logical_to_capture_space)?;
    if !facts.capture_scale.is_finite()
        || facts.capture_scale <= 0.0
        || !facts.capture_origin.x.is_finite()
        || !facts.capture_origin.y.is_finite()
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "invalid source capture origin or density",
        ));
    }
    let m = facts.logical_to_capture_space;
    let sx = facts.capture_scale / f64::from(facts.pixel_size.width);
    let sy = facts.capture_scale / f64::from(facts.pixel_size.height);
    let frame = SourceSamplingFrame {
        schema: SourceSamplingSchema::SourceSampling,
        version: SourceSamplingVersion::V01,
        logical_size: facts.logical_size,
        pixel_size: facts.pixel_size,
        logical_uv_to_texture_uv: [
            [
                m[0][0] * facts.logical_size.width * sx,
                m[0][1] * facts.logical_size.height * sx,
                (m[0][2] - facts.capture_origin.x) * sx,
            ],
            [
                m[1][0] * facts.logical_size.width * sy,
                m[1][1] * facts.logical_size.height * sy,
                (m[1][2] - facts.capture_origin.y) * sy,
            ],
        ],
    };
    frame.validate()?;
    Ok(frame)
}

/// Decoded capture pixel-edge coordinates -> logical source units. Vector
/// carriers use the same map to retain their curves inside a logical view box;
/// raster carriers normally consume `SourceSamplingFrame` at sampling time.
pub fn source_capture_to_logical(facts: &SourceCaptureFacts) -> TransformResult<AffineSourceMap> {
    plan_source_capture(facts)?;
    let m = facts.logical_to_capture_space;
    let scale = m[0][0]
        .abs()
        .max(m[0][1].abs())
        .max(m[1][0].abs())
        .max(m[1][1].abs());
    let [a, b, c, d] = [
        m[0][0] / scale,
        m[0][1] / scale,
        m[1][0] / scale,
        m[1][1] / scale,
    ];
    let determinant = a * d - b * c;
    let inverse = [
        [d / determinant / scale, -b / determinant / scale],
        [-c / determinant / scale, a / determinant / scale],
    ];
    let offset = [
        facts.capture_origin.x - m[0][2],
        facts.capture_origin.y - m[1][2],
    ];
    let result = [
        [
            inverse[0][0] / facts.capture_scale,
            inverse[0][1] / facts.capture_scale,
            inverse[0][0] * offset[0] + inverse[0][1] * offset[1],
        ],
        [
            inverse[1][0] / facts.capture_scale,
            inverse[1][1] / facts.capture_scale,
            inverse[1][0] * offset[0] + inverse[1][1] * offset[1],
        ],
    ];
    validate_map(result)?;
    Ok(result)
}

pub(crate) fn validate_map(m: AffineSourceMap) -> TransformResult<()> {
    if !m.iter().flatten().all(|value| value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::NonFiniteCoordinate,
            "source sampling map must be finite",
        ));
    }
    let scale = m[0][0]
        .abs()
        .max(m[0][1].abs())
        .max(m[1][0].abs())
        .max(m[1][1].abs());
    let determinant = (m[0][0] / scale) * (m[1][1] / scale) - (m[0][1] / scale) * (m[1][0] / scale);
    if !determinant.is_finite() || determinant.abs() <= 1.0e-12 {
        return Err(TransformError::new(
            ErrorCode::HomographySingular,
            "source sampling map is singular or ill-conditioned",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> SourceCaptureFacts {
        SourceCaptureFacts {
            logical_size: Size::new(100.0, 50.0),
            logical_to_capture_space: [[1.0, 0.0, 70000.25], [0.0, 1.0, -1000.375]],
            capture_origin: Point::new(70000.25, -1000.375),
            capture_scale: 2.0,
            pixel_size: PixelSize::new(200, 100),
            convention: SourceCaptureConvention::FixedDensityFromOrigin,
        }
    }

    #[test]
    fn identity_uses_actual_header_and_origin_relative_math() {
        let f = plan_source_capture(&facts()).unwrap();
        assert!(f.is_identity());
        assert_eq!(f.map_uv(Point::new(0.25, 0.75)), Point::new(0.25, 0.75));
        assert_eq!(
            f.validate_pixels(201, 100).unwrap_err().code,
            ErrorCode::RasterShapeMismatch
        );
        let mut rounded = facts();
        rounded.pixel_size.width = 201;
        let f = plan_source_capture(&rounded).unwrap();
        assert_eq!(f.map_uv(Point::new(1.0, 0.0)).x, 200.0 / 201.0);
    }

    #[test]
    fn capture_inverse_restores_logical_vector_coordinates_at_any_density() {
        for matrix in [
            [[0.0, -1.0, 74000.0], [1.0, 0.0, -300.0]],
            [[-1.0, 0.5, -1000.125], [0.0, 1.0, -1000.375]],
        ] {
            for density in [0.125, 1.0, 3.0] {
                let mut f = facts();
                f.logical_to_capture_space = matrix;
                f.capture_scale = density;
                let inverse = source_capture_to_logical(&f).unwrap();
                for point in [
                    Point::new(0.0, 0.0),
                    Point::new(100.0, 50.0),
                    Point::new(43.25, 9.75),
                ] {
                    let captured = Point::new(
                        (matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2]
                            - f.capture_origin.x)
                            * density,
                        (matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2]
                            - f.capture_origin.y)
                            * density,
                    );
                    let x = inverse[0][0] * captured.x + inverse[0][1] * captured.y + inverse[0][2];
                    let y = inverse[1][0] * captured.x + inverse[1][1] * captured.y + inverse[1][2];
                    assert!((x - point.x).abs() < 1e-9 && (y - point.y).abs() < 1e-9);
                }
            }
        }
    }

    #[test]
    fn reflected_negative_origin_and_shear_keep_their_signed_domain() {
        let mut input = facts();
        input.logical_to_capture_space = [[-1.0, 0.5, -1000.125], [0.0, 1.0, -1000.375]];
        input.capture_origin = Point::new(-1100.125, -1000.375);
        input.pixel_size = PixelSize::new(250, 100);
        let f = plan_source_capture(&input).unwrap();
        assert_eq!(f.map_uv(Point::new(0.0, 0.0)), Point::new(0.8, 0.0));
        let corner = f.map_uv(Point::new(1.0, 1.0));
        assert!((corner.x - 0.2).abs() < 1.0e-14 && corner.y == 1.0);
        assert_eq!(f.map_uv_vector(Point::new(1.0, 0.0)), Point::new(-0.8, 0.0));
    }

    #[test]
    fn logical_and_encoded_dimensions_are_independent() {
        let mut input = facts();
        input.logical_size = Size::new(6928.203125, 69.2820358276);
        input.logical_to_capture_space = [[0.5, 0.0, 0.0], [0.0, 0.5, 0.0]];
        input.capture_origin = Point::new(0.0, 0.0);
        input.capture_scale = 1.0;
        input.pixel_size = PixelSize::new(4080, 40);
        let f = plan_source_capture(&input).unwrap();
        assert_eq!(f.logical_size, input.logical_size);
        assert_eq!(f.pixel_size, PixelSize::new(4080, 40));
    }

    #[test]
    fn rejects_singular_nonfinite_and_wrong_version_before_sampling() {
        let mut input = facts();
        input.logical_to_capture_space[1][1] = 0.0;
        assert_eq!(
            plan_source_capture(&input).unwrap_err().code,
            ErrorCode::HomographySingular
        );
        input = facts();
        input.capture_scale = f64::INFINITY;
        assert!(plan_source_capture(&input).is_err());
        input = facts();
        input.logical_to_capture_space[0][2] = f64::NAN;
        assert!(plan_source_capture(&input).is_err());
        let frame = plan_source_capture(&facts()).unwrap();
        let mut value = serde_json::to_value(frame).unwrap();
        value["version"] = "0.2".into();
        assert!(serde_json::from_value::<SourceSamplingFrame>(value).is_err());
    }
}

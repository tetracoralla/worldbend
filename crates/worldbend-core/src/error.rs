use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

pub type TransformResult<T> = Result<T, TransformError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub enum ErrorCode {
    #[serde(rename = "E_SCHEMA")]
    Schema,
    #[serde(rename = "E_NON_FINITE_COORDINATE")]
    NonFiniteCoordinate,
    #[serde(rename = "E_QUAD_SELF_INTERSECT")]
    QuadSelfIntersect,
    #[serde(rename = "E_QUAD_CONCAVE")]
    QuadConcave,
    #[serde(rename = "E_QUAD_ORIENTATION")]
    QuadOrientation,
    #[serde(rename = "E_QUAD_DEGENERATE")]
    QuadDegenerate,
    #[serde(rename = "E_EDGE_TOO_SHORT")]
    EdgeTooShort,
    #[serde(rename = "E_HOMOGRAPHY_SINGULAR")]
    HomographySingular,
    #[serde(rename = "E_HOMOGRAPHY_HORIZON_CROSSING")]
    HomographyHorizonCrossing,
    #[serde(rename = "E_REPROJECTION")]
    Reprojection,
    #[serde(rename = "E_CROP_BOUNDS")]
    CropBounds,
    #[serde(rename = "E_TRIM_EMPTY")]
    TrimEmpty,
    #[serde(rename = "E_RASTER_SHAPE_MISMATCH")]
    RasterShapeMismatch,
    #[serde(rename = "E_OUTPUT_COLLISION")]
    OutputCollision,
    #[serde(rename = "E_UNSUPPORTED_MEDIA")]
    UnsupportedMedia,
    #[serde(rename = "E_OUTPUT_LIMIT")]
    OutputLimit,
    #[serde(rename = "E_PATH_OUTSIDE_ROOT")]
    PathOutsideRoot,
    #[serde(rename = "E_PATH_SYMLINK")]
    PathSymlink,
    #[serde(rename = "E_DESTINATION_EXISTS")]
    DestinationExists,
    #[serde(rename = "E_RENDER")]
    Render,
    #[serde(rename = "E_CAPACITY")]
    Capacity,
    #[serde(rename = "E_CANCELLED")]
    Cancelled,
    #[serde(rename = "E_TIMEOUT")]
    Timeout,
    #[serde(rename = "E_MEMORY")]
    Memory,
    #[serde(rename = "E_INTERNAL")]
    Internal,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Schema => "E_SCHEMA",
            Self::NonFiniteCoordinate => "E_NON_FINITE_COORDINATE",
            Self::QuadSelfIntersect => "E_QUAD_SELF_INTERSECT",
            Self::QuadConcave => "E_QUAD_CONCAVE",
            Self::QuadOrientation => "E_QUAD_ORIENTATION",
            Self::QuadDegenerate => "E_QUAD_DEGENERATE",
            Self::EdgeTooShort => "E_EDGE_TOO_SHORT",
            Self::HomographySingular => "E_HOMOGRAPHY_SINGULAR",
            Self::HomographyHorizonCrossing => "E_HOMOGRAPHY_HORIZON_CROSSING",
            Self::Reprojection => "E_REPROJECTION",
            Self::CropBounds => "E_CROP_BOUNDS",
            Self::TrimEmpty => "E_TRIM_EMPTY",
            Self::RasterShapeMismatch => "E_RASTER_SHAPE_MISMATCH",
            Self::OutputCollision => "E_OUTPUT_COLLISION",
            Self::UnsupportedMedia => "E_UNSUPPORTED_MEDIA",
            Self::OutputLimit => "E_OUTPUT_LIMIT",
            Self::PathOutsideRoot => "E_PATH_OUTSIDE_ROOT",
            Self::PathSymlink => "E_PATH_SYMLINK",
            Self::DestinationExists => "E_DESTINATION_EXISTS",
            Self::Render => "E_RENDER",
            Self::Capacity => "E_CAPACITY",
            Self::Cancelled => "E_CANCELLED",
            Self::Timeout => "E_TIMEOUT",
            Self::Memory => "E_MEMORY",
            Self::Internal => "E_INTERNAL",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Error)]
#[error("{message}")]
#[serde(deny_unknown_fields)]
pub struct TransformError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

impl TransformError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(mut self, details: Value) -> Self {
        self.details = Some(details);
        self
    }
}

/// Truncate free-form text to a bounded number of characters so error payloads
/// stay bounded across every adapter.
pub fn bounded_text(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capacity_and_cancellation_have_distinct_stable_wire_codes() {
        assert_eq!(ErrorCode::Capacity.as_str(), "E_CAPACITY");
        assert_eq!(ErrorCode::Cancelled.as_str(), "E_CANCELLED");
        assert_eq!(
            serde_json::to_string(&ErrorCode::Capacity).unwrap(),
            r#""E_CAPACITY""#
        );
        assert_eq!(
            serde_json::to_string(&ErrorCode::Cancelled).unwrap(),
            r#""E_CANCELLED""#
        );
    }

    #[test]
    fn canvas_failures_have_stable_wire_codes() {
        for (code, wire) in [
            (ErrorCode::CropBounds, "E_CROP_BOUNDS"),
            (ErrorCode::TrimEmpty, "E_TRIM_EMPTY"),
            (ErrorCode::RasterShapeMismatch, "E_RASTER_SHAPE_MISMATCH"),
            (ErrorCode::OutputCollision, "E_OUTPUT_COLLISION"),
        ] {
            assert_eq!(code.as_str(), wire);
            assert_eq!(serde_json::to_string(&code).unwrap(), format!("\"{wire}\""));
        }
    }
}

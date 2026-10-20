use crate::{ErrorCode, TransformError, TransformResult};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Shared named easing curves. Motion timelines and interactive-card turns
/// sample the same math so carriers cannot diverge on timing meaning.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum MotionEasing {
    Linear,
    Hold,
    CubicBezier {
        #[schemars(range(min = 0.0, max = 1.0))]
        x1: f64,
        #[schemars(range(min = -4.0, max = 4.0))]
        y1: f64,
        #[schemars(range(min = 0.0, max = 1.0))]
        x2: f64,
        #[schemars(range(min = -4.0, max = 4.0))]
        y2: f64,
    },
}

pub(crate) fn validate_easing(easing: MotionEasing) -> TransformResult<()> {
    if let MotionEasing::CubicBezier { x1, y1, x2, y2 } = easing
        && (!x1.is_finite()
            || !y1.is_finite()
            || !x2.is_finite()
            || !y2.is_finite()
            || !(0.0..=1.0).contains(&x1)
            || !(0.0..=1.0).contains(&x2)
            || !(-4.0..=4.0).contains(&y1)
            || !(-4.0..=4.0).contains(&y2))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "motion cubicBezier controls exceed their finite x or y bounds",
        ));
    }
    Ok(())
}

pub(crate) fn apply_easing(easing: MotionEasing, progress: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    match easing {
        MotionEasing::Linear => progress,
        MotionEasing::Hold => 0.0,
        MotionEasing::CubicBezier { x1, y1, x2, y2 } => {
            let mut low = 0.0;
            let mut high = 1.0;
            for _ in 0..32 {
                let middle = (low + high) * 0.5;
                if cubic_coordinate(middle, x1, x2) < progress {
                    low = middle;
                } else {
                    high = middle;
                }
            }
            cubic_coordinate((low + high) * 0.5, y1, y2)
        }
    }
}

fn cubic_coordinate(parameter: f64, first: f64, second: f64) -> f64 {
    let inverse = 1.0 - parameter;
    3.0 * inverse * inverse * parameter * first
        + 3.0 * inverse * parameter * parameter * second
        + parameter * parameter * parameter
}

//! Whole-scene framing shared by authored motion, receivers and video.
use crate::{
    CanvasPlan, ErrorCode, PixelSize, Size, SolveOutput, SpatialTemplateOutput, TransformError,
    TransformResult, TransformSpec, plan_canvas_set, solve_spec,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMotionPresentation {
    pub transform: TransformSpec,
    /// The explicit whole-scene raster viewport, before named output framing.
    pub size: PixelSize,
    pub output: SpatialTemplateOutput,
    pub output_id: String,
    /// Optional whole-view motion in the transform destination coordinate space.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub keyframes: Vec<crate::MotionKeyframe>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MockupMotionPresentationPlan {
    pub spec: MockupMotionPresentation,
    pub solve: SolveOutput,
    pub output: PixelSize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas: Option<CanvasPlan>,
}

pub fn plan_mockup_motion_presentation(
    spec: &MockupMotionPresentation,
) -> TransformResult<MockupMotionPresentationPlan> {
    spec.size.validate("motion presentation size")?;
    if let Some(last) = spec.keyframes.last() {
        if last.frame >= crate::MAX_TIMELINE_FRAMES as u32 {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "Whole-view keyframes must use the admitted motion frame range",
            ));
        }
        crate::mockup_motion::validate_keyframes(&spec.keyframes, last.frame + 1, "whole-view")?;
    }
    let solve = solve_spec(
        &spec.transform,
        Some(Size::new(
            f64::from(spec.size.width),
            f64::from(spec.size.height),
        )),
    )?;
    if solve.resolved_destination.reference
        != Size::new(f64::from(spec.size.width), f64::from(spec.size.height))
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "Motion presentation transform must resolve in its explicit raster viewport",
        ));
    }
    let canvas = match &spec.output {
        SpatialTemplateOutput::Single { id } => {
            crate::template::validate_id(id, "motion presentation output")?;
            if id != &spec.output_id {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "Select the declared motion presentation output",
                ));
            }
            None
        }
        SpatialTemplateOutput::CanvasSet { spec: set } => {
            let plan = plan_canvas_set(set, spec.size)?;
            Some(
                plan.variants
                    .into_iter()
                    .find(|v| v.id == spec.output_id)
                    .ok_or_else(|| {
                        TransformError::new(
                            ErrorCode::Schema,
                            "Select an existing named motion presentation output",
                        )
                    })?
                    .plan,
            )
        }
    };
    let output = canvas.as_ref().map_or(spec.size, |v| v.output_size);
    Ok(MockupMotionPresentationPlan {
        spec: spec.clone(),
        solve,
        output,
        canvas,
    })
}

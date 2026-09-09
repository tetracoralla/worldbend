use crate::{
    CoordinateSpace, CssTransform, ErrorCode, Point, Quad, Size, SourceOrientation, TransformError,
    TransformResult, TransformSpec, emit_css_transform, solve_spec, transform_point,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneStripPanel {
    #[schemars(length(min = 1, max = 64), regex(pattern = "^[A-Za-z0-9_-]+$"))]
    pub id: String,
    /// Left and right source-space fractions of one shared strip, including caller-chosen gaps.
    #[schemars(range(min = 0, max = 1))]
    pub start: f64,
    #[schemars(range(min = 0, max = 1))]
    pub end: f64,
    pub element_size: Size,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneStripInput {
    /// One front-facing unwarped shared plane. Each panel keeps its own source content.
    pub spec: TransformSpec,
    #[serde(default)]
    pub destination_size: Option<Size>,
    #[schemars(length(min = 1, max = 32))]
    pub panels: Vec<PlaneStripPanel>,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneStripItem {
    pub id: String,
    pub spec: TransformSpec,
    pub css: CssTransform,
}

#[derive(Debug, Clone, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlaneStripOutput {
    pub items: Vec<PlaneStripItem>,
}

/// Partition one homography, never assign unrelated rotations/scales per panel.
pub fn project_plane_strip(input: &PlaneStripInput) -> TransformResult<PlaneStripOutput> {
    if !(1..=32).contains(&input.panels.len()) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "a plane strip requires 1..32 panels",
        ));
    }
    if input.spec.content.orientation != SourceOrientation::Native
        || input
            .spec
            .content
            .warp
            .is_some_and(|warp| warp.amount != 0.0)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "the shared strip requires native source orientation and no nonzero Warp",
        ));
    }
    if input.spec.destination.space == CoordinateSpace::Normalized
        && input.destination_size.is_none()
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "normalized strip requires destinationSize",
        ));
    }
    let solved = solve_spec(&input.spec, input.destination_size)?;
    let mut ids = HashSet::new();
    let mut previous_end = 0.0;
    let mut items = Vec::with_capacity(input.panels.len());
    for panel in &input.panels {
        if !panel.start.is_finite() || !panel.end.is_finite() {
            return Err(TransformError::new(
                ErrorCode::NonFiniteCoordinate,
                "strip intervals must be finite",
            ));
        }
        if panel.id.is_empty()
            || panel.id.len() > 64
            || !panel
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
            || !ids.insert(&panel.id)
            || panel.start < previous_end
            || panel.end > 1.0
            || panel.start >= panel.end
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "strip IDs must be unique bounded ASCII identifiers; intervals must be ordered, nonoverlapping and within [0,1]",
            ));
        }
        previous_end = panel.end;
        let point = |x, y| transform_point(&solved.homography, Point::new(x, y));
        let spec = TransformSpec::pixel(
            solved.resolved_destination.reference,
            Quad::new(
                point(panel.start, 0.0)?,
                point(panel.end, 0.0)?,
                point(panel.end, 1.0)?,
                point(panel.start, 1.0)?,
            ),
        );
        let css = emit_css_transform(&spec, panel.element_size, None)?;
        items.push(PlaneStripItem {
            id: panel.id.clone(),
            spec,
            css,
        });
    }
    Ok(PlaneStripOutput { items })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example() -> PlaneStripInput {
        PlaneStripInput {
            spec: TransformSpec::pixel(
                Size::new(800.0, 400.0),
                Quad::new(
                    Point::new(0.0, 0.0),
                    Point::new(800.0, 60.0),
                    Point::new(800.0, 340.0),
                    Point::new(0.0, 400.0),
                ),
            ),
            destination_size: None,
            panels: vec![
                PlaneStripPanel {
                    id: "outer".into(),
                    start: 0.0,
                    end: 0.4,
                    element_size: Size::new(320.0, 400.0),
                },
                PlaneStripPanel {
                    id: "inner".into(),
                    start: 0.44,
                    end: 1.0,
                    element_size: Size::new(320.0, 400.0),
                },
            ],
        }
    }
    #[test]
    fn all_panel_edges_remain_on_the_two_shared_lines() {
        let input = example();
        let result = project_plane_strip(&input).unwrap();
        for item in &result.items {
            for p in [item.spec.destination.quad.tl, item.spec.destination.quad.tr] {
                assert!((p.y - p.x * 60.0 / 800.0).abs() < 1e-9);
            }
            for p in [item.spec.destination.quad.bl, item.spec.destination.quad.br] {
                assert!((p.y - (400.0 - p.x * 60.0 / 800.0)).abs() < 1e-9);
            }
        }
        assert_eq!(result.items[0].id, "outer");
        assert_eq!(result.items[1].id, "inner");
        assert!(
            result.items[0].spec.destination.quad.tr.x < result.items[1].spec.destination.quad.tl.x
        );
    }
    #[test]
    fn overlap_duplicate_ids_and_invalid_final_panel_fail_the_whole_plan() {
        let mut input = example();
        input.panels[1].start = 0.3;
        assert!(project_plane_strip(&input).is_err());
        input = example();
        input.panels[1].id = "outer".into();
        assert!(project_plane_strip(&input).is_err());
        input = example();
        input.panels[1].element_size.width = 0.0;
        assert!(project_plane_strip(&input).is_err());
        input = example();
        input.panels[0].start = f64::NAN;
        assert_eq!(
            project_plane_strip(&input).unwrap_err().code,
            ErrorCode::NonFiniteCoordinate
        );
    }
}

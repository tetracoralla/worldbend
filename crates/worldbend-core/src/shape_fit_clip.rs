//! Project the original compound mask through the canonical vector engine.
//! Interior deformation acts before fitting; this target-domain mask follows
//! the outer plane while retaining every contour, region and winding rule.
use crate::{
    Bounds, ErrorCode, MockupClip, MockupClipContour, MockupClipPlan, MockupClipSegment, Point,
    Size, TransformError, TransformResult, VectorPathRegion, VectorPathSegment, VectorPathSpec,
    VectorPathVertex, VectorProjectionInput, VectorWindingRule, flatten_mockup_clip_contour,
    plan_vector_projection, polygon_signed_area,
};

fn vertex(point: Point) -> VectorPathVertex {
    VectorPathVertex {
        x: point.x,
        y: point.y,
    }
}

fn path(contour: &MockupClipContour) -> VectorPathSpec {
    let mut vertices = vec![vertex(contour.start)];
    let mut segments = Vec::new();
    let mut current = contour.start;
    let mut current_index = 0;
    for segment in &contour.segments {
        let start = current_index;
        let (to, handles) = match *segment {
            MockupClipSegment::Line { to } => (to, (None, None)),
            MockupClipSegment::Cubic { c1, c2, to } => (
                to,
                (
                    Some(Point::new(c1.x - current.x, c1.y - current.y)),
                    Some(Point::new(c2.x - to.x, c2.y - to.y)),
                ),
            ),
        };
        if to == current && matches!(segment, MockupClipSegment::Line { .. }) {
            continue;
        }
        // Reuse the closing vertex rather than adding a coincident one.
        let end = if to == contour.start {
            0
        } else {
            vertices.push(vertex(to));
            vertices.len() - 1
        };
        segments.push(VectorPathSegment {
            start,
            end,
            tangent_start: handles.0,
            tangent_end: handles.1,
        });
        current = to;
        current_index = end;
    }
    let end = segments.last().expect("validated contour has segments").end;
    if end != 0 {
        segments.push(VectorPathSegment {
            start: end,
            end: 0,
            tangent_start: None,
            tangent_end: None,
        });
    }
    // A valid two-cubic lens has only two endpoints. The vector network needs
    // three vertices; an exact split changes its representation, not its curve.
    while vertices.len() < 3 {
        let first = segments[0];
        let a = Point::new(vertices[first.start].x, vertices[first.start].y);
        let b = Point::new(vertices[first.end].x, vertices[first.end].y);
        let c1 = first
            .tangent_start
            .map_or(a, |t| Point::new(a.x + t.x, a.y + t.y));
        let c2 = first
            .tangent_end
            .map_or(b, |t| Point::new(b.x + t.x, b.y + t.y));
        let (left, right) = crate::vector_projection::de_casteljau_split(&[a, c1, c2, b]);
        let middle = vertices.len();
        vertices.push(vertex(left[3]));
        let split = |p: [Point; 4], start, end| VectorPathSegment {
            start,
            end,
            tangent_start: Some(Point::new(p[1].x - p[0].x, p[1].y - p[0].y)),
            tangent_end: Some(Point::new(p[2].x - p[3].x, p[2].y - p[3].y)),
        };
        segments[0] = split(left, first.start, middle);
        segments.insert(1, split(right, middle, first.end));
    }
    VectorPathSpec {
        regions: vec![VectorPathRegion {
            winding_rule: VectorWindingRule::NonZero,
            loops: vec![(0..segments.len()).collect()],
        }],
        vertices,
        segments,
    }
}

/// Combine the authored target-domain mask without flattening its curves or
/// changing compound holes/independent region union semantics.
pub(crate) fn compound_vector_path(clip: &MockupClip) -> VectorPathSpec {
    let mut vertices = Vec::new();
    let mut segments = Vec::new();
    let mut loops = Vec::new();
    for contour in &clip.contours {
        let one = path(contour);
        let v = vertices.len();
        let s = segments.len();
        vertices.extend(one.vertices);
        segments.extend(one.segments.into_iter().map(|mut part| {
            part.start += v;
            part.end += v;
            part
        }));
        loops.push(
            one.regions[0].loops[0]
                .iter()
                .map(|i| i + s)
                .collect::<Vec<_>>(),
        );
    }
    let rule = |r| match r {
        crate::MockupClipFillRule::NonZero => VectorWindingRule::NonZero,
        crate::MockupClipFillRule::EvenOdd => VectorWindingRule::EvenOdd,
    };
    let regions = if clip.regions.is_empty() {
        vec![VectorPathRegion {
            winding_rule: rule(clip.fill_rule),
            loops,
        }]
    } else {
        clip.regions
            .iter()
            .map(|r| VectorPathRegion {
                winding_rule: rule(r.fill_rule),
                loops: r
                    .contour_indices
                    .iter()
                    .map(|&i| loops[i].clone())
                    .collect(),
            })
            .collect()
    };
    VectorPathSpec {
        vertices,
        segments,
        regions,
    }
}

pub fn project_deformation_clip(
    clip: &MockupClip,
    homography: [f64; 9],
    reference: Size,
) -> TransformResult<MockupClipPlan> {
    reference.validate("deformation clip reference")?;
    // Input limits, region references, finite coordinates and empty contours
    // use the same contract as Mockup. Generated projection has its own bound.
    crate::mockup::plan_clip(clip, reference)?;
    let mut contours = Vec::new();
    let mut total_segments = 0;
    for contour in &clip.contours {
        let output = plan_vector_projection(&VectorProjectionInput {
            schema: "worldbend.vector-projection".to_owned(),
            version: "0.1".to_owned(),
            path: path(contour),
            stroke: None,
            source_transform: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            source_bounds: Bounds {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            homography,
            mesh: None,
            reference,
            placement: reference,
            tolerance_px: 0.25,
        })?;
        let network = output.network;
        let indices = &network.regions[0].loops[0];
        total_segments += indices.len();
        if total_segments > crate::MAX_VECTOR_OUTPUT_SEGMENTS {
            return Err(TransformError::new(
                ErrorCode::OutputLimit,
                "fitted work mask exceeds the shared projected-segment limit",
            ));
        }
        let normalized = |index: usize| {
            Point::new(
                network.vertices[index].x / reference.width,
                network.vertices[index].y / reference.height,
            )
        };
        let start = normalized(network.segments[indices[0]].start);
        let segments = indices
            .iter()
            .map(|&index| {
                let segment = &network.segments[index];
                let to = normalized(segment.end);
                match (segment.tangent_start, segment.tangent_end) {
                    (None, None) => MockupClipSegment::Line { to },
                    (a, b) => {
                        let from = normalized(segment.start);
                        let a = a.unwrap_or(Point::new(0.0, 0.0));
                        let b = b.unwrap_or(Point::new(0.0, 0.0));
                        MockupClipSegment::Cubic {
                            c1: Point::new(
                                from.x + a.x / reference.width,
                                from.y + a.y / reference.height,
                            ),
                            c2: Point::new(
                                to.x + b.x / reference.width,
                                to.y + b.y / reference.height,
                            ),
                            to,
                        }
                    }
                }
            })
            .collect();
        contours.push(MockupClipContour { start, segments });
    }
    let mut left = f64::INFINITY;
    let mut top = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    let mut contour_area_pixels = 0.0;
    for contour in &contours {
        let points = flatten_mockup_clip_contour(contour, reference);
        contour_area_pixels += polygon_signed_area(&points).abs();
        for p in points {
            left = left.min(p.x);
            top = top.min(p.y);
            right = right.max(p.x);
            bottom = bottom.max(p.y);
        }
    }
    Ok(MockupClipPlan {
        contours,
        fill_rule: clip.fill_rule,
        regions: clip.regions.clone(),
        bounds: Bounds {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top,
        },
        contour_area_pixels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MockupClipFillRule, MockupClipRegion};

    fn rectangle(x: f64, y: f64, width: f64, height: f64) -> MockupClipContour {
        MockupClipContour {
            start: Point::new(x, y),
            segments: [(x + width, y), (x + width, y + height), (x, y + height)]
                .map(|(x, y)| MockupClipSegment::Line {
                    to: Point::new(x, y),
                })
                .to_vec(),
        }
    }

    #[test]
    fn retains_compound_regions_and_their_winding_through_a_translated_plane() {
        let clip = MockupClip {
            contours: vec![
                rectangle(0.0, 0.0, 1.0, 1.0),
                rectangle(0.1, 0.5, 0.3, 0.3),
                rectangle(0.6, 0.5, 0.3, 0.3),
            ],
            fill_rule: MockupClipFillRule::EvenOdd,
            regions: vec![
                MockupClipRegion {
                    contour_indices: vec![0, 1],
                    fill_rule: MockupClipFillRule::EvenOdd,
                },
                MockupClipRegion {
                    contour_indices: vec![2],
                    fill_rule: MockupClipFillRule::NonZero,
                },
            ],
        };
        let matrix = [200.0, 0.0, -50.0, 0.0, 100.0, 25.0, 0.0, 0.0, 1.0];
        let plan = project_deformation_clip(&clip, matrix, Size::new(400.0, 200.0)).unwrap();
        assert_eq!(plan.regions, clip.regions);
        assert_eq!(plan.fill_rule, clip.fill_rule);
        assert_eq!(plan.contours.len(), 3);
        assert_eq!(plan.contours[0].start, Point::new(-0.125, 0.125));
        assert_eq!(
            plan.bounds,
            Bounds {
                x: -50.0,
                y: 25.0,
                width: 200.0,
                height: 100.0
            }
        );
        assert_eq!(
            plan,
            project_deformation_clip(&clip, matrix, Size::new(400.0, 200.0)).unwrap()
        );
    }

    #[test]
    fn retains_two_cubic_lenses_and_projects_curves_with_a_pixel_budget() {
        let lens = MockupClipContour {
            start: Point::new(0.2, 0.5),
            segments: vec![
                MockupClipSegment::Cubic {
                    c1: Point::new(0.2, 0.1),
                    c2: Point::new(0.8, 0.1),
                    to: Point::new(0.8, 0.5),
                },
                MockupClipSegment::Cubic {
                    c1: Point::new(0.8, 0.9),
                    c2: Point::new(0.2, 0.9),
                    to: Point::new(0.2, 0.5),
                },
            ],
        };
        let clip = MockupClip {
            contours: vec![lens],
            fill_rule: MockupClipFillRule::EvenOdd,
            regions: vec![],
        };
        let affine = project_deformation_clip(
            &clip,
            [320.0, 0.0, 0.0, 0.0, 360.0, 0.0, 0.0, 0.0, 1.0],
            Size::new(320.0, 360.0),
        )
        .unwrap();
        assert_eq!(affine.contours[0].segments.len(), 3);
        assert!(
            affine.contours[0]
                .segments
                .iter()
                .all(|s| matches!(s, MockupClipSegment::Cubic { .. }))
        );
        let projected = project_deformation_clip(
            &clip,
            [320.0, 0.0, 0.0, 0.0, 360.0, 0.0, 0.4, 0.1, 1.0],
            Size::new(320.0, 360.0),
        )
        .unwrap();
        assert!(projected.contours[0].segments.len() > 3);
        // Compare dense samples of the original rational curve with the
        // emitted target outline, independently of the internal report.
        let emitted = flatten_mockup_clip_contour(&projected.contours[0], Size::new(320.0, 360.0));
        let mut from = clip.contours[0].start;
        for segment in &clip.contours[0].segments {
            let MockupClipSegment::Cubic { c1, c2, to } = *segment else {
                unreachable!()
            };
            for i in 0..=200 {
                let t = f64::from(i) / 200.0;
                let u = 1.0 - t;
                let p = Point::new(
                    u.powi(3) * from.x
                        + 3.0 * u * u * t * c1.x
                        + 3.0 * u * t * t * c2.x
                        + t.powi(3) * to.x,
                    u.powi(3) * from.y
                        + 3.0 * u * u * t * c1.y
                        + 3.0 * u * t * t * c2.y
                        + t.powi(3) * to.y,
                );
                let w = 0.4 * p.x + 0.1 * p.y + 1.0;
                let p = Point::new(320.0 * p.x / w, 360.0 * p.y / w);
                let distance = emitted
                    .windows(2)
                    .map(|edge| {
                        let a = edge[0];
                        let b = edge[1];
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
                            .clamp(0.0, 1.0);
                        (p.x - a.x - t * dx).hypot(p.y - a.y - t * dy)
                    })
                    .fold(f64::INFINITY, f64::min);
                assert!(distance <= 0.6, "projected mask curve error {distance}");
            }
            from = to;
        }
    }

    #[test]
    fn rejects_bad_regions_and_horizon_crossings_instead_of_losing_a_contour() {
        let mut clip = MockupClip {
            contours: vec![rectangle(0.0, 0.0, 1.0, 1.0)],
            fill_rule: MockupClipFillRule::NonZero,
            regions: vec![],
        };
        assert!(
            project_deformation_clip(
                &clip,
                [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, -2.0, 0.0, 1.0],
                Size::new(100.0, 100.0)
            )
            .is_err()
        );
        clip.regions.push(MockupClipRegion {
            contour_indices: vec![1],
            fill_rule: MockupClipFillRule::EvenOdd,
        });
        assert_eq!(
            project_deformation_clip(
                &clip,
                [100.0, 0.0, 0.0, 0.0, 100.0, 0.0, 0.0, 0.0, 1.0],
                Size::new(100.0, 100.0)
            )
            .unwrap_err()
            .code,
            ErrorCode::Schema
        );
    }
}

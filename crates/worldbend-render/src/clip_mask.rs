//! Canvas clip masking for the mockup renderer. One deterministic scanline
//! rasterizer converts the clip's flattened contours into per-pixel coverage,
//! which multiplies the composed canvas alpha. Vertical antialiasing uses
//! fixed sample lines; horizontal coverage is exact span arithmetic.

use image::{Rgba, RgbaImage};
use worldbend_core::{
    ErrorCode, MockupClipFillRule, MockupClipPlan, Point, Size, TransformError, TransformResult,
    flatten_mockup_clip_contour,
};

/// Sample lines per output row. Four keeps the accumulated rounding error of
/// the fixed-point accumulator well under one alpha step.
const SAMPLE_LINES_PER_ROW: usize = 4;
/// Fixed-point units of one fully covered row (SAMPLE_LINES_PER_ROW * 256).
const ROW_UNITS: u32 = (SAMPLE_LINES_PER_ROW * 256) as u32;

struct ClipEdge {
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    /// +1.0 when the edge points toward increasing y, -1.0 otherwise.
    direction: f64,
    regions: u16,
}

impl ClipEdge {
    fn ymin(&self) -> f64 {
        self.y0.min(self.y1)
    }

    fn ymax(&self) -> f64 {
        self.y0.max(self.y1)
    }

    fn x_at(&self, y: f64) -> f64 {
        let t = (y - self.y0) / (self.y1 - self.y0);
        self.x0 + t * (self.x1 - self.x0)
    }
}

/// Multiply the canvas alpha by the clip's covered region. Color channels are
/// untouched: the image keeps straight alpha, so a clipped pixel simply
/// disappears instead of darkening.
pub fn apply_clip_mask(
    image: &mut RgbaImage,
    clip: &MockupClipPlan,
    is_cancelled: &dyn Fn() -> bool,
) -> TransformResult<()> {
    let reference = Size::new(f64::from(image.width()), f64::from(image.height()));
    apply_clip_mask_in_frame(image, clip, reference, Point::new(0.0, 0.0), is_cancelled)
}

/// Clip coordinates are normalized to the solved reference, whereas a Tight
/// render can have a translated origin and different dimensions.
pub(crate) fn apply_clip_mask_in_frame(
    image: &mut RgbaImage,
    clip: &MockupClipPlan,
    reference: Size,
    origin: Point,
    is_cancelled: &dyn Fn() -> bool,
) -> TransformResult<()> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    if width == 0 || height == 0 {
        return Ok(());
    }
    let mut edges = Vec::new();
    let fill_rules: Vec<_> = if clip.regions.is_empty() {
        vec![clip.fill_rule]
    } else {
        clip.regions.iter().map(|region| region.fill_rule).collect()
    };
    for (contour_index, contour) in clip.contours.iter().enumerate() {
        let regions = if clip.regions.is_empty() {
            1
        } else {
            clip.regions
                .iter()
                .enumerate()
                .fold(0, |mask, (index, region)| {
                    if region.contour_indices.contains(&contour_index) {
                        mask | (1 << index)
                    } else {
                        mask
                    }
                })
        };
        let points: Vec<_> = flatten_mockup_clip_contour(contour, reference)
            .into_iter()
            .map(|p| Point::new(p.x - origin.x, p.y - origin.y))
            .collect();
        for pair in points.windows(2) {
            let (start, end) = (pair[0], pair[1]);
            if start.y == end.y {
                continue;
            }
            edges.push(ClipEdge {
                x0: start.x,
                y0: start.y,
                x1: end.x,
                y1: end.y,
                direction: if end.y > start.y { 1.0 } else { -1.0 },
                regions,
            });
        }
    }
    // Edges enter the sweep in bottom-to-top order of their range; the active
    // list below keeps only edges crossing the current sample line.
    edges.sort_by(|left, right| {
        left.ymin()
            .partial_cmp(&right.ymin())
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut row_units = vec![0_u16; width];
    let mut next_edge = 0_usize;
    let mut active: Vec<usize> = Vec::new();
    let mut crossings: Vec<(f64, f64, u16)> = Vec::new();
    let mut region_crossings = Vec::new();
    let mut spans: Vec<(f64, f64)> = Vec::new();
    for row in 0..height {
        if is_cancelled() {
            return Err(TransformError::new(
                ErrorCode::Cancelled,
                "mockup render was cancelled",
            ));
        }
        row_units.iter_mut().for_each(|units| *units = 0);
        for sample in 0..SAMPLE_LINES_PER_ROW {
            let y = row as f64 + (sample as f64 + 0.5) / SAMPLE_LINES_PER_ROW as f64;
            while next_edge < edges.len() && edges[next_edge].ymin() <= y {
                active.push(next_edge);
                next_edge += 1;
            }
            active.retain(|&index| edges[index].ymax() > y);
            crossings.clear();
            crossings.extend(active.iter().map(|&index| {
                let edge = &edges[index];
                (edge.x_at(y), edge.direction, edge.regions)
            }));
            crossings.sort_by(|left, right| {
                left.0
                    .partial_cmp(&right.0)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            spans.clear();
            for (region_index, fill_rule) in fill_rules.iter().enumerate() {
                region_crossings.clear();
                region_crossings.extend(
                    crossings
                        .iter()
                        .filter(|entry| entry.2 & (1 << region_index) != 0)
                        .map(|entry| (entry.0, entry.1)),
                );
                match fill_rule {
                    MockupClipFillRule::EvenOdd => {
                        for pair in region_crossings.chunks_exact(2) {
                            spans.push((pair[0].0, pair[1].0));
                        }
                    }
                    MockupClipFillRule::NonZero => {
                        let mut winding = 0.0_f64;
                        for pair in region_crossings.windows(2) {
                            winding += pair[0].1;
                            if winding != 0.0 {
                                spans.push((pair[0].0, pair[1].0));
                            }
                        }
                    }
                }
            }
            // Regions are a geometric union. Merge their intervals before
            // accumulating coverage, so overlap cannot double alpha or cancel.
            spans.sort_by(|left, right| left.0.total_cmp(&right.0));
            let mut merged: Option<(f64, f64)> = None;
            for &(start, end) in &spans {
                match merged {
                    Some((from, to)) if start <= to => merged = Some((from, to.max(end))),
                    Some((from, to)) => {
                        add_span(&mut row_units, width, from, to);
                        merged = Some((start, end));
                    }
                    None => merged = Some((start, end)),
                }
            }
            if let Some((start, end)) = merged {
                add_span(&mut row_units, width, start, end);
            }
        }
        for (column, units) in row_units.iter().enumerate() {
            if *units == 0 {
                image.put_pixel(column as u32, row as u32, Rgba([0, 0, 0, 0]));
                continue;
            }
            let pixel = image.get_pixel(column as u32, row as u32).0;
            let alpha = (u32::from(pixel[3]) * u32::from(*units) + ROW_UNITS / 2) / ROW_UNITS;
            image.put_pixel(
                column as u32,
                row as u32,
                Rgba([pixel[0], pixel[1], pixel[2], alpha as u8]),
            );
        }
    }
    Ok(())
}

/// Accumulate the horizontal coverage of one inside span `[start, end)` into
/// the row, in units of 1/ROW_UNITS of a fully covered row.
fn add_span(row_units: &mut [u16], width: usize, start: f64, end: f64) {
    if end <= start {
        return;
    }
    let start = start.clamp(0.0, width as f64);
    let end = end.clamp(0.0, width as f64);
    if end <= start {
        return;
    }
    let first = start.floor() as usize;
    let last = (end.ceil() as usize).saturating_sub(1).min(width - 1);
    for (column, units) in row_units.iter_mut().enumerate().take(last + 1).skip(first) {
        let covered = (end.min(column as f64 + 1.0) - start.max(column as f64)).clamp(0.0, 1.0);
        // One sample line contributes up to 256 of the row's 1024 units.
        *units = (*units).saturating_add((covered * 256.0).round() as u16);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use worldbend_core::{MockupClip, MockupClipContour, MockupClipSegment, Point};

    fn contour(start: Point, segments: Vec<MockupClipSegment>) -> MockupClipContour {
        MockupClipContour { start, segments }
    }

    fn plan(clip: MockupClip) -> MockupClipPlan {
        worldbend_core::plan_mockup(&worldbend_core::MockupSpec {
            schema: worldbend_core::MOCKUP_SCHEMA.to_owned(),
            version: worldbend_core::MOCKUP_VERSION.to_owned(),
            canvas: worldbend_core::PixelSize::new(16, 16),
            background: worldbend_core::CanvasBackground::Transparent {},
            planes: vec![worldbend_core::MockupPlane {
                id: "plane".to_owned(),
                source_id: "source".to_owned(),
                transform: worldbend_core::TransformSpec::normalized(worldbend_core::Quad::unit()),
                opacity: 1.0,
                grid: None,
                measurement: None,
                surface: None,
                shadow: None,
            }],
            seams: vec![],
            clip: Some(clip),
        })
        .unwrap()
        .clip
        .unwrap()
    }

    fn masked(clip: MockupClip) -> Vec<Vec<u8>> {
        let mut image = RgbaImage::from_pixel(16, 16, Rgba([12, 34, 56, 255]));
        let clip = plan(clip);
        apply_clip_mask(&mut image, &clip, &|| false).unwrap();
        (0..16)
            .map(|row| {
                (0..16)
                    .map(|column| image.get_pixel(column, row).0[3])
                    .collect()
            })
            .collect()
    }

    fn square_contour(from: f64, to: f64) -> MockupClipContour {
        contour(
            Point::new(from, from),
            vec![
                MockupClipSegment::Line {
                    to: Point::new(to, from),
                },
                MockupClipSegment::Line {
                    to: Point::new(to, to),
                },
                MockupClipSegment::Line {
                    to: Point::new(from, to),
                },
            ],
        )
    }

    #[test]
    fn clips_a_rectangle_with_antialiased_edges() {
        let alpha = masked(MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.25, 0.75)],
            fill_rule: MockupClipFillRule::NonZero,
        });
        // Deep interior stays fully opaque; the fully outside corner clears.
        // 0.25 and 0.75 land exactly on pixel boundaries 4 and 12.
        assert_eq!(alpha[8][8], 255);
        assert_eq!(alpha[8][5], 255);
        assert_eq!(alpha[8][4], 255);
        assert_eq!(alpha[8][3], 0);
        assert_eq!(alpha[8][12], 0);
        assert_eq!(alpha[1][1], 0);

        // A boundary inside pixel 4 covers only that pixel's remainder.
        let partial = masked(MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.275, 0.75)],
            fill_rule: MockupClipFillRule::NonZero,
        });
        // 0.275 * 16 = 4.4, so pixel 4 is 0.6 covered: about 153 of 255.
        assert!((partial[8][4] as i32 - 153).abs() <= 2, "{}", partial[8][4]);
        assert_eq!(partial[8][5], 255);
        assert_eq!(partial[8][3], 0);
    }

    #[test]
    fn even_odd_holes_punch_out_while_same_winding_fills() {
        let ring = MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.1, 0.9), square_contour(0.3, 0.7)],
            fill_rule: MockupClipFillRule::EvenOdd,
        };
        let even_odd = masked(ring);
        assert_eq!(even_odd[8][8], 0, "the inner square is a hole");
        assert_eq!(even_odd[8][2], 255, "the ring band stays covered");

        // Same-wound loops fill the center under nonzero; reversing the inner
        // loop must subtract it, including its first (vertical) edge.
        let mut same_wound = MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.1, 0.9), square_contour(0.3, 0.7)],
            fill_rule: MockupClipFillRule::NonZero,
        };
        assert_eq!(masked(same_wound.clone())[8][8], 255);
        let inner = contour(
            Point::new(0.3, 0.3),
            vec![
                MockupClipSegment::Line {
                    to: Point::new(0.3, 0.7),
                },
                MockupClipSegment::Line {
                    to: Point::new(0.7, 0.7),
                },
                MockupClipSegment::Line {
                    to: Point::new(0.7, 0.3),
                },
            ],
        );
        same_wound.contours[1] = inner;
        let nonzero = masked(same_wound);
        assert_eq!(
            nonzero[8][8], 0,
            "an opposite-wound inner contour still subtracts under nonzero"
        );
    }

    #[test]
    fn nonzero_counts_overlapping_same_wound_contours_once() {
        let clip = MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.2, 0.8), square_contour(0.2, 0.8)],
            fill_rule: MockupClipFillRule::NonZero,
        };
        let alpha = masked(clip);
        assert_eq!(alpha[8][8], 255);
        // Even-odd on the identical pair cancels to an empty clip.
        let cancelled = MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.2, 0.8), square_contour(0.2, 0.8)],
            fill_rule: MockupClipFillRule::EvenOdd,
        };
        assert_eq!(masked(cancelled)[8][8], 0);
    }

    #[test]
    fn cancellation_surfaces_between_rows() {
        let mut image = RgbaImage::from_pixel(16, 16, Rgba([0, 0, 0, 255]));
        let clip = plan(MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.1, 0.9)],
            fill_rule: MockupClipFillRule::NonZero,
        });
        let error = apply_clip_mask(&mut image, &clip, &|| true).unwrap_err();
        assert_eq!(error.code, worldbend_core::ErrorCode::Cancelled);
    }

    #[test]
    fn independent_regions_union_their_own_rules_and_overlap_once() {
        use worldbend_core::MockupClipRegion;
        let combined = masked(MockupClip {
            contours: vec![
                square_contour(0.1, 0.9),
                square_contour(0.3, 0.7),
                square_contour(0.5, 0.8),
            ],
            fill_rule: MockupClipFillRule::NonZero,
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
        });
        assert_eq!(
            combined[8][6], 0,
            "the uncovered part of the hole remains transparent"
        );
        assert_eq!(
            combined[8][9], 255,
            "the independent region fills part of the hole"
        );
        assert_eq!(combined[12][12], 255, "overlapping regions remain opaque");
        let duplicate = MockupClip {
            contours: vec![square_contour(0.28125, 0.75)],
            fill_rule: MockupClipFillRule::NonZero,
            regions: vec![
                MockupClipRegion {
                    contour_indices: vec![0],
                    fill_rule: MockupClipFillRule::EvenOdd,
                },
                MockupClipRegion {
                    contour_indices: vec![0],
                    fill_rule: MockupClipFillRule::NonZero,
                },
            ],
        };
        let mut single = duplicate.clone();
        single.regions.clear();
        assert_eq!(
            masked(duplicate),
            masked(single),
            "union does not double antialias coverage"
        );
    }

    #[test]
    fn partial_alpha_is_scaled_not_replaced() {
        let mut image = RgbaImage::from_pixel(16, 16, Rgba([10, 20, 30, 128]));
        let clip = plan(MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.25, 0.75)],
            fill_rule: MockupClipFillRule::NonZero,
        });
        apply_clip_mask(&mut image, &clip, &|| false).unwrap();
        // A half-covered column keeps half of the original alpha; fully
        // covered columns keep it all.
        assert_eq!(image.get_pixel(6, 8).0[3], 128);
        assert_eq!(image.get_pixel(6, 8).0[0], 10);
        assert_eq!(image.get_pixel(6, 8).0[1], 20);
        let half = masked(MockupClip {
            regions: Vec::new(),
            contours: vec![square_contour(0.28125, 0.75)],
            fill_rule: MockupClipFillRule::NonZero,
        });
        assert!((half[8][4] as i32 - 128).abs() <= 2, "{}", half[8][4]);
    }
}

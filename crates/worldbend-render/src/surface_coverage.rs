use crate::{CanvasPlacement, PixelCoverage, polygon_centroid};
use worldbend_core::{Homography, Point, TransformResult, polygon_signed_area, transform_point};

/// Index the projected outline once, so full interior pixels do not traverse
/// all surface edges. Only boundary pixels need polygon clipping for exact area.
pub(crate) struct SurfaceCoverage {
    polygon: Vec<Point>,
    rows: Vec<Row>,
}

#[derive(Default)]
struct Row {
    inside: Vec<(f64, f64)>,
    boundary: Vec<(f64, f64)>,
}

impl SurfaceCoverage {
    pub(crate) fn new(
        outline: &[Point],
        homography: &Homography,
        placement: CanvasPlacement,
    ) -> TransformResult<Self> {
        let polygon = outline
            .iter()
            .map(|point| {
                transform_point(homography, *point)
                    .map(|p| Point::new(p.x - placement.origin.x, p.y - placement.origin.y))
            })
            .collect::<TransformResult<Vec<_>>>()?;
        let mut rows = (0..placement.height)
            .map(|_| Row::default())
            .collect::<Vec<_>>();
        for (y, row) in rows.iter_mut().enumerate() {
            let y = y as f64;
            let mut crossings = Vec::new();
            for (a, b) in polygon
                .iter()
                .copied()
                .zip(polygon.iter().copied().cycle().skip(1))
                .take(polygon.len())
            {
                let low = a.y.min(b.y);
                let high = a.y.max(b.y);
                let x_at = |v: f64| a.x + (b.x - a.x) * (v - a.y) / (b.y - a.y);
                if (a.y > y + 0.5) != (b.y > y + 0.5) {
                    crossings.push(x_at(y + 0.5));
                }
                if high < y || low > y + 1.0 {
                    continue;
                }
                let (x1, x2) = if a.y == b.y {
                    (a.x, b.x)
                } else {
                    (x_at(low.max(y)), x_at(high.min(y + 1.0)))
                };
                row.boundary.push((x1.min(x2), x1.max(x2)));
            }
            crossings.sort_by(f64::total_cmp);
            row.inside = crossings
                .chunks_exact(2)
                .map(|pair| (pair[0], pair[1]))
                .collect();
            row.boundary.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut merged: Vec<(f64, f64)> = Vec::new();
            for span in row.boundary.drain(..) {
                if let Some(last) = merged.last_mut().filter(|last| span.0 <= last.1) {
                    last.1 = last.1.max(span.1);
                } else {
                    merged.push(span);
                }
            }
            row.boundary = merged;
        }
        Ok(Self { polygon, rows })
    }

    pub(crate) fn pixel(&self, x: u32, y: u32) -> (PixelCoverage, f64, Point, Option<Point>) {
        let row = &self.rows[y as usize];
        let left = f64::from(x);
        if !row
            .boundary
            .iter()
            .any(|span| span.0 <= left + 1.0 && span.1 >= left)
        {
            let inside = row
                .inside
                .iter()
                .any(|span| span.0 <= left + 0.5 && span.1 >= left + 0.5);
            return (
                if inside {
                    PixelCoverage::Inside
                } else {
                    PixelCoverage::Outside
                },
                if inside { 1.0 } else { 0.0 },
                Point::new(0.5, 0.5),
                None,
            );
        }
        let mut clipped = self
            .polygon
            .iter()
            .map(|p| Point::new(p.x - left, p.y - f64::from(y)))
            .collect::<Vec<_>>();
        for axis in 0..4 {
            let inside = |p: Point| match axis {
                0 => p.x >= 0.0,
                1 => p.x <= 1.0,
                2 => p.y >= 0.0,
                _ => p.y <= 1.0,
            };
            let intersection = |a: Point, b: Point| match axis {
                0 => crate::interpolate_at_x(a, b, 0.0),
                1 => crate::interpolate_at_x(a, b, 1.0),
                2 => crate::interpolate_at_y(a, b, 0.0),
                _ => crate::interpolate_at_y(a, b, 1.0),
            };
            let Some(mut previous) = clipped.last().copied() else {
                break;
            };
            let mut next = Vec::with_capacity(clipped.len() + 4);
            for current in clipped {
                match (inside(previous), inside(current)) {
                    (true, true) => next.push(current),
                    (true, false) => next.push(intersection(previous, current)),
                    (false, true) => {
                        next.push(intersection(previous, current));
                        next.push(current);
                    }
                    (false, false) => {}
                }
                previous = current;
            }
            clipped = next;
        }
        let area = polygon_signed_area(&clipped).abs().clamp(0.0, 1.0);
        if area <= f64::EPSILON {
            return (PixelCoverage::Outside, 0.0, Point::new(0.5, 0.5), None);
        }
        (
            PixelCoverage::Boundary,
            area,
            polygon_centroid(&clipped),
            clipped.first().copied(),
        )
    }
}

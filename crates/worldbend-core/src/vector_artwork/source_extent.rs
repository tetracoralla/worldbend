//! Opt-in source-window enclosure, not an exterior mesh extension or a path
//! approximation. Rounded carrier bounds do not erase complete native paths.
//! Outward interval Bézier hulls enclose the continuous curves; subdivision
//! narrows only the metadata enclosure and shares the artwork's work meter.
use super::*;
use crate::Point;
use crate::vector_projection::cubic_control_points;

#[derive(Clone, Copy)]
struct Interval {
    lo: f64,
    hi: f64,
}
impl Interval {
    fn point(value: f64) -> Self {
        Self {
            lo: value,
            hi: value,
        }
    }
    fn add(self, other: Self) -> Self {
        if other.lo == 0. && other.hi == 0. {
            return self;
        }
        if self.lo == 0. && self.hi == 0. {
            return other;
        }
        Self {
            lo: (self.lo + other.lo).next_down(),
            hi: (self.hi + other.hi).next_up(),
        }
    }
    fn scale(self, value: f64) -> Self {
        if value == 0. {
            return Self::point(0.);
        }
        if value == 1. {
            return self;
        }
        let (lo, hi) = if value > 0. {
            (self.lo * value, self.hi * value)
        } else {
            (self.hi * value, self.lo * value)
        };
        Self {
            lo: lo.next_down(),
            hi: hi.next_up(),
        }
    }
    fn average(self, other: Self) -> Self {
        self.scale(0.5).add(other.scale(0.5))
    }
    fn finite(self) -> bool {
        self.lo.is_finite() && self.hi.is_finite()
    }
}
fn failure(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}
fn split(c: [Interval; 4]) -> ([Interval; 4], [Interval; 4]) {
    let a = c[0].average(c[1]);
    let b = c[1].average(c[2]);
    let d = c[2].average(c[3]);
    let e = a.average(b);
    let f = b.average(d);
    let g = e.average(f);
    ([c[0], a, e, g], [g, f, d, c[3]])
}
fn enclose(
    control: [Interval; 4],
    extent: f64,
    precision: f64,
    depth: u32,
    work: &ProjectionWork,
    extrema: &mut (f64, f64),
) -> TransformResult<()> {
    work.charge(WorkKind::Extent, 1)?;
    if !control.iter().all(|c| c.finite()) {
        return Err(failure("source extent interval is not representable"));
    }
    let lo = control.iter().map(|c| c.lo).fold(f64::INFINITY, f64::min);
    let hi = control
        .iter()
        .map(|c| c.hi)
        .fold(f64::NEG_INFINITY, f64::max);
    if lo >= 0. && hi <= extent {
        return Ok(());
    }
    // Endpoints belong to the curve. The difference between their interval
    // enclosure and the full control hull bounds the excess of this metadata
    // rectangle, without replacing or sampling the authored curve.
    let endpoints_lo = control[0].lo.min(control[3].lo);
    let endpoints_hi = control[0].hi.max(control[3].hi);
    if endpoints_lo - lo <= precision && hi - endpoints_hi <= precision {
        extrema.0 = extrema.0.min(lo);
        extrema.1 = extrema.1.max(hi);
        return Ok(());
    }
    if depth >= 24 {
        return Err(failure(
            "source extent enclosure exceeds its bounded refinement depth",
        ));
    }
    let (left, right) = split(control);
    enclose(left, extent, precision, depth + 1, work, extrema)?;
    enclose(right, extent, precision, depth + 1, work, extrema)
}

pub(super) fn resolve(
    input: &VectorArtworkProjectionInput,
    work: &ProjectionWork,
) -> TransformResult<Bounds> {
    let b = input.source_bounds;
    if ![b.x, b.y, b.width, b.height].iter().all(|v| v.is_finite())
        || b.width <= 0.
        || b.height <= 0.
    {
        return Err(failure("source bounds must be finite with positive extent"));
    }
    let mut x: (f64, f64) = (0., b.width);
    let mut y: (f64, f64) = (0., b.height);
    for part in &input.parts {
        if part.stroke.is_some() {
            return Err(failure(
                "complete source extent requires resolved native stroke outlines",
            ));
        }
        let m = part.source_transform;
        if !m.iter().all(|v| v.is_finite()) {
            return Err(failure("source transform must be finite"));
        }
        let local = |p: Point, axis: usize| {
            let (i, origin) = if axis == 0 { (0, b.x) } else { (3, b.y) };
            // Equal origins cancel exactly. Otherwise enclose subtraction too;
            // a rounded point offset is not an exact affine interval witness.
            let offset = if m[i + 2] == origin || origin == 0. {
                Interval::point(m[i + 2] - origin)
            } else {
                Interval::point(m[i + 2]).add(Interval::point(-origin))
            };
            Interval::point(p.x)
                .scale(m[i])
                .add(Interval::point(p.y).scale(m[i + 1]))
                .add(offset)
        };
        for vertex in &part.path.vertices {
            work.charge(WorkKind::Extent, 1)?;
            let p = Point::new(vertex.x, vertex.y);
            for (axis, extrema) in [(0, &mut x), (1, &mut y)] {
                let range = local(p, axis);
                if !range.finite() {
                    return Err(failure("source extent is not representable"));
                }
                extrema.0 = extrema.0.min(range.lo);
                extrema.1 = extrema.1.max(range.hi);
            }
        }
        for segment in &part.path.segments {
            let control = cubic_control_points(segment, &part.path.vertices);
            for (axis, extent, extrema) in [(0, b.width, &mut x), (1, b.height, &mut y)] {
                work.charge(WorkKind::Extent, 1)?;
                enclose(
                    control.map(|p| local(p, axis)),
                    extent,
                    extent.max(1.) * 1.0e-9,
                    0,
                    work,
                    extrema,
                )?;
            }
        }
    }
    let axis = |origin: f64, extent: f64, (lo, hi): (f64, f64)| {
        if lo == 0. && hi == extent {
            return (origin, extent);
        }
        let first = if lo < 0. {
            (origin + lo).next_down()
        } else {
            origin
        };
        let last = if hi > extent {
            (origin + hi).next_up()
        } else {
            origin + extent
        };
        (first, (last - first).next_up())
    };
    let (new_x, width) = axis(b.x, b.width, x);
    let (new_y, height) = axis(b.y, b.height, y);
    if ![new_x, new_y, width, height].iter().all(|v| v.is_finite()) || width <= 0. || height <= 0. {
        return Err(failure("resolved source extent is not representable"));
    }
    Ok(Bounds {
        x: new_x,
        y: new_y,
        width,
        height,
    })
}

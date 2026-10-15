//! Outline fitting keeps the target triangulation, parameterizes its boundary
//! onto the source square, and solves positive one-ring mean-value coordinates.
//! Resampling this map onto a regular grid can fold a concave outline.
use crate::{
    ErrorCode, MeshBoundary, MockupClipContour, MockupClipSegment, Point, TransformError,
    TransformResult, WarpMesh, WarpMeshTopology, WarpVertex, polygon_signed_area,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

const MAX_BOUNDARY_POINTS: usize = 512;
const CURVE_TOLERANCE: f64 = 1.0 / 1024.0;
const MAX_ITERATIONS: usize = 16_000;
const SOLVE_TOLERANCE: f64 = 1.0e-11;
const EPSILON: f64 = 1.0e-12;
// Leave room for the exact overlay with an authored interior. Boundary curve
// precision is independent of refinement: both passes retain every flattened
// boundary vertex. Dense curved outlines need one pass at ordinary edit grids.
const AUTOMATIC_FIT_VERTICES: usize = 512;
const AUTOMATIC_FIT_TRIANGLES: usize = 768;

/// An authored closed contour in normalized destination-plane coordinates.
/// Corner positions are perimeter fractions in positive winding order, starting
/// at the authored contour's start, and correspond to TL, TR, BR, BL. The four
/// fractions may wrap once. Omission selects four ordered bounding-box landmarks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitControls {
    pub contour: MockupClipContour,
    /// Original compound fill in destination-plane coordinates. Fitting owns
    /// the connected domain; this mask retains holes and independent regions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<crate::MockupClip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub corner_positions: Option<[f64; 4]>,
    /// One or two conforming refinement passes. Omission chooses two for a
    /// compact outline, reserving room for exact composition with later edits.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schemars(range(min = 1, max = 2))]
    pub refinement: Option<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitResolution {
    pub mesh: WarpMesh,
    pub corner_positions: [f64; 4],
    #[schemars(range(min = 1, max = 2))]
    pub refinement: u8,
    #[schemars(range(min = 1, max = 16000))]
    pub iterations: usize,
}

/// Candidate connected domains preserve the original compound clip. A native
/// contour is offered only when it contains every contour; the enclosing
/// control hull contains the complete authored Bezier curves, not just samples.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ShapeFitDomainKind {
    NativeContour,
    ConvexEnvelope,
    Bounds,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitDomain {
    pub kind: ShapeFitDomainKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contour_index: Option<usize>,
    pub contour: MockupClipContour,
}

/// Authored domain choice, independent of the guide's current coordinates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitDomainChoice {
    pub kind: ShapeFitDomainKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contour_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitRefreshInput {
    pub shape_fit: ShapeFitControls,
    pub clip: crate::MockupClip,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<ShapeFitDomainChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ShapeFitRefreshOutput {
    pub shape_fit: ShapeFitControls,
    pub domain: ShapeFitDomainChoice,
}

/// Re-read a bound native guide without replacing the author's domain choice
/// or corner correspondence. Legacy choices are recovered from the old recipe.
pub fn refresh_shape_fit(input: &ShapeFitRefreshInput) -> TransformResult<ShapeFitRefreshOutput> {
    let domain = match &input.domain {
        Some(domain) => domain.clone(),
        None => {
            let old_clip = input.shape_fit.clip.as_ref().ok_or_else(|| {
                invalid("A bound fitting recipe requires its original compound clip")
            })?;
            let old = shape_fit_domains(old_clip)?
                .into_iter()
                .find(|candidate| candidate.contour == input.shape_fit.contour)
                .ok_or_else(|| {
                    invalid("Choose a fitting domain again for this authored boundary")
                })?;
            ShapeFitDomainChoice {
                kind: old.kind,
                contour_index: old.contour_index,
            }
        }
    };
    let next = shape_fit_domains(&input.clip)?
        .into_iter()
        .find(|candidate| candidate.kind == domain.kind && candidate.contour_index == domain.contour_index)
        .ok_or_else(|| invalid("The chosen fitting domain no longer contains the complete guide; choose a domain again"))?;
    let mut shape_fit = input.shape_fit.clone();
    shape_fit.contour = next.contour;
    shape_fit.clip = Some(input.clip.clone());
    // Validate the refreshed map before a carrier can save it. Composition
    // with interior edits remains the ordinary Work planner's responsibility.
    resolve_shape_fit(&shape_fit)?;
    Ok(ShapeFitRefreshOutput { shape_fit, domain })
}

pub fn shape_fit_domains(clip: &crate::MockupClip) -> TransformResult<Vec<ShapeFitDomain>> {
    // Refuse coordinates that cannot form a fitting guide before the shared
    // clip planner spends work flattening their curves.
    for contour in &clip.contours {
        let bounded = |p: Point| {
            p.x.is_finite()
                && p.y.is_finite()
                && (-2.0..=3.0).contains(&p.x)
                && (-2.0..=3.0).contains(&p.y)
        };
        if !bounded(contour.start)
            || contour.segments.iter().any(|segment| match *segment {
                MockupClipSegment::Line { to } => !bounded(to),
                MockupClipSegment::Cubic { c1, c2, to } => ![c1, c2, to].into_iter().all(bounded),
            })
        {
            return Err(invalid(
                "shape fitting authored coordinates must stay within [-2,3]",
            ));
        }
    }
    crate::mockup::plan_clip(clip, crate::Size::new(1024.0, 1024.0))?;
    let flattened: Vec<Vec<Point>> = clip
        .contours
        .iter()
        .map(|contour| {
            crate::flatten_mockup_clip_contour(contour, crate::Size::new(1024.0, 1024.0))
                .into_iter()
                .map(|p| Point::new(p.x / 1024.0, p.y / 1024.0))
                .collect()
        })
        .collect();
    if flattened.iter().flatten().any(|p| {
        !p.x.is_finite()
            || !p.y.is_finite()
            || p.x < -EPSILON
            || p.x > 1.0 + EPSILON
            || p.y < -EPSILON
            || p.y > 1.0 + EPSILON
    }) {
        return Err(invalid(
            "shape fitting mask must stay within the unit square",
        ));
    }
    let mut domains = Vec::new();
    for (index, contour) in clip.contours.iter().enumerate() {
        let Ok(boundary) = flatten(contour) else {
            continue;
        };
        if flattened.iter().enumerate().all(|(other, points)| {
            other == index
                || points
                    .windows(2)
                    .all(|pair| contained_segment(pair[0], pair[1], &boundary))
        }) {
            domains.push(ShapeFitDomain {
                kind: ShapeFitDomainKind::NativeContour,
                contour_index: Some(index),
                contour: contour.clone(),
            });
        }
    }
    let mut controls = Vec::new();
    for contour in &clip.contours {
        controls.push(contour.start);
        for segment in &contour.segments {
            match *segment {
                MockupClipSegment::Line { to } => controls.push(to),
                MockupClipSegment::Cubic { c1, c2, to } => controls.extend([c1, c2, to]),
            }
        }
    }
    // Both the control hull and unit square contain the normalized fill.
    // Their intersection preserves that enclosure even for exterior handles.
    let mut hull = convex_hull(controls);
    for (axis, limit, greater) in [
        (0, 0.0, true),
        (0, 1.0, false),
        (1, 0.0, true),
        (1, 1.0, false),
    ] {
        hull = clip_half_plane(hull, axis, limit, greater);
    }
    if (3..=128).contains(&hull.len()) {
        let contour = polygon_contour(&hull);
        if flatten(&contour).is_ok() {
            domains.push(ShapeFitDomain {
                kind: ShapeFitDomainKind::ConvexEnvelope,
                contour_index: None,
                contour,
            });
        }
    }
    let bounds = polygon_contour(&[
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ]);
    domains.push(ShapeFitDomain {
        kind: ShapeFitDomainKind::Bounds,
        contour_index: None,
        contour: bounds,
    });
    Ok(domains)
}

fn polygon_contour(points: &[Point]) -> MockupClipContour {
    MockupClipContour {
        start: points[0],
        segments: points[1..]
            .iter()
            .map(|&to| MockupClipSegment::Line { to })
            .collect(),
    }
}

fn convex_hull(mut points: Vec<Point>) -> Vec<Point> {
    points.sort_by(|a, b| a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)));
    points.dedup_by(|a, b| *a == *b);
    if points.len() < 3 {
        return points;
    }
    let mut lower = Vec::new();
    for &p in &points {
        while lower.len() >= 2 && area(lower[lower.len() - 2], lower[lower.len() - 1], p) <= EPSILON
        {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper = Vec::new();
    for &p in points.iter().rev() {
        while upper.len() >= 2 && area(upper[upper.len() - 2], upper[upper.len() - 1], p) <= EPSILON
        {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

fn clip_half_plane(points: Vec<Point>, axis: usize, limit: f64, greater: bool) -> Vec<Point> {
    let coordinate = |p: Point| if axis == 0 { p.x } else { p.y };
    let inside = |p: Point| {
        if greater {
            coordinate(p) >= limit
        } else {
            coordinate(p) <= limit
        }
    };
    let mut output = Vec::new();
    for i in 0..points.len() {
        let a = points[i];
        let b = points[(i + 1) % points.len()];
        if inside(a) {
            output.push(a);
        }
        if inside(a) != inside(b) {
            let mut p = mix(
                a,
                b,
                (limit - coordinate(a)) / (coordinate(b) - coordinate(a)),
            );
            if axis == 0 {
                p.x = limit;
            } else {
                p.y = limit;
            }
            output.push(p);
        }
    }
    // A hull corner on a clipping plane must not become a zero-length edge.
    output.dedup_by(|a, b| distance(*a, *b) <= EPSILON);
    if output.len() > 1 && distance(output[0], *output.last().unwrap()) <= EPSILON {
        output.pop();
    }
    output
}

fn contained_point(p: Point, ring: &[Point]) -> bool {
    let mut inside = false;
    for i in 0..ring.len() {
        let a = ring[i];
        let b = ring[(i + 1) % ring.len()];
        if area(a, b, p).abs() <= EPSILON
            && p.x >= a.x.min(b.x) - EPSILON
            && p.x <= a.x.max(b.x) + EPSILON
            && p.y >= a.y.min(b.y) - EPSILON
            && p.y <= a.y.max(b.y) + EPSILON
        {
            return true;
        }
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
    }
    inside
}

fn contained_segment(a: Point, b: Point, ring: &[Point]) -> bool {
    if !contained_point(a, ring) || !contained_point(b, ring) {
        return false;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let length2 = dx * dx + dy * dy;
    if length2 <= EPSILON * EPSILON {
        return true;
    }
    let mut cuts = vec![0.0, 1.0];
    for i in 0..ring.len() {
        let c = ring[i];
        let d = ring[(i + 1) % ring.len()];
        let ex = d.x - c.x;
        let ey = d.y - c.y;
        let cross = dx * ey - dy * ex;
        if cross.abs() > EPSILON {
            let t = ((c.x - a.x) * ey - (c.y - a.y) * ex) / cross;
            let u = ((c.x - a.x) * dy - (c.y - a.y) * dx) / cross;
            if (0.0..=1.0).contains(&t) && (-EPSILON..=1.0 + EPSILON).contains(&u) {
                cuts.push(t);
            }
        } else if area(a, b, c).abs() <= EPSILON {
            for p in [c, d] {
                let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2;
                if (0.0..=1.0).contains(&t) {
                    cuts.push(t);
                }
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    cuts.windows(2)
        .all(|pair| contained_point(mix(a, b, (pair[0] + pair[1]) * 0.5), ring))
}

fn invalid(message: &str) -> TransformError {
    TransformError::new(ErrorCode::Schema, message)
}

fn area(a: Point, b: Point, c: Point) -> f64 {
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5
}

fn distance(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

fn mix(a: Point, b: Point, t: f64) -> Point {
    Point::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

fn append(points: &mut Vec<Point>, point: Point) -> TransformResult<()> {
    if points
        .last()
        .is_none_or(|&last| distance(last, point) > EPSILON)
    {
        if points.len() >= MAX_BOUNDARY_POINTS {
            return Err(invalid(
                "shape fitting exceeds its 512-point flattened boundary",
            ));
        }
        points.push(point);
    }
    Ok(())
}

fn flatten_curve(p: [Point; 4], depth: u8, points: &mut Vec<Point>) -> TransformResult<()> {
    // Distance to the chord segment also catches a collinear curve that
    // overshoots or reverses; distance to the infinite line alone does not.
    let chord_length = distance(p[0], p[3]);
    let deviation = |point: Point| {
        if chord_length <= EPSILON {
            distance(point, p[0])
        } else {
            let dx = p[3].x - p[0].x;
            let dy = p[3].y - p[0].y;
            let t =
                ((point.x - p[0].x) * dx + (point.y - p[0].y) * dy) / (chord_length * chord_length);
            distance(point, mix(p[0], p[3], t.clamp(0.0, 1.0)))
        }
    };
    if deviation(p[1]).max(deviation(p[2])) <= CURVE_TOLERANCE {
        return append(points, p[3]);
    }
    if depth == 12 {
        return Err(invalid(
            "shape fitting curve exceeds its bounded flattening precision",
        ));
    }
    let a = mix(p[0], p[1], 0.5);
    let b = mix(p[1], p[2], 0.5);
    let c = mix(p[2], p[3], 0.5);
    let d = mix(a, b, 0.5);
    let e = mix(b, c, 0.5);
    let middle = mix(d, e, 0.5);
    flatten_curve([p[0], a, d, middle], depth + 1, points)?;
    flatten_curve([middle, e, c, p[3]], depth + 1, points)
}

fn flatten(contour: &MockupClipContour) -> TransformResult<Vec<Point>> {
    if !(2..=crate::MAX_MOCKUP_CLIP_SEGMENTS_PER_CONTOUR).contains(&contour.segments.len()) {
        return Err(invalid(
            "shape fitting contour must contain 2 through 128 segments",
        ));
    }
    let bounded = |p: Point| {
        p.x.is_finite()
            && p.y.is_finite()
            && (-2.0..=3.0).contains(&p.x)
            && (-2.0..=3.0).contains(&p.y)
    };
    if !bounded(contour.start) {
        return Err(invalid(
            "shape fitting authored coordinates must be finite and within [-2,3]",
        ));
    }
    let mut points = vec![contour.start];
    let mut from = contour.start;
    for segment in &contour.segments {
        match *segment {
            MockupClipSegment::Line { to } => {
                if !bounded(to) {
                    return Err(invalid("shape fitting endpoint is out of bounds"));
                }
                append(&mut points, to)?;
                from = to;
            }
            MockupClipSegment::Cubic { c1, c2, to } => {
                if ![c1, c2, to].into_iter().all(bounded) {
                    return Err(invalid("shape fitting curve is out of bounds"));
                }
                flatten_curve([from, c1, c2, to], 0, &mut points)?;
                from = to;
            }
        }
    }
    if distance(points[0], *points.last().expect("start")) <= EPSILON {
        points.pop();
    }
    if points.len() < 3
        || points
            .iter()
            .any(|p| !(0.0..=1.0).contains(&p.x) || !(0.0..=1.0).contains(&p.y))
    {
        return Err(invalid(
            "shape fitting needs a nonempty outline within the unit square",
        ));
    }
    let signed = polygon_signed_area(&points);
    if signed.abs() <= 1.0e-8 {
        return Err(invalid("shape fitting outline covers no bounded area"));
    }
    if signed < 0.0 {
        points[1..].reverse();
    }
    for i in 0..points.len() {
        let a = points[i];
        let b = points[(i + 1) % points.len()];
        let c = points[(i + 2) % points.len()];
        if area(a, b, c).abs() <= EPSILON
            && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0.0
        {
            return Err(invalid("shape fitting boundary doubles back on itself"));
        }
        for j in i + 1..points.len() {
            if j == i + 1 || (i == 0 && j == points.len() - 1) {
                continue;
            }
            if crate::warp::segments_touch(a, b, points[j], points[(j + 1) % points.len()]) {
                return Err(invalid("shape fitting boundary crosses or touches itself"));
            }
        }
    }
    // Three target vertices still need four source-square landmarks. Insert
    // an exact point on the longest edge; no target corner is invented.
    if points.len() == 3 {
        let edge = (0..3)
            .max_by(|&a, &b| {
                distance(points[a], points[(a + 1) % 3])
                    .total_cmp(&distance(points[b], points[(b + 1) % 3]))
            })
            .expect("three edges");
        points.insert(edge + 1, mix(points[edge], points[(edge + 1) % 3], 0.5));
    }
    Ok(points)
}

fn lengths(points: &[Point]) -> (Vec<f64>, f64) {
    let mut cumulative = vec![0.0];
    for i in 0..points.len() {
        cumulative.push(cumulative[i] + distance(points[i], points[(i + 1) % points.len()]));
    }
    let total = *cumulative.last().expect("nonempty boundary");
    (cumulative, total)
}

fn automatic_corners(points: &[Point], cumulative: &[f64], total: f64) -> [f64; 4] {
    let minimum_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
    let maximum_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
    let minimum_y = points.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
    let maximum_y = points.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
    let targets = [
        Point::new(minimum_x, minimum_y),
        Point::new(maximum_x, minimum_y),
        Point::new(maximum_x, maximum_y),
        Point::new(minimum_x, maximum_y),
    ];
    let start = (0..points.len())
        .min_by(|&a, &b| {
            distance(points[a], targets[0]).total_cmp(&distance(points[b], targets[0]))
        })
        .expect("nonempty boundary");
    // Ordered dynamic programming avoids four independent nearest points
    // choosing the same vertex or reversing around a concavity.
    let n = points.len();
    let mut previous = vec![f64::INFINITY; n];
    previous[0] = distance(points[start], targets[0]).powi(2);
    let mut parents = vec![vec![0; n]; 4];
    for corner in 1..4 {
        let mut next = vec![f64::INFINITY; n];
        let mut best = (f64::INFINITY, 0);
        for at in 1..n {
            if previous[at - 1] < best.0 {
                best = (previous[at - 1], at - 1);
            }
            next[at] = best.0 + distance(points[(start + at) % n], targets[corner]).powi(2);
            parents[corner][at] = best.1;
        }
        previous = next;
    }
    let mut at = (3..n)
        .min_by(|&a, &b| previous[a].total_cmp(&previous[b]))
        .expect("four landmarks");
    let mut result = [0.0; 4];
    for corner in (0..4).rev() {
        result[corner] = cumulative[(start + at) % n] / total;
        at = parents[corner][at];
    }
    result
}

fn boundary_sources(
    points: Vec<Point>,
    corners: [f64; 4],
    cumulative: &[f64],
    total: f64,
) -> TransformResult<(Vec<Point>, Vec<Point>)> {
    if corners
        .iter()
        .any(|v| !v.is_finite() || !(0.0..1.0).contains(v))
    {
        return Err(invalid(
            "shape fitting corner positions must be finite perimeter fractions in [0,1)",
        ));
    }
    let gaps =
        std::array::from_fn::<_, 4, _>(|i| (corners[(i + 1) % 4] - corners[i]).rem_euclid(1.0));
    if gaps.iter().any(|&gap| gap <= EPSILON) || (gaps.iter().sum::<f64>() - 1.0).abs() > EPSILON {
        return Err(invalid(
            "shape fitting corners must be four distinct positions in boundary order",
        ));
    }
    let square = [
        Point::new(0.0, 0.0),
        Point::new(1.0, 0.0),
        Point::new(1.0, 1.0),
        Point::new(0.0, 1.0),
    ];
    let mut ring: Vec<(f64, Point)> = points
        .iter()
        .enumerate()
        .map(|(i, &p)| (cumulative[i] / total, p))
        .collect();
    for &fraction in &corners {
        if ring.iter().any(|&(t, _)| (t - fraction).abs() <= EPSILON) {
            continue;
        }
        let length = fraction * total;
        let segment = (0..points.len())
            .find(|&i| length >= cumulative[i] && length < cumulative[i + 1])
            .ok_or_else(|| invalid("shape fitting landmark could not be resolved"))?;
        ring.push((
            fraction,
            mix(
                points[segment],
                points[(segment + 1) % points.len()],
                (length - cumulative[segment]) / (cumulative[segment + 1] - cumulative[segment]),
            ),
        ));
    }
    if ring.len() > MAX_BOUNDARY_POINTS {
        return Err(invalid(
            "shape fitting landmarks exceed the bounded boundary",
        ));
    }
    ring.sort_by(|a, b| {
        (a.0 - corners[0])
            .rem_euclid(1.0)
            .total_cmp(&(b.0 - corners[0]).rem_euclid(1.0))
    });
    let mut target = Vec::with_capacity(ring.len());
    let mut source = Vec::with_capacity(ring.len());
    for (fraction, p) in ring {
        target.push(p);
        if let Some(corner) = corners
            .iter()
            .position(|&t| (t - fraction).abs() <= EPSILON)
        {
            source.push(square[corner]);
            continue;
        }
        let relative = (fraction - corners[0]).rem_euclid(1.0);
        let mut start = 0.0;
        for side in 0..4 {
            if relative < start + gaps[side] || side == 3 {
                source.push(mix(
                    square[side],
                    square[(side + 1) % 4],
                    (relative - start) / gaps[side],
                ));
                break;
            }
            start += gaps[side];
        }
    }
    Ok((target, source))
}

fn triangulate(points: &[Point]) -> TransformResult<Vec<[u16; 3]>> {
    let mut remaining: Vec<_> = (0..points.len()).collect();
    let mut triangles = Vec::with_capacity(points.len() - 2);
    while remaining.len() > 3 {
        let mut ear = None;
        for at in 0..remaining.len() {
            let a = remaining[(at + remaining.len() - 1) % remaining.len()];
            let b = remaining[at];
            let c = remaining[(at + 1) % remaining.len()];
            if area(points[a], points[b], points[c]) <= EPSILON {
                continue;
            }
            if remaining.iter().copied().any(|p| {
                p != a
                    && p != b
                    && p != c
                    && area(points[a], points[b], points[p]) >= -EPSILON
                    && area(points[b], points[c], points[p]) >= -EPSILON
                    && area(points[c], points[a], points[p]) >= -EPSILON
            }) {
                continue;
            }
            ear = Some((at, [a as u16, b as u16, c as u16]));
            break;
        }
        let Some((at, triangle)) = ear else {
            return Err(invalid(
                "shape fitting could not triangulate its simple boundary",
            ));
        };
        triangles.push(triangle);
        remaining.remove(at);
    }
    if area(
        points[remaining[0]],
        points[remaining[1]],
        points[remaining[2]],
    ) <= EPSILON
    {
        return Err(invalid(
            "shape fitting triangulation collapses at the boundary",
        ));
    }
    triangles.push([
        remaining[0] as u16,
        remaining[1] as u16,
        remaining[2] as u16,
    ]);
    Ok(triangles)
}

/// Improve the target triangulation, preserving every authored boundary edge.
/// Ear clipping is a topology seed: long fans along rounded corners otherwise
/// make the positive-weight embedding needlessly ill-conditioned. Deterministic
/// Lawson flips give local Delaunay edges before parameterization/refinement.
fn improve_triangulation(
    points: &[Point],
    triangles: &mut [[u16; 3]],
    boundary_sources: Option<(&[Point], &BTreeSet<usize>)>,
) -> TransformResult<()> {
    type Adjacent = (usize, u16, u16, u16);
    for _ in 0..128 {
        let mut edges = BTreeMap::<(u16, u16), Vec<Adjacent>>::new();
        for (face, &[a, b, c]) in triangles.iter().enumerate() {
            for (u, v, w) in [(a, b, c), (b, c, a), (c, a, b)] {
                edges
                    .entry((u.min(v), u.max(v)))
                    .or_default()
                    .push((face, u, v, w));
            }
        }
        let mut changed = false;
        let mut used = BTreeSet::new();
        for adjacent in edges.values().filter(|a| a.len() == 2) {
            let (first, u, v, w) = adjacent[0];
            let (second, _, _, z) = adjacent[1];
            if used.contains(&first) || used.contains(&second) {
                continue;
            }
            let [pu, pv, pw, pz] = [u, v, w, z].map(|i| points[usize::from(i)]);
            // The new diagonal must stay inside the two-face convex region.
            if area(pw, pu, pz) <= EPSILON || area(pw, pz, pv) <= EPSILON {
                continue;
            }
            // Boundary source vertices on one square side are intentionally
            // collinear. Do not create an all-fixed ear there: no interior
            // solve could give such a face nonzero source area.
            let candidates = [[w, u, z], [w, z, v]];
            if boundary_sources.is_some_and(|(sources, fixed)| {
                candidates.iter().any(|face| {
                    face.iter().all(|&i| fixed.contains(&usize::from(i))) && {
                        let [a, b, c] = face.map(|i| sources[usize::from(i)]);
                        area(a, b, c) <= EPSILON
                    }
                })
            }) {
                continue;
            }
            let a = Point::new(pu.x - pz.x, pu.y - pz.y);
            let b = Point::new(pv.x - pz.x, pv.y - pz.y);
            let c = Point::new(pw.x - pz.x, pw.y - pz.y);
            let aa = a.x * a.x + a.y * a.y;
            let bb = b.x * b.x + b.y * b.y;
            let cc = c.x * c.x + c.y * c.y;
            let determinant = aa * (b.x * c.y - b.y * c.x) - bb * (a.x * c.y - a.y * c.x)
                + cc * (a.x * b.y - a.y * b.x);
            let scale = aa.max(bb).max(cc);
            // Co-circular edges retain their stable seed order. A relative
            // guard prevents numerical flips cycling near the same circle.
            if determinant <= 1e-12 * scale * scale {
                continue;
            }
            triangles[first] = candidates[0];
            triangles[second] = candidates[1];
            used.extend([first, second]);
            changed = true;
        }
        if !changed {
            return Ok(());
        }
    }
    Err(invalid(
        "shape fitting triangulation did not converge within its bounded edge flips",
    ))
}

fn refine(
    target: &mut Vec<Point>,
    source: &mut Vec<Point>,
    triangles: &mut Vec<[u16; 3]>,
    boundary: &mut BTreeSet<(u16, u16)>,
    fixed: &mut BTreeSet<usize>,
) -> TransformResult<()> {
    let edge = |a: u16, b: u16| (a.min(b), a.max(b));
    let edges: BTreeSet<_> = triangles
        .iter()
        .flat_map(|&[a, b, c]| [edge(a, b), edge(b, c), edge(c, a)])
        .collect();
    crate::warp_topology::check_size(
        target.len() + edges.len() + triangles.len(),
        triangles.len() * 6,
    )?;
    let mut midpoints = BTreeMap::new();
    let mut next_boundary = BTreeSet::new();
    for &(a, b) in &edges {
        let vertex = target.len() as u16;
        target.push(mix(target[usize::from(a)], target[usize::from(b)], 0.5));
        source.push(mix(source[usize::from(a)], source[usize::from(b)], 0.5));
        midpoints.insert((a, b), vertex);
        if boundary.contains(&(a, b)) {
            fixed.insert(usize::from(vertex));
            next_boundary.extend([edge(a, vertex), edge(vertex, b)]);
        }
    }
    let mut next = Vec::with_capacity(triangles.len() * 6);
    for &[a, b, c] in triangles.iter() {
        let ab = midpoints[&edge(a, b)];
        let bc = midpoints[&edge(b, c)];
        let ca = midpoints[&edge(c, a)];
        let centroid = |points: &[Point]| {
            Point::new(
                (points[usize::from(a)].x + points[usize::from(b)].x + points[usize::from(c)].x)
                    / 3.0,
                (points[usize::from(a)].y + points[usize::from(b)].y + points[usize::from(c)].y)
                    / 3.0,
            )
        };
        let g = target.len() as u16;
        target.push(centroid(target));
        source.push(centroid(source));
        next.extend([
            [a, ab, g],
            [ab, b, g],
            [b, bc, g],
            [bc, c, g],
            [c, ca, g],
            [ca, a, g],
        ]);
    }
    *triangles = next;
    *boundary = next_boundary;
    Ok(())
}

fn solve(
    target: &[Point],
    source: &mut [Point],
    triangles: &[[u16; 3]],
    fixed: &BTreeSet<usize>,
) -> TransformResult<usize> {
    let mut weights = vec![BTreeMap::<usize, f64>::new(); target.len()];
    for &[a, b, c] in triangles {
        for (i, left, right) in [(a, b, c), (b, c, a), (c, a, b)] {
            let (i, left, right) = (usize::from(i), usize::from(left), usize::from(right));
            if fixed.contains(&i) {
                continue;
            }
            let u = Point::new(target[left].x - target[i].x, target[left].y - target[i].y);
            let v = Point::new(target[right].x - target[i].x, target[right].y - target[i].y);
            let lu = u.x.hypot(u.y);
            let lv = v.x.hypot(v.y);
            let dot = u.x * v.x + u.y * v.y;
            let cross = (u.x * v.y - u.y * v.x).abs();
            let half = if dot >= 0.0 {
                cross / (lu * lv + dot)
            } else {
                (lu * lv - dot) / cross
            };
            for (j, length) in [(left, lu), (right, lv)] {
                let value = half / length;
                if !value.is_finite() || value <= 0.0 {
                    return Err(invalid(
                        "shape fitting mean-value weights are ill-conditioned",
                    ));
                }
                *weights[i].entry(j).or_default() += value;
            }
        }
    }
    let mut rows = Vec::new();
    for (i, row) in weights
        .iter()
        .enumerate()
        .filter(|(i, _)| !fixed.contains(i))
    {
        let total: f64 = row.values().sum();
        if !total.is_finite() || total <= 0.0 {
            return Err(invalid("shape fitting contains an unconnected interior"));
        }
        rows.push((
            i,
            row.iter()
                .map(|(&j, &weight)| (j, weight / total))
                .collect::<Vec<_>>(),
        ));
    }
    for iteration in 1..=MAX_ITERATIONS {
        let mut maximum = 0.0_f64;
        for (i, row) in &rows {
            let mut value = Point::new(0.0, 0.0);
            for &(j, w) in row {
                value.x += source[j].x * w;
                value.y += source[j].y * w;
            }
            maximum = maximum.max(distance(source[*i], value));
            source[*i] = value;
        }
        if maximum <= SOLVE_TOLERANCE {
            // Check the equation residual after the complete sweep, rather
            // than relying only on the last update's small displacement.
            let residual = rows
                .iter()
                .map(|(i, row)| {
                    let value = row.iter().fold(Point::new(0.0, 0.0), |p, &(j, w)| {
                        Point::new(p.x + source[j].x * w, p.y + source[j].y * w)
                    });
                    distance(source[*i], value)
                })
                .fold(0.0_f64, f64::max);
            if residual <= SOLVE_TOLERANCE {
                return Ok(iteration);
            }
        }
    }
    Err(invalid(
        "shape fitting did not converge within its bounded solve",
    ))
}

pub fn resolve_shape_fit(controls: &ShapeFitControls) -> TransformResult<ShapeFitResolution> {
    if controls.refinement.is_some_and(|n| !(1..=2).contains(&n)) {
        return Err(invalid(
            "shape fitting refinement must be one or two passes",
        ));
    }
    let points = flatten(&controls.contour)?;
    let (cumulative, total) = lengths(&points);
    let corners = controls
        .corner_positions
        .unwrap_or_else(|| automatic_corners(&points, &cumulative, total));
    let (mut target, mut source) = boundary_sources(points, corners, &cumulative, total)?;
    let n = target.len();
    let mut triangles = triangulate(&target)?;
    improve_triangulation(&target, &mut triangles, None)?;
    let refinement = controls.refinement.unwrap_or(
        if triangles.len() * 36 <= AUTOMATIC_FIT_TRIANGLES
            && (triangles.len() * 36 + n * 4) / 2 < AUTOMATIC_FIT_VERTICES
        {
            2
        } else {
            1
        },
    );
    let mut fixed: BTreeSet<_> = (0..n).collect();
    let mut boundary: BTreeSet<_> = (0..n)
        .map(|i| {
            let a = i as u16;
            let b = ((i + 1) % n) as u16;
            (a.min(b), a.max(b))
        })
        .collect();
    for _ in 0..refinement {
        refine(
            &mut target,
            &mut source,
            &mut triangles,
            &mut boundary,
            &mut fixed,
        )?;
        improve_triangulation(&target, &mut triangles, Some((&source, &fixed)))?;
    }
    let iterations = solve(&target, &mut source, &triangles, &fixed)?;
    let mesh = WarpMesh {
        topology: WarpMeshTopology::Triangles { triangles },
        vertices: source
            .into_iter()
            .zip(target)
            .map(|(source, warped)| WarpVertex { source, warped })
            .collect(),
        boundary: MeshBoundary::Free,
        shading: None,
    };
    mesh.validate_with_context("shape fitting")?;
    Ok(ShapeFitResolution {
        mesh,
        corner_positions: corners,
        refinement,
        iterations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outline(points: &[(f64, f64)]) -> ShapeFitControls {
        ShapeFitControls {
            contour: MockupClipContour {
                start: Point::new(points[0].0, points[0].1),
                segments: points[1..]
                    .iter()
                    .map(|&(x, y)| MockupClipSegment::Line {
                        to: Point::new(x, y),
                    })
                    .collect(),
            },
            clip: None,
            corner_positions: None,
            refinement: None,
        }
    }

    fn l_shape() -> ShapeFitControls {
        outline(&[
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, 1.0 / 3.0),
            (0.6875, 1.0 / 3.0),
            (0.6875, 1.0),
            (0.0, 1.0),
        ])
    }

    fn domain_contour(points: &[(f64, f64)]) -> MockupClipContour {
        polygon_contour(
            &points
                .iter()
                .map(|&(x, y)| Point::new(x, y))
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn bound_guide_refresh_preserves_choice_landmarks_and_all_mask_parts() {
        let outer = l_shape().contour;
        let hole = domain_contour(&[(0.1, 0.6), (0.3, 0.6), (0.3, 0.8), (0.1, 0.8)]);
        let original = crate::MockupClip {
            contours: vec![hole, outer.clone()],
            fill_rule: crate::MockupClipFillRule::EvenOdd,
            regions: vec![],
        };
        let fit = ShapeFitControls {
            contour: outer,
            clip: Some(original.clone()),
            corner_positions: Some([0.01, 0.25, 0.578125, 0.75]),
            refinement: Some(1),
        };
        let mut clip = original.clone();
        clip.contours[1].segments[2] = MockupClipSegment::Line {
            to: Point::new(0.6, 1.0 / 3.0),
        };
        clip.contours[1].segments[3] = MockupClipSegment::Line {
            to: Point::new(0.6, 1.0),
        };
        let refreshed = refresh_shape_fit(&ShapeFitRefreshInput {
            shape_fit: fit.clone(),
            clip: clip.clone(),
            domain: None,
        })
        .unwrap();
        assert_eq!(
            refreshed.domain,
            ShapeFitDomainChoice {
                kind: ShapeFitDomainKind::NativeContour,
                contour_index: Some(1)
            }
        );
        assert_eq!(refreshed.shape_fit.contour, clip.contours[1]);
        assert_eq!(refreshed.shape_fit.clip, Some(clip.clone()));
        assert_eq!(refreshed.shape_fit.corner_positions, fit.corner_positions);
        assert_eq!(refreshed.shape_fit.refinement, fit.refinement);
        clip.contours.push(domain_contour(&[
            (0.8, 0.7),
            (0.95, 0.7),
            (0.95, 0.9),
            (0.8, 0.9),
        ]));
        assert!(
            refresh_shape_fit(&ShapeFitRefreshInput {
                shape_fit: fit.clone(),
                clip: clip.clone(),
                domain: Some(refreshed.domain)
            })
            .is_err()
        );
        let enclosed = refresh_shape_fit(&ShapeFitRefreshInput {
            shape_fit: fit,
            clip: clip.clone(),
            domain: Some(ShapeFitDomainChoice {
                kind: ShapeFitDomainKind::ConvexEnvelope,
                contour_index: None,
            }),
        })
        .unwrap();
        assert_eq!(enclosed.shape_fit.clip, Some(clip));
        assert_eq!(original.contours.len(), 2);
    }

    #[test]
    fn domains_keep_outer_curves_holes_and_independent_parts() {
        let outer = domain_contour(&[
            (0.0, 0.0),
            (1.0, 0.0),
            (1.0, 0.4),
            (0.4, 0.4),
            (0.4, 1.0),
            (0.0, 1.0),
        ]);
        let hole = domain_contour(&[(0.1, 0.6), (0.3, 0.6), (0.3, 0.8), (0.1, 0.8)]);
        let mut clip = crate::MockupClip {
            contours: vec![hole, outer.clone()],
            fill_rule: crate::MockupClipFillRule::EvenOdd,
            regions: vec![],
        };
        let before = clip.clone();
        let domains = shape_fit_domains(&clip).unwrap();
        assert_eq!(domains[0].kind, ShapeFitDomainKind::NativeContour);
        assert_eq!(domains[0].contour_index, Some(1));
        assert_eq!(domains[0].contour, outer);
        assert_eq!(clip, before);
        clip.contours.push(domain_contour(&[
            (0.7, 0.7),
            (0.9, 0.7),
            (0.9, 0.9),
            (0.7, 0.9),
        ]));
        let domains = shape_fit_domains(&clip).unwrap();
        assert!(
            !domains
                .iter()
                .any(|domain| domain.kind == ShapeFitDomainKind::NativeContour)
        );
        assert_eq!(domains[0].kind, ShapeFitDomainKind::ConvexEnvelope);
        resolve_shape_fit(&ShapeFitControls {
            contour: domains[0].contour.clone(),
            clip: Some(clip),
            corner_positions: None,
            refinement: None,
        })
        .unwrap();
    }

    #[test]
    fn convex_domain_encloses_curves_with_exterior_control_handles() {
        let curved = MockupClipContour {
            start: Point::new(0.5, 0.0),
            segments: vec![
                MockupClipSegment::Cubic {
                    c1: Point::new(1.2, 0.0),
                    c2: Point::new(0.8, 1.0),
                    to: Point::new(0.5, 1.0),
                },
                MockupClipSegment::Cubic {
                    c1: Point::new(0.2, 1.0),
                    c2: Point::new(-0.2, 0.0),
                    to: Point::new(0.5, 0.0),
                },
            ],
        };
        let clip = crate::MockupClip {
            contours: vec![curved.clone()],
            fill_rule: crate::MockupClipFillRule::NonZero,
            regions: vec![],
        };
        let domains = shape_fit_domains(&clip).unwrap();
        let hull = &domains
            .iter()
            .find(|domain| domain.kind == ShapeFitDomainKind::ConvexEnvelope)
            .unwrap()
            .contour;
        let ring = flatten(hull).unwrap();
        for segment in &curved.segments {
            if let MockupClipSegment::Cubic { c1, c2, to } = *segment {
                let from = if to.y == 1.0 {
                    curved.start
                } else {
                    Point::new(0.5, 1.0)
                };
                for i in 0..=1000 {
                    let t = f64::from(i) / 1000.0;
                    let a = mix(from, c1, t);
                    let b = mix(c1, c2, t);
                    let c = mix(c2, to, t);
                    assert!(contained_point(mix(mix(a, b, t), mix(b, c, t), t), &ring));
                }
            }
        }
    }

    #[test]
    fn domain_containment_checks_entire_segments_and_rejects_excess_masks() {
        let boundary = vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.6, 1.0),
            Point::new(0.6, 0.4),
            Point::new(0.4, 0.4),
            Point::new(0.4, 1.0),
            Point::new(0.0, 1.0),
        ];
        assert!(!contained_segment(
            Point::new(0.2, 0.8),
            Point::new(0.9, 0.8),
            &boundary
        ));
        let contour = domain_contour(&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]);
        let clip = crate::MockupClip {
            contours: vec![contour; 9],
            fill_rule: crate::MockupClipFillRule::NonZero,
            regions: vec![],
        };
        assert!(shape_fit_domains(&clip).is_err());
    }

    #[test]
    fn fits_concave_outlines_without_the_folds_from_regular_grid_resampling() {
        let cases = [
            l_shape(),
            outline(&[
                (0.0, 0.0),
                (1.0, 0.0),
                (1.0, 0.25),
                (0.3, 0.25),
                (0.3, 0.75),
                (1.0, 0.75),
                (1.0, 1.0),
                (0.0, 1.0),
            ]),
            outline(&[
                (0.0, 0.0),
                (0.3, 0.0),
                (0.3, 0.65),
                (0.7, 0.65),
                (0.7, 0.0),
                (1.0, 0.0),
                (1.0, 1.0),
                (0.0, 1.0),
            ]),
        ];
        for controls in cases {
            let before = controls.clone();
            let resolved = resolve_shape_fit(&controls).unwrap();
            assert_eq!(controls, before);
            assert!(resolved.mesh.grid_subdivisions().is_none());
            assert_eq!(resolved.refinement, 2);
            assert!(resolved.iterations < MAX_ITERATIONS);
            resolved.mesh.validate().unwrap();
            let triangle_area: f64 = resolved
                .mesh
                .triangle_indices()
                .unwrap()
                .iter()
                .map(|face| {
                    let [a, b, c] = face.map(|i| resolved.mesh.vertices[i].warped);
                    area(a, b, c)
                })
                .sum();
            let boundary = flatten(&controls.contour).unwrap();
            assert!((triangle_area - polygon_signed_area(&boundary)).abs() < 1e-10);
            assert_eq!(resolve_shape_fit(&controls).unwrap(), resolved);
            // Saving the original curve recipe reproduces the same geometry;
            // generated mesh coordinates are not substituted for authoring.
            let saved = serde_json::to_string(&controls).unwrap();
            let reopened: ShapeFitControls = serde_json::from_str(&saved).unwrap();
            assert_eq!(resolve_shape_fit(&reopened).unwrap(), resolved);
        }
    }

    #[test]
    fn preserves_affine_artwork_in_a_rectangular_target() {
        for (x, y, w, h) in [(0.0, 0.0, 1.0, 1.0), (0.1, 0.2, 0.7, 0.6)] {
            let controls = outline(&[(x, y), (x + w, y), (x + w, y + h), (x, y + h)]);
            let resolved = resolve_shape_fit(&controls).unwrap();
            for vertex in resolved.mesh.vertices {
                assert!((vertex.warped.x - (x + vertex.source.x * w)).abs() < 1e-9);
                assert!((vertex.warped.y - (y + vertex.source.y * h)).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn accepts_triangle_and_reversed_native_winding() {
        let triangle = outline(&[(0.0, 0.0), (1.0, 0.0), (0.5, 1.0)]);
        let resolved = resolve_shape_fit(&triangle).unwrap();
        resolved.mesh.validate().unwrap();
        let clockwise = l_shape();
        let mut points = flatten(&clockwise.contour).unwrap();
        points[1..].reverse();
        let reversed = outline(&points.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>());
        assert_eq!(
            resolve_shape_fit(&clockwise).unwrap().mesh,
            resolve_shape_fit(&reversed).unwrap().mesh
        );
    }

    #[test]
    fn retains_curves_and_explicit_landmarks_in_the_saved_recipe() {
        let mut controls = outline(&[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]);
        controls.contour.segments[1] = MockupClipSegment::Cubic {
            c1: Point::new(0.75, 0.3),
            c2: Point::new(0.75, 0.7),
            to: Point::new(1.0, 1.0),
        };
        let resolved = resolve_shape_fit(&controls).unwrap();
        assert!(resolved.mesh.vertices.len() > 49);
        assert!(matches!(
            controls.contour.segments[1],
            MockupClipSegment::Cubic { .. }
        ));
        controls.corner_positions = Some([0.01, 0.24, 0.51, 0.78]);
        let edited = resolve_shape_fit(&controls).unwrap();
        assert_ne!(resolved.mesh, edited.mesh);
        assert_eq!(edited.corner_positions, controls.corner_positions.unwrap());
    }

    #[test]
    fn fits_native_rounded_corners_without_degenerate_uv_ears() {
        let r = 0.15;
        let k = 0.552_284_749_830_793_6 * r;
        let controls = ShapeFitControls {
            contour: MockupClipContour {
                start: Point::new(0.0, r),
                segments: vec![
                    MockupClipSegment::Cubic {
                        c1: Point::new(0.0, r - k),
                        c2: Point::new(r - k, 0.0),
                        to: Point::new(r, 0.0),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(1.0 - r, 0.0),
                    },
                    MockupClipSegment::Cubic {
                        c1: Point::new(1.0 - r + k, 0.0),
                        c2: Point::new(1.0, r - k),
                        to: Point::new(1.0, r),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(1.0, 1.0 - r),
                    },
                    MockupClipSegment::Cubic {
                        c1: Point::new(1.0, 1.0 - r + k),
                        c2: Point::new(1.0 - r + k, 1.0),
                        to: Point::new(1.0 - r, 1.0),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(r, 1.0),
                    },
                    MockupClipSegment::Cubic {
                        c1: Point::new(r - k, 1.0),
                        c2: Point::new(0.0, 1.0 - r + k),
                        to: Point::new(0.0, 1.0 - r),
                    },
                    MockupClipSegment::Line {
                        to: Point::new(0.0, r),
                    },
                ],
            },
            clip: None,
            corner_positions: None,
            refinement: None,
        };
        let resolved = resolve_shape_fit(&controls).unwrap();
        assert_eq!(resolved.refinement, 1);
        resolved.mesh.validate().unwrap();
        // Rounded symmetric artwork should not acquire an arbitrary directional
        // squeeze from a triangulation fan. The center stays centered.
        let center =
            crate::mockup_surface::sample_mesh(&resolved.mesh, Point::new(0.5, 0.5)).unwrap();
        assert!(distance(center, Point::new(0.5, 0.5)) < 0.01, "{center:?}");
        // A rounded result must remain editable at all ordinary grid densities,
        // without reducing the user's density or flattening away the curve.
        for n in [4_u16, 8, 12, 16] {
            let side = usize::from(n) + 1;
            let mut interior = WarpMesh {
                topology: WarpMeshTopology::Grid { subdivisions: n },
                boundary: MeshBoundary::Fixed,
                shading: None,
                vertices: (0..=n)
                    .flat_map(|y| {
                        (0..=n).map(move |x| {
                            let p = Point::new(
                                f64::from(x) / f64::from(n),
                                f64::from(y) / f64::from(n),
                            );
                            WarpVertex {
                                source: p,
                                warped: p,
                            }
                        })
                    })
                    .collect(),
            };
            interior.vertices[usize::from(n / 2) * side + usize::from(n / 2)].warped =
                Point::new(0.52, 0.49);
            let composed =
                crate::shape_fit_composition::compose_shape_fit(&interior, &resolved.mesh)
                    .unwrap_or_else(|e| panic!("rounded fit at density {n}: {e:?}"));
            for y in 1..10 {
                for x in 1..10 {
                    let p = Point::new(f64::from(x) / 10.0, f64::from(y) / 10.0);
                    let before_fit = crate::mockup_surface::sample_mesh(&interior, p).unwrap();
                    let expected =
                        crate::mockup_surface::sample_mesh(&resolved.mesh, before_fit).unwrap();
                    let actual = crate::mockup_surface::sample_mesh(&composed, p).unwrap();
                    assert!(distance(actual, expected) < 1e-8, "density {n}, {p:?}");
                }
            }
        }
    }

    #[test]
    fn rejects_invalid_boundary_landmarks_and_resource_requests_before_solving() {
        let mut unknown = serde_json::to_value(l_shape()).unwrap();
        unknown["contour"]["segments"][0]["unexpected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ShapeFitControls>(unknown).is_err());
        for mut controls in [
            outline(&[(0.0, 0.0), (1.0, 1.0), (1.0, 0.0), (0.0, 1.0)]),
            outline(&[(0.0, 0.0), (1.0, 0.0), (0.5, 0.0), (1.0, 1.0), (0.0, 1.0)]),
            outline(&[(0.0, 0.0), (1.1, 0.0), (1.0, 1.0), (0.0, 1.0)]),
        ] {
            assert_eq!(
                resolve_shape_fit(&controls).unwrap_err().code,
                ErrorCode::Schema
            );
            controls.contour.start.x = f64::NAN;
            assert_eq!(
                resolve_shape_fit(&controls).unwrap_err().code,
                ErrorCode::Schema
            );
        }
        for corners in [
            [0.0, 0.0, 0.5, 0.75],
            [0.0, 0.5, 0.25, 0.75],
            [0.0, 0.25, 0.5, 1.0],
            [0.0, 0.25, 0.5, f64::INFINITY],
        ] {
            let mut controls = l_shape();
            controls.corner_positions = Some(corners);
            assert_eq!(
                resolve_shape_fit(&controls).unwrap_err().code,
                ErrorCode::Schema
            );
        }
        let mut controls = l_shape();
        controls.refinement = Some(3);
        assert_eq!(
            resolve_shape_fit(&controls).unwrap_err().code,
            ErrorCode::Schema
        );
        controls.refinement = None;
        controls.contour.segments = vec![
            MockupClipSegment::Line {
                to: Point::new(1.0, 0.0)
            };
            129
        ];
        assert_eq!(
            resolve_shape_fit(&controls).unwrap_err().code,
            ErrorCode::Schema
        );
    }
}

//! Vector boundaries through the same validated piecewise-affine mesh as
//! raster execution. No smooth-surface model or sampled error certificate.
use super::mesh_index::MeshIndex;
use super::*;
use crate::mesh_coordinates::{
    MeshCoordinateMap, blend, contains, linear_combination_abs_bound, orientation,
    orientation_value, weights,
};
use std::cell::Cell;

const MAX_FACE_VISITS: usize = 8_000_000;
const MAX_CURVE_DEPTH: u32 = 24;

pub(crate) struct MeshProjection<'a> {
    work: Option<&'a ProjectionWork>,
    map: MeshCoordinateMap,
    face_index: MeshIndex,
    edge_index: MeshIndex,
    visits: Cell<usize>,
    pub(super) scale: f64,
    pub(super) identity: bool,
}

fn unit_bounds() -> Bounds {
    Bounds {
        x: 0.0,
        y: 0.0,
        width: 1.0,
        height: 1.0,
    }
}

fn domain(point: Point) -> TransformResult<()> {
    if !point.x.is_finite()
        || !point.y.is_finite()
        || !(0.0..=1.0).contains(&point.x)
        || !(0.0..=1.0).contains(&point.y)
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "vector boundary leaves the canonical mesh source domain",
        ));
    }
    Ok(())
}

impl<'a> MeshProjection<'a> {
    pub(crate) fn new(mesh: &WarpMesh, linear: &ProjectionFrame<'a>) -> TransformResult<Self> {
        let map = MeshCoordinateMap::new(mesh)?;
        if mesh
            .shading
            .as_ref()
            .is_some_and(|shading| shading.iter().any(|value| *value != 1.0))
        {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "vector projection does not represent mesh shading",
            ));
        }
        let identity = mesh
            .vertices
            .iter()
            .all(|vertex| vertex.source == vertex.warped);
        // Validate identity topology/shading, then leave legacy projection
        // entirely intact, including its geometry-local horizon acceptance.
        if identity {
            return Ok(Self {
                map,
                face_index: MeshIndex::default(),
                edge_index: MeshIndex::default(),
                work: linear.work,
                visits: Cell::new(0),
                scale: 1.0,
                identity: true,
            });
        }
        let mut maximum_jacobian = 0.0_f64;
        for face in map.faces() {
            let [a, b, c] = face.source;
            let [u, v, w] = face.target;
            let determinant = orientation_value(a, b, c);
            // Mixed source/target coordinates express each derivative as
            // an orient2d determinant without first rounding differences.
            // The admitted indexed sliver floor makes ordinary multiply-
            // subtract estimates inadequate for a conservative error scale.
            let j00 = orientation_value(
                Point::new(u.x, a.y),
                Point::new(v.x, b.y),
                Point::new(w.x, c.y),
            ) / determinant;
            let j01 = orientation_value(
                Point::new(a.x, u.x),
                Point::new(b.x, v.x),
                Point::new(c.x, w.x),
            ) / determinant;
            let j10 = orientation_value(
                Point::new(u.y, a.y),
                Point::new(v.y, b.y),
                Point::new(w.y, c.y),
            ) / determinant;
            let j11 = orientation_value(
                Point::new(a.x, u.y),
                Point::new(b.x, v.y),
                Point::new(c.x, w.y),
            ) / determinant;
            let matrix = [
                j00,
                j01,
                u.x - j00 * a.x - j01 * a.y,
                j10,
                j11,
                u.y - j10 * a.x - j11 * a.y,
            ];
            if matrix.iter().any(|value| !value.is_finite()) {
                return Err(TransformError::new(
                    ErrorCode::Schema,
                    "mesh face affine map is not representable",
                ));
            }
            maximum_jacobian = maximum_jacobian.max(spectral_norm(j00, j01, j10, j11));
        }
        let points: Vec<Point> = mesh.vertices.iter().map(|vertex| vertex.warped).collect();
        let normalized = ProjectionFrame {
            transform: [1., 0., 0., 0., 1., 0.],
            bounds: unit_bounds(),
            mesh: None,
            ..*linear
        };
        // H's derivative is bounded over the hull of ALL warped vertices,
        // not the original path hull. M is continuous on the source square;
        // max face Jacobian is a global Lipschitz bound there. Multiplication
        // includes placement pixels. Conservative rounding slack never
        // consumes the caller's entire budget (acceptance also reserves slack).
        let scale = maximum_jacobian
            * normalized.compute_scale_over_normalized_points(&points)?
            * (1.0 + 1.0e-12);
        if !scale.is_finite() || scale <= 0.0 {
            return Err(TransformError::new(
                ErrorCode::HomographySingular,
                "mesh vector projection scale is not representable",
            ));
        }
        let face_index = MeshIndex::new(
            map.faces().iter().map(|face| face.source.to_vec()),
            linear.work,
        )?;
        let edge_index = MeshIndex::new(map.edges().iter().map(|edge| edge.to_vec()), linear.work)?;
        Ok(Self {
            map,
            face_index,
            edge_index,
            work: linear.work,
            visits: Cell::new(0),
            scale,
            identity,
        })
    }

    fn visit(&self) -> TransformResult<()> {
        if let Some(work) = self.work {
            work.charge(WorkKind::Face, 1)?;
        }
        let next = self.visits.get() + 1;
        if next > MAX_FACE_VISITS {
            return Err(complexity_error("mesh face visits", next, MAX_FACE_VISITS));
        }
        self.visits.set(next);
        Ok(())
    }

    pub(super) fn map_point(&self, point: Point) -> TransformResult<Point> {
        domain(point)?;
        for index in self.face_index.candidates(&[point], &|| self.visit())? {
            let face = &self.map.faces()[index];
            self.visit()?;
            if contains(face.source, point) {
                return Ok(blend(face.target, weights(face.source, point)));
            }
        }
        Err(TransformError::new(
            ErrorCode::Schema,
            "vector boundary has no canonical mesh face",
        ))
    }

    /// Every source face is part of the validated square domain. Split the
    /// chord at each UNIQUE declared edge; adjacent faces therefore use the
    /// same intersection arithmetic, rather than creating last-bit double
    /// boundaries from independently clipped intervals.
    fn line_parameters(&self, start: Point, end: Point) -> TransformResult<Vec<f64>> {
        domain(start)?;
        domain(end)?;
        let direction = Point::new(end.x - start.x, end.y - start.y);
        let mut parameters = vec![0.0, 1.0];
        let length_squared = direction.x * direction.x + direction.y * direction.y;
        if length_squared == 0.0 {
            return Ok(parameters);
        }
        for index in self
            .edge_index
            .candidates(&[start, end], &|| self.visit())?
        {
            let [a, b] = self.map.edges()[index];
            self.visit()?;
            let start_side = orientation(a, b, start);
            let end_side = orientation(a, b, end);
            if start_side == 0.0 && end_side == 0.0 {
                // A seam-coincident chord follows the same affine edge in
                // both faces. Its intermediate mesh vertices may still kink.
                for point in [a, b] {
                    let t = ((point.x - start.x) * direction.x + (point.y - start.y) * direction.y)
                        / length_squared;
                    if (0.0..=1.0).contains(&t) {
                        parameters.push(t);
                    }
                }
            } else {
                let straddles = |first: f64, second: f64| {
                    first == 0.0
                        || second == 0.0
                        || first.is_sign_positive() != second.is_sign_positive()
                };
                // Testing robust sides avoids a near-parallel direction
                // cross rounding to zero and silently omitting a real seam.
                if straddles(start_side, end_side)
                    && straddles(orientation(start, end, a), orientation(start, end, b))
                {
                    // Opposite sides add magnitudes rather than cancel them.
                    let start_value = orientation_value(a, b, start);
                    let end_value = orientation_value(a, b, end);
                    let t = start_value / (start_value - end_value);
                    if (0.0..=1.0).contains(&t) {
                        parameters.push(t);
                    }
                }
            }
        }
        parameters.sort_by(f64::total_cmp);
        parameters.dedup();
        Ok(parameters)
    }

    pub(super) fn emit_line(
        &self,
        frame: &ProjectionFrame<'_>,
        start: Point,
        end: Point,
        start_index: usize,
        end_index: usize,
        builder: &mut OutputBuilder,
    ) -> TransformResult<()> {
        let parameters = self.line_parameters(start, end)?;
        let mut previous = start_index;
        for &t in parameters.iter().skip(1) {
            let next = if t == 1.0 {
                end_index
            } else {
                let point = Point::new(
                    start.x + (end.x - start.x) * t,
                    start.y + (end.y - start.y) * t,
                );
                builder.push_vertex(frame.project(point, 1.0)?)?
            };
            if previous != next {
                builder.push_segment(previous, next, None, None)?;
            }
            previous = next;
        }
        Ok(())
    }

    pub(super) fn project_segment(
        &self,
        frame: &ProjectionFrame<'_>,
        segment: &VectorPathSegment,
        vertices: &[VectorPathVertex],
        builder: &mut OutputBuilder,
        error: &mut Option<f64>,
    ) -> TransformResult<()> {
        let first = builder.segments.len();
        let control =
            cubic_control_points(segment, vertices).map(|point| frame.to_normalized(point));
        // Analytic extrema admit exterior handles when the actual curve stays
        // in the image domain, while rejecting genuinely exterior geometry.
        for axis in [control.map(|point| point.x), control.map(|point| point.y)] {
            for value in [axis[0], axis[3]].into_iter().chain(
                domain_extrema(axis)?
                    .into_iter()
                    .map(|t| cubic_coordinate(axis, t)),
            ) {
                if !(0.0..=1.0).contains(&value) {
                    return Err(TransformError::new(
                        ErrorCode::Schema,
                        "vector curve leaves the canonical mesh source domain",
                    ));
                }
            }
        }
        if (zero_tangent(segment.tangent_start) && zero_tangent(segment.tangent_end))
            || exactly_collinear(&control)
        {
            self.emit_line(
                frame,
                control[0],
                control[3],
                segment.start,
                segment.end,
                builder,
            )?;
        } else {
            self.project_curve(
                frame,
                control,
                segment.start,
                segment.end,
                0,
                builder,
                error,
            )?;
        }
        builder.segment_pieces.push(SegmentPieces {
            first,
            count: builder.segments.len() - first,
        });
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn project_curve(
        &self,
        frame: &ProjectionFrame<'_>,
        control: [Point; 4],
        start: usize,
        end: usize,
        depth: u32,
        builder: &mut OutputBuilder,
        error: &mut Option<f64>,
    ) -> TransformResult<()> {
        if let Some(work) = self.work {
            work.charge(WorkKind::Curve, 1)?;
        }
        builder.max_depth = builder.max_depth.max(depth);
        for index in self.face_index.candidates(&control, &|| self.visit())? {
            let face = &self.map.faces()[index];
            self.visit()?;
            if control.iter().all(|point| contains(face.source, *point)) {
                // An affine face maps Bézier controls exactly. Transform
                // controls with the SAME barycentric map as point lookup,
                // then reuse H's rational projector. Avoid cancellation from
                // constructing a huge H∘face matrix for a legitimate sliver.
                let warped = control.map(|point| blend(face.target, weights(face.source, point)));
                let local = ProjectionFrame {
                    mesh: None,
                    ..*frame
                };
                return project_cubic_piece(&local, warped, start, end, depth, builder, error);
            }
        }
        // C(t)-chord(t) is a cubic with controls [0,P1-Q1,P2-Q2,0].
        // The convex hull bounds its norm for EVERY parameter. Applying the
        // full canonical map's Lipschitz bound proves the target deviation.
        let residual = |point: Point, first_weight: f64, last_weight: f64| {
            let axis = |p: f64, first: f64, last: f64| {
                let numerator = linear_combination_abs_bound([
                    (p, 3.0),
                    (first, -first_weight),
                    (last, -last_weight),
                ]);
                if numerator == 0.0 {
                    0.0
                } else {
                    (numerator / 3.0).next_up()
                }
            };
            let x = axis(point.x, control[0].x, control[3].x);
            let y = axis(point.y, control[0].y, control[3].y);
            let distance = x.hypot(y);
            if distance == 0.0 {
                0.0
            } else {
                distance.next_up()
            }
        };
        let deviation = residual(control[1], 2.0, 1.0).max(residual(control[2], 1.0, 2.0));
        let bound = if deviation == 0.0 {
            0.0
        } else {
            (deviation * self.scale).next_up()
        };
        if !bound.is_finite() {
            return Err(TransformError::new(
                ErrorCode::Schema,
                "mesh curve deviation bound is not representable",
            ));
        }
        if bound <= frame.tolerance_px * 0.99 {
            self.emit_line(frame, control[0], control[3], start, end, builder)?;
            if bound > 0.0 {
                *error = Some(error.map_or(bound, |old| old.max(bound)));
            }
            return Ok(());
        }
        if depth >= MAX_CURVE_DEPTH {
            return Err(complexity_error(
                "mesh curve subdivision depth",
                depth as usize + 1,
                MAX_CURVE_DEPTH as usize,
            ));
        }
        let (left, right) = de_casteljau_split(&control);
        let middle = builder.push_vertex(frame.project(left[3], 1.0)?)?;
        self.project_curve(frame, left, start, middle, depth + 1, builder, error)?;
        self.project_curve(frame, right, middle, end, depth + 1, builder, error)
    }
}

// Domain admission cannot use the legacy bounds helper's absolute derivative
// floor: even a sub-ulp-sized exterior curve has no canonical mesh image.
// Normalize derivative differences and solve with the cancellation-resistant
// quadratic formula; no sample or source-space epsilon supplies admission.
fn domain_extrema(control: [f64; 4]) -> TransformResult<Vec<f64>> {
    if control.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mesh curve coordinates are not representable",
        ));
    }
    if control.iter().all(|value| (0.0..=1.0).contains(value)) {
        // Convex hull already proves the complete curve lies in the domain.
        return Ok(Vec::new());
    }
    let differences = [
        control[1] - control[0],
        control[2] - control[1],
        control[3] - control[2],
    ];
    if differences.iter().any(|value| !value.is_finite()) {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "mesh curve derivative is not representable",
        ));
    }
    let scale = differences
        .iter()
        .map(|value| value.abs())
        .fold(0.0, f64::max);
    if scale == 0.0 {
        return Ok(Vec::new());
    }
    let [d0, d1, d2] = differences.map(|value| value / scale);
    let a = (d2 - d1) - (d1 - d0);
    let b = 2.0 * (d1 - d0);
    let c = d0;
    let mut roots = Vec::with_capacity(2);
    let mut add = |t: f64| {
        if t > 0.0 && t < 1.0 && !roots.contains(&t) {
            roots.push(t);
        }
    };
    if a == 0.0 {
        if b != 0.0 {
            add(-c / b);
        }
    } else {
        let discriminant = b * b - 4.0 * a * c;
        if discriminant >= 0.0 {
            let q = -0.5 * (b + discriminant.sqrt().copysign(b));
            if q == 0.0 {
                add(-b / (2.0 * a));
            } else {
                add(q / a);
                add(c / q);
            }
        }
    }
    Ok(roots)
}

// A source-space epsilon is NOT a target-space error budget: the mesh may
// amplify tiny curvature. Only an exact monotone collinear control polygon
// may bypass the proven subdivision in the nonlinear branch.
pub(super) fn exactly_collinear(control: &[Point; 4]) -> bool {
    let x = control[3].x - control[0].x;
    let y = control[3].y - control[0].y;
    let length = x * x + y * y;
    if length == 0.0 {
        return control.iter().all(|point| *point == control[0]);
    }
    control[1..3].iter().all(|point| {
        let dx = point.x - control[0].x;
        let dy = point.y - control[0].y;
        let along = dx * x + dy * y;
        orientation(control[0], control[3], *point) == 0.0 && (0.0..=length).contains(&along)
    })
}

#[cfg(test)]
mod tests;

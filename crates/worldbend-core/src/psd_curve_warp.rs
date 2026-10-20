//! Canonical adoption of a bounded PSD `warpCustom` curve warp.
//!
//! A `warpCustom` 4×4 warp describes one bicubic Bézier patch: sixteen
//! controls in the smart object's source-pixel space, a rectangular rest
//! envelope, and a placement quad (`Trnf`). The declared envelope is the
//! warp's source domain, so adoption maps that envelope onto the quad and
//! normalizes every control through the same envelope. Controls outside the
//! envelope remain outside the unit domain instead of being compressed back
//! into the placement. Because Bézier patches are affine-invariant, this
//! reproduces the source patch exactly while the quad keeps the placement.
//!
//! The output is an ordinary `worldbend.deformation-work`: the sixteen
//! controls remain live Pin-view Bézier controls. When the normalized outer
//! ring still sits on the regular grid and no control leaves the declared
//! envelope, the work keeps a fixed rectangular boundary. Any warp whose
//! outline leaves that grid, or whose interior controls extend beyond the
//! envelope, adopts the free boundary so the expanded authored canvas and
//! handles are retained. Provenance records
//! the original envelope, control bbox, snap corrections, and boundary
//! decision so no origin or rest window is silently discarded.

use crate::{
    BezierEnvelope, DEFORMATION_WORK_SCHEMA, DEFORMATION_WORK_VERSION, DeformationWorkSpec,
    ErrorCode, MeshBoundary, Point, Quad, Size, SurfaceDeformationControls, TransformError,
    TransformResult, TransformSpec, validate_quad,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The PSD `warpCustom` 4×4 control lattice this contract adopts.
pub const PSD_CURVE_WARP_ORDER: u32 = 4;
/// Semantically unmoved controls may differ from their rest-grid fraction by
/// small serialization error; adoption snaps within the stated absolute
/// normalized tolerance to the exact grid so fixed
/// boundaries validate without changing meaning.
pub const PSD_CURVE_WARP_SNAP_EPSILON: f64 = 1e-9;
/// Mesh density used for the adopted work; the Bézier patch is evaluated
/// exactly per vertex, so this only sets the render approximation density.
pub const PSD_CURVE_WARP_SUBDIVISIONS: u16 = 12;

/// The warp's rectangular rest envelope in the smart object's source pixels.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PsdCurveWarpEnvelope {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

/// The untyped warp facts every carrier must supply identically. Units and
/// descriptor framing stay adapter concerns; the geometry here is already in
/// Photoshop pixel space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct PsdCurveWarp {
    pub u_order: u32,
    pub v_order: u32,
    pub envelope: PsdCurveWarpEnvelope,
    /// Sixteen controls, rows first from top-left, in source pixels.
    #[schemars(length(min = 16, max = 16))]
    pub controls: Vec<Point>,
    /// The placement quad `Trnf` in document pixels: TL, TR, BR, BL.
    pub quad: Quad,
    pub document: Size,
}

/// Adoption provenance: the facts that make the normalized work reversible.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdCurveWarpProvenance {
    /// Control-point bounding box in source pixels, retained as diagnostic
    /// provenance. Placement is defined by `envelope`, not this box.
    pub control_bbox: PsdCurveWarpEnvelope,
    /// True when the control bbox coincides with the rest envelope, so the
    /// normalized controls sit on their original rest fractions exactly.
    pub bbox_matches_envelope: bool,
    /// Boundary adoption: fixed when every outer-ring control stayed on the
    /// rest grid, free when the warp moves its own outline.
    pub boundary: MeshBoundary,
    /// How many normalized coordinates were snapped onto the exact third
    /// fractions. Each snap is within `PSD_CURVE_WARP_SNAP_EPSILON`.
    #[schemars(range(min = 0, max = 32))]
    pub snapped_coordinates: usize,
    /// The sixteen controls normalized through the declared rest envelope.
    /// Out-of-envelope controls therefore remain outside the unit square.
    #[schemars(length(min = 16, max = 16))]
    pub normalized_controls: Vec<Point>,
    /// The placement quad and document the work was framed against.
    pub quad: Quad,
    pub document: Size,
    /// The warp's rest envelope, retained because the normalized work no
    /// longer carries the source-pixel origin or rest window.
    pub envelope: PsdCurveWarpEnvelope,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PsdCurveWarpAdoption {
    pub work: DeformationWorkSpec,
    pub provenance: PsdCurveWarpProvenance,
}

/// Adopt one bounded curve warp as a complete, editable deformation work.
///
/// Rejections are explicit: unsupported orders, non-finite values, a
/// degenerate envelope or control bbox, and invalid placement quads fail
/// closed. Out-of-envelope controls are valid authored geometry within the
/// bounded free-control range; they are not silently clamped or reframed.
pub fn adopt_psd_curve_warp(warp: &PsdCurveWarp) -> TransformResult<PsdCurveWarpAdoption> {
    if warp.u_order != PSD_CURVE_WARP_ORDER || warp.v_order != PSD_CURVE_WARP_ORDER {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp adoption requires the measured 4×4 control grid",
        )
        .with_details(serde_json::json!({
            "uOrder": warp.u_order,
            "vOrder": warp.v_order,
        })));
    }
    if warp.controls.len() != (PSD_CURVE_WARP_ORDER * PSD_CURVE_WARP_ORDER) as usize {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp adoption requires exactly sixteen controls",
        ));
    }
    let envelope = warp.envelope;
    if ![envelope.left, envelope.top, envelope.right, envelope.bottom]
        .iter()
        .all(|value| value.is_finite())
        || envelope.right - envelope.left <= 0.0
        || envelope.bottom - envelope.top <= 0.0
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp envelope must be finite with positive extents",
        ));
    }
    if !warp
        .controls
        .iter()
        .all(|point| point.x.is_finite() && point.y.is_finite())
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp controls must be finite",
        ));
    }
    if !warp.document.width.is_finite()
        || !warp.document.height.is_finite()
        || warp.document.width <= 0.0
        || warp.document.height <= 0.0
    {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp document size must be finite and positive",
        ));
    }
    validate_quad(&warp.quad).map_err(|error| {
        TransformError::new(
            ErrorCode::Schema,
            "curve warp placement quad is not canonically valid",
        )
        .with_details(serde_json::json!({ "quad": error.code }))
    })?;

    let mut bbox = PsdCurveWarpEnvelope {
        left: f64::INFINITY,
        top: f64::INFINITY,
        right: f64::NEG_INFINITY,
        bottom: f64::NEG_INFINITY,
    };
    for point in &warp.controls {
        bbox.left = bbox.left.min(point.x);
        bbox.top = bbox.top.min(point.y);
        bbox.right = bbox.right.max(point.x);
        bbox.bottom = bbox.bottom.max(point.y);
    }
    if bbox.right - bbox.left <= 0.0 || bbox.bottom - bbox.top <= 0.0 {
        return Err(TransformError::new(
            ErrorCode::Schema,
            "curve warp control bounding box must have positive extents",
        ));
    }
    let bbox_matches_envelope = bbox.left == envelope.left
        && bbox.top == envelope.top
        && bbox.right == envelope.right
        && bbox.bottom == envelope.bottom;

    let width = envelope.right - envelope.left;
    let height = envelope.bottom - envelope.top;
    let mut snapped = 0usize;
    let mut normalized = Vec::with_capacity(warp.controls.len());
    for point in &warp.controls {
        let x = snap_third((point.x - envelope.left) / width);
        let y = snap_third((point.y - envelope.top) / height);
        snapped += usize::from(x.1) + usize::from(y.1);
        normalized.push(Point::new(x.0, y.0));
    }

    // A moved outline needs the free boundary. So does an interior control
    // outside the declared envelope: the outline can remain rectangular, but
    // the authored canvas must expand to retain the Bézier bulge.
    let outline_off_grid = normalized.iter().enumerate().any(|(index, point)| {
        let column = index % 4;
        let row = index / 4;
        let outer = column == 0 || row == 0 || column == 3 || row == 3;
        // After snapping, an unmoved control equals its rest fraction exactly,
        // so exact inequality is the precise moved test.
        outer && (point.x != column as f64 / 3.0 || point.y != row as f64 / 3.0)
    });
    let extends_beyond_envelope = normalized
        .iter()
        .any(|point| !(0.0..=1.0).contains(&point.x) || !(0.0..=1.0).contains(&point.y));
    let boundary = if outline_off_grid || extends_beyond_envelope {
        MeshBoundary::Free
    } else {
        MeshBoundary::Fixed
    };

    let work = DeformationWorkSpec {
        schema: DEFORMATION_WORK_SCHEMA.to_owned(),
        version: DEFORMATION_WORK_VERSION.to_owned(),
        transform: TransformSpec::pixel(warp.document, warp.quad),
        target_size: Some(warp.document),
        mesh_subdivisions: PSD_CURVE_WARP_SUBDIVISIONS,
        boundary,
        surface: Some(SurfaceDeformationControls {
            envelope: BezierEnvelope {
                columns: 1,
                rows: 1,
                points: normalized.clone(),
            },
            anchors: Vec::new(),
            strokes: Vec::new(),
        }),
        liquify: None,
        shape_fit: None,
        mesh_edits: Vec::new(),
    };
    let provenance = PsdCurveWarpProvenance {
        control_bbox: bbox,
        bbox_matches_envelope,
        boundary,
        snapped_coordinates: snapped,
        normalized_controls: normalized,
        quad: warp.quad,
        document: warp.document,
        envelope,
    };
    Ok(PsdCurveWarpAdoption { work, provenance })
}

/// Snap a normalized coordinate onto exact thirds within the absolute
/// normalized tolerance, including Photoshop pixel quanta such as
/// `21.333…/64`. Returns the coordinate and whether a snap occurred.
fn snap_third(value: f64) -> (f64, bool) {
    if !value.is_finite() {
        return (value, false);
    }
    for numerator in 0..=3 {
        let third = f64::from(numerator) / 3.0;
        if (value - third).abs() <= PSD_CURVE_WARP_SNAP_EPSILON {
            return (third, value != third);
        }
    }
    (value, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MeshBoundary, plan_deformation_work};

    fn rest_controls(envelope: PsdCurveWarpEnvelope) -> Vec<Point> {
        let width = envelope.right - envelope.left;
        let height = envelope.bottom - envelope.top;
        let mut points = Vec::with_capacity(16);
        for row in 0..4 {
            for column in 0..4 {
                // Photoshop's pixel quanta: the descriptor carries
                // 21.33333333333333, one float step below 64/3.
                let x = envelope.left + width * f64::from(column) / 3.0;
                let y = envelope.top + height * f64::from(row) / 3.0;
                points.push(Point::new(
                    if column == 1 {
                        envelope.left + width * (21.33333333333333 / 64.0)
                    } else {
                        x
                    },
                    y,
                ));
            }
        }
        points
    }

    fn warp(controls: Vec<Point>) -> PsdCurveWarp {
        PsdCurveWarp {
            u_order: 4,
            v_order: 4,
            envelope: PsdCurveWarpEnvelope {
                left: 0.0,
                top: 0.0,
                right: 64.0,
                bottom: 48.0,
            },
            controls,
            quad: Quad::new(
                Point::new(68.0, 31.0),
                Point::new(132.0, 31.0),
                Point::new(132.0, 119.0),
                Point::new(68.0, 119.0),
            ),
            document: Size::new(200.0, 150.0),
        }
    }

    #[test]
    fn interior_bend_adopts_as_fixed_work_with_live_controls() {
        let mut controls = rest_controls(PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        });
        // One interior control bends; the outer rectangle stays at rest.
        controls[6] = Point::new(28.0, 14.0);
        let adoption = adopt_psd_curve_warp(&warp(controls)).unwrap();
        assert_eq!(adoption.provenance.boundary, MeshBoundary::Fixed);
        assert!(adoption.provenance.bbox_matches_envelope);
        // The pixel-quantum rest column snapped onto the exact third.
        assert!(adoption.provenance.snapped_coordinates >= 4);
        let surface = adoption.work.surface.as_ref().unwrap();
        assert_eq!(surface.envelope.columns, 1);
        assert_eq!(surface.envelope.rows, 1);
        assert_eq!(surface.envelope.points.len(), 16);
        assert_eq!(
            surface.envelope.points[6],
            Point::new(28.0 / 64.0, 14.0 / 48.0)
        );
        // Every adopted work must remain a valid, plannable deformation work.
        plan_deformation_work(&adoption.work).unwrap();
    }

    #[test]
    fn moved_outline_adopts_the_free_boundary_with_handles_retained() {
        let mut controls = rest_controls(PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        });
        // The bottom-middle control pulls outward, moving the outline.
        controls[13] = Point::new(32.0, 52.0);
        let adoption = adopt_psd_curve_warp(&warp(controls)).unwrap();
        assert_eq!(adoption.provenance.boundary, MeshBoundary::Free);
        assert!(!adoption.provenance.bbox_matches_envelope);
        // The control stays beyond the declared warp domain instead of being
        // compressed into a new control-derived frame.
        assert_eq!(adoption.provenance.control_bbox.bottom, 52.0);
        assert_eq!(adoption.provenance.normalized_controls[13].y, 52.0 / 48.0);
        plan_deformation_work(&adoption.work).unwrap();
    }

    #[test]
    fn out_of_envelope_bulge_retains_the_declared_envelope_frame() {
        let mut controls = rest_controls(PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        });
        // An interior bulge beyond the envelope converts without changing
        // the declared placement frame. It uses the free authored canvas so
        // the bulge remains visible outside the quad.
        controls[5] = Point::new(32.0, -4.0);
        controls[6] = Point::new(58.0, 52.0);
        let adoption = adopt_psd_curve_warp(&warp(controls)).unwrap();
        assert_eq!(adoption.provenance.boundary, MeshBoundary::Free);
        assert!(!adoption.provenance.bbox_matches_envelope);
        assert_eq!(adoption.provenance.control_bbox.top, -4.0);
        assert_eq!(adoption.provenance.control_bbox.bottom, 52.0);
        assert_eq!(adoption.provenance.normalized_controls[5].y, -4.0 / 48.0);
        assert_eq!(adoption.provenance.normalized_controls[6].y, 52.0 / 48.0);
        plan_deformation_work(&adoption.work).unwrap();
    }

    #[test]
    fn uniform_translation_of_every_control_remains_authored_geometry() {
        // Translating the lattice relative to the declared warp envelope is
        // visible geometry; it must not be erased by reframing to its bbox.
        let envelope = PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        };
        let translated: Vec<Point> = rest_controls(envelope)
            .into_iter()
            .map(|point| Point::new(point.x + 10.0, point.y + 6.0))
            .collect();
        let adoption = adopt_psd_curve_warp(&warp(translated)).unwrap();
        assert_eq!(adoption.provenance.boundary, MeshBoundary::Free);
        assert_eq!(adoption.provenance.control_bbox.left, 10.0);
        assert_eq!(adoption.provenance.control_bbox.top, 6.0);
        let surface = adoption.work.surface.as_ref().unwrap();
        // Every control keeps the same normalized translation.
        for (index, point) in surface.envelope.points.iter().enumerate() {
            let expected_x = (index % 4) as f64 / 3.0 + 10.0 / 64.0;
            let expected_y = (index / 4) as f64 / 3.0 + 6.0 / 48.0;
            assert!((point.x - expected_x).abs() < 1e-12);
            assert!((point.y - expected_y).abs() < 1e-12);
        }
        plan_deformation_work(&adoption.work).unwrap();
    }

    #[test]
    fn unsupported_orders_non_finite_and_degenerate_inputs_fail_closed() {
        let envelope = PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        };
        let base = rest_controls(envelope);

        let mut wrong_order = warp(base.clone());
        wrong_order.u_order = 5;
        assert!(adopt_psd_curve_warp(&wrong_order).is_err());

        let mut short = warp(base[..15].to_vec());
        short.u_order = 4;
        short.v_order = 4;
        assert!(adopt_psd_curve_warp(&short).is_err());

        let mut non_finite = warp(base.clone());
        non_finite.controls[7] = Point::new(f64::NAN, 12.0);
        assert!(adopt_psd_curve_warp(&non_finite).is_err());

        // Every control collapsed onto one axis: no positive bbox extent.
        let collapsed: Vec<Point> = base.iter().map(|point| Point::new(10.0, point.y)).collect();
        assert!(adopt_psd_curve_warp(&warp(collapsed)).is_err());

        let mut bad_envelope = warp(base.clone());
        bad_envelope.envelope = PsdCurveWarpEnvelope {
            left: 30.0,
            top: 0.0,
            right: 10.0,
            bottom: 48.0,
        };
        assert!(adopt_psd_curve_warp(&bad_envelope).is_err());

        let mut bad_quad = warp(base.clone());
        bad_quad.quad = Quad::new(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
            Point::new(10.0, 10.0),
        );
        assert!(adopt_psd_curve_warp(&bad_quad).is_err());
    }

    #[test]
    fn provenance_round_trips_through_serde_with_the_original_window() {
        let envelope = PsdCurveWarpEnvelope {
            left: 0.0,
            top: 0.0,
            right: 64.0,
            bottom: 48.0,
        };
        let mut controls = rest_controls(envelope);
        controls[10] = Point::new(40.0, 30.0);
        let adoption = adopt_psd_curve_warp(&warp(controls)).unwrap();
        let encoded = serde_json::to_string(&adoption).unwrap();
        let decoded: PsdCurveWarpAdoption = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, adoption);
        // The source-pixel rest window survives adoption.
        assert_eq!(decoded.provenance.envelope, envelope);
        assert_eq!(decoded.provenance.document, Size::new(200.0, 150.0));
    }
}

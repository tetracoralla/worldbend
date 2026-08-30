use proptest::prelude::*;
use worldbend_core::{
    ErrorCode, Point, Quad, TransformSpec, inverse_transform_point, solve_quad, solve_spec,
    transform_point, validate_quad,
};

fn convex_trapezoid() -> impl Strategy<Value = Quad> {
    (
        -10_000.0_f64..10_000.0,
        -10_000.0_f64..10_000.0,
        1.0_f64..4_000.0,
        1.0_f64..4_000.0,
        0.0_f64..0.2,
        0.0_f64..0.2,
        0.0_f64..0.2,
        0.0_f64..0.2,
    )
        .prop_map(|(x, y, width, height, tl, tr, br, bl)| {
            Quad::new(
                Point::new(x + width * tl, y),
                Point::new(x + width * (1.0 - tr), y),
                Point::new(x + width * (1.0 - br), y + height),
                Point::new(x + width * bl, y + height),
            )
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn solved_homographies_round_trip_interior_points(
        quad in convex_trapezoid(),
        u in 0.0_f64..1.0,
        v in 0.0_f64..1.0,
    ) {
        let (homography, diagnostics) = solve_quad(&quad).unwrap();
        let source = Point::new(u, v);
        let destination = transform_point(&homography, source).unwrap();
        let restored = inverse_transform_point(&homography, destination).unwrap();
        let tolerance = diagnostics.bounds.diagonal().max(1.0) * 1.0e-8;
        prop_assert!((restored.x - source.x).abs() <= tolerance);
        prop_assert!((restored.y - source.y).abs() <= tolerance);
        prop_assert!(diagnostics.reprojection.max <= diagnostics.reprojection.limit);
    }

    #[test]
    fn translation_and_positive_uniform_scale_preserve_quad_validity(
        quad in convex_trapezoid(),
        scale in 0.01_f64..100.0,
        tx in -1_000_000.0_f64..1_000_000.0,
        ty in -1_000_000.0_f64..1_000_000.0,
    ) {
        validate_quad(&quad).unwrap();
        let mapped = quad.map(|point| Point::new(point.x * scale + tx, point.y * scale + ty));
        let diagnostics = validate_quad(&mapped).unwrap();
        prop_assert!(diagnostics.convex);
        prop_assert!(!diagnostics.self_intersecting);
        prop_assert_eq!(diagnostics.orientation, "clockwise-screen");
    }

    #[test]
    fn mirrored_destination_order_is_never_silently_reordered(quad in convex_trapezoid()) {
        let mirrored = Quad::new(quad.tl, quad.bl, quad.br, quad.tr);
        let error = validate_quad(&mirrored).unwrap_err();
        prop_assert!(matches!(
            error.code,
            ErrorCode::QuadOrientation
                | ErrorCode::QuadSelfIntersect
                | ErrorCode::QuadDegenerate
                | ErrorCode::EdgeTooShort
        ));
    }

    #[test]
    fn normalized_solve_preserves_the_canonical_spec(
        quad in convex_trapezoid(),
        width in 1.0_f64..8_192.0,
        height in 1.0_f64..8_192.0,
    ) {
        let normalized = quad.map(|point| Point::new(point.x / 20_000.0 + 0.5, point.y / 20_000.0 + 0.5));
        let spec = TransformSpec::normalized(normalized);
        if validate_quad(&normalized).is_ok() {
            let solved = solve_spec(&spec, Some(worldbend_core::Size::new(width, height))).unwrap();
            prop_assert_eq!(solved.spec, spec);
        }
    }

    #[test]
    fn arbitrary_bounded_json_input_never_panics(bytes in prop::collection::vec(any::<u8>(), 0..16_384)) {
        let _ = serde_json::from_slice::<TransformSpec>(&bytes);
    }
}

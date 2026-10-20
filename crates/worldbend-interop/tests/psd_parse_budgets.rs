//! End-to-end resource-budget verification for the PSD/PSB inspection entry.
//!
//! These tests build minimal single-layer PSD documents by hand so every
//! declared length, item count, and additional-info block order is under the
//! test's control. They verify that malformed inputs are rejected with typed
//! errors before the parser reserves storage or recurses, that bounded
//! recovery stays available, that rejection leaves later parses unaffected,
//! and that real Photoshop fixtures keep their established results.

use worldbend_core::ErrorCode;
use worldbend_interop::{
    PsdSmartObjectImportability, PsdSmartObjectRejection, inspect_psd_smart_objects,
};

// ---------------------------------------------------------------------------
// Byte and descriptor building helpers
// ---------------------------------------------------------------------------

fn push(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(bytes);
}

fn be16(out: &mut Vec<u8>, value: u16) {
    push(out, &value.to_be_bytes());
}

fn be32(out: &mut Vec<u8>, value: u32) {
    push(out, &value.to_be_bytes());
}

fn be64(out: &mut Vec<u8>, value: f64) {
    push(out, &value.to_bits().to_be_bytes());
}

/// `readAsciiStringOrClassId` framing: a zero length selects the four-byte
/// class-id form, anything else a length-prefixed ASCII string.
fn class_id(out: &mut Vec<u8>, value: &str) {
    let raw = value.as_bytes();
    if raw.len() == 4 {
        be32(out, 0);
    } else {
        be32(out, raw.len() as u32);
    }
    push(out, raw);
}

/// One descriptor item value; each variant encodes its own OSType signature.
#[derive(Clone)]
enum Item {
    Doub(f64),
    Long(i32),
    Bool(bool),
    Enum(&'static str, &'static str),
    /// `TEXT` with a controlled string.
    Text(&'static str),
    Obj(Vec<Field>),
    /// `VlLs` list; every entry carries its own signature.
    List(Vec<Item>),
    /// `ObAr` object array used by `customEnvelopeWarp.meshPoints`:
    /// named rows of raw f64 values.
    ObjectArray(Vec<(&'static str, Vec<f64>)>),
    /// Fully pre-encoded signature + payload for attack cases whose declared
    /// lengths are the object under test.
    Raw(Vec<u8>),
}

/// A descriptor field: key plus value.
#[derive(Clone)]
struct Field {
    key: &'static str,
    value: Item,
}

fn field(key: &'static str, value: Item) -> Field {
    Field { key, value }
}

fn write_value(out: &mut Vec<u8>, value: &Item) {
    match value {
        Item::Doub(value) => {
            push(out, b"doub");
            be64(out, *value);
        }
        Item::Long(value) => {
            push(out, b"long");
            push(out, &value.to_be_bytes());
        }
        Item::Bool(value) => {
            push(out, b"bool");
            push(out, &[*value as u8]);
        }
        Item::Enum(kind, name) => {
            push(out, b"enum");
            class_id(out, kind);
            class_id(out, name);
        }
        Item::Text(value) => {
            push(out, b"TEXT");
            let units = value.chars().count() as u32 + 1;
            be32(out, units);
            for unit in value.encode_utf16() {
                push(out, &unit.to_be_bytes());
            }
            // trailing null unit consumed by the reader
            be16(out, 0);
        }
        Item::Obj(items) => {
            push(out, b"Objc");
            write_descriptor_body(out, items);
        }
        Item::List(items) => {
            push(out, b"VlLs");
            be32(out, items.len() as u32);
            for item in items.iter() {
                write_value(out, item);
            }
        }
        Item::ObjectArray(rows) => {
            push(out, b"ObAr");
            push(out, &16i32.to_be_bytes()); // version
            be32(out, 0); // name
            class_id(out, "rationalPoint");
            be32(out, rows.len() as u32);
            for (name, values) in rows.iter() {
                class_id(out, name);
                push(out, b"UnFl");
                push(out, b"#Pxl");
                be32(out, values.len() as u32);
                for value in values.iter() {
                    be64(out, *value);
                }
            }
        }
        Item::Raw(bytes) => push(out, bytes),
    }
}

fn write_descriptor_body(out: &mut Vec<u8>, items: &[Field]) {
    be32(out, 0); // unicode name, zero code units
    class_id(out, "null");
    be32(out, items.len() as u32);
    for item in items {
        class_id(out, item.key);
        write_value(out, &item.value);
    }
}

/// A `SoLd` additional-info payload: `soLD` + version 4 + versioned
/// descriptor.
fn sold_payload(items: &[Field]) -> Vec<u8> {
    let mut out = Vec::new();
    push(&mut out, b"soLD");
    push(&mut out, &4i32.to_be_bytes());
    be32(&mut out, 16); // descriptor version
    write_descriptor_body(&mut out, items);
    out
}

/// A `PlLd` additional-info payload carrying a legacy placed layer with the
/// given transform and warp descriptor.
fn plld_payload(transform: &[f64; 8], warp_items: &[Field]) -> Vec<u8> {
    let mut out = Vec::new();
    push(&mut out, b"plcL");
    push(&mut out, &3i32.to_be_bytes());
    push(&mut out, &[0]); // pascal id, empty
    push(&mut out, &1i32.to_be_bytes()); // page
    push(&mut out, &1i32.to_be_bytes()); // total pages
    push(&mut out, &16i32.to_be_bytes()); // anti-alias policy
    push(&mut out, &0i32.to_be_bytes()); // raster type
    for value in transform {
        be64(&mut out, *value);
    }
    push(&mut out, &0i32.to_be_bytes()); // warp version
    be32(&mut out, 16);
    write_descriptor_body(&mut out, warp_items);
    out
}

const IDENTITY_TRANSFORM: [f64; 8] = [0.0, 0.0, 64.0, 0.0, 64.0, 64.0, 0.0, 64.0];

/// The common valid `SoLd` shape: raster type, an axis-aligned transform and
/// a 64x64 source size, plus any extra fields the test supplies.
fn valid_sold_items(extra: &[Field]) -> Vec<Field> {
    let mut items = vec![
        field("Type", Item::Long(0)),
        field(
            "Trnf",
            Item::List(vec![
                Item::Doub(0.0),
                Item::Doub(0.0),
                Item::Doub(64.0),
                Item::Doub(0.0),
                Item::Doub(64.0),
                Item::Doub(64.0),
                Item::Doub(0.0),
                Item::Doub(64.0),
            ]),
        ),
        field(
            "Sz  ",
            Item::Obj(vec![
                field("Wdth", Item::Doub(64.0)),
                field("Hght", Item::Doub(64.0)),
            ]),
        ),
    ];
    items.extend(extra.iter().cloned());
    items
}

/// A neutral `warp` descriptor: `warpStyle = warpNone`, no envelope.
fn neutral_warp_items() -> Vec<Field> {
    vec![field("warpStyle", Item::Enum("warpStyle", "warpNone"))]
}

/// A minimal warp that still carries deformation: custom style plus a
/// non-zero `warpValue`.
fn carrying_warp_items(value: f64) -> Vec<Field> {
    vec![
        field("warpStyle", Item::Enum("warpStyle", "warpCustom")),
        field("warpValue", Item::Doub(value)),
    ]
}

/// A moved 4x4 custom envelope curve in a 64x64 pixel bounds window: the
/// adoptable `warpCustom` family with one interior control displaced.
fn curve_warp_items() -> Vec<Field> {
    let xs: Vec<f64> = [0.0, 21.0, 43.0, 64.0]
        .iter()
        .cycle()
        .take(16)
        .copied()
        .collect();
    let mut ys: Vec<f64> = [0.0f64, 21.0, 43.0, 64.0]
        .iter()
        .flat_map(|row| std::iter::repeat_n(*row, 4))
        .collect();
    // one interior control moved: carries a real deformation
    ys[5] += 2.0;
    vec![
        field("warpStyle", Item::Enum("warpStyle", "warpCustom")),
        field("uOrder", Item::Doub(4.0)),
        field("vOrder", Item::Doub(4.0)),
        field(
            "bounds",
            Item::Obj(vec![
                field("Left", Item::Long(0)),
                field("Top ", Item::Long(0)),
                field("Rght", Item::Long(64)),
                field("Btom", Item::Long(64)),
            ]),
        ),
        field(
            "customEnvelopeWarp",
            Item::Obj(vec![field(
                "meshPoints",
                Item::ObjectArray(vec![("Hrzn", xs), ("Vrtc", ys)]),
            )]),
        ),
    ]
}

/// An `8BIM` additional-info block wrapping a payload.
fn block(key: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    push(&mut out, b"8BIM");
    push(&mut out, key);
    be32(&mut out, payload.len() as u32);
    push(&mut out, payload);
    out
}

/// A minimal 1x1 single-layer PSD whose layer carries the given
/// additional-info blocks.
fn psd_with_blocks(blocks: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::new();
    // header
    push(&mut out, b"8BPS");
    be16(&mut out, 1); // version
    push(&mut out, &[0; 6]); // reserved
    be16(&mut out, 1); // channels
    be32(&mut out, 1); // height
    be32(&mut out, 1); // width
    be16(&mut out, 8); // depth
    be16(&mut out, 3); // RGB
    // color mode data
    be32(&mut out, 0);
    // image resources
    be32(&mut out, 0);
    // layer record
    let mut record = Vec::new();
    push(&mut record, &0i32.to_be_bytes()); // top
    push(&mut record, &0i32.to_be_bytes()); // left
    push(&mut record, &1i32.to_be_bytes()); // bottom
    push(&mut record, &1i32.to_be_bytes()); // right
    be16(&mut record, 1); // channel count
    push(&mut record, &0i16.to_be_bytes()); // channel id
    be32(&mut record, 3); // channel length
    push(&mut record, b"8BIM");
    push(&mut record, b"norm");
    push(&mut record, &[255, 0, 0, 0]); // opacity, clipping, flags, filler
    let mut extra = Vec::new();
    be32(&mut extra, 0); // mask data
    be32(&mut extra, 0); // blending ranges
    push(&mut extra, &[1, b'L']); // pascal name "L"
    for block in blocks {
        push(&mut extra, block);
    }
    be32(&mut record, extra.len() as u32);
    push(&mut record, &extra);
    // layer info section content
    let mut content = Vec::new();
    push(&mut content, &1i16.to_be_bytes()); // one layer
    push(&mut content, &record);
    push(&mut content, &[0, 0, 0]); // channel compression + one sample
    if content.len() % 2 != 0 {
        push(&mut content, &[0]);
    }
    let mut layer_info = Vec::new();
    be32(&mut layer_info, content.len() as u32);
    push(&mut layer_info, &content);
    // layer & mask info section
    be32(&mut out, layer_info.len() as u32);
    push(&mut out, &layer_info);
    // composite image data
    be16(&mut out, 0);
    push(&mut out, &[0]);
    out
}

fn valid_document() -> Vec<u8> {
    psd_with_blocks(&[block(b"SoLd", &sold_payload(&valid_sold_items(&[])))])
}

fn assert_rejected_with_conflict(bytes: &[u8]) {
    let inspection = inspect_psd_smart_objects(bytes).unwrap();
    assert_eq!(inspection.smart_objects.len(), 1);
    match &inspection.smart_objects[0].importability {
        PsdSmartObjectImportability::Unsupported { reasons } => {
            assert!(
                reasons.contains(&PsdSmartObjectRejection::ConflictingWarpBlocks),
                "expected a warp-block conflict, got {:?}",
                reasons
            );
        }
        other => panic!("expected conflict rejection, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Declared-length rejections (big- and little-endian, ASCII, class ids)
// ---------------------------------------------------------------------------

#[test]
fn big_endian_unicode_length_is_rejected_before_allocation() {
    let mut raw = Vec::new();
    push(&mut raw, b"TEXT");
    be32(&mut raw, 0xffff_ffff);
    let items = [field("Idnt", Item::Raw(raw))];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let error = inspect_psd_smart_objects(&bytes).unwrap_err();
    assert_eq!(error.code, ErrorCode::UnsupportedMedia);
    // The same process accepts an ordinary document afterwards.
    let inspection = inspect_psd_smart_objects(&valid_document()).unwrap();
    assert_eq!(
        inspection.smart_objects[0].importability,
        PsdSmartObjectImportability::Eligible
    );
}

#[test]
fn little_endian_path_length_is_rejected_before_allocation() {
    let mut raw = Vec::new();
    push(&mut raw, b"Pth ");
    push(&mut raw, &20i32.to_be_bytes()); // total length
    push(&mut raw, b"path"); // signature
    push(&mut raw, &16i32.to_le_bytes()); // path size
    push(&mut raw, &(-1i32).to_le_bytes()); // chars count
    let items = [field("Pth ", Item::Raw(raw))];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let error = inspect_psd_smart_objects(&bytes).unwrap_err();
    assert_eq!(error.code, ErrorCode::UnsupportedMedia);
}

#[test]
fn negative_alias_and_class_id_lengths_are_rejected_before_allocation() {
    // "alis" with a sign-extended negative length.
    let mut alias = Vec::new();
    push(&mut alias, b"alis");
    push(&mut alias, &(-1i32).to_be_bytes());
    let items = [field("Alis", Item::Raw(alias))];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    assert_eq!(
        inspect_psd_smart_objects(&bytes).unwrap_err().code,
        ErrorCode::UnsupportedMedia
    );

    // An item key whose declared class-id length exceeds the file.
    let mut payload = Vec::new();
    be32(&mut payload, 0); // name
    class_id(&mut payload, "null");
    be32(&mut payload, 1); // one item
    be32(&mut payload, 0x7fff_ffff);
    push(&mut payload, b"doub");
    be64(&mut payload, 1.0);
    let mut wrapped = Vec::new();
    push(&mut wrapped, b"soLD");
    push(&mut wrapped, &4i32.to_be_bytes());
    be32(&mut wrapped, 16);
    push(&mut wrapped, &payload);
    let bytes = psd_with_blocks(&[block(b"SoLd", &wrapped)]);
    assert_eq!(
        inspect_psd_smart_objects(&bytes).unwrap_err().code,
        ErrorCode::UnsupportedMedia
    );
}

// ---------------------------------------------------------------------------
// Recursion and cumulative item budgets
// ---------------------------------------------------------------------------

#[test]
fn deep_descriptor_nesting_is_rejected_with_a_typed_error() {
    // 200 nested Objc values, far beyond the 64-level cap; each level is
    // roughly 24 bytes so the document stays small.
    let mut nested = field("Depth", Item::Doub(1.0));
    for _ in 0..200 {
        nested = field("Nested", Item::Obj(vec![nested]));
    }
    let items = [nested];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let error = inspect_psd_smart_objects(&bytes).unwrap_err();
    assert_eq!(error.code, ErrorCode::Memory);
    // A shallow document parsed afterwards is unaffected.
    assert!(inspect_psd_smart_objects(&valid_document()).is_ok());
}

#[test]
fn list_and_mixed_nesting_share_the_descriptor_depth_budget() {
    // Encode iteratively: constructing a deeply recursive test value would
    // itself use an unbounded test stack, outside the parser under test.
    for mixed in [false, true] {
        for depth in [10, 63, 64, 70, 5_000] {
            let mut raw = Vec::new();
            for level in 0..depth {
                if mixed && level % 2 == 1 {
                    push(&mut raw, b"Objc");
                    be32(&mut raw, 0);
                    class_id(&mut raw, "null");
                    be32(&mut raw, 1);
                    class_id(&mut raw, "Deep");
                } else {
                    push(&mut raw, b"VlLs");
                    be32(&mut raw, 1);
                }
            }
            push(&mut raw, b"doub");
            be64(&mut raw, 1.0);
            let items = valid_sold_items(&[
                field("Deep", Item::Raw(raw)),
                field("Text", Item::Text("Bounded text")),
            ]);
            let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
            let result = inspect_psd_smart_objects(&bytes);
            if depth < 64 {
                assert!(
                    result.is_ok(),
                    "bounded depth {depth}, mixed={mixed}: {result:?}"
                );
            } else {
                assert_eq!(result.unwrap_err().code, ErrorCode::Memory);
            }
            assert!(inspect_psd_smart_objects(&valid_document()).is_ok());
        }
    }
}

#[test]
fn list_items_share_the_cumulative_parse_budget() {
    const ITEM_COUNT: usize = 300_000;
    let items = vec![field(
        "VlLs",
        Item::List(vec![Item::Bool(true); ITEM_COUNT]),
    )];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let error = inspect_psd_smart_objects(&bytes).unwrap_err();
    assert_eq!(error.code, ErrorCode::Memory);
    // Retry with an ordinary document in the same process.
    assert!(inspect_psd_smart_objects(&valid_document()).is_ok());
}

#[test]
fn recovery_zero_fill_stays_bounded_and_compatible() {
    // A `tdta` blob declaring five megabytes past the end of the file exceeds
    // the recovery budget and is rejected.
    let mut oversized = Vec::new();
    push(&mut oversized, b"tdta");
    push(&mut oversized, &(5 * 1024 * 1024i32).to_be_bytes());
    let items = [field("Big ", Item::Raw(oversized))];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let error = inspect_psd_smart_objects(&bytes).unwrap_err();
    assert_eq!(error.code, ErrorCode::Memory);

    // A small recovery read past the end still zero-fills and the document
    // stays inspectable: bounded compatibility, not removal.
    let mut small = Vec::new();
    push(&mut small, b"tdta");
    push(&mut small, &1024i32.to_be_bytes());
    let items = valid_sold_items(&[field("Tail", Item::Raw(small))]);
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    assert_eq!(inspection.smart_objects.len(), 1);
    assert_eq!(
        inspection.smart_objects[0].importability,
        PsdSmartObjectImportability::Eligible
    );
}

// ---------------------------------------------------------------------------
// Dual-block (SoLd/PlLd) and quilt-shadowed warp visibility
// ---------------------------------------------------------------------------

#[test]
fn plld_curve_hidden_by_sold_is_reported_in_both_block_orders() {
    let curve = curve_warp_items();

    // PlLd first: the merge precedence overwrites the legacy curve.
    let plld_first = psd_with_blocks(&[
        block(b"PlLd", &plld_payload(&IDENTITY_TRANSFORM, &curve)),
        block(b"SoLd", &sold_payload(&valid_sold_items(&[]))),
    ]);
    let inspection = inspect_psd_smart_objects(&plld_first).unwrap();
    assert!(inspection.smart_objects[0].curve.is_none());
    assert_rejected_with_conflict(&plld_first);

    // SoLd first: the legacy block is skipped but its warp is still compared.
    let sold_first = psd_with_blocks(&[
        block(b"SoLd", &sold_payload(&valid_sold_items(&[]))),
        block(b"PlLd", &plld_payload(&IDENTITY_TRANSFORM, &curve)),
    ]);
    assert_rejected_with_conflict(&sold_first);
}

#[test]
fn agreeing_dual_blocks_and_neutral_legacy_warps_stay_importable() {
    // Both blocks carry the same curve: no divergence, still curve-eligible.
    let curve = curve_warp_items();
    let sold_with_curve = valid_sold_items(&[field("warp", Item::Obj(curve.clone()))]);
    let bytes = psd_with_blocks(&[
        block(b"PlLd", &plld_payload(&IDENTITY_TRANSFORM, &curve)),
        block(b"SoLd", &sold_payload(&sold_with_curve)),
    ]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    assert!(inspection.smart_objects[0].curve.is_some());
    assert_eq!(
        inspection.smart_objects[0].importability,
        PsdSmartObjectImportability::CurveEligible
    );

    // A neutral legacy warp loses nothing.
    let bytes = psd_with_blocks(&[
        block(
            b"PlLd",
            &plld_payload(&IDENTITY_TRANSFORM, &neutral_warp_items()),
        ),
        block(b"SoLd", &sold_payload(&valid_sold_items(&[]))),
    ]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    assert_eq!(
        inspection.smart_objects[0].importability,
        PsdSmartObjectImportability::Eligible
    );
}

#[test]
fn quilt_shadowed_plain_warp_is_reported_when_it_diverges() {
    // quiltWarp governs; the shadowed plain warp carries a different
    // deformation, which must surface as a conflict on top of the quilt
    // rejection.
    let items = valid_sold_items(&[
        field("warp", Item::Obj(carrying_warp_items(0.5))),
        field(
            "quiltWarp",
            Item::Obj(vec![
                field("warpStyle", Item::Enum("warpStyle", "warpCustom")),
                field("warpValue", Item::Doub(0.75)),
                field("deformNumRows", Item::Doub(3.0)),
            ]),
        ),
    ]);
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    match &inspection.smart_objects[0].importability {
        PsdSmartObjectImportability::Unsupported { reasons } => {
            assert!(reasons.contains(&PsdSmartObjectRejection::QuiltWarp));
            assert!(reasons.contains(&PsdSmartObjectRejection::ConflictingWarpBlocks));
        }
        other => panic!("expected quilt conflict rejection, got {:?}", other),
    }

    // An equivalent shadowed plain warp adds no conflict of its own.
    let items = valid_sold_items(&[
        field("warp", Item::Obj(carrying_warp_items(0.5))),
        field(
            "quiltWarp",
            Item::Obj(vec![
                field("warpStyle", Item::Enum("warpStyle", "warpCustom")),
                field("warpValue", Item::Doub(0.5)),
            ]),
        ),
    ]);
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    match &inspection.smart_objects[0].importability {
        PsdSmartObjectImportability::Unsupported { reasons } => {
            assert!(reasons.contains(&PsdSmartObjectRejection::NonNeutralWarp));
            assert!(!reasons.contains(&PsdSmartObjectRejection::ConflictingWarpBlocks));
        }
        other => panic!("expected plain non-neutral rejection, got {:?}", other),
    }
}

// ---------------------------------------------------------------------------
// Non-finite values and real fixtures
// ---------------------------------------------------------------------------

#[test]
fn non_finite_warp_and_transform_values_fail_closed() {
    let items = valid_sold_items(&[field(
        "warp",
        Item::Obj(vec![
            field("warpStyle", Item::Enum("warpStyle", "warpCustom")),
            field("warpValue", Item::Doub(f64::NAN)),
        ]),
    )]);
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    assert!(inspection.smart_objects[0].curve.is_none());
    match &inspection.smart_objects[0].importability {
        PsdSmartObjectImportability::Unsupported { reasons } => {
            assert!(reasons.contains(&PsdSmartObjectRejection::NonNeutralWarp));
        }
        other => panic!("expected non-finite warp rejection, got {:?}", other),
    }

    let items = vec![
        field("Type", Item::Long(0)),
        field(
            "Trnf",
            Item::List(vec![
                Item::Doub(0.0),
                Item::Doub(f64::INFINITY),
                Item::Doub(64.0),
                Item::Doub(0.0),
                Item::Doub(64.0),
                Item::Doub(64.0),
                Item::Doub(0.0),
                Item::Doub(64.0),
            ]),
        ),
        field(
            "Sz  ",
            Item::Obj(vec![
                field("Wdth", Item::Doub(64.0)),
                field("Hght", Item::Doub(64.0)),
            ]),
        ),
    ];
    let bytes = psd_with_blocks(&[block(b"SoLd", &sold_payload(&items))]);
    let inspection = inspect_psd_smart_objects(&bytes).unwrap();
    match &inspection.smart_objects[0].importability {
        PsdSmartObjectImportability::Unsupported { reasons } => {
            assert!(reasons.contains(&PsdSmartObjectRejection::NonFiniteTransform));
            assert!(inspection.smart_objects[0].raw_transform.is_none());
        }
        other => panic!("expected non-finite transform rejection, got {:?}", other),
    }
}

#[test]
fn real_photoshop_psd_and_psb_fixtures_still_inspect_eligible() {
    let fixtures: [&[u8]; 2] = [
        include_bytes!("fixtures/photoshop-cc-placed-layer.psd"),
        include_bytes!("fixtures/photoshop-cc-placed-layer.psb"),
    ];
    for bytes in fixtures {
        let inspection = inspect_psd_smart_objects(bytes).unwrap();
        assert_eq!(inspection.smart_objects.len(), 3);
        assert!(
            inspection
                .smart_objects
                .iter()
                .all(|object| object.importability == PsdSmartObjectImportability::Eligible)
        );
    }
}

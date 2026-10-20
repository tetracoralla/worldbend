# ag-psd (Worldbend vendored copy)

This is a vendored copy of the `ag-psd` Rust crate, patched by Worldbend.
The unmodified upstream README is kept as `README.upstream.md`.

- **Upstream**: https://github.com/Vasyanator/ag-psd-rs (Rust port of the
  TypeScript `ag-psd` library).
- **Vendored version**: `ag-psd` 0.2.0 from crates.io, downloaded from
  <https://static.crates.io/crates/ag-psd/ag-psd-0.2.0.crate>. The upstream
  `LICENSE` (MIT) is retained. The vendored Rust sources were normalized with
  this workspace's `rustfmt`; semantic changes remain confined to regions
  marked `WORLDBEND-PATCH`. 0.3.0 (2026-09-06) was checked and still reserves
  storage from declared lengths before bounds checks, so it does not close the
  gap.
- **Consumed by**: `crates/worldbend-interop` through the workspace
  `ag-psd = { path = "third_party/ag-psd" }` dependency, and the
  `psd-import` WASM profile built from it. No other carrier carries the
  parser.
- **Scope rule**: this copy stays a narrow patched mirror of upstream. Every
  Worldbend change is marked with a `WORLDBEND-PATCH` comment and keeps the
  upstream behavior for well-formed files. Do not grow Worldbend product
  semantics here; canonical geometry and validation live in `worldbend-core`.

## Why the copy exists

Upstream reserves memory from untrusted length fields before checking how
many bytes remain (`Vec::with_capacity`/`String::with_capacity` in
`read_unicode_string_with_length{,_le}` and `read_ascii_string`, the
zero-filling recovery branch of `read_bytes`, and layer/channel-count
reservations), recurses into descriptors with no depth cap
(`read_descriptor_structure` ↔ `read_os_type`), recurses in engine-data
decoding (`decode_obj`), and indexes past the buffer in engine-data
`get_text_byte`. A malformed ~5 KiB PSD with one crafted length can make the
WASM build abort or exhaust memory before any byte is read. Input size caps,
bitmap budgets and post-parse layer limits cannot bound those allocations,
and catching a trap is not a rejection.

The patches enforce budgets **before** allocation and recursion:

- `reader.rs`: checked arithmetic plus remaining-byte checks in front of
  every reservation sized by file data; the `read_bytes` recovery branch
  charges a shared, non-refunded allocation budget; layer/channel/layer-info
  reservations are clamped to what the remaining bytes can describe.
- `reader.rs` + `descriptor.rs`: a shared descriptor/list nesting depth cap and a
  shared parse-item budget covering descriptor items, list/reference items
  and object-array items; exhaustion is a typed `ReadError`, never a trap or
  OOM.
- `engine_data.rs`: the escaped-byte reader no longer indexes past the
  buffer; `engine_data2.rs::decode_obj` carries an explicit depth cap.
- `smart_object_keys.rs`: `read_plld` keeps the legacy warp in
  `LayerAdditionalInfo::plld_warp` even when the `SoLd` merge precedence
  drops it, and `read_sold` records a plain `warp` descriptor shadowed by
  `quiltWarp` in `LayerAdditionalInfo::shadowed_warp`, so
  `worldbend-interop` can reject diverging or hidden warp sources instead
  of importing an unnoticed neutral.
- `psd.rs`: `ReadOptions` gains `parse_item_budget` and
  `recovery_allocation_budget` fields; `PsdReader` carries the corresponding
  live counters. Defaults preserve upstream behavior (unlimited) for library
  callers; Worldbend sets both.

## Upgrading

1. Download the new `.crate` from static.crates.io and unpack it over this
   directory, then re-add this checkout's integration points: keep the
   crate listed in the root workspace `members` (it does not carry its own
   `[workspace]` table here) and re-check `Cargo.toml`'s `exclude`/member
   state.
2. Re-apply every `WORLDBEND-PATCH` region: search this directory for the
   marker. If upstream adopted an equivalent guard, prefer theirs and delete
   ours; record the decision in the patch list above.
3. Run `cargo test -p worldbend-interop` and the
   `packages/wasm/pkg-psd-import` probes referenced in
   `docs/PSD_SMART_OBJECT_INTEROP_CONTRACT.md`.

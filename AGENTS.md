# Worldbend transform repository contract

Read `docs/PRODUCT_MODEL.md`, `docs/CONTRACT.md`,
`docs/REVIEW_CONTRACT.md`, and `docs/CAMPAIGN_ANCHOR.md` before changing the
core, schemas, adapters, plugin, or packaging. Use the review contract for
current cross-carrier seams, adversarial sequences, performance/load evidence,
and conditional Capability review; it is not a completion certificate.

- This product is growing into a deterministic Photoshop-familiar transform
  utility for humans and Agents, not a general image editor. The productized
  source superset includes explicit affine/projective mapping, Canvas,
  Place/Mockup, bounded custom Mesh and Surface Deformation,
  Lens/Displacement Remap, ordered Timeline and rational-time Motion, Spatial
  Template/Variation, production media/vector/tiling, narrow PSD Smart Object
  projection, and an explicitly selected assisted-perception Provider.
  Unbounded arbitrary deformation, implicit perception application,
  camera/motion estimation, and adapter-local simulation remain outside those
  contracts.
- `worldbend-core` owns `TransformSpec`, semantic affine composition, corner
  semantics, validation, homography solving, diagnostics, inversion, bounds,
  and CSS geometry. CLI, MCP, Web/WASM, and Figma are adapters; they must not
  invent a second transform model.
- Corner order is strict `TL -> TR -> BR -> BL`. Never silently reorder Agent
  input. Reject non-finite, self-intersecting, concave, degenerate, short-edge,
  singular, or projective-horizon-crossing mappings with stable error codes.
  Horizontal/vertical flip flows only through the explicit
  `content.orientation` / `TransformRecipe.flip` source-orientation contract;
  it must never be faked by mirrored destination corner order.
- Rasterization uses inverse mapping, pixel extents `[0,width] x [0,height]`,
  pixel centers `(x+0.5,y+0.5)`, premultiplied-alpha filtering, and transparent
  samples outside the source.
- Agent paths are capabilities. MCP relative paths resolve under its explicit
  granted root and must reject absolute, parent, URI, symlink, and non-regular
  source escapes. CLI paths remain deliberate human/operator arguments.
- Preflight destination, overwrite authority, output limits, and return bounds
  before publishing a render. Dry-run must execute the same preflight without
  writing.
- High-frequency Agent use makes tail latency, sustained concurrency,
  backpressure, bounded queueing, cancellation cleanup, recovery, complete
  schema/result bytes, and total tool-call/context cost part of the product
  boundary. Historical microbenchmarks are observations, not SLAs. Worldbend
  currently has no public batch operation; adding one requires explicit order,
  input correlation, partial-failure, cumulative-budget, fairness,
  cancellation, and publication semantics before implementation.
- The experimental Capability projection is conditional and narrower than the
  product contract. Its provider manifest, schema snapshots, adapter acceptance
  surface, transport digests, closed errors, and real-boundary conformance must
  agree; it must not silently accept product-only fields or imply independent
  substitutability.
- The Figma surface is local and task-native. Keep implementation metadata,
  tool names, schemas, and Agent workflow out of the human UI. Figma raster
  outputs must respect the current 4096 px per-axis image limit.
- Preserve the complete dirty worktree. Do not commit, push, publish, deploy,
  or discard changes unless the owner explicitly asks.
- Report development regression, runtime Agent flow, runtime human flow, and
  owner business/experience acceptance separately.

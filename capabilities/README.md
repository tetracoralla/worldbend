# Portable Capability provider

This directory is Worldbend's provider-facing boundary for the experimental
Agent Capability Substrate.

- `schemas/` snapshots the provider-neutral
  `org.openadam.projective.transform@0.2.0` operation contracts;
- `provider.json` binds the neutral `inspect` and `render` operations to the
  current MCP transport with binary-relative commands and records profile and
  transport schema digests separately;
- the compiled `worldbend-capability` adapter accepts bounded JSONL requests,
  enforces an explicit workspace grant for file operations, converts the
  neutral `projective.transform` envelope into Worldbend's product-owned
  `worldbend.transform` `TransformSpec`, invokes the real `worldbend`
  executable, and projects its richer results and errors into the narrower
  profile;
- the compiled `worldbend-transport-schema-probe` reacquires the installed
  MCP input schemas without Node or the source checkout;
- `pnpm capability:check` builds the owning binaries, runs real adapter and
  probe requests, and fails on local Profile or live MCP input-schema drift;
- plugin staging copies this complete directory beside the four release
  binaries, and the installed-plugin check rereads and executes it from the
  Codex cache.

The canonical capability definition and central conformance suite live in the
separate `capability-contracts` standard repository. The copied schemas here
make the provider contract reviewable and checkable without making that
repository a runtime dependency.

The profile owns only explicit geometry inspection and bounded local raster
rendering. Worldbend's core remains authoritative for corner order, validation,
homography, raster behavior, limits, and evidence. Web/Figma editor state,
preview interaction, CSS emission, and source-selection UX stay product-owned.
The current Profile does not declare `content.orientation` or `content.warp`;
the local strict adapter rejects either product-only member instead of
silently widening its acceptance surface.
Procedure layers may compose this provider, but they do not become a second
geometry model or gain implicit plane-detection authority.

This is a provider-seeded experimental profile. Passing the current provider
and central conformance checks proves this implementation against the current
profile; it does not by itself prove cross-provider substitutability.

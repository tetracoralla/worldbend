# Contributor guidance

Worldbend uses one canonical Rust geometry model. CLI, MCP, Web/WASM and Figma
adapt its versioned contracts. Keep validation, transform meaning and stable
errors in the owning core instead of duplicating them in adapters.

Read README.md for build commands and supported entry points, docs/CONTRACT.md
for shared semantics, and the affected feature contract for its exact scope.
Inspect unchanged callers and generated projections when changing a public type.
Run focused regressions and the applicable checks in CONTRIBUTING.md.

Preserve unrelated work. Keep credentials, private artwork, local paths,
conversation excerpts, internal planning and temporary evidence outside commits
and distribution packages. Inspect actual package contents before publication.
Use synthetic or properly licensed fixtures, retaining their provenance.

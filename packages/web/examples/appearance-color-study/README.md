# Color study

Compare one authored backdrop through unfiltered, compensated Web glass,
color-preserving Web glass and explicit frost fallback. The four foreground
actions keep their original DOM and handlers. Exposed refraction, frost and
dispersion controls use the existing local receiving sessions without a planner
or model call per frame.

Build `@worldbend/web` and the source MCP, then run
`node scripts/generate-appearance-color-study.mjs`. Serve `packages/web` and
open `examples/appearance-color-study/`. `--check` verifies the source receipts.

The receiving application's `worldbendColorStudy.getState()` exposes its current
sessions. `receiveFaithfulUpdate(plan, source)` accepts the ordinary
`appearance_update` result plus the pure new source delivery for the faithful
surface. It delegates revision/preference guards to the same shared binding;
it is an example application action, not another material protocol.

Color preservation omits global saturation/brightness treatment. Authored
dispersion, frost and edge lighting retain their visual effects. Refraction
must still displace edge detail; blur alone does not prove optical support.
The explicit fallback discloses adapted displacement controls while retaining
their saved canonical values. CSS feature probing alone cannot verify every
browser's visual filter support.

Artwork and construction are first-party and covered by the repository license.

# Worldbend campaign anchor

Last updated: 2026-08-30

## Objective

Prepare Worldbend as a trustworthy commercial pre-release: keep its source in
a private GitHub repository with no Worldbend product license declaration,
ship the Figma surface through Figma Community as a paid plugin, and preserve
one deterministic transform model across human and Agent carriers.

## Fixed product boundary

- The core maps one normalized plane to an explicit convex destination quad,
  composes semantic affine adjustments, and supports one of ten fixed Warp
  presets.
- Corner order is `TL -> TR -> BR -> BL`; source flips use the explicit source
  orientation contract and never mirrored destination order.
- Native rasterization uses inverse mapping, pixel centers, premultiplied-alpha
  filtering, transparent outside samples, bounded resources, private staging,
  and atomic publication.
- CLI, MCP, Web/WASM, Figma, and the conditional Capability projection adapt
  the same core.
- Perception, camera estimation, 3D, custom meshes, arbitrary deformation,
  vector-preserving Figma output, video, cloud services, and public batch
  semantics remain outside the current release.

## Current campaign state

The product and repository identity is **Worldbend**. Stable geometry and Agent
interoperability identifiers such as `ProjectiveSpec`,
`projective.transform`, and the existing Capability ID remain technical
contract names; they are not a second product brand or a customer-facing old
name.

The Web canvas fitting repair is committed locally. It keeps manual zoom and
pan independent from handle dragging: dragging never auto-zooms the canvas,
while Fit and manual zoom can bring off-canvas handles back into view. The
interactive corner radius is screen-space stable, so manual zoom does not make
handles unusably small or large.

The commercial Figma access boundary is implemented but not yet submitted.
The complete plugin is available for seven days from first use. After that,
Apply invokes Figma's native one-time checkout; paid customers continue, while
checkout dismissal or an unavailable payment status leaves the edit and Figma
document unchanged. Editing and preview are not paywalled. The selected launch
price is USD 12 one-time, with no subscription or product-owned cloud service.
Figma Desktop generated and accepted plugin ID `1675767923532475446`. A real
in-trial Apply on the final manifest created a `· Worldbend` result, and the
required 128 x 128 icon plus two real-runtime 1920 x 1080 listing images are in
`assets/figma-community/`.

Worldbend's own Apache-2.0 declarations and product license files are removed
from the release tree. Locked third-party dependency notices, license
texts, and SPDX inventory remain because binary redistribution obligations are
separate from the Worldbend product-license decision.

The final private-source tree passes the complete `pnpm check`: 139 Rust tests,
154 Web tests, 123 Figma tests, 2 repository script tests, formatting,
warnings-denied lint, schemas, typechecks, real WASM builds, Figma packaging,
plugin validation, built CLI/MCP runtime behavior, Capability conformance, and
built-artifact inspection.

The source is hosted at the private `tetracoralla/worldbend` GitHub repository.
Its first remote baseline is one clean root commit and the repository reports
no detected Worldbend product license. The complete earlier development
history remains recoverable only from the verified ignored local Git bundle;
it was not pushed to GitHub.

GitHub's hosted CodeQL code-scanning upload is not available for this personal
private repository without GitHub Code Security. The workflow therefore names
and records that private-repository boundary instead of reporting a failed or
misleading security scan. It automatically runs the JavaScript/TypeScript and
Rust analyses if the repository becomes public. The independent three-platform
`clean-checkout` workflow remains the hosted regression check while private.

## Required current checks

1. Regenerate the Web contract and require a clean contract check.
2. Run the complete `pnpm check` workflow from the final private-source tree.
3. Exercise real built CLI/MCP behavior, path and publication negatives,
   cancellation cleanup, Web/Figma browser interaction, and package inventory.
4. Verify the Figma denied-payment sequence performs no document mutation and
   the paid/in-trial routes still create and replace results correctly.
5. Audit current source, Git history, dependency licenses, generated artifacts,
   and unwanted/private material.
6. Preserve the earlier history in a verified local bundle, keep the hosted
   baseline private, and verify the remote revision and visibility after each
   release push.
7. In Figma Desktop, generate or confirm the development plugin ID, test the
   exact submitted build, prepare real listing media, and submit only after the
   owner confirms the required publisher/payee and support-contact facts.

## Completion lanes

- **Development regression:** formatting, lint, tests, types, builds, schemas,
  package, and conformance checks must pass on current source.
- **Runtime Agent flow:** built CLI, MCP, staged plugin, cancellation, limits,
  paths, and artifact publication must pass against real boundaries.
- **Runtime human flow:** Web and packaged Figma interactions must pass through
  real browser/host events; unavailable host-only checks are `BLOCKED`, not
  inferred from static tests.
- **Private source distribution:** remote visibility is private, pushed history
  has a clean root, and the prior local history is recoverable but not hosted.
- **Figma commercial distribution:** payment mode, price, trial, plugin ID,
  publisher/payee, support contact, submitted revision, and review state are
  recorded from Figma's current system.
- **Business/experience acceptance:** remains an owner judgment, separate from
  technical checks and Figma review.

## Authority and safeguards

The owner authorized a private GitHub repository and commercial Figma plugin.
That authorizes creation and push of the private repository and preparation of
the Figma submission. It does not authorize inventing identity, tax, payout,
support-contact, or jurisdiction facts, accepting terms on the owner's behalf,
publishing the source publicly, or adding a Worldbend open-source license.

Do not publish local paths, internal review traces, generated build trees,
credentials, or unverified binary artifacts. Keep third-party legal inventory
accurate even though Worldbend itself has no declared product license.

## Remaining action

- Keep the private GitHub baseline aligned with the verified current source and
  require the three-platform clean-checkout workflow to finish successfully.
- Complete the Figma listing form. Stop only at the real owner-account boundary
  for the public Community handle and support contact, publisher/payee choice,
  tax, Stripe, two-factor authentication, or submission terms.

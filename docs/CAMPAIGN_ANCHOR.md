# Worldbend campaign anchor

Last updated: 2026-08-30

## Objective

Keep Worldbend source in a private GitHub repository with no Worldbend product
license declaration, release the complete Figma surface through Figma
Community for free, and preserve one deterministic transform model across
human and Agent carriers.

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

The Web canvas fitting repair keeps manual zoom and pan independent from handle
dragging: dragging never auto-zooms the canvas, while Fit and manual zoom can
bring off-canvas handles back into view. The interactive corner radius is
screen-space stable, so manual zoom does not make handles unusably small or
large.

The Figma release decision is now free. The implementation removes the trial,
checkout, payment-state checks, purchase copy, and Payments API permission.
The manifest declares no network domains and no extra permissions. Free
distribution does not make the private GitHub source public and does not grant
a Worldbend product license.

Figma Desktop generated plugin ID `1675767923532475446`. The required 128 x
128 icon plus two real-runtime 1920 x 1080 listing images are in
`assets/figma-community/`. The exact free manifest completed a real Figma
Desktop Apply without a Payments API and created a new `· Worldbend` result.
The current source passes the complete `pnpm check`: 139 Rust tests, 154 Web
tests, 117 Figma tests, 10 repository script tests, formatting, lint, contract
drift, types, real WASM/Figma builds, package inventory, built CLI/MCP smoke,
and Capability conformance. Figma received the Community submission for source
revision `3802586074897523d97127ad328db766e6aa669e`; its private review page is
`https://www.figma.com/community/plugin/1675767923532475446/worldbend`. Only
the publisher can see it until Figma approves the plugin.

Figma confirmed the `worldbend` Community handle and displays the listing as a
free plugin under its default Community Free Resource License. That platform
distribution license permits use inside Figma while restricting redistribution
and reverse engineering; it does not publish or license the private GitHub
source. No selling, Stripe, tax, payout, price, trial, banking, backend,
analytics, authentication, or network configuration was created.

Worldbend's own Apache-2.0 declarations and product license files are absent
from the release tree. Locked third-party dependency notices, license texts,
and SPDX inventory remain because binary redistribution obligations are
separate from the Worldbend product-license decision.

The source is hosted at the private `tetracoralla/worldbend` GitHub repository.
Its first remote baseline is one clean root commit and the repository reports
no detected Worldbend product license. The complete earlier development
history remains recoverable only from the verified ignored local Git bundle;
it was not pushed to GitHub.

GitHub's hosted CodeQL code-scanning upload is not available for this personal
private repository without GitHub Code Security. The workflow records that
private-repository boundary and automatically analyzes JavaScript/TypeScript
and Rust if the repository becomes public. Normal pushes run one complete
Ubuntu clean-checkout check plus a lightweight Windows portability check; a
manual dispatch can run the complete check on Ubuntu, macOS, or Windows.

## Required current checks

1. Regenerate the Web contract and require a clean contract check.
2. Run the complete `pnpm check` workflow from the final private-source tree.
3. Exercise real built CLI/MCP behavior, path and publication negatives,
   cancellation cleanup, Web/Figma browser interaction, and package inventory.
4. Verify the free Figma build can create and replace a result without a
   Payments API and that the exact manifest has no extra permissions.
5. Audit current source, Git history, dependency licenses, generated artifacts,
   and unwanted/private material.
6. Preserve the earlier history in a verified local bundle, keep the hosted
   source private, and verify the remote revision and visibility after each
   release push.
7. In Figma Desktop, test the exact submitted build, confirm the listing media,
   set the listing to Free, complete truthful data-security answers, and submit
   from the owner's real Community profile.

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
- **Figma Community distribution:** Free status, plugin ID, publisher, support
  contact, submitted revision, listing URL, and review state are recorded from
  Figma's current system.
- **Business/experience acceptance:** remains an owner judgment, separate from
  technical checks and Figma review.

## Authority and safeguards

The owner authorized a private GitHub repository and a free Figma Community
publication. This authorizes updating and pushing the private repository,
setting the listing to Free, and submitting the reviewed plugin through the
owner's existing Figma profile. It does not authorize inventing identity or
support-contact facts, accepting unreviewed legal terms on the owner's behalf,
publishing source publicly, or adding a Worldbend open-source license.

Do not publish local paths, internal review traces, generated build trees,
credentials, or unverified binary artifacts. Keep third-party legal inventory
accurate even though Worldbend itself has no declared product license.

## Remaining action

- Wait for Figma's review decision. Approval time varies and Figma documents a
  possible review window of up to two weeks.
- After approval, verify the public page and install the approved build through
  the Community listing before sharing the URL with company designers.

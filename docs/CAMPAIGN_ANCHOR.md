# Worldbend campaign anchor

Last updated: 2026-08-31

## Objective

Keep Worldbend source in a private GitHub repository with no Worldbend product
license declaration, release the complete Figma surface through Figma
Community for free, add a self-contained local ComfyUI execution route, and
preserve one deterministic spatial-processing core across human, Agent, and
workflow carriers.

## Fixed product boundary

- The core maps one normalized plane to an explicit convex destination quad,
  composes semantic affine adjustments, and supports one of ten fixed Warp
  presets.
- The separate `worldbend.rectify@0.1` operation maps one caller-supplied
  source quad to caller-supplied integer output dimensions. It does not detect
  a plane, infer aspect ratio, estimate a camera, or choose an operation for an
  Agent.
- The separate `worldbend.canvas@0.1` and ordered
  `worldbend.canvas-set@0.1` operations execute caller-supplied Crop, Trim,
  Pad, Contain, Cover, or Stretch programs. They do not select a crop, infer a
  ratio, identify content, or choose output variants.
- Corner order is `TL -> TR -> BR -> BL`; source flips use the explicit source
  orientation contract and never mirrored destination order.
- Native rasterization uses inverse mapping, pixel centers, premultiplied-alpha
  filtering, transparent outside samples, bounded resources, private staging,
  and atomic publication.
- CLI, MCP, Web/WASM, Figma, the local ComfyUI nodes, and the conditional
  Capability projection adapt the same core.
- Perception, camera estimation, content-aware expansion, 3D, custom meshes,
  arbitrary deformation, vector-preserving Figma output, video, cloud
  services, and public batch semantics remain outside the current release.

## Current campaign state

The product and repository identity is **Worldbend**. Stable geometry and Agent
interoperability identifiers such as `ProjectiveSpec`,
`projective.transform`, and the existing Capability ID remain technical
contract names; they are not a second product brand or a customer-facing old
name.

The ComfyUI phase now has seven experimental V3 nodes under
`packages/comfyui`: two validate/apply a reusable TransformSpec, two
validate/apply an explicit RectifySpec, and three validate an ordered Canvas
Set, apply it once to heterogeneous IMAGE/MASK lists, and replay the resolved
Plan on a same-shape 8-bit control raster. Python contains no transform,
rectification, or Canvas geometry. The adapter rejects batches and video,
caps individual rasters at 8192 pixels per axis and 32 Mi pixels, narrows one
Canvas Set to 16 Mi output pixels cumulatively, polls Comfy cancellation,
enforces a 120-second child deadline, and preserves native stable errors.

`pnpm test:comfyui` currently passes 24 tests. Four Canvas cases cross the real
native boundary and check ordered heterogeneous dimensions and alpha, returned
file metadata, Trim replay without re-trimming, and pre-publication 16-MiP
rejection. The local package includes three API workflow examples alongside a
reduced executable exposing only `inspect`, `render`, `rectify`,
`rectify-render`, `canvas-inspect`, and `canvas-render`, plus a checksum
manifest, legal notices, copied dependency licenses, and SPDX inventory. The
current `darwin-arm64` archive is 1,540,790 bytes with SHA-256
`d9918326a309549c3eebe6d9130f772e396688d5a6bd430a5cc1f5445182b888`;
the unpacked package is 3,421,864 bytes and its reduced executable is 2,003,600
bytes. These identify only the locally built package and do not establish
Comfy host loading or a cross-platform release.
No ComfyUI installation is present on this machine, so V3 host registration and
a real workflow remain unobserved rather than inferred from the source or
package.

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
128 icon plus the owner's final two real-runtime recordings and one static
plugin screenshot are in `assets/figma-community/`. The exact free manifest completed a real Figma
Desktop Apply without a Payments API and created a new `· Worldbend` result.
The current source passes the complete `pnpm check`: Rust workspace tests,
Web and Figma tests, repository script tests, formatting, lint, contract drift,
types, real WASM/Figma builds, package inventory, built CLI/MCP smoke, and
Capability conformance. The current local Figma package includes the
unpublished rectification and Canvas workspaces. Its archive is 427,045 bytes
with SHA-256
`1e8dae7506cf38cc563b2d9bc88c9a4c4a9fb1f9324b90d64dba13839f29f84d`;
runtime entries total 390,747 bytes and the unpacked package is 966,258 bytes.
An isolated Chromium run exercised the compressed-WASM Canvas round trip, but
this exact package has not been run in Figma Desktop or uploaded to the
existing Community listing. Figma received the earlier Community submission
for source revision
`3802586074897523d97127ad328db766e6aa669e6`; its private review page is
`https://www.figma.com/community/plugin/1675767923532475446/worldbend`. Only
the publisher can see it until Figma approves the plugin.

Figma confirmed the `worldbend` Community handle and displays the listing as a
free plugin under its default Community Free Resource License. That platform
distribution license permits use inside Figma while restricting redistribution
and reverse engineering; it does not publish or license the private GitHub
source. No selling, Stripe, tax, payout, price, trial, banking, backend,
analytics, authentication, or network configuration was created.

The first uploaded runtime images were found to retain Figma's app tab bar.
They were removed before approval. The owner then rejected the replacement
crops because they still showed the host canvas, a Computer Use pointer, and
an unhelpful in-progress Apply moment. The final owner-captured media shows
only the plugin surface: one Free/Perspective recording, one Transform
recording, and one completed Transform screenshot. The owner removed the old
media, accepted the final presentation, and submitted it on 2026-08-30. The
current owner-only Community page shows three preview items, remains private
while in review, and still reports Version 2 because the media-only update did
not resubmit the plugin package.

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
8. Run the Comfy adapter test through the built native binary, validate the
   self-contained package inventory, then separately exercise installed V3
   registration and the example workflow in a real ComfyUI host.

## Completion lanes

- **Development regression:** formatting, lint, tests, types, builds, schemas,
  package, and conformance checks must pass on current source.
- **Runtime Agent flow:** built CLI, MCP, staged plugin, cancellation, limits,
  paths, and artifact publication must pass against real boundaries.
- **Runtime human flow:** Web and packaged Figma interactions must pass through
  real browser/host events; unavailable host-only checks are `BLOCKED`, not
  inferred from static tests.
- **Runtime ComfyUI flow:** installed V3 discovery, IMAGE/MASK execution,
  cancellation, cleanup, repeat reuse, and workflow residual state must be
  observed in a real host; source/native tests and package checks are separate.
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
publishing source publicly, adding a Worldbend open-source license, creating a
Comfy Registry publisher identity, or publishing a Comfy node pack.

Do not publish local paths, internal review traces, generated build trees,
credentials, or unverified binary artifacts. Keep third-party legal inventory
accurate even though Worldbend itself has no declared product license.

## Remaining action

- Wait for Figma's review decision. Approval time varies and Figma documents a
  possible review window of up to two weeks.
- After approval, verify the public page and install the approved build through
  the Community listing before sharing the URL with company designers.
- Install the staged ComfyUI package in a real supported host and close the V3
  registration/workflow/cancellation lane. Until then that lane is `BLOCKED`.
- After real Comfy dogfood, promote the smallest repeated deterministic
  graphics task that removes Agent reasoning or manual reconstruction. Do not
  infer Registry release readiness or video/batch semantics from the local
  single-image package.

## Completed deterministic plane-rectification batch

The next productized slice is explicit planar rectification. Worldbend accepts
one caller-authored source quadrilateral in strict `TL -> TR -> BR -> BL`
order plus explicit integer output dimensions, validates and solves that
mapping in `worldbend-core`, and renders the selected plane into the declared
output rectangle through the shared native sampler. The result is a reusable
rectification plan and an identity `TransformSpec` for the newly flattened
output; the rectification is not hidden inside `TransformSpec` because the
projective continuation outside the selected source plane may cross a horizon.

The phase completion line is current core/CLI/MCP/WASM behavior, thin Figma and
ComfyUI projections where their runtime shapes are compatible, updated public
contracts, and fresh affected plus complete development regression checks.
Adapters may parse platform values, move bytes, and manage host state, but may
not detect a plane, infer aspect ratio, solve geometry, or sample pixels.

Out of scope for this batch: automatic edge/plane/vanishing-point detection,
camera pose or lens estimation, content-aware fill, non-planar deformation,
video or implicit IMAGE batches, and any Agent policy or workflow planner.
Agent hosts remain free to decide when and how to call the deterministic
program; that routing is not part of the Worldbend core or product promise.

## Completed carrier-isolation foundation

The pre-expansion foundation is current in the dirty working tree. One closed
`config/carrier-profiles.json` now drives surface declarations, package
inventories, forbidden cross-carrier files, the Figma byte ceilings, and the
Agent tool-catalog ceiling. Figma builds a no-CSS WASM profile; Web and Agent
retain CSS. Comfy builds the same CLI source under a `comfy` feature and its
package rejects the four full-only commands. Package scripts and built-artifact
checks consume the same profile rather than duplicating those boundaries.

The existing Figma `perspective` workspace is frozen as the current operation
sequence Transform, Free, Perspective, Warp, Correct, More. This is a
compatibility baseline, not a promise that the whole plugin can never grow.
Future Place/Mockup or Mesh work enters separate task workspaces and does not
append controls to the mature Perspective or Canvas surfaces. The
self-contained Figma artifact may remain one inlined HTML file while source
modules and heavy initialization stay workspace-owned.

Baseline measurements after the profile change and before Canvas
implementation:

- Figma runtime entries: 524,692 bytes against a 655,360-byte ceiling;
- Figma unpacked package: 1,100,203 bytes against a 2,097,152-byte ceiling;
- Figma archive: 430,475 bytes against a 524,288-byte ceiling, SHA-256
  `43cb6981c15ca1c269ce4fbe2ba9e29bde7fef73ee9cd6dbe76d6d1050f2f5ab`;
- full Web WASM: 250,051 bytes; Figma no-CSS WASM: 242,195 bytes;
- reduced Comfy native executable on `darwin-arm64`: 1,753,936 bytes;
- reduced Comfy archive: 1,429,709 bytes, SHA-256
  `7e07bbc4e618b9a0d94b6341c1642eb12d5c9ce398a911d5abd302e809ffa2c6`.

These measurements establish only local build/package facts. The Figma package
still needs any applicable installed-host regression after product changes;
Comfy V3 registration and workflows remain `BLOCKED` until observed in a real
supported host. No source commit, push, package publication, Registry release,
or Figma resubmission is authorized by this foundation.

## Completed owner-authorized Canvas and multi-output batch

On 2026-08-31 the owner enabled Ultra and explicitly authorized the controlled
multi-agent Canvas/multi-output stage. The shared contract is
`docs/CANVAS_CONTRACT.md`; all three implementation lanes now consume that one
model rather than defining carrier-local geometry.

The frozen slice is deterministic only: six closed Canvas operations, ordered
Canvas Sets whose variants all read the original raster, resolved same-size
Plan replay, explicit sampling/background behavior, bounded outputs, and
all-or-none directory publication. Worldbend does not select a crop, infer a
ratio, detect content, plan an Agent workflow, or reinterpret an upstream
control map.

Completed implementation and current checks:

- `worldbend-core` owns the six closed operations, ordered sets, canonical
  resolved Plans, strict replay, stable errors, and product ceilings;
- the native renderer decodes once, renders every variant from the original,
  supports exact Trim replay, polls cancellation, and publishes a new
  directory with one no-replace rename;
- CLI exposes `canvas-inspect` and `canvas-render`; MCP exposes one eighth
  `worldbend.canvas_render` tool with a 32-MiP set limit, 128-MiB encoded-set
  ceiling, complete-response preflight, bounded queueing, isolated worker, and
  descriptor-scoped paths;
- Figma exposes Canvas as a replacing sibling workspace with 1..8 explicit
  Contain/Cover variants, 3x3 anchors, transparent/solid backgrounds, one
  core-planned active preview, separate state/history, renderer teardown, and
  recoverable create/replace publication. Perspective retains the checked
  Transform, Free, Perspective, Warp, Correct, More sequence;
- Comfy exposes three Canvas V3 nodes and invokes one reduced native process
  for the complete ordered set or Plan replay;
- complete `pnpm check`, `pnpm test:comfyui`, and local Comfy packaging pass.
  The built Agent catalog is 79,582 bytes; runtime smoke observed two worker
  slots, two overload rejections, 7-ms ordinary cancellation cleanup, and 7-ms
  Canvas cancellation cleanup. The staged Agent plugin files total 10,125,778
  bytes and contain no Figma HTML/CSS or Comfy Python;
- current Figma measurements are 390,747 runtime bytes, 427,045 archive bytes,
  and 966,258 unpacked bytes, all inside the unchanged profile ceilings. The
  no-CSS Figma WASM is 340,713 bytes and is stored as a compressed inlined
  payload; an isolated real Chromium round trip passed.

The exact changed build has not been exercised inside Figma Desktop, and no
ComfyUI installation is present on this machine. Those installed-host lanes
remain unobserved rather than inferred from browser, adapter, or package
checks.

Preserve the complete dirty worktree and current HEAD
`5878370be8855252897d3231536a7d32d06cdfb2`. This authorization does not include
commit, push, publication, deployment, Figma upload, or Comfy Registry action.

## Completed external-review repair batch

On 2026-08-31 an independent review was checked against current source and
runtime rather than accepted as a completion claim. Confirmed defects were
repaired without changing the deterministic product boundary:

- Agent filesystem and destination preflight now happens before render
  admission, so invalid paths and existing outputs retain their stable errors
  even when all four admissions are occupied. Capacity and timeout errors now
  include bounded retry facts, destination collisions name the available
  remedy, successful MCP text names the usable artifact, and the CLI exposes
  actionable flag help plus an `E_RENDER` file-open failure;
- the published input schemas now describe normalized target sizes,
  destination authority, dry-run behavior, and CSS destination resolution.
  Their experimental Capability transport digests were refreshed against the
  live built MCP schemas;
- Figma now lets `[hidden]` defeat `display: contents`, preserves preview zoom
  shortcuts when a non-text button owns focus, yields undo to actual text
  editors, retains exact typed numeric display, exposes Undo/Redo and compact
  shortcut help in More, shows Apply status, makes errors dismissible, adds
  slider value text, and completes localized Canvas preview/Fit/tab semantics;
- the minimal Web playground now opens a real non-identity example, converts
  its pixel fixture to the editor's normalized contract, renders through the
  shared viewport, exposes current TransformSpec and CSS, and provides Fit,
  zoom, Reset, copy, and PNG export in the same workspace.

Fresh isolated Chromium observations cover Web example -> zoom -> Reset with
visible synchronized JSON/CSS and zero console errors. The built Figma panel
observed hidden Distort controls at computed `display: none`, button-focused
`Command-1` changing the viewport to 100%, a dismissible error, visible history
and shortcut help, and localized English/Simplified-Chinese Canvas tabpanel
labels. These observations do not cover Figma document mutation or installed
Community runtime; that human-host lane remains unmeasured.

Current regression observations after the repair are: complete `pnpm check`
PASS; 24 Comfy adapter/node tests PASS; local Comfy packaging PASS; live MCP
`tools/list` 80,516 bytes against the 81,920-byte ceiling; Figma runtime
394,272 bytes, archive 428,096 bytes, and unpacked package 969,783 bytes
against the unchanged carrier ceilings. Runtime smoke retained two worker
slots, two overload rejections, and 6-ms observed ordinary and Canvas
cancellation cleanup. These are current local measurements, not installed-host
or product-experience acceptance.

The review suggestions to remove the returned solved TransformSpec, rename
the existing solve input asymmetry, reclassify oversized JSON as an output
failure, or grow the Web playground into a second Figma product were not
adopted. They conflict with the current reusable-result, input-validation, and
minimal-playground contracts and had no reproduced defect. No commit, push,
publication, Figma resubmission, or Comfy Registry action is authorized by
this repair batch.

# Worldbend Figma Community distribution

Worldbend is a **free Figma Community plugin**. Designers obtain approved
updates from the [Worldbend listing](https://www.figma.com/community/plugin/1675767923532475446/worldbend).
No trial, checkout, subscription, product account or Worldbend cloud service
is required. Free plugin distribution does not publish or license the private
source repository.

## Current package and companion effect

The Figma package is `0.3.0`. Figma assigns its own Community version number;
local package creation and submission do not establish marketplace approval.

The optional [Worldbend Perspective effect](https://www.figma.com/community/shader/1679431734495527701)
has been submitted to Community and is under review. Until Figma approves and
makes it available, editable output requires existing access to that exact
effect. HD images work independently. Keep this distinction visible in the
listing and update it only after verifying the public acquisition path.

## Listing content

- **Name:** Worldbend
- **Category:** Editing & effects
- **Tagline:** Perspective, sizes, and reusable spatial transforms in Figma.
- **Price:** Free
- **Recommended tag:** Mockup tools
- **Custom tags:** distort, perspective, transform, warp

The listing should explain the completed task: select a source, shape it with
Transform, Distort, Perspective, Warp or Correct, then create an HD image.
Sizes creates named variants; Templates save repeatable work. Composition,
Mesh and Lens & maps are discoverable under More.

A saved result can reopen alone through its source binding. Update HD Image
or Update Frame preserves that result; either New action creates another
independent result. Native content is edited directly on the Figma canvas.
Edits to an image's source are applied to that snapshot only after Update.
The original is preserved when creating results.

Describe editable Frames as independent native content with a **sampled**
perspective appearance, requiring the companion effect. Do not advertise
vector-preserving perspective output or HD live text. Disclose the 4096-pixel
image limit, supported clipped and unrotated Frames, and the host Undo limits
in [FIGMA_HANDOFF.md](FIGMA_HANDOFF.md).

## Security and privacy

- The manifest declares no network domains and no extra permissions.
- Source pixels stay inside Figma and the bundled WebAssembly runtime.
- There is no product account, analytics, advertising, remote storage or payment
  integration.
- The plugin stores results, reusable transform/source bindings, and local
  preferences in Figma. These are not sent to a Worldbend server.
- Third-party notices and an SPDX inventory accompany the internal archive.
- Source visibility, marketplace terms and free pricing are separate decisions.

## Media

Use the owned icon and current product examples in
[`assets/figma-community`](../assets/figma-community/README.md). The `0.3`
thumbnail shows an actual HD result. The companion-effect thumbnail separately
shows a sampled editable Frame. Do not reuse old interface screenshots as
current previews. Exclude account chrome, unrelated artwork, company projects,
automation overlays and incomplete operations.

## Release verification

Before publishing a new package:

1. Verify the exact manifest and built bytes being submitted. Run the affected
   source checks, `pnpm test:figma-refresh`, `pnpm test:figma-shader` and
   `pnpm test:remap-parity` when their rendering paths change.
2. Exercise creation, result-only reopening, update versus new output, source
   edits, recovery and output limits through the actual Figma plugin.
3. Verify optional effect acquisition separately from HD availability. An
   author's account is not evidence of another account's effect access.
4. Confirm the unchanged free price, local processing and actual permissions.
5. Read back the Community version and run the acquired plugin after approval.
6. Keep submission receipts, local paths and task evidence in ignored
   `.task-notes/`; retain reusable contracts in source documentation.

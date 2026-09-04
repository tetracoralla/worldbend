# Worldbend Figma Community release

## Release decision

Worldbend launches as a **free Figma Community plugin**. The full transform
workflow is available without a trial, checkout, subscription, account, or
product-owned cloud service. Free distribution does not publish or license the
private Worldbend source repository.

Worldbend `0.2.0` was published to Figma Community as Version 3 on 2026-09-04.
Figma returned `And you’re live!`, and the public listing readback showed
`Your resource is live`, Version 3, the current description, release notes,
three current preview images, and the declared no-network security state.

The plugin does not request Figma's Payments API and contains no purchase
state. Designers can preview, Apply, replace, and create another image without
entering payment information or configuring a payout method.

## Community listing

- **Name:** Worldbend
- **Category:** Editing & effects
- **Tagline:** Perspective, sizes, and reusable spatial transforms in Figma.
- **Price:** Free
- **Recommended tag:** Mockup tools
- **Custom tags:** distort, perspective, transform, warp

### Description

Worldbend brings Photoshop-familiar spatial transforms to Figma. Select a
layer, adjust it with live Transform, Distort, Perspective, Warp, or Correct
controls, and apply a high-quality image result without leaving your file.

- Scale, rotate, skew, flip, and place with precise values or direct handles.
- Move four corners freely or use axis-locked Perspective Distort.
- Choose from ten bounded Warp presets with live preview.
- Create one to eight named Size variants with explicit crop, trim, pad,
  contain, cover, or stretch behavior.
- Save and reopen reusable Size or multi-plane Composition tasks as Templates.
- Open Composition, bounded Mesh, or Lens & maps from Advanced transforms when
  the selected layers support them.
- Reopen a result with its original source to refine or replace it in place.
- Keep the original source unchanged and use Figma Undo for the applied result.
- Work locally: source artwork is not uploaded to a Worldbend service.

Worldbend creates a raster image result so effects, shadows, and composed
layers remain visually consistent. Figma limits one raster image to 4096 px on
each axis; Worldbend reports that limit instead of silently reducing quality.
Vector-preserving output, automatic plane or depth detection, 3D
reconstruction, and unbounded arbitrary deformation are not included.

## Security and privacy disclosure

- The manifest declares no network domains and no extra permissions.
- Source pixels stay inside Figma and the bundled local WebAssembly runtime.
- Worldbend has no account system, analytics, advertising, remote storage,
  payment integration, or product-owned server in this release.
- The plugin writes only the applied image, its reusable transform data, and
  adapter-local raster dimensions into the authorized Figma document.
- Bundled third-party notices and an SPDX inventory ship with the reviewed
  development package.

## Listing media for 0.2.0

- `assets/figma-community/worldbend-icon-128.png` is the 128 x 128 px plugin
  icon.
- `assets/figma-community/worldbend-0.2-thumbnail-1920x1080.png` is the
  1920 x 1080 primary thumbnail describing the Perspective, Sizes, and
  Templates loop.
- `assets/figma-community/worldbend-0.2-primary-loop-1920x1080.png` and
  `assets/figma-community/worldbend-0.2-advanced-transforms-1920x1080.png`
  are the published carousel images. They show the primary loop, More menu,
  Composition, Mesh, and Lens & maps from the current built/live surface.
- Short recordings may supplement the stills only when they show an entire
  completed task rather than transient setup.
- Every published asset must show the current `0.2.0` surface and avoid Figma
  account chrome, unrelated canvas content, company project names, automated
  pointers, developer diagnostics, or an in-progress Apply state.

The earlier Perspective/Transform recordings and Transform screenshot remain
archived as the media submitted with the `0.1.0` listing; they are not current
`0.2.0` previews.

## Owner-account boundary

Figma requires a public Community profile and support contact for submission.
The listing uses the owner's individual creator profile and the support contact
already configured in that Figma account. Figma confirmed the public handle
`worldbend` was available. The submitted free form did not enable selling,
Stripe, tax, payout, price, trial, or banking configuration.

Figma Desktop generated plugin ID `1675767923532475446` on 2026-08-30. The ID
is part of the manifest, but generation alone is not a publication receipt.

## Submission acceptance

Before submission:

1. Build and run the current package from the exact manifest being submitted.
2. Exercise Perspective create, replace, Apply as New Image, Undo, selection
   change during Apply, and the 4096 px limit in Figma Desktop.
3. Exercise Sizes multi-output, Template save/reopen/delete, Composition,
   Mesh, Lens, and source-plus-map Displacement from the exact package.
4. Run `pnpm test:remap-parity` on a Chrome/Chromium release host and retain its
   current Native/WebGL standard/high-quality measurement.
5. Confirm the current 1920 x 1080 thumbnail and carousel represent both the
   primary loop and the discoverable advanced transforms.
6. Confirm the manifest has no extra permissions or network domains and Apply
   never opens checkout.
7. Confirm the listing is Free, says raster output, and does not claim editable
   vectors or open-source availability.
8. Record the submitted plugin ID, publisher, support-contact source, listing
   URL, review state, and submitted source revision in this document.

## 0.2.0 publication record

- **Package:** `artifacts/figma/worldbend-figma-0.2.0.zip`
- **Archive size:** `491193` bytes
- **Archive SHA-256:**
  `d3bf51cd990b141dd8c0e3c99a5bff82126de162b5215f7da782b43e3fa95b11`
- **Runtime / unpacked size:** `556412` / `1131923` bytes
- **Publish state:** Live on Figma Community as of 2026-09-04
- **Listing URL:**
  `https://www.figma.com/community/plugin/1675767923532475446/worldbend`
- **Publisher:** Adam Wong, individual creator
- **Support contact:** Figma account's existing support contact
- **Community readback:** Figma displayed `And you’re live!`, then the public
  resource page displayed `Your resource is live` and `Last updated just now`
- **Release notes:** Adds Sizes and reusable Templates to the primary loop;
  groups Composition, Mesh, and Lens & maps under Advanced transforms; retains
  free local-only raster processing and the 4096 px boundary
- **Submitted source revision:** `9be6b9e3c8a5ded248ded12b3908a17908638e7c`
- **Package-content baseline:** `45fd2a7a85ef3c72e58309fa8e455a62794e97a8`;
  subsequent Linux durability and clean-checkout fixes did not change the
  reviewed Figma archive hash
- **Figma version after update:** Version 3
- **Media:** Existing 128 px icon; current `0.2.0` thumbnail; primary-loop and
  advanced-transforms carousel images, in that order
- **Data security:** No backend, network requests, or authentication; local
  plugin storage and solo-developer update management disclosed
- **Remote checks:** clean-checkout and CodeQL passed for the submitted source
  revision before the Figma Publish action

## Historical 0.1.0 submission record

- **Plugin ID:** `1675767923532475446` (generated by Figma Desktop)
- **Publisher:** Adam Wong, individual creator
- **Support contact:** Figma account's existing support contact
- **Community handle:** `worldbend` (confirmed available by Figma)
- **Listing URL:** `https://www.figma.com/community/plugin/1675767923532475446/worldbend`
- **Review state:** Resubmitted after the owner accepted the final media on
  2026-08-30; Figma reports that only the publisher can see the page while the
  plugin is in review
- **Submitted source revision:** `3802586074897523d97127ad328db766e6aa669e`
- **Media:** Icon plus the three owner-reviewed items archived in
  `assets/figma-community/`; the current listing shows three preview items
- **Version:** The listing-only media update did not resubmit the plugin
  package; Figma still reports Version 2 rather than creating Version 3
- **Data security:** No backend, network requests, or authentication; local
  plugin storage disclosed; solo-developer update management disclosed
- **Financial configuration:** None; the submission created no selling,
  Stripe, tax, payout, price, trial, or banking configuration
- **Figma resource license:** Figma displays its default Community Free
  Resource License for the downloadable plugin. This platform distribution
  license does not publish or add a license to the private GitHub source tree.

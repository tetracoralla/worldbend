# Worldbend Figma commercial release

## Release decision

Worldbend launches as a paid Figma Community plugin with a seven-day complete
product trial followed by a **USD 12 one-time purchase**. It is not a
subscription: the plugin has no product-owned cloud service or recurring
compute cost. Figma's native checkout owns payment collection and purchase
status; Worldbend never receives payment details.

The trial and paid build are the same product. An unpaid user inside the trial
may preview and Apply normally. After the trial, Apply opens Figma checkout.
Dismissal or an unavailable purchase status leaves the current editor state
and Figma document unchanged so the user can retry without rebuilding the
transform.

## Community listing

- **Name:** Worldbend
- **Category:** Design tools
- **Tagline:** Photoshop-familiar transforms, directly in Figma.
- **Price:** USD 12, one-time payment
- **Trial:** Seven days, complete product
- **Search terms:** perspective, warp, distort, transform, mockup

### Description

Worldbend brings a focused Free Transform workflow to Figma. Select a layer,
adjust it with live Transform, Distort, Perspective, or Warp controls, and
apply one high-quality image result without leaving your file.

- Scale, rotate, skew, flip, and place with precise values or direct handles.
- Move four corners freely or use axis-locked Perspective Distort.
- Choose from ten bounded Warp presets with live preview.
- Reopen a result with its original source to refine or replace it in place.
- Keep the original source unchanged and use Figma Undo for the applied result.
- Work locally: source artwork is not uploaded to a Worldbend service.

Worldbend creates a raster image result so effects, shadows, and composed
layers remain visually consistent. Figma limits one raster image to 4096 px on
each axis; Worldbend reports that limit instead of silently reducing quality.
Vector-preserving output, automatic plane detection, 3D reconstruction, and
arbitrary mesh deformation are not included in this release.

### Trial disclosure

The complete plugin is available for seven days from first use. After the
trial, a one-time purchase is required when applying a result. Previewing and
editing do not modify the Figma document; dismissing checkout preserves the
current edit.

## Security and privacy disclosure

- The manifest declares no network domains.
- Source pixels stay inside Figma and the bundled local WebAssembly runtime.
- The plugin reads only Figma's host-owned paid/unpaid status and first-run
  age through the Payments API.
- Worldbend has no account system, analytics, advertising, remote storage, or
  product-owned server in this release.
- The plugin writes only the applied image, its reusable transform data, and
  adapter-local raster dimensions into the authorized Figma document.
- Bundled third-party notices and an SPDX inventory ship with the reviewed
  development package.

## Listing media

- `assets/figma-community/worldbend-icon-128.png` is the 128 x 128 px plugin
  icon.
- `assets/figma-community/free-distort-runtime-1920x1080.jpg` is the primary
  thumbnail and shows the current plugin on a real Figma Desktop source.
- `assets/figma-community/applied-result-runtime-1920x1080.jpg` shows the
  successful complete-trial Apply path and the current `· Worldbend` result.
- Later optional previews may add Transform, Warp, and source/result re-editing,
  but must continue to use the current runtime rather than mock controls.

## Owner-account boundary

Figma requires an approved individual Community seller, two-factor
authentication, an activated Stripe account, a supported payout jurisdiction,
tax identity, and a public support contact. The first publisher becomes the
designated payee and cannot later be changed. These account facts must be
completed or confirmed by the owner in Figma Desktop before final submission.
The current form also requires a new public Community handle of at most 15
letters, numbers, or underscores. The form defaults to the owner's individual
creator profile and contains a prefilled support email; neither public identity
field is treated as approved until the owner confirms it.

Figma Desktop generated plugin ID `1675767923532475446` for this commercial
submission on 2026-08-30. The ID is now part of the manifest, but generation is
only a registration fact and is not treated as a publication receipt.

## Submission acceptance

Before clicking Publish:

1. Build and run the current package from the exact manifest being submitted.
2. Exercise unpaid in-trial, unpaid expired/cancelled, paid, and unavailable
   payment states; require zero document mutation on every denied path.
3. Exercise create, replace, Apply as New Image, Undo, selection change during
   Apply, and the 4096 px limit in Figma Desktop.
4. Confirm the listing says raster output and does not claim editable vectors.
5. Confirm one-time payment, USD 12, and seven-day trial before submission;
   Figma does not allow a paid plugin's payment model to be changed later.
6. Record the submitted plugin ID, publisher/payee, support contact, listing
   URL, review state, and submitted source revision in this document.

## Submission record

- **Plugin ID:** `1675767923532475446` (generated by Figma Desktop)
- **Publisher/payee:** Figma currently defaults to Adam Wong as individual creator and owner/payee; owner confirmation pending
- **Support contact:** Pending owner-supplied public contact
- **Community handle:** Required and pending owner choice
- **Listing URL:** Pending submission
- **Review state:** Not submitted
- **Source revision:** Pending final commercial release commit
- **Draft media:** Icon, primary runtime thumbnail, and applied-result carousel image uploaded to the unpublished Figma form

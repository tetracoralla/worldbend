# Receive and continue a native material

Open `MaterialReceiving.xcodeproj` in Xcode 26+ and run the `MaterialReceiving`
scheme on an iOS 26+ Simulator or device. No Figma credentials, Worldbend
executable or network is needed to run the receiving project. The local Swift
package and licensed photo are addressed by relative paths in this source
bundle. For a standalone copy, run `pnpm package:ios-receiving` in the repository
and extract the archive while keeping its directory structure.

The trip's Save control and editable morning panel share one received material.
Enter a note, change Guests, reserve the morning, then Receive update. Revision
2 is a later native Figma visibility edit at the same recipe version. The
controls, entered note and input focus survive it. Receive again to restore
the source visibility. Save/reservation survive application relaunch; note and
Guests demonstrate view-local state during continued use.

More offers a local material preference, removal, explicit restoration, a stale
receipt and a simulated failed delivery. Removed material stays removed through
source updates. Retry after a failure keeps the current look until a valid
receipt arrives. Cancel and application backgrounding stop the pending receipt.
Transport delay/failure is simulated; the canonical receipt and merge are real
source-MCP outputs. A remote transport belongs to the receiving application.

`source.v1.json` and `source.v2.json` retain complete source inputs, `Receipts/`
contains native delivery/update plans, and `native-extras.json` discloses Splay.
The default `swiftui` profile maps visibility to native Liquid Glass; all six optical
Figma setters and Splay are unavailable. This example proves continued native
use, not Figma pixel equality or physical-device performance.

Launch with `-optical-example` to use the `swiftui-optical` target over the same
licensed photo. A text field, circular action and diagnostic pane share one
session; Receive edit changes the real refraction, rim depth and frost while
preserving the note and handlers. Remove/Restore preserve foreground identity.
The calibration toggle and background slider reveal sample alignment. Source
inputs live in `optical-source.v1.json`/`optical-source.v2.json`; core-generated
single-field variants exercise all six knobs. `-optical-chart` and
`-optical-variant <field>` select those deterministic comparisons. The neutral
variant verifies alignment against the original backdrop, including scrolling.
The UIKit photo is decoded once into an ordinary SwiftUI Image; no native view
capture or pixel readback drives the glass. Shape/tint/layout belong to the host.

Regenerate receipts with `pnpm example:ios-appearance:generate`. If changing the
project specification, run `xcodegen generate --spec project.yml`; the generated
project is included so recipients do not need XcodeGen. Run the scheme's UI
tests to check nested state/focus, source restoration, local removal, stale
receipt rejection, failed receipt retry and cancellation. Inspect light/dark
mode and large text on the target you support; keep host accessibility policy
when attaching the material to your own controls.

Photo attribution is in `../../packages/web/examples/assets/NOTICE.md`.

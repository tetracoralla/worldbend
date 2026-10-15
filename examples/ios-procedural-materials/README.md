# Native Foil and fluid-light receiving

This independent host uses canonical `swiftui` Foil/mesh-gradient deliveries
and the local WorldbendAppearance package on macOS 14+ / iOS 17+. Native layout,
book-cover content and controls remain host-owned. Metal renders only the
material background from the generated canonical kernels.

Edit the cover title, choose a material, pause motion, apply a local color, then
accept the next design. Local colors survive the source revision. Removing a
material keeps title/actions intact and the next source revision does not
reattach it. Restore explicitly when needed. Motion/visibility clocks remain
separate from material provenance.

Generate canonical source receipts with `pnpm material:native:receipts`; check
them with `pnpm material:native:check`. Build a local macOS app with
`node scripts/build-material-receiving-example.mjs`. Its app and scratch stay
under the repository's ignored `.task-notes/`; this neither installs nor
publishes it. The same SwiftUI source builds with `project.yml` on iOS.

The normal example starts with the continuous-loop v2 mesh. Pass `--legacy-mesh`
to the build helper for a QA app that starts with exact v1 receipts; choosing
the next design explicitly upgrades its renderer while retaining title, local
color and clock state. This flag changes only that generated local example.

Pass `--personal-preferences` for the personal-material host. It exposes typed
Foil/mesh controls, composable preview/apply/cancel, explicit-default retention,
new design, removal/restore and guarded preferences. Configure product-owned
storage with `--preference-store <file>` or `WORLDBEND_MATERIAL_PREFERENCE_STORE`.
Without a path it honestly keeps choices for the current session. The SDK never
chooses a disk location or writes preferences itself.

Configured saves and reads run off the UI thread. Newer saves cannot be
replaced by an older queued snapshot. Read/validation failures retain the file
and current working state; intervening edits invalidate a pending restoration.
The small host record also saves title, selected family and source/removal state.
Runtime pause remains separate. Keep the host's chosen directory writable and
available; a failed write reports failure and can be retried with Save.
`--invalid-render-size` creates a local recovery fixture: the cover content stays
available, and Retry material restores the renderer. These flags build only
that local QA host and do not install or publish it.

The sample accepts trusted core receipts bundled with it. A real receiving
product obtains its own typed delivery/update through the Agent entry or core,
controls which values people/Agents may edit, and owns persistence. Kernel
source integrity is checked before compilation. It does not contact Figma or
fetch any account-owned resource. Cross-host pixel identity, environmental
reflection and native Splay are not claimed.

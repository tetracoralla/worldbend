# Live spatial windows

Use this route when sampled content should remain on a stationary plane while
an explicitly posed window moves, with blur increasing with separation. Use
ordinary host transforms for simple layered parallax, and the existing live CSS
perspective route when real DOM controls should rotate with their surface.

1. Call `worldbend.describe` for `window_plan` if its schema is not known, then
   `worldbend.run` with operation `window_plan` and the complete spec directly in
   `arguments`. It returns visibility plus drawable geometry for visible faces.
2. Install the independent `assets/web/worldbend-web.tgz` archive relative to
   this Skill directory into the authorized frontend, as described in
   [live web](live-web.md). For a source candidate, run `pnpm package:web` in
   its checkout and use the resulting archive under `artifacts/web/`. Use
   `@worldbend/web/surface-window`, not the default or perspective entry. Follow
   the SDK's `SURFACE_WINDOW_CONTRACT.md` for the coordinate system and limits.
3. Bind a dedicated output canvas with `attachSurfaceWindow`, a decoded,
   origin-clean image/video/canvas/ImageBitmap and the same spec. Update the
   complete spec from the application's local drag, scroll or opening progress.
   No MCP or Agent runs per frame. Refresh after editing source-canvas pixels;
   video playback refreshes automatically. The host still owns playback.
4. Inspect the actual effect while reversing, pausing, replacing content and
   resizing. React to structured errors with a usable host fallback. Stop host
   animation loops while hidden and honor reduced-motion preferences. Dispose
   bindings when their elements leave the application.

`contentOrigin` is the fixed content's top-left relative to the unposed window;
`contentSize` is its logical coverage. `windowSize` describes the moving pane.
The plan's sample homography and CSS projection must be used together; do not
replace one with an adapter-derived camera model. The Web binding already does
this. A source texture can have a different decoded resolution.

At side-on/back-facing angles the plan has no drawable mapping. A two-sided
fold uses two independently oriented windows and the recipe in the contract;
never reverse destination-corner order to fake a face. Pixel blur samples use
an explicit radius derived from distance; this is not calibrated lens physics.

The texture is visual content, not a live DOM subtree. Keep ordinary controls
outside it or explicitly switch back to real DOM after a transition. No
implicit screenshot capture, DOM hit remapping or native SwiftUI renderer is
provided. The current Figma/ComfyUI and portable Capability carriers do not
expose this family. A missing operation in an installed older plugin means that
source development has not yet been released/installed there; do not claim the
installed runtime gained it merely because the source checkout has it.

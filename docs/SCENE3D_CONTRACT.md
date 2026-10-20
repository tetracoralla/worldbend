# Three-dimensional scene continuation

## Owning meaning and execution

An ordinary Spatial Document may contain `kind: "scene3d"` alongside static,
interactive, temporal and material expressions. The expression retains a
`worldbend.scene3d` version-`0.1` spec and exact `content` bindings. `sceneSlot`
names the adopted scene asset; each artwork names a distinct slot and exact
exported material. The ordinary document inspection, assembly, update, stale
fingerprint and delivery rules apply. Scene-source revision affects that scene;
shared print revision affects every bound expression, including a static proof.

The core validates camera/clip selection, rational timing, output dimensions,
artwork fit and receiving presentation values, and emits a fingerprinted frame
plan. glTF owns model transforms, cameras, standard materials and animation.
Three.js executes those adopted semantics. This contract does not introduce a
second projective/deformation solver or transfer all Worldbend authoring into
Blender. `.blend` source provenance stays with the production package, separate
from canonical GLB/content asset identity and receiving overrides.

The spec selects one exact camera and optional exact animation by exported
name. Missing or ambiguous names fail receiving. Camera selection uses original glTF
node names rather than loader-sanitized animation labels, retaining spaces, dots
and Unicode through later source edits. The imported clip is sampled
at the plan's normalized progress; the first/last frames retain its endpoints.
`frameCount / timebase` determines presentation duration, with the final pose
held through the remaining final-frame interval. A one-frame plan uses the
initial pose. Retime preserves normalized clip meaning rather than editing
Blender curves. The adopted animation mixer retains glTF interpolation.

Artworks replace texture maps on their named materials, preserving geometry
and UVs. `stretch`, `contain` and `cover` reuse the canonical Canvas planner;
contain/cover center the source against a declared warm-paper background.
The receiving camera preserves vertical field when output aspect changes,
including orthographic cameras. Background RGB is sRGB8. Exposure and added
hemisphere intensity are explicit receiving presentation values. They do not
claim equivalence with Blender world illumination or native shader graphs.

## Optional Web carrier

`@worldbend/scene-three` is a separate optional package, pinned to Three.js
0.186.1. The existing Web/Figma entries do not import it. Its public entry is
`attachScene3d(host, document, expressionId, options)`; the host resolves named
asset bytes and owns storage, placement and controls. Declared `sha256:` content
versions must match the received bytes before decoding or publication.

A revision requires the current receiver instance, generation and document
fingerprint. Concurrent revisions reject. The complete candidate prepares
without replacing the accepted scene. Failed validation/acquisition, missing
camera/material, stale guards, cancellation and late decode preserve accepted
pixels and work. Publication retains the current normalized viewing time, then
retires replaced geometry, materials, textures, shadows and skeleton resources.
Disposal cancels pending work, removes listeners and releases the GPU surface.
Host reporter failures cannot become lifecycle authority.

Playback respects pause, document visibility and reduced motion; explicit
scrubbing remains available. Real WebGL loss stops playback and export, retains
the document, and rebuilds the accepted presentation on restoration. Source
failure can be retried through the same receiving entry. The package does not
report unavailable rendering as a successful screenshot.

`renderSceneFrames` snapshots the document into an isolated receiving session.
It supplies each planned PNG to the host's callback and returns document/scene
fingerprints, canvas, rational rate, frame count and duration. Failure or
cancellation retires that session; live receiving clocks and pixels remain
untouched. The host owns encoding. The example check encodes the actual delivered
frames into opaque 8-bit H.264/MP4; that file is a scoped video output, not an
editable replacement for the work.

## Native fixed-frame projection

The optional native appearance package receives the same authored work through
`WorldbendRasterWorkSession` and the existing `WorldbendFrameHub`. A
`worldbend.raster-work-package@0.1` manifest retains the core `scene3d-frames`
receipt, explicit sample timestamps, sRGB premultiplied-BGRA8 publication intent,
hashed PNG files, ordinary document/plan and editable production assets. This is
a fixed execution projection, not another Spatial Document or geometry engine.
`scripts/package-raster-work.mjs` verifies the current canonical delivery plan
against the actual renderer receipt and packages exact resource bytes.

The host supplies the package root, independently retained manifest pin,
current receiver/hub guard and logical-point layout. Full candidate resource
verification and first selected decode finish before atomic publication; failed
replacement retains the accepted work. Revision keeps normalized viewing time.
Play/pause/seek/reset/stop, monotonic foreground time, completion/replay,
interruption and disposal execute locally without per-frame MCP. Host layout
changes during receiving/seek apply to the completed frame without cancelling
source preparation. Another producer's hub revision prevents late publication;
stop/dispose clears only this receiver's own frame. An explicit latest-guard
receive is the host-directed route to reclaim the hub.

The receiver walks relative regular files without following entry symlinks,
checks the manifest/resource SHA256 and rechecks later PNG reads. Current bounds
are64MiB per file,512MiB cumulative,240 frames and8192 axes/16 megapixels per
decoded image. One synchronous image decoder per receiver and two cached frames
bound retained work; cancellation retires publication immediately, including a
decoder which finishes later. These bounds are carrier admission, not intended
long-form limits. Hash pins detect byte changes, not author authenticity.

CPU PNG decode/color conversion/buffer writing precede publication. Only a
completed CVPixelBuffer enters FrameHub; borrowed frames stay alive under its
existing access rules. Metal optics can wrap this buffer through the existing
CVMetalTextureCache route, while the SwiftUI optical host materializes its shared
CGImage once/revision. No end-to-end zero-copy claim follows. Host overlays never
feed their own sampled completed frame. Background suspension holds the last
frame and excludes elapsed time; hosts use stop/dispose when retiring visibility.

Camera/material/print changes require rebaking the retained canonical source.
This profile supplies no realtime3D, stochastic seed behavior, event-history
simulation or audio. App owns eligibility, lifecycle, preferences and business
history. Source/macOS CVPixelBuffer evidence, iOS target receiving, optical shader
composition and actual App acceptance remain separate claims. The
[native example](../examples/native-raster-work/README.md) receives the original
four-second work and revised six-second work through this same mechanism.

## Current admission and explicit limits

This carrier receives self-contained GLB 2.0 with embedded PNG textures;
external URIs are not admitted by the current resolver profile. Unsupported used/required extensions reject before loading. In particular,
GPU-instancing extensions are not admitted before their multiplied geometry
work has a supported accounting profile. Transport is bounded to 64 MiB, JSON to 4 MiB,
node depth to 128 and nodes to 20,000. Hierarchies are glTF trees; depth checks
are independent of node order. The loader's complete expansion across at most
32 scenes shares a 20,000-node and two-million-vertex instance budget. At most
16 punctual light instances and four 2048² directional shadow maps are admitted
before rendering allocation. These are receiving-profile bounds; authored source
may be adapted to them before delivery.
Declared accessor expansion and cumulative copied buffer views each have a
128 MiB bound; small accessors cannot hide large overlapping resource slices.
Morph targets have a separate 128 MiB expanded RGBA-float texture budget,
including conservative row-padding accounting even when targets reuse accessors.
The receiver also checks the actual device's array-texture layer capacity before
rendering a candidate. These guards retain supported authored morph animation;
they do not redefine the product's intended deformation or animation scope.
Embedded image declarations share a 128 MiB encoded-copy bound even when they
reuse one view. A failed texture decode rejects the candidate and retires its
temporary blob URLs. Image sources
and replacement surfaces share a 64-megapixel receiving budget. Artwork axes are
at most 8192 and individual images at most 16 megapixels. These are current
receiving resource bounds, not a permanent restriction on the product direction.

The first core frame plan reuses the existing bounded batch profile: up to
240 frames and 256 megapixels of total output, with rational-rate validation.
Long-form/chunked delivery remains work to implement; this batch profile does
not redefine the intended animation workflow.

The current example explicitly exports Blender COMPAT lighting. Cycles/AgX,
angular light softness, native world illumination and the Three ACES/sRGB/PCF
pipeline differ. Shadow framing currently suits the demonstrated paper stage;
wide-scale lighting/culling and additional material profiles need their own
complete-work evidence. No general native/Web visual parity is claimed.

## Authored example and verification

### Host authoring continuity

The receiving example records author baseline and local-choice ownership beside
the ordinary Spatial Document. The document remains the authority for actual
values; ownership records explain which choices should remain local on a later
author update, including a choice which happens to match an intervening default.
A field comparison prepares an ordinary core update plan. Frame count and rational
timebase form one rhythm choice. Concurrent/stale guards, candidate preparation
and rendering acceptance still belong to the existing core and SceneSession.
Only successful receiving advances the host baseline and undo history.

Its version0.2 host save envelope carries document, packaged author baseline,
local fields, viewing time and bounded validated snapshots. Known legacy records
can recover observable differences, but cannot reconstruct missing historical
intent. Unknown envelope versions or invalid lineage/history leave accepted work
untouched. This is a concrete same-work receiving workflow, not a new canonical
document standard or a replacement for broader creator/consumer authoring.
Its saved-file/moved-package checks establish portable host continuation;
they do not establish a shared Figma-to-engineering workflow or prescribe
one computer/client for different roles.

[Field Notes source](../examples/blender-paper-stage/README.md) preserves original
print, an editable packed Blender scene, an animated paper lift and a camera
reveal. The [receiving example](../packages/scene-three/examples/paper-stage/README.md)
changes print, adopts later Blender exports, retimes, undoes and saves/reopens
work. Content-addressed GLB/source files retain prior saved versions. The
FrontCamera view provides a strict rectangle reference; presentation uses an
upright book and level longer-lens camera after visual review rejected the
initial tilted composition.

The receiving check observes actual GPU pixels, projected front-cover corners,
output aspect preservation, shared revision, fresh-session continuation,
late cleanup, repeated texture retirement, real context loss/restoration and
complete isolated frame delivery. These checks establish the documented
technical behavior, not identical appearance across renderers.

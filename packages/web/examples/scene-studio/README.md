# Scene Studio

A runnable local authoring carrier for the Field Notes editions scene. Drag or
keyboard-nudge a selected layer's corners, capture a scene pose, remove a selected
layer's intermediate pose, change easing or duration, replace PNG artwork and
undo/redo the complete design and source binding. Shadows remain part of the
same reusable scene. Endpoints and seam constraints come from core validation.

Build the CLI and Web package, then run from the repository root:

```sh
cargo build --release -p worldbend-cli --bin worldbend
pnpm build:web
node scripts/scene-studio-server.mjs --workspace .task-notes/scene-studio --ffmpeg /usr/local/bin/ffmpeg --ffprobe /usr/local/bin/ffprobe --port 4189
```

Use encoder paths available on your machine. The server binds only to localhost
and keeps assets, saved work, drafts, copies and export jobs inside the named
project workspace. Its session token gates private routes. No account or external
service is used. Open the printed URL.

Save retains a canonical temporal Spatial Document and separate content-addressed
carrier asset bindings. A coalesced checkpoint protects edits after its disk
acknowledgement; changes within the 350 ms debounce or before acknowledgement
can still be lost on a sudden exit. Reopening recovers that protected draft.
Saved revision conflicts refuse overwrite and offer a separate work copy. Do not
remove the workspace while a retained work or export references its assets.

Image export uses the selected core frame; video export freezes the whole
program and source hashes, runs the ordinary native CLI, and exposes cancellation
and retry. Continuing to edit during export keeps the frozen output labelled as
an earlier edit. MP4 playback uses the browser's native media support.

Current studio admission is one temporal Mockup expression with PNG sources and
one asset per source slot. The shared core authoring API is carrier independent. See the Spatial Document
contract for the supported expression kinds in each carrier.

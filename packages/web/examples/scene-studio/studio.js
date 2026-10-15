import { attachMockupMotion } from "../../dist/mockup-motion.js";
import {
  planMockupMotion,
  planCanvas,
  CanvasRasterRenderer,
  observePointerSessionBoundary,
} from "../../dist/index.js";
import { artwork } from "../scene-motion/artwork.js";
import { scene } from "../scene-shadow/scene.js";
const $ = (id) => document.getElementById(id),
  session = globalThis.studioSession;
const keys = ["tl", "tr", "br", "bl"],
  names = {
    tl: "Top left",
    tr: "Top right",
    br: "Bottom right",
    bl: "Bottom left",
  };
let controller,
  plans,
  bindings = [],
  images = [],
  revision = 0,
  selected = "cover-2",
  history = [],
  historyIndex = 0,
  busy = false,
  dirty = false,
  job,
  disposed = false,
  poseQueue,
  pumping = false,
  abort,
  drag,
  pumpPromise,
  alternate = false,
  documentTemplate,
  workId = new URL(location.href).searchParams.get("work"),
  checkpointToken,
  checkpointGeneration = 0,
  checkpointTimer,
  checkpointRunning = false,
  checkpointWanted = false,
  recoveryConflict = false,
  refreshGeneration = 0,
  resumeView,
  reopening;
const clientInstance = crypto.randomUUID();
const handles = {},
  cornerInputs = {};
const status = (text) => ($("status").textContent = text);
const api = async (url, body, raw) => {
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "x-worldbend-token": session.token,
      ...(!raw && body !== undefined
        ? { "content-type": "application/json" }
        : {}),
    },
    ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? "Studio operation failed");
  return value;
};
const sourceUrl = (sha) =>
  "/assets/" + sha + ".png?token=" + encodeURIComponent(session.token);
const imageFromSha = async (sha) => {
  const bitmap = await createImageBitmap(
    await (await fetch(sourceUrl(sha))).blob(),
  );
  return bitmap;
};
const blobOf = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("Image encoding failed"))),
      "image/png",
    ),
  );
async function register(canvas) {
  return (await api("/api/asset", await blobOf(canvas), true)).sha;
}
const currentPlane = () =>
  controller.getSpec().planes.find((p) => p.id === selected);
const frame = () => controller.getState().frameIndex;
const currentPose = () =>
  plans.frameSpecs[frame()].planes.find((p) => p.id === selected).transform
    .destination.quad;
const normalized = (point, plane = currentPlane()) =>
  plane.base.destination.space === "pixel"
    ? { x: point.x / plans.canvas.width, y: point.y / plans.canvas.height }
    : point;
const authored = (point, plane = currentPlane()) =>
  plane.base.destination.space === "pixel"
    ? { x: point.x * plans.canvas.width, y: point.y * plans.canvas.height }
    : point;
const snapshot = () => ({
  spec: controller.getSpec(),
  bindings: structuredClone(bindings),
  timeMs: controller.getState().timeMs,
  selected,
});
function commitHistory() {
  const next = snapshot();
  if (
    JSON.stringify(next.spec) === JSON.stringify(history[historyIndex]?.spec) &&
    JSON.stringify(next.bindings) ===
      JSON.stringify(history[historyIndex]?.bindings)
  )
    return;
  history = history.slice(0, historyIndex + 1);
  history.push(next);
  if (history.length > 64) history.shift();
  historyIndex = history.length - 1;
  dirty = true;
  controls();
  scheduleCheckpoint();
}
function controls() {
  if (!controller) return;
  const editing = busy || pumping || Boolean(drag),
    state = controller.getState();
  $("play").disabled =
    editing || state.status !== "ready" || state.reducedMotion;
  for (const id of [
    "save",
    "export-image",
    "export-video",
    "plane",
    "duration",
    "capture",
    "easing",
    "strength",
    "replace",
    "fit",
    "next",
  ])
    $(id).disabled = editing || state.status !== "ready";
  $("undo").disabled = editing || historyIndex === 0;
  $("redo").disabled = editing || historyIndex === history.length - 1;
  $("position").disabled = editing || state.status !== "ready";
  const isPose = currentPlane().keyframes.some((k) => k.frame === frame());
  $("remove").disabled =
    editing || !isPose || frame() === 0 || frame() === state.frameCount - 1;
  $("easing").disabled = editing || frame() === state.frameCount - 1;
  for (const [key, button] of Object.entries(handles))
    button.disabled =
      (editing && key !== drag?.key) || state.status !== "ready";
  for (const input of Object.values(cornerInputs))
    input.disabled = editing || state.status !== "ready";
  $("save").textContent = dirty ? "Save work" : "Saved work";
}
function paintOverlay() {
  if (!plans || !controller || disposed) return;
  const state = controller.getState();
  if (!plans.frameSpecs[state.frameIndex]) return;
  const p = currentPlane(),
    q = drag?.quad ?? currentPose();
  $("selection-outline").setAttribute(
    "points",
    keys
      .map((key) => {
        const point = normalized(q[key], p);
        return point.x * 100 + "," + point.y * 100;
      })
      .join(" "),
  );
  $("selection-outline").style.display = state.paused ? "" : "none";
  for (const key of keys) {
    const point = normalized(q[key], p);
    handles[key].style.left = point.x * 100 + "%";
    handles[key].style.top = point.y * 100 + "%";
    handles[key].hidden = !state.paused;
    for (const axis of ["x", "y"]) {
      const input = cornerInputs[key + axis];
      if (document.activeElement !== input)
        input.value = String(point[axis] * 100);
    }
  }
  $("stage").dataset.editing = String(state.paused);
  $("position").value = String(
    Math.round((state.timeMs / state.durationMs) * 1000),
  );
  $("time").value =
    (state.timeMs / 1000).toFixed(1) +
    " / " +
    (state.durationMs / 1000).toFixed(1) +
    " s";
  $("play").textContent = state.paused ? "Play" : "Pause";
  for (const pose of $("poses").children)
    pose.setAttribute(
      "aria-current",
      String(Number(pose.dataset.frame) === frame()),
    );
  controls();
}
function inspector() {
  const spec = controller.getSpec(),
    p = currentPlane();
  $("plane").value = selected;
  $("duration").value = String(controller.getState().durationMs / 1000);
  $("strength").value = String((p.shadow?.opacity ?? 0) * 100);
  $("strength-value").value = Math.round((p.shadow?.opacity ?? 0) * 100) + "%";
  $("fit").value = bindings.find((b) => b.id === p.sourceId)?.fit ?? "contain";
  const key = p.keyframes.find((k) => k.frame === frame());
  $("easing").value =
    key?.easingToNext?.kind === "hold"
      ? "hold"
      : key?.easingToNext?.kind === "cubicBezier"
        ? "smooth"
        : "linear";
  $("poses").replaceChildren();
  for (const f of [...new Set(p.keyframes.map((k) => k.frame))].sort(
    (a, b) => a - b,
  )) {
    const button = document.createElement("button");
    button.className = "pose";
    button.dataset.frame = f;
    button.textContent =
      ((f * spec.timebase.denominator) / spec.timebase.numerator).toFixed(1) +
      " s";
    button.setAttribute("aria-label", "Pose at " + button.textContent);
    button.onclick = () => {
      controller.pause();
      controller.seek(
        (f * 1000 * spec.timebase.denominator) / spec.timebase.numerator,
      );
      inspector();
    };
    $("poses").append(button);
  }
  paintOverlay();
}
async function refresh() {
  const generation = ++refreshGeneration;
  const candidate = await planMockupMotion(controller.getSpec());
  if (generation !== refreshGeneration || disposed) return;
  plans = candidate;
  if (!currentPlane()) selected = controller.getSpec().planes[0].id;
  $("plane").replaceChildren(
    ...controller.getSpec().planes.map((p, index) => {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.id.startsWith("cover-")
        ? (["Left cover", "Right cover", "Front cover"][index] ??
          "Cover " + (index + 1))
        : p.id;
      return option;
    }),
  );
  inspector();
}
async function action(edit, record = true) {
  if (busy || pumping || drag) return;
  busy = true;
  controller.pause();
  controls();
  try {
    await controller.author(edit, controller.getAuthoringGuard());
    await refresh();
    if (record) commitHistory();
    status("Pose updated");
  } catch (error) {
    status(error.message);
    inspector();
  } finally {
    busy = false;
    controls();
  }
}
function queuePose(quad) {
  poseQueue = {
    quad: structuredClone(quad),
    frame: frame(),
    planeId: selected,
    owner: drag ?? { guard: controller.getAuthoringGuard() },
  };
  if (pumping) return pumpPromise;
  pumpPromise = (async () => {
    pumping = true;
    try {
      while (poseQueue && !disposed) {
        const candidate = poseQueue;
        poseQueue = undefined;
        try {
          const p = controller
              .getSpec()
              .planes.find((p) => p.id === candidate.planeId),
            existing = p.keyframes.find((k) => k.frame === candidate.frame);
          const receipt = await controller.author(
            {
              kind: "setKeyframe",
              planeId: candidate.planeId,
              keyframe: {
                frame: candidate.frame,
                quad: candidate.quad,
                ...(existing?.easingToNext
                  ? { easingToNext: existing.easingToNext }
                  : {}),
              },
            },
            {
              ...candidate.owner.guard,
              ...(candidate.owner.abort
                ? { signal: candidate.owner.abort.signal }
                : {}),
            },
          );
          candidate.owner.guard = receipt.guard;
          candidate.owner.invalid = false;
          await refresh();
        } catch (error) {
          candidate.owner.invalid = error.name !== "AbortError";
          status(error.message);
        }
      }
    } finally {
      pumping = false;
      paintOverlay();
    }
  })();
  return pumpPromise;
}
async function finishDrag(cancel = false) {
  if (!drag) return;
  const previous = drag;
  if (cancel) {
    poseQueue = undefined;
    previous.abort.abort();
  }
  drag = undefined;
  previous.cleanup?.();
  try {
    if (handles[previous.key].hasPointerCapture(previous.pointerId))
      handles[previous.key].releasePointerCapture(previous.pointerId);
  } catch {}
  await pumpPromise;
  if (cancel || previous.invalid) {
    try {
      await controller.update(previous.startSpec, images, {
        expectedRevision: previous.guard.expectedRevision,
      });
      await refresh();
      status(
        cancel
          ? "Pose edit cancelled"
          : "Invalid pose · previous pose restored",
      );
    } catch (error) {
      status(error.message);
    }
  } else commitHistory();
  paintOverlay();
}
for (const key of keys) {
  const button = document.createElement("button");
  button.className = "handle";
  button.type = "button";
  button.hidden = true;
  button.disabled = true;
  button.setAttribute("aria-label", names[key] + " corner");
  $("overlay").append(button);
  handles[key] = button;
  const sample = (event) => {
    if (!drag || ("pointerId" in event && event.pointerId !== drag.pointerId))
      return;
    const rect = controller.canvas.getBoundingClientRect();
    drag.quad[key] = authored({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
    paintOverlay();
    void queuePose(drag.quad);
  };
  button.onpointerdown = (event) => {
    if (busy || pumping || event.button !== 0) return;
    event.preventDefault();
    controller.pause();
    drag = {
      key,
      pointerId: event.pointerId,
      quad: structuredClone(currentPose()),
      startSpec: controller.getSpec(),
      guard: controller.getAuthoringGuard(),
      abort: new AbortController(),
    };
    button.setPointerCapture(event.pointerId);
    drag.cleanup = observePointerSessionBoundary({
      pointerId: event.pointerId,
      onRelease: (event) => {
        sample(event);
        void finishDrag();
      },
      onInterrupt: () => void finishDrag(true),
    });
  };
  button.onpointermove = sample;
  button.onpointercancel = () => void finishDrag(true);
  button.onkeydown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      void finishDrag(true);
      return;
    }
    const delta = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const quad = structuredClone(currentPose()),
      point = normalized(quad[key]),
      step = event.shiftKey ? 10 : 1;
    point.x += (delta[0] * step) / plans.canvas.width;
    point.y += (delta[1] * step) / plans.canvas.height;
    quad[key] = authored(point);
    void action({
      kind: "setKeyframe",
      planeId: selected,
      keyframe: {
        frame: frame(),
        quad,
        ...(currentPlane().keyframes.find((k) => k.frame === frame())
          ?.easingToNext
          ? {
              easingToNext: currentPlane().keyframes.find(
                (k) => k.frame === frame(),
              ).easingToNext,
            }
          : {}),
      },
    });
  };
  for (const axis of ["x", "y"]) {
    const label = document.createElement("label");
    label.textContent = names[key] + " " + axis.toUpperCase() + " %";
    const input = document.createElement("input");
    input.type = "number";
    input.step = "any";
    label.append(input);
    $("corners").append(label);
    cornerInputs[key + axis] = input;
    input.onchange = () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) {
        status("Enter a finite corner position");
        return;
      }
      const quad = structuredClone(currentPose()),
        point = normalized(quad[key]);
      point[axis] = n / 100;
      quad[key] = authored(point);
      void action({
        kind: "setKeyframe",
        planeId: selected,
        keyframe: { frame: frame(), quad },
      });
    };
  }
}
const smooth = { kind: "cubicBezier", x1: 0.22, y1: 0, x2: 0.35, y2: 1 };
$("plane").onchange = () => {
  selected = $("plane").value;
  controller.pause();
  inspector();
  scheduleCheckpoint();
};
$("play").onclick = () =>
  controller.getState().paused ? controller.play() : controller.pause();
$("position").oninput = () => {
  const n = Number($("position").value);
  controller.pause();
  controller.seek((n / 1000) * controller.getState().durationMs);
  inspector();
  scheduleCheckpoint();
};
$("capture").onclick = () =>
  void action({
    kind: "capturePose",
    frame: frame(),
    easingToNext:
      frame() === controller.getState().frameCount - 1 ? undefined : smooth,
  });
$("remove").onclick = () =>
  void action({ kind: "removeKeyframe", planeId: selected, frame: frame() });
$("duration").onchange = () => {
  const spec = controller.getSpec(),
    count = Math.round(
      (Number($("duration").value) * spec.timebase.numerator) /
        spec.timebase.denominator,
    );
  void action({ kind: "retime", timebase: spec.timebase, frameCount: count });
};
$("easing").onchange = () => {
  const kind = $("easing").value;
  void action({
    kind: "setKeyframe",
    planeId: selected,
    keyframe: {
      frame: frame(),
      quad: currentPose(),
      easingToNext: kind === "smooth" ? smooth : { kind },
    },
  });
};
$("strength").onchange = () => {
  const plane = structuredClone(currentPlane());
  plane.shadow = {
    ...(plane.shadow ?? {
      offset: { x: 8, y: 16 },
      blurSigmaPx: 12,
      color: [24, 39, 37],
    }),
    opacity: Number($("strength").value) / 100,
  };
  void action({ kind: "replacePlane", plane });
};
$("strength").oninput = () =>
  ($("strength-value").value = $("strength").value + "%");
async function restoreHistory(index) {
  if (busy || pumping || drag || index < 0 || index >= history.length) return;
  busy = true;
  controls();
  try {
    const entry = history[index],
      nextImages = await Promise.all(
        entry.bindings.map(async (b) => ({
          id: b.id,
          image: await imageFromSha(b.sha),
        })),
      );
    try {
      await controller.update(entry.spec, nextImages, {
        expectedRevision: controller.getState().revision,
      });
    } catch (error) {
      nextImages.forEach((s) => s.image.close());
      throw error;
    }
    images.forEach((s) => s.image.close());
    images = nextImages;
    bindings = structuredClone(entry.bindings);
    selected = entry.selected;
    historyIndex = index;
    controller.pause();
    controller.seek(entry.timeMs);
    await refresh();
    dirty = true;
    scheduleCheckpoint();
    status(index === 0 ? "Original work restored" : "History restored");
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    controls();
  }
}
$("undo").onclick = () => void restoreHistory(historyIndex - 1);
$("redo").onclick = () => void restoreHistory(historyIndex + 1);
function work() {
  const spec = controller.getSpec();
  const document = structuredClone(
    documentTemplate ?? {
      schema: "worldbend.spatial-document",
      version: "0.1",
      assets: bindings.map((b) => ({ id: b.id, contentVersion: b.sha })),
      expressions: [
        {
          kind: "temporal",
          id: "field-notes-editions",
          video: {
            schema: "worldbend.mockup-video",
            version: "0.1",
            backgroundRgb: [233, 229, 219],
            encoding: { format: "mp4H264", crf: 18 },
            mockupMotion: spec,
          },
          bindings: bindings.map((b) => ({
            role: "content",
            slotId: b.id,
            assetId: b.id,
          })),
        },
      ],
    },
  );
  document.expressions[0].video.mockupMotion = spec;
  document.assets = document.assets.map((asset) => ({
    ...asset,
    contentVersion: bindings.find((b) => b.id === asset.id).sha,
  }));
  return {
    document,
    bindings: structuredClone(bindings),
    view: {
      timeMs: controller.getState().timeMs,
      paused: controller.getState().paused,
      planeId: selected,
    },
  };
}
function scheduleCheckpoint() {
  checkpointWanted = true;
  clearTimeout(checkpointTimer);
  checkpointTimer = setTimeout(() => void flushCheckpoint(), 350);
}
async function flushCheckpoint() {
  if (checkpointRunning || !checkpointWanted || disposed) return;
  if (busy || pumping || drag) {
    clearTimeout(checkpointTimer);
    checkpointTimer = setTimeout(() => void flushCheckpoint(), 350);
    return;
  }
  checkpointRunning = true;
  try {
    while (checkpointWanted && !disposed) {
      checkpointWanted = false;
      const generation = ++checkpointGeneration;
      try {
        const result = await api("/api/checkpoint", {
          work: work(),
          workId,
          baseRevision: revision,
          generation,
          instanceId: clientInstance,
          ...(checkpointToken ? { expectedToken: checkpointToken } : {}),
        });
        checkpointToken = result.token;
        if (!busy) status("Draft protected · save to keep this version");
      } catch (error) {
        recoveryConflict = true;
        $("keep-copy").hidden = false;
        status(error.message);
        break;
      }
    }
  } finally {
    checkpointRunning = false;
  }
}
async function keepCopy() {
  if (busy || pumping || drag) return;
  busy = true;
  controls();
  clearTimeout(checkpointTimer);
  checkpointWanted = false;
  while (checkpointRunning)
    await new Promise((resolve) => setTimeout(resolve, 10));
  try {
    const saved = await api("/api/save-copy", { work: work() });
    workId = saved.id;
    revision = saved.state.revision;
    checkpointToken = undefined;
    checkpointWanted = false;
    dirty = false;
    recoveryConflict = false;
    $("keep-copy").hidden = true;
    const url = new URL(location.href);
    url.searchParams.set("work", workId);
    window.history.replaceState(null, "", url);
    status("Edits saved as a separate work · previous work retained");
  } catch (error) {
    status(error.message);
  } finally {
    busy = false;
    controls();
  }
}
$("keep-copy").onclick = () => void keepCopy();
async function save() {
  if (busy || pumping || drag) return;
  busy = true;
  controls();
  clearTimeout(checkpointTimer);
  checkpointWanted = false;
  while (checkpointRunning)
    await new Promise((resolve) => setTimeout(resolve, 10));
  try {
    const saved = await api("/api/save", {
      expectedRevision: revision,
      work: work(),
      workId,
    });
    revision = saved.state.revision;
    checkpointToken = undefined;
    checkpointWanted = false;
    dirty = false;
    recoveryConflict = false;
    $("keep-copy").hidden = true;
    status("Work saved · artwork and motion retained");
  } catch (error) {
    status(error.message);
    $("keep-copy").hidden = false;
  } finally {
    busy = false;
    controls();
  }
}
$("save").onclick = () => void save();
async function fitSource(originalSha, kind, sourceId) {
  const raw = await imageFromSha(originalSha),
    binding = bindings.find((b) => b.id === sourceId),
    raster = new CanvasRasterRenderer();
  try {
    const plan = await planCanvas(
      {
        schema: "worldbend.canvas",
        version: "0.1",
        operation: {
          kind,
          output: { width: binding.width, height: binding.height },
          anchor: { x: 0.5, y: 0.5 },
          background: { kind: "transparent" },
        },
      },
      { width: raw.width, height: raw.height },
    );
    raster.render(raw, plan, "high");
    return await register(raster.canvas);
  } finally {
    raw.close();
    raster.dispose();
  }
}
async function replaceSource(
  originalSha,
  kind = $("fit").value,
  intent = {
    sourceId: currentPlane().sourceId,
    guard: controller.getState().revision,
  },
) {
  if (busy || pumping || drag) return false;
  busy = true;
  controller.pause();
  controls();
  const { sourceId, guard } = intent;
  try {
    const sha = await fitSource(originalSha, kind, sourceId),
      image = await imageFromSha(sha),
      nextImages = images.map((s) =>
        s.id === sourceId ? { id: sourceId, image } : s,
      );
    try {
      await controller.update(controller.getSpec(), nextImages, {
        expectedRevision: guard,
      });
    } catch (error) {
      image.close();
      throw error;
    }
    images.find((s) => s.id === sourceId).image.close();
    images = nextImages;
    bindings = bindings.map((b) =>
      b.id === sourceId ? { ...b, sha, originalSha, fit: kind } : b,
    );
    await refresh();
    commitHistory();
    status("Artwork replaced · poses retained");
    return true;
  } catch (error) {
    status(error.message);
    return false;
  } finally {
    busy = false;
    controls();
  }
}
$("replace").onclick = () => $("asset").click();
$("asset").onchange = async () => {
  const file = $("asset").files[0];
  if (!file || busy || pumping || drag) return;
  const intent = {
      sourceId: currentPlane().sourceId,
      guard: controller.getState().revision,
    },
    kind = $("fit").value;
  try {
    const registered = await api("/api/asset", file, true);
    await replaceSource(registered.sha, kind, intent);
  } catch (error) {
    status(error.message);
  } finally {
    $("asset").value = "";
  }
};
$("fit").onchange = () =>
  void replaceSource(
    bindings.find((b) => b.id === currentPlane().sourceId).originalSha ??
      bindings.find((b) => b.id === currentPlane().sourceId).sha,
    $("fit").value,
  );
$("next").onclick = async () => {
  if (busy || pumping || drag) return;
  const intent = {
      sourceId: currentPlane().sourceId,
      guard: controller.getState().revision,
    },
    kind = $("fit").value;
  try {
    const candidate = artwork(!alternate).find((s) => s.id === "cover").image;
    const sha = await register(candidate);
    if (await replaceSource(sha, kind, intent)) alternate = !alternate;
  } catch (error) {
    status(error.message);
  }
};
async function exportWork(kind) {
  if (job || busy) return;
  controller.pause();
  try {
    const exported = work(),
      exportedFrame = frame();
    const result = await api("/api/export", {
      work: exported,
      kind,
      frame: exportedFrame,
    });
    job = result.id;
    $("cancel").hidden = false;
    $("download").hidden = true;
    status(kind === "mp4" ? "Rendering video…" : "Rendering image…");
    while (job && !disposed) {
      const state = await api("/api/jobs/" + job);
      if (state.status === "complete") {
        $("download").href = state.url;
        $("download").download = "field-notes-editions." + kind;
        $("download").textContent =
          kind === "mp4" ? "Download video" : "Download image";
        $("download").hidden = false;
        const now = work(),
          same =
            JSON.stringify(exported.document) ===
              JSON.stringify(now.document) &&
            JSON.stringify(exported.bindings) ===
              JSON.stringify(now.bindings) &&
            (kind !== "png" || frame() === exportedFrame);
        status(
          same
            ? "Export ready · saved work retained"
            : "Earlier edit exported · current edits retained",
        );
        if (!same)
          $("download").textContent =
            kind === "mp4"
              ? "Download earlier video"
              : "Download earlier image";
        break;
      }
      if (state.status === "failed" || state.status === "cancelled") {
        status(
          state.status === "cancelled"
            ? "Export cancelled · work retained"
            : state.error,
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } catch (error) {
    status(error.message);
  } finally {
    job = undefined;
    $("cancel").hidden = true;
  }
}
$("export-image").onclick = () => void exportWork("png");
$("export-video").onclick = () => void exportWork("mp4");
$("cancel").onclick = () => {
  if (job) void api("/api/jobs/" + job + "/cancel", {});
};
try {
  const loaded = await api(
    "/api/work" + (workId ? "?work=" + encodeURIComponent(workId) : ""),
  );
  let spec, view;
  const resumed = loaded.pending
    ? { revision: loaded.state?.revision ?? 0, work: loaded.pending.work }
    : loaded.state;
  if (loaded.pending) {
    checkpointToken = loaded.pending.token;
    dirty = true;
    recoveryConflict =
      loaded.pending.baseRevision !== (loaded.state?.revision ?? 0);
    $("keep-copy").hidden = !recoveryConflict;
  }
  if (resumed) {
    revision = resumed.revision;
    documentTemplate = structuredClone(resumed.work.document);
    bindings = resumed.work.bindings;
    spec = resumed.work.document.expressions[0].video.mockupMotion;
    view = resumed.work.view;
    selected = view?.planeId ?? spec.planes[0].id;
    images = await Promise.all(
      bindings.map(async (b) => ({
        id: b.id,
        image: await imageFromSha(b.sha),
      })),
    );
    status(
      loaded.pending
        ? recoveryConflict
          ? "Saved work changed · keep the recovered draft as a copy"
          : "Recovered the latest protected draft"
        : "Saved work reopened",
    );
  } else {
    spec = scene({ series: true });
    const cover = artwork().find((s) => s.id === "cover").image,
      sha = await register(cover);
    bindings = [
      {
        id: "cover",
        sha,
        originalSha: sha,
        fit: "contain",
        width: 600,
        height: 800,
      },
    ];
    images = [{ id: "cover", image: await imageFromSha(sha) }];
    dirty = true;
    status("Drag a corner to author a pose");
  }
  controller = await attachMockupMotion($("receiver"), spec, images, {
    paused: true,
    onChange: () => paintOverlay(),
    onError: (error) => status(error.message),
  });
  await refresh();
  if (view) {
    controller.seek(view.timeMs);
    if (!view.paused) controller.play();
  }
  history = [snapshot()];
  historyIndex = 0;
  controls();
  globalThis.sceneStudio = {
    get controller() {
      return controller;
    },
    get plans() {
      return plans;
    },
    get bindings() {
      return structuredClone(bindings);
    },
    work,
    save,
    action,
    queuePose,
    restoreHistory,
    replaceSource,
    get revision() {
      return revision;
    },
    get busy() {
      return busy || pumping || checkpointRunning;
    },
    flushCheckpoint,
    scheduleCheckpoint,
    keepCopy,
    api,
  };
} catch (error) {
  status(error.message);
  globalThis.sceneStudioError = error.stack;
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && drag) {
    event.preventDefault();
    void finishDrag(true);
  }
});
window.addEventListener("pagehide", () => {
  if (disposed || !controller) return;
  resumeView = {
    ...controller.getState(),
    spec: drag?.startSpec ?? controller.getSpec(),
  };
  disposed = true;
  ++refreshGeneration;
  clearTimeout(checkpointTimer);
  abort?.abort();
  drag?.abort.abort();
  drag?.cleanup?.();
  drag = undefined;
  poseQueue = undefined;
  controller.destroy();
  controls();
});
window.addEventListener("pageshow", () => {
  if (!disposed || !resumeView || reopening) return;
  reopening = (async () => {
    try {
      await pumpPromise;
      controller = await attachMockupMotion(
        $("receiver"),
        resumeView.spec,
        images,
        {
          paused: true,
          onChange: paintOverlay,
          onError: (error) => status(error.message),
        },
      );
      disposed = false;
      controller.seek(resumeView.timeMs);
      if (!resumeView.paused) controller.play();
      await refresh();
      if (dirty) scheduleCheckpoint();
      status("Work resumed · artwork and motion retained");
    } catch (error) {
      status(error.message);
    } finally {
      reopening = undefined;
    }
  })();
});

import { attachCardController, type CardController, type CardControllerState } from "@worldbend/web";
import type { CardRig, CardView } from "@worldbend/web";
import { localCardView } from "@worldbend/web/card-state";
import { projectCardPose, sampleCardPointer, sampleCardTurn } from "@worldbend/web/perspective";
import type { CardSample } from "./card-wire";
import { createCardRasterPreview } from "./card-raster-preview";
import { copyPlacementParameters } from "./copy-parameters";
import { createContextualHelp } from "./contextual-help";
import type { MainToUiMessage, UiToMainMessage } from "./messages";
import type { DesignerTaskWorkspace } from "./designer-workspace-common";

export interface CardWorkspaceCopy {
  title: string;
  reset: string;
  cancel: string;
  precision: string;
  apply: string;
  applying: string;
  applied: string;
  selectionEmpty: string;
  selectionSummary: string;
  helpTitle: string;
  helpBody: string;
  poseGroup: string;
  envelopeGroup: string;
  actionGroup: string;
  idleGroup: string;
  rotateX: string;
  rotateY: string;
  rotateZ: string;
  perspective: string;
  pivotX: string;
  pivotY: string;
  maxTiltX: string;
  maxTiltY: string;
  axis: string;
  axisX: string;
  axisY: string;
  direction: string;
  forward: string;
  reverse: string;
  turns: string;
  duration: string;
  easing: string;
  smooth: string;
  constant: string;
  stepAtEnd: string;
  customCurve: string;
  idleOn: string;
  idleAmplitudeX: string;
  idleAmplitudeY: string;
  idlePeriod: string;
  turn: string;
  play: string;
  pause: string;
  scrub: string;
  live: string;
  scrubbing: string;
  viewsGroup: string;
  viewRest: string;
  viewTilt(role: string): string;
  viewTurn(angle: number): string;
  publish: string;
  updateView: string;
  saveCopy: string;
  publishing: string;
  outputLimit: string;
  densityShortfall: string;
  edgeNote: string;
  front: string;
  useSelectionAsBack: string;
  mirrorBack: string;
  rigApplied: string;
  stillPublished: string;
  stillFailed: string;
  copyJson: string;
  copiedJson: string;
  copyFailed: string;
  face(value: CardControllerState["face"]): string;
  revolutions(value: number): string;
}

interface CardNodeState {
  nodeId: string;
  name: string;
  width: number;
  height: number;
  rig?: CardRig | undefined;
  backNodeId?: string | undefined;
  backName?: string | undefined;
  stills?: { viewId: string; view: CardView; sample?: CardSample }[];
  selectedStill?: { viewId: string; view: CardView };
}

const DEFAULT_RIG: CardRig = {
  schema: "worldbend.card",
  version: "0.1",
  elementSize: { width: 320, height: 200 },
  geometry: { perspective: 1000 },
  tilt: { maxRotateX: 10, maxRotateY: 14, smoothingMs: 110, settleMs: 420 },
  action: {
    axis: "y",
    direction: 1,
    turns: 1,
    durationMs: 720,
    easing: { kind: "cubicBezier", x1: 0.4, y1: 0, x2: 0.2, y2: 1 },
  },
};

const CARD_STILL_MAX_AXIS = 4096;

/**
 * Interactive-card key-pose authoring over the current artwork. The accepted
 * `worldbend.card` state drives the same core samplers the live web binding
 * uses, so the in-window preview, published stills and developer receipt all
 * agree by construction. The source artwork is only read; Apply stores the
 * rig, publishing a still is a separate explicit act.
 */
export function createCardWorkspace(input: {
  root: HTMLElement;
  copy(): CardWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
}): DesignerTaskWorkspace {
  const root = input.root;
  root.classList.add("designer-workspace", "card-workspace");
  root.innerHTML = `<header class="designer-header"><h1></h1><span data-role="help"></span></header>
    <div class="card-body">
      <div class="card-stage-wrap">
        <div class="card-stage" data-role="stage"><img alt="" data-role="front-image"><img alt="" data-role="back-image" hidden></div>
        <p class="card-stage-status" aria-live="off" data-role="stage-status"></p>
        <div class="card-stage-controls">
          <button type="button" data-role="turn"></button>
          <button type="button" data-role="idle-toggle"></button><button type="button" class="primary" data-role="publish-current"></button>
          <button type="button" data-role="save-copy" hidden></button><button type="button" data-role="back-assign" hidden></button>
          <label class="card-scrub"><span data-role="scrub-label"></span><input type="range" min="0" max="100" step="1" value="0" data-role="scrub"></label>
        </div>
      </div>
      <aside class="card-controls">
        <section class="card-control-group" data-group="pose"><h2></h2><div class="card-fields" data-role="pose-fields"></div></section>
        <section class="card-control-group" data-group="envelope"><h2></h2><div class="card-fields" data-role="envelope-fields"></div></section>
        <section class="card-control-group" data-group="action"><h2></h2><div class="card-fields" data-role="action-fields"></div></section>
        <section class="card-control-group" data-group="idle"><h2></h2><div class="card-fields" data-role="idle-fields"></div></section>
        <section class="card-control-group" data-group="views"><h2></h2><ul class="card-views" data-role="views"></ul>
</section>
      </aside>
    </div>
    <footer class="designer-footer"><span class="card-feedback" role="status" data-role="feedback"></span>
      <button data-role="copy-json" type="button"></button>
      <button data-role="cancel" type="button"></button><button data-role="reset" type="button"></button><button data-role="apply" class="primary" type="button"></button></footer>
    <p class="designer-error" role="alert" hidden></p><span class="sr-only" role="status" data-role="status"></span>`;
  const el = <T extends HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(selector);
    return node;
  };
  const help = createContextualHelp();
  help.button.dataset.role = "card-help";
  el("[data-role=help]").append(help.button);

  let active = false;
  let busy = false;
  let generation: number | undefined;
  let nodes: CardNodeState[] = [];
  let sourceRequest = 0;
  let publicationRequest = 0;
  let sourceKey: string | undefined;
  let source: { bytes: string; width: number; height: number } | undefined;
  let backSource: { bytes: string; width: number; height: number } | undefined;
  let backNodeId: string | undefined;
  let rig: CardRig = structuredClone(DEFAULT_RIG);
  let storedRig: CardRig | undefined;
  let controller: CardController | undefined;
  let scrubbing = false;
  let previewIdlePaused = false;
  let overrideView: CardView | undefined;
  let selectedViewIndex = -1;
  let selectedViewId: string | undefined;
  let scrubProgress = 0;
  let poseFaceRig = "";
  let publishJob = 0;
  const poseFaces = new Map<string, "front" | "back" | "edge" | "pending" | "invalid">();
  let previewTicket = 0;
  let previewFace: import("./card-wire").CardFace | undefined;
  let refreshRequested = false;
  let publication: { requestId: number; viewId: string; view: CardView; sample: CardSample; resolve(): void; reject(error: unknown): void } | undefined;
  const copy = (): CardWorkspaceCopy => input.copy();

  const rasterPreview = createCardRasterPreview(el("[data-role=stage]"), error => shell.showError(input.formatError(error)));
  const drawPreview = (pose: Parameters<typeof rasterPreview.draw>[0]) => {
    if (!active || !source) return;
    previewFace = pose.face;
    rasterPreview.draw(pose, el<HTMLImageElement>("[data-role=front-image]"),
      backSource && backNodeId ? el<HTMLImageElement>("[data-role=back-image]") : undefined);
    const state = controller?.getState();
    if (!overrideView && !scrubbing && state) {
      el("[data-role=stage-status]").textContent = `${copy().face(pose.face)} · ${copy().revolutions(state.revolutions)}`;
      el<HTMLButtonElement>("[data-role=turn]").disabled = busy || state.actionActive;
    } else if (overrideView && !scrubbing) el("[data-role=stage-status]").textContent = pose.face === "edge" ? copy().edgeNote : "";
    el<HTMLButtonElement>("[data-role=publish-current]").disabled = busy || pose.face === "edge";
    el<HTMLButtonElement>("[data-role=save-copy]").disabled = busy || pose.face === "edge";
  };
  const shell = {
    showError(text?: string) {
      const box = el(".designer-error");
      box.textContent = text ?? "";
      box.hidden = !text;
    },
  };

  const numberField = (holder: HTMLElement, spec: {
    field: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: () => number;
    write: (value: number) => void;
  }): void => {
    const row = document.createElement("label");
    row.className = "designer-field card-field";
    const text = document.createElement("span");
    text.textContent = spec.label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.value());
    input.dataset.field = spec.field;
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (input.value === "" || !Number.isFinite(value) || value < spec.min || value > spec.max || (spec.field === "turns" && !Number.isInteger(value)) || (spec.field === "direction" && value !== -1 && value !== 1)) {
        render();
        return;
      }
      spec.write(value);
      refreshPreview();
      render();
    });
    row.append(text, input);
    holder.append(row);
  };

  const poseHolder = el('[data-role=pose-fields]');
  const envelopeHolder = el('[data-role=envelope-fields]');
  const actionHolder = el('[data-role=action-fields]');
  const idleHolder = el('[data-role=idle-fields]');

  function buildControls(): void {
    poseHolder.replaceChildren();
    const precision = document.createElement("details");
    precision.className = "card-precision";
    const summary = document.createElement("summary"); summary.textContent = copy().precision;
    const preciseFields = document.createElement("div"); preciseFields.className = "card-fields";
    precision.append(summary, preciseFields);
    for (const spec of [
      { field: "rotate-x", label: copy().rotateX, min: -3600, max: 3600, step: 0.5, value: () => overrideRotate("x"), write: (v: number) => writeOverride("x", v) },
      { field: "rotate-y", label: copy().rotateY, min: -3600, max: 3600, step: 1, value: () => overrideRotate("y"), write: (v: number) => writeOverride("y", v) },
      { field: "rotate-z", label: copy().rotateZ, min: -180, max: 180, step: 0.5, value: () => overrideView?.rotateZ ?? rig.rest?.rotateZ ?? 0, write: (v: number) => { writePose("rotateZ", v); } },
      { field: "perspective", label: copy().perspective, min: 1, max: 20000, step: 10, value: () => rig.geometry.perspective, write: (v: number) => { rig = { ...rig, geometry: { ...rig.geometry, perspective: v } }; } },
      { field: "pivot-x", label: copy().pivotX, min: 0, max: 1, step: 0.01, value: () => rig.geometry.pivot?.x ?? 0.5, write: (v: number) => { rig = { ...rig, geometry: { ...rig.geometry, pivot: { ...(rig.geometry.pivot ?? { x: 0.5, y: 0.5 }), x: v } } }; } },
      { field: "pivot-y", label: copy().pivotY, min: 0, max: 1, step: 0.01, value: () => rig.geometry.pivot?.y ?? 0.5, write: (v: number) => { rig = { ...rig, geometry: { ...rig.geometry, pivot: { ...(rig.geometry.pivot ?? { x: 0.5, y: 0.5 }), y: v } } }; } },
    ]) numberField(spec.field.startsWith("pivot-") ? preciseFields : poseHolder, spec);
    poseHolder.append(precision);

    envelopeHolder.replaceChildren();
    for (const spec of [
      { field: "max-tilt-x", label: copy().maxTiltX, min: 0, max: 90, step: 0.5, value: () => rig.tilt.maxRotateX, write: (v: number) => { rig = { ...rig, tilt: { ...rig.tilt, maxRotateX: v } }; } },
      { field: "max-tilt-y", label: copy().maxTiltY, min: 0, max: 90, step: 0.5, value: () => rig.tilt.maxRotateY, write: (v: number) => { rig = { ...rig, tilt: { ...rig.tilt, maxRotateY: v } }; } },
    ]) numberField(envelopeHolder, spec);

    actionHolder.replaceChildren();
    const axisRow = document.createElement("label");
    axisRow.className = "designer-field card-field";
    axisRow.innerHTML = `<span></span>`;
    const axisLabel = axisRow.querySelector("span")!;
    axisLabel.textContent = copy().axis;
    const axisSelect = document.createElement("select");
    for (const value of ["y", "x"] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value === "y" ? copy().axisY : copy().axisX;
      axisSelect.append(option);
    }
    axisSelect.value = rig.action.axis ?? "y";
    axisSelect.addEventListener("change", () => {
      rig = { ...rig, action: { ...rig.action, axis: axisSelect.value as "x" | "y" } };
      refreshPreview();
      render();
    });
    axisRow.append(axisSelect);
    actionHolder.append(axisRow);
    const directionRow = document.createElement("label");
    directionRow.className = "designer-field card-field";
    const directionLabel = document.createElement("span"); directionLabel.textContent = copy().direction;
    const directionSelect = document.createElement("select"); directionSelect.dataset.field = "direction";
    for (const [value,label] of [["1",copy().forward],["-1",copy().reverse]]) {
      const option = document.createElement("option"); option.value = value!; option.textContent = label!;
      directionSelect.append(option);
    }
    directionSelect.value = String(rig.action.direction ?? 1);
    directionSelect.addEventListener("change", () => {
      rig = {...rig,action:{...rig.action,direction: directionSelect.value === "-1" ? -1 : 1}};
      refreshPreview(); render();
    });
    directionRow.append(directionLabel,directionSelect); actionHolder.append(directionRow);
    numberField(actionHolder, {
      field: "turns", label: copy().turns, min: 1, max: 8, step: 1,
      value: () => rig.action.turns ?? 1,
      write: (v: number) => { rig = { ...rig, action: { ...rig.action, turns: Math.max(1, Math.round(v)) } }; },
    });
    numberField(actionHolder, {
      field: "duration", label: copy().duration, min: 100, max: 10000, step: 20,
      value: () => rig.action.durationMs ?? 720,
      write: (v: number) => { rig = { ...rig, action: { ...rig.action, durationMs: v } }; },
    });
    const easingRow = document.createElement("label");
    easingRow.className = "designer-field card-field";
    const easingLabel = document.createElement("span");
    easingLabel.textContent = copy().easing;
    const easingSelect = document.createElement("select");
    for (const [value, label] of [
      ["cubic", copy().smooth],
      ["linear", copy().constant],
      ["hold", copy().stepAtEnd],
      ["custom", copy().customCurve],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      easingSelect.append(option);
    }
    const curve = rig.action.easing;
    easingSelect.value = !curve ? "cubic" : curve.kind === "linear" || curve.kind === "hold" ? curve.kind
      : curve.x1 === .4 && curve.y1 === 0 && curve.x2 === .2 && curve.y2 === 1 ? "cubic" : "custom";
    easingSelect.querySelector<HTMLOptionElement>('option[value="custom"]')!.disabled = true;
    easingSelect.addEventListener("change", () => {
      const easing = easingSelect.value === "linear" || easingSelect.value === "hold"
        ? ({ kind: easingSelect.value } as {kind: "linear" | "hold"})
        : ({ kind: "cubicBezier", x1: 0.4, y1: 0, x2: 0.2, y2: 1 } as const);
      rig = { ...rig, action: { ...rig.action, easing } };
      refreshPreview();
      render();
    });
    easingRow.append(easingLabel, easingSelect);
    actionHolder.append(easingRow);

    idleHolder.replaceChildren();
    const idleRow = document.createElement("label");
    idleRow.className = "designer-field card-field card-checkbox";
    const idleInput = document.createElement("input");
    idleInput.type = "checkbox";
    idleInput.checked = Boolean(rig.tilt.idle);
    idleInput.dataset.field = "idle";
    idleInput.addEventListener("change", () => {
      const idle = idleInput.checked
        ? { amplitudeX: 2.5, amplitudeY: 3.5, periodMs: 5200 }
        : null;
      rig = { ...rig, tilt: { ...rig.tilt, idle } };
      rebuildController();
      render();
    });
    const idleLabel = document.createElement("span");
    idleLabel.textContent = copy().idleOn;
    idleRow.append(idleInput, idleLabel);
    idleHolder.append(idleRow);
    for (const spec of [
      { field: "idle-x", label: copy().idleAmplitudeX, min: 0, max: 45, step: 0.5, value: () => rig.tilt.idle?.amplitudeX ?? 2.5, write: (v: number) => { rig = { ...rig, tilt: { ...rig.tilt, idle: { ...(rig.tilt.idle ?? { amplitudeX: 2.5, amplitudeY: 3.5, periodMs: 5200 }), amplitudeX: v } } }; } },
      { field: "idle-y", label: copy().idleAmplitudeY, min: 0, max: 45, step: 0.5, value: () => rig.tilt.idle?.amplitudeY ?? 3.5, write: (v: number) => { rig = { ...rig, tilt: { ...rig.tilt, idle: { ...(rig.tilt.idle ?? { amplitudeX: 2.5, amplitudeY: 3.5, periodMs: 5200 }), amplitudeY: v } } }; } },
      { field: "idle-period", label: copy().idlePeriod, min: 100, max: 60000, step: 100, value: () => rig.tilt.idle?.periodMs ?? 5200, write: (v: number) => { rig = { ...rig, tilt: { ...rig.tilt, idle: { ...(rig.tilt.idle ?? { amplitudeX: 2.5, amplitudeY: 3.5, periodMs: 5200 }), periodMs: v } } }; } },
    ]) numberField(idleHolder, spec);
  }

  function overrideRotate(axis: "x" | "y"): number {
    return axis === "x" ? overrideView?.rotateX ?? rig.rest?.rotateX ?? 0 : overrideView?.rotateY ?? rig.rest?.rotateY ?? 0;
  }
  function writeOverride(axis: "x" | "y", value: number): void {
    writePose(axis === "x" ? "rotateX" : "rotateY", value);
  }
  function writePose(axis: "rotateX" | "rotateY" | "rotateZ", value: number): void {
    const view = { ...(overrideView ?? rig.rest ?? {}), [axis]: value };
    // Editing the resting pose persists it; editing an inspected derived view
    // refines just that saved still, without accidentally redefining rest.
    if (selectedViewIndex <= 0 && !scrubbing && (!selectedViewId || selectedViewId === "derived-0")) rig = { ...rig, rest: view };
    else if (selectedViewIndex >= 1 && selectedViewIndex <= 5 && axis !== "rotateZ") {
      const base = rig.rest?.[axis] ?? 0;
      const maximum = Math.abs(value - base);
      if (maximum <= 90) rig = { ...rig, tilt: { ...rig.tilt, [axis === "rotateX" ? "maxRotateX" : "maxRotateY"]: maximum } };
      selectedViewIndex = -1;
    } else selectedViewIndex = -1;
    overrideView = view;
    scrubbing = false;
    showOverride();
  }
  function refreshPreview(): void {
    if (overrideView) applyOverrideTransform();
    else rebuildController();
  }

  /** Static pose display: the live controller stands down while it holds. */
  function showOverride(): void {
    controller?.dispose();
    controller = undefined;
    applyOverrideTransform();
  }

  /** Return the stage to the live pointer/idle/turn preview. */
  function showLivePreview(): void {
    overrideView = undefined;
    scrubbing = false;
    selectedViewIndex = -1;
    selectedViewId = undefined;
    rebuildController();
    render();
  }

  /** Derived views: rest, tilt extrema and turn samples of the accepted rig. */
  function views(): { key: string; label: string; view: CardView; edge: boolean }[] {
    const c = copy();
    const rigKey = JSON.stringify(rig);
    if (rigKey !== poseFaceRig) { poseFaces.clear(); poseFaceRig = rigKey; }
    const list: { key: string; label: string; view: CardView; edge: boolean }[] = [
      { key: "rest", label: c.viewRest, view: { ...rig.rest }, edge: false },
    ];
    const tiltX = rig.tilt.maxRotateX;
    const tiltY = rig.tilt.maxRotateY;
    for (const [key, label, x, y] of [
      ["tilt-x+", c.viewTilt(`+${c.rotateX}`), -tiltX, 0],
      ["tilt-x-", c.viewTilt(`-${c.rotateX}`), tiltX, 0],
      ["tilt-y+", c.viewTilt(`+${c.rotateY}`), 0, tiltY],
      ["tilt-y-", c.viewTilt(`-${c.rotateY}`), 0, -tiltY],
      ["tilt-xy", c.viewTilt(`${c.rotateX}+${c.rotateY}`), -tiltX, tiltY],
    ] as const) {
      list.push({ key, label, view: { rotateX: x, rotateY: y }, edge: false });
    }
    for (const percent of [25, 50, 75, 100]) {
      const progress = percent / 100;
      const angle =
        (rig.action.direction ?? 1) * (rig.action.turns ?? 1) * 360 * progress;
      const view = rig.action.axis === "x"
        ? { rotateX: angle }
        : { rotateY: angle };
      list.push({
        key: `turn-${percent}`,
        label: c.viewTurn(angle),
        view,
        edge: false,
      });
    }
    return list.map((entry, index) => {
      const view = localCardView(index === 0 ? entry.view : { ...rig.rest, ...entry.view,
        rotateX: (rig.rest?.rotateX ?? 0) + (entry.view.rotateX ?? 0),
        rotateY: (rig.rest?.rotateY ?? 0) + (entry.view.rotateY ?? 0) });
      const key = JSON.stringify({rig, view});
      if (!poseFaces.has(key)) {
        poseFaces.set(key, "pending");
        void projectCardPose({rig,view}).then(result => {if (poseFaceRig !== rigKey) return; poseFaces.set(key,result.face); if(active) render();}, () => {if (poseFaceRig !== rigKey) return; poseFaces.set(key,"invalid"); if(active) render();});
      }
      return {...entry, view, edge: poseFaces.get(key) === "edge" || poseFaces.get(key) === "invalid"};
    });
  }

  function previewRig(): CardRig {
    const image = el<HTMLImageElement>("[data-role=front-image]");
    const scale = image.clientWidth / (nodes[0]?.width ?? rig.elementSize.width) || 1;
    return { ...rig, elementSize: { width: image.clientWidth || rig.elementSize.width, height: image.clientHeight || rig.elementSize.height },
      geometry: { ...rig.geometry, perspective: rig.geometry.perspective * scale },
      ...(rig.rest ? { rest: scaleView(rig.rest, scale) } : {}) };
  }
  function scaleView(view: CardView, scale: number): CardView {
    return { ...view, ...(view.depth === undefined ? {} : { depth: view.depth * scale }),
      ...(view.translate ? { translate: { x: view.translate.x * scale, y: view.translate.y * scale } } : {}) };
  }
  function layoutPreview(): void {
    const stage = el("[data-role=stage]");
    const front = nodes[0];
    if (!front || !source) return;
    const scale = Math.min(stage.clientWidth * 0.72 / front.width, stage.clientHeight * 0.82 / front.height, 1);
    for (const image of root.querySelectorAll<HTMLImageElement>(".card-stage img")) {
      image.style.width = `${front.width * scale}px`;
      image.style.height = `${front.height * scale}px`;
    }
  }
  function rebuildController(): void {
    ++previewTicket;
    controller?.dispose(); controller = undefined;
    if (!source || scrubbing || overrideView || !active) return;
    layoutPreview();
    controller = attachCardController(el<HTMLImageElement>("[data-role=front-image]"), { ...previewRig(), ...(previewIdlePaused ? { tilt: {...rig.tilt, idle: null} } : {}) }, {
      surface: el("[data-role=stage]"),
      ...(backSource && backNodeId ? { back: el<HTMLImageElement>("[data-role=back-image]") } : {}),
      onError: error => shell.showError(input.formatError(error)),
      onPose: drawPreview,
    });
    const current = controller;
    void current.ready.then(() => { if (active && current === controller) render(); });
  }
  function applyOverrideTransform(): void {
    if (!source || !overrideView) return;
    layoutPreview();
    const ticket = ++previewTicket;
    const image = el<HTMLImageElement>("[data-role=front-image]");
    const backImage = el<HTMLImageElement>("[data-role=back-image]");
    const scaled = previewRig();
    const scale = scaled.elementSize.width / (nodes[0]?.width ?? rig.elementSize.width);
    void projectCardPose({ rig: scaled, view: scaleView(overrideView, scale) }).then(pose => {
      if (ticket !== previewTicket || !active || !overrideView) return;
      drawPreview(pose);
      image.style.transform = pose.rigidCss;
      image.style.transformOrigin = "0px 0px";
      image.style.backfaceVisibility = backSource && backNodeId ? "hidden" : "visible";
      backImage.style.transform = pose.backCss;
      backImage.style.transformOrigin = "0px 0px";
      backImage.style.backfaceVisibility = "hidden";
      el<HTMLButtonElement>("[data-role=publish-current]").disabled = busy || pose.face === "edge";
    }, error => { if (ticket === previewTicket) shell.showError(input.formatError(error)); });
  }
  const stage = el("[data-role=stage]");
  stage.tabIndex = 0;
  let drag: {pointer: number; x: number; y: number; view: CardView} | undefined;
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0 || busy || !source || ![el("[data-role=front-image]"), el("[data-role=back-image]")].includes(event.target as HTMLElement)) return;
    drag = {pointer: event.pointerId, x: event.clientX, y: event.clientY, view: {...(overrideView ?? rig.rest ?? {})}};
    stage.setPointerCapture(event.pointerId); controller?.dispose(); controller = undefined; event.preventDefault();
  });
  stage.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    overrideView = {...drag.view, rotateX: (drag.view.rotateX ?? 0) - (event.clientY - drag.y) / 3,
      rotateY: (drag.view.rotateY ?? 0) + (event.clientX - drag.x) / 3};
    if (selectedViewIndex <= 0 && !scrubbing && (!selectedViewId || selectedViewId === "derived-0")) rig = {...rig, rest: {...overrideView}};
    else selectedViewIndex = -1;
    scrubbing = false; showOverride(); render();
  });
  stage.addEventListener("pointerup", () => { drag = undefined; });
  stage.addEventListener("pointercancel", () => { drag = undefined; });
  stage.addEventListener("keydown", event => {
    if (!source || busy || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    const amount = event.shiftKey ? 5 : 1;
    const axis = event.key === "ArrowLeft" || event.key === "ArrowRight" ? "y" : "x";
    const sign = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    writeOverride(axis, overrideRotate(axis) + sign * amount); render(); event.preventDefault();
  });
  const stageResize = new ResizeObserver(() => refreshPreview());
  stageResize.observe(el("[data-role=stage]"));

  function selectView(index: number): void {
    // Pressing the shown view again toggles back to the live preview.
    if (index === selectedViewIndex && overrideView) {
      showLivePreview();
      return;
    }
    const chosen = views()[index];
    if (!chosen) return;
    selectedViewIndex = index;
    selectedViewId = `derived-${index}`;
    overrideView = { ...chosen.view };
    scrubbing = false;
    showOverride();
    render();
  }

  function render(): void {
    if (!active) return;
    const c = copy();
    const front = nodes[0];
    el("h1").textContent = front?.name ?? c.title;
    help.setCopy(c.helpTitle, c.helpBody);
    for (const group of root.querySelectorAll<HTMLElement>(".card-control-group")) {
      const title = group.querySelector("h2");
      if (!title) continue;
      const key = group.dataset.group;
      title.textContent =
        key === "pose" ? c.poseGroup
        : key === "envelope" ? c.envelopeGroup
        : key === "action" ? c.actionGroup
        : key === "idle" ? c.idleGroup
        : c.viewsGroup;
    }
    // Refresh field values without rebuilding focus targets.
    for (const input of root.querySelectorAll<HTMLInputElement>("[data-field]")) {
      input.disabled = busy || (input.dataset.field!.startsWith("idle-") && input.type === "number" && !rig.tilt.idle);
      if (document.activeElement === input) continue;
      const field = input.dataset.field!;
      const value = fieldValue(field);
      if (input.type === "checkbox") input.checked = Boolean(rig.tilt.idle);
      else if (value !== undefined) input.value = String(value);

    }
    for (const select of root.querySelectorAll<HTMLSelectElement>("select")) select.disabled = busy;
    el<HTMLInputElement>("[data-role=scrub]").disabled = busy || !source;
    backAssign.disabled = busy;
    const stageStatus = el("[data-role=stage-status]");
    if (!nodes.length) {
      stageStatus.textContent = c.selectionEmpty;
    } else if (!source) {
      stageStatus.textContent = c.selectionSummary.replace("{count}", "…");
    } else if (scrubbing) {
      stageStatus.textContent = c.scrubbing;
    } else if (overrideView) {
      stageStatus.textContent = "";
    } else {
      const state = controller?.getState();
      stageStatus.textContent = state
        ? `${c.face(state.face)} · ${c.revolutions(state.revolutions)}`
        : c.live;
    }
    el<HTMLButtonElement>("[data-role=turn]").textContent = c.turn;
    el<HTMLButtonElement>("[data-role=turn]").disabled = busy || Boolean(controller?.getState().actionActive) || (!controller && !overrideView);
    const idleButton = el<HTMLButtonElement>("[data-role=idle-toggle]");
    idleButton.textContent = rig.tilt.idle && !previewIdlePaused ? c.pause : c.play;
    idleButton.disabled = busy;
    el("[data-role=scrub-label]").textContent = c.scrub;
    backAssign.hidden = nodes.length < 2 && !backNodeId;
    backAssign.textContent = backNodeId
      ? c.mirrorBack
      : c.useSelectionAsBack.replace("{name}", nodes[1]?.name ?? "");
    const viewsList = el("[data-role=views]");
    const focusedView = document.activeElement?.closest(".card-view");
    const focusedIndex = focusedView ? [...viewsList.children].indexOf(focusedView) : -1;
    viewsList.replaceChildren();
    for (const [index, view] of views().entries()) {
      const row = document.createElement("li");
      row.className = "card-view";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = view.label;
      button.setAttribute("aria-pressed", String(index === selectedViewIndex));
      button.disabled = busy;
      button.addEventListener("click", () => selectView(index));
      row.append(button);
      viewsList.append(row);
    }
    if (focusedIndex >= 0) (viewsList.children[focusedIndex]?.querySelectorAll<HTMLButtonElement>("button")[0])?.focus();
    const ownsView = Boolean(nodes[0]?.stills?.some(still => still.viewId === (selectedViewId ?? "custom")));
    el<HTMLButtonElement>("[data-role=publish-current]").textContent = ownsView ? c.updateView : c.publish;
    const saveCopy = el<HTMLButtonElement>("[data-role=save-copy]");
    saveCopy.textContent = c.saveCopy; saveCopy.hidden = !ownsView; saveCopy.disabled = busy || !source || previewFace === "edge";
    el<HTMLButtonElement>("[data-role=publish-current]").disabled = busy || !source || previewFace === "edge";
    const copyJsonButton = el<HTMLButtonElement>("[data-role=copy-json]");
    copyJsonButton.textContent = c.copyJson;
    copyJsonButton.disabled = busy || !nodes.length || !source || Boolean(backNodeId && !backSource);
    el<HTMLButtonElement>("[data-role=cancel]").textContent = c.cancel;
    el<HTMLButtonElement>("[data-role=cancel]").disabled = busy;
    el<HTMLButtonElement>("[data-role=reset]").textContent = c.reset;
    el<HTMLButtonElement>("[data-role=reset]").disabled = busy;
    const applyButton = el<HTMLButtonElement>("[data-role=apply]");
    applyButton.textContent = busy ? c.applying : c.apply;
    applyButton.disabled = busy || !nodes.length || !validRig();
    const frontImage = el<HTMLImageElement>("[data-role=front-image]");
    const backImage = el<HTMLImageElement>("[data-role=back-image]");
    frontImage.hidden = !source;
    if (source && frontImage.src !== `data:image/png;base64,${source.bytes}`) frontImage.src = `data:image/png;base64,${source.bytes}`;
    backImage.hidden = !backSource || !backNodeId;
    if (backSource) backImage.src = `data:image/png;base64,${backSource.bytes}`;
  }

  function fieldValue(field: string): number | string | undefined {
    switch (field) {
      case "rotate-x": return overrideRotate("x");
      case "rotate-y": return overrideRotate("y");
      case "rotate-z": return overrideView?.rotateZ ?? rig.rest?.rotateZ ?? 0;
      case "perspective": return rig.geometry.perspective;
      case "pivot-x": return rig.geometry.pivot?.x ?? 0.5;
      case "pivot-y": return rig.geometry.pivot?.y ?? 0.5;
      case "max-tilt-x": return rig.tilt.maxRotateX;
      case "max-tilt-y": return rig.tilt.maxRotateY;
      case "direction": return rig.action.direction ?? 1;
      case "turns": return rig.action.turns ?? 1;
      case "duration": return rig.action.durationMs ?? 720;
      case "idle": return rig.tilt.idle ? "on" : "off";
      case "idle-x": return rig.tilt.idle?.amplitudeX ?? 2.5;
      case "idle-y": return rig.tilt.idle?.amplitudeY ?? 3.5;
      case "idle-period": return rig.tilt.idle?.periodMs ?? 5200;
      default: return undefined;
    }
  }

  function validRig(): boolean {
    return Array.from(root.querySelectorAll<HTMLInputElement>("[data-field][type=number]")).every(
      (input) => {
        const value = Number(input.value);
        return input.value !== "" && Number.isFinite(value) && (input.dataset.field !== "turns" || Number.isInteger(value)) && (input.dataset.field !== "direction" || value === -1 || value === 1) &&
          value >= Number(input.min) && value <= Number(input.max);
      },
    );
  }

  async function publishView(viewId: string, view: CardView, label: string, sample: CardSample = shownSample()): Promise<void> {
    if (!source || busy || generation === undefined) return;
    const expectedGeneration = generation;
    const job = ++publishJob;
    busy = true; render();
    try {
      const result = await renderStill(view);
      if (!active || generation !== expectedGeneration || job !== publishJob) return;
      await new Promise<void>((resolve, reject) => {
        const requestId = ++publicationRequest;
        publication = { requestId, viewId, view, sample, resolve, reject };
        input.post({ type: "publish-card-still", generation: expectedGeneration, requestId,
          viewId, sample, name: [...`${label} · ${nodes[0]?.name ?? copy().title}`].slice(0,96).join(""), view, rig: structuredClone(rig), ...result });
      });
    } catch (error) {
      if (job === publishJob && active && generation === expectedGeneration) throw error;
    } finally { if (job === publishJob) {publication = undefined; busy = false; render();} }
  }
  el<HTMLButtonElement>("[data-role=publish-current]").addEventListener("click", () => {
    const index = selectedViewIndex;
    const chosen = index >= 0 ? views()[index] : undefined;
    void publishView(selectedViewId ?? (chosen ? `derived-${index}` : "custom"), shownView(), chosen?.label ?? copy().poseGroup)
      .catch(error => shell.showError(input.formatError(error)));
  });

  el<HTMLButtonElement>("[data-role=save-copy]").addEventListener("click", () => {
    const id = `custom-${Date.now()}-${++publicationRequest}`;
    selectedViewId = id; selectedViewIndex = -1;
    void publishView(id, shownView(), copy().poseGroup).catch(error => shell.showError(input.formatError(error)));
  });

  /** Render a still through the same core pose the live controller samples.
   * A back view's projected quad winds the mirrored way, which the shared
   * solve rejects, so it is normalized by swapping each horizontal edge
   * (tl↔tr, br↔bl) and the source is drawn mirrored: together they reproduce
   * exactly what the browser shows for the mirrored-back default. */
  async function renderStill(view: CardView): Promise<{bytes: string; renderWidth: number; renderHeight: number; face: "front" | "back"}> {
    if (!source) throw new Error("no source");
    const { projectCardPose } = await import("@worldbend/web/perspective");
    const { solveTransformPreview, TransformWebGLRenderer } = await import("@worldbend/web");
    const reference = { width: nodes[0]!.width, height: nodes[0]!.height };
    const output = await projectCardPose({
      rig: { ...rig, elementSize: reference },
      view,
    });
    if (output.face === "edge") throw new Error(copy().edgeNote);
    const quad = output.quad;
    const target = output.face === "back"
      ? { tl: quad.tr, tr: quad.tl, br: quad.bl, bl: quad.br }
      : quad;
    const points = Object.values(target);
    const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
    const maxX = Math.max(...points.map(p => p.x)), maxY = Math.max(...points.map(p => p.y));
    const texture = output.face === "back" && backNodeId ? backSource : source;
    if (!texture) throw new Error(copy().stillFailed);
    const density = Math.min(2, texture.width / reference.width, texture.height / reference.height, CARD_STILL_MAX_AXIS / Math.max(Math.ceil(maxX - minX + 2) + 1, Math.ceil(maxY - minY + 2) + 1));
    const renderWidth = Math.ceil(maxX - minX + 2 / density);
    const renderHeight = Math.ceil(maxY - minY + 2 / density);
    if (renderWidth > 8192 || renderHeight > 8192) throw new Error(copy().outputLimit);
    if (density < 1.99) shell.showError(copy().densityShortfall);
    const corner = (point: { x: number; y: number }) => ({ x: (point.x - minX) * density + 1, y: (point.y - minY) * density + 1 });
    const spec = {
      schema: "worldbend.transform",
      version: "0.1",
      destination: {
        space: "pixel",
        reference: { width: renderWidth * density, height: renderHeight * density },
        quad: {
          tl: corner(target.tl),
          tr: corner(target.tr),
          br: corner(target.br),
          bl: corner(target.bl),
        },
      },
      content: { fit: "stretch" },
    };
    const solved = await solveTransformPreview(spec as never);
    const image = new Image();
    if (output.face === "back" && backNodeId && !backSource) throw new Error(copy().stillFailed);
    image.src = `data:image/png;base64,${output.face === "back" && backNodeId ? backSource!.bytes : source.bytes}`;
    await image.decode();
    const renderer = new TransformWebGLRenderer(undefined, { preserveDrawingBuffer: true });
    try {
      const textured = output.face === "back" && !backNodeId ? mirroredSource(image) : image;
      renderer.render(textured, solved, undefined, "high");
      const blob = await new Promise<Blob | null>((resolve) =>
        renderer.canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("still encoding failed");
      const bytes = arrayBufferBase64(await blob.arrayBuffer());
      if (bytes.length > 16_000_000) throw new Error(copy().outputLimit);
      return { bytes, renderWidth, renderHeight, face: output.face };
    } finally {
      renderer.dispose();
    }
  }

  function shownSample(): CardSample {
    if (scrubbing) return {kind: "turn", progress: scrubProgress};
    if (selectedViewIndex >= 6) return {kind: "angle", progress: [0.25,0.5,0.75,1][selectedViewIndex - 6]!};
    if (selectedViewIndex >= 1 && selectedViewIndex <= 5) {
      const region = rig.tilt.pointerRegion ?? {x:0,y:0,width:1,height:1};
      const [x,y] = ([[0.5,1],[0.5,0],[1,0.5],[0,0.5],[1,1]] as const)[selectedViewIndex-1]!;
      return {kind:"pointer", position:{x:region.x+x*region.width,y:region.y+y*region.height}};
    }
    const current = overrideView ? undefined : controller?.getState();
    return current ? {kind: "live", progress: current.actionProgress, angle: current.turnAngle,
      tiltX: current.tiltX, tiltY: current.tiltY, timeMs: current.idleTimeMs,
      ...(current.pointer ? {position: current.pointer} : {})} : {kind:"pose"};
  }
  function shownView(): CardView {
    if (overrideView) return {...overrideView};
    const current = controller?.getState();
    if (!current) return {...rig.rest};
    return localCardView({...rig.rest,
      rotateX: (rig.rest?.rotateX ?? 0) + current.tiltX + (rig.action.axis === "x" ? current.turnAngle % 360 : 0),
      rotateY: (rig.rest?.rotateY ?? 0) + current.tiltY + (rig.action.axis !== "x" ? current.turnAngle % 360 : 0)});
  }
  el<HTMLButtonElement>("[data-role=turn]").addEventListener("click", () => {
    void (async () => {
      if (scrubbing || overrideView || !controller) showLivePreview();
      const current = controller;
      await current?.ready;
      if (active && current === controller && !busy && current?.activate()) {
        el<HTMLButtonElement>("[data-role=turn]").disabled = current.getState().actionActive;
      }
    })().catch(error => shell.showError(input.formatError(error)));
  });
  el<HTMLButtonElement>("[data-role=idle-toggle]").addEventListener("click", () => {
    if (!rig.tilt.idle || previewIdlePaused) {
      rig = {...rig, tilt: {...rig.tilt, idle: rig.tilt.idle ?? {amplitudeX:2.5, amplitudeY:3.5, periodMs:5200}}};
      previewIdlePaused = false; showLivePreview();
    } else {
      const view = shownView(); previewIdlePaused = true;
      overrideView = view; selectedViewIndex = -1; scrubbing = false;
      showOverride(); render();
    }
  });
  const backAssign = el<HTMLButtonElement>("[data-role=back-assign]");
  backAssign.addEventListener("click", () => {
    if (backNodeId) {
      backNodeId = undefined;
      backSource = undefined;
    } else if (nodes[1]) {
      backNodeId = nodes[1].nodeId;
      if (generation !== undefined && sourceRequest >= 0) {
        input.post({ type: "request-card-source", generation, requestId: sourceRequest, nodeId: backNodeId, back: true });
      }
    }
    refreshPreview();
    render();
  });
  el<HTMLInputElement>("[data-role=scrub]").addEventListener("input", (event) => {
    const slider = event.target as HTMLInputElement;
    const progress = Number(slider.value) / 100; scrubProgress = progress;
    scrubbing = true;
    selectedViewIndex = -1; selectedViewId = undefined;
    controller?.dispose();
    controller = undefined;
    const ticket = ++previewTicket;
    void sampleCardTurn({ rig, progress }).then(sample => {
      if (!active || ticket !== previewTicket) return;
      overrideView = localCardView({ ...rig.rest, ...(rig.action.axis === "x"
        ? { rotateX: (rig.rest?.rotateX ?? 0) + sample.angle }
        : { rotateY: (rig.rest?.rotateY ?? 0) + sample.angle }) });
      applyOverrideTransform(); render();
    }, error => shell.showError(input.formatError(error)));
  });
  el<HTMLButtonElement>("[data-role=cancel]").addEventListener("click", () => {
    previewIdlePaused = false;
    rig = structuredClone(storedRig ?? defaultForNodes());
    backNodeId = nodes[0]?.backNodeId;
    sourceKey = undefined; requestSource();
    buildControls(); showLivePreview(); shell.showError();
  });
  el<HTMLButtonElement>("[data-role=reset]").addEventListener("click", () => {
    previewIdlePaused = false;
    rig = defaultForNodes();
    backNodeId = undefined; backSource = undefined;
    buildControls();
    showLivePreview();
    shell.showError();
  });
  el<HTMLButtonElement>("[data-role=copy-json]").addEventListener("click", () => {
    const payload = JSON.stringify(
      { schema: "worldbend.card-delivery", version: "0.1",
        rig: { ...rig, elementSize: { width: nodes[0]?.width ?? rig.elementSize.width, height: nodes[0]?.height ?? rig.elementSize.height } },
        front: { nodeId: nodes[0]?.nodeId, name: nodes[0]?.name, ...(source ? { pngBase64: source.bytes } : {}) },
        ...(backNodeId && backSource ? { back: { nodeId: backNodeId, pngBase64: backSource.bytes } } : {}) },
      null,
      2,
    );
    void copyPlacementParameters(payload).then(copied => {
      if (copied) el("[data-role=status]").textContent = copy().copiedJson;
      else shell.showError(copy().copyFailed);
    });
  });
  el<HTMLButtonElement>("[data-role=apply]").addEventListener("click", () => {
    if (!active || busy || !nodes.length || !validRig() || generation === undefined) return;
    busy = true; render();
    const expectedGeneration = generation;
    const job = ++publishJob;
    const nextBack = backNodeId;
    const next = structuredClone({ ...rig, elementSize: { width: nodes[0]!.width, height: nodes[0]!.height } });
    void projectCardPose({rig: next}).then(() => {
      if (!active || generation !== expectedGeneration || job !== publishJob) return;
      input.post({type: "apply-card-rig", generation: expectedGeneration, rig: next, ...(nextBack ? {backNodeId: nextBack} : {})});
    }, error => {
      if (!active || generation !== expectedGeneration || job !== publishJob) return;
      busy = false; shell.showError(input.formatError(error)); render();
    });
  });

  function defaultForNodes(): CardRig {
    const node = nodes[0];
    const base = structuredClone(DEFAULT_RIG);
    if (!node) return base;
    return { ...base, elementSize: { width: node.width, height: node.height } };
  }

  function requestSource(): void {
    if (!active || !nodes.length || generation === undefined) return;
    const front = nodes[0]!;
    const key = `${generation}:${front.nodeId}`;
    if (key === sourceKey) return;
    sourceKey = key;
    const requestId = ++sourceRequest;
    input.post({ type: "request-card-source", generation, requestId, nodeId: front.nodeId });
    const back = backNodeId ?? front.backNodeId;
    if (back) {
      input.post({ type: "request-card-source", generation, requestId, nodeId: back, back: true });
    }
  }

  return {
    enter() {
      active = true; generation = undefined;
      root.hidden = false;
      render();
      input.post({ type: "request-card-state" });
    },
    leave() {
      ++previewTicket; ++publishJob; drag = undefined;
      publication?.reject(new Error("Card workspace closed"));
      publication = undefined; busy = false; refreshRequested = false;
      rig = structuredClone(storedRig ?? defaultForNodes());
      backNodeId = nodes[0]?.backNodeId;
      overrideView = undefined; scrubbing = false; selectedViewId = undefined; selectedViewIndex = -1;
      help.close();
      controller?.dispose(); rasterPreview.clear();
      controller = undefined;
      active = false;
      root.hidden = true;
    },
    setSource() {
      this.selectionLoading();
    },
    selectionLoading() {
      ++previewTicket; ++publishJob; drag = undefined;
      previewFace = undefined;
      publication?.reject(new Error("Selection changed"));
      refreshRequested = false;
      poseFaces.clear();
      nodes = [];
      generation = undefined;
      source = undefined;
      backSource = undefined; rasterPreview.clear();
      sourceKey = undefined;
      backNodeId = undefined;
      storedRig = undefined;
      previewIdlePaused = false;
      rig = structuredClone(DEFAULT_RIG);
      selectedViewId = undefined; selectedViewIndex = -1;
      shell.showError();
      overrideView = undefined;
      scrubbing = false;
      busy = false;
      controller?.dispose();
      controller = undefined;
      buildControls();
      render();
      input.post({ type: "request-card-state" });
    },
    clearSource() {
      this.selectionLoading();
    },
    updateLocale() {
      buildControls();
      render();
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!active) return false;
      if (message.type === "card-state") {
        if (generation !== undefined && message.generation < generation) return true;
        const sameWorkpiece = nodes[0]?.nodeId === message.nodes[0]?.nodeId && generation === message.generation;
        const hadDraft = sameWorkpiece && storedRig !== undefined && dirty();
        generation = message.generation;
        nodes = message.nodes;
        if (!sameWorkpiece) {selectedViewId = undefined; selectedViewIndex = -1; overrideView = undefined; scrubbing = false;}
        const front = nodes[0];
        storedRig = structuredClone(front?.rig ?? defaultForNodes());
        if (!hadDraft) {
          rig = structuredClone(storedRig);
          backNodeId = front?.backNodeId;
          if (front?.selectedStill && !sameWorkpiece) {
            selectedViewId = front.selectedStill.viewId;
            selectedViewIndex = selectedViewId.startsWith("derived-") ? Number(selectedViewId.slice(8)) : -1;
            overrideView = {...front.selectedStill.view}; scrubbing = false;
          }
          buildControls();
        }
        ++previewTicket; controller?.dispose(); controller = undefined; rasterPreview.clear();
        source = undefined;
        backSource = undefined;
        sourceKey = undefined;
        render();
        requestSource();
        return true;
      }
      if (message.type === "card-source") {
        if (message.generation !== generation || message.requestId !== sourceRequest) return true;
        if (message.back) backSource = { bytes: message.bytes, width: message.width, height: message.height };
        else source = { bytes: message.bytes, width: message.width, height: message.height };
        render();
        refreshPreview();
        if (source && refreshRequested && (!backNodeId || backSource)) {
          refreshRequested = false;
          const saved = nodes[0]?.stills ?? [];
          const expectedGeneration = generation, expectedRequest = sourceRequest;
          void (async () => { for (const still of saved) {
            const view = await refreshedView(still);
            if (!active || generation !== expectedGeneration || sourceRequest !== expectedRequest) return;
            await publishView(still.viewId, view, copy().poseGroup, still.sample ?? {kind:"pose"});
          } })().catch(error => shell.showError(input.formatError(error)));
        }
        return true;
      }
      if (message.type === "card-rig-applied") {
        if (message.generation !== generation) return true;
        busy = false;
        storedRig = structuredClone(rig);
        if (nodes[0]) nodes[0].backNodeId = backNodeId;
        refreshRequested = Boolean(nodes[0]?.stills?.length);
        shell.showError();
        el("[data-role=status]").textContent = copy().rigApplied;
        render();
        return true;
      }
      if (message.type === "card-still-published") {
        if (message.generation !== generation) return true;
        if (message.requestId !== undefined && message.requestId !== publication?.requestId) return true;
        if (publication && nodes[0]) {
          const stills = nodes[0].stills ??= [];
          const saved = {viewId: publication.viewId, view: publication.view, sample: publication.sample};
          const index = stills.findIndex(still => still.viewId === saved.viewId);
          if (index < 0) stills.push(saved); else stills[index] = saved;
        }
        publication?.resolve();
        el("[data-role=status]").textContent = copy().stillPublished;
        render();
        return true;
      }
      if (message.type === "card-error") {
        if (message.generation !== generation) return true;
        if (message.operation === "source") {
          if (message.requestId === sourceRequest) shell.showError(input.formatError(message.message));
          return true;
        }
        if (message.operation === "publish" && message.requestId !== publication?.requestId) return true;
        publication?.reject(new Error(input.formatError(message.message)));
        busy = false;
        shell.showError(input.formatError(message.message));
        render();
        return true;
      }
      return false;
    },
    handleKeydown(event) {
      if (event.key !== "Escape") return false;
      if (scrubbing || overrideView) {
        showLivePreview();
        return true;
      }
      input.onBack();
      return true;
    },
    dispose() {
      stageResize.disconnect(); rasterPreview.dispose();
      ++previewTicket; ++publishJob; active = false;
      publication?.reject(new Error("Card workspace disposed"));
      publication = undefined; busy = false;
      help.dispose();
      controller?.dispose();
      controller = undefined;
    },
  };

  function dirty(): boolean {
    return JSON.stringify(rig) !== JSON.stringify(storedRig) || backNodeId !== nodes[0]?.backNodeId;
  }

  async function refreshedView(still: {viewId: string; view: CardView; sample?: CardSample}): Promise<CardView> {
    const sample = still.sample;
    if (sample?.kind === "turn" || sample?.kind === "angle") {
      const angle = sample.kind === "turn"
        ? (await sampleCardTurn({rig, progress: sample.progress!})).angle
        : (rig.action.direction ?? 1) * (rig.action.turns ?? 1) * 360 * sample.progress!;
      return localCardView({...rig.rest, ...(rig.action.axis === "x"
        ? {rotateX: (rig.rest?.rotateX ?? 0) + angle}
        : {rotateY: (rig.rest?.rotateY ?? 0) + angle})});
    }
    if (sample?.kind === "pointer") {
      const tilt = await sampleCardPointer({rig, ...sample.position!});
      return localCardView({...rig.rest, rotateX: (rig.rest?.rotateX ?? 0) + tilt.tiltX, rotateY: (rig.rest?.rotateY ?? 0) + tilt.tiltY});
    }
    // Explicit refinements and captured live poses retain their shown view.
    // Rest remains bound to the accepted rest; older unannotated derived
    // records retain their original behavior through the legacy identity.
    if (sample && still.viewId !== "derived-0") return still.view;
    const index = Number(still.viewId.replace("derived-", ""));
    return still.viewId.startsWith("derived-") ? views()[index]?.view ?? still.view : still.view;
  }
}

function arrayBufferBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

/** The mirrored-back default shows the front artwork mirrored; drawing the
 * source mirrored first keeps the normalized back quad's corner mapping
 * identical to what the live browser rendering samples. */
function mirroredSource(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return image as unknown as HTMLCanvasElement;
  context.translate(canvas.width, 0);
  context.scale(-1, 1);
  context.drawImage(image, 0, 0);
  return canvas;
}

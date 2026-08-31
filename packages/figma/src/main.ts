import type { MainToUiMessage, SourcePayload, UiToMainMessage } from "./messages";
import { isUiToMainMessage } from "./messages";
import { withTimeout } from "./async-timeout";
import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import { createLocalePreferenceSettings } from "./locale-preference";
import {
  LOCALE_STORAGE_KEY,
  resolveLocale,
  translate,
  userMessage,
  type LocalePreference,
  type MessageKey,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";
import {
  MAX_FIGMA_IMAGE_AXIS,
  parseOwnedRectifySpec,
  parseOwnedTransformSpec,
  RENDER_HEIGHT_KEY,
  RENDER_WIDTH_KEY,
  SHARED_NAMESPACE,
  SHARED_RECTIFY_KEY,
  SHARED_TRANSFORM_KEY,
} from "./stored-plane";
import {
  parseOwnedCanvasSpec,
  SHARED_CANVAS_KEY,
  type OwnedCanvasSpec,
} from "./stored-canvas";
import {
  CanvasRollbackIncompleteError,
  publishCanvasDocumentTransaction,
} from "./canvas-document-transaction";

figma.showUI(__html__, { width: 600, height: 720, themeColors: true });

const localeSettings = createLocalePreferenceSettings({
  read: () => figma.clientStorage.getAsync(LOCALE_STORAGE_KEY),
  write: (record) => figma.clientStorage.setAsync(LOCALE_STORAGE_KEY, record),
});
const storedLocalePreference = localeSettings.readStoredPreference();
let localePreference: LocalePreference = "system";
let activeLocale: SupportedLocale = "en";
let systemLocales: string[] = [];
let uiInitialized = false;

let selectionGeneration = 0;
let preparedSelection:
  | {
      generation: number;
      payload: SourcePayload;
      selectedNodeIds: ReadonlySet<string>;
      ancestorNodeIds: ReadonlySet<string>;
    }
  | undefined;
let applying = false;
let observedPage = figma.currentPage;
let loadSelectionTimer: ReturnType<typeof setTimeout> | undefined;
// True while a (re)load is scheduled but not started. Applies in this window
// would race a reload whose pixels are about to become stale.
let reloadScheduled = false;

// Marquee drags and panel edits fire selection/node changes far faster than
// once per frame, and each load rasterizes the source. Coalesce the storms;
// the first explicit UI readiness still loads immediately.
const SELECTION_SETTLE_DELAY_MS = 120;
const SOURCE_EXPORT_TIMEOUT_MS = 10_000;

figma.on("selectionchange", handleSelectionChange);
figma.on("currentpagechange", handleCurrentPageChange);
observedPage.on("nodechange", handleNodeChange);
figma.ui.onmessage = (message: unknown) => {
  if (!isUiToMainMessage(message)) {
    post({
      type: "apply-error",
      generation: selectionGeneration,
      message: userMessage("invalidApplyRequest"),
    });
    return;
  }
  if (message.type === "ready") {
    void initializeUi(message.systemLocales);
    return;
  }
  if (message.type === "set-locale") {
    setLocalePreference(message.preference);
    return;
  }
  if (!uiInitialized) {
    post({
      type: "apply-error",
      generation: selectionGeneration,
      message: userMessage("invalidApplyRequest"),
    });
    return;
  }
  if (message.type === "trigger-undo") {
    figma.triggerUndo();
    scheduleLoadSelection();
    return;
  }
  if (message.type === "request-source-raster") {
    void refreshSourceRaster(message);
    return;
  }
  if (message.type === "apply") void applyResult(message.payload);
  if (message.type === "apply-canvas") void applyCanvasSet(message.payload);
};

async function initializeUi(nextSystemLocales: string[]): Promise<void> {
  if (uiInitialized) return;
  systemLocales = [...nextSystemLocales];
  localePreference = await storedLocalePreference;
  activeLocale = resolveLocale(localePreference, systemLocales);
  uiInitialized = true;
  post({ type: "locale", preference: localePreference, locale: activeLocale });
  loadSelectionNow();
}

function setLocalePreference(preference: LocalePreference): void {
  if (!uiInitialized) return;
  localePreference = preference;
  activeLocale = resolveLocale(preference, systemLocales);
  post({ type: "locale", preference, locale: activeLocale });
  localeSettings.queueWrite(preference, () => {
    post({ type: "preference-error", message: userMessage("languageSaveFailed") });
  });
}

function scheduleLoadSelection(): void {
  // Advancing the generation on the leading edge invalidates in-flight
  // exports and apply responses immediately. Waiting until the debounce fires
  // would let stale work from the previous selection land in the UI.
  if (!reloadScheduled) {
    selectionGeneration += 1;
    reloadScheduled = true;
    // One leading-edge notification invalidates the old selection. Further
    // node-change samples only extend the settle window; they do not restart
    // the panel's busy state or flood the bridge with identical messages.
    post({
      type: "selection-loading",
      generation: selectionGeneration,
      nodeIds: figma.currentPage.selection.map((node) => node.id),
    });
  }
  const generation = selectionGeneration;
  if (loadSelectionTimer !== undefined) clearTimeout(loadSelectionTimer);
  loadSelectionTimer = setTimeout(() => {
    loadSelectionTimer = undefined;
    if (generation !== selectionGeneration) return;
    reloadScheduled = false;
    void loadSelection(generation);
  }, SELECTION_SETTLE_DELAY_MS);
}

function loadSelectionNow(): void {
  if (loadSelectionTimer !== undefined) {
    clearTimeout(loadSelectionTimer);
    loadSelectionTimer = undefined;
  }
  reloadScheduled = false;
  const generation = ++selectionGeneration;
  void loadSelection(generation);
}

async function loadSelection(generation: number): Promise<void> {
  const selection = [...figma.currentPage.selection];
  // The previous snapshot stays installed until the new one is ready so that
  // node changes landing inside the export window still invalidate through
  // it; applies during the window are rejected by the generation mismatch in
  // requirePreparedSelection.
  post({
    type: "selection-loading",
    generation,
    nodeIds: selection.map((node) => node.id),
  });
  try {
    const payload = await selectionPayload(selection);
    if (generation !== selectionGeneration) return;
    preparedSelection = {
      generation,
      payload,
      selectedNodeIds: new Set(selection.map((node) => node.id)),
      ancestorNodeIds: selectionAncestorIds(selection),
    };
    post({ type: "source", generation, payload });
  } catch (error) {
    if (generation !== selectionGeneration) return;
    post({
      type: "selection-error",
      generation,
      message: toUserMessage(error, "previewFailed"),
    });
  }
}

async function selectionPayload(selection: readonly SceneNode[]): Promise<SourcePayload> {
  if (selection.length === 1) {
    const source = selection[0];
    if (!source) throw userError("selectOneSource");
    const stored = readStoredPlane(source);
    if (stored.status === "invalid") {
      throw userError("invalidReusablePlane");
    }
    if (stored.status === "valid") {
      throw userError("selectResultWithSource");
    }
    return exportSource(source);
  }

  if (selection.length === 2) {
    const candidates = selection.map((node) => ({ node, stored: readStoredPlane(node) }));
    const invalid = candidates.find((candidate) => candidate.stored.status === "invalid");
    if (invalid) throw userError("invalidReusablePlane");
    const targets = candidates.filter((candidate) => candidate.stored.status === "valid");
    if (targets.length !== 1) {
      throw userError("selectOneSourceAndResult");
    }
    const target = targets[0];
    const source = candidates.find((candidate) => candidate.node.id !== target?.node.id)?.node;
    if (!target || target.stored.status !== "valid" || !source) {
      throw userError("selectOneSourceAndResult");
    }
    if (target.node.type !== "RECTANGLE") {
      throw userError("resultNotReplaceable");
    }
    return exportSource(source, target.node, target.stored.operation);
  }

  throw userError("selectOneOrPair");
}

async function exportSource(
  source: SceneNode,
  target?: RectangleNode,
  storedOperation?:
    | { kind: "transform"; spec: TransformSpec }
    | { kind: "rectify"; spec: RectifySpecInput }
    | { kind: "canvas"; spec: OwnedCanvasSpec },
): Promise<SourcePayload> {
  const box = source.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    throw userError("sourceNeedsVisibleBounds");
  }
  const placementBox = target?.absoluteBoundingBox ?? box;
  if (!placementBox || placementBox.width <= 0 || placementBox.height <= 0) {
    throw userError("resultNeedsVisibleBounds");
  }

  const desiredWidth = target ? target.width : Math.max(1, Math.round(box.width));
  const desiredHeight = target ? target.height : Math.max(1, Math.round(box.height));
  const renderWidth = checkedOutputAxis(desiredWidth);
  const renderHeight = checkedOutputAxis(desiredHeight);
  const desiredScale = Math.max(1, renderWidth / box.width, renderHeight / box.height);
  const maximumScale = Math.min(
    MAX_FIGMA_IMAGE_AXIS / box.width,
    MAX_FIGMA_IMAGE_AXIS / box.height,
  );
  const exportScale = Math.min(desiredScale, maximumScale);
  if (!Number.isFinite(exportScale) || exportScale <= 0) {
    throw userError("sourceUnsupportedSize");
  }
  const bytes = await withTimeout(
    source.exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: exportScale },
    }),
    SOURCE_EXPORT_TIMEOUT_MS,
    () => userError("sourceExportTimedOut"),
  );
  return {
    bytes,
    sourceNodeId: source.id,
    sourceName: source.name,
    renderWidth,
    renderHeight,
    placement: {
      x: placementBox.x,
      y: placementBox.y,
      width: placementBox.width,
      height: placementBox.height,
    },
    ...(storedOperation?.kind === "transform" && target
      ? { spec: storedOperation.spec, targetNodeId: target.id }
      : {}),
    ...(storedOperation?.kind === "rectify" && target
      ? { rectification: storedOperation.spec, targetNodeId: target.id }
      : {}),
    ...(storedOperation?.kind === "canvas" && target
      ? { canvas: storedOperation.spec, targetNodeId: target.id }
      : {}),
  };
}

async function refreshSourceRaster(
  request: Extract<UiToMainMessage, { type: "request-source-raster" }>,
): Promise<void> {
  try {
    if (
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      !preparedSelection ||
      preparedSelection.generation !== request.generation ||
      preparedSelection.payload.sourceNodeId !== request.sourceNodeId ||
      preparedSelection.payload.targetNodeId !== request.targetNodeId ||
      !selectionMatches(request.sourceNodeId, request.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }
    const source = await figma.getNodeByIdAsync(request.sourceNodeId);
    if (!source || !isSceneNode(source)) throw userError("selectionChanged");
    const box = source.absoluteBoundingBox;
    if (!box || box.width <= 0 || box.height <= 0) {
      throw userError("sourceNeedsVisibleBounds");
    }
    const requestedScale = Math.max(
      request.desiredWidth / box.width,
      request.desiredHeight / box.height,
    );
    const maximumScale = Math.min(
      MAX_FIGMA_IMAGE_AXIS / box.width,
      MAX_FIGMA_IMAGE_AXIS / box.height,
    );
    const exportScale = Math.min(requestedScale, maximumScale);
    if (!Number.isFinite(exportScale) || exportScale <= 0) {
      throw userError("sourceUnsupportedSize");
    }
    const bytes = await withTimeout(
      source.exportAsync({
        format: "PNG",
        constraint: { type: "SCALE", value: exportScale },
      }),
      SOURCE_EXPORT_TIMEOUT_MS,
      () => userError("sourceExportTimedOut"),
    );
    if (
      request.generation !== selectionGeneration ||
      reloadScheduled ||
      !selectionMatches(request.sourceNodeId, request.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }
    post({
      type: "source-raster",
      generation: request.generation,
      requestId: request.requestId,
      bytes,
    });
  } catch (error) {
    post({
      type: "source-raster-error",
      generation: request.generation,
      requestId: request.requestId,
      message: toUserMessage(error, "previewFailed"),
    });
  }
}

async function applyResult(
  payload: Extract<UiToMainMessage, { type: "apply" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({
      type: "apply-error",
      generation: requestGeneration,
      message: userMessage("applyAlreadyInProgress"),
    });
    return;
  }
  applying = true;
  try {
    const prepared = requirePreparedSelection(payload);
    const source = await figma.getNodeByIdAsync(payload.sourceNodeId);
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !source ||
      !isSceneNode(source) ||
      !selectionMatches(payload.sourceNodeId, payload.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }

    let existing: RectangleNode | undefined;
    // Apply-as-copy keeps an existing pair result untouched and publishes a
    // new rectangle instead of replacing in place.
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (requestGeneration !== selectionGeneration || reloadScheduled) {
        throw userError("selectionChanged");
      }
      if (!target || target.type !== "RECTANGLE") {
        throw userError("resultUnavailable");
      }
      const stored = readStoredPlane(target);
      if (
        stored.status !== "valid" ||
        checkedOutputAxis(target.width) !== prepared.renderWidth ||
        checkedOutputAxis(target.height) !== prepared.renderHeight
      ) {
        throw userError("resultChanged");
      }
      existing = target;
    }

    const storedKind = payload.rectification ? "rectify" : "transform";
    const serializedOperation = JSON.stringify(payload.rectification ?? payload.spec);
    // Establish an explicit pre-mutation snapshot. A post-mutation commit alone
    // can leave a long-running UI plugin without the boundary needed for the
    // host's next Undo to restore an in-place replacement.
    figma.commitUndo();
    const image = figma.createImage(payload.bytes);
    const operation = existing ? "replace" : "apply";
    const result = await publishResult({
      ...(existing ? { existing } : {}),
      imageHash: image.hash,
      storedKind,
      serializedOperation,
      sourceName: source.name,
      placement: payload.placement,
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    finishAppliedResult(result, operation, requestGeneration);
  } catch (error) {
    post({
      type: "apply-error",
      generation: requestGeneration,
      message: toUserMessage(error, "unexpectedError"),
    });
  } finally {
    applying = false;
  }
}

async function applyCanvasSet(
  payload: Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({
      type: "apply-canvas-error",
      generation: requestGeneration,
      message: userMessage("applyAlreadyInProgress"),
    });
    return;
  }
  applying = true;
  try {
    const prepared = requirePreparedSelection(payload);
    const source = await figma.getNodeByIdAsync(payload.sourceNodeId);
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !source ||
      !isSceneNode(source) ||
      !selectionMatches(payload.sourceNodeId, payload.targetNodeId)
    ) {
      throw userError("selectionChanged");
    }

    let existing: RectangleNode | undefined;
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (requestGeneration !== selectionGeneration || reloadScheduled) {
        throw userError("selectionChanged");
      }
      if (!target || target.type !== "RECTANGLE") throw userError("resultUnavailable");
      const stored = readStoredPlane(target);
      if (
        stored.status !== "valid" ||
        stored.operation.kind !== "canvas" ||
        checkedOutputAxis(target.width) !== prepared.renderWidth ||
        checkedOutputAxis(target.height) !== prepared.renderHeight
      ) {
        throw userError("resultChanged");
      }
      existing = target;
    }

    if (requestGeneration !== selectionGeneration || reloadScheduled) {
      throw userError("selectionChanged");
    }
    const results = await publishCanvasDocumentTransaction({
      payload,
      sourceName: source.name,
      ...(existing ? { existing } : {}),
      createImage: (bytes) => figma.createImage(bytes),
      commitUndo: () => figma.commitUndo(),
      publish: publishResult,
    });
    finishAppliedCanvasResults(results, existing ? "replace" : "apply", requestGeneration);
  } catch (error) {
    post({
      type: "apply-canvas-error",
      generation: requestGeneration,
      message: error instanceof CanvasRollbackIncompleteError
        ? userMessage("rollbackIncomplete")
        : toUserMessage(error, "unexpectedError"),
    });
  } finally {
    applying = false;
  }
}

function finishAppliedCanvasResults(
  results: RectangleNode[],
  operation: "apply" | "replace",
  generation: number,
): void {
  preparedSelection = undefined;
  try {
    figma.viewport.scrollAndZoomIntoView(results);
  } catch {
    // Viewport movement does not determine publication success.
  }
  try {
    figma.notify(
      translate(activeLocale, operation === "replace" ? "canvasReplaced" : "canvasApplied"),
    );
  } catch {
    // Notifications are non-authoritative confirmation only.
  }
  try {
    figma.commitUndo();
  } catch {
    // Visible results remain the truthful operation outcome.
  }
  post({
    type: "apply-canvas-complete",
    generation,
    targetNodeIds: results.map((result) => result.id),
    operation,
  });
}

function finishAppliedResult(
  result: RectangleNode,
  operation: "apply" | "replace",
  generation: number,
): void {
  // The pre-mutation commit in applyResult is the one host Undo boundary.
  // Keep the user's source/pair selection stable: selecting the result creates
  // a separate host history step before the visible write can be undone.
  preparedSelection = undefined;
  try {
    figma.viewport.scrollAndZoomIntoView([result]);
  } catch {
    // Selection and viewport movement do not determine write success.
  }
  try {
    figma.notify(
      translate(activeLocale, operation === "replace" ? "perspectiveReplaced" : "perspectiveApplied"),
    );
  } catch {
    // Notifications are non-authoritative confirmation only.
  }
  try {
    // Close this mutation as its own host history item. The pre-mutation
    // commit preserves replacement rollback; keeping selection stable avoids
    // the extra no-op selection step that previously sat above this commit.
    figma.commitUndo();
  } catch {
    // The visible result remains the truthful operation outcome.
  }
  post({
    type: "apply-complete",
    generation,
    targetNodeId: result.id,
    operation,
  });
}

function handleSelectionChange(): void {
  scheduleLoadSelection();
}

function handleCurrentPageChange(): void {
  observedPage.off("nodechange", handleNodeChange);
  observedPage = figma.currentPage;
  observedPage.on("nodechange", handleNodeChange);
  scheduleLoadSelection();
}

function handleNodeChange(event: NodeChangeEvent): void {
  if (applying || !preparedSelection) return;
  if (event.nodeChanges.some((change) => nodeChangeTouchesPreparedSelection(change))) {
    scheduleLoadSelection();
  }
}

function nodeChangeTouchesPreparedSelection(change: NodeChange): boolean {
  const prepared = preparedSelection;
  if (!prepared) return false;
  if (prepared.selectedNodeIds.has(change.id) || prepared.ancestorNodeIds.has(change.id)) {
    return true;
  }
  // Removed nodes no longer expose ancestry. Deletion is uncommon, and a
  // conservative refresh is preferable to applying pixels from stale content.
  if (change.type === "DELETE") return true;
  let node: BaseNode | null = "parent" in change.node ? change.node : null;
  while (node) {
    if (prepared.selectedNodeIds.has(node.id)) return true;
    node = node.parent;
  }
  return false;
}

function selectionAncestorIds(selection: readonly SceneNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const selected of selection) {
    let parent = selected.parent;
    while (parent && parent.type !== "PAGE" && parent.type !== "DOCUMENT") {
      ids.add(parent.id);
      parent = parent.parent;
    }
  }
  return ids;
}

async function publishResult(input: {
  existing?: RectangleNode;
  imageHash: string;
  storedKind: "transform" | "rectify" | "canvas";
  serializedOperation: string;
  sourceName: string;
  placement: SourcePayload["placement"];
  renderWidth: number;
  renderHeight: number;
}): Promise<RectangleNode> {
  const existingFills = input.existing?.fills;
  if (existingFills === figma.mixed) {
    throw userError("mixedFills");
  }
  const priorFills = existingFills ? [...existingFills] : undefined;
  const priorShared = input.existing?.getSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_TRANSFORM_KEY,
  );
  const priorRectification = input.existing?.getSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_RECTIFY_KEY,
  );
  const priorCanvas = input.existing?.getSharedPluginData(
    SHARED_NAMESPACE,
    SHARED_CANVAS_KEY,
  );
  const priorWidth = input.existing?.getPluginData(RENDER_WIDTH_KEY);
  const priorHeight = input.existing?.getPluginData(RENDER_HEIGHT_KEY);
  const priorFrame = input.existing
    ? {
        x: input.existing.x,
        y: input.existing.y,
        width: input.existing.width,
        height: input.existing.height,
      }
    : undefined;
  const result = input.existing ?? figma.createRectangle();
  const created = !input.existing;
  try {
    if (created) {
      result.name = `${input.sourceName} · Worldbend`;
      result.resize(input.placement.width, input.placement.height);
      // A created node lives on the current page, where node coordinates and
      // absolute coordinates agree, so the payload placement applies as-is.
      result.x = input.placement.x;
      result.y = input.placement.y;
    } else {
      // The payload placement is absolute while node x/y are parent-relative.
      // Preserve the payload's intended center (including a real transform
      // translation) by mapping it through the parent's affine transform.
      // This keeps nested results in their parent without silently ignoring
      // the newly composed placement.
      result.resize(input.renderWidth, input.renderHeight);
      const center = parentPointFromAbsolute(result, {
        x: input.placement.x + input.placement.width / 2,
        y: input.placement.y + input.placement.height / 2,
      });
      result.x = center.x - input.renderWidth / 2;
      result.y = center.y - input.renderHeight / 2;
    }
    result.fills = [{ type: "IMAGE", imageHash: input.imageHash, scaleMode: "FILL" }];
    result.setSharedPluginData(
      SHARED_NAMESPACE,
      SHARED_TRANSFORM_KEY,
      input.storedKind === "transform" ? input.serializedOperation : "",
    );
    result.setSharedPluginData(
      SHARED_NAMESPACE,
      SHARED_RECTIFY_KEY,
      input.storedKind === "rectify" ? input.serializedOperation : "",
    );
    result.setSharedPluginData(
      SHARED_NAMESPACE,
      SHARED_CANVAS_KEY,
      input.storedKind === "canvas" ? input.serializedOperation : "",
    );
    result.setPluginData(RENDER_WIDTH_KEY, String(input.renderWidth));
    result.setPluginData(RENDER_HEIGHT_KEY, String(input.renderHeight));
    return result;
  } catch (error) {
    try {
      if (created) {
        result.remove();
      } else if (priorFills && priorFrame) {
        result.resize(priorFrame.width, priorFrame.height);
        result.x = priorFrame.x;
        result.y = priorFrame.y;
        result.fills = priorFills;
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, priorShared ?? "");
        result.setSharedPluginData(
          SHARED_NAMESPACE,
          SHARED_RECTIFY_KEY,
          priorRectification ?? "",
        );
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY, priorCanvas ?? "");
        result.setPluginData(RENDER_WIDTH_KEY, priorWidth ?? "");
        result.setPluginData(RENDER_HEIGHT_KEY, priorHeight ?? "");
      }
    } catch {
      throw userError("rollbackIncomplete");
    }
    throw error;
  }
}

function parentPointFromAbsolute(
  result: RectangleNode,
  point: { x: number; y: number },
): { x: number; y: number } {
  const parent = result.parent;
  if (!parent || !("absoluteTransform" in parent)) return point;
  const [[a, c, e], [b, d, f]] = parent.absoluteTransform;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= Number.EPSILON) {
    throw userError("resultChanged");
  }
  const x = point.x - e;
  const y = point.y - f;
  const local = {
    x: (d * x - c * y) / determinant,
    y: (-b * x + a * y) / determinant,
  };
  if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) {
    throw userError("resultChanged");
  }
  return local;
}

function requirePreparedSelection(
  payload:
    | Extract<UiToMainMessage, { type: "apply" }>["payload"]
    | Extract<UiToMainMessage, { type: "apply-canvas" }>["payload"],
): SourcePayload {
  const prepared = preparedSelection;
  if (
    !prepared ||
    prepared.generation !== payload.generation ||
    prepared.generation !== selectionGeneration ||
    // A scheduled reload invalidates the snapshot's pixels even though its
    // generation has not advanced yet.
    reloadScheduled ||
    prepared.payload.sourceNodeId !== payload.sourceNodeId ||
    prepared.payload.targetNodeId !== payload.targetNodeId
  ) {
    throw userError("selectionChanged");
  }
  return prepared.payload;
}

function readStoredPlane(
  node: SceneNode,
):
  | { status: "none" }
  | { status: "invalid" }
  | {
      status: "valid";
      operation:
        | { kind: "transform"; spec: TransformSpec }
        | { kind: "rectify"; spec: RectifySpecInput }
        | { kind: "canvas"; spec: OwnedCanvasSpec };
    } {
  const transform = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY);
  const rectification = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY);
  const canvas = node.getSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY);
  if (!transform && !rectification && !canvas) return { status: "none" };
  // Exactly one operation owns a reusable result. Ambiguous or malformed
  // plugin data is rejected instead of choosing one silently.
  if ([transform, rectification, canvas].filter(Boolean).length !== 1) {
    return { status: "invalid" };
  }
  if (transform) {
    const parsed = parseOwnedTransformSpec(transform);
    return parsed
      ? { status: "valid", operation: { kind: "transform", spec: parsed } }
      : { status: "invalid" };
  }
  if (rectification) {
    const parsed = parseOwnedRectifySpec(rectification);
    return parsed
      ? { status: "valid", operation: { kind: "rectify", spec: parsed } }
      : { status: "invalid" };
  }
  const parsed = parseOwnedCanvasSpec(canvas);
  return parsed
    ? { status: "valid", operation: { kind: "canvas", spec: parsed } }
    : { status: "invalid" };
}

function checkedOutputAxis(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded < 1) throw userError("outputInvalidDimensions");
  if (rounded > MAX_FIGMA_IMAGE_AXIS) {
    throw userError("outputLimitExceeded", { limit: MAX_FIGMA_IMAGE_AXIS });
  }
  return rounded;
}

class UserFacingError extends Error {
  constructor(readonly userMessage: UserMessage) {
    super(userMessage.key);
  }
}

function userError(
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
): UserFacingError {
  return new UserFacingError(userMessage(key, values));
}

function toUserMessage(error: unknown, fallback: MessageKey): UserMessage {
  return error instanceof UserFacingError ? error.userMessage : userMessage(fallback);
}

function selectionMatches(sourceNodeId: string, targetNodeId?: string): boolean {
  const actual = figma.currentPage.selection.map((node) => node.id).sort();
  const expected = [sourceNodeId, ...(targetNodeId ? [targetNodeId] : [])].sort();
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function isSceneNode(node: BaseNode): node is SceneNode {
  return "visible" in node;
}

function post(message: MainToUiMessage): void {
  try {
    figma.ui.postMessage(message);
  } catch {
    // A closed UI cannot receive messages; the canvas state remains the
    // truthful outcome either way.
  }
}

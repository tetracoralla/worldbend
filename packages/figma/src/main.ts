import type { TransformSpec } from "@worldbend/web/types";
import type {
  MainToUiMessage,
  SourcePayload,
  TemplateMutationReceipt,
  UiToMainMessage,
  NativeApplyPayload,
} from "./messages";
import { isUiToMainMessage } from "./messages";
import { withTimeout } from "./async-timeout";
import { createLatestAsyncQueue } from "./latest-async-queue";
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
  isFigmaImageAxis,
  MAX_FIGMA_IMAGE_AXIS,
  RENDER_HEIGHT_KEY,
  RENDER_WIDTH_KEY,
  SHARED_NAMESPACE,
} from "./stored-plane";
import { readStoredBinding, SHARED_BINDING_KEY, writeStoredBinding } from "./stored-binding";
import { canUseNativeSource, loadNativeRenderer, nativeDocumentParts, nodePage, NativeRollbackIncompleteError, publishNativeResult, restoreNativeProjection,
  nativePublicationUndoFor, matchesNativePublicationUndo, restoreNativePublicationUndo, type NativePublicationUndo } from "./native-document";
import { readNativeProjection, readCopiedNativeProjection, SHARED_NATIVE_KEY } from "./native-projective";
import {
  ownedCanvasOperationOutput,
} from "./stored-canvas";
import {
  CanvasRollbackIncompleteError,
  publishCanvasDocumentTransaction,
} from "./canvas-document-transaction";
import {
  readStoredOperation,
  readStoredOperationSlots,
  restoreStoredOperationSlots,
  writeStoredOperation,
  type StoredOperation,
} from "./stored-operation";
import type { StoredDesignerTask } from "./stored-designer-task";
import { placementBeside } from "./result-placement";
import {
  MAX_SAVED_SPATIAL_TEMPLATES,
  TEMPLATE_LIBRARY_STORAGE_KEY,
  checkedTemplateLibrary,
  canvasTemplateFromSet,
  emptyTemplateLibrary,
  parseTemplateLibrary,
  spatialTemplateFromMockup,
  type SavedSpatialTemplate,
  type StoredTemplateLibrary,
} from "./stored-template-library";

figma.showUI(__html__, { width: 820, height: 760, themeColors: true });

const localeSettings = createLocalePreferenceSettings({
  read: () => figma.clientStorage.getAsync(LOCALE_STORAGE_KEY),
  write: (record) => figma.clientStorage.setAsync(LOCALE_STORAGE_KEY, record),
});
const storedLocalePreference = localeSettings.readStoredPreference();
const storedTemplateLibrary = (
  figma.clientStorage?.getAsync(TEMPLATE_LIBRARY_STORAGE_KEY) ?? Promise.resolve(undefined)
)
  .then((value) => ({ ok: true as const, value }))
  .catch(() => ({ ok: false as const }));
let localePreference: LocalePreference = "system";
let activeLocale: SupportedLocale = "en";
let systemLocales: string[] = [];
let uiInitialized = false;
let templateLibrary: StoredTemplateLibrary = emptyTemplateLibrary();
let templateLibraryReadFailed = false;
let templateMutation = Promise.resolve();

let selectionGeneration = 0;
let preparedSelection:
  | {
      generation: number;
      payload: SourcePayload;
      selectedNodeIds: ReadonlySet<string>;
      observedNodeIds: ReadonlySet<string>;
      ancestorNodeIds: ReadonlySet<string>;
    }
  | undefined;
let applying = false;
// Async preflight is not a write: user/source edits must still invalidate it.
// Suppress our own host changes only after the last checked write boundary.
let publishing = false;
function beginPublication(): void {
  publishing = true;
  figma.commitUndo();
}
let observedPage = figma.currentPage;
let selectionPageId = observedPage.id;
let selectionNodeIds = observedPage.selection.map((node) => node.id);
let editingSelection: readonly SceneNode[] = [];

// Drilling into a selected Frame edits that frame's content. Keep its operation
// and preview until selection leaves it; pixel changes still invalidate through
// nodechange. This is a session anchor, never an A -> B synchronization link.
function currentEditingSelection(): readonly SceneNode[] {
  const selection = figma.currentPage.selection;
  const anchor = editingSelection.length === 1 ? editingSelection[0] : undefined;
  if (anchor?.type === "FRAME" && selectionIsInside(anchor)) return editingSelection;
  editingSelection = [...selection];
  return editingSelection;
}

function selectionIsInside(anchor: FrameNode): boolean {
  const selection = figma.currentPage.selection;
  return !anchor.removed && nodePage(anchor)?.id === figma.currentPage.id &&
    selection.length > 0 && selection.every((selected) => {
      let node: BaseNode | null = selected;
      while (node && node.type !== "PAGE" && node.type !== "DOCUMENT") {
        if (node.id === anchor.id) return true;
        node = node.parent;
      }
      return false;
    });
}
let loadSelectionTimer: ReturnType<typeof setTimeout> | undefined;
// True while a (re)load is scheduled but not started. Applies in this window
// would race a reload whose pixels are about to become stale.
let reloadScheduled = false;
let observeNativeUndo: (() => void) | undefined;
let loadingSelection: {
  observedNodeIds: ReadonlySet<string>; ancestorNodeIds: ReadonlySet<string>;
} | undefined;

function observeLoadingSelection(nodes: readonly SceneNode[]): void {
  loadingSelection = {
    observedNodeIds: new Set([...(loadingSelection?.observedNodeIds ?? []), ...nodes.map((node) => node.id)]),
    ancestorNodeIds: new Set([...(loadingSelection?.ancestorNodeIds ?? []), ...selectionAncestorIds(nodes)]),
  };
}

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
    void undoInHost();
    return;
  }
  if (message.type === "restore-native") {
    void restoreNativeSelection(message);
    return;
  }
  if (message.type === "apply-native") {
    void applyNativeResult(message.payload);
    return;
  }
  if (message.type === "save-template") {
    const mutation: TemplateMutationReceipt = {
      kind: "save",
      workspace: message.workspace,
      requestId: message.requestId,
    };
    queueTemplateMutation(mutation, async () => {
      assertTemplateLibraryWritable();
      if (templateLibrary.templates.length >= MAX_SAVED_SPATIAL_TEMPLATES) {
        throw userError("templateLimitReached", { limit: MAX_SAVED_SPATIAL_TEMPLATES });
      }
      if (templateLibrary.templates.some((template) => template.name === message.name)) {
        throw userError("templateNameExists", { name: message.name });
      }
      const record: SavedSpatialTemplate = {
        id: createTemplateId(templateLibrary.templates),
        name: message.name,
        template: message.template.operation.kind === "canvas"
          ? canvasTemplateFromSet(message.template.operation.spec)
          : spatialTemplateFromMockup(message.template.operation.spec),
      };
      const next = checkedTemplateLibrary([...templateLibrary.templates, record]);
      if (!next) throw userError("templateSaveFailed");
      await figma.clientStorage.setAsync(TEMPLATE_LIBRARY_STORAGE_KEY, next);
      templateLibrary = next;
      postTemplateLibrary(mutation);
    });
    return;
  }
  if (message.type === "delete-template") {
    const mutation: TemplateMutationReceipt = {
      kind: "delete",
      requestId: message.requestId,
    };
    queueTemplateMutation(mutation, async () => {
      assertTemplateLibraryWritable();
      const next = checkedTemplateLibrary(
        templateLibrary.templates.filter((template) => template.id !== message.id),
      );
      if (!next) throw userError("templateSaveFailed");
      await figma.clientStorage.setAsync(TEMPLATE_LIBRARY_STORAGE_KEY, next);
      templateLibrary = next;
      postTemplateLibrary(mutation);
    });
    return;
  }
  if (message.type === "request-source-raster") {
    void refreshSourceRaster(message);
    return;
  }
  if (message.type === "apply") void applyResult(message.payload);
  if (message.type === "apply-canvas") void applyCanvasSet(message.payload);
  if (message.type === "apply-designer") void applyDesignerResult(message.payload);
};

async function initializeUi(nextSystemLocales: string[]): Promise<void> {
  if (uiInitialized) return;
  systemLocales = [...nextSystemLocales];
  const [nextPreference, savedLibraryRead] = await Promise.all([
    storedLocalePreference,
    storedTemplateLibrary,
  ]);
  localePreference = nextPreference;
  if (!savedLibraryRead.ok) {
    templateLibraryReadFailed = true;
  } else if (savedLibraryRead.value === undefined) {
    templateLibrary = emptyTemplateLibrary();
  } else {
    const parsed = parseTemplateLibrary(savedLibraryRead.value);
    if (parsed) templateLibrary = parsed;
    else templateLibraryReadFailed = true;
  }
  activeLocale = resolveLocale(localePreference, systemLocales);
  uiInitialized = true;
  post({ type: "locale", preference: localePreference, locale: activeLocale });
  postTemplateLibrary();
  if (templateLibraryReadFailed) {
    post({ type: "template-library-error", message: userMessage("templateLibraryInvalid") });
  }
  loadSelectionNow();
}

function queueTemplateMutation(
  mutation: TemplateMutationReceipt,
  operation: () => Promise<void>,
): void {
  templateMutation = templateMutation.then(operation, operation).catch((error) => {
    post({
      type: "template-library-error",
      message: toUserMessage(error, "templateSaveFailed"),
      mutation,
    });
  });
}

function assertTemplateLibraryWritable(): void {
  if (templateLibraryReadFailed) throw userError("templateLibraryInvalid");
}

function postTemplateLibrary(mutation?: TemplateMutationReceipt): void {
  post({
    type: "template-library",
    templates: checkedTemplateLibrary(templateLibrary.templates)?.templates ?? [],
    ...(mutation ? { mutation } : {}),
  });
}

function createTemplateId(existing: readonly SavedSpatialTemplate[]): string {
  const used = new Set(existing.map((template) => template.id));
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const id = `template-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(36)}`;
    if (id.length <= 64 && !used.has(id)) return id;
  }
  throw userError("templateSaveFailed");
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
  rememberSelectionIdentity();
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
      nodeIds: currentEditingSelection().map((node) => node.id),
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
  rememberSelectionIdentity();
  if (loadSelectionTimer !== undefined) {
    clearTimeout(loadSelectionTimer);
    loadSelectionTimer = undefined;
  }
  reloadScheduled = false;
  const generation = ++selectionGeneration;
  void loadSelection(generation);
}

const selectionLoads = createLatestAsyncQueue(async (generation: number) => {
  if (generation === selectionGeneration) await loadSelectionSnapshot(generation);
});

function loadSelection(generation: number): void {
  // Figma exports cannot be cancelled. Keep one selection export active and
  // replace pending work with the latest settled selection instead of piling
  // up rasterizations while the designer types, resizes or switches layers.
  selectionLoads.request(generation);
}

async function loadSelectionSnapshot(generation: number): Promise<void> {
  const selection = [...currentEditingSelection()];
  observeLoadingSelection(selection);
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
    const { payload, rendererRequest } = await selectionPayload(selection);
    const sourceIds = payload.sources?.map((source) => source.sourceNodeId) ?? [payload.sourceNodeId];
    const selectedSources = sourceIds.map((id) => selection.find((node) => node.id === id));
    const sources = selectedSources.every((node) => node !== undefined)
      ? selectedSources
      : await Promise.all(sourceIds.map((id) => figma.getNodeByIdAsync(id)));
    if (generation !== selectionGeneration) return;
    if (!sources.every((node): node is SceneNode => node !== null && isSceneNode(node))) {
      throw userError("linkedSourceUnavailable");
    }
    preparedSelection = {
      generation,
      payload,
      selectedNodeIds: new Set(selection.map((node) => node.id)),
      observedNodeIds: new Set([...selection, ...sources].map((node) => node.id)),
      ancestorNodeIds: selectionAncestorIds([...selection, ...sources]),
    };
    post({ type: "source", generation, payload });
    if (payload.nativeRendererPending && rendererRequest) {
      // Optional effect discovery must not occupy the source-export queue.
      // Retain only identities, not each obsolete snapshot's PNG bytes while
      // a shared import is pending across many content/selection refreshes.
      const { sourceNodeId, targetNodeId } = payload;
      void rendererRequest.then((renderer) => {
        const installed = preparedSelection?.payload;
        if (generation !== selectionGeneration || !installed || installed.sourceNodeId !== sourceNodeId ||
          installed.targetNodeId !== targetNodeId) return;
        if (renderer) installed.nativeRenderer = renderer;
        else delete installed.nativeRenderer;
        delete installed.nativeRendererPending;
        post({ type: "source-renderer", generation, sourceNodeId,
          ...(targetNodeId ? { targetNodeId } : {}),
          ...(renderer ? { renderer } : {}),
        });
      });
    }
  } catch (error) {
    if (generation !== selectionGeneration) return;
    // A broken wrapper must not trap selection inside its failed context;
    // selecting Content is also an explicit recovery route.
    editingSelection = [];
    const node = selection.length === 1 ? selection[0] : undefined;
    const message = toUserMessage(error, "previewFailed");
    const recovery = message.key === "nativeResultChanged" && node?.type === "FRAME" && readNativeProjection(node)
      ? { nodeId: node.id, expected: node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) } : undefined;
    post({
      type: "selection-error",
      generation,
      message,
      ...(recovery ? { nativeRecovery: recovery } : {}),
    });
  } finally {
    loadingSelection = undefined;
  }
}

async function undoInHost(): Promise<void> {
  if (applying) return;
  const selected = currentEditingSelection();
  const result = selected.length === 1 && selected[0]?.type === "FRAME" ? selected[0] : undefined;
  const before = result && readNativeProjection(result);
  const revision = result && readStoredBinding(result)?.revision;
  if (!result || !before || revision === undefined) {
    figma.triggerUndo();
    scheduleLoadSelection();
    return;
  }
  applying = true;
  try {
    const publicationUndo = nativePublicationUndoFor(result);
    publishing = true;
    await triggerNativeUndoAndWait(result, before, revision, publicationUndo);
    if (publicationUndo && matchesNativePublicationUndo(result, publicationUndo)) {
      await restoreNativePublicationUndo(result, publicationUndo, () => {
        if (!editingSelectionMatchesNode(result.id)) throw userError("selectionChanged");
      });
      return;
    }
    const after = result && !result.removed && readNativeProjection(result);
    if (result && before && after && revision !== undefined &&
      readStoredBinding(result)?.revision === revision - 1 &&
      before.contentNodeId === after.contentNodeId && before.surfaceNodeId === after.surfaceNodeId) {
      try { await nativeDocumentParts(result); }
      catch {
        const expected = JSON.stringify(after);
        await restoreNativeProjection(result, () => {
          if (JSON.stringify(readNativeProjection(result)) !== expected ||
            !editingSelectionMatchesNode(result.id)) throw userError("selectionChanged");
        });
      }
    }
  } catch (error) {
    post({ type: "apply-error", generation: selectionGeneration, message: toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false; scheduleLoadSelection(); }
}

function triggerNativeUndoAndWait(
  result: FrameNode,
  before: NonNullable<ReturnType<typeof readNativeProjection>>,
  revision: number,
  publicationUndo?: NativePublicationUndo,
): Promise<void> {
  const page = figma.currentPage;
  return new Promise((resolve, reject) => {
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    // Events drive completion; the deadline only bounds an absent/unsupported
    // host notification. Later mismatches retain the explicit recovery route.
    const deadline = setTimeout(() => finish(), 1000);
    const finish = (error?: unknown) => {
      clearTimeout(deadline);
      if (checkTimer !== undefined) clearTimeout(checkTimer);
      observeNativeUndo = undefined;
      if (error !== undefined) reject(error); else resolve();
    };
    const check = () => {
      checkTimer = undefined;
      if (result.removed || figma.currentPage.id !== page.id ||
        !editingSelectionMatchesNode(result.id)) {
        finish(userError("selectionChanged"));
        return;
      }
      const after = readNativeProjection(result);
      if (publicationUndo && matchesNativePublicationUndo(result, publicationUndo)) finish();
      else if (after && readStoredBinding(result)?.revision === revision - 1 &&
        after.contentNodeId === before.contentNodeId && after.surfaceNodeId === before.surfaceNodeId) finish();
    };
    observeNativeUndo = () => {
      // Coalesce host changes before inspecting the matching record/binding.
      if (checkTimer === undefined) checkTimer = setTimeout(check, 0);
    };
    try { figma.triggerUndo(); observeNativeUndo(); }
    catch (error) { finish(error); }
  });
}

async function restoreNativeSelection(request: Extract<UiToMainMessage, { type: "restore-native" }>): Promise<void> {
  if (applying) return;
  // A failed preview releases the session anchor so Content can be selected
  // independently. Its offered repair still belongs to the containing result.
  let selected: BaseNode | null = figma.currentPage.selection[0] ?? null;
  while (selected && selected.id !== request.nodeId && selected.type !== "PAGE" && selected.type !== "DOCUMENT") {
    selected = selected.parent;
  }
  const node = selected?.type === "FRAME" ? selected : undefined;
  applying = true;
  try {
    const check = () => {
      if (request.generation !== selectionGeneration ||
        !node || node.id !== request.nodeId || !selectionIsInside(node) ||
        node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY) !== request.expected) throw userError("selectionChanged");
    };
    check();
    if (node?.type !== "FRAME") throw userError("nativeResultChanged");
    await restoreNativeProjection(node, () => { check(); beginPublication(); });
    figma.commitUndo();
    editingSelection = [node];
  } catch (error) {
    post({ type: "apply-error", generation: request.generation, message: toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false; loadSelectionNow(); }
}

type SelectionPreview = {
  payload: SourcePayload;
  rendererRequest: ReturnType<typeof loadNativeRenderer> | undefined;
};

async function selectionPayload(selection: readonly SceneNode[]): Promise<SelectionPreview> {
  if (selection.length === 0) throw userError("selectOneSource");
  if (selection.length > 9) throw userError("selectOneOrPair");
  const candidates = selection.map((node) => ({ node, stored: readStoredOperation(node) }));
  if (candidates.some((candidate) => candidate.stored.status === "invalid")) {
    throw userError("invalidReusablePlane");
  }
  const targets = candidates.filter((candidate) => candidate.stored.status === "valid");
  if (targets.length > 1) throw userError("selectOneSourceAndResult");
  if (targets.length === 0) {
    if (selection.some((node) => node.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY) ||
      node.getSharedPluginData(SHARED_NAMESPACE, SHARED_NATIVE_KEY))) throw userError("invalidReusablePlane");
    if (selection.length > 8) throw userError("selectOneOrPair");
    return exportSources(selection);
  }
  const target = targets[0]!;
  if (target.stored.status === "valid" && target.stored.operation.kind === "transform" && target.node.type === "FRAME") {
    let content: FrameNode;
    let spec: TransformSpec;
    try {
      ({ content, spec } = await nativeDocumentParts(target.node));
    } catch { throw userError("nativeResultChanged"); }
    if (selection.some((node) => node.id !== target.node.id && node.id !== content.id)) throw userError("selectOneSourceAndResult");
    const preview = await exportSources([content], target.node, { kind: "transform", spec });
    preview.payload.nativeTarget = true;
    return preview;
  }
  if (target.stored.status !== "valid" || target.node.type !== "RECTANGLE") {
    throw userError("resultNotReplaceable");
  }
  let sources = candidates.filter((candidate) => candidate.node.id !== target.node.id).map((candidate) => candidate.node);
  const binding = readStoredBinding(target.node);
  if (sources.length === 0) {
    if (!binding) throw userError("selectOneSourceAndResult");
    const resolved = await Promise.all(binding.sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)));
    if (!resolved.every((node): node is SceneNode =>
      node !== null && isSceneNode(node) && nodePage(node)?.id === figma.currentPage.id)) {
      throw userError("linkedSourceUnavailable");
    }
    sources = resolved;
  } else if (binding && sameIds(sources.map((source) => source.id), binding.sourceNodeIds)) {
    // Selection order is not source-slot order (especially after a marquee).
    sources = binding.sourceNodeIds.map((id) => sources.find((source) => source.id === id)!);
  }
  if (sources.length < 1 || sources.length > 8) throw userError("selectOneSourceAndResult");
  if (target.stored.operation.kind !== "task" && sources.length !== 1) {
    throw userError("selectOneSourceAndResult");
  }
  if (target.stored.operation.kind === "task" && sources.length !== taskSourceCount(target.stored.operation.task)) {
    throw userError("selectOneSourceAndResult");
  }
  return exportSources(sources, target.node, target.stored.operation);
}

async function exportSources(
  sources: readonly SceneNode[],
  target?: RectangleNode | FrameNode,
  storedOperation?: StoredOperation,
): Promise<SelectionPreview> {
  // Observe the source being read too, including a linked source outside the
  // selected result. This also protects the very first export before a
  // prepared snapshot exists.
  observeLoadingSelection(sources);
  const rasterTarget = storedOperation?.kind === "transform" || storedOperation?.kind === "rectify"
    ? target
    : undefined;
  const nativeRecord = target?.type === "FRAME" ? (readNativeProjection(target) ?? readCopiedNativeProjection(target)) : undefined;
  const rasterTargetSize = nativeRecord && target
    ? { width: Math.ceil(target.width), height: Math.ceil(target.height) }
    : rasterTarget ? storedRasterSize(rasterTarget) : undefined;
  let nativeRenderer: SourcePayload["nativeRenderer"];
  let rendererPending = false;
  const rendererRequest = sources.length === 1 && canUseNativeSource(sources[0]!)
    ? loadNativeRenderer(figma.currentPage, nativeRecord?.shaderId, "publish").catch(() => undefined).then((renderer) => {
        rendererPending = false;
        nativeRenderer = renderer;
        return renderer;
      }) : undefined;
  rendererPending = Boolean(rendererRequest);
  const rasters = await Promise.all(sources.map((source, index) => exportSourceRaster(
      source,
      index === 0 ? rasterTarget : undefined,
      index === 0 ? rasterTargetSize : undefined,
    )));
  const first = rasters[0];
  if (!first) throw userError("selectOneSource");
  const targetBox = target?.absoluteBoundingBox;
  const primary = targetBox && targetBox.width > 0 && targetBox.height > 0
    ? { ...first, placement: { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: targetBox.height } }
    : first;
  return { rendererRequest, payload: {
    ...primary,
    ...(nativeRenderer ? { nativeRenderer } : {}),
    ...(rendererPending ? { nativeRendererPending: true } : {}),
    ...(rasters.length > 1 || storedOperation?.kind === "task" ? { sources: rasters } : {}),
    ...(storedOperation?.kind === "transform" && target ? { spec: storedOperation.spec, targetNodeId: target.id } : {}),
    ...(storedOperation?.kind === "rectify" && target ? { rectification: storedOperation.spec, targetNodeId: target.id } : {}),
    ...(storedOperation?.kind === "canvas" && target ? { canvas: storedOperation.spec, targetNodeId: target.id } : {}),
    ...(storedOperation?.kind === "task" && target ? { task: storedOperation.task, targetNodeId: target.id } : {}),
  } };
}

async function exportSourceRaster(
  source: SceneNode,
  target?: RectangleNode | FrameNode,
  targetRasterSize?: { width: number; height: number },
): Promise<SourcePayload> {
  const box = source.absoluteBoundingBox;
  if (!box || box.width <= 0 || box.height <= 0) {
    throw userError("sourceNeedsVisibleBounds");
  }
  const placementBox = target?.absoluteBoundingBox ?? box;
  if (!placementBox || placementBox.width <= 0 || placementBox.height <= 0) {
    throw userError("resultNeedsVisibleBounds");
  }

  const desiredWidth = targetRasterSize?.width ??
    (target ? target.width : Math.max(1, Math.round(box.width)));
  const desiredHeight = targetRasterSize?.height ??
    (target ? target.height : Math.max(1, Math.round(box.height)));
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
      // Native Content may extend beyond its result's output clip. Export
      // its full view box so reopening cannot silently crop the source.
      ...(canUseNativeSource(source) ? { useAbsoluteBounds: true } : {}),
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
  };
}

function taskSourceCount(task: StoredDesignerTask): number {
  if (task.kind === "mockup") return new Set(task.spec.planes.map((plane) => plane.sourceId)).size;
  if (task.kind === "remap" && task.spec.operation.kind === "displacement") return 2;
  return 1;
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
        ...(canUseNativeSource(source) ? { useAbsoluteBounds: true } : {}),
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

async function applyNativeResult(payload: NativeApplyPayload): Promise<void> {
  const generation = payload.generation;
  if (applying) {
    post({ type: "apply-error", generation, message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  try {
    const prepared = requirePreparedSelection(payload);
    const [source, renderer, target] = await Promise.all([
      figma.getNodeByIdAsync(payload.sourceNodeId),
      loadNativeRenderer(figma.currentPage, prepared.nativeRenderer?.id),
      payload.targetNodeId ? figma.getNodeByIdAsync(payload.targetNodeId) : undefined,
    ]);
    if (generation !== selectionGeneration || reloadScheduled || !selectionMatches(payload.sourceNodeId, payload.targetNodeId)) {
      throw userError("selectionChanged");
    }
    if (!source || !isSceneNode(source) || !canUseNativeSource(source) || !renderer) throw userError("nativeUnavailable");
    const existing = prepared.nativeTarget && !payload.duplicate && target?.type === "FRAME" ? target : undefined;
    if (existing && nodePage(existing)?.id !== figma.currentPage.id) throw userError("nativeResultChanged");
    const placement = existing ? { ...payload.placement, ...parentPointFromAbsolute(existing, payload.placement) } : placementBeside(
      inputPlacements(figma.currentPage, prepared), payload.placement, pagePlacements(figma.currentPage, prepared),
    );
    const result = await publishNativeResult({
      source, ...(existing ? { existing } : {}), renderer,
      spec: payload.spec, inverse: payload.inverse, placement,
      renderWidth: payload.renderWidth, renderHeight: payload.renderHeight,
      beforeWrite: () => {
        if (generation !== selectionGeneration || reloadScheduled ||
          !selectionMatches(payload.sourceNodeId, payload.targetNodeId)) throw userError("selectionChanged");
        beginPublication();
      },
    });
    finishAppliedResult(result, [source], existing ? "replace" : "apply", generation);
  } catch (error) {
    post({ type: "apply-error", generation, message: error instanceof NativeRollbackIncompleteError
      ? userMessage("rollbackIncomplete") : toUserMessage(error, "nativeApplyFailed") });
  } finally { applying = false; publishing = false; }
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
      const stored = readStoredOperation(target);
      const targetRaster = storedRasterSize(target) ?? {
        width: checkedOutputAxis(target.width),
        height: checkedOutputAxis(target.height),
      };
      if (
        stored.status !== "valid" ||
        targetRaster.width !== prepared.renderWidth ||
        targetRaster.height !== prepared.renderHeight
      ) {
        throw userError("resultChanged");
      }
      existing = target;
    }

    const storedOperation: StoredOperation = payload.rectification
      ? { kind: "rectify", spec: payload.rectification }
      : { kind: "transform", spec: payload.spec! };
    // Establish an explicit pre-mutation snapshot. A post-mutation commit alone
    // can leave a long-running UI plugin without the boundary needed for the
    // host's next Undo to restore an in-place replacement.
    beginPublication();
    const image = figma.createImage(payload.bytes);
    const operation = existing ? "replace" : "apply";
    const placement = existing
      ? payload.placement
      : placementBeside(
          inputPlacements(figma.currentPage, prepared),
          payload.placement,
          pagePlacements(figma.currentPage, prepared),
        );
    const result = await publishResult({
      ...(existing ? { existing } : {}),
      imageHash: image.hash,
      storedOperation,
      sourceName: source.name,
      sourceNodeIds: [source.id],
      placement,
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    const zoomContext: SceneNode[] = [source];
    if (payload.targetNodeId && payload.duplicate) {
      const pairTarget = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (pairTarget && isSceneNode(pairTarget)) zoomContext.push(pairTarget);
    }
    finishAppliedResult(result, zoomContext, operation, requestGeneration);
  } catch (error) {
    post({
      type: "apply-error",
      generation: requestGeneration,
      message: toUserMessage(error, "unexpectedError"),
    });
  } finally {
    applying = false;
    publishing = false;
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
      const stored = readStoredOperation(target);
      const storedOutput = stored.status === "valid" && stored.operation.kind === "canvas"
        ? ownedCanvasOperationOutput(stored.operation.spec.operation, {
            width: prepared.renderWidth,
            height: prepared.renderHeight,
          })
        : undefined;
      if (
        stored.status !== "valid" ||
        stored.operation.kind !== "canvas" ||
        !storedOutput ||
        checkedOutputAxis(target.width) !== storedOutput.width ||
        checkedOutputAxis(target.height) !== storedOutput.height
      ) {
        throw userError("resultChanged");
      }
      existing = target;
    }

    if (requestGeneration !== selectionGeneration || reloadScheduled) {
      throw userError("selectionChanged");
    }
    // The UI-side chain positions are advisory for new applies: publication
    // is authoritative here, where page-wide obstacles are readable. Each
    // variant chains right of the inputs and the variants before it, so a
    // variant set never covers inputs, page content, or its own siblings.
    let outputs = payload.outputs;
    if (!existing) {
      const inputs = inputPlacements(figma.currentPage, prepared);
      const obstacles = pagePlacements(figma.currentPage, prepared);
      const placed: SourcePayload["placement"][] = [];
      outputs = payload.outputs.map((output) => {
        const placement = placementBeside(
          [...inputs, ...placed],
          output.placement,
          [...obstacles, ...placed],
        );
        placed.push(placement);
        return { ...output, placement };
      });
    }
    const results = await publishCanvasDocumentTransaction({
      payload: { ...payload, outputs },
      sourceName: source.name,
      ...(existing ? { existing } : {}),
      createImage: (bytes) => figma.createImage(bytes),
      commitUndo: beginPublication,
      publish: (request) => publishResult({ ...request, sourceNodeIds: [source.id] }),
    });
    finishAppliedCanvasResults(results, source, existing ? "replace" : "apply", requestGeneration);
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
    publishing = false;
  }
}

async function applyDesignerResult(
  payload: Extract<UiToMainMessage, { type: "apply-designer" }>["payload"],
): Promise<void> {
  const requestGeneration = payload.generation;
  if (applying) {
    post({ type: "apply-designer-error", generation: requestGeneration, message: userMessage("applyAlreadyInProgress") });
    return;
  }
  applying = true;
  try {
    const prepared = requirePreparedDesignerSelection(payload);
    const actualIds = currentEditingSelection().map((node) => node.id);
    const expectedIds = [...preparedSelection!.selectedNodeIds];
    if (requestGeneration !== selectionGeneration || reloadScheduled || !sameIds(actualIds, expectedIds)) {
      throw userError("selectionChanged");
    }
    const sourceNodes = await Promise.all(
      payload.sourceNodeIds.map((id) => figma.getNodeByIdAsync(id)),
    );
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !sameIds(currentEditingSelection().map((node) => node.id), expectedIds) ||
      !sourceNodes.every((node): node is SceneNode => node !== null && isSceneNode(node))
    ) {
      throw userError("selectionChanged");
    }
    const source = sourceNodes[0];
    if (!source) throw userError("selectionChanged");
    let existing: RectangleNode | undefined;
    if (payload.targetNodeId && !payload.duplicate) {
      const target = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (!target || target.type !== "RECTANGLE") throw userError("resultUnavailable");
      const stored = readStoredOperation(target);
      const storedWidth = Number(target.getPluginData(RENDER_WIDTH_KEY));
      const storedHeight = Number(target.getPluginData(RENDER_HEIGHT_KEY));
      if (
        stored.status !== "valid" ||
        stored.operation.kind !== "task" ||
        !Number.isSafeInteger(storedWidth) ||
        !Number.isSafeInteger(storedHeight) ||
        checkedOutputAxis(target.width) !== storedWidth ||
        checkedOutputAxis(target.height) !== storedHeight
      ) throw userError("resultChanged");
      existing = target;
    }
    if (
      requestGeneration !== selectionGeneration ||
      reloadScheduled ||
      !sameIds(currentEditingSelection().map((node) => node.id), expectedIds)
    ) {
      throw userError("selectionChanged");
    }
    if (prepared.task?.kind && prepared.task.kind !== payload.task.kind) throw userError("resultChanged");
    beginPublication();
    const result = await publishResult({
      ...(existing ? { existing } : {}),
      imageHash: figma.createImage(payload.bytes).hash,
      storedOperation: { kind: "task", task: payload.task },
      sourceName: source.name,
      sourceNodeIds: [...payload.sourceNodeIds],
      placement: existing
        ? payload.placement
        : placementBeside(
            inputPlacements(figma.currentPage, prepared),
            payload.placement,
            pagePlacements(figma.currentPage, prepared),
          ),
      renderWidth: payload.renderWidth,
      renderHeight: payload.renderHeight,
    });
    const zoomContext: SceneNode[] = [...sourceNodes];
    if (payload.duplicate && payload.targetNodeId) {
      const pairTarget = await figma.getNodeByIdAsync(payload.targetNodeId);
      if (pairTarget && isSceneNode(pairTarget)) zoomContext.push(pairTarget);
    }
    try { figma.viewport.scrollAndZoomIntoView([result, ...zoomContext]); } catch {}
    try { figma.notify(translate(activeLocale, "designerApplied")); } catch {}
    try { figma.commitUndo(); } catch {}
    post({ type: "apply-designer-complete", generation: requestGeneration, targetNodeId: result.id, operation: existing ? "replace" : "apply" });
  } catch (error) {
    post({ type: "apply-designer-error", generation: requestGeneration, message: toUserMessage(error, "unexpectedError") });
  } finally {
    applying = false;
    publishing = false;
  }
}

function finishAppliedCanvasResults(
  results: RectangleNode[],
  source: SceneNode,
  operation: "apply" | "replace",
  generation: number,
): void {
  try {
    // Keep the producing input in view beside the results: side-by-side
    // comparison is the outcome a human checks after publication.
    figma.viewport.scrollAndZoomIntoView([...results, source]);
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

function selectionPlacements(selection: readonly SceneNode[]): SourcePayload["placement"][] {
  return selection.flatMap((node) => {
    const box = node.absoluteBoundingBox;
    return box && box.width > 0 && box.height > 0
      ? [{ x: box.x, y: box.y, width: box.width, height: box.height }]
      : [];
  });
}

function preparedPlacements(prepared: SourcePayload): SourcePayload["placement"][] {
  const sources = prepared.sources ?? [prepared];
  return [
    ...sources.map((source) => ({ ...source.placement })),
    ...(prepared.targetNodeId ? [{ ...prepared.placement }] : []),
  ];
}

function inputPlacements(
  page: PageNode,
  prepared: SourcePayload,
): SourcePayload["placement"][] {
  const placements = selectionPlacements(page === figma.currentPage ? currentEditingSelection() : page.selection);
  return placements.length > 0 ? placements : preparedPlacements(prepared);
}

function pagePlacements(
  page: PageNode,
  prepared: SourcePayload,
): SourcePayload["placement"][] {
  // Hidden layers still own bounds but are invisible on canvas; they must
  // not push results around. Masks keep their bounds: they shape content.
  const placements = selectionPlacements(page.children.filter((node) => node.visible));
  return placements.length > 0 ? placements : preparedPlacements(prepared);
}

function finishAppliedResult(
  result: RectangleNode | FrameNode,
  zoomContext: readonly SceneNode[],
  operation: "apply" | "replace",
  generation: number,
): void {
  // The pre-mutation commit in applyResult is the one host Undo boundary.
  // Keep the user's source/pair selection stable: selecting the result creates
  // a separate host history step before the visible write can be undone.
  // Publication leaves the producing selection and its pixels intact. Keep
  // its snapshot available for another Apply and for observing later edits;
  // clearing it here strands the ready UI until the user selects elsewhere.
  try { result.setRelaunchData({ edit: "" }); }
  catch { /* Relaunch support does not determine publication success. */ }
  try {
    // Keep the producing inputs in view beside the result: side-by-side
    // comparison is the outcome a human checks after publication.
    figma.viewport.scrollAndZoomIntoView([result, ...zoomContext]);
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
  observeNativeUndo?.();
  // Figma also emits this event for text caret/range changes. Those do not
  // change source pixels and must neither discard a draft nor postpone a
  // pending content refresh. Actual edits still arrive through nodechange.
  if (rememberSelectionIdentity()) scheduleLoadSelection();
}

function rememberSelectionIdentity(): boolean {
  const page = figma.currentPage;
  const ids = currentEditingSelection().map((node) => node.id);
  const changed = page.id !== selectionPageId || ids.length !== selectionNodeIds.length ||
    ids.some((id, index) => id !== selectionNodeIds[index]);
  selectionPageId = page.id;
  selectionNodeIds = ids;
  return changed;
}

function handleCurrentPageChange(): void {
  observeNativeUndo?.();
  observedPage.off("nodechange", handleNodeChange);
  observedPage = figma.currentPage;
  observedPage.on("nodechange", handleNodeChange);
  scheduleLoadSelection();
}

function handleNodeChange(event: NodeChangeEvent): void {
  observeNativeUndo?.();
  if (publishing || (!preparedSelection && !loadingSelection)) return;
  if (event.nodeChanges.some((change) => nodeChangeTouchesPreparedSelection(change))) {
    scheduleLoadSelection();
  }
}

function nodeChangeTouchesPreparedSelection(change: NodeChange): boolean {
  const prepared = preparedSelection;
  if (prepared?.observedNodeIds.has(change.id) || prepared?.ancestorNodeIds.has(change.id) ||
    loadingSelection?.observedNodeIds.has(change.id) || loadingSelection?.ancestorNodeIds.has(change.id)) {
    return true;
  }
  // Removed nodes no longer expose ancestry. Deletion is uncommon, and a
  // conservative refresh is preferable to applying pixels from stale content.
  if (change.type === "DELETE") return true;
  let node: BaseNode | null = "parent" in change.node ? change.node : null;
  while (node) {
    if (prepared?.observedNodeIds.has(node.id) || loadingSelection?.observedNodeIds.has(node.id)) return true;
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
  storedOperation: StoredOperation;
  sourceName: string;
  sourceNodeIds: string[];
  placement: SourcePayload["placement"];
  renderWidth: number;
  renderHeight: number;
}): Promise<RectangleNode> {
  const existingFills = input.existing?.fills;
  if (existingFills === figma.mixed) {
    throw userError("mixedFills");
  }
  const priorFills = existingFills ? [...existingFills] : undefined;
  const priorOperationSlots = input.existing
    ? readStoredOperationSlots(input.existing)
    : undefined;
  const priorWidth = input.existing?.getPluginData(RENDER_WIDTH_KEY);
  const priorHeight = input.existing?.getPluginData(RENDER_HEIGHT_KEY);
  const priorBinding = input.existing?.getSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY);
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
      result.resize(input.placement.width, input.placement.height);
      const center = parentPointFromAbsolute(result, {
        x: input.placement.x + input.placement.width / 2,
        y: input.placement.y + input.placement.height / 2,
      });
      result.x = center.x - input.placement.width / 2;
      result.y = center.y - input.placement.height / 2;
    }
    result.fills = [{ type: "IMAGE", imageHash: input.imageHash, scaleMode: "FILL" }];
    writeStoredOperation(result, input.storedOperation);
    result.setPluginData(RENDER_WIDTH_KEY, String(input.renderWidth));
    result.setPluginData(RENDER_HEIGHT_KEY, String(input.renderHeight));
    writeStoredBinding(result, input);
    if (input.existing && preparedSelection?.payload.targetNodeId === result.id &&
      (input.storedOperation.kind === "transform" || input.storedOperation.kind === "rectify")) {
      // The next replacement must compare against the output we just wrote,
      // not the dimensions from when this result was originally opened.
      preparedSelection.payload = {
        ...preparedSelection.payload,
        renderWidth: input.renderWidth,
        renderHeight: input.renderHeight,
      };
    }
    return result;
  } catch (error) {
    try {
      if (created) {
        result.remove();
      } else if (priorFills && priorFrame && priorOperationSlots) {
        result.resize(priorFrame.width, priorFrame.height);
        result.x = priorFrame.x;
        result.y = priorFrame.y;
        result.fills = priorFills;
        restoreStoredOperationSlots(result, priorOperationSlots);
        result.setPluginData(RENDER_WIDTH_KEY, priorWidth ?? "");
        result.setPluginData(RENDER_HEIGHT_KEY, priorHeight ?? "");
        result.setSharedPluginData(SHARED_NAMESPACE, SHARED_BINDING_KEY, priorBinding ?? "");
      }
    } catch {
      throw userError("rollbackIncomplete");
    }
    throw error;
  }
}

function parentPointFromAbsolute(
  result: RectangleNode | FrameNode,
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
    | NativeApplyPayload
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

function requirePreparedDesignerSelection(
  payload: Extract<UiToMainMessage, { type: "apply-designer" }>["payload"],
): SourcePayload {
  const prepared = preparedSelection;
  const preparedSourceIds = prepared?.payload.sources?.map((source) => source.sourceNodeId) ??
    (prepared ? [prepared.payload.sourceNodeId] : []);
  if (
    !prepared ||
    prepared.generation !== payload.generation ||
    prepared.generation !== selectionGeneration ||
    reloadScheduled ||
    preparedSourceIds.length !== payload.sourceNodeIds.length ||
    !preparedSourceIds.every((id, index) => id === payload.sourceNodeIds[index]) ||
    prepared.payload.targetNodeId !== payload.targetNodeId
  ) throw userError("selectionChanged");
  return prepared.payload;
}

function checkedOutputAxis(value: number): number {
  const rounded = Math.round(value);
  if (!Number.isFinite(value) || rounded < 1) throw userError("outputInvalidDimensions");
  if (rounded > MAX_FIGMA_IMAGE_AXIS) {
    throw userError("outputLimitExceeded", { limit: MAX_FIGMA_IMAGE_AXIS });
  }
  return rounded;
}

function storedRasterSize(
  target: Pick<RectangleNode, "id" | "getPluginData" | "getSharedPluginData">,
): { width: number; height: number } | undefined {
  const width = Number(target.getPluginData(RENDER_WIDTH_KEY));
  const height = Number(target.getPluginData(RENDER_HEIGHT_KEY));
  const binding = readStoredBinding(target);
  return isFigmaImageAxis(width) && isFigmaImageAxis(height)
    ? { width, height }
    : binding ? { width: binding.renderWidth, height: binding.renderHeight } : undefined;
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
  const prepared = preparedSelection;
  if (!prepared || prepared.payload.sourceNodeId !== sourceNodeId ||
    prepared.payload.targetNodeId !== targetNodeId) return false;
  const actual = currentEditingSelection().map((node) => node.id).sort();
  const expected = [...prepared.selectedNodeIds].sort();
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function editingSelectionMatchesNode(nodeId: string): boolean {
  const selection = currentEditingSelection();
  return selection.length === 1 && selection[0]?.id === nodeId;
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
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

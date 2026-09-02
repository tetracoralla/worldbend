import { buildWarpMeshPreview, solveTransformPreview } from "./bridge";
import {
  classifySurfacePointer,
  type EditorInteractionMode,
  type TransformGestureEvent,
  type TransformHandle,
  type TransformGestureKind,
} from "./editor-gestures";
import { awaitImageDecoded } from "./image-decode";
import { closePreviewSource, createPreviewSource } from "./preview-source";
import { observePointerSessionBoundary } from "./pointer-session";
import { correctionGridPolylines } from "./correction-grid";
import {
  applySymmetricPerspective,
  resolvePerspectiveAxis,
  type PerspectiveAxis,
} from "./quad-edits";
import {
  cloneQuad,
  normalizedSpec,
  type Point,
  type TransformSpec,
  type Quad,
  type Size,
  type PreviewSolveOutput,
  type SourceOrientation,
  type WarpMesh,
  type WarpSpec,
  unitQuad,
} from "./types";
import { TransformWebGLRenderer } from "./webgl-renderer";

const corners = ["tl", "tr", "br", "bl"] as const;
export type PerspectiveCorner = (typeof corners)[number];
export type DistortInteractionMode = "free" | "perspective";
export type DistortGestureEvent = {
  phase: "start" | "update" | "end";
  corner: PerspectiveCorner;
  pointerId: number;
  /** Raw viewport coordinates; the camera decides how to keep the handle reachable. */
  client: Point;
  /** Whether this sample is using the explicit/temporary Perspective behavior. */
  perspective: boolean;
  /** Captured physical axis; absent while Free or before the dead zone resolves. */
  axis?: PerspectiveAxis;
};
export type CornerLabelFormatter = (
  corner: PerspectiveCorner,
  point: { x: number; y: number },
) => string;
export type TransformHandleLabelFormatter = (handle: TransformHandle) => string;
export type PreparedExportGeometry = {
  solved: PreviewSolveOutput;
  warpMesh?: WarpMesh;
};

const cornerNames: Record<PerspectiveCorner, string> = {
  tl: "Top-left",
  tr: "Top-right",
  br: "Bottom-right",
  bl: "Bottom-left",
};
const transformHandleNames: Record<TransformHandle, string> = {
  tl: "Top-left corner",
  tr: "Top-right corner",
  br: "Bottom-right corner",
  bl: "Bottom-left corner",
  top: "Top edge",
  right: "Right edge",
  bottom: "Bottom edge",
  left: "Left edge",
};
const edges = ["top", "right", "bottom", "left"] as const;
const DEFAULT_MAX_EXPORT_PIXELS = 4096 * 4096;
const WORKSPACE_GUTTER_DISPLAY_PIXELS = 32;
const WORKSPACE_BUCKET_DISPLAY_PIXELS = 64;

export interface PerspectiveEditorOptions {
  maxPreviewAxis?: number;
  maxExportPixels?: number;
  cornerLabel?: CornerLabelFormatter;
  transformHandleLabel?: TransformHandleLabelFormatter;
  transformSurfaceLabel?: string;
  transformPivotLabel?: string;
  /** Extra surface (typically the editor's mount) that also grabs gestures. */
  interactionSurface?: HTMLElement;
  onChange?: (spec: TransformSpec) => void;
  onDistortGesture?: (event: DistortGestureEvent) => void;
  onTransformGesture?: (event: TransformGestureEvent) => void;
  /** Fired once when an interactive edit (drag or nudge) finishes. */
  onEditEnd?: (source: EditorInteractionMode) => void;
  onError?: (error: unknown) => void;
  onValidityChange?: (valid: boolean) => void;
}

export class PerspectiveEditor {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: TransformWebGLRenderer;
  // Export runs offscreen on demand. One context is created lazily and kept
  // for the editor's lifetime: per-export context creation costs tens of
  // milliseconds and churns the host's WebGL context quota.
  private exportRenderer: TransformWebGLRenderer | undefined;
  private readonly overlay: SVGSVGElement;
  private readonly referenceRect: SVGRectElement;
  private readonly correctionGrid: SVGPolylineElement[] = [];
  private readonly polygon: SVGPolygonElement;
  private readonly handles = new Map<(typeof corners)[number], HTMLButtonElement>();
  private readonly edgeHandles = new Map<(typeof edges)[number], HTMLButtonElement>();
  private readonly pivotHandle: HTMLButtonElement;
  private readonly surface: HTMLElement;
  private source: HTMLImageElement | undefined;
  private previewSource: TexImageSource | undefined;
  private quad: Quad = unitQuad();
  private orientation: SourceOrientation = "native";
  private warp: WarpSpec | undefined;
  private previewSize = { width: 1, height: 1 };
  private targetSize = { width: 1, height: 1 };
  private displayScale = 1;
  // A fit-style host may resize the editor element without applying a parent
  // compositor transform. Keep that concrete presentation size separate from
  // canonical geometry so controls share the resized canvas coordinate space.
  private presentationSize: Size | undefined;
  // Quad coordinates remain normalized to targetSize. The workspace is a
  // presentation-only frame that expands to contain the target plane and any
  // outward corners without changing the captured TransformSpec.
  private workspaceOrigin: Point = { x: 0, y: 0 };
  private workspaceSize: Size = { width: 1, height: 1 };
  private renderGeneration = 0;
  private geometryRevision = 0;
  private overlayRevision = -1;
  private sourceGeneration = 0;
  private animationFrame: number | undefined;
  private renderInFlight = false;
  private queuedRender:
    | { generation: number; resolve: (rendered: boolean) => void }
    | undefined;
  private disabled = false;
  private disposed = false;
  private dragCleanup: (() => void) | undefined;
  private distortCameraUpdate:
    | ((pointerId: number, translation: Point) => boolean)
    | undefined;
  private gestureCleanup: (() => void) | undefined;
  private lastRenderError: string | undefined;
  private cornerLabel: CornerLabelFormatter;
  private transformHandleLabel: TransformHandleLabelFormatter;
  private transformSurfaceLabel: string;
  private transformPivotLabel: string;
  private transformPivot: { x: number; y: number } = { x: 0.5, y: 0.5 };
  private interactionMode: EditorInteractionMode = "distort";
  private distortMode: DistortInteractionMode = "free";
  // A rectification carrier uses the same four handles to select a source
  // plane. The source pixels stay visually unwarped while the selected quad
  // is validated; only the eventual RectifyPlan changes sampling.
  private sourceSelectionMode = false;
  private overlayVisible = true;
  private correctionGridAvailable = false;
  private correctionGridVisible = false;
  private warpMeshCache:
    | { key: string; promise: Promise<WarpMesh> }
    | undefined;
  private nudgeCommitTimer: ReturnType<typeof setTimeout> | undefined;
  private nudgeActive = false;

  constructor(private readonly options: PerspectiveEditorOptions = {}) {
    this.cornerLabel = options.cornerLabel ?? defaultCornerLabel;
    this.transformHandleLabel = options.transformHandleLabel ?? defaultTransformHandleLabel;
    this.transformSurfaceLabel = options.transformSurfaceLabel ?? defaultTransformSurfaceLabel;
    this.transformPivotLabel = options.transformPivotLabel ?? defaultTransformPivotLabel;
    this.element = document.createElement("div");
    this.element.className = "worldbend-editor";
    this.element.tabIndex = -1;
    this.element.setAttribute("aria-label", this.transformSurfaceLabel);
    this.element.addEventListener("keydown", this.onElementKeydown);
    this.element.addEventListener("keyup", this.onElementKeyup);
    this.renderer = new TransformWebGLRenderer(undefined, {
      onContextLost: () => {
        if (this.disposed) return;
        this.renderGeneration += 1;
        this.cancelScheduledRender();
        // Recording the message here keeps the pending frame's identical
        // assertAvailable failure from reporting the loss a second time.
        this.lastRenderError = "The perspective preview lost its graphics context. Try again.";
        this.setValidity(false);
        this.options.onError?.(new Error(this.lastRenderError));
      },
      onContextRestored: () => {
        if (!this.disposed && this.source) this.scheduleFrame();
      },
    });
    this.canvas = this.renderer.canvas;
    this.canvas.className = "worldbend-editor__canvas";
    this.overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.overlay.classList.add("worldbend-editor__overlay");
    this.overlay.setAttribute("aria-hidden", "true");
    this.referenceRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    this.referenceRect.classList.add("worldbend-editor__reference");
    for (let index = 0; index < 4; index += 1) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      line.classList.add("worldbend-editor__grid-line");
      this.correctionGrid.push(line);
    }
    this.polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    this.polygon.classList.add("worldbend-editor__polygon");
    this.overlay.append(this.referenceRect, ...this.correctionGrid, this.polygon);
    this.element.append(this.canvas, this.overlay);

    for (const corner of corners) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "worldbend-editor__handle";
      handle.dataset.corner = corner;
      handle.dataset.handle = corner;
      handle.addEventListener("pointerdown", (event) => this.beginHandlePointer(event, corner));
      handle.addEventListener("keydown", (event) => this.handleKeydown(event, corner));
      this.handles.set(corner, handle);
      this.element.append(handle);
    }
    for (const edge of edges) {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "worldbend-editor__handle worldbend-editor__handle--edge";
      handle.dataset.edge = edge;
      handle.dataset.handle = edge;
      handle.addEventListener("pointerdown", (event) => this.beginHandlePointer(event, edge));
      handle.addEventListener("keydown", (event) => this.handleKeydown(event, edge));
      this.edgeHandles.set(edge, handle);
      this.element.append(handle);
    }
    this.pivotHandle = document.createElement("button");
    this.pivotHandle.type = "button";
    this.pivotHandle.className = "worldbend-editor__pivot";
    this.pivotHandle.dataset.transformPivot = "true";
    this.pivotHandle.setAttribute("aria-label", this.transformPivotLabel);
    this.pivotHandle.addEventListener("pointerdown", (event) =>
      this.beginTransformGesture(event, "pivot"),
    );
    this.pivotHandle.addEventListener("keydown", this.handlePivotKeydown);
    this.element.append(this.pivotHandle);
    this.surface = options.interactionSurface ?? this.element;
    this.surface.addEventListener("pointerdown", this.onSurfacePointerDown);
    this.surface.addEventListener("pointermove", this.onSurfacePointerMove);
    this.updateOverlay();
    this.applyInteractionMode();
  }

  setCornerLabelFormatter(formatter?: CornerLabelFormatter): void {
    this.assertAvailable();
    this.cornerLabel = formatter ?? defaultCornerLabel;
    this.updateOverlay();
  }

  setTransformHandleLabelFormatter(formatter?: TransformHandleLabelFormatter): void {
    this.assertAvailable();
    this.transformHandleLabel = formatter ?? defaultTransformHandleLabel;
    this.updateOverlay();
  }

  setTransformSurfaceLabel(label?: string): void {
    this.assertAvailable();
    this.transformSurfaceLabel = label ?? defaultTransformSurfaceLabel;
    this.element.setAttribute("aria-label", this.transformSurfaceLabel);
  }

  setTransformPivotLabel(label?: string): void {
    this.assertAvailable();
    this.transformPivotLabel = label ?? defaultTransformPivotLabel;
    this.pivotHandle.setAttribute("aria-label", this.transformPivotLabel);
  }

  /** Reference point position in normalized output-preview coordinates. */
  setTransformPivot(point: { x: number; y: number }): void {
    this.assertAvailable();
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    this.transformPivot = { ...point };
    this.updateTransformPivot();
  }

  /** Switch between direct corner dragging and Free Transform gestures. */
  setInteractionMode(mode: EditorInteractionMode): void {
    this.assertAvailable();
    if (this.interactionMode === mode) return;
    this.interactionMode = mode;
    this.applyInteractionMode();
    // Corner buttons are shared by both modes, but their operation changes
    // from moving one corner to scaling the plane. Refresh the accessible
    // name immediately instead of waiting for the next geometry update.
    this.updateOverlay();
  }

  /** Choose independent-corner or adjacent-partner perspective edits in Distort. */
  setDistortMode(mode: DistortInteractionMode): void {
    this.assertAvailable();
    if (this.distortMode === mode) return;
    this.distortMode = mode;
    this.element.dataset.distortMode = mode;
    this.updateOverlay();
  }

  /** Show the untouched source while the four handles select a source plane. */
  setSourceSelectionMode(enabled: boolean): void {
    this.assertAvailable();
    if (this.sourceSelectionMode === enabled) return;
    this.cancelDrag();
    this.cancelGesture();
    this.sourceSelectionMode = enabled;
    this.element.dataset.sourceSelection = String(enabled);
    this.correctionGridAvailable = false;
    this.setCorrectionGridVisibility(false);
    if (this.source) this.scheduleFrame();
  }

  async setSource(
    source: HTMLImageElement,
    spec?: TransformSpec,
    options?: { preserveQuad?: boolean; targetSize?: Size },
  ): Promise<boolean> {
    this.assertAvailable();
    if (spec && spec.destination.space !== "normalized") {
      throw new Error("The interactive editor requires a normalized perspective spec");
    }
    if (
      options?.targetSize &&
      (!Number.isFinite(options.targetSize.width) ||
        !Number.isFinite(options.targetSize.height) ||
        options.targetSize.width <= 0 ||
        options.targetSize.height <= 0)
    ) {
      throw new Error("The preview target has invalid dimensions");
    }
    this.cancelDrag();
    this.cancelGesture();
    const sourceGeneration = ++this.sourceGeneration;
    // The public entry point cannot assume hosts pre-decoded the image.
    // awaitImageDecoded keeps a wedged decode() promise from hanging the
    // editor in embedded webview builds that never settle it for blob URLs.
    if (!source.complete) {
      try {
        await awaitImageDecoded(source);
      } catch {
        throw new Error("The source image could not be decoded");
      }
    }
    if (source.naturalWidth <= 0 || source.naturalHeight <= 0) {
      throw new Error("The source image has no readable pixels");
    }
    const sourcePreviewSize = this.fitPreviewSize({
      width: source.naturalWidth,
      height: source.naturalHeight,
    });
    const targetSize = options?.targetSize ?? {
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
    const targetPreviewSize = this.fitPreviewSize(targetSize);
    const previewSource = await createPreviewSource(
      source,
      sourcePreviewSize.width,
      sourcePreviewSize.height,
    );
    if (sourceGeneration !== this.sourceGeneration || this.disposed) {
      // A newer setSource won the race; the freshly prepared bitmap is not
      // owned by anyone yet, so release it instead of waiting for GC.
      closePreviewSource(previewSource);
      return false;
    }

    const previousPreview = this.previewSource;
    const hadSource = this.source !== undefined;
    this.source = source;
    this.previewSource = previewSource;
    this.quad = options?.preserveQuad && hadSource
      ? this.quad
      : spec
        ? cloneQuad(spec.destination.quad)
        : unitQuad();
    this.orientation =
      options?.preserveQuad && hadSource ? this.orientation : contentOrientation(spec);
    this.warp = options?.preserveQuad && hadSource ? this.warp : contentWarp(spec);
    this.targetSize = { ...targetSize };
    this.displayScale = targetPreviewSize.width / targetSize.width;
    this.recomputeWorkspace();
    this.renderer.invalidateSource();
    closePreviewSource(previousPreview);
    this.updateOverlay();
    return this.renderImmediately();
  }

  async setSpec(spec: TransformSpec, targetSize: Size): Promise<boolean> {
    this.assertAvailable();
    if (!this.source || !this.previewSource) throw new Error("No source is loaded");
    if (spec.destination.space !== "normalized") {
      throw new Error("The interactive editor requires a normalized perspective spec");
    }
    if (
      !Number.isFinite(targetSize.width) ||
      !Number.isFinite(targetSize.height) ||
      targetSize.width <= 0 ||
      targetSize.height <= 0
    ) {
      throw new Error("The preview target has invalid dimensions");
    }
    // A spec swap changes the coordinate frame, so a distort drag cannot keep
    // running against it. Transform gestures own their feedback loop and feed
    // setSpec themselves, so they must survive their own updates.
    this.cancelDrag();
    this.quad = cloneQuad(spec.destination.quad);
    this.orientation = contentOrientation(spec);
    this.warp = contentWarp(spec);
    this.targetSize = { ...targetSize };
    this.recomputeWorkspace();
    this.updateOverlay();
    return this.renderImmediately();
  }

  setHandlesVisible(visible: boolean): void {
    this.assertAvailable();
    this.overlayVisible = visible;
    this.applyInteractionMode();
  }

  /**
   * Supersede asynchronous solve/mesh work that no longer owns the preview.
   * Callers can then restore a known spec without allowing the late render to
   * publish over it.
   */
  invalidatePendingRender(): void {
    this.assertAvailable();
    this.renderGeneration += 1;
    this.cancelScheduledRender();
    this.cancelQueuedRender();
  }

  clearSource(): void {
    if (this.disposed) return;
    this.cancelDrag();
    this.cancelGesture();
    this.sourceGeneration += 1;
    this.renderGeneration += 1;
    this.cancelScheduledRender();
    this.cancelQueuedRender();
    this.source = undefined;
    this.discardPreviewSource();
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.setValidity(false);
  }

  setDisabled(disabled: boolean): void {
    if (this.disposed || this.disabled === disabled) return;
    if (disabled) {
      this.cancelDrag();
      this.cancelGesture();
    }
    this.disabled = disabled;
    this.element.dataset.disabled = String(disabled);
    for (const handle of this.allHandles()) handle.disabled = disabled;
  }

  captureSpec(): TransformSpec {
    this.assertAvailable();
    return normalizedSpec(cloneQuad(this.quad), this.orientation, this.warp);
  }

  /** Current preview canvas size in preview pixels (capped by maxPreviewAxis). */
  getPreviewSize(): Size {
    return { width: this.previewSize.width, height: this.previewSize.height };
  }

  /**
   * Stable logical display size for transform feedback. Unlike the capped
   * renderer canvas, this grows and shrinks in proportion to the output so a
   * 200% transform looks twice as large instead of being auto-fitted back to
   * the same preview box.
   */
  getDisplaySize(): Size {
    return {
      width: Math.max(1, this.targetSize.width * this.workspaceSize.width * this.displayScale),
      height: Math.max(1, this.targetSize.height * this.workspaceSize.height * this.displayScale),
    };
  }

  /**
   * Match transform-only control coordinates to a host-owned CSS fit.
   * Compositor viewports should leave this unset because they scale the
   * canvas, overlay, and controls together and counter-scale only hit targets.
   */
  setPresentationSize(size?: Size): void {
    if (this.disposed) return;
    if (
      size &&
      (!Number.isFinite(size.width) ||
        !Number.isFinite(size.height) ||
        size.width <= 0 ||
        size.height <= 0)
    ) {
      throw new Error("The editor presentation has invalid dimensions");
    }
    const next = size ? { ...size } : undefined;
    if (
      this.presentationSize?.width === next?.width &&
      this.presentationSize?.height === next?.height
    ) {
      return;
    }
    this.presentationSize = next;
    this.updateOverlay(false);
  }

  /** Display size of the target coordinate frame, excluding workspace gutters. */
  getTargetDisplaySize(): Size {
    return {
      width: Math.max(1, this.targetSize.width * this.displayScale),
      height: Math.max(1, this.targetSize.height * this.displayScale),
    };
  }

  /**
   * Translation that keeps the original target frame registered while an
   * outward Distort edit grows the surrounding workspace. The viewport owns
   * the camera; the editor only reports this presentation-space correction.
   */
  getWorkspaceDisplayOffset(): Point {
    const target = this.getTargetDisplaySize();
    return {
      x: this.workspaceOrigin.x * target.width,
      y: this.workspaceOrigin.y * target.height,
    };
  }

  /** Quad bounds inside the dynamically sized workspace, in display pixels. */
  getQuadDisplayBounds(): { x: number; y: number; width: number; height: number } {
    const target = this.getTargetDisplaySize();
    const xValues = corners.map(
      (corner) => (this.quad[corner].x - this.workspaceOrigin.x) * target.width,
    );
    const yValues = corners.map(
      (corner) => (this.quad[corner].y - this.workspaceOrigin.y) * target.height,
    );
    const minimumX = Math.min(...xValues);
    const maximumX = Math.max(...xValues);
    const minimumY = Math.min(...yValues);
    const maximumY = Math.max(...yValues);
    return {
      x: minimumX,
      y: minimumY,
      width: maximumX - minimumX,
      height: maximumY - minimumY,
    };
  }

  /** One corner inside the dynamically sized workspace, in display pixels. */
  getCornerDisplayPoint(corner: PerspectiveCorner): Point {
    const target = this.getTargetDisplaySize();
    return {
      x: (this.quad[corner].x - this.workspaceOrigin.x) * target.width,
      y: (this.quad[corner].y - this.workspaceOrigin.y) * target.height,
    };
  }

  /**
   * Re-sample the active Distort drag after presentation-only camera motion.
   * `translation` is the viewport's total screen-pixel camera translation
   * since pointer-down. The preview viewport uses this during bounded edge
   * assistance. Free Distort may sustain traditional edge following;
   * Perspective consumes only fresh pointer-driven steps so its mirrored pair
   * cannot keep expanding after the designer stops moving.
   */
  updateActiveDistortCamera(pointerId: number, translation: Point): boolean {
    if (this.disposed) return false;
    if (!Number.isFinite(translation.x) || !Number.isFinite(translation.y)) return false;
    return this.distortCameraUpdate?.(pointerId, translation) ?? false;
  }

  /** Decoded source pixels available to a final export (not the capped preview). */
  getSourceRasterSize(): Size | undefined {
    return this.source
      ? { width: this.source.naturalWidth, height: this.source.naturalHeight }
      : undefined;
  }

  async reset(): Promise<void> {
    this.assertAvailable();
    this.quad = unitQuad();
    this.orientation = "native";
    this.warp = undefined;
    this.recomputeWorkspace();
    this.updateOverlay();
    await this.renderImmediately();
    this.options.onChange?.(this.captureSpec());
  }

  async exportPng(
    width: number,
    height: number,
    spec: TransformSpec = this.captureSpec(),
    sourceOverride?: TexImageSource,
    preparedGeometry?: PreparedExportGeometry,
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.assertAvailable();
    if (!this.source) throw new Error("No source is loaded");
    const outputWidth = Math.round(width);
    const outputHeight = Math.round(height);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      outputWidth <= 0 ||
      outputHeight <= 0
    ) {
      throw new Error("The output image has invalid dimensions");
    }
    const maximumPixels = this.options.maxExportPixels ?? DEFAULT_MAX_EXPORT_PIXELS;
    if (outputWidth * outputHeight > maximumPixels) {
      throw new Error(
        `The output exceeds this editor's ${maximumPixels.toLocaleString()} pixel limit`,
      );
    }

    const snapshot = structuredClone(spec);
    const solved =
      preparedGeometry?.solved ??
      (await solveTransformPreview(snapshot, {
        width: outputWidth,
        height: outputHeight,
      }));
    const warpMesh = preparedGeometry
      ? preparedGeometry.warpMesh
      : await this.resolveWarpMesh(snapshot);
    const renderer = this.acquireExportRenderer();
    renderer.render(sourceOverride ?? this.source, solved, warpMesh, "high");
    const blob = await new Promise<Blob>((resolve, reject) => {
      renderer.canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error("Unable to encode the perspective result"));
      }, "image/png");
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  private acquireExportRenderer(): TransformWebGLRenderer {
    this.assertAvailable();
    if (this.exportRenderer) return this.exportRenderer;
    this.exportRenderer = new TransformWebGLRenderer(undefined, {
      preserveDrawingBuffer: true,
      onContextLost: () => {
        // Drop the dead context so the next export transparently rebuilds it.
        this.exportRenderer?.dispose();
        this.exportRenderer = undefined;
      },
    });
    return this.exportRenderer;
  }

  private fitPreviewSize(size: Size): Size {
    const maximum = this.options.maxPreviewAxis ?? 1024;
    const scale = Math.min(1, maximum / Math.max(size.width, size.height));
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelDrag();
    this.cancelGesture();
    this.disposed = true;
    this.sourceGeneration += 1;
    this.renderGeneration += 1;
    this.cancelScheduledRender();
    this.cancelQueuedRender();
    this.surface.removeEventListener("pointerdown", this.onSurfacePointerDown);
    this.surface.removeEventListener("pointermove", this.onSurfacePointerMove);
    this.element.removeEventListener("keydown", this.onElementKeydown);
    this.element.removeEventListener("keyup", this.onElementKeyup);
    this.finishKeyboardNudge();
    this.renderer.dispose();
    this.exportRenderer?.dispose();
    this.exportRenderer = undefined;
    this.source = undefined;
    this.discardPreviewSource();
    this.handles.clear();
    this.edgeHandles.clear();
    this.element.replaceChildren();
  }

  private discardPreviewSource(): void {
    const previous = this.previewSource;
    this.previewSource = undefined;
    this.renderer.invalidateSource();
    closePreviewSource(previous);
  }

  private allHandles(): HTMLButtonElement[] {
    return [...this.handles.values(), ...this.edgeHandles.values(), this.pivotHandle];
  }

  private applyInteractionMode(): void {
    const distortActive = this.interactionMode === "distort" && this.overlayVisible;
    const transformActive = this.interactionMode === "transform" && this.overlayVisible;
    this.element.dataset.mode = this.interactionMode;
    this.element.dataset.distortMode = this.distortMode;
    this.referenceRect.style.display = this.overlayVisible ? "" : "none";
    this.polygon.style.display = this.overlayVisible ? "" : "none";
    this.setCorrectionGridVisibility(distortActive && this.correctionGridAvailable);
    for (const handle of this.handles.values()) handle.hidden = !(distortActive || transformActive);
    for (const handle of this.edgeHandles.values()) handle.hidden = !transformActive;
    this.pivotHandle.hidden = !transformActive;
    this.element.tabIndex = transformActive ? 0 : -1;
  }

  private onElementKeydown = (event: KeyboardEvent): void => {
    if (event.target !== this.element || this.interactionMode !== "transform") return;
    const direction = arrowDirection(event.key);
    if (!direction || this.disabled || this.disposed) return;
    event.preventDefault();
    this.moveByKeyboard(event, direction);
  };

  private onElementKeyup = (event: KeyboardEvent): void => {
    if (arrowDirection(event.key)) this.finishKeyboardNudge();
  };

  private onSurfacePointerDown = (event: PointerEvent): void => {
    if (this.interactionMode !== "transform") return;
    if (isFormControlTarget(event.target)) return;
    this.beginTransformGesture(
      event,
      classifySurfacePointer({
        quad: this.quad,
        pointer: this.pointerPosition(event),
        previewSize: this.displaySize(),
      }),
    );
  };

  private onSurfacePointerMove = (event: PointerEvent): void => {
    if (this.interactionMode !== "transform" || this.disabled || this.disposed) return;
    if (this.gestureCleanup !== undefined) return;
    if (isFormControlTarget(event.target)) {
      this.setZoneHint("none");
      return;
    }
    this.setZoneHint(
      classifySurfacePointer({
        quad: this.quad,
        pointer: this.pointerPosition(event),
        previewSize: this.displaySize(),
      }),
    );
  };

  private setZoneHint(zone: "none" | "move" | "rotate"): void {
    const next = zone === "none" ? "" : zone;
    if (this.surface.dataset.zone === next) return;
    if (next === "") delete this.surface.dataset.zone;
    else this.surface.dataset.zone = next;
  }

  private pointerPosition(
    event: PointerEvent,
    rect: Pick<DOMRect, "left" | "top" | "width" | "height"> =
      this.overlay.getBoundingClientRect(),
    workspace: { origin: Point; size: Size } = {
      origin: this.workspaceOrigin,
      size: this.workspaceSize,
    },
  ): { x: number; y: number } {
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
    return {
      x:
        workspace.origin.x +
        ((event.clientX - rect.left) / rect.width) * workspace.size.width,
      y:
        workspace.origin.y +
        ((event.clientY - rect.top) / rect.height) * workspace.size.height,
    };
  }

  /** Current rendered editor size, including viewport zoom. */
  private displaySize(): Size {
    const rect = this.overlay.getBoundingClientRect();
    return {
      width: rect.width / this.workspaceSize.width,
      height: rect.height / this.workspaceSize.height,
    };
  }

  private beginHandlePointer(
    event: PointerEvent,
    handle: (typeof corners)[number] | (typeof edges)[number],
  ): void {
    if (this.interactionMode === "transform") {
      this.beginTransformGesture(event, "scale", handle);
      return;
    }
    if (isCorner(handle)) this.beginDrag(event, handle);
  }

  private beginTransformGesture(
    event: PointerEvent,
    kind: TransformGestureKind | "none",
    handle?: TransformHandle,
  ): void {
    if (kind === "none") return;
    // One gesture at a time: a second concurrent pointer would overwrite
    // gestureCleanup and leave the first gesture's handlers running.
    if (this.disabled || this.disposed || event.button !== 0 || this.gestureCleanup) return;
    event.preventDefault();
    const focus = (event.currentTarget as { focus?: () => void } | null)?.focus;
    if (typeof focus === "function") focus.call(event.currentTarget);
    try {
      this.surface.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    const activeHandle = handle
      ? isCorner(handle)
        ? this.handles.get(handle)
        : this.edgeHandles.get(handle)
      : kind === "pivot"
        ? this.pivotHandle
        : undefined;
    if (activeHandle) activeHandle.dataset.active = "true";
    this.element.dataset.dragging = "true";
    const startQuad = cloneQuad(this.quad);
    // Transform feedback can resize and reposition the preview on every
    // update. Keep all pointer samples in the gesture-start coordinate frame
    // so the plane does not accelerate or jump underneath a steady pointer.
    const gestureRect = this.overlay.getBoundingClientRect();
    const gestureWorkspace = {
      origin: { ...this.workspaceOrigin },
      size: { ...this.workspaceSize },
    };
    const position = (pointerEvent: PointerEvent): { x: number; y: number } =>
      this.pointerPosition(pointerEvent, gestureRect, gestureWorkspace);
    const startPointer = position(event);
    let latestPointer = startPointer;
    let latestShiftKey = event.shiftKey;
    this.setZoneHint("none");
    this.options.onTransformGesture?.({
      phase: "start",
      kind,
      ...(handle ? { handle } : {}),
      pointer: startPointer,
      quad: startQuad,
    });
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (this.disabled || this.disposed) return;
      // Figma can lose pointer-up beyond the plugin iframe and later deliver
      // a re-entry move. Do not apply that unrelated coordinate: buttons=0
      // closes at the last sample the user actually saw while pressed.
      if (moveEvent.buttons === 0) {
        finish(latestPointer, latestShiftKey);
        return;
      }
      latestPointer = position(moveEvent);
      latestShiftKey = moveEvent.shiftKey;
      this.options.onTransformGesture?.({
        phase: "update",
        pointer: latestPointer,
        shiftKey: latestShiftKey,
      });
    };
    let detachBoundary = (): void => {};
    let finished = false;
    const detach = (): void => {
      this.surface.removeEventListener("pointermove", move);
      this.surface.removeEventListener("pointerup", end);
      this.surface.removeEventListener("pointercancel", cancelled);
      this.surface.removeEventListener("lostpointercapture", interrupted);
      detachBoundary();
    };
    const finish = (pointer: { x: number; y: number }, shiftKey: boolean): void => {
      if (finished) return;
      finished = true;
      this.options.onTransformGesture?.({
        phase: "end",
        pointer,
        shiftKey,
      });
      this.options.onEditEnd?.("transform");
      detach();
      if (this.surface.hasPointerCapture(event.pointerId)) {
        this.surface.releasePointerCapture(event.pointerId);
      }
      if (activeHandle) delete activeHandle.dataset.active;
      delete this.element.dataset.dragging;
      if (this.gestureCleanup === cleanup) this.gestureCleanup = undefined;
    };
    const end = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId !== event.pointerId) return;
      // The exact final coordinate is the release event's; the modifier state
      // stays the last sampled one so the committed recipe matches the last
      // visible preview even when Shift flips between the final move and
      // release.
      finish(position(endEvent), latestShiftKey);
    };
    const cancelled = (cancelEvent?: PointerEvent): void => {
      if (cancelEvent && cancelEvent.pointerId !== event.pointerId) return;
      finish(latestPointer, latestShiftKey);
    };
    // Capture loss keeps the last visible edit and closes it as one recoverable
    // history step; silently abandoning it would leave host state without an
    // undo boundary.
    const interrupted = (captureEvent?: PointerEvent): void => {
      if (captureEvent && captureEvent.pointerId !== event.pointerId) return;
      cancelled();
    };
    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      detach();
      if (this.surface.hasPointerCapture(event.pointerId)) {
        this.surface.releasePointerCapture(event.pointerId);
      }
      if (activeHandle) delete activeHandle.dataset.active;
      delete this.element.dataset.dragging;
      if (this.gestureCleanup === cleanup) this.gestureCleanup = undefined;
    };
    this.gestureCleanup = cleanup;
    this.surface.addEventListener("pointermove", move);
    this.surface.addEventListener("pointerup", end);
    this.surface.addEventListener("pointercancel", cancelled);
    this.surface.addEventListener("lostpointercapture", interrupted);
    detachBoundary = observePointerSessionBoundary({
      pointerId: event.pointerId,
      onRelease: (releaseEvent) => {
        finish(position(releaseEvent as PointerEvent), latestShiftKey);
      },
      onInterrupt: interrupted,
    });
  }

  private handlePivotKeydown = (event: KeyboardEvent): void => {
    if (this.disabled || this.disposed || this.interactionMode !== "transform") return;
    const direction = arrowDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    const pixels = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
    const next = {
      x: this.transformPivot.x + (direction.x * pixels) / this.targetSize.width,
      y: this.transformPivot.y + (direction.y * pixels) / this.targetSize.height,
    };
    this.options.onTransformGesture?.({
      phase: "start",
      kind: "pivot",
      pointer: { ...this.transformPivot },
      quad: cloneQuad(this.quad),
    });
    this.options.onTransformGesture?.({ phase: "update", pointer: next, shiftKey: event.shiftKey });
    this.options.onTransformGesture?.({ phase: "end", pointer: next, shiftKey: event.shiftKey });
    this.options.onEditEnd?.("transform");
  };

  private handleKeydown(event: KeyboardEvent, handle: TransformHandle): void {
    if (this.disabled || this.disposed) return;
    const direction = arrowDirection(event.key);
    if (!direction) return;
    event.preventDefault();
    if (this.interactionMode === "transform") {
      this.resizeByKeyboard(event, handle, direction);
      return;
    }
    if (isCorner(handle)) this.nudgeCorner(event, handle, direction);
  }

  private resizeByKeyboard(
    event: KeyboardEvent,
    handle: TransformHandle,
    direction: { x: number; y: number },
  ): void {
    const pixels = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
    const delta = {
      x: (direction.x * pixels) / this.targetSize.width,
      y: (direction.y * pixels) / this.targetSize.height,
    };
    const anchor = this.transformHandlePoint(handle);
    this.options.onTransformGesture?.({
      phase: "start",
      kind: "scale",
      handle,
      pointer: anchor,
      quad: cloneQuad(this.quad),
    });
    this.options.onTransformGesture?.({
      phase: "update",
      pointer: { x: anchor.x + delta.x, y: anchor.y + delta.y },
      shiftKey: event.shiftKey,
    });
    this.options.onTransformGesture?.({
      phase: "end",
      pointer: { x: anchor.x + delta.x, y: anchor.y + delta.y },
      shiftKey: event.shiftKey,
    });
    this.options.onEditEnd?.("transform");
  }

  private moveByKeyboard(
    event: KeyboardEvent,
    direction: { x: number; y: number },
  ): void {
    const pixels = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
    const delta = {
      x: (direction.x * pixels) / this.targetSize.width,
      y: (direction.y * pixels) / this.targetSize.height,
    };
    const anchor = { ...this.quad.tl };
    this.options.onTransformGesture?.({
      phase: "start",
      kind: "move",
      pointer: anchor,
      quad: cloneQuad(this.quad),
    });
    this.options.onTransformGesture?.({
      phase: "update",
      pointer: { x: anchor.x + delta.x, y: anchor.y + delta.y },
      shiftKey: event.shiftKey,
    });
    this.options.onTransformGesture?.({
      phase: "end",
      pointer: { x: anchor.x + delta.x, y: anchor.y + delta.y },
      shiftKey: event.shiftKey,
    });
    this.options.onEditEnd?.("transform");
  }

  private transformHandlePoint(handle: TransformHandle): { x: number; y: number } {
    if (isCorner(handle)) return { ...this.quad[handle] };
    const midpoint = (a: PerspectiveCorner, b: PerspectiveCorner): { x: number; y: number } => ({
      x: (this.quad[a].x + this.quad[b].x) / 2,
      y: (this.quad[a].y + this.quad[b].y) / 2,
    });
    return {
      top: midpoint("tl", "tr"),
      right: midpoint("tr", "br"),
      bottom: midpoint("br", "bl"),
      left: midpoint("bl", "tl"),
    }[handle];
  }

  private beginDrag(event: PointerEvent, corner: (typeof corners)[number]): void {
    // One drag at a time: a second concurrent pointer would overwrite
    // dragCleanup and leave the first drag's move handler writing the quad
    // with a stale rect after cancelDrag.
    if (this.disabled || this.disposed || event.button !== 0 || this.dragCleanup) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLButtonElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      return;
    }
    // pointerdown's preventDefault keeps some browsers from focusing the
    // handle; restore it so mouse users can nudge with arrow keys after a drag.
    handle.focus();
    // Symmetric perspective maps from the drag's starting quad so the linked
    // pair cannot drift while the modifier toggles.
    const startQuad = cloneQuad(this.quad);
    // The workspace can expand while a corner moves outward. Freeze the
    // gesture-start mapping so that expansion never accelerates or jumps the
    // point underneath a steady pointer.
    const dragRect = this.overlay.getBoundingClientRect();
    const dragWorkspace = {
      origin: { ...this.workspaceOrigin },
      size: { ...this.workspaceSize },
    };
    let latestClient = { x: event.clientX, y: event.clientY };
    let latestShiftKey: boolean | undefined = event.shiftKey;
    let cameraTranslation: Point = { x: 0, y: 0 };
    let perspectiveAxis: PerspectiveAxis | undefined;
    let sampledDuringGesture = false;
    handle.dataset.active = "true";
    this.element.dataset.dragging = "true";
    const perspectiveAtStart = this.usesPerspectiveEdit(event.shiftKey);
    this.options.onDistortGesture?.({
      phase: "start",
      corner,
      pointerId: event.pointerId,
      client: { ...latestClient },
      perspective: perspectiveAtStart,
    });
    const applySample = (
      client: Point,
      shiftKey: boolean | undefined,
      updateOverlayImmediately = false,
    ): void => {
      sampledDuringGesture = true;
      latestClient = { ...client };
      latestShiftKey = shiftKey;
      const position = this.pointerPosition(
        {
          clientX: client.x - cameraTranslation.x,
          clientY: client.y - cameraTranslation.y,
        } as PointerEvent,
        dragRect,
        dragWorkspace,
      );
      const perspective = this.usesPerspectiveEdit(shiftKey);
      if (perspective && !perspectiveAxis) {
        perspectiveAxis = resolvePerspectiveAxis({
          x: client.x - event.clientX,
          y: client.y - event.clientY,
        });
      }
      const moved = perspective
        ? perspectiveAxis
          ? applySymmetricPerspective(startQuad, corner, position, perspectiveAxis)
          : startQuad
        : ({
          ...startQuad,
          [corner]: { ...position },
        } as Quad);
      this.quad = cloneQuad(moved);
      this.scheduleFrame();
      // Edge assistance and camera translation are painted in the same frame.
      // Marking this revision as positioned lets the editor rAF skip a second
      // full overlay write unless a newer pointer sample arrives first.
      if (updateOverlayImmediately) this.updateOverlay();
    };
    this.distortCameraUpdate = (pointerId, translation): boolean => {
      if (finished || pointerId !== event.pointerId || this.disabled || this.disposed) {
        return false;
      }
      if (
        translation.x === cameraTranslation.x &&
        translation.y === cameraTranslation.y
      ) return true;
      cameraTranslation = { ...translation };
      // Auto-pan already runs at paint cadence. Update the controls in the
      // same frame as the camera transform, then leave WebGL work coalesced.
      applySample(latestClient, latestShiftKey, true);
      return true;
    };
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== event.pointerId) return;
      if (this.disabled || this.disposed) return;
      if (moveEvent.buttons === 0) {
        end();
        return;
      }
      applySample(
        { x: moveEvent.clientX, y: moveEvent.clientY },
        moveEvent.shiftKey,
      );
      const perspective = this.usesPerspectiveEdit(moveEvent.shiftKey);
      this.options.onDistortGesture?.({
        phase: "update",
        corner,
        pointerId: event.pointerId,
        client: { ...latestClient },
        perspective,
        ...(perspectiveAxis ? { axis: perspectiveAxis } : {}),
      });
    };
    let detachBoundary = (): void => {};
    let finished = false;
    const detach = (): void => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      handle.removeEventListener("lostpointercapture", end);
      detachBoundary();
    };
    const end = (endEvent?: PointerEvent | MouseEvent): void => {
      if (finished) return;
      if (
        endEvent &&
        "pointerId" in endEvent &&
        endEvent.pointerId !== event.pointerId
      ) return;
      finished = true;
      // Pointer-up owns the exact final coordinate, but the modifier state is
      // the gesture's last sampled one: a Shift flipped between the final move
      // and release must not re-map the committed geometry, and in free Distort
      // it would otherwise reinterpret the whole drag as Perspective and wipe
      // it back to the start quad. Cancellation/capture loss intentionally
      // keeps the last visible sample.
      const releaseMovedPastIntent = endEvent &&
        "clientX" in endEvent &&
        resolvePerspectiveAxis({
          x: endEvent.clientX - event.clientX,
          y: endEvent.clientY - event.clientY,
        }) !== undefined;
      if (
        (endEvent?.type === "pointerup" || endEvent?.type === "mouseup") &&
        !this.disabled &&
        !this.disposed &&
        (sampledDuringGesture || releaseMovedPastIntent) &&
        Number.isFinite(endEvent.clientX) &&
        Number.isFinite(endEvent.clientY)
      ) {
        applySample(
          { x: endEvent.clientX, y: endEvent.clientY },
          latestShiftKey,
        );
      }
      detach();
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      if (this.dragCleanup === cleanup) this.dragCleanup = undefined;
      if (this.distortCameraUpdate) this.distortCameraUpdate = undefined;
      delete handle.dataset.active;
      delete this.element.dataset.dragging;
      this.updateOverlay();
      const perspective = this.usesPerspectiveEdit(latestShiftKey);
      this.options.onDistortGesture?.({
        phase: "end",
        corner,
        pointerId: event.pointerId,
        client: { ...latestClient },
        perspective,
        ...(perspectiveAxis ? { axis: perspectiveAxis } : {}),
      });
      this.options.onEditEnd?.("distort");
    };
    const cleanup = (): void => {
      if (finished) return;
      finished = true;
      detach();
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
      if (this.dragCleanup === cleanup) this.dragCleanup = undefined;
      if (this.distortCameraUpdate) this.distortCameraUpdate = undefined;
      delete handle.dataset.active;
      delete this.element.dataset.dragging;
      const perspective = this.usesPerspectiveEdit(latestShiftKey);
      this.options.onDistortGesture?.({
        phase: "end",
        corner,
        pointerId: event.pointerId,
        client: { ...latestClient },
        perspective,
        ...(perspectiveAxis ? { axis: perspectiveAxis } : {}),
      });
    };
    this.dragCleanup = cleanup;
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
    handle.addEventListener("lostpointercapture", end);
    detachBoundary = observePointerSessionBoundary({
      pointerId: event.pointerId,
      onRelease: end,
      onInterrupt: () => end(),
    });
  }

  private cancelDrag(): void {
    this.dragCleanup?.();
    this.dragCleanup = undefined;
  }

  private cancelGesture(): void {
    this.gestureCleanup?.();
    this.gestureCleanup = undefined;
    this.setZoneHint("none");
  }

  private nudgeCorner(
    event: KeyboardEvent,
    corner: (typeof corners)[number],
    direction: { x: number; y: number },
  ): void {
    const pixels = event.altKey ? 0.1 : event.shiftKey ? 10 : 1;
    const pointer = {
      x: this.quad[corner].x + (direction.x * pixels) / this.targetSize.width,
      y: this.quad[corner].y + (direction.y * pixels) / this.targetSize.height,
    };
    const perspective = this.usesPerspectiveEdit(event.shiftKey);
    const moved = perspective
      ? applySymmetricPerspective(
        this.quad,
        corner,
        pointer,
        direction.x === 0 ? "vertical" : "horizontal",
      )
      : ({ ...this.quad, [corner]: pointer } as Quad);
    this.quad = moved;
    this.scheduleFrame();
    this.nudgeActive = true;
    if (this.nudgeCommitTimer !== undefined) clearTimeout(this.nudgeCommitTimer);
    // keyup is the normal commit boundary. The idle fallback covers embedded
    // hosts that lose the matching keyup while focus crosses the iframe.
    this.nudgeCommitTimer = setTimeout(this.finishKeyboardNudge, 240);
  }

  private finishKeyboardNudge = (): void => {
    if (this.nudgeCommitTimer !== undefined) clearTimeout(this.nudgeCommitTimer);
    this.nudgeCommitTimer = undefined;
    if (!this.nudgeActive) return;
    this.nudgeActive = false;
    this.options.onEditEnd?.("distort");
  };

  private updateOverlay(withLabels = true): void {
    this.recomputeWorkspace();
    const workspacePoint = (point: Point): Point => ({
      x: (point.x - this.workspaceOrigin.x) / this.workspaceSize.width,
      y: (point.y - this.workspaceOrigin.y) / this.workspaceSize.height,
    });
    const point = (corner: PerspectiveCorner): [number, number] => [
      workspacePoint(this.quad[corner]).x * this.previewSize.width,
      workspacePoint(this.quad[corner]).y * this.previewSize.height,
    ];
    const referenceTopLeft = workspacePoint({ x: 0, y: 0 });
    const referenceBottomRight = workspacePoint({ x: 1, y: 1 });
    this.referenceRect.setAttribute("x", String(referenceTopLeft.x * this.previewSize.width));
    this.referenceRect.setAttribute("y", String(referenceTopLeft.y * this.previewSize.height));
    this.referenceRect.setAttribute(
      "width",
      String((referenceBottomRight.x - referenceTopLeft.x) * this.previewSize.width),
    );
    this.referenceRect.setAttribute(
      "height",
      String((referenceBottomRight.y - referenceTopLeft.y) * this.previewSize.height),
    );
    this.polygon.setAttribute(
      "points",
      corners.map((corner) => point(corner).join(",")).join(" "),
    );
    for (const corner of corners) {
      const handle = this.handles.get(corner);
      if (!handle) continue;
      const displayPoint = workspacePoint(this.quad[corner]);
      this.positionControl(handle, displayPoint);
      if (withLabels) {
        // Corner buttons serve both modes; the accessible role follows the
        // active interaction semantics rather than the shared element.
        handle.setAttribute(
          "aria-label",
          this.interactionMode === "transform"
            ? this.transformHandleLabel(corner)
            : this.cornerLabel(corner, this.quad[corner]),
        );
      }
    }
    const mid = (a: PerspectiveCorner, b: PerspectiveCorner): { x: number; y: number } => ({
      x: workspacePoint({
        x: (this.quad[a].x + this.quad[b].x) / 2,
        y: (this.quad[a].y + this.quad[b].y) / 2,
      }).x * 100,
      y: workspacePoint({
        x: (this.quad[a].x + this.quad[b].x) / 2,
        y: (this.quad[a].y + this.quad[b].y) / 2,
      }).y * 100,
    });
    const edgeMidpoints: Record<(typeof edges)[number], { x: number; y: number }> = {
      top: mid("tl", "tr"),
      right: mid("tr", "br"),
      bottom: mid("br", "bl"),
      left: mid("bl", "tl"),
    };
    for (const edge of edges) {
      const handle = this.edgeHandles.get(edge);
      if (!handle) continue;
      this.positionControl(handle, {
        x: edgeMidpoints[edge].x / 100,
        y: edgeMidpoints[edge].y / 100,
      });
      if (withLabels) {
        handle.setAttribute("aria-label", this.transformHandleLabel(edge));
      }
    }
    this.updateTransformPivot();
    this.overlayRevision = this.geometryRevision;
  }

  private updateTransformPivot(): void {
    this.positionControl(this.pivotHandle, {
      x: (this.transformPivot.x - this.workspaceOrigin.x) / this.workspaceSize.width,
      y: (this.transformPivot.y - this.workspaceOrigin.y) / this.workspaceSize.height,
    });
  }

  private positionControl(control: HTMLElement, point: Point): void {
    const display = this.presentationSize ?? this.getDisplaySize();
    control.style.setProperty("--worldbend-control-x", `${point.x * display.width}px`);
    control.style.setProperty("--worldbend-control-y", `${point.y * display.height}px`);
  }

  // Pointer events can outpace the display refresh rate, so one frame of
  // overlay, change notification, and render work is coalesced per rAF tick.
  private scheduleFrame(): void {
    this.renderGeneration += 1;
    this.geometryRevision += 1;
    if (this.animationFrame !== undefined || this.disposed) return;
    this.animationFrame = requestAnimationFrame(() => {
      this.animationFrame = undefined;
      if (this.overlayRevision !== this.geometryRevision) {
        this.updateOverlay(this.dragCleanup === undefined);
      }
      this.options.onChange?.(this.captureSpec());
      void this.requestRender(this.renderGeneration);
    });
  }

  private async renderImmediately(): Promise<boolean> {
    this.cancelScheduledRender();
    const generation = ++this.renderGeneration;
    return this.requestRender(generation);
  }

  /**
   * WebAssembly solve work cannot be interrupted once it enters the bridge.
   * Keep exactly one solve/render in flight and replace only the queued
   * intermediate sample, so pointer frequency cannot build a backlog.
   */
  private requestRender(generation: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.queuedRender?.resolve(false);
      this.queuedRender = { generation, resolve };
      this.pumpRenderQueue();
    });
  }

  private pumpRenderQueue(): void {
    if (this.renderInFlight || this.disposed) return;
    const request = this.queuedRender;
    if (!request) return;
    this.queuedRender = undefined;
    this.renderInFlight = true;
    void this.render(request.generation)
      .then(request.resolve)
      .finally(() => {
        this.renderInFlight = false;
        this.pumpRenderQueue();
      });
  }

  private async render(generation: number): Promise<boolean> {
    if (!this.source || !this.previewSource || this.disposed) return false;
    try {
      const snapshot = this.capturePreviewSpec();
      // Source-plane selection still validates the live quadrilateral through
      // the Rust-owned geometry contract, but previews the original pixels in
      // their reference frame. No adapter-side inverse or homography is built.
      if (this.sourceSelectionMode) {
        await solveTransformPreview(snapshot, this.previewSize);
      }
      const renderSpec = this.sourceSelectionMode
        ? this.captureSourceFramePreviewSpec()
        : snapshot;
      const solved = await solveTransformPreview(renderSpec, this.previewSize);
      const warpMesh = this.sourceSelectionMode
        ? undefined
        : await this.resolveWarpMesh(snapshot);
      if (generation !== this.renderGeneration || this.disposed) return false;
      this.renderer.render(this.previewSource, solved, warpMesh);
      if (this.sourceSelectionMode) {
        this.correctionGridAvailable = false;
        this.setCorrectionGridVisibility(false);
      } else {
        this.updateCorrectionGrid(solved, warpMesh);
      }
      this.lastRenderError = undefined;
      this.setValidity(true);
      return true;
    } catch (error) {
      if (generation !== this.renderGeneration || this.disposed) return false;
      // Dragging sweeps through invalid intermediates at frame rate; report
      // each distinct failure once instead of on every frame.
      const message = error instanceof Error ? error.message : String(error);
      const enteredInvalid = this.element.dataset.valid !== "false";
      this.correctionGridAvailable = false;
      this.setCorrectionGridVisibility(false);
      this.setValidity(false);
      if (enteredInvalid || message !== this.lastRenderError) {
        this.lastRenderError = message;
        this.options.onError?.(error);
      }
      return false;
    }
  }

  private setValidity(valid: boolean): void {
    // Render runs every interaction frame; only state changes may notify.
    if (this.element.dataset.valid === String(valid)) return;
    this.element.dataset.valid = String(valid);
    this.options.onValidityChange?.(valid);
  }

  private updateCorrectionGrid(solved: PreviewSolveOutput, warpMesh?: WarpMesh): void {
    const lines = correctionGridPolylines(solved, warpMesh);
    for (let index = 0; index < this.correctionGrid.length; index += 1) {
      const line = this.correctionGrid[index];
      const points = lines[index];
      if (!line || !points) continue;
      line.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    }
    this.correctionGridAvailable = true;
    this.setCorrectionGridVisibility(
      this.overlayVisible && this.interactionMode === "distort",
    );
  }

  private setCorrectionGridVisibility(visible: boolean): void {
    if (visible === this.correctionGridVisible) return;
    this.correctionGridVisible = visible;
    for (const line of this.correctionGrid) line.style.display = visible ? "" : "none";
  }

  private resolveWarpMesh(spec: TransformSpec): Promise<WarpMesh | undefined> {
    if (!hasActiveWarp(spec)) return Promise.resolve(undefined);
    const warp = spec.content.warp!;
    const key = `${warp.preset}\u0000${warp.amount}`;
    if (this.warpMeshCache?.key === key) return this.warpMeshCache.promise;
    const promise = buildWarpMeshPreview(warp).catch((error) => {
      if (this.warpMeshCache?.promise === promise) this.warpMeshCache = undefined;
      throw error;
    });
    this.warpMeshCache = { key, promise };
    return promise;
  }

  private cancelScheduledRender(): void {
    if (this.animationFrame === undefined) return;
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = undefined;
  }

  private cancelQueuedRender(): void {
    const queued = this.queuedRender;
    this.queuedRender = undefined;
    queued?.resolve(false);
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("The perspective editor has been disposed");
  }

  private usesPerspectiveEdit(shiftKey: boolean | undefined): boolean {
    return (this.distortMode === "perspective") !== Boolean(shiftKey);
  }

  private recomputeWorkspace(): void {
    const gutterX = WORKSPACE_GUTTER_DISPLAY_PIXELS /
      Math.max(1, this.targetSize.width * this.displayScale);
    const gutterY = WORKSPACE_GUTTER_DISPLAY_PIXELS /
      Math.max(1, this.targetSize.height * this.displayScale);
    const xValues = [0, 1, ...corners.map((corner) => this.quad[corner].x)];
    const yValues = [0, 1, ...corners.map((corner) => this.quad[corner].y)];
    const rawMinimumX = Math.min(...xValues);
    const rawMaximumX = Math.max(...xValues);
    const rawMinimumY = Math.min(...yValues);
    const rawMaximumY = Math.max(...yValues);
    // Expand the transparent preview workspace in screen-space buckets. A
    // fast outward gesture can then cross many raw pointer samples without
    // reallocating the canvas backing store on every frame. The camera's
    // workspace offset keeps the original target frame visually stationary.
    const bucketX = WORKSPACE_BUCKET_DISPLAY_PIXELS /
      Math.max(1, this.targetSize.width * this.displayScale);
    const bucketY = WORKSPACE_BUCKET_DISPLAY_PIXELS /
      Math.max(1, this.targetSize.height * this.displayScale);
    const minimumX = rawMinimumX < 0
      ? Math.floor((rawMinimumX - gutterX) / bucketX) * bucketX
      : 0;
    const maximumX = rawMaximumX > 1
      ? Math.ceil((rawMaximumX + gutterX) / bucketX) * bucketX
      : 1;
    const minimumY = rawMinimumY < 0
      ? Math.floor((rawMinimumY - gutterY) / bucketY) * bucketY
      : 0;
    const maximumY = rawMaximumY > 1
      ? Math.ceil((rawMaximumY + gutterY) / bucketY) * bucketY
      : 1;
    this.workspaceOrigin = { x: minimumX, y: minimumY };
    this.workspaceSize = {
      width: Math.max(Number.EPSILON, maximumX - minimumX),
      height: Math.max(Number.EPSILON, maximumY - minimumY),
    };
    this.previewSize = this.fitPreviewSize({
      width: this.targetSize.width * this.workspaceSize.width,
      height: this.targetSize.height * this.workspaceSize.height,
    });
    this.overlay.setAttribute(
      "viewBox",
      `0 0 ${this.previewSize.width} ${this.previewSize.height}`,
    );
  }

  private capturePreviewSpec(): TransformSpec {
    const toWorkspace = (point: Point): Point => ({
      x: (point.x - this.workspaceOrigin.x) / this.workspaceSize.width,
      y: (point.y - this.workspaceOrigin.y) / this.workspaceSize.height,
    });
    return normalizedSpec(
      {
        tl: toWorkspace(this.quad.tl),
        tr: toWorkspace(this.quad.tr),
        br: toWorkspace(this.quad.br),
        bl: toWorkspace(this.quad.bl),
      },
      this.orientation,
      this.warp,
    );
  }

  private captureSourceFramePreviewSpec(): TransformSpec {
    const toWorkspace = (point: Point): Point => ({
      x: (point.x - this.workspaceOrigin.x) / this.workspaceSize.width,
      y: (point.y - this.workspaceOrigin.y) / this.workspaceSize.height,
    });
    return normalizedSpec({
      tl: toWorkspace({ x: 0, y: 0 }),
      tr: toWorkspace({ x: 1, y: 0 }),
      br: toWorkspace({ x: 1, y: 1 }),
      bl: toWorkspace({ x: 0, y: 1 }),
    });
  }
}

function arrowDirection(key: string): { x: number; y: number } | undefined {
  return {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
  }[key];
}

// Handles and host overlay controls (for example zoom buttons sharing the
// gesture surface) manage their own pointer events; a duck-typed closest()
// check keeps the guard working in DOM-less test environments.
function isFormControlTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const closest = (target as Element).closest;
  return typeof closest === "function" && Boolean((target as Element).closest("button, input"));
}

function isCorner(
  handle: (typeof corners)[number] | (typeof edges)[number],
): handle is (typeof corners)[number] {
  return (corners as readonly string[]).includes(handle);
}

function contentOrientation(spec: TransformSpec | undefined): SourceOrientation {
  return spec?.content.orientation ?? "native";
}

function contentWarp(spec: TransformSpec | undefined): WarpSpec | undefined {
  return spec?.content.warp ? { ...spec.content.warp } : undefined;
}

function hasActiveWarp(spec: TransformSpec): boolean {
  return spec.content.warp !== undefined && spec.content.warp.amount !== 0;
}

function defaultCornerLabel(corner: PerspectiveCorner, point: { x: number; y: number }): string {
  return `${cornerNames[corner]} corner, x ${(point.x * 100).toFixed(2)}%, y ${(point.y * 100).toFixed(2)}%. Use arrow keys to move.`;
}

function defaultTransformHandleLabel(handle: TransformHandle): string {
  return `${transformHandleNames[handle]} handle. Use arrow keys to resize.`;
}

const defaultTransformSurfaceLabel =
  "Transform preview. Use arrow keys to move the plane. Hold Space to pan the preview.";

const defaultTransformPivotLabel =
  "Transform reference point. Drag or use arrow keys to move.";

import type { Point, TransformSpec } from "@worldbend/web";
import {
  rebaseTransformFrame,
  type TransformFrame,
} from "./transform-frame";

export interface FlipState {
  x: boolean;
  y: boolean;
}

/** The flip state users see is the effective saved result, not a recipe delta. */
export function effectiveFlipState(
  spec: TransformSpec | undefined,
): FlipState {
  switch (spec?.content.orientation ?? "native") {
    case "flipHorizontal":
      return { x: true, y: false };
    case "flipVertical":
      return { x: false, y: true };
    case "flipBoth":
      return { x: true, y: true };
    case "native":
      return { x: false, y: false };
  }
}

export interface AppliedTransformSnapshot {
  initialFrame: TransformFrame;
  finalFrame: TransformFrame;
}

export interface AppliedTransformMemory {
  begin(generation: number, snapshot: AppliedTransformSnapshot): void;
  complete(generation: number): boolean;
  fail(generation: number): void;
  cancelPending(): void;
  hasLatest(): boolean;
  repeatFor(nextInitial: TransformFrame): TransformFrame | undefined;
}

/**
 * Remember only a transform that the Figma main thread confirmed as written.
 * The snapshot is the complete visual result, so Transform Again also covers
 * a cumulative Transform -> Distort sequence instead of replaying reset fields.
 */
export function createAppliedTransformMemory(): AppliedTransformMemory {
  let pending:
    | { generation: number; snapshot: AppliedTransformSnapshot }
    | undefined;
  let latest: AppliedTransformSnapshot | undefined;

  return {
    begin(generation, snapshot) {
      pending = { generation, snapshot: cloneSnapshot(snapshot) };
    },
    complete(generation) {
      if (!pending || pending.generation !== generation) return false;
      latest = cloneSnapshot(pending.snapshot);
      pending = undefined;
      return true;
    },
    fail(generation) {
      if (pending?.generation === generation) pending = undefined;
    },
    cancelPending() {
      pending = undefined;
    },
    hasLatest: () => latest !== undefined,
    repeatFor(nextInitial) {
      if (!latest) return undefined;
      return rebaseTransformFrame(
        latest.initialFrame,
        nextInitial,
        latest.finalFrame,
      );
    },
  };
}

export function parsePlacementValue(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Convert a document-space placement edit back into recipe translation. */
export function translationForPlacement(input: {
  desired: number;
  current: number;
  currentTranslation: number;
  baseRenderSize: number;
  basePlacementSize: number;
}): number | undefined {
  const {
    desired,
    current,
    currentTranslation,
    baseRenderSize,
    basePlacementSize,
  } = input;
  if (
    ![desired, current, currentTranslation, baseRenderSize, basePlacementSize].every(
      Number.isFinite,
    ) ||
    baseRenderSize <= 0 ||
    basePlacementSize <= 0
  ) {
    return undefined;
  }
  const scale = basePlacementSize / baseRenderSize;
  return currentTranslation + (desired - current) / scale;
}

function cloneSnapshot(snapshot: AppliedTransformSnapshot): AppliedTransformSnapshot {
  return {
    initialFrame: structuredClone(snapshot.initialFrame),
    finalFrame: structuredClone(snapshot.finalFrame),
  };
}

/** Utility for updating one axis without losing the other recipe translation. */
export function withTranslationAxis(
  translation: Point,
  axis: "x" | "y",
  value: number,
): Point {
  return { ...translation, [axis]: value };
}

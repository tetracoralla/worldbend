import type {
  TransformGestureEvent,
  TransformHandle,
  TransformRecipe,
} from "@worldbend/web";
import {
  applyMoveGesture,
  applyPivotGesture,
  applyRotateGesture,
  applyScaleGesture,
  type GestureFrame,
} from "./recipe-gestures";

interface ActiveGesture {
  frame: GestureFrame;
  kind: "move" | "scale" | "rotate" | "pivot";
  handle?: TransformHandle;
  startPointer: { x: number; y: number };
}

type UpdateGestureEvent = Exclude<TransformGestureEvent, { phase: "start" }>;

export interface TransformGestureSample {
  recipe: TransformRecipe;
  final: boolean;
}

export interface TransformGestureSession {
  start(event: TransformGestureEvent, frame: GestureFrame): boolean;
  update(event: TransformGestureEvent, scaleLinked: boolean): TransformGestureSample | undefined;
  cancel(): void;
  active(): boolean;
}

/**
 * Own pointer-session state separately from UI rendering and async preview
 * scheduling. Every new session receives an already-committed GestureFrame;
 * pointer-up clears ownership before its final sample leaves this boundary.
 */
export function createTransformGestureSession(): TransformGestureSession {
  let active: ActiveGesture | undefined;

  return {
    start(event, frame) {
      if (event.phase !== "start") return false;
      active = {
        frame,
        kind: event.kind,
        ...(event.handle ? { handle: event.handle } : {}),
        startPointer: { ...event.pointer },
      };
      return true;
    },
    update(event, scaleLinked) {
      if (event.phase === "start" || !active) return undefined;
      const recipe = recipeForEvent(active, event, scaleLinked);
      if (!recipe) return undefined;
      const final = event.phase === "end";
      if (final) active = undefined;
      return { recipe, final };
    },
    cancel() {
      active = undefined;
    },
    active: () => active !== undefined,
  };
}

function recipeForEvent(
  session: ActiveGesture,
  event: UpdateGestureEvent,
  scaleLinked: boolean,
): TransformRecipe | undefined {
  if (session.kind === "move") {
    return applyMoveGesture(session.frame, session.startPointer, event.pointer);
  }
  if (session.kind === "rotate") {
    return applyRotateGesture(
      session.frame,
      session.startPointer,
      event.pointer,
      event.shiftKey,
    );
  }
  if (session.kind === "pivot") {
    return applyPivotGesture(session.frame, event.pointer);
  }
  if (!session.handle) return undefined;
  const uniform = event.shiftKey ? !scaleLinked : scaleLinked;
  return applyScaleGesture(session.frame, session.handle, event.pointer, uniform);
}

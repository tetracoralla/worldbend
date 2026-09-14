export type DesignerDraftOrigin =
  | "unresolved"
  | "stored-task"
  | "perspective"
  | "template"
  | "user";

/**
 * Records where a task-workspace draft came from.
 *
 * An empty Undo stack is not evidence that a draft is uninitialized: a stored
 * task or a freshly loaded template also starts with one baseline entry. Keep
 * the origin explicit so an asynchronous Perspective seed cannot overwrite a
 * draft the user already chose or edited.
 */
export class DesignerDraftOriginState {
  #origin: DesignerDraftOrigin = "unresolved";

  get current(): DesignerDraftOrigin {
    return this.#origin;
  }

  loadSource(hasStoredTask: boolean): void {
    this.#origin = hasStoredTask ? "stored-task" : "unresolved";
  }

  mark(origin: Exclude<DesignerDraftOrigin, "unresolved" | "stored-task">): void {
    this.#origin = origin;
  }

  clear(): void {
    this.#origin = "unresolved";
  }

  shouldSeedFromPerspective(): boolean {
    return this.#origin === "unresolved";
  }
}

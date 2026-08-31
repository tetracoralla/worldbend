export type ProductWorkspace = "perspective" | "canvas";

export interface ProductWorkspaceRouter {
  current(): ProductWorkspace;
  enterCanvas(): boolean;
  returnToPerspective(): boolean;
}

/**
 * Owns only the product-level route. Perspective mode/draft state remains in
 * its existing controller and is therefore neither reset nor copied when the
 * replacing Canvas workspace opens.
 */
export function createProductWorkspaceRouter(input: {
  onEnterCanvas(): void;
  onReturnToPerspective(): void;
}): ProductWorkspaceRouter {
  let workspace: ProductWorkspace = "perspective";
  return {
    current: () => workspace,
    enterCanvas() {
      if (workspace === "canvas") return false;
      workspace = "canvas";
      input.onEnterCanvas();
      return true;
    },
    returnToPerspective() {
      if (workspace === "perspective") return false;
      workspace = "perspective";
      input.onReturnToPerspective();
      return true;
    },
  };
}

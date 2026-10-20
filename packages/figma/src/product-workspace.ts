export type ProductWorkspace = "perspective" | "canvas" | "spatial" | "mockup" | "mesh" | "surface" | "remap" | "appearance" | "card" | "presets" | "templates";

/** Product intent owns navigation hierarchy; operation state remains with the
 * workspace or its shared work model. A family is not a claim that every tool
 * inside it can mutate the same unpublished operation. */
export type ProductWorkspaceFamily = "shape" | "compose" | "finish" | "library";

export const PRODUCT_WORKSPACE_FAMILIES: Readonly<Record<ProductWorkspaceFamily, readonly ProductWorkspace[]>> = {
  shape: ["perspective", "mesh", "surface", "remap"],
  compose: ["mockup", "spatial", "card"],
  finish: ["appearance", "canvas"],
  library: ["presets", "templates"],
};

export function productWorkspaceFamily(workspace: ProductWorkspace): ProductWorkspaceFamily {
  for (const [family, workspaces] of Object.entries(PRODUCT_WORKSPACE_FAMILIES)) {
    if (workspaces.includes(workspace)) return family as ProductWorkspaceFamily;
  }
  throw new Error(`Unknown product workspace: ${workspace}`);
}

export interface ProductWorkspaceRouter {
  current(): ProductWorkspace;
  enter(workspace: ProductWorkspace): boolean;
  returnToPerspective(): boolean;
}

/**
 * Owns only the product-level route. Perspective mode/draft state remains in
 * its existing controller and is therefore neither reset nor copied when the
 * replacing Canvas workspace opens.
 */
export function createProductWorkspaceRouter(input: {
  onChange(previous: ProductWorkspace, next: ProductWorkspace): void;
}): ProductWorkspaceRouter {
  let workspace: ProductWorkspace = "perspective";
  const move = (next: ProductWorkspace): boolean => {
    if (workspace === next) return false;
    const previous = workspace;
    workspace = next;
    input.onChange(previous, next);
    return true;
  };
  return {
    current: () => workspace,
    enter: (next) => move(next),
    returnToPerspective: () => move("perspective"),
  };
}

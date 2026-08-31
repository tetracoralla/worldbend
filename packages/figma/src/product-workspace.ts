export type ProductWorkspace = "perspective" | "canvas" | "mockup" | "mesh" | "remap";

export interface ProductWorkspaceRouter {
  current(): ProductWorkspace;
  enter(workspace: Exclude<ProductWorkspace, "perspective">): boolean;
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

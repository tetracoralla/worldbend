/** Test-host coordinate mechanics, not a replacement for native Figma evidence. */
export function appendNativeTestChild(parent: any, node: any): void {
  const previous = node.parent?.children;
  if (previous) { const i = previous.indexOf(node); if (i >= 0) previous.splice(i, 1); }
  if (!parent.children.includes(node)) parent.children.push(node);
  node.parent = parent;
}
export function installNativeTestBasis(node: any): any {
  let local = structuredClone(node.relativeTransform ?? node.absoluteTransform ?? [[1, 0, 0], [0, 1, 0]]);
  Object.defineProperty(node, "relativeTransform", { configurable: true, enumerable: true,
    get: () => local, set: value => { local = structuredClone(value); } });
  Object.defineProperty(node, "absoluteTransform", { configurable: true, enumerable: true,
    get: () => {
      let parent = node.parent;
      while (parent?.type === "GROUP" || parent?.type === "BOOLEAN_OPERATION") parent = parent.parent;
      const basis = parent?.absoluteTransform;
      return basis ? multiply(basis, local) : structuredClone(local);
    },
    set: value => {
      let parent = node.parent;
      while (parent?.type === "GROUP" || parent?.type === "BOOLEAN_OPERATION") parent = parent.parent;
      local = parent?.absoluteTransform ? multiply(inverse(parent.absoluteTransform), value) : structuredClone(value);
    },
  });
  for(const [axis,row] of [["x",0],["y",1]] as const)Object.defineProperty(node,axis,{configurable:true,enumerable:true,
    get:()=>local[row][2],set:value=>{local[row][2]=value;}});
  if (node.children) node.appendChild = (child: any) => appendNativeTestChild(node, child);
  node.resizeWithoutConstraints = (width: number, height: number) => { node.width = width; node.height = height; };
  return node;
}
function multiply(a: number[][], b: number[][]): number[][] {
  return [[a[0]![0]! * b[0]![0]! + a[0]![1]! * b[1]![0]!, a[0]![0]! * b[0]![1]! + a[0]![1]! * b[1]![1]!, a[0]![0]! * b[0]![2]! + a[0]![1]! * b[1]![2]! + a[0]![2]!],
    [a[1]![0]! * b[0]![0]! + a[1]![1]! * b[1]![0]!, a[1]![0]! * b[0]![1]! + a[1]![1]! * b[1]![1]!, a[1]![0]! * b[0]![2]! + a[1]![1]! * b[1]![2]! + a[1]![2]!]];
}
function inverse(a: number[][]): number[][] {
  const d = a[0]![0]! * a[1]![1]! - a[0]![1]! * a[1]![0]!;
  return [[a[1]![1]! / d, -a[0]![1]! / d, (a[0]![1]! * a[1]![2]! - a[1]![1]! * a[0]![2]!) / d],
    [-a[1]![0]! / d, a[0]![0]! / d, (a[1]![0]! * a[0]![2]! - a[0]![0]! * a[1]![2]!) / d]];
}

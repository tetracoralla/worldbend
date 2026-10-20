import { inspectLinkedResult as read, publishLinkedImage as publish, type LinkedUpdatePlan } from "./agent-linked-results";
export { inspectLinkedResults } from "./agent-linked-results";

type PackedRow = [string, string, number, string, string[], string[], boolean];
type Column<T> = T[] | {constant:T};
type PackedPlan = Omit<LinkedUpdatePlan, "items"> & (
  {rows:PackedRow[]} | {columns:[string[],Column<string>,Column<number>,Column<string>,Column<string[]>,Column<string[]>,Column<boolean>]}
);

/** Exact private projection: retain all graph and guard facts while avoiding
 * repeated column values. Public callers continue supplying the complete plan. */
export function expandLinkedUpdatePlan(plan: LinkedUpdatePlan | PackedPlan): LinkedUpdatePlan {
  if ("items" in plan) return plan;
  const rows = "rows" in plan ? plan.rows : plan.columns[0].map((_,index)=>
    plan.columns.map(column=>Array.isArray(column)?column[index]:column.constant) as PackedRow);
  const header = "rows" in plan ? (({rows,...rest})=>rest)(plan) : (({columns,...rest})=>rest)(plan);
  return {...header,items:rows.map(([nodeId,kind,revision,expected,sourceNodeIds,dependencyNodeIds,updatable])=>
    ({nodeId,name:"",kind,revision,expected,sourceNodeIds,dependencyNodeIds,updatable}))};
}

export function inspectLinkedResult(input: Omit<Parameters<typeof read>[0], "plan"> & { plan: LinkedUpdatePlan | PackedPlan }) {
  return read({ ...input, plan: expandLinkedUpdatePlan(input.plan) });
}

export function publishLinkedImage(input: Omit<Parameters<typeof publish>[0], "plan"> & { plan: LinkedUpdatePlan | PackedPlan },validatePublication?:()=>void) {
  return publish({ ...input, plan: expandLinkedUpdatePlan(input.plan) },validatePublication);
}

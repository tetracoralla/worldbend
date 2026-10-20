import { readResultBinding } from "./stored-binding";
import { readStoredOperation, operationDraftKey } from "./stored-operation";
export { operationDraftKey } from "./stored-operation";
import { nodePage } from "./native-document";
import { linkedTargetExpected } from "./agent-linked-results";
import { figmaError } from "./state-fingerprint";
import { boundedStateFingerprint } from "./agent-handoff";
import { rasterPaintsIntact } from "./raster-paint-guard";
import { parseStoredEffectDraft, parseStoredMockupDraft } from "./stored-designer-task";

export interface WorkScope { fileKey: string; pageId: string; nodeId: string }
export interface WorkReference extends WorkScope { revision: number; targetExpected: string }
export interface WorkPage { part?: number; token?: string }

export function workScope(input: WorkScope) {
  if (figma.fileKey !== input.fileKey || figma.currentPage.id !== input.pageId || figma.currentPage.removed) {
    throw figmaError("SCOPE", "inspect the granted live page");
  }
}

/** Metadata remains obtainable even when the old source is missing. Reading
 * does not export media, repair plugin data or overwrite native appearance. */
export async function workState(input: WorkScope & { targetExpected?: string; revision?: number },
  invalidDraftPolicy: "reject" | "report" = "reject") {
  workScope(input);
  const node = await figma.getNodeByIdAsync(input.nodeId);
  workScope(input);
  const stored = node && readStoredOperation(node), binding = node && readResultBinding(node);
  if (!node || node.removed || node.type !== "RECTANGLE" || nodePage(node)?.id !== input.pageId ||
    stored?.status !== "valid" || !binding) throw figmaError("STATE", "select linked raster work with valid saved controls");
  const targetExpected = linkedTargetExpected(node);
  if ((input.targetExpected !== undefined && input.targetExpected !== targetExpected) ||
    (input.revision !== undefined && input.revision !== binding.revision)) throw figmaError("CONFLICT", "work changed; reread");
  const draftKey = operationDraftKey(stored.operation);
  const raw = draftKey && node.getSharedPluginData("worldbend", draftKey);
  const draft = raw && (draftKey === "effectDraft" ? parseStoredEffectDraft(raw) : parseStoredMockupDraft(raw));
  const invalidDraft = Boolean(raw && (!draft || draft.baseRevision !== binding.revision || stored.operation.kind !== "task" ||
    (draftKey === "effectDraft" ? stored.operation.task.kind !== "effect" || draft.task.kind !== "effect" :
      !["mockup", "composition"].includes(stored.operation.task.kind) || !["mockup", "composition"].includes(draft.task.kind))));
  if (invalidDraft && invalidDraftPolicy === "reject") {
    throw figmaError("STATE", "invalid pending draft; reopen to repair");
  }
  return { schema: "worldbend.figma.work-state" as const, version: "0.1" as const,
    fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId,
    revision: binding.revision, targetExpected, operation: stored.operation, sourceNodeIds: [...binding.sourceNodeIds],
    renderWidth: binding.renderWidth, renderHeight: binding.renderHeight,
    placement: { x: node.x, y: node.y, width: node.width, height: node.height },
    published: Array.isArray(node.fills) && node.fills.some(paint => paint.type === "IMAGE" && Boolean(paint.imageHash)),
    imageIntact: rasterPaintsIntact(node), ...(draft && !invalidDraft ? { draftKey, pendingDraft: draft } : {}),
    ...(invalidDraft ? { draftIssue: "unusable" as const } : {}) };
}

/** Parts contain exact UTF-16 slices of one JSON value. Joining all parts
 * before JSON parsing retains Unicode and every parameter without summaries.
 * The token includes the whole value; a changed native state cannot be mixed
 * into an earlier read. At 2048 code units even worst JSON escaping is bounded. */
export function statePage(value: unknown, input: WorkPage, partSize = 2048) {
  const json = JSON.stringify(value);
  if (json.length > 512 * 1024) throw figmaError("LIMIT", "work state exceeds bounded read capacity");
  const token = boundedStateFingerprint(json), partCount = Math.max(1, Math.ceil(json.length / partSize)), part = input.part ?? 0;
  if (!Number.isSafeInteger(part) || part < 0 || part >= partCount || (part > 0 && !input.token)) throw figmaError("INPUT", "use a valid state part and its token");
  if (input.token !== undefined && input.token !== token) throw figmaError("CONFLICT", "work changed between parts; restart read");
  return { schema: "worldbend.figma.work-state-page" as const, version: "0.1" as const, token, part, partCount,
    codeUnits: json.length, json: json.slice(part * partSize, (part + 1) * partSize) };
}

export async function readWorkState(input: WorkScope & WorkPage) {
  return statePage(await workState({fileKey:input.fileKey,pageId:input.pageId,nodeId:input.nodeId}), input);
}

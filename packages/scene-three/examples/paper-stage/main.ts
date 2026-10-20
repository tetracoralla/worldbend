import { attachScene3d, type SceneSession, type SceneState, type SpatialDocumentSpec } from "../../src/index";
import { inspectSpatialDocument, planSpatialDocumentUpdate } from "@worldbend/web/spatial-document";
import { continueFromAuthor, fieldName, type Choice } from "./continuation";
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const storageKey = "worldbend.paper-theatre.v1";
const status = $("status"), host = $("stage"), time = $<HTMLInputElement>("time");
type Snapshot = { document: SpatialDocumentSpec; sourceDocument?: SpatialDocumentSpec; localFields?: string[] };
type Author = { id: string; title: string; document: SpatialDocumentSpec; fingerprint?: string };
let session: SceneSession | undefined, busy = false, retry: (() => Promise<void>) | undefined;
let history: Snapshot[] = [], sourceDocument: SpatialDocumentSpec | undefined;
let localFields: string[] = [];
let recoveryRecord: string | undefined, preserveOriginal = false;
let previousStatus: SceneState["status"] | undefined;
let initial: SpatialDocumentSpec, refs: Record<string, string>, sources: Record<string, string>;
let editions: Record<string, { cover: string; scene: string; camera: string; animation: string }>, authors: Author[];
let pending: { author: Author; before: Snapshot; guard: SceneState["guard"]; choices: Record<string, Choice> } | undefined;
let sourceAbort: AbortController | undefined;
const scene = (doc: SpatialDocumentSpec) => {
  const item = doc.expressions.find(e => e.id === "paper-theatre");
  if (item?.kind !== "scene3d") throw Error("作品缺少纸质场景。");
  return item.scene;
};
const version = (edition: number, file: string) => editions[String(edition)][file === "cover.png" ? "cover" : "scene"];
const message = (text: string, error = false) => { status.textContent = text; status.classList.toggle("error", error); };
async function loadProject() {
  const load = async (name: string) => {
    const response = await fetch("./" + name + ".json");
    if (!response.ok) throw Error("作品文件暂时无法读取，请重试。");
    return response.json();
  };
  [initial, refs, editions, sources, authors] = await Promise.all([
    load("document"), load("asset-index"), load("editions"), load("source-index"), load("author-versions"),
  ]);
  for (const author of authors) author.fingerprint = (await inspectSpatialDocument(author.document)).fingerprint;
}
const resolveAsset = async (asset: { contentVersion?: string | null }, signal: AbortSignal) => {
  const url = refs[asset.contentVersion ?? ""];
  if (!url) throw Error("作品缺少对应素材，请打开完整的作品包。");
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error("素材暂时无法读取，请重试。");
  return new Uint8Array(await response.arrayBuffer());
};
const snapshot = (): Snapshot => ({ document: session!.getDocument(), sourceDocument: sourceDocument && structuredClone(sourceDocument), localFields: [...localFields] });
const authorOf = (doc?: SpatialDocumentSpec) => doc && authors.find(a => JSON.stringify(a.document) === JSON.stringify(doc));
const inferSource = (doc: SpatialDocumentSpec) => authors.find(a =>
  a.document.assets.find(x => x.id === "paper-stage")?.contentVersion === doc.assets.find(x => x.id === "paper-stage")?.contentVersion,
)?.document;
function encodedWork() {
  return { schema: "worldbend.paper-theatre-file", version: "0.2", ...snapshot(), timeMs: session!.getState().timeMs, history };
}
function persist() {
  if (!session) return;
  if (preserveOriginal) { message("原记录已保留；当前编辑请使用“保存作品”另存。", true); return; }
  try { localStorage.setItem(storageKey, JSON.stringify(encodedWork())); }
  catch { message("当前作品可继续使用；浏览器未保存，请下载作品文件。"); }
}
function stateChanged(state: SceneState) {
  time.max = String(state.durationMs); time.value = String(state.timeMs);
  $("clock").textContent = `${(state.timeMs / 1000).toFixed(1)} / ${(state.durationMs / 1000).toFixed(1)} s`;
  $("play").textContent = state.reducedMotion ? "动态已关闭" : state.paused ? "播放" : "暂停";
  $("play").setAttribute("aria-label", state.reducedMotion ? "减少动态模式" : state.paused ? "播放镜头" : "暂停镜头");
  $<HTMLButtonElement>("play").disabled = state.reducedMotion || state.status !== "ready";
  if (state.status === "lost") message("画面正在恢复，已保留当前作品。");
  else if (previousStatus === "lost" && state.status === "ready") message("画面已恢复。");
  previousStatus = state.status;
}
function updateContent() {
  if (!session) return;
  const doc = session.getDocument(), cover = doc.assets.find(a => a.id === "field-notes")!.contentVersion!;
  const source = doc.assets.find(a => a.id === "paper-stage")!.contentVersion!, second = cover === version(2, "cover.png");
  $("edition").textContent = second ? "02" : "01";
  const flat = $<HTMLImageElement>("flat"); flat.src = refs[cover]; flat.hidden = false;
  $("cover").textContent = second ? "恢复封面 01" : "换封面";
  $("blend").setAttribute("href", sources[source]);
  $("view").textContent = scene(doc).camera === "FrontCamera" ? "作者视角" : "正面";
  const baseline = sourceDocument && scene(sourceDocument);
  const adjusted = baseline && (localFields.includes("/expressions/paper-theatre/scene/timing") || scene(doc).frameCount !== baseline.frameCount || scene(doc).timebase.numerator !== baseline.timebase.numerator || scene(doc).timebase.denominator !== baseline.timebase.denominator);
  $("retime").textContent = adjusted ? "恢复作者节奏" : "延长到 6 秒";
  const author = authorOf(sourceDocument), index = authors.findIndex(a => a === author);
  const changes = sourceDocument ? continueFromAuthor(sourceDocument, doc, sourceDocument, {}, localFields).preserved : [];
  $("provenance").textContent = author ? `作者版 ${author.id} · ${changes.length ? "本地调整：" + [...new Set(changes.map(d => fieldName(d.path)))].join("、") : "沿用作者设置"}` : "作者基线未记录；当前作品仍可编辑和保存";
  $("scene").textContent = index === authors.length - 1 ? "已接续最新作者版" : "查看作者更新";
  $<HTMLButtonElement>("scene").disabled = busy || !!pending || index < 0 || index === authors.length - 1;
  $<HTMLButtonElement>("undo").disabled = busy || !!pending || !history.length;
}
const editingControls = ["cover", "scene", "view", "retime", "undo", "save", "png"];
function controls() {
  $<HTMLInputElement>("open").disabled = busy || !!pending;
  for (const id of editingControls) $<HTMLButtonElement>(id).disabled = busy || !!pending || !session;
  $<HTMLButtonElement>("apply-source").disabled = busy;
  $<HTMLButtonElement>("cancel-source").disabled = busy && !sourceAbort;
  for (const input of $("source-conflicts").querySelectorAll("input")) input.disabled = busy;
  updateContent();
}
async function run(action: () => Promise<void>) {
  if (busy) return;
  busy = true; retry = action; $("retry").hidden = true; controls();
  try { await action(); retry = undefined; persist(); }
  catch (error) {
    if (error instanceof Error && error.name === "AbortError") { retry = undefined; message("已取消接续，当前作品已保留。"); }
    else if (error instanceof Error && error.name === "SourcePreviewChanged") { retry = undefined; message(error.message, true); }
    else { message(error instanceof Error ? error.message : String(error), true); $("retry").hidden = false; }
  }
  finally { busy = false; controls(); }
}
async function accept(next: SpatialDocumentSpec, guard = session!.getState().guard, source = sourceDocument, fields = localFields, signal?: AbortSignal) {
  const before = snapshot();
  const candidate = await planSpatialDocumentUpdate({
    document: before.document, expectedFingerprint: guard.documentFingerprint,
    revisions: next.assets.filter(a => a.contentVersion !== before.document.assets.find(x => x.id === a.id)?.contentVersion)
      .map(a => ({ assetId: a.id, contentVersion: a.contentVersion! })),
    expressions: next.expressions,
  });
  await session!.revise(candidate.document, guard, signal);
  // The carrier accepted the pixels first. Lineage and undo move in that same
  // successful transaction; failed/stale source candidates never advance them.
  sourceDocument = source && structuredClone(source);
  localFields = [...fields];
  history = [...history, before].slice(-20);
  message("作品已更新。");
}
async function localEdit(path: string, edit: (doc: SpatialDocumentSpec) => void) {
  const doc = session!.getDocument(); edit(doc);
  const other = localFields.filter(p => p !== path);
  const fields = sourceDocument ? continueFromAuthor(sourceDocument, doc, sourceDocument, {}, other).localFields : other;
  await accept(doc, session!.getState().guard, sourceDocument, fields);
}
async function open(spec: SpatialDocumentSpec, ms = 1625, source = inferSource(spec)) {
  await inspectSpatialDocument(spec);
  // This concrete host's controls address one known work structure. Check it
  // before acquiring a candidate or retiring the accepted receiver; the core
  // and generic scene carrier continue to support other documents.
  continueFromAuthor(initial, spec, initial);
  scene(spec);
  const nextFields = source ? continueFromAuthor(source, spec, source).localFields : [];
  const candidateHost = document.createElement("div"); candidateHost.style.cssText = "width:100%;height:100%";
  const next = await attachScene3d(candidateHost, spec, "paper-theatre", {
    resolveAsset, paused: true,
    onChange: state => { if (session?.canvas.parentElement === candidateHost) stateChanged(state); },
    onError: e => message(e.message, true),
  });
  try { next.seek(ms); } catch (error) { next.destroy(); throw error; }
  session?.destroy(); host.replaceChildren(candidateHost); session = next;
  sourceDocument = source && structuredClone(source); history = [];
  localFields = nextFields;
  stateChanged(next.getState()); updateContent();
  message(next.getState().reducedMotion ? "已打开作品；减少动态模式下可拖动查看镜头。" : "作品已打开。");
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function previewSource() {
  const author = authorOf(sourceDocument), index = authors.findIndex(a => a === author), next = authors[index + 1];
  if (!sourceDocument || index < 0 || !next) return;
  pending = { author: next, before: snapshot(), guard: session!.getState().guard, choices: {} };
  renderPreview(); $("source-panel").hidden = false; controls(); $("apply-source").focus();
}
function renderPreview() {
  if (!pending) return;
  const diff = continueFromAuthor(pending.before.sourceDocument!, pending.before.document, pending.author.document, pending.choices, pending.before.localFields);
  $("source-title").textContent = `作者版 ${pending.author.id} · ${pending.author.title}`;
  $("source-summary").textContent = `更新：${[...new Set(diff.changes.map(fieldName))].join("、")}。`;
  $("source-preserved").textContent = diff.preserved.length ? `保留本地：${[...new Set(diff.preserved.map(d => fieldName(d.path)))].join("、")}。` : "采用作者设置。";
  $("source-conflicts").replaceChildren();
  for (const conflict of diff.conflicts) {
    const group = document.createElement("fieldset"); group.dataset.path = conflict.path;
    const legend = document.createElement("legend"); legend.textContent = `${fieldName(conflict.path)}也被作者改过`;
    const options = document.createElement("div"); options.className = "conflict-options";
    group.append(legend, options);
    const describe = (value: unknown) => {
      if (conflict.path.endsWith("/timing")) {
        const timing = value as { frameCount: number; timebase: { numerator: number; denominator: number } };
        return `${Number((timing.frameCount * timing.timebase.denominator / timing.timebase.numerator).toFixed(2))} 秒`;
      }
      if (conflict.path.endsWith("/camera")) return value === "FrontCamera" ? "正面视角" : "镜头视角";
      if (conflict.path === "/assets/field-notes/contentVersion") return "封面";
      return "设置";
    };
    for (const [value, text] of [["local", "保留：" + describe(conflict.local)], ["source", "采用作者：" + describe(conflict.source)]]) {
      const label = document.createElement("label"), input = document.createElement("input");
      input.type = "radio"; input.name = conflict.path; input.value = value;
      input.checked = value === (pending.choices[conflict.path] ?? "local");
      input.onchange = () => {
        if (!input.checked) return;
        pending!.choices[conflict.path] = input.value as Choice;
        const chosen = continueFromAuthor(pending!.before.sourceDocument!, pending!.before.document, pending!.author.document, pending!.choices, pending!.before.localFields);
        $("source-preserved").textContent = chosen.preserved.length ? `保留本地：${[...new Set(chosen.preserved.map(d => fieldName(d.path)))].join("、")}。` : "采用作者设置。";
      };
      label.append(input, document.createTextNode(text)); options.append(label);
    }
    $("source-conflicts").append(group);
  }
}
function dismissSource() {
  pending = undefined; $("source-panel").hidden = true; controls();
  requestAnimationFrame(() => ($<HTMLButtonElement>("scene").disabled ? $("view") : $("scene")).focus());
}
$("scene").onclick = previewSource;
$("cancel-source").onclick = () => { sourceAbort?.abort(); dismissSource(); message("保留当前作品。"); };
$("apply-source").onclick = () => {
  if (busy || !pending) return;
  void run(async () => {
    const controller = new AbortController(); sourceAbort = controller; controls();
    try {
      if (!pending) throw Error("请重新查看作者更新。");
      const update = pending;
      const now = session!.getState().guard;
      if (now.instance !== update.guard.instance || now.revision !== update.guard.revision || now.documentFingerprint !== update.guard.documentFingerprint) {
        dismissSource();
        const error = Error("作品在预览期间已有修改，请重新查看作者更新。");
        error.name = "SourcePreviewChanged"; throw error;
      }
      const next = continueFromAuthor(update.before.sourceDocument!, update.before.document, update.author.document, update.choices, update.before.localFields);
      await accept(next.document, update.guard, update.author.document, next.localFields, controller.signal);
      dismissSource(); message(`已接续作者版 ${update.author.id}；本地调整和观看位置已保留。`);
    } finally { sourceAbort = undefined; }
  });
};
$("play").onclick = () => { if (!session) return; if (session.getState().paused) session.play(); else session.pause(); persist(); };
time.oninput = () => session?.seek(Number(time.value)); time.onchange = persist;
$("cover").onclick = () => run(() => localEdit("/assets/field-notes/contentVersion", doc => {
  const asset = doc.assets.find(a => a.id === "field-notes")!;
  asset.contentVersion = version(asset.contentVersion === version(2, "cover.png") ? 1 : 2, "cover.png");
}));
$("view").onclick = () => run(() => localEdit("/expressions/paper-theatre/scene/camera", doc => {
  scene(doc).camera = scene(doc).camera === "FrontCamera" ? (sourceDocument ? scene(sourceDocument).camera : "RevealCamera") : "FrontCamera";
}));
$("retime").onclick = () => run(() => localEdit("/expressions/paper-theatre/scene/timing", doc => {
  const current = scene(doc), baseline = sourceDocument && scene(sourceDocument);
  const adjusted = baseline && (localFields.includes("/expressions/paper-theatre/scene/timing") || current.frameCount !== baseline.frameCount || current.timebase.numerator !== baseline.timebase.numerator || current.timebase.denominator !== baseline.timebase.denominator);
  if (adjusted) { current.frameCount = baseline.frameCount; current.timebase = structuredClone(baseline.timebase); }
  else { current.frameCount = 144; current.timebase = { numerator: 24, denominator: 1 }; }
}));
$("undo").onclick = () => run(async () => {
  const previous = history.at(-1)!;
  await session!.revise(previous.document, session!.getState().guard);
  sourceDocument = previous.sourceDocument && structuredClone(previous.sourceDocument); localFields = [...(previous.localFields ?? [])]; history.pop();
  message("已恢复上一步作品及作者基线。");
});
$("png").onclick = () => run(async () => { download(await session!.exportPng(), "field-notes.png"); message("画面已保存。"); });
$("save").onclick = () => run(async () => {
  download(new Blob([JSON.stringify(encodedWork(), null, 2)], { type: "application/json" }), "field-notes.worldbend.json");
  message("已保存作品、作者基线和撤销记录；素材随完整作品包保留。");
});
async function readSnapshot(value: Snapshot, legacy = false): Promise<Snapshot> {
  const doc = legacy && !(value as Snapshot).document ? value as unknown as SpatialDocumentSpec : value.document;
  await inspectSpatialDocument(doc);
  let source = value.sourceDocument;
  if (source) {
    const inspected = await inspectSpatialDocument(source);
    const known = authors.find(a => a.fingerprint === inspected.fingerprint);
    if (!known) throw Error("作品的作者基线不在此作品包内，请打开对应的完整作品包。");
    source = known.document;
  } else if (legacy) source = inferSource(doc);
  const inferred = source ? continueFromAuthor(source, doc, source) : undefined;
  const legacyChoices = legacy && source ? [
    "/assets/field-notes/contentVersion", "/expressions/paper-theatre/scene/camera", "/expressions/paper-theatre/scene/timing",
  ] : [];
  const fields = value.localFields ?? [...new Set([...(inferred?.localFields ?? []), ...legacyChoices])];
  if (!Array.isArray(fields) || fields.length > 256 || new Set(fields).size !== fields.length ||
      fields.some((path: unknown) => typeof path !== "string" || !inferred?.paths.includes(path)))
    throw Error("作品的本地调整记录无效。");
  return { document: doc, sourceDocument: source, localFields: fields };
}
async function readSaved(value: any) {
  const canonical = value?.schema === "worldbend.spatial-document";
  const legacy = canonical || value?.schema === "worldbend.paper-theatre-file" && value.version === "0.1" ||
    value?.schema === undefined && value?.version === undefined && !!value?.document;
  if (!legacy && (value?.schema !== "worldbend.paper-theatre-file" || value.version !== "0.2"))
    throw Error("作品保存格式或版本不支持；原文件未改动。");
  const current = await readSnapshot(canonical ? { document: value } : value, legacy);
  const ms = value.timeMs ?? 1625;
  if (!Number.isFinite(ms) || ms < 0) throw Error("作品观看时间无效。");
  if (value.history !== undefined && (!Array.isArray(value.history) || value.history.length > 20)) throw Error("作品撤销记录无效。");
  const steps = await Promise.all((value.history ?? []).map((s: Snapshot) => readSnapshot(s, legacy)));
  return { current, timeMs: ms, history: steps, legacy };
}
async function openSaved(value: any) {
  const saved = await readSaved(value);
  await open(saved.current.document, saved.timeMs, saved.current.sourceDocument);
  localFields = [...(saved.current.localFields ?? [])];
  history = saved.history;
  updateContent();
  if (saved.legacy) message("已按当前作品包建立接续基线；旧作品现有设置保留为本地版本。");
}
$<HTMLInputElement>("open").onchange = event => {
  const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
  if (file) void run(async () => {
    if (file.size > 8 * 1024 * 1024) throw Error("作品文件过大。");
    await openSaved(JSON.parse(await file.text()));
  });
  input.value = "";
};
$("record").onclick = () => { if (recoveryRecord) download(new Blob([recoveryRecord], { type: "application/json" }), "field-notes.recovery.json"); };
$("retry").onclick = () => { if (retry) void run(retry); };
addEventListener("pagehide", () => { persist(); session?.destroy(); });
await run(async () => {
  await loadProject(); let original: string | null = null;
  try { recoveryRecord = localStorage.getItem(storageKey + ".recovery") ?? undefined; original = localStorage.getItem(storageKey); } catch {}
  $("record").hidden = !recoveryRecord;
  if (original) {
    try { await openSaved(JSON.parse(original)); return; }
    catch {
      recoveryRecord = original; $("record").hidden = false;
      try { localStorage.setItem(storageKey + ".recovery", original); } catch { preserveOriginal = true; }
      await open(initial); message("上次作品未能打开，原记录已保留；现在展示原始版。", true); return;
    }
  }
  await open(initial);
});
// Real carrier handles for composed checks; no competing rendering state.
Object.assign(globalThis, { worldbendSceneExample: {
  getSession: () => session, open, openSaved, resolveAsset, getInitial: () => initial,
  getAssetIndex: () => structuredClone(refs), getSaved: () => structuredClone(encodedWork()),
} });

import type { NativeRenderer } from "./native-projective";

const MAX_TRACKS = 256;
const MAX_KEYFRAMES = 4096;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface StoredTrack {
  field: KeyframeField;
  track: ManualKeyframeBinding;
}

export interface NativeMotionSnapshot {
  tracks: StoredTrack[];
  styles: AppliedAnimationStyle[];
  timelineDuration?: number;
}

export interface NativeMotionCapture {
  snapshot?: NativeMotionSnapshot;
  validate(): void;
}

export interface NativeMotionGeometry {
  source: { width: number; height: number };
  surface: { width: number; height: number };
}

type MotionFrame = FrameNode & {
  applyManualKeyframeTrack(field: KeyframeField, track: ManualKeyframeTrackInput): void;
};

function hasMotion(node: FrameNode): node is MotionFrame {
  return typeof (node as MotionFrame).applyManualKeyframeTrack === "function";
}

function motionState(node: MotionFrame): string {
  return JSON.stringify({
    tracks: node.manualKeyframeTracks,
    styles: node.animationStyles,
    timelines: node.timelines,
  });
}

function addTrack(output: StoredTrack[], field: KeyframeField, track: ManualKeyframeBinding): void {
  output.push({ field: copy(field), track: copy(track) });
  if (output.length > MAX_TRACKS) throw Error(`Native Motion exceeds ${MAX_TRACKS} tracks`);
  const keyframes = output.reduce((sum, entry) => sum + entry.track.keyframes.length, 0);
  if (keyframes > MAX_KEYFRAMES) throw Error(`Native Motion exceeds ${MAX_KEYFRAMES} keyframes`);
}

function flattenTracks(tracks: ManualKeyframeTracks): StoredTrack[] {
  const output: StoredTrack[] = [];
  for (const [name, track] of Object.entries(tracks)) {
    if (name === "fills" || name === "strokes" || name === "effects") continue;
    addTrack(output, { type: "PROPERTY", name: name as KeyframePropertyFieldName }, track as ManualKeyframeBinding);
  }
  for (const collection of ["fills", "strokes"] as const) {
    for (const [indexText, item] of Object.entries(tracks[collection] ?? {})) {
      if (!item) continue;
      const index = Number(indexText);
      if (!Number.isInteger(index) || index < 0) throw Error("Invalid native Motion paint track");
      if ("keyframes" in item) addTrack(output, { type: "INDEXED_ITEM", collection, index }, item);
      else for (const [propertyId, track] of Object.entries(item.properties ?? {})) {
        if (track) addTrack(output, { type: "INDEXED_ITEM", collection, index, propertyId }, track);
      }
    }
  }
  for (const [indexText, item] of Object.entries(tracks.effects ?? {})) {
    if (!item) continue;
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0) throw Error("Invalid native Motion effect track");
    for (const [name, track] of Object.entries(item)) {
      if (name === "properties") continue;
      addTrack(output, { type: "INDEXED_ITEM", collection: "effects", index,
        field: name as EffectKeyframeFieldName }, track as ManualKeyframeBinding);
    }
    for (const [propertyId, track] of Object.entries(item.properties ?? {})) {
      if (track) addTrack(output, { type: "INDEXED_ITEM", collection: "effects", index, propertyId }, track);
    }
  }
  return output;
}

function readSnapshot(node: MotionFrame): NativeMotionSnapshot | undefined {
  const tracks = flattenTracks(node.manualKeyframeTracks ?? {});
  const styles = copy(node.animationStyles ?? []);
  if (styles.length > MAX_TRACKS) throw Error(`Native Motion exceeds ${MAX_TRACKS} styles`);
  const timelines = node.timelines ?? [];
  if (timelines.length > 1) throw Error("Native Motion has more than one containing timeline");
  const timelineDuration = timelines[0]?.duration;
  if (timelineDuration !== undefined && (!Number.isFinite(timelineDuration) || timelineDuration <= 0)) {
    throw Error("Native Motion timeline duration is invalid");
  }
  return tracks.length || styles.length ? { tracks, styles, ...(timelineDuration !== undefined ? { timelineDuration } : {}) } : undefined;
}

/** Capture one node's native Motion as an exact optimistic-concurrency proof.
 * Hosts without the Motion API retain the static path; partially exposed Motion
 * must be readable before a replacement can proceed. */
export function captureNativeMotion(node: FrameNode): NativeMotionCapture {
  if (!hasMotion(node)) return { validate() {} };
  try {
    const expected = motionState(node);
    const snapshot = readSnapshot(node);
    return { ...(snapshot ? { snapshot } : {}), validate() {
      if (!hasMotion(node) || motionState(node) !== expected) throw Error("Native Motion changed. Retry the update.");
    } };
  } catch (error) {
    // The host can expose the write method while refusing the read. Treating
    // that as an empty snapshot would retire a surface with unknown tracks.
    if (String(error).includes("not a supported API")) {
      throw Error("Native Motion state is unavailable in this Figma host. Retry the update in a host that can read Motion tracks.");
    }
    throw error;
  }
}

function shaderTrack(field: KeyframeField): field is Extract<KeyframeField,
  { type: "INDEXED_ITEM"; collection: "effects"; propertyId: string }> {
  return field.type === "INDEXED_ITEM" && field.collection === "effects" && "propertyId" in field;
}

/** Validate the resting projective state when Figma has moved keyed shader
 * properties out of Effect.properties and into Motion track base values. */
export function validateProjectiveMotionBase(surface: FrameNode, recorded: Record<string, number>): void {
  const effect = surface.effects[0];
  if (!effect || effect.type !== "SHADER" || !effect.properties) throw Error("Native projection effect changed");
  const staticProperties = effect.properties as Record<string, unknown>;
  const allowed = new Set(Object.keys(recorded));
  if (Object.keys(staticProperties).some(id => !allowed.has(id))) throw Error("Native projection effect changed");
  const motion = captureNativeMotion(surface).snapshot;
  const keyed = new Map<string, number>();
  for (const entry of motion?.tracks ?? []) if (entry.field.type === "INDEXED_ITEM" && entry.field.collection === "effects") {
    if (!shaderTrack(entry.field) || entry.field.index !== 0 || !allowed.has(entry.field.propertyId) ||
      entry.track.baseValue.type !== "FLOAT" || !Number.isFinite(entry.track.baseValue.value) || keyed.has(entry.field.propertyId)) {
        throw Error("Native projection Motion changed");
    }
    keyed.set(entry.field.propertyId, entry.track.baseValue.value);
  }
  for (const [id, saved] of Object.entries(recorded)) {
    const staticValue = staticProperties[id];
    const keyedValue = keyed.get(id);
    if (keyedValue !== undefined && keyedValue !== saved) throw Error("Native projection Motion base changed");
    if (staticValue !== undefined && (typeof staticValue !== "number" || staticValue !== Math.fround(saved))) {
      throw Error("Native projection effect changed");
    }
    if (staticValue === undefined && keyedValue === undefined) throw Error("Native projection effect changed");
  }
}

function rendererIds(renderer: NativeRenderer): string[] {
  return [...renderer.propertyIds, ...renderer.extentPropertyIds];
}

function inputTrack(track: ManualKeyframeBinding, baseValue = track.baseValue): ManualKeyframeTrackInput {
  return { baseValue: copy(baseValue), keyframes: track.keyframes.map(({ timelinePosition, easing, value }) => ({
    timelinePosition, easing: copy(easing), value: copy(value),
  })) };
}

interface MotionApiHost {
  readonly motion?: { readonly playheadPosition: number | undefined };
}

/** Read the host-owned playhead without manufacturing a Worldbend time value.
 * Older hosts expose the beta namespace but throw when its property is read. */
export function readNativeMotionPlayhead(host: MotionApiHost): number | undefined {
  try {
    const value = host.motion?.playheadPosition;
    return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
  } catch (error) {
    if (String(error).includes("not a supported API")) return undefined;
    throw error;
  }
}

/** Replay semantic native Motion on a replacement surface. Shader fields are
 * remapped by Worldbend's ordered renderer contract and their resting values
 * are rebased to the newly published Perspective; authored keyframes remain. */
export function restoreNativeMotion(
  node: FrameNode,
  snapshot: NativeMotionSnapshot | undefined,
  oldRenderer: NativeRenderer | undefined,
  newRenderer: NativeRenderer | undefined,
  newProperties: Record<string, number> | undefined,
  shaderValuesCompatible = true,
): void {
  if (!snapshot) return;
  if (!hasMotion(node)) throw Error("Native Motion is unavailable; the authored tracks were not changed");
  const oldIds = oldRenderer ? rendererIds(oldRenderer) : [];
  const nextIds = newRenderer ? rendererIds(newRenderer) : [];
  const remap = new Map(oldIds.map((id, index) => [id, nextIds[index]]));
  for (const style of snapshot.styles) {
    if (style.type === "CUSTOM") {
      node.applyAnimationStyle(style.styleId, {
        type: "CUSTOM",
        ...(style.timelineOffset !== undefined ? { timelineOffset: style.timelineOffset } : {}),
      });
      continue;
    }
    node.applyAnimationStyle(style.styleId, {
      ...(style.duration !== undefined ? { duration: style.duration } : {}),
      ...(style.timelineOffset !== undefined ? { timelineOffset: style.timelineOffset } : {}),
      ...(style.props !== undefined ? { props: copy(style.props) } : {}),
    });
  }
  for (const entry of snapshot.tracks) {
    let field = entry.field;
    let baseValue = entry.track.baseValue;
    if (shaderTrack(field)) {
      if (!shaderValuesCompatible) throw Error("Native projection Motion needs matching source and surface dimensions");
      if (oldIds.length !== 11 || nextIds.length !== 11) throw Error("Native projection Motion renderer mapping is unavailable");
      if (field.index !== 0) throw Error("Native projection Motion targets an unavailable effect");
      const propertyId = remap.get(field.propertyId);
      const value = propertyId === undefined ? undefined : newProperties?.[propertyId];
      if (!propertyId || value === undefined || !Number.isFinite(value)) {
        throw Error("Native projection Motion property could not be remapped");
      }
      field = { ...field, propertyId };
      baseValue = { type: "FLOAT", value };
    }
    node.applyManualKeyframeTrack(field, inputTrack(entry.track, baseValue));
  }
  if (snapshot.timelineDuration !== undefined) {
    const timeline = node.timelines[0];
    if (!timeline) throw Error("Native Motion timeline is unavailable after surface replacement");
    if (timeline.duration < snapshot.timelineDuration) node.setTimelineDuration(timeline.id, snapshot.timelineDuration);
  }
}

/** A v0.3 record is written with nine matrix fields followed by two source
 * extents. That stable order lets an older keyed surface map to a repaired
 * renderer without making raw property ids part of product semantics. */
export function recordedRenderer(shaderId: string, properties: Record<string, number>): NativeRenderer | undefined {
  const ids = Object.keys(properties);
  return ids.length === 11 ? { id: shaderId, propertyIds: ids.slice(0, 9), extentPropertyIds: ids.slice(9) as [string, string] } : undefined;
}

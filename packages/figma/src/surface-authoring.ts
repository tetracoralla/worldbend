import type {
  DeformationAnchor,
  DeformationStroke,
  Point,
  StrokeSample,
  WarpMesh,
} from "@worldbend/web/types";

export type EnvelopePointRole = "boundary" | "curve" | "handle";

export const MAX_SURFACE_ANCHORS = 64;
const MAX_STROKES = 64;
const MAX_SAMPLES_PER_STROKE = 256;
const MAX_SAMPLES = 1024;

export function envelopePointRole(
  columns: number,
  rows: number,
  index: number,
): EnvelopePointRole {
  const controlColumns = columns * 3 + 1;
  const controlRows = rows * 3 + 1;
  const column = index % controlColumns;
  const row = Math.floor(index / controlColumns);
  if (column === 0 || row === 0 || column + 1 === controlColumns || row + 1 === controlRows) {
    return "boundary";
  }
  return column % 3 === 0 || row % 3 === 0 ? "curve" : "handle";
}

export function toggleInteriorAnchor(
  anchors: readonly DeformationAnchor[],
  column: number,
  row: number,
  subdivisions: number,
): DeformationAnchor[] {
  if (column <= 0 || row <= 0 || column >= subdivisions || row >= subdivisions) return [...anchors];
  const existing = anchors.find((anchor) => anchor.column === column && anchor.row === row);
  if (existing) return anchors.filter((anchor) => anchor.id !== existing.id);
  if (anchors.length >= MAX_SURFACE_ANCHORS) return [...anchors];
  const base = `pin-${column}-${row}`;
  let id = base;
  for (let suffix = 2; anchors.some(anchor => anchor.id === id); suffix += 1) id = `${base}-${suffix}`;
  return [...anchors, { id, column, row }];
}

/** A density change may keep a pin only at its exact original source point. */
export function anchorsForSubdivisions(anchors: readonly DeformationAnchor[], previous: number, next: number): DeformationAnchor[] | undefined {
  const remapped = anchors.map(anchor => ({ ...anchor, column: anchor.column * next / previous, row: anchor.row * next / previous }));
  return remapped.every(anchor => Number.isInteger(anchor.column) && Number.isInteger(anchor.row)) ? remapped : undefined;
}

export function sourceUvFromWarped(mesh: WarpMesh, warped: Point): Point | undefined {
  return mapMesh(mesh, warped, true);
}

/** Display the brush footprint through the same piecewise-linear core mesh. */
export function warpedFromSource(mesh: WarpMesh, source: Point): Point | undefined {
  return mapMesh(mesh, source, false);
}

function mapMesh(mesh: WarpMesh, point: Point, inverse: boolean): Point | undefined {
  const side = mesh.subdivisions + 1;
  for (let row = 0; row < mesh.subdivisions; row += 1) {
    for (let column = 0; column < mesh.subdivisions; column += 1) {
      const tl = mesh.vertices[row * side + column];
      const tr = mesh.vertices[row * side + column + 1];
      const bl = mesh.vertices[(row + 1) * side + column];
      const br = mesh.vertices[(row + 1) * side + column + 1];
      if (!tl || !tr || !bl || !br) continue;
      const hit = hitTriangle(point, tl, tr, br, inverse) ?? hitTriangle(point, tl, br, bl, inverse);
      if (hit) return hit;
    }
  }
  return undefined;
}

export function strokeSample(
  position: Point,
  previous: Point | undefined,
  radius: number,
  strength: number,
): StrokeSample {
  const delta = previous
    ? {
        x: clamp(position.x - previous.x, -1, 1),
        y: clamp(position.y - previous.y, -1, 1),
      }
    : { x: 0, y: 0 };
  return {
    position: {
      x: clamp(position.x, 0, 1),
      y: clamp(position.y, 0, 1),
    },
    delta,
    radius: clamp(radius, 0.001, 2),
    strength: clamp(strength, 0, 1),
  };
}

/** Which closed capacity, if any, blocks appending a sample to this stroke. */
export function strokeAppendLimit(
  strokes: readonly DeformationStroke[],
  strokeId: string,
): "none" | "samples" | "strokes" | "stroke" {
  const total = strokes.reduce((sum, stroke) => sum + stroke.samples.length, 0);
  if (total >= MAX_SAMPLES) return "samples";
  const index = strokes.findIndex((stroke) => stroke.id === strokeId);
  if (index < 0) return strokes.length >= MAX_STROKES ? "strokes" : "none";
  const current = strokes[index];
  return current && current.samples.length >= MAX_SAMPLES_PER_STROKE ? "stroke" : "none";
}

export function appendStrokeSample(
  strokes: readonly DeformationStroke[],
  strokeId: string,
  sample: StrokeSample,
): DeformationStroke[] | undefined {
  if (strokeAppendLimit(strokes, strokeId) !== "none") return undefined;
  const index = strokes.findIndex((stroke) => stroke.id === strokeId);
  if (index < 0) {
    return [...strokes, { id: strokeId, samples: [sample] }];
  }
  const current = strokes[index]!;
  const next = [...strokes];
  next[index] = { ...current, samples: [...current.samples, sample] };
  return next;
}

export function nextStrokeId(strokes: readonly DeformationStroke[]): string | undefined {
  if (strokes.length >= MAX_STROKES) return undefined;
  let number = 1;
  while (strokes.some(stroke => stroke.id === `stroke-${number}`)) number += 1;
  return `stroke-${number}`;
}

function hitTriangle(
  point: Point,
  a: { source: Point; warped: Point },
  b: { source: Point; warped: Point },
  c: { source: Point; warped: Point },
  inverse: boolean,
): Point | undefined {
  const from = inverse ? "warped" : "source";
  const to = inverse ? "source" : "warped";
  const weights = barycentric(point, a[from], b[from], c[from]);
  if (!weights) return undefined;
  return {
    x: a[to].x * weights[0] + b[to].x * weights[1] + c[to].x * weights[2],
    y: a[to].y * weights[0] + b[to].y * weights[1] + c[to].y * weights[2],
  };
}

function barycentric(
  point: Point,
  a: Point,
  b: Point,
  c: Point,
): [number, number, number] | undefined {
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-12) return undefined;
  const wA = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / det;
  const wB = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / det;
  const wC = 1 - wA - wB;
  if (wA < -1e-9 || wB < -1e-9 || wC < -1e-9) return undefined;
  return [wA, wB, wC];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

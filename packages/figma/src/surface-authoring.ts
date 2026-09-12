import type {
  DeformationAnchor,
  DeformationStroke,
  Point,
  StrokeSample,
  WarpMesh,
} from "@worldbend/web/types";

export type EnvelopePointRole = "boundary" | "curve" | "handle";

const MAX_ANCHORS = 64;
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
  if (anchors.length >= MAX_ANCHORS) return [...anchors];
  return [...anchors, { id: `pin-${column}-${row}`, column, row }];
}

export function sourceUvFromWarped(mesh: WarpMesh, warped: Point): Point | undefined {
  const side = mesh.subdivisions + 1;
  for (let row = 0; row < mesh.subdivisions; row += 1) {
    for (let column = 0; column < mesh.subdivisions; column += 1) {
      const tl = mesh.vertices[row * side + column];
      const tr = mesh.vertices[row * side + column + 1];
      const bl = mesh.vertices[(row + 1) * side + column];
      const br = mesh.vertices[(row + 1) * side + column + 1];
      if (!tl || !tr || !bl || !br) continue;
      const hit = hitTriangle(warped, tl, tr, br) ?? hitTriangle(warped, tl, br, bl);
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

export function appendStrokeSample(
  strokes: readonly DeformationStroke[],
  strokeId: string,
  sample: StrokeSample,
): DeformationStroke[] | undefined {
  const total = strokes.reduce((sum, stroke) => sum + stroke.samples.length, 0);
  if (total >= MAX_SAMPLES) return undefined;
  const index = strokes.findIndex((stroke) => stroke.id === strokeId);
  if (index < 0) {
    if (strokes.length >= MAX_STROKES) return undefined;
    return [...strokes, { id: strokeId, samples: [sample] }];
  }
  const current = strokes[index];
  if (!current || current.samples.length >= MAX_SAMPLES_PER_STROKE) return undefined;
  const next = [...strokes];
  next[index] = { ...current, samples: [...current.samples, sample] };
  return next;
}

export function nextStrokeId(strokes: readonly DeformationStroke[]): string | undefined {
  if (strokes.length >= MAX_STROKES) return undefined;
  return `stroke-${strokes.length + 1}`;
}

function hitTriangle(
  point: Point,
  a: { source: Point; warped: Point },
  b: { source: Point; warped: Point },
  c: { source: Point; warped: Point },
): Point | undefined {
  const weights = barycentric(point, a.warped, b.warped, c.warped);
  if (!weights) return undefined;
  return {
    x: a.source.x * weights[0] + b.source.x * weights[1] + c.source.x * weights[2],
    y: a.source.y * weights[0] + b.source.y * weights[1] + c.source.y * weights[2],
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

export interface DocumentPoint {
  x: number;
  y: number;
}

export interface DocumentQuad {
  tl: DocumentPoint;
  tr: DocumentPoint;
  br: DocumentPoint;
  bl: DocumentPoint;
}

interface VectorPoint extends DocumentPoint {}
interface VectorSegmentLike {
  start: number;
  end: number;
  tangentStart?: VectorPoint;
  tangentEnd?: VectorPoint;
}
interface VectorSourceLike {
  type: "VECTOR";
  vectorNetwork: {
    vertices: readonly VectorPoint[];
    segments: readonly VectorSegmentLike[];
  };
  absoluteTransform: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ];
}

/**
 * Read a simple straight four-corner Vector as an explicit Figma-canvas guide.
 * Complex paths stay ordinary artwork instead of being guessed into a target.
 */
export function documentQuadForSource(source: unknown): DocumentQuad | undefined {
  if (!isVectorSource(source)) return undefined;
  const network = source.vectorNetwork;
  if (network.vertices.length !== 4 || network.segments.length !== 4) return undefined;

  const degree = [0, 0, 0, 0];
  const edges = new Set<string>();
  for (const segment of network.segments) {
    if (!isVertexIndex(segment.start) || !isVertexIndex(segment.end) || segment.start === segment.end) return undefined;
    if (!isStraight(segment.tangentStart) || !isStraight(segment.tangentEnd)) return undefined;
    degree[segment.start] = (degree[segment.start] ?? 0) + 1;
    degree[segment.end] = (degree[segment.end] ?? 0) + 1;
    edges.add(edgeKey(segment.start, segment.end));
  }
  if (edges.size !== 4 || degree.some((value) => value !== 2)) return undefined;

  const transform = source.absoluteTransform;
  const points = network.vertices.map((point) => ({
    x: transform[0][0] * point.x + transform[0][1] * point.y + transform[0][2],
    y: transform[1][0] * point.x + transform[1][1] * point.y + transform[1][2],
  }));
  if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return undefined;
  const order = quadOrder(points, edges);
  if (!order) return undefined;
  const ordered = order.map((index) => points[index]!);

  return { tl: ordered[0]!, tr: ordered[1]!, br: ordered[2]!, bl: ordered[3]! };
}

/** Prefer visible document-space corner roles. For an exact diamond, where
 * axis extrema cannot name four distinct corners, use its connected clockwise
 * perimeter beginning at the topmost, then leftmost, vertex. */
function quadOrder(points: readonly DocumentPoint[], edges: ReadonlySet<string>): number[] | undefined {
  const tl = uniqueExtreme(points, (point) => point.x + point.y, "min");
  const br = uniqueExtreme(points, (point) => point.x + point.y, "max");
  const tr = uniqueExtreme(points, (point) => point.x - point.y, "max");
  const bl = uniqueExtreme(points, (point) => point.x - point.y, "min");
  if (tl !== undefined && tr !== undefined && br !== undefined && bl !== undefined &&
    new Set([tl, tr, br, bl]).size === 4) {
    const order = [tl, tr, br, bl];
    if (perimeterMatches(order, edges) && convexOrientation(order.map((index) => points[index]!)) > 0) {
      return order;
    }
  }

  const adjacency = points.map((_point, index) => [...edges]
    .map((edge) => edge.split(":").map(Number) as [number, number])
    .filter(([first, second]) => first === index || second === index)
    .map(([first, second]) => first === index ? second : first));
  if (adjacency.some((neighbors) => neighbors.length !== 2)) return undefined;
  const start = points.map((point, index) => ({ point, index }))
    .sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x)[0]?.index;
  if (start === undefined) return undefined;
  for (const neighbor of adjacency[start]!) {
    const order = connectedCycle(start, neighbor, adjacency);
    if (order && convexOrientation(order.map((index) => points[index]!)) > 0) return order;
  }
  return undefined;
}

function connectedCycle(start: number, next: number, adjacency: readonly number[][]): number[] | undefined {
  const order = [start];
  let previous = start;
  let current = next;
  while (current !== start && order.length <= adjacency.length) {
    if (order.includes(current)) return undefined;
    order.push(current);
    const following = adjacency[current]?.find((candidate) => candidate !== previous);
    if (following === undefined) return undefined;
    previous = current;
    current = following;
  }
  return current === start && order.length === adjacency.length ? order : undefined;
}

function perimeterMatches(order: readonly number[], edges: ReadonlySet<string>): boolean {
  return order.every((point, index) => edges.has(edgeKey(point, order[(index + 1) % order.length]!)));
}

/** 1 is clockwise in screen coordinates, -1 is mirrored, and 0 is invalid. */
function convexOrientation(points: readonly DocumentPoint[]): -1 | 0 | 1 {
  const turns = points.map((point, index) => cross(
    point,
    points[(index + 1) % points.length]!,
    points[(index + 2) % points.length]!,
  ));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const scale = Math.max(1, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const tolerance = Number.EPSILON * 128 * scale * scale;
  if (turns.some((value) => !Number.isFinite(value) || Math.abs(value) <= tolerance)) return 0;
  if (turns.every((value) => value > tolerance)) return 1;
  if (turns.every((value) => value < -tolerance)) return -1;
  return 0;
}

function isVertexIndex(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < 4;
}

function isStraight(value: VectorPoint | undefined): boolean {
  return value === undefined || (value.x === 0 && value.y === 0);
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`;
}

function uniqueExtreme(
  points: readonly DocumentPoint[],
  score: (point: DocumentPoint) => number,
  direction: "min" | "max",
): number | undefined {
  const values = points.map(score);
  const extreme = direction === "min" ? Math.min(...values) : Math.max(...values);
  const scale = Math.max(1, ...values.map((value) => Math.abs(value)));
  const tolerance = Number.EPSILON * 128 * scale;
  const matches = values.map((value, index) => ({ value, index }))
    .filter(({ value }) => Math.abs(value - extreme) <= tolerance);
  return matches.length === 1 ? matches[0]!.index : undefined;
}

function cross(a: DocumentPoint, b: DocumentPoint, c: DocumentPoint): number {
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
}

function isVectorSource(value: unknown): value is VectorSourceLike {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["type"] !== "VECTOR" || typeof record["vectorNetwork"] !== "object" ||
    record["vectorNetwork"] === null || !Array.isArray(record["absoluteTransform"])) return false;
  const network = record["vectorNetwork"] as Record<string, unknown>;
  const transform = record["absoluteTransform"];
  return Array.isArray(network["vertices"]) && Array.isArray(network["segments"]) &&
    transform.length === 2 && transform.every((row) => Array.isArray(row) && row.length === 3 &&
      row.every((item) => typeof item === "number" && Number.isFinite(item)));
}

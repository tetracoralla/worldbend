import type { BezierEnvelope, Point } from "@worldbend/web";

/** Rewrite cubic control data at a different patch density. Splitting is exact;
 * removing a split is allowed only when its curves can still be represented.
 * The canonical planner remains responsible for geometry and topology checks. */
export function resampleEnvelope(envelope: BezierEnvelope, columns: number, rows: number): BezierEnvelope {
  if (columns === envelope.columns && rows === envelope.rows) return envelope;
  const oldWidth = envelope.columns * 3 + 1;
  const oldHeight = envelope.rows * 3 + 1;
  const width = columns * 3 + 1;
  const height = rows * 3 + 1;
  const horizontal = Array.from({ length: oldHeight }, (_, row) =>
    resampleCurve(envelope.points.slice(row * oldWidth, (row + 1) * oldWidth), columns));
  const vertical = Array.from({ length: width }, (_, column) =>
    resampleCurve(horizontal.map(row => row[column]!), rows));
  const points = Array.from({ length: width * height }, (_, index) => vertical[index % width]![Math.floor(index / width)]!);
  return { columns, rows, points: points as BezierEnvelope["points"] };
}

function resampleCurve(points: readonly Point[], count: number): Point[] {
  const previous = (points.length - 1) / 3;
  const result: Point[] = [];
  for (let segment = 0; segment < count; segment += 1) {
    const start = endpoint(points, previous, segment / count, false);
    const end = endpoint(points, previous, (segment + 1) / count, true);
    if (segment === 0) result.push(start.point);
    result.push(
      add(start.point, start.derivative, 1 / (3 * count)),
      add(end.point, end.derivative, -1 / (3 * count)),
      end.point,
    );
  }
  // On each interval of the union partition, both curves are cubic. Four
  // distinct evaluations establish equality and reject a lossy merge.
  const breaks = [...new Set([
    ...Array.from({ length: previous + 1 }, (_, i) => i / previous),
    ...Array.from({ length: count + 1 }, (_, i) => i / count),
  ])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < breaks.length; i += 1) {
    for (const fraction of [0, 1 / 3, 2 / 3, 1]) {
      const t = breaks[i]! + (breaks[i + 1]! - breaks[i]!) * fraction;
      const a = endpoint(points, previous, t, t === 1).point;
      const b = endpoint(result, count, t, t === 1).point;
      if (Math.abs(a.x - b.x) > 1e-9 || Math.abs(a.y - b.y) > 1e-9) {
        throw new Error("The current curves need these splits");
      }
    }
  }
  return result;
}

function endpoint(points: readonly Point[], count: number, t: number, fromLeft: boolean) {
  const scaled = t * count;
  const segment = Math.min(count - 1, Math.max(0, fromLeft ? Math.ceil(scaled) - 1 : Math.floor(scaled)));
  const u = scaled - segment, v = 1 - u;
  const [a, b, c, d] = points.slice(segment * 3, segment * 3 + 4) as [Point, Point, Point, Point];
  const at = (key: "x" | "y") => v ** 3 * a[key] + 3 * v ** 2 * u * b[key] + 3 * v * u ** 2 * c[key] + u ** 3 * d[key];
  const derivative = (key: "x" | "y") => 3 * count * (
    v ** 2 * (b[key] - a[key]) + 2 * v * u * (c[key] - b[key]) + u ** 2 * (d[key] - c[key]));
  return { point: { x: at("x"), y: at("y") }, derivative: { x: derivative("x"), y: derivative("y") } };
}

function add(point: Point, delta: Point, scale: number): Point {
  return { x: point.x + delta.x * scale, y: point.y + delta.y * scale };
}

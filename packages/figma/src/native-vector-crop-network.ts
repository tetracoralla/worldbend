type Point = { x: number; y: number };
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

function extrema([p0, p1, p2, p3]: number[]): number[] {
  const a = -p0! + 3 * p1! - 3 * p2! + p3!, b = 2 * (p0! - 2 * p1! + p2!), c = p1! - p0!;
  const epsilon = Number.EPSILON * 16 * Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1);
  if (Math.abs(a) <= epsilon) return Math.abs(b) > epsilon ? [-c / b] : [];
  const d = b * b - 4 * a * c;
  return d < 0 ? [] : [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)];
}

/** Lossless preparation for native Boolean cropping. Some host intersections
 * retain a cubic whose endpoints fit the mask while its bow crosses it.
 * Expose curve extrema and a midpoint as native anchors before intersection;
 * the host still owns the crop and the core still owns projected geometry.
 * This is subdivision, never polyline approximation or a containment proof. */
export function nativeCropNetwork(network: VectorNetwork): VectorNetwork {
  if (network.vertices.length > 8192 || network.segments.length > 16384) throw Error("E_FIGMA_LIMIT: native crop network exceeds its geometry budget");
  const vertices: VectorVertex[] = network.vertices.map(vertex => ({ ...vertex }));
  const segments: VectorSegment[] = [], replacements: number[][] = [];
  for (const segment of network.segments) {
    if (![segment.tangentStart?.x, segment.tangentStart?.y, segment.tangentEnd?.x, segment.tangentEnd?.y].some(v => v)) {
      replacements.push([segments.length]); segments.push({ ...segment }); continue;
    }
    const start = vertices[segment.start]!, end = vertices[segment.end]!;
    let control = [start, { x: start.x + (segment.tangentStart?.x ?? 0), y: start.y + (segment.tangentStart?.y ?? 0) },
      { x: end.x + (segment.tangentEnd?.x ?? 0), y: end.y + (segment.tangentEnd?.y ?? 0) }, end];
    const cuts = [...new Set([.5, ...extrema(control.map(p => p.x)), ...extrema(control.map(p => p.y))]
      .filter(t => Number.isFinite(t) && t > 1e-7 && t < 1 - 1e-7))].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1]! > 1e-7);
    const indices: number[] = [];
    let previous = 0, from = segment.start;
    for (const cut of [...cuts, 1]) {
      const t = (cut - previous) / (1 - previous), [p0, p1, p2, p3] = control as [Point, Point, Point, Point];
      const a = mix(p0, p1, t), b = mix(p1, p2, t), c = mix(p2, p3, t), d = mix(a, b, t), e = mix(b, c, t), point = mix(d, e, t);
      const to = cut === 1 ? segment.end : vertices.push(point) - 1;
      indices.push(segments.length);
      segments.push({ start: from, end: to, tangentStart: subtract(a, p0), tangentEnd: subtract(d, point) });
      if (vertices.length > 8192 || segments.length > 16384) throw Error("E_FIGMA_LIMIT: native crop network exceeds its geometry budget");
      control = [point, e, c, p3]; previous = cut; from = to;
    }
    replacements.push(indices);
  }
  let references = 0;
  const regions = network.regions?.map(region => ({ ...region, loops: region.loops.map(loop => {
    if (!loop.length) return [];
    // Follow the contour rather than inferring each direction from the prior
    // edge: two-edge loops share both endpoints and need a consistent walk.
    const walk = (start: number): number[] | undefined => {
      let vertex = start;
      const result: number[] = [];
      for (const index of loop) {
        const edge = network.segments[index], indices = replacements[index];
        if (!edge || !indices) return undefined;
        if (references + result.length + indices.length > 131072) throw Error("E_FIGMA_LIMIT: native crop network exceeds its reference budget");
        if (vertex === edge.start) { result.push(...indices); vertex = edge.end; }
        else if (vertex === edge.end) { result.push(...[...indices].reverse()); vertex = edge.start; }
        else return undefined;
      }
      return vertex === start ? result : undefined;
    };
    const first = network.segments[loop[0]!];
    const result = first && (walk(first.start) ?? walk(first.end));
    if (!result) throw Error("Invalid native crop contour");
    references += result.length;
    return result;
  }) }));
  return { vertices, segments, ...(regions ? { regions } : {}) };
}

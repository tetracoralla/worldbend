import type {
  Point,
  TransformSpec,
  Size,
  SolveOutput,
  WarpMesh,
  WarpVertex,
} from "./types";

const PERSPECTIVE_HEADROOM = 1.08;

type WarpTriangle = readonly [WarpVertex, WarpVertex, WarpVertex];

const unitVertices: readonly WarpVertex[] = [
  { source: { x: 0, y: 0 }, warped: { x: 0, y: 0 } },
  { source: { x: 1, y: 0 }, warped: { x: 1, y: 0 } },
  { source: { x: 1, y: 1 }, warped: { x: 1, y: 1 } },
  { source: { x: 0, y: 1 }, warped: { x: 0, y: 1 } },
];

/**
 * Estimate the source raster needed to give the final projective output about
 * one source texel per destination pixel in the most magnified region.
 * Geometry remains core-owned: this only plans an adapter export resolution.
 */
export function estimateSourceRasterSize(
  solved: SolveOutput,
  spec: TransformSpec,
  maximumAxis: number,
  warpMesh?: WarpMesh,
): Size {
  if (!Number.isFinite(maximumAxis) || maximumAxis < 1) {
    throw new Error("The source raster limit is invalid");
  }
  const hasWarp = spec.content.warp !== undefined && spec.content.warp.amount !== 0;
  if (hasWarp && !warpMesh) {
    throw new Error("The active Warp requires its core-owned mesh for source raster planning");
  }
  const matrix = solved.homography.matrix;
  let requiredWidth = 1;
  let requiredHeight = 1;
  for (const triangle of hasWarp ? warpTriangles(warpMesh!) : unitTriangles()) {
    const derivative = triangleWarpDerivative(triangle);
    const warped = triangle.map((vertex) => vertex.warped);
    requiredWidth = Math.max(
      requiredWidth,
      homographyDirectionalDerivativeBound(matrix, warped, derivative.du),
    );
    requiredHeight = Math.max(
      requiredHeight,
      homographyDirectionalDerivativeBound(matrix, warped, derivative.dv),
    );
  }
  const width = Math.max(1, Math.ceil(requiredWidth * PERSPECTIVE_HEADROOM));
  const height = Math.max(1, Math.ceil(requiredHeight * PERSPECTIVE_HEADROOM));
  const scale = Math.min(1, maximumAxis / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function unitTriangles(): WarpTriangle[] {
  return [
    [unitVertices[0]!, unitVertices[1]!, unitVertices[2]!],
    [unitVertices[0]!, unitVertices[2]!, unitVertices[3]!],
  ];
}

function warpTriangles(mesh: WarpMesh): WarpTriangle[] {
  const subdivisions = mesh.subdivisions;
  const side = subdivisions + 1;
  if (
    !Number.isInteger(subdivisions) ||
    subdivisions < 1 ||
    mesh.vertices.length !== side * side
  ) {
    throw new Error("The source raster planner received an invalid warp mesh");
  }
  const vertex = (x: number, y: number): WarpVertex => {
    const value = mesh.vertices[y * side + x];
    if (!value) throw new Error("The source raster planner received an incomplete warp mesh");
    if (
      value.source.x !== x / subdivisions ||
      value.source.y !== y / subdivisions ||
      !finitePoint(value.warped)
    ) {
      throw new Error("The source raster planner received an invalid core warp vertex");
    }
    return value;
  };
  const triangles: WarpTriangle[] = [];
  for (let y = 0; y < subdivisions; y += 1) {
    for (let x = 0; x < subdivisions; x += 1) {
      const tl = vertex(x, y);
      const tr = vertex(x + 1, y);
      const br = vertex(x + 1, y + 1);
      const bl = vertex(x, y + 1);
      triangles.push([tl, tr, br], [tl, br, bl]);
    }
  }
  return triangles;
}

function triangleWarpDerivative(triangle: WarpTriangle): { du: Point; dv: Point } {
  const [first, second, third] = triangle;
  const sourceU = {
    x: second.source.x - first.source.x,
    y: second.source.y - first.source.y,
  };
  const sourceV = {
    x: third.source.x - first.source.x,
    y: third.source.y - first.source.y,
  };
  const warpedU = {
    x: second.warped.x - first.warped.x,
    y: second.warped.y - first.warped.y,
  };
  const warpedV = {
    x: third.warped.x - first.warped.x,
    y: third.warped.y - first.warped.y,
  };
  const determinant = sourceU.x * sourceV.y - sourceV.x * sourceU.y;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error("The source raster planner received a degenerate warp source triangle");
  }
  return {
    du: {
      x: (warpedU.x * sourceV.y - warpedV.x * sourceU.y) / determinant,
      y: (warpedU.y * sourceV.y - warpedV.y * sourceU.y) / determinant,
    },
    dv: {
      x: (warpedV.x * sourceU.x - warpedU.x * sourceV.x) / determinant,
      y: (warpedV.y * sourceU.x - warpedU.y * sourceV.x) / determinant,
    },
  };
}

/**
 * Conservatively bound one composed derivative over a triangle. The
 * derivative numerators and projective denominator are affine, so their
 * component extrema and the minimum safe denominator occur at vertices.
 */
function homographyDirectionalDerivativeBound(
  matrix: SolveOutput["homography"]["matrix"],
  triangle: readonly Point[],
  direction: Point,
): number {
  let maximumNumeratorX = 0;
  let maximumNumeratorY = 0;
  let minimumAbsDenominator = Number.POSITIVE_INFINITY;
  let denominatorSign = 0;
  for (const point of triangle) {
    const numeratorX = matrix[0] * point.x + matrix[1] * point.y + matrix[2];
    const numeratorY = matrix[3] * point.x + matrix[4] * point.y + matrix[5];
    const denominator = matrix[6] * point.x + matrix[7] * point.y + matrix[8];
    if (!Number.isFinite(denominator) || denominator === 0) {
      throw new Error("The source raster plan crosses the projective horizon");
    }
    const sign = Math.sign(denominator);
    if (denominatorSign !== 0 && sign !== denominatorSign) {
      throw new Error("The source raster plan crosses the projective horizon");
    }
    denominatorSign = sign;
    minimumAbsDenominator = Math.min(minimumAbsDenominator, Math.abs(denominator));
    const derivativeXNumerator =
      (matrix[0] * denominator - numeratorX * matrix[6]) * direction.x +
      (matrix[1] * denominator - numeratorX * matrix[7]) * direction.y;
    const derivativeYNumerator =
      (matrix[3] * denominator - numeratorY * matrix[6]) * direction.x +
      (matrix[4] * denominator - numeratorY * matrix[7]) * direction.y;
    maximumNumeratorX = Math.max(maximumNumeratorX, Math.abs(derivativeXNumerator));
    maximumNumeratorY = Math.max(maximumNumeratorY, Math.abs(derivativeYNumerator));
  }
  const denominatorSquared = minimumAbsDenominator * minimumAbsDenominator;
  const bound = Math.hypot(maximumNumeratorX, maximumNumeratorY) / denominatorSquared;
  if (!Number.isFinite(bound)) {
    throw new Error("The source raster planner produced an invalid density bound");
  }
  return bound;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

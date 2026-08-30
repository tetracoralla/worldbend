import { describe, expect, it } from "vitest";
import { correctionGridPolylines } from "./correction-grid";
import type { SolveOutput, WarpMesh } from "./types";

function solved(matrix: SolveOutput["homography"]["matrix"]): SolveOutput {
  return { homography: { matrix } } as SolveOutput;
}

describe("correctionGridPolylines", () => {
  it("places thirds in the solved output coordinate system", () => {
    const lines = correctionGridPolylines(solved([300, 0, 10, 0, 150, 20, 0, 0, 1]));
    expect(lines).toHaveLength(4);
    expect(lines[0]?.[0]).toEqual({ x: 110, y: 20 });
    expect(lines[0]?.at(-1)).toEqual({ x: 110, y: 170 });
    expect(lines[2]?.[0]).toEqual({ x: 10, y: 70 });
    expect(lines[2]?.at(-1)).toEqual({ x: 310, y: 70 });
  });

  it("uses the renderer's piecewise warp mesh before projection", () => {
    const mesh: WarpMesh = {
      subdivisions: 2,
      vertices: [
        { source: { x: 0, y: 0 }, warped: { x: 0, y: 0 } },
        { source: { x: 0.5, y: 0 }, warped: { x: 0.5, y: 0 } },
        { source: { x: 1, y: 0 }, warped: { x: 1, y: 0 } },
        { source: { x: 0, y: 0.5 }, warped: { x: 0, y: 0.5 } },
        { source: { x: 0.5, y: 0.5 }, warped: { x: 0.6, y: 0.5 } },
        { source: { x: 1, y: 0.5 }, warped: { x: 1, y: 0.5 } },
        { source: { x: 0, y: 1 }, warped: { x: 0, y: 1 } },
        { source: { x: 0.5, y: 1 }, warped: { x: 0.5, y: 1 } },
        { source: { x: 1, y: 1 }, warped: { x: 1, y: 1 } },
      ],
    };
    const lines = correctionGridPolylines(
      solved([100, 0, 0, 0, 100, 0, 0, 0, 1]),
      mesh,
    );
    expect(lines[0]?.[12]?.x).toBeCloseTo(40, 8);
    expect(lines[0]?.[12]?.y).toBe(50);
  });
});

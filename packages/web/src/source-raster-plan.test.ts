import { describe, expect, it } from "vitest";
import { estimateSourceRasterSize } from "./source-raster-plan";
import {
  normalizedSpec,
  unitQuad,
  type SolveOutput,
  type WarpMesh,
} from "./types";

function solved(matrix: SolveOutput["homography"]["matrix"]): SolveOutput {
  return { homography: { matrix } } as SolveOutput;
}

describe("estimateSourceRasterSize", () => {
  it("tracks identity output density with bounded reconstruction headroom", () => {
    const result = estimateSourceRasterSize(
      solved([1200, 0, 0, 0, 800, 0, 0, 0, 1]),
      normalizedSpec(unitQuad()),
      4096,
    );
    expect(result).toEqual({ width: 1296, height: 864 });
  });

  it("plans from the most magnified projective region", () => {
    const result = estimateSourceRasterSize(
      solved([1000, 0, 0, 0, 800, 0, -0.5, 0, 1]),
      normalizedSpec(unitQuad()),
      4096,
    );
    expect(result.width).toBeGreaterThan(3000);
    expect(result.height).toBeGreaterThan(1400);
  });

  it("requires the core mesh instead of guessing density from Warp amount", () => {
    expect(() =>
      estimateSourceRasterSize(
        solved([1000, 0, 0, 0, 1000, 0, 0, 0, 1]),
        normalizedSpec(unitQuad(), undefined, { preset: "arc", amount: 1 }),
        4096,
      )
    ).toThrow("requires its core-owned mesh");
  });

  it("plans from local core-mesh magnification and respects the adapter axis limit", () => {
    const subdivisions = 2;
    const mesh: WarpMesh = {
      subdivisions,
      vertices: Array.from({ length: (subdivisions + 1) ** 2 }, (_, index) => {
        const x = index % (subdivisions + 1);
        const y = Math.floor(index / (subdivisions + 1));
        const source = { x: x / subdivisions, y: y / subdivisions };
        return {
          source,
          warped: x === 1 && y === 1 ? { x: source.x, y: 0.1 } : source,
        };
      }),
    };
    const result = estimateSourceRasterSize(
      solved([1000, 0, 0, 0, 1000, 0, 0, 0, 1]),
      normalizedSpec(unitQuad(), undefined, { preset: "arc", amount: 1 }),
      4096,
      mesh,
    );
    // The lower cells stretch one source-v unit across 1.8 destination units.
    // An amount-only 1.5x guess would have stopped at 1620 px.
    expect(result.height).toBe(1945);
    expect(result.width).toBeGreaterThan(1000);
  });
});

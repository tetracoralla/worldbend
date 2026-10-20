import { describe, expect, it } from "vitest";
import {
  DESIGNER_PREVIEW_MAX_AXIS,
  previewScaleFor,
  scalePreviewSolve,
  scaleSolveByFactor,
  scaleSolveToRasterSize,
  scaledPreviewSize,
} from "./designer-preview";
import type { PreviewSolveOutput } from "@worldbend/web";

const identitySolve = (width: number, height: number): PreviewSolveOutput => ({
  resolvedDestination: { reference: { width, height } },
  homography: { matrix: [width, 0, 0, 0, height, 0, 0, 0, 1] },
});

describe("previewScaleFor", () => {
  it("keeps plans at or below the shared preview axis unscaled", () => {
    expect(previewScaleFor(1024, 768)).toBe(1);
    expect(DESIGNER_PREVIEW_MAX_AXIS).toBe(1024);
  });

  it("caps the longer axis and preserves aspect", () => {
    expect(previewScaleFor(4096, 2048)).toBe(0.25);
    expect(previewScaleFor(2048, 4096)).toBe(0.25);
  });

  it("falls back to scale 1 for invalid plans instead of inventing geometry", () => {
    expect(previewScaleFor(0, 100)).toBe(1);
    expect(previewScaleFor(100, Number.NaN)).toBe(1);
    expect(previewScaleFor(100, 100, 0)).toBe(1);
  });
});

describe("scaledPreviewSize", () => {
  it("caps the longer axis with valid integer dimensions", () => {
    expect(scaledPreviewSize(4096, 2048)).toEqual({ width: 1024, height: 512 });
    expect(scaledPreviewSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("never rounds a scaled dimension down to zero", () => {
    expect(scaledPreviewSize(4097, 1)).toEqual({ width: 1024, height: 1 });
  });
});

describe("scaleSolveByFactor", () => {
  it("returns the original solve untouched at factor 1", () => {
    const solve = identitySolve(800, 600);
    expect(scaleSolveByFactor(solve, 1)).toBe(solve);
  });

  it("scales the pixel reference and the homography destination rows together", () => {
    const scaled = scaleSolveByFactor(identitySolve(4096, 2048), 0.25);
    expect(scaled.resolvedDestination.reference).toEqual({ width: 1024, height: 512 });
    expect(scaled.homography.matrix).toEqual([1024, 0, 0, 0, 512, 0, 0, 0, 1]);
  });

  it("keeps the projective row so normalized mapping is unchanged", () => {
    const solve: PreviewSolveOutput = {
      resolvedDestination: { reference: { width: 3000, height: 3000 } },
      homography: { matrix: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    };
    const scaled = scaleSolveByFactor(solve, 0.5);
    expect(scaled.homography.matrix.slice(6)).toEqual([7, 8, 9]);
    expect(scaled.resolvedDestination.reference).toEqual({ width: 1500, height: 1500 });
  });
});

describe("scalePreviewSolve", () => {
  it("delegates to the shared preview axis", () => {
    const scaled = scalePreviewSolve(identitySolve(4096, 4096));
    expect(scaled.resolvedDestination.reference).toEqual({ width: 1024, height: 1024 });
  });
});

describe("scaleSolveToRasterSize", () => {
  it("preserves normalized mapping at exact integer raster dimensions", () => {
    const solve: PreviewSolveOutput = { resolvedDestination: { reference: { width: 3000, height: 2400 } },
      homography: { matrix: [2800, 100, 20, 50, 2300, 12, .1, .2, 1] } };
    const size = { width: 4096, height: 3277 }, scaled = scaleSolveToRasterSize(solve, size);
    expect(scaled.resolvedDestination.reference).toEqual(size);
    for (const [u,v] of [[0,0], [.3,.7], [1,1]]) {
      const projected = (value: PreviewSolveOutput) => {
        const [a,b,c,d,e,f,g,h,i] = value.homography.matrix, frame = value.resolvedDestination.reference;
        return [(a*u!+b*v!+c)/(g*u!+h*v!+i)/frame.width, (d*u!+e*v!+f)/(g*u!+h*v!+i)/frame.height];
      };
      projected(scaled).forEach((value,index) => expect(value).toBeCloseTo(projected(solve)[index]!, 12));
    }
  });
  it("rejects invalid raster frames", () => {
    expect(() => scaleSolveToRasterSize(identitySolve(200,160), { width: 0, height: 160 })).toThrow("Invalid raster frame");
  });
});

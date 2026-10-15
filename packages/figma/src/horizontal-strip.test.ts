import { describe, expect, it } from "vitest";
import { horizontalStripState } from "./horizontal-strip";

describe("horizontalStripState", () => {
  it("hides overflow controls when every peer fits", () => {
    expect(horizontalStripState({ scrollLeft: 0, clientWidth: 240, scrollWidth: 240 })).toEqual({
      overflow: false,
      canScrollBackward: false,
      canScrollForward: false,
    });
  });

  it("exposes only the useful direction at each edge", () => {
    expect(horizontalStripState({ scrollLeft: 0, clientWidth: 240, scrollWidth: 480 })).toEqual({
      overflow: true,
      canScrollBackward: false,
      canScrollForward: true,
    });
    expect(horizontalStripState({ scrollLeft: 240, clientWidth: 240, scrollWidth: 480 })).toEqual({
      overflow: true,
      canScrollBackward: true,
      canScrollForward: false,
    });
  });
});

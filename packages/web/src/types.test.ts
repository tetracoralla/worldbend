import { describe, expect, it } from "vitest";
import { cloneQuad, unitQuad } from "./types";

describe("cloneQuad", () => {
  it("copies values without sharing corner objects", () => {
    const quad = unitQuad();
    const copy = cloneQuad(quad);
    expect(copy).toEqual(quad);
    expect(copy).not.toBe(quad);
    expect(copy.tl).not.toBe(quad.tl);
    copy.tl.x = 0.5;
    expect(quad.tl.x).toBe(0);
  });
});

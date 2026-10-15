import { describe, it, expect } from "vitest";
import { isMockupSurface, mockupSurfaceControls, parseMockupSurfaceControls } from "./mockup-surface";

describe("mockup surface admission and continued controls", () => {
  it("retains exact Agent-authored values across unrelated edits", () => {
    const surface = {kind:"cylinder" as const,curvature:1/3,tilt:0.123456789012345,light:{strength:2/3,direction:-0.234567890123456}};
    const controls = mockupSurfaceControls(surface);
    expect(parseMockupSurfaceControls(controls,surface)).toEqual(surface);
    controls.tilt = "20";
    expect(parseMockupSurfaceControls(controls,surface)).toEqual({...surface,tilt:0.2});
  });
  it("admits core defaults, closes unknown fields and bounds numeric controls", () => {
    expect(isMockupSurface({kind:"fabric",folds:2,depth:0.7})).toBe(true);
    expect(isMockupSurface({kind:"cylinder",curvature:0.5})).toBe(true);
    for (const bad of [{kind:"fabric",folds:0,depth:0.5},{kind:"fabric",folds:2,depth:NaN},{kind:"cylinder",curvature:0.5,depth:0.5},{kind:"cylinder",curvature:0.5,light:{strength:0.5,direction:0,extra:1}}]) expect(isMockupSurface(bad)).toBe(false);
    const controls = {...mockupSurfaceControls(),kind:"fabric"};
    expect(() => parseMockupSurfaceControls({...controls,phase:"101"})).toThrow();
    expect(() => parseMockupSurfaceControls({...controls,amount:""})).toThrow();
    expect(() => parseMockupSurfaceControls({...controls,folds:"2.5"})).toThrow();
    expect(parseMockupSurfaceControls({...controls,kind:"",amount:"bad"})).toBeUndefined();
  });
});

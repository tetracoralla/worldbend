import {describe, expect, it, vi} from "vitest";

const core = vi.hoisted(() => ({
  map: vi.fn(), map_control: vi.fn(), free: vi.fn(), construct: vi.fn(),
}));
vi.mock("@worldbend/wasm", () => ({
  default: vi.fn(),
  MeshCoordinateMap: class {
    constructor(value: string) { core.construct(value); }
    map = core.map;
    map_control = core.map_control;
    free = core.free;
  },
}));
import {createMeshCoordinateMap} from "./bridge";
import type {WarpMesh} from "./types";

describe("core mesh coordinate bridge", () => {
  it("routes synchronous lookup and fixed control frames and releases once", async () => {
    const mesh = {subdivisions: 2, vertices: []} as unknown as WarpMesh;
    const map = await createMeshCoordinateMap(mesh);
    expect(core.construct).toHaveBeenCalledWith(JSON.stringify(mesh));
    core.map.mockReturnValue(new Float64Array([.3, .4]));
    expect(map.map({x:.5, y:.6}, true)).toEqual({x:.3, y:.4});
    expect(core.map).toHaveBeenLastCalledWith(.5, .6, true);
    core.map.mockReturnValue(new Float64Array());
    expect(map.map({x:.9, y:.9})).toBeUndefined();
    core.map_control.mockReturnValue(new Float64Array([-1, 2]));
    expect(map.mapControl({x:-.2, y:1.5}, {x:1/3, y:2/3}, true)).toEqual({x:-1, y:2});
    expect(core.map_control).toHaveBeenCalledWith(-.2, 1.5, 1/3, 2/3, true);
    map.dispose(); map.dispose();
    expect(core.free).toHaveBeenCalledTimes(1);
    expect(() => map.map({x:0, y:0})).toThrow("disposed");
  });
});

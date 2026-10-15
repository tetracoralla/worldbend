import { readFile } from "node:fs/promises";
import { beforeAll, expect, it } from "vitest";
import * as wasm from "@worldbend/wasm";
import { normalizedSpec, unitQuad } from "./types";

beforeAll(async () => {
  const bytes = await readFile(new URL("../../wasm/pkg/worldbend_wasm_bg.wasm", import.meta.url));
  wasm.initSync({ module: new WebAssembly.Module(bytes) });
});

const validSpec = JSON.stringify(normalizedSpec(unitQuad()));
const calls: Array<[string, (input: string) => unknown]> = [
  ["transform", input => wasm.solve_json(input, 100, 100)],
  ["compose", input => wasm.compose_json(validSpec, input, 100, 100)],
  ["rectify", input => wasm.rectify_json(input)],
  ["canvas", input => wasm.canvas_plan_json(input, 100, 100)],
  ["canvas set", input => wasm.canvas_set_plan_json(input, 100, 100)],
  ["shape domains", input => wasm.shape_fit_domains_json(input)],
  ["shape refresh", input => wasm.shape_fit_refresh_json(input)],
  ["deformation migration", input => wasm.deformation_work_migrate_json(input)],
  ["pose", input => wasm.pose_json(input)],
  ["card pose", input => wasm.card_pose_json(input)],
  ["card pointer", input => wasm.card_pointer_json(input)],
  ["card idle", input => wasm.card_idle_json(input)],
  ["card turn", input => wasm.card_turn_json(input)],
  ["warp", input => wasm.warp_mesh_json(input)],
  ["mockup surface", input => wasm.mockup_surface_mesh_json(input, "null")],
];

it.each(calls)("bounds malformed %s errors at the real WASM boundary and recovers", (_name, call) => {
  const input = JSON.stringify({ [`unknown_${"界".repeat(4000)}`]: 0 });
  let error: unknown;
  try { call(input); } catch (caught) { error = caught; }
  expect(error).toBeDefined();
  const encoded = String(error);
  expect(encoded.length).toBeLessThan(400);
  expect(JSON.parse(encoded)).toMatchObject({ code: "E_SCHEMA" });
  expect(JSON.parse(wasm.solve_json(validSpec, 100, 100))).toHaveProperty("homography");
});

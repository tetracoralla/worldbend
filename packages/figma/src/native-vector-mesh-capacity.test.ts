import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { initSync, deformation_work_plan_json, vector_projection_json } from "../../wasm/pkg-figma/worldbend_wasm.js";
import { isValidVectorProjectionOutput } from "./native-vector-guard";

initSync({ module: readFileSync(new URL("../../wasm/pkg-figma/worldbend_wasm_bg.wasm", import.meta.url)) });

it("admits the real bounded mesh stroke and larger canonical output without weakening fidelity", () => {
  const points = Array.from({ length: 16 }, (_, index) => ({ x: index % 4 / 3, y: Math.floor(index / 4) / 3 }));
  points[5] = { x: .39, y: .30 }; points[10] = { x: .61, y: .72 };
  const work = { schema: "worldbend.deformation-work", version: "0.1", targetSize: { width: 440, height: 620 },
    transform: { schema: "worldbend.transform", version: "0.1", destination: { space: "normalized",
      quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } }, content: { fit: "stretch" } },
    meshSubdivisions: 8, surface: { envelope: { columns: 1, rows: 1, points }, anchors: [], strokes: [] },
    meshEdits: [{ column: 4, row: 4, warped: { x: .55, y: .46 } }] };
  const mesh = JSON.parse(deformation_work_plan_json(JSON.stringify(work))).meshWarp.spec.mesh;
  const k = .3 * .5522847498307936;
  const output = JSON.parse(vector_projection_json(JSON.stringify({ schema: "worldbend.vector-projection", version: "0.2", mesh,
    path: { vertices: [{ x: .8, y: .5 }, { x: .5, y: .8 }, { x: .2, y: .5 }, { x: .5, y: .2 }],
      segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: k }, tangentEnd: { x: k, y: 0 } },
        { start: 1, end: 2, tangentStart: { x: -k, y: 0 }, tangentEnd: { x: 0, y: k } },
        { start: 2, end: 3, tangentStart: { x: 0, y: -k }, tangentEnd: { x: -k, y: 0 } },
        { start: 3, end: 0, tangentStart: { x: k, y: 0 }, tangentEnd: { x: 0, y: -k } }], regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2, 3]] }] },
    sourceTransform: [1, 0, 0, 0, 1, 0], sourceBounds: { x: 0, y: 0, width: 1, height: 1 },
    homography: [440, 0, 0, 0, 620, 0, 0, 0, 1], reference: { width: 440, height: 620 }, placement: { width: 440, height: 620 },
    tolerancePx: .25, stroke: { weight: .01, cap: "NONE", join: "MITER", miterLimit: 4 } })));
  expect(output.report.outputVertices).toBeLessThanOrEqual(4096);
  expect(output.report.outputVertices).toBeGreaterThan(2048);
  expect(output.report.fidelity).toBe("outlined");
  expect(output.report.maxError).toBeLessThanOrEqual(.25);
  expect(output.network.regions[1].loops).toHaveLength(2);
  expect(isValidVectorProjectionOutput(output)).toBe(true);
  expect(isValidVectorProjectionOutput({ ...output, report: { ...output.report, maxError: .26 } })).toBe(false);
  expect(isValidVectorProjectionOutput({ ...output, report: { ...output.report, fidelity: "exact" } })).toBe(false);
  const wavy = JSON.parse(vector_projection_json(JSON.stringify({ schema: "worldbend.vector-projection", version: "0.1",
    path: { vertices: Array.from({ length: 300 }, (_, index) => ({ x: index * .33, y: 50 + 45 * Math.sin(index * .4) })),
      segments: Array.from({ length: 300 }, (_, index) => index === 299 ? { start: 299, end: 0 }
        : { start: index, end: index + 1, tangentStart: { x: .1, y: 8 }, tangentEnd: { x: -.1, y: -8 } }),
      regions: [{ windingRule: "NONZERO", loops: [Array.from({ length: 300 }, (_, index) => index)] }] },
    sourceTransform: [1, 0, 0, 0, 1, 0], sourceBounds: { x: 0, y: 0, width: 100, height: 100 },
    homography: [100, 0, 0, 0, 100, 0, .3, .2, 1], reference: { width: 100, height: 100 }, placement: { width: 100, height: 100 }, tolerancePx: .01 })));
  expect(wavy.report.outputVertices).toBeGreaterThan(2048);
  expect(wavy.report.outputVertices).toBeLessThanOrEqual(4096);
  expect(wavy.report.maxError).toBeLessThanOrEqual(.01);
  expect(isValidVectorProjectionOutput(wavy)).toBe(true);
});

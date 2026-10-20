import { expect, it } from "vitest";
import { vectorExactPage } from "./agent-vector-pages";
import { utf8Bytes } from "./utf8-base64";

const json = JSON.stringify({ schema: "worldbend.exact-json", version: "0.1", encoding: "utf8-base64",
  decodedBytes: 65536, digest: "d".repeat(64), data: "A".repeat(18 * 1024 * 4) });

it("budgets complete state/capture/initialization receipts, not just their ASCII slice", () => {
  for (const identity of ["118:2", '"\\'.repeat(128), "汉".repeat(85)]) {
    const scope = { fileKey: identity, pageId: identity, nodeId: identity };
    const reference = { ...scope, revision: Number.MAX_SAFE_INTEGER, targetExpected: "source32x2:9999999:" + "d".repeat(32) };
    const receipt = { schema: "worldbend.figma.publication-receipt", version: "0.1", ...scope,
      transferId: "d".repeat(64), affectedNodeIds: [scope.nodeId] };
    const first = vectorExactPage(json, {}, scope), collected: string[] = [];
    for (let part = 0; part < first.partCount; part++) {
      const page = { ...vectorExactPage(json, { part, token: first.token }, scope), reference };
      for (const returned of [page, { ...receipt, status: "captured", snapshot: { nodeId: scope.nodeId, ...page } },
        { ...receipt, status: "initialized", snapshot: { nodeId: scope.nodeId, status: "initialized", reused: false, state: page } }]) {
        expect(utf8Bytes(JSON.stringify(returned)).length).toBeLessThanOrEqual(20480);
      }
      collected.push(page.json);
    }
    expect(collected.join("")).toBe(json);
    if (identity === "118:2") expect(first.json.length).toBe(18432);
    else expect(first.json.length).toBeLessThanOrEqual(18432);
  }
});

it("binds the layout to its token and rejects unbounded escape metadata without weakening recovery", () => {
  const small = { fileKey: "file", pageId: "page", nodeId: "node" };
  const first = vectorExactPage(json, {}, small);
  const large = { fileKey: '"'.repeat(256), pageId: '"'.repeat(256), nodeId: '"'.repeat(256) };
  expect(() => vectorExactPage(json, { part: 1, token: first.token }, large)).toThrow("restart read");
  expect(() => vectorExactPage('"'.repeat(20480), {}, small)).toThrow("metadata exceeds host return capacity");
  expect(() => vectorExactPage("汉", {}, small)).toThrow("bounded read capacity");
  expect(vectorExactPage(json, {}, small)).toEqual(first);
});

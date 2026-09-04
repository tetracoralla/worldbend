import assert from "node:assert/strict";
import test from "node:test";

import { compareRgba } from "./remap-native-webgl-parity.mjs";

test("Remap parity comparison excludes only the declared edge inset", () => {
  const expected = new Uint8Array(4 * 4 * 4);
  const actual = expected.slice();
  actual[(1 * 4 + 1) * 4] = 3;
  actual[(3 * 4 + 3) * 4] = 255;

  assert.deepEqual(compareRgba(actual, expected, 4, 4, 1), {
    maxChannelDelta: 3,
    meanChannelDelta: 3 / 16,
    differentChannelRatio: 1 / 16,
    comparedChannels: 16,
    inset: 1,
    maxAt: { x: 1, y: 1, channel: 0, actual: 3, expected: 0 },
  });
});

test("Remap parity comparison rejects inconsistent dimensions", () => {
  assert.throws(
    () => compareRgba(new Uint8Array(4), new Uint8Array(8), 1, 1),
    /same declared dimensions/,
  );
});

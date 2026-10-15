import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeCanvasPixels} from './webgpu-readback.mjs';

test('canvas readback skips padded rows and swizzles BGRA', () => {
  const bytes = new Uint8Array(512).fill(123);
  bytes.set([3, 2, 1, 255], 0);
  bytes.set([30, 20, 10, 255], 256);
  assert.deepEqual([...decodeCanvasPixels(bytes, 1, 2, 256, 'bgra8unorm', 'opaque')], [1, 2, 3, 255, 10, 20, 30, 255]);
});

test('canvas readback returns straight RGBA and canonical transparent black', () => {
  const bytes = Uint8Array.from([26, 51, 77, 128, 8, 10, 12, 0, 255, 255, 255, 1]);
  assert.deepEqual([...decodeCanvasPixels(bytes, 3, 1, 12, 'rgba8unorm', 'premultiplied')], [52, 102, 153, 128, 0, 0, 0, 0, 255, 255, 255, 1]);
});

test('canvas readback rejects unsupported formats and truncated storage', () => {
  assert.throws(() => decodeCanvasPixels(new Uint8Array(8), 1, 1, 4, 'rgba16float', 'opaque'), /format/);
  assert.throws(() => decodeCanvasPixels(new Uint8Array(4), 1, 2, 256, 'rgba8unorm', 'opaque'), /layout/);
});

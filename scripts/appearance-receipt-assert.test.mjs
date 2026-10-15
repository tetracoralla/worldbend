import assert from 'node:assert/strict';
import test from 'node:test';
import {assertAppearanceReceiptMatches} from './appearance-receipt-assert.mjs';

const receipt = () => ({updates: [{delivery: {
  fingerprint: 'exact-content-identity', material: {lightAngle: 120, radius: 0.5},
  web: {lightAxis: {angleDegrees: 120, direction: [-0.8660254037844387, -0.49999999999999983]}},
  swiftui: {optical: {lightDirection: [-0.8660254037844387, -0.49999999999999983]}},
}}]});
const check = (stored, actual) => assertAppearanceReceiptMatches(JSON.stringify(stored), actual, 'Stale receipt');

test('accepts platform sin/cos last-bit differences in both derived vectors', () => {
  const stored = receipt(), actual = receipt();
  actual.updates[0].delivery.web.lightAxis.direction[1] = -0.4999999999999998;
  actual.updates[0].delivery.swiftui.optical.lightDirection[1] = -0.4999999999999998;
  check(stored, actual);
});

test('rejects changed identities, authored numbers and non-vector output', () => {
  for (const mutate of [
    value => { value.fingerprint = 'different-content-identity'; },
    value => { value.material.radius += 1e-15; },
    value => { value.web.lightAxis.angleDegrees += 1e-13; },
    value => { value.web.lightAxis.extra = true; },
    value => { delete value.material; },
  ]) {
    const actual = receipt(); mutate(actual.updates[0].delivery);
    assert.throws(() => check(receipt(), actual), /Stale receipt/);
  }
});

test('rejects actual direction changes, malformed vectors and lookalike paths', () => {
  for (const vector of [[-0.866, -0.5], [0, 1], [0, 1, 0], [0], [NaN, 0], [Infinity, 0], ['0', 1], [1.01, 0]]) {
    const actual = receipt(); actual.updates[0].delivery.web.lightAxis.direction = vector;
    assert.throws(() => check(receipt(), actual), /Stale receipt/);
  }
  const stored = {material: {lightDirection: [0, 1]}}, actual = {material: {lightDirection: [1e-15, 1]}};
  assert.throws(() => check(stored, actual), /Stale receipt/);
});

test('preserves array order, nulls, types and nested structure', () => {
  const stored = {values: [null, '1', 1, false]};
  check(stored, structuredClone(stored));
  for (const values of [[null, 1, '1', false], [null, '1', 1], [null, '1', 1, 0]]) {
    assert.throws(() => check(stored, {values}), /Stale receipt/);
  }
  assert.throws(() => assertAppearanceReceiptMatches('invalid json', {}, 'Stale receipt'), SyntaxError);
});

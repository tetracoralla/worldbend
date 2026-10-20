import assert from 'node:assert/strict';

// Rust sin/cos precision varies across platforms. Only these derived unit
// vectors may vary by 1e-12; authored fields, fingerprints and other output
// remain exact. Core direction tests use 1e-9. See:
// https://doc.rust-lang.org/std/primitive.f64.html#method.cos
const derivedDirection = /\/(?:web\/lightAxis\/direction|swiftui\/optical\/lightDirection)$/;

export function assertAppearanceReceiptMatches(storedText, generated, message) {
  const stored = JSON.parse(storedText);
  function compare(expected, actual, location) {
    const context = `${message} at ${location || '/'}`;
    if (derivedDirection.test(location)) {
      for (const vector of [expected, actual]) {
        assert.ok(Array.isArray(vector) && vector.length === 2, context);
        assert.ok(vector.every(value => Number.isFinite(value) && Math.abs(value) <= 1), context);
      }
      for (let index = 0; index < 2; index++) {
        assert.ok(Math.abs(expected[index] - actual[index]) <= 1e-12, `${context}/${index}`);
      }
    } else if (Array.isArray(expected)) {
      assert.ok(Array.isArray(actual), context);
      assert.equal(actual.length, expected.length, context);
      expected.forEach((value, index) => compare(value, actual[index], `${location}/${index}`));
    } else if (expected !== null && typeof expected === 'object') {
      assert.ok(actual !== null && typeof actual === 'object' && !Array.isArray(actual), context);
      assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), context);
      for (const key of Object.keys(expected)) compare(expected[key], actual[key], `${location}/${key}`);
    } else {
      assert.equal(actual, expected, context);
    }
  }
  compare(stored, generated, '');
}

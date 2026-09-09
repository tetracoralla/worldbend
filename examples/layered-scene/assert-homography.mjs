#!/usr/bin/env node
// Verifies the consumer-side homography conventions against expected-plan.json.
//
//   node assert-homography.mjs
//
// The plan is real output from `worldbend mockup-inspect`. Every plane's
// row-major matrix must map the unit square corners (0,0)(1,0)(1,1)(0,1) to
// the resolved destination quad TL, TR, BR, BL after perspective division.
// A consumer integration that cannot reproduce these numbers has a
// convention bug (transposition, missing divide, or corner reordering).

import { readFileSync } from "node:fs";

const document = JSON.parse(readFileSync(new URL("./expected-plan.json", import.meta.url), "utf8"));
const plan = document.ok === true ? document.result : document;

const unitSquare = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const diagonal = Math.hypot(plan.canvas.width, plan.canvas.height);
// Same bound the core enforces for its own reprojection check.
const tolerance = 1e-6 * diagonal;

let failures = 0;
for (const plane of plan.planes) {
  const H = plane.solve.homography.matrix;
  const quad = plane.solve.resolvedDestination.quad;
  for (const corner of ["tl", "tr", "br", "bl"]) {
    const [u, v] = unitSquare[corner];
    const xp = H[0] * u + H[1] * v + H[2];
    const yp = H[3] * u + H[4] * v + H[5];
    const wp = H[6] * u + H[7] * v + H[8];
    const x = xp / wp;
    const y = yp / wp;
    const error = Math.hypot(x - quad[corner].x, y - quad[corner].y);
    if (!(error <= tolerance)) {
      failures += 1;
      console.error(
        `${plane.id}.${corner}: mapped (${x}, ${y}) but expected (${quad[corner].x}, ${quad[corner].y})`,
      );
    }
  }
  // Frameworks that multiply row vectors ([x y 1] * M: CGAffineTransform and
  // SwiftUI ProjectionTransform style) must use the transpose below. The CSS
  // adapter performs the equivalent arrangement when it emits matrix3d.
  const transposed = [H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]];
  console.log(
    `${plane.id}: row-vector entries (m11..m33) = ${transposed.map((n) => Number(n.toPrecision(10))).join(", ")}`,
  );
}

if (failures > 0) {
  console.error(`${failures} corner mapping(s) failed within ${tolerance}.`);
  process.exit(1);
}
console.log(`All ${plan.planes.length} planes reproduce their quads within ${tolerance}.`);

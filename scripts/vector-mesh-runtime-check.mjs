import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeChrome, createPage, findChrome, launchChrome, readPageResult } from "./remap-native-webgl-parity.mjs";

// Real canonical WASM profiles plus the built Web bridge. An optional private
// native-capture fixture stays outside the public tree and result metadata.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureArgument = process.argv.find(argument => argument.startsWith("--fixture="));
assert(process.argv.slice(2).every(argument => argument === fixtureArgument), "Unknown probe argument");
const transform = { schema: "worldbend.transform", version: "0.1", destination: { space: "normalized",
  quad: { tl: { x: 0, y: 0 }, tr: { x: 1, y: 0 }, br: { x: 1, y: 1 }, bl: { x: 0, y: 1 } } }, content: { fit: "stretch" } };
const base = { schema: "worldbend.vector-projection", version: "0.2", path: {
  vertices: [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .8, y: .8 }, { x: .2, y: .8 }],
  segments: [{ start: 0, end: 1, tangentStart: { x: .15, y: -.12 }, tangentEnd: { x: -.15, y: .15 } },
    { start: 1, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 0 }],
  regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2, 3]] }] },
  sourceTransform: [1, 0, 0, 0, 1, 0], sourceBounds: { x: 0, y: 0, width: 1, height: 1 },
  homography: [440, 0, 0, 0, 620, 0, 0, 0, 1], reference: { width: 440, height: 620 }, placement: { width: 440, height: 620 }, tolerancePx: .25 };
const k = .3 * .5522847498307936;
const rounded = { vertices: [{ x: .8, y: .5 }, { x: .5, y: .8 }, { x: .2, y: .5 }, { x: .5, y: .2 }],
  segments: [{ start: 0, end: 1, tangentStart: { x: 0, y: k }, tangentEnd: { x: k, y: 0 } },
    { start: 1, end: 2, tangentStart: { x: -k, y: 0 }, tangentEnd: { x: 0, y: k } },
    { start: 2, end: 3, tangentStart: { x: 0, y: -k }, tangentEnd: { x: -k, y: 0 } },
    { start: 3, end: 0, tangentStart: { x: k, y: 0 }, tangentEnd: { x: 0, y: -k } }],
  regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2, 3]] }] };
let sources = [base];
if (fixtureArgument) {
  const fixture = fixtureArgument.slice("--fixture=".length);
  assert((await stat(fixture)).size <= 4 * 1024 * 1024, "Capture fixture is too large");
  const data = JSON.parse(await readFile(fixture, "utf8"));
  assert(Array.isArray(data.sources) && data.sources.length >= 1 && data.sources.length <= 16, "Capture needs bounded complete parts");
  sources = data.sources.map(({ textOutlined: _text, strokeOutlined: _stroke, ...source }) => ({ ...source, version: "0.2" }));
}
const profiles = [];
for (const name of ["full", "figma"]) {
  const directory = name === "full" ? "pkg" : "pkg-figma";
  const wasm = await import(new URL(`../packages/wasm/${directory}/worldbend_wasm.js`, import.meta.url));
  const bytes = await readFile(path.join(root, "packages/wasm", directory, "worldbend_wasm_bg.wasm"));
  wasm.initSync({ module: new WebAssembly.Module(bytes) });
  let admission;
  try { wasm.vector_projection_json(" ".repeat(8 * 1024 * 1024 + 1)); } catch (error) { admission = JSON.parse(String(error)); }
  assert.equal(admission?.code, "E_OUTPUT_LIMIT");
  let diagnostic;
  try { wasm.vector_projection_json(JSON.stringify({ ["x".repeat(4096)]: 1 })); } catch (error) { diagnostic = JSON.parse(String(error)); }
  assert.equal(diagnostic?.code, "E_SCHEMA"); assert(diagnostic.message.length < 400, "Parse diagnostics must remain bounded");
  // H is evaluated AFTER M: a valid moved source domain must not be refused
  // merely because the unexecuted original path hull crossed H's pole.
  const horizonInput = { ...base, path: { ...base.path,
    segments: base.path.segments.map(({ start, end }) => ({ start, end })) },
    homography: [100, 0, 0, 0, 100, 0, 1, 0, -.5] };
  let horizonRefusal;
  try { wasm.vector_projection_json(JSON.stringify(horizonInput)); } catch (error) { horizonRefusal = JSON.parse(String(error)); }
  assert.equal(horizonRefusal?.code, "E_HOMOGRAPHY_HORIZON_CROSSING");
  horizonInput.mesh = { subdivisions: 2, boundary: "free", vertices: Array.from({ length: 9 }, (_, i) => {
    const source = { x: i % 3 / 2, y: Math.floor(i / 3) / 2 };
    return { source, warped: { x: .6 + .4 * source.x, y: .2 + .6 * source.y } };
  }) };
  assert.equal(JSON.parse(wasm.vector_projection_json(JSON.stringify(horizonInput))).report.fidelity, "exact");
  const nearSeam = { x: .5, y: .5 + 5e-11 };
  const seamMesh = { triangles: [[0, 1, 3], [0, 3, 2]], boundary: "free",
    vertices: [
      { source: { x: 0, y: 0 }, warped: { x: 0, y: 0 } },
      { source: { x: 1, y: 0 }, warped: { x: 1, y: 0 } },
      { source: { x: 0, y: 1 }, warped: { x: 0, y: .5 } },
      { source: { x: 1, y: 1 }, warped: { x: 1, y: 1 } } ] };
  const seamInput = { ...base, mesh: seamMesh, homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    reference: { width: 1, height: 1 }, placement: { width: 1e12, height: 1e12 }, path: {
      vertices: [nearSeam, { x: .1, y: .6 }, { x: .2, y: .7 }],
      segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 }],
      regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } };
  const seamOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify(seamInput)));
  assert(Math.abs(seamOutput.network.vertices[0].y - (nearSeam.x + nearSeam.y) * .5 * 1e12) < .001,
    "Near seam must choose its actual face even at high placement scale");
  const coordinates = new wasm.MeshCoordinateMap(JSON.stringify(seamMesh));
  try {
    const mapped = coordinates.map(nearSeam.x, nearSeam.y, false);
    assert(Math.abs(mapped[1] * 1e12 - seamOutput.network.vertices[0].y) < .001);
    const control = coordinates.map_control(-.2, 1.2, nearSeam.x, nearSeam.y, false);
    const reopened = coordinates.map_control(control[0], control[1], nearSeam.x, nearSeam.y, true);
    assert(Math.hypot(reopened[0] + .2, reopened[1] - 1.2) < 1e-10, "Exterior control semantics must survive the face fix");
  } finally { coordinates.free(); }
  // A rounded point on a nonuniform indexed shared edge used to be rejected
  // by BOTH adjacent directed-edge tests. Exercise the actual profiles, not
  // only a Rust helper or the regular-grid source oracle.
  const indexedSource = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
    { x: .27195870503783226, y: .2523574760183692 }];
  const indexedMesh = { triangles: [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]], boundary: "fixed",
    vertices: indexedSource.map((source, index) => ({ source, warped: index === 4 ? { x: .6624678906984627, y: .5074056423734874 } : source })) };
  const indexedPoint = { x: .11667315743181769, y: .10826402311516918 };
  const indexedCoordinates = new wasm.MeshCoordinateMap(JSON.stringify(indexedMesh));
  try {
    assert.equal(indexedCoordinates.map(indexedPoint.x, indexedPoint.y, false).length, 2, "An in-domain indexed seam cannot disappear");
    const indexedOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...base, mesh: indexedMesh, path: {
      vertices: [indexedPoint, { x: .07, y: .13 }, { x: .9, y: .11 }],
      segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 }],
      regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } })));
    assert.equal(indexedOutput.report.fidelity, "exact");
    assert.equal(indexedCoordinates.map(-1e-16, .2, false).length, 0, "The repair must not epsilon-expand the domain");
  } finally { indexedCoordinates.free(); }
  const sliverCenter = { x: .39517041057097313, y: .6825596004484735 };
  const sliverInside = { x: sliverCenter.x * .5, y: sliverCenter.y * .5 - 1e-11 };
  const sliverMesh = { triangles: [[0, 1, 5], [1, 4, 5], [4, 0, 5], [1, 2, 4], [2, 3, 4], [3, 0, 4]], boundary: "fixed",
    vertices: [...indexedSource.slice(0, 4), sliverCenter, sliverInside].map((source, index) => ({ source,
      warped: index === 5 ? { x: source.x, y: source.y - .1 } : source })) };
  const sliverPoint = { x: .19758520528548656, y: .34127980021923676 };
  const sliverInput = { ...base, mesh: sliverMesh, homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    reference: { width: 1, height: 1 }, placement: { width: 10000, height: 10000 }, tolerancePx: .01,
    path: { vertices: [sliverPoint, { x: .1, y: .1 }, { x: .2, y: .05 }],
      segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 }],
      regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } };
  const sliverOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify(sliverInput)));
  const sliverExpected = { x: 1975.8520528548656, y: 2912.798002192368 };
  assert(Math.hypot(sliverOutput.network.vertices[0].x - sliverExpected.x,
    sliverOutput.network.vertices[0].y - sliverExpected.y) < 1e-9, "Admitted sliver weights must not falsify an Exact result");
  assert.deepEqual(JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...sliverInput,
    sourceTransform: [1, 0, 75000, 0, 1, 18000], sourceBounds: { x: 75000, y: 18000, width: 1, height: 1 } }))),
    sliverOutput, "Page-origin translation must not erase nonlinear source detail");
  const crossingMesh = { ...indexedMesh, vertices: indexedMesh.vertices.map((vertex, index) => index === 4
    ? { source: { x: .6345434657246721, y: .5350630241589321 }, warped: { x: .3, y: .7 } } : vertex) };
  const crossingOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...base, mesh: crossingMesh, path: {
    vertices: [{ x: .08274797263667595, y: .06977517360680134 }, { x: .5038131051363208, y: .42482789313302743 }, { x: .7, y: .1 }],
    segments: [{ start: 0, end: 1 }, { start: 1, end: 2 }, { start: 2, end: 0 }],
    regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } })));
  assert.notEqual(crossingOutput.network.segments[0].end, 1, "A near-parallel real crossing cannot silently bridge its seam");
  const affineMesh = { triangles: [[0, 1, 2], [0, 2, 3]], boundary: "free", vertices: indexedSource.slice(0, 4)
    .map(source => ({ source, warped: { x: source.x, y: source.y * .5 } })) };
  for (const controls of [
    [[.05077155651030568, .1860792237786627], [.19590119161977762, .2528451615022825], [.34103082672924956, .31961109922590225], [.48616046183872147, .386377036949522]],
    [[.09808226753871438, .16032847568281075], [.21611524113384287, .20972733953395686], [.3341482147289713, .259126203385103], [.4521811883240998, .3085250672362491]],
  ]) {
    const [first, inner1, inner2, last] = controls.map(([x, y]) => ({ x, y }));
    const residualOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...base, mesh: affineMesh, path: {
      vertices: [first, last, { x: .2, y: .5 }], segments: [{ start: 0, end: 1,
        tangentStart: { x: inner1.x - first.x, y: inner1.y - first.y }, tangentEnd: { x: inner2.x - last.x, y: inner2.y - last.y } },
      { start: 1, end: 2 }, { start: 2, end: 0 }], regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } })));
    assert.equal(residualOutput.report.fidelity, "approximated", "Nonzero curve residual cannot become an Exact chord");
    assert(residualOutput.report.maxError > 0 && residualOutput.report.maxError <= .25);
  }
  const cases = [];
  for (const preset of ["arc", "arch", "flag", "wave", "fish", "rise", "fisheye", "inflate", "squeeze", "twist"]) {
    cases.push({ id: preset, mesh: JSON.parse(wasm.warp_mesh_json(JSON.stringify({ preset, amount: .35 }))) });
  }
  const points = Array.from({ length: 16 }, (_, i) => ({ x: i % 4 / 3, y: Math.floor(i / 4) / 3 }));
  points[5] = { x: .39, y: .30 }; points[10] = { x: .61, y: .72 };
  const work = { schema: "worldbend.deformation-work", version: "0.1", transform, targetSize: base.reference, meshSubdivisions: 8,
    surface: { envelope: { columns: 1, rows: 1, points }, anchors: [], strokes: [] },
    meshEdits: [{ column: 4, row: 4, warped: { x: .55, y: .46 } }] };
  const planned = JSON.parse(wasm.deformation_work_plan_json(JSON.stringify(work)));
  cases.push({ id: "pin-mesh", mesh: planned.meshWarp.spec.mesh });
  const fitted = JSON.parse(wasm.deformation_work_plan_json(JSON.stringify({ ...work, shapeFit: {
    contour: { start: { x: 0, y: 0 }, segments: [{ x: 1, y: 0 }, { x: 1, y: .4 },
      { x: .4, y: .4 }, { x: .4, y: 1 }, { x: 0, y: 1 }].map(to => ({ kind: "line", to })) } } })));
  cases.push({ id: "concave-pin-mesh", mesh: fitted.meshWarp.spec.mesh });
  const fitCoordinates = new wasm.MeshCoordinateMap(JSON.stringify(fitted.shapeFitView.fit.mesh));
  try {
    for (const anchor of [{ x: 1 / 3, y: 2 / 3 }, { x: .5, y: .5 }, { x: 1, y: 0 }]) {
      const mapped = fitCoordinates.map_control(-2, 3, anchor.x, anchor.y, false);
      const reopened = fitCoordinates.map_control(mapped[0], mapped[1], anchor.x, anchor.y, true);
      assert(Math.hypot(reopened[0] + 2, reopened[1] - 3) < 1e-8, "Concave fitted control must reopen in the same face frame");
    }
    assert.equal(fitCoordinates.map(.8, .8, true).length, 0, "Concave notch must not snap to a nearby face");
    let overflowingControl;
    try { fitCoordinates.map_control(Number.MAX_VALUE, -Number.MAX_VALUE, .5, .5, false); }
    catch (error) { overflowingControl = JSON.parse(String(error)); }
    assert.equal(overflowingControl?.code, "E_SCHEMA", "Finite exterior inputs must not yield nonfinite successful controls");
    const recovered = fitCoordinates.map_control(-2, 3, .5, .5, false);
    const recoveredBack = fitCoordinates.map_control(recovered[0], recovered[1], .5, .5, true);
    assert(Math.hypot(recoveredBack[0] + 2, recoveredBack[1] - 3) < 1e-8);
  } finally { fitCoordinates.free(); }
  const exteriorInput = { ...base, mesh: planned.meshWarp.spec.mesh, path: {
    vertices: [{ x: .2, y: 0 }, { x: .8, y: 0 }, { x: .8, y: .5 }],
    segments: [{ start: 0, end: 1, tangentStart: { x: .2, y: -1e-16 }, tangentEnd: { x: -.2, y: -1e-16 } },
      { start: 1, end: 2 }, { start: 2, end: 0 }], regions: [{ windingRule: "EVENODD", loops: [[0, 1, 2]] }] } };
  let exteriorRefusal;
  try { wasm.vector_projection_json(JSON.stringify(exteriorInput)); } catch (error) { exteriorRefusal = JSON.parse(String(error)); }
  assert.equal(exteriorRefusal?.code, "E_SCHEMA", "A tiny exterior curve has no canonical mesh image");
  const dense = { ...base, mesh: { subdivisions: 32, boundary: "free",
    vertices: Array.from({ length: 33 * 33 }, (_, index) => {
      const source = { x: index % 33 / 32, y: Math.floor(index / 33) / 32 };
      const warped = { x: .01 + .98 * source.x, y: .01 + .98 * source.y };
      if (index === 16 * 33 + 16) { warped.x += .004; warped.y += .001; }
      return { source, warped };
    }) }, path: {
      vertices: Array.from({ length: 512 }, (_, index) => ({ x: .5 + .3 * Math.cos(index * Math.PI / 256), y: .5 + .3 * Math.sin(index * Math.PI / 256) })),
      segments: Array.from({ length: 512 }, (_, index) => ({ start: index, end: (index + 257) % 512 })),
      regions: [{ windingRule: "EVENODD", loops: [Array.from({ length: 512 }, (_, index) => index * 257 % 512)] }] } };
  // Broad-phase acceleration must admit this formerly scan-bound job without
  // relaxing output capacity, topology or the exact straight-edge semantics.
  const denseWire=wasm.vector_projection_json(JSON.stringify(dense)),denseOutput=JSON.parse(denseWire);
  assert.equal(denseOutput.report.inputVertices,512);assert.equal(denseOutput.network.regions.length,1);
  assert(denseOutput.network.vertices.length>512&&denseOutput.network.vertices.length<=32768);
  assert.equal(denseOutput.network.regions[0].loops[0].length,denseOutput.network.segments.length);
  const excessive={...dense,path:{vertices:Array.from({length:1024},(_,i)=>({x:.5+.3*Math.cos(i*Math.PI/512),y:.5+.3*Math.sin(i*Math.PI/512)})),
    segments:Array.from({length:1024},(_,i)=>({start:i,end:(i+513)%1024})),
    regions:[{windingRule:"EVENODD",loops:[Array.from({length:1024},(_,i)=>i*513%1024)]}]}};
  let denseRefusal;
  try{wasm.vector_projection_json(JSON.stringify(excessive));}catch(error){denseRefusal=JSON.parse(String(error));}
  assert.equal(denseRefusal?.code,"E_OUTPUT_LIMIT","Actual emitted capacity still refuses a wholly captured in-budget source");
  assert.equal(wasm.vector_projection_json(JSON.stringify(dense)),denseWire,"Next-call recovery keeps the complete admitted path exact");
  let sharpStroke;
  try {
    const output = JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...base, mesh: planned.meshWarp.spec.mesh,
      stroke: { weight: .04, cap: "NONE", join: "MITER", miterLimit: 4 } })));
    assert(output.report.maxError <= output.report.tolerancePx);
    sharpStroke = { status: "bounded", vertices: output.report.outputVertices };
  } catch (error) {
    const refusal = JSON.parse(String(error));
    assert.equal(refusal.code, "E_SCHEMA"); assert(refusal.message.includes("stroke outline self-intersects"));
    sharpStroke = { status: "refused", code: refusal.code, reason: "overlapping curved-junction outline" };
  }
  cases.push({ id: "pin-mesh-stroke", mesh: planned.meshWarp.spec.mesh,
    sources: [{ ...base, path: rounded, stroke: { weight: .01, cap: "NONE", join: "MITER", miterLimit: 4 } }] });
  const rotation = Math.SQRT1_2;
  const rotatedStroke = { ...base, mesh: planned.meshWarp.spec.mesh, path: rounded,
    sourceTransform: [rotation, -rotation, .5, rotation, rotation, .5 - rotation],
    sourceBounds: { x: .18, y: .18, width: .64, height: .64 },
    stroke: { weight: .01, cap: "NONE", join: "MITER", miterLimit: 4 } };
  const rotatedOutput = JSON.parse(wasm.vector_projection_json(JSON.stringify(rotatedStroke)));
  assert.equal(rotatedOutput.report.fidelity, "outlined");
  assert.equal(rotatedOutput.network.regions[1].loops.length, 2);
  assert(rotatedOutput.report.maxError <= rotatedOutput.report.tolerancePx);
  let rotatedRefusal;
  try { wasm.vector_projection_json(JSON.stringify({ ...rotatedStroke,
    sourceBounds: { x: .198, y: .198, width: .604, height: .604 } })); }
  catch (error) { rotatedRefusal = JSON.parse(String(error)); }
  assert.equal(rotatedRefusal?.code, "E_SCHEMA", "Actual exterior stroke must still refuse after the rotated-box repair");
  let timeMs = 0;
  const measurements = [];
  for (const test of cases) {
    const start = performance.now();
    const outputs = (test.sources ?? sources).map((source, index) => {
      try { return JSON.parse(wasm.vector_projection_json(JSON.stringify({ ...source, mesh: test.mesh }))); }
      catch (error) { throw new Error(`${test.id}/part ${index}: ${error}`); }
    });
    const elapsed = performance.now() - start; timeMs += elapsed;
    for (const output of outputs) {
      assert(output.report.maxError === undefined || output.report.maxError <= output.report.tolerancePx);
      assert.equal(output.network.regions.length, output.report.outputRegions);
      assert(output.network.vertices.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
    }
    if (test.id === "pin-mesh-stroke") {
      assert.equal(outputs[0].report.strokeOutlined, true);
      assert.equal(outputs[0].network.regions[1].loops.length, 2, "Closed stroke must retain its hole");
    }
    measurements.push({ id: test.id, parts: outputs.length, elapsedMs: +elapsed.toFixed(2),
      vertices: outputs.map(output => output.report.outputVertices), bytes: Buffer.byteLength(JSON.stringify(outputs)),
      maxError: Math.max(...outputs.map(output => output.report.maxError ?? 0)) });
    test.outputs = outputs;
  }
  profiles.push({ name, wasm, cases, measurements, timeMs, sharpStroke });
}
for (let i = 0; i < profiles[0].cases.length; i++) assert.deepEqual(profiles[0].cases[i], profiles[1].cases[i], "Full/Figma canonical profile drift");

// The Web export must actually invoke its built Rust module, not a local TS
// substitute. Check a positive moved mesh and a discriminating refusal.
let server, browser;
try {
  const test = profiles[0].cases.find(test => test.id === "pin-mesh");
  const input = { ...base, mesh: test.mesh };
  const expected = JSON.parse(profiles[0].wasm.vector_projection_json(JSON.stringify(input)));
  const html = `<!doctype html><title>Canonical vector mesh bridge</title><script type="module">
    import {planVectorProjection} from '/web/index.js';
    try {const result=await planVectorProjection(${JSON.stringify(input)});
      let rejected;try{await planVectorProjection({...${JSON.stringify(input)},version:'0.1'})}catch(error){rejected=error.code}
      globalThis.__WORLDBEND_PARITY__={ok:true,result,rejected};
    }catch(error){globalThis.__WORLDBEND_PARITY__={error:String(error.stack??error)}};</script>`;
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if (url.pathname === "/") { response.setHeader("Content-Type", "text/html"); response.end(html); return; }
      const prefix = path.join(root, "packages/web/dist") + path.sep;
      const file = path.resolve(prefix, url.pathname.slice("/web/".length));
      if (!url.pathname.startsWith("/web/") || !file.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : "text/javascript"); response.end(await readFile(file));
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await launchChrome(await findChrome()); const tab = await createPage(browser.debugUrl, url);
  const result = await readPageResult(tab.webSocketDebuggerUrl, { url, width: 820, height: 660, timeoutMs: 60000 });
  assert.equal(result.error, undefined, result.error); assert.equal(result.ok, true); assert.equal(result.rejected, "E_SCHEMA");
  assert.deepEqual(result.result, expected, "Built Web bridge differs from canonical WASM");
} finally {
  if (browser) await closeChrome(browser);
  if (server) await new Promise(resolve => server.close(resolve));
}
process.stdout.write(JSON.stringify({ ok: true, fixture: Boolean(fixtureArgument), bridge: "real-built-Web/WASM", profiles:
  profiles.map(profile => ({ profile: profile.name, timeMs: +profile.timeMs.toFixed(2), sharpStroke: profile.sharpStroke, measurements: profile.measurements })) }, null, 2) + "\n");

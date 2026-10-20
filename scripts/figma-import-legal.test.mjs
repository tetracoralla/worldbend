import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { writeFigmaLegalMaterial } from "./generate-plugin-legal.mjs";
import { figmaWasmModules, wasmProfile } from "./wasm-profiles.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("embedded Figma profiles keep the bounded parser separate from the designer", () => {
  assert.deepEqual(figmaWasmModules.map(entry => entry.profile), ["figma", "psd-import"]);
  const designer = wasmProfile("figma"), parser = wasmProfile("psd-import");
  assert.ok(designer.featureArguments.includes("--no-default-features"));
  assert.ok(!designer.featureArguments.join(",").includes("psd-import"));
  assert.deepEqual(parser.featureArguments, ["--no-default-features", "--features", "psd-import"]);
  assert.notEqual(designer.outputDirectory, parser.outputDirectory);
  parser.featureArguments.push("unexpected");
  assert.ok(!wasmProfile("psd-import").featureArguments.includes("unexpected"));
  assert.throws(() => wasmProfile("__proto__"), /Unknown WASM carrier profile/);
});

test("Figma legal inventory includes the actual import module's bundled source and full license", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "worldbend-figma-legal-"));
  try {
    const destination = path.join(temporary, "package");
    await writeFigmaLegalMaterial({ destination });
    const sbomText = await readFile(path.join(destination, "sbom/worldbend-figma-wasm.spdx.json"), "utf8");
    const sbom = JSON.parse(sbomText);
    const parser = sbom.packages.filter(pkg => pkg.name === "ag-psd");
    assert.equal(parser.length, 1, "the union must include the vendored parser exactly once");
    assert.equal(parser[0].versionInfo, "0.2.0");
    assert.equal(parser[0].licenseDeclared, "MIT");
    assert.equal(parser[0].downloadLocation, "NOASSERTION", "modified local source must not claim registry bytes");
    assert.ok(sbom.relationships.some(edge => edge.relatedSpdxElement === parser[0].SPDXID));
    const upstream = await readFile(path.join(root, "third_party/ag-psd/LICENSE"));
    assert.deepEqual(await readFile(path.join(destination, "licenses/ag-psd-0.2.0/LICENSE")), upstream);
    const notices = await readFile(path.join(destination, "THIRD_PARTY_NOTICES.md"), "utf8");
    assert.match(notices, /ag-psd 0\.2\.0.*licenses\/ag-psd-0\.2\.0\/LICENSE/);
    assert.match(notices, /PSD import/);
    assert.ok(sbom.packages.some(pkg => pkg.name === "fflate"));
    assert.equal(new Set(sbom.packages.map(pkg => pkg.SPDXID)).size, sbom.packages.length);
    for (const text of [sbomText, notices]) {
      assert.ok(!text.includes(root));
      assert.doesNotMatch(text, /(?:\/Users\/|\/Volumes\/|path\+file:)/);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

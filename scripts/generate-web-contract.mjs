import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { compile } from "json-schema-to-typescript";

import { normalizeLineEndings } from "./text-normalization.mjs";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedPath = path.join(
  workspaceRoot,
  "packages/web/src/generated/core-contract.ts",
);
const checkOnly = process.argv.includes("--check");

const cargo = spawnSync(
  "cargo",
  ["run", "--quiet", "-p", "worldbend-cli", "--bin", "worldbend", "--", "schema"],
  { cwd: workspaceRoot, encoding: "utf8" },
);

if (cargo.status !== 0) {
  process.stderr.write(cargo.stderr);
  process.exit(cargo.status ?? 1);
}

let schemaEnvelope;
try {
  schemaEnvelope = JSON.parse(cargo.stdout);
} catch {
  throw new Error("Worldbend schema did not return a JSON envelope");
}

const schema = schemaEnvelope?.result?.webContract;
if (schemaEnvelope?.ok !== true || !schema || typeof schema !== "object") {
  throw new Error("Worldbend schema did not include result.webContract");
}

const generated = await compile(schema, "WebContract", {
  additionalProperties: false,
  bannerComment: "// @generated from Rust core JSON Schema. Do not edit by hand.\n",
  style: { endOfLine: "lf", semi: true, singleQuote: false },
});
const canonicalGenerated = normalizeLineEndings(generated);

if (checkOnly) {
  // Git may materialize tracked text as CRLF on Windows. Compare canonical
  // text so checkout policy cannot masquerade as a schema change.
  const current = normalizeLineEndings(
    await readFile(generatedPath, "utf8").catch(() => ""),
  );
  if (current !== canonicalGenerated) {
    process.stderr.write(
      "Generated Web contract is stale. Run `pnpm contract:generate` and commit the result.\n",
    );
    process.exit(1);
  }
  process.stdout.write("Generated Web contract matches the Rust core schema.\n");
} else {
  await mkdir(path.dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, canonicalGenerated);
  process.stdout.write(`${path.relative(workspaceRoot, generatedPath)} updated.\n`);
}

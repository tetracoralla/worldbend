import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { compile } from "json-schema-to-typescript";

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
  style: { semi: true, singleQuote: false },
});

if (checkOnly) {
  const current = await readFile(generatedPath, "utf8").catch(() => "");
  if (current !== generated) {
    process.stderr.write(
      "Generated Web contract is stale. Run `pnpm contract:generate` and commit the result.\n",
    );
    process.exit(1);
  }
  process.stdout.write("Generated Web contract matches the Rust core schema.\n");
} else {
  await mkdir(path.dirname(generatedPath), { recursive: true });
  await writeFile(generatedPath, generated);
  process.stdout.write(`${path.relative(workspaceRoot, generatedPath)} updated.\n`);
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRootArgument = process.argv.indexOf("--plugin-root");
assert(
  pluginRootArgument === -1 || process.argv[pluginRootArgument + 1],
  "--plugin-root requires a path",
);
const pluginRoot =
  pluginRootArgument === -1
    ? path.join(root, "plugins", "worldbend")
    : path.resolve(process.argv[pluginRootArgument + 1]);
const resultArgument = process.argv.find((argument) =>
  argument.startsWith("--result-file="),
);
const resultFile =
  resultArgument === undefined
    ? null
    : path.resolve(resultArgument.slice("--result-file=".length));

const executableSuffix = process.platform === "win32" ? ".exe" : "";
const cli = path.join(pluginRoot, "bin", `worldbend${executableSuffix}`);
const documentsRoot = path.join(
  pluginRoot,
  "skills",
  "worldbend",
  "assets",
  "documents",
);

const documents = [
  {
    id: "entry",
    name: "brand-brief-document.worldbend.json",
    example: "examples/brand-brief-document.worldbend.json",
    expectedInitial:
      "sha256:1b32d1aba887ba20d5d761c07356a997d574074a51cbabfb9192185f1a495cac",
    expectedWeekly:
      "sha256:79ff831949896ce649c7a227386529a01840e740594e40245225694a5405d7bc",
  },
  {
    id: "multistage",
    name: "brand-brief-multistage-document.worldbend.json",
    example: "examples/brand-brief-multistage-document.worldbend.json",
    expectedInitial:
      "sha256:70f725fbf88c155b9a1bbc7479f8dae163ff65bc6aa9d0f004c9d0377a18fa4f",
    expectedWeekly:
      "sha256:b06cfbdf6b5d8992a531968897f09c83db1104b261e64f6c8a86f1277610c576",
  },
];

const version = runCli(["--version"]).trim();
assert.match(version, /^worldbend /, `unexpected staged CLI version: ${version}`);

const evidence = {
  schema: "worldbend.n3-20.installed-runtime-evidence",
  version: "0.1",
  pluginRoot: path.relative(root, pluginRoot) || ".",
  cli: path.relative(root, cli),
  cliVersion: version,
  developerOperationFilesUsed: false,
  marketplaceInstall: false,
  agentHostImport: false,
  documents: [],
};

const work = await mkdtemp(path.join(tmpdir(), "worldbend-n3-20-"));
try {
  for (const document of documents) {
    const installedPath = path.join(documentsRoot, document.name);
    const examplePath = path.join(root, document.example);
    const installedBytes = await readFile(installedPath);
    const exampleBytes = await readFile(examplePath);
    assert.equal(
      digest(installedBytes),
      digest(exampleBytes),
      `${document.name} installed asset must match examples twin`,
    );

    const documentJson = JSON.parse(installedBytes.toString("utf8"));
    const inspect = runCliJson([
      "document-inspect",
      "--spec",
      installedPath,
      "--json",
    ]);
    assert.equal(inspect.ok, true, `${document.id} inspect must succeed`);
    const fingerprint = inspect.result.fingerprint;
    assert.equal(fingerprint, document.expectedInitial, `${document.id} initial fingerprint`);

    const outputs = (inspect.result.expressions ?? [])
      .flatMap((expression) => expression.template?.outputs ?? [])
      .map((output) => output.id)
      .filter(Boolean);
    for (const required of [
      "website-presentation",
      "social-square",
      "social-wide",
    ]) {
      assert(
        outputs.includes(required),
        `${document.id} inspect missing ${required}: ${outputs.join(",")}`,
      );
    }

    const deliveryInput = {
      document: documentJson,
      expectedFingerprint: fingerprint,
    };
    const deliveryPath = path.join(work, `${document.id}-delivery.json`);
    await writeFile(deliveryPath, `${JSON.stringify(deliveryInput, null, 2)}\n`);
    const delivery = runCliJson([
      "document-delivery-plan",
      "--spec",
      deliveryPath,
      "--json",
    ]);
    assert.equal(delivery.ok, true, `${document.id} delivery must succeed`);
    assert.equal(
      delivery.result.documentFingerprint,
      fingerprint,
      `${document.id} delivery fingerprint`,
    );
    assert(
      Array.isArray(delivery.result.deliveries) &&
        delivery.result.deliveries.length >= 1,
      `${document.id} delivery must list work`,
    );

    const updateInput = {
      document: documentJson,
      expectedFingerprint: fingerprint,
      revisions: [
        {
          assetId: "product-screen",
          contentVersion: "week-02",
        },
      ],
    };
    const updatePath = path.join(work, `${document.id}-update.json`);
    await writeFile(updatePath, `${JSON.stringify(updateInput, null, 2)}\n`);
    const update = runCliJson([
      "document-update-plan",
      "--spec",
      updatePath,
      "--json",
    ]);
    assert.equal(update.ok, true, `${document.id} weekly update must succeed`);
    assert.equal(update.result.changed, true);
    assert.equal(
      update.result.previousFingerprint,
      fingerprint,
      `${document.id} previous fingerprint`,
    );
    assert.equal(
      update.result.fingerprint,
      document.expectedWeekly,
      `${document.id} weekly fingerprint`,
    );

    const weeklyDocument = update.result.document;
    const staleInput = {
      document: weeklyDocument,
      expectedFingerprint: fingerprint,
      revisions: [
        {
          assetId: "product-screen",
          contentVersion: "week-03",
        },
      ],
    };
    const stalePath = path.join(work, `${document.id}-stale.json`);
    await writeFile(stalePath, `${JSON.stringify(staleInput, null, 2)}\n`);
    const stale = runCliJson(
      ["document-update-plan", "--spec", stalePath, "--json"],
      { allowFailure: true },
    );
    assert.equal(stale.ok, false, `${document.id} stale must reject`);
    assert.equal(stale.error?.code, "E_SCHEMA", `${document.id} stale code`);
    assert.match(
      String(stale.error?.message ?? ""),
      /fingerprint mismatch/i,
      `${document.id} stale message`,
    );
    assert.equal(
      stale.error?.details?.expectedFingerprint,
      fingerprint,
      `${document.id} stale expected`,
    );
    assert.equal(
      stale.error?.details?.actualFingerprint,
      document.expectedWeekly,
      `${document.id} stale actual`,
    );

    evidence.documents.push({
      id: document.id,
      installedAsset: path.relative(root, installedPath),
      exampleTwin: document.example,
      contentSha256: digest(installedBytes),
      initialFingerprint: fingerprint,
      weeklyFingerprint: update.result.fingerprint,
      outputs,
      deliveryOk: true,
      updateChanged: true,
      staleRejected: true,
      staleRejection: {
        ok: false,
        code: stale.error.code,
        message: stale.error.message,
        expectedFingerprint: stale.error.details.expectedFingerprint,
        actualFingerprint: stale.error.details.actualFingerprint,
      },
    });
  }
} finally {
  await rm(work, { recursive: true, force: true });
}

const payload = `${JSON.stringify(evidence, null, 2)}\n`;
if (resultFile) {
  await mkdir(path.dirname(resultFile), { recursive: true });
  await writeFile(resultFile, payload);
}
process.stdout.write(payload);

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runCli(args, options = {}) {
  const result = spawnSync(cli, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${cli} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout || result.stderr || "";
}

function runCliJson(args, options = {}) {
  const result = spawnSync(cli, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout || "";
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    if (options.allowFailure) {
      return {
        ok: false,
        error: {
          code: "E_PARSE",
          message: stdout || String(error),
        },
      };
    }
    throw new Error(
      `${cli} ${args.join(" ")} returned non-JSON (${result.status}): ${stdout || result.stderr}`,
    );
  }
  if (result.status !== 0 && !options.allowFailure && parsed.ok !== false) {
    throw new Error(
      `${cli} ${args.join(" ")} failed (${result.status}): ${stdout || result.stderr}`,
    );
  }
  if (parsed.ok === false && !options.allowFailure) {
    throw new Error(
      `${cli} ${args.join(" ")} rejected: ${JSON.stringify(parsed.error ?? parsed)}`,
    );
  }
  return parsed;
}

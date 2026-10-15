import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { withAppearancePlanner } from "./appearance-planner-client.mjs";
const root = new URL(
  "../packages/scene-three/examples/paper-stage/",
  import.meta.url,
);
const editions = JSON.parse(
  await readFile(new URL("editions.json", root), "utf8"),
);
const document = JSON.parse(
  await readFile(new URL("document.json", root), "utf8"),
);
const version = async (file) =>
  "sha256:" +
  createHash("sha256")
    .update(await readFile(new URL(file, root)))
    .digest("hex");
await withAppearancePlanner(async (run) => {
  const inspection = await run("document_inspect", { spec: document });
  const cover = await run("document_update_plan", {
    document,
    expectedFingerprint: inspection.fingerprint,
    revisions: [
      {
        assetId: "field-notes",
        contentVersion: await version("assets/edition-2/cover.png"),
      },
    ],
  });
  const source = await run("document_update_plan", {
    document: cover.document,
    expectedFingerprint: cover.fingerprint,
    revisions: [
      { assetId: "paper-stage", contentVersion: editions["2"].scene },
    ],
  });
  const timedExpression = structuredClone(source.document.expressions[0]);
  timedExpression.scene.frameCount = 144;
  const timed = await run("document_update_plan", {
    document: source.document,
    expectedFingerprint: source.fingerprint,
    revisions: [],
    expressions: [timedExpression],
  });
  const results = {
    timed,
    initial: {
      document,
      inspection,
      delivery: await run("document_delivery_plan", {
        document,
        expectedFingerprint: inspection.fingerprint,
      }),
    },
    cover,
    source,
  };
  const authorVersions = [{ id: "01", title: "原始纸质舞台", document }];
  let authored = document;
  for (const edition of [2, 3]) {
    const expression = structuredClone(authored.expressions[0]);
    expression.scene.camera = editions[String(edition)].camera;
    expression.scene.animation = editions[String(edition)].animation;
    expression.scene.frameCount = edition === 2 ? 120 : 210;
    expression.scene.timebase = { numerator: edition === 2 ? 24 : 30, denominator: 1 };
    const base = await run("document_inspect", { spec: authored });
    const next = await run("document_update_plan", {
      document: authored, expectedFingerprint: base.fingerprint,
      revisions: [
        { assetId: "paper-stage", contentVersion: editions[String(edition)].scene },
        { assetId: "field-notes", contentVersion: editions[String(edition)].cover },
      ], expressions: [expression],
    });
    authored = next.document;
    authorVersions.push({ id: String(edition).padStart(2, "0"),
      title: edition === 2 ? "新版封面与五秒镜头" : "纸带新比例与七秒镜头", document: authored });
  }
  results["author-versions"] = authorVersions;
  for (const [name, value] of Object.entries(results)) {
    const file = new URL(name + ".json", root),
      text = JSON.stringify(value, null, 2) + "\n";
    if (process.argv.includes("--check"))
      assert.equal(
        await readFile(file, "utf8"),
        text,
        "Stale scene receipt " + name,
      );
    else await writeFile(file, text);
  }
  console.log(
    JSON.stringify({
      ok: true,
      initial: inspection.fingerprint,
      coverAffected: cover.affectedExpressions,
      sourceAffected: source.affectedExpressions,
    }),
  );
});

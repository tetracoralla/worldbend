import assert from "node:assert/strict";
import test from "node:test";
import {
  downstreamPage,
  staticCompositionDelivery,
} from "./composition-provider-chain-check.mjs";

function continuation() {
  const bindings = ["source-1", "source-2"].map((slotId) => ({
    role: "content",
    slotId,
    assetId: slotId,
  }));
  const template = {
    schema: "worldbend.spatial-template",
    version: "0.1",
    operation: { kind: "compositionProgram" },
    output: { kind: "single", id: "output" },
  };
  const job = {
    schema: "worldbend.variation-job",
    version: "0.1",
    template: structuredClone(template),
    items: [{ id: "figma-composition", bindings: bindings.map(({ slotId, assetId }) => ({ slotId, assetId })) }],
  };
  return {
    schema: "worldbend.figma-composition-continuation",
    version: "0.1",
    expressionId: "figma-composition",
    sourceBindings: [
      { slotId: "source-1", assetId: "source-1", sourceName: "First <source>", sourceNodeId: "1:2" },
      { slotId: "source-2", assetId: "source-2", sourceName: "Second", sourceNodeId: "1:3" },
    ],
    document: {
      schema: "worldbend.spatial-document",
      version: "0.1",
      assets: [{ id: "source-1" }, { id: "source-2" }],
      expressions: [{ kind: "static", id: "figma-composition", template, bindings }],
    },
    deliveryPlan: {
      schema: "worldbend.spatial-document-delivery-plan",
      version: "0.1",
      documentFingerprint: `sha256:${"a".repeat(64)}`,
      deliveries: [{ kind: "static", id: "figma-composition", bindings, job }],
    },
    losses: ["sourceMediaNotEmbedded"],
  };
}

test("accepts only the standard static Composition delivery", () => {
  const value = continuation();
  assert.equal(staticCompositionDelivery(value).job.schema, "worldbend.variation-job");
  assert.throws(
    () => staticCompositionDelivery({ ...value, expressionId: "other" }),
    /figma-composition/,
  );
  const changedJob = structuredClone(value);
  changedJob.deliveryPlan.deliveries[0].job.template.output.id = "other-output";
  assert.throws(
    () => staticCompositionDelivery(changedJob),
    /job template must match/,
  );
  const changedSource = structuredClone(value);
  changedSource.sourceBindings[0].assetId = "source-2";
  assert.throws(
    () => staticCompositionDelivery(changedSource),
    /source bindings must match/,
  );
});

test("builds a downstream page that reads state and rendered artifacts", () => {
  const page = downstreamPage({
    continuation: continuation(),
    imagePaths: ["./artifacts/item/output.png"],
  });
  assert.match(page, /Provider-chain validation, not a formal Procedure/);
  assert.match(page, /spatial-document\.json/);
  assert.match(page, /delivery-plan\.json/);
  assert.match(page, /artifacts\/item\/output\.png/);
  assert.match(page, /First &lt;source&gt;/);
  assert.match(page, /worldbendReady/);
});

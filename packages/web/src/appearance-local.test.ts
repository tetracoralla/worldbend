import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  CLARITY_MAPPING_VERSION,
  appearanceDeliveryFingerprint,
  canonicalSerialize,
  clarityToRadius,
  compileWebAppearance,
  effectiveOverrides,
  evaluateAppearanceDelivery,
  resolvePreferenceLocally,
  sha256Hex,
} from "./appearance-local";
import type { AppearanceDeliveryPlan, GlassMaterial } from "./generated/core-contract";
import fixture from "./generated/appearance-parity.json";

const parity = fixture as unknown as {
  recipe: { recipeId: string; recipeVersion: number; material: GlassMaterial };
  plans: { material: GlassMaterial; plan: AppearanceDeliveryPlan }[];
  preference: {
    schema: string; version: string; revision: number;
    fields: Record<string, { value: number | boolean; actor: "user" | "agent" }>;
  };
  resolvedNoPolicy: {
    material: GlassMaterial; delivery: AppearanceDeliveryPlan; preferenceRevision: number;
    receipts: { field: string; state: string; reason: string }[];
  };
  resolvedWithPolicy: {
    material: GlassMaterial; delivery: AppearanceDeliveryPlan;
    receipts: { field: string; state: string; reason: string }[];
  };
  exposure: Parameters<typeof resolvePreferenceLocally>[2];
  colorExposure: Parameters<typeof resolvePreferenceLocally>[2];
  colorPreference: { material: GlassMaterial; delivery: AppearanceDeliveryPlan; receipts: { field: string; state: string }[] };
};

describe("sha256Hex", () => {
  it("matches node crypto over canonical text samples", () => {
    for (const sample of ["", "worldbend", JSON.stringify(parity.recipe), canonicalSerialize(parity.plans[0]!.material)]) {
      expect(sha256Hex(sample)).toBe(createHash("sha256").update(sample, "latin1").digest("hex"));
    }
  });
});

describe("canonicalSerialize", () => {
  it("sorts keys, normalizes -0 and mirrors serde_json float text", () => {
    expect(canonicalSerialize({ b: 1, a: 2 })).toBe('{"a":2.0,"b":1.0}');
    expect(canonicalSerialize({ x: -0 })).toBe('{"x":0.0}');
    expect(canonicalSerialize({ a: 1e-5, b: 1e-6, c: 1e16, d: 12, e: 0.35, f: 9.9e-7, g: 1.2345678901234568e16 }))
      .toBe('{"a":0.00001,"b":1e-6,"c":1e+16,"d":12.0,"e":0.35,"f":9.9e-7,"g":1.2345678901234568e+16}');
    expect(canonicalSerialize([2, { y: true, x: null }])).toBe("[2.0,{\"x\":null,\"y\":true}]");
  });
});

describe("local Web compile parity", () => {
  const base = parity.plans[0]!.plan;

  // JSON.stringify cannot carry -0, so the fixture's stored direction loses
  // the sign the live MCP JSON does keep; compare at the value level.
  // Transcendental results can also differ by one ulp between libm
  // implementations (system libm vs V8's fdlibm port): identity fingerprints
  // and every formatted string stay exact, and 15 significant digits absorb
  // that last-ulp variance in the numeric direction receipt.
  const withoutNegativeZero = (value: unknown): unknown =>
    typeof value === "number" && Object.is(value, -0) ? 0
    : Array.isArray(value) ? value.map(withoutNegativeZero)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).map(([key, item]) =>
          [key, key === "direction" && Array.isArray(item) ? item.map((axis: number) => Number(axis.toPrecision(15))) : withoutNegativeZero(item)]))
      : value;

  it("reproduces every canonical receipt exactly, including fingerprints", () => {
    expect(parity.plans.length).toBeGreaterThanOrEqual(25);
    for (const { material, plan } of parity.plans) {
      const profileBase = parity.plans.find(row=>row.plan.target===plan.target)!.plan;
      const local = evaluateAppearanceDelivery(profileBase, material);
      expect(local.fingerprint).toBe(plan.fingerprint);
      expect(withoutNegativeZero(local.web)).toEqual(withoutNegativeZero(plan.web));
      expect(withoutNegativeZero(local.material)).toEqual(withoutNegativeZero(material));
    }
  });

  it("exposes the compile directly for parity smoke checks", () => {
    for(const plan of [parity.plans[0]!.plan,parity.plans.find(row=>row.plan.target==='web-color-preserving')!.plan]) {
      expect(withoutNegativeZero(compileWebAppearance(plan.material,plan.target==='web-color-preserving'))).toEqual(withoutNegativeZero(plan.web));
    }
  });
});

describe("local preference resolution parity", () => {
  const base = parity.plans[0]!.plan;

  it("keeps the color-preserving profile while evaluating explicit preferences", () => {
    const colorBase=parity.plans.find(row=>row.plan.target==='web-color-preserving')!.plan;
    const local=resolvePreferenceLocally(colorBase,parity.preference as never,parity.colorExposure as never);
    expect(local.delivery.fingerprint).toBe(parity.colorPreference.delivery.fingerprint);
    expect(local.material).toEqual(parity.colorPreference.material);
    expect(local.receipts.map(r=>[r.field,r.state])).toEqual(parity.colorPreference.receipts.map(r=>[r.field,r.state]));
    expect(local.delivery.web!.backdropFilter).toBe('blur(1px)');
    expect(local.delivery.web!.couplings).toEqual([]);
    expect(()=>resolvePreferenceLocally(colorBase,parity.preference as never,parity.exposure as never)).toThrow('target must match');
  });

  it("matches the canonical no-policy resolution", () => {
    const local = resolvePreferenceLocally(base, parity.preference as never);
    expect(local.delivery.fingerprint).toBe(parity.resolvedNoPolicy.delivery.fingerprint);
    expect(local.material).toEqual(parity.resolvedNoPolicy.material);
    expect(local.receipts.map(r => [r.field, r.state])).toEqual(
      parity.resolvedNoPolicy.receipts.map(r => [r.field, r.state]),
    );
  });

  it("matches the canonical policy-filtered resolution", () => {
    const local = resolvePreferenceLocally(base, parity.preference as never, parity.exposure as never);
    expect(local.delivery.fingerprint).toBe(parity.resolvedWithPolicy.delivery.fingerprint);
    expect(local.material).toEqual(parity.resolvedWithPolicy.material);
    const canonicalHidden = parity.resolvedWithPolicy.receipts
      .filter(receipt => receipt.state === "not-exposed")
      .map(receipt => receipt.field);
    const localHidden = local.receipts
      .filter(receipt => receipt.state === "not-exposed")
      .map(receipt => receipt.field);
    expect(localHidden).toEqual(canonicalHidden);
    // Hidden fields keep the base value in the effective material, not the
    // saved override.
    expect(local.material.depth).toBe(base.material.depth);
  });
});

describe("clarity composite", () => {
  it("maps 1 to the clearest end and 0 to the most solid end", () => {
    expect(clarityToRadius(1, 4, 40)).toBe(4);
    expect(clarityToRadius(0, 4, 40)).toBe(40);
    expect(clarityToRadius(0.5, 4, 40)).toBe(22);
    expect(() => clarityToRadius(1.01, 0, 40)).toThrow();
    expect(CLARITY_MAPPING_VERSION).toBe("1");
  });

  it("a clarity-only policy keeps radius overrides applied, and hidden without the composite", () => {
    const pinned = parity.exposure!;
    const clarityOnly = {
      ...pinned,
      controls: pinned.controls.map(row =>
        row.field === "radius" ? { ...row, state: "not-exposed" } : row),
    } as typeof pinned;
    const applied = effectiveOverrides(parity.preference as never, clarityOnly);
    expect(applied.applied).toContain("radius");
    expect(applied.receipts.find(receipt => receipt.field === "radius")?.reason)
      .toContain("clarity composite");
    // Depth has no composite carrying it: stays hidden under this policy.
    expect(applied.applied).not.toContain("depth");
    const locked = {
      ...clarityOnly,
      controls: clarityOnly.controls.map(row =>
        row.field === "clarity" ? { ...row, state: "not-exposed" } : row),
    } as typeof pinned;
    expect(effectiveOverrides(parity.preference as never, locked).applied)
      .not.toContain("radius");
  });
});

describe("appearanceDeliveryFingerprint", () => {
  it("binds recipe identity, values and target", () => {
    const material = parity.plans[0]!.material;
    const fingerprint = appearanceDeliveryFingerprint("sha256:" + "a".repeat(64), material, "web");
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    const changed = appearanceDeliveryFingerprint("sha256:" + "a".repeat(64), { ...material, radius: material.radius + 1 }, "web");
    expect(changed).not.toBe(fingerprint);
  });
});

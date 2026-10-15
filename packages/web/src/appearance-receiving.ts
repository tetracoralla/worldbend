import { attachAppearance } from "./appearance";
import type { AppearanceHandle, AppearanceOptions } from "./appearance";
import {
  clarityToRadius,
  resolvePreferenceLocally,
} from "./appearance-local";
import type { GlassFieldId, PreferenceFieldReceipt } from "./appearance-local";
import type {
  AppearanceDeliveryPlan,
  AppearanceExposureReport,
  AppearancePreferenceRecord,
  AppearanceUpdatePlan,
} from "./generated/core-contract";
export type { AppearanceDeliveryPlan, AppearanceUpdatePlan } from "./generated/core-contract";
export type { AppearanceExposureReport, AppearancePreferenceRecord } from "./generated/core-contract";

/** One proposed change on its way through preview to commit. */
export interface AppearanceOverrideChange {
  field: GlassFieldId;
  value: boolean | number;
  actor: "user" | "agent";
}

export interface AppearanceCandidate {
  /** The full record the candidate would commit, with its next revision. */
  record: AppearancePreferenceRecord;
  /** Locally evaluated display: no MCP or model call is involved. */
  delivery: AppearanceDeliveryPlan;
  receipts: PreferenceFieldReceipt[];
}

export interface AppearancePreferenceState {
  /** Committed record; revision 0 means no override has ever been committed. */
  record: AppearancePreferenceRecord;
  /** Candidate revision currently previewed, if any. */
  candidateRevision: number | null;
  /** Fingerprint of the pinned exposure report guiding this session. */
  policyFingerprint: string | null;
}

export interface AppearanceGroup {
  /** A detached clone for Agent planning; source and local state are distinct. */
  getState(): { sourceFingerprint: string; delivery: AppearanceDeliveryPlan | null; preservedProperties: string[][]; preference: AppearancePreferenceState };
  /** Apply a canonical appearance_update plan. Stale or foreign plans throw
   * before mutation. Consumer-path plans (explicit preferenceRevision) also
   * take the new source delivery the plan was prepared against: overrides
   * are absolute values over the source, so later tuning and resets must
   * evaluate against it, not against the plan's merged display. */
  update(plan: AppearanceUpdatePlan, source?: AppearanceDeliveryPlan): void;
  /** Apply a canonical project-local material adjustment without advancing the source. */
  updateLocal(plan: AppearanceDeliveryPlan): void;
  /** Preview explicit overrides locally. Replaces any pending candidate; throws
   * on fields the pinned policy does not expose, with the report's reason. */
  propose(changes: readonly AppearanceOverrideChange[]): AppearanceCandidate;
  /** Persist the pending candidate as the committed preference. */
  commitCandidate(): AppearancePreferenceRecord;
  /** Drop the preview and restore the committed evaluation, not an older snapshot. */
  cancelPreview(): void;
  /** Remove overrides (all when omitted): reveals current source defaults and
   * keeps every other override intact. */
  resetOverrides(fields?: readonly GlassFieldId[]): AppearancePreferenceRecord;
  setVisible(visible: boolean | undefined): void;
  /** Remove the material locally; subsequent source revisions preserve removal. */
  remove(): void;
  destroy(): void;
}

const PREFERENCE_SCHEMA = "worldbend.appearance-preference@0.1" as const;

function emptyRecord(): AppearancePreferenceRecord {
  return { schema: PREFERENCE_SCHEMA, version: "0.1", revision: 0, fields: {} };
}

function recordWithRevision(record: AppearancePreferenceRecord, revision: number): AppearancePreferenceRecord {
  return { ...structuredClone(record), revision };
}

/** Shared material configuration over the project's existing components.
 * Canonical core plans own the three-way material merge. This binding owns
 * receipt ordering and DOM lifecycle; it never derives optical parameters.
 * Live tuning evaluates locally through the parity-checked mirror, so no
 * frame goes through an Agent or MCP request.
 */
export function attachAppearanceGroup(
  elements: readonly HTMLElement[], initial: AppearanceDeliveryPlan, options: AppearanceOptions & {
    /** Restored committed preference (offline restore/migration input). */
    preference?: AppearancePreferenceRecord;
    /** Pinned exposure report; guards propose() against policy-hidden fields. */
    exposure?: AppearanceExposureReport;
  } = {},
): AppearanceGroup {
  const surfaces = [...elements];
  if (!surfaces.length || new Set(surfaces).size !== surfaces.length) throw new Error("Appearance group needs distinct surfaces");
  const origin = structuredClone(initial);
  if ((origin.target !== "web" && origin.target !== "web-color-preserving") || !/^sha256:[0-9a-f]{64}$/.test(origin.fingerprint)) throw new Error("Invalid source appearance receipt");
  const exposure = options.exposure ?? null;
  if (exposure && exposure.target !== origin.target) throw new Error("Exposure report target must match the receiving profile");
  let committed: AppearancePreferenceRecord = options.preference
    ? structuredClone(options.preference)
    : emptyRecord();
  if (committed.schema !== PREFERENCE_SCHEMA || committed.version !== "0.1"
    || !Number.isInteger(committed.revision) || committed.revision < 0
    || (committed.revision === 0 && Object.keys(committed.fields ?? {}).length > 0)) {
    throw new Error("Invalid preference record; keep worldbend.appearance-preference@0.1 with a consistent revision");
  }
  committed = { ...committed, fields: committed.fields ?? {} };
  let sourceBase: AppearanceDeliveryPlan = structuredClone(origin);
  let delivery: AppearanceDeliveryPlan | null;
  {
    const resolved = resolvePreferenceLocally(origin, { ...committed, fields: committed.fields ?? {} }, exposure);
    delivery = resolved.delivery;
  }
  let sourceFingerprint = initial.fingerprint;
  let candidate: AppearanceCandidate | null = null;
  let destroyed = false;
  let handles: AppearanceHandle[] = [];
  try { for (const element of surfaces) handles.push(attachAppearance(element, delivery, options)); }
  catch (error) { for (const handle of handles) handle.destroy(); throw error; }

  const active = () => { if (destroyed) throw new Error("Appearance group is destroyed"); };
  const compatible = (next: AppearanceDeliveryPlan) => {
    if (next.schema !== origin.schema || next.version !== origin.version || next.target !== origin.target ||
      next.recipeId !== origin.recipeId || !/^sha256:[0-9a-f]{64}$/.test(next.fingerprint) ||
      !Number.isInteger(next.recipeVersion) || next.recipeVersion < (delivery?.recipeVersion ?? origin.recipeVersion)) {
      throw new Error("Incompatible appearance receipt");
    }
  };
  function apply(next: AppearanceDeliveryPlan) {
    // Every handle validates the same plan before its scheduled paint. No
    // application content, nodes, listeners or layout are replaced.
    for (const handle of handles) handle.update(next);
    delivery = next;
  }
  function remove() { for (const handle of handles) handle.destroy(); handles = []; delivery = null; }
  const guardTunable = (field: GlassFieldId) => {
    if (!exposure) return;
    const row = exposure.controls.find(control => control.field === field);
    if (!row) throw new Error(`Field ${field} has no row in the pinned exposure report`);
    // The clarity composite owns frost: a clarity-only policy still allows
    // radius overrides saved through that composite.
    const carriedByClarity = field === "radius"
      && row.state === "not-exposed"
      && exposure.controls.some(control => control.field === "clarity" && control.state === "exposed")
      && exposure.clarity?.mapsTo === "radius";
    if ((row.state === "not-exposed" || row.state === "unsupported") && !carriedByClarity) {
      throw new Error(`Field ${field} is ${row.state} on this target: ${row.reason}`);
    }
  };
  const evaluate = (record: AppearancePreferenceRecord): AppearanceCandidate => {
    if (!sourceBase || !delivery) throw new Error("A locally removed appearance needs explicit reattachment before tuning");
    const resolved = resolvePreferenceLocally(sourceBase, record, exposure);
    compatible(resolved.delivery);
    return { record, delivery: resolved.delivery, receipts: resolved.receipts };
  };

  return {
    getState: () => ({ sourceFingerprint, delivery: delivery && structuredClone(delivery),
      preservedProperties: handles.map(handle => [...handle.preservedProperties]),
      preference: {
        record: structuredClone(committed),
        candidateRevision: candidate ? candidate.record.revision : null,
        policyFingerprint: exposure ? exposure.fingerprint : null,
      } }),
    update(plan, source) {
      active();
      if (candidate) throw new Error("A pending preview must be applied or cancelled before a source update; reread the current preference");
      if (plan.schema !== "worldbend.appearance-update@0.1" || plan.version !== "0.1" ||
        plan.previousFingerprint !== sourceFingerprint ||
        !Object.hasOwn(plan, "delivery") || !Object.hasOwn(plan, "previousDeliveryFingerprint") ||
        plan.previousDeliveryFingerprint !== (delivery?.fingerprint ?? null) ||
        !/^sha256:[0-9a-f]{64}$/.test(plan.sourceFingerprint) ||
        (plan.delivery !== null && (typeof plan.delivery !== "object" || !plan.delivery))) {
        throw new Error("Stale or invalid appearance update; reread the accepted source");
      }
      const planPreferenceRevision = plan.preferenceRevision ?? 0;
      if (planPreferenceRevision !== committed.revision) {
        throw new Error(planPreferenceRevision < committed.revision
          ? "Stale preference proposal; a newer human edit was committed. Reread the current preference and retry"
          : "Foreign preference proposal; it was prepared against a preference this session never committed");
      }
      let nextSourceBase: AppearanceDeliveryPlan | null = null;
      if (plan.preferenceRevision != null) {
        // Consumer path: the plan's merged delivery only shows the current
        // effective state. Keep the pure new source as the evaluation base so
        // a later reset reveals the new source default instead of the
        // previous override value.
        if (!source || typeof source !== "object") throw new Error("A consumer update needs the new source delivery; reread the plan and the source together");
        compatible(source);
        if (source.fingerprint !== plan.sourceFingerprint ||
          (plan.delivery != null && (source.recipeFingerprint !== plan.delivery.recipeFingerprint || source.recipeVersion !== plan.delivery.recipeVersion))) {
          throw new Error("Stale or invalid appearance update; the delivered source does not match the plan");
        }
        nextSourceBase = structuredClone(source);
      }
      const next = plan.delivery === null ? null : structuredClone(plan.delivery);
      if (next) {
        if (!delivery) throw new Error("A locally removed appearance needs explicit reattachment");
        compatible(next); apply(next);
        if (plan.preferenceRevision == null) nextSourceBase = next;
      } else remove();
      // Commit the evaluation base only after the entire delivered update
      // passed validation and application. A rejected plan is not a revision.
      if (nextSourceBase) sourceBase = nextSourceBase;
      sourceFingerprint = plan.sourceFingerprint;
      // The plan already merged the committed preference; any preview it was
      // not prepared against was rejected by the CAS above.
      candidate = null;
    },
    updateLocal(plan) {
      active();
      if (candidate) throw new Error("A pending preview must be applied or cancelled before a local designer edit");
      compatible(plan);
      if (committed.revision > 0) throw new Error("A preference-tuned session commits overrides through propose/commit; local designer edits need a fresh session");
      if (!delivery || plan.recipeFingerprint !== delivery.recipeFingerprint || plan.recipeVersion !== delivery.recipeVersion) {
        throw new Error("A local edit must keep the accepted recipe");
      }
      apply(structuredClone(plan));
    },
    propose(changes) {
      active();
      if (!changes.length) throw new Error("A proposal needs at least one override change");
      const base = candidate ? candidate.record : committed;
      const fields = structuredClone(base.fields ?? {});
      for (const change of changes) {
        guardTunable(change.field);
        fields[change.field] = { value: change.value, actor: change.actor };
      }
      const record: AppearancePreferenceRecord = { schema: PREFERENCE_SCHEMA, version: "0.1", revision: base.revision + 1, fields };
      const evaluated = evaluate(record);
      apply(evaluated.delivery);
      candidate = evaluated;
      return structuredClone(evaluated);
    },
    commitCandidate() {
      active();
      if (!candidate) throw new Error("No preference candidate to commit");
      committed = candidate.record;
      candidate = null;
      return structuredClone(committed);
    },
    cancelPreview() {
      active();
      if (!candidate) return;
      candidate = null;
      // Restore the latest committed evaluation, never an older snapshot:
      // someone else's committed edit stays in effect.
      const restored = evaluate(committed);
      apply(restored.delivery);
    },
    resetOverrides(fields) {
      active();
      const next = structuredClone(committed);
      if (fields && fields.length) {
        const drop = new Set(fields);
        for (const field of drop) if (!(field in (next.fields ?? {}))) throw new Error(`No committed override for ${field}`);
        next.fields = Object.fromEntries(Object.entries(next.fields ?? {}).filter(([field]) => !drop.has(field as GlassFieldId)));
      } else next.fields = {};
      next.revision = committed.revision + 1;
      committed = next;
      candidate = null;
      const restored = evaluate(committed);
      apply(restored.delivery);
      return structuredClone(committed);
    },
    setVisible(visible) { active(); for (const handle of handles) handle.setVisible(visible); },
    remove() { active(); candidate = null; remove(); },
    destroy() { if (destroyed) return; destroyed = true; remove(); },
  };
}

export { clarityToRadius };

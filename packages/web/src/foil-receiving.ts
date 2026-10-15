import { attachFoil, validateFoilDelivery } from './foil';
import type { FoilHandle, FoilOptions } from './foil';
import type { FoilDeliveryPlan, FoilUpdatePlan } from './generated/core-contract';
export type { FoilDeliveryPlan, FoilUpdatePlan } from './generated/core-contract';

export interface FoilGroup {
  getState(): { sourceFingerprint: string; delivery: FoilDeliveryPlan | null };
  update(plan: FoilUpdatePlan): void;
  updateLocal(plan: FoilDeliveryPlan): void;
  setPaused(paused: boolean): void;
  setVisible(visible: boolean | undefined): void;
  remove(): void;
  destroy(): void;
}

/** A shared configuration over existing components. The canonical update
 * merges source and local material; this binding guards receipt ordering.
 * Pause and visibility are host state and survive design revisions.
 */
export async function attachFoilGroup(elements: readonly HTMLElement[], initial: FoilDeliveryPlan, options: FoilOptions = {}): Promise<FoilGroup> {
  const surfaces = [...elements];
  if (!surfaces.length || new Set(surfaces).size !== surfaces.length) throw new Error('Foil group needs distinct surfaces');
  validateFoilDelivery(initial);
  let handles: FoilHandle[] = [], delivery: FoilDeliveryPlan | null = structuredClone(initial);
  let sourceFingerprint = initial.fingerprint, destroyed = false;
  try { for (const element of surfaces) handles.push(await attachFoil(element,initial,options)); }
  catch (error) { for (const handle of handles) handle.destroy(); throw error; }
  function destroy() {
    if (!destroyed) { remove(); destroyed = true; options.signal?.removeEventListener('abort',destroy); }
  }
  options.signal?.addEventListener('abort',destroy,{once:true});
  if (options.signal?.aborted) { destroy(); throw new DOMException('Foil group attachment cancelled','AbortError'); }
  const active = () => { if (destroyed) throw new Error('Foil group is destroyed'); };
  function compatible(next: FoilDeliveryPlan) {
    validateFoilDelivery(next);
    if (next.recipeId !== initial.recipeId || next.target !== initial.target || next.kernel.source !== initial.kernel.source) throw new Error('Foil update needs the same recipe, target and kernel');
  }
  function apply(next: FoilDeliveryPlan) {
    if (handles.some(handle => handle.getState().status === 'destroyed')) throw new Error('Foil group contains a disposed surface');
    // The whole plan and all handles are checked before the first mutation.
    for (const handle of handles) handle.update(next);
    delivery = next;
  }
  function remove() { for (const handle of handles) handle.destroy(); handles = []; delivery = null; }
  return {
    getState: () => ({sourceFingerprint,delivery:delivery && structuredClone(delivery)}),
    update(plan) {
      active();
      if (plan.schema !== 'worldbend.foil-update@0.1' || plan.version !== '0.1' ||
          plan.previousFingerprint !== sourceFingerprint || !Object.hasOwn(plan,'delivery') ||
          !Object.hasOwn(plan,'previousDeliveryFingerprint') || plan.previousDeliveryFingerprint !== (delivery?.fingerprint ?? null) ||
          !/^sha256:[0-9a-f]{64}$/.test(plan.sourceFingerprint)) throw new Error('Stale or invalid Foil update; reread accepted source and local state');
      const next = plan.delivery === null ? null : structuredClone(plan.delivery);
      if (next) { if (!delivery) throw new Error('Locally removed Foil needs explicit reattachment'); compatible(next); apply(next); }
      else remove();
      sourceFingerprint = plan.sourceFingerprint;
    },
    updateLocal(plan) {
      active(); compatible(plan);
      if (!delivery || plan.recipeFingerprint !== delivery.recipeFingerprint || plan.recipeVersion !== delivery.recipeVersion) throw new Error('A local Foil edit must keep the accepted seed');
      apply(structuredClone(plan));
    },
    setPaused(value) { active(); for (const handle of handles) handle.setPaused(value); },
    setVisible(value) { active(); for (const handle of handles) handle.setVisible(value); },
    remove() { active(); remove(); },
    destroy,
  };
}

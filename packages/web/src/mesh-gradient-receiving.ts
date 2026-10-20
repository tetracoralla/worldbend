import { attachMeshGradient, validateMeshGradientDelivery } from './mesh-gradient';
import type { MeshGradientHandle, MeshGradientOptions } from './mesh-gradient';
import type { MeshGradientDeliveryPlan, MeshGradientUpdatePlan } from './generated/core-contract';
export type { MeshGradientDeliveryPlan, MeshGradientUpdatePlan } from './generated/core-contract';

export interface MeshGradientGroup {
  getState(): { sourceFingerprint: string; delivery: MeshGradientDeliveryPlan | null };
  update(plan: MeshGradientUpdatePlan): void;
  updateLocal(plan: MeshGradientDeliveryPlan): void;
  setPaused(paused: boolean): void;
  setVisible(visible: boolean | undefined): void;
  remove(): void;
  destroy(): void;
}

/** A shared configuration over existing components. The canonical update
 * merges source and local material; this binding guards receipt ordering.
 * Pause and visibility are host state and survive design revisions.
 */
export async function attachMeshGradientGroup(elements: readonly HTMLElement[], initial: MeshGradientDeliveryPlan, options: MeshGradientOptions = {}): Promise<MeshGradientGroup> {
  const surfaces = [...elements];
  if (!surfaces.length || new Set(surfaces).size !== surfaces.length) throw new Error('Mesh-gradient group needs distinct surfaces');
  validateMeshGradientDelivery(initial);
  let handles: MeshGradientHandle[] = [], delivery: MeshGradientDeliveryPlan | null = structuredClone(initial);
  let sourceFingerprint = initial.fingerprint, destroyed = false;
  try { for (const element of surfaces) handles.push(await attachMeshGradient(element,initial,options)); }
  catch (error) { for (const handle of handles) handle.destroy(); throw error; }
  function destroy() {
    if (!destroyed) { remove(); destroyed = true; options.signal?.removeEventListener('abort',destroy); }
  }
  options.signal?.addEventListener('abort',destroy,{once:true});
  if (options.signal?.aborted) { destroy(); throw new DOMException('Mesh-gradient group attachment cancelled','AbortError'); }
  const active = () => { if (destroyed) throw new Error('Mesh-gradient group is destroyed'); };
  function compatible(next: MeshGradientDeliveryPlan) {
    validateMeshGradientDelivery(next);
    if (next.recipeId !== initial.recipeId || next.target !== initial.target) throw new Error('Mesh-gradient update needs the same recipe and target');
  }
  function apply(next: MeshGradientDeliveryPlan) {
    if (handles.some(handle => handle.getState().status === 'destroyed')) throw new Error('Mesh-gradient group contains a disposed surface');
    // The whole plan and all handles are checked before the first mutation.
    for (const handle of handles) handle.update(next);
    delivery = next;
  }
  function remove() { for (const handle of handles) handle.destroy(); handles = []; delivery = null; }
  return {
    getState: () => ({sourceFingerprint,delivery:delivery && structuredClone(delivery)}),
    update(plan) {
      active();
      if (plan.schema !== 'worldbend.mesh-gradient-update@0.1' || plan.version !== '0.1' ||
          plan.previousFingerprint !== sourceFingerprint || !Object.hasOwn(plan,'delivery') ||
          !Object.hasOwn(plan,'previousDeliveryFingerprint') || plan.previousDeliveryFingerprint !== (delivery?.fingerprint ?? null) ||
          !/^sha256:[0-9a-f]{64}$/.test(plan.sourceFingerprint)) throw new Error('Stale or invalid Mesh-gradient update; reread accepted source and local state');
      const next = plan.delivery === null ? null : structuredClone(plan.delivery);
      if (next) { if (!delivery) throw new Error('Locally removed mesh-gradient needs explicit reattachment'); compatible(next); apply(next); }
      else remove();
      sourceFingerprint = plan.sourceFingerprint;
    },
    updateLocal(plan) {
      active(); compatible(plan);
      if (!delivery || plan.recipeFingerprint !== delivery.recipeFingerprint || plan.recipeVersion !== delivery.recipeVersion || plan.kernel.id !== delivery.kernel.id) throw new Error('A local mesh-gradient edit must keep the accepted seed and renderer');
      apply(structuredClone(plan));
    },
    setPaused(value) { active(); for (const handle of handles) handle.setPaused(value); },
    setVisible(value) { active(); for (const handle of handles) handle.setVisible(value); },
    remove() { active(); remove(); },
    destroy,
  };
}

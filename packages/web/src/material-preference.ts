import { initializeWorldbend, evaluateMaterialPreference } from './bridge';
import { attachTexture, type TextureHandle, type TextureOptions } from './texture';
import { attachFoil, type FoilHandle, type FoilOptions } from './foil';
import { attachMeshGradient, type MeshGradientHandle, type MeshGradientOptions } from './mesh-gradient';
import type { MaterialPreferenceInput, MaterialPreferenceOutput, MaterialPreferenceValue, TextureField, FoilField, MeshGradientField, AppearanceOverrideActor } from './generated/core-contract';
export type { MaterialPreferenceInput, MaterialPreferenceOutput, MaterialPreferenceValue } from './generated/core-contract';
type Field = TextureField | FoilField | MeshGradientField;
export type MaterialPreferenceChanges = Partial<Record<Field, MaterialPreferenceValue | null>>;
export interface MaterialPreferenceGuard {
  sourceFingerprint: string; policyFingerprint: string; policyRevision: number;
  preferenceFingerprint: string; preferenceRevision: number; runtime: string; scope: string; draftRevision: number;
}
export interface MaterialPreferenceSession {
  getState(): { input: MaterialPreferenceInput; output: MaterialPreferenceOutput; preview: MaterialPreferenceOutput | null; guard: MaterialPreferenceGuard; previewing: boolean; status: string };
  preview(changes: MaterialPreferenceChanges, guard: MaterialPreferenceGuard, actor?: AppearanceOverrideActor): void;
  applyPreview(guard: MaterialPreferenceGuard): void;
  cancelPreview(): void;
  commit(changes: MaterialPreferenceChanges, guard: MaterialPreferenceGuard, actor?: AppearanceOverrideActor): void;
  reset(guard: MaterialPreferenceGuard): void;
  revise(next: MaterialPreferenceInput['source'], policy: MaterialPreferenceInput['policy'], guard: MaterialPreferenceGuard): void;
  setRuntime(runtime: MaterialPreferenceInput['runtime'], guard: MaterialPreferenceGuard): void;
  exportPreference(): string;
  restorePreference(saved: string, guard: MaterialPreferenceGuard): void;
  destroy(): void;
}
export interface MaterialPreferenceOptions { foil?: FoilOptions; mesh?: MeshGradientOptions; texture?: TextureOptions; signal?: AbortSignal }
type Handle = TextureHandle | FoilHandle | MeshGradientHandle;
type Candidate = { input: MaterialPreferenceInput; output: MaterialPreferenceOutput; guard: MaterialPreferenceGuard };

/** Product-selected controls, explicit personal intent and canonical local delivery.
 * The host owns user/account storage. This session owns one surface and its guards.
 */
export async function attachMaterialPreference(host: HTMLElement, initial: MaterialPreferenceInput,
  options: MaterialPreferenceOptions = {}): Promise<MaterialPreferenceSession> {
  if(options.signal?.aborted)throw new DOMException('Material attachment cancelled','AbortError');
  await initializeWorldbend();
  if(options.signal?.aborted)throw new DOMException('Material attachment cancelled','AbortError');
  let input = structuredClone(initial), output = evaluateMaterialPreference(input);
  if (input.source.target !== 'web') throw Error('Web material preference needs a Web source');
  let handle: Handle;
  switch (output.family) {
    case 'texture': handle = attachTexture(host, output.plan.delivery, options.texture); break;
    case 'foil': handle = await attachFoil(host, output.plan.delivery, {...options.foil,...(options.signal?{signal:options.signal}:{})}); break;
    case 'mesh-gradient': handle = await attachMeshGradient(host, output.plan.delivery, {...options.mesh,...(options.signal?{signal:options.signal}:{})}); break;
  }
  let destroyed = false, candidate: Candidate | undefined, draftRevision=0;
  const destroy=()=>{if(!destroyed){destroyed=true;candidate=undefined;handle.destroy();options.signal?.removeEventListener('abort',destroy);}};
  options.signal?.addEventListener('abort',destroy,{once:true});
  if(options.signal?.aborted){destroy();throw new DOMException('Material attachment cancelled','AbortError');}
  const active = () => { if (destroyed) throw Error('Material preference session is destroyed'); };
  const observedRuntime=()=>{
    const state='getState' in handle?handle.getState():undefined;
    return {rendererAvailable:input.runtime.rendererAvailable&&(!state||state.status==='ready'),
      motionAllowed:input.runtime.motionAllowed&&(!state||!state.reducedMotion)};
  };
  const guard = (): MaterialPreferenceGuard => ({ sourceFingerprint: output.plan.sourceFingerprint,
    policyFingerprint: output.plan.policyFingerprint, policyRevision: output.plan.policyRevision,
    preferenceFingerprint: output.plan.preferenceFingerprint, preferenceRevision: output.plan.preferenceRevision,
    runtime: JSON.stringify(observedRuntime()), scope: output.plan.scope, draftRevision });
  const sameGuard = (value: MaterialPreferenceGuard) => { active(); const current=guard();
    if (!value || Object.keys(current).some(key => value[key as keyof MaterialPreferenceGuard] !== current[key as keyof MaterialPreferenceGuard])) throw Error('Stale material preference proposal; reread current human/source/policy state'); };
  const render = (next: MaterialPreferenceOutput, runtime: MaterialPreferenceInput['runtime']) => {
    if (next.family !== input.family) throw Error('A preference session cannot switch material family');
    // Each adapter still owns its target-specific renderer and validation.
    switch (next.family) {
      case 'texture': (handle as TextureHandle).update(next.plan.delivery); break;
      case 'foil': (handle as FoilHandle).update(next.plan.delivery); break;
      case 'mesh-gradient': (handle as MeshGradientHandle).update(next.plan.delivery); break;
    }
    handle.setVisible(runtime.rendererAvailable ? undefined : false);
    if ('setPaused' in handle) handle.setPaused(!runtime.motionAllowed);
  };
  try { render(output,input.runtime); } catch(error) { handle.destroy(); throw error; }
  const accept = (next: MaterialPreferenceInput, resolved: MaterialPreferenceOutput) => {
    render(resolved,next.runtime); input=next; output=resolved; candidate=undefined; draftRevision++;
  };
  const change = (changes: MaterialPreferenceChanges, actor: AppearanceOverrideActor, base=input): Candidate => {
    const next=structuredClone(base);
    if (next.preference.revision >= Number.MAX_SAFE_INTEGER) throw Error('Preference revision is exhausted');
    const fields=next.preference.fields as Partial<Record<Field,{value:MaterialPreferenceValue;actor:AppearanceOverrideActor}>>;
    for (const [field,value] of Object.entries(changes) as [Field,MaterialPreferenceValue|null][]) {
      const control=output.plan.controls.find(row=>row.field===field);
      if (!control) throw Error('Unknown material preference field');
      if (value===null) { delete fields[field]; continue; }
      if (!input.policy.exposed.some(row=>row.field===field)) throw Error('This material control is not exposed by the product');
      fields[field]={value:structuredClone(value),actor};
    }
    next.preference.revision=input.preference.revision+1;
    const resolved=evaluateMaterialPreference(next);
    for (const [field,value] of Object.entries(changes)) if (value!==null && resolved.plan.receipts.some(row=>row.field===field&&row.state!=='applied')) throw Error('Preference value is outside the current product range');
    return {input:next,output:resolved,guard:guard()};
  };
  const getStatus = () => destroyed ? 'destroyed' : 'getState' in handle ? handle.getState().status : 'ready';
  return {
    getState:()=>{const runtime=observedRuntime();return {input:structuredClone({...input,runtime}) as MaterialPreferenceInput,
      output:evaluateMaterialPreference({...input,runtime} as MaterialPreferenceInput),
      preview:candidate?evaluateMaterialPreference({...candidate.input,runtime} as MaterialPreferenceInput):null,
      guard:guard(),previewing:!!candidate,status:getStatus()};},
    preview(changes,expected,actor='user') {sameGuard(expected);const next=change(changes,actor,candidate?.input??input);render(next.output,input.runtime);draftRevision++;next.guard=guard();candidate=next;},
    applyPreview(expected) {sameGuard(expected);if(!candidate)throw Error('No material preview to apply');sameGuard(candidate.guard);accept(candidate.input,candidate.output);},
    cancelPreview() {active();if(candidate){render(output,input.runtime);candidate=undefined;draftRevision++;}},
    commit(changes,expected,actor='user') {sameGuard(expected);const next=change(changes,actor);accept(next.input,next.output);},
    reset(expected) {sameGuard(expected);const changes=Object.fromEntries(Object.keys(input.preference.fields).map(field=>[field,null])) as MaterialPreferenceChanges;const next=change(changes,'user');accept(next.input,next.output);},
    revise(source,policy,expected) {
      sameGuard(expected);
      if (source.recipe.recipeId!==input.source.recipe.recipeId || source.target!==input.source.target || policy.policyId!==input.policy.policyId) throw Error('Revision needs the same material recipe, target and product policy');
      if (policy.revision<input.policy.revision || (JSON.stringify(policy)!==JSON.stringify(input.policy)&&policy.revision===input.policy.revision)) throw Error('Changed material policy needs a newer revision');
      const next=structuredClone({...input,source,policy}) as MaterialPreferenceInput;
      const resolved=evaluateMaterialPreference(next);accept(next,resolved);
    },
    setRuntime(runtime,expected) {sameGuard(expected);const next=structuredClone({...input,runtime}) as MaterialPreferenceInput;accept(next,evaluateMaterialPreference(next));},
    exportPreference() {active();return JSON.stringify({schema:'worldbend.material-preference-save@0.1',family:input.family,preference:input.preference});},
    restorePreference(saved,expected) {
      sameGuard(expected);if(new TextEncoder().encode(saved).length>16384)throw Error('Saved preference exceeds the record budget');
      const record=JSON.parse(saved);if(record.schema!=='worldbend.material-preference-save@0.1'||record.family!==input.family||!record.preference)throw Error('Saved preference family or version does not match');
      const next=structuredClone(input);next.preference=record.preference;
      evaluateMaterialPreference(next); // Check original revision/type/scope before rebasing its ordering token.
      if(next.preference.revision>=Number.MAX_SAFE_INTEGER||input.preference.revision>=Number.MAX_SAFE_INTEGER)throw Error('Preference revision is exhausted');
      next.preference.revision=Math.max(input.preference.revision+1,next.preference.revision);
      accept(next,evaluateMaterialPreference(next));
    },
    destroy,
  };
}

import { readFile } from "node:fs/promises";
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSync } from "@worldbend/wasm/effects";
import { discoverEffects, createEffectRecipe, planEffect, attachEffect, attachDocumentEffect } from "./effects";
import type { EffectRecipe, EffectState, SpatialDocumentDeliveryPlan } from "./effects";

const state:EffectState={progress:.35,pointerX:.7,pointerY:-.4,reducedMotion:false};
const preset=(effect:'layered-depth'|'rigid-tilt'|'shared-plane'|'hinged-reveal'|'frosted-lens'='rigid-tilt')=>createEffectRecipe({effect,version:'1',viewport:{width:600,height:400},intensity:.8});
const cameraPreset=()=>createEffectRecipe({effect:'multiplane-camera',version:'2',viewport:{width:600,height:400},intensity:.8});
const appearancePreset=()=>createEffectRecipe({effect:'multiplane-camera',version:'3',viewport:{width:600,height:400},intensity:.8});
beforeAll(async()=>{initSync({module:new WebAssembly.Module(await readFile(new URL('../../wasm/pkg-effects/worldbend_wasm_bg.wasm',import.meta.url)))});});
class Element extends EventTarget {
  declarations=new Map<string,[string,string]>();
  style={getPropertyValue:(name:string)=>this.declarations.get(name)?.[0]??'',getPropertyPriority:(name:string)=>this.declarations.get(name)?.[1]??'',setProperty:(name:string,value:string,priority='')=>{this.declarations.set(name,[value,priority]);},removeProperty:(name:string)=>this.declarations.delete(name)};
}
let media:EventTarget&{matches:boolean};let bindings:Array<{dispose():void}>=[];
const element=()=>new Element() as unknown as HTMLElement;
beforeEach(()=>{
  media=Object.assign(new EventTarget(),{matches:false});
  vi.stubGlobal('HTMLElement',Element);vi.stubGlobal('HTMLCanvasElement',class extends Element{});
  vi.stubGlobal('matchMedia',()=>media);vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
});
afterEach(()=>{bindings.forEach(binding=>binding.dispose());bindings=[];vi.unstubAllGlobals();});

describe('spatial effects over real WASM',()=>{
  it('discovers the bounded SwiftUI projection without advertising Web-only effects',async()=>{
    const all=await discoverEffects({version:'1',query:''});expect(all.effects).toHaveLength(5);
    const current=await discoverEffects({version:'2',query:''});expect(current.effects).toHaveLength(6);expect(current.effects[1]!.id).toBe('multiplane-camera');
    const appearance=await discoverEffects({version:'3',query:'景深'});expect(appearance.effects).toHaveLength(1);expect(appearance.effects[0]).toMatchObject({id:'multiplane-camera',content:'texture'});
    expect((await discoverEffects({version:'1',query:'视差'})).effects[0]!.id).toBe('layered-depth');
    const swiftui=(await discoverEffects({version:'1',carrier:'swiftui',query:''})).effects;
    expect(swiftui.map(effect=>effect.id)).toEqual(['layered-depth']);
    expect(swiftui[0]!.carriers).toEqual(['web','swiftui']);
    expect(swiftui[0]!.slots).toEqual(['background','middle','foreground']);
    expect((await discoverEffects({version:'1',carrier:'figma',query:''})).effects).toEqual([]);
    expect((await discoverEffects({version:'1',intent:'reveal',content:'dom',query:''})).effects).toEqual([]);
    await expect(discoverEffects({version:'99',query:''} as never)).rejects.toMatchObject({code:'E_SCHEMA'});
  });
  it('has repeatable JSON/identity across every built-in and reversed state',async()=>{
    for(const row of (await discoverEffects({version:'1',query:''})).effects){
      if(row.id==='multiplane-camera')throw Error('version 1 must not advertise the shared camera');
      const recipe=await preset(row.id);const request={recipe,state};const first=await planEffect(request);
      await planEffect({recipe,state:{...state,progress:1,pointerX:-1,pointerY:1}});
      expect(await planEffect(JSON.parse(JSON.stringify({...request,expectedFingerprint:first.fingerprint})))).toEqual(first);
      expect((await planEffect({recipe,state:{...state,reducedMotion:true}})).state).toEqual({progress:1,pointerX:0,pointerY:0,reducedMotion:true});
    }
  });
  it('retains the intended foreground/middle/background motion ratios',async()=>{
    const plan=await planEffect({recipe:await preset('layered-depth'),state:{...state,pointerX:1,pointerY:0}});
    for(const [i,x]of [7.2,16.8,31.2].entries()){
      const surface=plan.frames[i]!.surface;if(surface.kind!=='plane')throw Error('wrong carrier');
      expect(surface.plan.spec.destination.quad.tl.x).toBeCloseTo(x,10);
    }
  });
  it('projects authored depths through one camera and reports source exposure',async()=>{
    const recipe=await cameraPreset();
    expect(recipe.camera).toMatchObject({focusDistance:1000,travel:{x:48,y:32}});
    expect(recipe.layers.map(layer=>layer.surface.kind)).toEqual(['camera-plane','camera-plane','camera-plane']);
    const plan=await planEffect({recipe,state:{...state,pointerX:1,pointerY:0}});
    expect(plan.version).toBe('2');expect(plan.frames.every(frame=>frame.coverage?.viewportCovered)).toBe(true);
    const centers=plan.frames.map(frame=>{
      if(frame.surface.kind!=='plane')throw Error('wrong carrier');const q=frame.surface.plan.spec.destination.quad;
      return frame.offset.x+(q.tl.x+q.tr.x+q.br.x+q.bl.x)/4;
    });
    expect((centers[0]!-300)*(centers[2]!-300)).toBeLessThan(0);
    if(plan.frames[2]!.surface.kind!=='plane')throw Error('wrong carrier');
    expect(Math.abs(plan.frames[2]!.surface.plan.css.matrix3d[3]!)).toBeGreaterThan(0);
    const exposed=structuredClone(recipe);for(const layer of exposed.layers){layer.offset={x:0,y:0};if(layer.surface.kind!=='camera-plane')throw Error('wrong recipe');layer.surface.size={...exposed.viewport};}
    expect((await planEffect({recipe:exposed,state:{...state,pointerX:1,pointerY:0}})).frames.some(frame=>!frame.coverage?.viewportCovered)).toBe(true);
    await expect(createEffectRecipe({effect:'multiplane-camera',version:'1',viewport:{width:600,height:400},intensity:.8})).rejects.toMatchObject({code:'E_SCHEMA'});
  });
  it('plans independent optical focus, explicit depth maps and history-free motion exposure',async()=>{
    const recipe=await appearancePreset();expect(recipe.version).toBe('3');expect(recipe.appearance).toMatchObject({depthOfField:{focusDistance:1000,focusRange:300},motionBlur:{exposureFraction:.65}});expect(recipe.appearance!.depthOfField!.maxBlurRadius).toBeCloseTo(11.2);expect(recipe.appearance!.motionBlur!.maxBlurRadius).toBeCloseTo(25.6);
    const previous={...state,pointerX:0,pointerY:0},current={...state,pointerX:.8,pointerY:-.5};
    const moving=await planEffect({recipe,state:current,motion:{previousState:previous,elapsedSeconds:1/60}});
    expect(moving.frames.every(frame=>frame.appearance?.motionBlur)).toBe(true);expect(moving.frames.some(frame=>Math.abs(frame.appearance!.motionBlur!.screenVelocity.x)>0)).toBe(true);
    expect(moving.frames[1]!.appearance?.depthOfField?.blurRadius).toBe(0);
    expect(moving.frames[0]!.appearance?.depthOfField?.blurRadius).toBeGreaterThan(0);
    const still=await planEffect({recipe,state:current});expect(still.frames.every(frame=>frame.appearance?.motionBlur?.screenBlurVector.x===0&&frame.appearance?.motionBlur?.screenBlurVector.y===0)).toBe(true);
    const custom=structuredClone(recipe);custom.origin=null;if(custom.layers[0]!.surface.kind!=='camera-plane')throw Error('wrong recipe');custom.layers[0]!.surface.depthMap={nearDistance:900,farDistance:1800};
    expect((await planEffect({recipe:custom,state:current})).frames[0]!.appearance?.depthOfField?.depthMap).toEqual({nearDistance:900,farDistance:1800});
    const optical=structuredClone(recipe);optical.origin=null;optical.appearance!.depthOfField!.focusDistance=650;expect(optical.camera!.focusDistance).toBe(1000);const focused=await planEffect({recipe:optical,state:current});expect(focused.frames[2]!.appearance?.depthOfField?.blurRadius).toBe(0);expect(focused.frames[0]!.appearance?.depthOfField?.blurRadius).toBe(focused.frames[0]!.appearance?.depthOfField?.maxBlurRadius);
    const identical=await planEffect({recipe,state:current,motion:{previousState:current,elapsedSeconds:1/60}});expect(identical.frames.every(frame=>frame.appearance!.motionBlur!.screenBlurVector.x===0&&frame.appearance!.motionBlur!.screenBlurVector.y===0)).toBe(true);
    await expect(planEffect({recipe:await preset(),state:current,motion:{previousState:previous,elapsedSeconds:1/60}})).rejects.toMatchObject({code:'E_SCHEMA'});
  });
  it('allows explicit composition but rejects conflicts, extra fields and drift',async()=>{
    const recipe=await preset();const extra=structuredClone(recipe.layers[0]!);extra.id='second';extra.offset.x=90;recipe.origin=null;recipe.layers.push(extra);
    expect((await planEffect({recipe,state})).frames).toHaveLength(2);
    const plan=await planEffect({recipe,state});recipe.layers[1]!.tracks[0]!.to+=.1;
    await expect(planEffect({recipe,state,expectedFingerprint:plan.fingerprint})).rejects.toMatchObject({code:'E_SCHEMA'});
    await expect(planEffect({recipe,state,extra:true} as never)).rejects.toMatchObject({code:'E_SCHEMA'});
    await expect(planEffect({recipe,state:{...state,progress:2}})).rejects.toMatchObject({code:'E_SCHEMA'});
    recipe.layers[1]!.id='content';await expect(planEffect({recipe,state})).rejects.toMatchObject({code:'E_SCHEMA'});
  });
  it('snapshots requests before awaiting initialization and rejects oversized input',async()=>{
    const recipe=await preset();const input={recipe,state:{...state}};const pending=planEffect(input);input.state.progress=.9;
    expect((await pending).state.progress).toBe(.35);
    await expect(planEffect({recipe:{...recipe,schema:'x'.repeat(300000)},state} as never)).rejects.toMatchObject({code:'E_OUTPUT_LIMIT'});
  });
});

describe('effect binding ownership and continued use',()=>{
  const attach=async(recipe:EffectRecipe,e=element())=>{const b=await attachEffect(recipe,{content:{element:e}},state,{onError:vi.fn()});bindings.push(b);return{b,e};};
  it('publishes and continues a three-slot shared-camera scene',async()=>{
    const elements={background:element(),middle:element(),foreground:element()};
    const binding=await attachEffect(await cameraPreset(),Object.fromEntries(Object.entries(elements).map(([id,element])=>[id,{element}])),state);
    bindings.push(binding);expect(binding.getPlan().frames.every(frame=>frame.coverage?.viewportCovered)).toBe(true);
    const before=elements.foreground.style.getPropertyValue('transform');expect(before).toContain('matrix3d(');
    expect(await binding.update({...state,pointerX:-1,pointerY:1})).toBe(true);expect(elements.foreground.style.getPropertyValue('transform')).not.toBe(before);
    expect(elements.background.style.getPropertyValue('left')).toBe('-60px');
  });
  it('attaches a validated document delivery without rebuilding its asset bindings',async()=>{
    const recipe=await preset('layered-depth');
    const fingerprint=(await planEffect({recipe,state})).fingerprint;
    const plan:SpatialDocumentDeliveryPlan={
      schema:'worldbend.spatial-document-delivery-plan',version:'0.1',documentFingerprint:`sha256:${'0'.repeat(64)}`,
      deliveries:[{kind:'interactive',id:'hero',recipe,recipeFingerprint:fingerprint,bindings:[
        {role:'content',slotId:'background',assetId:'shared-art'},
        {role:'content',slotId:'middle',assetId:'details'},
        {role:'content',slotId:'foreground',assetId:'shared-art'},
      ]}],
    };
    const elements={background:element(),middle:element(),foreground:element()};
    const errors:unknown[]=[];
    const binding=await attachDocumentEffect(plan,'hero',{elements},state,{onError:error=>errors.push(error)});bindings.push(binding);
    expect(binding.getPlan().frames.map(frame=>frame.id)).toEqual(['background','middle','foreground']);
    expect(elements.foreground.style.getPropertyValue('transform')).toContain('matrix3d(');
    expect(await binding.replaceAsset('shared-art',element() as never)).toBe(false);
    expect(errors.at(-1)).toMatchObject({code:'E_SCHEMA',message:expect.stringContaining('live DOM')});
    expect(await binding.replaceAsset('missing',element() as never)).toBe(false);
    expect(errors.at(-1)).toMatchObject({code:'E_SCHEMA',message:expect.stringContaining('does not bind')});

    await expect(attachDocumentEffect(plan,'missing',{elements},state)).rejects.toMatchObject({code:'E_SCHEMA'});
    await expect(attachDocumentEffect(plan,'hero',{elements:{...elements,extra:element()}},state)).rejects.toMatchObject({code:'E_SCHEMA'});
    await expect(attachDocumentEffect({...plan,documentFingerprint:'stale'},'hero',{elements},state)).rejects.toMatchObject({code:'E_SCHEMA'});
    const changed=structuredClone(plan);const delivery=changed.deliveries[0];if(delivery.kind!=='interactive')throw Error('wrong delivery');delivery.recipe.layers[0]!.offset.x+=1;
    await expect(attachDocumentEffect(changed,'hero',{elements},state)).rejects.toMatchObject({code:'E_SCHEMA'});
  });
  it('coalesces state bursts, protects snapshots and recovers after malformed updates',async()=>{
    const{b,e}=await attach(await preset());const before=b.getPlan();const errors:unknown[]=[];
    const values=await Promise.all(Array.from({length:80},(_,i)=>b.update({...state,pointerX:i/80})));
    expect(values.filter(Boolean)).toHaveLength(1);expect(b.getPlan().state.pointerX).toBe(79/80);
    const accepted=e.style.getPropertyValue('transform');expect(await b.update({...state,progress:2})).toBe(false);expect(e.style.getPropertyValue('transform')).toBe(accepted);
    const snapshot=b.getRecipe();snapshot.layers[0]!.id='changed';expect(b.getRecipe().layers[0]!.id).toBe('content');
    expect(await b.update(state)).toBe(true);expect(b.getPlan()).toEqual(before);expect(errors).toEqual([]);
  });
  it('validates fingerprint and exact slots before changing existing elements',async()=>{
    const recipe=await preset(),e=element();e.style.setProperty('transform','rotate(2deg)','important');
    await expect(attachEffect(recipe,{content:{element:e}},state,{expectedFingerprint:'sha256:bad'})).rejects.toMatchObject({code:'E_SCHEMA'});
    expect(e.style.getPropertyValue('transform')).toBe('rotate(2deg)');
    await expect(attachEffect(recipe,{content:{element:e},extra:{element:element()}},state)).rejects.toMatchObject({code:'E_SCHEMA'});
    expect(e.style.getPropertyValue('transform')).toBe('rotate(2deg)');
  });
  it('restores owned styles on dispose/rebind while leaving host content styles intact',async()=>{
    const recipe=await preset(),e=element();e.style.setProperty('transform','rotate(2deg)','important');e.style.setProperty('color','red');
    const{b}=await attach(recipe,e);const next=await attachEffect(recipe,{content:{element:e}},state);bindings.push(next);
    expect(await b.update(state)).toBe(false);e.style.setProperty('color','blue');next.dispose();
    expect(e.style.getPropertyValue('transform')).toBe('rotate(2deg)');expect(e.style.getPropertyPriority('transform')).toBe('important');expect(e.style.getPropertyValue('color')).toBe('blue');
    expect(await next.update(state)).toBe(false);
  });
  it('records paused state, redraws on resume and reacts to reduced motion',async()=>{
    const{b,e}=await attach(await preset());const transform=e.style.getPropertyValue('transform');b.pause();await b.update({...state,pointerX:-1});
    expect(e.style.getPropertyValue('transform')).toBe(transform);expect(b.getPlan().state.pointerX).toBe(-1);
    await b.resume();expect(e.style.getPropertyValue('transform')).not.toBe(transform);
    media.matches=true;media.dispatchEvent(new Event('change'));await vi.waitFor(()=>expect(b.getPlan().state.reducedMotion).toBe(true));expect(b.getPlan().state.pointerX).toBe(0);
    media.matches=false;media.dispatchEvent(new Event('change'));await vi.waitFor(()=>expect(b.getPlan().state.pointerX).toBe(-1));
  });
  it('does not mutate a disposed binding after pending work completes',async()=>{
    const{b,e}=await attach(await preset());const pending=b.update({...state,pointerX:-1});b.dispose();expect(await pending).toBe(false);
    await new Promise(r=>setTimeout(r,5));expect(e.style.getPropertyValue('transform')).toBe('');
  });
});

import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const planner=vi.fn();
const renderers:FakeRenderer[]=[];
vi.mock('./window-bridge',()=>({planSurfaceWindow:(...args:unknown[])=>planner(...args)}));
vi.mock('./window-renderer',async importOriginal=>({
  ...await importOriginal<typeof import('./window-renderer')>(),
  WindowRenderer:class {constructor(canvas:HTMLCanvasElement){const renderer=new FakeRenderer(canvas);renderers.push(renderer);return renderer;}},
}));
import {attachSurfaceWindow,windowBackingSize} from './surface-window';
import type {SurfaceWindowSpec,SurfaceWindowPlan} from './surface-window';
class FakeRenderer {
  maximumTextureSize=4096;maximumDrawingSize=4096;draws=0;uploads=0;released=false;source:unknown;
  constructor(readonly canvas:HTMLCanvasElement){}
  setSource(source:unknown){if(source==='bad')throw Error('bad source');this.source=source;this.uploads++;}
  refresh(){}
  draw(_plan:SurfaceWindowPlan,w:number,h:number){this.draws++;this.canvas.width=w;this.canvas.height=h;}
  contextLost(){}contextRestored(){this.uploads++;}dispose(){this.released=true;}
}
class Canvas extends EventTarget {
  width=41;height=27;
  declarations=new Map<string,[string,string]>();
  style={getPropertyValue:(n:string)=>this.declarations.get(n)?.[0]??'',getPropertyPriority:(n:string)=>this.declarations.get(n)?.[1]??'',setProperty:(n:string,v:string,p='')=>{this.declarations.set(n,[v,p]);},removeProperty:(n:string)=>this.declarations.delete(n)};
}
const input=(x=0):SurfaceWindowSpec=>({schema:'worldbend.surface-window',version:'0.1',windowSize:{width:200,height:100},contentSize:{width:400,height:200},contentOrigin:{x:0,y:0},pose:{perspective:1200,translate:{x,y:0}},frost:{baseRadius:0,spread:.1,maxRadius:30}});
const planned=(s:SurfaceWindowSpec)=>({schema:'worldbend.surface-window-plan',version:'0.1',spec:s,visibility:'visible',mapping:{css:{transform:`translateX(${s.pose.translate?.x??0}px)`,transformOrigin:'0 0'},depthPlane:[0,0,0],sampleHomography:[]}} as unknown as SurfaceWindowPlan);
let doc:EventTarget&{hidden:boolean};
let owners:ReturnType<typeof attachSurfaceWindow>[]=[];
const attach=(canvas=new Canvas())=>{const b=attachSurfaceWindow(canvas as unknown as HTMLCanvasElement,{} as HTMLCanvasElement,input(),{onError:vi.fn(),pixelRatio:1});owners.push(b);return{canvas,b};};
beforeEach(()=>{
  doc=Object.assign(new EventTarget(),{hidden:false});vi.stubGlobal('document',doc);
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(performance.now()),0));vi.stubGlobal('cancelAnimationFrame',clearTimeout);
  planner.mockReset();planner.mockImplementation(async s=>planned(s));renderers.length=0;
});
afterEach(()=>{owners.forEach(b=>b.dispose());owners=[];vi.unstubAllGlobals();});
describe('surface window lifetime',()=>{
  it('bounds the backing for extreme aspect ratios and density',()=>{
    for(const w of [1,120,8192])for(const h of [1,120,8192])for(const budget of [1,7,10000,4194304]){
      const size=windowBackingSize(w,h,4,budget,4096);expect(size.width*size.height).toBeLessThanOrEqual(budget);expect(size.width).toBeLessThanOrEqual(4096);expect(size.height).toBeLessThanOrEqual(4096);expect(size.width).toBeGreaterThanOrEqual(1);expect(size.height).toBeGreaterThanOrEqual(1);
    }
  });
  it('does not publish an old asynchronous plan after a burst',async()=>{
    let finish!:(p:SurfaceWindowPlan)=>void;planner.mockImplementationOnce(()=>new Promise(r=>finish=r));const{b,canvas}=attach();
    await vi.waitFor(()=>expect(planner).toHaveBeenCalledOnce());const updates=Array.from({length:80},(_,i)=>b.update(input(i)));
    finish(planned(input(-1)));expect((await Promise.all(updates)).filter(Boolean)).toHaveLength(1);expect(canvas.style.getPropertyValue('transform')).toBe('translateX(79px)');expect(renderers[0]!.draws).toBe(1);
  });
  it('rejects malformed geometry while retaining a clone of the last accepted plan',async()=>{
    const{b}=attach();await b.update(input(5));planner.mockRejectedValueOnce(Error('bad'));expect(await b.update(input(99))).toBe(false);expect(b.getPlan()!.spec.pose.translate!.x).toBe(5);
    const snapshot=b.getPlan()!;snapshot.spec.pose.translate!.x=-5;expect(b.getPlan()!.spec.pose.translate!.x).toBe(5);expect(await b.update(input(10))).toBe(true);
  });
  it('does not let media refreshes supersede pending geometry',async()=>{
    const{b}=attach();await b.update(input(1));let finish!:(p:SurfaceWindowPlan)=>void;planner.mockImplementationOnce(()=>new Promise(r=>finish=r));const update=b.update(input(8));await vi.waitFor(()=>expect(planner).toHaveBeenCalledTimes(2));await b.refresh();finish(planned(input(8)));expect(await update).toBe(true);expect(b.getPlan()!.spec.pose.translate!.x).toBe(8);
  });
  it('records the latest paused plan, draws once on resume, and stops while hidden',async()=>{
    const{b}=attach();await b.update(input());b.pause();const before=renderers[0]!.draws;expect(await b.update(input(3))).toBe(true);expect(await b.refresh()).toBe(false);expect(renderers[0]!.draws).toBe(before);await b.resume();expect(renderers[0]!.draws).toBe(before+1);
    doc.hidden=true;doc.dispatchEvent(new Event('visibilitychange'));await b.update(input(8));expect(renderers[0]!.draws).toBe(before+1);doc.hidden=false;doc.dispatchEvent(new Event('visibilitychange'));expect(renderers[0]!.draws).toBe(before+2);
  });
  it('hides edge faces and lost contexts, then restores the latest accepted plan',async()=>{
    const{b,canvas}=attach();await b.update(input());planner.mockResolvedValueOnce({...planned(input()),visibility:'edge-on',mapping:undefined});await b.update(input());expect(canvas.style.getPropertyValue('visibility')).toBe('hidden');
    canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));await b.update(input(8));expect(b.getStatus().contextLost).toBe(true);canvas.dispatchEvent(new Event('webglcontextrestored'));expect(canvas.style.getPropertyValue('transform')).toBe('translateX(8px)');expect(canvas.style.getPropertyValue('visibility')).toBe('');
  });
  it('releases the previous owner, restores style priority, and suppresses late callbacks',async()=>{
    const canvas=new Canvas();canvas.style.setProperty('width','40%','important');const{b}=attach(canvas);await b.update(input());const next=attach(canvas).b;expect(b.getStatus().disposed).toBe(true);expect(renderers[0]!.released).toBe(true);const pending=next.update(input(4));next.dispose();expect(await pending).toBe(false);expect(canvas.style.getPropertyValue('width')).toBe('40%');expect(canvas.style.getPropertyPriority('width')).toBe('important');expect([canvas.width,canvas.height]).toEqual([41,27]);await new Promise(r=>setTimeout(r,10));expect(canvas.style.getPropertyValue('width')).toBe('40%');
  });
});

/** Optional live spatial-window carrier. Not imported by the static perspective entry. */
import { latestFrame } from "./latest-frame";
import { perspectiveOwners } from "./binding-ownership";
import { TransformError } from "./transform-error";
import { WindowRenderer, windowFailure } from "./window-renderer";
import type { WindowSource } from "./window-renderer";
import type { SurfaceWindowSpec, SurfaceWindowPlan } from "./generated/core-contract";
export { TransformError } from "./transform-error";
export type { WindowSource } from "./window-renderer";
export type { SurfaceWindowSpec, SurfaceWindowPlan, SurfaceWindowMapping, SurfaceVisibility, WindowFrost } from "./generated/core-contract";

export interface SurfaceWindowOptions {
  /** Requested backing density, bounded to [0.25, 4]. Actual density is reported. */
  pixelRatio?: number;
  /** Backing pixels, defaults to 4MP; cannot exceed 16MP. */
  maxPixels?: number;
  preserveDrawingBuffer?: boolean;
  onError?: (error:unknown)=>void;
}
export interface SurfaceWindowBinding {
  /** Replace the complete spec. False means rejected, superseded or disposed. */
  update(spec:SurfaceWindowSpec):Promise<boolean>;
  /** Sources must be decoded; ownership/playback stays with the caller. */
  setSource(source:WindowSource):Promise<boolean>;
  /** Call after drawing a source canvas. Videos update automatically. */
  refresh():Promise<boolean>;
  /** Stops automatic drawing. Geometry can still be updated while paused. */
  pause():void;
  resume():Promise<boolean>;
  getPlan():SurfaceWindowPlan|undefined;
  getStatus():{disposed:boolean;paused:boolean;contextLost:boolean;draws:number;uploads:number;pixelRatio:number;backingSize:{width:number;height:number}};
  dispose():void;
}

export function windowBackingSize(width:number,height:number,pixelRatio:number,maxPixels:number,maxAxis:number) {
  const ratio=Math.min(pixelRatio,maxAxis/width,maxAxis/height,Math.sqrt(maxPixels/(width*height)));
  let w=Math.max(1,Math.floor(width*ratio)),h=Math.max(1,Math.floor(height*ratio));
  if(w*h>maxPixels){if(w>=h)w=Math.max(1,Math.floor(maxPixels/h));else h=Math.max(1,Math.floor(maxPixels/w));}
  return {width:w,height:h,pixelRatio:Math.min(w/width,h/height)};
}

export function createWindowBinding(canvas:HTMLCanvasElement,source:WindowSource,initial:SurfaceWindowSpec,options:SurfaceWindowOptions={},initialPlan?:SurfaceWindowPlan,planner?:(spec:SurfaceWindowSpec)=>Promise<SurfaceWindowPlan>):PlannedWindowBinding {
  const ratio=options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1,2);
  const maxPixels=options.maxPixels ?? 4_194_304;
  if(!Number.isFinite(ratio)||ratio<0.25||ratio>4||!Number.isSafeInteger(maxPixels)||maxPixels<1||maxPixels>16_777_216) {
    windowFailure("E_SCHEMA","pixelRatio must be in [0.25,4] and maxPixels an integer in [1,16777216]");
  }
  const first=structuredClone(initial);
  perspectiveOwners.get(canvas)?.dispose();
  const savedStyles=["transform","transform-origin","width","height","visibility"].map(name=>({name,value:canvas.style.getPropertyValue(name),priority:canvas.style.getPropertyPriority(name)}));
  const savedSize={width:canvas.width,height:canvas.height};
  const renderer=new WindowRenderer(canvas,options.preserveDrawingBuffer);
  try { renderer.setSource(source); } catch(error) { renderer.dispose();throw error; }
  let disposed=false, paused=false, lost=false;
  let input=first;
  let plan:SurfaceWindowPlan|undefined;
  let density=ratio;
  let video:HTMLVideoElement|undefined;
  let videoFrame:number|undefined;
  let fallbackFrame:number|undefined;
  let lastVideoTime=-1;
  let videoNeedsFrame=true;
  const report=(error:unknown)=>{
    if(options.onError)options.onError(error);
    else canvas.dispatchEvent(new CustomEvent("worldbenderror",{detail:error}));
  };
  const active=()=>!disposed&&!paused&&!lost&&!document.hidden;
  const hide=()=>canvas.style.setProperty("visibility","hidden");
  const publish=(next:SurfaceWindowPlan)=>{
    if(!active()) {plan=next;return;}
    if(!next.mapping){hide();plan=next;renderer.refresh();stopVideo();stopRefresh();return;}
    const size=windowBackingSize(next.spec.windowSize.width,next.spec.windowSize.height,ratio,maxPixels,renderer.maximumDrawingSize);
    // Draw successfully before changing the last accepted geometry/style.
    renderer.draw(next,size.width,size.height);
    canvas.style.setProperty("width",`${next.spec.windowSize.width}px`);
    canvas.style.setProperty("height",`${next.spec.windowSize.height}px`);
    if(next.mapping) {
      canvas.style.setProperty("transform",next.mapping.css.transform);
      canvas.style.setProperty("transform-origin",next.mapping.css.transformOrigin);
      const previous=savedStyles.find(style=>style.name==="visibility")!;
      if(previous.value)canvas.style.setProperty("visibility",previous.value,previous.priority);
      else canvas.style.removeProperty("visibility");
    } else hide();
    density=size.pixelRatio;plan=next;scheduleVideo();
  };
  const queue=latestFrame(()=>{if(!planner)throw new TransformError({code:"E_INTERNAL",message:"This planned window is driven by its effect binding"});return planner(input);},publish,report);
  // Media refreshes do not solve geometry or supersede a pending user update.
  let refreshFrame:number|undefined;
  let refreshWaiters:((value:boolean)=>void)[]=[];
  const stopRefresh=()=>{
    if(refreshFrame!==undefined)cancelAnimationFrame(refreshFrame);
    refreshFrame=undefined;
    for(const resolve of refreshWaiters)resolve(false);
    refreshWaiters=[];
  };
  const refresh=():Promise<boolean>=>{
    if(disposed)return Promise.resolve(false);
    renderer.refresh();
    if(!active()||!plan?.mapping)return Promise.resolve(false);
    // Bounded waiter set: only the newest explicit refresh can report applied.
    for(const resolve of refreshWaiters)resolve(false);
    refreshWaiters=[];
    const promise=new Promise<boolean>(resolve=>refreshWaiters.push(resolve));
    if(refreshFrame===undefined)refreshFrame=requestAnimationFrame(()=>{
      refreshFrame=undefined;
      let applied=false;
      try {if(active()&&plan){publish(plan);applied=true;}}
      catch(error){report(error);}
      finally {for(const resolve of refreshWaiters)resolve(applied);refreshWaiters=[];}
    });
    return promise;
  };
  const stopVideo=()=>{
    if(videoFrame!==undefined&&video)video.cancelVideoFrameCallback(videoFrame);
    if(fallbackFrame!==undefined)cancelAnimationFrame(fallbackFrame);
    videoFrame=undefined;fallbackFrame=undefined;
    videoNeedsFrame=true;
  };
  const scheduleVideo=()=>{
    if(!active()||!plan?.mapping||!video||(!videoNeedsFrame&&(video.paused||video.ended))||videoFrame!==undefined||fallbackFrame!==undefined)return;
    if(typeof video.requestVideoFrameCallback==="function") {
      videoFrame=video.requestVideoFrameCallback(()=>{videoFrame=undefined;videoNeedsFrame=false;void refresh();scheduleVideo();});
    } else {
      fallbackFrame=requestAnimationFrame(()=>{fallbackFrame=undefined;const forced=videoNeedsFrame;videoNeedsFrame=false;if(video&&(forced||video.currentTime!==lastVideoTime)){lastVideoTime=video.currentTime;void refresh();}scheduleVideo();});
    }
  };
  const mediaEvent=()=>{stopVideo();void refresh();scheduleVideo();};
  const detachVideo=()=>{
    stopVideo();
    if(video)for(const name of ["play","pause","seeked","loadeddata","ended"])video.removeEventListener(name,mediaEvent);
    video=undefined;
  };
  const bindVideo=(next:WindowSource)=>{
    detachVideo();
    if(typeof HTMLVideoElement!=="undefined"&&next instanceof HTMLVideoElement) {
      video=next;lastVideoTime=-1;
      for(const name of ["play","pause","seeked","loadeddata","ended"])video.addEventListener(name,mediaEvent);
      scheduleVideo();
    }
  };
  const onVisibility=()=>{
    if(document.hidden){renderer.refresh();stopVideo();stopRefresh();}
    else {if(plan&&active()){try{publish(plan);}catch(error){report(error);}}scheduleVideo();}
  };
  const onLost=(event:Event)=>{
    event.preventDefault();lost=true;renderer.contextLost();stopVideo();stopRefresh();hide();
    report(new TransformError({code:"E_RENDER",message:"Spatial window graphics context lost; waiting for restoration"}));
  };
  const onRestored=()=>{
    if(disposed)return;
    try {renderer.contextRestored();lost=false;if(plan&&active())publish(plan);scheduleVideo();}
    catch(error){lost=true;hide();report(error);}
  };
  const binding:PlannedWindowBinding={
    applyPlan(next) { if(disposed)return false; publish(next); return true; },
    update(next) {
      if(disposed)return Promise.resolve(false);
      try {input=structuredClone(next);}catch(error){return queue.reject(error);}
      return queue.request();
    },
    setSource(next) {
      if(disposed)return Promise.resolve(false);
      try {renderer.setSource(next);bindVideo(next);}
      catch(error){report(error);return Promise.resolve(false);}
      if(active()&&plan){try{publish(plan);}catch(error){report(error);return Promise.resolve(false);}}
      return Promise.resolve(true);
    },
    refresh,
    pause(){if(disposed)return;paused=true;stopVideo();stopRefresh();},
    async resume(){if(disposed)return false;paused=false;if(plan&&!lost&&!document.hidden){try{renderer.refresh();publish(plan);}catch(error){report(error);return false;}}scheduleVideo();return !lost;},
    getPlan(){return plan?structuredClone(plan):undefined;},
    getStatus(){return{disposed,paused,contextLost:lost,draws:renderer.draws,uploads:renderer.uploads,pixelRatio:density,backingSize:{width:canvas.width,height:canvas.height}};},
    dispose(){
      if(disposed)return;disposed=true;queue.dispose();stopRefresh();detachVideo();
      document.removeEventListener("visibilitychange",onVisibility);
      canvas.removeEventListener("webglcontextlost",onLost);canvas.removeEventListener("webglcontextrestored",onRestored);
      renderer.dispose();
      for(const {name,value,priority} of savedStyles){if(value)canvas.style.setProperty(name,value,priority);else canvas.style.removeProperty(name);}
      canvas.width=savedSize.width;canvas.height=savedSize.height;
      if(perspectiveOwners.get(canvas)===binding)perspectiveOwners.delete(canvas);
    },
  };
  document.addEventListener("visibilitychange",onVisibility);
  canvas.addEventListener("webglcontextlost",onLost);canvas.addEventListener("webglcontextrestored",onRestored);
  perspectiveOwners.set(canvas,binding);bindVideo(source);
  if(initialPlan){try{publish(initialPlan);}catch(error){binding.dispose();throw error;}}else void queue.request();
  return binding;
}

/** Internal adapter entry: only accepts plans returned by the shared core. */
export interface PlannedWindowBinding extends SurfaceWindowBinding { applyPlan(plan:SurfaceWindowPlan):boolean; }
export function attachPlannedWindow(canvas:HTMLCanvasElement,source:WindowSource,plan:SurfaceWindowPlan,options:SurfaceWindowOptions={}):PlannedWindowBinding {
  return createWindowBinding(canvas,source,plan.spec,options,plan);
}

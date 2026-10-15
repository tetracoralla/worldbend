import { TransformWebGLRenderer, solveTransformPreview } from "@worldbend/web";
import { projectCardPose } from "@worldbend/web/perspective";
import type { EffectRecipe, Quad as Quad1 } from "@worldbend/web/types";
import { WindowRenderer } from "../../web/src/window-renderer";
import type { SurfaceWindowSpec } from "../../web/src/generated/core-contract";
import { planEffect } from "./designer-plan";
import { FOLD_GLASS, presetCard, type PresetEffectSpec, type PresetEffectRaster } from "./preset-effect";

/** One representative still. Window sampling and every pose are canonical core plans. */
export async function renderPresetEffect(
  source: HTMLImageElement, size: {width:number;height:number}, spec: PresetEffectSpec,
): Promise<{raster: PresetEffectRaster; canvas: HTMLCanvasElement}> {
  const parts: {name: "card" | "fold-outer" | "fold-inner"; quad: Quad1; texture: TexImageSource}[] = [];
  let windowRenderer: WindowRenderer | undefined;
  const projector = new TransformWebGLRenderer(undefined, {preserveDrawingBuffer:true});
  const half = size.width / 2;
  try {
    if (spec.effect !== "fold-screen") {
      const {rig,view} = presetCard(spec,size);
      const pose = await projectCardPose({rig,view});
      if (pose.face !== "front") throw Error("Choose a visible front pose.");
      parts.push({name:"card",quad:pose.quad,texture:source});
    } else {
      const angle = 180 - 60 * spec.amount;
      const windows: SurfaceWindowSpec[] = [false,true].map(inner => ({
        schema:"worldbend.surface-window",version:"0.1",contentSize:size,
        contentOrigin:{x:inner ? -half : 0,y:0},windowSize:{width:half,height:size.height},
        pose:{perspective:size.width * 2.4,rotateY:inner ? angle - 180 : angle,
          pivot:{x:inner ? 0 : 1,y:.5},perspectiveOrigin:{x:inner ? 0 : 1,y:.5}},
        frost:{baseRadius:0,spread:.13,maxRadius:30},
      }));
      const recipe: EffectRecipe = {schema:"worldbend.effect-recipe",version:"1",viewport:size,
        layers:windows.map((window,index)=>({id:index ? "inner" : "outer",offset:{x:index ? half : 0,y:0},
          surface:{kind:"window",spec:window},tracks:[]})) as EffectRecipe["layers"]};
      const plan = await planEffect({recipe,state:{progress:1,pointerX:0,pointerY:0,reducedMotion:false}});
      windowRenderer = new WindowRenderer(document.createElement("canvas"),true);
      windowRenderer.setSource(source);
      for (const [index,frame] of plan.frames.entries()) {
        if (frame.surface.kind !== "window" || frame.surface.plan.visibility !== "visible") continue;
        const window = windows[index]!;
        // Card pose reports even hidden faces without weakening TransformSpec;
        // it shares the window's exact core PlanePose projection.
        const {rig} = presetCard(spec,window.windowSize);
        const pose = await projectCardPose({rig:{...rig,geometry:{perspective:window.pose.perspective,
          pivot:window.pose.pivot!,perspectiveOrigin:window.pose.perspectiveOrigin!}},view:{rotateY:window.pose.rotateY!}});
        const quad = Object.fromEntries(Object.entries(pose.quad).map(([key,p])=>[key,{x:p.x+frame.offset.x,y:p.y+frame.offset.y}])) as unknown as Quad1;
        const density = Math.min(2,4096 / Math.max(half,size.height));
        windowRenderer.draw(frame.surface.plan,Math.max(1,Math.round(half*density)),Math.max(1,Math.round(size.height*density)));
        const texture = document.createElement("canvas"); texture.width=windowRenderer.canvas.width; texture.height=windowRenderer.canvas.height;
        texture.getContext("2d")!.drawImage(windowRenderer.canvas,0,0);
        parts.push({name:index ? "fold-inner" : "fold-outer",quad,texture});
      }
    }
    const points = parts.flatMap(part=>Object.values(part.quad));
    if (spec.effect === "fold-screen") points.push({x:0,y:0},{x:half,y:size.height});
    if (!points.length) throw Error("This pose has no visible area.");
    const glass=spec.effect==="fold-screen"&&spec.amount>0;
    const padding=glass?FOLD_GLASS.padding:1;
    const x = Math.floor(Math.min(...points.map(p=>p.x)))-padding, y = Math.floor(Math.min(...points.map(p=>p.y)))-padding;
    const width=Math.ceil(Math.max(...points.map(p=>p.x)))-x+padding, height=Math.ceil(Math.max(...points.map(p=>p.y)))-y+padding;
    const density=Math.min(2,source.naturalWidth/size.width,source.naturalHeight/size.height,4096/Math.max(width,height));
    if (density <= 0 || width > 8192 || height > 8192) throw Error("This artwork exceeds the output size limit.");
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width*density));canvas.height=Math.max(1,Math.round(height*density));
    const context=canvas.getContext("2d")!;
    if (spec.effect === "fold-screen") context.drawImage(source,0,0,source.naturalWidth/2,source.naturalHeight,-x*density,-y*density,half*density,size.height*density);
    const layers: PresetEffectRaster["layers"]=[];
    for (const part of parts) {
      const quad=Object.fromEntries(Object.entries(part.quad).map(([k,p])=>[k,{x:p.x-x,y:p.y-y}])) as unknown as Quad1;
      const pixelQuad=Object.fromEntries(Object.entries(quad).map(([k,p])=>[k,{x:p.x*density,y:p.y*density}])) as unknown as Quad1;
      const solved=await solveTransformPreview({schema:"worldbend.transform",version:"0.1",destination:{space:"pixel",
        reference:{width:canvas.width,height:canvas.height},quad:pixelQuad},content:{fit:"stretch"}});
      projector.render(part.texture,solved,undefined,"high");context.drawImage(projector.canvas,0,0);
      if(glass) {
        // Sampling deliberately keeps the backdrop stationary. An explicit
        // glass surface must carry the fold's silhouette over transparent UVs.
        context.save();context.scale(density,density);
        context.beginPath();context.moveTo(quad.tl.x,quad.tl.y);
        for(const p of [quad.tr,quad.br,quad.bl])context.lineTo(p.x,p.y);
        context.closePath();
        const {fill,stroke,shadow}=FOLD_GLASS;
        // Canvas shadows multiply paint alpha; native vector shadows use the
        // silhouette. Compensate for the glass fill rather than darken it.
        context.shadowColor=`rgba(0,0,0,${shadow.opacity/fill.opacity*spec.amount})`;
        context.shadowBlur=shadow.radius*density;context.shadowOffsetX=shadow.x*density;context.shadowOffsetY=shadow.y*density;
        context.fillStyle=`rgba(255,255,255,${fill.opacity*spec.amount})`;context.fill();
        context.shadowColor="transparent";
        context.strokeStyle=`rgba(${stroke.r*255},${stroke.g*255},${stroke.b*255},${stroke.opacity*spec.amount})`;
        context.lineWidth=stroke.width;context.stroke();context.restore();
      }
      const bytes=projector.canvas.toDataURL("image/png").split(",")[1]!;
      if (bytes.length > 16_000_000) throw Error("This artwork exceeds the image transfer limit.");
      layers.push({name:part.name,bytes,quad});
    }
    return {canvas,raster:{width,height,origin:{x,y},...(spec.effect==="fold-screen"?{baseWidth:half}:{}),layers}};
  } finally {windowRenderer?.dispose();projector.dispose();}
}

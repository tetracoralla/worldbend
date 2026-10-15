import {describe,it,expect} from "vitest";
import {defaultMockup} from "./mockup-workspace";
import {continuedCompositionTask,isStoredDesignerTask,parseStoredDesignerTask,type FigmaCompositionTask} from "./stored-designer-task";
import {spatialTemplateFromCompositionTask,isFigmaSpatialTemplate,checkedTemplateLibrary} from "./stored-template-library";
import {writeStoredOperation} from "./stored-operation";
const source=(id:string,x:number)=>({sourceNodeId:id,sourceName:id,renderWidth:100,renderHeight:80,placement:{x,y:0,width:100,height:80},image:{} as HTMLImageElement});
function animated(){
 const task=continuedCompositionTask(defaultMockup([source("one",0),source("two",120)])) as Extract<FigmaCompositionTask,{kind:"composition"}>;
 const scene=task.template.operation.composition;
 task.motion={frame:0,spec:{schema:"worldbend.mockup-motion",version:"0.1",canvas:scene.canvas,timebase:{numerator:24,denominator:1},frameCount:96,background:scene.background??{kind:"transparent"},seams:scene.seams??[],planes:scene.planes.map(p=>({id:p.id,sourceId:p.sourceId,base:p.transform,opacity:p.opacity??1,keyframes:[{frame:0,quad:p.transform.destination.quad,easingToNext:{kind:"cubicBezier",x1:.2,y1:-.5,x2:.8,y2:1.5}},{frame:95,quad:p.transform.destination.quad}]}))}};
 return task;
}
describe("durable animated Composition",()=>{
 it("retains the complete whole presentation and rejects broken output selection",()=>{
  const task=animated();const stage=task.template.operation.postprocess.stages[0]!;
  if(stage.kind!=="transform"||!stage.target_size)throw Error("test whole transform missing");
  task.motion!.spec.presentation={transform:stage.spec,size:stage.target_size,output:task.template.output,outputId:task.previewOutputId,keyframes:[{frame:0,quad:stage.spec.destination.quad,easingToNext:{kind:"linear"}},{frame:48,quad:{...stage.spec.destination.quad,tr:{x:.88,y:.1}}},{frame:95,quad:stage.spec.destination.quad}]};
  expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
  const library=spatialTemplateFromCompositionTask(task);expect(library.motion!.spec.presentation).toEqual(task.motion!.spec.presentation);
  const broken=structuredClone(task);broken.motion!.spec.presentation!.outputId="missing";
  expect(isStoredDesignerTask(broken)).toBe(false);
  const incomplete=structuredClone(task);incomplete.motion!.spec.presentation!.keyframes!.pop();expect(isStoredDesignerTask(incomplete)).toBe(false);
 });
 it("round-trips the complete program, outer transform and named output",()=>{
  const task=animated();task.previewOutputId="wide";task.template.output={kind:"single",id:"wide"};
  expect(parseStoredDesignerTask(JSON.stringify(task))).toEqual(task);
  const record=spatialTemplateFromCompositionTask(task);expect(isFigmaSpatialTemplate(record)).toBe(true);
  const library=checkedTemplateLibrary([{id:"motion",name:"Animated cover",template:record}]);expect(library?.templates[0]?.template).toEqual(record);
  record.motion!.spec.planes[0]!.keyframes[0]!.quad.tl.x+=.1;expect(record.motion).not.toEqual(task.motion);
 });
 it("rejects incomplete endpoints, unknown motion fields and a frame outside the program",()=>{
  const task=animated();expect(isStoredDesignerTask(task)).toBe(true);
  const broken=structuredClone(task);broken.motion!.frame=96;expect(isStoredDesignerTask(broken)).toBe(false);
  broken.motion!.frame=0;broken.motion!.spec.planes[0]!.keyframes.pop();expect(isStoredDesignerTask(broken)).toBe(false);
  expect(isStoredDesignerTask({...task,motion:{...task.motion,invented:true}})).toBe(false);
 });
 it("refuses oversized persisted work before changing any existing shared slot",()=>{
  const task=animated(),writes:unknown[]=[];
  task.motion!.spec.planes[0]!.keyframes=Array.from({length:240},(_,frame)=>({frame,quad:{tl:{x:.123456789012345,y:.234567890123456},tr:{x:.8,y:.1},br:{x:.9,y:.9},bl:{x:.1,y:.8}}}));
  task.motion!.spec.planes=Array.from({length:8},(_,i)=>({...task.motion!.spec.planes[0]!,id:"plane-"+i}));
  expect(()=>writeStoredOperation({getSharedPluginData(){return "retained"},setSharedPluginData(...args){writes.push(args)}},{kind:"task",task})).toThrow("storage limit");expect(writes).toEqual([]);
 });
});

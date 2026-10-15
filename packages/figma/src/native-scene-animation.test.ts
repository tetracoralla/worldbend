import {describe,it,expect} from "vitest";
import {sceneFrameVisibility,sceneAnimationGateIntact,sceneAnimationFrameIntact} from "./native-scene-animation";
import {isUiToMainMessage} from "./messages";
function at(track:ReturnType<typeof sceneFrameVisibility>,time:number){let value=track.baseValue?.type==="FLOAT"?track.baseValue.value:0;for(const key of track.keyframes)if(key.timelinePosition<=time&&key.value.type==="FLOAT")value=key.value.value;return value;}
describe("complete scene frame visibility",()=>{
 it("shows exactly one canonical image at each encoded time and retains the last image",()=>{
  const tracks=Array.from({length:96},(_,index)=>sceneFrameVisibility(index,96,24,95/24));
  for(let frame=0;frame<96;frame++)expect(tracks.map(t=>at(t,frame/24))).toEqual(Array.from({length:96},(_,i)=>i===frame?1:0));
  expect(tracks.map(t=>at(t,4))).toEqual(Array.from({length:96},(_,i)=>i===95?1:0));
 });
 it("keeps a design-mode poster without showing it at other movie times",()=>{
  const track=sceneFrameVisibility(24,96,24,95/24,1);
  expect(track.baseValue).toEqual({type:"FLOAT",value:1});
  expect(at(track,0)).toBe(0);expect(at(track,1)).toBe(1);expect(at(track,2)).toBe(0);
 });
 it("holds the final authored image through a longer native decoration timeline",()=>{
  expect(at(sceneFrameVisibility(95,96,24,6),5.5)).toBe(1);expect(at(sceneFrameVisibility(94,96,24,6),5.5)).toBe(0);
 });
 it("admits the first image and refuses open or oversized frame messages",()=>{
  const frame={type:"scene-animation-frame",generation:1,requestId:1,index:0,bytes:new Uint8Array([1])};
  expect(isUiToMainMessage(frame)).toBe(true);expect(isUiToMainMessage({...frame,unexpected:true})).toBe(false);
  expect(isUiToMainMessage({...frame,bytes:new Uint8Array(16*1024*1024+1)})).toBe(false);
 });
});

describe("generated scene frame edit protection",()=>{
 const meta={frameCount:96,fps:24,posterFrame:24,timelineEnd:95/24};
 function gate(index=24){return {parent:{type:"FRAME",width:1300,height:1000},width:1300,height:1000,opacity:index===24?1:0,visible:true,isMask:false,clipsContent:false,blendMode:"PASS_THROUGH",layoutMode:"NONE",cornerRadius:0,fills:[],strokes:[],effects:[],relativeTransform:[[1,0,0],[0,1,0]],animationStyles:[],manualKeyframeTracks:{OPACITY:sceneFrameVisibility(index,96,24,95/24,index===24?1:0)},getSharedPluginData:()=>JSON.stringify({index})} as unknown as FrameNode;}
 it("admits original gates after host rounding and clone ID changes",()=>{
  const node=gate(25);const track=node.manualKeyframeTracks.OPACITY!;
  for(const key of track.keyframes as Array<ManualKeyframe>){(key as {timelinePosition:number}).timelinePosition=Math.round(key.timelinePosition*1e6)/1e6;}
  expect(sceneAnimationGateIntact(node,meta)).toBe(true);
 });
 it("refuses changed geometry, effects, visibility and authored gate timing",()=>{
  expect(sceneAnimationGateIntact(gate(),meta)).toBe(true);
  for(const patch of [{relativeTransform:[[1,0,12],[0,1,0]]},{width:1200},{effects:[{type:"LAYER_BLUR",radius:8,visible:true}]},{visible:false},{opacity:.5},{clipsContent:true}])expect(sceneAnimationGateIntact(Object.assign(gate(),patch),meta)).toBe(false);
  const changed=gate();const track=changed.manualKeyframeTracks.OPACITY!;(track.keyframes[1] as {timelinePosition:number}).timelinePosition=2;
  expect(sceneAnimationGateIntact(changed,meta)).toBe(false);
 });
 it("protects uniform edits to cached frames while allowing the editable poster's new placement",()=>{
  const leaf=()=>({type:"RECTANGLE",width:1300,height:1000,relativeTransform:[[1,0,0],[0,1,0]],visible:true,opacity:1,blendMode:"NORMAL",effects:[],strokes:[],strokeWeight:0,strokeAlign:"INSIDE",cornerRadius:0,isMask:false,fills:[],getSharedPluginData:()=>""}) as unknown as RectangleNode;
  const primary=leaf(),cached=leaf();const wrapper=gate(25);Object.assign(wrapper,{children:[cached]});
  const originalGeometry=JSON.stringify({width:cached.width,height:cached.height,transform:cached.relativeTransform});
  const proof={...meta,frameGeometry:originalGeometry};
  expect(sceneAnimationFrameIntact(wrapper,proof,primary)).toBe(true);
  Object.assign(primary,{relativeTransform:[[1,0,15],[0,1,0]]});
  expect(sceneAnimationFrameIntact(wrapper,proof,primary)).toBe(true);
  Object.assign(cached,{relativeTransform:[[1,0,15],[0,1,0]]});
  expect(sceneAnimationFrameIntact(wrapper,proof,primary)).toBe(false);
  Object.assign(cached,{relativeTransform:[[1,0,0],[0,1,0]],effects:[{type:"LAYER_BLUR",radius:8}]});
  expect(sceneAnimationFrameIntact(wrapper,proof,primary)).toBe(false);
 });
});

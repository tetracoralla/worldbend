import {describe,expect,it} from "vitest";
import {expandLinkedUpdatePlan} from "./agent-linked-update";
describe("exact linked update packet expansion",()=>{
  it("restores every distinct guard, source binding, dependency and revision",()=>{
    const header={schema:"worldbend.figma.linked-update" as const,version:"0.1" as const,fileKey:"file",pageId:"page",sourceNodeId:"source"};
    const ids=Array.from({length:64},(_,i)=>`node-${i}`),guards=ids.map((_,i)=>`hash32x2:001200:${i.toString(16).padStart(16,"0")}`);
    const dependency=ids.map((_,i)=>i?[ids[i-1]!]:[]);
    const plan=expandLinkedUpdatePlan({...header,columns:[ids,{constant:"transform"},{constant:7},guards,{constant:["source"]},dependency,{constant:true}]});
    expect(plan.items).toEqual(ids.map((nodeId,i)=>({nodeId,name:"",kind:"transform",revision:7,expected:guards[i],sourceNodeIds:["source"],dependencyNodeIds:dependency[i],updatable:true})));
    expect(expandLinkedUpdatePlan(plan)).toBe(plan);
    expect(expandLinkedUpdatePlan({...header,rows:[["node","transform",1,"hash32x2:opaque:legacy",["source"],[],true]]}).items[0]!.expected).toBe("hash32x2:opaque:legacy");
  });
});

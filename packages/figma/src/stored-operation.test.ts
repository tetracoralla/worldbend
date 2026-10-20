import { describe, expect, it } from "vitest";
import type { RectifySpecInput, TransformSpec } from "@worldbend/web/types";
import { createMeshSpec } from "./mesh-workspace";
import { createSurfaceSpec } from "./surface-workspace";
import { singleCanvasSpec } from "./stored-canvas";
import {
  readStoredOperation,
  readStoredOperationSlots,
  restoreStoredOperationSlots,
  writeStoredOperation,
  isStoredOperation,
  type SharedOperationWriter,
  type StoredOperation,
} from "./stored-operation";
import {
  SHARED_NAMESPACE,
  SHARED_RECTIFY_KEY,
  SHARED_TRANSFORM_KEY,
} from "./stored-plane";
import { SHARED_CANVAS_KEY } from "./stored-canvas";
import {nativeNodeSnapshot} from "./native-copy-closure";

const transform: TransformSpec = {
  schema: "worldbend.transform",
  version: "0.1",
  destination: {
    space: "normalized",
    quad: {
      tl: { x: 0, y: 0 },
      tr: { x: 1, y: 0 },
      br: { x: 1, y: 1 },
      bl: { x: 0, y: 1 },
    },
  },
  content: { fit: "stretch" },
};

const rectification: RectifySpecInput = {
  schema: "worldbend.rectify",
  version: "0.1",
  source: { space: "normalized", quad: transform.destination.quad },
  output: { width: 100, height: 80 },
};

function operationStore(): SharedOperationWriter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getSharedPluginData(namespace, key) {
      return values.get(`${namespace}:${key}`) ?? "";
    },
    setSharedPluginData(namespace, key, value) {
      values.set(`${namespace}:${key}`, value);
    },
  };
}

describe("stored operation envelope", () => {
  const operations: StoredOperation[] = [
    { kind: "transform", spec: transform },
    { kind: "rectify", spec: rectification },
    {
      kind: "canvas",
      spec: singleCanvasSpec({
        kind: "stretch",
        output: { width: 100, height: 80 },
      }),
    },
    { kind: "task", task: { kind: "mesh", spec: createMeshSpec(100, 80, 2) } },
    { kind: "task", task: { kind: "surface", spec: createSurfaceSpec(100, 80) } },
  ];

  it("round-trips each existing persisted operation through one exclusive envelope", () => {
    const store = operationStore();
    for (const operation of operations) {
      writeStoredOperation(store, operation);
      expect(readStoredOperation(store)).toEqual({ status: "valid", operation });
      expect(Object.values(readStoredOperationSlots(store)).filter(Boolean)).toHaveLength(1);
    }
  });

  it("retains complete large deformation controls through owning banks, rollback snapshots and corruption refusal",()=>{
    const samples=Array.from({length:256},(_,i)=>({position:{x:(i+1)/257,y:.5},delta:{x:Math.sin(i)*.000001,y:0},radius:.1,strength:.01}));
    const operation:unknown={kind:"task",task:{kind:"deformation",view:"pin",spec:{schema:"worldbend.deformation-work",version:"0.1",transform,
      meshSubdivisions:16,surface:{envelope:{columns:1,rows:1,points:Array.from({length:16},(_,i)=>({x:i%4/3,y:Math.floor(i/4)/3}))},anchors:[],
        strokes:Array.from({length:4},(_,i)=>({id:`stroke-${i}`,samples:structuredClone(samples)}))},
      liquify:{strokes:Array.from({length:4},(_,i)=>({id:`liquify-${i}`,mode:"push",samples:structuredClone(samples)}))},meshEdits:[]}}};
    if(!isStoredOperation(operation))throw Error("invalid full-control fixture");
    const store=operationStore();writeStoredOperation(store,operation);expect(readStoredOperation(store)).toEqual({status:"valid",operation});
    const old=readStoredOperationSlots(store);expect(old.banks).toBeDefined();
    const node={...store,id:"saved",type:"FRAME",parent:{id:"page"}} as unknown as SceneNode;
    const beforeSnapshot=nativeNodeSnapshot(node),active=Object.keys(old.banks!)[0]!;
    store.setSharedPluginData("worldbend",active,old.banks![active]!+"A");
    expect(nativeNodeSnapshot(node)).not.toBe(beforeSnapshot);
    store.setSharedPluginData("worldbend",active,old.banks![active]!);
    store.setSharedPluginData("worldbend",`operation-bank-${"f".repeat(64)}-0`,"inactive bytes");
    store.setSharedPluginData("worldbend","publication-chunk-0","temporary bytes");
    expect(nativeNodeSnapshot(node)).toBe(beforeSnapshot);
    const changed=structuredClone(operation);if(changed.kind!=="task"||changed.task.kind!=="deformation")throw Error();changed.task.view="mesh";
    writeStoredOperation(store,changed);expect(readStoredOperation(store)).toEqual({status:"valid",operation:changed});
    restoreStoredOperationSlots(store,old);expect(readStoredOperation(store)).toEqual({status:"valid",operation});
    for(const phase of ["bank","slot"] as const){
      const before=readStoredOperationSlots(store),keysBefore=new Set(store.values.keys()),originalWrite=store.setSharedPluginData.bind(store);let failed=false;
      const attempt=structuredClone(changed);if(attempt.kind!=="task"||attempt.task.kind!=="deformation")throw Error();
      attempt.task.spec.surface!.strokes![0]!.id+=`-${phase}`;
      store.setSharedPluginData=(namespace,key,value)=>{
        if(!failed&&value&&(phase==="bank"?key.startsWith("operation-bank-"):key==="task")){
          failed=true;throw Error("native storage rejected write");
        }
        originalWrite(namespace,key,value);
      };
      expect(()=>writeStoredOperation(store,attempt)).toThrow("native storage rejected write");
      expect(failed).toBe(true);expect(readStoredOperationSlots(store)).toEqual(before);
      expect(readStoredOperation(store)).toEqual({status:"valid",operation});
      expect([...store.values].filter(([key,value])=>value&&!keysBefore.has(key))).toEqual([]);
      store.setSharedPluginData=originalWrite;
      writeStoredOperation(store,attempt);expect(readStoredOperation(store)).toEqual({status:"valid",operation:attempt});
      restoreStoredOperationSlots(store,before);
    }
    const chunk=Object.keys(old.banks!)[0]!;store.setSharedPluginData("worldbend",chunk,"");expect(readStoredOperation(store)).toEqual({status:"invalid"});
    restoreStoredOperationSlots(store,old);expect(readStoredOperation(store)).toEqual({status:"valid",operation});
    writeStoredOperation(store,{kind:"transform",spec:transform});expect(readStoredOperation(store)).toEqual({status:"valid",operation:{kind:"transform",spec:transform}});
  // This bounded full-control fixture verifies several immutable-bank writes,
  // corruption, rollback and recovery. Its aggregate test work is not one
  // interactive read: give it headroom under concurrent full-suite workers.
  },20000);

  it("reopens an authored shadow with its curved source for later refresh", () => {
    const operation: StoredOperation = {kind:"task",task:{kind:"mockup",spec:{
      schema:"worldbend.mockup",version:"0.1",canvas:{width:100,height:80},background:{kind:"transparent"},seams:[],
      planes:[{id:"cover",sourceId:"source-1",transform,opacity:.8,surface:{kind:"cylinder",curvature:.4},
        shadow:{offset:{x:-12.5,y:18},blurSigmaPx:6,color:[52,27,24],opacity:.35}}],
    }}};
    const store=operationStore();writeStoredOperation(store,operation);
    expect(readStoredOperation(store)).toEqual({status:"valid",operation});
    const invalid=structuredClone(operation);if(invalid.kind!=="task"||invalid.task.kind!=="mockup")throw Error("fixture");
    invalid.task.spec.planes[0]!.shadow!.blurSigmaPx=65;
    const rejectedStore=operationStore();writeStoredOperation(rejectedStore,invalid);
    expect(readStoredOperation(rejectedStore)).toEqual({status:"invalid"});
    expect(readStoredOperation(store)).toEqual({status:"valid",operation});
  });

  it("rejects ambiguous or malformed legacy slots instead of selecting one", () => {
    const store = operationStore();
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, JSON.stringify(transform));
    store.setSharedPluginData(
      SHARED_NAMESPACE,
      SHARED_CANVAS_KEY,
      JSON.stringify(operations[2]!.kind === "canvas" ? operations[2]!.spec : undefined),
    );
    expect(readStoredOperation(store)).toEqual({ status: "invalid" });
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_TRANSFORM_KEY, "");
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_CANVAS_KEY, "{not-json");
    expect(readStoredOperation(store)).toEqual({ status: "invalid" });
  });

  it("restores the exact prior slots after a failed replacement", () => {
    const store = operationStore();
    store.setSharedPluginData(SHARED_NAMESPACE, SHARED_RECTIFY_KEY, JSON.stringify(rectification));
    const before = readStoredOperationSlots(store);
    writeStoredOperation(store, { kind: "transform", spec: transform });
    restoreStoredOperationSlots(store, before);
    expect(readStoredOperationSlots(store)).toEqual(before);
    expect(readStoredOperation(store)).toEqual({
      status: "valid",
      operation: { kind: "rectify", spec: rectification },
    });
  });
});


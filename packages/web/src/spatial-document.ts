import {spatial_document_delivery_json as deliveryJson,spatial_document_inspect_json as inspectJson,spatial_document_update_json as updateJson} from '@worldbend/wasm';
import {initializeWorldbend} from './bridge';
import {throwBridgeError} from './transform-error';
import type {SpatialDocumentDeliveryInput,SpatialDocumentDeliveryPlan,SpatialDocumentSpec,SpatialDocumentInspection,SpatialDocumentUpdateInput,SpatialDocumentUpdatePlan} from './generated/core-contract';
export type {SpatialDocumentDeliveryInput,SpatialDocumentDeliveryPlan,SpatialDocumentSpec,SpatialDocumentAsset,SpatialDocumentInspection,SpatialDocumentUpdateInput,SpatialDocumentUpdatePlan,Scene3DPlan,Scene3DSpec} from './generated/core-contract';

async function invoke<T>(input:unknown,run:(json:string)=>string):Promise<T>{
  const json=JSON.stringify(input);
  if(new TextEncoder().encode(json).length>8*1024*1024)throw Error('Document exceeds the Web receiving record budget');
  await initializeWorldbend();
  try{return JSON.parse(run(json)) as T;}catch(error){return throwBridgeError(error);}
}

export function inspectSpatialDocument(document:SpatialDocumentSpec):Promise<SpatialDocumentInspection>{return invoke(document,inspectJson);}
export function planSpatialDocumentUpdate(input:SpatialDocumentUpdateInput):Promise<SpatialDocumentUpdatePlan>{return invoke(input,updateJson);}

/** The ordinary core planner; no adapter-owned expression or asset semantics. */
export async function planSpatialDocumentDelivery(input:SpatialDocumentDeliveryInput):Promise<SpatialDocumentDeliveryPlan>{
  return invoke(input,deliveryJson);
}

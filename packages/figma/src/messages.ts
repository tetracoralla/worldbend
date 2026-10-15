import {isRasterCanvasChange, type RasterCanvasChange} from "./raster-canvas-change";
import {isNativeVectorSourceView} from "./native-vector-view";
import {sameJsonValue} from "./json-value";
import type { FoilNodeSnapshot } from './foil-material-wire';
import { normalizeCanvasOutputName } from "./canvas-output-name";
import type { MeshGradientNodeSnapshot } from './mesh-gradient-material-wire';
import type { FigmaDeformationTask } from "./stored-designer-task";
import type {
  CardRig,
  SourceCaptureFacts,
  NativeAffineFrameState,
  NativeFramePlan,
  CardView,
  NineNumbers,
  RectifySpecInput,
  TransformSpec,
  VectorProjectionInput,
  VectorProjectionOutput,
} from "@worldbend/web/types";
import { isCardRig, isCardView, isCardSample, type CardSample } from "./card-wire";
import {
  isValidVectorArtworkOutputs,
  type NativeVectorFidelity,
} from "./native-vector-guard";
import type { NativeRenderer } from "./native-projective";
import {
  isFigmaImageAxis,
  isOwnedRectifySpec,
  isOwnedTransformSpec,
  isRecord,
} from "./stored-plane";
import {
  isLocalePreference,
  isSupportedLocale,
  type LocalePreference,
  type SupportedLocale,
  type UserMessage,
} from "./i18n";
import {isNativeVectorExecutionFrame,isNativeVectorStoredOperation,resolveNativeVectorOperation,type NativeVectorStoredOperation} from "./native-vector-operation";
import type {NativeVectorSourceView} from "./native-vector-view";
import type { StoredOperation } from "./stored-operation";
import { isMaterialEdit, isSavedMaterial, type MaterialEditWire, type SavedMaterial, type MaterialOutcome } from "./material-edit-wire";
import {
  isAppearanceRecipeWire,
  isGlassMaterialWire,
  type GlassMaterialWire,
  type AppearanceApplyOutcome,
  type AppearanceNodeSnapshot,
  type AppearancePreviewWire,
  type AppearanceRecipeWire,
} from "./appearance-wire";
import {
  isTextureRecipeWire,
  isTextureMaterialWire,
  type TextureMaterialWire,
  type TextureApplyOutcome,
  type TextureNodeSnapshot,
  type TextureRecipeWire,
} from "./texture-wire";
import {
  isOwnedCanvasSetSpec,
  isOwnedCanvasSpec,
  ownedCanvasOperationOutput,
  type OwnedCanvasSetSpec,
  type OwnedCanvasSpec,
} from "./stored-canvas";
import {
  MAX_FIGMA_CANVAS_PIXELS,
  MAX_FIGMA_CANVAS_VARIANTS,
} from "./canvas-state";
import {
  isStoredDesignerTask,
  type StoredEffectDraft,
  type StoredMockupDraft,
  type StoredDesignerTask,
  type FigmaCompositionTask,
} from "./stored-designer-task";
import {
  isFigmaTaskTemplate,
  normalizeTemplateName,
  type FigmaTaskTemplate,
  type SavedSpatialTemplate,
  type TemplateSlot,
} from "./stored-template-library";
import { isSceneDraftToken } from "./scene-draft-id";
import type { DocumentQuad } from "./native-quad";
import type { DocumentShape } from "./native-shape";
import { isReadySceneId, type ReadySceneId, type SceneArtworkFit } from "./ready-scenes";
import { isPresetEffectSpec, type PresetEffectSpec, type PresetEffectRaster } from "./preset-effect";

export interface SourceRasterPayload {
  bytes: Uint8Array;
  captureFacts?: SourceCaptureFacts;
  sourceNodeId: string;
  sourceName: string;
  renderWidth: number;
  renderHeight: number;
  placement: { x: number; y: number; width: number; height: number };
  /** A simple native four-corner vector that can guide another selected layer. */
  quadGuide?: DocumentQuad;
  /** A closed native vector outline that can clip fitted artwork. */
  shapeGuide?: DocumentShape;
}

export interface SourcePayload extends SourceRasterPayload {
  sources?: SourceRasterPayload[];
  linkedResults?: { total: number; items: Array<{
    nodeId: string;
    name: string;
    revision: number;
    kind: "transform" | "rectify" | "canvas" | "invalid" | StoredDesignerTask["kind"];
    position?: { x: number; y: number };
  }> };
  linkedResultsUnavailable?: true;
  spec?: TransformSpec;
  rectification?: RectifySpecInput;
  canvas?: OwnedCanvasSpec;
  canvasOutputId?: string;
  canvasOutputName?: string;
  task?: StoredDesignerTask;
  deformationDraft?: FigmaDeformationTask;
  effectDraft?: StoredEffectDraft;
  mockupDraft?: StoredMockupDraft;
  mockupDraftUnavailable?: true;
  targetNodeId?: string;
  /** Actual stored result pixels, independent of the source/work coordinates. */
  targetRasterSize?: { width: number; height: number };
  sceneContext?: true;
  /** A saved task changed with identical source pixels; read its native
   * preview without temporary document writes that would clear host Redo. */
  sceneContextReadOnly?: true;
  /** A saved card view continues in its owning workspace on selection. */
  cardResult?: true;
  presetResult?: true;
  nativeRenderer?: NativeRenderer;
  /** Eligible native-content Frame, independently of companion availability. */
  nativeFrameSource?: true;
  nativeSourceSize?: { width: number; height: number };
  nativeAffineState?: NativeAffineFrameState;
  nativeComponentTarget?: true;
  /** Native result axes for intrinsic editing and exact page placement. */
  nativeOutputBasis?: SourceCaptureFacts["logicalToCaptureSpace"];
  nativeSourceEditing?: true;
  nativeRendererPending?: true;
  nativeTarget?: true;
  nativeRevision?: number;
  vectorSource?: true;
  /** The source is a whole Frame or Group; unsupported inner layers keep the
   * HD image route and the UI says which artwork kind was refused. */
  artworkSource?: true;
  /** Supported filled Vector geometry can publish with explicit native fidelity. */
  nativeVector?: true;
  nativeVectorTarget?: true;
  nativeVectorSourceView?:NativeVectorSourceView;
}

export interface NativeApplyPayload {
  nativePlan?: NativeFramePlan;
  generation: number;
  spec: TransformSpec;
  inverse: NineNumbers;
  sourceNodeId: string;
  targetNodeId?: string;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
  duplicate?: boolean;
}

export interface NativeVectorProjectionPayload {
  generation: number;
  spec: TransformSpec;
  operation?:NativeVectorStoredOperation;
  operationExpected?:string;
  sourceNodeIds?:string[];
  sourceView?:NativeVectorSourceView;
  /** Core-planned expanded execution frame; the complete operation stays authored. */
  executionFrame?: import("./native-vector-operation").NativeVectorExecutionFrame;
  matrix: NineNumbers;
  sourceNodeId: string;
  targetNodeId?: string;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
  duplicate?: boolean;
}

export interface NativeVectorApplyPayload extends NativeVectorProjectionPayload {
  /** Core projections the UI relayed through the shared WASM bridge, one per
   * captured part in paint order (a single-part source carries one entry). */
  projection: {
    outputs: VectorProjectionOutput[];
    clip?:VectorProjectionOutput;
    sourceFingerprint: string;
  };
}

export type Placement = SourcePayload["placement"];

export interface SceneContextFrame {
  bytes: Uint8Array;
  width: number;
  height: number;
  placement: Placement;
  resultTransform: [[number, number, number], [number, number, number]];
  resultWidth: number;
  resultHeight: number;
}

export type TemplateMutationReceipt =
  | {
      kind: "save";
      workspace: "canvas" | "mockup" | "mesh" | "surface";
      requestId: number;
    }
  | { kind: "delete"; requestId: number };

export interface CardNodeSnapshot {
  nodeId: string;
  name: string;
  width: number;
  height: number;
  rig?: CardRig;
  backNodeId?: string;
  backName?: string;
  stills?: { viewId: string; view: CardView; sample?: CardSample }[];
  selectedStill?: { viewId: string; view: CardView };
}

export type MainToUiMessage =
  | { type: "shape-fit-error"; generation: number; message: UserMessage }
  | { type: "locale"; preference: LocalePreference; locale: SupportedLocale }
  | { type: "preference-error"; message: UserMessage }
  | {
      type: "template-library";
      templates: SavedSpatialTemplate[];
      mutation?: TemplateMutationReceipt;
    }
  | {
      type: "template-library-error";
      message: UserMessage;
      mutation?: TemplateMutationReceipt;
      useRequestId?: number;
    }
  | { type: "native-scene-preview"; id: string; bytes: Uint8Array }
  | {type:"scene-animation-reply";generation:number;requestId:number;stage:"ready"|"frame"|"complete"|"error";index?:number;nodeId?:string;bytes?:Uint8Array;name?:string;message?:string}
  | { type: "scene-context-preview"; generation: number; requestId: number; frame?: SceneContextFrame }
  | { type: "selection-loading"; generation: number; nodeIds: string[] }
  | { type: "source"; generation: number; payload: SourcePayload }
  | {
      type: "native-vector-projection";
      generation: number;
      inputs: VectorProjectionInput[];
      placement: Placement;
      sourceFingerprint: string;
      sourceView:NativeVectorSourceView;
      operationExpected:string;
    }
  | {
      type: "native-vector-projection-error";
      generation: number;
      message: UserMessage;
    }
  | { type: "source-renderer"; generation: number; sourceNodeId: string; targetNodeId?: string; renderer?: NativeRenderer }
  | { type: "selection-error"; generation: number; message: UserMessage; nativeRecovery?: { nodeId: string; expected: string } }
  | {
      type: "source-raster";
      generation: number;
      requestId: number;
      bytes: Uint8Array;
      captureFacts?: SourceCaptureFacts;
    }
  | {
      type: "source-raster-error";
      generation: number;
      requestId: number;
      message: UserMessage;
    }
  | {
      type: "apply-complete";
      generation: number;
      targetNodeId: string;
      operation: "apply" | "replace";
      nativeRevision?: number;
      /** Fidelity summary for native-vector results; absent otherwise. */
      vectorFidelity?: NativeVectorFidelity;
    }
  | { type: "apply-error"; generation: number; message: UserMessage }
  | {
      type: "apply-canvas-complete";
      generation: number;
      targetNodeIds: string[];
      operation: "apply" | "replace";
    }
  | { type: "apply-canvas-error"; generation: number; message: UserMessage }
  | {
      type: "apply-designer-complete";
      generation: number;
      targetNodeId: string;
      operation: "apply" | "replace";
      vectorFidelity?: NativeVectorFidelity;
      publication?: {placement: Placement; renderWidth:number;renderHeight:number};
    }
  | { type: "apply-designer-error"; generation: number; message: UserMessage }
  | { type: "scene-sizes-ready"; generation: number; sourceNodeId: string }
  | {
      /** Correlated items of one source's linked results, ordered for the batch. */
      type: "linked-batch";
      generation: number;
      items: LinkedBatchItem[];
    }
  | { type: "linked-batch-error"; generation: number; message: UserMessage }
  | { type: "batch-source" } & LinkedBatchSourcePayload
  | { type: "batch-source-error"; generation: number; resultNodeId: string; nodeId: string; message: UserMessage }
  | { type: "material-trial"; generation: number; requestId: number; ok: boolean; previews?: AppearancePreviewWire[]; canvas?: boolean }
  | { type: "material-context-changed"; generation: number }
  | { type: "material-preview"; generation: number; requestId: number; previews: AppearancePreviewWire[] }
  | { type: "material-applied"; generation: number; results: MaterialOutcome[] }
  | { type: "material-library"; materials: SavedMaterial[] }
  | { type: "material-library-error" }
  | { type: "card-state"; generation: number; nodes: CardNodeSnapshot[] }
  | { type: "preset-state"; generation: number; node?: {nodeId:string;name:string;spec?:PresetEffectSpec;resultNodeId?:string}; message?: UserMessage }
  | { type: "preset-source"; generation: number; requestId:number; bytes:string; width:number; height:number; sourceState:string }
  | { type: "preset-applied"; generation:number; nodeId:string }
  | { type: "preset-error"; generation:number; requestId?:number; message:UserMessage }
  | { type: "card-source"; generation: number; requestId: number; bytes: string; width: number; height: number; back?: boolean }
  | { type: "card-rig-applied"; generation: number }
  | { type: "card-still-published"; generation: number; requestId?: number; nodeId: string }
  | { type: "card-error"; generation: number; operation?: "source" | "apply" | "publish"; requestId?: number; message: UserMessage }
  | { type: "appearance-state"; generation: number; nodes: AppearanceNodeSnapshot[] }
  | { type: "appearance-applied"; generation: number; results: AppearanceApplyOutcome[] }
  | { type: "appearance-error"; generation: number; message: UserMessage }
  | {type:"foil-state";generation:number;nodes:FoilNodeSnapshot[]}
  | {type:"mesh-gradient-state";generation:number;nodes:MeshGradientNodeSnapshot[]}
  | { type: "texture-state"; generation: number; nodes: TextureNodeSnapshot[] }
  | { type: "texture-applied"; generation: number; results: TextureApplyOutcome[] }
  | { type: "texture-error"; generation: number; message: UserMessage };

/** One batch item: the stored operation of a linked result plus its node facts. */
export interface LinkedBatchItem {
  nodeId: string;
  name: string;
  revision: number;
  kind: "transform" | "rectify" | "canvas" | "invalid" | StoredDesignerTask["kind"];
  width: number;
  height: number;
  placement: Placement;
  /** Serialized stored operation slot of the result node. */
  operationKind: "transform" | "canvas" | "task";
  operationJson: string;
  /** Binding-order sources; downstream items export them after prerequisites publish. */
  sourceNodeIds?: string[];
  dependencyNodeIds?: string[];
  /** Native editable results and unavailable families keep their ordinary reopen route. */
  updatable?: false;
}

/** One recomputed linked result, published in place through the batch. */
export interface LinkedBatchApplyPayload {
  generation: number;
  nodeId: string;
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
  placement: Placement;
  storedOperation: StoredOperation;
  /** Full binding-order source ids a multi-source item republishes with. */
  sourceNodeIds?: string[];
}

/** A fresh raster of one bound source of an in-flight batch item. */
export interface LinkedBatchSourcePayload {
  shapeGuide?: DocumentShape;
  generation: number;
  resultNodeId: string;
  nodeId: string;
  bytes: Uint8Array;
  renderWidth: number;
  renderHeight: number;
}
export type UiToMainMessage =
  | {type:"scene-animation-begin";generation:number;requestId:number;task:FigmaCompositionTask;renderWidth:number;renderHeight:number}
  | {type:"scene-animation-frame";generation:number;requestId:number;index:number;bytes:Uint8Array}
  | {type:"scene-animation-finish";generation:number;requestId:number}
  | {type:"scene-animation-cancel";generation:number;requestId:number}
  | {type:"prepare-shape-fit";generation:number;task:FigmaDeformationTask}
  | { type: "select-linked-result"; generation: number; sourceNodeId: string; resultNodeId: string }
  | { type: "prepare-linked-batch"; generation: number }
  | { type: "apply-linked-batch-item"; payload: LinkedBatchApplyPayload }
  | {
      /** Ask main for a fresh raster of one bound source of a batch item. */
      type: "export-batch-source";
      generation: number;
      resultNodeId: string;
      nodeId: string;
      desiredWidth: number;
      desiredHeight: number;
    }
  | { type: "request-material-preview"; generation: number; requestId: number }
  | { type: "request-material-trial"; generation: number; requestId: number; edit: MaterialEditWire }
  | { type: "apply-material"; generation: number; edit: MaterialEditWire }
  | { type: "request-material-library" }
  | { type: "material-layout"; active: boolean }
  | { type: "resize-ui"; width: number; height: number }
  | { type: "save-material"; material: SavedMaterial }
  | { type: "delete-material"; recipeId: string }
  | { type: "request-card-state" }
  | { type: "request-preset-state" }
  | { type: "request-preset-source"; generation:number; requestId:number; nodeId:string }
  | { type: "apply-preset-effect"; generation:number; sourceNodeId:string; sourceState:string; spec:PresetEffectSpec; raster:PresetEffectRaster }
  | { type: "edit-preset-source"; generation:number }
  | { type: "request-card-source"; generation: number; requestId: number; nodeId: string; back?: boolean }
  | { type: "apply-card-rig"; generation: number; rig: CardRig; backNodeId?: string }
  | { type: "publish-card-still"; generation: number; requestId: number; name: string; face: "front" | "back"; sample?: CardSample; viewId: string; view: CardView; rig: CardRig; bytes: string; renderWidth: number; renderHeight: number }
  | { type: "request-appearance-state" }
  | { type: "cancel-appearance-draft" }
  | { type: "apply-appearance"; generation: number; recipe: AppearanceRecipeWire; material?: GlassMaterialWire }
  | { type: "request-foil-state" }
  | { type: "request-mesh-gradient-state" }
  | { type: "request-texture-state" }
  | { type: "apply-texture"; generation: number; recipe: TextureRecipeWire; material?: TextureMaterialWire }
  | { type: "open-native-effect-listing" }
  | { type: "restore-native"; generation: number; nodeId: string; expected: string }
  | { type: "apply-native"; payload: NativeApplyPayload }
  | { type: "edit-native-source"; generation:number; sourceNodeId:string; targetNodeId:string; spec:TransformSpec }
  | { type: "request-native-vector-projection"; payload: NativeVectorProjectionPayload }
  | { type: "apply-native-vector"; payload: NativeVectorApplyPayload }
  | { type: "ready"; systemLocales: string[]; sceneDraftSessionId: string }
  | { type: "set-locale"; preference: LocalePreference }
  | {
      type: "scene-draft";
      generation: number;
      bytes: Uint8Array;
      renderWidth: number;
      renderHeight: number;
      placement: Placement;
    }
  | { type: "scene-draft-clear"; generation: number }
  | { type: "request-scene-context"; generation: number; requestId: number; bytes: Uint8Array; showCanvas: boolean; readPublished?: true }
  | {
      type: "save-template";
      workspace: "canvas" | "mockup" | "mesh" | "surface";
      requestId: number;
      name: string;
      template: FigmaTaskTemplate;
      /** Slot descriptors of the saving workspace's live sources. */
      slots?: TemplateSlot[];
    }
  | { type: "save-native-scene"; generation: number; requestId: number; targetNodeId: string; name: string; task: FigmaCompositionTask; bytes: Uint8Array; renderWidth: number; renderHeight: number }
  | { type: "use-native-scene"; generation: number; requestId: number; id: string; fit: SceneArtworkFit }
  | { type: "delete-template"; requestId: number; id: string }
  | { type: "use-ready-scene"; generation: number; requestId: number; id: ReadySceneId; fit: SceneArtworkFit }
  | { type: "trigger-undo" }
  | {
      type: "request-source-raster";
      generation: number;
      requestId: number;
      sourceNodeId: string;
      targetNodeId?: string;
      desiredWidth: number;
      desiredHeight: number;
    }
  | {
      type: "apply";
      payload: {
        generation: number;
        bytes: Uint8Array;
        spec?: TransformSpec;
        rectification?: RectifySpecInput;
        sourceNodeId: string;
        renderWidth: number;
        renderHeight: number;
        placement: Placement;
        targetNodeId?: string;
        /** Create a new result instead of replacing an existing pair target. */
        duplicate?: boolean;
        /** The raster publication stands in for a refused Native Vector projection. */
        nativeVectorFallback?: boolean;
      };
    }
  | {
      type: "apply-canvas";
      payload: {
        generation: number;
        sourceNodeId: string;
        setSpec: OwnedCanvasSetSpec;
        outputs: Array<{
          id: string;
          name?: string;
          bytes: Uint8Array;
          renderWidth: number;
          renderHeight: number;
          placement: Placement;
        }>;
        targetNodeId?: string;
        /** Create a new result instead of replacing the selected Canvas result. */
        duplicate?: boolean;
      };
    }
  | {
      type: "apply-designer";
      payload: {
        generation: number;
        task: StoredDesignerTask;
        sourceNodeIds: string[];
        bytes: Uint8Array;
        renderWidth: number;
        renderHeight: number;
        placement: Placement;
        targetNodeId?: string;
        duplicate?: boolean;
        /** Apply the current linked scene, then size its complete native Frame. */
        sceneSizes?: true;
        nativeVector?:true;
        canvasChange?:RasterCanvasChange;
      };
    };

export function isUiToMainMessage(value: unknown): value is UiToMainMessage {
  if (!isRecord(value) || typeof value["type"] !== "string") return false;
  if (value["type"] === "prepare-shape-fit") return hasExactKeys(value,["type","generation","task"]) &&
    isRequestId(value["generation"]) && isStoredDesignerTask(value["task"]) && value["task"].kind === "deformation" &&
    value["task"].shapeGuideSourceIndex !== undefined;
  if (value["type"] === "open-native-effect-listing") return Object.keys(value).length === 1;
  if (value["type"] === "select-linked-result") return hasExactKeys(value, ["type", "generation", "sourceNodeId", "resultNodeId"]) &&
    isRequestId(value["generation"]) &&
    [value["sourceNodeId"], value["resultNodeId"]].every((id) => typeof id === "string" && id.length > 0 && id.length <= 256);
  if (value["type"] === "prepare-linked-batch") return hasExactKeys(value, ["type", "generation"]) &&
    isRequestId(value["generation"]);
  if (value["type"] === "request-appearance-state") return Object.keys(value).length === 1;
  if (value["type"] === "request-card-state") return Object.keys(value).length === 1;
  if (value["type"] === "request-preset-state") return Object.keys(value).length === 1;
  if (value["type"] === "edit-preset-source") return hasExactKeys(value,["type","generation"]) && isRequestId(value["generation"]);
  if (value["type"] === "request-preset-source") return hasExactKeys(value,["type","generation","requestId","nodeId"]) &&
    isRequestId(value["generation"]) && isRequestId(value["requestId"]) && typeof value["nodeId"] === "string" && value["nodeId"].length>0 && value["nodeId"].length<=256;
  if (value["type"] === "apply-preset-effect") {
    const r=value["raster"];
    return hasExactKeys(value,["type","generation","sourceNodeId","sourceState","spec","raster"]) && isRequestId(value["generation"]) &&
      typeof value["sourceNodeId"]==="string" && value["sourceNodeId"].length>0 && value["sourceNodeId"].length<=256 &&
      typeof value["sourceState"]==="string" && value["sourceState"].length>0 && value["sourceState"].length<=1_000_000 && isPresetEffectSpec(value["spec"]) &&
      isRecord(r) && hasExactKeys(r,["width","height","origin","layers",...(r["baseWidth"]===undefined?[]:["baseWidth"])]) &&
      [r["width"],r["height"]].every(v=>Number.isInteger(v)&&(v as number)>=1&&(v as number)<=8192) &&
      isRecord(r["origin"]) && hasExactKeys(r["origin"],["x","y"]) && [r["origin"]["x"],r["origin"]["y"]].every(v=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=1_000_000) &&
      (r["baseWidth"]===undefined || typeof r["baseWidth"]==="number"&&Number.isFinite(r["baseWidth"])&&r["baseWidth"]>0&&r["baseWidth"]<=8192) &&
      Array.isArray(r["layers"]) && r["layers"].length>=1 && r["layers"].length<=2 && r["layers"].every(layer=>isRecord(layer) &&
        hasExactKeys(layer,["name","bytes","quad"]) && ["card","fold-inner","fold-outer"].includes(String(layer["name"])) &&
        typeof layer["bytes"]==="string" && layer["bytes"].length>0 && layer["bytes"].length<=16_000_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(layer["bytes"]) &&
        isRecord(layer["quad"]) && hasExactKeys(layer["quad"],["tl","tr","br","bl"]) && Object.values(layer["quad"]).every(p=>isRecord(p)&&hasExactKeys(p,["x","y"])&&
          [p["x"],p["y"]].every(v=>typeof v==="number"&&Number.isFinite(v)&&Math.abs(v)<=1_000_000))) &&
      ((value["spec"].effect==="fold-screen" && typeof r["baseWidth"]==="number" && r["layers"].length===1 && r["layers"][0]["name"]==="fold-inner") ||
        (value["spec"].effect!=="fold-screen" && r["baseWidth"]===undefined && r["layers"].length===1 && r["layers"][0]["name"]==="card")) &&
      r["layers"].every(layer=>Object.values(layer["quad"] as Record<string,{x:number;y:number}>).every(p=>p.x>=0&&p.y>=0&&p.x<=(r["width"] as number)&&p.y<=(r["height"] as number)));
  }
  if (value["type"] === "request-card-source") return (hasExactKeys(value, ["type", "generation", "requestId", "nodeId"]) ||
      (hasExactKeys(value, ["type", "generation", "requestId", "nodeId", "back"]) &&
        typeof value["back"] === "boolean")) &&
      isRequestId(value["generation"]) && isRequestId(value["requestId"]) &&
      typeof value["nodeId"] === "string" && value["nodeId"].length > 0 && value["nodeId"].length <= 64;
  if (value["type"] === "apply-card-rig") return (hasExactKeys(value, ["type", "generation", "rig"]) ||
      (hasExactKeys(value, ["type", "generation", "rig", "backNodeId"]) &&
        typeof value["backNodeId"] === "string" && value["backNodeId"].length > 0 && value["backNodeId"].length <= 64)) &&
      isRequestId(value["generation"]) && isCardRig(value["rig"]);
  if (value["type"] === "publish-card-still") return hasExactKeys(value, ["type", "generation", "requestId", "name", "face", "viewId", "view", "rig", "bytes", "renderWidth", "renderHeight", ...(value["sample"] === undefined ? [] : ["sample"])]) &&
      (value["sample"] === undefined || isCardSample(value["sample"])) &&
      isRequestId(value["generation"]) && isRequestId(value["requestId"]) &&
      typeof value["name"] === "string" && value["name"].trim().length > 0 && [...value["name"]].length <= 96 &&
      (value["face"] === "front" || value["face"] === "back") &&
      typeof value["viewId"] === "string" && /^[a-z0-9-]{1,64}$/.test(value["viewId"]) &&
      isCardView(value["view"]) && isCardRig(value["rig"]) &&
      typeof value["bytes"] === "string" && value["bytes"].length > 0 && value["bytes"].length <= 16_000_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(value["bytes"]) &&
      Number.isInteger(value["renderWidth"]) && (value["renderWidth"] as number) >= 1 && (value["renderWidth"] as number) <= 8192 &&
      Number.isInteger(value["renderHeight"]) && (value["renderHeight"] as number) >= 1 && (value["renderHeight"] as number) <= 8192;
  if (value["type"] === "request-material-library") return Object.keys(value).length === 1;
  if (value["type"] === "resize-ui") return hasExactKeys(value, ["type", "width", "height"]) &&
    typeof value["width"] === "number" && Number.isInteger(value["width"]) && value["width"] >= 300 && value["width"] <= 1600 && typeof value["height"] === "number" && Number.isInteger(value["height"]) && value["height"] >= 440 && value["height"] <= 1200;
  if (value["type"] === "material-layout") return hasExactKeys(value, ["type", "active"]) && typeof value["active"] === "boolean";
  if (value["type"] === "save-material") return hasExactKeys(value, ["type", "material"]) && isSavedMaterial(value["material"]);
  if (value["type"] === "delete-material") return hasExactKeys(value, ["type", "recipeId"]) && typeof value["recipeId"] === "string" && value["recipeId"].length <= 64;
  if (value["type"] === "apply-material") return hasExactKeys(value, ["type", "generation", "edit"]) && isRequestId(value["generation"]) && isMaterialEdit(value["edit"]);
  if (value["type"] === "request-material-preview") return hasExactKeys(value,["type","generation","requestId"]) && isRequestId(value["generation"]) && isRequestId(value["requestId"]);
  if (value["type"] === "request-material-trial") return hasExactKeys(value, ["type", "generation", "requestId", "edit"]) && isRequestId(value["generation"]) && isRequestId(value["requestId"]) && isMaterialEdit(value["edit"]);
  if (value["type"] === "apply-appearance") return (hasExactKeys(value, ["type", "generation", "recipe"]) ||
    hasExactKeys(value, ["type", "generation", "recipe", "material"])) &&
    isRequestId(value["generation"]) &&
    isAppearanceRecipeWire(value["recipe"]) &&
    (value["material"] === undefined || isGlassMaterialWire(value["material"]));
  if (value["type"] === "request-foil-state" || value["type"] === "request-mesh-gradient-state" || value["type"] === "request-texture-state" || value["type"] === "cancel-appearance-draft") return Object.keys(value).length === 1;
  if (value["type"] === "apply-texture") return (hasExactKeys(value, ["type", "generation", "recipe"]) ||
    hasExactKeys(value, ["type", "generation", "recipe", "material"])) &&
    isRequestId(value["generation"]) &&
    isTextureRecipeWire(value["recipe"]) &&
    (value["material"] === undefined || isTextureMaterialWire(value["material"]));
  if (value["type"] === "apply-linked-batch-item") return isLinkedBatchApplyMessage(value);
  if (value["type"] === "export-batch-source") return hasExactKeys(value, ["type", "generation", "resultNodeId", "nodeId", "desiredWidth", "desiredHeight"]) &&
    isRequestId(value["generation"]) &&
    [value["resultNodeId"], value["nodeId"]].every((id) => typeof id === "string" && id.length > 0 && id.length <= 256) &&
    Number.isSafeInteger(value["desiredWidth"]) && Number(value["desiredWidth"]) >= 1 &&
    Number.isSafeInteger(value["desiredHeight"]) && Number(value["desiredHeight"]) >= 1;
  if (value["type"] === "restore-native") return hasExactKeys(value, ["type", "generation", "nodeId", "expected"]) &&
    isRequestId(value["generation"]) && typeof value["nodeId"] === "string" && value["nodeId"].length > 0 && value["nodeId"].length <= 256 &&
    typeof value["expected"] === "string" && value["expected"].length > 0 && value["expected"].length <= 4096;
  if (value["type"] === "ready") {
    return (
      hasExactKeys(value, ["type", "systemLocales", "sceneDraftSessionId"]) &&
      isSceneDraftToken(value["sceneDraftSessionId"]) &&
      Array.isArray(value["systemLocales"]) &&
      value["systemLocales"].length <= 16 &&
      value["systemLocales"].every(
        (locale) => typeof locale === "string" && locale.length > 0 && locale.length <= 64,
      )
    );
  }
  if(value["type"]==="scene-animation-begin")return hasExactKeys(value,["type","generation","requestId","task","renderWidth","renderHeight"])&&isRequestId(value["generation"])&&isRequestId(value["requestId"])&&isStoredDesignerTask(value["task"])&&value["task"].kind==="composition"&&Boolean(value["task"].motion)&&isFigmaImageAxis(value["renderWidth"])&&isFigmaImageAxis(value["renderHeight"]);
  if(value["type"]==="scene-animation-frame")return hasExactKeys(value,["type","generation","requestId","index","bytes"])&&isRequestId(value["generation"])&&isRequestId(value["requestId"])&&Number.isSafeInteger(value["index"])&&Number(value["index"])>=0&&Number(value["index"])<240&&value["bytes"] instanceof Uint8Array&&value["bytes"].length>0&&value["bytes"].length<=16*1024*1024;
  if(value["type"]==="scene-animation-finish"||value["type"]==="scene-animation-cancel")return hasExactKeys(value,["type","generation","requestId"])&&isRequestId(value["generation"])&&isRequestId(value["requestId"]);
  if (value["type"] === "set-locale") {
    return Object.keys(value).length === 2 && isLocalePreference(value["preference"]);
  }
  if (value["type"] === "save-template") {
    const slots = value["slots"];
    return (
      hasExactKeys(value, ["type", "workspace", "requestId", "name", "template",
        ...(slots === undefined ? [] : ["slots"])]) &&
      (value["workspace"] === "canvas" || value["workspace"] === "mockup" ||
        value["workspace"] === "mesh" || value["workspace"] === "surface") &&
      isRequestId(value["requestId"]) &&
      typeof value["name"] === "string" &&
      normalizeTemplateName(value["name"]) === value["name"] &&
      isFigmaTaskTemplate(value["template"]) &&
      (value["template"].operation.kind === value["workspace"] ||
        (value["workspace"] === "mockup" && value["template"].operation.kind === "compositionProgram") ||
        (value["template"].operation.kind === "deformation" &&
          value["workspace"] === (value["template"].operation.view === "pin" ? "surface" : "mesh"))) &&
      (slots === undefined ||
        (Array.isArray(slots) && slots.length >= 1 && slots.length <= 8 &&
          slots.every((slot) =>
            isRecord(slot) && hasExactKeys(slot, ["name", "width", "height"]) &&
            typeof slot["name"] === "string" && slot["name"].length >= 1 && slot["name"].length <= 128 &&
            Number.isSafeInteger(slot["width"]) && Number(slot["width"]) >= 1 && Number(slot["width"]) <= 4096 &&
            Number.isSafeInteger(slot["height"]) && Number(slot["height"]) >= 1 && Number(slot["height"]) <= 4096)))
    );
  }
  if (value["type"] === "delete-template") {
    return (
      hasExactKeys(value, ["type", "requestId", "id"]) &&
      isRequestId(value["requestId"]) &&
      typeof value["id"] === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value["id"])
    );
  }
  if (value["type"] === "save-native-scene") {
    return hasExactKeys(value, ["type", "generation", "requestId", "targetNodeId", "name", "task", "bytes", "renderWidth", "renderHeight"]) &&
      isRequestId(value["generation"]) && isRequestId(value["requestId"]) && typeof value["targetNodeId"] === "string" &&
      value["targetNodeId"].length > 0 && value["targetNodeId"].length <= 256 && typeof value["name"] === "string" &&
      normalizeTemplateName(value["name"]) === value["name"] && isStoredDesignerTask(value["task"]) &&
      (value["task"].kind === "mockup" || value["task"].kind === "composition") && value["bytes"] instanceof Uint8Array &&
      value["bytes"].byteLength >= 1 && value["bytes"].byteLength <= 128 * 1024 * 1024 &&
      isFigmaImageAxis(value["renderWidth"]) && isFigmaImageAxis(value["renderHeight"]);
  }
  if (value["type"] === "use-native-scene") {
    return hasExactKeys(value, ["type", "generation", "requestId", "id", "fit"]) && isRequestId(value["generation"]) && isRequestId(value["requestId"]) &&
      typeof value["id"] === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value["id"]) &&
      (value["fit"] === "cover" || value["fit"] === "contain");
  }
  if (value["type"] === "use-ready-scene") {
    return hasExactKeys(value, ["type", "generation", "requestId", "id", "fit"]) && isRequestId(value["generation"]) && isRequestId(value["requestId"]) &&
      isReadySceneId(value["id"]) && (value["fit"] === "cover" || value["fit"] === "contain");
  }
  if (value["type"] === "trigger-undo") return Object.keys(value).length === 1;
  if (value["type"] === "scene-draft") {
    return (
      hasExactKeys(value, ["type", "generation", "bytes", "renderWidth", "renderHeight", "placement"]) &&
      isRequestId(value["generation"]) &&
      value["bytes"] instanceof Uint8Array &&
      value["bytes"].byteLength >= 1 &&
      value["bytes"].byteLength <= 32 * 1024 * 1024 &&
      isFigmaImageAxis(value["renderWidth"]) &&
      isFigmaImageAxis(value["renderHeight"]) &&
      isPlacement(value["placement"])
    );
  }
  if (value["type"] === "scene-draft-clear") {
    return hasExactKeys(value, ["type", "generation"]) && isRequestId(value["generation"]);
  }
  if (value["type"] === "request-scene-context") {
    return hasExactKeys(value, ["type", "generation", "requestId", "bytes", "showCanvas", ...(value["readPublished"] === undefined ? [] : ["readPublished"])]) &&
      (value["readPublished"] === undefined || (value["readPublished"] === true && value["showCanvas"] === false)) &&
      isRequestId(value["generation"]) && isRequestId(value["requestId"]) && typeof value["showCanvas"] === "boolean" &&
      value["bytes"] instanceof Uint8Array && value["bytes"].byteLength > 0 && value["bytes"].byteLength <= 32 * 1024 * 1024;
  }
  if (value["type"] === "request-source-raster") {
    const allowed = new Set([
      "type",
      "generation",
      "requestId",
      "sourceNodeId",
      "targetNodeId",
      "desiredWidth",
      "desiredHeight",
    ]);
    return (
      !Object.keys(value).some((key) => !allowed.has(key)) &&
      Number.isSafeInteger(value["generation"]) &&
      Number(value["generation"]) >= 1 &&
      Number.isSafeInteger(value["requestId"]) &&
      Number(value["requestId"]) >= 1 &&
      typeof value["sourceNodeId"] === "string" &&
      value["sourceNodeId"].length > 0 &&
      (value["targetNodeId"] === undefined ||
        (typeof value["targetNodeId"] === "string" && value["targetNodeId"].length > 0)) &&
      isFigmaImageAxis(value["desiredWidth"]) &&
      isFigmaImageAxis(value["desiredHeight"])
    );
  }
  if (value["type"] === "apply-canvas") return isApplyCanvasMessage(value);
  if (value["type"] === "apply-designer") return isApplyDesignerMessage(value);
  if (value["type"] === "apply-native") {
    if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
    const p = value["payload"];
    return hasExactKeys(p, ["generation", "spec", "inverse", "sourceNodeId", "renderWidth", "renderHeight", "placement",
      ...(p["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
      ...(p["duplicate"] === undefined ? [] : ["duplicate"]),
      ...(p["nativePlan"] === undefined ? [] : ["nativePlan"])]) &&
      (p["nativePlan"] === undefined || isNativeFramePlan(p["nativePlan"])) &&
      isRequestId(p["generation"]) && isOwnedTransformSpec(p["spec"]) && !p["spec"].content.warp &&
      Array.isArray(p["inverse"]) && p["inverse"].length === 9 &&
      p["inverse"].every((n) => typeof n === "number" && Number.isFinite(n)) &&
      typeof p["sourceNodeId"] === "string" && p["sourceNodeId"].length > 0 && p["sourceNodeId"].length <= 256 &&
      isFigmaImageAxis(p["renderWidth"]) && isFigmaImageAxis(p["renderHeight"]) && isPlacement(p["placement"]) &&
      (p["targetNodeId"] === undefined || (typeof p["targetNodeId"] === "string" && p["targetNodeId"].length > 0 && p["targetNodeId"].length <= 256)) &&
      (p["duplicate"] === undefined || typeof p["duplicate"] === "boolean");
  }
  if(value["type"]==="edit-native-source")return hasExactKeys(value,["type","generation","sourceNodeId","targetNodeId","spec"])&&
    isRequestId(value["generation"])&&isOwnedTransformSpec(value["spec"])&&!value["spec"].content.warp&&
    [value["sourceNodeId"],value["targetNodeId"]].every(id=>typeof id==="string"&&id.length>0&&id.length<=256);
  if (value["type"] === "request-native-vector-projection" || value["type"] === "apply-native-vector") {
    if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
    const p = value["payload"];
    const base = hasExactKeys(p, ["generation", "spec", "matrix", "sourceNodeId", "renderWidth", "renderHeight", "placement",
      ...(p["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
      ...(p["duplicate"] === undefined ? [] : ["duplicate"]),
      ...["operation","operationExpected","sourceNodeIds","sourceView","executionFrame"].filter(k=>p[k]!==undefined),
      ...(value["type"] === "apply-native-vector" ? ["projection"] : [])]) &&
      isRequestId(p["generation"]) && isOwnedTransformSpec(p["spec"])  &&
      Array.isArray(p["matrix"]) && p["matrix"].length === 9 &&
      p["matrix"].every((n) => typeof n === "number" && Number.isFinite(n)) &&
      typeof p["sourceNodeId"] === "string" && p["sourceNodeId"].length > 0 && p["sourceNodeId"].length <= 256 &&
      isFigmaImageAxis(p["renderWidth"]) && isFigmaImageAxis(p["renderHeight"]) && isPlacement(p["placement"]) &&
      (p["targetNodeId"] === undefined || (typeof p["targetNodeId"] === "string" && p["targetNodeId"].length > 0 && p["targetNodeId"].length <= 256)) &&
      (p["duplicate"] === undefined || typeof p["duplicate"] === "boolean");
    const op=p["operation"];
    let modern=true;
    if(op!==undefined){
      modern=isNativeVectorStoredOperation(op);
      if(modern){const r=resolveNativeVectorOperation(op as NativeVectorStoredOperation);
        modern=sameJsonValue(r.plane,p["spec"])&&Array.isArray(p["sourceNodeIds"])&&
          p["sourceNodeIds"].length===r.sourceCount&&new Set(p["sourceNodeIds"]).size===r.sourceCount&&
          p["sourceNodeIds"].every((id:unknown)=>typeof id==="string"&&id.length>0&&id.length<=256)&&
          p["sourceNodeIds"][r.artworkSourceIndex]===p["sourceNodeId"];
      }
    }else if(p["sourceNodeIds"]!==undefined||p["operationExpected"]!==undefined||p["sourceView"]!==undefined)modern=false;
    if(p["operationExpected"]!==undefined)modern=modern&&typeof p["operationExpected"]==="string"&&/^[a-f0-9]{64}$/.test(p["operationExpected"]);
    if(p["sourceView"]!==undefined)modern=modern&&isNativeVectorSourceView(p["sourceView"]);
    if(p["executionFrame"]!==undefined)modern=modern&&isNativeVectorExecutionFrame(p["executionFrame"])&&
      isNativeVectorStoredOperation(op)&&op.kind==="task"&&op.task.spec.boundary==="free";
    if(value["type"]==="request-native-vector-projection"||!base||!modern)return base&&modern;
    // apply-native-vector must carry structurally valid core projections with
    // the snapshot fingerprint they were computed from.
    const projection = p["projection"];
    return base && isRecord(projection) &&
      hasExactKeys(projection, ["outputs", "sourceFingerprint",...(projection["clip"]===undefined?[]:["clip"])]) &&
      typeof projection["sourceFingerprint"] === "string" &&
      /^source32x2:\d+:[0-9a-f]{16}$/.test(projection["sourceFingerprint"]) &&
      Array.isArray(projection["outputs"])&&isValidVectorArtworkOutputs([...(projection["clip"]===undefined?[]:[projection["clip"]]),...projection["outputs"]]);
  }
  if (value["type"] !== "apply" || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const allowed = new Set([
    "generation",
    "bytes",
    "spec",
    "rectification",
    "sourceNodeId",
    "renderWidth",
    "renderHeight",
    "placement",
    "targetNodeId",
    "duplicate",
    "nativeVectorFallback",
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return false;
  if (
    !Number.isSafeInteger(payload["generation"]) ||
    Number(payload["generation"]) < 1 ||
    !(payload["bytes"] instanceof Uint8Array) ||
    payload["bytes"].byteLength < 1 ||
    payload["bytes"].byteLength > 128 * 1024 * 1024 ||
    (isOwnedTransformSpec(payload["spec"]) ===
      isOwnedRectifySpec(payload["rectification"])) ||
    typeof payload["sourceNodeId"] !== "string" ||
    payload["sourceNodeId"].length === 0 ||
    !isFigmaImageAxis(payload["renderWidth"]) ||
    !isFigmaImageAxis(payload["renderHeight"])
    || !isPlacement(payload["placement"])
  ) {
    return false;
  }
  if (payload["duplicate"] !== undefined && typeof payload["duplicate"] !== "boolean") {
    return false;
  }
  if (payload["nativeVectorFallback"] !== undefined && typeof payload["nativeVectorFallback"] !== "boolean") {
    return false;
  }
  return (
    payload["targetNodeId"] === undefined ||
    (typeof payload["targetNodeId"] === "string" && payload["targetNodeId"].length > 0)
  );
}

function isRequestId(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 1;
}

function isLinkedBatchApplyMessage(
  value: Record<string, unknown>,
): value is Extract<UiToMainMessage, { type: "apply-linked-batch-item" }> {
  if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const stored = payload["storedOperation"];
  const storedValid = isRecord(stored) &&
    (stored["kind"] === "transform"
      ? isOwnedTransformSpec(stored["spec"])
      : stored["kind"] === "canvas" ? isOwnedCanvasSpec(stored["spec"])
      : stored["kind"] === "task" && isStoredDesignerTask(stored["task"]));
  const sourceIds = payload["sourceNodeIds"];
  const sourceIdsValid = sourceIds === undefined ||
    (Array.isArray(sourceIds) && sourceIds.length >= 1 && sourceIds.length <= 8 &&
      sourceIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256));
  return (
    hasExactKeys(payload, ["generation", "nodeId", "bytes", "renderWidth", "renderHeight", "placement", "storedOperation",
      ...(sourceIds === undefined ? [] : ["sourceNodeIds"])]) &&
    isRequestId(payload["generation"]) &&
    typeof payload["nodeId"] === "string" && payload["nodeId"].length > 0 && payload["nodeId"].length <= 256 &&
    payload["bytes"] instanceof Uint8Array &&
    Number.isSafeInteger(payload["renderWidth"]) && Number(payload["renderWidth"]) >= 1 &&
    Number.isSafeInteger(payload["renderHeight"]) && Number(payload["renderHeight"]) >= 1 &&
    isPlacement(payload["placement"]) &&
    sourceIdsValid &&
    storedValid
  );
}

function isApplyDesignerMessage(
  value: Record<string, unknown>,
): value is Extract<UiToMainMessage, { type: "apply-designer" }> {
  if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  const expected = [
    "generation", "task", "sourceNodeIds", "bytes", "renderWidth", "renderHeight", "placement",
    ...(payload["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
    ...(payload["duplicate"] === undefined ? [] : ["duplicate"]),
    ...(payload["sceneSizes"] === undefined ? [] : ["sceneSizes"]),
    ...(payload["nativeVector"] === undefined ? [] : ["nativeVector"]),
    ...(payload["canvasChange"] === undefined ? [] : ["canvasChange"]),
  ];
  return (
    hasExactKeys(payload, expected) &&
    Number.isSafeInteger(payload["generation"]) &&
    Number(payload["generation"]) >= 1 &&
    isStoredDesignerTask(payload["task"]) &&
    Array.isArray(payload["sourceNodeIds"]) &&
    payload["sourceNodeIds"].length >= 1 &&
    payload["sourceNodeIds"].length <= 8 &&
    new Set(payload["sourceNodeIds"]).size === payload["sourceNodeIds"].length &&
    payload["sourceNodeIds"].every((id) => typeof id === "string" && id.length > 0) &&
    payload["bytes"] instanceof Uint8Array &&
    (payload["bytes"].byteLength>=1||payload["nativeVector"]===true)&&
    payload["bytes"].byteLength <= 128 * 1024 * 1024 &&
    isFigmaImageAxis(payload["renderWidth"]) &&
    isFigmaImageAxis(payload["renderHeight"]) &&
    isPlacement(payload["placement"]) &&
    (payload["targetNodeId"] === undefined ||
      (typeof payload["targetNodeId"] === "string" && payload["targetNodeId"].length > 0)) &&
    (payload["duplicate"] === undefined || typeof payload["duplicate"] === "boolean") &&
    (payload["nativeVector"] === undefined || (payload["nativeVector"]===true&&payload["task"].kind==="deformation")) &&
    (payload["canvasChange"] === undefined || (payload["task"].kind==="deformation" && payload["nativeVector"]!==true &&
      payload["targetNodeId"]!==undefined && payload["duplicate"]!==true && isRasterCanvasChange(payload["canvasChange"]))) &&
    (payload["sceneSizes"] === undefined || (payload["sceneSizes"] === true && payload["targetNodeId"] !== undefined &&
      payload["duplicate"] !== true && (payload["task"].kind === "mockup" || payload["task"].kind === "composition")))
  );
}

function isApplyCanvasMessage(
  value: Record<string, unknown>,
): value is Extract<UiToMainMessage, { type: "apply-canvas" }> {
  if (!hasExactKeys(value, ["type", "payload"]) || !isRecord(value["payload"])) return false;
  const payload = value["payload"];
  if (
    !hasExactKeys(payload, [
      "generation",
      "sourceNodeId",
      "setSpec",
      "outputs",
      ...(payload["targetNodeId"] === undefined ? [] : ["targetNodeId"]),
      ...(payload["duplicate"] === undefined ? [] : ["duplicate"]),
    ]) ||
    !Number.isSafeInteger(payload["generation"]) ||
    Number(payload["generation"]) < 1 ||
    typeof payload["sourceNodeId"] !== "string" ||
    payload["sourceNodeId"].length === 0 ||
    !isOwnedCanvasSetSpec(payload["setSpec"]) ||
    !Array.isArray(payload["outputs"]) ||
    payload["outputs"].length < 1 ||
    payload["outputs"].length > MAX_FIGMA_CANVAS_VARIANTS ||
    payload["outputs"].length !== payload["setSpec"].variants.length ||
    (payload["targetNodeId"] !== undefined &&
      (typeof payload["targetNodeId"] !== "string" || payload["targetNodeId"].length === 0)) ||
    (payload["duplicate"] !== undefined && typeof payload["duplicate"] !== "boolean") ||
    (payload["targetNodeId"] !== undefined && payload["outputs"].length !== 1)
  ) {
    return false;
  }
  let pixels = 0;
  let bytes = 0;
  for (let index = 0; index < payload["outputs"].length; index += 1) {
    const output = payload["outputs"][index];
    const variant = payload["setSpec"].variants[index];
    const declaredOutput = variant
      ? ownedCanvasOperationOutput(variant.operation)
      : undefined;
    if (
      !isRecord(output) ||
      !hasExactKeys(output, ["id", "bytes", "renderWidth", "renderHeight", "placement", ...(output["name"] === undefined ? [] : ["name"])]) ||
      (output["name"] !== undefined && normalizeCanvasOutputName(output["name"]) !== output["name"]) ||
      !variant ||
      output["id"] !== variant.id ||
      !(output["bytes"] instanceof Uint8Array) ||
      output["bytes"].byteLength < 1 ||
      !isFigmaImageAxis(output["renderWidth"]) ||
      !isFigmaImageAxis(output["renderHeight"]) ||
      (declaredOutput !== undefined &&
        (output["renderWidth"] !== declaredOutput.width ||
          output["renderHeight"] !== declaredOutput.height)) ||
      !isPlacement(output["placement"]) ||
      !sameAspectRatio(
        output["placement"],
        output["renderWidth"],
        output["renderHeight"],
      )
    ) {
      return false;
    }
    pixels += output["renderWidth"] * output["renderHeight"];
    bytes += output["bytes"].byteLength;
    if (
      !Number.isSafeInteger(pixels) ||
      pixels > MAX_FIGMA_CANVAS_PIXELS ||
      !Number.isSafeInteger(bytes) ||
      bytes > 128 * 1024 * 1024
    ) {
      return false;
    }
  }
  return true;
}

function sameAspectRatio(placement: Placement, width: number, height: number): boolean {
  const left = placement.width * height;
  const right = placement.height * width;
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(left), Math.abs(right));
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function isPlacement(value: unknown): value is Placement {
  if (!isRecord(value)) return false;
  if (
    Object.keys(value).length !== 4 ||
    !["x", "y", "width", "height"].every((key) => key in value)
  ) {
    return false;
  }
  const x = value["x"];
  const y = value["y"];
  const width = value["width"];
  const height = value["height"];
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0
  );
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

export function isMainToUiLocaleMessage(
  value: unknown,
): value is Extract<MainToUiMessage, { type: "locale" }> {
  return (
    isRecord(value) &&
    value["type"] === "locale" &&
    Object.keys(value).length === 3 &&
    isLocalePreference(value["preference"]) &&
    isSupportedLocale(value["locale"])
  );
}

/** Structural admission only; the shared core creates this geometry plan. */
function isNativeFramePlan(v: unknown): v is NativeFramePlan {
  if (!isRecord(v)) return false;
  const size=(n:unknown)=>isRecord(n)&&hasExactKeys(n,["width","height"])&&[n.width,n.height].every(x=>typeof x==="number"&&Number.isFinite(x)&&x>0);
  const matrix=(n:unknown)=>Array.isArray(n)&&n.length===2&&n.every(row=>Array.isArray(row)&&row.length===3&&row.every(x=>typeof x==="number"&&Number.isFinite(x)&&Math.abs(x)<=1e9));
  if(!size(v.sourceSize)||!size(v.outputSize))return false;
  if(v.kind==="affine")return hasExactKeys(v,["kind","sourceSize","outputSize","logicalToOutput","outerBasis","innerBasis","contentScale","numericalResidual"])&&matrix(v.logicalToOutput)&&matrix(v.outerBasis)&&matrix(v.innerBasis)&&typeof v.contentScale==="number"&&Number.isFinite(v.contentScale)&&v.contentScale>0&&typeof v.numericalResidual==="number"&&Number.isFinite(v.numericalResidual)&&v.numericalResidual>=0;
  return v.kind==="projective"&&hasExactKeys(v,["kind","sourceSize","outputSize","inverse"])&&Array.isArray(v.inverse)&&v.inverse.length===9&&v.inverse.every(x=>typeof x==="number"&&Number.isFinite(x));
}

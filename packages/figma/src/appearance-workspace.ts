import { BUILTIN_FOIL_RECIPES } from './foil-material-wire';
import type { FoilNodeSnapshot, FoilColorChannels } from './foil-material-wire';
import { changedFoilFields } from './foil-wire';
import type { FoilRecipeWire, FoilMaterialWire, FoilWireField, FoilColorWire } from './foil-wire';
import { BUILTIN_MESH_GRADIENT_RECIPES } from './mesh-gradient-material-wire';
import type { MeshGradientNodeSnapshot, MeshGradientColorChannels } from './mesh-gradient-material-wire';
import { changedMeshGradientFields, meshGradientProperty } from './mesh-gradient-wire';
import type { MeshGradientRecipeWire, MeshGradientMaterialWire, MeshGradientWireField, MeshGradientColorWire } from './mesh-gradient-wire';
import { MESH_GRADIENT_LEGACY_PROFILE } from './mesh-gradient-resource-wire';
import {
  BUILTIN_APPEARANCE_RECIPES,
  changedGlassFields,
  GLASS_WIRE_FIELDS,
  type AppearanceNodeSnapshot,
  type AppearanceRecipeWire,
  type GlassMaterialWire,
  type GlassWireField,
} from "./appearance-wire";
import {
  BUILTIN_TEXTURE_RECIPES,
  changedTextureFields,
  type TextureNodeSnapshot,
  type TextureRecipeWire,
  type TextureMaterialWire,
  type TextureWireField,
} from "./texture-wire";
import {
  numericInput,
  type DesignerTaskWorkspace,
  type DesignerWorkspaceCopy,
  type DesignerWorkspaceSource,
} from "./designer-workspace-common";
import { sliderProgress } from "./slider-domain";
import type { MainToUiMessage, UiToMainMessage } from "./messages";
import type { MaterialEditWire, SavedMaterial } from "./material-edit-wire";
import { createContextualHelp } from "./contextual-help";
import { MATERIAL_THUMBNAILS } from "./material-thumbnails";
import { createSceneDraftToken } from "./scene-draft-id";
export type MaterialFamily = "glass" | "texture" | "foil" | "mesh-gradient";

export interface AppearanceWorkspaceCopy extends DesignerWorkspaceCopy {
  allMaterials: string;
  tune: string;
  cancel: string;
  saveVariation: string;
  remove: string;
  libraryError: string;
  trialReady: string;
  trialInWindow: string;
  trialLoading: string;
  trialFailed: string;
  variationName: string;
  mixed: string;
  edited: string;
  deleteLook: string;
  closeTuning: string;
  artworkPreview: string;
  controlGroups: Record<
    "optics" | "lighting" | "grain" | "etching" | "display" | "motion" | "corners" | "surface",
    string
  >;
  glassFamily: string;
  textureFamily: string;
  foilFamily:string;foilUnavailable:string;foilUnverified:string;foilLegacy:string;foilMultiple:string;
  foilLocked:string;foilInvalid:string;foilNoFills:string;foilAdopt:string;foilAdoptNote:string;foilOpacity:string;
  foilFieldNames:Record<FoilWireField,string>;
  meshGradientFamily:string;meshGradientUnavailable:string;meshGradientUnverified:string;meshGradientLegacy:string;meshGradientMultiple:string;
  meshGradientLocked:string;meshGradientInvalid:string;meshGradientNoFills:string;meshGradientAdopt:string;meshGradientAdoptNote:string;meshGradientOpacity:string;
  meshGradientFieldNames:Record<MeshGradientWireField,string>;
  recipeNames: Record<string, string>;
  visible: string;
  clipToShape: string;
  applyToSelection: string;
  selectionEmpty: string;
  selectionSummary: string;
  untagged: string;
  absent: string;
  customizedFields: string;
  removedGlass: string;
  multipleGlass: string;
  noEffects: string;
  previewNote: string;
  retryPreview: string;
  previewHelp: string;
  opaqueFill: string;
  backgroundBlur: string;
  invalidGlass: string;
  fieldNames: Record<GlassWireField, string>;
  textureUntagged: string;
  textureAbsent: string;
  textureRemovedTexture: string;
  textureMultipleNoise: string;
  textureMultipleTexture: string;
  textureInvalidTexture: string;
  textureFieldNames: Record<TextureWireField, string>;
}

interface FieldControl {
  family: MaterialFamily;
  field: string;
  label: HTMLElement;
  input: HTMLInputElement;
  valueInput?: HTMLInputElement | undefined;
  channelGroup?:'rgb'|'alpha';
}
export function createAppearanceWorkspace(input: {
  root: HTMLElement;
  copy(): AppearanceWorkspaceCopy;
  onBack(): void;
  post(message: UiToMainMessage): void;
  formatError(error: unknown): string;
}): DesignerTaskWorkspace {
  const root = input.root;
  root.classList.add("designer-workspace", "appearance-workspace");
  root.innerHTML = `<header class="designer-header"><h1></h1><span data-role="help"></span></header>
    <div class="material-body"><div class="material-applied"></div><div class="material-filter" role="group"></div>
    <div class="material-catalog"></div><div class="material-view"><div class="material-stage"><div class="material-stage-images"></div><p class="material-stage-empty"></p></div><section class="material-tuning" hidden><header><h2></h2><button type="button" data-role="close-tuning">×</button></header><div class="appearance-controls"></div>
    <form class="material-save"><input type="text" maxlength="64"><button type="submit"></button></form></section></div><div class="appearance-status"></div></div>
    <footer class="designer-footer" hidden><span class="material-feedback" role="status"></span><button data-role="tune-trial" type="button"></button><button data-role="reset" type="button"></button><button data-role="apply" class="primary" type="button"></button></footer>
    <p class="designer-error" role="alert" hidden></p><span class="sr-only" role="status" data-role="status"></span>`;
  const el = <T extends HTMLElement>(selector: string): T => {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(selector);
    return node;
  };
  const shell = {
    root,
    title: el("h1"),
    apply: el<HTMLButtonElement>("[data-role=apply]"),
    reset: el<HTMLButtonElement>("[data-role=reset]"),
    status: el("[data-role=status]"),
    showError(text?: string) {
      const box = el(".designer-error");
      box.textContent = text ?? "";
      box.hidden = !text;
    },
  };
  const inspector = el(".appearance-controls"),
    catalog = el(".material-catalog"),
    applied = el(".material-applied"),
    footer = el("footer"),
    tuning = el(".material-tuning"),
    feedback = el(".material-feedback"),
    status = el(".appearance-status");
  const help = createContextualHelp();
  help.button.dataset.role = "preview-help";
  el("[data-role=help]").append(help.button);
  let active = false,
    busy = false,
    generation: number | undefined;
  let family: MaterialFamily = "glass",
    filter: MaterialFamily | "all" = "all";
  let nodes: AppearanceNodeSnapshot[] = [],
    textureNodes: TextureNodeSnapshot[] = [];
  let foilNodes:FoilNodeSnapshot[]=[];
  let meshNodes:MeshGradientNodeSnapshot[]=[];
  const firstRecipe = BUILTIN_APPEARANCE_RECIPES[0]!,
    firstTextureRecipe = BUILTIN_TEXTURE_RECIPES[0]!,firstFoilRecipe=BUILTIN_FOIL_RECIPES[0]!,firstMeshRecipe=BUILTIN_MESH_GRADIENT_RECIPES[0]!;
  let seed = structuredClone(firstRecipe),
    textureSeed = structuredClone(firstTextureRecipe),foilSeed=structuredClone(firstFoilRecipe),meshSeed=structuredClone(firstMeshRecipe);
  let material = structuredClone(seed.material),
    textureMaterial = structuredClone(textureSeed.material),foilMaterial=structuredClone(foilSeed.material),meshMaterial=structuredClone(meshSeed.material);
  const colorChannels:FoilColorChannels={};
  const meshColorChannels:MeshGradientColorChannels={};
  let adopt=false;
  let candidate = false,
    wholePreset = false,
    remove = false;
  const fields = new Set<string>();
  let draftKey: string | undefined,
    draftRenderId = 0,
    trial: "loading" | "ready" | "failed" = "loading";
  let nativeKey: string | undefined,
    nativeRequestId = 0,
    nativePreviews: import("./appearance-wire").AppearancePreviewWire[] = [],
    trialPreviews: import("./appearance-wire").AppearancePreviewWire[] = [];
  let trialOnCanvas = true;
  let nativeLoading = false,
    stageKey: string | undefined;
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let saved: SavedMaterial[] = [],
    saving = false,
    saveId: string | undefined;
  const cards = new Map<
    string,
    {
      wrapper: HTMLElement;
      button: HTMLButtonElement;
      deletion: HTMLButtonElement;
      label: HTMLElement;
      img: HTMLImageElement;
      edit: MaterialEditWire;
    }
  >();
  const workspaceCopy = () => input.copy();
  const recipeName = (id: string, key: MaterialFamily): string =>
    saved.find(s => s.edit.recipe.recipeId === id)?.name ??
    workspaceCopy().recipeNames[id] ??
    familyName(key);
  const eligibleNodes = () => nodes.filter((n) => n.eligible);
  const eligibleTextureNodes = () => textureNodes.filter((n) => n.eligible);
  const eligibleFoilNodes=()=>foilNodes.filter(n=>n.eligible);
  const eligibleMeshNodes=()=>meshNodes.filter(n=>n.eligible);
  const familyName=(key:MaterialFamily)=>key==='glass'?workspaceCopy().glassFamily:key==='texture'?workspaceCopy().textureFamily:key==='foil'?workspaceCopy().foilFamily:workspaceCopy().meshGradientFamily;
  const snapshotsFor=(key:MaterialFamily)=>key==='glass'?nodes:key==='texture'?textureNodes:key==='foil'?foilNodes:meshNodes;
  const eligibleFor=(key:MaterialFamily)=>key==='glass'?eligibleNodes():key==='texture'?eligibleTextureNodes():key==='foil'?eligibleFoilNodes():eligibleMeshNodes();
  const currentMaterial=()=>family==='glass'?material:family==='texture'?textureMaterial:family==='foil'?foilMaterial:meshMaterial;
  const currentSeed=()=>family==='glass'?seed:family==='texture'?textureSeed:family==='foil'?foilSeed:meshSeed;
  function clearDraftMarks(): void {
    fields.clear();adopt=false;
    delete colorChannels["base-color"];delete colorChannels["highlight-color"];
    delete meshColorChannels["color-tl"];delete meshColorChannels["color-tr"];delete meshColorChannels["color-bl"];delete meshColorChannels["color-br"];
  }
  function channelMap(key:MaterialFamily):FoilColorChannels|MeshGradientColorChannels|undefined {
    return key==='foil'?colorChannels:key==='mesh-gradient'?meshColorChannels:undefined;
  }
  function editedChannels(key:MaterialFamily,field:string):readonly string[] {
    const map=channelMap(key) as Partial<Record<string,readonly string[]>>|undefined;
    return map?.[field]??[];
  }
  const familyNodes = () => snapshotsFor(family);
  const currentNodes = () =>
    eligibleFor(family);
  function requestState(): void {
    input.post({ type: "request-appearance-state" });
    input.post({ type: "request-texture-state" });
  }
  function cancelDraftPreview(): void {
    input.post({ type: "cancel-appearance-draft" });
    trialPreviews = [];
    draftKey = undefined;
    if (nativeLoading) {
      nativeKey = undefined;
      nativeLoading = false;
      nativeRequestId += 1;
    }
    draftRenderId += 1;
    if (draftTimer !== undefined) {
      clearTimeout(draftTimer);
      draftTimer = undefined;
    }
  }
  function nativeValues(): void {
    const glass = eligibleNodes()[0],
      texture = eligibleTextureNodes()[0],foil=eligibleFoilNodes()[0],mesh=eligibleMeshNodes()[0];
    seed = structuredClone(glass?.provenance ?? firstRecipe);
    textureSeed = structuredClone(texture?.provenance ?? firstTextureRecipe);
    foilSeed=structuredClone(foil?.provenance??firstFoilRecipe);
    meshSeed=structuredClone(mesh?.provenance??firstMeshRecipe);
    setControlsFrom(
      glass?.live ?? seed.material,
      texture?.live ?? textureSeed.material,
      foil?.live??foilSeed.material,
      mesh?.live??meshSeed.material,
    );
  }
  function cancelTrial(): void {
    cancelDraftPreview();
    // Restore the cached image immediately, then recapture and resume observing
    // its context. Cancelling feedback also retires the host's observations.
    nativeKey = undefined;
    candidate = false;
    wholePreset = false;
    remove = false;
    clearDraftMarks();
    nativeValues();
    shell.showError();
    requestNativePreview();
    render();
  }
  shell.reset.addEventListener("click", cancelTrial);
  el<HTMLButtonElement>("[data-role=tune-trial]").addEventListener(
    "click",
    () => openTuning(family),
  );
  shell.apply.addEventListener("click", () => {
    if (
      !active ||
      busy ||
      !candidate ||
      generation === undefined ||
      !validControls() ||
      trial !== "ready"
    )
      return;
    busy = true;
    input.post({ type: "apply-material", generation, edit: edit() });
    render();
  });
  function closeTuning(): void {
    tuning.hidden = true;
    render();
    applied
      .querySelector<HTMLButtonElement>(`[data-action="tune-${family}"]`)
      ?.focus();
  }
  el<HTMLButtonElement>("[data-role=close-tuning]").addEventListener(
    "click",
    closeTuning,
  );
  const filters = new Map<MaterialFamily | "all", HTMLButtonElement>();
  for (const key of ["all", "glass", "texture", "foil", "mesh-gradient"] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.family = key;
    button.addEventListener("click", () => {
      filter = key;
      render();
    });
    el(".material-filter").append(button);
    filters.set(key, button);
  }
  const controls: FieldControl[] = [
    ...buildGlassControls(),
    ...buildTextureControls(),
    ...buildFoilControls(),
    ...buildMeshGradientControls(),
  ];

  function buildGlassControls(): FieldControl[] {
    const entries: {
      field: GlassWireField;
      min: number;
      max: number;
      step: number;
      value: number;
      slider: boolean;
    }[] = [
      {
        field: "light-intensity",
        min: 0,
        max: 1,
        step: 0.01,
        value: material.lightIntensity,
        slider: true,
      },
      {
        field: "light-angle",
        min: 0,
        max: 359.999,
        step: 0.01,
        value: material.lightAngle,
        slider: false,
      },
      {
        field: "refraction",
        min: 0,
        max: 1,
        step: 0.01,
        value: material.refraction,
        slider: true,
      },
      {
        field: "dispersion",
        min: 0,
        max: 1,
        step: 0.01,
        value: material.dispersion,
        slider: true,
      },
      {
        field: "depth",
        min: 1,
        max: 1000,
        step: 0.1,
        value: material.depth,
        slider: false,
      },
      {
        field: "radius",
        min: 0,
        max: 1000,
        step: 1,
        value: material.radius,
        slider: false,
      },
    ];
    return entries.map((entry) => {
      const row = document.createElement("label");
      row.className = "designer-field appearance-field";
      const text = document.createElement("span");
      const holder: HTMLInputElement = entry.slider
        ? rangeInput(entry.value, entry.min, entry.max, entry.step)
        : numericInput(entry.value, entry.min, entry.max, String(entry.step));
      holder.dataset.field = entry.field;
      holder.addEventListener("input", () => {
        if (!validNumberInput(holder)) {
          render();
          return;
        }
        const value = Number(holder.value);
        if (!Number.isFinite(value)) return;
        writeGlassField(entry.field, value);
        syncRangeProgress(holder);
        if (holder.type !== "range") render();
      });
      appendNumericControl(row, text, holder, entry.slider, (value) =>
        writeGlassField(entry.field, value),
      );
      inspector.append(row);
      return {
        family: "glass",
        field: entry.field,
        label: text,
        input: holder,
        valueInput:
          row.querySelector<HTMLInputElement>(
            ".designer-range-pair input[type='number']",
          ) ?? undefined,
      };
    });
  }

  function buildTextureControls(): FieldControl[] {
    const numeric: {
      field: TextureWireField;
      min: number;
      max: number;
      step: number;
      value: number;
      slider: boolean;
    }[] = [
      {
        field: "grain",
        min: 0,
        max: 1,
        step: 0.01,
        value: textureMaterial.grain,
        slider: true,
      },
      {
        field: "grain-size",
        min: 0.5,
        max: 1000,
        step: 0.5,
        value: textureMaterial.grainSize,
        slider: false,
      },
      {
        field: "etch",
        min: 0,
        max: 1000,
        step: 0.1,
        value: textureMaterial.etch,
        slider: false,
      },
      {
        field: "etch-size",
        min: 0.5,
        max: 1000,
        step: 0.5,
        value: textureMaterial.etchSize,
        slider: false,
      },
    ];
    const built: FieldControl[] = numeric.map((entry): FieldControl => {
      const row = document.createElement("label");
      row.className = "designer-field appearance-field";
      const text = document.createElement("span");
      const holder: HTMLInputElement = entry.slider
        ? rangeInput(entry.value, entry.min, entry.max, entry.step)
        : numericInput(entry.value, entry.min, entry.max, String(entry.step));
      holder.dataset.field = entry.field;
      holder.addEventListener("input", () => {
        if (!validNumberInput(holder)) {
          render();
          return;
        }
        const value = Number(holder.value);
        if (!Number.isFinite(value)) return;
        writeTextureField(entry.field, value);
        syncRangeProgress(holder);
        if (holder.type !== "range") render();
      });
      appendNumericControl(row, text, holder, entry.slider, (value) =>
        writeTextureField(entry.field, value),
      );
      inspector.append(row);
      return {
        family: "texture",
        field: entry.field,
        label: text,
        input: holder,
        valueInput:
          row.querySelector<HTMLInputElement>(
            ".designer-range-pair input[type='number']",
          ) ?? undefined,
      };
    });
    const colorRow = document.createElement("label");
    colorRow.className = "designer-field appearance-field";
    const colorLabel = document.createElement("span");
    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = textureMaterial.grainColor;
    colorInput.dataset.field = "grain-color";
    colorInput.addEventListener("input", () => {
      textureMaterial = { ...textureMaterial, grainColor: colorInput.value };
      markField("grain-color");
      render();
    });
    colorRow.append(colorLabel, colorInput);
    inspector.append(colorRow);
    built.push({
      family: "texture" as MaterialFamily,
      field: "grain-color",
      label: colorLabel,
      input: colorInput,
    });
    return built;
  }

  function buildFoilControls():FieldControl[] {
    const result:FieldControl[]=[];
    for(const [field,min,max,step] of [['light-angle',0,360,.01],['intensity',0,1,.01],['roughness',0,1,.01],['flow-speed',0,2,.01]] as const) {
      const row=document.createElement('label');row.className='designer-field appearance-field';
      const label=document.createElement('span');
      const key=field.replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase()) as 'lightAngle'|'intensity'|'roughness'|'flowSpeed';
      const holder=(field==='light-angle'?numericInput(foilMaterial[key],min,max,String(step)):rangeInput(foilMaterial[key],min,max,step));holder.dataset.field=field;
      const write=(value:number)=>{foilMaterial={...foilMaterial,[key]:value};markField(field);render();};
      holder.addEventListener('input',()=>{if(validNumberInput(holder))write(holder.valueAsNumber);else render();});
      appendNumericControl(row,label,holder,field!=='light-angle',write);
      inspector.append(row);
      result.push({family:'foil',field,label,input:holder,valueInput:row.querySelector<HTMLInputElement>('.designer-range-pair input[type="number"]')??undefined});
    }
    for(const field of ['base-color','highlight-color'] as const)for(const channelGroup of ['rgb','alpha'] as const) {
      const row=document.createElement('label');row.className='designer-field appearance-field';
      const label=document.createElement('span'),holder=document.createElement('input');
      holder.type=channelGroup==='rgb'?'color':'number';holder.dataset.field=field;holder.dataset.channel=channelGroup;
      if(channelGroup==='alpha'){holder.min='0';holder.max='100';holder.step='any';}
      holder.addEventListener('input',()=>{
        if(channelGroup==='alpha'&&!validNumberInput(holder)){render();return;}
        const key=field==='base-color'?'baseColor':'highlightColor',color={...foilMaterial[key]};
        const keys:('r'|'g'|'b'|'a')[]=channelGroup==='alpha'?['a']:['r','g','b'];
        if(channelGroup==='alpha')color.a=holder.valueAsNumber/100;
        else for(const [index,key] of (['r','g','b'] as const).entries())color[key]=parseInt(holder.value.slice(1+index*2,3+index*2),16)/255;
        foilMaterial={...foilMaterial,[key]:color};
        colorChannels[field]=[...new Set([...(colorChannels[field]??[]),...keys])];
        markField(field);render();
      });
      row.append(label,holder);inspector.append(row);
      result.push({family:'foil',field,label,input:holder,channelGroup});
    }
    return result;
  }

  function buildMeshGradientControls():FieldControl[] {
    const result:FieldControl[]=[];
    for(const [field,min,max,step] of [['warp',0,1,.01],['softness',0,1,.01],['duration-ms',100,60000,1],['phase-ms',0,60000,1],['flow-speed',0,2,.01]] as const) {
      const row=document.createElement('label');row.className='designer-field appearance-field';
      const label=document.createElement('span');
      const key=meshGradientProperty(field);
      const numeric=field==='duration-ms'||field==='phase-ms';
      const current=meshMaterial[key] as number;
      const holder=(numeric?numericInput(current,min,max,String(step)):rangeInput(current,min,max,step));holder.dataset.field=field;
      const write=(value:number)=>{meshMaterial={...meshMaterial,[key]:value};markField(field);render();};
      holder.addEventListener('input',()=>{if(validNumberInput(holder))write(holder.valueAsNumber);else render();});
      appendNumericControl(row,label,holder,!numeric,write);
      inspector.append(row);
      result.push({family:'mesh-gradient',field,label,input:holder,valueInput:row.querySelector<HTMLInputElement>('.designer-range-pair input[type="number"]')??undefined});
    }
    for(const field of ['color-tl','color-tr','color-bl','color-br'] as const)for(const channelGroup of ['rgb','alpha'] as const) {
      const row=document.createElement('label');row.className='designer-field appearance-field';
      const label=document.createElement('span'),holder=document.createElement('input');
      holder.type=channelGroup==='rgb'?'color':'number';holder.dataset.field=field;holder.dataset.channel=channelGroup;
      if(channelGroup==='alpha'){holder.min='0';holder.max='100';holder.step='any';}
      holder.addEventListener('input',()=>{
        if(channelGroup==='alpha'&&!validNumberInput(holder)){render();return;}
        const key=meshGradientProperty(field) as 'colorTl'|'colorTr'|'colorBl'|'colorBr',color={...meshMaterial[key]};
        const keys:('r'|'g'|'b'|'a')[]=channelGroup==='alpha'?['a']:['r','g','b'];
        if(channelGroup==='alpha')color.a=holder.valueAsNumber/100;
        else for(const [index,channel] of (['r','g','b'] as const).entries())color[channel]=parseInt(holder.value.slice(1+index*2,3+index*2),16)/255;
        meshMaterial={...meshMaterial,[key]:color};
        meshColorChannels[field]=[...new Set([...(meshColorChannels[field]??[]),...keys])];
        markField(field);render();
      });
      row.append(label,holder);inspector.append(row);
      result.push({family:'mesh-gradient',field,label,input:holder,channelGroup});
    }
    return result;
  }
  const colorHex=(color:FoilColorWire|MeshGradientColorWire)=>'#'+[color.r,color.g,color.b].map(channel=>Math.round(channel*255).toString(16).padStart(2,'0')).join('');

  const visibleRow = document.createElement("label");
  visibleRow.className = "designer-field appearance-visible";
  const visibleLabel = document.createElement("span");
  const visibleInput = document.createElement("input");
  visibleInput.type = "checkbox";
  visibleInput.checked = material.visible;
  visibleInput.addEventListener("change", () => {
    if (family === "glass")
      material = { ...material, visible: visibleInput.checked };
    else if(family==="texture")
      textureMaterial = { ...textureMaterial, visible: visibleInput.checked };
    else if(family==="foil") foilMaterial={...foilMaterial,visible:visibleInput.checked};
    else meshMaterial={...meshMaterial,visible:visibleInput.checked};
    markField("visible");
    render();
  });
  visibleRow.append(visibleInput, visibleLabel);
  inspector.append(visibleRow);

  const clipRow = document.createElement("label");
  clipRow.className = "designer-field appearance-clip";
  const clipLabel = document.createElement("span");
  const clipInput = document.createElement("input");
  clipInput.type = "checkbox";
  clipInput.checked = textureMaterial.clipToShape;
  clipInput.addEventListener("change", () => {
    textureMaterial = { ...textureMaterial, clipToShape: clipInput.checked };
    markField("clip-to-shape");
    render();
  });
  clipRow.append(clipInput, clipLabel);
  inspector.append(clipRow);

  const controlGroups = [
    {
      key: "optics",
      family: "glass",
      fields: ["refraction", "depth", "radius", "dispersion"],
    },
    {
      key: "lighting",
      family: "glass",
      fields: ["light-intensity", "light-angle"],
    },
    {
      key: "grain",
      family: "texture",
      fields: ["grain", "grain-size", "grain-color"],
    },
    { key: "etching", family: "texture", fields: ["etch", "etch-size"] },
    {key:'optics',family:'foil',fields:['base-color','highlight-color','roughness']},
    {key:'lighting',family:'foil',fields:['light-angle','intensity']},
    {key:'motion',family:'foil',fields:['flow-speed']},
    {key:'corners',family:'mesh-gradient',fields:['color-tl','color-tr','color-bl','color-br']},
    {key:'surface',family:'mesh-gradient',fields:['warp','softness']},
    {key:'motion',family:'mesh-gradient',fields:['duration-ms','phase-ms','flow-speed']},
    { key: "display", fields: [] },
  ].map((group) => {
    const section = document.createElement("fieldset");
    section.className = "material-control-group";
    section.dataset.group = group.key;
    const title = document.createElement("legend");
    const body = document.createElement("div");
    body.className = "material-group-fields";
    for (const field of group.fields) {
      for(const control of controls.filter(c=>c.family===group.family&&c.field===field)) {
      const row = control.input.closest("label")!;
      row.dataset.wide = String(control.input.type === "range");
      body.append(row);
      }
    }
    if (group.key === "display") body.append(visibleRow, clipRow);
    section.append(title, body);
    inspector.append(section);
    return {
      key: group.key as keyof AppearanceWorkspaceCopy["controlGroups"],
      family: group.family,
      section,
      title,
    };
  });

  function syncRangeProgress(target: HTMLInputElement): void {
    if (target.type !== "range") return;
    target.style.setProperty(
      "--range-progress",
      `${sliderProgress(Number(target.value), Number(target.min), Number(target.max))}%`,
    );
  }

  /** Reuse the shared slider/number pattern for scrubbing and exact entry. */
  function appendNumericControl(
    row: HTMLElement,
    label: HTMLElement,
    holder: HTMLInputElement,
    slider: boolean,
    write: (value: number) => void,
  ): void {
    row.append(label);
    if (!slider) {
      row.append(holder);
      return;
    }
    const pair = document.createElement("div");
    pair.className = "designer-range-pair";
    const number = numericInput(
      Number(holder.value),
      Number(holder.min),
      Number(holder.max),
      holder.step,
    );
    number.dataset.valueFor = holder.dataset.field;
    number.addEventListener("input", () => {
      if (!validNumberInput(number)) {
        render();
        return;
      }
      holder.value = number.value;
      write(Number(number.value));
      syncRangeProgress(holder);
      render();
    });
    holder.addEventListener("input", () => {
      number.value = holder.value;
      render();
    });
    pair.append(holder, number);
    row.append(pair);
  }

  function validNumberInput(holder: HTMLInputElement): boolean {
    const value = Number(holder.value);
    // Step controls the increment buttons, not the permissible precision of
    // a value typed by a designer or read from Figma's native panel.
    return (
      holder.value !== "" &&
      Number.isFinite(value) &&
      value >= Number(holder.min) &&
      value <= Number(holder.max)
    );
  }

  function writeGlassField(field: GlassWireField, value: number): void {
    markField(field);
    switch (field) {
      case "light-intensity":
        material = { ...material, lightIntensity: value };
        break;
      case "light-angle":
        material = { ...material, lightAngle: value };
        break;
      case "refraction":
        material = { ...material, refraction: value };
        break;
      case "dispersion":
        material = { ...material, dispersion: value };
        break;
      case "depth":
        material = { ...material, depth: value };
        break;
      case "radius":
        material = { ...material, radius: value };
        break;
      default:
        break;
    }
  }

  function writeTextureField(field: TextureWireField, value: number): void {
    markField(field);
    switch (field) {
      case "grain":
        textureMaterial = { ...textureMaterial, grain: value };
        break;
      case "grain-size":
        textureMaterial = { ...textureMaterial, grainSize: value };
        break;
      case "etch":
        textureMaterial = { ...textureMaterial, etch: value };
        break;
      case "etch-size":
        textureMaterial = { ...textureMaterial, etchSize: value };
        break;
      default:
        break;
    }
  }

  function readGlassField(
    field: GlassWireField,
    source: GlassMaterialWire,
  ): number {
    switch (field) {
      case "light-intensity":
        return source.lightIntensity;
      case "light-angle":
        return source.lightAngle;
      case "refraction":
        return source.refraction;
      case "dispersion":
        return source.dispersion;
      case "depth":
        return source.depth;
      case "radius":
        return source.radius;
      default:
        return 0;
    }
  }

  function readTextureField(
    field: TextureWireField,
    source: TextureMaterialWire,
  ): string {
    switch (field) {
      case "grain":
        return String(source.grain);
      case "grain-size":
        return String(source.grainSize);
      case "etch":
        return String(source.etch);
      case "etch-size":
        return String(source.etchSize);
      case "grain-color":
        return source.grainColor;
      default:
        return "";
    }
  }

  function setControlsFrom(
    glass: GlassMaterialWire,
    texture: TextureMaterialWire,
    foil:FoilMaterialWire=foilMaterial,
    mesh:MeshGradientMaterialWire=meshMaterial,
  ): void {
    material = { ...glass };
    textureMaterial = { ...texture };
    foilMaterial=structuredClone(foil);
    meshMaterial=structuredClone(mesh);
    for (const control of controls) {
      const value =
        control.family === "glass"
          ? readGlassField(control.field as GlassWireField, glass)
          : control.family==='texture'?readTextureField(control.field as TextureWireField, texture)
          : control.family==='foil'
          ? control.channelGroup ? (control.channelGroup==='rgb'?colorHex(foil[control.field==='base-color'?'baseColor':'highlightColor']):Number((foil[control.field==='base-color'?'baseColor':'highlightColor'].a*100).toPrecision(7)))
          : foil[control.field.replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase()) as 'lightAngle'|'intensity'|'roughness'|'flowSpeed']
          : control.channelGroup ? (control.channelGroup==='rgb'?colorHex(mesh[meshGradientProperty(control.field as MeshGradientWireField) as 'colorTl'|'colorTr'|'colorBl'|'colorBr']):Number((mesh[meshGradientProperty(control.field as MeshGradientWireField) as 'colorTl'|'colorTr'|'colorBl'|'colorBr'].a*100).toPrecision(7)))
          : mesh[meshGradientProperty(control.field as MeshGradientWireField)] as number;
      control.input.value = String(value);
      syncRangeProgress(control.input);
      if (control.valueInput)
        control.valueInput.value = String(Number(Number(value).toPrecision(7)));
    }
    visibleInput.checked = currentMaterial().visible;
    clipInput.checked = texture.clipToShape;
  }
  function edit(): MaterialEditWire {
    const patch = !wholePreset && fields.size ? [...fields] : undefined;
    return family === "glass"
      ? {
          family,
          recipe: seed,
          material: { ...material },
          ...(patch ? { fields: patch as GlassWireField[] } : {}),
          ...(remove ? { remove: true } : {}),
        }
      : family==="foil" ? {family,recipe:foilSeed,material:structuredClone(foilMaterial),
          ...(patch?{fields:patch as FoilWireField[]}:{}),...(remove?{remove:true}:{}),...(adopt?{adopt:true}:{}),
          ...(patch&&Object.keys(colorChannels).length?{colorChannels:structuredClone(colorChannels)}:{})}
      : family==="mesh-gradient" ? {family,recipe:meshSeed,material:structuredClone(meshMaterial),
          ...(patch?{fields:patch as MeshGradientWireField[]}:{}),...(remove?{remove:true}:{}),...(adopt?{adopt:true}:{}),
          ...(patch&&Object.keys(meshColorChannels).length?{colorChannels:structuredClone(meshColorChannels)}:{})}
      : {
          family,
          recipe: textureSeed,
          material: { ...textureMaterial },
          ...(patch ? { fields: patch as TextureWireField[] } : {}),
          ...(remove ? { remove: true } : {}),
        };
  }
  function markField(field: string): void {
    candidate = true;
    remove = false;
    fields.add(field);
  }
  function validControls(): boolean {
    return !controls.some(
      (c) =>
        c.family === family &&
        (c.valueInput ?? c.input).type === "number" &&
        !(c.input.dataset.mixed === 'true' && !(c.channelGroup?editedChannels(c.family,c.field).includes(c.channelGroup==='alpha'?'a':'r'):fields.has(c.field))) &&
        !validNumberInput(c.valueInput ?? c.input),
    );
  }
  function choose(value: MaterialEditWire): void {
    cancelDraftPreview();
    family = value.family;
    clearDraftMarks();
    wholePreset = true;
    remove = false;
    if (value.family === "glass") {
      seed = structuredClone(value.recipe);
      setControlsFrom(value.material, textureMaterial);
    } else if(value.family==="foil") {foilSeed=structuredClone(value.recipe);setControlsFrom(material,textureMaterial,value.material);}
    else if(value.family==="mesh-gradient") {meshSeed=structuredClone(value.recipe);setControlsFrom(material,textureMaterial,foilMaterial,value.material);}
    else {
      textureSeed = structuredClone(value.recipe);
      setControlsFrom(material, value.material);
    }
    candidate = currentNodes().length > 0;
    shell.showError();
    render();
  }
  function openTuning(key: MaterialFamily): void {
    if (key !== family || !candidate) {
      cancelTrial();
      family = key;
      nativeValues();
    }
    tuning.hidden = false;
    render();
    el<HTMLInputElement>(
      ".appearance-controls .designer-field:not([hidden]) input",
    ).focus();
  }
  function choices(): {
    edit: MaterialEditWire;
    name?: string;
    thumbnail?: string;
  }[] {
    const values: {
      edit: MaterialEditWire;
      name?: string;
      thumbnail?: string;
    }[] = [
      ...BUILTIN_APPEARANCE_RECIPES.map((recipe) => ({
        edit: { family: "glass" as const, recipe, material: recipe.material },
      })),
      ...BUILTIN_TEXTURE_RECIPES.map((recipe) => ({
        edit: { family: "texture" as const, recipe, material: recipe.material },
      })),
      ...BUILTIN_FOIL_RECIPES.map(recipe=>({edit:{family:'foil' as const,recipe,material:recipe.material}})),
      ...BUILTIN_MESH_GRADIENT_RECIPES.map(recipe=>({edit:{family:'mesh-gradient' as const,recipe,material:recipe.material}})),
      ...saved,
    ];
    for (const [key, snapshots] of [
      ["glass", nodes],
      ["texture", textureNodes],
      ["foil", foilNodes.filter(n=>n.canChoose)],
      ["mesh-gradient", meshNodes.filter(n=>n.canChoose)],
    ] as const) {
      const origin = snapshots[0]?.provenance;
      if (
        origin &&
        !values.some((v) => v.edit.recipe.recipeId === origin.recipeId)
      )
        values.push({
          edit:
            key === "glass"
              ? {
                  family: key,
                  recipe: origin as AppearanceRecipeWire,
                  material: (origin as AppearanceRecipeWire).material,
                }
              : key==='foil'?{family:key,recipe:origin as FoilRecipeWire,material:(origin as FoilRecipeWire).material}
              : key==='mesh-gradient'?{family:key,recipe:origin as MeshGradientRecipeWire,material:(origin as MeshGradientRecipeWire).material}
              : {
                  family: key,
                  recipe: origin as TextureRecipeWire,
                  material: (origin as TextureRecipeWire).material,
                },
        });
    }
    return values;
  }
  function renderStage(): void {
    const area = el(".material-stage"),
      holder = el(".material-stage-images"),
      empty = el(".material-stage-empty");
    area.setAttribute("aria-label", workspaceCopy().artworkPreview);
    const previews =
      candidate && trial === "ready" ? trialPreviews : nativePreviews;
    const key = JSON.stringify(previews);
    if (key !== stageKey) {
      stageKey = key;
      holder.replaceChildren();
      for (const preview of previews) {
        const img = document.createElement("img");
        img.alt = workspaceCopy().artworkPreview;
        img.src = `data:image/png;base64,${preview.bytes}`;
        holder.append(img);
      }
    }
    holder.querySelectorAll("img").forEach((img) => {
      img.alt = workspaceCopy().artworkPreview;
    });
    holder.hidden = !previews.length;
    empty.hidden = previews.length > 0;
    empty.textContent = nodes.length
      ? nativeLoading
        ? workspaceCopy().trialLoading
        : workspaceCopy().trialFailed
      : workspaceCopy().selectionEmpty;
    if (nodes.length && !nativeLoading && !previews.length && !candidate) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = workspaceCopy().retryPreview;
      retry.addEventListener("click", () => {
        nativeKey = undefined;
        requestNativePreview();
        render();
      });
      empty.append(" ", retry);
    }
    area.setAttribute(
      "aria-busy",
      String(candidate ? trial === "loading" : nativeLoading),
    );
    area.dataset.pending = String(candidate ? trial !== "ready" : nativeLoading);
  }
  function requestNativePreview(): void {
    if (
      !active ||
      candidate ||
      busy ||
      !nodes.length ||
      generation === undefined
    )
      return;
    const key = JSON.stringify({ generation, nodes, textureNodes,foilNodes,meshNodes });
    if (key === nativeKey) return;
    nativeKey = key;
    nativeLoading = true;
    input.post({
      type: "request-material-preview",
      generation,
      requestId: ++nativeRequestId,
    });
  }
  function renderCards(): void {
    const copy = workspaceCopy(),
      items = choices(),
      ids = new Set(items.map((v) => v.edit.recipe.recipeId));
    for (const [id, card] of cards)
      if (!ids.has(id)) {
        card.wrapper.remove();
        cards.delete(id);
      }
    for (const item of items) {
      const id = item.edit.recipe.recipeId;
      let card = cards.get(id);
      if (!card) {
        const wrapper = document.createElement("div"),
          deletion = document.createElement("button");
        wrapper.className = "material-card-slot";
        deletion.type = "button";
        deletion.className = "material-delete";
        deletion.textContent = "×";
        deletion.addEventListener("click", () => {
          if (!saving && !busy) {
            saving = true;
            input.post({ type: "delete-material", recipeId: id });
            render();
          }
        });
        const button = document.createElement("button"),
          img = document.createElement("img"),
          label = document.createElement("span");
        button.type = "button";
        button.className = "material-card";
        button.dataset.recipe = id;
        img.alt = "";
        button.append(img, label);
        button.addEventListener("click", () => {
          const value = cards.get(id);
          if (value) choose(value.edit);
        });
        wrapper.append(button, deletion);
        card = { wrapper, button, deletion, img, label, edit: item.edit };
        cards.set(id, card);
        catalog.append(wrapper);
      }
      card.edit = item.edit;
      card.label.textContent = item.name ?? recipeName(id, item.edit.family);
      const thumb = item.thumbnail
        ? `data:image/png;base64,${item.thumbnail}`
        : MATERIAL_THUMBNAILS[id];
      card.img.hidden = !thumb;
      if (thumb) card.img.src = thumb;
      card.button.classList.toggle("material-card-custom", !thumb);
      card.wrapper.hidden = filter !== "all" && filter !== item.edit.family;
      card.deletion.hidden = !saved.some((s) => s.edit.recipe.recipeId === id);
      card.deletion.disabled = busy || saving;
      card.deletion.setAttribute(
        "aria-label",
        `${copy.deleteLook}: ${card.label.textContent}`,
      );
      card.deletion.title = card.deletion.getAttribute("aria-label")!;
      card.button.disabled = busy || ((item.edit.family==='foil' || item.edit.family==='mesh-gradient') && (!eligibleFor(item.edit.family).length || eligibleFor(item.edit.family).some(n=>!('canChoose' in n) || !n.canChoose)));
      card.button.setAttribute(
        "aria-pressed",
        String(
          candidate &&
            !remove &&
            wholePreset &&
            family === item.edit.family &&
            currentSeed().recipeId === id,
        ),
      );
      const snapshots =
        eligibleFor(item.edit.family);
      card.button.dataset.applied = String(
        snapshots.length > 0 &&
          snapshots.every(
            (n) =>
              n.live &&
              (item.edit.family === "glass"
                ? changedGlassFields(
                    n.live as GlassMaterialWire,
                    item.edit.material,
                  )
                : item.edit.family==="foil" ? changedFoilFields(n.live as FoilMaterialWire,item.edit.material)
                : item.edit.family==="mesh-gradient" ? changedMeshGradientFields(n.live as MeshGradientMaterialWire,item.edit.material) : changedTextureFields(
                    n.live as TextureMaterialWire,
                    item.edit.material,
                  )
              ).length === 0,
          ),
      );
      card.button.title = card.label.textContent;
    }
  }
  function renderApplied(): void {
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.dataset.action
        : undefined;
    applied.replaceChildren();
    const copy = workspaceCopy();
    for (const key of ["glass", "texture", "foil", "mesh-gradient"] as const) {
      const snapshots =
        eligibleFor(key);
      const live = snapshots.filter((n) => n.live);
      if (!live.length) continue;
      const row = document.createElement("div");
      row.className = "material-current";
      const title = document.createElement("span"),
        toggle = document.createElement("input"),
        tune = document.createElement("button"),
        clear = document.createElement("button");
      const first = live[0]!,
        origin = first.provenance;
      const name = origin
        ? recipeName(origin.recipeId, key)
        : familyName(key);
      const same =
        live.length === snapshots.length &&
        live.every(
          (n) =>
            JSON.stringify(n.live) === JSON.stringify(first.live) &&
            n.provenance?.recipeId === origin?.recipeId,
        );
      title.textContent = !same
        ? `${name} · ${copy.mixed}`
        : first.customized.length
          ? `${name} · ${copy.edited}`
          : name;
      title.title = title.textContent;
      toggle.type = "checkbox";
      toggle.checked = live.every((n) => n.live?.visible);
      toggle.indeterminate =
        live.length !== snapshots.length ||
        (live.some((n) => n.live?.visible) && !toggle.checked);
      if (candidate && !remove && family === key && fields.has("visible")) {
        toggle.checked = key === 'glass' ? material.visible : key==='texture'?textureMaterial.visible:key==='foil'?foilMaterial.visible:meshMaterial.visible;
        toggle.indeterminate = false;
      }
      toggle.setAttribute("aria-label", `${name} · ${copy.visible}`);
      toggle.dataset.action = `toggle-${key}`;
      tune.type = clear.type = "button";
      tune.textContent = copy.tune;
      clear.textContent = "×";
      clear.setAttribute("aria-label", `${copy.remove} ${name}`);
      clear.title = clear.getAttribute("aria-label")!;
      tune.dataset.action = `tune-${key}`;
      clear.dataset.action = `remove-${key}`;
      tune.addEventListener("click", () => openTuning(key));
      toggle.addEventListener("change", () => {
        const value = toggle.checked;
        cancelTrial();
        family = key;
        nativeValues();
        if (key === "glass") material.visible = value;
        else if(key==='texture')textureMaterial.visible = value;
        else if(key==='foil')foilMaterial.visible=value;
        else meshMaterial.visible=value;
        markField("visible");
        render();
      });
      clear.addEventListener("click", () => {
        cancelTrial();
        family = key;
        nativeValues();
        candidate = true;
        remove = true;
        render();
      });
      for (const control of [toggle, tune, clear]) control.disabled = busy;
      row.append(toggle, title, tune, clear);
      applied.append(row);
    }
    if (focused)
      applied.querySelector<HTMLElement>(`[data-action='${focused}']`)?.focus();
  }
  function renderMixed(): void {
    const snapshots = currentNodes();
    visibleInput.checked = currentMaterial().visible;
    clipInput.checked = textureMaterial.clipToShape;
    for (const [checkbox, key] of [
      [visibleInput, "visible"],
      [clipInput, "clipToShape"],
    ] as const) {
      const field = key === "visible" ? key : "clip-to-shape";
      const values = snapshots.map((n) =>
        n.live
          ? (n.live as unknown as Record<string, unknown>)[key]
          : undefined,
      );
      checkbox.indeterminate =
        !wholePreset &&
        !fields.has(field) &&
        values.length > 1 &&
        values.some((v) => v !== values[0]);
      checkbox.disabled = busy || remove;
      checkbox.setAttribute(
        "aria-checked",
        checkbox.indeterminate ? "mixed" : String(checkbox.checked),
      );
    }
    for (const control of controls) {
      const row = control.input.closest<HTMLElement>(".designer-field")!;
      row.hidden = control.family !== family;
      const key = control.field.replace(/-([a-z])/g, (_, c: string) =>
        c.toUpperCase(),
      );
      const values = snapshots.map((n) =>
        n.live
          ? (n.live as unknown as Record<string, unknown>)[key]
          : undefined,
      );
      const mixed =
        !wholePreset &&
        !(control.channelGroup?wholePreset || editedChannels(control.family,control.field).includes(control.channelGroup==='alpha'?'a':'r'):fields.has(control.field)) &&
        values.length > 1 &&
        values.some((v) => {
          if(control.channelGroup) {
            const current=v as FoilColorWire|MeshGradientColorWire|undefined,first=values[0] as FoilColorWire|MeshGradientColorWire|undefined;
            if(!current||!first)return current!==first;
            return (control.channelGroup==='alpha'?['a'] as const:['r','g','b'] as const).some(key=>current[key]!==first[key]);
          }
          return v!==values[0];
        });
      control.input.dataset.mixed = String(mixed);
      if (mixed && control.input.type === "color") {
        control.label.textContent += ` · ${workspaceCopy().mixed}`;
        control.input.setAttribute("aria-label", control.label.textContent);
      }
      if (control.valueInput) {
        control.valueInput.placeholder = mixed ? workspaceCopy().mixed : "";
        if (mixed) control.valueInput.value = "";
      }
      if (mixed && control.input.type === "number") {
        control.input.value = "";
        control.input.placeholder = workspaceCopy().mixed;
      }
      if (control.input.type === "range")
        control.input.setAttribute(
          "aria-valuetext",
          mixed ? workspaceCopy().mixed : control.input.value,
        );
      const legacyIgnored=control.family==='foil' && control.field==='highlight-color' && control.channelGroup==='alpha' && !adopt && eligibleFoilNodes().some(n=>n.profile==='worldbend.foil.prototype@0.1');
      control.input.disabled = control.family !== family || busy || remove || legacyIgnored;
      if (control.valueInput) control.valueInput.disabled = busy || remove;
    }
  }
  function render(): void {
    if (!active) return;
    const copy = workspaceCopy(),
      current = familyNodes();
    shell.title.textContent =
      nodes.length === 1
        ? nodes[0]!.name
        : nodes.length
          ? copy.selectionSummary.replace("{count}", String(nodes.length))
          : copy.title;
    shell.title.title = shell.title.textContent;
    help.setCopy(copy.previewHelp, copy.previewNote);
    for (const [key, button] of filters) {
      button.textContent =
        key === "all"
          ? copy.allMaterials
          : familyName(key);
      button.setAttribute("aria-pressed", String(filter === key));
    }
    renderCards();
    renderApplied();
    for (const control of controls) {
      const names =
        control.family === 'glass' ? copy.fieldNames : control.family==='texture'?copy.textureFieldNames:control.family==='foil'?copy.foilFieldNames:copy.meshGradientFieldNames;
      control.label.textContent =
        (names as Record<string,string>)[control.field]!;
      if(control.channelGroup==='alpha')control.label.textContent=(control.family==='mesh-gradient'?copy.meshGradientOpacity:copy.foilOpacity).replace('{color}',control.label.textContent);
      if (control.valueInput)
        control.valueInput.setAttribute(
          "aria-label",
          control.label.textContent,
        );
    }
    for (const group of controlGroups) {
      group.section.hidden =
        group.family !== undefined && group.family !== family;
      group.title.textContent = copy.controlGroups[group.key];
    }
    visibleLabel.textContent = copy.visible;
    clipLabel.textContent = copy.clipToShape;
    clipRow.hidden = family !== "texture";
    const origin=currentNodes()[0]?.provenance;
    el('.material-tuning h2').textContent=wholePreset?recipeName(currentSeed().recipeId,family):origin?recipeName(origin.recipeId,family):familyName(family);
    el<HTMLButtonElement>("[data-role=close-tuning]").setAttribute(
      "aria-label",
      copy.closeTuning,
    );
    renderMixed();
    const saveInput = el<HTMLInputElement>(".material-save input"),
      saveButton = el<HTMLButtonElement>(".material-save button");
    saveInput.placeholder = copy.variationName;
    saveInput.setAttribute("aria-label", copy.variationName);
    saveButton.textContent = copy.saveVariation;
    const selectedLive = currentNodes();
    saveButton.disabled =
      candidate ||
      busy ||
      saving ||
      selectedLive.length === 0 || (family==='foil'&&eligibleFoilNodes().some(n=>!n.canChoose)) || (family==='mesh-gradient'&&eligibleMeshNodes().some(n=>!n.canChoose)) ||
      selectedLive.some(
        (n) =>
          !n.live ||
          JSON.stringify(n.live) !== JSON.stringify(selectedLive[0]?.live),
      );
    status.replaceChildren();
    for (const node of current) {
      const issue =
        !node.eligible ||
        (family === 'glass' && (node as AppearanceNodeSnapshot).warnings?.length) ||
        (family==='foil' && (node as FoilNodeSnapshot).warnings.length) ||
        (family==='mesh-gradient' && (node as MeshGradientNodeSnapshot).warnings.length);
      if (!issue) continue;
      const row = document.createElement("p");
      row.className = "material-issue";
      row.textContent = `${node.name} · ${family === "glass" ? nodeDetail(node as AppearanceNodeSnapshot, copy) : family==="foil"?foilNodeDetail(node as FoilNodeSnapshot,copy):family==="mesh-gradient"?meshNodeDetail(node as MeshGradientNodeSnapshot,copy):textureNodeDetail(node as TextureNodeSnapshot, copy)}`;
      status.append(row);
    }
    footer.hidden = !candidate;
    el<HTMLButtonElement>("[data-role=tune-trial]").textContent = copy.tune;
    el<HTMLButtonElement>("[data-role=tune-trial]").disabled = busy || remove;
    shell.reset.textContent = copy.cancel;
    shell.reset.disabled = busy;
    shell.apply.textContent = busy
      ? copy.applying
      : nodes.length > 1
        ? `${copy.applyToSelection} · ${currentNodes().length}/${nodes.length}`
        : copy.apply;
    if (!validControls() && draftKey !== undefined) {
      cancelDraftPreview();
      trial = "loading";
    }
    if (candidate && !busy && validControls() && generation !== undefined) {
      const value = edit(),
        key = JSON.stringify({ generation, edit: value });
      if (key !== draftKey) {
        draftKey = key;
        trial = "loading";
        const requestId = ++draftRenderId;
        if (draftTimer !== undefined) clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
          draftTimer = undefined;
          if (active && draftKey === key && generation !== undefined)
            input.post({
              type: "request-material-trial",
              generation,
              requestId,
              edit: value,
            });
        }, 100);
      }
    }
    if(filter==='foil' || family==='foil') {
      if(filter==='foil'&&family!=='foil')for(const node of foilNodes.filter(node=>!node.eligible||node.warnings.length)) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=node.name+' · '+foilNodeDetail(node,copy);status.append(note);
      }
      if(!foilNodes.length || !eligibleFoilNodes().length) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=copy.foilUnavailable;status.append(note);
      }
      if(eligibleFoilNodes().some(node=>node.canAdopt)) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=copy.foilAdoptNote;
        const button=document.createElement('button');button.type='button';button.dataset.action='adopt-foil';button.textContent=copy.foilAdopt;
        button.disabled=busy || !eligibleFoilNodes().length || eligibleFoilNodes().some(node=>!node.canAdopt);
        button.addEventListener('click',()=>{
          cancelTrial();family='foil';nativeValues();adopt=true;wholePreset=true;candidate=true;
          foilSeed={...foilSeed,recipeId:'user-foil-'+createSceneDraftToken(values=>crypto.getRandomValues(values)),recipeVersion:1,material:structuredClone(foilMaterial)};tuning.hidden=false;render();
        });status.append(note,button);
      }
    }
    if(filter==='mesh-gradient' || family==='mesh-gradient') {
      if(filter==='mesh-gradient'&&family!=='mesh-gradient')for(const node of meshNodes.filter(node=>!node.eligible||node.warnings.length)) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=node.name+' · '+meshNodeDetail(node,copy);status.append(note);
      }
      if(!meshNodes.length || !eligibleMeshNodes().length) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=copy.meshGradientUnavailable;status.append(note);
      }
      if(eligibleMeshNodes().some(node=>node.canAdopt)) {
        const note=document.createElement('p');note.className='material-issue';note.textContent=copy.meshGradientAdoptNote;
        const button=document.createElement('button');button.type='button';button.dataset.action='adopt-mesh-gradient';button.textContent=copy.meshGradientAdopt;
        button.disabled=busy || !eligibleMeshNodes().length || eligibleMeshNodes().some(node=>!node.canAdopt);
        button.addEventListener('click',()=>{
          cancelTrial();family='mesh-gradient';nativeValues();adopt=true;wholePreset=true;candidate=true;
          meshSeed={...meshSeed,recipeId:'user-mesh-gradient-'+createSceneDraftToken(values=>crypto.getRandomValues(values)),recipeVersion:1,material:structuredClone(meshMaterial)};tuning.hidden=false;render();
        });status.append(note,button);
      }
    }
    shell.apply.disabled =
      busy ||
      !candidate ||
      currentNodes().length === 0 ||
      !validControls() ||
      trial !== "ready";
    renderStage();
    feedback.textContent =
      trial === "ready"
        ? trialOnCanvas
          ? copy.trialReady
          : copy.trialInWindow
        : trial === "failed"
          ? copy.trialFailed
          : copy.trialLoading;
    feedback.dataset.state = trial;
    if (trial === "failed" && candidate) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = copy.retryPreview;
      retry.addEventListener("click", () => {
        draftKey = undefined;
        render();
      });
      feedback.append(" ", retry);
    }
  }
  el<HTMLFormElement>(".material-save").addEventListener("submit", (event) => {
    event.preventDefault();
    if (
      candidate ||
      busy ||
      saving ||
      el<HTMLButtonElement>(".material-save button").disabled
    )
      return;
    const name = el<HTMLInputElement>(".material-save input").value.trim();
    if (!name || [...name].length > 64) return;
    const value = edit();
    delete value.fields;
    delete value.remove;
    if(value.family==='foil'||value.family==='mesh-gradient'){delete value.adopt;delete value.colorChannels;}
    value.recipe = {
      ...value.recipe,
      recipeId: `user-${family}-${createSceneDraftToken((values) => {
        crypto.getRandomValues(values);
      })}`,
      recipeVersion: 1,
      material: { ...value.material },
    } as typeof value.recipe;
    saving = true;
    saveId = value.recipe.recipeId;
    input.post({ type: "save-material", material: { name, edit: value } });
    render();
  });

  function nodeDetail(
    node: AppearanceNodeSnapshot,
    copy: AppearanceWorkspaceCopy,
  ): string {
    if (!node.eligible) {
      if (node.reason === "multiple-glass") return copy.multipleGlass;
      if (node.reason === "invalid-glass") return copy.invalidGlass;
      return copy.noEffects;
    }
    if (node.warnings?.includes("opaque-fill")) return copy.opaqueFill;
    if (node.warnings?.includes("background-blur")) return copy.backgroundBlur;
    if (node.state === "untagged-native") return copy.untagged;
    if (node.state === "removed") return copy.removedGlass;
    if (node.state === "absent") return copy.absent;
    if (node.state === "customized" && node.provenance && node.live) {
      const names = changedGlassFields(node.live, node.provenance.material).map(
        (field) => copy.fieldNames[field],
      );
      return copy.customizedFields.replace("{fields}", names.join(", "));
    }
    return node.provenance
      ? recipeName(node.provenance.recipeId, "glass")
      : copy.absent;
  }

  function textureNodeDetail(
    node: TextureNodeSnapshot,
    copy: AppearanceWorkspaceCopy,
  ): string {
    if (!node.eligible) {
      if (node.reason === "multiple-noise") return copy.textureMultipleNoise;
      if (node.reason === "multiple-texture")
        return copy.textureMultipleTexture;
      if (node.reason === "invalid-texture") return copy.textureInvalidTexture;
      return copy.noEffects;
    }
    if (node.state === "untagged-native") return copy.textureUntagged;
    if (node.state === "removed") return copy.textureRemovedTexture;
    if (node.state === "absent") return copy.textureAbsent;
    if (node.state === "customized" && node.provenance && node.live) {
      const names = changedTextureFields(
        node.live,
        node.provenance.material,
      ).map((field) => copy.textureFieldNames[field]);
      return copy.customizedFields.replace("{fields}", names.join(", "));
    }
    return node.provenance
      ? recipeName(node.provenance.recipeId, "texture")
      : copy.textureAbsent;
  }

  function foilNodeDetail(node:FoilNodeSnapshot,copy:AppearanceWorkspaceCopy):string {
    if(!node.eligible)return node.reason==='multiple'?copy.foilMultiple:node.reason==='locked'?copy.foilLocked:
      node.reason==='no-fills'?copy.foilNoFills:node.reason==='unverified'?copy.foilUnverified:node.reason==='unavailable'?copy.foilUnavailable:copy.foilInvalid;
    if(node.profile==='worldbend.foil.prototype@0.1')return copy.foilLegacy;
    if(node.state==='customized')return copy.customizedFields.replace('{fields}',node.customized.map(field=>copy.foilFieldNames[field]).join(', '));
    return node.provenance?recipeName(node.provenance.recipeId,'foil'):copy.foilFamily;
  }

  function meshNodeDetail(node:MeshGradientNodeSnapshot,copy:AppearanceWorkspaceCopy):string {
    if(!node.eligible)return node.reason==='multiple'?copy.meshGradientMultiple:node.reason==='locked'?copy.meshGradientLocked:
      node.reason==='no-fills'?copy.meshGradientNoFills:node.reason==='unverified'?copy.meshGradientUnverified:node.reason==='unavailable'?copy.meshGradientUnavailable:copy.meshGradientInvalid;
    if(node.profile===MESH_GRADIENT_LEGACY_PROFILE)return copy.meshGradientLegacy;
    if(node.state==='customized')return copy.customizedFields.replace('{fields}',node.customized.map(field=>copy.meshGradientFieldNames[field]).join(', '));
    return node.provenance?recipeName(node.provenance.recipeId,'mesh-gradient'):copy.meshGradientFamily;
  }

  return {
    enter() {
      active = true;
      root.hidden = false;
      candidate = false;
      clearDraftMarks();
      input.post({ type: "material-layout", active: true });
      requestState();
      input.post({ type: "request-material-library" });
      render();
    },
    leave() {
      help.close();
      cancelDraftPreview();
      candidate = false;
      active = false;
      root.hidden = true;
      input.post({ type: "material-layout", active: false });
    },
    selectionLoading() {
      cancelDraftPreview();
      candidate = false;
      wholePreset = false;
      remove = false;
      clearDraftMarks();
      nodes = [];
      textureNodes = [];foilNodes=[];meshNodes=[];
      busy = false;
      generation = undefined;
      nativeKey = undefined;
      nativePreviews = [];
      nativeLoading = false;
      tuning.hidden = true;
      render();
      requestState();
    },
    setSource(_next: DesignerWorkspaceSource) {
      requestState();
    },
    clearSource() {
      cancelDraftPreview();
      candidate = false;
      wholePreset = false;
      remove = false;
      clearDraftMarks();
      nodes = [];
      textureNodes = [];foilNodes=[];meshNodes=[];
      busy = false;
      nativeKey = undefined;
      nativePreviews = [];
      nativeLoading = false;
      tuning.hidden = true;
      render();
      requestState();
    },
    updateLocale() {
      render();
    },
    handleMainMessage(message: MainToUiMessage) {
      if (!active) return false;
      if (
        message.type === "appearance-state" ||
        message.type === "texture-state" || message.type==="foil-state" || message.type==="mesh-gradient-state"
      ) {
        if (generation !== undefined && message.generation < generation)
          return true;
        const previous =
          message.type === "appearance-state" ? nodes : message.type==="foil-state"?foilNodes:message.type==="mesh-gradient-state"?meshNodes:textureNodes;
        const changed =
          JSON.stringify(previous) !== JSON.stringify(message.nodes);
        if (changed && candidate) {
          cancelDraftPreview();
          candidate = false;
          clearDraftMarks();
          wholePreset = false;
          remove = false;
        }
        if (generation !== message.generation) {
          busy = false;
          candidate = false;
          clearDraftMarks();
          wholePreset = false;
          remove = false;
        }
        generation = message.generation;
        if (message.type === "appearance-state") nodes = message.nodes;
        else if(message.type==="foil-state")foilNodes=message.nodes;
        else if(message.type==="mesh-gradient-state")meshNodes=message.nodes;
        else textureNodes = message.nodes;
        if (!candidate) {
          if(tuning.hidden&&!eligibleFor(family).some(node=>node.live)) {
            const liveFamily=(['glass','texture','foil','mesh-gradient'] as const).find(key=>eligibleFor(key).some(node=>node.live));
            if(liveFamily)family=liveFamily;
          }
          nativeValues();
          requestNativePreview();
        }
        render();
        return true;
      }
      if (message.type === "material-context-changed") {
        if (message.generation !== generation) return true;
        cancelDraftPreview();
        nativeKey = undefined;
        if (!candidate) requestNativePreview();
        render();
        return true;
      }
      if (message.type === "material-preview") {
        if (
          message.generation === generation &&
          message.requestId === nativeRequestId &&
          !candidate
        ) {
          nativeLoading = false;
          nativePreviews = message.previews;
          render();
        }
        return true;
      }
      if (message.type === "material-trial") {
        if (
          message.generation === generation &&
          message.requestId === draftRenderId &&
          candidate
        ) {
          trial = message.ok ? "ready" : "failed";
          trialPreviews = message.previews ?? [];
          trialOnCanvas = message.canvas !== false;
          render();
        }
        return true;
      }
      if (
        message.type === "material-applied" ||
        message.type === "appearance-applied" ||
        message.type === "texture-applied"
      ) {
        if (message.generation !== generation) return true;
        busy = false;
        candidate = false;
        clearDraftMarks();
        wholePreset = false;
        remove = false;
        cancelDraftPreview();
        shell.showError();
        shell.status.textContent = workspaceCopy().applied;
        render();
        return true;
      }
      if (
        message.type === "appearance-error" ||
        message.type === "texture-error"
      ) {
        busy = false;
        cancelTrial();
        shell.showError(input.formatError(message.message));
        return true;
      }
      if (message.type === "material-library") {
        saved = message.materials;
        saving = false;
        if (saveId && saved.some((s) => s.edit.recipe.recipeId === saveId)) {
          el<HTMLInputElement>(".material-save input").value = "";
          saveId = undefined;
        }
        render();
        return true;
      }
      if (message.type === "material-library-error") {
        saving = false;
        shell.showError(workspaceCopy().libraryError);
        render();
        return true;
      }
      return false;
    },
    handleKeydown(event) {
      if (event.key !== "Escape") return false;
      if (candidate) cancelTrial();
      else if (!tuning.hidden) closeTuning();
      else input.onBack();
      return true;
    },
    dispose() {
      help.dispose();
      cancelDraftPreview();
    },
  };
}
function rangeInput(
  value: number,
  min: number,
  max: number,
  step: number,
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.className = "transform-slider";
  input.value = String(value);
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}
export const APPEARANCE_WIRE_FIELD_ORDER = GLASS_WIRE_FIELDS;

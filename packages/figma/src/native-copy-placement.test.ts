import {afterEach,expect,it,vi} from "vitest";
import {fitNativePlacementContainers,nativePlacementContainers,nativePlacementSelection,placeIndependentNativeCopy} from "./native-copy-placement";
import {componentSnapshot,restoreComponentSnapshot} from "./native-component";
afterEach(()=>vi.unstubAllGlobals());
const identity:Transform=[[1,0,0],[0,1,0]];
const multiply=(a:Transform,b:Transform):Transform=>[
  [a[0][0]*b[0][0]+a[0][1]*b[1][0],a[0][0]*b[0][1]+a[0][1]*b[1][1],a[0][0]*b[0][2]+a[0][1]*b[1][2]+a[0][2]],
  [a[1][0]*b[0][0]+a[1][1]*b[1][0],a[1][0]*b[0][1]+a[1][1]*b[1][1],a[1][0]*b[0][2]+a[1][1]*b[1][2]+a[1][2]],
];
function host(){
  let id=0;const frames:any[]=[];
  const page:any={id:"page",type:"PAGE",children:[],appendChild(node:any){
    if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node);
  }};
  function frame(){
    let transform:Transform=structuredClone(identity);const data=new Map();
    const node:any={id:`frame:${++id}`,type:"FRAME",name:"Artwork",parent:null,children:[],width:300,height:180,layoutMode:"NONE",clipsContent:false,
      fills:[],strokes:[],effects:[],removed:false,
      get relativeTransform(){return structuredClone(transform);},
      // Real Figma Frames normalize columns; a composed page basis cannot
      // simply be assigned after detaching a scaled/sheared containing frame.
      set relativeTransform(value:Transform){transform=structuredClone(value);for(const col of [0,1]){
        const length=Math.hypot(transform[0][col]!,transform[1][col]!);transform[0][col]!/=length;transform[1][col]!/=length;}},
      get absoluteTransform():Transform{return this.parent?.absoluteTransform?multiply(this.parent.absoluteTransform,transform):structuredClone(transform);},
      get x(){return transform[0][2];},set x(value:number){transform[0][2]=value;},
      get y(){return transform[1][2];},set y(value:number){transform[1][2]=value;},
      appendChild:page.appendChild,resizeWithoutConstraints(width:number,height:number){this.width=width;this.height=height;},
      getSharedPluginData:(_ns:string,key:string)=>data.get(key)??"",setSharedPluginData:(_ns:string,key:string,value:string)=>data.set(key,value),
      remove(){if(this.removed)return;this.removed=true;for(const child of [...this.children])child.remove();this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;},
    };page.appendChild(node);frames.push(node);return node as FrameNode;
  }
  vi.stubGlobal("figma",{currentPage:page,createFrame:vi.fn(frame)});return {page,frame,frames};
}
it.each(["clip","layout"])("copies outside a %s owner without changing its size or child positions",kind=>{
  const h=host(),parent=h.frame(),original=h.frame(),result=h.frame();parent.appendChild(original);
  if(kind==="clip")parent.clipsContent=true;else parent.layoutMode="HORIZONTAL";
  original.x=20;original.y=20;const before={width:parent.width,height:parent.height,children:parent.children.map(n=>n.id),matrix:original.relativeTransform};
  const outer=placeIndependentNativeCopy(result,original,{x:900,y:800});
  expect(outer).toBe(result);expect(result.parent).toBe(h.page);expect(result.absoluteTransform).toEqual([[1,0,900],[0,1,800]]);
  expect({width:parent.width,height:parent.height,children:parent.children.map(n=>n.id),matrix:original.relativeTransform}).toEqual(before);
});
it("preserves a compound reflected/sheared basis in fitted coordinate layers and keeps subsequent copies independent",()=>{
  const h=host(),outer=h.frame(),parent=h.frame(),original=h.frame(),result=h.frame();
  outer.relativeTransform=[[0,-1,9000],[1,0,7000]];outer.clipsContent=true;outer.appendChild(parent);
  parent.relativeTransform=[[1,.8,40],[0,.6,60]];parent.appendChild(original);
  original.relativeTransform=[[-.8829476,-.4694716,20],[-.4694716,.8829476,20]];
  const before=original.absoluteTransform;
  const carrier=placeIndependentNativeCopy(result,original,{x:2000,y:3000});
  expect(carrier.parent).toBe(h.page);expect(nativePlacementSelection(carrier)).toBe(result);
  expect(nativePlacementContainers(result)).toHaveLength(2);
  for(const row of [0,1])for(const col of [0,1])expect(result.absoluteTransform[row]![col]).toBeCloseTo(before[row]![col]!,12);
  expect(result.absoluteTransform[0][2]).toBeCloseTo(2000,10);expect(result.absoluteTransform[1][2]).toBeCloseTo(3000,10);
  const previous=result.absoluteTransform;result.resizeWithoutConstraints(600,360);fitNativePlacementContainers(result);
  for(const row of [0,1])for(const col of [0,1,2])expect(result.absoluteTransform[row]![col]).toBeCloseTo(previous[row]![col]!,10);
  expect(original.absoluteTransform).toEqual(before);
  const second=h.frame();second.relativeTransform=original.relativeTransform;
  const next=placeIndependentNativeCopy(second,result,{x:4000,y:5000});
  expect(next).not.toBe(carrier);expect(next.parent).toBe(h.page);expect(nativePlacementSelection(next)).toBe(second);
  expect(nativePlacementContainers(result)).toHaveLength(2);
});
it("removes only newly allocated context layers when construction fails",()=>{
  const h=host(),outer=h.frame(),parent=h.frame(),original=h.frame(),result=h.frame();outer.clipsContent=true;
  outer.appendChild(parent);parent.relativeTransform=[[1,.8,0],[0,.6,0]];parent.appendChild(original);original.relativeTransform=[[.88,-.47,0],[.47,.88,0]];
  const before=outer.children.map(n=>n.id),count=h.frames.length;
  vi.mocked(figma.createFrame).mockImplementationOnce(h.frame).mockImplementationOnce(()=>{throw Error("host capacity");});
  expect(()=>placeIndependentNativeCopy(result,original,{x:2000,y:3000})).toThrow("host capacity");
  expect(outer.children.map(n=>n.id)).toEqual(before);expect(original.parent).toBe(parent);
  expect(h.frames.slice(count).every(node=>node.removed)).toBe(true);
});
it("restores fitted container geometry as well as the result after a failed update",()=>{
  const h=host(),parent=h.frame(),original=h.frame(),result=h.frame();parent.clipsContent=true;
  parent.relativeTransform=[[1,.8,0],[0,.6,0]];parent.appendChild(original);original.relativeTransform=[[.88,-.47,20],[.47,.88,20]];
  placeIndependentNativeCopy(result,original,{x:2000,y:3000});
  const surface=h.frame(),basis=h.frame(),instance=Object.assign(h.frame(),{scaleFactor:1}),master=h.frame(),content=h.frame(),masterContent=h.frame();
  const parts={surface,basis,instance,master,content,masterContent} as never;
  const saved=componentSnapshot(result,parts),before=result.absoluteTransform;
  result.resizeWithoutConstraints(600,360);result.x+=19;result.y-=7;fitNativePlacementContainers(result);
  restoreComponentSnapshot(result,parts,saved);
  for(const row of [0,1])for(const col of [0,1,2])expect(result.absoluteTransform[row]![col]).toBeCloseTo(before[row]![col]!,10);
  expect(nativePlacementContainers(result).map(n=>[n.id,n.width,n.height,n.relativeTransform])).toEqual(saved.containers?.map(n=>[n.id,n.width,n.height,n.transform]));
});

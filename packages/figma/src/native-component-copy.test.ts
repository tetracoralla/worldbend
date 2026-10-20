import {afterEach,expect,it,vi} from "vitest";
import {localizeComponentCopy} from "./native-component-copy";
import type {ComponentNativeTopology} from "./native-component-topology";

function host() {
  let next=0,failConversion=false;
  class Node {
    id=String(++next);name="Artwork";children:Node[]=[];parent:Node|null=null;removed=false;
    width=100;height=50;x=0;y=0;visible=true;characters="";relativeTransform=[[1,0,0],[0,1,0]];
    main:Node|undefined;scale=1;
    shared=new Map<string,string>();layoutMode="NONE";clipsContent=false;
    get absoluteTransform(){return [[1,0,this.x],[0,1,this.y]];}
    get absoluteBoundingBox(){return {x:this.x,y:this.y,width:this.width,height:this.height};}
    getSharedPluginData(_ns:string,key:string){return this.shared.get(key)??"";}
    constructor(public type:string){}
    appendChild(node:Node){this.insertChild(this.children.length,node);}
    insertChild(index:number,node:Node){if(node.parent)node.parent.children.splice(node.parent.children.indexOf(node),1);this.children.splice(index,0,node);node.parent=this;}
    remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;this.removed=true;for(const c of this.children)c.remove();}
    rescale(factor:number){this.width*=factor;this.height*=factor;for(const c of this.children){c.x*=factor;c.y*=factor;c.rescale(factor);}}
    get scaleFactor(){return this.scale;}
    set scaleFactor(scale:number){this.rescale(scale/this.scale);this.scale=scale;}
    clone():Node {const n=new Node(this.type);Object.assign(n,{name:this.name,width:this.width,height:this.height,x:this.x,y:this.y,
      visible:this.visible,characters:this.characters,scale:this.scale,main:this.main});for(const c of this.children)n.appendChild(c.clone());page.appendChild(n);return n;}
    detachInstance(){this.type="FRAME";this.scale=1;return this;}
    createInstance(){const n=this.clone();n.type="INSTANCE";n.main=this;n.scale=1;return n;}
    async getMainComponentAsync(){return this.main??null;}
  }
  const page=new Node("PAGE"),result=new Node("FRAME"),surface=new Node("FRAME"),basis=new Node("FRAME");
  const master=new Node("INSTANCE"),masterContent=new Node("FRAME"),instance=new Node("INSTANCE"),content=new Node("FRAME"),text=new Node("TEXT");
  page.appendChild(result);result.appendChild(surface);result.appendChild(master);surface.appendChild(basis);basis.appendChild(instance);instance.appendChild(content);content.appendChild(text);master.appendChild(masterContent);
  master.visible=false;master.name="Source";text.characters="LOCAL override";instance.scaleFactor=.8;
  const parts={surface,basis,master,masterContent,instance,content} as unknown as ComponentNativeTopology;
  vi.stubGlobal("figma",{currentPage:page,createComponentFromNode:(node:Node)=>{if(failConversion)throw Error("conversion failed");node.type="COMPONENT";return node;}});
  return {Node,page,result,parts,master,instance,content,text,fail(){failConversion=true;}};
}
afterEach(()=>vi.unstubAllGlobals());

it("materializes the current live override at its original source scale, not the stale hidden Source instance",async()=>{
  const h=host(),edit=localizeComponentCopy(h.result as unknown as FrameNode,h.parts);
  expect(edit.parts.master.type).toBe("COMPONENT");
  expect(edit.parts.master.width).toBe(100);
  expect(edit.parts.content.width).toBe(h.content.width);
  expect((edit.parts.content.children[0] as TextNode).characters).toBe("LOCAL override");
  expect((await edit.parts.instance.getMainComponentAsync())?.id).toBe(edit.parts.master.id);
  expect(h.master.removed).toBe(false);expect(h.instance.removed).toBe(false);
  edit.commit();
  expect(h.result.children.map(n=>n.id)).toEqual([h.parts.surface.id,edit.parts.master.id]);
  expect(h.master.removed).toBe(true);expect(h.instance.removed).toBe(true);
});

it("can roll back a later publication failure to the exact old local graph",()=>{
  const h=host(),children=h.result.children.map(n=>n.id),page=h.page.children.map(n=>n.id);
  const edit=localizeComponentCopy(h.result as unknown as FrameNode,h.parts);edit.rollback();
  expect(h.result.children.map(n=>n.id)).toEqual(children);
  expect(h.page.children.map(n=>n.id)).toEqual(page);
  expect(h.parts.basis.children[0]?.id).toBe(h.instance.id);
  expect(h.instance.visible).toBe(true);expect(h.master.visible).toBe(false);
  expect(h.text.characters).toBe("LOCAL override");
});

it("cleans a failed component conversion without touching the duplicate",()=>{
  const h=host(),page=h.page.children.map(n=>n.id),children=h.result.children.map(n=>n.id);h.fail();
  expect(()=>localizeComponentCopy(h.result as unknown as FrameNode,h.parts)).toThrow("conversion failed");
  expect(h.page.children.map(n=>n.id)).toEqual(page);
  expect(h.result.children.map(n=>n.id)).toEqual(children);
});

it("preserves old Content identities in a retained work when another result still consumes them",()=>{
  const h=host(),consumer=new h.Node("RECTANGLE");h.page.appendChild(consumer);
  consumer.shared.set("binding",JSON.stringify({sourceNodeIds:[h.content.id]}));
  const edit=localizeComponentCopy(h.result as unknown as FrameNode,h.parts);edit.commit();
  expect(h.master.removed).toBe(false);expect(h.instance.removed).toBe(false);expect(h.text.removed).toBe(false);
  expect(h.instance.parent?.parent?.parent?.name).toBe("Previous artwork · Artwork");
  expect(h.master.parent?.id).toBe(h.instance.parent?.parent?.parent?.id);
  expect(consumer.getSharedPluginData("worldbend","binding")).toContain(h.content.id);
  expect(edit.parts.content.id).not.toBe(h.content.id);
});

it("rolls a retained consumer source back without leaving an extra work",()=>{
  const h=host(),consumer=new h.Node("RECTANGLE");h.page.appendChild(consumer);
  consumer.shared.set("binding",JSON.stringify({sourceNodeIds:[h.text.id]}));
  const page=h.page.children.map(n=>n.id),children=h.result.children.map(n=>n.id);
  const edit=localizeComponentCopy(h.result as unknown as FrameNode,h.parts);edit.rollback();
  expect(h.page.children.map(n=>n.id)).toEqual(page);
  expect(h.result.children.map(n=>n.id)).toEqual(children);
  expect(h.parts.basis.children[0]?.id).toBe(h.instance.id);
  expect(h.text.removed).toBe(false);
});

it("preserves edits made to a duplicated Source view while the plugin was closed",()=>{
  const h=host(),text=new h.Node("TEXT");text.characters="Edited while closed";
  (h.parts.masterContent as unknown as InstanceType<typeof h.Node>).appendChild(text);
  h.parts.masterContent.resizeWithoutConstraints=vi.fn();
  Object.assign(h.parts.masterContent,{width:120});
  const edit=localizeComponentCopy(h.result as unknown as FrameNode,h.parts,true);
  expect(edit.parts.instance.scaleFactor).toBe(1);
  expect(edit.parts.content.width).toBe(120);
  expect((edit.parts.content.children[0] as TextNode).characters).toBe("Edited while closed");
  edit.rollback();
});

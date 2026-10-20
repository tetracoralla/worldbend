// Shared positioning/isolation leases for material bindings on the same host.
// Only the last owner restores its declaration; host edits relinquish ownership.
type Lease = {count:number;before:string;priority:string;owned:string};
const hosts=new WeakMap<HTMLElement,Map<string,Lease>>();
export function acquireSurfaceEnvironment(element:HTMLElement,isolate=false):()=>void{
  const win=element.ownerDocument.defaultView;if(!win)throw Error('Material needs a live document');
  let leases=hosts.get(element);if(!leases){leases=new Map();hosts.set(element,leases)}
  const held:string[]=[];
  const release=()=>{for(const key of held.splice(0)){const lease=leases!.get(key)!;if(--lease.count)continue;
    if(element.style.getPropertyValue(key)===lease.owned&&element.style.getPropertyPriority(key)===''){
      if(lease.before)element.style.setProperty(key,lease.before,lease.priority);else element.style.removeProperty(key);
    }leases!.delete(key);
  }if(!leases!.size&&hosts.get(element)===leases)hosts.delete(element)};
  try{
    const requirements:Array<[string,string]>=[['position','relative']];if(isolate)requirements.push(['isolation','isolate']);
    for(const [key,required]of requirements){
      const existing=leases.get(key);if(existing){existing.count++;held.push(key);continue}
      const computed=win.getComputedStyle(element).getPropertyValue(key);
      if(key==='position'?computed!=='static':computed===required)continue;
      const before=element.style.getPropertyValue(key),priority=element.style.getPropertyPriority(key);
      element.style.setProperty(key,required);const owned=element.style.getPropertyValue(key);
      leases.set(key,{count:1,before,priority,owned});held.push(key);
    }
    const style=win.getComputedStyle(element);
    if(style.position==='static'||(isolate&&style.isolation!=='isolate'))throw Error('The host stylesheet prevents material positioning');
    return release;
  }catch(error){release();throw error}
}

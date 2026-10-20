import {expect,it} from 'vitest';
import {nativeCropNetwork} from './native-vector-crop-network';
const network:VectorNetwork={vertices:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}],
  segments:[{start:0,end:1,tangentStart:{x:0,y:-100},tangentEnd:{x:0,y:100}},
    {start:1,end:2},{start:2,end:3},{start:3,end:0}],
  regions:[{windingRule:'EVENODD',loops:[[0,1,2,3]],fills:[{type:'SOLID',color:{r:1,g:0,b:0}}]}]};
const at=(p:number[],t:number)=>p[0]!*(1-t)**3+3*p[1]!*(1-t)**2*t+3*p[2]!*(1-t)*t*t+p[3]!*t**3;
it('retains the continuous cubic, paints and winding while exposing bows as anchors',()=>{
  const original=structuredClone(network),out=nativeCropNetwork(network),last=out.regions![0]!.loops[0]!.indexOf(out.segments.length-3);
  expect(network).toEqual(original);expect(out.regions![0]!.fills).toEqual(network.regions![0]!.fills);expect(out.regions![0]!.windingRule).toBe('EVENODD');
  expect(Math.min(...out.vertices.map(v=>v.y))).toBeLessThan(-28);expect(Math.max(...out.vertices.slice(4).map(v=>v.y))).toBeGreaterThan(28);
  for(const index of out.regions![0]!.loops[0]!.slice(0,last)){
    const s=out.segments[index]!,a=out.vertices[s.start]!,b=out.vertices[s.end]!;
    for(let i=0;i<=20;i++){
      const t=i/20,x=at([a.x,a.x+s.tangentStart!.x,b.x+s.tangentEnd!.x,b.x],t),y=at([a.y,a.y+s.tangentStart!.y,b.y+s.tangentEnd!.y,b.y],t);
      let lo=0,hi=1;for(let j=0;j<55;j++){const mid=(lo+hi)/2;if(at([0,0,100,100],mid)<x)lo=mid;else hi=mid;}
      expect(y).toBeCloseTo(x===0||x===100?0:at([0,-100,100,0],(lo+hi)/2),8);
    }
  }
});
it('keeps reversed connected contours connected through every split',()=>{
  const reversed={...network,regions:network.regions!.map(r=>({...r,loops:[[3,2,1,0]]}))},out=nativeCropNetwork(reversed);
  let entry=0;for(const i of out.regions![0]!.loops[0]!){const s=out.segments[i]!;expect([s.start,s.end]).toContain(entry);entry=s.start===entry?s.end:s.start;}expect(entry).toBe(0);
});
it('keeps two-curve and single-curve closed contours connected',()=>{
  const cases:VectorNetwork[]=[
    {vertices:[{x:0,y:0},{x:100,y:0}],segments:[
      {start:0,end:1,tangentStart:{x:0,y:-100},tangentEnd:{x:0,y:-100}},
      {start:0,end:1,tangentStart:{x:0,y:100},tangentEnd:{x:0,y:100}}],regions:[{windingRule:'NONZERO',loops:[[0,1]]}]},
    {vertices:[{x:0,y:0}],segments:[{start:0,end:0,tangentStart:{x:100,y:-100},tangentEnd:{x:100,y:100}}],regions:[{windingRule:'NONZERO',loops:[[0]]}]},
  ];
  for(const input of cases){
    const out=nativeCropNetwork(input),loop=out.regions![0]!.loops[0]!;
    let entry=0;for(const i of loop){const s=out.segments[i]!;expect([s.start,s.end]).toContain(entry);entry=s.start===entry?s.end:s.start;}expect(entry).toBe(0);
    expect(loop.length).toBeGreaterThan(input.segments.length);
  }
});
it('leaves straight networks unchanged and refuses expansion before host writes exceed the budget',()=>{
  const straight={...network,segments:network.segments.map(s=>({start:s.start,end:s.end}))};expect(nativeCropNetwork(straight)).toEqual(straight);
  const repeated={...network,segments:Array.from({length:5000},()=>network.segments[0]!)};
  expect(()=>nativeCropNetwork(repeated)).toThrow('geometry budget');
});

/** A no-op certificate, never a clipping implementation. The host's fresh
 * unmasked page-level outline AABB must fit strictly inside the native clip's
 * conservative inner rectangle. Every arithmetic operation is enclosed; an
 * uncertain edge keeps its native Boolean crop. No outward geometric slack. */
type Range = readonly [number, number];
const exact = (n:number):Range=>[n,n];
function enclose(n:number):Range {
  // For a finite binary64 result this step covers both adjacent values,
  // including subnormals. Infinity/NaN is never a containment certificate.
  const step=Math.abs(n)*Number.EPSILON+Number.MIN_VALUE;
  return [n-step,n+step];
}
function add(a:Range,b:Range):Range {return [enclose(a[0]+b[0])[0],enclose(a[1]+b[1])[1]];}
function neg(a:Range):Range {return [-a[1],-a[0]];}
function sub(a:Range,b:Range):Range {return add(a,neg(b));}
function mul(a:Range,b:Range):Range {
  const values=[a[0]*b[0],a[0]*b[1],a[1]*b[0],a[1]*b[1]];
  return [enclose(Math.min(...values))[0],enclose(Math.max(...values))[1]];
}
function div(a:Range,b:Range):Range {
  if(b[0]<=0&&b[1]>=0)return [-Infinity,Infinity];
  const values=[a[0]/b[0],a[0]/b[1],a[1]/b[0],a[1]/b[1]];
  return [enclose(Math.min(...values))[0],enclose(Math.max(...values))[1]];
}
export function nativeOutlineInsideClip(box:Rect,clip:{transform:Transform;width:number;height:number;inset:number}):boolean {
  const {transform:m,width,height,inset}=clip;
  if(![box.x,box.y,box.width,box.height,width,height,inset,...m[0],...m[1]].every(Number.isFinite)||
    box.width<0||box.height<0||width<=0||height<=0||inset<0)return false;
  const [a,b,c,d,e,f]=[...m[0],...m[1]].map(exact) as unknown as [Range,Range,Range,Range,Range,Range];
  const determinant=sub(mul(a,e),mul(b,d));
  const left=exact(box.x),top=exact(box.y),right=add(left,exact(box.width)),bottom=add(top,exact(box.height));
  const farX=sub(exact(width),exact(inset))[0],farY=sub(exact(height),exact(inset))[0];
  return [[left,top],[right,top],[right,bottom],[left,bottom]].every(([x,y])=>{
    const dx=sub(x!,c),dy=sub(y!,f);
    const u=div(sub(mul(e,dx),mul(b,dy)),determinant),v=div(sub(mul(a,dy),mul(d,dx)),determinant);
    return [...u,...v].every(Number.isFinite)&&u[0]>inset&&u[1]<farX&&v[0]>inset&&v[1]<farY;
  });
}

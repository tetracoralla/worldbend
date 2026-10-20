export type NativeOutputBasis=[[number,number,number],[number,number,number]];
type Point={x:number;y:number};

/** Coordinate conversion of an observed host basis, shared by UI and main. */
export function inverseBasisPoint(basis:NativeOutputBasis,point:Point):Point {
  const [[a,c,e],[b,d,f]]=basis;
  const scale=Math.max(Math.abs(a),Math.abs(b),Math.abs(c),Math.abs(d));
  if(!Number.isFinite(scale)||scale===0)throw Error("Invalid containing coordinate basis");
  const an=a/scale,bn=b/scale,cn=c/scale,dn=d/scale,determinant=an*dn-bn*cn;
  if(!Number.isFinite(determinant)||determinant===0)throw Error("Invalid containing coordinate basis");
  const x=point.x-e,y=point.y-f;
  const local={x:(dn*x-cn*y)/determinant/scale,y:(-bn*x+an*y)/determinant/scale};
  if(!Object.values(local).every(Number.isFinite))throw Error("Invalid containing coordinate position");
  return local;
}

/** The editor works in intrinsic output axes anchored at the initial page
 * origin. Map a tight-frame shift through the native root's actual axes. */
export function nativePlacementPagePoint(point:Point,basis?:NativeOutputBasis):Point {
  if(!basis)return {x:point.x,y:point.y};
  const [[a,c,e],[b,d,f]]=basis,x=point.x-e,y=point.y-f;
  return {x:e+a*x+c*y,y:f+b*x+d*y};
}

/** Position inputs display page coordinates; a requested page-axis change
 * can require movement along both intrinsic editor axes. */
export function nativePlacementPointFromPage(point:Point,basis?:NativeOutputBasis):Point {
  if(!basis)return {...point};
  const local=inverseBasisPoint(basis,point);
  return {x:local.x+basis[0][2],y:local.y+basis[1][2]};
}

/** Page bounds of an intrinsic output transported through an observed host
 * basis. This places independent copies without changing their appearance. */
export function nativeOutputBounds(size:{width:number;height:number},basis?:NativeOutputBasis) {
  const [[a,c,e],[b,d,f]]=basis??[[1,0,0],[0,1,0]];
  const xs=[0,a*size.width,c*size.height,a*size.width+c*size.height];
  const ys=[0,b*size.width,d*size.height,b*size.width+d*size.height];
  const left=Math.min(...xs),top=Math.min(...ys);
  const bounds={x:e+left,y:f+top,width:Math.max(...xs)-left,height:Math.max(...ys)-top};
  if(!Object.values(bounds).every(Number.isFinite)||bounds.width<=0||bounds.height<=0)throw Error("Invalid native output bounds");
  return bounds;
}

/** Give a page-root copy the same linear basis, with its actual bounds at the
 * chosen free page position. Its intrinsic size is independent of those bounds. */
export function nativeOutputAtBounds(size:{width:number;height:number},boundsOrigin:Point,basis?:NativeOutputBasis) {
  const transform:NativeOutputBasis=basis?basis.map(row=>[...row]) as NativeOutputBasis:[[1,0,0],[0,1,0]];
  const offsets=nativeOutputBounds(size,[[transform[0][0],transform[0][1],0],[transform[1][0],transform[1][1],0]]);
  transform[0][2]=boundsOrigin.x-offsets.x;transform[1][2]=boundsOrigin.y-offsets.y;
  return transform;
}

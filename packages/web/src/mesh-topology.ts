import type { GridWarpMesh, Point, WarpMesh } from "./types";

export const MAX_INDEXED_MESH_VERTICES = 2048;
export const MAX_INDEXED_MESH_TRIANGLES = 4096;
export type TriangleIndices = [number, number, number];
export interface MeshTopology { triangles: TriangleIndices[]; boundary: number[] }

export function requireGridMesh(mesh: WarpMesh): GridWarpMesh {
  if (!("subdivisions" in mesh)) throw new Error("Indexed geometry requires its original shape recipe for fixed-grid editing");
  return mesh;
}

/** Read declared topology with allocation bounds; geometry remains core-owned. */
export function meshTriangleIndices(mesh: WarpMesh): TriangleIndices[] {
  if (!Array.isArray(mesh.vertices)) throw new Error("The warp mesh topology is invalid");
  if ("triangles" in mesh) {
    if ("subdivisions" in mesh || !Array.isArray(mesh.triangles) || mesh.vertices.length < 4 || mesh.vertices.length > MAX_INDEXED_MESH_VERTICES ||
      mesh.triangles.length < 2 || mesh.triangles.length > MAX_INDEXED_MESH_TRIANGLES ||
      mesh.triangles.some(t => !Array.isArray(t) || t.length !== 3 || t.some(i => !Number.isSafeInteger(i) || i < 0 || i >= mesh.vertices.length) || new Set(t).size !== 3)) {
      throw new Error("The warp mesh topology is invalid");
    }
    return mesh.triangles;
  }
  const n = gridSubdivisions(mesh);
  const triangles: TriangleIndices[] = [];
  for (let y=0; y<n; y++) for (let x=0; x<n; x++) {
    const tl=y*(n+1)+x;
    triangles.push([tl,tl+1,tl+n+2],[tl,tl+n+2,tl+n+1]);
  }
  return triangles;
}

export function validateMeshTopology(mesh: WarpMesh): MeshTopology {
  const triangles = meshTriangleIndices(mesh);
  if (mesh.boundary !== undefined && mesh.boundary !== "fixed" && mesh.boundary !== "free") throw new Error("The mesh boundary mode is invalid");
  if (mesh.shading && (mesh.shading.length !== mesh.vertices.length || mesh.shading.some(v => !Number.isFinite(v) || v < 0 || v > 2))) throw new Error("The mesh shading is invalid");
  for (const v of mesh.vertices) {
    if (!finite(v.source) || !finite(v.warped)) throw new Error("The warp mesh contains a non-finite point");
    if (mesh.boundary === "free" && !unit(v.warped)) throw new Error("The free mesh placement bounds are invalid");
  }
  const boundary = "triangles" in mesh ? indexedBoundary(mesh,triangles) : gridBoundary(mesh.subdivisions);
  if ("subdivisions" in mesh) {
    const n=mesh.subdivisions;
    mesh.vertices.forEach((v,i) => {
      if (v.source.x !== (i%(n+1))/n || v.source.y !== Math.floor(i/(n+1))/n) throw new Error("The warp mesh source grid is invalid");
    });
  } else {
    validateIndexedSources(mesh,triangles,boundary);
  }
  if (mesh.boundary !== "free" && boundary.some(i => {
    const v=mesh.vertices[i]!; return v.source.x !== v.warped.x || v.source.y !== v.warped.y;
  })) throw new Error("The warp mesh boundary is invalid");
  for (const t of triangles) {
    const [a,b,c] = t.map(i => mesh.vertices[i]!.warped) as [Point,Point,Point];
    if (area(a,b,c) <= ("triangles" in mesh ? 1e-12 : 1e-8)) throw new Error("The warp mesh contains a folded or collapsed triangle");
  }
  if (mesh.boundary === "free" || "triangles" in mesh) assertSimpleBoundary(boundary.map(i => mesh.vertices[i]!.warped));
  return {triangles,boundary};
}

function gridBoundary(n: number): number[] {
  const side=n+1, ring:number[]=[];
  for (let x=0;x<n;x++) ring.push(x);
  for (let y=0;y<n;y++) ring.push(y*side+n);
  for (let x=n;x>0;x--) ring.push(n*side+x);
  for (let y=n;y>0;y--) ring.push(y*side);
  return ring;
}

function indexedBoundary(mesh: WarpMesh, triangles: TriangleIndices[]): number[] {
  const edges=new Map<string,{a:number;b:number;count:number}>();
  const faces=new Set<string>();
  for (const [a,b,c] of triangles) {
    const face=[a,b,c].sort((x,y)=>x-y).join(",");
    if (faces.has(face)) throw new Error("The indexed mesh repeats a triangle");
    faces.add(face);
    for (const [from,to] of [[a,b],[b,c],[c,a]] as [number,number][]) {
      const key=`${Math.min(from,to)},${Math.max(from,to)}`;
      const previous=edges.get(key);
      if (previous) {
        if (previous.count !== 1 || previous.a !== to || previous.b !== from) throw new Error("The indexed mesh edge is non-manifold");
        previous.count++;
      } else edges.set(key,{a:from,b:to,count:1});
    }
  }
  if (mesh.vertices.length+triangles.length !== edges.size+1) throw new Error("The indexed mesh must be a triangulated disk");
  const outgoing=new Map<number,number>(),incoming=new Set<number>();
  for (const {a,b,count} of edges.values()) if (count===1) {
    if (outgoing.has(a) || incoming.has(b)) throw new Error("The indexed mesh boundary is non-manifold");
    outgoing.set(a,b); incoming.add(b);
  }
  const start=outgoing.keys().next().value as number|undefined;
  if (start===undefined) throw new Error("The indexed mesh boundary is missing");
  const ring=[start],visited=new Set(ring);
  let at=start;
  while (true) {
    const next=outgoing.get(at);
    if (next===undefined) throw new Error("The indexed mesh boundary is open");
    at=next;
    if (at===start) break;
    if (visited.has(at)) throw new Error("The indexed mesh boundary is disconnected");
    ring.push(at); visited.add(at);
  }
  if (ring.length !== outgoing.size) throw new Error("The indexed mesh must have one connected boundary");
  return ring;
}

function validateIndexedSources(mesh: WarpMesh, triangles: TriangleIndices[], boundary: number[]): void {
  const boundarySet=new Set(boundary);
  mesh.vertices.forEach((v,i) => {
    if (!unit(v.source) || (!boundarySet.has(i) && (v.source.x===0 || v.source.x===1 || v.source.y===0 || v.source.y===1))) throw new Error("The indexed mesh source bounds are invalid");
  });
  const points=boundary.map(i=>mesh.vertices[i]!.source);
  const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  if (corners.some(c=>!points.some(p=>p.x===c.x && p.y===c.y))) throw new Error("The indexed mesh source boundary skips a square corner");
  const start=points.findIndex(p=>p.x===0 && p.y===0);
  const parameter=(p:Point):number => p.y===0?p.x:p.x===1?1+p.y:p.y===1?3-p.x:p.x===0?4-p.y:NaN;
  const squareEdge=(a:Point,b:Point):boolean => (a.x===b.x && (a.x===0 || a.x===1)) || (a.y===b.y && (a.y===0 || a.y===1));
  let previous=0;
  for (let i=1;i<points.length;i++) {
    const a=points[(start+i-1)%points.length]!,b=points[(start+i)%points.length]!,t=parameter(b);
    if (!Number.isFinite(t) || t<=previous || !squareEdge(a,b)) throw new Error("The indexed mesh source boundary must traverse the square once");
    previous=t;
  }
  if (!squareEdge(points[(start+points.length-1)%points.length]!,points[start]!)) throw new Error("The indexed mesh source boundary skips a square corner");
  const links=mesh.vertices.map(()=>new Map<number,number[]>());
  let total=0;
  for (const [a,b,c] of triangles) {
    const source=area(mesh.vertices[a]!.source,mesh.vertices[b]!.source,mesh.vertices[c]!.source);
    if (source<=1e-12) throw new Error("The indexed mesh source triangle is folded or collapsed");
    total+=source;
    for (const [v,left,right] of [[a,b,c],[b,c,a],[c,a,b]]) {
      const link=links[v!]!;
      link.set(left!,[...(link.get(left!)??[]),right!]);
      link.set(right!,[...(link.get(right!)??[]),left!]);
    }
  }
  if (Math.abs(total-1)>1e-8) throw new Error("The indexed mesh must cover the source square exactly once");
  links.forEach((link,i)=>{
    const ends=[...link.values()].filter(v=>v.length===1).length;
    if (!link.size || [...link.values()].some(v=>v.length<1 || v.length>2) || ends!==(boundarySet.has(i)?2:0)) throw new Error("The indexed mesh vertex fan is non-manifold");
    const visited=new Set<number>(),pending=[link.keys().next().value!];
    while(pending.length) {
      const at=pending.pop()!;
      if (!visited.has(at)) { visited.add(at);pending.push(...link.get(at)!); }
    }
    if(visited.size!==link.size) throw new Error("The indexed mesh vertex fan is disconnected");
  });
}

function assertSimpleBoundary(ring: Point[]): void {
  for (let i=0;i<ring.length;i++) {
    const a=ring[i]!,b=ring[(i+1)%ring.length]!,c=ring[(i+2)%ring.length]!;
    if (Math.abs(area(a,b,c))<=1e-12 && (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0) throw new Error("The free mesh boundary crosses or touches itself");
    for(let j=i+1;j<ring.length;j++) {
      if(j===i+1 || (i===0 && j===ring.length-1)) continue;
      const c=ring[j]!,d=ring[(j+1)%ring.length]!;
      if(Math.max(a.x,b.x)<Math.min(c.x,d.x) || Math.max(c.x,d.x)<Math.min(a.x,b.x) || Math.max(a.y,b.y)<Math.min(c.y,d.y) || Math.max(c.y,d.y)<Math.min(a.y,b.y)) continue;
      if(area(a,b,c)*area(a,b,d)<=0 && area(c,d,a)*area(c,d,b)<=0) throw new Error("The free mesh boundary crosses or touches itself");
    }
  }
}

/** Forward/inverse sampling of the declared core faces, without grid resampling. */
export function mapWarpMesh(mesh: WarpMesh, point: Point, inverse=false): Point|undefined {
  if (!finite(point)) return undefined;
  if ("triangles" in mesh) {
    for (const [a, b, c] of meshTriangleIndices(mesh)) {
      const mapped = mapTriangle(mesh, point, a, b, c, inverse);
      if (mapped) return mapped;
    }
    return undefined;
  }

  const n = gridSubdivisions(mesh), side = n + 1;
  if (!inverse) {
    // Forward grid lookup visits one cell. Correction guides sample this on
    // every preview; scanning and allocating the entire grid per point would
    // make the existing editor substantially slower after widening topology.
    const x = Math.max(0, Math.min(n - 1, Math.floor(point.x * n)));
    const y = Math.max(0, Math.min(n - 1, Math.floor(point.y * n)));
    const tl = y * side + x;
    for (const i of [tl, tl + 1, tl + side, tl + side + 1]) {
      const source = mesh.vertices[i]!.source;
      if (source.x !== (i % side) / n || source.y !== Math.floor(i / side) / n) {
        throw new Error("The warp mesh source grid is invalid");
      }
    }
    return mapTriangle(mesh, point, tl, tl + 1, tl + side + 1, false) ??
      mapTriangle(mesh, point, tl, tl + side + 1, tl + side, false);
  }

  // Inverse placement can hit a different cell after deformation. Retain the
  // canonical face order without allocating a triangle inventory for each hit.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const tl = y * side + x;
    const mapped = mapTriangle(mesh, point, tl, tl + 1, tl + side + 1, true) ??
      mapTriangle(mesh, point, tl, tl + side + 1, tl + side, true);
    if (mapped) return mapped;
  }
  return undefined;
}

function gridSubdivisions(mesh: GridWarpMesh): number {
  const n = mesh.subdivisions;
  if (!Number.isSafeInteger(n) || n < 2 || n > (mesh.boundary === "free" ? 32 : 16) ||
    !Array.isArray(mesh.vertices) || mesh.vertices.length !== (n + 1) ** 2) {
    throw new Error("The warp mesh topology is invalid");
  }
  return n;
}

function mapTriangle(
  mesh: WarpMesh, point: Point, aIndex: number, bIndex: number, cIndex: number, inverse: boolean,
): Point | undefined {
  const va = mesh.vertices[aIndex]!, vb = mesh.vertices[bIndex]!, vc = mesh.vertices[cIndex]!;
  const a = inverse ? va.warped : va.source;
  const b = inverse ? vb.warped : vb.source;
  const c = inverse ? vc.warped : vc.source;
  const denominator = area(a, b, c);
  if (!Number.isFinite(denominator) || denominator <= 1e-12) return undefined;
  const wa = area(b, c, point) / denominator;
  const wb = area(c, a, point) / denominator;
  const wc = area(a, b, point) / denominator;
  if (wa < -1e-9 || wb < -1e-9 || wc < -1e-9) return undefined;
  const ta = inverse ? va.source : va.warped;
  const tb = inverse ? vb.source : vb.warped;
  const tc = inverse ? vc.source : vc.warped;
  return {x: ta.x * wa + tb.x * wb + tc.x * wc, y: ta.y * wa + tb.y * wb + tc.y * wc};
}
function finite(p:Point):boolean { return Number.isFinite(p.x) && Number.isFinite(p.y); }
function unit(p:Point):boolean { return finite(p) && p.x>=0 && p.x<=1 && p.y>=0 && p.y<=1; }
function area(a:Point,b:Point,c:Point):number { return ((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x))*0.5; }

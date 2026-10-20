import { requireGridMesh } from "@worldbend/web";
import type {
  DeformationWorkPlanOutput,
  DeformationWorkSpecInput,
  BezierEnvelope,
  LiquifyControls,
  MeshWarpSpecInput,
  SurfaceDeformationSpecInput,
  TransformSpec,
  WarpMesh,
} from "@worldbend/web";

export type DeformationWorkView = "pin" | "mesh";

/** The Plane view reads the work's transform without its persisted null
 * shape: the shared work never carries a preset Warp, so dropping that field
 * cannot lose plane geometry. */
export function planeSpecFromDeformationWork(work: DeformationWorkSpecInput): TransformSpec {
  const source = work.transform.content;
  if (!source) throw new Error("The deformation work carries no plane content");
  const { warp: _warp, ...content } = source;
  return {
    ...structuredClone(work.transform),
    content,
  };
}

/** An authored preset Warp has no slot in the shared work, so it cannot
 * compose with a carried interior; refusing keeps the refusal visible. */
export function planeSpecComposesWithDeformation(spec: TransformSpec): boolean {
  return spec.content.warp === undefined || spec.content.warp.amount === 0;
}

/** Compose the live Plane editor into a carried work. Plane edits replace the
 * work's Plane view while the normalized interior stays untouched, matching
 * the documented replay order without re-deriving geometry adapter-side. */
export function deformationWorkFromPlaneView(
  work: DeformationWorkSpecInput,
  spec: TransformSpec,
  size?: { width: number; height: number },
): DeformationWorkSpecInput {
  const { warp: _warp, ...content } = spec.content;
  const targetSize = size ? { width: size.width, height: size.height }
    : work.targetSize ? structuredClone(work.targetSize) : undefined;
  // Canonical key order keeps value-semantic JSON comparisons with the other
  // view lifts stable.
  return {
    schema: "worldbend.deformation-work",
    version: "0.1",
    transform: {
      ...structuredClone(spec),
      destination: structuredClone(spec.destination),
      content,
    },
    ...(targetSize ? { targetSize } : {}),
    ...(work.meshSubdivisions !== undefined ? { meshSubdivisions: work.meshSubdivisions } : {}),
    ...(work.boundary === "free" ? { boundary: "free" as const } : {}),
    ...(work.surface ? { surface: structuredClone(work.surface) } : {}),
    ...(work.shapeFit ? { shapeFit: structuredClone(work.shapeFit) } : {}),
    meshEdits: structuredClone(work.meshEdits ?? []),
    // Liquify state lives with its owning work (docs/LIQUIFY_CONTRACT.md); a
    // plane publication must carry it, never approximate it away.
    ...(work.liquify ? { liquify: structuredClone(work.liquify) } : {}),
  };
}

/** An untouched identity Pin view does not constrain Mesh density. */
export function deformationWorkHasPinEdits(work?: DeformationWorkSpecInput): boolean {
  const surface = work?.surface;
  if (!surface) return false;
  if ((surface.anchors?.length ?? 0) > 0 || (surface.strokes?.length ?? 0) > 0) return true;
  return JSON.stringify(surface.envelope) !== JSON.stringify(identityEnvelope());
}

/** Lift a legacy Mesh result into the durable shared deformation container. */
export function deformationWorkFromMesh(spec: MeshWarpSpecInput): DeformationWorkSpecInput {
  return deformationWorkFromMeshView(spec);
}

/** Lift a legacy Split Warp result into the durable shared deformation container. */
export function deformationWorkFromSurface(
  spec: SurfaceDeformationSpecInput,
): DeformationWorkSpecInput {
  return {
    schema: "worldbend.deformation-work",
    version: "0.1",
    transform: structuredClone(spec.transform),
    ...(spec.targetSize ? { targetSize: { ...spec.targetSize } } : {}),
    meshSubdivisions: spec.meshSubdivisions ?? 12,
    ...(spec.boundary === "free" ? { boundary: "free" as const } : {}),
    surface: {
      envelope: structuredClone(spec.envelope),
      anchors: structuredClone(spec.anchors ?? []),
      strokes: structuredClone(spec.strokes ?? []),
    },
    meshEdits: [],
  };
}

/** Project one work into the existing Mesh editor without deriving geometry
 * in the carrier. The mesh comes only from the Rust planner. */
export function meshViewFromDeformationPlan(
  plan: DeformationWorkPlanOutput,
): MeshWarpSpecInput {
  const spec = structuredClone(plan.meshWarp.spec);
  if (plan.authoredView) {
    spec.mesh = structuredClone(plan.authoredView.mesh);
    spec.transform = structuredClone(plan.spec.transform);
    if (plan.spec.targetSize) spec.targetSize = structuredClone(plan.spec.targetSize);
    else delete spec.targetSize;
  }
  if (plan.shapeFitView) spec.mesh = structuredClone(plan.shapeFitView.interiorMesh);
  return spec;
}

/** Project the Pin controls into the existing direct manipulation editor. A
 * mesh-only work gets an identity envelope while retaining all Mesh edits. */
export function surfaceViewFromDeformationWork(
  work: DeformationWorkSpecInput,
): SurfaceDeformationSpecInput {
  const meshSubdivisions = work.meshSubdivisions ?? 12;
  if (meshSubdivisions < 4) {
    throw new Error("Pin Warp needs a mesh density of at least 4 × 4");
  }
  const surface = work.surface ?? {
    envelope: identityEnvelope(),
    anchors: [],
    strokes: [],
  };
  return {
    schema: "worldbend.surface-deformation",
    version: "0.1",
    transform: structuredClone(work.transform),
    ...(work.targetSize ? { targetSize: { ...work.targetSize } } : {}),
    meshSubdivisions,
    ...(work.boundary === "free" ? { boundary: "free" as const } : {}),
    envelope: structuredClone(surface.envelope),
    anchors: structuredClone(surface.anchors ?? []),
    strokes: structuredClone(surface.strokes ?? []),
  };
}

/** Merge Pin edits back into the same work. Existing explicit Mesh edits stay
 * later in replay order and therefore retain their documented precedence, and
 * the work's Liquify strokes ride along; the live Pin Liquify block, when the
 * caller passes one, replaces the base's. */
export function deformationWorkFromSurfaceView(
  spec: SurfaceDeformationSpecInput,
  base?: DeformationWorkSpecInput,
  liquify?: LiquifyControls,
): DeformationWorkSpecInput {
  if (base && (base.meshSubdivisions ?? 12) !== spec.meshSubdivisions && (base.meshEdits?.length ?? 0) > 0) {
    throw new Error("Change Mesh density before adding explicit Mesh edits");
  }
  const carriedLiquify = liquify ?? base?.liquify;
  return {
    schema: "worldbend.deformation-work",
    version: "0.1",
    transform: structuredClone(spec.transform),
    ...(spec.targetSize ? { targetSize: { ...spec.targetSize } } : {}),
    meshSubdivisions: spec.meshSubdivisions ?? 12,
    ...(spec.boundary === "free" ? { boundary: "free" as const } : {}),
    surface: {
      envelope: structuredClone(spec.envelope),
      anchors: structuredClone(spec.anchors ?? []),
      strokes: structuredClone(spec.strokes ?? []),
    },
    meshEdits: structuredClone(base?.meshEdits ?? []),
    ...(carriedLiquify ? { liquify: structuredClone(carriedLiquify) } : {}),
    ...(base?.shapeFit ? { shapeFit: structuredClone(base.shapeFit) } : {}),
  };
}

/** Merge the current final Mesh view back into the same work. When Pin state
 * exists, edits are measured against the Rust-planned pre-edit mesh after
 * Liquify (the plan's `meshEditBaseline`), so a view switch neither bakes nor
 * duplicates Pin or Liquify deformation, and the work's Liquify block rides
 * along unchanged. */
export function deformationWorkFromMeshView(
  spec: MeshWarpSpecInput,
  base?: DeformationWorkSpecInput,
  editBaseline?: WarpMesh,
): DeformationWorkSpecInput {
  const mesh = requireGridMesh(spec.mesh);
  if (deformationWorkHasPinEdits(base) && (base?.meshSubdivisions ?? 12) !== mesh.subdivisions) {
    throw new Error("Pin Warp density must stay fixed while editing its Mesh view");
  }
  const baseline = requireGridMesh(editBaseline ?? identityMesh(mesh.subdivisions));
  if (baseline.subdivisions !== mesh.subdivisions || baseline.vertices.length !== spec.mesh.vertices.length) {
    throw new Error("Mesh and Pin views must use the same density");
  }
  const side = mesh.subdivisions + 1;
  const existing=(base?.meshSubdivisions??12)===mesh.subdivisions?base?.meshEdits??[]:[];
  const owned=new Set(existing.map(edit=>edit.row*side+edit.column));
  // An explicit placement can coincide with the current Pin/Liquify baseline
  // while still overriding its future replay. Keep that authored intent and
  // ordering; unchanged controls are not re-normalized through the view.
  const meshEdits=existing.map(edit=>{
    const point=spec.mesh.vertices[edit.row*side+edit.column]!.warped;
    return point.x===edit.warped.x&&point.y===edit.warped.y?structuredClone(edit):{...structuredClone(edit),warped:{...point}};
  });
  for(const [index,vertex] of spec.mesh.vertices.entries()){
    const column=index%side,row=Math.floor(index/side);
    // Keep changed edges even in a proposed fixed-mode view. The core must
    // reject that unchanged geometry, rather than this projection deleting it.
    if(owned.has(index))continue;
    const before=baseline.vertices[index]?.warped;
    if(before&&before.x===vertex.warped.x&&before.y===vertex.warped.y)continue;
    meshEdits.push({column,row,warped:{...vertex.warped}});
  }
  return {
    schema: "worldbend.deformation-work",
    version: "0.1",
    transform: structuredClone(spec.transform),
    ...(spec.targetSize ? { targetSize: { ...spec.targetSize } } : {}),
    meshSubdivisions: mesh.subdivisions,
    ...(mesh.boundary === "free" ? { boundary: "free" as const } : {}),
    ...(base?.surface ? { surface: structuredClone(base.surface) } : {}),
    meshEdits,
    ...(base?.liquify ? { liquify: structuredClone(base.liquify) } : {}),
    ...(base?.shapeFit ? { shapeFit: structuredClone(base.shapeFit) } : {}),
  };
}

function identityMesh(subdivisions: number): WarpMesh {
  const vertices = [];
  for (let row = 0; row <= subdivisions; row += 1) {
    for (let column = 0; column <= subdivisions; column += 1) {
      const source = { x: column / subdivisions, y: row / subdivisions };
      vertices.push({ source, warped: { ...source } });
    }
  }
  return { subdivisions, vertices };
}

function identityEnvelope(): BezierEnvelope {
  return {
    columns: 1,
    rows: 1,
    points: Array.from({ length: 16 }, (_, index) => ({
      x: (index % 4) / 3,
      y: Math.floor(index / 4) / 3,
    })) as BezierEnvelope["points"],
  };
}

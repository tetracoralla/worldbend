# Worldbend Mesh Gradient shader

Soft fluid four-corner mesh-gradient kernel for `worldbend.mesh-gradient@0.1`.
Corner colors blend across an editable loop with soft domain warp. The surface
is fully generated: no input texture is sampled. Output is straight RGBA under
Figma's Shader-fill contract. Frame time is milliseconds; duration and phase
are editable timing parameters so independent instances can run out of phase.

Designer parameters (native Shader properties):

| Property | Meaning | Range |
| --- | --- | --- |
| `visible` | Hides the effect entirely | boolean |
| `colorTl` / `colorTr` / `colorBl` / `colorBr` | Corner tints and alpha | color |
| `warp` | Soft fluid domain warp | 0–1 |
| `softness` | Corner falloff softness | 0–1 |
| `durationMs` | Loop duration | 100–60000 ms |
| `phaseMs` | Instance phase offset | 0–60000 ms |
| `flowSpeed` | Motion energy inside the loop | 0–2 |

## Integration

The canonical kernel is generated from the shared core. Exact source identity
and native properties are checked before adoption. Account-library acquisition
and Community distribution are separate from this source directory. See the
[mesh-gradient contract](../../../../docs/MESH_GRADIENT_CONTRACT.md).

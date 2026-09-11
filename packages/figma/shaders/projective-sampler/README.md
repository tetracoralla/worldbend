# Figma perspective shader source

`main.ts` and `features.json` are the authored source of the Worldbend
Perspective effect. Its eleven numeric controls accept the core's inverse
matrix and source extents; the effect never solves geometry itself.

[Community companion effect](https://www.figma.com/community/shader/1679431734495527701).
The first submission was rejected with two findings: the effect's purpose was
unclear, and a hand-edited control could blank the image with no obvious way
back (shader-effect Undo is broken on the tested Figma build). The resubmission
labels every control as plugin-written and ships listing directions that say
the effect is not a standalone filter and how to restore defaults. Publication
does not bundle the resource into the plugin ZIP or guarantee availability in
every account.

- Resource: `20eff4c7-e099-4bf2-937b-1d83305c0851`
- Tested build: `610eb52f8eeb4810422bf37b504129cf83efa355`
- Retained resource hash: `d5d769a7aecb88b7fe06550eaad56dd603840634`
- `main.ts` SHA-256 (labeled resubmission): `5047d0a7b0c67e2962c21028d3b1872ba33748093edbeb66163d27a736800a38`
  (pre-label build: `226ba4f0ebdaf86e2dbe9be8897761ca4310679295b3a781e8e84598bed8564c`)

Figma supplies and consumes premultiplied RGBA textures. This build interpolates
those values directly, fixing the previous duplicate alpha conversion. Run
`pnpm test:figma-shader` for actual GPU compilation and six sampling cases.
That check ends at shader output: Figma's subsequent compositing/resampling and
the reference renderer's boundary coverage require separate host measurements.
The original resource `25fbd473-a6d4-4978-9dac-0a679d35fbad`, build
`28a52aefe26125f1b8b4d8c221c5b668466c81d9`, remains unchanged for existing results.

The shader remains outside the self-contained human plugin payload and does
not solve geometry. Import requires that exact effect to be available to the
file/account. Building this repository does not create or publish a Figma
shader. See [the adapter contract](../../../../docs/FIGMA_HANDOFF.md) for acquisition
and rendering limits.

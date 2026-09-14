# Figma perspective shader source

`main.ts` and `features.json` are the authored source of the Worldbend
Perspective effect. Its eleven numeric controls accept the core's inverse
matrix and source extents; the effect never solves geometry itself.

[Community companion effect](https://www.figma.com/community/shader/1679431734495527701).
The plugin writes the eleven controls automatically. Applying the effect alone
uses identity defaults. Manual values can sample outside the source and make
the image blank: restore H00/H11/H22 and both Source values to 1, and the other
H values to 0, or remove the effect. Some host builds do not restore effect
edits through Undo; see the adapter contract before relying on that workflow.

The supported resource identity is defined in `src/native-renderer.ts` relative
to the Figma package. Availability is checked against the exact imported version.

Figma supplies and consumes premultiplied RGBA textures. The sampler interpolates
those values directly. Run
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

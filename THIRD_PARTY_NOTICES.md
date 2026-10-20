# Third-party material

Worldbend code and documentation are Apache-2.0; third-party material retains
its upstream license. The project license does not relicense those works.

- Runtime Rust dependencies: the locked native inventory, copied upstream
  terms and platform notes are in
  [plugins/worldbend/THIRD_PARTY_NOTICES.md](plugins/worldbend/THIRD_PARTY_NOTICES.md),
  `plugins/worldbend/licenses/` and `plugins/worldbend/sbom/`. Figma, Web and
  ComfyUI packages include inventories for their own compiled dependency sets.
- Figma UI icons: selected IconPark SVG geometry from ByteDance's
  [IconPark](https://github.com/bytedance/IconPark), licensed under Apache-2.0.
  Icon geometry is retained; integration uses currentColor and UI sizing.
  [Apache-2.0 terms](LICENSE).
- PSD interoperability test fixtures: the individual origins are documented
  in `crates/worldbend-interop/tests/fixtures/`; psd-tools material retains
  [its MIT license](crates/worldbend-interop/tests/fixtures/LICENSE.psd-tools.txt),
  copyright 2019 Kota Yamaguchi.

Development dependencies are resolved from `Cargo.lock` and `pnpm-lock.yaml`;
installing them obtains their upstream notices. They are not all embedded in
Worldbend runtime artifacts. Preserve each artifact's LICENSE, NOTICE,
THIRD_PARTY_NOTICES.md, licenses/ and sbom/ when redistributing it.

Worldbend does not claim ownership of user input images, design files, fonts,
or generated outputs. Users retain responsibility for rights to their inputs.

- Wet-glass / droplet simulation and water-field composition: adaptation of
  [Raindrop FX](https://github.com/SardineFish/raindrop-fx) by SardineFish,
  MIT License, pinned at `bae4081bc15815bb094ea040a976dca083bbc3a5`. License
  text: `packages/swiftui/Sources/WorldbendAppearance/Licenses/RaindropFX-LICENSE.txt`
  (also listed in root `NOTICE`). No upstream demo artwork or WebGL runtime is
  redistributed.

Google Filament (native glazed-surface microfacet clear-coat BRDF adaptation)
Apache License 2.0. Pinned reference: 764fe6cac9bdb4ba24d3d852344dfa04a5f70f75
https://github.com/google/filament/blob/764fe6cac9bdb4ba24d3d852344dfa04a5f70f75/shaders/src/surface_brdf.fs
D_GGX, V_Kelemen and scalar F_Schlick adapted to Metal; host mask normals and
fixed studio lighting added. No Filament engine, model or demo media is bundled.
Full license ships at Sources/WorldbendAppearance/Licenses/Filament-LICENSE.txt.

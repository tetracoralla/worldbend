# Contributing to Worldbend

Worldbend owns one deterministic transform model shared by its Rust core,
CLI, MCP, Web/WASM, Figma, and Capability adapters. Do not add a parallel
geometry model or infer planes, camera state, or 3D scenes.

Use the toolchains listed in the README, then run:

```sh
pnpm install --frozen-lockfile
pnpm check
```

Changes to geometry, rasterization, path authority, or publication require a
focused negative regression. Do not include credentials, private design files,
generated binaries, build outputs, or local paths. External contributions are
not accepted while the repository remains private.

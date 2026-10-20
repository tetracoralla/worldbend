# Personal materials

Open `/packages/web/examples/material-preferences/` after building and locally
serving the repository. The Field notes book keeps its original title and layout
while Paper, Foil or Fluid light supplies its material.

```sh
pnpm build:web:package
python3 -m http.server 8000 --bind 127.0.0.1
```

Adjust the amount or tint to preview, then Apply or Cancel. Use design defaults
resets personal intent. Next design changes the underlying design while keeping
explicit personal choices, including a choice equal to the previous default.
The sample stores its small records in browser local storage, scoped by family;
it is a single local study, with no user/account service. A storage failure keeps
the material visible, reports that saving failed and exposes Save again.

`inputs.json` supplies versioned ordinary family delivery inputs, product policy
and an empty preference. A design-derived input can replace the authored source
without changing the receiving implementation. The product decides which fields
to expose and where records belong; its content, business handlers and account
authority remain outside the renderer.

```sh
node scripts/material-preference-receiving-check.mjs \
  --evidence .worldbend-work/material-preference-receiving
```

The check compares actual source-MCP and WASM plans, drives the rendered page,
checks continued use and saves representative desktop/mobile evidence. Supply
`--web-root /absolute/copied/web` to serve only a separately copied built package
and this example, without resolving assets from the author's checkout.

See [typed material intent](../../../../docs/MATERIAL_PREFERENCE_CONTRACT.md)
for guards, drafts, runtime adaptation and restoration. The shipped receiving
package is build output; this build step does not install or publish it.

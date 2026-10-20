## Change

Describe the user-visible or contract-visible change.

## Boundary

Name the affected core/adapters and confirm that no parallel transform model,
implicit corner reordering, path-authority widening, or unsupported product
surface was added.

## Verification

- [ ] A focused positive or negative regression covers the change.
- [ ] `pnpm check` passes on current source.
- [ ] Applicable built-runtime or human-flow behavior was exercised.
- [ ] Generated artifacts, private assets, credentials, and local paths are absent.
- [ ] New bundled dependencies have compatible license and notice coverage.

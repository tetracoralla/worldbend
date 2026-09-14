# Worldbend macOS distribution

Worldbend's public macOS target is an **unsigned Apple Silicon disk image**.
It gives users one familiar download while keeping installation, activation,
update, rollback, and removal under Agent Host. It is not an app bundle and it
does not claim Apple Developer ID signing or notarization.

## Release assets

One macOS packaging run produces a content-addressed directory under the
ignored `artifacts/macos/` tree:

| Asset | Purpose |
| --- | --- |
| `worldbend-<version>-macos-arm64.dmg` | Human download containing the complete Agent Host component, bilingual instructions, checksums, and a machine-readable payload manifest. |
| `worldbend-<version>-macos-arm64.dmg.sha256` | Digest for the exact disk-image bytes. |
| `worldbend-<component-version>-macos-arm64.tar.gz` | The same sealed component carried inside the DMG, exposed separately for Agent Host and automated installation. |
| `worldbend-<component-version>-macos-arm64.tar.gz.sha256` | Digest for the exact component archive. |
| `worldbend-<version>-macos-arm64.release.json` | Platform, component, trust, source-revision, and digest record for release tooling. |

The component contains the native CLI and MCP executables, Codex plugin and
Skill, Capability projection, complete license inventory, third-party notices,
and SPDX SBOM. Agent Host validates its closed `component.json` inventory
before accepting it.

## Build and verify

Build on an Apple Silicon Mac from the reviewed release revision:

```bash
pnpm package:macos-dmg
```

Verify the exact DMG emitted by that command:

```bash
pnpm verify:macos-dmg -- /absolute/path/to/worldbend-<version>-macos-arm64.dmg
```

The verifier checks the outer digest and disk-image structure, mounts it
read-only, checks the exact four-file payload, binds the separately published
component asset to the mounted copy, preflights the archive member paths before
extraction, verifies every component file against `component.json`, confirms
the architecture and ad-hoc signature of every packaged native executable, and
exercises the packaged MCP server through its real compact catalog.

The Agent Host component archive is byte-reproducible for unchanged inputs:
file order, modes, timestamps, ownership, and gzip metadata are normalized.
Apple disk-image metadata is not treated as byte-reproducible. Each DMG is
instead immutable, checksummed, mounted, and compared with the deterministic
component identity recorded in its release manifest.

A public candidate must report `source.dirty: false` and name the intended
Git tag and GitHub Release. Packaging a dirty checkout is useful for local
verification but is not a publishable candidate.

## Install with Agent Host

The DMG is the download carrier; Agent Host is the installer. Copy the enclosed
component archive to a writable folder. With an installed Agent Host CLI,
preview the exact archive and write its approval binding:

```bash
agent-host component preview \
  --artifact "/absolute/path/worldbend-<component-version>-macos-arm64.tar.gz" \
  --license-spdx Apache-2.0 \
  --workspace-root "/absolute/path/to/your/workspace" \
  --json > "/absolute/path/worldbend-binding.json"
```

Then import and activate the unchanged archive:

```bash
agent-host component import \
  --artifact "/absolute/path/worldbend-<component-version>-macos-arm64.tar.gz" \
  --binding "/absolute/path/worldbend-binding.json" \
  --activate \
  --workspace-root "/absolute/path/to/your/workspace"
```

Agent Host copies verified bytes into private versioned storage; the source
checkout and mounted DMG are not runtime dependencies. It also owns the Codex
projection and preserves its rollback/removal boundary. Remove the imported
component with:

```bash
agent-host component remove worldbend
```

## Trust and platform limits

- Platform: macOS on Apple Silicon (`arm64`) only. There is no Intel binary in
  this carrier.
- Signing: native executables are ad-hoc signed. The DMG and executables are
  not Developer ID signed and are not notarized.
- Gatekeeper: macOS may require explicit user approval for downloaded software.
  Do not disable Gatekeeper globally. Verify the published SHA-256 first and
  use the narrow approval path presented by macOS or Agent Host.
- The repository-local marketplace at `.agents/plugins/marketplace.json` is a
  development surface. A Git checkout must run `pnpm plugin:stage` before its
  ignored native payload exists. It is not a complete public-repository install
  route and is not an OpenAI public plugin-directory listing.

## Release closure

Before attaching these assets to a GitHub Release:

1. build from a clean reviewed revision and verify `source.dirty: false`;
2. run the repository development checks and the exact DMG verifier;
3. run Agent Host `component preview --standalone` against the separate
   component archive to reacquire its admission and live catalog facts;
4. upload the DMG, component archive, both checksum sidecars, and release JSON
   without renaming them;
5. download the published files again, compare their hashes, and repeat the
   DMG and Agent Host admission checks.

Publishing, signing, notarization, and OpenAI directory submission remain
separate actions and require their own authority.

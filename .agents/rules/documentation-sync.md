# Documentation Sync Rules

Rules for keeping package documentation and robota.io current.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Documentation Source Map

- `content/README.md` is the robota.io home page source (`/`).
- `content/getting-started/README.md` is `/getting-started/`.
- `content/guide/README.md` is `/guide/`.
- `content/guide/building-agents.md` is `/guide/building-agents.html`.
- `content/guide/sdk.md` is `/guide/sdk.html`.
- `content/guide/cli.md` is `/guide/cli.html`.
- `content/guide/architecture.md` is `/guide/architecture.html`.
- `content/guide/permissions-and-hooks.md` is `/guide/permissions-and-hooks.html`.
- `content/guide/context-management.md` is `/guide/context-management.html`.
- `content/examples/*.md` is `/examples/*`.
- `packages/<pkg>/docs/README.md` is copied into robota.io as `/packages/<pkg>/`.
- `packages/<pkg>/docs/SPEC.md` is package contract truth, not marketing docs.
- `packages/<pkg>/README.md` is the npm/GitHub package README.
- `apps/docs/.temp/` and `apps/docs/.vitepress/dist/` are generated outputs. Do not edit them directly.

### Package Change Documentation Gate

- Any package source, public API, CLI behavior, provider behavior, transport behavior, or user-facing configuration change MUST update documentation in the same PR or commit.
- For every changed package, inspect and update `packages/<pkg>/README.md`.
- For every changed package with website-visible package docs, inspect and update `packages/<pkg>/docs/README.md`.
- For every changed package contract, update `packages/<pkg>/docs/SPEC.md`.
- For every changed package composition, import edge, execution mode, or class/interface ownership, inspect and update any package-local `packages/<pkg>/docs/ARCHITECTURE-MAP.md`.
- For every cross-package architecture change, inspect `.agents/specs/ARCHITECTURE-MAP.md` and update the relevant `.agents/specs/architecture-map/*.md` subdocument instead of appending details to the router.
- For every user-facing feature, update at least one matching robota.io source page under `content/`.
- If no README or robota.io update is needed, the PR/task summary MUST explicitly say why the existing docs remain correct.

### Website Build Gate

- After changing `content/` or `packages/*/docs/`, run `pnpm docs:build`.
- Before publish or release prep, verify current user-facing changes are represented in robota.io source pages.
- Never publish a package whose README or website-visible docs describe stale APIs, unsupported provider behavior, removed commands, or missing new features.

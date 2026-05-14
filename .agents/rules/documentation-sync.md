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

### Architecture Map Content Policy

Architecture map files (`.agents/specs/architecture-map/`) own _relationships_ between layers and elements, and the brief contract at each boundary. They do not own verbose explanations, rationale, ownership rationale, or capability inventories.

**Content rules — what belongs:**

- Each entry states: what the element is, what it connects to, and the brief contract at that boundary. Nothing more.
- A relationship table or layer listing must be readable at a glance, like a connection diagram rendered in prose/tables.
- A single-line reference pointer to the owning SPEC or spec doc is sufficient when detail is needed.

**Content rules — what does not belong:**

- Verbose rationale, design notes, and usage guidance belong in the owning package `SPEC.md` or a cross-cutting spec doc.
- Ownership narrative paragraphs that restate what the layer table already shows must be removed.
- Diagram note blocks that repeat structural facts visible in the diagram itself must be removed.

**Removal gate — always re-home before deleting:**

- Before removing any content from an architecture map file, identify the correct target document (package `SPEC.md`, cross-cutting spec, or design doc) and absorb the content there first.
- After re-homing, replace the removed content with a one-line reference pointer only if the relationship itself is still architecture-relevant; otherwise delete entirely.
- Never delete architecture map content without a corresponding absorption commit. Losing durable knowledge is a bug.

**Weight gate:**

- If an architecture map file requires more than one read to understand its structural relationships, it is too heavy. Strip it until each relationship is one line or one row.

### Document Role Sync Gate

- Architecture maps own stable structural boundaries. Update them when ownership, layer direction,
  package topology, deployment topology, or product-shell responsibility changes.
- Package/app SPEC files own package-local contracts. Update them when public API, behavior,
  lifecycle, events, persistence, protocol details, or class/interface contracts change.
- Design documents own rationale and plans. When a design is accepted or implemented, promote the
  durable contract into the relevant SPEC/API/architecture document instead of leaving the design as
  the only source of truth.
- README and robota.io content own user-facing explanation. They must reflect accepted behavior, but
  they must not introduce contracts that are absent from SPEC/API/architecture docs.
- Backlog and task files own scheduling, recommendations, and execution state only. They must not be
  referenced as contract authority after implementation.

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

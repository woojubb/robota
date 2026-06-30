---
name: architecture-map-authoring
description: Use when creating or updating an architecture-map document (`.agents/specs/architecture-map/*`). Produces a doc that satisfies the architecture-map document-type contract (RULE-008) and its completeness gate.
---

# Architecture Map Authoring

Produces an architecture-map document that passes the architecture-map document-type contract
(`RULE-008`) and the `check-architecture-map-completeness.mjs` gate. It authors structure; it does not
own content rules (those live in `documentation-sync.md`).

## Rule Anchor

- `.agents/specs/document-standards/index.md` — the artifact taxonomy + meta-form (the type's contract).
- `.agents/rules/documentation-sync.md` — "Architecture Map Content Policy" (what belongs vs. not).
- `.agents/rules/learning-loop.md` — "Contract Before Automation".

## Use This Skill When

- Adding a new architecture-map slice (e.g. a new subsystem's `<name>-system.md`).
- Updating a map doc after a package-composition change (common-mistakes #45).
- Recovering a map doc the completeness gate flags as missing a spine element.

## Steps

1. **Start from the template.** Copy `.agents/templates/architecture-map-template.md` to
   `.agents/specs/architecture-map/<slice>.md` (or a nested `<section>/<slice>.md`).
2. **Write the spine (MUST):**
   - **H1 title** naming the slice.
   - **Scope line** — one sentence stating what this map owns.
   - **Up-link** — `[System Architecture Map](../ARCHITECTURE-MAP.md)` for a top-level doc, or a link
     to the parent router for a nested detail doc.
   - **Structure block** — a relationship/layer table or a `mermaid` diagram: elements + edges
     (direction) + the brief contract at each boundary. A pure router doc may use a link list instead.
3. **Add owner pointers (recommended).** Link each element to the `SPEC.md` / spec doc that owns its
   detail. Missing pointers are a non-blocking warning.
4. **Stay at relationship altitude.** Per `documentation-sync.md`: relationships + brief boundary
   contracts only. Push rationale, capability inventories, and API detail to the owning `SPEC.md`.
5. **Verify references resolve.** Cited `packages/<name>/...` paths must exist
   (`check-architecture-map-paths.mjs`).
6. **Run the gate:** `pnpm harness:scan:arch-map-completeness` (structure) and
   `pnpm harness:scan:arch-map-paths` (source integrity). Both must pass.
7. **Register the doc** in the architecture-map `README.md` document tree, and (for a new subsystem)
   confirm `repository-overview.md` / `dependency-direction.md` reflect the new slice.

## What This Skill Does NOT Do

- Define content rules → `documentation-sync.md`.
- Own package contracts → `packages/*/docs/SPEC.md`.

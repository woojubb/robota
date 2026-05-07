# Architecture Map Document Tree Split

## Status

Backlog.

## Created

2026-05-07

## Priority

P1 - architecture navigation and maintainability.

## Problem

The architecture map documents have grown too large after earlier guidance asked agents to avoid
splitting files as much as possible. That guidance is now withdrawn for architecture maps. Keeping
all repository structure, package relationships, contracts, layer notes, diagrams, and lessons in a
small number of large files makes the maps harder for humans and LLM agents to scan.

Architecture maps should become a routed document tree: a small entrypoint that explains how to
navigate the map, plus grouped subdocuments that own focused architecture areas.

## Current Code Confirmation

- `.agents/specs/ARCHITECTURE-MAP.md` is the repository-level architecture map and is already large.
- `packages/agent-cli/docs/ARCHITECTURE-MAP.md` is the CLI-focused architecture map and is also
  large.
- `.agents/project-structure.md` links to `.agents/specs/ARCHITECTURE-MAP.md` as the
  repository-level architecture map.
- Completed backlog and task history already tracks architecture-map creation/audit work, but not
  a dedicated document-tree split for architecture maps.

## Scope

- `.agents/specs/ARCHITECTURE-MAP.md`
- New architecture-map-only folder, recommended as `.agents/specs/architecture-map/`
- `.agents/project-structure.md`
- `AGENTS.md` document tree only if the routing entrypoint changes
- `packages/*/docs/ARCHITECTURE-MAP.md` files that should be linked, moved, summarized, or folded
  into the architecture-map tree
- `.agents/rules/process.md` and `.agents/rules/common-mistakes.md` if rules need to describe when
  architecture-map updates are required

## Recommended Direction

Create a dedicated architecture map folder and turn the current top-level map into a short router.
The goal is not to scatter documentation excessively; it is to make architecture ownership
explicit and keep each document small enough to be read and maintained safely.

Recommended tree:

```text
.agents/specs/
├── ARCHITECTURE-MAP.md                  # router and reading guide
└── architecture-map/
    ├── README.md                        # map index, update policy, diagram conventions
    ├── repository-overview.md           # top-level package/app grouping
    ├── dependency-direction.md          # allowed dependency flow and forbidden edges
    ├── agent-system.md                  # agent package family and command/provider/runtime flow
    ├── dag-system.md                    # DAG package family and orchestration flow
    ├── apps-and-deployment.md           # apps, docs/blog, deployment paths
    ├── cross-cutting-contracts.md       # auth, credits, storage, events, permissions
    └── architecture-lessons.md          # durable architecture lessons and update triggers
```

Recommended migration strategy:

- Keep `.agents/specs/ARCHITECTURE-MAP.md` as the stable entrypoint linked by existing docs.
- Move detailed sections into focused files under `.agents/specs/architecture-map/`.
- Keep each subdocument focused on one architecture slice and prefer links to owning `SPEC.md`
  files instead of duplicating package contracts.
- Use Mermaid diagrams only where they clarify boundaries or dependency direction.
- Preserve an LLM-friendly tree/index in the router so an agent can choose the right subdocument
  before reading large context.
- Add a rule or process note that architecture-affecting changes must update the relevant
  architecture-map subdocument, not append everything to the root map.

## Constraints

- The architecture map folder is allowed and expected; the previous "avoid splitting architecture
  maps" preference is withdrawn.
- Do not duplicate package-level SSOT details already owned by `packages/*/docs/SPEC.md`.
- Do not make `AGENTS.md` domain-specific. It may route to the architecture map entrypoint, but
  detailed architecture belongs under `.agents/specs/architecture-map/` and package specs.
- Keep generated API reference content untouched.
- Avoid excessive fragmentation: split by architecture ownership, not by every package or class.
- Preserve existing inbound links or provide compatibility links from old entrypoints.

## Acceptance Criteria

- [ ] `.agents/specs/ARCHITECTURE-MAP.md` becomes a concise router and reading guide.
- [ ] A dedicated `.agents/specs/architecture-map/` folder exists.
- [ ] Repository overview, dependency direction, agent system, DAG system, apps/deployment,
      cross-cutting contracts, and architecture lessons are separated into focused subdocuments.
- [ ] Existing links from `.agents/project-structure.md`, AGENTS routing, and package docs still
      lead to a valid architecture-map entrypoint.
- [ ] The split reduces root-map size substantially while preserving all important architecture
      information through links or moved sections.
- [ ] Subdocuments link to owning package `SPEC.md` files instead of duplicating contract details.
- [ ] Rules/process docs state that architecture-affecting changes must update the relevant
      architecture-map subdocument.
- [ ] A quick link-check or grep-based validation confirms no stale architecture-map links remain.

## Verification Plan

- `rg -n "ARCHITECTURE-MAP|architecture-map" AGENTS.md .agents packages content`
- `pnpm harness:scan`
- Manual review of the router to confirm each major architecture area has one clear destination.
- Manual review that no generated `content/api-reference/**` files were edited.

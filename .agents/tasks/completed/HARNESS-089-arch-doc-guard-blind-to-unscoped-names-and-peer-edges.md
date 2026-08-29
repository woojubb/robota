---
title: 'HARNESS-089: the architecture-doc package-name guard only validates @robota-sdk-scoped tokens, and the dependency-direction rules ignore peerDependencies — the guards are blind to exactly the reference style and edge set they claim to cover'
status: skipped
created: 2026-08-13
priority: high
urgency: soon
area: scripts/harness/check-dependency-direction.mjs, .agents/harness.config.json
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2049#issuecomment-5460946050
---

# HARNESS-089: dependency-direction guard blind spots

## Problem

Two guards in `check-dependency-direction.mjs` are narrower than the guarantees they are cited for,
and the gap is why the architecture-map drift (DOCS-022) survived unflagged. Fixing DOCS-022/DOCS-023
without this leaves the drift free to recur.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- **(a) Rule 9 matches only scoped tokens.** `check-dependency-direction.mjs:427-428` builds
  `tokenPattern` from `internalPackagePrefix = '@robota-sdk/agent-'` (`.agents/harness.config.json:5`),
  so it only ever matches fully-scoped `@robota-sdk/agent-*` names. The guarded docs
  (`project-structure.md`, `.agents/specs/architecture-map/*`) reference packages predominantly
  unscoped (`agent-provider`) and as `apps/<name>` paths — exactly the phantom styles that survived
  (`apps/agent-web-monitor` dissolved yet listed "landed"; bare `agent-provider` denied by
  `project-structure.md:20`). Sibling scans cover only part of the corpus:
  `check-ghost-package-refs.mjs` validates scoped `@robota-sdk/*` and `packages/<name>` dir tokens;
  `check-architecture-map-paths.mjs` validates only `packages/<name>/(src|scripts|bin)/*.ts` paths.
  The unvalidated residue is bare `agent-*`/`dag-*`/`pack-*` names and `apps/<name>` tokens.
- **(b) Direction rules ignore peerDependencies.** The per-package record stores
  `Object.keys(pkg.dependencies)` only (`:60,:77`); every direction rule (bidirectional, forbidden-prod,
  agent-core-zero-deps, plugin-layer, interface-deps, dag-nodes-leaf) iterates `pkg.dependencies`
  only, while `peerDependencies` reach only `allDependencies`, consumed solely by the full-graph cycle
  check (`:645-675`). `project-structure.md:118` defines the ground-truth edge set as
  `dependencies + peerDependencies` and says this script enforces direction over that graph — it does
  not. Live peer-only edges exist: `agent-tools → agent-core` and `agent-tool-mcp → agent-core` are
  declared only in `peerDependencies`, invisible to rules 1/3/4/5/7.

## Direction

1. Extend Rule 9 to also match unscoped `agent-*`/`dag-*`/`pack-*` tokens and `apps/<name>` path
   references against the workspace package/app directories (keep the existing "planned" exemption for
   `auth`/`credits`).
2. Include workspace `peerDependencies` in the per-package `dependencies` set the direction rules
   iterate (or, if a peer edge should be exempt from a specific rule, make that explicit) — so the
   enforced graph matches the documented ground-truth edge set. Alternatively, narrow
   `project-structure.md:118` to "dependencies only" and state the blind spot; the scan-narrower-than-
   its-claim is the finding either way.

## Test Plan

- Red-first: a doc fixture referencing a nonexistent unscoped `agent-foo` and an `apps/bar` path must
  FAIL Rule 9 (passes today).
- Red-first: a fixture package with a direction-violating `peerDependency` must be caught by the
  relevant direction rule (passes today).
- Existing green scan output unchanged on the real tree after DOCS-022/023 land.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness/guard change only; verification is the red-first fixtures in the Test Plan.

## Resolution

This guard/document-graph finding is explicitly covered by the open architecture-contract owner
issue #2049. The implementation remains outstanding there; this local duplicate is archived as
skipped with the exact handoff rather than claiming the guard is fixed.

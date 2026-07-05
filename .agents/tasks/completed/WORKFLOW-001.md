# WORKFLOW-001 — Absorb the DAG workflow engine into robota (task breakdown)

Spec: `.agents/spec-docs/done/WORKFLOW-001-absorb-dag-engine.md`
Status: completed — Phases A–E complete; 36 DAG packages absorbed external-runtime-free + free of out-of-scope material; committed ba23e7517; harness:scan 38/38 green.

Clean-history invariant: nothing containing the external-runtime name or out-of-scope material is ever
committed to `robota`. Each phase is gated; the first commit happens only at the end of Phase E.

## Phase A — Exclusion manifest → (sets up TC-03, TC-04)

- [x] Freeze the absorb set (36 workspace members: 10 engine/core, 3 surfaces, 2 adapters, 21 nodes).
- [x] Freeze the exclusion set (5: the external-runtime provider adapter, `dag-runtime-server`, the
      visual-designer UI packages, the internal docs site) plus the never-copy non-source material
      (local environment files, internal tooling) — all out of scope.
- [x] No file changes in this phase — manifest only.

## Phase B — Copy into robota working tree (uncommitted) → TC-01 (part), TC-03

- [x] Copy the 36 `dag-*` packages into `robota/packages/` (flat, no rename).
- [x] Copy none of the 5 excluded packages/apps; the external-runtime provider adapter enters neither
      `pnpm-workspace.yaml` nor any `package.json`.
- [x] Copy none of the out-of-scope material (local environment files, internal tooling).

## Phase C — Renativize the external runtime (working tree, pre-commit) → TC-02, TC-03

- [x] Replace external-runtime-shaped concepts in `dag-core/src/types/{runtime-provider,workflow-file}.ts`,
      `dag-core/src/index.ts`, and
      `dag-framework/src/{local-dag-runtime-provider,types,create-dag-framework,default-node-registry}.ts`
      with a robota-native runtime-provider + workflow-file model.
- [x] Remove the external-runtime provider branch + dependency from
      `dag-cli/src/providers/resolve-provider.ts` and `dag-cli/package.json` (sole importer).
- [x] Gate: `rg -i` for the external-runtime name over `packages/dag-*` returns empty (TC-02); `rg -l`
      for the external-runtime provider adapter / excluded package names over `packages/dag-*` empty (TC-03).

## Phase D — License + workspace + harness → TC-05, TC-07, TC-08

- [x] Set every absorbed package `license` to robota's (`AGPL-3.0-only OR LicenseRef-Commercial`); no `MIT` remains (TC-05).
- [x] Fix stale root `tsconfig.json` refs (incl. pre-existing `agent-provider-openai`/`agent-team`).
- [x] Confirm `pnpm-workspace.yaml` flat `packages/*` glob admits `packages/dag-*` and `harness:scan` config is valid at the enlarged count.
- [x] Confirm no unmet workspace deps point at excluded packages (TC-08).

## Phase E — Verify green & first clean commit → TC-01, TC-04, TC-06, TC-07

- [x] `pnpm install && pnpm -w typecheck` → exit 0 with the 36 absorbed packages present (TC-01).
- [x] `pnpm --filter "@robota-sdk/dag-*" test` → exit 0 (TC-06).
- [x] `pnpm harness:scan` → exit 0 at the enlarged package count (TC-07).
- [x] `git ls-files | rg` check for out-of-scope material → nothing (TC-04).
- [x] Only after all gates green: make the first commit (external-runtime-free and free of out-of-scope material).

## Follow-ups (separate specs, not in this task)

- WORKFLOW-002 — native `dag-runtime-server` API (R1 redesign) + absorb it.
- WORKFLOW-003 — `/workflows` agent-cli command.
- Update `feedback_runtime_orchestrator_api_boundary` memory/rule to native-first; retire the origin repo.

## TC Coverage Map

| TC    | Covered by phase(s) |
| ----- | ------------------- |
| TC-01 | B, E                |
| TC-02 | C                   |
| TC-03 | B, C                |
| TC-04 | A, E                |
| TC-05 | D                   |
| TC-06 | E                   |
| TC-07 | D, E                |
| TC-08 | D                   |

## Test Plan / 검증

Every Completion Criterion (TC-01..TC-08) is mechanically checkable — no manual rows. Verification is
command-form only: `pnpm install && pnpm -w typecheck` (TC-01) and `pnpm --filter "@robota-sdk/dag-*" test`
(TC-06) for build/test green; `rg -i` external-runtime-name scan over `packages/dag-*` and `rg -l` dangling-ref scans (TC-02, TC-03)
for external-runtime de-wiring; `git ls-files | rg` absence scan (TC-04) for out-of-scope material;
`rg '"license"'` assertion over absorbed `package.json` (TC-05); `pnpm harness:scan` smoke (TC-07); and
`pnpm --filter "@robota-sdk/dag-*" exec -- true` unmet-dependency resolution (TC-08). Each phase carries its
own gate; the first commit is taken in Phase E only after all eight criteria pass green, preserving
the clean-history (external-runtime-free, free of out-of-scope material) invariant.

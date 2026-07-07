---
status: done
type: DATA
tags: [typescript, json-schema]
---

# DATA-004: unify dag-cli instant-node reload onto the owner round-trip

## Problem

DATA-003 gave `@robota-sdk/dag-node-instant-node` the read half of its persistence round-trip
(`parsePersistedInstantNode` + `rehydrateInstantNode` + `isPersistableInstantNode`). But
`packages/dag-cli/src/local-runner/persistence/store.ts` still carries its **own** hand-rolled copy of
that logic — `parsePersistedRecord` (prompt + composite manifest parsing), `reconstructNode`
(prompt→`createPromptBackedNodeDefinition`, composite→`createCompositeInstantNodeDefinition`), plus
`toRecordObject`/`parsePortKeys` and a duck-typed `asPersistable`. This is the exact second copy
DATA-003 flagged as a deferred follow-up: two independent deserializers for one owned data model, free
to drift (e.g. dag-cli defaults missing prompt ports to `{key:'text'}` and drops port `description`;
the owner validates strictly and preserves `description`). Reproduction: `parsePersistedRecord` and
`reconstructNode` in `store.ts` duplicate `parsePersistedInstantNode`/`rehydrateInstantNode` in the
owner package.

Goal: `store.ts` delegates instant-node parse + reconstruct to the owner (single SSOT), keeping only
what is genuinely dag-cli's — the `code` node kind (manifest + `.dag.node.js` companion) and the
composite sub-runner (`buildCompositeRunner`, which closes over dag-cli's `LocalDagRunner`).

## Architecture Review

### Affected Scope

- **`packages/dag-cli/src/local-runner/persistence/store.ts`** only. Delete `parsePersistedRecord`,
  `reconstructNode`, `toRecordObject`, `parsePortKeys`, and the local `asPersistable`; import and call
  `parsePersistedInstantNode`, `rehydrateInstantNode`, `isPersistableInstantNode` from the owner.
  `loadNodes` passes `{ compositeRunner: buildCompositeRunner(liveDefs) }` to `rehydrateInstantNode`;
  the `code` branch (`parseCodeManifest`/`reconstructCodeNode`) and `buildCompositeRunner` stay.
- dag-cli is private (not published); no external contract. Behavior preserved for well-formed
  manifests (all written by `saveNode`); the owner's stricter validation only affects hand-corrupted
  manifests, which it skips rather than defaulting — an improvement, not a regression.

### Alternatives Considered

1. **Leave the duplicate.** Con: two deserializers for one owned model — the drift DATA-003 set out to
   remove; the port-default divergence already exists. Rejected.
2. **Delegate to the owner round-trip, keep code-node + composite-runner local (chosen).** Pro: one
   SSOT for instant-node persistence; deletes ~70 lines; the owner's tests already cover the round-trip.
   Con: a minor behavior tightening (strict port validation) — acceptable, manifests are owner-written.

### Decision

Alternative 2. `store.ts` uses the owner's parse + rehydrate; `code` nodes and `buildCompositeRunner`
remain dag-cli's. Existing characterization tests (`composite-reload-real`, `code-node-persistence`,
`mcp-handlers` prompt round-trip) are the safety net.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (only `dag-cli` store.ts; owner unchanged)
- [x] Sibling scan 완료 — the sibling is the owner round-trip added in DATA-003; this retires dag-cli's copy
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (single SSOT; keep code-node + composite-runner local)

## Solution

Replace `store.ts`'s instant-node parse/reconstruct/guard with the owner's, threading
`buildCompositeRunner` as the composite runner; keep the `code`-kind branch and `buildCompositeRunner`.

## Affected Files

- `packages/dag-cli/src/local-runner/persistence/store.ts`
- (tests) existing dag-cli persistence/composite tests must stay green; add one if a gap appears.

## Completion Criteria

- [x] TC-01: `store.ts` no longer defines `parsePersistedRecord`/`reconstructNode` (nor
      `toRecordObject`/`parsePortKeys`); it imports `parsePersistedInstantNode`, `rehydrateInstantNode`,
      `isPersistableInstantNode` from `@robota-sdk/dag-node-instant-node` — asserted by grep + typecheck.
- [x] TC-02: a prompt node saved by `saveNode` reloads via `loadNodes` with the same nodeType/ports —
      the existing prompt round-trip test stays green.
- [x] TC-03: a composite node reloads and its sub-runner executes the inner DAG — the existing
      `composite-reload-real` test stays green.
- [x] TC-04: a `code` node still reconstructs from its manifest + companion — the existing
      `code-node-persistence` test stays green.
- [x] TC-05: full dag-cli suite + `pnpm harness:scan` green; 0 lint errors.

## Test Plan

DATA + typescript/json-schema → the change is covered by the existing dag-cli persistence
characterization tests (prompt round-trip, composite real reload, code-node reload) plus a grep/type
assertion that the duplication is gone.

| TC-ID | Test Type          | Tool / Approach                                                         | Notes |
| ----- | ------------------ | ----------------------------------------------------------------------- | ----- |
| TC-01 | Unit (grep+type)   | `rg` shows no local parse/reconstruct; typecheck green after delegation |       |
| TC-02 | Integration        | existing dag-cli prompt-node round-trip test stays green                |       |
| TC-03 | Integration (real) | existing `composite-reload-real` test stays green                       |       |
| TC-04 | Integration        | existing `code-node-persistence` test stays green                       |       |
| TC-05 | CI smoke           | full dag-cli suite + harness:scan green                                 |       |

## Tasks

- [ ] `.agents/tasks/DATA-004.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **Origin + GATE-WRITE (2026-07-07).** The deferred DATA-003 Phase-3 follow-up: dag-cli's `store.ts`
  duplicates the owner's DATA-003 round-trip. All sections present; concrete symptom + reproduction; 2
  alternatives + decision; checklist [x]; TC-01…TC-05 observable; one Test Plan row per TC.
- **GATE-APPROVAL (2026-07-07).** Owner directed resolving the outstanding follow-up. Verbatim:
  **"미해결 그 문제 해결해"** (solve that unresolved problem).

- **IMPLEMENTED + GATE-COMPLETE — ✅ PASS | 2026-07-07.** `store.ts` now imports
  `parsePersistedInstantNode` / `rehydrateInstantNode` / `isPersistableInstantNode` from the owner and
  deleted `parsePersistedRecord`/`reconstructNode`/`parsePortKeys`/`toRecordObject` + the local
  `asPersistable` (~70 lines); `loadNodes` passes `{ compositeRunner: buildCompositeRunner(liveDefs) }`;
  the `code` branch + `buildCompositeRunner` stay dag-cli's. TC-01 (grep: duplication gone; typecheck
  green) · TC-02/03/04 (existing prompt round-trip, `composite-reload-real` real-fs+runner, and
  `code-node-persistence` tests stay green) · TC-05 (full dag-cli 1007 tests, 45/45 scans, 0 lint
  errors). Spec `draft/` → `done/`, `status: done`; task at `.agents/tasks/completed/DATA-004.md`.

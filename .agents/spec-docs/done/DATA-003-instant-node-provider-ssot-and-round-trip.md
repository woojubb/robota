---
status: done
type: DATA
tags: [typescript, json-schema]
---

# DATA-003: instant-node provider SSOT + symmetric persistence round-trip

## Problem

`@robota-sdk/dag-node-instant-node` owns the instant-node data model but under-exports it, forcing
consumers to duplicate its enumeration and hand-roll half of its serialization. Two concrete symptoms
(surfaced by the architecture-auditor pass on FLOW-007, findings F1/F2/F4, 2026-07-06):

1. **No runtime SSOT for the provider set (F1).** The package exports the union **type**
   `TInstantNodeProvider` but no runtime value. Its authoritative enumeration exists only as the keys
   of the un-exported `PROVIDER_DEFAULTS` record. So consumers re-declare the identical literal
   `['anthropic', 'openai', 'gemini', 'deepseek', 'qwen']` to narrow a `string` at runtime:
   `packages/agent-command-workflows/src/create-command.ts` (`PROVIDER_VALUES`) and
   `packages/agent-command-workflows/src/persistence/instant-node-loader.ts` (`PROVIDERS`), plus a
   third copy in `create-command.test.ts`. Reproduction: `rg "'anthropic', 'openai', 'gemini'"` →
   three independent definitions; adding a provider silently requires editing all three with no
   compile-time link back to the owner's type.

2. **Asymmetric persistence — write is owned, read is hand-rolled and prompt-only (F2/F4).** The owner
   provides the write half (`IPersistableInstantNode.toPersisted()`, implemented by BOTH
   `PromptBackedNodeDefinition` → `kind:'prompt'` and `CompositeInstantNodeDefinition` →
   `kind:'composite'`), but **no `fromPersisted`**. So `instant-node-loader.ts`
   (`reconstructPromptNode`) reimplements deserialization field-by-field and handles **only**
   `kind:'prompt'`, returning `null` for anything else. Because `workspace-writer.ts` `asPersistable`
   is a purely structural `toPersisted` probe (via an `as unknown as` double-cast, F4), a composite
   instant node **can be written** to `<root>/nodes/*.node.json` yet is **silently dropped on reload**
   (orphaned, no error). Reproduction: persist a `kind:'composite'` manifest, call `loadInstantNodes`
   → it is absent from the returned defs with no diagnostic. (Latent today — `/workflows create` only
   authors prompt nodes — but the write/read seam is already inconsistent and will break the moment
   composite authoring or any other composite-saving caller is added.)

Goal: make the instant-node owner the **single runtime source of truth** for its provider set and a
**symmetric** serialize/deserialize round-trip, and delete the duplicated literals + double-cast in
the consumer.

## Architecture Review

### Affected Scope

- **Owner — `@robota-sdk/dag-node-instant-node`** (`packages/dag-nodes/instant-node/src/index.ts`):
  add runtime exports — `INSTANT_NODE_PROVIDERS` (a `readonly` const array) with `TInstantNodeProvider`
  **derived** from it (`typeof INSTANT_NODE_PROVIDERS[number]`), an `isInstantNodeProvider(x): x is
TInstantNodeProvider` guard, an `isPersistableInstantNode(x): x is IPersistableInstantNode` guard,
  and a `rehydrateInstantNode(record, deps?)` that reconstructs BOTH `kind`s from a
  `TPersistedInstantNode` (composite needs an injected sub-runner — mirror the existing
  `createCompositeInstantNodeDefinition({ runner })` shape; the caller supplies it).
- **Consumer — `@robota-sdk/agent-command-workflows`**: `create-command.ts` and
  `instant-node-loader.ts` import `INSTANT_NODE_PROVIDERS`/`isInstantNodeProvider` and delete their
  local arrays; `instant-node-loader.ts` delegates reconstruction to `rehydrateInstantNode`;
  `workspace-writer.ts` uses `isPersistableInstantNode` instead of the `as unknown as` probe. Its unit
  - opt-in live suites must stay green.
- **Out of scope (noted):** `packages/dag-cli/src/local-runner/persistence/store.ts` holds its **own**
  private copy of the same reconstruction (`parsePersistedRecord`/`reconstructNode`, incl. composite
  via `buildCompositeRunner`). It MAY later delegate to the new owner `rehydrateInstantNode` to unify
  the two copies, but dag-cli is a private product and its refactor is deferred to a follow-up.

### Alternatives Considered

1. **Leave the duplication; just add a comment.** Pro: zero change. Con: the type/enumeration stays
   modeled by three independent sources that silently drift (common-mistakes #23/#55); the composite
   orphan remains latent-but-real. Rejected.
2. **Export a runtime const + guards + `rehydrateInstantNode` from the owner; consumers import
   (chosen).** Pro: single runtime owner for the provider set; symmetric round-trip owned where
   `toPersisted` already lives; deletes both consumer copies + the double-cast; composite reload
   becomes a real, testable path (or an explicit reject) rather than a silent drop. Con: touches the
   owner package's public surface (needs its SPEC update) and requires a composite runner-injection
   seam.
3. **Put the shared reader/rehydrator in `@robota-sdk/dag-framework`** (next to `scanWorkspaceCatalog`).
   Pro: one workspace-catalog module. Con: `dag-node-instant-node` depends **up** on
   `agent-core`/`agent-provider`, so importing it into `dag-framework` would pull the agent-\* layer
   into the dag layer (the exact edge FLOW-007 kept out). The round-trip belongs to the type's owner,
   not the framework. Rejected.

### Decision

Alternative 2. The instant-node owner exports `INSTANT_NODE_PROVIDERS` + `TInstantNodeProvider`
(derived) + `isInstantNodeProvider` + `isPersistableInstantNode` + `rehydrateInstantNode` (both
kinds). `agent-command-workflows` imports them, deletes its two literal arrays and the `as unknown as`
double-cast, and delegates reconstruction to the owner. Composite persistence becomes either a
supported round-trip or an explicit, surfaced rejection — never a silent orphan.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 (owner `dag-node-instant-node`; consumer `agent-command-workflows`; dag-cli noted out-of-scope)
- [x] Sibling scan 완료 — the sibling is `dag-cli`'s private reconstruction copy (`store.ts`); this spec unifies the _owner-side_ contract and leaves dag-cli's adoption as a documented follow-up
- [x] 대안 최소 2개 검토 완료 (3 considered)
- [x] 결정 근거 문서화 완료 (owner-owned SSOT + symmetric round-trip; no agent-\* edge into dag-framework)

## Solution

Phased; each phase independently green.

- **Phase 1 — provider SSOT (F1).** Owner exports `INSTANT_NODE_PROVIDERS` (const) and derives
  `TInstantNodeProvider` from it, plus `isInstantNodeProvider`. Consumers import and delete
  `PROVIDER_VALUES`/`PROVIDERS`/the test copy.
- **Phase 2 — symmetric round-trip (F2 + F4).** Owner adds `rehydrateInstantNode(record, deps?)`
  covering `prompt` and `composite` (composite runner injected by the caller) and
  `isPersistableInstantNode`. `instant-node-loader.ts` delegates to it; `workspace-writer.ts` uses the
  guard. Decide composite policy: reload it (preferred) or make `saveInstantNodeFile` reject a
  composite with a clear error — no silent drop either way.
- **Phase 3 (optional follow-up) — unify dag-cli.** Point `store.ts`'s reconstruction at the owner
  `rehydrateInstantNode` so the two copies collapse to one. Deferred; separate task.

## Affected Files

- `packages/dag-nodes/instant-node/src/index.ts` (+ its `docs/SPEC.md`) — new exports + round-trip.
- `packages/agent-command-workflows/src/create-command.ts`, `src/persistence/instant-node-loader.ts`,
  `src/persistence/workspace-writer.ts` (+ tests, + `docs/SPEC.md` if surface changes).
- Tests across the above.

## Completion Criteria

- [x] TC-01: `@robota-sdk/dag-node-instant-node` exports `INSTANT_NODE_PROVIDERS` and
      `isInstantNodeProvider`, and `TInstantNodeProvider` is derived from the const; the consumer
      literal arrays (`PROVIDER_VALUES`, `PROVIDERS`, test copy) are deleted — `rg "'anthropic', 'openai', 'gemini'"`
      returns zero source matches; typecheck + the affected suites are green.
- [x] TC-02: a prompt node round-trips — `createPromptBackedNodeDefinition(spec).toPersisted()` →
      `rehydrateInstantNode(record)` yields a definition with the same `nodeType`, ports, `provider`,
      and `model`; asserted by a JSON round-trip test.
- [x] TC-03: a **composite** instant node either round-trips (write manifest → `rehydrateInstantNode`
      reconstructs it with an injected runner and it is present in `loadInstantNodes` output) OR, if
      composite reload is intentionally unsupported, `saveInstantNodeFile` returns/raises a clear
      "composite not supported" error — in neither case is it silently dropped.
- [x] TC-04: `workspace-writer.asPersistable` uses `isPersistableInstantNode` (no `as unknown as`
      double-cast remains in the file); asserted by a type/behavior test.
- [x] TC-05: `agent-command-workflows` default unit suite (`vi.stubEnv` no-key path intact) and the
      opt-in `test:live` suite remain green after the consumer refactor.

## Test Plan

DATA + typescript/json-schema → type tests (`vitest-expect-type`/tsd) for the SSOT/guards and
Zod/JSON round-trip tests for the persistence symmetry, plus a consumer-refactor regression run.

| TC-ID | Test Type         | Tool / Approach                                                               | Notes |
| ----- | ----------------- | ----------------------------------------------------------------------------- | ----- |
| TC-01 | Type + grep       | vitest-expect-type (derived `TInstantNodeProvider`) + `rg` zero-dup assertion |       |
| TC-02 | Data (round-trip) | vitest — `toPersisted()` → `rehydrateInstantNode()` equivalence (prompt)      |       |
| TC-03 | Data (round-trip) | vitest — composite write→reload present, or explicit reject (no silent drop)  |       |
| TC-04 | Type              | vitest — `isPersistableInstantNode` guard replaces the double-cast            |       |
| TC-05 | Integration       | vitest — agent-command-workflows unit + opt-in live suites stay green         |       |

## Tasks

- [ ] `.agents/tasks/DATA-003.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- **Origin (2026-07-06).** Drafted from the `architecture-auditor` pass on the FLOW-007 authoring
  module (findings F1 provider-list-no-SSOT, F2 asymmetric prompt/composite persistence, F4
  double-cast probe). Auditor recommended these as one owner-package backlog item; captured here as
  DATA-003.
- **GATE-WRITE — PASS (2026-07-06).** All sections present; Problem has concrete symptoms (3 duplicated
  provider literals; composite write-but-no-read orphan) + reproduction (`rg` the literal; persist a
  composite → absent on reload); Architecture Review has 3 alternatives + validated Decision; checklist
  all [x]; TC-01…TC-05 observable; one Test Plan row per TC. 45/45 harness scans pass.
- **GATE-APPROVAL — PASS (2026-07-06).** Owner approved immediate implementation. Verbatim: **"1"**
  (the offered option "지금 승인 → 바로 구현"). Implementation authorized.
- **IMPLEMENTED — DONE (2026-07-06).** Owner `@robota-sdk/dag-node-instant-node` now exports
  `INSTANT_NODE_PROVIDERS` (const, `TInstantNodeProvider` derived), `isInstantNodeProvider`,
  `isPersistableInstantNode`, `parsePersistedInstantNode`, `rehydrateInstantNode` (both kinds;
  composite requires an injected runner else throws) — 7 new owner tests (no module mocks). Consumer
  `agent-command-workflows` deleted both duplicated provider arrays + the `as unknown as` double-cast
  and delegates parse/rehydrate to the owner; `saveInstantNodeFile` refuses composites so no orphan is
  written; `loadInstantNodes` surfaces a composite skip non-silently. 28 unit tests + 4 opt-in live
  scenarios (incl. a deterministic DATA-003 reload-round-trip that stubs authoring but runs the prompt
  node against the real LLM) green; 45/45 scans; 0 lint errors. SPECs updated. dag-cli's private
  reconstruction copy remains a documented follow-up.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-07

Implemented + merged (#1005 → #1006) and released in `3.0.0-beta.79`. TC-01 (provider runtime SSOT;
zero duplicated arrays), TC-02 (prompt round-trip), TC-03 (composite round-trip in owner / write-reject
in consumer — no silent orphan), TC-04 (`isPersistableInstantNode` guard replaces the `as unknown as`
double-cast), TC-05 (consumer unit + opt-in live suites green) all verified: 7 owner round-trip tests
(no module mocks) + 3 consumer writer tests + 28 consumer unit + a deterministic real-LLM reload
round-trip; 45/45 scans, 0 lint errors. dag-cli's private reconstruction copy remains a documented
follow-up. Spec `draft/` → `done/`, `status: done`; task at `.agents/tasks/completed/DATA-003.md`.

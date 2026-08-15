---
title: "ARCH-015: agent-session's persistSession rebuilds the record from nine fields and destroys every other contract field on re-save — a latent public-API data-loss hazard against interactive records, plus a near-duplicate store port"
status: done
completed: 2026-08-15
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-session, packages/agent-interface-transport
depends_on: []
---

# ARCH-015: the Session-level record writer is non-preserving

## Problem

`agent-session`'s `persistSession` rebuilds the persisted record from nine fields, carrying forward
only `name`/`createdAt` from the loaded record — so every other field of the shared
`IInteractiveSessionRecord` contract (goal, plan, activeBranch, backgroundTasks, memoryEvents,
contextReferences, sandboxSnapshotId) is destroyed when a `Session`-level save re-persists a record
that the framework writer had enriched. It is not a live first-party bug today, but it is a real
latent hazard on genuinely public API, and it sits beside a near-duplicate store port that seeds the
same drift.

## Evidence (adversarially verified 2026-08-13, PARTIAL — mechanism confirmed, live-path citation corrected)

- `packages/agent-session/src/session-history-ops.ts:154-173` — `persistSession` loads `existing` but
  rebuilds from 9 fields, carrying only `name`/`createdAt`; no `...existing` spread. Because
  `ISessionRecord` is a literal alias of `IInteractiveSessionRecord` (`session-store.ts:35`, TYPE-003),
  a `Session`-level save of an interactive record drops the optional contract fields the framework
  writer preserves (`agent-framework/src/interactive/interactive-session-persistence.ts:54-134`).
- **Correction (verifier):** the original "live public API" citation was wrong. `agent-framework`'s
  `assembly/create-session.ts` is INTERNAL (`agent-framework/src/index.ts:663-668` marks
  `createSession()` "INTERNAL (not exported)"; only the `ICreateSessionOptions` TYPE is exported), and
  no in-repo wiring gives a raw `Session` a `sessionStore` — the interactive projection
  (`create-session-projection.ts:29-97`) omits it, so `InteractiveSession`'s inner `Session` never
  persists (`session.ts:206-207` no-op), and every first-party store consumer routes the store only to
  `InteractiveSession`. The two writers therefore never touch the same record in-repo.
- The hazard is a genuinely public surface: `@robota-sdk/agent-session` exports `Session`
  (`index.ts:4`), `ISessionOptions.sessionStore` (`session-types.ts:95`), and `SessionStore`
  (`index.ts:69`) with default dir `~/.robota/sessions` — an external consumer wiring a raw `Session`
  with a store to the same dir + id as an interactive record hits the field-destruction.
- Adjacent drift seed (interface-cluster F12): `ISessionStore` (`session-store.ts:38-45`, +optional
  `getFilePath`) is a near-duplicate of the SSOT `IInteractiveSessionStore`
  (`agent-interface-transport/src/session-contracts.ts:550-556`); neither doc acknowledges the other,
  and a store built to the SSOT contract silently loses `transcript_path` in every hook input.

## Direction

1. Make `persistSession` non-destructive: spread `...existing` (or all optional fields) into the
   rebuilt record so a `Session`-level save preserves fields it does not own.
2. Reconcile the store ports: fold `getFilePath` into the SSOT `IInteractiveSessionStore` and alias
   `ISessionStore` to it (mirroring TYPE-003's record alias), or document the SPI split explicitly in
   both SPECs.

## Endorsed Recommendation

Preserve the complete pre-existing `IInteractiveSessionRecord` first, then overwrite only the fields
owned by the raw `Session` writer: `id`, `cwd`, `updatedAt`, `messages`, `history`, `systemPrompt`, and
`toolSchemas`. Keep the existing `name` and `createdAt` semantics. This ordering preserves every current
and future field that the writer does not own while preventing stale values from overriding live Session
state.

Make `IInteractiveSessionStore` the sole owned port. Add its optional file-backed `getFilePath` capability
to `agent-interface-transport`; make all `agent-session` internals consume the canonical record and store
contracts directly; remove the local interface declarations. Existing public names may remain only as
renamed re-exports from the owner package, never as local one-to-one aliases. Verify all current non-owned
optional fields, Session-owned overwrite priority, direct canonical type consumption, and a deterministic
public-SDK round trip with cleanup.

Depth review on 2026-08-15 found both findings LOCAL and no foundational finding. Independent proposal
review first returned REVISE because a local `I*` type alias would violate the type SSOT rules; after the
recommendation was changed to direct internal consumption plus compatibility-only renamed re-exports, it
returned `REVIEW VERDICT: ENDORSE` on 2026-08-15.

## Test Plan

- Red-first: persist an interactive-shaped record (with goal/plan/activeBranch set) via
  `agent-session`'s `Session` + `SessionStore`, reload, re-save, reload — assert the optional fields
  survive. Fails today.
- Typecheck asserts `ISessionStore` and `IInteractiveSessionStore` are one type (or the SPI split is
  documented).
- `pnpm harness:verify -- --scope packages/agent-session` green.

RED proof (2026-08-15):
`volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-session exec vitest run src/__tests__/session-record-field-preservation.test.ts`
failed 0/1 with exit code 1 on the pre-fix writer because `backgroundTasks` reloaded as `undefined`.

## Implementation Tasks

- [x] Update the canonical record/store contracts and both owning package specifications.
- [x] Add and prove RED the complete record-preservation and ownership-precedence regression test.
- [x] Make the Session persistence writer preservation-safe and remove local contract declarations.
- [x] Add the maintained public-SDK example, refresh its scenario record, and run the scenario gate.
- [x] Run focused package verification, scoped harness verification, and SPEC conformance.

## Verification Evidence

- Focused GREEN: the record-preservation test plus the affected existing session tests passed 36/36;
  the canonical interface contract suite passed 6/6. Full package suites passed 209/209 for
  `agent-session` and 43/43 for `agent-interface-transport`.
- Static/build gates: both affected package builds and typechecks passed. Lint completed with zero
  errors (32 existing warnings in `agent-interface-transport`, 51 existing warnings in
  `agent-session`). The SPEC public-surface scan, dependency-conformance scan, architecture-map
  completeness/path scans, and 86/86 package-SPEC coverage scan passed.
- SPEC → code: all ten documented assertions resolve to implementation or executable evidence:
  canonical record/store ownership, optional `getFilePath`, the file-backed adapter, preservation
  ordering, all 13 non-owned fields, all six mutable Session-owned projections, `createdAt`, public
  compatibility exports, the maintained scenario, and bounded cleanup.
- Code → SPEC: all eight changed public/architectural surfaces are documented: the canonical store
  method, `SessionStore` conformance, `ISessionOptions`, the Session store field, persistence writer,
  artifact APIs, public re-exports, and the example/script entrypoint.
- Scoped harness evidence is composite and change-complete. One full run passed the repository
  harness 3,364/3,364 and all build/test/typecheck/lint tiers, then stopped only on the old
  nondeterministic scenario-record hash. After replacing build-log capture with the deterministic
  source runner, direct record comparison returned exit 0 with no differences. The final full run
  passed 3,363/3,364 and stopped only because the unrelated branch-guard stalled-query timing test
  measured 86.331 s against its 40 s ceiling; immediate isolation passed 6/6 in 15.55 s, with that
  exact case completing in 10.517 s. No ARCH-015 source or scenario check failed.

## User Execution Test Scenarios

**Applies — this changes persistence behavior reachable through the public
`@robota-sdk/agent-session` SDK surface.**

### Scenario ARCH-015-S1 — a raw Session re-save preserves fields it does not own

- **Agent executability:** `agent-executable`. The public SDK example is deterministic,
  non-interactive, provider-key-free, and performs all setup and cleanup inside the process.
- **Surface choice:** preference level 1, a self-contained public-SDK observable. The maintained
  example imports `Session` and `SessionStore` through the package's public barrel, uses a
  deterministic offline provider, prints a JSON result to stdout, and exits non-zero when any
  contract assertion fails. No live credentials, external service, or private source import is
  needed.
- **Executability probe (2026-08-15):**
  `volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-session scenario:verify` was run before
  this scenario was written. The existing non-interactive example entry resolved, printed
  `sessions offline verify passed.`, and returned exit code `0`. A second probe imported `Session`
  and `SessionStore` from `./src/index.ts`, the package's public barrel, through the same package-local
  `tsx` runner; it printed `{"session":"function","sessionStore":"function"}` and returned exit code
  `0`. Together these prove the package-owned TypeScript example runner and required public exports
  are available; the new example is deliberately part of this backlog's implementation scope.
- **Prerequisites:** Node 22.14.0 through Volta and installed workspace dependencies. No provider
  credentials, environment variables, network service, seeded user files, or pre-existing session
  directory. The implementation adds the maintained standalone example
  `packages/agent-session/examples/verify-session-record-field-preservation.ts`
  <!-- allow-missing-artifact: ARCH-015 implementation scope creates this planned scenario artifact -->
  and appends it to the existing package `scenario:verify` script after `verify-offline.ts`, so the
  earlier offline smoke coverage is not replaced. `scenario:record` continues to capture both
  observables in the package-owned scenario record.
- **Fixture/setup performed by the example:** create a unique directory beneath the operating
  system temporary directory and construct a `SessionStore` for it. Pre-save one
  `IInteractiveSessionRecord` whose stale Session-owned values are distinct sentinels and whose
  complete current set of non-owned optional fields is populated: `name`, `backgroundTasks`,
  `backgroundTaskEvents`, `backgroundJobGroups`, `backgroundJobGroupEvents`,
  `skillActivationEvents`, `memoryEvents`, `usedMemoryReferences`, `contextReferences`,
  `sandboxSnapshotId`, `goal`, `plan`, and `activeBranch`. Give `createdAt` its own stable sentinel.
  Then construct a public `Session` with the same id and store, a different `cwd`, system prompt,
  and tool-schema state, plus a deterministic offline provider. Run one turn and await the real
  `Session.shutdown()` path so its production persistence writer re-saves the record; reload it
  through `SessionStore`.
- **Exact command:**

  ```bash
  volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-session scenario:verify
  ```

- **Expected observable:** exit code `0`. Existing stdout still contains
  `sessions offline verify passed.`. The new example then emits a JSON object containing all of the
  following values (object key order and whitespace are not contractual):

  ```json
  {
    "scenario": "ARCH-015",
    "provider": "arch-015-offline",
    "assistantResponse": "arch-015:preserve-record-fields",
    "preservedFields": [
      "name",
      "backgroundTasks",
      "backgroundTaskEvents",
      "backgroundJobGroups",
      "backgroundJobGroupEvents",
      "skillActivationEvents",
      "memoryEvents",
      "usedMemoryReferences",
      "contextReferences",
      "sandboxSnapshotId",
      "goal",
      "plan",
      "activeBranch"
    ],
    "preservedCount": 13,
    "createdAtPreserved": true,
    "sessionOwnedOverwrites": {
      "cwd": true,
      "updatedAt": true,
      "messages": true,
      "history": true,
      "systemPrompt": true,
      "toolSchemas": true
    },
    "cleanupRemoved": true
  }
  ```

  The example compares every populated non-owned field deeply against the pre-saved value. It also
  proves that preservation ordering did not allow stale record data to win: `cwd`, `updatedAt`,
  `messages`, `history`, `systemPrompt`, and `toolSchemas` must reflect live Session state after the
  run and shutdown. On the pre-fix implementation at least the preservation assertion fails and the
  command exits non-zero instead of printing the success JSON.

- **Cleanup/reset:** the example removes its unique scratch directory in `finally`, then observes
  the path is absent before it emits `"cleanupRemoved": true`. It neither reads nor mutates the
  default `~/.robota/sessions` directory.
- **Evidence (2026-08-15):** the exact command exited `0`, retained
  `sessions offline verify passed.`, and printed the expected ARCH-015 JSON with
  `preservedCount: 13`, `createdAtPreserved: true`, all six `sessionOwnedOverwrites` values `true`,
  and `cleanupRemoved: true`. A second captured execution compared against
  `packages/agent-session/examples/scenarios/offline-verify.record.json`: stdout SHA-256
  `c2fb090e67cfde0c7e074ea27148dcf5c7e109431a9b22b80d18a201af873d4a`, empty-stderr SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`, differences `[]`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario drafted → scenario written

- Ordering: PASS — `DONE-GATE-STAGE-1` is an entry gate with no predecessor. The worktree contains
  only this Task edit for ARCH-015; the planned example is absent, and the current
  `persistSession` still rebuilds the record without `...existing`, so no ARCH-015 implementation
  source edit preceded the scenario plan.
- Scenario `ARCH-015-S1`: PASS — it records the explicit `agent-executable` decision, Node/workspace
  prerequisites, provider-free temporary fixture setup, the exact Bash command, exit-code and
  stdout observables, bounded scratch-directory cleanup, and a separate pending evidence field for
  the post-implementation run.
- Public reachability: PASS — the scenario drives exported `Session` and `SessionStore` through the
  `@robota-sdk/agent-session` public barrel and awaits the production `Session.run()` plus
  `Session.shutdown()` persistence path. It does not substitute build, typecheck, lint, tests,
  harness/CI output, or repository-text inspection for the user-visible SDK result.
- Invocation and fixture readiness: PASS — the declared package-owned `scenario:verify` entrypoint
  was independently run on 2026-08-15 and exited `0` with `sessions offline verify passed.`; the
  missing maintained preservation example and script extension are explicitly included in this
  backlog's implementation scope, with an `allow-missing-artifact` marker at PLAN time.
- Expected observable and cleanup: PASS — the plan enumerates all 13 non-owned fields, the preserved
  `createdAt`, six live Session-owned overwrite checks, the deterministic provider response, exit
  `0`, retention of the existing smoke output, and `cleanupRemoved: true` after `finally` removes
  only the unique OS-temporary directory.
- Credentials and external services: PASS — the scenario explicitly states that it requires no
  credentials, environment variables, network service, seeded user files, or pre-existing session
  directory.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-15

**Status upgrade:** scenario written → scenario executed

- Ordering: PASS — `DONE-GATE-STAGE-1` has a recorded PASS, the Task remains `in-progress`, all five
  implementation tasks are checked, and the maintained example, record-preserving writer, and canonical
  store-port implementation are present in the completed worktree state.
- Direct execution: PASS — the guardian directly ran
  `volta run --node 22.14.0 pnpm --filter @robota-sdk/agent-session scenario:verify` against that state;
  it exited `0` and retained `sessions offline verify passed.`.
- Expected observable: PASS — the ARCH-015 JSON reported the `arch-015-offline` provider response, all
  13 named non-owned fields, `createdAtPreserved: true`, all six Session-owned overwrite flags as `true`,
  and `cleanupRemoved: true`, exactly matching Scenario `ARCH-015-S1`.
- Concrete durable evidence: PASS — the scenario evidence field records the command, exit code, observed
  values, and the maintained artifacts
  `packages/agent-session/examples/verify-session-record-field-preservation.ts` and
  `packages/agent-session/examples/scenarios/offline-verify.record.json`. An independent fresh comparison
  validated the record with differences `[]`, stdout SHA-256
  `c2fb090e67cfde0c7e074ea27148dcf5c7e109431a9b22b80d18a201af873d4a`, and empty-stderr SHA-256
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Cleanup: PASS — the example removed its unique OS-temporary directory before emitting
  `cleanupRemoved: true`; a post-run filesystem probe found no `arch-015-example-*` directory under the
  active Node temporary root.
- Evidence integrity: PASS — this verdict relies on the public-SDK scenario output and persisted scenario
  record, not build, test, lint, harness, CI, or static-inspection output. No capability-absence exception
  was claimed; the scenario is provider-key-free and fully agent-executable.

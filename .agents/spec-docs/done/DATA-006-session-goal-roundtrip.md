---
status: done
type: DATA
tags: [cli, typescript, async]
---

# DATA-006: Session `goal` survives the persistence round-trip (ARL-08)

## Problem

An in-flight autonomous `goal` (GOAL-001) is **silently lost on session resume**. In
`packages/agent-framework/src/interactive/session-persistence.ts`:

- `toSessionRecord(session) = { ...session }` spreads the full `IInteractiveSessionRecord` (including
  `goal`) into `ISessionRecord`, so `goal` **is** written to disk (via `SessionStore.save` →
  `JSON.stringify`).
- `fromSessionRecord(session)` rebuilds the typed record by **explicitly enumerating** each field
  (id, name, cwd, …, sandboxSnapshotId) and **omits `goal`** — so on load the goal is dropped.

Verified: `goal` appears nowhere in `fromSessionRecord` (`rg goal session-persistence.ts` → only absent).

### Root cause (the class, not just the instance)

`agent-session`'s storage-neutral `ISessionRecord` (opaque payloads) **re-enumerates the same field
list** as `agent-interface-transport`'s typed `IInteractiveSessionRecord`, and `fromSessionRecord` is a
hand-maintained field-by-field whitelist. A field added to `IInteractiveSessionRecord` (here `goal?:
IGoalState`) must be mirrored in **both** `ISessionRecord` and `fromSessionRecord`; `goal` was added to
the typed contract but not the storage contract/mapper. This dual-maintenance seam is the drift class —
the fix must make a _missed field fail loudly_, not just patch this one field. (The deeper question of
collapsing the two record contracts is tracked separately as ARL-09 — out of scope here.)

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/interactive/session-persistence.ts` — make `fromSessionRecord` a
  **structural mirror** of `toSessionRecord` (`{ ...session } as unknown as IInteractiveSessionRecord`),
  deleting the per-field whitelist; drop the imports that become dead.
- `packages/agent-session/src/session-store.ts` — add `goal?: unknown` to `ISessionRecord` (opaque,
  storage-neutral — matching how `messages`/`backgroundTasks`/… are `unknown`; contract-honesty, the
  `agent-session → agent-interface-transport` edge already exists).
- `packages/agent-framework/src/interactive/__tests__/` — NEW JSON round-trip integrity + regression test.
- **Out of scope:** the replay-log path (`loadFromReplayLog`) hand-builds a record from JSONL _events_, a
  different (event-derived) mechanism — `goal` is not a logged session event, so it is intentionally
  unaffected; this fix targets the `SessionStore` JSON record path.

### Alternatives Considered

1. **Patch only: add `goal` to the `fromSessionRecord` whitelist.** Fixes this instance but keeps the
   hand-enumerated read path — the next field added to `IInteractiveSessionRecord` drops again, silently.
   Rejected (proper-foundation rule): it preserves the drift-prone construct.
2. **Patch + a `Required<IInteractiveSessionRecord>` round-trip test guarding the whitelist.** Keeps the
   enumeration and bolts a test onto it. Rejected: the test does not make drift _structurally_ impossible
   (a future author can satisfy the compile-forced fixture yet still forget to map the field — caught only
   at test-run), and it is _more_ code than option 3 while less correct.
3. **Make the read path structural, symmetric with the write path (chosen).** `toSessionRecord` is already
   `{ ...session }` (drift-proof); make `fromSessionRecord` its mirror —
   `return { ...session } as unknown as IInteractiveSessionRecord;` — deleting the whitelist entirely.
   The persisted record already carries every field (the write path spreads them), so the spread restores
   **all** of them (incl. `goal`) with nothing left to enumerate → a dropped-field regression becomes
   **structurally impossible**. Smaller than options 1–2, keeps the two contracts separate, does not
   pre-empt ARL-09. The whitelist performed only `as`-narrowing (no runtime validation — verified), so no
   validation is lost. Add `goal?: unknown` to `ISessionRecord` so the storage contract honestly mirrors
   what is persisted, and keep a save→load deep-equal test as **JSON round-trip integrity + regression**
   coverage (not the primary drift defense — the structural mapper is).
4. **Collapse the two record contracts / derive the mapping (ARL-09).** A genuine architecture decision:
   `cross-cutting-contracts.md` affirms the storage-neutral-vs-typed split as intentional, and hosting
   `SessionStore` in the runtime-free `agent-interface-transport` is forbidden (`scan-interface-runtime`).
   Deferred to ARL-09 as a separate gated decision item; not required to fix this correctness bug.

### Decision

**Alternative 3.** Restore every field on load by making `fromSessionRecord` a structural mirror of
`toSessionRecord` (`{ ...session } as unknown as IInteractiveSessionRecord`), which fixes the missed-field
drift **class** structurally (not just the `goal` instance) and is the smallest correct change. Add
`goal?: unknown` to `ISessionRecord` for contract honesty (opaque-payload posture — the
`agent-session → agent-interface-transport` dependency edge already exists, so this is not about avoiding a
dependency). Keep a full-field save→load deep-equal test as JSON-integrity + regression coverage. Defer the
ARL-09 contract-unification decision. Consumer effectiveness confirmed: `interactive-session-restore.ts`
and `interactive-session.ts` restore `record.goal` into the goal controller on resume.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-session (storage contract), agent-framework (mapper + test)
- [x] Sibling scan 완료 — `fromSessionRecord` field whitelist vs `IInteractiveSessionRecord`; `ISessionRecord` opaque-field pattern
- [x] 대안 최소 2개 검토 완료 — 4개 (patch-only / whitelist+Required test / structural mirror / contract-collapse)
- [x] 결정 근거 문서화 완료 — fix the drift class via a structural mirror (drift structurally impossible); defer ARL-09

## Solution

1. `fromSessionRecord`: replace the hand-enumerated whitelist with the structural mirror of
   `toSessionRecord` — `return { ...session } as unknown as IInteractiveSessionRecord;`. The `as unknown as`
   is required because `ISessionRecord` types payloads as `unknown[]`; the spread copies every persisted
   runtime field (incl. `goal`) with nothing left to omit. Remove the now-unused per-field type imports if
   they become dead.
2. `ISessionRecord`: add `goal?: unknown;` so the storage contract mirrors what is persisted (opaque,
   consistent with `messages`/`backgroundTasks`/… being `unknown`). Not strictly required by the structural
   cast, but keeps `ISessionRecord` an honest description of the on-disk shape.
3. NEW test `session-persistence-roundtrip.test.ts`: build a fixture typed `Required<IInteractiveSessionRecord>`
   (every field present, all values **non-`undefined` and JSON-stable** — no `Date`/`Map`/`undefined`-in-array),
   `goal` populated; persist + reload via the exported `createProjectSessionStore` factory against an `fs.mkdtempSync` temp dir
   (real `SessionStore`); assert the loaded record **deep-equals** the fixture. RED on current `main` (goal
   dropped), GREEN after (1). Purpose: JSON round-trip integrity + regression coverage. (The `Required<>`
   fixture is belt-and-suspenders — it forces the fixture to enumerate every field so the test exercises the
   whole surface; the structural mapper, not the test, is what makes drift impossible.)

## Affected Files

- `packages/agent-framework/src/interactive/session-persistence.ts` (`fromSessionRecord` → structural mirror; drop dead per-field imports)
- `packages/agent-session/src/session-store.ts` (`ISessionRecord.goal?: unknown` — contract honesty)
- `packages/agent-framework/src/interactive/__tests__/session-persistence-roundtrip.test.ts` (NEW)
- SPEC updates: `packages/agent-session/docs/SPEC.md` (ISessionRecord gains `goal`), `packages/agent-framework/docs/SPEC.md` (structural round-trip note) if they enumerate the field list.
- `.changeset/*.md` (agent-session + agent-framework — bug fix, patch).

## Completion Criteria

- [ ] TC-01: a session with a populated `goal` saved then loaded via `IInteractiveSessionStore` returns the identical `goal` — RED on current `main`, GREEN after the structural mapper.
- [ ] TC-02: full-field round-trip — a `Required<IInteractiveSessionRecord>` fixture (every field non-`undefined`, JSON-stable) deep-equals itself after save→load through the exported `createProjectSessionStore` factory (temp dir).
- [ ] TC-03: `fromSessionRecord` contains no per-field whitelist (structural spread only) — verified by reading the function; a dropped-field regression is structurally impossible, not test-dependent.
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-session build + typecheck + test` green; full-repo `pnpm typecheck`; `pnpm harness:scan` exit 0; a changeset for both packages (patch).

## Test Plan

RED→GREEN: the new `session-persistence-roundtrip.test.ts` asserts a full-field `IInteractiveSessionRecord`
survives save→load; it fails on current `main` (goal dropped) and passes after the structural mapper. The
**structural mirror** (`{ ...session } as unknown as IInteractiveSessionRecord`) — not the test — is what makes
missed-field drift impossible; the `Required<IInteractiveSessionRecord>` fixture is belt-and-suspenders that
forces the test to exercise every field, and the deep-equal asserts JSON round-trip integrity. Gate via the
standard flow + `merge-verifier`; resolve ARL-08 in `.agents/architecture-remediation-log.md` on land.

## Tasks

- [ ] 미생성 — GATE-APPROVAL 후 생성.

## Evidence Log

- 2026-07-08 GATE-APPROVAL round 1 — proposal-reviewer REVISE→resolved. Confirmed the bug + all premises
  against code (incl. consumer restores `record.goal` on resume). Corrected: the fix should make
  `fromSessionRecord` **structural** (`{...session} as unknown as IInteractiveSessionRecord`), deleting the
  whitelist so drift is _structurally_ impossible (smaller + more correct than the `Required<>`-test-guarded
  whitelist); `goal?: unknown` on `ISessionRecord` is for opaque-payload posture, not dependency avoidance
  (the edge already exists); the round-trip test is JSON-integrity/regression, not the primary drift guard.
  ARL-09 (contract collapse) correctly deferred. Reflected in Alternatives 3 (chosen), Decision, Solution.
- 2026-07-08 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE (design)** + REVISE (doc-consistency only):
  confirmed the structural mirror is sound, the whitelist's `as`-narrowing is NOT load-bearing (bare casts,
  no runtime validation; `JSON.parse` never yields `undefined` keys so blanket-cast equivalence holds), the
  double-assertion is honest at the `unknown[]` trust boundary, and the ARL-09 deferral is justified. Required
  only a scrub of stale round-1 text (Test Plan/Affected Scope/checklist calling the `Required<>` test "the
  drift guard"; `ProjectSessionStoreFacade`→`createProjectSessionStore`; note replay-log is a different,
  out-of-scope mechanism). All scrubbed → "clean ENDORSE". Approved → implement.
- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — `fromSessionRecord` → structural mirror
  (`{ ...session } as unknown as IInteractiveSessionRecord`); 4 dead per-field imports removed;
  `ISessionRecord.goal?: unknown` added; agent-session SPEC `goal` row added; changeset (both packages,
  patch). NEW `session-persistence-roundtrip.test.ts`: TC-01 (goal survives) + TC-02 (full-field deep-equal).
  **TDD RED→GREEN proven**: without the fix TC-01 fails `expected undefined to deeply equal { id: 'goal_1' }`
  (goal dropped); with the structural mirror 2/2 pass. Verified: agent-session 86/86, agent-framework
  1045/1045, full-repo `pnpm typecheck` exit 0, `pnpm harness:scan` exit 0. Test fixture uses JSON-stable
  values (message `Date` timestamp is an out-of-scope payload-serialization detail). ARL-08 → Resolved. DONE.

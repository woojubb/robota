---
status: done
type: BEHAVIOR
tags: [cli, typescript, react]
---

# CLI-B11: Session-switch context restoration — regression test suite

## Problem

The session-switch context-loss bug (fixed 2026-05-31 via the `createChannel` factory patch,
INFRA-001) had no regression tests at the layer where it actually lived. The verification
script written during the fix (`real-resume-verify-v3.mjs`) instantiated `InteractiveSession`
directly — but the bug was one layer up:

```
render.tsx  → TuiInteractionChannel created without resumeSessionId
App.tsx     → onSessionSwitch only called setActiveSessionId; channel reused as-is
AppInner    → remounted with the SAME channel → no InteractiveSession restore → Context: 0%
```

Reproduction (pre-fix): `/resume` → pick a session with messages → status bar shows
`Context: 0% (0K/1M tokens)` instead of the real usage. An `InteractiveSession`-level test
passes throughout and never detects the `render.tsx ↔ App.tsx ↔ TuiInteractionChannel`
boundary bug. Today (post-fix, verified 2026-06-13 on develop) `App.tsx:57-84` holds
`{channel, sessionId}` in React state and `onSessionSwitch` creates a new channel via the
injected factory — but no test pins any of this, so the exact same regression can return
silently.

## Architecture Review

### Affected Scope

- `packages/agent-transport` / `src/tui/__tests__/session-switch-channel.test.tsx` (new) —
  React-layer tests of `App` session-switch handling with a mocked `createChannel`
- `packages/agent-transport` / `src/tui/__tests__/channel-factory-integration.test.ts`
  (new) — real `createChannel(sessionId)` against a real `FileSessionStore` + `Session`,
  asserting restored context tokens > 0 (the official CI equivalent of
  `real-resume-verify-v3.mjs`)
- `packages/agent-transport` / `docs/SPEC.md` — Test Strategy section row for the new suites
- No production code changes. `TuiInteractionChannel` stays unexported (tests are
  in-package and import via relative path).

### Alternatives Considered

1. **In-package tests at the App/factory boundary with mock factory + one real-store
   integration test (chosen).**
   - Pro: tests live exactly at the layer that broke; mock factory verifies call
     count/arguments (TC-A/C/D/E) while the integration test verifies real restored context
     (TC-B); no public-surface expansion (orphan-export scan stays clean).
   - Con: React/ink component testing needs `ink-testing-library` render plumbing — more
     setup than plain unit tests.
2. **Export `TuiInteractionChannel` from the package index and test from outside.**
   - Pro: any package could exercise the channel directly.
   - Con: expands the public surface for test convenience only (violates the
     orphan-export/no-pass-through direction); unnecessary — vitest runs inside the package
     and relative imports already reach the class.
3. **PTY end-to-end test only (`/resume` through the real binary).**
   - Pro: highest fidelity, exercises the full stack.
   - Con: cannot inject a mock factory, so call-count/argument assertions (TC-A/C/E) are
     impossible; PTY suites are slow and run outside the default CI test pass — a
     regression would be caught late or not at all.

### Decision

Alternative 1. The driving trade-off is layer fidelity vs surface cost: the bug lived at the
React/factory boundary, so the tests must observe factory calls and channel identity there,
and the one real-store integration test covers the restoration substance — all without
exporting internals. PTY coverage already exists separately (CLI-074) for boot/slash paths
and is not duplicated here. Note: TC-D pins today's no-factory fallback (`props.channel`
used as-is); CLI-B12 (Option A) will make the factory mandatory and supersede TC-D in its
own spec.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `src/tui/__tests__/` 기존 스위트 확인: `App` 렌더 테스트 전무,
      채널 관련은 `TuiInteractionChannel` 단위 동작만 존재; `render.tsx:83-116`(팩토리 생성
      및 주입), `App.tsx:57-84`(sessionState + onSessionSwitch + `void oldChannel.stop()`),
      `AppInner` `useEffect`(:167-172, channel.start/stop) 모두 무테스트 확인
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Solution

1. `session-switch-channel.test.tsx` (ink-testing-library, mock `createChannel`):
   - TC-A: trigger a session switch → `createChannel` called exactly once with the selected
     sessionId.
   - TC-C: the previous channel's `stop()` called exactly once.
   - TC-D: render without `createChannel` → existing `props.channel` is used and no crash
     (pins today's fallback until CLI-B12).
   - TC-E: consecutive switches A→B→C → one new channel per switch, each prior channel
     stopped, latest channel is the active one.
2. `channel-factory-integration.test.ts` (no mocks): build a real `FileSessionStore` in a
   temp dir, persist a session with messages, call the real `createChannel(sessionId)` path
   used by `render.tsx`, then assert
   `channel.interactiveSession.getContextState().usedTokens > 0` (TC-B).
3. Add the two suites to `packages/agent-transport/docs/SPEC.md` Test Strategy.

## Affected Files

- `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` (new)
- `packages/agent-transport/src/tui/__tests__/channel-factory-integration.test.ts` (new)
- `packages/agent-transport/docs/SPEC.md`

## Completion Criteria

- [x] TC-01 (=TC-A): session switch from the picker calls `createChannel` exactly once with
      the selected sessionId (mock factory assertion)
- [x] TC-02 (=TC-B): real-store integration — `createChannel(sessionId)` over a persisted
      session yields `getContextState().usedTokens > 0` (no mocks)
- [x] TC-03 (=TC-C): on switch, the previous channel's `stop()` is invoked and the new
      channel is started; the new (active) channel is never stopped. _Correction during
      implementation (within the approved Decision): the draft said "exactly once", but the
      released old channel receives `stop()` from BOTH the switch handler
      (`void oldChannel.stop()`) and the unmounting `AppInner`'s effect cleanup —
      `TuiInteractionChannel.stop()` is idempotent by contract (lifecycle suite). The
      resource-release contract is "stopped and never restarted", not a single invocation;
      the test asserts stop invoked on the old channel, start on the new, and no stop on
      the active channel._
- [x] TC-04 (=TC-D): rendering without a `createChannel` prop uses `props.channel` and does
      not crash (current fallback pinned; superseded by CLI-B12)
- [x] TC-05 (=TC-E): consecutive switches A→B→C create one new channel per switch, stop each
      prior channel, and the latest channel is active
- [x] TC-06: `pnpm --filter @robota-sdk/agent-transport test` passes with the new suites
      included; `docs/SPEC.md` Test Strategy lists both files

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                        | Notes                                                                                                                                                                                                                                                                                                                |
| ----- | ----------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | unit        | vitest + ink-testing-library, mock `createChannel` injection           | Test: `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` > `App session-switch channel ownership (CLI-B11)` > `TC-01: selecting a session in the picker calls createChannel exactly once with that sessionId`                                                                              |
| TC-02 | integration | vitest, real `FileSessionStore`/`Session` in temp dir, real factory    | Test: `packages/agent-transport/src/tui/__tests__/channel-factory-integration.test.ts` > `channel factory restores persisted context (CLI-B11 TC-02)` > `createChannel(sessionId) over a real FileSessionStore yields usedTokens > 0` (+ empty-context control test in same describe)                                |
| TC-03 | unit        | vitest, mock channel with spied `stop()`                               | Test: `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` > `App session-switch channel ownership (CLI-B11)` > `TC-03: the previous channel is stopped on switch and the new channel is started` (per in-Decision correction: old stopped — idempotent — new started, active never stopped) |
| TC-04 | unit        | vitest, render `App` without factory prop                              | Test: `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` > `App session-switch channel ownership (CLI-B11)` > `TC-04: without a createChannel prop, the switch falls back to props.channel and does not crash` — pins current fallback until CLI-B12                                       |
| TC-05 | unit        | vitest, three sequential switch triggers                               | Test: `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` > `App session-switch channel ownership (CLI-B11)` > `TC-05: consecutive switches A→B→C create one channel per switch and stop each prior channel`                                                                                |
| TC-06 | integration | `pnpm --filter @robota-sdk/agent-transport test` + SPEC.md direct read | Suite-level: full package run, 61 files / 473 tests green (2026-06-13). Doc-row half verified manually by direct read of `packages/agent-transport/docs/SPEC.md` Test Strategy lines 279–283 listing both new test files (manual read — a doc-presence check, not automatable as a unit test)                        |

## Tasks

- [x] `.agents/tasks/completed/CLI-B11.md` — archived at GATE-COMPLETE (T1~T7 complete, TC-01~TC-06 매핑)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-13

**Status upgrade:** draft → review-ready

- Frontmatter: file begins with `---` YAML block; `status: draft` present; `type: BEHAVIOR` is one of the 11 allowed prefixes; `tags: [cli, typescript, react]` present.
- Problem — concrete symptom: status bar shows `Context: 0% (0K/1M tokens)` instead of real usage after session switch.
- Problem — reproduction condition: `/resume` → pick a session with messages (pre-fix); layer chain `render.tsx → App.tsx → AppInner` documented.
- Problem — no "TBD"/"TODO" or vague single-sentence description found.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with completion evidence (existing `src/tui/__tests__/` suites reviewed; `render.tsx:83-116`, `App.tsx:57-84`, `AppInner` useEffect confirmed untested).
- Alternatives Considered: 3 entries (in-package mock+integration, export `TuiInteractionChannel`, PTY-only e2e), each with pro and con.
- Decision: references the driving trade-off (layer fidelity vs public-surface cost) and chooses Alternative 1.
- Completion Criteria: 6 items, all prefixed TC-01…TC-06; each uses command form or observable behavior (mock call-count assertions, `usedTokens > 0`, `pnpm --filter @robota-sdk/agent-transport test`); no banned vague phrases ("works correctly", "no errors", "implemented", "displays correctly") present.
- Test Plan: section present; 6 rows = 6 TC-N in Completion Criteria (count matches); every row has non-empty Test Type and Tool/Approach with no "TBD"; no rows use "manual" Tool, so the manual-Notes requirement is N/A.
- Structure: `## Tasks` section present with placeholder (`.agents/tasks/CLI-B11.md` — 미생성); `## Evidence Log` present and empty at first GATE-WRITE run; no `## Status` or `## Classification` sections in the body.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-13

**Status upgrade:** review-ready → approved

- Explicit approval in current conversation: user replied exactly "승인함" (2026-06-13) after the consolidated approval request "## 설계안 요약 (승인 요청) — 백로그 일괄 11건", which individually summarized this spec's design (mock `createChannel` injection for TC-A~E, real-FileSessionStore integration test asserting restored `usedTokens > 0`, no `TuiInteractionChannel` export, test-only addition).
- Direct, unambiguous, directed at this spec: the approval request explicitly stated that replying authorizes GATE-APPROVAL → per-item implementation for the 11 listed designs including CLI-B11; the user was told verbatim that "승인함" authorizes implementation and then replied "승인함". The earlier release instruction ("머지하고 main 릴리스 진행해줘") was correctly not treated as design approval.
- No Architecture Review or frontmatter type/tags modified after the approval request: only post-GATE-WRITE changes were the guard's Evidence Log entry, the frontmatter status upgrade draft → review-ready, and prettier formatting (commit cd5b1053a, docs-only spec additions per `git show --stat`).
- No implementation started before this gate: `.agents/tasks/CLI-B11.md` does not exist; `packages/agent-transport/src/tui/__tests__/session-switch-channel.test.tsx` and `channel-factory-integration.test.ts` do not exist; `git status --porcelain` shows no changes under `packages/agent-transport` or `.agents/tasks`; no commits touching `packages/agent-transport/src/tui/__tests__/` since CLI-074 (5dc0c9649).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-13

**Status upgrade:** approved → in-progress

- Tasks file created: `.agents/tasks/CLI-B11.md` exists (verified via `ls`, 1978 bytes, created 2026-06-13).
- Tasks file path recorded in `## Tasks` section of this spec: `.agents/tasks/CLI-B11.md` — T1~T7 (TC-01~TC-06 매핑 + wrap-up).
- Tasks correspond to Completion Criteria — one task per TC-N: T1↔TC-01 (mock `createChannel` call-count/argument via real `SessionPicker` switch), T2↔TC-02 (real `FileSessionStore` integration, `usedTokens > 0`), T3↔TC-03 (previous channel `stop()` exactly once), T4↔TC-04 (no-factory fallback to `props.channel`, no crash), T5↔TC-05 (A→B→C consecutive switches, per-switch factory/stop bookkeeping), T6↔TC-06 (full package test green + SPEC.md Test Strategy rows); T7 is wrap-up (typecheck/lint/build, PR, backlog evidence) — all 6 TC-N covered.
- NON-COMPLIANCE check (implementation commits without tasks file): negative — neither test file exists yet; `git status --porcelain` shows only spec/tasks/evals doc changes (no `packages/agent-transport` changes); recent commits (949e8af5d, 9b999b950, cd5b1053a) are docs/evals only.

### [GATE-VERIFY] — ✅ PASS | 2026-06-13

**Status upgrade:** in-progress → verifying

- All tasks complete: `.agents/tasks/CLI-B11.md` T1–T6 `[x]`. T7 (wrap-up: PR merge + backlog completed/) unchecked but every component independently verified per the established CLI-063/064/065/066 GATE-VERIFY interpretation: PR #706 OPEN (`feat/cli-b11-session-switch-tests` → `develop`, "test(transport): session-switch channel regression suite (CLI-B11)") with all CI checks green on `gh pr checks 706` — build pass (1m24s), quality pass (49s), security audit pass, Cloudflare Pages pass; compat-node18 and release-grade verification report "skipping" by workflow design on feature PRs; backlog evidence recorded in `.agents/backlog/completed/CLI-B11-session-switch-context-restoration-tests.md` (frontmatter `status: done`; real-binary PTY `/resume` evidence 2026-06-13: boot `Context: 0%` → first select `Context: 6% (11.9K/200K)` → second select `Context: 16% (31.8K/200K)`).
- No tasks blocked or pending: tasks file contains no blocked markers; only T7 wrap-up remains open as adjudicated above. The TC-03 "exactly once" → "stopped and never restarted" wording is a documented in-Decision correction in this spec (italic note, resource-release contract — stop() idempotent by lifecycle contract), mirrored in T3; within the approved Decision per the CLI-066 correction-note precedent, not a blocked/divergent task.
- Build passes: `pnpm --filter @robota-sdk/agent-transport build` fresh-run this gate — "Build complete in 758ms" (38 files, 481.52 kB), exit 0.
- Tests pass: `pnpm --filter @robota-sdk/agent-transport test` fresh-run this gate — **61 files passed / 473 tests passed**, 0 failures, including both new suites: `src/tui/__tests__/session-switch-channel.test.tsx` (4 tests ✓) and `src/tui/__tests__/channel-factory-integration.test.ts` (2 tests ✓). Both files exist on disk and `docs/SPEC.md` Test Strategy lists both (lines 279–281), matching TC-06's doc-row requirement.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-06-13

- Checkbox: TC-01 `[x]` in Completion Criteria.
- Command: `npx vitest run src/tui/__tests__/session-switch-channel.test.tsx` (cwd `packages/agent-transport`), fresh-run this gate.
- Observed: `✓ App session-switch channel ownership (CLI-B11) > TC-01: selecting a session in the picker calls createChannel exactly once with that sessionId 1059ms`; suite total 4/4 passed. Exit code 0.
- Test reference recorded in Test Plan: `session-switch-channel.test.tsx` > `App session-switch channel ownership (CLI-B11)` > TC-01 test.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-06-13

- Checkbox: TC-02 `[x]` in Completion Criteria.
- Command: `npx vitest run src/tui/__tests__/channel-factory-integration.test.ts` (cwd `packages/agent-transport`), fresh-run this gate.
- Observed: `✓ src/tui/__tests__/channel-factory-integration.test.ts (2 tests) 110ms` — `describe('channel factory restores persisted context (CLI-B11 TC-02)')` containing `it('createChannel(sessionId) over a real FileSessionStore yields usedTokens > 0')` and the control `it('a channel created WITHOUT resumeSessionId starts with an empty context (control)')` (test names confirmed at file lines 58/72/108). 2/2 passed. Exit code 0. No mocks — real `FileSessionStore`/`Session`.
- Test reference recorded in Test Plan.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-06-13

- Checkbox: TC-03 `[x]` in Completion Criteria, with the documented in-Decision correction (old channel stopped — `stop()` idempotent, invoked by both the switch handler and AppInner effect cleanup — new channel started, active channel never stopped; resource-release contract instead of literal exactly-once).
- Command: same `session-switch-channel.test.tsx` run as TC-01.
- Observed: `✓ App session-switch channel ownership (CLI-B11) > TC-03: the previous channel is stopped on switch and the new channel is started 988ms`. Exit code 0.
- Test reference recorded in Test Plan, including the correction note.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-06-13

- Checkbox: TC-04 `[x]` in Completion Criteria.
- Command: same `session-switch-channel.test.tsx` run as TC-01.
- Observed: `✓ App session-switch channel ownership (CLI-B11) > TC-04: without a createChannel prop, the switch falls back to props.channel and does not crash 993ms`. Exit code 0. Pins the current fallback until CLI-B12 supersedes it.
- Test reference recorded in Test Plan.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-06-13

- Checkbox: TC-05 `[x]` in Completion Criteria.
- Command: same `session-switch-channel.test.tsx` run as TC-01.
- Observed: `✓ App session-switch channel ownership (CLI-B11) > TC-05: consecutive switches A→B→C create one channel per switch and stop each prior channel 2678ms`. Exit code 0.
- Test reference recorded in Test Plan.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-06-13

- Checkbox: TC-06 `[x]` in Completion Criteria.
- Command (suite half): `pnpm --filter @robota-sdk/agent-transport test`, fresh-run this gate — **Test Files 61 passed (61), Tests 473 passed (473)**, duration 30.49s, exit code 0; both new suites included and green (session-switch 4 ✓, channel-factory-integration 2 ✓).
- Doc-row half (manual read): `packages/agent-transport/docs/SPEC.md` Test Strategy, lines 279–283 read directly this gate — bullet "Session-switch channel ownership (CLI-B11)" lists `src/tui/__tests__/session-switch-channel.test.tsx` (real `App` + mocked `createChannel` factory) and `src/tui/__tests__/channel-factory-integration.test.ts` (real `toChannelOptions`/`TuiInteractionChannel` path, `usedTokens > 0`). Skip reason for automation: doc-presence check, verified by direct read.
- Test Plan row records the suite run + the manual doc-read with reason.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-13

**Status upgrade:** verifying → done

- Completion Criteria: all 6 TC-N checkboxes `[x]` (TC-01…TC-06), each with a matching `[GATE-COMPLETE: TC-N]` evidence entry above containing command, observed output, and exit code — all fresh-run 2026-06-13.
- Test Plan: all 6 rows updated with test file + describe/test references (TC-01…TC-05) or suite run + explicit manual-read reason (TC-06 doc-row half). No TC-N silently unaddressed.
- Tasks file archived: `.agents/tasks/completed/CLI-B11.md` exists (2694 bytes); active path `.agents/tasks/CLI-B11.md` no longer exists; archived file shows T1–T7 all `[x]` (T7 wrap-up closed: PR merged, backlog completed).
- `## Tasks` section points at the archived path `.agents/tasks/completed/CLI-B11.md`.
- User-execution corroboration (done-gate): `.agents/backlog/completed/CLI-B11-session-switch-context-restoration-tests.md` frontmatter `status: done` with real-binary PTY `/resume` evidence — boot `Context: 0% (0K/200K)` → first select `Context: 6% (11.9K/200K)` → second select `Context: 16% (31.8K/200K)` (file lines 107–128, verified by grep this gate).

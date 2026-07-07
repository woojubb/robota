---
status: done
type: INFRA
tags: [cli, async]
---

# INFRA-026: TUI PTY e2e teardown race (ENOTEMPTY on rmSync)

## Problem

The TUI PTY e2e suite (`packages/agent-transport-tui`, `test:pty`) flakes at test
**teardown**, not on any behavior assertion. Observed on PR #969 CI (job 85193039688):

```
FAIL src/__tests__/pty/flag-tui.ptytest.ts > ... --permission-mode acceptEdits ...
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/robota-flagtui-XUHcOB/.robota'
  ❯ src/__tests__/pty/flag-tui.ptytest.ts:32:5   rmSync(projectDir, { recursive: true, force: true })
```

Root cause: the `afterEach` kills the PTY session and immediately removes the temp project dir:

```ts
afterEach(() => {
  session?.kill(); // pty-driver kill() → session.dispose() (sync; does NOT await child exit)
  rmSync(projectDir, { recursive: true, force: true }); // races the dying child still writing <projectDir>/.robota
});
```

`kill()` (in `pty-driver.ts`, `kill: () => session.dispose()`) signals the PTY child but does
not await its exit. The booted `robota` binary persists settings/session into
`<projectDir>/.robota`; if a write lands between `rmSync`'s internal `readdir` and `rmdir`, the
`rmdir` sees a non-empty `.robota` and throws `ENOTEMPTY`. `force: true` suppresses `ENOENT`, not
`ENOTEMPTY`. The failure is non-deterministic (a race), confirmed flaky: the same commit passed on
a zero-change CI re-run, and the suite passed on PRs #965–#968 with the same TUI code.

This is a shared-teardown pattern — other `*.ptytest.ts` files use the same `kill()` + `rmSync`
sequence, so the flake can surface in any PTY test, not just `flag-tui`.

## Architecture Review

### Affected Scope

- `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts` — the shared PTY session driver
  (`IPtySession.kill()` → `dispose()`); candidate for an awaitable exit / async dispose.
- `packages/agent-transport-tui/src/__tests__/pty/*.ptytest.ts` — the `afterEach` teardown pattern
  (`flag-tui`, and any sibling using `kill()` + `rmSync`).

### Alternatives Considered

1. **Await child exit before `rmSync` (preferred).** Add an awaitable exit to the driver (resolve on
   the pty `onExit`) and `await session.disposeAsync()` (or `waitForExit()`) in `afterEach` before
   removing the dir. Pro: removes the race at its source; benefits every PTY test via the shared
   driver. Con: teardown becomes async (trivial — vitest `afterEach` supports async).
2. **Retry `rmSync` on `ENOTEMPTY`.** Wrap removal in a short bounded retry loop. Pro: minimal,
   localized. Con: treats the symptom, not the race; masks a real "child still alive after kill".
3. **Do both — await exit + a defensive bounded `ENOTEMPTY` retry.** _(Rejected — see Decision: the retry
   is an implicit fallback the root fix makes redundant; No-Fallback Policy.)_ Pro: robust; the retry covers
   any residual OS-level lag after exit. Con: masks a real "child alive after kill".

### Decision

**Alternative 1 only — await true child exit before `rmSync`; NO defensive retry.** The `ENOTEMPTY`
retry (Alt 3) is rejected: it violates the No-Fallback Policy (`operational.md:8,12` — "a single, correct,
verifiable path"; retry only "through an explicit policy gate, never as an implicit fallback") and
`verification.md:59` (race-condition / silent-fallback prohibition). Once the writer process has fully
exited its `.robota` writes are flushed and descriptors closed, so awaiting exit removes the race at its
source — the retry would only ever fire on a genuine "child still alive after kill" or a grandchild
outliving the PTY leader, both of which must fail loudly (or be fixed with a process-tree kill), not be
papered over.

**Factual correction (from GATE-APPROVAL review):** the awaitable exit this item needs already exists —
`IPtyRunSession.expectExit(timeoutMs): Promise<number>` (`packages/agent-testing/src/pty/spawn-pty.ts:157-166`,
backed by `pty.onExit`), and it is already re-exposed on the driver's `IPtySession` (`pty-driver.ts:41,105`)
and used mid-test at `tui-pty.ptytest.ts:62`. The gap is NOT a missing primitive — it is that `afterEach`
calls `kill()` (sync `dispose()`) and never awaits the existing exit signal before `rmSync`. So the fix is a
combined awaitable teardown on the driver, not a new exit primitive.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — all `packages/agent-transport-tui/src/__tests__/pty/*.ptytest.ts` share the `kill()` + `rmSync` teardown; fix belongs in the shared `pty-driver.ts`
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 — Alternative 1 only (await real exit; retry rejected per No-Fallback); awaitable exit already exists (`expectExit`), fix is a combined `disposeAsync()`

## Solution

Add a combined awaitable teardown to the shared driver — `disposeAsync(): Promise<void>` that runs
`session.dispose()` (existing sync kill: SIGTERM + 2s→SIGKILL grace) then `await session.expectExit(timeout)`
with `timeout ≥` the SIGTERM→SIGKILL grace, **propagating `expectExit`'s throw on non-exit** (so a child that
refuses to die fails the test loudly instead of being silently retried). Make each `*.ptytest.ts` `afterEach`
async and `await session?.disposeAsync()` before `rmSync(projectDir, ...)`. No `ENOTEMPTY` retry. No
production code changes — test infrastructure only. (If a stress run reveals a grandchild outliving the PTY
leader, the correct escalation is a process-tree kill — the CORE-023 `killProcessTree` pattern the driver
already references at `spawn-pty.ts:174` — not a retry.)

## Affected Files

- `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts` (add `disposeAsync()` combining
  `dispose()` + existing `expectExit()`)
- `packages/agent-transport-tui/src/__tests__/pty/*.ptytest.ts` — all 8 teardowns become `async` and
  `await session?.disposeAsync()` before `rmSync` (`flag-tui`, `tui-pty`, `replay-conversation`,
  `provider-setup`, `ask-user-question`, `background-work-switcher`, `screen-010-scrollback`,
  `terminal-handoff`)

## Completion Criteria

- [ ] TC-01: The shared driver's `disposeAsync()` awaits **actual child exit** (composes the existing
      `expectExit()` after `dispose()`) and propagates the timeout throw on non-exit. (Not "expose an
      awaitable exit" — `expectExit()` already exists; TC asserts the combined teardown awaits exit.)
- [ ] TC-02: all 8 `*.ptytest.ts` `afterEach` blocks `await session?.disposeAsync()` before `rmSync`; a
      stress run repeating the previously-flaky `flag-tui` case N≥20× locally shows 0 `ENOTEMPTY` failures.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0 (CI `tui-e2e` green).
- [ ] TC-04: no `ENOTEMPTY`/`rmSync` retry loop introduced (No-Fallback compliance — verified by grep).

## Test Plan

INFRA (test-infra reliability) — the deliverable is a reliably-green PTY e2e suite; verified by a
local repeat-run stress check plus the CI `tui-e2e` job. The root fix (await real exit) removes the race at
source; no retry masks it.

| TC-ID | Test Type         | Tool / Approach                                                                                        | Notes                            |
| ----- | ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------- |
| TC-01 | Unit (driver)     | vitest — assert `disposeAsync()` resolves only after child exit and rejects on non-exit within timeout | Composes existing `expectExit()` |
| TC-02 | Integration (PTY) | vitest — loop the `flag-tui` PTY test ≥20× (or a seeded stress harness), assert no `ENOTEMPTY`         | All 8 teardowns awaited          |
| TC-03 | CI smoke          | `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0 (CI `tui-e2e`)                        |                                  |
| TC-04 | Guard             | `rg -n "ENOTEMPTY\|retry" packages/agent-transport-tui/src/__tests__/pty` → no retry loop              | No-Fallback Policy compliance    |

## Tasks

- [ ] `.agents/tasks/INFRA-026.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

- 2026-07-08 GATE-APPROVAL round 1 — proposal-reviewer REVISE→ resolved to ENDORSE-able Alternative 1.
  Two required changes applied: (1) dropped the defensive `ENOTEMPTY` retry (No-Fallback Policy
  `operational.md:8,12` + `verification.md:59` — an implicit fallback masking a real "child alive after
  kill"); (2) corrected the false premise that the driver needs a NEW awaitable exit — `expectExit()`
  already exists and is re-exposed on the driver, so the fix is a combined `disposeAsync()` (dispose +
  await expectExit, throw on non-exit) with all 8 `afterEach` blocks made async. Reviewer confirmed the
  race premise (pty-driver.ts:106 sync dispose), the `force:true`≠ENOTEMPTY semantics, and the shared-8-file
  teardown pattern. Decision finalized: Alternative 1 only.
- 2026-07-08 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All four required changes confirmed
  (Alt-1-only + rule cites, expectExit factual correction, combined `disposeAsync()` with throw-on-non-exit,
  reworded TC-01 + TC-04 guard). Root-cause fix at the single shared seam, reuses existing exit primitive,
  zero production surface. Approved → implement.
- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — Added exported `killAndAwaitExit(session, timeoutMs)` +
  `IPtySession.disposeAsync()` to `pty-driver.ts` (dispose→await `expectExit`, throw on non-exit); made all 8
  `*.ptytest.ts` `afterEach` blocks `async` awaiting `disposeAsync()` before `rmSync`. No retry. Verified:
  TC-01 unit test `pty-driver-dispose.test.ts` (2/2 — awaits actual exit, rejects on non-exit); TC-04 grep
  (no `ENOTEMPTY`/retry loop, clean); package typecheck + build EXIT 0; full non-ptytest suite 418/418.
  TC-02 (≥20× flag-tui stress) / TC-03 (`test:pty`) are carried by CI `tui-e2e` (built-CLI project). DONE.

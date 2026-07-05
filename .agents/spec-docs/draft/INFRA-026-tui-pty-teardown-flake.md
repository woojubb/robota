---
status: draft
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
3. **Do both — await exit + a defensive bounded `ENOTEMPTY` retry.** Pro: robust; the retry covers
   any residual OS-level lag after exit. Con: slightly more code. Likely the safest combination.

### Decision

_Deferred._ Recommendation on record: Alternative 1 (await child exit in the shared driver before
`rmSync`), optionally combined with Alternative 3's defensive retry. To be finalized at GATE-APPROVAL
when this item is picked up.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — all `packages/agent-transport-tui/src/__tests__/pty/*.ptytest.ts` share the `kill()` + `rmSync` teardown; fix belongs in the shared `pty-driver.ts`
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 (recommendation recorded; final decision deferred to pickup)

## Solution

Make the shared PTY driver expose an awaitable exit, and have each `*.ptytest.ts` teardown await the
session's exit before `rmSync(projectDir, ...)`; optionally add a bounded `ENOTEMPTY` retry around the
removal as defense-in-depth. No production code changes — test infrastructure only.

## Affected Files

- `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts`
- `packages/agent-transport-tui/src/__tests__/pty/flag-tui.ptytest.ts` (and sibling `*.ptytest.ts` teardowns)

## Completion Criteria

- [ ] TC-01: The shared PTY driver exposes an awaitable exit (e.g. `waitForExit()` / async
      `dispose()`) that resolves after the child process has exited.
- [ ] TC-02: `*.ptytest.ts` teardowns await the session exit before `rmSync`; a stress run of the PTY
      suite (repeat the previously-flaky `flag-tui` case N≥20 times locally) shows 0 `ENOTEMPTY`
      failures.
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0 (CI `tui-e2e` green).

## Test Plan

INFRA (test-infra reliability) — the deliverable is a reliably-green PTY e2e suite; verified by a
local repeat-run stress check plus the CI `tui-e2e` job.

| TC-ID | Test Type         | Tool / Approach                                                                                | Notes |
| ----- | ----------------- | ---------------------------------------------------------------------------------------------- | ----- |
| TC-01 | Unit (driver)     | vitest — assert the driver's awaitable exit resolves after child exit                          |       |
| TC-02 | Integration (PTY) | vitest — loop the `flag-tui` PTY test ≥20× (or a seeded stress harness), assert no `ENOTEMPTY` |       |
| TC-03 | CI smoke          | `pnpm --filter @robota-sdk/agent-transport-tui test:pty` exits 0 (CI `tui-e2e`)                |       |

## Tasks

- [ ] `.agents/tasks/INFRA-026.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

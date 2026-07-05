---
title: 'CLI-075: 종료/채널 위생: TUI 리스너 해제·permission 큐 drain·graceful shutdown'
status: done
created: 2026-07-04
completed: 2026-07-05
priority: medium
urgency: soon
area: packages/agent-transport-tui, packages/agent-cli, packages/agent-tools
depends_on: ['CORE-022']
---

# 종료/채널 위생: TUI 리스너 해제·permission 큐 drain·graceful shutdown

Re-audit P2-18 (RUNTIME-31/32/33/35). TuiInteractionChannel.stop이 리스너 13종 미해제+구세션
미shutdown; abort가 permission 큐 미drain(processingPermission 고착); renderApp 종료가
process.exit(0) 즉시 + 행 시 2차 Ctrl+C no-op.

## What

1. stop() 리스너 unwire + 세션 전환 시 구세션 shutdown 정책 명시.
2. cancelAllPermissions() 추가(abort/shutdown 경로).
3. 타임아웃부 await channel.stop() + 2차 시그널 process.exit(130) (api-boundary 준수).
4. 동반: 스톨 감지기 도구 실행 중 억제(39), tui-state-manager dispose(52).

## Test Plan

- 채널 stop 후 리스너 0; permission drain; 시그널 경로 테스트.

Implemented (SPEC-first → TDD red→green):

- `TuiInteractionChannel` (RUNTIME-31/32): `wireSessionEvents()` now records every binding; `stop()` is
  a full idempotent teardown that `unwireSessionEvents()` (all 13 listeners → `session.off`), drains
  both queues (`cancelAllPermissions()` resolves pending permissions as `false`/deny, symmetric to
  `cancelAllUserActions()`), disposes the state manager, stops transports, and shuts the session down
  (bounded) unless a graceful `shutdown()` already ran. `abort()`/`cancelQueue()`/`shutdown()` all drain
  permissions.
- `shutdownSessionBounded()` (RUNTIME-33): graceful session shutdown is bounded by `SHUTDOWN_TIMEOUT_MS`
  so a wedged subsystem cannot block exit; SPEC contract in agent-transport-tui + agent-cli SPEC.
- `shutdown-signal.ts` `handleInterrupt()` (RUNTIME-33): first interrupt → graceful; second during an
  in-flight shutdown → `process.exit(130)`. App.tsx Ctrl+C + a single `process.on('SIGINT'|'SIGTERM')`
  effect route through it.
- `TuiStateManager` (RUNTIME-39/52): stall hint suppressed while any tool runs (`onToolStart` clears,
  `onToolEnd` re-arms only when no tool runs and still thinking); `dispose()` releases the stall +
  debounce timers and nulls `onChange`.

Regression tests (git-tracked): `TuiInteractionChannel.lifecycle.test.ts` Group D (D1 unwire, D2/D3
session-shutdown once, D4 idempotent, D5/D6 permission drain, D7 timeout-bounded);
`tui-state-manager.error-stall.test.ts` (stall suppression ×4, dispose ×2); `shutdown-signal.test.ts`
(handleInterrupt ×3). Package suite 414 passed; PTY suite 11 passed (incl. TC-08 /exit exit-within-10s).

## User Execution Test Scenarios

- agent-executable. 라이브 TUI(PTY) 기동 → 세션 전환 → 종료 후 프로세스 자연 종료(핸들 0) 실측
  - 종료 중 pending permission drain 확인.
- Evidence (2026-07-05, built CLI `packages/agent-cli/bin/robota.cjs` in a real PTY, real Anthropic
  `claude-haiku-4-5`; driver was a disposable gitignored scratch script — evidence-superseded by the
  git-tracked regression tests above for the drain/unwire/idempotency invariants):
  - UE-A: first Ctrl+C → "Shutting down…" → **exit 0 in 52ms** (well under the 5000ms bound) — bounded
    graceful shutdown completes and the process exits naturally (no hung listeners/timers/session).
  - UE-B: model runs the shell tool → permission prompt pending → Ctrl+C mid-permission → **exit 0 in
    52ms** — the pending permission is drained (deny) and shutdown proceeds; no hang.
  - UE-D: run 1 seeds a persisted session; run 2 (`-r ""`) opens the picker → select → **live session
    switch** (old channel torn down mid-process) → channel idle on the new session → Ctrl+C → **exit 0**
    — natural exit after a live switch.
  - UE-C: double Ctrl+C during a live turn → **exit 0** (graceful won the race at ~52ms; the
    `handleInterrupt` force-quit-130 branch is deterministically covered by the unit test since a
    hung shutdown cannot be forced live). Process always terminated cleanly.

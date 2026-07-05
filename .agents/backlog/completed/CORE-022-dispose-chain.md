---
title: 'CORE-022: dispose 체인 단일 계약: shutdown→destroy→plugin dispose + destroyed 가드'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: now
area: packages/agent-core, packages/agent-session
depends_on: []
---

# dispose 체인 단일 계약: shutdown→destroy→plugin dispose + destroyed 가드

> **Live re-confirmation (2026-07-04, CORE-021 UE):** `agent.destroy()` does not dispose
> registered plugins — a buffered `EventEmitterPlugin`'s flush `setInterval` kept the event
> loop alive and the probe process hung indefinitely until an explicit `plugin.destroy()`
> was added (`scratch/src/core-021-user-execution.ts` handoff note).

Re-audit P1-7 (RUNTIME-09/10/22 병합). destroy가 플러그인 미dispose(usage setInterval 생존),
Session.shutdown이 destroy 미호출(저장소 전체 호출 0건 실측), destroyed 플래그 부재로 파괴된
에이전트 부활. SPEC 확정 선행(라이프사이클 계약).

## What

1. SPEC: shutdown→destroy→plugin dispose 체인 + destroyed 터미널 상태 계약.
2. destroyAgent 플러그인 dispose 단계; dispose/destroy 단일 진입점.
3. destroy에서 run 큐 tail await + 후속 run 터미널 에러; 실패 init 프라미스 캐시 해소.

## Test Plan

- shutdown 후 활성 타이머/리스너 0; destroy 후 run() 거부; 큐 tail 대기.

## User Execution Test Scenarios

- agent-executable. 라이브 세션 기동→shutdown 후 프로세스 자연 종료(활성 핸들 0) 실측 + 파괴된
  에이전트 run 거부 확인.
- Evidence: **PASSED 2026-07-04** — live probe `scratch/src/core-022-user-execution.ts`
  (gitignored scratch workspace; recipe `pnpm --filter robota-scratch run run
src/core-022-user-execution.ts`, key from the gitignored agent-cli `.env`, model
  claude-haiku-4-5): real turn ran with a buffered `EventEmitterPlugin` (a live flush
  `setInterval`), then **`agent.destroy()` ALONE** (no explicit `plugin.destroy()`).
  Measured via `process.getActiveResourcesInfo()`:
  `timersBefore=1 timersAfter=0 lifecycleRejected=true` / `CORE-022-OK`, and the process
  **exited naturally** (`OUTER_EXIT=0` under a 90s hang-detecting timeout). This is the exact
  setup that hung indefinitely in the CORE-021 UE — `agent.destroy()` now disposes the plugin
  and clears its flush timer, and `run()` after destroy rejects with `[LIFECYCLE]`.

## Implementation Evidence (2026-07-04)

- SPEC first: `packages/agent-core/docs/SPEC.md` § Disposal Chain Contract (dispose() single
  entry point, destroy() terminal + queue-tail await, destroyed terminal state, failed-init
  not cached); `packages/agent-session/docs/SPEC.md` shutdown → `robota.destroy()` step.
- `packages/agent-core/src/abstracts/abstract-plugin-types.ts` — `IPluginContract.dispose()`
  is now a required contract method (was absent; disposal was ad-hoc `destroy()`).
- `packages/agent-core/src/core/robota.ts` — `destroyed` terminal flag; `assertNotDestroyed()`
  gates `run`/`runStream`/`ensureFullyInitialized`; `destroy()` is idempotent, awaits
  `runQueueTail`, then disposes; failed `doAsyncInit()` clears the cached init promise.
- `packages/agent-core/src/core/robota-lifecycle.ts` — `destroyAgent` now calls
  `plugin.dispose()` per plugin (single entry point; removed the redundant explicit
  unsubscribe loop — base `dispose()` unsubscribes) and `eventEmitter.dispose()`.
- `packages/agent-core/src/plugins/event-emitter-plugin.ts` — `destroy()` → `override dispose()`
  (clears flush timer, flushes, clears listeners, `super.dispose()`).
- `packages/agent-plugin/src/*` — 7 plugins (logging, performance, execution-analytics,
  conversation-history, webhook, error-handling, usage) migrated `destroy()` →
  `override dispose()` with `super.dispose()`; their tests migrated `destroy()` → `dispose()`.
- `packages/agent-session/src/session.ts` — `shutdown()` adds a best-effort `destroy-agent`
  step (`robota.destroy()`) after the SessionEnd hook.
- Tests (TDD, red→green): `robota.test.ts` 'disposal chain contract (CORE-022)' (5 — post-destroy
  run/runStream `[LIFECYCLE]` rejection, idempotent destroy, plugin dispose, queue-tail await);
  `session-shutdown-best-effort.test.ts` post-shutdown `[LIFECYCLE]` rejection. Full workspace:
  agent-core 839/839, agent-plugin 303/303, agent-session green; build/typecheck/lint 0 errors;
  45/45 harness scans.

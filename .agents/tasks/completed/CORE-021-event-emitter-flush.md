---
title: 'CORE-021: EventEmitterPlugin flush 부동 프라미스 + catchErrors rethrow 수정'
status: done
created: 2026-07-04
completed: 2026-07-04
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# EventEmitterPlugin flush 부동 프라미스 + catchErrors rethrow 수정

Re-audit P1-6 (RUNTIME-11). 버퍼링 flush가 setInterval 부동 프라미스 + catchErrors:true여도
rethrow — 핸들러 하나가 던지면 unhandled rejection으로 프로세스 사망 가능.

## What

1. catchErrors가 실제로 삼키도록(구조화 로깅 유지) + flush 호출부 .catch.

## Test Plan

- 던지는 핸들러 주입 시 프로세스 생존 + 에러 로깅.

## User Execution Test Scenarios

- agent-executable. 라이브 세션에 던지는 핸들러 등록 후 flush 주기 경과 — unhandled rejection 0
  (프로세스 생존) 실측.
- Evidence: **PASSED 2026-07-04** — live probe `scratch/src/core-021-user-execution.ts`
  (gitignored scratch workspace; recipe `pnpm --filter robota-scratch run run
src/core-021-user-execution.ts`, key from the gitignored agent-cli `.env`, model
  claude-haiku-4-5): real turn ran with a buffered EventEmitterPlugin (flushInterval 50ms)
  whose handlers ALWAYS throw; a buffered event was routed through the flush timer. Output:
  `unhandledRejections=0 handlerErrorsRecorded=1` / `CORE-021-OK` — zero unhandled
  rejections across multiple flush cycles (previously: floating flush promise +
  catchErrors rethrow = process death on Node 20+), with the handler failure recorded in
  plugin metrics.
- Side discovery (live re-confirmation of CORE-022): `agent.destroy()` does not dispose
  registered plugins — the probe hung until an explicit `plugin.destroy()` was added;
  noted in the CORE-022 backlog.

## Implementation Evidence (2026-07-04)

- SPEC first: `packages/agent-core/docs/SPEC.md` § EventEmitterPlugin Error Containment —
  catchErrors:true (default) records+logs+swallows, catchErrors:false rethrows; the flush
  timer must never float a rejection.
- `packages/agent-core/src/plugins/event-emitter-helpers.ts` — `executeEventHandler` now
  swallows after metrics+log when catchErrors is enabled (was: logged AND rethrew).
- `packages/agent-core/src/plugins/event-emitter-plugin.ts` — flush timer attaches
  `.catch` (structured log, last-resort surface); maxSize-overflow flush is now awaited
  inside async `emit()` (was floating).
- Tests (TDD, red 3/4 → green 4/4): `event-emitter-plugin.test.ts` — swallow+metrics,
  catchErrors:false rethrow, flush-timer no-unhandled-rejection, overflow-flush
  no-unhandled-rejection (unhandledRejection listener assertions). agent-core 834/834.

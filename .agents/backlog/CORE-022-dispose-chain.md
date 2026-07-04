---
title: 'CORE-022: dispose 체인 단일 계약: shutdown→destroy→plugin dispose + destroyed 가드'
status: todo
created: 2026-07-04
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
- Evidence: (record after execution)

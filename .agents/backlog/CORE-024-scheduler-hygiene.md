---
title: 'CORE-024: 백그라운드 스케줄러 위생: 슬롯/hung fire 기아/wakeTaskIds/IPC flush 레이스'
status: todo
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-executor, packages/agent-subagent-runner, packages/agent-framework
depends_on: []
---

# 백그라운드 스케줄러 위생: 슬롯/hung fire 기아/wakeTaskIds/IPC flush 레이스

Re-audit P2-9 (RUNTIME-17/18/19/20/25 + 47 동반). 잠자는 cron이 maxConcurrent(4) 슬롯 영구 점유
→ spawn 기아; hung fire protect:true 기아; wake 축출 시 wakeTaskIds 미정리 → 미래 wake 영구
거부; 워커 IPC result/exit flush 레이스로 성공이 crash 오보 + usage 유실(ANALYTICS-001 부류).

## What

1. SLEEP 전이 시 슬롯 반환(또는 스케줄 태스크 동시성 제외); fire별 timeout+kill.
2. pending 프롬프트 큐 배열화(최소: 축출 시 wakeTaskIds 정리); 워커 exit를 process.send 완료
   이후로; 무조건 exit 예약 vs runFollowUp 모순 해소.
3. 동반: IPC usage 스키마 검증(RUNTIME-47).

## Test Plan

- 스케줄러 상태기계 단위 테스트; IPC flush 레이스 회귀.

## User Execution Test Scenarios

- agent-executable. 라이브 스케줄 태스크 실행 — 성공이 crash로 오보되지 않고 usage가 부모 로그
  귀속 실측(ANALYTICS-001 라이브 레시피 재사용).
- Evidence: (record after execution)

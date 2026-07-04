---
title: 'HARNESS-025: 게이트 위생 잔여: MOCK allowlist 번다운·실 sleep·env 변이·PTY HOME 격리'
status: todo
created: 2026-07-04
priority: low
urgency: later
area: scripts/harness, packages
depends_on: ['HARNESS-023']
---

# 게이트 위생 잔여: MOCK allowlist 번다운·실 sleep·env 변이·PTY HOME 격리

Re-audit P3 (GATE-004/007/008/009). MOCK-001 allowlist 36파일 잔존, 실 벽시계 sleep 의존(cache
TTL 100ms, PTY 300ms), vi.stubEnv 없는 env 변이, PTY e2e 실HOME 전달(조건부 플레이크).

## What

1. PTY e2e temp HOME 주입; cache TTL fake timers; env 변이 → vi.stubEnv 전환.
2. MOCK-001 번다운 진행률 점검 + 감축 목표 기록.

## Test Plan

- 격리 HOME 전체 스위트 green; 하네스 스위트 green.

## User Execution Test Scenarios

Not applicable — test-hygiene only. Engineering evidence: isolated-env suite runs.

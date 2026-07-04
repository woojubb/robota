---
title: 'CORE-019: 컴팩션 실패 시 히스토리 원본 보존 + 에러 전파 (원자적 영속화)'
status: todo
created: 2026-07-04
priority: high
urgency: now
area: packages/agent-session
depends_on: []
---

# 컴팩션 실패 시 히스토리 원본 보존 + 에러 전파 (원자적 영속화)

Re-audit P1-4 (RUNTIME-15 + RUNTIME-45 흡수). 컴팩션 summary 무효 시 '(compaction failed)'
마커로 clearHistory() 후 치환하고 계속 진행 — append-only/No-Fallback 동시 위반 데이터 오염.
세션 영속화도 비원자 writeFileSync.

## What

1. clearHistory() 이전에 summary 무효 시 throw — 히스토리 무손상 보존.
2. 세션 영속화 temp+rename 원자화 (RUNTIME-45).

## Test Plan

- 무효 summary 주입 시 원본 무손상 + 에러 표면화; 영속화 원자성 테스트.

## User Execution Test Scenarios

- agent-executable. 라이브 세션에서 컴팩션 실패 유도(불가 시 fault-injection 지점 명시) 후
  세션 로그 원본 무손상 실측.
- Evidence: (record after execution)

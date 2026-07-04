---
title: 'CORE-021: EventEmitterPlugin flush 부동 프라미스 + catchErrors rethrow 수정'
status: todo
created: 2026-07-04
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
- Evidence: (record after execution)

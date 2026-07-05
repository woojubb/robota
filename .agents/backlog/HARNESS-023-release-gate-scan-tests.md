---
title: 'HARNESS-023: 릴리스 게이트 스캔 자체 테스트: publish-safety·release-governance부터 fixture'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# 릴리스 게이트 스캔 자체 테스트: publish-safety·release-governance부터 fixture

Re-audit P2-14 (GATE-003). 45종 중 ~15종 스캔이 자체 테스트 전무 — 특히 릴리스 안전 게이트가
무검증이라 게이트가 조용히 무력화되어도 감지 수단이 없다.

## What

1. publish-safety → release-governance → spec-publish-claims 순 위반 fixture 단위 테스트.
2. 무테스트 스캔 우선순위 현황표 산출(잔여는 순차 후속).

## Test Plan

- 각 게이트 위반 fixture fail + 정상 pass; 하네스 스위트 green.

## User Execution Test Scenarios

Not applicable — harness tooling only. Engineering evidence: fixture red/green per gate.

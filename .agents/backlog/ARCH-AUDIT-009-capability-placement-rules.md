---
title: 'ARCH-AUDIT-009: capability-placement.md API/Orchestrator 분리 및 conformance loop 링크 추가'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: documentation
---

## Problem

`.agents/specs/architecture-map/capability-placement.md`에 두 가지 안내가 없다.

1. **API/Orchestrator 분리 안내 부재**: Owner Selection Table에 오케스트레이터 역량(agent-runtime/sessions)과 SDK surface(agent-sdk) 경계 구분 없음.

2. **conformance verification loop 링크 누락**: "SPEC을 먼저 업데이트하라"고 안내하나 `spec-workflow.md`의 conformance verification loop 실행 요건이 누락.

## Solution

1. Owner Selection Table 또는 Stop Conditions에 레이어 분리 안내 추가
2. 4단계 이후 "→ spec-workflow.md conformance verification loop 실행" 링크 추가

## Test Plan

- 수정 후 `api-boundary.md` 규칙과 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

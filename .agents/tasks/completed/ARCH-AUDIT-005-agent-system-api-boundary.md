---
title: 'ARCH-AUDIT-005: agent-system.md에 Runtime/Orchestrator API 경계 기술 추가'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: documentation
---

## Problem

`.agents/specs/architecture-map/agent-system.md`에 Runtime/Orchestrator API 경계가 전혀 기술되지 않았다. 이 규칙은 피드백 `feedback_runtime_orchestrator_api_boundary.md`, `feedback_api_orchestrator_separation.md`에 명시된 핵심 계약이다.

- Runtime API = 불변, ComfyUI-compatible (Robota가 수정 불가)
- Orchestrator API = Robota 소유, 수정 가능

이 구분이 없으면 에이전트가 잘못된 레이어를 수정하는 실수를 할 수 있다.

## Solution

`agent-system.md`에 "API Boundary" 섹션을 추가한다.

## Test Plan

- 기술된 경계가 `api-boundary.md` 규칙과 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

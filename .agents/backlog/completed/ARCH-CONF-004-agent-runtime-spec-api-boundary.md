---
title: 'ARCH-CONF-004: agent-runtime SPEC.md에 Runtime/Orchestrator API 경계 반영'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: spec-conformance
depends_on: ARCH-AUDIT-005
---

## Problem

`agent-system.md`에 Runtime API(불변, ComfyUI 호환) vs Orchestrator API(Robota 소유, 수정 가능) 경계를 신설했으나, `packages/agent-runtime/docs/SPEC.md`에 이 경계가 반영되지 않았다.

또한 `dependency-direction.md`에서 agent-sessions와 agent-runtime이 별도 레이어로 분리(sessions > runtime)되었으나, SPEC.md에서 이 계층 관계가 명확하지 않을 수 있다.

## Required Change

`packages/agent-runtime/docs/SPEC.md`에 다음을 명시:

1. **API 경계**: agent-runtime이 expose하는 API 중 어느 부분이 Runtime API(ComfyUI 호환, 불변)이고 어느 부분이 Orchestrator API(Robota 소유, 수정 가능)인지 구분
2. **계층 위치**: agent-runtime은 agent-sessions보다 하위 레이어. sessions가 runtime을 통해 background/subagent lifecycle을 관리하며, 역방향 의존성은 금지
3. **불변 계약**: Runtime API를 변경할 때는 ComfyUI 호환성 영향을 반드시 평가해야 한다는 제약 명시

## Test Plan

- `packages/agent-runtime/package.json`에 agent-sessions 의존성 없음 확인
- SPEC.md 수정 후 `agent-system.md`의 API Boundary 섹션과 표현 일치 확인
- `pnpm harness:verify -- --scope packages/agent-runtime`

## User Execution Test Scenarios

Not applicable — SPEC.md-only change. No runnable user-facing behavior change.

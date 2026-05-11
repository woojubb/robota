---
title: 'ARCH-CONF-005: agent-plugin-* SPEC.md 아키텍처 레이어 규칙 준수 검증 및 업데이트'
status: done
created: 2026-05-09
priority: medium
urgency: soon
area: spec-conformance
depends_on: ARCH-AUDIT-002
---

## Problem

`repository-overview.md`에 `agent-plugin-*` 9개 패키지가 독립 Plugin 패밀리로 추가되었다. 각 패키지에 SPEC.md는 존재하나 아키텍처 레이어 규칙이 일관되게 반영되어 있는지 검증되지 않았다.

대상 패키지 (9개):

- `agent-plugin-conversation-history`
- `agent-plugin-error-handling`
- `agent-plugin-event-emitter`
- `agent-plugin-execution-analytics`
- `agent-plugin-limits`
- `agent-plugin-logging`
- `agent-plugin-performance`
- `agent-plugin-usage`
- `agent-plugin-webhook`

## Required Checks per Package

1. **의존성 방향**: plugin 패키지는 `agent-core`에만 의존해야 함 (agent-sessions, agent-sdk, agent-cli에 의존 금지)
2. **SPEC.md Boundaries**: "agent-core에만 의존", "agent-cli/agent-sdk가 composition root에서 주입"이 명시되어 있는가
3. **No own contracts**: plugin은 agent-core에 정의된 `AbstractPlugin` 인터페이스를 구현할 뿐, 자체 cross-package 계약을 정의하지 않아야 함

## Test Plan

각 패키지별:

- `packages/agent-plugin-*/package.json`에서 agent-sdk, agent-sessions, agent-cli 의존성 없음 확인
- SPEC.md Boundaries 섹션 확인 — 아키텍처 레이어 규칙 명시 여부
- `pnpm harness:verify -- --scope packages/agent-plugin-<name>` 실행

## User Execution Test Scenarios

Not applicable — SPEC.md-only change. No runnable user-facing behavior change.

---
title: 'ARCH-CONF-003: agent-sessions SPEC.md에 storage port 계약 소유권 명시'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: spec-conformance
depends_on: ARCH-AUDIT-006
---

## Problem

`cross-cutting-contracts.md`를 업데이트하여 storage port 계약의 소유자를 `agent-sessions`으로 지정했으나, `packages/agent-sessions/docs/SPEC.md`에 storage port 계약 소유권이 명시되지 않았다.

SSOT 원칙: 계약 소유는 해당 패키지의 SPEC.md에 있어야 한다. 아키텍처 맵은 router일 뿐이다.

## Required Change

`packages/agent-sessions/docs/SPEC.md`에 다음을 명시:

- `agent-sessions`는 storage port interface를 소유한다
- Storage port는 conversation history, session metadata, compaction 결과의 영속성 계약을 정의한다
- Adapters(in-memory, filesystem 등)는 이 port를 구현하며, port 계약 자체는 다른 패키지를 참조하지 않는다
- 소비자는 adapter를 직접 생성하지 않고 SDK facade를 통해 session store를 얻는다

## Test Plan

- `packages/agent-sessions/src/` 에서 storage port interface 정의 위치 확인
- SPEC.md 수정 후 `cross-cutting-contracts.md`의 "Storage port contracts" 행과 표현 일치 확인
- `pnpm harness:verify -- --scope packages/agent-sessions`

## User Execution Test Scenarios

Not applicable — SPEC.md-only change. No runnable user-facing behavior change.

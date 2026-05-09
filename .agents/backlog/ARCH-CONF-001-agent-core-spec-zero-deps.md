---
title: 'ARCH-CONF-001: agent-core SPEC.md에 ZERO deps 제약 명시'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: spec-conformance
depends_on: ARCH-AUDIT-008
---

## Problem

`packages/agent-core/docs/SPEC.md`에 "다른 agent-\* 패키지에 대한 의존성 ZERO" 제약이 명시적으로 기술되지 않았다.

현재 상태:

- 패키지 구현에서는 agent-\* 의존성이 없음 (jssha, zod만 존재) — 코드는 준수
- SPEC.md에는 "plugins were extracted to comply with the agent-core zero-dependency rule"로 간접 언급만 존재
- 아키텍처 맵(`dependency-direction.md`)은 "ZERO deps from other agent-\* packages"로 명시

## Required Change

`packages/agent-core/docs/SPEC.md`의 "Boundaries" 또는 "Non-Goals" 섹션에 다음을 명시:

- `agent-core`는 다른 `agent-*` 패키지를 production dependency로 가질 수 없다
- 다른 agent-\* 패키지는 agent-core에 등록하는 방식으로 연동한다 (역방향)
- 이 제약은 layered assembly architecture의 기반이며 순환 의존성 방지의 핵심이다

## Test Plan

- `packages/agent-core/package.json`의 dependencies/peerDependencies에 agent-\* 항목 없음 확인
- SPEC.md 수정 후 `dependency-direction.md`와 표현 일치 확인
- 하네스 검사: `pnpm harness:verify -- --scope packages/agent-core`

## User Execution Test Scenarios

Not applicable — SPEC.md-only change. No runnable user-facing behavior change.

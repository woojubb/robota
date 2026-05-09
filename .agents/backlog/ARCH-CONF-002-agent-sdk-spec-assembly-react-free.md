---
title: 'ARCH-CONF-002: agent-sdk SPEC.md에 assembly layer + React-free 명시'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: spec-conformance
depends_on: ARCH-AUDIT-007
---

## Problem

`packages/agent-sdk/docs/SPEC.md`에 두 가지 아키텍처 제약이 불명확하다.

1. **Assembly layer 역할 불명확**: "assembly layer — SDK-specific features only"로 간단히 언급되나 "re-export 레이어가 아님"이 명시되지 않음. 일부 섹션에서 re-export를 언급하여 역할 혼동 가능.

2. **React-free 제약 부재**: SDK 소스에는 React import가 없어 구현은 준수하나 SPEC.md에 "SDK는 React-free"가 명시되지 않음. 향후 기여자가 React hooks를 SDK에 추가하는 것을 막는 계약이 없다.

## Required Change

`packages/agent-sdk/docs/SPEC.md`의 Boundaries 섹션에 다음을 명시:

1. **Assembly layer**: agent-sdk는 sessions/runtime/tools/core를 하나의 SDK surface로 조립하는 조합 레이어다. 단순 pass-through re-export 레이어가 아니다. re-export는 SDK-owned facade barrel을 통해서만 허용된다.

2. **React-free**: agent-sdk는 React 의존성을 가지지 않는다. React hooks, React context, React components는 CLI 패키지(`agent-cli`, command packages)에만 속한다. SDK는 플랫폼 중립적 API만 제공한다.

## Test Plan

- `packages/agent-sdk/src/` 에서 React import 없음 확인: `grep -r "from 'react'" packages/agent-sdk/src/`
- `packages/agent-sdk/package.json` dependencies에 react 없음 확인
- SPEC.md 수정 후 `agent-system.md` 아키텍처 맵과 표현 일치 확인
- `pnpm harness:verify -- --scope packages/agent-sdk`

## User Execution Test Scenarios

Not applicable — SPEC.md-only change. No runnable user-facing behavior change.

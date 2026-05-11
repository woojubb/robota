---
title: 'ARCH-CONF-007: 아키텍처 핵심 제약을 하네스 기계적 검사로 보강'
status: done
created: 2026-05-09
priority: medium
urgency: later
area: harness
depends_on: ARCH-CONF-006
---

## Problem

아키텍처 제약이 문서(SPEC.md, 아키텍처 맵)에 명시되더라도 코드 변경 시 기계적으로 검사되지 않으면 점진적으로 위반이 발생한다. ARCH-CONF-006 검증 이후 준수 상태를 자동으로 유지하기 위한 하네스 검사가 필요하다.

## Required Harness Checks

### 1. agent-sdk React-free 검사 (신규)

- 파일: `scripts/harness/check-sdk-react-free.mjs` (신규 생성)
- 검사: `packages/agent-sdk/src/`에서 React import 없음
- 트리거: `pnpm harness:scan` 또는 `pnpm harness:verify -- --scope packages/agent-sdk`
- 위반 시: error + 개선 안내

### 2. agent-core zero-deps 검사 (신규 또는 기존 확장)

- 현재 `check-dependency-direction.mjs`가 존재하면 여기에 agent-core 특수 규칙 추가
- 검사: `packages/agent-core/package.json`에 `@robota-sdk/agent-*` deps 없음
- 위반 시: error + "agent-core는 다른 agent-\* 패키지에 의존할 수 없음" 안내

### 3. agent-plugin-\* 의존성 방향 검사 (신규 또는 기존 확장)

- 검사: `packages/agent-plugin-*/package.json`에 agent-sdk, agent-sessions, agent-cli deps 없음
- agent-core만 허용
- 위반 시: error + "plugin 패키지는 agent-core에만 의존해야 함" 안내

### 4. Runtime/Orchestrator 경계 검사 (조사 필요)

- 현재 경계를 기계적으로 검사하는 방법 조사
- 예: agent-runtime의 특정 API가 ComfyUI 호환 계약을 깨는지 type-level 검사

## Test Plan

- 각 검사 스크립트 작성 후 `pnpm harness:scan`에 포함
- 의도적 위반 케이스로 검사 동작 확인
- CI에서 실행되는지 확인

## User Execution Test Scenarios

Not applicable — harness/tooling change. No user-facing behavior change.

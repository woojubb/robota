---
title: 'ARCH-FIX-009: packages/agent-web SPEC.md 작성 및 project-structure 등재'
status: todo
created: 2026-05-10
priority: high
urgency: soon
area: documentation
related: [V-CON-003, PLG-002]
---

## Problem

`packages/agent-web`은 v3.0.0-beta.62에서 이미 공개 배포된 패키지이지만:

1. `packages/agent-web/docs/SPEC.md`가 없다.
2. `.agents/project-structure.md`에 등재되지 않았다.
3. `apps/agent-web`(Next.js 호스트 앱)과 이름이 비슷해 혼동 위험이 있다.

모든 workspace 패키지는 `docs/SPEC.md`가 필수이며 `project-structure.md`에 등재되어야 한다.

## Solution

1. `packages/agent-web/docs/SPEC.md`를 작성한다:
   - 패키지 역할 및 레이어 소속 명시
   - `apps/agent-web`(Next.js 호스트)과의 관계 구분 명시
   - 공개 API 목록
   - 의존 방향
2. `.agents/project-structure.md`에 `packages/agent-web` 항목을 추가한다.
3. `repository-overview.md` 패키지 패밀리에 추가한다.
4. 혼동 방지를 위해 두 패키지의 역할 차이를 `agent-system.md` 또는 `apps-and-deployment.md`에 명시한다.

## Test Plan

- `packages/agent-web/docs/SPEC.md` 존재 확인
- `project-structure.md`에 `packages/agent-web` 항목 존재 확인
- SPEC.md가 `spec-writing-standard` 스킬의 필수 섹션을 포함하는지 확인
- `pnpm harness:verify -- --scope packages/agent-web`

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 SPEC.md 경로 및 project-structure 항목 기록)

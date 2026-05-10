---
title: 'ARCH-FIX-015: apps/agent-web /monitor 라우트를 아키텍처 맵 및 SPEC에 등재'
status: todo
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CON-004, PLG-002]
---

## Problem

`apps/agent-web`의 `/monitor` 라우트가 구현되어 있으나 아키텍처 문서에 등재되지 않았다:

- `apps-and-deployment.md`에 언급 없음
- `apps/agent-web`의 SPEC.md나 README에 언급 없음

`/monitor`는 CLI 세컨드 스크린 기능의 핵심 진입점이다. 백로그 `PLG-002`와 연관된 제품 기능이 문서화되지 않은 상태다.

## Solution

1. `apps-and-deployment.md`에 `apps/agent-web`의 라우트 구조를 추가한다 (`/`, `/monitor` 등).
2. `apps/agent-web`의 SPEC.md 또는 README에 `/monitor` 라우트의 역할과 `packages/agent-web`과의 관계를 기술한다.
3. `PLG-002` 백로그가 완료되면 해당 아키텍처 등재를 이 항목에서 확인한다.

## Test Plan

- `apps-and-deployment.md`에 `/monitor` 라우트 언급 확인
- `apps/agent-web` 문서에 라우트 목록 존재 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 각 문서 업데이트 내용 기록)

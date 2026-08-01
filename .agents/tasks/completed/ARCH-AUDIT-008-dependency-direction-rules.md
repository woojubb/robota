---
title: 'ARCH-AUDIT-008: dependency-direction.md 규칙 강화 (core zero-deps, CF Pages 제거, 계층 분리)'
status: done
created: 2026-05-09
priority: medium
urgency: soon
area: documentation
---

## Problem

`.agents/specs/architecture-map/dependency-direction.md`에 세 가지 규칙이 반영되지 않았다.

1. **agent-core zero-deps 제약 미명시**: agent-core가 다른 agent-\* 패키지에 의존하면 안 된다는 핵심 제약 없음. `feedback_core_no_deps.md` 미반영.

2. **Cloudflare Pages가 코드 레이어에 포함**: 배포 인프라가 코드 레이어 다이어그램에 포함됨. `feedback_cf_dynamic_worker_naming.md` 취지에 맞지 않음.

3. **agent-runtime vs agent-sessions 계층 미구분**: `code-quality.md`는 agent-runtime이 agent-sessions보다 하위임을 명시하나 동일 레이어로 표현.

## Solution

1. agent-core 항목에 "ZERO production deps from other agent-\* packages" 명시
2. Cloudflare Pages 등 인프라 항목은 apps-and-deployment.md로 이동
3. agent-runtime과 agent-sessions를 별도 레이어 또는 화살표로 하위 관계 명시

## Test Plan

- 수정 후 `project-structure.md` 규칙과 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

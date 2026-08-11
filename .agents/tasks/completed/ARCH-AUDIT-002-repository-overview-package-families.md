---
title: 'ARCH-AUDIT-002: repository-overview.md 패키지 패밀리 목록 대규모 누락 수정'
status: done
created: 2026-05-09
priority: critical
urgency: now
area: documentation
---

## Problem

`.agents/specs/architecture-map/repository-overview.md`의 패키지 패밀리 표에서 다수 패키지가 완전히 누락되어 있다.

- `agent-plugin-*` 9개 패키지 전체 누락 (독립 패밀리로 추가 필요)
- `agent-team` 미기재
- `agent-event-service` 미기재
- `agent-tool-mcp` 소속 미명시
- `auth`, `credits` 미기재 또는 소속 불명확

## Solution

`ls packages/` 결과 기준으로 모든 패키지를 올바른 패밀리에 배치한다. `agent-plugin-*`는 독립 Plugin 패밀리로 추가한다.

## Test Plan

- `ls packages/` 결과와 overview 패밀리 표 대조 — 빠진 패키지 없음 확인
- 각 패키지의 역할이 패밀리 설명과 일치하는지 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

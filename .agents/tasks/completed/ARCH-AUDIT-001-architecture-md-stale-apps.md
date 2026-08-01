---
title: 'ARCH-AUDIT-001: ARCHITECTURE.md 존재하지 않는 앱 참조 제거'
status: done
created: 2026-05-09
priority: critical
urgency: now
area: documentation
---

## Problem

`ARCHITECTURE.md`의 System Overview 다이어그램에 실제 존재하지 않는 앱들이 남아 있다.

- `apps/web` → 실제는 `apps/agent-web`
- `apps/dag-studio` → 존재하지 않음
- `apps/dag-orchestrator-server` → 존재하지 않음
- `apps/dag-runtime-server` → 존재하지 않음

DAG 서브시스템 관련 앱들이 다이어그램에 잔존하여 신규 기여자와 에이전트에게 혼란을 주고 있다. `dependency-direction.md`의 ProductShells 목록(`agent-cli, agent-web, docs, blog, agent-server`)과 실제 `apps/` 디렉토리 구조와 불일치한다.

## Solution

ARCHITECTURE.md System Overview 다이어그램을 현재 실제 앱 구조(`apps/agent-web`, `apps/agent-server`, `apps/docs`, `apps/blog`)에 맞게 재작성한다. DAG 서브시스템 섹션도 DAG 패키지가 더 이상 존재하지 않으면 제거 또는 주석 처리한다.

## Test Plan

- `ls apps/` 결과와 다이어그램 앱 목록 대조 — 불일치 없음 확인
- `dependency-direction.md` ProductShells 목록과 동기화 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

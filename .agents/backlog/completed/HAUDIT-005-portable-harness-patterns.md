---
title: 'HAUDIT-005: 이식 가능한 하네스 패턴 문서화 — 보편 강화'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: low
urgency: backlog
area: scripts/harness, .agents/skills
depends_on: []
---

# HAUDIT-005: 이식 가능한 하네스 패턴 문서화

## Problem

rulebased-harness 감사(2026-06-15) 강화 권고. 이 레포의 하네스(26 스캔 등)는 강력하지만 상당수가
Robota-특화다. 그중 일부(ghost-path 메타 스캔, cold-state seam 테스트, 보호브랜치 commit 가드,
gh `--delete-branch` 차단 등 LESSON-001~007 산출물)는 **다른 프로젝트로 이식 가능한 보편 패턴**인데,
프로젝트-특화 구현과 섞여 일반 원칙이 드러나지 않는다.

## Solution

이식 가능한 하네스 패턴을 한 곳(예: `scripts/harness/README.md` 또는 별도 패턴 문서)에 정리:
각 패턴의 "일반 원칙 / 프로젝트-특화 부분 / 이식 시 조정 포인트". 최소 대상 = harness-config-paths
(ghost-path 메타스캔), live-seam cold-state 테스트, protected-branch commit 가드,
gh `--delete-branch` 차단. 신규 코드 없이 기존 산출물의 보편 원칙만 문서화.

## Completion Criteria

- [x] TC-01: 이식 가능한 하네스 패턴이 한 문서에 정리됨(최소 4개 패턴, 각 일반원칙/특화/이식포인트)
- [x] TC-02: 기존 산출물(LESSON-001~007 등)로의 링크가 정확함(존재하는 경로)
- [x] TC-03: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                               |
| ----- | ---------- | -------------------------------------- |
| TC-01 | Doc review | 패턴 문서 — 4개 패턴 + 3요소 구조 확인 |
| TC-02 | Harness    | 링크 경로 실재 확인 (done-evidence류)  |
| TC-03 | Harness    | `pnpm harness:scan` 통과               |

## User Execution Test Scenarios

Not applicable — 하네스 패턴 문서화(보편화). 런타임 동작 무변경.

## Tasks

- [x] 패턴 문서 작성 → 링크 검증 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01:** `scripts/harness/README.md`에 "Portable Harness Patterns" 절 추가 — 4개 패턴
  (ghost-path 메타스캔, live-seam cold-state 테스트, protected-branch commit 가드, gh
  `--delete-branch` 차단), 각 "일반 원칙 / 프로젝트-특화 / 이식 포인트" 3요소 + origin 링크.
- **TC-02:** origin 링크는 `completed/LESSON-001·003·006·007`의 실재 경로를 가리킴(상대경로
  `../../.agents/backlog/completed/...`). 신규 코드 없이 기존 산출물의 보편 원칙만 문서화.
- **TC-03:** `pnpm harness:scan` **26/26 passed**.

감사 효과(보편 강화): Robota-특화 하네스 산출물의 이식 가능한 일반 원칙을 한 곳에 정리.
User Execution Test Scenario gate: Not applicable — 하네스 패턴 문서화(런타임 무변경).

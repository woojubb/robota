---
title: 'HAUDIT-004: 영속 메모리/학습 lessons 발견성 포인터 — auto-memory-system 강화'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: low
urgency: later
area: AGENTS.md, .agents/evals
depends_on: []
---

# HAUDIT-004: 영속 메모리/학습 lessons 발견성 포인터

## Problem

rulebased-harness 감사(2026-06-15)에서 `auto-memory-system`은 pass이나(외부 Claude memory +
`.agents/evals/lessons/` 존재) AGENTS.md에서 **발견 불가**. 범용 에이전트가 영속 학습 자산의
위치를 컨텍스트 문서에서 찾을 수 없다.

## Solution

AGENTS.md(또는 Document tree)에 "Learned lessons / persistent memory" 포인터를 추가해
`.agents/evals/lessons/`(auto-lessons, weekly-digest)와 메모리 정책을 발견 가능하게 함.
도메인-프리 유지(포인터만).

## Completion Criteria

- [x] TC-01: AGENTS.md에서 `.agents/evals/lessons/`(학습 lessons) 위치가 발견 가능함
- [x] TC-02: 포인터만 추가하고 lessons 본문을 AGENTS.md에 중복하지 않음
- [x] TC-03: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                             |
| ----- | ---------- | ------------------------------------ |
| TC-01 | Doc review | AGENTS.md diff — lessons 포인터 확인 |
| TC-02 | Doc review | 본문 중복 없음 확인                  |
| TC-03 | Harness    | `pnpm harness:scan` 통과             |

## User Execution Test Scenarios

Not applicable — 컨텍스트 문서 발견성 개선. 런타임 동작 무변경.

## Tasks

- [x] AGENTS.md lessons 포인터 추가 → harness:scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01:** AGENTS.md에 "## Learned Lessons & Memory" 섹션 추가 — `.agents/evals/lessons/`
  (auto-lessons, weekly-digest), `.agents/evals/README.md`, 외부 세션 메모리 정책을 포인터로 노출.
- **TC-02:** 포인터만 추가, lessons 본문 중복 없음.
- **TC-03:** `pnpm harness:scan` **26/26 passed**.

감사 효과: `auto-memory-system` 발견성 강화(AGENTS.md에서 학습 자산 위치 발견 가능).
User Execution Test Scenario gate: Not applicable — 컨텍스트 문서 발견성 개선(런타임 무변경).

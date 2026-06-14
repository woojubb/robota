---
title: 'HAUDIT-002: AGENTS.md Common Pitfalls 진입점 추가 — ctx-agents-pitfalls hollow 해소'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: soon
area: AGENTS.md
depends_on: []
---

# HAUDIT-002: AGENTS.md Common Pitfalls 진입점 추가

## Problem

rulebased-harness 감사(2026-06-15)에서 `ctx-agents-pitfalls`가 **hollow**로 판정됨. 흔한 실수
목록은 `.agents/rules/common-mistakes.md`에 존재하나 AGENTS.md에는 "Mandatory Rules" 표
안의 한 행으로만 라우팅되어, 범용 에이전트가 "pitfalls/common mistakes" 키워드로 발견하기
어렵다.

## Solution

AGENTS.md에 명시적 "Common Pitfalls" 진입점(1~2줄 포인터)을 추가해
`.agents/rules/common-mistakes.md`("Observed failure patterns")로 직접 라우팅. 도메인-프리
유지(목록 본문은 인라인하지 않고 포인터만).

## Completion Criteria

- [x] TC-01: AGENTS.md에 "Common Pitfalls" 키워드 진입점이 추가되고 common-mistakes.md로 라우팅됨
- [x] TC-02: 실수 목록 본문은 여전히 common-mistakes.md가 SSOT(AGENTS.md에 중복 인라인 없음)
- [x] TC-03: `pnpm harness:scan` 통과 (scan-consistency 라우팅 일관성 포함)

## Test Plan

| TC-ID | Test Type  | Approach                            |
| ----- | ---------- | ----------------------------------- |
| TC-01 | Doc review | AGENTS.md diff — 진입점/라우팅 확인 |
| TC-02 | Doc review | 본문 중복 없음 확인                 |
| TC-03 | Harness    | `pnpm harness:scan` 통과            |

## User Execution Test Scenarios

Not applicable — 컨텍스트 문서 발견성 개선. 런타임 동작 무변경.

## Tasks

- [x] AGENTS.md 진입점 추가 → harness:scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01:** AGENTS.md에 "## Common Pitfalls" 섹션 추가 — `.agents/rules/common-mistakes.md`로
  직접 라우팅, "read it before non-trivial work" 안내. 범용 키워드 "pitfalls"로 발견 가능.
- **TC-02:** 포인터만 추가, 실수 목록 본문은 common-mistakes.md가 SSOT(중복 인라인 없음, "Do not
  inline the list here." 명시).
- **TC-03:** `pnpm harness:scan` **26/26 passed** (scan-consistency 포함).

감사 효과: `ctx-agents-pitfalls` hollow → pass.
User Execution Test Scenario gate: Not applicable — 컨텍스트 문서 발견성 개선(런타임 무변경).

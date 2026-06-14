---
title: 'HAUDIT-003: CLAUDE.md 위임 의도 명시 — ctx-claude-exists 강화'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: low
urgency: later
area: CLAUDE.md
depends_on: []
---

# HAUDIT-003: CLAUDE.md 위임 의도 명시

## Problem

rulebased-harness 감사(2026-06-15)에서 `ctx-claude-exists`는 pass이나 경계선(3줄). CLAUDE.md가
AGENTS.md로 위임하는 의도가 명시되지 않아, 범용 도구가 CLAUDE.md를 "빈약한 컨텍스트"로
오인할 수 있다.

## Solution

CLAUDE.md에 "이 파일은 의도적으로 얇으며 모든 규칙/아키텍처/스킬은 AGENTS.md가 SSOT"라는
위임 의도를 1~2줄 명시. 본문 중복은 만들지 않음.

## Completion Criteria

- [x] TC-01: CLAUDE.md에 AGENTS.md로의 의도적 위임 문구가 명시됨
- [x] TC-02: 규칙/아키텍처 본문을 CLAUDE.md에 중복 인라인하지 않음(SSOT는 AGENTS.md)
- [x] TC-03: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type  | Approach                        |
| ----- | ---------- | ------------------------------- |
| TC-01 | Doc review | CLAUDE.md diff — 위임 문구 확인 |
| TC-02 | Doc review | 본문 중복 없음 확인             |
| TC-03 | Harness    | `pnpm harness:scan` 통과        |

## User Execution Test Scenarios

Not applicable — 컨텍스트 문서 명확화. 런타임 동작 무변경.

## Tasks

- [x] CLAUDE.md 위임 문구 추가 → harness:scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01/02:** CLAUDE.md에 "This file is intentionally thin. AGENTS.md is the single source of
  truth ... not duplicated here by design." 문구 추가. 규칙/아키텍처 본문 중복 인라인 없음.
- **TC-03:** `pnpm harness:scan` **26/26 passed**.

감사 효과: `ctx-claude-exists` 경계선 → 의도 명확화.
User Execution Test Scenario gate: Not applicable — 컨텍스트 문서 명확화(런타임 무변경).

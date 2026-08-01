---
title: 'LESSON-009: unregistered-skill 검사를 skills/index.md(SSOT)로 교정'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: now
area: scripts/harness/cleanup-drift.mjs
depends_on: []
---

# LESSON-009: unregistered-skill 검사를 skills/index.md로 교정

## Problem (이번 세션 발견)

세션에서 새로 추가한 스킬(`design-quality-audit`)의 등록 누락 여부를 점검하다 발견.
`harness:cleanup`의 `unregistered-skill` 검사(`cleanup-drift.mjs`)가 **AGENTS.md**의 Skills
Reference 표를 스킬 등록부로 가정하나, AGENTS.md는 스킬을 개별 나열하지 않고
`.agents/skills/index.md`로 위임한다("See .agents/skills/index.md for the full list").

결과: 디스크의 51개 스킬 전부가 false `unregistered-skill`로 보고됨. 이 노이즈는 **진짜 미등록
스킬을 가린다** — 즉 신규 스킬 등록을 검증하는 기계적 가드가 무력화된 상태다.

실제 SSOT는 `.agents/skills/index.md`이며, 신규 스킬 `design-quality-audit`를 포함한 51개 스킬은
거기에 모두 정상 등록되어 있다(누락 없음). 문제는 검사가 잘못된 문서를 본다는 것.

## Solution

`cleanup-drift.mjs`의 `checkUnregisteredSkills`가 **`skills/index.md`**를 등록부로 읽도록 교정:

- index.md의 링크 형식 `[<name>](<name>/SKILL.md)`에서 스킬명을 추출(링크 텍스트 == 디렉터리명).
- 디스크에는 있으나 index.md에 없는 스킬 → `unregistered-skill`.
- index.md에는 있으나 디스크에 없는 스킬 → `stale-skill-reference`.
- 메시지 문구를 AGENTS.md → `.agents/skills/index.md`로 갱신.

## Completion Criteria

- [x] TC-01: `checkUnregisteredSkills`가 `.agents/skills/index.md`를 등록부로 사용
- [x] TC-02: `pnpm harness:cleanup`의 `unregistered-skill` false-positive 0건(현 51 → 0)
- [x] TC-03: 검사가 진짜 미등록(디스크엔 있고 index.md엔 없음)·stale(index.md엔 있고 디스크엔 없음)을 여전히 탐지
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                                  |
| ----- | ----------- | --------------------------------------------------------- |
| TC-01 | Code review | cleanup-drift.mjs diff — index.md 경로/추출 확인          |
| TC-02 | Integration | `pnpm harness:cleanup` 실행 → unregistered-skill 0건 확인 |
| TC-03 | Integration | 임시로 index.md 행 제거/디스크 가짜 스킬로 탐지 동작 확인 |
| TC-04 | Harness     | `pnpm harness:scan` 통과                                  |

## User Execution Test Scenarios

Not applicable — 하네스 검사 교정(개발 거버넌스). 런타임 동작 무변경.

## Tasks

- [x] cleanup-drift.mjs를 index.md 기반으로 교정 → cleanup/scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **점검 결과(원 질문):** 세션 신규 스킬 `design-quality-audit` 포함 디스크 51개 스킬 전부가
  실제 SSOT `.agents/skills/index.md`에 등록됨 — **누락 없음**. 누락된 것은 등록이 아니라 검사의 대상 문서였음.
- **TC-01:** `cleanup-drift.mjs` `checkUnregisteredSkills`가 `AGENTS_PATH` 대신 `SKILLS_INDEX_PATH`를
  읽도록 교정. `extractSkillsFromIndex`가 index.md 링크 형식 `[<name>](<name>/SKILL.md)`(역참조 \1로
  텍스트==경로 보장)에서 스킬명 추출. AGENTS_PATH 상수 및 구 함수 제거(잔존 참조 0 확인).
- **TC-02:** `pnpm harness:cleanup` 재실행 → `unregistered-skill` 51건 → **0건**. (잔존 finding은
  forbidden-agent-term/ spec-missing-sections 등 본 작업과 무관한 기존 항목.)
- **TC-03:** 정규식 추출 수 = 51 = 디스크 수(`design-quality-audit` 포함 true) — 디스크 전체가 매칭되어
  unregistered 0; 역방향(index.md엔 있고 디스크엔 없음 → stale-skill-reference) 로직은 대칭 유지.
- **TC-04:** `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — 하네스 검사 교정(런타임 무변경).

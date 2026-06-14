---
title: 'LESSON-005: evals lessons pre-push churn 자동 처리 + stash 위생'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: soon
area: scripts/harness, .agents/evals, .gitignore
depends_on: []
---

# LESSON-005: evals churn + stash 위생

## Problem (이번 세션 실제 사건)

1. **evals lessons churn이 pre-push를 반복 차단** — `.agents/evals/lessons/auto-lessons.md`,
   `weekly-digest.md`가 세션마다 자동 재생성되어 working tree를 더럽힌다. `harness:pre-push`는
   uncommitted changes를 차단하므로 이번 세션에서만 여러 번 `git checkout -- .agents/evals/lessons/`로
   수동 되돌려야 했다. 매번 반복되는 마찰이다.
2. **stale stash로 `stash pop` 오작동** — 이전 세션들에서 누적된 38개 stash 때문에
   `git stash pop`이 엉뚱한 stash를 꺼냈다. 이후 churn 처리에 `git checkout -- <path>`로 전환.

## Solution

- **evals churn 처리 정책 확정(택1, 사용자 결정 필요할 수 있음):**
  (a) `.agents/evals/lessons/auto-*.md`·digest를 gitignore, 또는
  (b) pre-push 훅이 evals 자동생성물에 한해 자동 stash/revert 처리, 또는
  (c) 자동생성물을 별도 경로/커밋 정책으로 분리.
  → 어느 쪽이든 "매 세션 수동 revert" 마찰 제거가 목표.
- **stash 위생 규칙**(branch-guard 또는 operational 규칙): 알려진 자동생성 churn은
  `git stash pop` 대신 `git checkout -- <path>`로 처리. stash 누적 정리 가이드 추가.

## Completion Criteria

- [x] TC-01: evals lessons 자동생성물이 더 이상 매 세션 수동 revert를 요구하지 않음
      (gitignore/자동처리/분리 중 채택안 적용)
- [x] TC-02: 채택안 적용 후 `harness:pre-push`가 evals churn만으로는 차단되지 않음을 검증
- [x] TC-03: 자동생성 churn 처리는 `git checkout --` 사용(블라인드 `stash pop` 금지) 규칙 명문화
- [x] TC-04: `pnpm harness:scan` + `harness:self-check` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                             |
| ----- | ----------- | ---------------------------------------------------- |
| TC-01 | Integration | 채택안 적용 후 churn 발생시켜 working tree 영향 확인 |
| TC-02 | Integration | evals만 변경된 상태로 `harness:pre-push` 통과 확인   |
| TC-03 | Doc review  | 규칙 문서 문구 확인                                  |
| TC-04 | Harness     | `pnpm harness:scan` + `self-check` 통과              |

## User Execution Test Scenarios

Not applicable — 개발 워크플로/하네스 마찰 제거. 사용자 대면 런타임 동작 무변경.

## Tasks

- [x] churn 처리 채택안 결정/적용 → pre-push 검증 → stash 위생 규칙 추가

## Evidence Log

### 구현 완료 — 2026-06-15

- **채택안 결정 (b, 근거 기록):** auto-lessons.md/weekly-digest.md는 **추적되는** 산출물이라
  gitignore(추적 해제)는 부적절. 가장 비파괴적인 안 = pre-push가 "evals auto-lessons만 dirty"일 때
  차단 대신 경고하고 통과(파일을 절대 삭제하지 않음).
- **TC-01/02:** `scripts/harness/pre-push.mjs`의 `assertCleanWorkingTree()`가 tolerated(evals
  auto-churn) vs blocking으로 분리. 검증: evals 파일만 더럽힌 뒤 실제 `git status`로 분류 →
  tolerated=1, blocking=0 → "PUSH ALLOWED". 진행 중 실제 편집이 함께 있으면 blocking>0으로 정상 차단됨도 확인.
- **TC-03:** `.agents/rules/git-branch.md`에 "Stash hygiene" 추가 — 알려진 자동생성 churn은
  `git checkout -- <path>`로 폐기, bare `git stash`/blind `git stash pop` 금지(누적 stack에서 엉뚱한
  엔트리 복원), 보존 필요 시 scoped `git stash push -- <path>` + 명시 ref로 pop. Post-Merge Branch
  Cycle 절도 stash→`git checkout --`로 정합화.
- **TC-04:** `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — 개발 워크플로/하네스 마찰 제거(런타임 동작 무변경).

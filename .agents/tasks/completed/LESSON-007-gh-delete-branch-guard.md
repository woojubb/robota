---
title: 'LESSON-007: gh pr merge --delete-branch 차단 가드 — branch-guard 훅에 기계적 강제'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: high
urgency: now
area: .claude/hooks/branch-guard.sh, .agents/skills/branch-guard
depends_on: []
---

# LESSON-007: gh pr merge --delete-branch 차단 가드

## Problem (이번 세션 실제 사건)

`.agents/rules/git-branch.md`(54행)는 **"Never pass `--delete-branch` to `gh pr merge`. Zero
exceptions."** 를 명시한다(원인: `--delete-branch`가 `develop → main` PR에서 `develop` 통합
브랜치를 삭제해 브랜치 구조가 붕괴된 사고). 그럼에도 이번 세션에서 에이전트가 PR #794·#795를
`gh pr merge --merge --delete-branch`로 머지했다(다행히 feature 브랜치라 피해는 없었음).

근본 원인: 이 규칙이 **prose로만 존재**하고 기계적 강제가 없다. branch-guard 훅은 `git
commit`/`push`/`merge`만 가로채고 `gh pr merge`는 검사하지 않아, 에이전트가 규칙을 잊으면
그대로 통과한다. (AGENTS.md 원칙: "규칙이 반복 필요하면 prose보다 기계적 검사를 선호".)

## Solution

- `.claude/hooks/branch-guard.sh`에 `gh pr merge ... --delete-branch` 탐지·차단 추가
  (early-exit 조건에도 포함해 gh 명령에서 빠져나가지 않도록). 차단 메시지에 대안 안내:
  머지 후 `git branch -D <name>`(로컬) / `gh api -X DELETE refs/heads/<name>`(원격)을 사용자
  명시 요청 시에만.
- `branch-guard` 스킬 Anti-Patterns에 `gh pr merge --delete-branch` 금지 명시.
- 한계 기록: `gh pr merge`는 원격 API 동작이라 git-native 훅이 없으므로 Claude PreToolUse
  훅이 유일한 강제 지점 — 명령 문자열 파싱에 의존(LESSON-003 참조). `--delete-branch`는
  단순 플래그라 파싱 취약점 영향이 적음.

## Completion Criteria

- [x] TC-01: `gh pr merge <n> --merge --delete-branch` 형태가 branch-guard 훅에서 차단됨(exit 2)
- [x] TC-02: `--delete-branch` 없는 `gh pr merge`는 영향 없음(통과)
- [x] TC-03: `branch-guard` 스킬 Anti-Patterns에 금지 항목 명문화
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                                     |
| ----- | ----------- | ------------------------------------------------------------ |
| TC-01 | Integration | 훅에 모의 tool_input(JSON)을 stdin으로 주입해 exit code 검증 |
| TC-02 | Integration | `--delete-branch` 없는 명령 주입 → exit 0 확인               |
| TC-03 | Doc review  | 스킬 diff 검토                                               |
| TC-04 | Harness     | `pnpm harness:scan` 통과                                     |

## User Execution Test Scenarios

Not applicable — 개발 거버넌스(git 훅 + 스킬) 변경. 사용자 대면 런타임 동작 무변경.

## Tasks

- [x] branch-guard.sh 가드 추가 → 스킬 Anti-Patterns 추가 → 훅 stdin 테스트 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01/02 (훅 stdin 검증):** `.claude/hooks/branch-guard.sh`에 `IS_GH_DELETE_BRANCH` 탐지
  (`gh pr merge` + `--delete-branch` 동시 매칭)를 early-exit **앞**에 배치해 gh 명령에서 빠져나가지
  않도록 함. 모의 tool_input JSON을 stdin 주입한 결과 — `gh pr merge 796 --merge --delete-branch`
  → **차단(exit 2)** + 대안 안내 출력; `gh pr merge 796 --merge` → 통과(exit 0); `ls -la` → 통과(exit 0).
- **TC-03:** `branch-guard/SKILL.md` Anti-Patterns에 `--delete-branch` 금지 + 대안(`git branch -D` /
  `gh api -X DELETE`) + 훅 강제 사실 명문화.
- **한계 기록:** `gh pr merge`는 원격 API 동작이라 git-native 훅 백스톱이 없고 Claude PreToolUse 훅이
  유일한 강제 지점(LESSON-003 참조). `--delete-branch`는 단순 플래그라 명령 파싱 취약점 영향 미미.
- **TC-04:** `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — git 훅 + 스킬 거버넌스 변경(런타임 동작 무변경).

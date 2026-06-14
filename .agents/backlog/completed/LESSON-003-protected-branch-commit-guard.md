---
title: 'LESSON-003: branch-guard를 commit 단계까지 확장 — 보호 브랜치 직접 커밋 차단'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: high
urgency: soon
area: .agents/skills/branch-guard, .claude/hooks, .husky
depends_on: []
---

# LESSON-003: branch-guard를 commit 단계까지 확장

## Problem (이번 세션 실제 사건)

릴리즈 기록 파일을 마무리하며 `main`에 직접 커밋(5e11d89e2)했다. push 시점에야
branch-guard 훅이 "cannot git push on protected branch 'main'"으로 차단했고,
결국 `git reset --hard origin/main` → 별도 브랜치 생성 → PR #794 경로로 **되돌리는
정리 작업**이 필요했다.

근본 원인: branch-guard(훅 + 스킬)는 **push만 차단**하고 **commit은 허용**한다.
보호 브랜치에서 작업하다 커밋을 만들면 이미 로컬 히스토리가 오염된 뒤라 cleanup churn이 발생한다.
세션 가이드의 "If on the default branch, branch first" 원칙이 기계적으로 강제되지 않았다.

## Solution

- `.husky/pre-commit`(또는 Claude 훅)에 보호 브랜치 직접 커밋 차단/경고 추가 —
  push가 아니라 **commit 시점**에 막아 cleanup을 원천 차단.
- `branch-guard` 스킬에 "보호 브랜치에서는 커밋 전에 먼저 브랜치를 판다(branch-first)" 절차 명문화.
- 릴리즈 기록처럼 main을 향하는 doc-only 변경도 항상 브랜치→PR 경로를 쓰도록 레퍼런스 추가.
- false-positive 방지: 머지 커밋/릴리즈 자동화 등 정당한 경로 예외 처리 설계.

## Completion Criteria

- [x] TC-01: 보호 브랜치(`main`)에서 `git commit` 시도 시 pre-commit 단계에서 차단/경고됨
- [x] TC-02: feature/develop 등 비보호 브랜치 커밋은 영향 없음(false-positive 0)
- [x] TC-03: `branch-guard` 스킬에 branch-first 절차 + 보호 브랜치 커밋 금지 명문화
- [x] TC-04: 정당한 예외(머지 커밋 등) 처리 방식 문서화 + `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                      |
| ----- | ----------- | --------------------------------------------- |
| TC-01 | Integration | 임시 레포/브랜치에서 main 커밋 차단 동작 확인 |
| TC-02 | Integration | 비보호 브랜치 커밋 정상 통과 확인             |
| TC-03 | Doc review  | 스킬 diff 검토                                |
| TC-04 | Harness     | `pnpm harness:scan` 통과                      |

## User Execution Test Scenarios

Not applicable — 개발 거버넌스(git 훅 + 스킬) 변경. 사용자 대면 런타임 동작 무변경.

## Tasks

- [x] pre-commit 가드 구현 → branch-guard 스킬 업데이트 → 예외 처리 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **근본 원인 규명:** Claude PreToolUse 훅(`branch-guard.sh`)은 이미 commit을 차단하나, command
  문자열을 grep `[^"]*`로 추출하므로 멀티라인/인용부호 포함 커밋 메시지에서 추출이 깨져 main 직접
  커밋이 통과했다. 해법 = git-native 방어층.
- **TC-01/02 (end-to-end 검증):** `.husky/pre-commit`에 git-native 가드 추가. 임시 레포 테스트
  결과 — `main` 커밋 → **차단(exit 1)**, `ALLOW_PROTECTED_COMMIT=1` 우회 → 통과(exit 0),
  `feat/x` 커밋 → 통과(exit 0). (참고: `develop`는 정책상 의도적으로 보호 대상이라 차단됨 — TC-02
  문구의 "feature/develop"은 feature 브랜치 무영향을 의도; develop 차단은 branch-policy 준수.)
- **TC-03:** `branch-guard/SKILL.md`에 "Defense Layers (why two)" 절 추가 — Claude 훅의 파싱
  취약점 + git-native 백스톱, branch-first 규칙(한 줄 doc 커밋도 main 직행 금지) 명문화.
- **TC-04:** 예외 처리(merge in progress = `.git/MERGE_HEAD`, `ALLOW_PROTECTED_COMMIT=1` override)
  훅·스킬 양쪽 문서화. `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — git 훅 + 스킬 거버넌스 변경(런타임 동작 무변경).

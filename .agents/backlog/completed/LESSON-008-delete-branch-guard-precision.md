---
title: 'LESSON-008: --delete-branch 가드 정밀화 — 주석/별도 세그먼트 false-positive 제거'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: now
area: .claude/hooks/branch-guard.sh
depends_on: []
---

# LESSON-008: --delete-branch 가드 정밀화

## Problem (이번 세션 실제 사건)

LESSON-007에서 추가한 `gh pr merge --delete-branch` 차단 가드가 **false-positive**를 일으켰다.
develop→main 머지 시 `gh pr merge 800 --merge` 명령에 `# ... NEVER --delete-branch ...` 주석을
달았더니, 가드가 **주석 안의 `--delete-branch` 문자열까지 매칭**해 정상 머지를 차단했다.

근본 원인: 탐지가 `gh pr merge`와 `--delete-branch`를 **각각 독립적으로** 명령 전체에서 grep함.
따라서 (a) 주석 안의 `--delete-branch`, (b) `echo "--delete-branch"`처럼 별도 세그먼트의 문자열도
`gh pr merge`가 어딘가 있으면 함께 매칭되어 차단된다.

## Solution

탐지를 "실제 `gh pr merge` 호출의 인자로 `--delete-branch`가 올 때"로 정밀화:

- 셸 주석(` #...` ~ 줄 끝) 제거 후 검사.
- `--delete-branch`가 `gh pr merge`와 **같은 명령 세그먼트**(중간에 `;`, `|`, `&&` 없음)에 있을
  때만 매칭. 즉 `gh\s+pr\s+merge\b[^|;&]*--delete-branch` 패턴.
- 실제 금지 케이스(`gh pr merge 800 --merge --delete-branch`)는 계속 차단, 주석/echo의 문자열은 통과.

## Completion Criteria

- [x] TC-01: `gh pr merge 800 --merge --delete-branch` → 차단(exit 2) 유지
- [x] TC-02: `gh pr merge 800 --merge` + 주석에 `--delete-branch` 포함 → 통과(exit 0)
- [x] TC-03: `echo "--delete-branch"; gh pr merge 800 --merge` (별도 세그먼트) → 통과(exit 0)
- [x] TC-04: `--delete-branch` 없는 `gh pr merge` 및 무관 명령 → 통과(exit 0)
- [x] TC-05: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                       |
| ----- | ----------- | ---------------------------------------------- |
| TC-01 | Integration | 훅 stdin 픽스처 — 실제 플래그 차단 확인        |
| TC-02 | Integration | 훅 stdin 픽스처 — 주석 내 문자열 통과 확인     |
| TC-03 | Integration | 훅 stdin 픽스처 — 별도 세그먼트 echo 통과 확인 |
| TC-04 | Integration | 훅 stdin 픽스처 — 무관/플래그 없음 통과 확인   |
| TC-05 | Harness     | `pnpm harness:scan` 통과                       |

## User Execution Test Scenarios

Not applicable — git 훅 정밀화(개발 거버넌스). 런타임 동작 무변경.

## Tasks

- [x] 주석 제거 + 세그먼트 한정 탐지로 교체 → stdin 픽스처 검증 → harness:scan

## Evidence Log

### 구현 완료 — 2026-06-15

- **수정:** `branch-guard.sh`의 탐지를 교체 — (1) `sed 's/[[:space:]]#[^"]*$//'`로 셸 주석 제거,
  (2) `gh[[:space:]]+pr[[:space:]]+merge\b[^|;&]*--delete-branch` 단일 패턴으로 `gh pr merge`와
  같은 세그먼트(`;`/`|`/`&` 미개입)에 플래그가 있을 때만 매칭.
- **TC-01~04 (stdin 픽스처):**
  - 실제 플래그 `gh pr merge 800 --merge --delete-branch` → 차단(exit 2). 순서 변형
    `gh pr merge --delete-branch 800 --merge` → 차단(exit 2).
  - 주석 내 문자열(선행 주석 / trailing ` # ... --delete-branch`) → 통과(exit 0) ← 이번 false-positive 해소.
  - 별도 세그먼트 `echo use --delete-branch ; gh pr merge 800 --merge` → 통과(exit 0).
  - 플래그 없는 `gh pr merge 800 --merge`, 무관 `ls -la` → 통과(exit 0).
- **TC-05:** `pnpm harness:scan` **26/26 passed**.

User Execution Test Scenario gate: Not applicable — git 훅 정밀화(런타임 무변경).

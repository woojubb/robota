---
title: 'ARCH-FIX-017: architecture-lessons.md 해결된 감사 항목에 검증 증거 등록'
status: done
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CON-006]
---

## Problem

`architecture-lessons.md`에 여러 감사 항목이 "resolved"로 표기되어 있으나, 각 항목에 검증 증거(commit hash, test output, diff link 등)가 기록되지 않았다.

`backlog-execution.md` done gate 규칙: "resolved 항목은 검증 증거(증거 아티팩트)가 기록되어야 한다. 증거 없이 resolved 처리는 프로세스 위반이다."

증거 없는 "resolved" 표기는 실제로 수정됐는지 확인할 수 없어 아키텍처 맵의 신뢰성을 낮춘다.

## Solution

1. `architecture-lessons.md`의 resolved 항목 전체 목록을 추출한다.
2. 각 항목에 대해 실제 수정 여부를 코드베이스에서 확인한다.
3. 수정이 확인된 항목에는 commit hash 또는 PR 번호, 관련 테스트 결과를 기록한다.
4. 수정이 확인되지 않은 항목은 상태를 "open"으로 되돌리고 새 백로그 항목을 만든다.
5. 향후 항목을 resolved로 표기할 때 증거를 반드시 기록하는 정책을 `architecture-lessons.md` 상단에 명시한다.

## Test Plan

- `architecture-lessons.md`의 모든 resolved 항목에 증거 필드 존재 확인
- 증거가 없는 항목이 0건임을 확인

## User Execution Test Scenarios

Not applicable — documentation governance change. No runnable user-facing behavior change.

## Verification Evidence

Back-filled 2026-07-26 by reading `.agents/specs/architecture-map/architecture-lessons.md` end to end
(33 lines) and checking both Test Plan criteria.

**Updated items: 3. Re-opened items: 0. Items with a `resolved` status and no verification artifact: 0.**

| Fact                                    | Citation                                                                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the governance policy (Solution step 5) | `.agents/specs/architecture-map/architecture-lessons.md:7-8` — _"An item may not be marked "resolved" without a verification artifact — a commit hash, PR number, or grep-output confirming the fix is in the codebase."_ |
| `SYS-AUDIT-001`                         | `.agents/specs/architecture-map/architecture-lessons.md:16` — `Status: resolved — PR #313 (2d6a4f569).`                                                                                                                   |
| `SYS-AUDIT-005`                         | `.agents/specs/architecture-map/architecture-lessons.md:23` — ``Status: resolved — `INFRA-BL-006`, commit `f9e388fd7`.``                                                                                                  |
| `SYS-AUDIT-006`                         | `.agents/specs/architecture-map/architecture-lessons.md:30` — `Status: resolved — PR #315 (eb658beb4).`                                                                                                                   |

The count of 0 re-opened items is a real result, not an omission: the file records no item whose
evidence failed to substantiate its `resolved` status.

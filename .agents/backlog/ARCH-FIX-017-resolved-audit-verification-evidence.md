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

(완료 후 업데이트된 항목 수와 재오픈된 항목 수 기록)

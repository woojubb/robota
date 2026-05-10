---
title: 'ARCH-FIX-019: CLI-AUDIT-003 partially resolved 후속 작업 백로그화'
status: todo
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CLI-003]
---

## Problem

`architecture-map/agent-cli/layering-audit.md`에 `CLI-AUDIT-003`이 "partially resolved" 상태로 표기되어 있으나, 잔여 후속 작업을 추적하는 백로그 파일 링크가 없다.

후속 작업이 산문 형태로 감사 문서 내에만 존재하면:

1. 언제 완료되었는지 추적할 수 없다.
2. done gate를 적용할 수 없다.
3. 새 기여자가 잔여 작업을 모르고 지나칠 수 있다.

## Solution

1. `layering-audit.md`에서 `CLI-AUDIT-003`의 "partially resolved" 후속 작업 내용을 파악한다.
2. 각 잔여 작업에 대해 적절한 백로그 항목을 생성한다 (기존 백로그와 중복이면 링크만 추가).
3. `layering-audit.md`의 `CLI-AUDIT-003` 항목에 백로그 링크를 추가한다.
4. 후속 백로그가 모두 완료되면 `CLI-AUDIT-003` 상태를 "resolved"로 갱신하고 증거를 기록한다.

## Test Plan

- `layering-audit.md`의 `CLI-AUDIT-003`에 백로그 링크 존재 확인
- 링크된 백로그 항목이 실제로 존재하는지 확인

## User Execution Test Scenarios

Not applicable — documentation governance change. No runnable user-facing behavior change.

## Verification Evidence

(완료 후 생성된 백로그 항목 목록 및 layering-audit.md 업데이트 기록)

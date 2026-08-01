---
title: 'ARCH-AUDIT-006: cross-cutting-contracts.md 계약 인덱스에 events/sessions/storage 행 추가'
status: done
created: 2026-05-09
priority: high
urgency: soon
area: documentation
---

## Problem

`ARCHITECTURE-MAP.md` 8번 지침과 `README.md`는 `cross-cutting-contracts.md`가 "events, sessions, storage" 계약을 다룬다고 명시하나, 실제 Contract Owner Index 표에 해당 행이 없다.

변경 시 어느 SPEC을 먼저 수정할지 불명확하여 spec-first 원칙 적용이 어렵다.

## Solution

Contract Owner Index에 다음 행을 추가한다:

- events → 소유: `agent-core`
- sessions → 소유: `agent-sessions`
- storage → 소유: 해당 port 계층 (실제 SPEC.md 확인 후 결정)

## Test Plan

- 각 계약의 실제 소유 패키지 SPEC.md 확인 후 표와 일치하는지 검증

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

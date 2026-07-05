---
title: 'CORE-025: permissionPolicy 집행 구현 (preapproved/prompt/deny 실동작)'
status: todo
created: 2026-07-04
priority: high
urgency: soon
area: packages/agent-executor, packages/agent-framework
depends_on: []
---

# permissionPolicy 집행 구현 (preapproved/prompt/deny 실동작)

Re-audit P2-11 (CONTRACT-004). permissionPolicy가 죽은 필수 필드(쓰기 전부 'inherit-allowlist'
리터럴, 읽기 0곳). 처분: 집행 구현(배선) — 선행 제공 원칙 + PRESET-004 permission profile 계약
정합. SPEC 확정 선행(집행 시맨틱).

## What

1. SPEC: 4개 정책 값의 집행 시맨틱 확정.
2. 백그라운드 태스크 권한 경로에 정책 리더 구현; 스포너에 정책 전달 표면 노출.

## Test Plan

- 정책별 권한 분기 테스트(deny 즉시 거부, prompt 발신, preapproved 통과).

## User Execution Test Scenarios

- agent-executable. 라이브 백그라운드 태스크 deny 정책 spawn → 권한 요청 즉시 거부 실측;
  preapproved 재실행 → 통과 실측.
- Evidence: (record after execution)

---
title: 'INFRA-026: develop-PR CI에 harness:scan 배선 + pre-push 하네스 전체 스위트'
status: todo
created: 2026-07-04
priority: high
urgency: now
area: .github/workflows, scripts/harness
depends_on: []
---

# develop-PR CI에 harness:scan 배선 + pre-push 하네스 전체 스위트

Re-audit P1-1 (GATE-001/002, HARNESS-021 동형). 45종 스캔이 develop-PR CI green 경로에 없고
(quality 잡 = harness:verify 3종 + harness:test뿐), pre-push의 harness-tests는 29개 테스트 중
11개 하드코딩 목록만 실행한다. CI 워크플로 변경은 사용자 사전 승인 완료(2026-07-04 안건 2).

## What

1. `.github/workflows/ci.yml` quality 잡에 `pnpm harness:scan` 스텝 추가.
2. `scripts/harness/verify-change.mjs`의 하드코딩 11개 목록을 전체 스위트 실행으로 교체.
3. Prove: 위반 fixture로 red 실측 후 제거하고 green.

## Test Plan

- 하네스 스위트 green; verify-change가 전체 테스트를 실행함을 로그로 확인.

## User Execution Test Scenarios

- agent-executable. 위반 fixture 커밋으로 실제 PR을 열어 CI red 실측 → revert 후 green 확인.
- Evidence: (record after execution)

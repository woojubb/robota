---
title: 'HARNESS-024: env-gated 프로바이더 라이브 스모크 1콜 + 로컬/CI 검증 정렬'
status: todo
created: 2026-07-04
priority: medium
urgency: soon
area: scripts/harness, .github/workflows
depends_on: ['INFRA-026']
---

# env-gated 프로바이더 라이브 스모크 1콜 + 로컬/CI 검증 정렬

Re-audit P2-15 (GATE-005/006). 프로바이더·전송 경계 전부 mock — IPC usage·Anthropic 400·
maxTokens 부류를 수동 라이브만 잡은 전력 3회. 로컬/CI 검증 범위 양방향 불일치. CI job 추가는
사용자 사전 승인 완료(안건 2 포괄).

## What

1. env-gated 라이브 스모크 1콜 스크립트 + 스케줄드 CI job(키 부재 skip).
2. 로컬/CI 비대칭(cli:dev 스모크, pnpm audit) 해소 방안 문서화.

## Test Plan

- 키 존재 실호출 성공 / 부재 skip 실측.

## User Execution Test Scenarios

- agent-executable. 스모크 자체가 라이브 1콜 — 로컬 키 실행 성공 + 키 제거 환경 skip 종료코드
  실측.
- Evidence: (record after execution)

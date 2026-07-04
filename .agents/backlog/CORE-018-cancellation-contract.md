---
title: 'CORE-018: 취소 계약: IToolExecutionContext에 AbortSignal + runStream signal threading'
status: todo
created: 2026-07-04
priority: high
urgency: now
area: packages/agent-core, packages/agent-tools, packages/agent-tool-mcp
depends_on: []
---

# 취소 계약: IToolExecutionContext에 AbortSignal + runStream signal threading

Re-audit P1-3 (RUNTIME-06/07; RUNTIME-03/23/37의 공통 뿌리). IToolExecutionContext에 signal이
없어 실행 중 Shell(120s)/WebFetch/MCP(30s)를 중단할 수 없고, runStream은 인라인 컨텍스트와
executeStream chatOptions 두 층에서 signal을 유실해 공개 스트리밍 API가 취소 불가다.
SPEC 확정 선행(계약 필드 추가).

## What

1. SPEC: IToolExecutionContext.signal 계약 확정 (agent-core SPEC).
2. runStream: buildRunContext 재사용으로 인라인 유실 제거 + executeStream chatOptions signal.
3. 도구 실행 배치와 개별 도구(Shell kill, fetch AbortSignal.any, MCP 요청)에서 signal honor.
4. 큐 대기 abort(RUNTIME-23)/서브에이전트 전파(RUNTIME-37)와의 경계 명시.

## Test Plan

- run/runStream abort 전파 단위 테스트, 도구별 signal honor 테스트.

## User Execution Test Scenarios

- agent-executable (scratch/src + packages/agent-cli/.env 키). 라이브 스트리밍 중 abort() 호출로
  진행 중 Shell 도구 즉시 종료 + 스트림 종료 실측.
- Evidence: (record after execution)

---
title: 'CORE-018: 취소 계약: IToolExecutionContext에 AbortSignal + runStream signal threading'
status: done
completed: 2026-07-04
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
- Evidence: **PASS (live, 2026-07-04, real Anthropic claude-haiku-4-5).** Probe
  `scratch/src/core-018-user-execution.ts`: 모델이 Shell 도구로 `sleep 120`을 실행 → pgrep
  폴링이 child 관측 시점에 abort 발화 → **런이 120초 대신 2.0초에 절단**(`toolStarted=true
elapsedMs=2019`), 직계 셸 child 종료, 스트림 종료 — `CORE-018-OK`. 라이브 게이트가 이번에도
  실결함을 추가 적발: 스트림 경로의 도구 배치(executeStreamToolCalls)가 signal을 받지 않는
  4번째 유실 지점 — 본 작업에서 배선. 손자 프로세스(sleep) 생존은 프로세스그룹 kill 부재
  (RUNTIME-03)로 **CORE-023 스코프의 라이브 재확인**이며 프로브에 handoff로 명기.
  구현: SPEC `Cancellation Contract` 신설(agent-core) → `IToolExecutionContext.signal` 계약;
  배치 실행기 병렬/순차 경로 스레딩(+순차 경로 abort 게이트); runStream 인라인 컨텍스트를
  `buildRunContext` 재사용으로 교체(signal/onTextDelta/onExecutionEvent 유실 일소);
  `executeStream` chatOptions + 스트림 도구 배치에 signal; 도구 honor — Shell(child kill,
  사전 abort 단락), WebFetch/WebSearch(`AbortSignal.any`로 타임아웃과 결합), MCP(요청 abort +
  재시도 루프 abort 단락). Durable artifacts:
  `packages/agent-core/src/interfaces/tool.ts`, `services/tool-execution-batch.ts`,
  `services/execution-stream.ts`, `services/execution-stream-tools.ts`,
  `core/robota-execution.ts`, `core/robota.test.ts`(cancellation describe 2),
  `packages/agent-tools/src/builtins/{shell-tool,web-fetch-tool,web-search-tool}.ts`,
  `packages/agent-tools/src/builtins/__tests__/shell-tool-cancellation.test.ts`(2),
  `packages/agent-tool-mcp/src/{mcp-tool,mcp-protocol}.ts`,
  `packages/agent-core/docs/SPEC.md`(§ Cancellation Contract). core 827/tools/mcp 및 전체
  스위트 green; typecheck 0; 45 스캔; lint 0 errors.

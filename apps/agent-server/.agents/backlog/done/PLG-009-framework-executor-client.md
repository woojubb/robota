---
title: 'PLG-009: Framework Executor Client — PlaygroundExecutor를 PLG-015 SSE 엔드포인트 기반으로 교체'
status: done
created: 2026-05-19
priority: high
urgency: soon
area: packages/agent-playground
depends_on: [PLG-015]
---

## Background

현재 `PlaygroundExecutor`는 `RemoteExecutor`를 통해 `/api/v1/remote/chat`을 호출하는
브라우저사이드 Robota 인스턴스를 사용한다. tool calling 루프가 브라우저에서 실행되고
스트리밍이 없어 UI 반응성이 낮다.

PLG-015에서 서버사이드 SSE 실행 API가 구축되면, 이 작업은 PlaygroundExecutor 내부를
새 엔드포인트를 호출하는 SSE 클라이언트로 교체한다. 외부 인터페이스(`createAgent`,
`updateAgentToolsFromCard`, `run`)는 유지하여 UI 레이어 변경을 최소화한다.

## Goals

1. `PlaygroundExecutor.run(prompt)` 내부를 교체:
   - 기존: 브라우저 Robota 인스턴스 → RemoteExecutor → `/api/v1/remote/chat`
   - 신규: `POST /api/playground/execute` SSE 스트림 consume
2. SSE 이벤트 파싱 → `IConversationEvent` 변환:
   - `text_delta` → `assistant_response` 이벤트 (스트리밍 조각 누적)
   - `tool_call_start` → `tool_call_start` 이벤트
   - `tool_call_complete` → `tool_call_complete` 이벤트
   - `error` → `tool_call_error` 이벤트
   - `done` → 완료 신호
3. `createAgent(config)`: 서버 호출 없음 — 로컬에 config 저장만 (stateless 모델)
4. `updateAgentToolsFromCard(agentId, card)`: 로컬 tool 목록 업데이트 (서버 호출 불필요)
5. BYOK 키 전달: `PlaygroundExecutor` 생성 시 `apiKey` 옵션으로 받아 SSE 요청 시
   `X-Provider-API-Key` 헤더에 설정 (절대 로그 미기록)
6. `PlaygroundWebSocketClient` 의존성 제거 (RemoteExecutor 방식 완전 폐기)
7. PLG-016 카탈로그 API를 사용해 provider/model 목록을 동적으로 로드하는
   `fetchProviderCatalog()` 유틸 함수 추가

## Non-Goals

- WebSocket 서버(`/ws/playground`) 제거 (다른 용도로 사용 중일 수 있음)
- UI 레이어 변경 (PlaygroundContext, PlaygroundApp 등)
- 스트리밍 UI 렌더링 (청크 단위 텍스트 표시) — 별도 UX 작업

## Architecture

```
packages/agent-playground/src/lib/playground/
├── robota-executor/
│   ├── playground-executor.ts    ← 내부 교체, 인터페이스 유지
│   ├── sse-client.ts             ← NEW: SSE fetch + 이벤트 파싱
│   ├── event-mapper.ts           ← NEW: SSE 이벤트 → IConversationEvent 변환
│   └── remote-providers.ts       ← DELETED (RemoteExecutor 폐기)
└── catalog-client.ts             ← NEW: /api/playground/catalog/* 조회
```

## Test Plan

- 단위 테스트:
  - `event-mapper.ts`: 각 SSE 이벤트 타입 → IConversationEvent 변환 검증
  - `sse-client.ts`: ReadableStream mock으로 파싱 로직 검증
  - `PlaygroundExecutor.run()`: SSE 스트림 mock → 이벤트 dispatch 검증
- 통합 테스트: Playwright — 에이전트 생성 → 채팅 → 이벤트 수신 확인
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 채팅 실행 + 실시간 이벤트

**Prerequisites**: `pnpm dev` (agent-web), `pnpm start` (agent-server), OpenAI API 키 설정

**Steps**:

1. `http://localhost:7071/playground` 접속
2. "Create Agent" → Provider: OpenAI, Model: gpt-4o-mini, API Key 입력 → Create
3. Workflow 영역에 "Current Time" tool 드래그
4. 채팅 입력: "What is the current time in Seoul?"
5. AI 응답 확인

**Expected observable result**:

- 채팅 응답에 실제 현재 시각(KST) 포함
- Workflow에 `tool_call_start` → `tool_call_complete` → `assistant_response` 노드 표시
- 브라우저 콘솔에 API 키 관련 로그 없음

**Evidence**: `<스크린샷 — 구현 후 기입>`

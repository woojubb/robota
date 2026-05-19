---
title: 'PLG-015: Playground Execution API — POST /api/playground/execute SSE 스트리밍 에이전트 실행'
status: done
created: 2026-05-19
priority: high
urgency: soon
area: apps/agent-server
depends_on: [PLG-017, PLG-018]
---

## Background

현재 Playground의 에이전트 실행 구조는 다음과 같다:

```
Browser: Robota agent (tool calling loop)
  └── RemoteExecutor → /api/v1/remote/chat (단순 AI 프록시)
```

문제점:

- tool calling 루프가 브라우저에서 실행 → 스트리밍 없음, request/response 방식
- 서버는 AI provider 프록시 역할만 하고 에이전트 로직 없음
- 이벤트가 실시간으로 UI에 전달되지 않음 (tool_call_start/complete 지연)

이 작업은 에이전트 실행 전체(tool calling 루프 포함)를 서버사이드로 이전하고
SSE(Server-Sent Events)로 실행 이벤트를 실시간 스트리밍하는 전용 엔드포인트를 구현한다.

## Goals

1. `POST /api/playground/execute` 엔드포인트 구현 (SSE streaming)

   **Request**:

   ```typescript
   interface IPlaygroundExecuteRequest {
     provider: string; // 'openai' | 'anthropic' | ...
     model: string; // 'gpt-4o-mini'
     tools: string[]; // ['current-time'] — PLG-017 registry ID
     systemPrompt?: string;
     message: string;
     history?: IHistoryEntry[]; // 멀티턴 대화 컨텍스트
   }
   interface IHistoryEntry {
     role: 'user' | 'assistant';
     content: string;
   }
   ```

   **Headers**:
   - `X-Provider-API-Key`: BYOK 키 (없으면 서버 환경변수 키 사용, 둘 다 없으면 401)
   - 해당 헤더는 **절대 로그에 기록하지 않음** (PLG-018 sanitizer 미들웨어 적용)

   **Response** (Content-Type: text/event-stream):

   ```
   data: {"type":"text_delta","data":{"text":"안녕하세요"}}

   data: {"type":"tool_call_start","data":{"id":"call_abc","name":"current-time","input":{}}}

   data: {"type":"tool_call_complete","data":{"id":"call_abc","output":"2026-05-19T10:30:00+09:00"}}

   data: {"type":"text_delta","data":{"text":"현재 시각은 10시 30분입니다."}}

   data: {"type":"done","data":{"usage":{"promptTokens":120,"completionTokens":45}}}
   ```

   오류 시:

   ```
   data: {"type":"error","data":{"message":"API key invalid"}}
   ```

2. 서버사이드 `@robota-sdk/agent-framework` 기반 에이전트 인스턴스 생성 및 실행
   - 요청마다 새 인스턴스 생성 (stateless)
   - PLG-017 tool registry에서 tool 실행 함수 조회
   - tool calling 루프 완전 처리 후 각 이벤트를 SSE로 즉시 전송

3. BYOK + 서버 키 양쪽 모드 지원:
   - `X-Provider-API-Key` 있으면 BYOK 모드
   - 없으면 서버 환경변수 키 사용 (demo 모드)
   - 둘 다 없으면 `401 Unauthorized`

4. 요청당 타임아웃: 60초 (초과 시 `{"type":"error","data":{"message":"Execution timeout"}}` 후 스트림 종료)

5. Rate limiting: 기존 전역 limiter와 별도로 `/api/playground/execute`에 추가 제한 적용
   (기본: 분당 20회/IP)

## Non-Goals

- 서버사이드 세션 상태 유지 (stateless 설계, 멀티턴은 클라이언트가 history 전송)
- 스트리밍 재연결/재시도 관리 (클라이언트 책임)
- MCP tool 실행

## Architecture

```
POST /api/playground/execute
  └── byok-sanitizer middleware (PLG-018)
  └── PlaygroundExecuteHandler
        ├── resolveProvider()     ← BYOK 키 or 서버 키로 provider 인스턴스 생성
        ├── resolveTools()        ← PLG-017 tool registry에서 tool 함수 로드
        ├── createAgentSession()  ← @robota-sdk/agent-framework InteractiveSession
        └── streamEvents()        ← SSE write loop
              ├── on text_delta   → write SSE
              ├── on tool_call_*  → write SSE
              └── on done/error   → write SSE + close
```

## Test Plan

- 단위 테스트:
  - `resolveProvider()`: BYOK 키 있을 때 / 서버 키만 있을 때 / 둘 다 없을 때 분기
  - `resolveTools()`: 존재하는 tool ID / 없는 tool ID 처리
  - SSE 이벤트 직렬화 형식 검증
- 통합 테스트:
  - curl --no-buffer로 SSE 스트림 수신 확인
  - tool calling 흐름 (current-time tool 사용) 전체 이벤트 순서 검증
  - 타임아웃 동작 확인
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: SSE 스트리밍 실행 (BYOK)

**Prerequisites**: `apps/agent-server` 실행 중, 유효한 OpenAI API 키 보유

**Steps**:

```bash
curl -N -X POST http://localhost:3001/api/playground/execute \
  -H "Content-Type: application/json" \
  -H "X-Provider-API-Key: sk-..." \
  -d '{
    "provider": "openai",
    "model": "gpt-4o-mini",
    "tools": ["current-time"],
    "systemPrompt": "You are a helpful assistant.",
    "message": "What time is it now in Seoul?"
  }'
```

**Expected observable result**:

```
data: {"type":"tool_call_start","data":{"id":"call_xxx","name":"current-time","input":{}}}

data: {"type":"tool_call_complete","data":{"id":"call_xxx","output":"2026-05-19T10:30:00+09:00"}}

data: {"type":"text_delta","data":{"text":"현재 서울 시각은 2026년 5월 19일 오전 10시 30분입니다."}}

data: {"type":"done","data":{"usage":{"promptTokens":150,"completionTokens":30}}}
```

- 이벤트가 실시간으로 스트리밍됨 (청크 단위)
- tool_call_start → tool_call_complete → text_delta → done 순서
- 응답에 실제 현재 시각 포함

**Evidence**: `<curl 출력 캡처 — 구현 후 기입>`

### Scenario 2: 키 없을 때 401 반환

**Prerequisites**: `apps/agent-server` 실행 중, 서버에 API 키 환경변수 없음

**Steps**:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  http://localhost:3001/api/playground/execute \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o-mini","tools":[],"message":"hello"}'
```

**Expected observable result**: `401`

**Evidence**: `<출력 캡처 — 구현 후 기입>`

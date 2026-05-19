---
title: 'PLG-F-002: 실행 엔진 마이그레이션 — InteractiveSession 기반 서버 실행'
status: todo
created: 2026-05-19
priority: high
urgency: now
area: apps/agent-server, packages/agent-playground
depends_on: []
---

## Background

현재 `playground-execute.ts`는 `provider.chat()` 직접 루프로 동작한다.
이 방식은 agent-framework가 제공하는 고수준 기능(멀티턴 세션 관리, 자동 tool-calling 루프,
이벤트 스트리밍, 컨텍스트 관리)을 모두 직접 재구현한 것이다.

`InteractiveSession`을 사용하면 이 로직을 완전히 교체할 수 있다.
더불어 conversation history가 서버에서 `InteractiveSession` 내부에 관리되므로
클라이언트가 매 요청마다 전체 history를 전송할 필요가 없어진다.

## Goals

1. 서버에 세션 생명주기 관리 추가:
   - `POST /api/playground/sessions` → 새 `InteractiveSession` 생성, `sessionId` 반환
   - `DELETE /api/playground/sessions/:id` → 세션 종료 (`session.shutdown()`)
   - 서버 메모리 내 세션 맵 (`Map<sessionId, InteractiveSession>`)
   - 세션 타임아웃: 30분 비활성 시 자동 종료

2. 기존 `POST /api/playground/execute` 교체:
   - 기존: 매 요청마다 provider 직접 생성 + 수동 tool-calling 루프
   - 변경: `POST /api/playground/sessions/:id/submit` — 기존 세션에 `session.submit(message)`
   - SSE 스트리밍: `session.on('text_delta')`, `session.on('tool_call_start')` 등 이벤트로 전달

3. 도구 등록을 InteractiveSession 방식으로 전환:
   - 기존: `toolSchemas` 배열 직접 주입
   - 변경: tool factory 함수로 tool 등록 (`@robota-sdk/agent-tools` 사용)

4. 클라이언트(`robota-executor.ts`) 업데이트:
   - 에이전트 생성 시 → `POST /sessions` 호출, sessionId 저장
   - 메시지 전송 시 → `POST /sessions/:id/submit` 호출
   - 에이전트 삭제 시 → `DELETE /sessions/:id` 호출

5. 기존 `POST /api/playground/execute` 유지 (하위 호환용 byok 라우트는 유지)

## Non-Goals

- 세션 영속성 (DB 저장) — 메모리 세션만으로 충분
- 세션 공유 (사용자 간 세션 격리는 이 작업 이후)

## Architecture

```
apps/agent-server/src/
├── routes/playground.ts          ← 새 세션 라우트 추가
├── routes/handlers/
│   ├── playground-execute.ts     ← 기존 (byok 전용으로 축소)
│   ├── session-create.ts         ← NEW: POST /sessions
│   ├── session-submit.ts         ← NEW: POST /sessions/:id/submit (SSE)
│   └── session-delete.ts         ← NEW: DELETE /sessions/:id
└── session/
    └── session-manager.ts        ← NEW: Map<id, InteractiveSession> + 타임아웃

packages/agent-playground/src/
├── lib/playground/
│   └── robota-executor.ts        ← 업데이트: session 생명주기 API 호출
└── hooks/
    └── use-robota-execution.ts   ← 업데이트: session 기반 실행 흐름
```

## Test Plan

- 단위 테스트:
  - `SessionManager`: 생성/조회/삭제/타임아웃 동작
  - session submit 핸들러: SSE 이벤트 포맷 검증
- 통합 테스트:
  - `POST /sessions` → `POST /sessions/:id/submit` → `DELETE /sessions/:id` 흐름
  - tool calling 이벤트 SSE 스트리밍 검증
- `pnpm typecheck && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 멀티턴 대화

**Prerequisites**: 서버 실행, 에이전트 생성

**Steps**:

1. 에이전트 생성 → 메시지 "안녕하세요" 전송
2. 응답 확인 후 "방금 내가 뭐라고 했어?" 전송

**Expected observable result**:

- 두 번째 응답에서 첫 번째 메시지("안녕하세요")를 기억하고 답변
- 매 요청마다 history가 재전송되지 않고 서버 세션이 유지됨 (Network 탭에서 확인)

**Evidence**: `<스크린샷 — 구현 후 기입>`

### Scenario 2: 도구 호출 포함 멀티턴

**Prerequisites**: Current Time 도구 추가된 에이전트

**Steps**:

1. "지금 몇 시야?" 전송 → tool_call_start / tool_call_complete 이벤트 확인
2. "방금 알려준 시간 기억해?" 전송

**Expected observable result**:

- 도구 호출 결과가 대화 맥락에 유지됨
- 두 번째 메시지에서 첫 번째 답변의 시간을 참조함

**Evidence**: `<스크린샷 — 구현 후 기입>`

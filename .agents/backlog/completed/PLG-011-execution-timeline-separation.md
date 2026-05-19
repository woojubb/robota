---
title: 'PLG-011: Execution Timeline 분리 — 조립 캔버스와 실행 트레이스를 별도 영역으로'
status: done
created: 2026-05-19
priority: medium
urgency: later
area: apps/agent-web, packages/agent-playground
depends_on: [PLG-010]
---

## Background

PLG-010에서 React Flow 캔버스는 Assembly(조립) 전용이 된다.
현재 캔버스에 표시되는 실행 이벤트(user_message, tool_call_start, tool_call_complete,
assistant_response)는 별도 영역으로 분리해야 한다.

조립 캔버스와 실행 트레이스가 같은 공간에 있으면:

- 조립 상태를 보면서 실행 결과를 동시에 확인하기 어렵다
- 실행 이벤트 노드들이 AgentNode/ToolNode와 시각적으로 섞인다

이 작업은 실행 이벤트를 전용 "Execution Timeline" 컴포넌트로 분리한다.

## Goals

1. `ExecutionTimeline` 컴포넌트 구현:
   - 레이아웃: 세로 스크롤 타임라인 (React Flow 대신 일반 DOM 리스트)
   - 각 이벤트 타입별 카드:
     - `user_message`: 파란색 우측 정렬 말풍선
     - `assistant_response`: 회색 좌측 정렬 말풍선 (마크다운 렌더링)
     - `tool_call_start`: 도구 아이콘 + tool 이름 + input JSON (collapsible)
     - `tool_call_complete`: 결과 값 (collapsible)
     - `tool_call_error`: 빨간색 오류 메시지
   - 새 이벤트 추가 시 자동 스크롤 (최신 이벤트가 항상 보임)

2. Playground 레이아웃 재구성:
   - 좌측 패널: Assembly Canvas (AgentNode + ToolNode)
   - 우측 상단: Chat 입력창 (기존 유지)
   - 우측 하단: Execution Timeline (신규)
   - 또는: 탭 방식으로 Assembly / Timeline 전환 (사용자 선호에 따라 결정)

3. `workflow-visualization.tsx`의 실행 이벤트 렌더링 로직을 `ExecutionTimeline`으로 이전
   - `eventsToFlow()` 함수는 더 이상 필요 없음 (제거 or PLG-010 용으로 축소)
   - 기존 ReactFlow 기반 workflow 노드 타입들(`UserMessageNode` 등)은 제거

4. `IConversationEvent` 스트림을 `ExecutionTimeline`이 구독하도록 연결

## Non-Goals

- 채팅 입력 UI 변경 (별도 작업)
- 타임라인 이벤트 필터링/검색
- 이벤트 export

## Architecture

```
packages/agent-playground/src/components/playground/
├── assembly-canvas/          ← PLG-010 (조립 캔버스)
├── execution-timeline/
│   ├── execution-timeline.tsx      ← NEW: 타임라인 컨테이너
│   └── event-cards/
│       ├── user-message-card.tsx   ← NEW
│       ├── assistant-card.tsx      ← NEW (마크다운 렌더링)
│       ├── tool-call-card.tsx      ← NEW (collapsible)
│       └── tool-error-card.tsx     ← NEW
└── workflow-visualization/         ← DELETED or 축소

apps/agent-web/src/app/playground/
└── page.tsx                  ← 레이아웃 재구성 (좌: Canvas, 우: Chat+Timeline)
```

## Test Plan

- 단위 테스트:
  - 각 event card 컴포넌트 렌더링 (props 기반 snapshot)
  - 자동 스크롤 동작 (마지막 이벤트 visible 확인)
- Playwright E2E:
  - 채팅 실행 후 timeline에 user_message → tool_call → assistant_response 순서로 표시
  - tool_call_start 카드에 input JSON 표시, 클릭 시 collapse/expand
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: 실행 타임라인 확인

**Prerequisites**: PLG-009, PLG-010 완료, `pnpm dev`, `pnpm start`, API 키 설정

**Steps**:

1. `http://localhost:7071/playground` 접속
2. 에이전트 생성, Current Time tool 연결
3. 채팅 입력: "현재 서울 시각을 알려줘"
4. Execution Timeline 영역 확인

**Expected observable result**:

- 타임라인에 순서대로: 사용자 메시지 카드 → tool_call_start(getCurrentTime) 카드 → tool_call_complete 카드 → AI 응답 카드
- tool_call 카드의 input/output이 collapsible JSON으로 표시
- Assembly Canvas는 영향 없이 AgentNode + ToolNode 유지

**Evidence**: `<스크린샷 — 구현 후 기입>`

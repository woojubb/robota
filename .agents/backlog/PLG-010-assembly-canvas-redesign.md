---
title: 'PLG-010: Assembly Canvas 재설계 — AgentNode + ToolNode + 엣지 연결 도구 주입'
status: todo
created: 2026-05-19
priority: high
urgency: later
area: apps/agent-web, packages/agent-playground
depends_on: [PLG-009]
---

## Background

현재 Playground의 React Flow 캔버스는 실행 이벤트(user message, tool_call, assistant_response)만
표시하는 "Workflow Visualization" 용도다. 에이전트 조립(assembly) 기능이 없다.

PLG-008 비전에서 캔버스는 두 가지 역할을 가진다:

1. **Assembly**: provider + model + tools + skills를 시각적으로 조립
2. **Execution Timeline**: 실행 이벤트 시각화 (PLG-011에서 분리)

이 작업은 캔버스를 Assembly 전용으로 재설계한다. AgentNode(에이전트 설정 표시)와
ToolNode(연결된 tool 표시)를 추가하고, 엣지로 연결하면 tool이 에이전트에 주입된다.

## Goals

1. `AgentNode` 커스텀 노드 타입 구현:
   - 표시: provider 아이콘, model 이름, system prompt 미리보기 (truncated)
   - 편집: 노드 클릭 시 사이드 패널에서 provider/model/system prompt 수정
   - 상태: 연결된 tool 수 badge

2. `ToolNode` 커스텀 노드 타입 구현:
   - 표시: tool 이름, tool 설명 요약, 파라미터 수
   - 소스: Tools 패널에서 드래그하거나 캔버스에서 직접 추가

3. 엣지 연결 동작:
   - ToolNode → AgentNode 엣지 생성 시 `injectToolIntoAgent()` 호출
   - 엣지 삭제 시 tool 제거
   - 연결 핸들: AgentNode 좌측(tool 입력), ToolNode 우측(출력)

4. 캔버스 레이아웃:
   - 캔버스 좌측: AgentNode (1개, 중앙 배치)
   - 캔버스 우측: ToolNode 들 (연결된 tool 수만큼 세로 배열, auto-layout)
   - 초기 상태: "Create Agent" 완료 시 AgentNode 자동 생성

5. 현재 `workflow-visualization.tsx`의 실행 이벤트 노드 표시는 PLG-011에서 분리될 때까지
   임시로 별도 탭 또는 토글로 유지

## Non-Goals

- multi-agent 캔버스 (에이전트 노드 여러 개 동시에)
- skill 노드 (PLG-014에서 추가)
- 캔버스 상태 서버 저장

## Architecture

```
packages/agent-playground/src/components/playground/
├── assembly-canvas/
│   ├── assembly-canvas.tsx           ← NEW: 조립 전용 ReactFlow 캔버스
│   ├── nodes/
│   │   ├── agent-node.tsx            ← NEW: AgentNode
│   │   └── tool-node.tsx             ← NEW: ToolNode
│   └── hooks/
│       └── use-assembly-layout.ts    ← NEW: 노드 자동 레이아웃
└── workflow-visualization/           ← 기존 (PLG-011에서 분리 예정)
```

## Test Plan

- 단위 테스트:
  - `AgentNode` 렌더링: provider/model/systemPrompt props 표시 검증
  - `ToolNode` 렌더링: tool 이름/설명 표시 검증
  - 엣지 연결 → `injectToolIntoAgent()` 호출 확인
- Playwright E2E:
  - "Create Agent" → AgentNode 자동 생성 확인
  - ToolNode 드래그 → AgentNode에 엣지 연결 → tool badge 업데이트 확인
- `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Assembly Canvas 조립

**Prerequisites**: `pnpm dev` (agent-web), `pnpm start` (agent-server)

**Steps**:

1. `http://localhost:7071/playground` 접속
2. "Create Agent" → Provider: OpenAI, Model: gpt-4o-mini → Create
3. 캔버스에 AgentNode 생성 확인 (provider 아이콘 + model 이름 표시)
4. 오른쪽 Tools 패널에서 "Current Time" 카드를 캔버스로 드래그
5. ToolNode가 캔버스에 추가됨 확인
6. ToolNode를 AgentNode로 드래그하여 엣지 연결
7. AgentNode에 tool badge("1 tools") 표시 확인
8. 채팅 입력: "What time is it now?"
9. AI가 current-time tool 호출하고 응답 반환 확인

**Expected observable result**:

- AgentNode에 provider(OpenAI), model(gpt-4o-mini) 표시
- 엣지 연결 후 AgentNode badge "1 tools"
- 채팅 응답에 현재 시각 포함

**Evidence**: `<스크린샷 — 구현 후 기입>`

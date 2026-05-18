---
title: 'PLG-008: Visual Agent Builder — agent-framework 기반 Playground 재구축'
status: todo
created: 2026-05-19
priority: high
urgency: later
area: apps/agent-web, packages/agent-playground
depends_on: []
---

## Background

현재 Playground는 구형 아키텍처로 구현되어 있다. Create Agent → React Flow에 agent 노드 생성
→ 오른쪽 Tools 패널에서 tool을 에이전트 노드로 드래그 → 주입된 상태로 채팅 실행. 이 흐름은
개념은 올바르나 구현이 agent-framework가 아닌 레거시 코드 위에 얹혀 있어 신뢰성이 낮다.

목표: Playground를 **agent-framework 위에서** 다시 만들어 tools / skills를 실시간으로 조립하고,
완성된 조합을 **복사 가능한 코드**(TypeScript snippet)로 내보낼 수 있는 Visual Agent Builder로
발전시킨다. agent-cli 패키지가 agent-framework 위에 올라간 방식과 동일한 계층 구조를 따른다.

## Goals

1. **agent-framework 기반 실행 엔진**: `@robota-sdk/agents` (또는 후속 core)를 직접 사용해
   에이전트 인스턴스를 브라우저에서 생성·실행.
2. **Visual Assembly UI**: React Flow 캔버스에서 agent 노드 생성 후 tool/skill 노드를 연결해
   의존성을 시각적으로 구성.
3. **Drag-and-Drop Tool Injection**: Tools 패널 → agent 노드로 드래그 시 framework API를 통해
   실시간으로 도구를 주입. 현재 `updateAgentToolsFromCard` 방식을 framework 공개 API로 대체.
4. **Real-time Chat + Workflow Trace**: 채팅 입력 → agent 실행 → tool calling 이벤트가 React
   Flow에 실시간으로 노드/엣지로 시각화.
5. **Code Export**: 현재 캔버스 조합(provider, model, tools, system prompt)을 그대로 재현하는
   TypeScript 코드 스니펫을 클립보드에 복사.

## Non-Goals

- agent 간 orchestration / multi-agent flow (별도 백로그로 분리)
- MCP 서버 연결 UI (후속 작업)
- 저장/불러오기 persistence (로컬스토리지 이후 단계)

## Scope

### Phase 1 — 실행 엔진 교체 (foundation)

- `PlaygroundExecutor` / `PlaygroundAgentSession` 을 agent-framework 공개 API로 교체
- BYOK 모드 유지 (브라우저에서 직접 provider key 입력)
- `useRobotaExecution` 훅의 내부 구현만 교체, 외부 인터페이스는 유지하여 UI 레이어 변경 최소화

### Phase 2 — React Flow 캔버스 재설계

- 캔버스에 **agent 노드** 타입 추가 (provider, model, system prompt 표시)
- **tool 노드** 타입 추가 (tool name, description, parameter summary)
- agent 노드 ↔ tool 노드를 엣지로 연결하면 tool이 에이전트에 주입
- tool 노드는 Tools 패널에서 드래그하거나 캔버스에서 직접 추가 가능
- 대화 이벤트 (user message, assistant response, tool call, tool result)는 별도 "Execution
  Timeline" 영역에 표시하여 조립 캔버스와 분리

### Phase 3 — Code Export

- 캔버스 상태를 직렬화하여 TypeScript 코드 스니펫 생성
- 생성 코드는 `@robota-sdk/agents` import 기준으로 실행 가능한 최소 코드
- "Copy Code" 버튼으로 클립보드에 복사
- 코드 미리보기 패널 (syntax highlight)

### Phase 4 — Skills 지원

- Skills 패널 추가 (현재 tools 패널과 동급)
- skill 노드를 agent 노드에 연결하면 agent에 skill context 주입
- Code Export에 skill 조합 반영

## Architecture

```
apps/agent-web
└── /playground
    ├── AssemblyCanvas (React Flow)
    │   ├── AgentNode         — provider, model, system prompt 편집
    │   ├── ToolNode          — 연결된 tool 표시
    │   └── ExecutionEdge     — tool call 이벤트 애니메이션
    ├── SidePanel
    │   ├── ToolsCatalog      — draggable tool cards
    │   └── SkillsCatalog     — draggable skill cards (Phase 4)
    ├── ChatPanel             — 에이전트 실행 입력/출력
    └── CodeExportPanel       — 생성된 TypeScript 코드 미리보기

packages/agent-playground
└── 실행 엔진을 agent-framework API로 교체
    ├── framework-executor.ts  — 교체된 실행 엔진
    └── code-generator.ts      — 캔버스 → TypeScript 코드 생성
```

## Test Plan

- `packages/agent-playground`: 단위 테스트
  - framework-executor: agent 생성 → tool 주입 → run 실행 흐름
  - code-generator: 캔버스 상태 → 올바른 TypeScript 스니펫 생성
- `apps/agent-web`: E2E (Playwright)
  - 에이전트 생성 → tool 드래그 → 채팅 → tool call 이벤트 확인
  - Code Export 버튼 → 클립보드 내용 검증
- build 검증: `pnpm typecheck && pnpm lint && pnpm test`

## User Execution Test Scenarios

### Scenario 1: Tool Drag-and-Drop + Chat

**Prerequisites**: `pnpm dev` (agent-web), `pnpm start` (agent-server), OpenAI API key 설정

**Steps**:

1. `http://localhost:7071/playground` 접속
2. "Create Agent" → Provider: OpenAI, Model: gpt-4o-mini → Create
3. React Flow 캔버스에 agent 노드가 생성됨을 확인
4. 오른쪽 Tools 패널에서 "Current Time" 카드를 agent 노드 위로 드래그
5. agent 노드에 "Current Time" 연결 표시 확인
6. 채팅 입력: "What is the current time in Seoul?"
7. AI가 `getCurrentTime` tool을 호출하고 결과를 반환하는지 확인
8. React Flow에 tool_call → tool_result 노드가 시각화되는지 확인

**Expected observable result**:

- agent 노드가 tool 연결 상태를 표시
- 채팅 응답이 실제 현재 시각 (KST) 포함
- Workflow에 User → tool_call(getCurrentTime) → tool_result → Assistant 노드 체인 표시

**Evidence**: `<스크린샷 또는 실행 로그 — 구현 후 기입>`

### Scenario 2: Code Export

**Prerequisites**: Scenario 1 완료 상태

**Steps**:

1. "Copy Code" 버튼 클릭 (또는 Code Export 패널 열기)
2. 생성된 TypeScript 코드를 확인

**Expected observable result**:

```typescript
import { Robota } from '@robota-sdk/agents';
// provider, tool 설정이 포함된 실행 가능한 코드
```

- 코드가 클립보드에 복사되고 미리보기 패널에 표시됨
- 코드를 별도 파일에 붙여넣어 `ts-node` 실행 시 동작

**Evidence**: `<코드 스니펫 캡처 — 구현 후 기입>`

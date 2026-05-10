# PLG-005: Web Monitor — 에이전트 활동 패널

- **Status**: backlog
- **Created**: 2026-05-10
- **Area**: packages/agent-transport-ws, packages/agent-web, packages/agent-cli (spa)
- **Priority**: high

## Objective

`robota --web` 모니터 브라우저에서 현재 실행 중인 백그라운드 태스크(서브에이전트)의 활동
상태를 실시간으로 표시한다. **채팅 UI와 에이전트 패널은 화면의 별도 영역에 분리된다.**
채팅 흐름에 에이전트 이벤트를 섞지 않고, 에이전트 각각의 상세 현황(현재 작업, 툴 호출,
상태 변이)을 별도 패널에서 실시간으로 시각화한다.

## Design Decisions (from conversation 2026-05-10)

1. **채팅 UI에 에이전트 이벤트 표시 금지** — `ConversationView`는 메인 스레드 대화만 표시.
   서브에이전트 활동은 대화창에 섞이지 않는다.
2. **별도 화면 영역** — 백그라운드 태스크가 1개 이상일 때 에이전트 패널이 대화창 옆
   (오른쪽 사이드패널 또는 하단 분할)에 나타난다.
3. **에이전트별 상세 현황** — 각 에이전트 카드는 단순 상태 표시를 넘어 현재 수행 중인
   작업(`currentAction`), 최신 미리보기(`preview`), 주의 상태(`attention`) 등 상세 정보를 보여준다.
4. **실시간** — WS에서 `execution_workspace_event` 수신 시 즉시 UI 갱신. 폴링 없음.

## Background

`InteractiveSession`은 이미 `execution_workspace_event`를 emit한다. 이 이벤트는
`IExecutionWorkspaceSnapshot`을 포함하며, 메인 스레드·백그라운드 태스크·잡 그룹 상태를
통합해 제공한다.

현재 WS 핸들러는 `background_task_event`와 `background_job_group_event`를 브라우저로
중계하지만, `execution_workspace_event`는 중계하지 않는다. 브라우저(`useWsSession`)도
두 이벤트를 처리하지 않아 에이전트 활동이 UI에 전혀 표시되지 않는다.

## Current State Analysis

### WS 프로토콜 (`packages/agent-transport-ws`)

| 항목                                                   | 상태          |
| ------------------------------------------------------ | ------------- |
| `execution_workspace_event` in `TServerMessage`        | ❌ 없음       |
| `get-execution-workspace` in `TClientMessage`          | ❌ 없음       |
| `subscribeSessionEvents` → `execution_workspace_event` | ❌ 구독 안 함 |
| 연결 시 초기 스냅샷 전송                               | ❌ 없음       |

### Web UI (`packages/agent-web`)

| 항목                                        | 상태    |
| ------------------------------------------- | ------- |
| `useWsSession` → `executionWorkspace` state | ❌ 없음 |
| `AgentActivityPanel` 컴포넌트               | ❌ 없음 |
| `SessionMonitor` 분할 레이아웃              | ❌ 없음 |

## Layout Design

```
┌────────────────────────────────────────────────────────┐
│ CLI MONITOR  ·  Connected          ws://... [Connect]  │
├────────────────────────────────┬───────────────────────┤
│                                │ AGENTS (2 running)    │
│   ConversationView             │                       │
│   (메인 스레드 대화만)          │  ┌─────────────────┐  │
│                                │  │ ● agent-a       │  │
│   User: ...                    │  │   running       │  │
│   Agent: ...                   │  │   Writing…      │  │
│                                │  │   [tool: Edit]  │  │
│                                │  └─────────────────┘  │
│                                │  ┌─────────────────┐  │
│                                │  │ ● agent-b       │  │
│                                │  │   running       │  │
│                                │  │   Analyzing…    │  │
│                                │  └─────────────────┘  │
├────────────────────────────────┤                       │
│  [message input]    [Send]     │                       │
└────────────────────────────────┴───────────────────────┘
```

- 백그라운드 태스크가 없으면 오른쪽 패널 미노출, 대화창이 전체 너비 사용
- 백그라운드 태스크가 있으면 분할 (대화 2/3 + 에이전트 1/3)
- 에이전트 패널은 스크롤 가능 (태스크 많을 때)

## Agent Card Design (per `IExecutionWorkspaceEntry`)

```
┌─────────────────────────────┐
│ ● agent-a          running  │  ← title + status dot
│   Analyzing packages…       │  ← currentAction
│   "Checking tsup config"    │  ← preview (last action preview)
│   ⚡ Bash                    │  ← 현재 실행 중인 툴 (tool_start에서)
└─────────────────────────────┘
```

주의 상태(`attention`) 표시:

- `permission` → 🔐 빨간 테두리 + "Permission required" 배지
- `failed` → ✗ 빨간 배경 + error 표시
- `completed` → ✓ 흐린 처리 (접힘 또는 fade)

상태별 dot 색상:

- `running` → amber animate-pulse
- `waiting_permission` → rose animate-pulse
- `queued` → zinc
- `completed` → emerald (흐림)
- `failed` → rose solid

## Work Plan

### Step 1 — WS 프로토콜 확장 (`packages/agent-transport-ws`)

**`ws-protocol.ts`**:

```typescript
// TClientMessage에 추가
| { type: 'get-execution-workspace' }

// TServerMessage에 추가 (IExecutionWorkspaceSnapshot import 필요)
| { type: 'execution_workspace_event'; snapshot: IExecutionWorkspaceSnapshot }
```

**`ws-handler.ts`** — `subscribeSessionEvents` 수정:

```typescript
const onExecutionWorkspace = (event: IExecutionWorkspaceEvent): void =>
  send({ type: 'execution_workspace_event', snapshot: event.snapshot });
session.on('execution_workspace_event', onExecutionWorkspace);
// cleanup에도 off 추가
```

**`ws-handler.ts`** — 연결 시 초기 스냅샷 전송 (기존 messages 전송 직후):

```typescript
send({ type: 'execution_workspace_event', snapshot: session.getExecutionWorkspaceSnapshot() });
```

**`ws-handler.ts`** — `handleSessionQueryMessage` 확장:

```typescript
if (msg.type === 'get-execution-workspace') {
  send({ type: 'execution_workspace_event', snapshot: session.getExecutionWorkspaceSnapshot() });
}
```

**isSessionQueryMessage** 함수 type guard에 `'get-execution-workspace'` 추가.

### Step 2 — Web UI 훅 확장 (`packages/agent-web/src/hooks/useWsSession.ts`)

```typescript
// import 추가
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-transport-ws';

const [executionWorkspace, setExecutionWorkspace] =
  useState<IExecutionWorkspaceSnapshot | null>(null);

// handleMessage switch에 추가
case 'execution_workspace_event': {
  setExecutionWorkspace(msg.snapshot);
  break;
}

// IWsSessionState 인터페이스에 추가
executionWorkspace: IExecutionWorkspaceSnapshot | null;

// 반환값에 추가
return { ..., executionWorkspace };
```

### Step 3 — AgentActivityPanel 컴포넌트 신규

**`packages/agent-web/src/components/AgentActivityPanel.tsx`**

`IExecutionWorkspaceSnapshot.entries`에서 `kind === 'background_task'` 항목만 필터링.
완료된 태스크는 일정 시간(2초) 후 자동으로 숨기거나 collapsed 처리.

각 항목은 `AgentCard` 서브컴포넌트로 분리:

```tsx
function AgentCard({ entry }: { entry: IExecutionWorkspaceEntry }): React.ReactElement;
```

표시 필드:

- `entry.title` — 에이전트 이름/레이블
- `entry.status` — 상태 dot + 텍스트
- `entry.currentAction` — 현재 수행 중인 작업 (있을 때만)
- `entry.preview` — 마지막 작업 미리보기 (있을 때만)
- `entry.attention` — permission/failed 시 시각적 강조

### Step 4 — SessionMonitor 레이아웃 분할

**`packages/agent-web/src/components/SessionMonitor.tsx`** 수정:

`executionWorkspace`에서 background_task 항목 개수를 계산해 패널 노출 여부 결정.

```tsx
const { ..., executionWorkspace } = useWsSession(url);
const backgroundTasks = executionWorkspace?.entries.filter(
  (e) => e.kind === 'background_task' && e.visibility !== 'collapsed'
) ?? [];
const hasAgents = backgroundTasks.length > 0;

// 레이아웃
<div className="flex h-full overflow-hidden">
  {/* 왼쪽: 대화 + 입력 */}
  <div className={`flex flex-col ${hasAgents ? 'flex-[2]' : 'flex-1'} overflow-hidden`}>
    ...ConversationView...
    ...SessionInput...
  </div>
  {/* 오른쪽: 에이전트 패널 (조건부) */}
  {hasAgents && (
    <AgentActivityPanel tasks={backgroundTasks} className="flex-1 border-l border-border/50" />
  )}
</div>
```

### Step 5 — UI 디자인 정착 (`/frontend-design:frontend-design`)

기능 구현이 완료된 후, UI 컴포넌트(`AgentActivityPanel`, `AgentCard`, 분할 레이아웃)에
대해 `/frontend-design:frontend-design` 스킬을 실행하여 디자인을 정착시킨다.

스킬 실행 범위:

- `AgentActivityPanel.tsx` — 패널 전체 레이아웃, 헤더, 스크롤 영역
- `AgentCard` 내 각 상태별 시각화 (running/waiting_permission/completed/failed/queued)
- `SessionMonitor.tsx` — 분할 레이아웃 비율, 패널 전환 애니메이션
- Layout Design 섹션의 ASCII 다이어그램을 기준으로 피드백 반영

### Step 6 — 빌드 및 검증

```bash
pnpm --filter @robota-sdk/agent-transport-ws build
pnpm --filter @robota-sdk/agent-web build:spa
pnpm --filter @robota-sdk/agent-cli build
pnpm typecheck && pnpm lint && pnpm test
```

## Scope

**변경 패키지:**

- `packages/agent-transport-ws` — 프로토콜 + 핸들러 (protocol, handler, index)
- `packages/agent-web` — 훅 + 컴포넌트 2개 신규 + SessionMonitor 레이아웃
- `packages/agent-cli` — SPA 재빌드 포함

**변경 없는 패키지:**

- `packages/agent-sdk` — `InteractiveSession` 그대로 사용
- `packages/agent-runtime` — 변경 없음

**새 파일:**

- `packages/agent-web/src/components/AgentActivityPanel.tsx`

## Test Plan

- [ ] `agent-transport-ws` 유닛 테스트: 연결 시 초기 스냅샷 전송 확인
- [ ] `agent-transport-ws` 유닛 테스트: `execution_workspace_event` 구독 + 중계 확인
- [ ] `agent-transport-ws` 유닛 테스트: `get-execution-workspace` 처리 확인
- [ ] `agent-web` 유닛 테스트: `useWsSession` → `execution_workspace_event` 수신 시 `executionWorkspace` 업데이트
- [ ] playwright 테스트: 백그라운드 태스크 없을 때 AgentActivityPanel 미노출 확인
- [ ] playwright 테스트: 백그라운드 태스크 있을 때 분할 레이아웃 + AgentCard 렌더링 확인
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 전 패키지 통과

## User Execution Test Scenarios

### Scenario 1: 두 에이전트 병렬 실행 시 웹 모니터에 활동 표시

**Prerequisites:**

- `robota --web` 실행 가능한 환경
- 브라우저에서 `http://localhost:<httpPort>/` 접속 가능

**Steps:**

1. `robota --web` 실행
2. 브라우저 자동 오픈 확인
3. CLI에서 두 에이전트를 병렬로 실행하는 프롬프트 입력
   (예: "두 개의 에이전트로 나눠서 README와 SPEC을 동시에 작성해줘")
4. 브라우저 모니터 확인

**Expected Observable Result:**

- 화면이 좌우로 분할됨 — 왼쪽: 메인 대화창, 오른쪽: "AGENTS (2 running)" 패널
- 채팅 UI에는 에이전트 툴 호출 등이 섞이지 않음
- 오른쪽 패널에서 각 에이전트 카드가 별도로 표시:
  - 에이전트 이름 + amber pulse dot (running)
  - `currentAction` 실시간 업데이트 (예: "Writing SPEC.md…")
  - `preview` 마지막 작업 미리보기
- 에이전트 완료 시 해당 카드 → emerald dot + completed 표시
- 모든 에이전트 완료 후 패널 숨김 또는 완료 상태 유지

**Evidence field:** _(구현 후 playwright 스크린샷 또는 DOM 스냅샷으로 채움)_

### Scenario 2: 단일 메인 스레드만 실행 시 분할 미적용

**Steps:**

1. `robota --web` 실행
2. 단순 질문 프롬프트 입력 (서브에이전트 없는 작업)

**Expected:** 화면 분할 없음. ConversationView가 전체 너비 사용. AgentActivityPanel 미노출.

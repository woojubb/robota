# PLG-007: agent-transport-tui 분리 — CLI 라이프사이클 소유권 복구

- **Status**: backlog
- **Created**: 2026-05-11
- **Area**: packages/agent-transport-tui (신규), packages/agent-cli
- **Priority**: high

## Objective

현재 `agent-cli/src/ui/` 에 혼재된 TUI 레이어를 `agent-transport-tui` 패키지로 분리한다.
TUI는 WS와 동일하게 `IConfigurableTransport`를 구현하는 I/O 어댑터이며,
`agent-cli`는 lifecycle을 소유하는 순수 조립 레이어로 남는다.

## Confirmed Decisions

| #   | 결정 사항                                                                              |
| --- | -------------------------------------------------------------------------------------- |
| 1   | TUI는 WS와 동일한 계층 — `IConfigurableTransport` 구현체. `agent-transport-tui` 패키지 |
| 2   | `agent-cli`는 lifecycle 소유. TUI/WS를 주입·실행하고 shutdown을 결정함                 |
| 3   | TUI는 I/O만 담당. 종료 의사를 CLI에 이벤트로 통보, 직접 `process.exit()` 호출 금지     |
| 4   | `tui-state-manager.ts`, React hooks, Ink 컴포넌트 전체를 `agent-transport-tui`로 이동  |
| 5   | `agent-cli`에서 Ink/React 직접 의존 제거 — `agent-transport-tui` 의존으로 교체         |

## Architecture

### 현재 구조의 문제

```
agent-cli
  ├── src/ui/           ← Ink + React + TUI 로직 전부 혼재
  │   ├── App.tsx           process.exit() 직접 호출
  │   ├── tui-state-manager.ts
  │   ├── hooks/
  │   └── render.tsx        void 반환 → CLI가 완료 시점 모름
  ├── package.json      ← ink, react, ink-* 직접 의존
  └── cli.ts            ← renderApp() 호출 후 제어 상실
```

- TUI(App.tsx)가 SIGINT, Ctrl+C, SIGTERM을 직접 처리하고 `exit()` 호출
- `renderApp()`이 `void` 반환 → CLI가 TUI 종료 시점을 알 수 없음
- TUI와 CLI 조립 로직의 경계가 없어 각자 독립적으로 진화 불가

### 목표 구조

```
agent-cli                          ← lifecycle 소유, 조립 레이어
  ├── cli.ts                           TuiTransport 생성, registry.startAll(), await 완료
  ├── utils/provider-*.ts              provider/config 조립
  ├── transports/transport-registry.ts
  └── (Ink/React 의존 없음)

agent-transport-tui (신규)         ← I/O 어댑터 (터미널)
  ├── TuiTransport implements IConfigurableTransport
  │     attach(session: ISession)
  │     start(): Promise<void>      ← Ink render loop 시작, 종료 시 resolve
  │     stop(): Promise<void>       ← Ink 종료
  │     onExitRequested callback    ← CLI에 종료 의사 통보
  ├── src/components/               ← App.tsx, InputArea, MessageList 등 이동
  ├── src/hooks/                    ← useInteractiveSession, useSideEffects 등 이동
  ├── src/tui-state-manager.ts      ← 이동
  └── deps: agent-sdk, ink, react

agent-transport-ws                 ← I/O 어댑터 (웹소켓) — 변경 없음
```

### 의존 방향 (변경 후)

```
agent-core
  ↑
agent-sessions
  ↑
agent-interface-transport
  ↑
agent-sdk
  ↑                    ↑
agent-transport-tui    agent-transport-ws
  ↑
agent-cli  ─────────── 조립 + lifecycle
```

### 라이프사이클 흐름 (변경 후)

```
cli.ts
  → new TuiTransport({ commandModules, provider, ... })
  → new WsTransport()
  → registry.startAll(session)      ← 둘 다 시작
  → await tuiTransport.waitForExit() ← TUI 종료까지 대기
  → registry.stopAll()              ← 전체 정리
  → process.exit(0)                 ← CLI가 결정
```

TUI 내부에서 Ctrl+C 감지 시:

```
App.tsx
  → props.onExitRequested('prompt_input_exit')  ← CLI에 신호
  → CLI: handleShutdown() → registry.stopAll() → process.exit()
```

## Work Plan

### Step 1 — `agent-interface-transport`: `ITransportLifecycle` 콜백 추가

TUI가 CLI에 "종료 요청"을 전달할 수 있도록 계약 확장.

```typescript
// IConfigurableTransport 확장 (또는 별도 옵션)
export interface ITransportLifecycleCallbacks {
  onExitRequested?: (reason: TSessionEndReason) => void;
}
```

`IConfigurableTransport`에 optional `setLifecycleCallbacks(cb: ITransportLifecycleCallbacks): void` 추가.
또는 `TuiTransport` 생성자 옵션으로 주입 (더 단순).

### Step 2 — `agent-cli/src/ui/render.tsx` 시그니처 변경

`renderApp()` → `Promise<void>` 반환하도록 변경.
Ink의 `waitUntilExit()` Promise를 caller에게 전달.

```typescript
export async function renderApp(options: IRenderOptions): Promise<void> {
  const instance = render(<App {...options} />, { exitOnCtrlC: false });
  await instance.waitUntilExit();
}
```

### Step 3 — `App.tsx` 종료 시그널 역전

SIGINT, Ctrl+C, SIGTERM 핸들러를 App에서 제거하고
`onExitRequested` 콜백으로 CLI에 위임.

```typescript
// App.tsx — 직접 exit() 대신 콜백
useInput((input, key) => {
  if (key.ctrl && input === 'c') props.onExitRequested?.('prompt_input_exit');
});
```

`cli.ts`에서 SIGINT/SIGTERM 등록 후 `registry.stopAll() → process.exit()`.

### Step 4 — `packages/agent-transport-tui` 패키지 신규 생성

```
packages/agent-transport-tui/
  src/
    index.ts
    tui-transport.ts          ← TuiTransport (IConfigurableTransport 구현)
    tui-state-manager.ts      ← agent-cli에서 이동
    components/               ← agent-cli/src/ui/components 이동
    hooks/                    ← agent-cli/src/ui/hooks 이동
  docs/
    SPEC.md
  package.json
  tsconfig.json
```

의존성: `@robota-sdk/agent-sdk`, `@robota-sdk/agent-interface-transport`, `ink`, `react`

### Step 5 — `agent-cli/src/ui/` 파일 이동

| 파일                                                | 현재 위치               | 이동 대상                           |
| --------------------------------------------------- | ----------------------- | ----------------------------------- |
| `App.tsx`, `AppInner`                               | agent-cli/src/ui/       | agent-transport-tui/src/components/ |
| `MessageList.tsx`, `InputArea.tsx` 등 컴포넌트 전체 | agent-cli/src/ui/       | agent-transport-tui/src/components/ |
| `tui-state-manager.ts`                              | agent-cli/src/ui/       | agent-transport-tui/src/            |
| `hooks/useInteractiveSession.ts` 등                 | agent-cli/src/ui/hooks/ | agent-transport-tui/src/hooks/      |
| `render.tsx`                                        | agent-cli/src/ui/       | agent-transport-tui/src/            |
| `TransportTUI.tsx`, `PluginTUI.tsx` 등 TUI 오버레이 | agent-cli/src/ui/       | agent-transport-tui/src/components/ |
| `types.ts` (TUI 타입)                               | agent-cli/src/ui/       | agent-transport-tui/src/            |

**agent-cli에 남는 것:**

- `cli.ts`, `bin.ts`
- `utils/` (provider setup, settings, cli-args 등)
- `transports/transport-registry.ts`
- `plugins/`, `subagents/`, `background/`

### Step 6 — `agent-cli` 의존성 정리

`agent-cli/package.json`:

- 제거: `ink`, `react`, `ink-select-input`, `ink-text-input`, `ink-spinner`
- 추가: `@robota-sdk/agent-transport-tui: workspace:*`
- `@types/react`, `ink-testing-library` → devDependencies에서도 정리

`agent-cli/src/cli.ts`:

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport-tui';

// renderApp() 대신:
const tuiTransport = new TuiTransport({ commandModules, commandHostAdapters, ... });
registry.register(tuiTransport);
await registry.startAll(session);
await tuiTransport.waitForExit();
await registry.stopAll();
process.exit(0);
```

### Step 7 — `agent-transport-tui` SPEC.md 작성

필수 섹션:

- Scope & Purpose
- Package Boundaries (IConfigurableTransport 구현, lifecycle 비소유)
- Public API Surface (TuiTransport, renderApp 내부 진입점)
- Dependency Rules

### Step 8 — 아키텍처 맵 업데이트

업데이트 대상 파일:

**`.agents/specs/architecture-map/agent-system.md`**

- Mermaid 다이어그램에 `agent-transport-tui` 노드 추가
- `AgentCLI` 설명을 "lifecycle owner + assembly" 로 변경
- Agent stack ownership 표에서 "Terminal input/rendering" 소유자를 `agent-transport-tui`로 변경

**`.agents/specs/architecture-map/dependency-direction.md`**

- `TransportShells` 목록에 `agent-transport-tui` 추가
- Transport shells 레이어 규칙에 TUI 어댑터 언급 추가

**`.agents/project-structure.md`**

- `agent-transport-tui` 패키지 항목 추가

## Scope

**신규 패키지:**

- `packages/agent-transport-tui`

**변경 패키지:**

- `packages/agent-interface-transport` — lifecycle 콜백 계약 추가 (선택적)
- `packages/agent-cli` — Ink 의존 제거, TuiTransport 주입으로 전환, lifecycle 소유권 복구

**변경 없는 패키지:**

- `packages/agent-sdk` — 변경 없음 (이미 TUI 무관)
- `packages/agent-transport-ws` — 변경 없음
- `packages/agent-sessions`, `packages/agent-core` — 변경 없음

## Test Plan

- [ ] `agent-transport-tui` 빌드 성공, `TuiTransport` export 확인
- [ ] `TuiTransport implements IConfigurableTransport` 타입체크 통과
- [ ] `TuiTransport.start()` → Ink render 시작, `stop()` → 정상 종료
- [ ] `agent-cli/package.json`에 `ink`, `react` 직접 의존 없음 확인
- [ ] `cli.ts`에서 `TuiTransport` 주입 후 세션 정상 동작
- [ ] Ctrl+C → onExitRequested 콜백 → CLI shutdown → `process.exit(0)` 흐름 확인
- [ ] SIGINT/SIGTERM → CLI 레벨 핸들러 → 정상 종료
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 전 패키지 통과
- [ ] 아키텍처 맵 3개 파일 업데이트 완료

## User Execution Test Scenarios

### Scenario 1: 기본 TUI 동작 유지

**Steps:**

1. `robota` 실행
2. 프롬프트 입력 → 에이전트 응답 수신
3. Ctrl+C로 종료

**Expected:** 기존과 동일한 TUI 동작. 패키지 분리가 사용자에게 투명하게 이루어짐.

---

### Scenario 2: Ctrl+C lifecycle 흐름

**Steps:**

1. `robota` 실행
2. 에이전트 응답 중 Ctrl+C

**Expected:**

- "Shutting down..." 메시지 표시
- session graceful shutdown
- `process.exit(0)`으로 정상 종료
- CLI가 TUI의 종료 요청을 수신하고 결정함

---

### Scenario 3: WS + TUI 동시 실행

**Steps:**

1. WS transport enabled 상태로 `robota` 실행
2. 브라우저에서 WS 연결 확인
3. CLI에서 Ctrl+C

**Expected:**

- TUI 종료 요청 → CLI → `registry.stopAll()` → WS 서버도 종료
- 두 transport가 CLI lifecycle에 의해 함께 관리됨

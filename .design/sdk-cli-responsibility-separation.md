# SDK ↔ CLI 책임 분리 설계

> **상태**: 설계 확정 (2026-03-25)

## 문제

CLI에 구현한 핵심 기능들이 SDK 레벨에서 지원되어야 하는 기능임. CLI는 TUI 렌더링만 담당해야 하는데, 현재 세션 관리/스트리밍/큐잉 로직이 React hooks 안에 섞여있음.

이 분리가 선행되어야 transport 레이어(HTTP, MCP, WS 등)를 붙일 수 있음. 다른 클라이언트(웹 UI, API 서버 등)도 동일한 SDK 기능을 사용해야 하기 때문.

## 확정된 결정 사항

| 결정                    | 선택                                                       |
| ----------------------- | ---------------------------------------------------------- |
| InteractiveSession 위치 | agent-sdk (신규 클래스)                                    |
| Session과의 관계        | Composition (래핑), 상속 아님                              |
| 슬래시 명령어 시스템    | SDK로 이동 (HTTP/MCP에서도 실행 가능)                      |
| CLI 역할                | 순수 TUI: InteractiveSession 이벤트 → React state → 렌더링 |

## 현재: CLI에 있는 것 분류

### CLI에 있어야 하는 것 (TUI 전용)

| 기능                                  | 위치                               | 이유             |
| ------------------------------------- | ---------------------------------- | ---------------- |
| Ink 컴포넌트 렌더링                   | App.tsx, MessageList, InputArea 등 | 터미널 UI        |
| CjkTextInput (한글 입력, 커서)        | CjkTextInput.tsx                   | 터미널 입력 처리 |
| Bracketed paste mode                  | CjkTextInput.tsx, render.tsx       | 터미널 프로토콜  |
| 멀티라인 커서 네비게이션              | CjkTextInput.tsx                   | 터미널 입력 UI   |
| PermissionPrompt (화살표 선택 UI)     | PermissionPrompt.tsx               | TUI 전용         |
| SlashAutocomplete (팝업 UI)           | SlashAutocomplete.tsx              | TUI 전용         |
| PluginTUI (메뉴 UI)                   | PluginTUI.tsx                      | TUI 전용         |
| StreamingIndicator (도구 진행률 표시) | StreamingIndicator.tsx             | TUI 전용 렌더링  |
| StatusBar                             | StatusBar.tsx                      | TUI 전용         |
| 색상, chalk, 보더 스타일              | 각 컴포넌트                        | 터미널 전용      |

### SDK에 있어야 하는 것 (현재 CLI에 있음)

| 기능                    | 현재 위치                                        | SDK에서 필요한 이유                         |
| ----------------------- | ------------------------------------------------ | ------------------------------------------- |
| 스트리밍 텍스트 축적    | useSession.ts (streamingTextRef, 16ms debounce)  | 웹 UI, API 서버도 스트리밍 텍스트 필요      |
| 도구 실행 상태 추적     | useSession.ts (activeTools, onToolStart/End)     | 모든 클라이언트가 도구 진행률 필요          |
| 프롬프트 큐잉           | App.tsx (pendingPrompt, pendingPromptRef)        | API 서버에서도 실행 중 추가 요청 큐잉 필요  |
| abort 오케스트레이션    | App.tsx (isAborting + session.abort())           | 모든 클라이언트에서 abort 가능해야 함       |
| 실행 완료 후 상태 정리  | App.tsx useEffect (isThinking 전환 시)           | 세션 라이프사이클 관리                      |
| 메시지 히스토리 관리    | useMessages.ts, useSubmitHandler.ts              | 모든 클라이언트가 대화 히스토리 관리 필요   |
| 컨텍스트 상태 추적      | App.tsx (contextState, getContextState)          | 모든 클라이언트가 토큰 사용량 필요          |
| 슬래시 명령어 실행      | useSlashCommands.ts                              | API에서도 명령어 실행 가능해야 함           |
| 세션 생성 + 권한 핸들러 | useSession.ts (createSession, permissionHandler) | SDK가 세션 팩토리와 권한 위임을 소유해야 함 |
| Edit diff 추출          | useSession.ts → edit-diff.ts                     | 도구 결과 파싱은 SDK 레벨                   |

## 제안: SDK에 추가할 계층

### InteractiveSession (SDK 신규)

Session 위에 상호작용 관련 로직을 래핑하는 클래스. CLI/웹/API 서버 모두 이것을 사용.

```typescript
/** SDK 레벨: 클라이언트 공통 상호작용 세션 */
class InteractiveSession {
  private session: Session;
  private promptQueue: string | null = null;
  private isRunning = false;

  /** 이벤트 기반 — 클라이언트가 구독 */
  on(event: 'text_delta', handler: (text: string) => void): void;
  on(event: 'tool_start', handler: (tool: IToolState) => void): void;
  on(event: 'tool_end', handler: (tool: IToolState) => void): void;
  on(event: 'complete', handler: (messages: TUniversalMessage[]) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
  on(event: 'context_update', handler: (state: IContextState) => void): void;

  /** 프롬프트 실행 (큐잉 내장) */
  async submit(input: string): Promise<void>;

  /** 실행 중단 */
  abort(): void;

  /** 큐 취소 */
  cancelQueue(): void;

  /** 히스토리 조회 */
  getMessages(): TUniversalMessage[];

  /** 컨텍스트 상태 */
  getContextState(): IContextState;

  /** 실행 중 여부 */
  isExecuting(): boolean;

  /** 큐에 대기 중인 프롬프트 */
  getPendingPrompt(): string | null;
}
```

### CLI 리팩토링 후 모습

```typescript
// CLI App.tsx — TUI 렌더링만 담당
function App(props: IProps) {
  const interactiveSession = useInteractiveSession(props);
  // SDK의 InteractiveSession 이벤트 → React state 변환만
  const [streamingText, setStreamingText] = useState('');
  const [activeTools, setActiveTools] = useState([]);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => {
    interactiveSession.on('text_delta', (text) => setStreamingText(text));
    interactiveSession.on('tool_start', (tool) => ...);
    interactiveSession.on('complete', () => setIsThinking(false));
  }, []);

  // 나머지는 순수 렌더링
  return (
    <Box>
      <MessageList messages={interactiveSession.getMessages()} />
      <StreamingIndicator text={streamingText} tools={activeTools} />
      <InputArea onSubmit={(input) => interactiveSession.submit(input)} />
    </Box>
  );
}
```

### 다른 클라이언트에서 동일하게 사용

```typescript
// HTTP API 서버
app.post('/chat', async (req) => {
  const session = new InteractiveSession(config);
  session.on('complete', (messages) => res.json(messages));
  await session.submit(req.body.message);
});

// WebSocket 서버
ws.on('message', (data) => {
  const { type, payload } = JSON.parse(data);
  if (type === 'submit') session.submit(payload.message);
  if (type === 'abort') session.abort();
});
session.on('text_delta', (text) => ws.send(JSON.stringify({ type: 'delta', text })));
```

## SDK ↔ CLI 경계 정리

```
┌─────────────────────────────────────────────┐
│  CLI (agent-cli)                            │
│  순수 TUI: Ink 컴포넌트, 터미널 입력,        │
│  색상, 레이아웃, 키보드 단축키               │
│  InteractiveSession 이벤트 → React state     │
└──────────────────▲──────────────────────────┘
                   │ 이벤트 구독
┌──────────────────┴──────────────────────────┐
│  SDK (agent-sdk)                            │
│  InteractiveSession: 스트리밍 축적,          │
│  도구 상태 추적, 프롬프트 큐, abort,          │
│  히스토리 관리, 컨텍스트 추적                 │
└──────────────────▲──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│  Sessions (agent-sessions)                  │
│  Session: run(), abort(), permissions,       │
│  hooks, compaction                           │
└──────────────────▲──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│  Core (agent-core)                          │
│  Robota, providers, tools, plugins           │
└─────────────────────────────────────────────┘
```

## 이 분리와 Transport 관계

InteractiveSession이 SDK에 있으면:

- `agent-transport-http`는 InteractiveSession을 HTTP로 노출
- `agent-transport-mcp`는 InteractiveSession을 MCP로 노출
- `agent-transport-ws`는 InteractiveSession을 WebSocket으로 노출
- `agent-cli`는 InteractiveSession을 터미널 TUI로 노출

모두 같은 SDK 계층을 소비하므로 transport 패키지는 하나로 합칠 수도 있고 분리할 수도 있음 — 어느 쪽이든 InteractiveSession이 중심.

## 구현 순서

1. InteractiveSession 인터페이스를 SDK SPEC에 정의
2. InteractiveSession 구현 (기존 CLI hooks 로직 추출)
3. CLI를 InteractiveSession 이벤트 구독 방식으로 리팩토링
4. transport 어댑터 구현 (HTTP, MCP, WS)

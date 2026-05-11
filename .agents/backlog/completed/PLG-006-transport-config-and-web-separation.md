# PLG-006: Transport Config Interface + WS/Web UI 분리

- **Status**: done
- **Created**: 2026-05-10
- **Area**: packages/agent-interface-transport (신규), packages/agent-sessions, packages/agent-sdk, packages/agent-transport-ws, packages/agent-cli, packages/agent-web
- **Priority**: high

## Objective

Transport(WS 등)와 Web UI(agent-web SPA)를 완전히 분리한다.
Transport 계약은 `agent-interface-transport` 패키지로 분리되며,
각 transport는 enable/disable 옵션과 함께 레지스트리에 등록되는 독립 플러그인이다.
agent-cli는 등록된 transport 목록을 `/settings` TUI로 관리하고 변경을 퍼시스트한다.
`--web` 플래그는 삭제하며 Web monitor 서비스도 settings로 제어한다.

## Confirmed Decisions

| #   | 결정 사항                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **인터페이스 패키지**: `agent-interface-transport` 신규 생성. `agent-interface-*` 패턴을 모노레포 계약 패키지의 표준 네이밍으로 채택                                                          |
| 2   | **Settings 저장**: 기존 `SettingsSchema`에 `transports` 섹션 추가 (새 설계, enabledPlugins 구조 아님). 사용자 수준은 `~/.robota/settings.json`, 프로젝트 오버라이드는 `.robota/settings.json` |
| 3   | **설정 UI**: `/settings` 커맨드 내 transport 목록을 방향키로 선택·토글하는 TUI                                                                                                                |
| 4   | **`--web` 플래그 삭제**: web monitor는 settings에서 `defaultEnabled: true`로 세션 시작 시 자동 기동                                                                                           |

## Architecture

### 현재 구조의 문제

```
agent-sdk
  └── ITransportAdapter          ← transport 계약이 assembly layer에 혼재
      attach(session: InteractiveSession)

agent-cli
  └── web-sidecar/
      ├── ws-server.ts           ← WS + HTTP 강결합
      └── http-server.ts         ← --web 플래그 하나로 둘 다 켜짐
```

- Transport 켜고 끄기 불가. 재시작해도 동일 상태.
- `agent-transport-*` 구현체들이 `agent-sdk` 의존 → `ITransportAdapter` 때문에 assembly layer를 끌어옴.

### 목표 구조

```
agent-sessions
  └── ISession                   ← 추상 세션 인터페이스 (신규)

agent-interface-transport        ← 신규 패키지 (계약만, 구현 없음)
  ├── ITransportAdapter          ← agent-sdk에서 이동. attach(session: ISession)
  ├── IConfigurableTransport     ← 신규
  └── ITransportConfig           ← 신규

agent-sdk
  ├── InteractiveSession implements ISession
  └── attachTransport(transport: IConfigurableTransport)  ← agent-interface-transport 사용

agent-transport-ws
  └── WsTransport implements IConfigurableTransport  ← agent-interface-transport만 의존

agent-cli
  ├── TransportRegistry          ← 등록·설정 관리
  └── /settings transport TUI
```

### 의존 방향 (변경 후)

```
agent-core                        (zero deps)
agent-sessions                  → agent-core
agent-interface-transport       → agent-sessions   (ISession 참조)
agent-sdk                       → agent-sessions, agent-interface-transport
agent-transport-ws              → agent-interface-transport  (더 이상 agent-sdk 불필요)
agent-cli                       → agent-sdk, agent-interface-transport, agent-transport-ws
```

## Interface Contracts

### `agent-interface-transport`

```typescript
// ISession — agent-sessions에 정의, 여기서 import
import type { ISession } from '@robota-sdk/agent-sessions';

export interface ITransportAdapter {
  readonly name: string;
  attach(session: ISession): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ITransportConfig {
  enabled: boolean;
  options?: Record<string, unknown>;
}

export interface IConfigurableTransport extends ITransportAdapter {
  readonly defaultEnabled: boolean;
  readonly optionsSchema?: Record<string, { type: string; description: string; default?: unknown }>;
  validateOptions?(options: Record<string, unknown>): boolean;
}
```

### `SettingsSchema` 확장 (`agent-sdk/config-types.ts`)

```typescript
const TransportSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  options: z.record(UniversalValueSchema).optional(),
});

// SettingsSchema에 추가
transports: z.record(TransportSettingsSchema).optional(),
```

### `TransportRegistry` (`agent-cli`)

```typescript
export class TransportRegistry {
  register(transport: IConfigurableTransport): void;
  getAll(): Array<{ transport: IConfigurableTransport; config: ITransportConfig }>;
  getEnabled(): IConfigurableTransport[];
  setEnabled(name: string, enabled: boolean): Promise<void>;
  setOptions(name: string, options: Record<string, unknown>): Promise<void>;
  startAll(session: ISession): Promise<void>;
  stopAll(): Promise<void>;
}
```

## Work Plan

### Step 0 — `agent-sessions`: `ISession` 추상 인터페이스 추가

`InteractiveSession`이 구현하는 최소 추상 인터페이스를 `agent-sessions`에 정의한다.
`agent-interface-transport`는 `InteractiveSession`을 직접 참조하지 않고 `ISession`을 사용함으로써 순환 의존을 방지한다.

```typescript
// packages/agent-sessions/src/session-interface.ts
export interface ISession {
  readonly sessionId: string;
  // transport가 실제로 필요로 하는 최소 계약만 포함
  // (구체 메서드는 InteractiveSession이 확장)
}
```

`InteractiveSession`에 `implements ISession` 추가. `agent-sessions` SPEC.md 업데이트.

### Step 1 — `agent-interface-transport` 패키지 신규 생성

```
packages/agent-interface-transport/
  src/
    index.ts
    transport-adapter.ts       ← ITransportAdapter (agent-sdk에서 이동)
    transport-config.ts        ← ITransportConfig, IConfigurableTransport
  docs/
    SPEC.md
  package.json
  tsconfig.json
  tsup.config.ts
```

- `agent-sdk`에서 `ITransportAdapter` 제거 → `agent-interface-transport`로 이동
- `agent-sdk`가 `agent-interface-transport`를 의존하도록 업데이트

### Step 2 — `agent-sdk`: `ITransportAdapter` 참조 마이그레이션

- `interactive/types.ts`에서 `ITransportAdapter` 정의 삭제
- `agent-interface-transport`에서 import
- `attachTransport(transport: IConfigurableTransport)` 시그니처 변경
- SPEC.md 업데이트

### Step 3 — `agent-sdk`: `SettingsSchema`에 `transports` 추가

`packages/agent-sdk/src/config/config-types.ts`:

- `TransportSettingsSchema` 추가
- `SettingsSchema`에 `transports: z.record(TransportSettingsSchema).optional()` 추가
- `IResolvedConfig`에 `transports?: Record<string, { enabled: boolean; options?: Record<string, unknown> }>` 추가

### Step 4 — `agent-transport-ws`: `IConfigurableTransport` 구현

- `agent-sdk` 의존을 `agent-interface-transport`로 교체 (인터페이스 부분)
- `WsTransport` 클래스가 `IConfigurableTransport` 구현
- `defaultEnabled: true`
- `optionsSchema`: `port` (number, default 7070), `maxRetries` (number, default 20)
- SPEC.md 업데이트

### Step 5 — `agent-cli`: `TransportRegistry` + settings 연동

`packages/agent-cli/src/transports/` (신규):

- `transport-registry.ts` — `TransportRegistry` 구현
- 기존 config loader에서 `settings.transports` 읽어 registry에 반영
- `setEnabled()` / `setOptions()` 시 settings 파일에 즉시 write

### Step 6 — `agent-cli`: `/settings` transport TUI

기존 `/settings` 커맨드(또는 신규 생성)에 transport 섹션 추가:

```
Settings > Transports
  ● ws               [enabled]    port: 7070
  ○ web-monitor      [enabled]    port: 7071
  ○ http             [disabled]
  ↑↓ select   space toggle   enter confirm
```

방향키 탐색, space로 enabled 토글, 변경 즉시 settings 파일 저장.

### Step 7 — `agent-cli`: `--web` 플래그 삭제

- `bin.ts` / `cli.ts`에서 `--web` 플래그 및 관련 처리 제거
- web-monitor를 `IConfigurableTransport`로 구현된 서비스로 등록
- 세션 시작 시 `TransportRegistry.startAll()` 호출로 settings 기반 자동 기동
- `web-sidecar/` 폴더 정리: WS 서버는 transport, HTTP 서버는 web-monitor 서비스로 분리

### Step 8 — `agent-web`: transport 없는 상태 처리

`SessionMonitor.tsx`:

- `<meta name="ws-url">` 없으면 연결 시도 안 함
- "No transport active" 안내 표시 (enable 방법 포함)

### Step 9 — 빌드 및 검증

```bash
pnpm --filter @robota-sdk/agent-sessions build
pnpm --filter @robota-sdk/agent-interface-transport build
pnpm --filter @robota-sdk/agent-sdk build
pnpm --filter @robota-sdk/agent-transport-ws build
pnpm --filter @robota-sdk/agent-web build:spa
pnpm --filter @robota-sdk/agent-cli build
pnpm typecheck && pnpm lint && pnpm test
```

## Scope

**신규 패키지:**

- `packages/agent-interface-transport`

**변경 패키지:**

- `packages/agent-sessions` — `ISession` 인터페이스 추가
- `packages/agent-sdk` — `ITransportAdapter` 제거, `agent-interface-transport` 의존 추가, `SettingsSchema` 확장
- `packages/agent-transport-ws` — `IConfigurableTransport` 구현, `agent-interface-transport` 의존
- `packages/agent-cli` — `TransportRegistry`, `/settings` transport TUI, `--web` 삭제
- `packages/agent-web` — no-transport 상태 처리

**변경 없는 패키지:**

- `packages/agent-core`, `packages/agent-runtime` — 변경 없음

## Test Plan

- [ ] `agent-sessions`: `ISession` 인터페이스 컴파일 + `InteractiveSession implements ISession` 확인
- [ ] `agent-interface-transport`: 패키지 빌드 성공, `ITransportAdapter` / `IConfigurableTransport` / `ITransportConfig` export 확인
- [ ] `agent-sdk`: `ITransportAdapter` 더 이상 자체 정의 안 함, `agent-interface-transport`에서 import 확인
- [ ] `agent-transport-ws`: `IConfigurableTransport` 구현 + `defaultEnabled: true` 확인
- [ ] `agent-cli`: `TransportRegistry.setEnabled()` → settings 파일 업데이트 확인
- [ ] `agent-cli`: 세션 시작 시 enabled transport만 start() 호출 확인
- [ ] `agent-cli`: `/settings` transport 토글 → 즉시 파일 반영 확인
- [ ] `agent-web`: ws-url 없을 때 no-transport 상태 렌더링 확인
- [ ] 순환 의존 없음: `pnpm madge --circular` 또는 harness dep-direction 체크 통과
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` 전 패키지 통과

## User Execution Test Scenarios

### Scenario 1: 기본 동작 — settings 기본값으로 WS + web-monitor 자동 기동

**Steps:**

1. `robota` 실행 (WS, web-monitor 모두 `defaultEnabled: true`)
2. 브라우저 자동 오픈

**Expected:** `--web` 없이도 브라우저 열림. WS 연결 + SPA 표시. 기존 `--web` 동작과 동일.

---

### Scenario 2: `/settings` → transport 비활성화 → 재시작

**Steps:**

1. `/settings` 실행 → Transports 메뉴
2. `ws` 항목에서 space로 disabled 토글 → enter 확인
3. `robota` 재시작

**Expected:** WS 서버 미기동. settings 파일에 `transports.ws.enabled: false` 저장.
브라우저가 열리더라도 WS 연결 없음. SPA에 "No transport active" 안내 표시.

---

### Scenario 3: `/settings` transport 목록 탐색

**Steps:**

1. `/settings` 실행

**Expected:**

```
Settings > Transports
  ● ws               [enabled]    port: 7070
  ● web-monitor      [enabled]    port: 7071
```

방향키 선택, space 토글 동작.

---

### Scenario 4: transport 즉시 기동 (런타임 enable)

**Steps:**

1. WS disabled 상태로 세션 시작
2. `/settings` → ws 토글 → enabled

**Expected:** WS 서버 즉시 기동. settings 파일 업데이트. 이미 열린 브라우저 탭에서 재연결 가능.

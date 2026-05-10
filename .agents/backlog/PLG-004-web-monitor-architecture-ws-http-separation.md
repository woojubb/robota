---
title: 'PLG-004: Web Monitor 아키텍처 재설계 — WS 서버 / HTTP 서버 분리 + 초기화 순서 명시'
status: in-progress
branch: feat/plg-004-web-monitor-arch
implemented: 2026-05-10
created: 2026-05-10
priority: medium
urgency: soon
area: agent-cli, agent-sdk, agent-web
---

## Problem

현재 PLG-003 구현의 문제점:

1. **WS + HTTP 서버를 단일 포트에 공유** — 포트 충돌 시 두 서버가 함께 이동하고,
   브라우저가 React SPA를 통해 `window.location.host`로 WS URL을 추론하는 방식에 의존.
   이 추론이 브라우저 렌더링 이전에는 동작하지 않는다.

2. **초기화 순서 불명확** — `useInteractiveSession` Effect 안에서 sidecar 서버를 띄우고
   브라우저를 여는 작업이 한 번에 섞여 있어, CLI가 완전히 초기화되기 전에 브라우저가 열릴 수 있다.

3. **포트 동적 할당 후 브라우저 URL 불일치 가능성** — 포트 retry 로직은 구현됐지만
   브라우저가 열릴 때 실제 바인딩 포트를 신뢰성 있게 전달해야 함.

## Proposed Architecture

### 구조 개요

```
agent-sdk
  └── IWebMonitorPlugin (interface)  ← agent-web이 구현체 제공
      - startWsServer(session) → WsServerHandle (port, stop)
      - startHttpServer(wsPort) → HttpServerHandle (port, stop)

agent-cli
  └── /monitor (내부 명령/기능 — 정확한 이름은 구현 시 확정)
      - --web 플래그 시 활성화
      - 초기화 완료 후 아래 순서로 실행:
        Step 1: WS 서버 기동 → wsPort 확보
        Step 2: HTTP 서버 기동 (wsPort 주입) → httpPort 확보
        Step 3: 브라우저를 http://localhost:{httpPort} 로 열기
```

### 단계별 실행 흐름

```
robota --web
  │
  ├── [Phase 1] CLI 완전 초기화 (session, plugins, providers)
  │
  ├── [Phase 2] WS 서버 기동
  │     startWsServer(session, preferredPort=7070)
  │     → EADDRINUSE 시 자동 retry (max 20)
  │     → wsPort = 실제 바인딩 포트
  │
  ├── [Phase 3] HTTP 서버 기동 (wsPort 주입)
  │     startHttpServer(wsPort, preferredPort=wsPort+1 or 7071)
  │     → React SPA 서빙, HTML에 wsPort 주입
  │     → httpPort = 실제 바인딩 포트
  │
  └── [Phase 4] 브라우저 열기
        open(`http://localhost:${httpPort}`)
```

### WS 포트를 React SPA에 주입하는 방법

HTML 서빙 시 `index.html`에 `window.__WS_PORT__` 또는 `<meta>` 태그로 포트를 주입:

```html
<!-- 서버가 동적으로 삽입 -->
<meta name="ws-url" content="ws://localhost:7072" />
```

React SPA에서:

```typescript
const wsUrl =
  document.querySelector('meta[name="ws-url"]')?.getAttribute('content') ??
  `ws://${window.location.host}`;
```

또는:

```typescript
declare global {
  interface Window {
    __WS_PORT__?: number;
  }
}
const wsUrl = window.__WS_PORT__
  ? `ws://localhost:${window.__WS_PORT__}`
  : `ws://${window.location.host}`;
```

### 패키지 소유권

| 역할                                      | 패키지                                 |
| ----------------------------------------- | -------------------------------------- |
| IWebMonitorPlugin 인터페이스              | agent-sdk 또는 agent-web               |
| WS 서버 구현                              | agent-web (현 agent-transport-ws 활용) |
| HTTP 서버 (정적 서빙 + 포트 주입)         | agent-web                              |
| --web 플래그 처리 및 단계별 orchestration | agent-cli                              |
| SPA 진입점에서 meta 태그 읽기             | agent-web/spa                          |

## Scope

- `packages/agent-sdk`: IWebMonitorPlugin 인터페이스 추가 (선택적)
- `packages/agent-web`:
  - WS 서버 (`startWsServer`) 분리 export
  - HTTP 서버 (`startHttpServer`, WS URL 주입) 분리 export
  - SPA: `<meta name="ws-url">` 읽는 로직 추가
- `packages/agent-cli`:
  - `--web` 초기화 순서 재설계 (CLI 완전 초기화 후 순차 기동)
  - 현재 `web-sidecar-server.ts` 로직 분해

## Current Status (PLG-003)

PLG-003에서 WS + HTTP를 단일 포트에서 서빙하는 방식은 구현 완료됐으나
브라우저에서 빈 페이지가 나오는 문제가 재현됨. 근본 원인은 초기화 순서 및
포트 주입 방식의 불명확함으로 판단하여 이 항목으로 재설계 범위를 확정.

## Test Plan

- [x] `ws-server.ts`: 포트 충돌 시 EADDRINUSE retry — 19200 점유 후 19201 바인딩 확인
- [x] `http-server.ts`: HTML 서빙 시 `<meta name="ws-url">` 주입 확인 (4/4 테스트 통과)
- [x] SPA 번들에 `meta[name]`, `ws-url` 포함 확인
- [x] CLI 빌드 번들에 `findPackageRoot`, `injectWsUrl`, `ws://127.0.0.1` 포함 확인
- [x] typecheck: agent-cli ✓, agent-web ✓
- [x] test: 53 files, 449 tests ✓
- [x] `pnpm --filter @robota-sdk/agent-cli build` 성공

## User Execution Test Scenarios

### Scenario 1: --web 플래그로 모니터 UI 자동 연결

**Steps:**

1. `robota --web` 실행
2. 브라우저 자동 오픈
3. CLI에 메시지 입력

**Expected result:**

- 브라우저가 자동 열리고 WS 연결 성공
- CLI 입력이 브라우저에 실시간 반영

**Evidence:** (구현 후 스크린샷 또는 녹화 첨부)

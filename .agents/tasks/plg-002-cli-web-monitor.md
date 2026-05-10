# PLG-002: CLI Second Screen — Browser Monitor

- **Status**: done
- **Created**: 2026-05-10
- **Branch**: feat/plg-002-cli-web-monitor
- **Scope**: packages/agent-cli, packages/agent-web (신규), apps/agent-web

## Objective

`agent-cli`에 `--web` 플래그를 추가해 실행 중인 `InteractiveSession`을 WebSocket으로 노출하고,
브라우저(`apps/agent-web /monitor`)가 실시간으로 대화 현황을 시각화하는 보조 화면을 구현한다.
Phase 1: 읽기 전용 모니터. Phase 2: 양방향 입력 지원.

## Plan

- [x] 브랜치 생성 + 태스크 파일
- [x] agent-cli: --web/--web-port 플래그 + sidecar WS 서버
- [x] packages/agent-web 신규 패키지 (WS 클라이언트 + SessionMonitor)
- [x] apps/agent-web: /monitor 페이지 추가
- [x] 빌드 + 타입체크 + 검증

## Progress

### 2026-05-10

- 백로그 PLG-002 확정 (WsTransport + CLI sidecar + 보조 브라우저 모니터)
- 브랜치 및 태스크 파일 생성
- agent-cli: --web/--web-port 파싱 + startWebSidecarServer + useInteractiveSession 연동
- packages/agent-web: ws-session-client, useWsSession, ConversationView, SessionMonitor, index.ts
- apps/agent-web: /monitor 페이지 (dynamic import, SSR off)
- 빌드/타입체크 통과 (agent-cli, agent-web, apps/agent-web)

## Decisions

- `packages/agent-web`: 브라우저 전용 React 라이브러리. Node.js 의존성 없음.
- sidecar 서버: `packages/agent-cli/src/web-sidecar/` 아래 구현. `ws` 패키지 사용.
- `useInteractiveSession` hook 내부에서 세션 생성 후 sidecar 시작.
- Phase 2: `submit` 메시지를 sidecar 서버가 수신해 `session.submit()` 호출.

## Blockers

- (없음)

## PLG-003 Implementation (2026-05-10)

Branch: `feat/plg-003-web-monitor-spa`

### Implemented

- `packages/agent-web/spa/`: Vite SPA 엔트리 (index.html, main.tsx, main.css + Tailwind v4 dark theme)
- `packages/agent-web/vite.spa.config.ts`: `spa/` → `dist/spa/` 빌드
- `packages/agent-cli/scripts/copy-web-assets.mjs`: `dist/spa/` → `dist/web/` 복사
- `packages/agent-cli/package.json` build 스크립트: `build:spa → copy → tsup` 직렬 실행
- `packages/agent-cli/src/web-sidecar/web-sidecar-server.ts`: `serveStatic` 추가, WS + HTTP 단일 포트 7070

### Verification

- typecheck: agent-web ✓, agent-cli ✓
- test: 53 files, 449 tests ✓
- HTTP 통합 테스트: GET /, assets/\*, SPA fallback 4/4 ✓
- `dist/web/index.html` + JS/CSS 번들 생성 확인

## Result

PLG-002 (WS sidecar + packages/agent-web) + PLG-003 (SPA 내장) 완료.
`robota --web` 실행 시 포트 7070 단일 포트에서 WS + 정적 파일 서빙.
Next.js 별도 서버 불필요. 브라우저 확인 시나리오 대기 중.

---
title: 'DQ-AUDIT-005: agent-transport 패키지 응집도 — 루트 배럴 export * 가 TUI(react/ink)+HTTP+WS+MCP 융합'
status: todo
created: 2026-06-14
priority: medium
urgency: later
area: packages/agent-transport, packages/agent-web-ui
depends_on: []
---

# DQ-AUDIT-005: agent-transport 부엌-싱크 정리

## DQ-08 (P1)

`agent-transport/src/index.ts:1-6`이 `headless`/`http`/`ws`/`mcp`/`tui`를 모두 `export *` 하고,
`package.json` deps가 `react`/`ink`/`ink-*`/`hono`/`@modelcontextprotocol/sdk`를 포함. 루트 배럴을
import하면 React+ink+hono가 소비자 그래프로 끌려옴. `agent-web-ui`(브라우저 React lib)는
`@robota-sdk/agent-transport/ws` 타입만 쓰는데 의존 엣지는 패키지 전체에 걸림. 서버(HTTP)·터미널 UI(TUI)·
프로토콜(WS/MCP)이라는 무관한 런타임 관심사가 한 배포 단위를 공유 — 그래프 최대 응집도 약점.

**옵션 (설계 컨펌 필요):**

1. transport 관심사별 분할(`agent-transport-http`/`-ws`/`-tui`/`-mcp`) — 깔끔하나 패키지 4개 신설.
2. 최소 조치: 루트 배럴에서 TUI `export *` 제거, React/ink는 명시적 `./tui` 서브패스로만 도달.
   `agent-web-ui`는 ws-타입 표면만 의존.

규모/배포 영향이 커서 사용자 결정 필요 — 단독 진행 금지.

## Completion Criteria (옵션 확정 시)

- [ ] TC-01: 루트 배럴 import 시 react/ink가 그래프로 끌려오지 않음 (의존 추적 검증)
- [ ] TC-02: `agent-web-ui`가 ws 타입 서브패스만 의존
- [ ] TC-03: 기존 transport 소비자(cli TUI, headless, ws server, mcp) 전부 빌드/동작 보존
- [ ] TC-04: `pnpm harness:scan` + 전체 build 통과

## Test Plan

| TC-ID    | Test Type     | Approach                                |
| -------- | ------------- | --------------------------------------- |
| TC-01/02 | Static        | 번들/의존 그래프 추적                   |
| TC-03/04 | Build/Harness | 전체 build + harness:scan + 소비자 회귀 |

## User Execution Test Scenarios

TUI/headless 진입이 영향받을 수 있어 분할/배럴 변경 후:

- 실행: `robota`(TUI 진입) 및 `robota -p "hi"`(headless) 정상 기동 확인
- 기대: 변경 전과 동일 기동, exit 0
- 증거: 기동 로그/exit code 기록

## Tasks

- [ ] 옵션 1(분할) vs 2(배럴 정리) 사용자 결정
- [ ] 확정안 구현 + 소비자 마이그레이션

## Evidence Log

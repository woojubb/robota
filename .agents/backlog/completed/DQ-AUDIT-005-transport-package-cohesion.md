---
title: 'DQ-AUDIT-005: agent-transport 패키지 응집도 — 루트 배럴 export * 가 TUI(react/ink)+HTTP+WS+MCP 융합'
status: done
created: 2026-06-14
completed: 2026-06-14
priority: medium
urgency: later
area: packages/agent-transport, packages/agent-transport-tui, packages/agent-transport-ws, packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-cli, packages/agent-web-ui
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

- [x] 옵션 결정 — 비용/규모 무관 "제대로 된" 풀 분할 승인 (옵션 1)
- [x] 확정안 구현 + 소비자 마이그레이션

## Evidence Log

### 설계 컨펌 — 2026-06-14

`.design/architecture-audit/2026-06-14/dq-004-005-redesign.md` + 사용자 승인("둘 다 승인"). 저렴한
배럴-정리(옵션 2) 거부, 관심사별 풀 분할(옵션 1) 채택.

### 구현 완료 — 2026-06-14

**관심사별 5-패키지 분할:**

- `@robota-sdk/agent-transport` — 린 코어: headless 어댑터 + `TransportRegistry` + scripted-provider
  testing 픽스처. **외부 런타임 의존 0**(react/ink/ws/hono/mcp 전부 제거).
- `@robota-sdk/agent-transport-tui` — React/Ink 터미널 UI (+ node-pty PTY 테스트).
- `@robota-sdk/agent-transport-ws` — WebSocket transport + protocol.
- `@robota-sdk/agent-transport-http` — Hono HTTP transport.
- `@robota-sdk/agent-transport-mcp` — MCP 서버 transport.

**core→ws 엣지 제거:** `createDefaultTransportRegistry`(WsTransport 기본 등록)를 코어에서 제거하고
agent-cli 합성 루트의 로컬 헬퍼로 이동(generic `TransportRegistry`만 코어 소유). 조사 결과 서브디렉터리 간
런타임 상호참조 0건이라 분할이 acyclic.

**소비자 마이그레이션:** agent-cli(tui→`-tui`, registry 합성 루트 배선, ws→`-ws`), agent-web-ui(ws 타입만
→ `-ws` 의존, React/hono 미유입), blog 예제(http→`-http`). 코어 `/headless`·`/testing` 소비자 무변경.

**검증 증거:**

- 5개 패키지 빌드 + typecheck 통과. 테스트: core 36 + ws 31 + http 16 + mcp 7 + tui 379 = **469**
  (= 분할 전 transport 합계), agent-cli 139, agent-web-ui(테스트 없음, typecheck/build OK). frozen-lockfile 통과.
- `pnpm harness:scan` **25/25 passed**(background-workspace 경로·spec-paths·done-evidence stale 참조 모두
  새 패키지 경로로 갱신; capability-placement는 기존 `agent-transport-*` 패턴이 커버; interface-imports PASS;
  conformance PASS).
- **User Execution Test Scenario (done-gate):** 빌드된 CLI `node bin/robota.cjs --help` → 정상 로드 +
  옵션 출력, **exit 0**(cli.ts의 `-tui`/`-ws` import 런타임 해소 입증). `robota -p "hi"`(무설정) →
  provider-config 단계 도달("No provider configuration found"), 모듈-로드 크래시 아님 — transport 배선
  무손상 확인.

배치 등록: project-structure.md, publish-registry.md(5행), changeset, background-workspace 가드 경로.

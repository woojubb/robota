---
title: 'ARCH-FIX-007: CLI 웹 사이드카 기능을 아키텍처 맵 및 SPEC에 등재'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: documentation
related: [V-CLI-001, PLG-002]
---

## Problem

`agent-cli`에 WebSocket 사이드카 모드(`--web` 플래그)가 구현되어 있으나 아키텍처 맵 전체에서 누락되어 있다.

- `target-architecture.md` 의존성 그래프에 WS transport 노드/엣지 없음
- `execution-modes.md`에 세 번째 실행 모드(WebSocket 사이드카 모드) 없음
- `class-interface-inventory.md`에 관련 클래스/인터페이스 없음
- `agent-cli/docs/SPEC.md`에 전혀 언급 없음

이 기능은 백로그 `CLI-003`, `CLI-004`에만 존재한다. 구현된 기능이 아키텍처 맵과 SPEC에 등재되지 않은 것은 `common-mistakes.md` #45, #53 위반이다.

## Solution

1. `execution-modes.md`에 WebSocket 사이드카 실행 모드를 세 번째 모드로 추가한다.
2. `target-architecture.md` 의존성 그래프에 `@robota-sdk/agent-transport-ws` 노드와 `--web` 플래그 경로를 추가한다.
3. `class-interface-inventory.md`에 `web-sidecar-server.ts`의 클래스/인터페이스를 추가한다.
4. `agent-cli/docs/SPEC.md`에 `--web` 플래그와 WebSocket 사이드카 모드 섹션을 추가한다.
5. `agent-cli-composition.md` 라우터에 웹 사이드카 아키텍처 슬라이스 링크를 추가한다.

## Test Plan

- 각 아키텍처 맵 파일에 `--web` / WebSocket 사이드카 관련 항목 존재 확인
- SPEC.md에 해당 섹션 존재 확인
- 문서의 의존 방향이 실제 코드(`web-sidecar-server.ts` → `useInteractiveSession.ts`)와 일치하는지 수동 검증

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

Back-filled 2026-07-26 by re-deriving each Solution step against the live tree.

| Solution step                             | Citation                                                                                                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| third execution mode registered           | `.agents/specs/architecture-map/agent-cli/execution-modes.md:70` — `## Runtime Host Mode (\`robota --serve\`)`, landed-note `:72-76`, sequence diagram `:78-97`                                       |
| WS transport node in the dependency graph | `.agents/specs/architecture-map/agent-cli/target-architecture.md:111` — `TransportWs["@robota-sdk/agent-transport-ws\nWsTransport"]`; allowed-edge row `:160`; `startRuntimeHost` ownership row `:93` |
| package SPEC section                      | `packages/agent-cli/docs/SPEC.md:7-11` (mode + `startRuntimeHost` + `WsTransport` + `ROBOTA_WS_TOKEN`), transport row `:450`                                                                          |
| router link                               | `.agents/specs/architecture-map/agent-cli-composition.md:14` routes "transports, or execution flags" to `execution-modes.md`                                                                          |

**The item's premise was retired, not implemented.** It was filed against a `--web` flag; the surface
shipped as `--serve` / `startRuntimeHost`. That is stated in the destination document itself —
`.agents/specs/architecture-map/agent-cli/execution-modes.md:99-103`: _"Superseded design. The earlier
`--web` / `--web-port` flags and `startWebSidecarServer(interactiveSession, port)` were never built."_

**One Solution step is NOT satisfied, recorded rather than glossed:** step 3 asked for the sidecar's
classes in `.agents/specs/architecture-map/agent-cli/class-interface-inventory.md`, and
`rg -n "WsTransport|serve-mode|startRuntimeHost|RuntimeHost"` over that file returns **zero matches**
(its only WS mention is the old→new package-rename row at `:18`). The registration landed in
`target-architecture.md` and the SPEC instead.

---
title: 'ARCH-FIX-007: CLI 웹 사이드카 기능을 아키텍처 맵 및 SPEC에 등재'
status: todo
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

(완료 후 각 문서 업데이트 diff 링크 기록)

---
title: 'ARCH-FIX-004: agent-team, agent-remote-client 아키텍처 맵 레이어 등재'
status: done
created: 2026-05-10
priority: high
urgency: soon
area: documentation
related: [V-DEP-003, V-DEP-006]
---

## Problem

`agent-team`과 `agent-remote-client`가 `dependency-direction.md` 레이어 다이어그램과 `agent-system.md` Product Stack 다이어그램 어느 쪽에도 등재되지 않았다. 두 패키지 모두 실제로 사용 중인 패키지이며 다른 패키지의 의존 대상이다.

- `agent-team`: `agent-core`, `agent-tools`, `agent-tool-mcp`, `agent-event-service`에 의존하는 orchestration 패키지
- `agent-remote-client`: HTTP 클라이언트 패키지, `prepublishOnly` 스크립트 누락 (현재 private)

아키텍처 맵 stale 상태는 `common-mistakes.md` #45 위반이다.

## Solution

1. `agent-team`의 아키텍처 레이어를 확정한다 (예: Orchestration/Assembly 상위 레이어 또는 별도 분류).
2. `agent-system.md` Product Stack 다이어그램에 `agent-team` 노드와 의존 엣지를 추가한다.
3. `dependency-direction.md` 레이어 표에 `agent-team`을 적절한 레이어에 추가한다.
4. `agent-remote-client`의 레이어 소속을 결정하고 동일하게 등재한다.
5. `repository-overview.md`의 패키지 패밀리 설명이 두 패키지를 정확히 반영하는지 확인하고 보완한다.

## Test Plan

- `agent-system.md`와 `dependency-direction.md`에 `agent-team`, `agent-remote-client` 노드 존재 확인
- 등재된 의존 방향이 실제 `package.json`과 일치하는지 수동 대조

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

Back-filled 2026-07-26 by re-deriving both Test Plan checks against the live tree (the original record
promised a diff link and never carried one).

**`agent-remote-client` is registered in all three documents**, and the registered direction matches
the real manifest:

| Check                             | Citation                                                                                                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| layer table                       | `.agents/specs/architecture-map/dependency-direction.md:21` — `Orchestration["Orchestration\nagent-remote-client"]`, edges at `:44,:45,:51`                                                                                                        |
| Product Stack diagram node        | `.agents/specs/architecture-map/agent-system.md:101` — `RemoteClient["agent-remote-client…"]`, edges `:109,:111`; ownership row `:128`                                                                                                             |
| package-family description        | `.agents/specs/architecture-map/repository-overview.md:16`                                                                                                                                                                                         |
| direction vs. real `package.json` | `packages/agent-remote-client/package.json` deps = `{"@robota-sdk/agent-core":"workspace:*"}` → matches `RemoteClient --> Core`; `packages/agent-playground/package.json` depends on `agent-remote-client` → matches `Playground --> RemoteClient` |

**The `agent-team` half of this item is moot, not fixed.** The package no longer exists —
`git log --diff-filter=D -- packages/agent-team` → `6acec82ec release: CORE-002~004 embedded API,
TOOL-003 agent-team removal, CORE-007 embedding guide (#614)`, with the removal documented at
`content/guide/migration.md:26,242-245`. Its absence from the architecture maps is therefore the
correct state today, not the defect this item was filed against. Recorded rather than quietly dropped.

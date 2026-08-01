---
title: 'ARCH-FIX-015: apps/agent-web /monitor 라우트를 아키텍처 맵 및 SPEC에 등재'
status: done
created: 2026-05-10
priority: medium
urgency: backlog
area: documentation
related: [V-CON-004, PLG-002]
---

## Problem

`apps/agent-web`의 `/monitor` 라우트가 구현되어 있으나 아키텍처 문서에 등재되지 않았다:

- `apps-and-deployment.md`에 언급 없음
- `apps/agent-web`의 SPEC.md나 README에 언급 없음

`/monitor`는 CLI 세컨드 스크린 기능의 핵심 진입점이다. 백로그 `PLG-002`와 연관된 제품 기능이 문서화되지 않은 상태다.

## Solution

1. `apps-and-deployment.md`에 `apps/agent-web`의 라우트 구조를 추가한다 (`/`, `/monitor` 등).
2. `apps/agent-web`의 SPEC.md 또는 README에 `/monitor` 라우트의 역할과 `packages/agent-web-ui과의 관계를 기술한다.
3. `PLG-002` 백로그가 완료되면 해당 아키텍처 등재를 이 항목에서 확인한다.

## Test Plan

- `apps-and-deployment.md`에 `/monitor` 라우트 언급 확인
- `apps/agent-web` 문서에 라우트 목록 존재 확인

## User Execution Test Scenarios

Not applicable — documentation-only change. No runnable user-facing behavior change.

## Verification Evidence

Back-filled 2026-07-26 by re-deriving each Solution step against the live tree.

| Fact                                    | Citation                                                                                                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/monitor` listed in the deployment map | `.agents/specs/architecture-map/apps-and-deployment.md:30` — ``Routes: `/` (→ `/playground`), `/playground`, `/playground/demo`, `/monitor` (CLI second-screen).``        |
| relationship to the shared GUI package  | `.agents/specs/architecture-map/apps-and-deployment.md:43` — ``its `/monitor` route mounts `SessionMonitor` from the shared GUI core `@robota-sdk/agent-transport-gui`.`` |
| app SPEC route structure                | `apps/agent-web/docs/SPEC.md:28-31` (the CLI second-screen role, its `NEXT_PUBLIC_CLI_WS_URL` default, and the `SessionMonitor` relationship)                             |
| component + env inventory rows          | `apps/agent-web/docs/SPEC.md:60` (`MonitorClient`), `:66` (env var), `:97` (imported-component row)                                                                       |

The Solution allowed "SPEC.md 또는 README"; this app has no README, and the SPEC carries it, which
satisfies the step as written.

**Drift found while back-filling — reported, not papered over.** The registrations above are all
present, but what they register is now WRONG: `apps/agent-web/src/app/` contains only `playground/`
and `remote/` — there is no `monitor/` directory and no `MonitorClient` anywhere under
`apps/agent-web/src`. The monitor moved to the CLI-served surface (`packages/agent-cli-web`) under
GUI-007, and neither `apps/agent-web/docs/SPEC.md:28-31` nor
`.agents/specs/architecture-map/apps-and-deployment.md:30,43` was updated. So two architecture
documents describe a route the app no longer has, and both still name
`src/app/monitor/MonitorClient.tsx` as its implementation.

That is drift introduced AFTER this item, not a failure of it — the registration this item asked for
did land — but it is a live defect in the same two documents and should be filed. Deliberately not
cited above as evidence, because a citation to a path that does not resolve is exactly the unearned
claim this back-fill exists to remove.

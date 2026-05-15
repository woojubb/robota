---
title: 'REFACTOR-008: Anti-monolith — 300줄 초과 파일 분할 (14개)'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-command-provider, packages/agent-core, packages/agent-sdk, packages/agent-sessions, packages/agent-transport-tui, packages/agent-transport-headless, packages/agent-provider-qwen, packages/agent-plugin-event-emitter, packages/agent-plugin-logging
---

## Problem

`pnpm harness:scan`이 기계적으로 검증해야 하는 300줄 규칙이 다수 파일에서 위반되고 있다 (COMBINED-001 InteractiveSession 1,578줄 제외, 별도 REFACTOR-001로 처리):

| 파일                                                       | 줄 수 |
| ---------------------------------------------------------- | ----- |
| `agent-command-provider/src/provider-command-execution.ts` | 713   |
| `agent-sdk/src/assembly/create-session.ts`                 | 482   |
| `agent-sdk/src/interactive/interactive-session-init.ts`    | 451   |
| `agent-core/src/services/execution-round.ts`               | 442   |
| `agent-sessions/src/session.ts`                            | 432   |
| `agent-core/src/core/robota.ts`                            | 392   |
| `agent-transport-tui/src/hooks/useInteractiveSession.ts`   | 365   |
| `agent-core/src/services/execution-round-tools.ts`         | 358   |
| `agent-core/src/services/execution-service.ts`             | 335   |
| `agent-provider-qwen/src/provider.ts`                      | 329   |
| `agent-plugin-event-emitter/src/event-emitter-plugin.ts`   | 328   |
| `agent-plugin-logging/src/logging-plugin.ts`               | 325   |
| `agent-sdk/src/tools/agent-tool.ts`                        | 323   |
| `agent-transport-headless/src/headless-runner.ts`          | 310   |

Rule violation: Anti-monolith — production files ≤ 300 lines.

Source: COMBINED-008 (SA-006, SD-016)

## Scope

각 파일을 책임 기준으로 분할한다. 우선순위:

1. **즉각 타깃** (>500줄): `provider-command-execution.ts`(713), `create-session.ts`(482), `interactive-session-init.ts`(451), `execution-round.ts`(442), `session.ts`(432)
2. **중간 타깃** (400~500줄): `robota.ts`(392), `useInteractiveSession.ts`(365), `execution-round-tools.ts`(358), `execution-service.ts`(335)
3. **경계 타깃** (300~340줄): 나머지 6개

분할 시 라인 수가 아닌 단일 책임 원칙에 따라 경계를 정한다.

## Test Plan

- 각 패키지 `pnpm test` — 통과
- `pnpm typecheck` — 전체 통과
- `pnpm harness:scan` — 300줄 초과 파일 0개
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 구조 분리이며 사용자 관찰 가능한 동작 변화 없음.

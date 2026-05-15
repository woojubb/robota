---
title: 'REFACTOR-004: EventEmitterPlugin 중복 제거 + Robota hard-instantiation 수정'
status: backlog
created: 2026-05-15
priority: high
urgency: soon
area: packages/agent-core, packages/agent-plugin-event-emitter
---

## Problem

`packages/agent-core/src/plugins/event-emitter-plugin.ts` (323줄)와 `packages/agent-plugin-event-emitter/src/event-emitter-plugin.ts` (328줄)에 동일 이름·역할의 구현 클래스가 두 곳에 공존한다.

agent-core SPEC.md는 "Plugins were externalized to agent-plugin-\* packages specifically to preserve this constraint"라고 명시하지만, 실제 구현은 core 내부에 잔존한다.

추가로, `packages/agent-core/src/core/robota.ts:26`이 `EventEmitterPlugin`을 직접 import하고 생성자에서 hard-instantiation한다:

```ts
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
```

Rule violation: No cross-package implementation duplication. Interface-first extension.

Source: COMBINED-004 (SA-004, SA-008)

## Scope

1. `agent-core/src/plugins/event-emitter-plugin.ts` 구현체를 제거. `IEventEmitterPlugin` 인터페이스(이미 `plugins/event-emitter/types.ts`에 존재)만 유지.
2. `agent-core/src/index.ts`에서 `EventEmitterPlugin` 클래스 export 제거.
3. `Robota` 생성자를 `eventEmitterPlugin?: IEventEmitterPlugin` optional injection으로 변경. 기본값은 null-object 패턴 또는 `agent-plugin-event-emitter`의 구현을 주입하도록 composition root에서 처리.
4. `agent-sdk` 또는 `agent-cli` composition root에서 `agent-plugin-event-emitter`의 구현을 주입.
5. `agent-plugin-event-emitter`가 정규 경로임을 SPEC에 명시.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-core test` — 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `grep -r "EventEmitterPlugin" packages/agent-core/src --include="*.ts"` — 구현 클래스 없음, 인터페이스만
- `pnpm build` — 전체 통과

## User Execution Test Scenarios

Not applicable — 내부 아키텍처 정리이며 이벤트 emitter 동작 자체는 동일하게 유지된다. 사용자 관찰 가능한 CLI/TUI 동작 변화 없음.

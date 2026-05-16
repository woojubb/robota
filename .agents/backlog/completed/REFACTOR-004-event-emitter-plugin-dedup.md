---
title: 'REFACTOR-004: agent-plugin-event-emitter 패키지 제거 (dead code)'
status: backlog
created: 2026-05-15
updated: 2026-05-16
priority: high
urgency: soon
area: packages/agent-plugin-event-emitter
---

## Problem

`packages/agent-plugin-event-emitter`는 전체 모노레포에서 아무도 import하지 않는 dead code 패키지다.

### 원래 분석 오류 (2026-05-15)

초기 분석은 `agent-core/EventEmitterPlugin`이 중복이며 제거 대상이라고 판단했다. 이는 잘못된 전제에 기반했다.

### 실제 상황 (2026-05-16 재조사)

- `agent-core/EventEmitterPlugin`은 SPEC에 "built-in — event coordination"으로 명시된 **의도적 내부 플러그인**이다.
- `agent-core`는 `agent-plugin-event-emitter`를 import할 수 없다: 순환 의존 발생 (`agent-plugin-event-emitter` → `@robota-sdk/agent-core`).
- 두 구현체는 verbatim 중복이 아니다: helper 위임 방식, `PluginError` 사용, `on()` 동작이 다르다.
- 전체 모노레포에서 `@robota-sdk/agent-plugin-event-emitter`를 import하는 파일이 단 하나도 없다.

**실제 문제**: `agent-plugin-event-emitter`가 사용되지 않는 orphan 패키지로 방치되어 있다.

## Scope

1. `packages/agent-plugin-event-emitter/` 디렉터리 전체 삭제.
2. `pnpm install`로 lockfile 갱신.
3. `pnpm build && pnpm typecheck`로 영향 없음 확인.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm build` — 전체 통과
- `ls packages/ | grep agent-plugin-event-emitter` — 존재하지 않음

## User Execution Test Scenarios

Not applicable — 아무도 사용하지 않는 패키지 삭제이며 외부 동작 변화 없음.

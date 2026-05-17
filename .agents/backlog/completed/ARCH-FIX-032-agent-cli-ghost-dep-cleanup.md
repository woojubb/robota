---
title: 'ARCH-FIX-032: remove ghost dependency agent-interface-transport from agent-cli'
status: done
created: 2026-05-17
priority: low
urgency: soon
area: packages/agent-cli, packages/agent-interface-transport
---

## Problem

`agent-cli/package.json`이 `@robota-sdk/agent-interface-transport`를 dependency로 선언하고 있으나
`agent-cli/src/` 어디에서도 import하지 않는다. ghost dependency다.

`agent-framework`과 `agent-transport`가 이미 `agent-interface-transport`를 의존하므로
`agent-cli`가 직접 선언할 이유가 없다.

추가로 `packages/agent-interface-transport/src/transport-adapter.ts` 1번 주석이
구버전 패키지명을 참조하고 있다:

```
// Moved from agent-sdk to break the circular dependency…
```

`agent-sdk`는 현재 `agent-framework`로 리네임되었다.

## Proposed Change

1. `agent-cli/package.json`에서 `@robota-sdk/agent-interface-transport` 제거
2. `transport-adapter.ts` 주석: `agent-sdk` → `agent-framework` 수정

## Scope

- `packages/agent-cli/package.json`
- `packages/agent-interface-transport/src/transport-adapter.ts`

## Test Plan

- `pnpm --filter @robota-sdk/agent-cli typecheck` — ghost dep 제거 후 타입 오류 없음 확인
- `pnpm --filter @robota-sdk/agent-cli build`
- `pnpm --filter @robota-sdk/agent-cli test`

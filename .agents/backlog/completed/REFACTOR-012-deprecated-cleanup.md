---
title: 'REFACTOR-012: @deprecated 제거 — agent-provider-google, agent-playground'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-provider-google, packages/agent-playground
---

## Problem

`@deprecated` 어노테이션이 두 패키지에 잔존한다:

```ts
// agent-provider-google/src/types.ts:7,12
/** @deprecated Use `TGeminiProviderOptionValue` from `@robota-sdk/agent-provider-gemini`. */
export type TGoogleProviderOptionValue = TGeminiProviderOptionValue;

// agent-provider-google/src/provider.ts:5
/** @deprecated Import `GeminiProvider` from `@robota-sdk/agent-provider-gemini`. */
export class GoogleProvider extends GeminiProvider { ... }

// agent-playground/src/contexts/playground-context/types.ts:31
/** @deprecated Use usePlaygroundState() or usePlaygroundActions() for better performance. */
```

미배포 프로젝트에서 deprecated 표시는 금지된다 — 외부 소비자 없으면 삭제, 내부 소비자 있으면 같은 작업에서 마이그레이션 완료.

Rule violation: No deprecated rule.

Source: COMBINED-012 (SD-008)

## Scope

1. **agent-provider-google**: 외부 소비자 없음 확인 후 `GoogleProvider` 클래스와 `TGoogleProviderOptionValue` 타입 삭제 또는 패키지 자체를 agent-provider-gemini의 re-export barrel로 축소. agent-cli 등 내부 소비자가 있다면 동일 PR에서 `agent-provider-gemini`로 import 변경.

2. **agent-playground**: deprecated context type의 소비자를 `usePlaygroundState()`/`usePlaygroundActions()`로 마이그레이션. deprecated type 삭제.

## Test Plan

- `grep -r "@deprecated" packages/agent-provider-google packages/agent-playground --include="*.ts"` — 결과 없음
- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-provider-google test` — 통과
- `pnpm --filter @robota-sdk/agent-playground test` — 통과

## User Execution Test Scenarios

Not applicable — 이미 사용되지 않는 심벌 제거이며 사용자 관찰 가능한 동작 변화 없음.

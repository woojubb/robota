---
title: 'REFACTOR-014: buildFailureResult 부정직한 타입 수정 (undefined as unknown as TOutput)'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-core
---

## Problem

`packages/agent-core/src/abstracts/workflow-converter-helpers.ts:91`의 `buildFailureResult`가 실패 경로에서 `data` 필드를 `undefined as unknown as TOutput`으로 채운다:

```ts
data: undefined as unknown as TOutput,
success: false,
```

`IWorkflowConversionResult<TOutput>.data`가 non-optional `TOutput`이므로, caller가 `result.success === false`인 상태에서 `result.data`를 역참조하면 런타임 오류가 발생한다. 타입이 거짓말을 하는 상태다.

Rule violation: `as unknown as` in production code. Dishonest contract.

Source: COMBINED-014 (SD-010)

## Scope

`IWorkflowConversionResult`를 discriminated union으로 변경:

```ts
type IWorkflowConversionResult<TOutput> =
  | { success: true; data: TOutput }
  | { success: false; data?: never };
```

또는 단순히 `data?: TOutput`으로 변경하고 caller에서 `result.success` 체크 후 `result.data` 접근.

소비자 코드 전체 업데이트 포함.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `grep -r "undefined as unknown as" packages/agent-core/src --include="*.ts"` — 결과 없음
- `pnpm --filter @robota-sdk/agent-core test` — 통과

## User Execution Test Scenarios

Not applicable — 내부 타입 정확성 수정이며 사용자 관찰 가능한 동작 변화 없음.

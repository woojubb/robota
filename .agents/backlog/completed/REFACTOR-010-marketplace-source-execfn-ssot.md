---
title: 'REFACTOR-010: IMarketplaceSource + ExecFn SSOT 위반 정리'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-sdk
---

## Problem

같은 패키지 내 두 가지 SSOT 위반:

**1. IMarketplaceSource 중복:**
`packages/agent-sdk/src/plugins/marketplace-types.ts:6–10`과 `plugin-settings-store.ts:11–15`에 동일한 type alias가 verbatim으로 중복 존재:

```ts
export type IMarketplaceSource =
  | { type: 'github'; repo: string; ref?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }
  | { type: 'url'; url: string };
```

**2. ExecFn 명명 위반 + 중복:**

- `marketplace-types.ts:39`에 `ExecFn`으로 export (T\* prefix 없음)
- `bundle-plugin-installer.ts:27`에 private으로 재정의

Rule violation: No cross-file type duplication. T\* prefix for type aliases.

Source: COMBINED-010 (SD-005, SD-006)

## Scope

1. `plugin-settings-store.ts`에서 `IMarketplaceSource` 중복 정의 제거. `marketplace-types.ts`에서 import.
2. `ExecFn` → `TExecFn`으로 rename.
3. `bundle-plugin-installer.ts`의 private `ExecFn` 재정의 제거. `marketplace-types.ts`의 `TExecFn` import.
4. 참조 전체 업데이트.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `pnpm --filter @robota-sdk/agent-sdk test` — 통과
- `grep -r "type IMarketplaceSource\|type ExecFn" packages/agent-sdk/src --include="*.ts"` — marketplace-types.ts 한 곳만 존재, ExecFn 없음

## User Execution Test Scenarios

Not applicable — 내부 타입 정리이며 사용자 관찰 가능한 동작 변화 없음.

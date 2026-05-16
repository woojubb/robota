---
title: 'REFACTOR-016: agent-tools IZodSchema cast 중앙화 (8개 파일 반복 제거)'
status: backlog
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-tools
---

## Problem

`packages/agent-tools/src/builtins/` 하위 8개 파일 모두 Zod schema를 `as unknown as IZodSchema`로 캐스트한다:

```ts
// web-fetch-tool.ts:104, write-tool.ts:51, glob-tool.ts:103, read-tool.ts:164
// edit-tool.ts:115, web-search-tool.ts:101, grep-tool.ts:228, bash-tool.ts:144
schema as unknown as IZodSchema;
```

`IZodSchema` 인터페이스가 Zod schema를 구조적으로 포함하지 않아 발생하는 계통적 결함이다.

Rule violation: `as unknown as` in production code (8곳).

Source: COMBINED-016 (SD-012)

## Scope

Option A (권장): `IZodSchema`를 Zod `ZodObject<...>`가 구조적으로 satisfies하도록 widening. 캐스트 8개 모두 제거.

Option B: cast를 `createZodFunctionTool` 내부 한 곳으로 중앙화. 각 built-in tool은 `z.ZodObject<...>` 타입으로만 schema를 넘기고 factory 내부에서 한 번만 변환.

둘 중 설계 확정 후 구현.

## Test Plan

- `pnpm typecheck` — 전체 통과
- `grep -r "as unknown as IZodSchema" packages/agent-tools/src --include="*.ts"` — 결과 없음 (또는 factory 내부 1곳만)
- `pnpm --filter @robota-sdk/agent-tools test` — 통과

## User Execution Test Scenarios

Not applicable — 내부 타입 정확성 개선이며 도구 동작 자체는 변경되지 않는다.

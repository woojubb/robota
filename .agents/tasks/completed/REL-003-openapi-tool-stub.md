---
title: 'REL-003: Remove OpenAPITool from public exports or implement execute()'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: packages/agent-tools
depends_on: []
---

## Background

`packages/agent-tools/src/implementations/openapi-tool.ts:171` throws unconditionally:

```typescript
throw new Error('Not implemented: actual API execution is not yet available');
```

`createOpenAPITool` is fully exported from `@robota-sdk/agent-tools` (line 40 of `index.ts`).
It is fully typed and the constructor accepts a valid OpenAPI spec with no warning.
Any developer who imports it and calls `.execute()` gets a runtime crash with no warning
at import or construction time.

This is a shipped public API stub. Source: pre-release dev audit 2026-05-25 (Gate G3).

## Options

**Option A (recommended):** Remove `createOpenAPITool` from `packages/agent-tools/src/index.ts`.
Mark it `@internal` in the source file. It can be restored to the public API when implemented.

**Option B:** Implement `execute()` in `openapi-tool.ts` to actually perform the HTTP call
described in the OpenAPI operation.

Option A is the safer and faster path for the release gate.

## Acceptance Criteria

- `createOpenAPITool` is not exported from `@robota-sdk/agent-tools/index.ts`, OR
- `OpenAPITool.execute()` no longer throws `Error('Not implemented')`
- `pnpm typecheck` and `pnpm test` still pass

## Supplementary Evidence (2026-06-11)

This item was previously marked done while the stub still existed in the tree — the new
HARNESS-008 stub-marker scan caught `Not implemented` at openapi-tool.ts:171 on 2026-06-11
(recorded as a HARNESS-002 incident example). Actual removal completed today:
`OpenAPITool`/`createOpenAPITool` removed from `packages/agent-tools/src/browser.ts`,
openapi-tool.ts + openapi-schema-converter.ts deleted (no consumers; `IToolFactory` has zero
implementors), `openapi-types` devDependency dropped with lockfile update, SPEC rows removed.
agent-tools 159/159 tests green; `harness:scan:stub-markers` passes.

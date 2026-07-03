---
title: 'SDK-009: createZodFunctionTool executor args should infer z.infer<S> instead of Record<string, TUniversalValue>'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: low
urgency: later
area: packages/agent-tools
depends_on: []
---

# Zod tool executor type inference

External adoption feedback (speech project, `.design/feedback-speech-adoption-2026-07-03.md` §3.5):
`createZodFunctionTool` already runtime-validates args with `safeParse` before the executor runs,
but the executor's parameter type is `Record<string, TUniversalValue>` — so strict consumers
(`noUncheckedIndexedAccess`) must write defensive conversions like `String(args['personaId'] ?? '')`
for values the runtime has already guaranteed.

## What

- Generic signature: `createZodFunctionTool<S extends z.ZodType>(name, description, schema: S,
fn: (args: z.infer<S>, context?: IToolExecutionContext) => …)` — the runtime check exists; only
  the type needs to flow.
- Keep the built tool's outward `IToolWithEventService` shape unchanged (structural compatibility
  is a valued property per the same feedback §2.5).
- Migrate internal builtins' executors off their `params as TX` casts where the inference now
  covers them.

## Test Plan

- Type-level test (expectTypeOf): executor args typed as the schema's inferred object; invalid
  property access is a compile error.
- Existing agent-tools suite green (no runtime behavior change).

## User Execution Test Scenarios

- Not applicable beyond compile-time DX (library typing change; no runtime behavior). Evidence: a
  strict-mode consumer snippet compiling without defensive casts, recorded at implementation.
- Evidence: **PASS (2026-07-03).** `createZodFunctionTool<S extends ZodType>(name, description,
schema: S, fn: TToolExecutor<TypeOf<S>>)` — the already-generic `TToolExecutor<TParams>` carries
  the inference; the executor now receives the PARSED value typed `z.infer<S>` (zod defaults
  applied — covered by a runtime test). Outward `FunctionTool`/`IToolWithEventService` shape
  unchanged (asserted). Migrated every internal call site off its cast: 9 builtin executors'
  `params as TXArgs` removed (read/write/edit/glob/grep/shell/web-fetch/web-search/
  ask-user-question) and all 4 agent-framework `asZodSchema(...)` helper casts deleted
  (background-process/agent/model-command-projection/command-execution tools). Type-level test
  (`expectTypeOf` + `@ts-expect-error` on invalid property, vitest --typecheck: 0 type errors);
  agent-tools 145 + framework 1033 + full repo test/typecheck green. User Execution
  (strict-mode consumer): snippet with `noUncheckedIndexedAccess: true` compiled against the
  BUILT package `.d.ts` (the real consumer surface) using direct `args.personaId` access — no
  `String(args['x'] ?? '')` defensive casts — exit 0.

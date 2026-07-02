---
title: 'SDK-009: createZodFunctionTool executor args should infer z.infer<S> instead of Record<string, TUniversalValue>'
status: todo
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
- Evidence: _to fill at implementation._

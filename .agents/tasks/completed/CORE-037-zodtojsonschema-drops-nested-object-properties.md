---
title: "CORE-037: zodToJsonSchema converts a nested z.object() to a bare { type: 'object' } with no properties or required, so every tool and structured-output schema with one level of nesting reaches the model as an unspecified blob — the handler is then never successfully invoked, sometimes with no error at all"
status: superseded
created: 2026-08-16
completed: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core, packages/agent-tools
depends_on: []
---

# CORE-037: nested objects lose their fields in Zod → JSON Schema conversion

Reported by an external user in [issue #1737](https://github.com/woojubb/robota/issues/1737)
(`@robota-sdk/agent-core` 3.0.0-beta.78, re-confirmed against `develop`).

## Problem

`convertZodTypeToProperty` returns `{ type: 'object' }` for `ZodObject` without recursing into the
shape. The top-level object is handled separately by `zodToJsonSchema` (which does walk the shape),
so only **nested** objects lose their `properties`/`required`. The model therefore sees "this field
is an object" with no indication of what belongs in it.

```ts
zodToJsonSchema(z.object({ inner: z.object({ s: z.string() }) }));
// → { type: 'object', properties: { inner: { type: 'object' } }, required: ['inner'] }
//                                            ^^^^^^^^^^^^^^^^^^ shape discarded
```

## Evidence (verified against `develop`, 2026-08-16)

- `packages/agent-core/src/schema/zod-to-json-schema.ts:96-97` —
  `case 'ZodObject': return { type: 'object', ...base };` — no recursion.
- Same file, `case 'ZodArray'` (`:84-94`) **does** recurse via
  `convertZodTypeToProperty(typeDef.type)`, and `ZodRecord` recurses into `valueType` — so the
  omission is specific to `ZodObject`, not a deliberate depth limit.
- Consequence for `z.array(z.object(...))`: the array recurses into `ZodObject`, which then returns
  the bare form — so arrays-of-objects are affected through the same case.

Reporter's measured downstream effect (forced tool call, `toolChoice: { tool: name }`,
`maxExecutionRounds: 1`, same model and prompt, only the schema shape varied):

| tool input schema                                    | handler invoked |
| ---------------------------------------------------- | --------------- |
| `{ a: string, b: string }`                           | yes             |
| `{ items: string[] }`                                | yes             |
| `{ items: string[] }` with `.max(2)`                 | yes             |
| `{ delivery: { score, evidence[], suggestions[] } }` | no              |
| 5 × the above nested object + `summary: string`      | no              |

Flat schemas including arrays and constraints work; one level of nesting is enough to break it.

## A shipped built-in tool is already affected

This is not confined to user-authored tools. `packages/agent-tools/src/implementations/function-tool.ts:40`
calls `zodToJsonSchema(zodSchema)` for every `createZodFunctionTool`, and the built-in computer-use
tool nests:

- `packages/agent-tools/src/computer-use/computer-tool.ts:72-74` —
  `const ComputerSchema = z.object({ action: ActionSchema.describe(…) })`, where `ActionSchema` is a
  13-field `z.object`. The model therefore receives `action` as `{ type: 'object' }` with **no
  fields at all** — the action vocabulary, the coordinates, the key list, none of it.
- Same file `:64` — `path: z.array(PointSchema)` is an array-of-objects, stripped through the same
  `ZodArray` → `ZodObject` route.

The comment above `ActionSchema` ("A flat object (not a discriminated union) so it converts to JSON
schema") shows the converter's limits were already being worked around one level down, while the
level above still nests. Whether the `Computer` tool is currently invocable at all should be checked
as part of this work; if it is not, that raises the severity and may overlap TOOL-004 (built-in tool
descriptions name parameters the schema rejects).

## Impact

- Any `createZodFunctionTool` tool whose input has a sub-object is effectively uncallable. The
  failure is quiet: sometimes the run completes with the handler never called and no error raised,
  sometimes it surfaces as `Validation Error: Failed to parse arguments for tool "<name>"` — neither
  points at schema conversion.
- The same converter feeds `IStructuredOutputSpec.jsonSchema`, so `run(input, { output })` (CORE-015)
  hands providers the same truncated schema on both the native and the fallback transport.
- The reporter's domain object (five scored axes, each `{ score, evidence[], suggestions[] }`) cannot
  be expressed flatly without exploding into ~16 sibling fields.

## Direction

> **Re-planned — [CORE-039](CORE-039-universal-schema-subset-treats-object-as-a-leaf.md)
> ([#1743](https://github.com/woojubb/robota/issues/1743)).** `finding-depth-triager` returned
> `DEPTH: FOUNDATIONAL` on this item's problem statement (2026-08-16): the cause is that the universal
> schema subset treats an object as a leaf and independent walks over it each re-decide what
> `object` means (seven, once counted). The Direction below is the in-place patch [finding-depth.md](../../rules/finding-depth.md)
> forbids — applied alone it makes `packages/agent-tools/src/builtins/ask-user-question-tool.ts:169`
> throw at **import time** (its nested `z.union` reaches the converter's `default:` throw, which the
> early return currently makes unreachable), while every other walk stays wrong. This item is
> delivered by CORE-039's change; the paragraph below is kept as the original report.

Recurse for `ZodObject`, mirroring `ZodArray`. `zodToJsonSchema` already contains the
"object shape → `properties`/`required`" walk for the top level; extract it into a shared helper so
the entry point and the nested case cannot diverge again. Check the interaction with `ZodOptional`
inside a nested shape (an optional nested field must stay out of `required`) and confirm the
`IParameterSchema` type actually carries nested `properties`/`required` — if it does not, widening
it is part of this work.

## Test Plan

- Converter tests for: two levels of nesting; an optional field inside a nested object (absent from
  that object's `required`); `z.array(z.object(...))`; a nested object carrying a `.describe()`.
- A round-trip test asserting the emitted schema validates a conforming payload and rejects one
  missing a nested required field, so the fix is pinned by behavior and not only by shape.
- Check the other `IParameterSchema` producers/consumers (provider adapters that forward tool
  schemas) accept the now-deeper shape.
- A test pinning the built-in `Computer` tool's emitted parameter schema, so the regression that
  silently emptied its `action` field cannot recur unnoticed.
- `pnpm harness:verify -- --scope packages/agent-core` and `--scope packages/agent-tools` green.

## Outcome

**Superseded by [CORE-039](CORE-039-universal-schema-subset-treats-object-as-a-leaf.md)
([#1743](https://github.com/woojubb/robota/issues/1743)), which fixed the reported defect.** The
status is `superseded` rather than `done` because it is this item's SCOPE that was replaced, not its
report: `finding-depth-triager` returned `DEPTH: FOUNDATIONAL` on the problem statement, so the
Direction below was never implemented as written. The behaviour the reporter hit is fixed —
a nested `z.object()` now keeps its `properties` and `required`, and the two shipped built-ins this
item named advertise their fields again. The evidence is CORE-039's user-execution scenarios, which
cover the same observable without requiring the provider credentials this item's own scenario asked
for; that scenario was therefore never executed and is left as filed.

## User Execution Test Scenarios

Applies — this changes observable SDK behavior.

**Scenario 1 — a tool with a nested-object input is actually invoked**

- Prerequisites: a provider API key (or OpenAI-compatible gateway `baseURL`) exported; `pnpm build`.
- Environment: uses the existing examples surface; confirm at implementation time which example
  registers a Zod tool, and extend it (or add a minimal script there) with a nested-object input.
- Steps: define a tool via `createZodFunctionTool` whose input is
  `z.object({ report: z.object({ score: z.number(), notes: z.array(z.string()) }) })` with a handler
  that prints its received argument; run the agent with `toolChoice` forcing that tool and a prompt
  that supplies the values.
- Expected observable result: the handler prints a fully populated `report` object. (Before the fix,
  the handler is not called, or the run reports `Failed to parse arguments`.)
- Cleanup: none.
- Evidence: _to be filled after implementation_ (paste the handler output and the run result).

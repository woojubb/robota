---
title: 'CORE-041: the hand-rolled Zod converter throws on ZodTuple, ZodDate, ZodIntersection, ZodLazy and ZodNativeEnum, so a tool or structured-output schema using any of them fails at construction rather than converting — a recurring coverage tail that a maintained library would not have'
status: done
created: 2026-08-16
completed: 2026-08-17
priority: low
urgency: later
area: packages/agent-core
depends_on: [CORE-039]
---

# CORE-041: the converter's unsupported-Zod-construct tail

Filed by [CORE-039](CORE-039-universal-schema-subset-treats-object-as-a-leaf.md), which absorbed the
constructs with a defect behind them and deferred the ones without.

## Problem

`convertZodTypeToProperty` (`packages/agent-core/src/schema/zod-to-json-schema.ts`) ends in
`default: throw new Error('Unsupported Zod type: …')`. After CORE-039 the supported set is
`ZodString`, `ZodNumber`, `ZodBoolean`, `ZodArray`, `ZodObject`, `ZodEnum`, `ZodOptional`,
`ZodNullable`, `ZodDefault`, `ZodRecord`, `ZodUnion`, `ZodDiscriminatedUnion`, `ZodLiteral` and
`ZodEffects` (unwrapped). Still unsupported: `ZodTuple`, `ZodDate`, `ZodIntersection`, `ZodLazy`,
`ZodNativeEnum`, and whatever Zod adds next.

A consumer using any of them gets a throw at tool construction — loud, which is the correct posture, but
it means the SDK's `createZodFunctionTool` and `run(input, { output })` accept a strictly smaller
language than Zod, and the boundary is discovered rather than published.

## Why it was deferred rather than absorbed

CORE-039's absorb criterion was "is there a defect behind it", not "how much work is it". `ZodUnion` was
forced (recursing without it crashes `@robota-sdk/agent-tools` at import); `ZodDiscriminatedUnion` and
`ZodLiteral` were justified by a shipped work-around (`agent-tools/src/computer-use/computer-tool.ts:50-53`
documents a tool schema distorted to dodge the gap). These have **zero in-repo users** and no work-around
behind them, so absorbing them would have been scope taken on speculation.

## The decision, re-run — and the library does NOT dissolve this

The item was explicit: do not mechanically add `ZodTuple` and call it done. Re-run, the tail turns out
to be **two different problems wearing one label**, and the library changes neither.

**Group A — the subset CAN express it, and nothing was in the way.** `ZodNativeEnum` maps to `enum`
exactly. `ZodDate` maps to `{ type: 'string', format: 'date-time' }` — and that is not a lossy
stand-in: JSON has no date type, so a string is what the provider receives either way, and `format`
is already a member of `IParameterSchema`. These were missing for no reason. **Added.**

**Group B — the subset CANNOT express it, and no library fixes that.** A tuple needs POSITIONAL
`items`; `IParameterSchema.items` is one schema. An intersection needs `allOf`. Recursion needs
`$ref`. None of the three is in the subset, and — the load-bearing part — none would survive the
field-enumerated provider mappers if it were.

That is the answer to CORE-039's deferred concession that "adopting the library would dissolve this
item permanently". **It would not.** `zod-to-json-schema` emits precisely `$ref` / `definitions` /
`allOf` — the constructs CORE-039 rejected it FOR. Adopting it relocates this same decision into a
normalizing pass that must still answer "a tuple becomes what?", and adds a dependency to carry the
question. The difficulty was never PARSING Zod; it is that the target language cannot say these
things, and a library emitting a richer document widens the gap rather than closing it.

**Mapping Group B lossily was the other option, and is worse than throwing.** A tuple flattened to
`array of anyOf[string, number]` would tell the model that any order and any length are acceptable —
a contract the author did not write. Silently weakening a declared schema is the same defect class as
CORE-040, reached from the other side.

So Group B still throws, which this item already called the correct posture. What changes is the half
it complained about: the boundary is **published** rather than discovered. `Unsupported Zod type:
ZodTuple` told a consumer the name of their own construct and nothing they could act on. The message
now names the construct, says why the subset cannot carry it, and names a Zod expression to write
instead — and the default branch still does the general half for a construct nobody has named yet.

## Test Plan

`packages/agent-core/src/schema/__tests__/zod-construct-boundary.test.ts` — eight cases against REAL
Zod, **seven red** against the unfixed code:

```
× converts a native enum to an enum node        → Unsupported Zod type: ZodNativeEnum
× converts a numeric native enum to its value set → Unsupported Zod type: ZodNativeEnum
× converts a date to the string a provider receives → Unsupported Zod type: ZodDate
× carries them through nesting                   → Unsupported Zod type: ZodNativeEnum
× ZodTuple / ZodIntersection / ZodLazy: the message says WHY rather than only WHAT
```

The numeric-enum case exists because it is the one that is easy to get wrong: a numeric TypeScript
enum compiles with a reverse mapping, so `Object.values` yields `['Low','High',0,1]` and the naive
conversion would advertise `"Low"` as acceptable for a field that accepts `0`.

The boundary cases assert the message is ACTIONABLE, checked structurally — it must name a Zod
expression (`/z\.[a-z]+\(|\.merge\(/`), not merely contain the word "instead", which prose
containing it would satisfy without helping anyone.

A final case drives a construct name this file has never heard of, because the tail is open-ended
("whatever Zod adds next") and a boundary published only for today's list is not published.

Two pre-existing tests pinned the old behaviour and are updated, not deleted:
`zod-to-json-schema.real-zod.test.ts` used `ZodDate` as its example of an unsupported nested type —
now supported, so `ZodTuple` takes its place; `zod-to-json-schema.test.ts` pinned the old message
string.

`agent-core` 1098 tests pass.

## User Execution Test Scenarios

**Applies**, and it is the shape the item anticipated: build a tool whose input uses the
newly-supported construct and read back the schema the SDK hands the provider. `agent-executable` and
provider-free — nothing is sent anywhere.

### Scenario — a Zod schema the SDK used to refuse now reaches the model correctly

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-041.ts`

**Evidence:** EXIT:0

```
constructs the SDK can now carry:
  schema the model is shown: {"type":"object","properties":{"priority":{"type":"string","enum":["low","high"]},"level":{"type":"number","enum":[0,1]},"when":{"type":"string","format":"date-time"}},"required":["priority","level","when"],"additionalProperties":true}
constructs it refuses, and what it says:
  z.tuple([...]): REFUSED -> ZodTuple cannot be carried by the universal JSON-schema subset: a tuple needs positional `items`, and the subset models `items` as ONE schema — use `z.object({...})` for a fixed-shape record, or `z.array(z.union([...]))` if order genuinely does not matter. …
  z.lazy(...): REFUSED -> ZodLazy cannot be carried by the universal JSON-schema subset: a recursive schema needs `$ref` — flatten the recursion to a fixed depth, or model the nested level as `z.record(...)`. …
PASS a string native enum builds a tool at all — it used to throw at construction
PASS and reaches the model as its real value set, not as a bare string
PASS a NUMERIC native enum carries its values, not the compiler reverse-mapping names
PASS a date is advertised as the string the provider actually receives, with its format
PASS a tuple is still refused rather than silently weakened to a loose array
PASS and the refusal explains the BOUNDARY, not just the construct name
PASS and names something the consumer can write instead
PASS recursion is refused too, with its own reason
CORE-041 SCENARIO PASS
```

**Red-proof.** Re-run with the converter edits stashed and the scenario does not report failures — it
**dies at tool construction**, which is the defect stated exactly:

```
Error: Unsupported Zod type: ZodNativeEnum
    at convertZodTypeToProperty (packages/agent-core/src/schema/zod-to-json-schema.ts:197:13)
    at createZodFunctionTool (packages/agent-tools/src/implementations/function-tool.ts:40:22)
```

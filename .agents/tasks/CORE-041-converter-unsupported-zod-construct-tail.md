---
title: 'CORE-041: the hand-rolled Zod converter throws on ZodTuple, ZodDate, ZodIntersection, ZodLazy and ZodNativeEnum, so a tool or structured-output schema using any of them fails at construction rather than converting — a recurring coverage tail that a maintained library would not have'
status: todo
created: 2026-08-16
priority: low
urgency: later
area: packages/agent-core
depends_on: [CORE-039]
---

# CORE-041: the converter's unsupported-Zod-construct tail

Filed by [CORE-039](completed/CORE-039-universal-schema-subset-treats-object-as-a-leaf.md), which absorbed the
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

## The decision this item must re-run, not skip

CORE-039 rejected adopting the `zod-to-json-schema` npm package — already a dependency of
`packages/dag-node`, `packages/dag-core` and `packages/agent-cli` — because it emits full JSON Schema
with `$ref`/`definitions`/`allOf`, which the repo's field-enumerated provider mappers silently drop.
That rejection explicitly conceded one thing: **adopting the library would dissolve this item
permanently**, and the next item like it.

So do not mechanically add `ZodTuple` and call it done. Re-run the choice with whatever the tail has cost
by then: mapping each construct into the subset by hand, versus adopting the library and owning a
normalizing pass down into the subset for the mappers. The recurrence is the evidence CORE-039 did not yet
have.

## Test Plan

- Whichever route is chosen: a converter test per newly-supported construct, against real Zod.
- A test pinning the failure mode for a construct that remains unsupported.
- `pnpm harness:verify -- --scope packages/agent-core` green.

## User Execution Test Scenarios

To be authored when this item is picked up. Expected to be `agent-executable` and provider-free: build a
tool whose input uses the newly-supported construct and read back the schema the SDK hands the provider.

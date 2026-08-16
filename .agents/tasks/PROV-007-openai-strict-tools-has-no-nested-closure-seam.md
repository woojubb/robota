---
title: 'PROV-007: strictTools forwards tool schemas to OpenAI unchanged, but strict mode requires every object node — nested included — to close additionalProperties and list all properties in required, and the OpenAI adapter has no seam that does this while the Anthropic adapter does'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-provider-openai
depends_on: [CORE-039]
---

# PROV-007: `strictTools` has no nested-closure seam

Filed by [CORE-039](completed/CORE-039-universal-schema-subset-treats-object-as-a-leaf.md), which made nested
object schemas actually reach providers and therefore made this gap reachable for the first time.

## Problem

`convertToOpenAIResponsesTools` (`packages/agent-provider-openai/src/openai/responses-converter.ts:20-33`)
forwards `tool.parameters` verbatim and sets `strict: strictTools ?? false`.

OpenAI strict mode does not accept an arbitrary JSON Schema. It requires **every** object node — nested
ones included — to carry `additionalProperties: false` and to list **all** of its properties in
`required`. The universal subset does neither: a Zod-derived schema emits `additionalProperties: true`
for Zod's default `strip` and for `.passthrough()` and `false` only for `.strict()`, a hand-written one
may omit the member, and `required` lists only genuinely-required fields. So a schema that is correct
for this repo is rejected by OpenAI under `strictTools: true` — and not only when it nests: an
`additionalProperties: true` root is refused by strict mode exactly as an absent member is, which makes
**every** `createZodFunctionTool` tool affected, flat ones included.

The sibling adapter already solves this at its own seam: Anthropic's `closeObjectSchemas`
(`packages/agent-provider-anthropic/src/anthropic/output-schema.ts`) recursively closes every object
node on the way out. OpenAI has no equivalent, on either the tool seam or the structured-output seam.

## Not a regression, and why it still matters now

Bare nested objects failed strict mode before CORE-039 too — they arrived as `{ type: 'object' }`, which
strict also rejects. Nothing got worse. What changed is that CORE-039's headline claim ("a tool with a
nested-object input is invoked correctly") is now true for every provider **except** an OpenAI caller who
opted into `strictTools`, and that exception has to be either fixed or stated. CORE-039 states it:
`packages/agent-provider-openai/docs/SPEC.md` and the `strictTools` JSDoc at
`packages/agent-provider-openai/src/openai/types.ts:150` record the limitation. This item removes it.

## Direction

Give the OpenAI adapter the closure seam Anthropic has, applied only when `strict` is actually being sent
— the transformation is lossy (it forces every optional field into `required`, which OpenAI compensates
for by requiring nullable types), so it must not run on the non-strict path where the honest schema is
accepted as-is. Decide, and write down, how an optional field is represented under the forced-`required`
rule; that is the part of strict mode with no faithful mapping and the reason this is a task rather than
a one-liner.

Reconcile with the Anthropic seam rather than duplicating it: after CORE-039 both adapters recurse the
same subset, including `anyOf`, and a third hand-rolled recursion over `IParameterSchema` is the defect
class CORE-039 exists to reduce.

## Test Plan

- A test asserting that with `strictTools: true` every object node in the emitted tool schema — root and
  nested — carries `additionalProperties: false` and a complete `required` list.
- A test asserting the non-strict path forwards the schema unchanged.
- A test covering the chosen optional-field representation.
- `pnpm harness:verify -- --scope packages/agent-provider-openai` green.

## User Execution Test Scenarios

To be authored when this item is picked up. Requires an OpenAI API key for the live half; the
schema-shape half is provider-free and agent-executable by reading the request payload the adapter builds.

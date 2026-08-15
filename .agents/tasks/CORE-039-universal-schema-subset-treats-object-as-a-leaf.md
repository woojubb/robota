---
title: "CORE-039: the universal JSON-schema subset treats an object as a leaf — `IParameterSchema` can express a nested object's fields but not its `required` and not a union, and four independent walks over the same subset each re-decide what `object` means, so a nested object loses its shape in the converter, its requirements in the Gemini adapter, and its validation on the tool-input path"
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core, packages/agent-tools, packages/agent-provider-gemini
depends_on: []
---

# CORE-039: the universal schema subset treats an object as a leaf

Root item filed under [finding-depth.md](../rules/finding-depth.md) for the `DEPTH: FOUNDATIONAL`
verdict on [CORE-037](CORE-037-zodtojsonschema-drops-nested-object-properties.md) (2026-08-16).
Registered as [issue #1743](https://github.com/woojubb/robota/issues/1743); the symptom it was raised
from is [issue #1737](https://github.com/woojubb/robota/issues/1737). Disposition: **re-plan** — the
cause is being fixed rather than contained, so CORE-037 is delivered by this item's change.
CORE-037 reports one symptom of this — `convertZodTypeToProperty` returning a bare
`{ type: 'object' }` — and its stated Direction ("recurse for `ZodObject`") is the in-place patch this
rule forbids: applied alone it turns a silent field loss into an **import-time crash of a shipped
built-in tool**, and leaves three of the four walks still wrong.

## Problem

`IParameterSchema` (`packages/agent-core/src/interfaces/provider.ts:78-90`) is the universal
JSON-schema subset every tool schema and every structured-output schema in the repo is expressed in.
It carries `properties`, `items` and `additionalProperties` — but no `required`, and no union form. So
an object node in the subset can name its fields and cannot state which of them are mandatory, and a
field that accepts either of two shapes cannot be expressed at all.

Four independent walks traverse that subset, each deciding on its own what an `object` node means:

| Walk                                                              | What it does with a nested object                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `schema/zod-to-json-schema.ts:96-97` (produce)                    | returns `{ type: 'object' }` — the shape is discarded (CORE-037)                              |
| `schema/structured-output.ts:110` (validate)                      | reads `'required' in schema`, a branch that is **statically dead** at every nested level      |
| `tool-registry/parameter-validator.ts:50-54` (validate)           | `case 'object'` stops at `typeof` — no `properties`, no nested `required`                     |
| `agent-provider-gemini/.../tool-schema-converter.ts:61-95` (emit) | rebuilds each node and forwards `properties`, but has no `required` to forward                |

The first two are called **twelve lines apart** on the same schema by the same method
(`tool-registry/function-tool.ts:65` for input, `:102` for output) and disagree about how deep
`object` goes.

## Evidence this is the cause and not the symptom

- **It has already been worked around three times in shipped code.**
  `IToolSchema.outputSchema` (`interfaces/provider.ts:65-72`) duplicates the entire root object shape
  as a union member purely to regain `required`, with a comment saying so.
  `agent-tools/src/computer-use/computer-tool.ts:50-53` documents flattening a discriminated union
  "so it converts to JSON schema". And `SELFHOST-005`
  (`.agents/spec-docs/done/SELFHOST-005-guardrails-structured-output.md:45,119`) records the decision
  to add the deep output validator *beside* the shallow input one rather than unify them — the same
  "object is a leaf" defect was present, seen, and built next to.
- **Two shipped built-in tools are already broken by it** (measured on `develop`, 2026-08-16, via
  `scratch/src/core-037-repro.ts`): `Computer`'s `act` tool emits
  `action: { type: 'object' }` with all 13 action fields absent, and `AskUserQuestion` emits
  `questions: { type: 'array', items: { type: 'object' } }` with every question field absent.
- **The naive fix breaks the second one harder.** `zod-to-json-schema.ts:143` throws on an
  unsupported Zod type. Because `ZodObject` returns early today, nothing *inside* a nested object is
  ever visited, so that throw is unreachable one level down. Recursing without adding union support
  makes `packages/agent-tools/src/builtins/ask-user-question-tool.ts:169` — a **module-level**
  `export const askUserQuestionTool = createAskUserQuestionTool()` whose nested
  `QuestionSchema.options` is `z.array(z.union([...]))` (`:34-46`) — throw at import time, taking the
  whole `@robota-sdk/agent-tools` package down on load.

## Direction

Make the subset able to express an object, then make one walk own what that means.

1. **Widen the subset** — `IParameterSchema` gains `required?: string[]` and `anyOf?: IParameterSchema[]`.
   Both are additive and optional, so no existing producer or consumer breaks. `required` is what makes
   `structured-output.ts:110`'s existing nested branch reachable instead of dead; `anyOf` is what lets a
   union be expressed rather than flattened or thrown on.
2. **One object walk in the converter** — extract the `shape → properties/required` walk now living only
   inside `zodToJsonSchema` and call it from both the root and the nested `ZodObject` case. Do not copy
   it: a second copy is how the two levels drifted in the first place.
3. **Close the coverage limit the recursion exposes** — add `ZodUnion` / `ZodDiscriminatedUnion` (→ `anyOf`)
   and `ZodLiteral` (→ single-value `enum`). The repo-wide inventory of Zod constructs reaching this
   converter is small (`z.string`, `z.object`, `z.number`, `z.array`, `z.enum`, `z.union`, `z.record`,
   `z.boolean`), so this is a bounded set, not an open-ended Zod reimplementation. Anything still
   unsupported keeps throwing — loudly, per "Silence is not success" — and the supported set is written
   into the SPEC so the limit is declared rather than discovered.
4. **One validation walk** — `parameter-validator.ts` delegates the nested case to the existing
   recursive `validateAgainstJsonSchema` instead of being a second, shallower implementation. Otherwise
   the tool schema advertises a contract the tool-input path does not check.
5. **Forward the widened fields in the one adapter that rebuilds nodes** — Gemini's
   `convertParameterSchema` gains `required` and `anyOf` (`@google/genai`'s `Schema` carries both:
   `genai.d.ts:9670,9708`). Anthropic (`message-converter.ts:139`), OpenAI (`responses-converter.ts:29`)
   and openai-compatible (`shared/openai-compatible/message-converter.ts:27`) forward `tool.parameters`
   verbatim and need no change.

**Rejected alternative — adopt the `zod-to-json-schema` npm package** (already a dependency of
`packages/dag-node`, `dag-core` and `agent-cli`). It emits full JSON Schema with `$ref`/`definitions`/
`allOf`, which is not the narrow universal subset the provider adapters map from — Gemini's converter
walks `IParameterSchema` node by node and has no `$ref` resolution. Adopting it would mean either
widening the subset to all of JSON Schema (a far larger blast radius across every adapter) or
post-processing its output back down into the subset, which is the same walk this item is unifying.
The narrow subset is deliberate; the defect is that it is missing two members, not that it exists.

## Test Plan

- Converter tests written against **real Zod**, not the existing hand-rolled `_def` mocks: two levels of
  nesting; an optional field inside a nested object absent from that object's `required`;
  `z.array(z.object(...))`; a nested `.describe()`; a nested `.passthrough()`; a nested `z.union` of a
  primitive and an object; a nested unsupported type still throwing. The existing suite's mocks are why
  a real-Zod defect passed 20 green tests — the new cases must not be mockable past.
- A test pinning the emitted parameter schema of **both** affected built-ins (`Computer`'s `act`,
  `AskUserQuestion`), so the regression that silently emptied them cannot recur unnoticed, and so the
  import-time-crash path is covered by construction.
- Round-trip tests: the emitted schema accepts a conforming payload and rejects one missing a nested
  required field, through `validateAgainstJsonSchema` **and** through `FunctionTool` input validation —
  the two walks must agree.
- Gemini adapter test asserting nested `required` and `anyOf` reach the function declaration.
- `pnpm harness:verify -- --scope` for `packages/agent-core`, `packages/agent-tools`,
  `packages/agent-provider-gemini`; `pnpm harness:verify-like-ci` before the branch is reported green.
- `packages/agent-core/docs/SPEC.md` § Schema / § Structured Output Contract state the supported Zod
  construct set and the subset's members, so the coverage limit is declared.

## User Execution Test Scenarios

Applies — this changes observable SDK behavior on a shipped product surface.

**Scenario 1 — a built-in tool's advertised schema carries its nested fields**

- Agent-executability decision: `agent-executable`.
- Prerequisites: `pnpm install --frozen-lockfile` (workspace already installed). No provider API key
  and no network: the observable is the schema the SDK hands the provider, read from the public
  product surface, so the gate is machine-executable in any environment.
- Environment: `scratch/` (the repo's sanctioned home for disposable live-verification scripts). No new
  fixture is required.
- Steps: `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-schema.ts` from
  `scratch/`, where the script imports `createComputerTool` and `askUserQuestionTool` from the public
  `@robota-sdk/agent-tools` entry point and prints `tool.schema.parameters` for each.
- Expected observable result: `Computer`'s `act` schema shows `action.properties.type` with its 8-value
  `enum` plus the coordinate/key/text fields, and `action.required` containing `type`;
  `AskUserQuestion`'s schema shows `questions.items.properties.question` and
  `questions.items.required` containing `question`. (Before the fix both print
  `{ "type": "object" }` with no fields.)
- Cleanup: none — `scratch/src` is gitignored and nothing is persisted.
- Evidence: _to be filled after implementation_ (paste both printed schemas).

**Scenario 2 — a tool with a nested-object input is actually invoked end to end**

- Agent-executability decision: `agent-executable`.
- Prerequisites: as above; additionally probe for a provider key
  (`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GOOGLE_API_KEY` in the environment and `.env`) and record the
  probe result. The scenario's primary observable does not need one.
- Environment: `scratch/`.
- Steps: build a tool with `createZodFunctionTool` over
  `z.object({ report: z.object({ score: z.number(), notes: z.array(z.string()) }) })` whose handler
  prints its argument; call `tool.execute({ report: { score: 4, notes: ['a'] } })`, then call
  `tool.execute({ report: { notes: ['a'] } })`.
- Expected observable result: the first call prints the fully populated `report` and returns
  `success: true`; the second is rejected naming the missing nested required field `score`. (Before the
  fix the second call is accepted, because the tool-input walk never enters the nested object.)
- Cleanup: none.
- Evidence: _to be filled after implementation_ (paste both outcomes and the key probe result).

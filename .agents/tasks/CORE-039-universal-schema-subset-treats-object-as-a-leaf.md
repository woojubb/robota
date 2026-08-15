---
title: "CORE-039: the universal JSON-schema subset treats an object as a leaf — `IParameterSchema` can express a nested object's fields but not its `required` and not a union, and seven independent walks over the same subset each re-decide what a node means, so a nested object loses its shape in the converter, its requirements in the Gemini adapter, and its validation on the tool-input path"
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-core, packages/agent-tools, packages/agent-provider-gemini, packages/agent-provider-anthropic, packages/agent-provider-openai
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
built-in tool**, and leaves every other walk still wrong.

## Problem

`IParameterSchema` (`packages/agent-core/src/interfaces/provider.ts:78-90`) is the universal
JSON-schema subset every tool schema and every structured-output schema in the repo is expressed in.
It carries `properties`, `items` and `additionalProperties` — but no `required`, and no union form. So
an object node in the subset can name its fields and cannot state which of them are mandatory, and a
field that accepts either of two shapes cannot be expressed at all.

Seven independent walks traverse that subset, each deciding on its own what a node means:

| Walk                                                                  | What it does with a nested object                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `schema/zod-to-json-schema.ts:96-97` (produce)                          | returns `{ type: 'object' }` — the shape is discarded (CORE-037)                          |
| `schema/structured-output.ts:110` (validate)                            | reads `'required' in schema`, a branch that is **statically dead** at every nested level  |
| `tool-registry/parameter-validator.ts:50-54` (validate)                 | `case 'object'` stops at `typeof` — no `properties`, no nested `required`                 |
| `agent-provider-gemini/.../tool-schema-converter.ts:61-95` (emit)       | rebuilds each node and forwards `properties`, but has no `required` to forward            |
| `agent-provider-anthropic/src/anthropic/provider.ts:369-397` (emit)     | `closeObjectSchemas` recurses `properties`/`items`/object-valued `additionalProperties` only |
| `tool-registry/tool-registry.ts:130-167` (`validateToolSchema`, run on every `register()`) | requires every top-level property to carry a `type`, and its `validTypes` list omits `integer`/`null` |
| `agent-tool-mcp/src/{mcp-tool.ts:125-139, relay-mcp-tool.ts:102-118}`   | two hand-rolled top-level-`required`-presence checks that never enter a nested object     |

The two core validators are called **37 lines apart** on the same schema by the same method
(`tool-registry/function-tool.ts:65` for input, `:102` for output) and disagree about how deep
`object` goes.

The last two are **named, not fixed, by this item** — they live in a different package, have no
measured defect behind them, and absorbing them would require newly exporting `validateToolParameters`
from agent-core's barrel (only `validateAgainstJsonSchema` is exported today, at
`agent-core/src/index.ts:26`). They are filed as CORE-040, because an item whose thesis is "one walk
owns what `object` means" must say which walks it is leaving standing.

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

**Recommendation gate:** `proposal-reviewer` → `REVIEW VERDICT: ENDORSE`, 2026-08-16 (revision 2 of 2;
`REVISE` on v1 and v2). Endorsed with three binding pre-merge conditions, folded in below as steps 6a,
6b and 7. `finding-depth-triager` → `DEPTH: FOUNDATIONAL`, 2026-08-16.

Make the subset able to express an object, then make one walk own what that means.

**1. Complete the subset type.** `IParameterSchema` gains `required?: string[]` and
`anyOf?: IParameterSchema[]`; `additionalProperties` widens to `boolean | IParameterSchema` to match
the root (`provider.ts:54`, `:70`); and **`type` becomes optional**. The last one is forced, not
chosen: a correct `anyOf` node carries no `type`, and emitting one beside `anyOf` is invalid JSON
Schema — a provider applies both constraints and rejects the non-matching branch.

**1b. Collapse the duplicated root shape.** `IToolSchema['parameters']` is an inline object literal
written twice (`provider.ts:50-55`, `:66-71`) and referenced from seven sites. Introduce
`IObjectParameterSchema extends IParameterSchema { type: 'object'; properties: Record<string,
IParameterSchema> }` and use it for `parameters` and `outputSchema`. Consequence to land in the same
change, not discover later: `structured-output.ts:97`'s `IToolSchema['parameters'] | IParameterSchema`
then collapses to `IParameterSchema`, making the `in`-guards at `:110`, `:143`, `:156`, `:161`, `:175`,
`:178`, `:181` vestigial — remove them.

**2. One object walk in the converter, no silent root fallthrough, unwrap shared with the nested path.**
Extract the `shape → properties/required` walk that lives only inside `zodToJsonSchema` (`:31-44`) into
one helper called from both the root and the nested `ZodObject` case — not copied, since a second copy
is how the two levels drifted. Absorb the adjacent same-class defect: `:31` guards
`if (typeName === 'ZodObject' && shape)` with no `else`, so a non-`ZodObject` root falls through to
`:46-53` and returns `{ type: 'object', properties: {}, required: [] }` — `z.object({...}).refine(...)`
is `ZodEffects`, so it silently produces an empty schema, this item's own symptom at the root of the
function being rewritten. Unwrap `ZodEffects`/`ZodOptional`/`ZodDefault` and throw on anything still not
an object, matching the file's throw-not-fallback posture. **Share the unwrap with
`convertZodTypeToProperty`** so a nested `.refine()` behaves as the root does; a root-only unwrap would
recreate this item's thesis violation for a different construct.

**3. Stop conflating three `unknownKeys` meanings into two emissions.** `zod-to-json-schema.ts:50` tests
only `=== 'passthrough'`, so Zod's default **`strip`** and explicit **`strict`** both emit *omitted* —
wrong in opposite directions under the subset's declared convention. Emit `passthrough → true`,
`strict → false`, **`strip → true`**. `strip` means "extras accepted at the boundary, then dropped", and
the drop provably happens: `FunctionTool.execute` validates at `:64-72` and only then calls the wrapper,
whose `safeParse` strips (`agent-tools/src/implementations/function-tool.ts:55-60`). After this,
*omitted* appears only on hand-written schemas. This step is what makes step 6 safe.

**4. Close the coverage limit the recursion exposes.** Add `ZodUnion` and `ZodDiscriminatedUnion` →
`anyOf`, and `ZodLiteral` → single-value `enum`. `ZodUnion` is forced by the import-time crash above.
`ZodDiscriminatedUnion`/`ZodLiteral` have no in-repo user and are justified on a different defect:
`computer-tool.ts:50-53` documents a **shipped tool whose schema was distorted** ("a flat object (not a
discriminated union) so it converts to JSON schema") to dodge exactly this gap. A work-around in shipped
code is the defect behind them — the same absorb criterion applied consistently.

**5. Specify `anyOf` into every walk that must see it.** Adding the member to the type and the converter
alone would trade the import-time crash for runtime uncallability of the very tool this item exists for:
an `anyOf` node has no `type`, so `validateAgainstJsonSchema`'s `switch` falls to
`default: return [unsupported schema type undefined]` (`structured-output.ts:201-202`), and
`AskUserQuestion`'s `questions.items → options → items` would reject **every** option value. Required,
all in this change:

- `validateAgainstJsonSchema` gains an `anyOf` branch **before** the type switch (valid if the value
  matches ≥1 member).
- `parameter-validator.validateParameterType` gains the same pre-switch delegation — an `anyOf` node can
  sit at any property position, not only inside an object.
- `tool-registry.ts:130-167` (`validateToolSchema`, run on every `register()`) must accept a top-level
  `anyOf` property. Otherwise `z.object({ value: z.union([...]) })` converts fine and then throws
  `Parameter "value" must have a type` at registration — the crash relocated, not removed.
- Anthropic's `closeObjectSchemas` recurses `anyOf` members; today it spreads `{...record}`, so objects
  inside a union branch would stay open — precisely what that seam exists to prevent.
- Gemini's `convertParameterSchema` maps `anyOf` and tolerates an absent `type`.
- The member and its `type` semantics go into agent-core's SPEC.

**6. One validation walk for depth — no special case.** `parameter-validator.ts`'s `case 'object'` keeps
its `typeof` check and message, then delegates depth to `validateAgainstJsonSchema` **unconditionally**.
No "property-less objects stay open" guard: that would contradict the owning document.
`docs/SPEC.md:363` already declares the convention (`true`/object-form accept extra props;
**`false`/omitted reject**), and `closeObjectSchemas` reads it the same way at the Anthropic seam. The
four pinned root messages (`Unknown parameter:`, `Missing required parameter:`, `must be a string`,
`must be an object`) live outside the delegated region — `parameter-validator.ts:92`, `:108`, `:19`,
`:52` — and are preserved unchanged; only the previously-unreachable nested depth gains messages.

**6a. Return early on the `typeof` failure, then delegate**, or a non-object payload reports the defect
twice in two dialects.

**6b. Pass a caller-shaped path root to the delegated call** (`Parameter "<key>"`, not a bare `$`).
After step 6 one `validateParameters()` result carries root-dialect and depth-dialect messages in one
string, and that string is what reaches the user through `ValidationError` at `function-tool.ts:71`.
The message shape at depth is this item's user-facing surface and is a stated choice, not a leftover.

**7. Absorb the seventh walk's own defects while editing it.** `validateToolSchema`'s `validTypes` list
(`tool-registry.ts:160`) omits `'integer'` and `'null'`, both members of `TJSONSchemaKind`
(`provider.ts:36-37`), so a top-level `integer` property is rejected today. Pre-existing, in the lines
being edited, so it is absorbed rather than left.

**8. Give `parameter-validator`'s switch a `default` that errors.** `validateParameterType`
(`:16-55`) has no `default`; an unmatched `type` falls through to the enum check and returns
`undefined` — accepted. That is unreachable while `type` is mandatory and becomes a silently-accepted
node the moment step 1 lands, which is a "Silence is not success" violation created by this change.
Mirror `validateAgainstJsonSchema`'s `default: return [unsupported schema type …]`.

**9. The two adapter seams, and the one that has no seam.** Gemini gains `required` and `anyOf`
(`@google/genai@1.52.0`'s `Schema` carries both). Anthropic gains step 5's `anyOf` recursion plus a
comment recording that its `else if (record.type === 'object')` overwrite of an explicit
`additionalProperties: true` is deliberate at that seam — step 3 makes that overwrite fire routinely, so
an unexplained one reads as a bug. **OpenAI strict mode has no equivalent seam**:
`responses-converter.ts:30` sends `strict: strictTools ?? false`, and strict requires every object node,
nested included, to carry `additionalProperties: false` and list all properties in `required`. Not a
regression, but this item's headline claim would be false for `strictTools: true` users — recorded where
a user meets it (`packages/agent-provider-openai/docs/SPEC.md` and the `strictTools` JSDoc at
`openai/types.ts:150`, **not** agent-core's SPEC, which does not own that option) and filed as PROV-007.

**10. No change to the two built-ins' schemas.** Once the converter recurses and expresses unions the
flattening work-around's premise is gone, but changing a shipped tool's argument shape is a user-facing
contract change with no defect left to justify it. Pin both emitted schemas with tests instead.

## Scope boundary — absorbed here, filed as follow-ups

Absorb where a **defect** sits behind it; file where only coverage does (`code-quality.md:51`).

- **CORE-040** — the two `agent-tool-mcp` validators bypass the subset validator entirely. Different
  package, no measured defect, and absorbing would require newly exporting `validateToolParameters` from
  agent-core's barrel (only `validateAgainstJsonSchema` is exported today, `agent-core/src/index.ts:26`).
- **CORE-041** — the converter's remaining unsupported constructs (`ZodTuple`, `ZodDate`,
  `ZodIntersection`, `ZodLazy`, `ZodNativeEnum`). Zero in-repo users, no defect behind them.
- **PROV-007** — OpenAI strict mode's missing nested-closure seam (step 9).

**Rejected alternative — adopt the `zod-to-json-schema` npm package** (already a dependency of
`packages/dag-node`, `packages/dag-core` and `packages/agent-cli`, used at
`dag-node/src/utils/node-descriptor.ts:1`).

Its real advantage, stated rather than omitted: it would dissolve CORE-041 permanently, and the next
item like it. Rejected anyway — it emits **full** JSON Schema with `$ref`/`definitions`/`allOf`, and
every downstream mapper here is **field-enumerated**: Gemini's `convertParameterSchema` copies a fixed
key list and would emit `{}` for any node it does not recognise, and `validateAgainstJsonSchema`'s
switch ends in `default: return [unsupported schema type …]`. That is a *worse, quieter* failure than
today's. Adopting it means either widening the subset to all of JSON Schema — a published-contract
redesign spanning agent-core, four adapters and three validators, which `backlog-execution.md`
§ Agent Decision Authority puts with the user, not the agent — or post-processing its output back down
into the subset, which is the same walk this item is unifying, plus a dependency. `anyOf` is not that
redesign: it is leaf-recursive, needs no resolution machinery, and every walk already has the shape for
it, which is why step 5 can specify it into all of them in one change.

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

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

| Walk                                                                                       | What it does with a nested object                                                                     |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `schema/zod-to-json-schema.ts:96-97` (produce)                                             | returns `{ type: 'object' }` — the shape is discarded (CORE-037)                                      |
| `schema/structured-output.ts:110` (validate)                                               | reads `'required' in schema`, a branch that is **statically dead** at every nested level              |
| `tool-registry/parameter-validator.ts:50-54` (validate)                                    | `case 'object'` stops at `typeof` — no `properties`, no nested `required`                             |
| `agent-provider-gemini/.../tool-schema-converter.ts:61-95` (emit)                          | rebuilds each node and forwards `properties`, but has no `required` to forward                        |
| `agent-provider-anthropic/src/anthropic/provider.ts:369-397` (emit)                        | `closeObjectSchemas` recurses `properties`/`items`/object-valued `additionalProperties` only          |
| `tool-registry/tool-registry.ts:130-167` (`validateToolSchema`, run on every `register()`) | requires every top-level property to carry a `type`, and its `validTypes` list omits `integer`/`null` |
| `agent-tool-mcp/src/{mcp-tool.ts:125-139, relay-mcp-tool.ts:102-118}`                      | two hand-rolled top-level-`required`-presence checks that never enter a nested object                 |

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
  to add the deep output validator _beside_ the shallow input one rather than unify them — the same
  "object is a leaf" defect was present, seen, and built next to.
- **Two shipped built-in tools are already broken by it** (measured on `develop`, 2026-08-16, via
  `scratch/src/core-037-repro.ts`): `Computer`'s `act` tool emits
  `action: { type: 'object' }` with all 13 action fields absent, and `AskUserQuestion` emits
  `questions: { type: 'array', items: { type: 'object' } }` with every question field absent.
- **The naive fix breaks the second one harder.** `zod-to-json-schema.ts:143` throws on an
  unsupported Zod type. Because `ZodObject` returns early today, nothing _inside_ a nested object is
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
only `=== 'passthrough'`, so Zod's default **`strip`** and explicit **`strict`** both emit _omitted_ —
wrong in opposite directions under the subset's declared convention. Emit `passthrough → true`,
`strict → false`, **`strip → true`**. `strip` means "extras accepted at the boundary, then dropped", and
the drop provably happens: `FunctionTool.execute` validates at `:64-72` and only then calls the wrapper,
whose `safeParse` strips (`agent-tools/src/implementations/function-tool.ts:55-60`). After this,
_omitted_ appears only on hand-written schemas. This step is what makes step 6 safe.

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

**6. One validation walk for depth.** `parameter-validator.ts`'s `case 'object'` keeps its `typeof`
check and message, then delegates depth to `validateAgainstJsonSchema` — with closure evaluated per
step 6c, which was added during implementation after the reviewer's own blast-radius claim was
falsified (`REVISE`, 2026-08-16: its v1 sweep had excluded test files, and
`agent-tools/src/__tests__/function-tool.test.ts:225` declares a bare nested `{ type: 'object' }` and
asserts a populated payload is accepted). `docs/SPEC.md:363` declares the convention
(`true`/object-form accept extra props; **`false`/omitted reject**), and `closeObjectSchemas` reads it
the same way at the Anthropic seam. The
four pinned root messages (`Unknown parameter:`, `Missing required parameter:`, `must be a string`,
`must be an object`) live outside the delegated region — `parameter-validator.ts:92`, `:108`, `:19`,
`:52` — and are preserved unchanged; only the previously-unreachable nested depth gains messages.

**6a. Return early on the `typeof` failure, then delegate**, or a non-object payload reports the defect
twice in two dialects.

**6b. Pass a caller-shaped path root to the delegated call** (`Parameter "<key>"`, not a bare `$`).
After step 6 one `validateParameters()` result carries root-dialect and depth-dialect messages in one
string, and that string is what reaches the user through `ValidationError` at `function-tool.ts:71`.
The message shape at depth is this item's user-facing surface and is a stated choice, not a leftover.

**6c. Closure is relative to a declared `properties` set.** A node that declares `properties` —
including an empty `properties: {}` — is closed unless `additionalProperties` says otherwise; a node
that declares **none** permits any properties, as JSON Schema says and as every provider reads the
document forwarded to it. An explicit `additionalProperties: false` closes either way. Keyed on the
member's presence, not its emptiness, so a no-argument tool root still rejects every argument.

This completes the convention at a position it was never written for rather than carving an exception
out of it: `SPEC.md:363` was authored for a tool's `parameters` root, where `properties` is
structurally always present, so "omitted rejects extras" could only ever mean "nothing beyond the
declared set". A nested node can omit the member entirely — the free-form object field — and carrying
the root's phrasing there unchanged gives omitted `additionalProperties` a second meaning that
contradicts the schema we ship. It lives inside `validateAgainstJsonSchema`, not at the delegation
site, so the tool-input and structured-output paths cannot diverge on it. Step 3 is unaffected: the
converter emits `properties` on every object node, so no Zod-derived schema changes under either
reading.

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
switch ends in `default: return [unsupported schema type …]`. That is a _worse, quieter_ failure than
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

Applies — this changes the schema a shipped, publicly exported tool advertises, and the validation a
shipped tool applies to its inputs. Both are observable from the public SDK entry point with no
provider and no network.

**Environment probe (recorded 2026-08-16, before authoring):** no provider credential is present in
this environment — `env | grep -iE "OPENAI|ANTHROPIC|GOOGLE|GEMINI|BYTEDANCE|API_KEY"` returns only
`PATH`, and there is no `.env` (only `.env.example`). No scenario below needs one; this is recorded so
the provider-free choice is a measurement, not an assumption.

**Stated coverage limit.** `convertToolsToGeminiFormat`
(`packages/agent-provider-gemini/src/gemini/tool-schema-converter.ts`) is not re-exported from that
package's barrel, `GeminiProvider` constructs `new GoogleGenAI({ apiKey })` with no `baseUrl`
passthrough (`provider.ts:53`), and the executor seam receives the universal `IToolSchema[]` rather
than the Gemini-mapped form — so Gemini's `required`/`anyOf` forwarding has **no** provider-free user
observable and is covered by the engineering test plan only, which is not user-execution evidence.
The other three adapters forward `tool.parameters` verbatim (Anthropic `message-converter.ts:139`,
OpenAI `responses-converter.ts:29`, openai-compatible `message-converter.ts:27`), so what Scenario 1
prints **is** the payload those three send. Widening the Gemini package's public surface purely for
observability is out of this item's endorsed scope; it is recorded here rather than papered over.

**Common prerequisites for all three scenarios**

- Workspace installed. In this environment `pnpm install --frozen-lockfile` fails at
  `better-sqlite3`'s native build (`make`/`g++` are absent), which aborts before pnpm links
  `node_modules/.bin`; `pnpm install --frozen-lockfile --ignore-scripts` completes and is what these
  runs used.
- Working directory `scratch/` — the repo's sanctioned home for disposable live-verification scripts
  (`.agents/rules/backlog-execution.md` § Script home). `scratch/src` is gitignored, which is why each
  script is reproduced in full below rather than referenced by path.
- No build step: `--conditions=source` resolves `@robota-sdk/*` to package source.
- Invocation note: `pnpm run run` fails here for the same missing-`.bin` reason. The proven invocation
  is `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/<file>.ts` executed from `scratch/`.
- No fixture, service, seed data, or credential is required, and no new one is introduced.
- All three scripts were executed verbatim against unfixed code while being authored, and all three
  failed with the stated pre-fix output — each is discriminating, not vacuous.

---

**Scenario 1 — the two shipped built-in tools advertise their nested fields**

- Agent-executability decision: `agent-executable`.
- Prerequisites: the common prerequisites above. Nothing else.
- Steps (from `scratch/`): write the script below, then run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-s1.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-039-s1.ts
import { askUserQuestionTool, createComputerTool } from '@robota-sdk/agent-tools';

const fails: string[] = [];
const check = (label: string, ok: boolean): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) fails.push(label);
};
const at = (root: unknown, path: string): any =>
  path.split('.').reduce<any>((node, key) => (node == null ? node : node[key]), root as any);

const act = createComputerTool()[1]!.schema.parameters;
const ask = askUserQuestionTool.schema.parameters;
console.log('Computer.act parameters:\n' + JSON.stringify(act, null, 2));
console.log('AskUserQuestion parameters:\n' + JSON.stringify(ask, null, 2));

check(
  'act: action.properties.type.enum has 8 values',
  at(act, 'properties.action.properties.type.enum')?.length === 8,
);
check(
  'act: action.properties.type.enum includes takeover',
  at(act, 'properties.action.properties.type.enum')?.includes('takeover') === true,
);
check(
  'act: action.required includes type',
  at(act, 'properties.action.required')?.includes('type') === true,
);
check(
  'act: action.required omits optional x',
  at(act, 'properties.action.required')?.includes('x') === false,
);
check(
  'act: action.properties.path.items.properties.x is a number (3 levels deep)',
  at(act, 'properties.action.properties.path.items.properties.x.type') === 'number',
);
check(
  'ask: questions.items.properties.question is a string',
  at(ask, 'properties.questions.items.properties.question.type') === 'string',
);
check(
  'ask: questions.items.required includes question',
  at(ask, 'properties.questions.items.required')?.includes('question') === true,
);
check(
  'ask: questions.items.properties.options.items.anyOf has 2 branches',
  at(ask, 'properties.questions.items.properties.options.items.anyOf')?.length === 2,
);

console.log(fails.length === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
```

- Expected observable result: `SCENARIO 1 PASS`, eight `PASS` lines, `EXIT:0`. The printed schemas show
  `properties.action.properties` populated (its `type` enum plus
  `x`/`y`/`button`/`text`/`keys`/`deltaX`/`deltaY`/`path`/`ms`/`reason`) with
  `properties.action.required` present, and `properties.questions.items.properties` populated with
  `properties.questions.items.required`. **The import completing at all is part of the observable** —
  `askUserQuestionTool` is a module-level construction, so a converter that throws on its nested union
  takes the whole `@robota-sdk/agent-tools` entry point down on load and the command cannot reach its
  first check.
  Measured pre-fix (2026-08-16, unfixed code): `SCENARIO 1 FAIL (8)`, `EXIT:1`, with
  `"action": { "type": "object", "description": … }` and `"items": { "type": "object" }` — every nested
  field absent.
- Cleanup: `rm -f src/core-039-s1.ts` from `scratch/`.
- Evidence (2026-08-16, re-run against the completed implementation at `afd397c10`, after step 6c's closure rule landed; an earlier run at `54886a665` gave the same result): **`SCENARIO 1 PASS`,
  `EXIT:0`**, eight `PASS` lines. `Computer.act` printed
  `action.properties.type.enum = ["click","double_click","type","keypress","scroll","drag","wait","takeover"]`,
  `action.required = ["type"]`, and `action.properties.path.items = { type: 'object', properties: { x:
{ type: 'number' }, y: { type: 'number' } }, required: ['x','y'] }` — the three-level-deep drag
  point. `AskUserQuestion` printed `questions.items.properties` =
  `question`/`header`/`options`/`multiSelect`/`allowFreeText` with `questions.items.required =
["question"]`, and `questions.items.properties.options.items.anyOf` carrying the string branch and
  the `{ label, description }` object branch with `required: ["label"]`.

---

**Scenario 2 — a tool enforces the nested schema it advertises, and both walks agree**

Isolates the walk under change. The tool is built with `createFunctionTool` over the schema the product
itself emitted — deliberately **not** `createZodFunctionTool`, whose wrapper re-validates with Zod
inside the executor (`packages/agent-tools/src/implementations/function-tool.ts:55-58`) and would mask
the schema walk entirely. An earlier draft of this scenario used `createZodFunctionTool` and was
rejected for exactly that: it passed on unfixed code, observing Zod rather than the walk under change.

- Agent-executability decision: `agent-executable`.
- Prerequisites: the common prerequisites above. Nothing else.
- Steps (from `scratch/`): write the script below, then run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-s2.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-039-s2.ts
import { validateAgainstJsonSchema } from '@robota-sdk/agent-core';
import { createFunctionTool, createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

const fails: string[] = [];
const check = (label: string, ok: boolean, seen?: unknown): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` -- saw ${JSON.stringify(seen)}`}`);
  if (!ok) fails.push(label);
};

const Reported = z.object({
  report: z.object({ score: z.number(), notes: z.array(z.string()), tag: z.string().optional() }),
});
const emitted = createZodFunctionTool('report', 'report', Reported, async () => 'ok').schema
  .parameters;
console.log('emitted schema:\n' + JSON.stringify(emitted, null, 2));

const good = { report: { score: 4, notes: ['a'] } };
const bad = { report: { notes: ['a'] } };

const deepGood = validateAgainstJsonSchema(emitted, good, '$');
const deepBad = validateAgainstJsonSchema(emitted, bad, '$');
check('deep walk accepts the conforming payload', deepGood.length === 0, deepGood);
check('deep walk rejects the payload missing nested "score"', deepBad.length > 0, deepBad);
check('deep walk names "score"', deepBad.join(' ').includes('score'), deepBad);

const tool = createFunctionTool('report-tool', 'report-tool', emitted, async () => 'handler-ran');
let goodOutcome = '';
let badOutcome = '';
try {
  goodOutcome = `success=${(await tool.execute(good)).success}`;
} catch (error) {
  goodOutcome = `threw ${(error as Error).message}`;
}
try {
  badOutcome = `success=${(await tool.execute(bad)).success}`;
} catch (error) {
  badOutcome = `threw ${(error as Error).message}`;
}
console.log('input walk good =>', goodOutcome);
console.log('input walk bad  =>', badOutcome);
check('input walk accepts the conforming payload', goodOutcome === 'success=true', goodOutcome);
check(
  'input walk rejects the payload missing nested "score"',
  badOutcome.startsWith('threw'),
  badOutcome,
);
check('input walk names "score"', badOutcome.includes('score'), badOutcome);

console.log(fails.length === 0 ? 'SCENARIO 2 PASS' : `SCENARIO 2 FAIL (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
```

- Expected observable result: `SCENARIO 2 PASS`, six `PASS` lines, `EXIT:0` — the deep walk returns `[]`
  for the conforming payload and an issue naming `score` for the non-conforming one; the tool-input walk
  prints `input walk good => success=true` and `input walk bad  => threw …score…`. The optional `tag`
  being absent must not be reported by either walk. The error text is asserted by the substring `score`,
  not by an exact message: a rejection that does not name the offending nested field is unusable to a
  model or a user, while the surrounding phrasing is deliberately unpinned.
  Measured pre-fix (2026-08-16, unfixed code): `SCENARIO 2 FAIL (4)`, `EXIT:1` — the two walks disagree
  in **both** directions on the same emitted schema. The deep walk falsely rejects the valid payload
  (`["$.report.score: unexpected additional property", "$.report.notes: unexpected additional property"]`)
  and the input walk falsely accepts the invalid one (`input walk bad => success=true`, handler ran).
- Cleanup: `rm -f src/core-039-s2.ts` from `scratch/`.
- Evidence (2026-08-16, re-run against the completed implementation at `afd397c10`, after step 6c's closure rule landed; an earlier run at `54886a665` gave the same result): **`SCENARIO 2 PASS`,
  `EXIT:0`**, six `PASS` lines. The emitted schema carried
  `report.required = ["score","notes"]` with the optional `tag` present in `properties` and absent from
  `required`. `input walk good => success=true`; `input walk bad  => threw Validation Error: Invalid
parameters for tool "report-tool": Parameter "report".score: required property missing`. That message
  is also the evidence for the path-root decision (step 6b): one `ValidationError` string, one dialect,
  the nested field named.

---

**Scenario 3 — a union-typed field is expressible and stays usable**

- Agent-executability decision: `agent-executable`.
- Prerequisites: the common prerequisites above. Nothing else.
- Steps (from `scratch/`): write the script below, then run
  `node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-s3.ts; echo "EXIT:$?"`.

```ts
// scratch/src/core-039-s3.ts
import {
  askUserQuestionTool,
  createFunctionTool,
  createZodFunctionTool,
} from '@robota-sdk/agent-tools';
import { z } from 'zod';

const fails: string[] = [];
const check = (label: string, ok: boolean, seen?: unknown): void => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` -- saw ${JSON.stringify(seen)}`}`);
  if (!ok) fails.push(label);
};
const at = (root: unknown, path: string): any =>
  path.split('.').reduce<any>((node, key) => (node == null ? node : node[key]), root as any);

let emitted: any;
try {
  emitted = createZodFunctionTool(
    'choose',
    'choose',
    z.object({
      choice: z.union([z.string(), z.object({ label: z.string() })]),
      mode: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('fast'), ms: z.number() }),
        z.object({ kind: z.literal('safe'), retries: z.number() }),
      ]),
    }),
    async () => 'ok',
  ).schema.parameters;
  check('createZodFunctionTool accepts a union-typed field', true);
} catch (error) {
  check('createZodFunctionTool accepts a union-typed field', false, (error as Error).message);
  console.log('SCENARIO 3 FAIL (union not expressible)');
  process.exit(1);
}
console.log('emitted schema:\n' + JSON.stringify(emitted, null, 2));
check('choice emits anyOf with 2 branches', at(emitted, 'properties.choice.anyOf')?.length === 2);
check('mode emits anyOf with 2 branches', at(emitted, 'properties.mode.anyOf')?.length === 2);
check(
  'the discriminator literal becomes a single-value enum',
  JSON.stringify(at(emitted, 'properties.mode.anyOf.0.properties.kind.enum')) === '["fast"]',
  at(emitted, 'properties.mode.anyOf.0.properties.kind'),
);

const tool = createFunctionTool('choose-tool', 'choose-tool', emitted, async () => 'handler-ran');
for (const [label, payload] of [
  ['string branch', { choice: 'yes', mode: { kind: 'fast', ms: 10 } }],
  ['object branch', { choice: { label: 'yes' }, mode: { kind: 'safe', retries: 2 } }],
] as const) {
  let outcome = '';
  try {
    outcome = `success=${(await tool.execute(payload as never)).success}`;
  } catch (error) {
    outcome = `threw ${(error as Error).message}`;
  }
  console.log(`input walk ${label} =>`, outcome);
  check(`input walk accepts the ${label}`, outcome === 'success=true', outcome);
}

let askOutcome = '';
try {
  const r = await askUserQuestionTool.execute({
    questions: [{ question: 'Which?', options: ['plain string', { label: 'object option' }] }],
  } as never);
  askOutcome = `success=${r.success}`;
  console.log('AskUserQuestion data =', JSON.stringify(r.data));
} catch (error) {
  askOutcome = `threw ${(error as Error).message}`;
}
check(
  'AskUserQuestion accepts mixed string/object options',
  askOutcome === 'success=true',
  askOutcome,
);

console.log(fails.length === 0 ? 'SCENARIO 3 PASS' : `SCENARIO 3 FAIL (${fails.length})`);
process.exit(fails.length === 0 ? 0 : 1);
```

- Expected observable result: `SCENARIO 3 PASS`, seven `PASS` lines, `EXIT:0`. The printed schema shows
  `choice.anyOf` and `mode.anyOf` each with two members and the discriminator rendered as
  `"enum": ["fast"]`; both union branches are accepted by the tool-input walk built from that same
  schema; and `AskUserQuestion` still executes (headless, so its data reports `unavailable: true` —
  the observable is that the call is accepted, not what it returns).
  Measured pre-fix (2026-08-16, unfixed code):
  `FAIL createZodFunctionTool accepts a union-typed field -- saw "Unsupported Zod type: ZodUnion"`,
  `EXIT:1` — a union field cannot be turned into a tool at all today. Check 7 run standalone **passes**
  today (`success= true`, `unavailable: true`), so it is a regression guard rather than a new
  capability: it fails if `anyOf` is emitted but not honoured on the input path, which is the failure
  mode that would turn the import-time crash into runtime uncallability of the same tool.
- Cleanup: `rm -f src/core-039-s3.ts` from `scratch/`.
- Evidence (2026-08-16, re-run against the completed implementation at `afd397c10`, after step 6c's closure rule landed; an earlier run at `54886a665` gave the same result): **`SCENARIO 3 PASS`,
  `EXIT:0`**, seven `PASS` lines. The emitted schema carried `choice.anyOf` with a `string` branch and
  an object branch (`required: ["label"]`), and `mode.anyOf` with both discriminated branches, each
  rendering its discriminator as `kind: { type: 'string', enum: ['fast'] }` / `['safe']`. Neither union
  node carried a `type` beside its `anyOf`. `input walk string branch => success=true`;
  `input walk object branch => success=true`;
  `AskUserQuestion data = "{\"success\":true,\"output\":\"{\\\"unavailable\\\":true,\\\"reason\\\":\\\"no interactive user attached\\\"}\"}"`
  — the mixed string/object `options` array was accepted, so `anyOf` is honoured on the input path and
  not merely emitted.

---

### [DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-08-16

**Status remains:** todo

**Violation:** Implementation of this item began before this gate produced a verdict.
`user-execution-scenario` SKILL.md runs this stage in **Mode PLAN — before implementation starts**
(step 4), and only its `PASS` authorizes the next step: "Return `PLANNED`. Implementation may begin."
No such PASS exists — this is the first DONE-GATE-STAGE-1 run against this item — yet the working tree
already carries Direction steps 1 and 1b, uncommitted:

- `packages/agent-core/src/interfaces/provider.ts` (mtime 2026-08-16 06:01:44) — `IParameterSchema.type`
  made optional, `required?: string[]` and `anyOf?: IParameterSchema[]` added, `additionalProperties`
  widened to `boolean | IParameterSchema`, `IObjectParameterSchema extends IParameterSchema` introduced
  with the exact signature written at Direction step 1b, `IToolSchema.parameters` retyped to it, and the
  duplicated `outputSchema` union collapsed to `IParameterSchema`. The added JSDoc names this item:
  "CORE-039 removed the second, structurally identical root shape".
- `packages/agent-core/src/interfaces/index.ts` (mtime 2026-08-16 06:01:55) — `IObjectParameterSchema`
  added to the interfaces barrel export.

Timeline: task document last written 06:00:56 → scenario commit `9e2feebd9` 06:01:12 → source edits
06:01:44 and 06:01:55 → this gate run. The scenario section therefore did exist before the first source
edit, so the item satisfies `backlog-execution.md` § User Execution Test Scenario Rule's "before
implementation starts" ordering on the _section_; what was bypassed is the gate verdict that
`user-execution-scenario` step 4 requires between the two. `git log --oneline origin/develop..HEAD`
carries only `docs(tasks):` commits, so the implementation is visible only in the uncommitted tree.

**Criteria assessment (recorded, but not a PASS — the process finding above is dispositive):** all four
DONE-GATE-STAGE-1 criteria were checked against the document and were met.

- Field completeness — met for all three scenarios. Each carries prerequisites (the shared block at
  §"Common prerequisites" plus a per-scenario "Nothing else"), an exact run command
  (`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-s<N>.ts; echo "EXIT:$?"`,
  verified runnable — `node_modules/tsx/dist/cli.mjs` exists and `scratch/src/*` is gitignored per
  `scratch/.gitignore:2`), an expected observable (`SCENARIO <N> PASS`, a stated PASS-line count,
  `EXIT:0`) plus a measured pre-fix contrast, a cleanup line, and an unfilled `Evidence:` field.
  Noted weakness, not a fail: the script bodies are specified as enumerated assertions with exact
  property paths and expected values rather than literal source, and are deferred to "the PR
  description", which does not exist yet.
- Executability decision — met. All three scenarios state `agent-executable`; no `manual-only` label is
  used, so the specific-technical-reason requirement is N/A.
- Product surface — met. All three drive the public SDK entry points `@robota-sdk/agent-tools` and
  `@robota-sdk/agent-core` (verified exports: `askUserQuestionTool` and `createAskUserQuestionTool` at
  `agent-tools/src/index.ts:122`, `createComputerTool` at `:88`, `createFunctionTool`/
  `createZodFunctionTool` at `:95`, `validateAgainstJsonSchema` at `agent-core/src/index.ts:26`). No
  scenario's observable is a build, typecheck, lint, test, harness, CI, or repository-text inspection.
  The §"Stated coverage limit" paragraph declares the Gemini forwarding gap as engineering-test-only
  and explicitly does not offer it as user-execution evidence.
- Credential / external-service prerequisite — met, and independently re-probed at gate time:
  `env | grep -iE "OPENAI|ANTHROPIC|GOOGLE|GEMINI|BYTEDANCE|API_KEY"` matches only `PATH`, and the repo
  root holds `.env.example` with no `.env` — matching the item's recorded probe. No scenario requires a
  credential or external service, and Scenario 3 check 7 runs `AskUserQuestion` headless.
  Scenario factual anchors spot-checked and correct: `createComputerTool()` returns
  `[view, act]` so `[1]` is the act tool (`computer-tool.ts:211-213`); the action `type` enum has
  exactly 8 values including `takeover`; `path` is `z.array(PointSchema)` with `x: z.number()`;
  `QuestionSchema.options` is `z.array(z.union([...]))` with 2 branches
  (`ask-user-question-tool.ts:33-46`); `askUserQuestionTool` is a module-level construction (`:169`).

**Required action:** Resolve the process violation before this stage is re-run. Per
`user-execution-scenario` SKILL.md step 4, a `NON-COMPLIANCE` here returns `HALT` to the orchestrator and
is a user-facing report — the disposition of the already-written implementation (kept, re-derived after a
PASS, or reverted) is the orchestrator's and the user's call, not this gate's. Also note that the item's
three "Measured pre-fix (2026-08-16, unfixed code)" claims can no longer be reproduced from this tree,
since the tree is no longer unfixed.

**Remediation (2026-08-16, same session).** The finding is accepted as stated. The premature
implementation was reverted (`git checkout -- packages/`), restoring a source tree identical to the
one the item's three "Measured pre-fix (unfixed code)" claims were taken against, so those claims are
reproducible again and the gate's ordering invariant holds. The work was not discarded — the diff is
retained outside the repository and is re-applied only after this gate returns `PASS`. This entry is
kept rather than replaced: a guardian's verdict that disappears once it is inconvenient is not a gate.

---

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16 (run 2, after remediation)

**Status upgrade:** todo → scenarios written; `user-execution-scenario` PLAN step 4 authorizes
implementation to begin.

**Prior finding cured.** The run-1 NON-COMPLIANCE was ordering, not content. Remediation verified
independently, not accepted on report:

- `git status --short --untracked-files=all` shows **no** modified or untracked path under `packages/`
  (only two harness-generated `.agents/evals/lessons/` files). The run-1 files are at committed state:
  `provider.ts:79` is `type: TJSONSchemaKind;` again (mandatory), with no `IObjectParameterSchema` and
  no `anyOf`; the `required?: string[]` at `:53`/`:69` is the pre-existing duplicated root shape this
  item's step 1b exists to remove, not implementation.
- `zod-to-json-schema.ts:96` is `case 'ZodObject': return { type: 'object', ...base };` — the defect is
  present again, i.e. genuinely unfixed code.
- `git diff --name-only origin/develop...HEAD` lists only `.agents/tasks/*`, and `7463493fe` touched
  only this document, so no implementation was smuggled into a commit.
- `git diff --numstat 9e2feebd9 7463493fe` on this file is `73 0` — strictly append-only. The scenario
  text is byte-identical to what run 1 reviewed, and the run-1 verdict entry was not edited.

That last point is what makes the cure genuine rather than cosmetic. The invariant PLAN step 4 protects
is that the scenario is authored independently of the implementation and that the verdict can still
change what happens next. Both hold: the scenario commit (`9e2feebd9`, 06:01:12) predates the reverted
edits (06:01:44/06:01:55) and has not been touched since, so no expected result was fitted to observed
output (`backlog-execution.md` § Evidence forbids exactly that); and with the diff out of the tree, a
FAIL again costs real work.

**Discriminating-power check (executed by this guardian).** A script reconstructed _from this
document's enumerated assertions alone_ was run against the restored tree
(`node ../node_modules/tsx/dist/cli.mjs --conditions=source` from `scratch/`, script since deleted):

```
action = {"type":"object","description":"The single mutating action to perform."}
questions.items = {"type":"object"}
FAIL 1 action.properties.type.enum has 8   FAIL 3 action.required includes type
FAIL 5 action.properties.path.items.properties.x.type
FAIL 7 questions.items.required includes question   FAIL 8 options.items.anyOf has 2
SCENARIO 1 FAIL (5)   EXIT:1
```

This reproduces Scenario 1's stated pre-fix observable exactly, confirming three things: the tree is
unfixed in behavior and not merely in `git status`; Scenario 1 is discriminating, not vacuous; and the
document's prose specification was sufficient for an independent reader to build a script that
reproduces the stated observable.

**Criteria (all four met, re-checked against unchanged scenario text):**

- Field completeness — met for all three scenarios: prerequisites, an exact invocation
  (`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-039-s<N>.ts; echo "EXIT:$?"`),
  an expected observable, a cleanup line, and an unfilled `Evidence:` field.
- Executability decision — met; all three are `agent-executable`, so the `manual-only`
  specific-reason requirement is N/A.
- Product surface — met; all three drive public SDK exports of `@robota-sdk/agent-tools` /
  `@robota-sdk/agent-core`. No observable is a build, typecheck, lint, test, harness, CI, or
  repository-text check. The §"Stated coverage limit" paragraph declares the Gemini forwarding gap as
  engineering-test-only and does not offer it as user-execution evidence.
- Credential / external-service prerequisite — met; re-probed at run 1 (env grep matches only `PATH`;
  `.env.example` present, no `.env`), and no scenario requires a credential or external service.

**Carried weakness, deliberately not failed (unchanged from run 1).** The scenario scripts are specified
as enumerated assertions with exact property paths and expected values rather than literal source, with
"the exact script is reproduced in the PR description" pointing at an artifact that does not yet exist.
This was re-examined rather than reaffirmed by habit, and the criterion asks for exact commands,
prerequisites, an expected observable and an evidence field — all four are present, the invocation is
exact, and the substantive observables (the 10 named `action` fields, `action.required`,
`options.items.anyOf` with 2 branches, the two walks agreeing on `score`) are stated exactly and do not
depend on the script's phrasing. The probe above is direct evidence that the specification is
executable by a reader who has never seen the original script. Inlining the literal scripts would still
be an improvement — it would pin the harness strings (`SCENARIO N PASS`, the PASS-line counts) that a
reconstruction may word differently — and is recommended for Stage 2, but it is not required to pass
this criterion.

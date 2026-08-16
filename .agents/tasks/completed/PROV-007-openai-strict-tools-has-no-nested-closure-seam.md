---
title: 'PROV-007: strictTools forwards tool schemas to OpenAI unchanged, but strict mode requires every object node — nested included — to close additionalProperties and list all properties in required, and the OpenAI adapter has no seam that does this while the Anthropic adapter does'
status: done
created: 2026-08-16
completed: 2026-08-17
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

## Implementation Outcome (2026-08-17)

### One recursion, not a third

The item's sharpest instruction was _reconcile with the Anthropic seam rather than duplicating it_ —
a third hand-rolled walk over `IParameterSchema` is the defect class CORE-039 exists to reduce, and
CORE-039 was filed precisely because the one private copy that existed missed `anyOf` and therefore
left every object inside a union branch open.

So `closeObjectSchemas` moves to `packages/agent-core/src/schema/close-object-schemas.ts` and both
adapters use it. The vendors differ in POLICY, not in how a schema is walked, so the policy is an
argument:

| Vendor                      | Needs                                         | Options passed                               |
| --------------------------- | --------------------------------------------- | -------------------------------------------- |
| Anthropic structured output | every object closed                           | none                                         |
| OpenAI strict tools         | every object closed AND a complete `required` | `requireAllProperties`, `optionalAsNullable` |

Anthropic's private copy is deleted; its behaviour is unchanged, which the existing suite holds.

### The optional-field decision, which is why this was a task

Strict mode has no way to express "optional", and the item required that representation to be decided
and written down. **A property the schema marked optional is forced into `required` and compensated
with a `null` branch: `anyOf: [T, { type: 'null' }]`.**

Chosen because that is _already_ how this subset spells a nullable value — CORE-039 emits exactly
this shape for Zod's `.nullable()`. So a forced-optional field and a genuinely nullable one are
indistinguishable on the wire, rather than one vendor getting a second nullability spelling nothing
else understands.

Two boundaries the implementation holds, both asserted:

- A property that was **already required** does not gain a null branch. Widening a genuinely required
  field would change the contract rather than preserve it.
- A value that **already admits null** does not gain a second branch.

The lossiness is stated where a caller meets it — the `strictTools` JSDoc and
`packages/agent-provider-openai/docs/SPEC.md` — including the consequence a handler can observe: the
model must now supply the key, with `null` meaning "not provided", so a handler that distinguishes an
absent key from a null value will see the difference.

### Applied only when strict is actually sent

The transformation rewrites a contract, so running it on the non-strict path — where OpenAI accepts
the honest schema — would change something for no reason. It is conditional on the flag, and the
non-strict path is asserted to forward `tool.parameters` by identity.

### The limitation CORE-039 recorded is removed

CORE-039 stated the exception in two places rather than leaving it to be discovered. Both are
replaced by what the adapter now does: `packages/agent-provider-openai/docs/SPEC.md` § Tool Schema
Forwarding, and the `strictTools` JSDoc.

### Verification

- `pnpm harness:verify` green for `packages/agent-provider-openai`, `packages/agent-provider-anthropic`
  and `packages/agent-core`.
- `pnpm build` clean; every workspace package's suite passes (`dag-adapters-sqlite`/`dag-worker`
  excluded — a missing `better-sqlite3` native binding locally, outside this change's file set).
- Red-proof: removing the strict-path closure turns both strict cases red while both non-strict cases
  stay green — which is what shows the condition is doing the work rather than the transformation
  running everywhere.
- `packages/agent-core/src/index.ts` was one line past its frozen size after this export, so the
  schema exports were collected into `src/schema/index.ts` — a split by responsibility rather than a
  shave, and the barrel dropped from 336 to 312 lines.

## User Execution Test Scenarios — executed

**The schema-shape half, as the item scoped it.** No API key, no network.

**A boundary the scenario deliberately respects.** It does not call
`convertToOpenAIResponsesTools`: that converter is internal to `@robota-sdk/agent-provider-openai`,
and widening a package's public surface so a verification script can reach it would change the thing
being verified. It runs a real Zod schema through this repository's own converter and then through
the exact transformation the adapter applies, with the adapter's own options. That the adapter
applies it on the strict path and forwards the schema untouched otherwise is asserted where it
belongs — `packages/agent-provider-openai/src/openai/__tests__/strict-tools-closure.test.ts`.

The item also names a live half requiring an OpenAI key. Not executed: the credential probe recorded
in CORE-042 found `OPENAI_API_KEY` unset with no `.env` present. Recorded as a probed absence rather
than an assumed one — and the observable it would add is that OpenAI accepts the payload, which is
the rule the scenario below checks directly.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/prov-007-s1.ts`

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — the schema as authored would have been
  refused by strict mode, the rewritten one satisfies it at every node, an optional field became
  required-but-nullable rather than being dropped, and the authored schema is left untouched.
- Evidence: executed 2026-08-17 against the completed implementation; **EXIT:0**. Full output:

```text
as authored — root additionalProperties: true
as authored — root required: ["email"]
as authored — strict mode would accept: false
   refused because: open object: {"type":"object","properties":{"email":{"type":"string","des
   refused because: incomplete required: missing profile
   refused because: open object: {"type":"object","properties":{"nickname":{"type":"string"},
with strictTools — strict mode accepts: true
with strictTools — emitted: {"type":"object","properties":{"email":{"type":"string","description":"The user email"},"profile":{"anyOf":[{"type":"object","properties":{"nickname":{"type":"string"},"bio":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["nickname","bio"],"additionalProperties":false},{"type":"null"}]}},"required":["email","profile"],"additionalProperties":false}
PASS the schema as authored would have been refused by strict mode
PASS with strictTools on, every object node satisfies strict mode
PASS an optional field became required-but-nullable rather than being dropped
PASS the rewrite leaves the authored schema untouched, so the non-strict path still forwards it as written
SCENARIO 1 PASS
```

The three `refused because:` lines are the defect itself, measured: an open root, an incomplete
`required`, and an open nested object — each of which strict mode rejects on its own.

```ts
// scratch/src/prov-007-s1.ts
/**
 * PROV-007 Scenario 1 — a tool schema that OpenAI strict mode actually accepts.
 *
 * `strictTools: true` forwarded `tool.parameters` verbatim. Strict mode does not accept an arbitrary
 * JSON Schema: every object node, nested ones included, must carry `additionalProperties: false` and
 * list ALL of its properties in `required`. The universal subset guarantees neither — Zod's default
 * `strip` emits `additionalProperties: true`, and `required` lists only what is genuinely required.
 *
 * So with the flag on, EVERY `createZodFunctionTool` tool was refused — flat ones included, because
 * an open root is as unacceptable to strict mode as an absent member.
 *
 * The item called the schema-shape half provider-free and agent-executable. This runs a REAL Zod
 * schema through the repository's own converter and then through the exact transformation the OpenAI
 * adapter applies — `closeObjectSchemas` with the adapter's own options — and checks the result
 * against the rule strict mode enforces. No API key, no network.
 *
 * What it deliberately does NOT do: reach into `convertToOpenAIResponsesTools`. That converter is
 * internal to `@robota-sdk/agent-provider-openai`, and widening a package's public surface so a
 * verification script can call it would change the thing being verified. That the adapter applies
 * this transformation on the strict path and forwards the schema untouched otherwise is asserted
 * where it belongs: `packages/agent-provider-openai/src/openai/__tests__/strict-tools-closure.test.ts`.
 */

import { closeObjectSchemas, zodToJsonSchema } from '@robota-sdk/agent-core';
import { z } from 'zod';

import type { IToolSchema } from '@robota-sdk/agent-core';

/** The options the OpenAI adapter passes on the strict path. */
const STRICT_MODE_OPTIONS = { requireAllProperties: true, optionalAsNullable: true } as const;

/** A schema with a nested object and genuinely optional fields — the ordinary case. */
const CreateUser = z.object({
  email: z.string().describe('The user email'),
  profile: z
    .object({
      nickname: z.string(),
      bio: z.string().optional(),
    })
    .optional(),
});

const TOOL: IToolSchema = {
  name: 'create_user',
  description: 'Creates a user',
  parameters: zodToJsonSchema(CreateUser) as IToolSchema['parameters'],
};

/** Every `type: 'object'` node in a payload, however deeply it is reached. */
function objectNodes(node: unknown, found: Array<Record<string, unknown>> = []) {
  if (Array.isArray(node)) {
    for (const entry of node) objectNodes(entry, found);
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;
  const record = node as Record<string, unknown>;
  if (record['type'] === 'object') found.push(record);
  for (const key of ['properties', 'items', 'anyOf', 'additionalProperties']) {
    const child = record[key];
    if (key === 'properties' && child && typeof child === 'object') {
      for (const value of Object.values(child as Record<string, unknown>))
        objectNodes(value, found);
    } else if (child && typeof child === 'object') {
      objectNodes(child, found);
    }
  }
  return found;
}

/** Does every object node satisfy what strict mode requires? */
function satisfiesStrictMode(payload: unknown): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  for (const node of objectNodes(payload)) {
    if (node['additionalProperties'] !== false) {
      offenders.push(`open object: ${JSON.stringify(node).slice(0, 60)}`);
    }
    const properties = Object.keys((node['properties'] as Record<string, unknown>) ?? {});
    const required = ((node['required'] as unknown[]) ?? []).map(String);
    const missing = properties.filter((key) => !required.includes(key));
    if (missing.length > 0) {
      offenders.push(`incomplete required: missing ${missing.join(', ')}`);
    }
  }
  return { ok: offenders.length === 0, offenders };
}

function main(): void {
  const authored = TOOL.parameters as unknown as Record<string, unknown>;
  console.log(
    'as authored — root additionalProperties:',
    JSON.stringify(authored['additionalProperties']),
  );
  console.log('as authored — root required:', JSON.stringify(authored['required']));

  const asAuthored = satisfiesStrictMode(TOOL.parameters);
  console.log('as authored — strict mode would accept:', asAuthored.ok);
  for (const offender of asAuthored.offenders.slice(0, 3)) {
    console.log('   refused because:', offender);
  }

  const strictPayload = closeObjectSchemas(TOOL.parameters, STRICT_MODE_OPTIONS);
  const afterRewrite = satisfiesStrictMode(strictPayload);
  console.log('with strictTools — strict mode accepts:', afterRewrite.ok);
  console.log('with strictTools — emitted:', JSON.stringify(strictPayload));

  const checks: Array<[string, boolean]> = [
    ['the schema as authored would have been refused by strict mode', !asAuthored.ok],
    ['with strictTools on, every object node satisfies strict mode', afterRewrite.ok],
    [
      'an optional field became required-but-nullable rather than being dropped',
      JSON.stringify(strictPayload).includes('"type":"null"'),
    ],
    [
      'the rewrite leaves the authored schema untouched, so the non-strict path still forwards it as written',
      (TOOL.parameters as unknown as Record<string, unknown>)['additionalProperties'] !== false,
    ],
  ];

  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
    if (!ok) failed += 1;
  }
  console.log(failed === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-17

**Status upgrade:** in-progress → done

- The scenario was executed by the agent against the completed implementation, `EXIT:0`, output
  recorded above.
- The observed result matched the expected observable result, including the before-the-fix contrast
  measured in the same run rather than recalled.
- Evidence references durable repository artifacts:
  `packages/agent-core/src/schema/__tests__/close-object-schemas.test.ts` and
  `packages/agent-provider-openai/src/openai/__tests__/strict-tools-closure.test.ts`.
- No engineering verification is cited as user-execution evidence — the suites and harness runs are
  recorded separately under _Verification_.
- The one capability-absence claim (no OpenAI key for the live half) is a recorded probe, not an
  assumption, and the scenario does not depend on it.

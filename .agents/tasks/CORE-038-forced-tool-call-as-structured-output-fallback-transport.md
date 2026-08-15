---
title: 'CORE-038: the structured-output fallback transport re-asks for JSON in prose, which is the path every provider without a native responseFormat surface takes — and, because a native surface is detected per PROVIDER PACKAGE rather than per endpoint, an OpenAI-compatible gateway serving a non-OpenAI model is silently on the prompt path while the enforcement loop believes it enforced early'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: packages/agent-core, packages/agent-provider-openai-compatible, packages/agent-provider-bytedance
depends_on: [CORE-037]
---

# CORE-038: forced tool call as the structured-output fallback transport

Proposed by an external user in [issue #1738](https://github.com/woojubb/robota/issues/1738), as a
follow-up to CORE-015 (first-class structured output). The reporter offered to open a PR for either
piece if the direction is agreed.

## Problem

CORE-015's validate-and-retry loop is not in question — it is what guarantees correctness. What is in
question is the **transport** used on the attempt the loop wraps. Today, when a provider has no
native structured-output surface, the fallback re-prompts in prose:

```ts
// packages/agent-core/src/core/robota-execution.ts:179
function buildRetryFeedbackInput(spec: IStructuredOutputSpec, issues: string[]): string {
  return [
    'Your previous response did not match the required JSON schema.',
    …
    'Respond with ONLY a JSON object (no prose, no code fences) matching this JSON schema:',
    JSON.stringify(spec.jsonSchema),
  ].join('\n');
}
```

Two things make this worth changing rather than accepting:

1. **The fallback is not a rare path.** Verified against `develop`, 2026-08-16 — the native
   `responseFormat` mapping exists in three provider packages and in neither of the other two
   text-generation packages:

   | provider package                   | native structured-output surface | evidence                                  |
   | ---------------------------------- | -------------------------------- | ----------------------------------------- |
   | `agent-provider-anthropic`         | yes — `output_config.format`     | `src/anthropic/provider.ts:349-356`       |
   | `agent-provider-gemini`            | yes — `responseSchema`           | `src/gemini/execution-helpers.ts:142-145` |
   | `agent-provider-openai`            | yes — `response_format`          | `src/openai/chat-completions-chat.ts`     |
   | `agent-provider-openai-compatible` | **no** — prompt fallback         | `grep -rn responseFormat …/src` → no hits |
   | `agent-provider-bytedance`         | **no** — prompt fallback         | `grep -rn responseFormat …/src` → no hits |

   `openai-compatible` is the path for DeepSeek, Groq, Together, OpenRouter, vLLM/Ollama and any
   gateway — a large share of real deployments.

2. **"Native surface" is per-endpoint, not per-model.** `agent-provider-openai` accepts a `baseURL`.
   Pointed at a gateway serving a non-OpenAI model, the request still carries
   `response_format: json_schema`, the endpoint accepts it, and the underlying model may ignore it.
   The provider cannot tell the difference, so the enforcement loop believes it is on the
   "enforce early" path while it is effectively on the prompt path.

Reporter's measurement outside robota — same schema, same prompt, one OpenAI-compatible gateway:

| transport                   | DeepSeek v4-flash | Claude haiku-4.5 |
| --------------------------- | ----------------- | ---------------- |
| JSON-schema response format | 0/4               | 4/4              |
| forced tool call            | 4/4               | 4/4              |

The failures were not quality failures: the model produced good content under an invented key
(`{"feedback": …}` instead of `{"hint": …}`), and once returned the JSON schema definition itself.

## Impact

The loop still returns a schema-conforming object or exhausts its retries, so this is a **cost,
latency and failure-rate** problem rather than a correctness hole: every first-attempt miss is a full
extra turn. On the providers most likely to miss, the reporter measured a 0% first-attempt rate.

## Direction (proposal — needs a decision before implementation)

Suggested shape from the reporter:

1. Add a tool-call transport used when no native surface is available: register one tool built from
   `spec.jsonSchema` (name from `spec.name`), send `tool_choice: required`, and validate the tool
   arguments with the existing validator.
2. Keep `buildRetryFeedbackInput` for the case where even the forced tool call fails validation — a
   good last resort, just not a good first resort.
3. Optionally make the transport selectable for deployments that know their endpoint honors
   `response_format`.

Nothing about the enforcement loop, the validator, or the public `run(input, { output })` surface
changes.

Open questions this Task does **not** decide — they belong to the paired spec-doc and the
recommendation gate:

- Is the tool-call transport the default for the two non-native packages only, or for any endpoint
  whose native support cannot be established (which would change `agent-provider-openai` behavior
  when `baseURL` is set)?
- Where does transport selection live — provider capability declaration, agent config, or
  `IRunOptions`? Note PROV-006 (per-model capability flags declared but read by nothing) covers the
  neighbouring capability-declaration surface and should be reconciled, not duplicated.
- Does injecting a schema tool interact with an agent's own tool set (name collisions, a model
  choosing a real tool instead of the schema tool under `tool_choice: required`)?

**Blocked in effect by CORE-037.** While `zodToJsonSchema` drops nested object properties, both
transports receive a truncated schema, so any before/after measurement of this change is
uninterpretable for nested schemas.

## Secondary item from the issue — already closed, verify sufficiency

The issue also asks that `llms.txt` mention structured output. On `develop` it already does:

- `llms.txt:24` — "**Schema-enforced structured output** — `run(prompt, { output: zodSchema })`
  returns a validated typed object with provider-native mapping + bounded retry".

So the gap the reporter hit is closed. What is worth checking as part of this Task is whether that
line conveys the _guarantee_ strongly enough for an agent reading `llms.txt` to choose robota's path
over its own SDK's helper, and whether it should state that non-native providers go through the
bounded loop rather than degrading silently. Reply to the issue with the correction either way.

## Test Plan

- The spec-doc's decision is recorded and passes the recommendation gate before any code is written
  (this is a proposal, not a defect).
- Provider-level tests asserting the forced-tool-call transport is used on the non-native packages
  and that its arguments go through the same validator as the native path.
- A test asserting the prose retry still fires when the forced tool call itself fails validation.
- A replay-provider (`agent-provider-replay`) test pinning the transport chosen per provider, so a
  future provider gaining a native surface flips one recorded expectation rather than silently
  changing behavior.
- `pnpm harness:verify -- --scope packages/agent-core` and the affected provider scopes green.
- `packages/agent-core/docs/SPEC.md` § Structured Output Contract documents the transport choice.

## User Execution Test Scenarios

Applies — this changes observable SDK behavior on non-native providers.

**Scenario 1 — a structured run succeeds first-attempt through an OpenAI-compatible endpoint**

- Prerequisites: an OpenAI-compatible gateway `baseURL` plus key exported, serving a non-OpenAI model
  (the reporter used DeepSeek through such a gateway); `pnpm build`.
- Environment: requires a user-provided gateway endpoint — state at implementation time whether the
  repo's existing example configuration covers it or the user must supply their own. This is the one
  environment dependency the scenario cannot create for itself.
- Steps: call `run(prompt, { output: <a Zod schema with a nested object> })` against that endpoint
  with `outputRetries: 0`, and print the returned object.
- Expected observable result: a schema-conforming object is returned with zero retries. (Before the
  change, the same call with `outputRetries: 0` fails validation on such an endpoint.)
- Cleanup: none.
- Evidence: _to be filled after implementation_ (paste the returned object and the attempt count).

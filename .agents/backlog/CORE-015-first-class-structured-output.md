---
title: 'CORE-015: first-class schema-enforced structured output — run(prompt, { output: schema })'
status: todo
created: 2026-07-03
priority: high
urgency: soon
area: packages/agent-core, packages/agent-provider
depends_on: []
---

# First-class structured output

Gap analysis G1 (`.design/gap-analysis-realtime-voice-agent-app.md`, P0 in its roadmap): a consumer
needing a fixed-schema JSON answer (their coach report) today must route it through a tool-call
workaround — there is no agent-level "return an object matching this schema, retry on violation"
API, and no provider-native structured-output mapping (`response_format`/`json_schema` etc.). The
doc marks this the single most broadly-needed missing block ("거의 모든 앱이 필요") and the speech
feedback's decision-tool pattern (§4) is partly a stand-in for it.

## What

1. Agent-level API: `run(prompt, { output: <schema> })` (and the streaming variant's final-object
   equivalent) returning a validated, typed object; on schema violation, bounded automatic retry
   with the validation error fed back.
2. Schema adapter: Zod and/or raw JSON-Schema in — one internal representation (reuse the existing
   zod→JSON-schema conversion in agent-tools rather than forking it; SSOT).
3. Provider mapping: use each provider's native structured-output surface where it exists
   (OpenAI `response_format`, Anthropic structured output, Gemini responseSchema), fall back to the
   tool-call technique where it doesn't — the fallback is an internal detail, not the public API.
4. Type inference: the returned object is `z.infer<S>`-typed for Zod input (pairs with SDK-009).

Design decisions for GATE-WRITE: relation to conversation history (does a structured answer append
as an assistant message?), retry budget surface, interaction with tools present in the same run.

## Test Plan

- Unit: schema pass/violation/retry/exhaustion per provider mapping (mock providers); zod and
  JSON-schema inputs; typed return.
- Functional: scripted provider returning an invalid then valid object — one retry, validated result.
- Live (User Execution): real provider returns a small schema-validated report.

## User Execution Test Scenarios

- Prereq: consumer script with a real provider key.
- Steps: request a 3-field structured report via the new API.
- Expected: a parsed, schema-valid typed object (no manual JSON.parse, no tool-call plumbing);
  violation path observably retries.
- Evidence: _to fill at implementation._

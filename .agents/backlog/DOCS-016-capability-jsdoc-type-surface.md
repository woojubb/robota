---
title: 'DOCS-016: adoption-critical capabilities on the type surface — baseURL gateway JSDoc + provider table reframing'
status: todo
created: 2026-07-03
priority: high
urgency: soon
area: packages/agent-provider, packages/agent-core
depends_on: []
---

# Put adoption-critical capabilities where agents (and IDEs) actually read

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` §3.1, P1, P5): the
evaluating agent concluded "robota cannot go through an AI gateway" (misunderstanding O1) after
faithfully reading the surfaces the repo presents first — all three quickstarts show vendor-key
examples, the provider table frames OpenAI as "GPT-4o, o1, o3" (model-vendor frame), and
`OpenAIProvider.baseURL`'s only documentation is one option-table line. The capability was
discoverable only via a grep that landed in ANOTHER provider's test file. Verified trust order of
the consumer agent: `.d.ts` > tests > source > README — and `.d.ts` ships with the package, so it
never goes stale for the consumer.

## What

1. **`IOpenAIProviderOptions.baseURL` JSDoc** (adoption-decision grade, per the report's draft):
   any OpenAI-compatible server works — AI gateways (Vercel AI Gateway, LiteLLM, OpenRouter),
   Azure, vLLM, Ollama, LM Studio; setting it switches `apiSurface` to chat-completions; gateway
   model slugs (e.g. `anthropic/claude-*`) pass through verbatim. Mirror on other providers'
   endpoint options where applicable.
2. **Provider table reframing (P5)**: describe providers by protocol/endpoint surface ("OpenAI API
   - any OpenAI-compatible endpoint — gateways, Azure, vLLM, local") instead of model lists that
     age and imply vendor-lock; move "OpenAI-compatible" out of the Gemma-only corner
     (`content/guide/providers.md` narrative included).
3. Behavior-contract JSDoc on `Robota.run`/`runStream` is owned by DOCS-014 (items 3-6) — this item
   cross-references, does not duplicate.

## Test Plan

- JSDoc lands in the published `.d.ts` (build output inspected); three-doc-layer sync (SPEC/README/
  content) for the reframed provider narrative; docs build green.

## User Execution Test Scenarios

- Prereq: fresh consumer with only the installed package (no repo access).
- Steps: in an IDE, hover `baseURL` on `OpenAIProvider` options; follow only that JSDoc to configure
  a gateway endpoint with a non-OpenAI slug.
- Expected: gateway streaming + tool calling works from the hover text alone.
- Evidence: _to fill at implementation._

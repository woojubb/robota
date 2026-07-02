---
title: 'DOCS-016: adoption-critical capabilities on the type surface — baseURL gateway JSDoc + provider table reframing'
status: done
completed: 2026-07-03
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
- Evidence: **PASS (live, 2026-07-03).** `IOpenAIProviderOptions.baseURL` now carries
  adoption-decision-grade JSDoc (gateways/Azure/vLLM/Ollama/LM Studio, apiSurface switch to
  chat-completions, verbatim slug pass-through, Vercel AI Gateway @example) — verified present in
  the built package `.d.ts` (`dist/node` + `dist/browser`), which is what a consumer's IDE hover
  reads. Mirrored on gemma/qwen/deepseek `baseURL` (OpenAI-compatible framing) and anthropic
  `baseURL` (Messages-protocol framing + pointer to the OpenAI provider for OpenAI-protocol
  gateways). Provider tables reframed to protocol/endpoint-surface in
  `packages/agent-provider/README.md` (+ new "AI Gateway / any OpenAI-compatible endpoint"
  example; fixed the Gemma example's wrong option names `baseUrl`/`model` →
  `baseURL`/`defaultModel`, masked from the doc scan by the options index signature) and
  `content/guide/providers.md` (protocol-client narrative, "Through an AI gateway" section,
  gateway pointer in the overview callout). Live User Execution: temp consumer script in
  `packages/agent-playground` following ONLY the new JSDoc recipe — `OpenAIProvider` +
  OpenAI-compatible endpoint baseURL (DashScope compatible-mode, same protocol class as a
  gateway) + non-OpenAI slug `qwen-plus` (TEST_QWEN_KEY) → PASS: streaming (7 deltas) + tool
  call (`get_weather` executed) + final answer. doc-examples scan 51 blocks green;
  `pnpm docs:build` green — required fixing a pre-existing breakage absorbed into scope:
  `scripts/docs/prepare-docs.js` still checked the removed `.vitepress/dist` path after the
  docs app's VitePress→Next.js migration (now checks `apps/docs/out`). DOCS-014 owns the
  run/runStream behavior-contract JSDoc (cross-referenced, not duplicated).

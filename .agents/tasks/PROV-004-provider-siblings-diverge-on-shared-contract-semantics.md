---
title: 'PROV-004: provider siblings diverge on the shared IAIProvider contract — Anthropic chatStream demotes system prompts and drops tool calls, error taxonomy is typed on 2 of 7 surfaces, responseFormat is ignored by the compat family, and three providers re-implement streamWithAbort without its abort race'
status: in-progress
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-provider-anthropic, packages/agent-provider-openai, packages/agent-provider-openai-compatible, packages/agent-core
depends_on: []
---

# PROV-004: sibling behavioral drift on the shared provider contract

## Problem

Providers implementing agent-core's shared `IAIProvider` contract give the same input materially
different model-visible semantics depending on which vendor (and which API surface) is configured.
Four independent divergences, each a contract-conformance defect.

## Evidence

- **Anthropic chatStream degraded (VIOLATION):** `provider.ts:198` runs
  `convertToAnthropicFormat(messages)` on ALL messages, so a system prompt is demoted to a user
  message (`message-converter.ts:110` "Anthropic doesn't have system role, use user") — unlike `chat`
  (`:113-117`) which uses the Anthropic `system` param; `:267-276` yields only `text_delta` (tool_use
  blocks, usage, stop_reason dropped); `:239` omits `options.signal`; mid-stream 429s unmapped. The
  compat siblings' `chatStream` surfaces tool-call and usage chunks
  (`shared/openai-compatible/response-parser.ts:102-159`).
- **Error taxonomy divergence (VIOLATION):** typed `RateLimitError` (recoverable, `retryAfter`,
  provider) on only 2 of 7 chat surfaces (anthropic `provider.ts:164-170`, openai Chat-Completions
  `chat-completions-chat.ts:62-67`); openai's DEFAULT Responses path (`responses-chat.ts:78-82`),
  gemini (`provider.ts:88-91`), and deepseek/qwen/gemma wrap everything into a prefix-string `Error`,
  so `agent-framework/error-humanizer.ts:19-23` degrades to regex and loses `retryAfter`/`provider`.
- **responseFormat dropped by the compat family (VIOLATION):** `IChatOptions.responseFormat`
  (CORE-015, `agent-core/provider.ts:249-252`) is mapped by agent-provider-openai on the
  Chat-Completions wire (`chat-completions-chat.ts:147-161`) but has ZERO references in
  `agent-provider-openai-compatible/src` — deepseek/qwen-chat/gemma emit model/messages/temperature/
  max_tokens/tools only; a `json_schema` run's fidelity depends silently on vendor choice.
- **streamWithAbort re-implemented weaker (VIOLATION):** the base class mandates `this.streamWithAbort`
  (abort race + macrotask yield, `agent-core/abstract-ai-provider.ts:116-141`); anthropic
  (`streaming-handler.ts:198-207`), openai-Responses (`responses-stream-utils.ts`), and qwen each ship
  a private copy that checks `signal.aborted` only between events (no `Promise.race`, no macrotask
  yield) — so an ESC during a long inter-event await is not honored on anthropic. (deepseek/gemma use
  the inherited helper correctly.)

## Direction

- Route Anthropic `chatStream` through the same system-separation and block-assembly as `chat` (yield
  tool-call/usage chunks; pass `options.signal`).
- Extract a shared error mapper (429→RateLimitError, 401→AuthenticationError, preserve `status`) in the
  openai-compatible `./shared` base and use it in all catch blocks; fix openai-Responses first (its
  default surface).
- Thread `responseFormat` through the compat `buildRequestParams` (via `./shared`), or document the
  intentional per-provider no-op the way the effort dial is documented.
- Replace the three private `streamWithAbort` copies with the inherited helper (or export the core
  helper for the free-function call sites).

## Test Plan

- Red-first per divergence: Anthropic streaming keeps the system prompt in the system channel and
  surfaces a tool call; a 429 from each provider surfaces a typed `RateLimitError`; a compat-family
  `json_schema` request maps `response_format`; an abort during a slow anthropic stream is honored
  promptly. Each fails today.
- `pnpm harness:verify` over the affected provider packages green.

## User Execution Test Scenarios

**Applies** (provider selection + tool use + structured output are CLI/SDK product surfaces).

- Prerequisites: built CLI + Anthropic and a compat-family (e.g. DeepSeek) key.
- Steps: (1) with Anthropic, run a streaming turn that has a system prompt and a tool — verify the
  system instruction is honored and the tool fires; (2) with a compat provider, request JSON-schema
  structured output; (3) trigger a rate limit and observe the error message.
- Expected (after fix): system prompt honored + tool fires on Anthropic streaming; compat provider
  returns schema-shaped output; the rate-limit error is a typed recoverable message with retry info.
- Expected (before fix, contrast): Anthropic streaming demotes the system prompt and drops the tool
  call; compat provider ignores the schema; the rate limit surfaces as an opaque string.
- Cleanup: none.
- Evidence (fill in after implementation): transcripts for each of the three.

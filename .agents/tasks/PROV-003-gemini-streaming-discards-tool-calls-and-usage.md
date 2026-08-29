---
title: "PROV-003: GeminiProvider's streaming-assembly path silently discards tool calls and usage while advertising functionCalling support — in the framework's normal interactive mode a Gemini function call is dropped and the turn completes as plain text"
status: todo
created: 2026-08-13
priority: high
urgency: soon
area: packages/agent-provider-gemini, packages/agent-core
depends_on: []
---

# PROV-003: Gemini loses tool calls in streaming mode

## Problem

When a text-delta callback is set (the framework's normal interactive path), GeminiProvider assembles
the response from text only — a model `functionCall` part and `usageMetadata` are silently dropped —
even though the provider advertises `functionCalling.supported: true` and its non-streaming path maps
function calls correctly. Separately, GeminiProvider alone skips the native-web-tools assertion every
sibling performs, so an unsupported `nativeWebTools` request is silently ignored.

## Evidence (adversarially verified 2026-08-13, CONFIRMED)

- `packages/agent-provider-gemini/src/gemini/execution-helpers.ts:43-45` — `executeDirect` delegates
  to `assembleStreamingChatResponse` when `options.onTextDelta` is set and IMAGE modality is absent;
  `:167-195` that assembly collects only `chunk.content` text; `:103-118` the stream loop yields only
  `extractStreamText(chunk)` — chunks carrying `functionCall` parts or `usageMetadata` are skipped. The
  returned assistant message has no `toolCalls` and no usage.
- Non-streaming path DOES map them: `message-converter.ts:55-65` (functionCalls→toolCalls),
  `:67-70` (usage). `supportsTools()` returns true (`provider.ts:257-259`); inherited
  `getCapabilities()` advertises `functionCalling.supported: true`
  (`agent-core/abstract-ai-provider.ts:210-212`).
- Production wiring confirms the loss is live: agent-core's streaming round passes `onTextDelta`
  together with tools into `provider.chat` (`execution-round-streaming.ts:80-87`,
  `execution-round-provider.ts:65`), and GeminiProvider `withProviderCallbacks` (`provider.ts:272-281`)
  injects a provider-level `onTextDelta` even when the caller set none.
- Native-web-tools: neither `chat` nor `chatStream` calls `validateNativeWebTools`/
  `assertProviderNativeWebToolsAvailable` (`provider.ts:58-129`), while every sibling does
  (anthropic `:99,183`; openai `:82,121`; deepseek/qwen/gemma likewise). `assertProviderNativeWebToolsAvailable`
  (`agent-core/provider-capabilities.ts:59-87`) throws on unsupported — so Gemini silently proceeds.

## Direction

Assemble `functionCall` parts and `usageMetadata` in `executeDirectStream`/`assembleStreamingChatResponse`,
mirroring the shared openai-compatible stream assembler; add the two `validateNativeWebTools` calls to
GeminiProvider's `chat`/`chatStream`. Red-first with a tool-calling stream fixture.

## Test Plan

- Red-first: a streaming Gemini chat (onTextDelta set) with a tool available and a fixture stream
  emitting a functionCall — assert the returned message carries the tool call and usage. Fails today.
- Red-first: a Gemini `chat` with an unsupported `nativeWebTools` request throws (matching siblings).
- `pnpm harness:verify -- --scope packages/agent-provider-gemini` green.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

The provider behavior is observable through the CLI's interactive streaming mode. The scenario
below exercises a built CLI against Gemini with a configured API key; its expected output is the
tool call being executed and usage being retained in the completed turn.

**Applies** (Gemini is a selectable provider in the CLI).

- Prerequisites: built CLI + a Gemini API key; a prompt that requires a tool call (e.g. read a file).
- Steps: select the Gemini provider, ask a question that needs a tool call in interactive (streaming)
  mode.
- Expected (after fix): the model's tool call executes and the turn uses the tool result.
- Expected (before fix, contrast): the tool call never fires; the model answers as plain text as if it
  had no tools, and usage is unattributed.
- Cleanup: none.
- Evidence (fill in after implementation): TUI transcript showing the Gemini tool call executing.

## Planning Gate

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-29

The user-execution scenario is executable after building the CLI and configuring a Gemini API key.
The exact interaction is: select Gemini in the interactive CLI, ask for an answer requiring a tool
call, and observe the transcript. Expected observables are a Gemini function call execution and a
completed turn retaining the tool result; cleanup is not required.

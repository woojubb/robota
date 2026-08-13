---
title: 'PROV-005: the OpenAI Responses protocol adapter is forked between agent-provider-openai and qwen (contradicting the "shared base" SPEC), Gemma invents an unowned pseudo-tool-call protocol that swallows undeclared-XML inner text, and Anthropic bakes web-search UI text into durable assistant content'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-provider-openai, packages/agent-provider-openai-compatible, packages/agent-provider-anthropic
depends_on: []
---

# PROV-005: protocol duplication + content-injection defects

## Problem

Three provider-internal contradictions around protocol ownership and model-visible content, each
crossing an architecture rule.

## Evidence

- **Responses adapter forked (DRIFT + structural duplication):** `agent-provider-openai/docs/SPEC.md:5`
  and `agent-provider-openai-compatible/docs/SPEC.md:58-60` claim the OpenAI-compatible protocol base
  lives in `./shared` and is consumed by both. But `src/shared/openai-compatible/` contains only the
  Chat-Completions base; the Responses adapter exists twice as near-parallel forks —
  `agent-provider-openai/src/openai/responses-{chat,converter,parser,stream-utils}.ts` (718 lines) vs
  `agent-provider-openai-compatible/src/qwen/responses-{chat,converter,parser,stream-utils}.ts` (644
  lines; type-renamed forks). A protocol fix lands in one vendor and not the other.
- **Gemma invented pseudo-protocol (RULE↔CODE + UNDOCUMENTED):** `gemma/tool-call-projector.ts:10-12`
  markers `<|tool_call>`/`<tool_call|>`/`call:`; `pseudo-command-envelope.ts:33-44` a `{command,args}`
  JSON envelope inside any XML tag becomes a tool call; `pseudo-tool-call-projector.ts:110-132` —
  ANY XML-ish tag not matching a declared tool is consumed as a "control block" and its inner VISIBLE
  text is removed (`mergeProjection:230-237` never merges inner `visibleText`; test at
  `tool-call-projector.test.ts:110-120` confirms internal planning text disappears). Rule
  `project-structure.md:113` bans invented parser syntax/pseudo tool-call markers without an owning
  SPEC; the package SPEC never mentions this protocol. (Tool-NAME matching DOES honor the
  declared-names clause — that part is compliant; the strip-all-XML and the marker grammar are the
  violation.)
- **Anthropic content injection (RULE↔CODE):** `anthropic/streaming-handler.ts:76-95` pushes
  `🔍 Searching: "…"` and `[Web Search Results]…` into `textParts` (durable assistant content that is
  persisted and re-sent to the model), instead of only through the structured `onServerToolUse`
  channel that exists (`provider.ts:62-63`). Rule `project-structure.md:116` — providers must not
  hardcode CLI/TUI behavior; `:115` — execution state only via structured results/events.

## Direction

- Hoist a Responses-protocol base into `openai-compatible/./shared` (the Chat-Completions half proves
  the shape), consumed by both packages — OR amend both SPECs to state the shared base covers Chat
  Completions only and the Responses adapters are deliberately per-vendor.
- Gemma: give the pseudo-protocol an owned SPEC section (grammar, envelope, strip policy) AND stop
  discarding the inner text of undeclared XML blocks (pass it through as visible content) unless the
  SPEC explicitly claims the strip with a rationale.
- Anthropic: emit server-tool activity only via `onServerToolUse`/native-payload events; keep the
  emoji label and results formatting out of `content` so the UI layer renders them.

## Test Plan

- Red-first: a protocol behavior added to `./shared` Responses is observed by both openai and qwen (or
  the SPECs no longer claim a shared Responses base); a Gemma answer containing legitimate XML retains
  its inner text; an Anthropic web-search turn's persisted assistant message contains no `🔍`/`[Web
Search Results]` decoration (the activity is on the structured channel).
- `pnpm harness:verify` over the affected provider packages green.

## User Execution Test Scenarios

**Applies** (Gemma/Anthropic are selectable providers; content contamination is user-visible and
re-fed to the model).

- Prerequisites: built CLI + the relevant keys.
- Steps: (1) with Gemma, ask a question whose answer legitimately contains an XML/HTML snippet; (2)
  with Anthropic + web search, run a search turn and inspect the persisted assistant message on the
  next turn.
- Expected (after fix): the Gemma answer keeps its XML content; the Anthropic assistant message
  carries no injected search-UI text (the label renders via the UI, not the transcript).
- Expected (before fix, contrast): the Gemma XML snippet is silently truncated; the Anthropic
  transcript contains `🔍 Searching:`/`[Web Search Results]` baked into content.
- Cleanup: none.
- Evidence (fill in after implementation): the two transcripts.

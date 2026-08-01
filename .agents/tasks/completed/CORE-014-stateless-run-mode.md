---
title: 'CORE-014: run-isolated (stateless) mode — retainHistory: false + a zero-assembly lightweight call path'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: medium
urgency: later
area: packages/agent-core, packages/agent-framework
depends_on: []
---

# Stateless usage mode

Two converging external signals (speech project):

- Feedback §3.4 (`.design/feedback-speech-adoption-2026-07-03.md`): every `run()` sends the full
  accumulated instance history. A caller that reconstructs context per call (their coordinator
  pattern) pays **O(n²) tokens** for zero information. Workaround: `clearHistory()` before every
  run — which works because CORE-010 re-injects the system prompt — but the accumulation behavior
  itself is easy to miss and directly costs money.
- Gap analysis G4 (`.design/gap-analysis-realtime-voice-agent-app.md`): `createQuery` exists as a
  lightweight entry, but assembling a "provider + system prompt + stream, nothing else" call still
  carries coding-agent-assembly connotations for newcomers. (Read with the doc's own caveat — robota
  is a composable library; this is about making the thin block obvious and first-class.)

## What

1. **`retainHistory: false`** (run-isolated mode) on `IAgentConfig` — each run starts from the
   system prompt + the prompt given; nothing accumulates. Equivalent to the clearHistory
   workaround, but declared once, self-documenting, and immune to a missed clear.
2. Document the default accumulation behavior prominently (cost-relevant) — JSDoc + SPEC + guide
   (DOCS-014 carries the guide part).
3. Evaluate whether `createQuery` already satisfies the "streamText-equivalent" ask once (1) exists;
   if yes, the remaining work is positioning/docs, not new API. Do not build a duplicate entry point
   without evidence it is needed (SSOT: one lightweight path).

## Test Plan

- Unit: with `retainHistory: false`, consecutive runs each send only system + current prompt
  (provider request payloads asserted); default unchanged; interaction with `clearHistory` and
  CORE-010 re-injection covered.

## User Execution Test Scenarios

- Prereq: consumer script running 3 sequential prompts with the mode on, request sizes logged.
- Steps: run; compare per-call prompt token counts against default mode.
- Expected: flat token profile (no growth), identical single-turn answers.
- Evidence: **PASS (live, 2026-07-03).** (1) `IAgentConfig.retainHistory` implemented (default
  `true`; `false` = run-isolated mode). Semantics chosen and documented: the store is _ephemeral
  per run_ — a run executes on system prompt + any pre-run injected context + the prompt, and the
  store resets in the run's `finally` (success/abort/error alike; also after a fully-consumed
  `runStream`), so injected context is visible to that run only and nothing leaks forward; the
  system prompt re-applies via CORE-010. (2) Cost-relevant accumulation default documented at the
  owner surfaces: `retainHistory` JSDoc (ships in `.d.ts`), SPEC interface row, guide "History
  lifetime & cost" extension with a runnable pattern, llms.txt contract line. (3) `createQuery`
  evaluation recorded: it shares ONE `InteractiveSession` across calls and assembles CLI tools +
  permissions — it is the framework-level assembly, not the thin block; with `retainHistory:
false`, a plain `Robota` IS the "provider + system prompt + stream, nothing else" path, so no
  new entry point is warranted (SSOT kept: one lightweight path, positioning line added to the
  guide). Unit (provider payload asserted): 3 consecutive isolated runs each send exactly
  `[system, user(current)]` + instance history stays empty; default unchanged (2nd call carries
  both user turns); pre-run `injectMessage` visible to that run, gone after. agent-core 805/805
  green. Live User Execution (real Anthropic, per-call `inputTokens` from response metadata):
  run-isolated `17, 18, 17` (flat, max spread 1); default `17, 30, 43` (linear per-call growth =
  the O(n²) total the feedback measured). Identical single-turn answers. PASS.

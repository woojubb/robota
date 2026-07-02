---
title: 'CORE-014: run-isolated (stateless) mode — retainHistory: false + a zero-assembly lightweight call path'
status: todo
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
- Evidence: _to fill at implementation._

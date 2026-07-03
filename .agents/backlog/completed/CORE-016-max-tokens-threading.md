---
title: 'CORE-016: maxTokens/temperature not threaded — runStream drops model options, per-run overrides dead'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: high
urgency: now
area: packages/agent-core
depends_on: []
---

# maxTokens/temperature threading

External live measurement (speech project, `.design/feedback-speech-adoption-2026-07-03.md` 추록,
[높음]): `defaultModel.maxTokens` AND per-run `run/runStream(input, { maxTokens })` are both
ignored on the streaming path (beta.76: maxTokens 50 → 2,475-char output; direct curl with
`max_tokens: 50` → 63 chars cut at `finish_reason: length`). Source-verified: the `executeStream`
chat options carried only `model`/`tools`/`responseFormat` (no maxTokens/temperature/effort), and
`IRunOptions.maxTokens`/`temperature` were dead fields — never threaded into any execution context.

## What

1. Streaming path parity: `executeStream` chat options carry `defaultModel.maxTokens`/
   `temperature`/`effort` like the round path.
2. Run-scoped overrides: `IRunOptions.maxTokens`/`temperature` thread through
   `IExecutionContext` to BOTH paths and win over `defaultModel.*`.
3. Regression tests (reporter's proposal): mock provider asserts chatOptions receive the values
   for run/runStream × defaultModel/per-run-override.

## Test Plan

- Unit: 4 threading assertions (mock provider records options); full core suite green.
- Live (User Execution): the reporter's exact repro — maxTokens 50 → visibly truncated output on
  both `run` and `runStream`.

## User Execution Test Scenarios

- Prereq: consumer script with a real provider key.
- Steps: `runStream` with `defaultModel.maxTokens: 50`, then `run` with `{ maxTokens: 50 }`;
  measure output lengths vs an uncapped control.
- Expected: both capped outputs are dramatically shorter than the control (truncation visible).
- Evidence: **PASS (live, 2026-07-03).** Fix: (1) `executeStream` chat options now carry
  `defaultModel.maxTokens`/`temperature` and the effort dial (parity with the round path — the
  streaming path had silently dropped ALL model options); (2) `IRunOptions.maxTokens`/
  `temperature` threaded end-to-end: buildRunContext + the runStream inline context →
  `IExecutionContext` (new run-scoped fields) → `buildFullExecutionContext` (the
  easy-to-miss helper, per the CORE-011 lesson) → both provider call sites
  (execution-round-streaming overrides + executeStream), overrides winning over
  `defaultModel.*`. JSDoc on both IRunOptions fields + SPEC row. Regression tests exactly as
  the reporter proposed: mock provider asserts chatOptions receive the values for
  run/runStream × defaultModel/per-run override (4 tests) — agent-core 809/809, full repo
  test/typecheck, harness suite 221, 43 scans green. Live User Execution (reporter's exact
  repro, real Anthropic haiku): uncapped control 13,501 chars vs `runStream` with
  `defaultModel.maxTokens: 50` → 238 chars and `run` with per-run `{ maxTokens: 50 }` →
  211 chars — truncation now lands where beta.76 measured 2,475 chars.

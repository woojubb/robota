---
title: 'EX-001: examples/capabilities track — gateway, decision-agent, streaming, stateless-turns demos'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: low
urgency: later
area: examples/
depends_on: []
---

# Capability demos ("what can it do"), not just integration demos ("where does it go")

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` P4): the existing
`examples/` are integration demos (discord/slack/telegram/express/nextjs). During capability
evaluation the consumer agent instead learned from test files (with mock noise) because no example
answered "what can it do". Four small runnable demos cover the evaluation path that was actually
walked:

## What

1. `examples/capabilities/openai-compatible-gateway/` — `baseURL` + non-OpenAI slug (pairs with
   DOCS-014 quickstart / DOCS-016 JSDoc).
2. `examples/capabilities/decision-agent/` — tool-only decision agent (router/orchestrator
   pattern), including decision extraction and the summary-call caveat (supersedes the caveat once
   CORE-011 lands).
3. `examples/capabilities/streaming/` — `runStream` consumption.
4. `examples/capabilities/stateless-turns/` — repeated decisions via `clearHistory` (doubles as
   history-lifetime documentation; switches to `retainHistory: false` once CORE-014 lands).

Wire into `examples-typecheck` CI (already exists) so they cannot drift from the API.

## Test Plan

- All four compile under the existing `examples-typecheck` CI job; each runs against a scripted or
  real provider (documented per demo).

## User Execution Test Scenarios

- Prereq: clone + provider key (or gateway key).
- Steps: run each demo per its README.
- Expected: each completes demonstrating its capability without code edits.
- Evidence: **PASS (live, all four, 2026-07-03).** `examples/capabilities/` track created
  (workspace globs added to pnpm-workspace.yaml + package.json `workspaces`, kept aligned —
  the workspace-drift scan caught the initial mismatch). All four wired into the existing
  `examples-typecheck` CI path (workspace members with `typecheck` scripts; `pnpm
examples:typecheck` green). Live runs per each demo's README, no code edits:
  (1) openai-compatible-gateway — env-driven `GATEWAY_BASE_URL`/`KEY`/`MODEL`; ran against a
  real OpenAI-compatible endpoint with the non-OpenAI slug `qwen-plus`, streamed a full answer
  (825 chars). (2) decision-agent — CORE-011 `allowToolOnlyCompletion` router (the backlog's
  summary-call caveat is gone as predicted): two real tickets routed `billing` / `bugs`, the
  decision typed via SDK-009 inference, `retainHistory:false` per ticket. (3) streaming —
  plain for-await deltas AND the CORE-015 structured variant returning
  `{ title: "TypeScript for Large Codebases", score: 8.5 }` as the generator return value.
  (4) stateless-turns — printed real per-call input tokens: isolated `16, 17, 16` vs default
  `16, 28, 40` (the backlog's clearHistory framing upgraded to CORE-014 `retainHistory:false`
  as it anticipated). llms.txt examples line split into capabilities vs integrations (25 links
  resolve); 43 harness scans green. Demos are products by design — the correct home per the
  Library Neutrality Rule.

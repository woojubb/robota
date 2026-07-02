---
title: 'EX-001: examples/capabilities track — gateway, decision-agent, streaming, stateless-turns demos'
status: todo
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
- Evidence: _to fill at implementation._

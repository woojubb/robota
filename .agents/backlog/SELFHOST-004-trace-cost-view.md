---
title: 'SELFHOST-004: first-class run tracing + token/cost budgeting surfaced in TUI/GUI'
status: todo
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-plugin, packages/agent-session-analytics, packages/agent-transport-tui, packages/agent-transport-gui
depends_on: []
---

# Run tracing + cost budgeting view

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). Robota
has usage/analytics plugins + `dag-cost`, but no first-class **trace + cost view** — competitors surface run
tracing and token/cost accounting in their UI.

## What

A first-class run **trace** (LLM calls, tool calls, handoffs, guardrail results) + **token/cost budgeting**
(per-run/session accounting, optional budget caps), surfaced in `agent-transport-tui` and
`agent-transport-gui`. Reuse the `usage`/`execution-analytics` plugins + `agent-session-analytics` + `dag-cost`
as the data sources; add the aggregation + the view. LLM cost/spend caps are financial risk, not DoS — treat
as first-class.

## Prior Art

OpenAI Agents SDK built-in tracing dashboard (LLM/tool/handoff/guardrail, https://openai.github.io/openai-agents-python/);
Google ADK event/state step inspector Web UI (https://google.github.io/adk-docs/); aider token-budgeted repo
map (https://aider.chat/docs/repomap.html); Cursor tool-call budgets / Max mode (https://cursor.com/docs).

## Test Plan

Unit tests for trace aggregation + cost accounting; a functional test that a budget cap halts/warns; TUI/GUI
behavior test rendering the trace/cost view. User Execution Test Scenarios for the view + a cap being hit.

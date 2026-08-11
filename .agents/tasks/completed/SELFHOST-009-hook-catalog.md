---
title: 'SELFHOST-009: rich lifecycle hook catalog (named events + PreToolUse security gate)'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-core
depends_on: []
---

# Lifecycle hook catalog

## Outcome (DONE 2026-07-19)

Shipped: documented lifecycle hook catalog — 16 named events with `packages/agent-core/docs/HOOK-CATALOG.md` as
the SSOT, PreToolUse security gate, plus a drift-guard scan keeping code and catalog in sync (later hardened by
HARNESS-031, PR #1247). Spec: `.agents/spec-docs/done/SELFHOST-009-hook-catalog.md` (GATE-COMPLETE 2026-07-19,
TC-01..07 incl. agent-run TC-07).

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has hooks in `agent-core`; the gap vs the strongest exemplar is **breadth + a documented
catalog** of named lifecycle events, including a PreToolUse security gate.

## What

Extend `agent-core`'s hooks with a documented **catalog** of named lifecycle events (session start/stop,
pre/post tool use, pre/post model call, permission decision, error, subagent spawn, …) and a first-class
**PreToolUse security gate**. Neutral mechanism; the events are the product surface for user-defined hooks.

## Prior Art

Claude Code 30 hook lifecycle events + PreToolUse security gate (https://code.claude.com/docs/); Microsoft
Agent Framework middleware/filters (https://learn.microsoft.com/en-us/agent-framework/overview/); CrewAI
callbacks (https://docs.crewai.com/).

## Test Plan

Unit tests that each catalogued event fires at the right point; a functional test that a PreToolUse hook can
block a tool call; a doc/scan check that the catalog is documented. Architecture Review confirms this extends
the existing hooks engine (no new tier).

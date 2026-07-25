---
title: 'SELFHOST-008: durable project + semantic long-term memory (auto-curated, cross-session)'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-core, packages/agent-cli, apps/agent-app
depends_on: []
---

# Durable + semantic long-term memory

## Outcome (DONE 2026-07-19 — neutral library + surface wiring complete)

Shipped across the epic's slices, all spec-gated in `.agents/spec-docs/done/`: parent
`SELFHOST-008-durable-semantic-memory.md` (P1 port + fs reference adapter, GATE-COMPLETE 2026-07-18, PR #1218)
plus P1R async remediation, P2 live auto-capture, P3 per-turn recall, P4 `SemanticMemoryStore` decorator
(PRs #1220/#1221/#1223/#1224), and P6 surface wiring (completed 2026-07-19). Port:
`packages/agent-framework/src/memory/types.ts`. The consciously-deferred concrete embedder/vector backend is
split out as [SELFHOST-008-P5](../SELFHOST-008-P5-concrete-semantic-backend.md) (stays open).

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has a `/memory` command; the advertised edge is memory that **grows with you** —
auto-curated project/workspace memory + optional semantic recall across sessions.

## What

A neutral **memory port** in `agent-core` (write/recall/curate) with a pluggable store adapter behind DIP
(semantic/vector optional); auto-capture + curation **policy** and any memory _content_ live in
`agent-cli`/`apps/agent-app` per library-neutrality (no memory content in `packages/`).

## Prior Art

Hermes agent-curated memory + cross-session FTS recall + user modeling
(https://hermes-agent.nousresearch.com/docs/); Windsurf workspace-scoped auto-generated Memories persisted
across sessions (https://docs.windsurf.com/windsurf/cascade/memories); Mastra working + semantic memory
(https://mastra.ai/); OpenAI Agents SDK Sessions with pluggable backends
(https://openai.github.io/openai-agents-python/).

## Test Plan

Unit tests for the memory port + a reference adapter; a functional test for cross-session recall; neutrality
guard (no content in libs). Architecture Review sets the port/adapter boundary + where curation policy lives.

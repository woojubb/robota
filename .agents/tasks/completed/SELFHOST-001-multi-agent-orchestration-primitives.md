---
title: 'SELFHOST-001: first-class multi-agent orchestration primitives (sequential/parallel/hierarchical/handoff/group-chat)'
status: done
completed: 2026-07-17
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework
depends_on: []
---

# Multi-agent orchestration primitives

## Outcome (DONE 2026-07-17)

Shipped: all five orchestration primitives (sequential / parallel / hierarchical / handoff / group-chat) as
neutral composition helpers in `packages/agent-framework/src/orchestration/`, composing over `SubagentManager`.
Spec: `.agents/spec-docs/done/SELFHOST-001-multi-agent-orchestration-primitives.md` (GATE-COMPLETE 2026-07-17;
landing PRs #1192, #1194, #1195). Verified 2026-07-24: orchestration test suite green (5 files, 30 tests).

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). The
single most-commonly-touted advantage across the landscape and Robota's biggest gap: Robota has subagents
(`agent-subagent-runner`) but no first-class **named orchestration patterns**.

## What

Provide a small set of neutral orchestration primitives the framework can compose: **sequential**,
**parallel/concurrent**, **hierarchical/manager-delegation**, **handoff (control transfer)**, and
**group-chat**. Contracts + events in `agent-core`; assembly/wiring in `agent-framework`; consider surfacing
as `dag-*` node/orchestration patterns where a graph fits. Neutral mechanism only — no persona/domain content
in libraries.

## Prior Art

CrewAI Processes (sequential/hierarchical) + manager delegation (https://docs.crewai.com/); OpenAI Agents SDK
handoffs (transfer loop ownership, https://openai.github.io/openai-agents-python/); Google ADK workflow agents
(Sequential/Parallel/Loop vs LLM transfer, https://google.github.io/adk-docs/agents/workflow-agents/);
Microsoft Agent Framework (sequential/concurrent/handoff/group-chat/Magentic-One,
https://learn.microsoft.com/en-us/agent-framework/overview/).

## Test Plan

Contract + unit tests per primitive; a framework functional test composing a manager→worker handoff; ensure
library-neutrality (no domain content) and the interface-runtime purity guard pass. Architecture Review must
confirm the layer split (contracts in agent-core, assembly in agent-framework) before implementation.

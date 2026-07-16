---
title: 'SELFHOST-005: structured output + parallel guardrails (input/output validation, fail-fast)'
status: todo
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework
depends_on: []
---

# Guardrails + structured output

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). A
table-stakes reliability feature: validate agent input/output against typed contracts and fail fast.

## What

A **guardrail contract** + engine hook in `agent-core` (the existing hooks/permissions engine is the natural
host): register input/output guardrails that run (optionally in parallel) and can fail-fast, plus typed
**structured output** validation for tool/model results. Neutral mechanism; specific guardrail policies belong
to the consumer/surface.

## Prior Art

OpenAI Agents SDK parallel guardrails + Pydantic-validated tool schemas, fail-fast
(https://openai.github.io/openai-agents-python/); CrewAI guardrails (https://docs.crewai.com/); Mastra eval
metrics gating (faithfulness/relevance/toxicity, https://mastra.ai/).

## Test Plan

Unit tests for the guardrail contract + engine hook (pass, fail-fast, parallel); a functional test that a
failing output guardrail blocks the turn; structured-output validation tests. Architecture Review confirms the
guardrail hook composes with existing permissions/hooks without a new tier.

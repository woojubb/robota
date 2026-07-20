---
title: 'SELFHOST-011: evals-as-code harness for SDK users (gate CI)'
status: done
completed: 2026-07-19
created: 2026-07-16
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

# Evals-as-code (product surface)

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md).
Differentiator. Robota has an internal `.agents/evals` harness, but no **product** eval surface for SDK users to
define and run agent evals that gate their CI.

## What

An `agent-framework` SDK surface + a `robota` CLI command to define evals-as-code (metrics over agent runs)
and run them, exit-coded to gate CI. Reuse the internal evals concepts; expose them as a neutral, consumer-facing
API (no domain content in libs).

## Prior Art

Mastra evals-as-code in CI, gate deploys (faithfulness/relevance/toxicity, https://mastra.ai/); Google ADK
build/evaluate/deploy toolkit (https://google.github.io/adk-docs/); OpenAI traces feeding eval tools
(https://openai.github.io/openai-agents-python/).

## Test Plan

Unit tests for the eval-definition API + a runner; a functional test that a failing eval returns non-zero;
example eval in `examples/`. Architecture Review confirms the SDK surface lives in agent-framework, CLI command
in agent-cli.

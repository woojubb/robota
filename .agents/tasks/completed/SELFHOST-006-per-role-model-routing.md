---
title: 'SELFHOST-006: per-role model routing + provider fallback (planner vs editor model)'
status: done
completed: 2026-07-18
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-provider-defaults, packages/agent-framework, packages/agent-core
depends_on: []
---

# Per-role model routing + fallback

## Outcome (DONE 2026-07-18 — v1: subagent path)

Shipped: per-role model routing + provider fallback policy in
`packages/agent-framework/src/routing/role-model-routing.ts` over the provider DIP (v1 scope: subagent path).
Spec: `.agents/spec-docs/done/SELFHOST-006-per-role-model-routing.md` (GATE-IMPLEMENT+VERIFY+COMPLETE
2026-07-18, TC-01..05; landing PR #1214). Verified 2026-07-24: `role-model-routing.test.ts` green.

Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md) / [VISION.md](../../VISION.md). Robota
has provider DIP + a `/model` command, but no **per-role routing** (e.g. a strong planner model + a cheaper
editor model) or **provider fallback** on failure.

## What

A routing policy (in `agent-framework`, over the existing provider DIP) that selects a model **per role/phase**
(planner vs editor vs reviewer) and **falls back** to an alternate provider/model on error or budget. Contract
for role→model mapping in `agent-core`/`agent-interface-*`; the default-set aggregator
(`agent-provider-defaults`) is the natural composition point. No provider secrets or domain content in the
policy mechanism.

## Prior Art

aider architect(planner)/editor two-model mode (https://aider.chat/docs/config/options.html); model-agnostic
provider swap in Google ADK / Mastra / MS Agent Framework
(https://google.github.io/adk-docs/ , https://learn.microsoft.com/en-us/agent-framework/overview/); Cursor Max
mode budget selection (https://cursor.com/docs).

## Test Plan

Unit tests for the routing policy (role→model selection) + fallback-on-error; a functional test that a planner
turn and an editor turn resolve to different configured models and that a provider failure falls back.
Architecture Review confirms this rides the existing provider DIP (no new provider coupling).

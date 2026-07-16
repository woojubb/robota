---
title: 'SELFHOST-006: per-role model routing + provider fallback (planner vs editor model)'
status: todo
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-provider-defaults, packages/agent-framework, packages/agent-core
depends_on: []
---

# Per-role model routing + fallback

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

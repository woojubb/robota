---
title: 'NEUT-006: mechanical floor for model-facing prose in packages/* (prompt-inventory ratchet)'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: scripts/harness, .agents/harness.config.json
depends_on: []
---

# NEUT-006: prompt-prose neutrality floor

## Problem (audit .design/audits/2026-07-24-neutrality-prompt-audit.md, gap #6)

The five neutrality scans guard dependencies/identifiers/corpus files — NOT model-facing prose. Plan-mode,
guardrails, computer-use, built-in agents, and tool descriptions rest on convention alone; nothing stops
the next "helpful default prompt" landing in a library layer unseen (this is exactly how the 2026-03 debt
accumulated).

## What

`scan-prompt-prose.mjs`: detect model-facing instruction prose in `packages/*/src` (heuristics: multi-word
imperative strings in known prompt sinks — `description:`, `systemPrompt`/`systemMessage` literals,
template exports; refine against the audit's 17-file inventory) with a FROZEN BASELINE ratchet (file-size
/ spec-surface precedent): current prompt-bearing files frozen at their prose fingerprint; NEW prose in a
non-baselined library file FAILS; baseline shrinks as NEUT-001..005 land. Config data (sinks, baseline)
in `harness.config.json`. Also add the role-vocabulary assertion from the delta audit (`planner|editor|
reviewer` + model IDs appear only in `agent-provider-defaults`).

## Test Plan

Red-before-green fixtures (new prose in core ⇒ FAIL; baselined file unchanged ⇒ pass; shrink ⇒ tighten
notice); register in run-all-scans.

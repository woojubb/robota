---
title: 'NEUT-006: mechanical floor for model-facing prose in packages/* (prompt-inventory ratchet)'
status: done
created: 2026-07-25
completed: 2026-07-25
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

## Outcome (2026-07-25)

Shipped `scripts/harness/scan-prompt-prose.mjs` — a repo-agnostic engine (sink-literal extraction with
template/interpolation + literal-array `[...].join()` handling, word-count+imperative-marker prose
heuristic, whitespace-normalized sha256 fingerprints) with a FROZEN per-file baseline ratchet
(`--write-baseline`, exact scan-file-size precedent: non-baselined prose FAILS, frozen fingerprints may
shrink but never grow/reword without an explicit same-PR regen, shrink prints a tighten notice, deleted
entries print stale notices). All policy DATA (scan roots, sink patterns, prose heuristic,
chartered-opinion exemptions [`agent-preset`], baseline path, role vocabulary) lives under the
`promptProse` key of `.agents/harness.config.json`.

- Baseline at adoption: **32 file(s), 50 frozen prose literal(s)** across agent-tools builtins,
  built-in-agents / subagent-prompts / session-naming / goal-prompts / agent-tool (framework),
  platform-shell + JSON-schema retry (core), command/CLI instruction templates, playground code
  templates, and dag-cli NL-authoring prompts — a superset of the audit's ~17-file inventory (the
  audit tiers excluded dag-cli/playground).
- Role-vocab assertion (audit delta): a `planner|editor|reviewer` role term AND a concrete model id in
  the SAME library file is flagged outside `packages/agent-provider-defaults/` — conjunction verified
  to match exactly one file on the current tree (the chartered defaults table).
- Red-before-green: no-baseline run FAILED on the current tree (50 findings); injected prose in
  `agent-core` FAILED (`new-prose-in-library-file`); injected role→model binding in `agent-core`
  FAILED (`role-model-binding-outside-defaults`); with baseline the tree passes. 22 unit tests on the
  exported pure evaluator; registered as `prompt-prose` in `run-all-scans.mjs`.

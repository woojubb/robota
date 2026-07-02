---
title: 'DOCS-018: root README restructure — library identity first, layered package table, resolve the dag scope contradiction'
status: todo
created: 2026-07-03
priority: medium
urgency: later
area: README.md
depends_on: []
---

# README: sell the library, then the app

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` §3.2, P3): the root README
leads with "CLI — AI Coding Assistant" + screenshot, the architecture diagram tops out at
`agent-cli`, and 41 packages are listed flat — so an evaluating consumer (agent or human) concludes
"this is a coding-CLI product, over-engineered for embedding" (misunderstanding O2, which required a
user correction to reverse). Verified contradiction: README:108 still says the DAG product line
"moved to a separate robota-dag repository" while `packages/` contains 15 `dag-*` packages
(WORKFLOW-001 absorbed the engine back — the sentence is stale).

## What

1. First sentence: robota is a composable TypeScript library collection for building agents;
   `agent-cli` (AI coding assistant) is a reference app built from it. CLI quickstart moves below.
2. Layered package table: "Start here (embedding): core / provider / tools" → "app assembly:
   framework / session / plugin" → "products & transports: cli / command / transport-\*" (the
   3-package minimal set surfaced first — same fact source as DOCS-017's llms.txt, one owner).
3. Fix the stale DAG sentence to match reality (engine absorbed; state what dag-\* is today).
4. Gateway/OpenAI-compatible quickstart variant placement is owned by DOCS-014 (item 1); the
   compile-error fix by DOCS-015 — cross-reference, don't duplicate.

## Test Plan

- Docs-only; README renders correctly; statements verified against the tree (no new contradictions);
  DOCS-015's example typecheck gate covers any code blocks touched.

## User Execution Test Scenarios

- Prereq: a fresh evaluator (agent session or person) given only the root README's first screen.
- Steps: ask "what is robota and what is the minimal package set to embed it?"
- Expected: answers "library collection / core+provider+tools", not "a coding CLI product".
- Evidence: _to fill at implementation._

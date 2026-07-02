---
title: 'DOCS-017: root llms.txt — a consumer-agent map (identity, minimal set, capability matrix, behavior contracts)'
status: todo
created: 2026-07-03
priority: medium
urgency: soon
area: repository root, content/
depends_on: []
---

# llms.txt for agent consumers

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` §2, P2): library adoption
evaluation is now performed by AI agents (the report itself is evidence — its two misunderstandings
each cost a user correction). The agent's first probes (`ls packages/` → 41 flat packages; README
quickstarts) produced both misunderstandings. A root `llms.txt` (llmstxt.org convention) replaces
that error-prone walk. Note the report's observation: `AGENTS.md`/`CLAUDE.md` are contributor
harness docs — consumer agents deliberately skip them, so the consumer map must be a separate file.

## What

Root `llms.txt` containing (per the report's outline):

1. Identity one-liner: a composable TypeScript library collection for building agents; `agent-cli`
   is a reference app built from it (kills misunderstanding O2).
2. Minimal embedding set: `agent-core + agent-provider + agent-tools`; everything else optional.
3. Capability matrix with source/example links: OpenAI-compatible gateway via `baseURL`, streaming,
   zod runtime tool validation, step control (`maxExecutionRounds`).
4. Behavior contracts: run concurrency, history lifetime, destroy semantics, tool-only-turn summary
   call (sync with CORE-011..014 outcomes as they land).
5. Canonical example + type-declaration file paths.

Keep it a thin index — facts live in their owner docs (no duplication); a harness check that the
listed paths exist (same class as the done-evidence path check) prevents rot.

## Test Plan

- File exists at root, referenced paths resolve (mechanical check); content review against the
  misunderstanding scenarios O1/O2.

## User Execution Test Scenarios

- Prereq: a fresh agent session pointed at the repo (or npm tarball) with the task "evaluate robota
  for embedded orchestration via a gateway".
- Steps: let it read llms.txt first; record its conclusions.
- Expected: no O1/O2-class misunderstanding — it identifies the library-collection identity, the
  3-package minimal set, and gateway support without user correction.
- Evidence: _to fill at implementation._

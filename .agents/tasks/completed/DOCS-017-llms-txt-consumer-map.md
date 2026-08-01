---
title: 'DOCS-017: root llms.txt — a consumer-agent map (identity, minimal set, capability matrix, behavior contracts)'
status: done
completed: 2026-07-03
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
- Evidence: **PASS (live fresh-agent run, 2026-07-03).** Root `llms.txt` written per the report's
  outline as a thin index (identity one-liner killing O2; 3-package minimal embedding set;
  capability matrix with owner-doc links incl. gateway-via-baseURL, structured output,
  maxExecutionRounds; behavior contracts linking SPEC/guide sections from CORE-011/012 +
  DOCS-014; type/example paths — facts stay in owner docs, no duplication). Rot prevention
  mechanized: new `llms-txt` harness scan (`scripts/harness/check-llms-txt.mjs`) fails on a
  missing file or any dangling repo-relative markdown link (21 links resolve; registered in
  run-all-scans — 43 scans total — + verify-change test selection + 4 unit tests). User
  Execution: a FRESH agent session (no prior repo knowledge, AGENTS.md/CLAUDE.md forbidden)
  was given the report's exact task class ("evaluate robota for embedded orchestration via
  Vercel AI Gateway with anthropic/\* slugs") with llms.txt as the entry point — its recorded
  conclusions: identity = "not a coding-agent product... library collection; agent-cli is
  merely a reference app" (no O2), minimal set = the exact 3 packages, gateway = "yes —
  protocol client, not a vendor lock" citing the baseURL JSDoc + providers guide (no O1),
  verdict "Suitable". Zero misunderstandings, zero user corrections. Side discovery filed
  separately: HARNESS-021 (background-workspace-conformance unit tests 5/5 failing on clean
  develop — pre-existing, out of this item's scope).

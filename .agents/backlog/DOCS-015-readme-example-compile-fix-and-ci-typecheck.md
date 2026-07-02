---
title: 'DOCS-015: README quickstart does not compile (defaultModel.systemMessage) — fix + CI typecheck for doc examples'
status: todo
created: 2026-07-03
priority: high
urgency: now
area: README.md, packages/agent-core/README.md, scripts/harness
depends_on: []
---

# README examples must compile — fix + gate

Discoverability report (`.design/feedback-discoverability-2026-07-03.md` §3.3, source-verified):
the Core quickstart in the root `README.md` (:48) and `packages/agent-core/README.md` (:25, and its
options table :94) puts `systemMessage` INSIDE `defaultModel` — but `IAgentConfig.defaultModel`
(`interfaces/agent.ts:79-87`) has no such field; `systemMessage` is top-level (:96). Under strict TS
the first example a consumer meets is an excess-property compile error. The report's key insight:
agents (and burned humans) trust `.d.ts` > tests > source > README precisely because of this class
of drift — the front-door example confirming the distrust is the worst possible surface for it.

## What

1. Fix the three occurrences (move `systemMessage` to the top level).
2. **Mechanize (the real deliverable)**: typecheck README/content TypeScript code blocks in CI or
   `harness:scan` (twoslash / typescript-docs-verifier / a small extract-and-tsc script — decide at
   implementation). New drift between doc examples and types must fail loudly, like any other
   enumerated-snapshot drift (same lesson class as common-mistakes #73/#74).
3. Sweep: run the checker over ALL existing README/content code blocks and fix what it finds — not
   just the reported one.

## Test Plan

- The doc-example typecheck gate passes on the fixed tree; a deliberately broken snippet fails it.
- `pnpm harness:scan` (or CI job) green; count of swept/fixed blocks recorded.

## User Execution Test Scenarios

- Prereq: fresh consumer project with strict TS.
- Steps: paste the root README Core quickstart verbatim; compile.
- Expected: compiles and runs without edits.
- Evidence: _to fill at implementation._

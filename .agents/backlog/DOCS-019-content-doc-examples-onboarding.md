---
title: 'DOCS-019: onboard content/ guide code blocks (517 blocks, 70 files) to the doc-examples typecheck gate'
status: todo
created: 2026-07-03
priority: medium
urgency: later
area: content/, scripts/harness
depends_on: []
---

# content/ doc-example onboarding

Split from DOCS-015 (recorded, not silent): the doc-examples typecheck gate
(`scripts/harness/check-doc-examples.mjs`, in `pnpm harness:scan`) covers the root README + all
packages/x/README.md (49 blocks green, 5 explicit fragments). The content/ guide corpus is 10x
larger — **517 ts blocks across 70 files** — and onboarding it (fixing/marking every failure) is its
own effort with the mechanism already built.

## What

1. Extend `listReadmeFiles()` (or a corpus option) to include `content/**/*.md` — possibly per-batch
   (guide/ first) so each PR stays reviewable.
2. Triage every failing block: fix real API drift; mark intentional fragments with
   `<!-- doc-example-skip: <reason> -->`; batch per directory with suites green.
3. Also honor DOCS-014/016 outcomes so fixed examples document the CURRENT contracts, not the old.

## Test Plan

- Per batch: `node scripts/harness/check-doc-examples.mjs` exit 0 with the batch included; final:
  full content/ in scope, `pnpm harness:scan` green.

## User Execution Test Scenarios

- Prereq: fresh strict-TS consumer project.
- Steps: paste 3 randomly-chosen content/ guide examples; compile.
- Expected: all compile without edits.
- Evidence: _to fill at implementation._

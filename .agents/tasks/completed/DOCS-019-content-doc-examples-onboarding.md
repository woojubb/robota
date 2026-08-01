---
title: 'DOCS-019: onboard content/ guide code blocks (517 blocks, 70 files) to the doc-examples typecheck gate'
status: done
completed: 2026-07-03
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
- Evidence: **PASS (2026-07-03).** Scan corpus extended to content/ (root pages + guide +
  getting-started + examples + integrations + development + plugins); excluded by design and
  documented in the scan header: content/v2.0.0 (preserved historical docs), content/ko
  (translations), content/images. Onboarding surfaced the DOCS-015 masking pattern again — 5
  syntax-error fragments hid 132 semantic errors; triage (parallelized across the two file-set
  owners) fixed the real drift and kept skips sparse: final `doc-examples scan passed (150 blocks
typechecked, 28 marked skip)` (was 52/5 before onboarding — 98 content blocks compile, 23
  content skips all with reasons: external consumer deps (ws/hono/e2b/@anthropic-ai/sdk), v2-API
  contrast blocks in migration.md, signature listings, local-module imports). Real API drift
  fixed included: `systemMessage` mis-nested under `defaultModel` across 8+ pages, stale
  `session.compact()` → `compactContext()`, plugin constructors missing required strategy
  options, `createSubagentSession` rewritten to the current `ISubagentOptions` shape,
  `tool_end` payload field drift, missing provider-subpath imports. DOCS-014/016 outcomes
  honored (current contracts documented). 43 harness scans + harness suite (221) + docs:build
  green. User Execution (fresh strict consumer): 3 deterministically-random-picked examples
  (`guide/sdk.md#9`, `examples/one-shot-query.md#1`, `guide/providers.md#4`) compiled UNEDITED
  against the BUILT package `.d.ts` surfaces with `strict: true` — exit 0. Side item: the
  original external maxTokens bug report (dropped at repo root) relocated to
  `.design/bug-report-maxtokens-2026-07-03.md` with a CORE-016 resolution note appended.

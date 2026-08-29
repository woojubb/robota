---
title: 'HARNESS-123: ten comment-stripping sites, no owner, and two scans a comment is currently holding up'
issue: https://github.com/woojubb/robota/issues/2258
status: done
created: 2026-08-26
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-123: no owner for comment stripping, and two scans a comment vouches for

## Problem

A harness scan that regex-matches file contents cannot tell code from a comment. Issue #2258 records
four measured effects of that on one scan and leaves two questions open: **which scans fail
permissive, and whether there should be one owner.** Both are answered below by measurement.

## Which scans a comment is holding up — measured, not classified

At `a4873073c`: `blankComments` (offset- and newline-preserving) applied to every tracked
`.ts`/`.tsx` under `packages/*/src`, then the full scan suite, then a verdict diff.

```
2479 files walked · 1683 rewritten · byte length preserved on every one
145 scans run     ·    4 flipped green → red    ·  141 unchanged
```

**Two of the four are the defect:**

- **`orphan-exports`** — asks whether an internal export has a consumer. Two passed because a **doc
  comment** names them: `PluginContainerBlock` (a sibling file's header sentence) and
  `IME_SUBMIT_DEFER_MS` (a test's doc comment, in a test that hard-codes the value instead of using
  the constant). Filed as issue #2362.
- **`spec-public-surface`** — asks whether every name in a SPEC public-API table appears in `src`.
  `createTestInteractiveSession` passes on one occurrence: a comment recording that the symbol
  **moved to another package**. Filed as issue #2361. Issue #2258 describes prose that describes a
  guard holding the guard up; this is prose describing a **removal** holding up the thing removed.

**Two are not, and saying so is half the result:**

- **`no-fallback`** requires an annotation on each silent fallback — and an annotation **is a
  comment**. Blanking deletes the artifact it checks for. Correct behaviour.
- **`product-identity`** is a shrink-ratchet; it reported `agent-framework 51 → 34`, which is its
  job. Not a defect — but worth carrying: **a third of what that ratchet counts is not code**, which
  matters to anyone sizing a reduction against its baseline.

**The limit, stated because the number invites over-reading.** This finds scans a comment is
_currently_ holding up **on this tree**. A scan permissive in principle with nothing presently hiding
behind a comment does not flip. **Four is a lower bound on exposure, not a complete audit** — the
honest claim is "four scans are being held up by comment text today".

## The sites, counted

```
scripts/harness/check-functional-coverage.mjs:30          stripComments                   JS   block → ' '     exported, 0 importers
scripts/harness/check-regression-red-proof.mjs:471        stripComments                   JS   block → ''      local
scripts/harness/scan-guard-scope-fail-closed.mjs:870      stripJsComments                 JS   block → ''      exported, 0 importers
scripts/harness/scan-harness-script-import-safety.mjs:174 (unnamed, inline)               JS   block → ''      —
scripts/harness/scan-session-artifact-neutrality.mjs:37   stripComments                   JS   block → ''      local
scripts/harness/scan-vitest-resource-ceiling.mjs:93       stripComments                   JS   block → ' '     local
scripts/harness/check-agent-server-boundary.mjs:468       stripComments                   JS   block → ' '     local
scripts/harness/check-agent-server-boundary.mjs:453       stripCommentsAndStringLiterals  JS   + blanks strings local
scripts/harness/scan-hook-enforcement-reachable.mjs:150   blankComments                   JS   blanked in place, OFFSETS PRESERVED, 0 importers
scripts/harness/scan-ci-base-history.mjs:92               stripComments                   YAML drops '#' lines  exported, 5 importers
```

**Ten sites. Four distinct JS behaviours, plus a YAML one.** And the name `stripComments` covers both
a YAML line-dropper and several JS strippers — **the YAML one is the only shared implementation in
the repository (5 importers); every JS one has none.** The single correct JS implementation,
`blankComments`, is imported by nothing.

## Direction

**Not a new mechanism.** `blankComments` already exists and is already right — it preserves offsets
and newlines and handles regex literals, which is what `lineOffsets`-style indexing needs. What is
missing is a decision, and the measurement makes it a three-way one rather than two:

```
no-fallback      the comment IS the artifact checked   →  must NOT strip
141 scans        verdict unchanged either way          →  immaterial
2 scans          a comment is holding them up          →  must strip
```

So "one helper applied everywhere" breaks `no-fallback`, and "a local copy per site" is the present
state. What survives is: **one owner, called at the read sites, and every non-calling site named with
its reason.**

`no-fallback` is that list's first entry and its reason already exists. **The reasons are not
decoration.** Without them the next reader asks "why does this one scan not strip", and **a
re-answered question is answered differently** — which is how ten sites and four behaviours happen.

**Safety evidence for consolidating:** 1683 files were rewritten and 141 of 145 verdicts did not
move. That is what makes making the ten one a low-risk change rather than a hopeful one.

**String-literal blanking is a separate question** and is deliberately not folded in.
`check-agent-server-boundary.mjs:453` already does it, under a different name, with nothing recorded
about why the others do not. Whether a literal should be able to satisfy a check is its own decision.

## Test Plan

- The chosen owner is called at each stripping read site, and every site that does not call it is
  named in one list with its reason. **The list is the deliverable**, not just the calls.
- **`no-fallback` still fires on an unannotated fallback**, proving the exemption is honoured rather
  than forgotten.
- A fixture per behaviour the ten sites currently differ on: offsets preserved, newlines preserved, a
  regex literal containing `//` left intact.
- **Positive control:** a scan that must still see comment text still sees it, so a suite proving the
  strippers were unified cannot pass against a workspace that strips everywhere.
- Re-running the global experiment above yields **0** verdict flips, which is the property this item
  exists to establish.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item changes how developer-host scans read source text; `robota`'s behaviour, output and exit
codes are identical before and after. The verification that matters is the global re-run in the Test
Plan, which is not a product scenario a user can run.

**This reason does not expire** — it is a property of what the item delivers, not of an undecided
disposition.

## Terminal disposition

Done: delivered by merged PR #2363 (`f1fdf8d0ddd6f83c86677535306fea919e1f5bc5`). The broader issue
#2258 remains open and is not closed by this delivery record.

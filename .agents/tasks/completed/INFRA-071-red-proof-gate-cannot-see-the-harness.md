---
title: 'INFRA-071: the accidental-green gate cannot see the layer where accidental greens keep happening'
status: done
completed: 2026-07-31
priority: high
urgency: now
type: INFRA
area: scripts/harness
created: 2026-07-31
depends_on: []
---

# INFRA-071 — the red-proof gate is scoped to `packages/*/src` and nothing else

## Problem

`check-regression-red-proof.mjs` (HARNESS-041) exists to catch a regression test that passes on the
unfixed code. It decides what to examine with one expression:

```js
export function pkgOf(filePath) {
  const m = filePath.match(/^((?:packages|apps)\/[^/]+)\/src\//);
  return m ? m[1] : null;
}
```

Everything outside `packages/*/src/` and `apps/*/src/` is invisible to it. That excludes:

- `.claude/hooks/**` — every guard in the repository
- `scripts/harness/**` and `scripts/harness/__tests__/**` — every scan, every floor, and their tests

## What it has cost

Measured over PRs #1525–#1530 (2026-07-30): twelve successful CI runs, **zero verdicts**. Nine
skipped with `no same-package (source+test) pair`, one with `range has no fix: commit`, two produced
no verdict line at all.

In that same window human review caught **four accidental-green tests**, every one of them in
`scripts/harness/__tests__/`:

| Test                              | What it asserted                      | What it missed                            |
| --------------------------------- | ------------------------------------- | ----------------------------------------- |
| `hooks-have-execution-coverage`   | a hook name appears in a test file    | a name in a COMMENT counted as coverage   |
| `remaining-hooks-run` (unset var) | exit 0 on a missing path and a `.txt` | never reached the `set -u` crash it named |
| `remaining-hooks-run` (extension) | exit 0 for a `.txt`                   | never reached the extension filter        |
| `remaining-hooks-run` (two hooks) | guard clauses returned 0              | never ran the hooks' actual logic         |

The mechanical floor for exactly this defect was blind to all four. They were found by a reviewer
reading the diff, which is the thing the floor is supposed to make unnecessary.

This also blocks INFRA-046: the promotion criterion is N code-PRs with zero false-positive verdicts,
and a gate that never produces a verdict can accumulate that tally forever without meaning anything.

## Proposed direction

Widen the subject to the layers that carry guards, and pair them the way they are actually written:

- `scripts/harness/x.mjs` ↔ `scripts/harness/__tests__/x.test.mjs`
- `.claude/hooks/x.sh` ↔ any test that executes it (`hooks-have-execution-coverage` already computes
  that relation and could export it)

The reverse-apply mechanism should carry over unchanged for `.mjs`; a `.sh` hook is not transformed
by vitest, so reverse-applying its hunks and re-running the executing test is the same operation.

## Design note (2026-07-31) — the obvious widening does not work

Read the gate's mechanism before planning the change, and one thing it says is easy to miss:
widening `pkgOf` to include `scripts/harness/` would catch **none of the four misses**.

All four have `.claude/hooks/*.sh` as the code under test; only their TESTS live in
`scripts/harness/__tests__/`. A `scripts/harness`-only widening pairs harness source with harness
tests, and those four have no harness source at all — for
`hooks-have-execution-coverage` the logic under test is inside the test file itself.

So the change has two parts, and the second is the one that matters:

1. **Grouping.** `classifyChanges` groups by `pkgOf`, so a `.sh` under `.claude/hooks/` and its test
   under `scripts/harness/__tests__/` currently land in different groups and never form a pair. They
   have to map to one subject.
2. **`importsReversedFile`.** The C3 check walks relative imports from the test and asks whether any
   reversed source is in that graph. A `.sh` is never in a module graph, so every hook pair would
   return `INCONCLUSIVE` — a SKIP by another name. The relation that does hold is "this test SPAWNS
   this hook", which `hooks-have-execution-coverage` already computes and could export.

The reverse-apply half needs no change: bash reads a hook at spawn time, so reversing its hunks and
re-running the executing test is the same operation vitest already performs for `src`.

This is correctness-critical code in a gate, so it is worth doing deliberately rather than quickly.

## What the implementation found (2026-07-31)

**The gate had never once reverse-applied anything.** `reverseApply` read the diff through a helper
that `.trim()`s its output, so the patch reached `git apply -R` without its final newline and git
rejected it as corrupt — "patch broke at line 60". Twelve CI runs, zero verdicts: the widening is
what made the line reachable, and reaching it is what exposed this. It was never a `packages/*/src`
problem versus a hooks problem — the mutation step was broken for every subject alike.

**The third acceptance bullet below was written on a false premise, and the replay disproves it.**
Both candidate ranges were replayed through the widened gate in a detached worktree:

| Range                  | Verdict        | Case that fails when the fix is reversed          |
| ---------------------- | -------------- | ------------------------------------------------- |
| `2ac10f251..b1f46acf3` | `red-proof-ok` | `post-tool-format > … outside the formatted set`  |
| `b1f46acf3..c08e0dbd6` | `red-proof-ok` | `post-tool-format > … project directory is unset` |

Those verdicts are CORRECT. Each range's changed test file does contain a case that fails on the
reversed hook, so the range is red-proved whatever else is true of its other cases.

The four misses are a **different defect class**, and reverse-apply cannot reach them by
construction:

- `hooks-have-execution-coverage` — the logic under test lives inside the test file. There is no
  source to reverse.
- the two guard-clause cases — the hooks they name (`spec-first-gate`, `task-tracking`) were not
  changed in the range, so there is no pair.
- the extension-filter case — the hook did change, and the case does fail reversed, but for the
  wrong reason (the reversed hook crashes before the filter). The gate reads pass/fail; it cannot
  read WHY.

Reverse-apply answers "does this test depend on the fix?". All four failed a different question:
"does this test REACH the behavior it names?" — the third of PROC-003's three questions, at
case granularity. That needs a mutation/coverage floor, not this one. Filed as INFRA-072 rather than
stretched into this item, because widening this gate to cover it would mean judging a test by its
reason for failing, which pass/fail output does not carry.

## Done when

- A `fix:` PR touching `scripts/harness/**` with a changed test produces a verdict, not a SKIP —
  proven on a real pair from this window.
- A `fix:` PR touching `.claude/hooks/**` with a test that executes the hook produces a verdict,
  proven the same way.
- ~~At least one of the four accidental-greens listed above is replayed through the widened gate and
  comes back `ACCIDENTAL_GREEN`.~~ **Retracted on measurement — see above.** Replaced by: the hook
  subject reaches `ACCIDENTAL_GREEN` through the orchestrator, pinned by a fixture, and the four
  misses are re-filed under the floor that can actually catch them.
- The SKIP reasons remain distinguishable from a clean verdict in the log, so the next promotion
  audit can tell "examined and clean" from "examined nothing".

## Completion (2026-07-31) — reconciled 2026-08-04

Landed before this file was reconciled, and verified against the tree rather than assumed:
`check-regression-red-proof.mjs` exports `HOOK_SUBJECT = '.claude/hooks'` and
`HARNESS_SUBJECT = 'scripts/harness'`, and `pkgOf` returns them — `.claude/hooks/branch-guard.sh` →
`.claude/hooks`, `scripts/harness/scan-x.mjs` → `scripts/harness`, `packages/agent-core/src/x.ts` →
`packages/agent-core`. Its docstring cites this item by number, and `scripts/harness/__tests__/
check-regression-red-proof.test.mjs` passes 51 cases.

One decision the widening forced is recorded in the code: a `.md` under the harness subject returns
`null`, because reversing a document and re-running a test proves nothing, and a docs-and-test range
would otherwise manufacture a pair whose only possible verdict is noise. Under a `packages/*/src`
scope that could not arise; under a whole directory it can.

The follow-on it exposed — one verdict for an aggregate, so a genuine red proof in one pair excused an
accidental green in another — was filed and resolved separately as
[INFRA-073](completed/INFRA-073-one-verdict-for-an-aggregate.md).

No GitHub issue was ever registered for this item; it predates that practice becoming routine.

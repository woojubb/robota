---
title: 'INFRA-071: the accidental-green gate cannot see the layer where accidental greens keep happening'
status: todo
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

## Done when

- A `fix:` PR touching `scripts/harness/**` with a changed test produces a verdict, not a SKIP —
  proven on a real pair from this window.
- A `fix:` PR touching `.claude/hooks/**` with a test that executes the hook produces a verdict,
  proven the same way.
- At least one of the four accidental-greens listed above is replayed through the widened gate and
  comes back `ACCIDENTAL_GREEN` — the floor must be shown catching what review caught, not merely
  running.
- The SKIP reasons remain distinguishable from a clean verdict in the log, so the next promotion
  audit can tell "examined and clean" from "examined nothing".

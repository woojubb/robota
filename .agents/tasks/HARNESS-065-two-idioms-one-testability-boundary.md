---
title: 'HARNESS-065: the harness scripts speak two idioms, and the fork is exactly the line between testable and untestable'
status: todo
created: 2026-08-02
priority: high
urgency: next
area: scripts/harness
depends_on: []
---

# HARNESS-065: an interrupted migration, and a guard that fails silently green

## Problem

The 120 harness scripts use two mutually exclusive idioms for two separate things, and neither fork
is a decision anyone made — both look like migrations that stopped partway.

The consequence is not stylistic. One fork decides whether a script can be imported and tested; the
other fails in the direction that makes a check silently not run.

## Evidence

From an external read-only investigation (2026-08-02). Every count below was re-run in this repo
before this Task was written and **all seven reproduced exactly**.

| Measurement                                          | Count                   |
| ---------------------------------------------------- | ----------------------- |
| Total `scripts/harness/*.mjs`                        | 120                     |
| Have `export function` (designed to be imported)     | 110                     |
| Use `process.exit()` and never `process.exitCode`    | 37                      |
| Use `process.exitCode`                               | 60                      |
| Use both                                             | 0                       |
| **Export a function AND call `process.exit()`**      | **36**                  |
| Guard: `` import.meta.url === `file://${argv[1]}` `` | 40                      |
| Guard: `path.resolve(process.argv[1]) === …`         | 28                      |
| No direct-execution guard at all                     | 52 (42 of which export) |
| Test files under `__tests__/`                        | 137                     |
| Scripts with no matching test file                   | **24 / 120**            |

**The exit fork (36).** A script that exports a function is saying "import me and test me". A script
that calls `process.exit()` can kill the process at import time. Sixty scripts have already moved to
`process.exitCode = 1; return;`, and **zero** mix the two — so this is a migration that stopped at
about 60%, not a considered split.

**The guard fork (40 vs 28), and why the weaker one is dangerous.** The `file://` comparison breaks
when the path contains characters a URL must escape — a space, a non-ASCII character, `#`. It breaks
in the worst direction: the guard evaluates false, `main()` never runs, and the script **exits 0**.
A check that did not execute is indistinguishable from a check that passed. That is the same failure
mode as HARNESS-064's vacuity, arriving through a different door. CI runner paths are currently safe,
so this is latent rather than live — parallel worktrees or a local path with non-ASCII characters
would surface it.

**The 24 untested scripts.** 137 tests is substantial coverage; the question is which 24 are outside
it, because an untested check is the leading candidate for a vacuous one.

## Why this is foundational (or not)

**LOCAL, but it blocks something foundational.** No single script here is wrong. The value of fixing
it is that once every script is importable, "every harness script has a test" becomes a mechanically
enforceable statement — which is the check that would stop the 24 from becoming 30, and which
HARNESS-064 needs in order to reach every finder.

## Direction

Mechanical, low-risk, and in this order:

1. Convert the 36 `export`+`process.exit()` scripts to `process.exitCode`, matching the 60 that
   already are.
2. Convert the 40 `file://` guards to the `path.resolve` form, matching the 28 that already are.
3. Decide what the 52 scripts with NO guard are — a script that exports and never guards runs its
   `main()` on import, which is the same hazard from the other side.
4. Only then: add the coverage meta-check that pins the untested count so it cannot grow.

Step 4 is the point; steps 1–3 are what make it possible. Landing 4 without 1–3 would just record
the number.

## Test Plan

- **Required red-first regression:** importing each converted script must not terminate the process.
  A script still calling `process.exit()` must FAIL the new check — prove it fails first.
- Red-first: a guard built from a path containing a space must still run `main()` when executed
  directly. Against the `file://` form this FAILS by exiting 0 with no output, which is the whole
  point — assert on the effect, not the exit code alone.
- The untested-script count is frozen and may fall, never rise.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** No user-facing surface changes; the subject is the repo's own tooling.

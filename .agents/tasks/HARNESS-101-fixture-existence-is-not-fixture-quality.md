---
title: 'HARNESS-101: the fixture floor proves a harness check HAS a test, not that the test can fail — a green-path-only fixture satisfies the floor and leaves the check unfalsifiable, which is the defect the floor was built to close'
status: todo
created: 2026-08-16
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-101: the second stage of the fixture floor

Split out of HARNESS-098 so its remaining half has an owner rather than living as an open note inside
a closed item. HARNESS-098 delivered stage 1; this is stage 2, and it was named as not-delivered
there rather than implied.

## Problem

`scripts/harness/check-fixture-floor.mjs` asserts that every `check-*/scan-*.mjs` has a same-named
fixture test. That is exactly decidable, and it is a real floor — but **fixture existence is not
fixture quality.** A test asserting only the green path satisfies it and leaves the check
unfalsifiable, which is the condition HARNESS-098 exists to eliminate.

## Why the obvious approach was rejected

Detecting the red direction **textually** — a heuristic over assertion shapes in the test file — was
considered during HARNESS-098 and rejected on the grounds that it would itself be a check that cannot
reliably fail. Shipping it would be this item's own defect, committed by the file closing it. That
reasoning stands and should not be re-derived; what is needed is a mechanism that does not rest on
reading assertions.

## Direction

The repository already owns a red-proof mechanism: `check-regression-red-proof.mjs` (HARNESS-041)
reverse-applies a `fix:` PR's own source hunks and requires a genuine assertion failure. It is scoped
to same-package source+test pairs, so it does not reach `scripts/harness`, which is why the floor
exists rather than an extension of it.

**The first question is whether that scoping can be widened** to treat a harness check and its
fixture as such a pair. If it can, this item is an extension rather than a new mechanism, and the red
proof becomes an execution result rather than a textual guess. If it cannot, say concretely why
before proposing anything else.

## Test Plan

- Prove-it-fails: a fixture asserting only the green path must make the mechanism FAIL; adding a
  red-direction case must make it PASS.
- The mechanism must not itself be satisfiable by a green-path-only fixture — state how that is
  prevented, since the item is about exactly that failure.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not applicable — harness change with no runnable user-facing behaviour. The prove-it-fails pair is
the evidence.

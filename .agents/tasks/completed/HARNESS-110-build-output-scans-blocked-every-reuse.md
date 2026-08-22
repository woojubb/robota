---
title: 'HARNESS-110: declaring the build-output scans ineligible made a plain scan run unreusable'
status: done
created: 2026-08-19
completed: 2026-08-19
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-110: the receipt could not serve the command the item was filed about

## The gap

HARNESS-109 gave the scan suite a receipt, and declared `dist` and `build-contracts` ineligible in
BOTH directions — a set containing either neither reused a receipt nor wrote one — because `dist/` is
ignored and a tree hash cannot speak for it.

That reasoning is right about what a receipt may ASSERT and wrong about what a run may DO. A plain
`pnpm harness:scan` includes both scans, so it was permanently unreusable — and a plain
`pnpm harness:scan` run twice on one tree is the exact waste HARNESS-109 was filed about. The
mechanism served `pre-push` and not the hand-run that caused it.

Owner's framing, 2026-08-19, and it is the correct one: **`dist/` is ignored output. It is not branch
content**, so a receipt keyed on branch content owes it nothing.

## Measured

The two scans stat files; they do not build anything.

| Run                                 | Before           | After                   |
| ----------------------------------- | ---------------- | ----------------------- |
| `pnpm harness:scan`, first          | full suite, 22s  | full suite, 22s         |
| `pnpm harness:scan`, unchanged tree | full suite again | **1s** — 2 scans re-run |

## Direction

- Exclude the two from the receipt's IDENTITY, and re-run them on every invocation.
- Side effect worth having: a full local run and CI's `--skip dist --skip build-contracts` then
  produce the same identity and share one receipt, because what the receipt asserts is the result of
  the scans a tree hash can speak for, and that set is identical in both.
- Do not judge the adoption ratchet over the re-run handful: it binds over the set that ran, and that
  set is two scans by construction.

## Done when

- [x] A plain `pnpm harness:scan` is reusable — measured 22s then 1s on an unchanged tree.
- [x] The build-output scans still report on a reused run — `✓ build-contracts`, `✓ dist` in the
      1s run, so a stale build is still surfaced.
- [x] Both call sites share one receipt — the full set and the CI mirror both report
      `127 scans not re-run: identical tree scanned at …` from the same receipt.
- [x] A set that is NOTHING but build-output scans claims no saving —
      `scripts/harness/__tests__/scan-receipt.test.mjs`, "does not claim a saving when the set is
      nothing but those scans".

## Result

Delivered. `TREE_EXTERNAL_SCANS` keeps its name and its list; what changed is its meaning — from
"makes the run ineligible" to "is never asserted by a receipt, and always runs". 17 tests, with the
refusing branches still outnumbering the reusing ones.

What did NOT change: a receipt still asserts only the scans a tree hash can speak for, a dirty tree
still refuses in both directions, and `--write-adoption-baseline` still forces an observed pass.

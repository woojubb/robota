---
title: 'HARNESS-109: the scan suite leaves no receipt, and one untracked file blocks the receipt that exists'
status: todo
created: 2026-08-19
priority: high
urgency: soon
area: scripts/harness
depends_on: []
---

# HARNESS-109: an identical tree is verified over and over, and nothing notices

## The gap

`verification-receipt.mjs` exists precisely so that an identical tree is not re-verified: it keys a
receipt on `headCommit` + `headTree` + base + toolchain + lockfile + owner fingerprint, `verify-like-ci`
writes it, and `pre-push` reuses it. Two holes make it miss the most repeated run in an agent session.

**1. `pnpm harness:scan` neither writes nor reads a receipt.** The scan suite is the single most
re-run local command — `pre-push` runs it on every push through `CI_SCANS_JOB_MIRROR`, the CI `scans`
job runs it again, and an agent runs it by hand whenever it wants a signal. Nothing connects those
runs. Scanning the same tree three times is indistinguishable, to the harness, from scanning three
different trees.

**2. One untracked file makes the whole clone receipt-ineligible.** `isCleanTree()` is false whenever
`git status --porcelain --untracked-files=all` shows anything outside `AUTO_GENERATED_CHURN`, and
`.claude/settings.local.json` — written by the agent harness itself, present in every agent clone,
absent from `.gitignore` — is outside it. So `readVerificationReceipt()` returns `null` for the whole
session and **every** push re-runs the full gate.

This is the second instance of the failure class the module's own header records: the lessons churn
left `readVerificationReceipt()` at `null` across five consecutive PASS runs. That instance was closed
by naming the two files. Naming files one at a time is what made a second instance possible.

## Measured — 2026-08-19, this clone

```
realDirtyLines: ["?? .claude/settings.local.json"]
isCleanTree:    false
receipt:        null
```

The only dirt in the tree is a file the agent harness writes and no one commits. Session evidence:
resolving a three-line JSON conflict on PR #1860 ran the full 126-scan suite twice on trees whose
scanned content was identical, and both runs were themselves redundant with the scan suite the push
gate then ran a third time. No mechanism could see any of it.

## Direction

- **Ignore what the harness writes.** `.claude/settings.local.json` belongs in `.gitignore` — it is
  per-clone agent configuration, never committed. This restores receipt eligibility for every agent
  clone, and is independently measurable through `isCleanTree()` before and after.
- **Prefer a rule over a list.** The receipt's cleanliness test should treat harness-owned, never-
  committed paths as a declared CLASS, so the next such file does not silently re-open the hole.
  `AUTO_GENERATED_CHURN` stays for tracked files that regenerate.
- **Give the scan suite the receipt treatment.** `run-all-scans.mjs` writes a receipt on a clean pass
  and reuses one whose identity matches, so `pre-push`'s scans mirror and a hand-run share one result.
  The failure mode to design against is a receipt reused when the tree differs: identity must cover
  what the suite actually reads, and an unreadable or partial receipt must re-run, never pass.

## Not in scope

Running a diff-scoped SUBSET of the suite. `pre-push.mjs` records the deliberate decision that the
whole suite runs because it is cheap relative to CI; this item removes the DUPLICATE run, it does not
reopen that trade-off.

## Done when

- [ ] `isCleanTree()` is true in a fresh agent clone whose only dirt is harness-written config, proved
      by a test that plants the file and asserts eligibility.
- [ ] A second `pnpm harness:scan` on an unchanged clean tree does not re-run the suite, and says so.
- [ ] `pre-push` reuses a hand-run's scan receipt, and a changed tree provably does not — red-first.
- [ ] A receipt that is missing, malformed, or written by a different toolchain re-runs the suite.

## Result

Pending.

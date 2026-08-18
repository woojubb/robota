---
title: 'HARNESS-109: the scan suite leaves no receipt, and one untracked file blocks the receipt that exists'
status: done
created: 2026-08-19
completed: 2026-08-19
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

- [x] `isCleanTree()` is true in a fresh agent clone whose only dirt is harness-written config, proved
      by a test that plants the file and asserts eligibility —
      `scripts/harness/__tests__/scan-receipt.test.mjs`, "a per-clone harness config file does not
      make the tree dirty", which also asserts the exemption stays narrow.
- [x] A second `pnpm harness:scan` on an unchanged clean tree does not re-run the suite, and says so —
      measured below: `126 scans not re-run: identical tree scanned at …`, 14s to 0s.
- [x] `pre-push` reuses a hand-run's scan receipt, and a changed tree provably does not — the reuse
      runs inside `CI_SCANS_JOB_MIRROR` in `scripts/harness/pre-push.mjs`, which invokes the same
      command; refusal on a touched tracked file is measured below.
- [x] A receipt that is missing, malformed, or written by a different toolchain re-runs the suite —
      `scripts/harness/__tests__/scan-receipt.test.mjs`, describe block "every refusing direction"
      (absent, malformed, failed, wrong schema version, wrong tree, wrong node/pnpm/lockfile).

## Result

Delivered in two commits. The ignore rule landed first (#1873) because it was measurable on its own;
this record closes with the mechanism.

**The measurement that started it.** `isCleanTree()` was false in this clone for one reason — an
untracked file the agent harness writes into every clone — so `readVerificationReceipt()` returned
null for whole sessions and every push re-ran the full gate. `isCleanTree()` false → true.

**The class, not the filename.** The first fix named `settings.local.json`, which is exactly how the
lessons-churn instance was closed, and naming files one at a time is what let a second instance
happen. The ignore rule is now `.claude/*.local.json` — the tool's own convention for a per-clone
file — with the shared `.claude/settings.json` still tracked, asserted by a test that plants both in
a temporary repository.

**The mechanism.** `scripts/harness/scan-receipt.mjs` gives the scan suite what
`verification-receipt.mjs` already gave `verify-like-ci`. Identity is `headTree` plus the toolchain:
the tree hash is the content of every tracked file, so any change to a scan, a baseline, or a source
file it reads invalidates the receipt.

Measured end to end on the CI mirror set (`--skip dist --skip build-contracts`, the set `pre-push`
repeats):

| Run                             | Result                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| first, clean tree               | 123 passed / 3 skipped, receipt written, **14s**                   |
| second, unchanged tree          | `126 scans not re-run: identical tree scanned at …`, **0s**        |
| third, one tracked file touched | `scan receipt not reused: working tree is not clean:  M AGENTS.md` |

**What a tree hash cannot speak for.** `dist` and `build-contracts` compare `dist/` against `src/`,
and `dist/` is ignored, so two runs under one tree hash can legitimately disagree. Both are named in
`TREE_EXTERNAL_SCANS` and a set containing either is ineligible in BOTH directions — it neither
reuses nor writes — asserted even in the case where identity, receipt and cleanliness all agree.

**The direction it fails in.** A missing, malformed, failed, or wrong-identity receipt re-runs the
suite; no path turns an unreadable receipt into a pass. The decision is one pure function so each
refusing branch is a test rather than a claim: 14 tests, and the refusing branches outnumber the
reusing ones, which is the correct ratio for a mechanism that can only fail in one direction.

**Not delivered, deliberately:** a diff-scoped subset of the suite. `scripts/harness/pre-push.mjs`
records the decision that the whole suite runs because it is cheap relative to CI. This removed the
DUPLICATE run; it did not reopen that trade-off.

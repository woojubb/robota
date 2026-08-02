---
title: 'HARNESS-064: vacuity was measured once and never again — 30 of 76 scans could not fail, and nothing tracks whether that number moves'
status: in-progress
created: 2026-08-02
priority: critical
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-064: a one-off measurement is not a gate

## Problem

On 2026-07-26 this repo measured that **~30 of its 76 scans were vacuous** — registered, green on
every CI run, and incapable of failing. That number was written down once. Nothing re-measures it, so
the repo cannot tell whether the figure has improved, held, or grown since.

A vacuous check is worse than a missing one. A missing check is visibly absent; a vacuous check
returns green every run and buys confidence it did not earn.

## Evidence

Raised by an external read-only investigation of this repo (2026-08-02, by a downstream consumer
evaluating the harness for adoption). Its counts were re-verified here before this Task was written.

- `.agents/memory/MEMORY.md:16`, this repo's own record: _"~30 of the 76-scan suite is measured
  vacuous (2026-07-26)"_.
- `.agents/memory/check-validity-two-axes.md` catalogues instances: `agent-server-boundary`
  _"satisfied vacuously by a never-called import"_; the `security audit` job that only scanned
  dependencies; a release workflow that reported success uploading a macOS artefact nobody had opened
  in four months.
- `.agents/memory/harness-diet-audit.md` names `scan-file-size` and `check-document-authority` as
  _"registered gates that can NEVER fail"_ and `compat-node18` as running Node 22.
- `scripts/harness/governed-tree.mjs:5` and `scan-guard-scope-fail-closed.mjs:15` record the sharpest
  instance: _"**30 of the 50 registered finders returned an empty finding list** — i.e. reported a
  pass over ground they never covered."_

**The timing is the finding.** The diet audit completed on 2026-07-24 with "dead/vacuous scan
removal" marked done. The 30/76 measurement is dated **2026-07-26** — two days later. The diet
removed the scripts that were dead; it did not remove the ones that were alive and checking nothing.

**Verified for this Task:** 31 of 120 harness scripts reference `governed-tree`. The guard exists and
its adoption is partial; which of the 30 originally-affected finders now call `requireGovernedTree`
was not established and is part of the work.

## Why this is foundational (or not)

**FOUNDATIONAL.** Every other harness item is judged by whether a check catches it. If ~40% of the
suite cannot fail, the suite's green is not evidence about the tree — and no individual scan fix can
establish that, because the property is about the suite.

The repo already owns the mechanism: `scan-guard-scope-fail-closed` measures exactly this — point a
finder at ground it does not cover and see whether it throws or reports a pass. The engine exists and
is run once by hand rather than on every change.

## Direction

Turn the one-off measurement into a repeatable one. Concretely, the shape the investigation
suggested and this repo's own tooling already supports: run every registered finder against an empty
temporary root and assert it FAILS (or explicitly declares the root out of scope) rather than
returning `[]`. Freeze the surviving count as a ratchet that may fall and never rise, the way
`file-size` and `spec-public-surface` already work.

Two things to decide, not assumed here:

- Whether a scan with genuinely nothing to check should throw, or declare itself not-applicable. The
  second is honest but becomes a dodge if it is easy to write; `requireGovernedTree` already chose
  the first for its own domain.
- Whether the ratchet counts scans or finders. The 30/76 and 30/50 figures count different things.

Do NOT close this by re-running the measurement and recording a new number. A number in a memory file
is what this Task exists because of.

## Test Plan

- **Required red-first regression:** a deliberately vacuous scan (one that returns `[]` unconditionally)
  added to the registry must FAIL the new check. Prove it fails before the check is trusted.
- Red-first: a scan that legitimately covers its ground must PASS, so the check is not a blanket
  refusal.
- The frozen count must fall, not rise, on a change that fixes a vacuous scan — assert the ratchet
  direction.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** This changes no user-facing product surface; it changes what the repo's own CI
can conclude. The verification is the red-first regression above.

## Progress

### The premise was wrong for the axis that has a mechanism — corrected before acting

This Task says the 30/76 measurement "was written down once" and "nothing re-measures it". For the
**guard-scope axis that is false**, and finding out cost less than building a duplicate would have.

`scripts/harness/scan-guard-scope-fail-closed.mjs` already:

- DERIVES the finder set from the registration list and the source, so a new scan cannot be added
  without being classified (rule 1);
- EXECUTES every pinned guard against a root lacking its governed tree and requires a throw or a
  finding — a behavioural assertion, not a source-pattern match (rule 2);
- RE-EXECUTES every ledger entry's recorded verdict on every run and fails if it drifted (rule 3),
  written because the ledger went stale within the hour it was first authored.

Today it reports **45 guards proven fail-closed by execution, 4 measured vacuous and recorded
unfixed, 14 fail-closed but unpinned**. The 30/76 figure is stale in both terms: the suite is 87
scans now, and that number came from the OTHER axis in `check-validity-two-axes` — _does it check
the right thing_ — which that memory itself records as a ceiling nothing catches.

### What was actually missing: the ledger had no ceiling

Rules 1–3 make every finder answer for itself and keep the ledger honest. None of them bounds its
SIZE. `PENDING_CLASSIFICATION.length` appeared only in the pass message — so a new scan could be
classified `pending` forever, and a new `vacuous` entry (a LIVE instance of the audited defect) could
be added with a paragraph explaining it, and nothing would object.

**Rule 4: the debt may shrink and never grow.** Two ceilings, frozen at the measured 4 vacuous and 14
unpinned, in `scripts/harness/guard-ledger-ceilings.json`. They are separate because they mean
different things — a vacuous entry is a live defect, an unpinned one is milder debt — and a rise in
either fails with the instruction that fits it: _fix the guard, do not record it_ versus _pin it in
`MANDATORY_TREE_GUARDS`_. A FALL also fails, demanding a re-freeze in the same change, because an
unlocked gain is a licence to grow back.

Red-proved four ways: a lowered `vacuous` ceiling fires with the right message, a lowered `unpinned`
one likewise, a raised ceiling demands the re-freeze, and an ABSENT ceiling is a finding rather than a
pass. Plus reachability — the first draft of those cases called the helper directly, so deleting the
line wiring it into `findGuardScopeFindings` failed nothing; there is now a case that runs the scan
as the CLI does over a deliberately wrong ceiling file and requires exit 1.

### Remaining

- **The second axis is still uncovered**, and this does not change that: whether a check examines the
  RIGHT thing is not decidable by executing it against an empty root. `check-validity-two-axes`
  records it as a ceiling; nothing here lifts it.
- **The 14 unpinned guards.** Each is unpinned for a recorded reason — some fail closed only
  INCIDENTALLY, via a stale-allowlist assertion rather than a deliberate check, so pinning them
  as-is would certify a property they do not hold. Lowering that 14 means fixing those guards, one at
  a time, each with its own measurement.
- **The 4 vacuous entries** are live instances, owned by HARNESS-052 and INFRA-060.

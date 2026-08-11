---
title: 'HARNESS-064: vacuity was measured once and never again — 30 of 76 scans could not fail, and nothing tracks whether that number moves'
status: done
completed: 2026-08-04
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

## The premise is out of date, and the correction is the finding (2026-08-04)

This item says the 30/76 measurement "was written down once" and that "nothing re-measures it". Both
were true when it was filed. Neither is true now, and it was checked rather than assumed:

`scan-guard-scope-fail-closed` is REGISTERED and runs on every `pnpm harness:scan`. It does not read
a recorded number — it points each pinned finder at a root without its governed tree and observes
whether the finder throws or reports a pass. Today it reports **53 guards proven fail-closed BY
EXECUTION, 4 measured vacuous and recorded with their reasons, 14 that fail closed but are not
pinned**. So the engine this item asks for exists and is continuous.

**What is actually missing is narrower, and it is the part the count hides.** The pinned set is a
HAND-KEPT list. A guard outside it can be vacuous and nothing notices, which is the same defect one
level up: the population is maintained by a person, so the measurement is only as complete as the last
edit to the list. The 14 unpinned guards are the visible edge of that; the invisible edge is the next
guard someone adds without a row.

That is the same shape [HARNESS-071](completed/HARNESS-071-loops-with-no-progress-escape.md) fixed for
loops, and the fix has the same form: derive the population from the registry rather than from a list,
and hold the vacuous count as a ratchet so it can fall and never rise.

**Landed here:** the engine now declares what it examined (`::examined:: 53 pinned guards`), which
feeds the suite-wide invariant in
[HARNESS-057](HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md) — an unearned zero from
this scan would now fail the suite rather than pass quietly. That does not close this item; it makes
the number this item is about visible to the runner every time it runs.

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

### Review round 1 (PR #1604)

One SHOULD, upheld: the reachability case mutated the real checked-in `guard-ledger-ceilings.json`
and restored it in a `finally`, so a kill between the two — this scan's own docstring records a
harness scan dying mid-run with no output — would leave the working tree holding a corrupted ceiling.
An under-count is the direction a ratchet must never fail in, and every other path in the file already
takes a `root` for exactly that reason.

The loader is now parametrised (`GUARD_LEDGER_CEILINGS`) and the case points the spawned CLI at a
temp copy, touching nothing tracked. That seam is itself a way past the ratchet, and cannot be closed
by removing it — an argument would be the same hole spelled differently — so a run against anything
but the frozen file now DECLARES that on both the pass and the fail path, and a case pins the
declaration. The wiring red-proof was re-run against the change: deleting the line that calls
`ledgerCeilingFindings` from `findGuardScopeFindings` still fails the reachability case.

## Closed 2026-08-04 — every part of it already holds, and each was verified by execution

This item asked for three things. All three are in force, and none of them was taken on trust; the
commands and their output are below so the next reader can recount rather than believe.

**1. The measurement repeats.** `scan-guard-scope-fail-closed` is registered and runs on every
`pnpm harness:scan`. It does not read a recorded number — it points each pinned finder at a root
without its governed tree and observes whether the finder throws or reports a pass, and it
RE-EXECUTES every ledger entry's recorded verdict on every run. Today: **53 guards proven fail-closed
by execution, 4 measured vacuous, 14 that fail closed but are not pinned.**

**2. The population is derived, not hand-kept.** This was the item's sharpest claim and it is wrong:
rule 1 of that scan derives the finder set from the registration list and the source, and a scan
registered without a table entry FAILS. A guard cannot be added without answering for its behaviour,
and a table entry naming a scan that no longer exists is itself a finding.

**3. The number is ratcheted.** `scripts/harness/guard-ledger-ceilings.json` freezes
`{ "vacuous": 4, "unpinned": 14 }`. Exercised in all four directions:

```
at ceiling   : []
vacuous ROSE : 4 entr(y/ies), up from a frozen 3. A new vacuous entry is a NEW live instance …
vacuous FELL : 4 entr(y/ies), DOWN from a frozen 5. Re-freeze it in this same change …
unfrozen     : [ 'ledger-ceiling:vacuous', 'ledger-ceiling:unpinned' ]
```

So the 30-of-76 figure this item was filed about cannot silently move: a new vacuous guard raises the
count and fails the suite, and a repaired one lowers it and demands a re-freeze in the same change.

**What this item added, since it was not merely closed as stale.** The scan now declares
`::examined:: 53 pinned guards`, so the number it audits is visible to the runner on every run and an
unearned zero from it would fail the suite — the invariant of
[HARNESS-057](HARNESS-057-a-scan-must-report-the-size-of-what-it-examined.md) applied to the scan that
measures vacuity.

**The honest residue.** The 14 unpinned guards fail closed but are not proven so by execution, and
their ceiling holds the count rather than the property. Reducing that number is ordinary debt work
under HARNESS-052, not a gap in the mechanism this item asked for.

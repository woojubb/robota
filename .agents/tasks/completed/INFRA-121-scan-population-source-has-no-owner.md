---
title: 'INFRA-121: a scan enumerated through the git index, so a file not yet staged was invisible'
status: done
created: 2026-08-20
completed: 2026-08-20
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-121: enumerate the tree the author is asking about, not the index

## Objective

Issue #1908. A harness scan decided for itself where its population came from. Eight enumerated
through `git ls-files`, so their coverage depended on the git index; the rest read the filesystem, so
theirs did not. Nothing owned the choice and nothing stated it.

## The false green, measured

Review of pull request #1886, round four. A newly written task document carried a citation
`reference-kind-qualified` refuses:

| when             | verdict                                                      |
| ---------------- | ------------------------------------------------------------ |
| before `git add` | **passed**, printing `::examined:: 2936 tracked document(s)` |
| after staging    | failed, naming that file and that line                       |

The suite ran, declared its size, and reported success on a tree whose newest file it could not see —
at exactly the moment a writer checks their own work. A human found it a review round later.

That is worse than a scan with no coverage at all. A missing scan is visibly missing; this one printed
a number and a pass. `enforcement-architecture.md` says silence is not success, and a size silently
conditional on the index is that same defect wearing a measurement.

## The recurrence answered itself, twice

Issue #1908 notes that pull request #1886 adds a sixth `ls-files` scan while the issue is open. By the
time this item was picked up there were **eight** — because two of them are mine, written earlier in
this same session, both copying the pattern from the scan beside them. A per-scan choice nobody owns
is copied by whoever writes the next one, and neither of us knew there was a choice being made.

## Approach

One owner, `enumerate-files.mjs`, enumerating tracked files AND untracked files git does not ignore.
Both are part of the tree the author is asking about.

An ignored file stays out, and that exclusion needs no per-run disclosure: `.gitignore` declares it
in one place for every reader. Measured before deciding: the ignored set for `*.md` alone is 3,021
paths, almost all under `node_modules`. A four-digit number printed every run is a disclosure readers
learn to skip, which is how a real one would be missed.

## Plan

- [x] TC-01: an unstaged new file is enumerated.
- [x] TC-02: the old behaviour is shown to miss exactly that file.
- [x] TC-03: a path git reports twice is not double-counted.
- [x] TC-04: the order is stable, so a finding list does not churn between runs.
- [x] TC-05: the size is asserted exactly, and again after a second run.
- [x] TC-06: five scans converted — `reference-kind-qualified`, `hook-override-declarations`,
      `aggregate-naming`, `preset-projection` and their shared shape.
- [x] TC-07: `pnpm harness:scan` green (129 passed, 2 skipped).
- [x] TC-08: `pnpm harness:pre-push` green, and CI clean on PR #1923.

## Not converted, and why

`check-done-evidence` and `scan-legacy-typescript` still enumerate directly. Both carry documented
subtleties the owner does not yet model — the first answers about an arbitrary `root` under a git
hook, the second deliberately counts index entries whose files are ABSENT from disk, which is a
different question from "what should I judge". Converting them without modelling those would trade a
visible gap for a silent one. Left as they are, named here rather than left for a reader to discover.

The `createDistFreeTree` half of issue #1908 — the CI-mirror worktree copies untracked files but never
stages them, so `ls-files` scans are blind inside the tree built for fidelity — is also untouched.
With the owner reading untracked files directly, that staging step is no longer what stands between
those scans and the truth; whether it should still happen is a question about the mirror's fidelity
rather than about this blindness.

## Test Plan

The `run` seam is injected, so each case states its own git output. A case that shelled out to real
git would be asserting the state of this repository at the moment it ran.

Red-proofed against the REAL tree rather than a fixture, because the incident was a real-tree one:
writing an unstaged document with a bare `#1234` and running the scan produces the finding with the
owner in place, and a pass without it — the measured before/after, reproduced in both directions.

## Progress

### 2026-08-20

Filed as issue #1908 from review of pull request #1886, as FOUNDATIONAL.

One process note worth keeping. The red-proof revert did NOT take: the module is new and therefore
untracked, so `git checkout --` silently did nothing and the probe stayed in the file. The scan
afterwards still passed, because the probe only affects a case the passing run does not exercise.
Checking that the REVERT was applied — not just that the probe was — is what caught it; the same
lesson as a red-proof that reports green, in the other direction.

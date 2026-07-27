---
title: 'HARNESS-057: a scan must report the size of the subject it examined, and zero must fail'
status: todo
priority: high
urgency: now
type: INFRA
area: scripts/harness
created: 2026-07-28
# HARNESS-053 and HARNESS-056 are the completed/open halves this builds on; HARNESS-052 is the
# sweep that found the class. Listed as lineage, not as blockers — 053 is already in completed/.
depends_on: [HARNESS-052, HARNESS-056]
---

# HARNESS-057 — one invariant that subsumes three recurring classes

## Problem

The most-repeated defect in this repository is a check reporting success over work it never did.
Measured across the audit: **at least twelve occurrences**, two full sweeps (HARNESS-052 passes 1
and 2), and thirty registered finders that returned `[]` over an absent subject. `run-all-scans.mjs`
was touched 53 times in 10 days; `scan-guard-scope-fail-closed.mjs` — the guard written to catch
vacuous guards — 27 times, and it **shipped containing three of its own defects, two masking each
other**.

Three symptoms have been chased separately, and they are the same thing:

| Symptom                                                      | Instance                                    |
| ------------------------------------------------------------ | ------------------------------------------- |
| Fail-open over an absent tree                                | `dist/ present on all 0 package(s)`, exit 0 |
| A SKIP renders as `✓` and counts toward "all N scans passed" | `HARNESS-056`                               |
| Depth-1 walk claims "all" over a subset                      | seven guards, "all 75 packages" over 55     |

Each was repaired instance by instance. Nothing prevents the next one, because nothing asks the
question they all answer wrongly: **how much did you look at?**

## Proposed direction

Every scan reports the size of the subject it examined, and the runner fails the suite when a scan
reports `0` without declaring an expected-empty reason.

That single invariant catches all three: an absent tree reports 0, a skip reports 0, and a depth-1
walk reports a count that visibly disagrees with the workspace — which is the thing a reader can
check at a glance and a follow-up scan can check mechanically.

Two design constraints, both learned the expensive way here:

- **Declaring an expected-empty subject must be possible**, or scans with legitimately empty
  subjects go red and the suite gets skipped. An expected-empty declaration is a reviewable line,
  not a silent default.
- **The declaration needs anti-rot scoped to the real tree.** An anti-rot that fires over a scratch
  fixture reports every entry stale on every test — this has now happened twice in this repository,
  once in `scan-workflow-permissions` and once in `scan-doc-folder-status-agreement`, both times
  fixed by scoping to the real subject.

## Done when

- A scan that examines nothing fails the suite, proven RED by pointing a real scan at an empty root.
- A scan with a declared expected-empty subject passes, proven GREEN, and its declaration fails when
  the subject stops being empty.
- The suite summary distinguishes examined-and-clean from examined-nothing, so `all N scans passed`
  stops being weaker than it reads.
- Applied to every registered scan, not to a sample — the count reported must be checkable against
  the workspace for the enumerating ones.

---
title: 'INFRA-122: one qualifier governs a phrase, and the check only saw the first member'
status: done
completed: 2026-08-21
created: 2026-08-20
priority: medium
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-122: a range, a list and an `A and B` pair are one reference phrase

## Objective

Issue #1913. `reference-kind-qualified` models a reference as one qualifying token immediately before
one number, so every member of a range after the first reads as bare — a form this repository writes
routinely and a reader resolves without opening anything.

## Measured, and wider than the issue described

The issue names ranges. Reproduced on the current model, and two more forms have the same defect:

| line                                         | before                   | after |
| -------------------------------------------- | ------------------------ | ----- |
| `Measured over PRs #1525–#1530: twelve runs` | flagged `#1530`          | clean |
| `issues #10-#12 are open`                    | flagged `#12`            | clean |
| `claimed by issues #1899, #1903, #1904`      | flagged `#1903`, `#1904` | clean |
| `pull requests #10 and #12`                  | flagged `#12`            | clean |
| `See PR #1525 and PR #1530`                  | clean                    | clean |

The list form is the one I hit twice while working other items this session — once quoting
`#1525–#1530` verbatim from another record, once writing `#1899, #1903, #1904`. Both times the fix
available at the site was wrong in the way the issue describes: alter a verbatim quotation to satisfy
a check mistaken about the text, or mark a real claim as a code-span "specimen", an exemption meant
for something else.

## Why it surfaced late

The scan is a per-file ratchet and every existing instance was frozen in its baseline. It costs
nothing until a NEW document writes a range.

## Approach

A qualifier governs forward across a separator, and the separators are ENUMERATED rather than "any
short run of punctuation". The point is to recognise a phrase, not to forgive proximity: `PR #10 broke
#12` must stay two references, because the second is a different claim and treating nearness as
governance would let a real bare reference hide behind an unrelated qualified one on the same line.

Chaining carries a qualifier forward; it never invents one. `See #10 and #12` is still two findings.

Both dash forms are listed. The en dash is what this repository's prose actually uses, and a check
that only knew the hyphen would be right about the form nobody writes.

## Plan

- [x] TC-01: a range with a hyphen is clean.
- [x] TC-02: a range with an en dash is clean.
- [x] TC-03: a comma list is clean, with and without a closing conjunction.
- [x] TC-04: `A and B` and `A to B` are clean.
- [x] TC-05: a verb between two references still yields a finding.
- [x] TC-06: a new sentence still yields a finding.
- [x] TC-07: an unqualified first member does NOT govern the rest.
- [x] TC-08: an intervening word breaks the chain.
- [x] TC-09: the baseline is re-frozen in this same change — 1,520 → 1,496 across 292 → 281 files.
- [x] TC-10: `pnpm harness:scan` green (128 passed, 3 skipped).
- [x] TC-11: `pnpm harness:pre-push` green.

## Test Plan

Red-proofed in BOTH directions, because a chaining rule can be wrong two ways and each way passes the
other's cases:

| probe                             | what went red          |
| --------------------------------- | ---------------------- |
| chaining disabled entirely        | the four accept-cases  |
| chaining widened to any short run | the three refuse-cases |

Neither probe alone would have shown the rule is right; a rule that only accepts is a rule that
accepts everything.

The baseline drop was also checked by reading, not just counted. `content/guide/cli.md` fell by one,
and the instance is `issues #22732, #3045` — a genuine list under one qualifier, which is the form
this change is for rather than a coincidence of the widening.

## Progress

### 2026-08-20

Filed as issue #1913 in review of the follow-up to pull request #1886. INFRA-106 owns the rule and is
complete; it enumerated its exemptions one at a time and never considered a phrase spanning more than
one number.

### 2026-08-21

TC-11 executed rather than assumed. The implementation is `af212f431` on `develop`.

`pnpm harness:test` — 221 files / 4087 tests and 73 files / 1113 tests, all passed, exit 0.
`pnpm harness:scan` — 129 scans, 0 failures.

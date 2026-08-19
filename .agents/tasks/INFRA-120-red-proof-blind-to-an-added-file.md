---
title: 'INFRA-120: the accidental-green gate cannot reach a verdict for a file added in its own range'
status: in-progress
created: 2026-08-20
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-120: reverse to the state that HAS the file, not to its absence

## Objective

Issue #1905. `check-regression-red-proof` is the declared mechanism against accidental-green tests,
and its CI job is named "enforcing: accidental-green only". For a source file **added within the range
it examines**, that verdict is structurally unreachable.

## The mechanism, traced

`defaultReverseApply(base, srcPaths)` reverse-applies `merge-base(origin/develop, HEAD)..HEAD`. For a
file added in that range:

1. reversing the diff DELETES the file;
2. every case importing it throws, so the run is a transform/import error;
3. `classifyVitestOutcome` reports `run-error`, never `all-pass` or `added-cases-pass`;
4. `decidePairVerdict` returns `ACCIDENTAL_GREEN` only on those two — so it returns `INCONCLUSIVE`.

The `addedCases` machinery built for exactly this granularity (INFRA-072) is defeated by the
whole-range reversal that runs before it.

## Measured

Pull request #1886 added a scan and its test in the same range across three review rounds. A case
added in round two was green three ways: on the current module, on the current module with the line it
guards deleted, and on the round-two predecessor that had no such support at all. The pull request's
red-proof job emitted exactly one verdict, for a different file, and none for that pair. **A human
found it.**

This is the gate's SECOND structural blind spot, and the file's own header records the first:
"Measured over PRs #1525–PR #1530: twelve CI runs, zero verdicts, nine of them `no same-package pair` —
while human review caught four accidental-green tests in that same window, all of them under
`scripts/harness/__tests__/` (INFRA-071)." Same gate, same directory, found the same way.

## Approach

The reversal base becomes a per-source question rather than one range-wide constant.

- **Existed at base** → reverse to `base`. Unchanged; this is the case the gate was designed for.
- **Added in the range, revised later** → reverse to the commit that CREATED it. Later rounds'
  revisions are undone, the file still exists, its tests run, and a verdict becomes reachable. This is
  exactly the pull request #1886 shape: a case added in round two against a round-two predecessor.
- **Added and never revised** → there is genuinely no earlier state. `reversalBaseFor` returns `null`
  and the gate reports `NO_EARLIER_STATE` rather than reversing to the file's absence and reading the
  resulting throws as a verdict.

`NO_EARLIER_STATE` is a named verdict rather than folded into `INCONCLUSIVE` because the two have
different remedies: inconclusive asks for a better pair, this asks for a red proof against a state
that exists.

## Plan

- [x] TC-01: a file added and later revised reverses to its creating commit.
- [x] TC-02: a file that existed at base still reverses to base.
- [x] TC-03: a file added and never revised returns `null`.
- [x] TC-04: a file the range never touched returns base.
- [x] TC-05: the orchestrator reverses to the creating commit rather than the base.
- [x] TC-06: `NO_EARLIER_STATE` is reported, and the gate does NOT reverse to the file's absence.
- [x] TC-07: the existing 60 cases still pass.
- [ ] TC-08: `pnpm harness:pre-push` green.

## Test Plan

Injected seams, as the rest of this file's orchestration fixtures already use: a case that shelled out
to `git log` for a path existing only in a fixture would couple the test to a repository state.

Adding the seam exposed that `baseIo` had to supply it too — six existing orchestration fixtures
began shelling out to real git the moment the default became live. That is worth recording rather
than quietly fixing: a new default in an injected-seam design reaches every existing caller of the
helper, and the failure it produces looks like a broken test rather than a missing injection.

Red-proofed: restoring the whole-range reversal fails exactly the two added-file cases and leaves the
other 64 green.

## Progress

### 2026-08-20

Filed as issue #1905 from review of pull request #1886, as FOUNDATIONAL. The specific accidental-green
case was corrected in that pull request; this item is why it was not caught mechanically.

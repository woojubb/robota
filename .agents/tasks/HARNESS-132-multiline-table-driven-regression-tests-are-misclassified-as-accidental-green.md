---
title: 'HARNESS-132: multiline table-driven regression tests are misclassified as accidental green'
issue: https://github.com/woojubb/robota/issues/2216
status: todo
created: 2026-08-29
priority: medium
urgency: soon
area: harness regression-red-proof
depends_on: []
---

# HARNESS-132: multiline table-driven regression tests are misclassified as accidental green

> **Contained — INFRA-145.** The official allocator returned the already-claimed `HARNESS-900`.
> This record uses the independently verified free ID `HARNESS-132` until the allocator stops
> discarding live work-item claims at its sentinel floor.

## Objective

Make the enforcing regression-red-proof gate recognize parameterized Vitest cases whose
`it.each` table and title occupy separate source lines. A case added by the branch and observed
failing after the source fix is reversed must be classified as RED evidence, never reported as
`added-cases-pass` merely because its runtime-expanded title differs from the literal source line.

This Task is registered by [issue #2216](https://github.com/woojubb/robota/issues/2216). Finding 1
of [issue #2358](https://github.com/woojubb/robota/issues/2358) is the same defect and must not be
implemented independently.

## Existing Evidence

- `scripts/harness/check-regression-red-proof.mjs` extracts added case titles one added line at a
  time. Its coverage includes a same-line `it.each(rows)(...)` form but not a multiline table plus
  a later title containing `%s` or the other runtime placeholders.
- PR #2507 CI run `33246764432`, job `99085488491`, reversed
  `frontmatter-profiles.ts`. All three newly added prototype-field cases failed, but the gate
  reported `accidental-green-fail (added-cases-pass)`.
- CI run `32630251814`, job `97171862831`, exhibited the same inverted verdict. Issue #2216 also
  records PR #2212, where rewriting equivalent table rows as literal-title cases changed only the
  checker verdict.
- A depth guardian classified the repeated defect as FOUNDATIONAL. The affected product regression
  is temporarily contained under this Task; that containment is not the checker fix.

## Scope Boundary

- Own title extraction and matching for multiline `it.each` and `test.each` declarations, including
  Vitest printf placeholders and object-table `$key` expansion.
- Preserve exact-title and template-literal matching behavior.
- Prove a generated matcher recognizes the added runtime case without matching unrelated cases in
  the same file.
- Keep current product tests as consumers of the checker. Do not weaken them, add a false
  `allow-green-at-base` declaration, or treat syntax rewrites in consumer tests as completion.

## Plan

- [ ] Record a recommendation and planning checkpoint for the checker change before implementation.
- [ ] Add harness fixtures for multiline parameterized declarations and each supported placeholder
      family, including a non-added neighboring case.
- [ ] Generalize added-case title extraction so source declarations and runtime-expanded titles are
      associated without broadening the matcher to unrelated cases.
- [ ] Re-run the dedicated harness suite and the exact enforcing regression-red-proof reproduction
      from PR #2507.
- [ ] Remove or update every `Contained — HARNESS-132.` hold once the root checker fix lands.

## Completion Criteria

- A branch whose only new regression cases use multiline `it.each`/`test.each` is classified
  `assertion-fail` when those cases fail after reversal.
- `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%#`, `%$`, and `$key` titles are matched to their runtime
  expansions without matching an unrelated case from the same file.
- `decidingFailures` identifies the specific added table row that supplied RED evidence.
- Existing exact-title and template-literal fixtures remain green.
- The PR #2507 reproduction changes from `accidental-green-fail (added-cases-pass)` to
  `red-proof-ok (assertion-fail)` without an opt-out.

## Test Plan

- Extend `scripts/harness/__tests__/check-regression-red-proof.test.mjs` with discriminating
  multiline table fixtures and negative neighboring-title assertions.
- Run `pnpm exec vitest run scripts/harness/__tests__/check-regression-red-proof.test.mjs`.
- Run the exact enforcing `check-regression-red-proof.mjs` command against a fixture or branch that
  reproduces PR #2507.
- Run affected harness scans and CI-equivalent verification before completing this Task.

## User Execution Test Scenarios

Not applicable. This Task changes an internal CI/harness judgement and exposes no CLI, TUI, browser,
or public SDK behavior. Its observable proof belongs to the enforcing CI check and harness fixtures.

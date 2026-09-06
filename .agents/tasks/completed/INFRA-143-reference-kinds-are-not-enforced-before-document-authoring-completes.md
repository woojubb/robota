---
title: 'INFRA-143: reference kinds are not enforced before document authoring completes'
issue: https://github.com/woojubb/robota/issues/2510
status: done
completed: 2026-09-06
created: 2026-08-29
priority: medium
urgency: soon
area: harness document authoring and reference qualification
depends_on: []
---

# INFRA-143: reference kinds are not enforced before document authoring completes

## Objective

Guarantee that governed documents emit or validate kind-qualified GitHub references before authoring
is considered complete. A new document must not reach a late integration scan with a bare `#NNNN`
that should say `issue #NNNN`, `PR #NNNN`, or another declared kind.

This Task is registered by [issue #2510](https://github.com/woojubb/robota/issues/2510). It owns one
cause: the authoring path has no pre-completion enforcement for a rule the integration scan applies
only after free-form prose already exists.

## Existing Evidence

- `node scripts/harness/scan-reference-kind-qualified.mjs` failed on the new INFRA-145 Task because
  it contained a bare issue reference.
- The same defect appeared previously in PROC-016 for issue #2406 and RUNTIME-007 for issue #1852;
  each site was corrected, then the pattern recurred in a different document.
- `reference-kind-qualified` is advisory in PR context and blocking in integration context, so a
  document can progress through authoring before the omission becomes a hard stop.
- A depth guardian classified the recurrence as FOUNDATIONAL rather than another isolated typo.

## Scope Boundary

- Own the authoring or pre-completion surface that creates governed Markdown documents.
- Reuse the repository's canonical reference-kind parser and vocabulary; do not add a second regex.
- Preserve the integration scan as a final independent floor.
- Do not bulk-rewrite frozen historical documents or weaken the per-file ratchet.

## Plan

- [x] Identify every governed document-authoring entry point and select one canonical pre-completion
      validation boundary.
- [x] Add a failing fixture that authors a new document with a bare issue reference and proves the
      omission is rejected before completion.
- [x] Wire the canonical reference-kind judgement into that boundary without duplicating parsing.
- [x] Prove correctly qualified issue, PR, closing-keyword, and non-GitHub/code references remain accepted.
- [x] Remove `Contained — INFRA-143.` holds only after the pre-completion mechanism lands.

## Completion Criteria

- A newly authored governed document containing bare `#1916` is rejected before authoring completes.
- The diagnostic identifies the path, line, reference, and accepted kind-qualified form.
- Every declared document-authoring path reaches the same canonical validation mechanism.
- `node scripts/harness/scan-reference-kind-qualified.mjs` remains green as an independent final
  floor and its frozen baseline is not widened.

## Test Plan

- Add red/green fixtures around the selected authoring boundary for bare and qualified references.
- Run `pnpm exec vitest run scripts/harness/__tests__/scan-reference-kind-qualified.test.mjs` and
  the authoring-boundary suite.
- Run `node scripts/harness/scan-reference-kind-qualified.mjs` and `pnpm harness:test:contracts`.
- Run CI-equivalent verification before completing the Task.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This Task changes only internal governed-document authoring and exposes no user-facing
CLI, TUI, browser, API, SDK, output, or runtime behavior.

## Resolution

Implemented `scripts/harness/document-authoring-reference.mjs` as the shared adapter over the
canonical `reference-kind.mjs` predicate. `new-spec.mjs` now rejects a prospective draft before
printing or writing it, and `allocate-work-item-id.mjs` rejects a prospective Task before its atomic
`wx` write. The diagnostic reports the target path, line, reference, and accepted qualified forms.

Focused verification passed on 2026-09-06: 3 Vitest files, 89 tests; the independent
`reference-kind-qualified` scan examined 3391 tracked documents and exited 0.

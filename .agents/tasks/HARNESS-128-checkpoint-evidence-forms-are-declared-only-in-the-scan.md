---
title: 'HARNESS-128: GATE-IMPLEMENT and Stage-1 checkpoint evidence forms are declared only in the scan and its fixture'
issue: https://github.com/woojubb/robota/issues/2394
status: todo
created: 2026-08-27
priority: high
urgency: soon
area: scripts/harness, .agents/specs/gate-catalogue.md, .agents/rules/backlog-execution.md
depends_on: []
---

# HARNESS-128: checkpoint evidence forms are declared only in the scan

## Problem

`scripts/harness/scan-user-execution-plan-order.mjs` decides whether a GATE-IMPLEMENT entry and a
DONE-GATE-STAGE-1 entry are complete by matching forms that exist **only in the scan and its test
fixture** — not in the catalogue or rule that own those gates. A guardian that follows the catalogue
cannot know the passing form; a guardian that copies a prior pass can.

## Evidence

Measured on `develop` `6802df180` (2026-08-27), raised by `finding-depth-triager` as the FOUNDATIONAL
cause behind HARNESS-127 (issue #2378):

| Gate              | What the owning document says to record                                                                                                       | What the scan requires                                                                                                                                                                               | Where the form is written                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GATE-IMPLEMENT    | `gate-catalogue.md:226-227`, prose: "Tasks file path + list of tasks created + exact PLAN outcome + whole worktree path inventory"            | `**Status upgrade:** approved → in-progress`, a task path, `SCENARIO DRAFTED: … \| N`, `/whole-worktree/i` (`completeGateImplementEntry`, lines 432-435)                                             | the scan; fixture at `__tests__/scan-user-execution-plan-order.test.mjs:177`                |
| DONE-GATE-STAGE-1 | `gate-catalogue.md:329-331`, prose: "each scenario named, with `guardian-observable-verdict=product-behavior`, its exact canonical surface …" | `<name> — surface=…; surface-rationale=…; invocation=…; observable-type=…; observable=…; observable-rationale=…; guardian-observable-verdict=product-behavior; ` (`completeStageOneEntry`, line 778) | the scan and its test only — `git grep 'surface-rationale='` finds nothing under `.agents/` |

Both forms were born in one commit (`675cd814e`, issue #2365), which also added the test at line 1940
asserting the RULE contains `whole worktree` — three lines from a scan that refused that spelling.
Cost so far: four spec documents carrying `whole-worktree`, a token the catalogue never wrote, and
three diagnostic rounds on ARCH-112.

The repository already owns the right design for parsed guardian evidence: RULE-012's
`scan-standing-delegation-evidence.mjs` reads the evidence form and the registry out of
`backlog-execution.md` at runtime, fail-closed, and GATE-APPROVAL's catalogue entry points at that
declared form. GATE-IMPLEMENT and Stage-1 have no such declaration.

## Reproduction condition

Any guardian writing a GATE-IMPLEMENT or DONE-GATE-STAGE-1 PASS from the catalogue's text alone,
without a prior PASS to copy from.

## Why it is its own item

It is a rule-side design change: declare the evidence form for both gates in the owning rule (the
place GATE-APPROVAL's form already lives), point the catalogue at it, and have the scan read the form
at the checkpoint's revision, fail-closed — then migrate or accept the four existing documents. That
edits `gate-catalogue.md` and `backlog-execution.md`, which issue #2375, issue #2376 and issue #2392 also want to
change, so it is sequenced with them rather than folded into the one-token fix.

**Contained under this item:** HARNESS-127 (issue #2378) widens the worktree token to the catalogue's
spelling and carries `Contained — HARNESS-128.` at the regex line.

Not this item: issue #2395 (the refusal message names a missing PASS, not the failed conjunct) and
issue #2376 (the criterion's semantics vs `AUTO_GENERATED_CHURN`).

## Test Plan

- A declared form for each gate in `backlog-execution.md`, referenced from `gate-catalogue.md`;
  `scan-user-execution-plan-order.mjs` parses the entry against the declared form read at the
  checkpoint's revision, and refuses with the name of the missing field.
- Fail-closed cases: unreadable rule section, missing form, entry with a missing field — each a
  finding naming the field; a control that the four existing checkpoint documents still resolve.
- Applied-check mutation: deleting the declared form from the rule must fail the scan, not pass it.

## User Execution Test Scenarios

Not applicable — repository gate machinery only; no product surface. To be re-judged by
`user-execution-scenario-author` when the item is picked up.

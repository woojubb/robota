---
title: 'INFRA-2634: Make lane declaration distinguish lifecycle projections from enforcement-policy changes'
issue: https://github.com/woojubb/robota/issues/2634
status: todo
created: 2026-09-06
priority: medium
urgency: soon
area: scripts/harness/scan-lane-declaration.mjs, scripts/harness/__tests__/scan-lane-declaration.test.mjs
depends_on: []
---

# INFRA-2634: Make lane declaration distinguish lifecycle projections from enforcement-policy changes

## Objective

Prevent the lane scanner from treating a required AGREEMENT parent lifecycle projection or a
historical done-spec evidence repair as a second implementation-lane declaration. The current
scanner makes an otherwise L1 topic branch fail with conflicting L2/L1 declarations, forcing an
unnecessary L2 promotion and delaying delivery.

## Plan

- [ ] Reproduce the conflict with the exact parent projection and historical done-spec shape.
- [ ] Make only live planning specs and non-projection changes contribute a spec-frontmatter lane
      declaration; preserve L2 refusal for actual lane-policy and gate-enforcement changes.
- [ ] Add regression coverage for ignored lifecycle/history changes and retained live spec changes.
- [ ] Re-run affected scans and the complete lane scanner suite on the final clean head.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes an internal repository lane-enforcement scan and its developer workflow only;
it adds no Robota CLI, TUI, browser, SDK, or other product action that an end user can execute.

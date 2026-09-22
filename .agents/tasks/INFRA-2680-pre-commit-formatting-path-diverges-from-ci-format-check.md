---
title: 'INFRA-2680: Pre-commit formatting path diverges from CI format-check'
issue: https://github.com/woojubb/robota/issues/2680
status: superseded
created: 2026-09-09
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# INFRA-2680: Pre-commit formatting path diverges from CI format-check

## Disposition

**Superseded by issue #2826.** Formatting is now locally owned by the pre-commit path; PR CI no
longer repeats the same format check. The prior objective of making two mandatory paths agree is
therefore intentionally retired rather than delivered. This record stays at its fixed path as
historical context, and its product-independent formatting concern is covered by the local owner.

## Objective

Reconcile the pre-commit formatting path with the CI `format-check` contract so governed Markdown and
harness source changes are either formatted before commit or explicitly covered by one documented
owner. Preserve the current formatting policy and add a regression for the agreed ownership boundary.

## Plan

- [x] Superseded — issue #2826 assigns formatting to one local owner and removes the duplicate CI path.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This root item changes repository formatting enforcement and developer workflow only. It
does not ship through the SDK, runtime, CLI, TUI, browser UI, or public example surface, so no end user
can observe it through a product interaction.

# Backlog User Execution Test Scenario Gate Rule

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - process quality rule for backlog-driven work.

## Request

Require future user-facing backlogs to include user execution test scenarios in addition to the agent's
engineering test plan.

The rule must answer:

> What can the user run or inspect after this work is complete, and how does that differ from the
> agent's own verification plan?

## Non-Negotiable Product Principles

- **Separate user execution test scenarios from engineering tests.** Unit, integration, harness,
  build, and CI checks are the agent's test plan. User execution test scenarios describe what the
  user can directly run or operate in the product to observe the changed behavior.
- **Gate completion on executed evidence.** A backlog is not complete until the user execution test
  scenario is executed when feasible and evidence is captured.
- **Report scenario availability.** When the user execution test scenario gate passes, the final
  response must tell the user that the scenario is available to run.
- **Keep orchestration thin.** The backlog execution skill coordinates the user execution test
  scenario gate but does not own detailed test design.

## Expected Outcomes

- Backlogs become easier for users to validate without reading internal test details.
- PRs record both internal verification and user-facing scenario evidence.
- Future work exposes a clear manual scenario before the user is asked to trust the result.
- The process remains compatible with the one-backlog-per-PR and initiative base branch workflow.

## Architecture Ownership Rule

`.agents/rules/backlog-execution.md` owns the mandatory rule. The
`backlog-execution-orchestrator` skill owns only sequencing, enforcement, PR body requirements, and
handoff shape. Detailed engineering tests remain owned by testing and package-specific skills.

## Recommended First Slice

1. Update `.agents/rules/backlog-execution.md` with a user execution test scenario rule.
2. Update `.agents/skills/backlog-execution-orchestrator/SKILL.md` to enforce the user execution
   test scenario gate.
3. Update `.agents/backlog/README.md` so backlog authors know to include `## Test Plan` and
   `## User Execution Test Scenarios`.
4. Add user execution test scenario sections to the current initiative backlogs that were completed before the new
   rule existed.

## Acceptance Criteria

- [x] Backlog execution rules require user-facing scenarios for user-visible work.
- [x] The orchestration skill checks scenario presence and final user execution test scenario gate
      result.
- [x] PR bodies must report the user execution test scenario gate result.
- [x] Backlog README explains the difference between `## Test Plan` and
      `## User Execution Test Scenarios`.
- [x] Current initiative backlogs either include product-surface user execution test scenarios or record why user
      scenarios are not applicable.

## Test Plan

- Run `git diff --check`.
- Run `pnpm harness:scan`.
- Verify the rules and orchestration skill mention the user execution test scenario gate.
- Verify current initiative backlog files do not present document inspection as a user execution test scenario.

## User Execution Test Scenarios

Not applicable. This backlog changed process rules and authoring guidance only. It did not deliver
runnable Robota product behavior, so document inspection must remain process verification rather
than a user execution test scenario.

## Process Verification Evidence

### Verification: Backlog Scenario Gate Rule Exists

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "## User Execution Test Scenarios|exact command lines or UI steps|Static review is not enough" .agents/backlog/README.md
  rg -n "exact command lines, UI actions|expected observable result|must execute the user execution test scenario|The user execution test scenario gate was not executed" .agents/rules/backlog-execution.md
  rg -n "exact commands or UI steps|Execute the user execution test scenario|observed evidence" .agents/skills/backlog-execution-orchestrator/SKILL.md
  ```

- Expected result: The commands print the backlog entry requirement, executable/observable
  scenario rule, mandatory execution gate, stop condition, and PR evidence requirement.
- Evidence: Executed during the original rule update and replaced here as process verification after
  product-surface scenario scoping.

## Verification Plan

- `git diff --check`
- `pnpm harness:scan`
- Confirm current initiative backlog files do not present document inspection as a user execution test scenario.

## Result

Completed by updating backlog execution rules, the backlog execution orchestrator skill, backlog
README guidance, and the current initiative backlog files.

- The rule now requires user-facing test scenarios for user-visible backlog work.
- The orchestrator skill records the user execution test scenario gate and evidence as part of the normal PR
  pipeline.
- Current initiative backlogs now either include product-surface user execution test scenarios or mark the scenario
  as not applicable for document/governance-only work.

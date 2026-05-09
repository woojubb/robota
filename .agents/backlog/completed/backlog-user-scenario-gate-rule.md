# Backlog User Scenario Gate Rule

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - process quality rule for backlog-driven work.

## Request

Require future user-facing backlogs to include user test scenarios in addition to the agent's
engineering test plan.

The rule must answer:

> What can the user run or inspect after this work is complete, and how does that differ from the
> agent's own verification plan?

## Non-Negotiable Product Principles

- **Separate user scenarios from engineering tests.** Unit, integration, harness, build, and CI
  checks are the agent's test plan. User scenarios describe what the user can manually run or
  inspect.
- **Gate completion on the scenario.** A backlog is not complete until the user scenario is run or
  coherently reviewed against the completed behavior.
- **Report scenario availability.** When the scenario gate passes, the final response must tell the
  user that the scenario is available to run.
- **Keep orchestration thin.** The backlog execution skill coordinates the scenario gate but does
  not own detailed test design.

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

1. Update `.agents/rules/backlog-execution.md` with a user test scenario rule.
2. Update `.agents/skills/backlog-execution-orchestrator/SKILL.md` to enforce the scenario gate.
3. Update `.agents/backlog/README.md` so backlog authors know to include `## Test Plan` and
   `## User Test Scenarios`.
4. Add user scenario sections to the current initiative backlogs that were completed before the new
   rule existed.

## Acceptance Criteria

- [x] Backlog execution rules require user-facing scenarios for user-visible work.
- [x] The orchestration skill checks scenario presence and final scenario gate result.
- [x] PR bodies must report the user scenario gate result.
- [x] Backlog README explains the difference between `## Test Plan` and
      `## User Test Scenarios`.
- [x] Current initiative backlogs include user-facing scenarios.

## Test Plan

- Run `git diff --check`.
- Run `pnpm harness:scan`.
- Verify the rules and orchestration skill mention the user scenario gate.
- Verify the current initiative backlog files include `## User Test Scenarios`.

## User Test Scenarios

### Scenario: Validate A Future Backlog Has A User Scenario

- Prerequisites: Open `.agents/backlog/README.md`,
  `.agents/rules/backlog-execution.md`, and
  `.agents/skills/backlog-execution-orchestrator/SKILL.md`.
- User actions: Check that a user-facing backlog is expected to contain both `## Test Plan` and
  `## User Test Scenarios`; then confirm the skill requires the scenario gate result in PR bodies
  and final handoff.
- Expected visible result: The user can see the engineering test plan is separate from the manual
  user scenario, and the scenario must be run or coherently reviewed before completion.
- Cleanup/reset: None.
- Agent verification: Static/manual review plus `pnpm harness:scan`.

## Verification Plan

- `git diff --check`
- `pnpm harness:scan`
- Confirm current initiative backlog files contain `## User Test Scenarios`.

## Result

Completed by updating backlog execution rules, the backlog execution orchestrator skill, backlog
README guidance, and the current initiative backlog files.

- The rule now requires user-facing test scenarios for user-visible backlog work.
- The orchestrator skill records the user scenario gate as part of the normal PR pipeline.
- Current initiative backlogs now include user scenarios that users can inspect manually.

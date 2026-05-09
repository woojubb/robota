# Executable User Execution Test Scenario Gate Hardening

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - correction to make user execution test scenario gates concrete, executable, and evidenced.

## Request

Strengthen the backlog user execution test scenario rule so scenarios are not abstract summaries. A
valid user execution test scenario must give the user exact commands or UI steps, expected
observable results, and evidence that the agent executed the scenario when execution is feasible.

## Non-Negotiable Product Principles

- **Concrete over abstract.** A scenario must include exact commands or UI steps, not just "review
  the document" or "confirm behavior."
- **Expected observable result.** The scenario must say what output, exit code, visible UI state, or
  file change the user should expect.
- **Agent execution first.** If the scenario can be run by the agent using shell, filesystem, HTTP,
  browser, TUI, or local scripts, the agent must run it before declaring the gate passed.
- **Evidence required.** No user execution test scenario gate may pass without captured evidence such as command
  output, exit code, screenshot, log excerpt, rendered UI observation, or changed-file diff.
- **Manual-only is exceptional.** Manual-only scenarios must explain why the agent cannot execute
  them and must not be reported as executed.
- **Handoff includes the runnable scenario.** After a gate passes, the user receives the concrete
  scenario, not a pointer to go read files.

## Expected Outcomes

- Users receive actionable scenarios they can run directly.
- PRs contain evidence from the agent-executed user execution test scenario gate.
- Gates without evidence fail by rule.
- Abstract static review no longer counts as a passed user execution test scenario when an executable check is
  available.
- Future product-behavior backlog scenarios become product-command-backed and reproducible.
- Document/governance-only backlog checks are recorded as process verification, not user execution test scenarios.

## Architecture Ownership Rule

The mandatory constraint belongs in `.agents/rules/backlog-execution.md`. The
`backlog-execution-orchestrator` skill sequences and reports the gate but does not design package
tests. Backlog files own the concrete user execution test scenarios for their own scope.

## Recommended First Slice

1. Strengthen `.agents/rules/backlog-execution.md` to require exact commands/UI steps, expected
   observable results, and execution evidence.
2. Strengthen `.agents/skills/backlog-execution-orchestrator/SKILL.md` to execute scenarios when
   feasible and report observed evidence in PRs.
3. Update `.agents/backlog/README.md` with the concrete scenario requirement.
4. Replace document-inspection user execution test scenarios with process verification evidence, and require future
   product-behavior scenarios to use product surfaces.

## Acceptance Criteria

- [x] The rule rejects abstract user execution test scenarios.
- [x] The rule requires exact commands/UI steps and expected observable results.
- [x] The rule requires agent execution when feasible.
- [x] The rule requires captured evidence and rejects evidence-free gates.
- [x] The orchestration skill requires observed evidence in PR bodies.
- [x] Current initiative document/governance checks are not presented as user execution test scenarios.
- [x] Product-behavior scenarios are required to use product surfaces.

## Test Plan

- Run `git diff --check`.
- Run `pnpm harness:scan`.
- Run `rg` checks proving rule/skill text contains exact-command, expected-result, execution, and
  evidence requirements.
- Confirm current initiative document/governance checks are process verification, not user
  scenarios.

## User Execution Test Scenarios

Not applicable. This backlog changed process rules and orchestration guidance only. It did not
deliver runnable Robota product behavior, so document inspection must not be presented as a user
test scenario.

## Process Verification Evidence

### Verification: Scenario Gate Is Executable And Evidenced

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "exact command lines, UI actions|expected observable result|must execute the user execution test scenario|The user execution test scenario gate was not executed" .agents/rules/backlog-execution.md
  rg -n "exact commands or UI steps|Execute the user execution test scenario|observed evidence" .agents/skills/backlog-execution-orchestrator/SKILL.md
  rg -n "^## User Execution Test Scenarios" .agents/backlog/cli-ai-workflow-reviewer-harness-planning.md .agents/backlog/completed/*.md
  ```

- Expected result: The first command prints the mandatory concrete scenario fields and
  execution gate. The second command prints orchestration requirements to execute and report
  evidence. The third command prints user execution test scenario sections, including the current initiative
  backlogs.
- Evidence: Executed during the original gate hardening and reclassified here as process
  verification after product-surface scenario scoping.

## Verification Plan

- `git diff --check`
- `pnpm harness:scan`
- Execute the process verification commands listed above.
- Confirm document/governance-only backlogs do not present document inspection as user execution test scenarios.

## Result

Completed by strengthening backlog execution rules, updating the backlog execution orchestrator
skill, updating backlog authoring guidance, and replacing the current initiative's abstract
scenarios with command-backed scenarios.

# Executable User Scenario Gate Hardening

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - correction to make user scenario gates concrete, executable, and evidenced.

## Request

Strengthen the backlog user scenario rule so scenarios are not abstract summaries. A valid user test
scenario must give the user exact commands or UI steps, expected observable results, and evidence
that the agent executed the scenario when execution is feasible.

## Non-Negotiable Product Principles

- **Concrete over abstract.** A scenario must include exact commands or UI steps, not just "review
  the document" or "confirm behavior."
- **Expected observable result.** The scenario must say what output, exit code, visible UI state, or
  file change the user should expect.
- **Agent execution first.** If the scenario can be run by the agent using shell, filesystem, HTTP,
  browser, TUI, or local scripts, the agent must run it before declaring the gate passed.
- **Evidence required.** No user scenario gate may pass without captured evidence such as command
  output, exit code, screenshot, log excerpt, rendered UI observation, or changed-file diff.
- **Manual-only is exceptional.** Manual-only scenarios must explain why the agent cannot execute
  them and must not be reported as executed.
- **Handoff includes the runnable scenario.** After a gate passes, the user receives the concrete
  scenario, not a pointer to go read files.

## Expected Outcomes

- Users receive actionable scenarios they can run directly.
- PRs contain evidence from the agent-executed user scenario gate.
- Gates without evidence fail by rule.
- Abstract static review no longer counts as a passed user scenario when an executable check is
  available.
- Current initiative backlog scenarios become command-backed and reproducible.

## Architecture Ownership Rule

The mandatory constraint belongs in `.agents/rules/backlog-execution.md`. The
`backlog-execution-orchestrator` skill sequences and reports the gate but does not design package
tests. Backlog files own the concrete user scenarios for their own scope.

## Recommended First Slice

1. Strengthen `.agents/rules/backlog-execution.md` to require exact commands/UI steps, expected
   observable results, and execution evidence.
2. Strengthen `.agents/skills/backlog-execution-orchestrator/SKILL.md` to execute scenarios when
   feasible and report observed evidence in PRs.
3. Update `.agents/backlog/README.md` with the concrete scenario requirement.
4. Replace current initiative user scenarios with executable command-backed scenarios.

## Acceptance Criteria

- [x] The rule rejects abstract user scenarios.
- [x] The rule requires exact commands/UI steps and expected observable results.
- [x] The rule requires agent execution when feasible.
- [x] The rule requires captured evidence and rejects evidence-free gates.
- [x] The orchestration skill requires observed evidence in PR bodies.
- [x] Current initiative user scenarios include concrete commands.
- [x] The concrete scenarios were executed by the agent before completion.

## Test Plan

- Run `git diff --check`.
- Run `pnpm harness:scan`.
- Run `rg` checks proving rule/skill text contains exact-command, expected-result, execution, and
  evidence requirements.
- Run each current initiative user scenario command and confirm expected matches are printed.

## User Test Scenarios

### Scenario: Verify User Scenario Gates Are Executable And Evidenced

- Prerequisites: Run from the repository root.
- User actions:

  ```bash
  rg -n "exact command lines, UI actions|expected observable result|must execute the user test scenario|The user scenario gate was not executed" .agents/rules/backlog-execution.md
  rg -n "exact commands or UI steps|Execute the user test scenario|observed evidence" .agents/skills/backlog-execution-orchestrator/SKILL.md
  rg -n "^## User Test Scenarios" .agents/backlog/cli-ai-workflow-reviewer-harness-planning.md .agents/backlog/completed/*.md
  ```

- Expected visible result: The first command prints the mandatory concrete scenario fields and
  execution gate. The second command prints orchestration requirements to execute and report
  evidence. The third command prints user scenario sections, including the current initiative
  backlogs.
- Cleanup/reset: None.
- Agent verification: Direct command execution plus `pnpm harness:scan`.

## Verification Plan

- `git diff --check`
- `pnpm harness:scan`
- Execute the user scenario commands listed above.
- Execute each updated current-initiative scenario command.

## Result

Completed by strengthening backlog execution rules, updating the backlog execution orchestrator
skill, updating backlog authoring guidance, and replacing the current initiative's abstract
scenarios with command-backed scenarios.

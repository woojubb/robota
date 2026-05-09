# Implementation User Execution Test Scenario Gate Alignment

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - correction to make user execution test scenario gates validate implemented work, not backlog quality.

## Request

Clarify the backlog execution flow so user execution test scenarios are planned in the backlog before
implementation, executed after implementation against the completed code path or delivered artifact,
and recorded back into the backlog with evidence before the gate can pass.

## Non-Negotiable Product Principles

- **Scenario planned before implementation.** The backlog must define the user execution test scenario before
  work starts so the implementation target is concrete.
- **Scenario targets completed work.** For code-changing backlogs, the scenario must exercise the
  implemented code path. Backlog text review, documentation search, or static prose checks are not a
  valid user execution test scenario gate for code work.
- **Runnable environment required.** If the scenario needs a fixture, demo command, local server,
  test project, seed data, or other setup, the backlog must say whether it exists, will be built, or
  requires a user decision.
- **Agent runs the scenario after implementation.** When executable from the workspace, the agent
  must run the scenario after implementation and compare observed output with the expected result.
- **Backlog evidence required.** The backlog must be updated with observed evidence after execution.
  No recorded evidence means the gate does not pass.
- **User handoff is executable.** After the gate passes, the user must receive the verified scenario
  with exact commands or UI steps and expected results they can run directly.
- **Do not fake user execution test scenarios for documents.** Document/rule/static checks are verification
  evidence, not user execution test scenarios.
- **Use product surfaces.** User execution test scenarios must use Robota product surfaces such as
  CLI commands, TUI actions, browser UI flows, or public SDK/example usage.

## Expected Outcomes

- User execution test scenario gates validate completed implementation behavior, not
  planning-document quality.
- Future code backlogs cannot pass with only `rg` checks against backlog text or documentation.
- Missing scenario environment becomes an explicit implementation item or user decision.
- Completed backlogs contain the evidence needed to prove the user execution test scenario gate passed.
- Final user handoffs include concrete commands or UI steps that have already been verified.
- Documentation-only or governance-only backlogs do not present document inspection as a user
  execution test scenario.
- User execution test scenarios are scoped to product usage instead of internal repository checks.

## Architecture Ownership Rule

The mandatory constraint belongs in `.agents/rules/backlog-execution.md`. The
`backlog-execution-orchestrator` skill owns sequencing and reporting only. `.agents/backlog/README.md`
owns the backlog entry format. Package-specific implementation and tests remain owned by the
affected package specs and owner skills.

## Recommended First Slice

1. Update `.agents/rules/backlog-execution.md` with the full lifecycle:
   planned scenario before implementation, environment readiness, post-implementation execution,
   backlog evidence update, and final user handoff.
2. Update `.agents/skills/backlog-execution-orchestrator/SKILL.md` so the orchestrator enforces the
   lifecycle without redefining package-specific implementation details.
3. Update `.agents/backlog/README.md` so future backlog entries require the same fields.
4. Record this correction as a completed backlog item with evidence.

## Acceptance Criteria

- [x] Rules distinguish the planned user execution test scenario from the post-implementation execution gate.
- [x] Rules require code-changing backlogs to exercise implemented code paths.
- [x] Rules require missing user execution test scenario environment to be built, proposed, or decided.
- [x] Rules require the backlog to be updated with observed evidence after execution.
- [x] The orchestrator skill enforces the same lifecycle.
- [x] Backlog authoring guidance describes the required lifecycle and evidence update.
- [x] Documentation-only and governance-only changes are required to mark user execution test scenarios as not
      applicable instead of presenting document inspection as a user execution test scenario.
- [x] User execution test scenario scope is limited to product surfaces such as Robota CLI, TUI,
      browser UI, or public SDK/example usage.

## Test Plan

- Run `git diff --check`.
- Run `pnpm harness:scan`.
- Run targeted `rg` checks proving the rules, skill, and backlog README contain the implementation
  target, environment readiness, post-implementation execution, and backlog evidence update
  requirements.

## User Execution Test Scenarios

Not applicable. This backlog changes process rules, a workflow skill, and backlog authoring
guidance. It does not deliver runnable user-facing product behavior. Document inspection would only
prove that the process documents changed, so it must not be presented as a user execution test scenario.

## Process Verification Evidence

### Verification: Implementation-Focused Gate Rules

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "implemented code path|completed implementation|product surface|internal repository checks|Missing test environment for the user execution test scenario" .agents/rules/backlog-execution.md
  rg -n "completed implementation or delivered artifact|product surface|internal repository verification|where the backlog was updated" .agents/skills/backlog-execution-orchestrator/SKILL.md
  rg -n "completed code path or delivered artifact|product-surface scenarios|rg`, harness commands|must not invent a user execution test scenario" .agents/backlog/README.md
  ```

- Expected result: The first command prints rule lines requiring implementation-code
  scenarios, completed-work execution, backlog evidence updates, and environment handling. The
  second command prints orchestrator lines requiring the same lifecycle. The third command prints
  backlog entry guidance that rejects static text checks for code-changing backlogs and requires
  captured evidence to be recorded.
- Evidence:
  - `rg` against `.agents/rules/backlog-execution.md` printed lines 48, 54, 84, 99, 151, 152, 176,
    and 179, covering product-surface scope, implemented-code scenarios, completed-work execution,
    internal-check exclusion, and missing environment handling.
  - `rg` against `.agents/skills/backlog-execution-orchestrator/SKILL.md` printed lines 46, 47, 55,
    115, and 128, covering product-surface scenario planning, completed-work behavior, backlog
    evidence reporting, and internal-verification rejection.
  - `rg` against `.agents/backlog/README.md` printed lines 19, 25, 32, and 36, covering
    product-surface scenarios, completed-artifact execution, internal-check exclusion, and
    not-applicable handling for document/governance-only work.

## Verification Plan

- `git diff --check`
- `pnpm harness:scan`
- Execute the process verification commands above and update this backlog with the observed
  evidence.

## Result

Completed by updating the backlog execution rule, backlog execution orchestrator skill, and backlog
entry requirements so user execution test scenario gates are planned before implementation, executed after
implementation against the completed work, and recorded with evidence in the backlog.

---
name: backlog-execution-orchestrator
description: Use when executing backlog-driven work, multi-PR initiatives, recommendation-gated implementation, or one-backlog-per-PR workflows. Orchestrates owner skills without duplicating their detailed procedures.
---

# Backlog Execution Orchestrator

## Rule Anchor

- `.agents/rules/backlog-execution.md`
- `.agents/rules/git-branch.md`
- `.agents/rules/process.md`

## Use This Skill When

- The user asks to work through one or more backlog items.
- The user requires a recommendation before implementation.
- The work must use one PR per backlog or split work unit.
- A multi-backlog initiative needs a base branch and child PR sequence.
- The final initiative PR must target `develop` but remain unmerged for the user.

## Scope

This skill owns orchestration only:

- recommendation gate enforcement;
- branch and PR sequencing;
- owner-skill routing;
- verification checkpoint ordering;
- user execution test scenario gate enforcement;
- PR summary requirements;
- final handoff state.

It does not own package architecture, test design, branch safety, SPEC authoring, commit messages,
or implementation details.

## Pipeline

1. Read the target backlog and `.agents/rules/backlog-execution.md`.
2. Present a recommendation gate before implementation:
   - proposed approach;
   - why it matches backlog intent;
   - why it matches repo rules, layering, and ownership;
   - affected scope;
   - test and verification plan;
   - concrete user execution test scenario plan using a product surface, with exact commands or UI
     steps and expected observable result against the completed implementation or delivered artifact
     when the backlog changes runnable user-facing behavior;
   - not-applicable reason when the backlog does not change runnable user-facing behavior;
   - required test environment for the user execution test scenario and whether it already exists,
     will be built by the backlog, or needs a user decision;
   - decisions that require the user.
3. Ensure the backlog or work unit includes a `## User Execution Test Scenarios` section when it
   changes runnable user-facing behavior, command behavior, workflow behavior, or TUI/browser
   behavior. The scenario must use a product surface, must be executable by command/tooling whenever
   feasible, must be designed for the post-implementation behavior, and must not be only an abstract
   review.
   Product surfaces include the Robota CLI command or local equivalent that invokes the same product
   binary, Robota TUI actions, Robota browser UI flows, and public SDK/example usage for SDK-only
   features. For `agent-cli` and command-package backlogs, prefer a Robota CLI or TUI action. For
   code-changing work, it must exercise the implemented code path rather than checking backlog or
   documentation text.
   Documentation-only, rule-only, skill-only, backlog-only, or governance-only changes must use the
   engineering test plan for verification and must not present document inspection as a user
   execution test scenario.
4. If the recommendation is coherent with rules and architecture, proceed. If not, stop and ask.
5. Use `branch-guard` before commits or branch changes.
6. For multi-backlog initiatives:
   - create or confirm the initiative base branch from `develop`;
   - create one child branch per backlog or split work unit;
   - open each child PR into the initiative base branch;
   - merge each child PR after checks pass;
   - open the final initiative PR into `develop`;
   - do not auto-merge the final `develop` PR.
7. Route detailed work to owner skills.
8. After implementation, confirm the scenario environment exists when a user execution test scenario
   applies. If it does not, build the missing fixture/demo/server/test harness when that is within
   the backlog scope, or stop for a user decision.
9. Execute the user execution test scenario as a final gate when command-line, file-system, HTTP,
   browser, TUI, or local-script execution is available. Run it against the completed implementation
   or delivered artifact. If it passes, update the backlog with the exact scenario, expected result,
   and observed evidence, then include the same runnable scenario in the user handoff. Without
   captured evidence recorded in the backlog, the gate does not pass. If it fails, keep working or
   ask for a decision. If the scenario is genuinely manual-only, label it as such and explain why it
   could not be executed. If no user execution test scenario applies, record the not-applicable reason
   and verification evidence, but do not include it in the user handoff as a user execution test
   scenario.
10. Ensure every PR body records recommendation, rationale, implementation summary, tests, user
    execution test scenario gate result or not-applicable reason, backlog evidence update when
    applicable, and residual risks.

## Owner Skill Routing

- Branch safety and protected branches: `branch-guard`
- Docs, backlog, ADR, or commit wording: `repo-writing`
- Impact, verification, and residual risk loop: `repo-change-loop`
- Contract boundary or package ownership change: `spec-first-development`
- SPEC authoring: `spec-writing-standard`
- SPEC/code drift after spec changes: `spec-code-conformance`
- Tests and red-green-refactor work: `tdd-red-green-refactor`
- Vitest strategy: `vitest-testing-strategy`
- Architecture/layering boundary: `architecture-patterns`
- Type contracts and trust boundaries: `type-boundary-and-ssot`
- Post-implementation release/docs checklist: `post-implementation-checklist`

Load only the owner skills needed for the current backlog or work unit.

## PR Body Requirements

Every child PR must include:

- accepted recommendation;
- rationale against backlog intent and architecture;
- implementation summary;
- tests and verification commands;
- user execution test scenario gate result, including exact command/UI steps, expected observable result,
  observed evidence, and where the backlog was updated with that evidence; or not-applicable reason
  when no runnable user-facing behavior changed;
- residual risks or skipped checks;
- next backlog or handoff note when relevant.

## Stop Conditions

- No recommendation gate was presented.
- A required runnable user-facing backlog has no user execution test scenario section.
- A user execution test scenario is abstract, lacks exact commands/UI steps, or lacks expected
  observable results.
- A code-changing backlog uses a documentation search, backlog review, or static text check as the
  user execution test scenario gate instead of exercising the implemented code.
- A user execution test scenario asks the user to run tests, harness commands, CI checks, or source
  inspection instead of executing the product behavior.
- A user execution test scenario uses internal repository verification instead of a product surface
  such as Robota CLI, TUI, browser UI, or public SDK/example usage.
- A documentation-only, rule-only, skill-only, backlog-only, or governance-only change presents
  document inspection as a user execution test scenario.
- The required test environment for the user execution test scenario is missing and was not built,
  proposed, or decided with the user.
- The user execution test scenario gate was not executed when it could reasonably be executed by the
  agent.
- The user execution test scenario gate has no captured evidence.
- The backlog was not updated with the observed user execution test scenario evidence after execution.
- The user execution test scenario gate fails or cannot be mapped to the completed behavior.
- The recommendation conflicts with rules, ownership, architecture, or backlog intent.
- The work combines unrelated backlogs in one PR.
- A child branch targets `develop` instead of the initiative base branch during a multi-backlog
  initiative.
- The final initiative PR would be auto-merged into `develop`.
- The final user handoff presents engineering or governance verification as a user execution test scenario.
- This skill would need to duplicate detailed instructions already owned by another skill.

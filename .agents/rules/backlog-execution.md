# Backlog Execution Rules

Mandatory rules for executing backlog-driven work through recommendation gates and focused PRs.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

## Recommendation Gate

Before starting each backlog or meaningful work unit inside a backlog, present a recommendation with
the reasoning needed to judge whether it should proceed.

The recommendation must include:

- the proposed implementation or documentation approach;
- why it matches the backlog intent;
- why it matches repository rules, layering, ownership, and architecture boundaries;
- affected packages, docs, or commands;
- the expected test and verification plan;
- the expected user test scenario plan, separate from agent/CI verification;
- any decisions that require the user instead of agent autonomy.

If the recommendation is coherent with repository rules, layering, architecture, and the backlog
intent, the agent may proceed with that recommendation. If the recommendation is weak, conflicts
with rules, changes ownership boundaries, introduces new dependency direction, or requires product
judgment, stop and ask the user for a decision.

## PR Unit Rule

- Treat one backlog as one PR by default.
- If a backlog is too large, split it into explicitly named work units before implementation; each
  work unit must have its own recommendation gate.
- Do not combine unrelated backlogs in one PR.
- Every PR description must include the accepted recommendation, rationale, implementation summary,
  tests run, user scenario gate result, and residual risks.

## User Test Scenario Rule

Every backlog that changes user-visible behavior, command behavior, workflow behavior, or
documentation for such behavior must include a user-facing test scenario section before
implementation starts.

User test scenarios are separate from the agent's engineering test plan:

- The engineering test plan covers unit, integration, type, harness, CI, build, and internal
  verification commands.
- The user test scenario describes the exact command or UI interaction a user can run after the work
  is complete to confirm the feature behaves as intended.

Each user test scenario must include:

- prerequisite state or sample setup;
- exact command lines, UI actions, or browser/TUI interactions in order;
- expected observable result, including exit code, output substring, visible UI state, or file
  change;
- any cleanup or reset step;
- whether the agent can verify the scenario directly, partially, or only by manual UI review;
- the concrete evidence the agent captured when running or reviewing the scenario.

Before declaring a backlog or work unit complete, the agent must execute the user test scenario as a
final gate whenever the scenario is command-line, file-system, HTTP, browser, or otherwise available
from the workspace. The gate passes only when the observed result matches the expected observable
result.

Evidence is mandatory. A user scenario gate without captured evidence does not pass. Evidence may be
command output, exit code, screenshot, log excerpt, rendered UI observation, changed-file diff, or
another concrete artifact that proves the expected observable result occurred.

Static review may not be used as a passing user scenario gate when an executable command, browser
flow, TUI flow, or local script can reasonably be run. If a scenario is genuinely manual-only, it
must be labeled `manual-only`, explain why it cannot be executed by the agent, and the PR must not
claim it passed by execution.

When the user scenario gate passes, the final user-facing response must tell the user that the
scenario is available to run, provide the concrete command or UI steps, and state the expected
result. If the scenario gate does not pass, the work is not complete and the agent must fix the
issue or ask for a decision.

## Base Branch Workflow

For a multi-backlog initiative:

1. Create an initiative base branch from `develop`.
2. For each backlog, create a child branch from the initiative base branch.
3. Open a PR from the child branch into the initiative base branch.
4. After checks pass and the PR content matches its recommendation gate, merge that PR into the
   initiative base branch.
5. Repeat until all backlog PRs are merged into the initiative base branch.
6. Open a final PR from the initiative base branch into `develop`.
7. Do not auto-merge the final PR into `develop`; leave that decision to the user.

## Layering Rule

Backlog implementation must preserve owner boundaries:

- `agent-cli` owns UI/TUI rendering, prompt intake, keyboard navigation, and local host adapter
  wiring.
- SDK/runtime or other lower owner packages own reusable contracts, lifecycle, state machines,
  storage policy, command behavior, and process/task semantics.
- Command packages expose user-visible commands through SDK/runtime contracts.
- Skills may orchestrate workflows, but they must not absorb detailed behavior owned by the skills
  or packages they invoke.

## Orchestration Skill Rule

An orchestration skill may coordinate other skills as a pipeline, but it must stay thin:

- It may select and sequence skills.
- It may enforce gates, PR order, and verification checkpoints.
- It may record status and handoff points.
- It must not duplicate the detailed procedures of invoked skills.
- It must not redefine mandatory rules.
- It must delegate package-specific, testing, branch, writing, architecture, and verification work
  to the relevant owner skills.

## Stop Conditions

- No recommendation gate was presented for the backlog or work unit.
- A required user-facing backlog lacks a user test scenario section.
- A user test scenario is abstract, lacks exact commands/UI steps, or lacks expected observable
  results.
- The user scenario gate was not executed when it could reasonably be executed by the agent.
- The user scenario gate has no captured evidence.
- The user scenario gate fails or cannot be mapped to the completed behavior.
- The recommendation conflicts with repo rules, layering, package ownership, or backlog intent.
- The work would combine unrelated backlogs into one PR.
- The final initiative PR would be auto-merged into `develop`.
- An orchestration skill duplicates implementation details from invoked skills instead of only
  coordinating them.

## Checklist

- [ ] Recommendation gate presented before work begins.
- [ ] Recommendation includes rationale, ownership, affected scope, engineering tests, user
      scenarios, and open decisions.
- [ ] Backlog includes user test scenarios when behavior is user-visible.
- [ ] PR scope maps to exactly one backlog or explicitly split work unit.
- [ ] User scenario includes exact commands or UI steps and expected observable results.
- [ ] User scenario gate was executed by the agent when executable.
- [ ] User scenario gate includes captured evidence; no evidence means no pass.
- [ ] Child PR targets the initiative base branch.
- [ ] Final initiative PR targets `develop` and is not auto-merged.
- [ ] PR description records the accepted recommendation, verification evidence, and user scenario
      gate result.

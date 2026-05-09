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
- the expected user execution test scenario plan when the backlog changes runnable user-facing
  behavior, or the not-applicable reason when it does not;
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
  tests run, user execution test scenario gate result or not-applicable reason, and residual risks.

## User Execution Test Scenario Rule

Every backlog that changes runnable user-facing behavior, command behavior, TUI/browser behavior, or
workflow behavior must include a `## User Execution Test Scenarios` section before implementation
starts.

User execution test scenarios are separate from the agent's engineering test plan:

- The engineering test plan covers unit, integration, type, harness, CI, build, and internal
  verification commands.
- A user execution test scenario is what the user can personally execute to see the product change
  working. It is not the agent's test command, CI command, unit test, harness command, or source
  inspection.
- The user execution test scenario describes the exact product command, UI interaction, browser
  flow, TUI flow, or public SDK/example flow a user can run after the work is implemented to confirm
  the implemented code or delivered artifact behaves as intended.
- A valid user execution test scenario must use a product surface. Product surfaces include the
  Robota CLI command or local equivalent that invokes the same product binary, Robota TUI actions,
  Robota browser UI flows, and public SDK/example usage for SDK-only features.
- For `agent-cli` and command-package backlogs, the default user execution test scenario surface is a
  Robota CLI or TUI action, such as `robota ...` or the repository-local command that invokes the
  same CLI entrypoint.
- For code-changing backlogs, the user execution test scenario must exercise the implemented code
  path. A documentation search, backlog review, or static text check may not be used as the user
  execution test scenario gate for code implementation work.
- For documentation-only, rule-only, skill-only, backlog-only, or governance-only changes that do
  not deliver runnable user-facing behavior, do not invent a user execution test scenario. Mark the
  user execution test scenario as not applicable and record verification evidence in the engineering
  test plan instead.
- If documentation changes describe a user procedure, any user execution test scenario must execute the
  documented procedure itself. It must not inspect the document to prove the document is well
  written.

Each user execution test scenario must include:

- prerequisite state, sample setup, fixture data, server startup, environment variables, or other
  test environment requirements;
- exact command lines, UI actions, or browser/TUI interactions in order;
- expected observable result, including exit code, output substring, visible UI state, or file
  change;
- any cleanup or reset step;
- whether the agent can verify the scenario directly, partially, or only by manual UI review;
- the evidence field that must be updated after implementation when the agent runs the scenario.

The planned user execution test scenario is part of the backlog before implementation starts. If
the scenario requires a test fixture, demo command, local server, test project, seed data, or other
environment that does not exist yet, the agent must either build that environment as part of the
backlog, propose it in the recommendation gate, or ask the user for a decision before proceeding. A
scenario that cannot realistically be run by the user after completion is not acceptable.

Before declaring a backlog or work unit complete, the agent must execute the user execution test
scenario as a final gate whenever the scenario is command-line, file-system, HTTP, browser, or
otherwise available from the workspace. The gate passes only when the observed result matches the
expected observable result, and only when the scenario was run against the completed implementation
or delivered artifact.

Evidence is mandatory. A user execution test scenario gate without captured evidence does not pass.
Evidence may be command output, exit code, screenshot, log excerpt, rendered UI observation,
changed-file diff, or another concrete artifact that proves the expected observable result occurred.
After running the scenario, the agent must update the backlog item with the observed evidence before
the backlog can be considered complete.

Static review may not be used as a passing user execution test scenario gate when an executable
command, browser flow, TUI flow, or local script can reasonably be run. If a scenario is genuinely
manual-only, it must be labeled `manual-only`, explain why it cannot be executed by the agent, and
the PR must not claim it passed by execution.

Document inspection, rule inspection, backlog inspection, source inspection, `rg` checks, harness
commands, unit tests, and other internal repository checks are engineering or governance
verification only. They must not be presented to the user as a user execution test scenario.

When the user execution test scenario gate passes, the final user-facing response must tell the user
that the scenario was verified, provide the concrete command or UI steps the user can run, state the
expected result, and summarize the evidence already observed by the agent. If the user execution
test scenario gate does not pass, the work is not complete and the agent must fix the issue or ask
for a decision.

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
- A required runnable user-facing backlog lacks a user execution test scenario section.
- A user execution test scenario is abstract, lacks exact commands/UI steps, or lacks expected
  observable results.
- A code-changing backlog uses backlog text review, documentation search, or other static review as
  the user execution test scenario gate instead of exercising the implemented code path.
- A user execution test scenario asks the user to run tests, harness commands, CI checks, or source
  inspection instead of executing the product behavior.
- A user execution test scenario uses internal repository verification instead of a product surface such
  as Robota CLI, TUI, browser UI, or public SDK/example usage.
- A documentation-only, rule-only, skill-only, backlog-only, or governance-only change presents
  document inspection as a user execution test scenario.
- The required test environment for the user execution test scenario is missing and was neither built,
  proposed, nor decided with the user.
- The user execution test scenario gate was not executed when it could reasonably be executed by the
  agent.
- The user execution test scenario gate has no captured evidence.
- The backlog item was not updated with the observed user execution test scenario evidence after execution.
- The user execution test scenario gate fails or cannot be mapped to the completed behavior.
- The recommendation conflicts with repo rules, layering, package ownership, or backlog intent.
- The work would combine unrelated backlogs into one PR.
- The final initiative PR would be auto-merged into `develop`.
- A final user response presents engineering or governance verification as a user execution test scenario.
- An orchestration skill duplicates implementation details from invoked skills instead of only
  coordinating them.

## Checklist

- [ ] Recommendation gate presented before work begins.
- [ ] Recommendation includes rationale, ownership, affected scope, engineering tests, user
      execution test scenarios or not-applicable reason, and open decisions.
- [ ] Backlog includes user execution test scenarios only when runnable user-facing behavior changes.
- [ ] PR scope maps to exactly one backlog or explicitly split work unit.
- [ ] User execution test scenario targets the completed implementation or delivered artifact, not
      backlog quality.
- [ ] User execution test scenario asks the user to execute product behavior, not tests or internal
      repository checks.
- [ ] User execution test scenario includes exact commands or UI steps, required environment setup,
      and expected observable results.
- [ ] Missing test environment for the user execution test scenario was built, proposed, or
      explicitly decided.
- [ ] User execution test scenario gate was executed by the agent against the completed work when
      executable.
- [ ] User execution test scenario gate includes captured evidence; no evidence means no pass.
- [ ] Backlog item records the observed user execution test scenario evidence after execution.
- [ ] Child PR targets the initiative base branch.
- [ ] Final initiative PR targets `develop` and is not auto-merged.
- [ ] PR description records the accepted recommendation, verification evidence, and user execution test scenario
      gate result or not-applicable reason.

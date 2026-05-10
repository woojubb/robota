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

### Agent Executability Requirement — MANDATORY

**Before writing a scenario, the agent must ask: "Can I execute this via Bash right now?"**

This question must be answered before the scenario is written, not after. The answer determines how
the scenario is written:

- **Yes — agent-executable:** Write the scenario with the exact Bash command. This is the default.
  Agent-executable scenarios use non-interactive CLI flags (`--version`, `--check-update`, `-p`,
  `--no-session-persistence`), pipe-friendly invocations, or scripted HTTP/file operations.
- **No — not agent-executable:** The scenario must be redesigned to be agent-executable before
  writing it. If a scenario requires interactive TTY (Ink raw mode), browser UI, hardware input, or
  another agent-inaccessible surface, the agent must first attempt to find an equivalent
  agent-executable path that exercises the same implemented code. Example: interactive TUI cannot be
  automated, but `--version` (module load), `-p` (CLI assembly), and `--check-update` (startup +
  shutdown) together cover the same code paths without requiring interactive input.
- **Genuinely not redesignable:** Only when no agent-executable equivalent exists may a scenario be
  labeled `manual-only:` with a specific technical reason (e.g., "Ink requires TTY raw mode which
  is unavailable in non-interactive agent execution"). This is the exception, not the default.

**Writing scenarios that the agent cannot execute is a process violation.** An unexecutable scenario
that is not labeled `manual-only:` at write time means the agent already knows the Done Gate Stage 2
will fail before implementation even begins. That is not acceptable — the scenario must be redesigned
first.

Each user execution test scenario must include:

- the agent-executability decision (`agent-executable` or `manual-only: <reason>`);
- prerequisite state, sample setup, fixture data, server startup, environment variables, or other
  test environment requirements;
- exact Bash command (for agent-executable) or exact UI steps (for manual-only) in order;
- expected observable result, including exit code, output substring, visible UI state, or file
  change;
- any cleanup or reset step;
- the evidence field that must be updated after implementation when the agent runs the scenario.

The planned user execution test scenario is part of the backlog before implementation starts. If
the scenario requires a test fixture, demo command, local server, test project, seed data, or other
environment that does not exist yet, the agent must either build that environment as part of the
backlog, propose it in the recommendation gate, or ask the user for a decision before proceeding. A
scenario that the agent cannot execute and has not labeled `manual-only:` is not acceptable.

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

**Done gate — ABSOLUTE RULE.** A backlog item with a `## User Execution Test Scenarios` section
must not have its status set to `done` (or equivalent completion marker) until BOTH gate stages
below pass. Setting `status: done` before both stages pass is a process violation with no exception
other than the explicit `manual-only` or `not-writable` exception documented in the scenario itself.

### Done Gate Stage 1 — Scenario Written

```
[ ] Every scenario is written with exact commands/steps, prerequisites,
    expected observable result, and an evidence field
```

Gate passes when every scenario is fully written.
Gate passes by exception only when writing is genuinely impossible AND a valid reason is recorded
explicitly under each unwritten scenario. An unwritten scenario with no stated reason does not pass.

### Done Gate Stage 2 — Scenario Executed

```
[ ] The agent directly executed every scenario against the completed implementation
[ ] The observed result matched the expected observable result for every scenario
[ ] Concrete evidence (command output, exit code, screenshot, log excerpt, diff, or another
    artifact) was recorded in the backlog file under the evidence field of every scenario
```

All three checkboxes must be `[x]` for the gate to pass.

Gate passes by exception only when execution is genuinely impossible AND a valid, specific reason
is stated explicitly under the scenario that could not be executed.

**The following are NEVER valid exception reasons and must not be cited as gate evidence:**

- Build succeeds
- Typecheck passes
- Lint passes
- Unit tests pass (any count)
- Harness checks pass
- CI checks pass
- Source inspection confirms the code is correct

**Why:** Build, typecheck, lint, and unit tests are completely unrelated to User Execution Test
Scenarios. They belong in `## Test Plan`. They verify that code compiles and internal logic is
correct. They have zero influence on whether a user can run the product and observe the expected
behavior. They must never be mentioned as User Execution gate evidence and they must not influence
whether the gate is considered passed.

If the scenario cannot be executed (genuinely manual-only or terminal-interactive-only), the item
must be labeled `manual-only` with the specific reason before status is set to `done`, and the PR
description must not claim the gate passed by execution.

Static review, document inspection, rule inspection, backlog inspection, source inspection, `rg`
checks, harness commands, unit tests, and other internal repository checks are engineering or
governance verification only. They must not be presented as user execution test scenario evidence.

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
- The backlog item status was set to `done` before evidence was recorded and the observed result
  confirmed (done-gate violation).
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

**Done Gate — must verify both stages before `status: done`:**

Stage 1 — Written:

- [ ] Every scenario is fully written (commands, prerequisites, expected result, evidence field)
      OR each unwritten scenario has a documented valid reason for why it could not be written

Stage 2 — Executed:

- [ ] The agent directly executed every scenario against the completed implementation
- [ ] The observed result matched the expected observable result for every scenario
- [ ] Concrete evidence was recorded in the backlog under each scenario's evidence field
      OR each unexecuted scenario has a `manual-only:` label with a documented valid reason

**NEVER cite as gate evidence:** build output, typecheck results, lint results, unit test counts,
harness results, CI results, source inspection. These are Test Plan items, completely unrelated
to User Execution Test Scenarios and have no influence on whether the gate passes.

- [ ] Child PR targets the initiative base branch.
- [ ] Final initiative PR targets `develop` and is not auto-merged.
- [ ] PR description records the accepted recommendation, verification evidence, and user execution
      test scenario gate result (both stages) or not-applicable reason.

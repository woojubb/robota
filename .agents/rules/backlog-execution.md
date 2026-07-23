# Backlog Execution Rules

Mandatory rules for executing backlog-driven work through recommendation gates and focused PRs.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

## Agent Decision Authority

When a decision must be made during backlog work, the agent must first determine whether it falls
within agent authority or requires user judgment.

**Agent authority — decide and proceed:**

The agent must form a recommendation with explicit reasoning and may act on it without asking the
user when ALL of the following hold:

- The decision follows clearly from existing project rules, architecture constraints, or repository
  conventions.
- A knowledgeable senior engineer reviewing the reasoning would reach the same conclusion.
- The decision does not change public API contracts, package ownership, dependency direction, or
  module boundaries in a way that requires cross-team coordination.
- The decision is reversible or has a low blast radius (e.g., internal cleanup, dead code removal,
  path constant extraction, naming fix).

When acting on agent authority, the agent must document the reasoning inline — in the backlog item,
PR description, or commit message — so the user can review and override if needed.

**User judgment required — stop and ask:**

The agent must stop and present options to the user when ANY of the following hold:

- The decision involves product direction, feature scope, or user-facing behavior that is not
  dictated by existing rules (e.g., "should this feature exist at all?").
- Multiple architecturally valid approaches exist and the choice has long-term structural impact.
- The decision changes a published or externally visible contract.
- The decision requires business, legal, or strategic judgment (e.g., telemetry opt-in consent,
  third-party service selection).
- The change introduces a practice this repository has not used before — a new workflow, tooling
  convention, file-placement pattern, or verification approach with no existing rule, skill, or
  precedent to point to.
- The change touches repository-wide policy files — lint configuration (`.eslintrc*`), CI
  workflows (`.github/workflows/`), git hooks, or workspace topology (root directories,
  `pnpm-workspace.yaml`, root `package.json` scripts) — even when the change is bundled inside an
  already-approved backlog. Backlog approval covers the backlog's stated scope, not policy files
  it happens to pass through. Backlog wording such as "consider adding X" authorizes evaluation
  and a recommendation, not the change itself.
- The change edits, moves, or deletes a user-authored document (a file the user personally wrote,
  e.g. reports or notes under `.design/`), unless the user has already given disposition for that
  document.

**Disclosure is not approval.** Mentioning a policy-file change or novel practice in a PR
description, commit message, or backlog note does not substitute for asking first. Approval must
be obtained before the change lands (2026-07-03 trust audit: three such changes shipped with
PR-body disclosure only; all required retroactive review).

**Never write "사용자 결정 필요" without first presenting a concrete recommendation.** Every
open decision in a backlog item must include the agent's recommendation and the reasoning behind it.
If the recommendation is sound, the agent may proceed. If genuinely uncertain, the agent presents
two to three options with trade-offs and asks the user to choose.

---

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
- open decisions within agent authority (with the agent's recommendation and reasoning) or, if
  genuinely outside agent authority, a clearly stated question with two to three concrete options.

If the recommendation is coherent with repository rules, layering, architecture, and the backlog
intent, the agent may proceed with that recommendation. If the recommendation is weak, conflicts
with rules, changes ownership boundaries, introduces new dependency direction, or requires product
judgment, stop and ask the user for a decision.

## One-Backlog-At-A-Time Rule (mandatory, zero exceptions)

**Finish one backlog completely before starting the next.**

The sequence is:

1. Complete all implementation, tests, and verification for the current backlog.
2. Commit every changed file — the working tree must be clean (`git status` shows no modified or
   staged files) before creating the PR.
3. Open the PR, merge it into `develop` (or the initiative base branch).
4. Only after the PR is merged may the next backlog begin.

**Violations:**

- Starting a new backlog while the current backlog's PR is open or unmerged → stop, merge first.
- Leaving uncommitted files (modified, staged, or newly tracked) after declaring a backlog done →
  stop, commit or discard them before opening the PR.
- Combining work from two separate backlogs in one PR → not allowed unless the backlogs were
  explicitly split into a single named work unit before implementation began.

**Automated enforcement:** `scripts/harness/pre-push.mjs` calls `assertCleanWorkingTree()` at
startup. Any push with modified or staged uncommitted files is blocked with exit code 1.

## PR Unit Rule

- Treat one backlog as one PR by default.
- If a backlog is too large, split it into explicitly named work units before implementation; each
  work unit must have its own recommendation gate.
- Do not combine unrelated backlogs in one PR.
- **This default is not an anti-batching rule.** A single coherent work-unit (one design-gate pass,
  one authoring pass, a rule + its enforcement + its wiring) belongs in ONE multi-commit PR — do not
  split it into many tiny PRs that each wait on a full CI run. Bundle by coherence + a soft size ceiling
  (~600 changed lines / ~15 files); see the [PR Batching policy](git-branch.md) (DX-001) in `git-branch.md`
  for the exact criteria. The line: **unrelated backlogs → separate PRs; related steps of one unit →
  one PR.**
- **Sequence by relatedness.** Decide the execution shape from whether items share files or contracts:
  items that touch the **same files/contracts are related — serialize them** (one ordered unit, or
  sequential PRs on the same seam) so reviews and merges do not interleave or conflict. Items that are
  **genuinely disjoint are unrelated — deliver them as separate PR units** and let their read-only work
  (audits, reviews, independent analyses) fan out in parallel. Parallelism applies to that read-only
  fan-out and to independent PR _units_, **not** to concurrently-open feature branches — the
  [One-Branch-At-A-Time rule](git-branch.md) still holds: branches are created and merged one at a time
  to avoid divergence. So: related → serial; unrelated → separate units, still merged in sequence.
- Every PR description must include the accepted recommendation, rationale, implementation summary,
  tests run, user execution test scenario gate result or not-applicable reason, and residual risks.

## User Execution Test Scenario Rule

Every backlog that changes runnable user-facing behavior, command behavior, TUI/browser behavior, or
workflow behavior must include a `## User Execution Test Scenarios` section before implementation
starts.

**Script home (INFRA-023)**: disposable live-verification scripts (evidence runs, repro probes)
live in `scratch/src/` — a gitignored workspace home whose committed skeleton resolves
`@robota-sdk/*` imports. Never park them inside `packages/` or `apps/`; the
`temp-script-placement` harness scan blocks temp-pattern files there.

User execution test scenarios are separate from the agent's engineering test plan:

- The engineering test plan covers unit, integration, type, harness, CI, build, and internal
  verification commands. A user execution test scenario is what the user can personally execute to
  see the product change working — never any of those (authoritative statement: Done Gate Stage 2).
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

### Capability Reachability — no library-seam "N/A" dodge — MANDATORY

When a backlog delivers a **user-facing capability** (something a user would experience — e.g. memory,
retrieval, a new tool or mode) but the slice implements only a neutral **library seam** that no product
surface yet enables, the user-execution gate **must not** be marked "not applicable." A user-facing
capability is not done until it is BOTH:

1. **Reachable via a product surface** — some surface (CLI/TUI/app/public-SDK) actually turns the seam on
   (injects/enables it), so a user can reach the behavior; and
2. **Verified by an AGENT-RUN end-to-end scenario the agent executes itself** — the agent drives the real
   product surface with a real provider, exercises the capability end-to-end, and captures the evidence.
   The agent never delegates this run to the user (see the Agent Executability Requirement below and the
   agent-owned-verification principle).

The spec/backlog **PLAN must include the surface-wiring + the agent-run verification step from the start.**
Splitting surface-wiring into a later slice is allowed, but an intermediate **library-only** slice records
its engineering evidence and **names the still-pending agent-run verification** — it must NOT claim the
capability "done," and the capability's epic is not COMPLETE until the agent-run verification passes. (This
closes the loophole where a library seam no surface enables silently marks the user-execution gate N/A —
the exact gap that let SELFHOST-008 memory ship OFF in the real agent, unverified end-to-end.)

**Mechanical floor (HARNESS-030).** A capability spec DECLARES itself with three frontmatter keys —
`capability: true`, `user_execution: agent-run | manual | none`, and (for `agent-run`)
`user_execution_scenario: <path>` naming the evidence file EXPLICITLY. `scan-capability-reachability.mjs` (in
`run-all-scans`) then enforces, over `.agents/spec-docs/done/`: a `capability: true` spec MUST NOT record
`user_execution: none`/omit it (no N/A dodge), and a `capability: true` + `user_execution: agent-run` spec MUST
name a `user_execution_scenario:` path that EXISTS. The reference is an explicit path, NOT a name/base-ID
guess — a spec's evidence may live under a differently-named scenario (e.g. SEC-001's evidence is the GUI-007
scenario file). `check-spec-doc-frontmatter.mjs` documents all three keys as recognized optional frontmatter.
The floor is opt-in — the scan never GUESSES which spec is a capability (that semantic call, and "is the seam
truly reachable," stay with the GATE-COMPLETE reviewer); it fences the recurrence once the capability is
declared. Set these keys on every user-facing capability spec (add `user_execution_scenario:` for agent-run).

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

**Durable-artifact evidence rule (HARNESS-002).** For code-changing backlogs, evidence MUST
reference durable artifacts — test file paths that exist in the repository. Evidence sections of
completed backlogs are continuously re-validated by `pnpm harness:scan:done-evidence`
(`scripts/harness/check-done-evidence.mjs`, part of the `harness:scan` aggregate): a referenced
repo file that no longer exists fails the scan. When a later refactor legitimately retires a
referenced artifact, annotate the reference with `<!-- evidence-superseded: <reason> -->` on the
same or the preceding line — exemptions are reported on every run, never silent.

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

**Capability-absence claims require a probe.** "The environment lacks X" (an API key, credential,
tool, or device) is not a valid exception reason unless the agent actually probed for it and records
the probe as evidence (e.g. which env vars / `.env` files / settings surfaces were checked and what
they contained). An unprobed absence claim is a guess, not a reason — the one time it was written
without a probe, the capability existed and the skipped live run would have caught a real bug that
every unit and integration test missed (ANALYTICS-001, 2026-07-02).

**Engineering verification is NEVER User-Execution evidence (authoritative statement).** Build,
typecheck, lint, unit tests (any count), harness checks, CI checks, static/document/backlog/source
inspection, and `rg` checks are engineering or governance verification: they belong in `## Test Plan`,
have zero influence on whether a user can run the product and observe the expected behavior, and must
never be cited as gate evidence, exception reasons, or in a final response as user execution test
scenario evidence. Every other mention of this rule in this file, in checklists, and in
`common-mistakes.md` #56 refers back to this statement.

If the scenario cannot be executed (genuinely manual-only or terminal-interactive-only), the item
must be labeled `manual-only` with the specific reason before status is set to `done`, and the PR
description must not claim the gate passed by execution.

When the user execution test scenario gate passes, the final user-facing response must tell the user
that the scenario was verified, provide the concrete command or UI steps the user can run, state the
expected result, and summarize the evidence already observed by the agent. If the user execution
test scenario gate does not pass, the work is not complete and the agent must fix the issue or ask
for a decision.

## Scenario Design Preference Order (mandatory for new scenarios)

When authoring `## User Execution Test Scenarios`, choose the verification surface in this
order:

1. **Provider-free product observables** — exit codes, created files, provider-free commands
   (e.g. `robota diagnose`, `robota init`, direct command output).
2. **Fixtures built by the work itself** — local mock servers, sample projects, seeded settings
   the implementation ships with (worked example: CLI-058's in-repo mock MCP server made the
   entire scenario machine-executable).
3. **Live-credential runs only when the verified behavior is inherently provider-coupled** —
   and then the scenario MUST state the credential prerequisite explicitly so an executor
   without keys knows the gate cannot run in that environment (counter-example: CLI-053's
   live-LLM transcript step was unexecutable in the implementing environment).

A scenario whose only observable requires credentials the executor may not have is a design
smell — restructure toward 1 or 2 before falling back to 3.

## Completion Steps

When all gates pass and the work is fully done, follow these steps **in order**:

1. **Update frontmatter** — set `status: done` and add `completed: YYYY-MM-DD` to the backlog
   file's frontmatter. For items that will not be implemented, use `status: wontfix` or
   `status: skipped` instead.
2. **Move the file** — `git mv .agents/backlog/<file>.md .agents/backlog/completed/<file>.md`.
3. **Single commit** — include the frontmatter update and the `git mv` in the same commit.
   Do not commit or push before both the status update and the move are staged together.

### Status Invariants

- Frontmatter `status:` is the **only** place status is recorded. Body sections such as
  `## Status` are banned and must not be written.
- A file may not reside in `completed/` with `status: todo` or `status: in-progress`.
- A file may not have `status: done` while still in the `backlog/` root.
- `status: done` must not be set before the User Execution Test Scenario gate passes (Stage 2).
- `wontfix`, `skipped`, and `superseded` are valid terminal statuses for items that were
  deliberately not implemented.
- **Mechanized:** the `backlog-placement` scan (`scripts/harness/check-backlog-placement.mjs`, in
  `pnpm harness:scan`) fails on a terminal-status file in the root, an open-status file in
  `completed/`, or `status: done` without a `completed:` date. The `task-archival` scan additionally
  fails a fully-checked task file whose spec never reached `spec-docs/done/` (gates overdue). These
  invariants held only as prose until 2026-07-02, when 8 shipped items were found with stale
  placement — closing the loop (evidence, status, move, gates) happens in the SAME change as the
  work, and a "tracked as follow-on" claim must name an existing backlog/task file.

### Common Mistakes to Avoid

| Mistake                                                                | Correct action                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Moving file to `completed/` before updating `status:` in frontmatter   | Update frontmatter first, then `git mv`                             |
| Leaving `status: done` in frontmatter but file still in `backlog/`     | Move with `git mv` immediately after the status update              |
| Splitting the status update and the move into separate commits         | Stage both changes and commit together                              |
| Writing `## Status` section in body instead of using frontmatter       | Use frontmatter `status:` field only                                |
| Setting `status: done` before user execution test scenario gate passes | Run the scenario, record evidence, then set done                    |
| Copying (not moving) to `completed/`, leaving a duplicate in root      | Always use `git mv` — never `cp`. Root must have no duplicate files |

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
- A scenario uses engineering/governance verification (static review, tests, harness commands, CI
  checks, source or document inspection) instead of a product surface — see the authoritative
  statement in Done Gate Stage 2.
- The required test environment for the user execution test scenario is missing and was neither built,
  proposed, nor decided with the user.
- The gate was not executed when the agent reasonably could, has no captured evidence, or the
  observed evidence was not recorded back into the backlog item.
- The backlog status was set to `done` before both Done Gate stages passed (done-gate violation),
  or the gate fails / cannot be mapped to the completed behavior.
- The recommendation conflicts with repo rules, layering, package ownership, or backlog intent.
- The work would combine unrelated backlogs into one PR.
- The final initiative PR would be auto-merged into `develop`.
- An orchestration skill duplicates implementation details from invoked skills instead of only
  coordinating them.

## Checklist

- [ ] Recommendation gate presented before work begins.
- [ ] Recommendation includes rationale, ownership, affected scope, engineering tests, user
      execution test scenarios or not-applicable reason, and open decisions.
- [ ] Backlog includes user execution test scenarios only when runnable user-facing behavior changes.
- [ ] PR scope maps to exactly one backlog or explicitly split work unit.
- [ ] User execution test scenario targets the completed implementation or delivered artifact via a
      product surface (not tests, internal repository checks, or backlog quality).
- [ ] User execution test scenario includes exact commands or UI steps, required environment setup,
      and expected observable results.
- [ ] Missing test environment for the user execution test scenario was built, proposed, or
      explicitly decided.

**Done Gate — must verify both stages before `status: done`** (full stage definitions and the
authoritative never-cite-engineering-verification statement are in the Done Gate sections above):

- [ ] Stage 1 — every scenario fully written (commands, prerequisites, expected result, evidence
      field) OR a documented valid reason per unwritten scenario
- [ ] Stage 2 — every scenario directly executed by the agent against the completed implementation,
      observed result matched, and concrete evidence recorded OR a `manual-only:` label with a
      documented valid reason

- [ ] Child PR targets the initiative base branch.
- [ ] Final initiative PR targets `develop` and is not auto-merged.
- [ ] PR description records the accepted recommendation, verification evidence, and user execution
      test scenario gate result (both stages) or not-applicable reason.

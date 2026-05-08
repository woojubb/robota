# CLI AI Workflow Harness Evolution Plan

## Status

Backlog.

## Created

2026-05-09

## Priority

P0 - strategic product direction for turning `agent-cli` into a complete AI agent assistant control
surface.

## Problem

AI workflows work only when the repository is legible, repeatable, and measurable. Today the CLI can
drive conversations and commands, but a user's repository still has to supply a lot of harness
discipline manually: task framing, setup detection, verification command selection, artifact capture,
background task supervision, review evidence, and follow-up loops.

The broader product goal is for `agent-cli` to feel like a complete AI agent assistant for serious
software work: it should understand the repo, help define work, run the harness, manage background
agents, show evidence, coordinate review, remember artifacts, and hand off cleanly to Git/CI.

The goal is still not to make `agent-cli` own all of that behavior. The CLI should be the TUI and
command surface. Reusable workflow contracts, harness discovery, execution state, artifacts, and
closed-loop evaluation must live below the CLI in SDK/runtime/harness owner packages.

## Product Vision

`agent-cli` should become the local cockpit for an AI-native software factory.

Complete means:

- **Repo-native**: understands each repository through versioned instructions, specs, harness
  manifests, package ownership, and task history.
- **Workflow-native**: turns a request into a traceable loop of plan, spec/test intent,
  implementation, verification, diagnosis, fix, review, and archive.
- **Harness-native**: can discover, explain, run, and record the repository's real checks instead of
  guessing commands from package metadata alone.
- **Agent-native**: manages main-thread work, background agent tasks, shell jobs, and verification
  jobs through one execution workspace.
- **Review-native**: produces diff, evidence, risk, and PR summaries that a human can approve without
  rereading the whole session transcript.
- **Safety-native**: respects permissions, hooks, branch policy, destructive-action gates, and
  repo-defined stop conditions.
- **Context-native**: captures durable artifacts so later turns and agents can query what happened,
  why decisions were made, and what evidence exists.
- **Cost-aware**: treats tokens as leverage, shows spend and waste, and helps the user decide when to
  spend more for better evidence.
- **Extensible**: lets teams package repeated workflows as skills, commands, hooks, and harness
  recipes.

## Source Article Summary

Primary source: Josh's newsletter, "Y Combinator says the most reliable way to build an AI-native
company" (`https://maily.so/josh/posts/knrj12e7rld`), published 2026-05-06.

Key principles extracted for Robota:

- Treat AI as an operating layer for the work, not as a small productivity add-on.
- Convert important processes into closed loops: decide, execute, measure, learn, and adjust.
- Make the organization, or in Robota's case the repository, legible and queryable by AI.
- Give models enough context to perform like a capable teammate, not a narrow autocomplete tool.
- Build a software factory where humans define specs and success tests, then agents implement and
  iterate until the harness passes.
- Keep humans responsible for choosing the goal and judging the result.
- Optimize for token leverage and throughput, not only for reducing API spend.
- The founder/operator must use the workflow directly; the operating model cannot be delegated
  before the leader understands it.

## Persona Note

Do not impersonate the newsletter author or any named person. When this backlog is promoted, create
an `AI Native Workflow Reviewer` agent profile or skill that is inspired by the article's principles:
closed loops, high context, software-factory discipline, token leverage, and founder/operator
accountability.

The agent should critique Robota workflows using those principles without claiming to be Josh, YC, or
Diana Hu.

## Prior Art Research

- OpenAI Codex use cases document repeatable workflows such as creating a CLI an agent can use,
  running verified operations, saving workflows as skills, code review, bug triage, and scored
  improvement loops: <https://developers.openai.com/codex/use-cases>
- OpenAI Codex `AGENTS.md` docs define repository instructions as project context loaded from the
  repo path, reinforcing that agent workflow quality depends on repo-owned instructions:
  <https://developers.openai.com/codex/guides/agents-md>
- OpenAI Codex non-interactive mode emphasizes explicit sandboxing, automation permissions, and
  Git-repository safety checks: <https://developers.openai.com/codex/noninteractive>
- OpenAI Codex GitHub Action positions repeatable agent tasks as CI workflow steps that can review
  PRs, run release prep, or gate quality checks: <https://developers.openai.com/codex/github-action>
- Claude Code hooks provide deterministic control points for session start, prompt submit, tool use,
  compaction, and environment setup; hook output can add context or block unsafe actions:
  <https://code.claude.com/docs/en/hooks>
- Cursor background agents expose async agents with a sidebar/status surface, follow-ups, takeover,
  isolated environments, setup commands, terminal processes, and explicit security tradeoffs:
  <https://docs.cursor.com/en/background-agents>
- Cursor modes separate autonomous editing, read-only planning, manual editing, and custom workflows:
  <https://docs.cursor.com/agent>
- Cursor review docs emphasize human review of generated diffs before accepting changes:
  <https://docs.cursor.com/en/agent/review>
- Jules runs coding tasks in a VM, clones the repo, installs dependencies, produces a plan before
  changes, reads `AGENTS.md`, and notifies users when tasks need input:
  <https://jules.google/docs>
- Jules Tools adds a terminal dashboard and remote-session commands for listing sessions, creating
  parallel sessions, pulling results, and reviewing diffs: <https://jules.google/docs/cli/reference/>

Common pattern:

AI coding tools that support reliable workflows provide repo-readable instructions, deterministic
setup/hooks, explicit execution environments, async task visibility, review gates, non-interactive
automation, and structured artifacts that can feed the next loop.

## Recommended Direction

Build `agent-cli` into an AI workflow control surface for a repository-local software factory. The
CLI should make the loop visible and ergonomic, while owner packages provide the reusable behavior.

Recommended feature pillars:

1. **Repository legibility bootstrap**
   - Add a workflow that scans a repo for package manager, test commands, build commands, CI config,
     docs, `AGENTS.md`, task/backlog files, and known harness entrypoints.
   - Produce a versioned workflow manifest the agent can read before starting work.
   - Surface gaps as actionable setup tasks, not as hidden prompt assumptions.

2. **Harness command registry**
   - Let a repo declare canonical commands for build, test, lint, typecheck, docs, release checks,
     smoke tests, visual checks, and custom domain checks.
   - The CLI should render and run these commands, but command discovery and execution contracts
     should be SDK/harness-owned.
   - Support dry-run, scoped runs, dependency expansion, timeout, retry policy, and required evidence
     capture.

3. **Spec-and-test-first task intake**
   - Provide a task wizard that turns a user request into goal, owner package, governing SPEC/API
     document, success criteria, failing-test plan, verification commands, and stop conditions.
   - Block implementation mode when the task changes a contract but no owner spec/test plan exists.
   - Keep the user in the role of goal setter and result judge.

4. **Closed-loop execution workspace**
   - Extend the existing execution workspace model into a general workflow loop: plan, implement,
     verify, diagnose, retry, review, archive.
   - Each loop iteration should capture artifacts: plan, changed files, command outputs, failing
     signatures, fixes attempted, final evidence, and open risks.
   - The CLI should show the loop state and let the user switch between main work, background jobs,
     harness runs, and agent tasks.

5. **Background workflow dashboard**
   - Build on the existing background switcher so shell tasks, harness runs, and agent tasks share a
     single list/detail UI.
   - Show status, current command, latest output, elapsed time, cost/tokens, files touched, and
     whether user input is needed.
   - Allow follow-up prompts, cancellation, takeover, and result pull/apply flows.

6. **Deterministic workflow hooks**
   - Add repo-defined hooks for session start, prompt submit, before command, after command,
     before commit, before merge, after verification, and stop/continue decisions.
   - Hooks should be able to inject context, block unsafe actions, or request one more verification
     pass.
   - Keep hook semantics deterministic and testable; do not depend on the model remembering to run
     checks.

7. **Review and evidence gate**
   - Add a CLI review mode that groups diffs by package/owner, shows why each file changed, links to
     verification evidence, and records explicit accept/reject decisions.
   - Generate PR summaries from structured artifacts instead of free-form memory.
   - Support "no merge until evidence exists" policies for repositories that opt in.

8. **Environment setup profiles**
   - Let repos describe install/start/watch/test services in a manifest similar in spirit to remote
     agent environment specs.
   - Show environment readiness before a task starts.
   - Persist safe environment changes per session without hiding them from the user.

9. **Token and cost leverage telemetry**
   - Track token spend, model choice, cached context, retry loops, and command time per workflow.
   - Report cost as workflow leverage: what was attempted, what evidence was produced, and where
     waste happened.
   - Add budget alerts without making low token spend the main optimization target.

10. **Workflow packaging**
    - Let teams save repeated loops as skills/workflows: release prep, bug triage, package audit,
      dependency upgrade, docs sync, code review, and security pass.
    - Workflows should declare required context, commands, hooks, output artifacts, and verification
      gates.

## Architecture Ownership

`agent-cli` must remain a product shell:

- owns TUI screens, keyboard navigation, prompt intake, review UI, and local host adapter wiring;
- does not own durable workflow state, command semantics, harness discovery, hook policy, task
  retention, or artifact schema.

Likely lower-level owners:

- `agent-sdk`: public workflow session APIs, task intake contracts, command/hook facades, artifact
  readers, review summary APIs.
- `agent-runtime`: execution workspace lifecycle, background task lifecycle, cancellation, runners,
  task state machines, event streams.
- new or existing harness owner package/spec: repo harness manifest schema, command registry,
  verification evidence model, hook contract.
- `agent-command-*`: user-visible slash commands such as workflow status, harness run, review,
  task intake, and workflow packaging.
- `agent-cli`: render the workflow dashboard, task wizard, review mode, and local setup adapters.

Before implementation, update the architecture map and owner SPEC files using the document authority
rules in `.agents/rules/spec-workflow.md`.

## Suggested Backlog Slices

1. Research and design the `AI Native Workflow Reviewer` agent profile.
2. Define repository workflow manifest and harness command registry contracts.
3. Add SDK/runtime workflow artifact and execution-loop read models.
4. Add CLI workflow dashboard over SDK/runtime projections.
5. Add spec-and-test-first task intake command.
6. Add deterministic workflow hook contracts and repo hook execution.
7. Add review/evidence gate and PR summary generation.
8. Add environment setup profiles and readiness UI.
9. Add token/cost leverage telemetry.
10. Add workflow packaging for reusable repo-local loops.

## Acceptance Criteria

- [ ] Backlog promotion starts with a design document that cites the source article and prior-art
      docs above.
- [ ] The recommended implementation explicitly separates CLI UI from SDK/runtime/harness
      ownership.
- [ ] A repo can declare canonical harness commands and the CLI can run them through owner APIs.
- [ ] Every workflow run produces structured artifacts that can be queried by a later agent turn.
- [ ] The CLI can show active and completed shell tasks, harness runs, and agent tasks in one
      workflow dashboard.
- [ ] The user can review diffs with linked verification evidence before accepting changes.
- [ ] Hooks can inject context or block unsafe workflow steps deterministically.
- [ ] Token/cost telemetry is visible at the workflow level.

## Verification Plan

- Architecture/spec review for owner placement before code.
- Contract tests for workflow manifest parsing, harness command registry, hook decisions, artifact
  persistence, and execution workspace projections.
- CLI TUI tests for task intake, workflow dashboard, background switching, review mode, and
  cancellation/follow-up flows.
- Scenario tests proving a full loop: request -> spec/test plan -> implementation -> harness run ->
  failure diagnosis -> fix -> evidence summary -> review.

## Promotion Path

Move this backlog into `.agents/tasks/` only after choosing the first slice. Recommended first task:
research/design the workflow reviewer and manifest contracts, then update owner SPEC files before
implementing CLI UI.

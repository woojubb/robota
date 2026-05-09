# Transparent Repo-Agnostic Workflow Client Planning for agent-cli

## Status

Backlog.

## Created

2026-05-09

## Priority

P0 - umbrella planning backlog for making `agent-cli` a transparent, repo-agnostic workflow client
without making user repositories depend on Robota.

## Request

Plan how `agent-cli` should evolve so AI workflows run well inside a user's repository while the
repository remains fully independent from `agent-cli`.

The core question is:

> If the user owns the harness and the repository must work without Robota, what basic repo context,
> process execution, background state, and user-local memory infrastructure should `agent-cli`
> provide so the user can predict what Robota will do and trust it to act on the user's intent?

This umbrella backlog splits the work into focused backlog documents that keep the same backlog
shape and can later become independent implementation PRs.

## Non-Negotiable Product Principles

- **Repo owns the harness.** Build, test, lint, typecheck, release, docs, smoke, visual, and custom
  checks belong to the user repository.
- **The repo must work without `agent-cli`.** A human, CI job, another agent, or a shell can run the
  same harness without Robota being installed.
- **`agent-cli` must not inject harness files.** No automatic Robota manifest, CI patch,
  `.agents/`, `.robota/`, task file, script, package dependency, or hook installation is allowed as
  part of basic operation.
- **Command choice is user-directed.** `agent-cli` must not infer a repository harness contract,
  rank likely commands, or present a guessed command catalog as default product behavior.
- **Transparency is part of correctness.** A feature is incomplete if the user cannot tell what
  Robota is doing, why a state changed, what source produced a shown item, or how to inspect/remove
  remembered local state.
- **Local memory is user-local only.** Baseline memory must be stored outside the repository. No
  workspace-local ignored state, repo-side cache, or tracked repo file is allowed for baseline
  memory.
- **Advisory repo inspection is explicit.** If a user asks Robota to inspect docs, scripts, CI, or
  failures, that is an explicit advisory task, not baseline CLI behavior.

## Source Article Summary

Primary source:

- Josh's newsletter, "Y Combinator says the most reliable way to build an AI-native company",
  published 2026-05-06: <https://maily.so/josh/posts/knrj12e7rld>

Important principles to carry into Robota:

- AI should be treated as an operating layer for work, not a small productivity add-on.
- Important work should become a closed loop: decide, execute, measure, learn, and adjust.
- The repository must be legible and queryable by AI through repo-owned instructions, specs,
  commands, evidence, and decisions.
- Humans remain responsible for choosing goals and judging whether the result is good enough.
- Token spend should be optimized as leverage and throughput, not only minimized as cost.

Robota interpretation:

- Robota should help the user operate a mature repo well, but should not become the source of the
  repo's harness structure.
- The primary product goal is predictable assistance. Robota should have strong basic capabilities,
  but hidden automation and unclear state transitions are product failures.

## Prior Art To Study

- OpenAI Codex use cases: repeatable workflows, PR review, visual checks, integrations, and saved
  workflows: <https://developers.openai.com/codex/use-cases>
- OpenAI Codex `AGENTS.md`: repository-owned instructions loaded before work begins:
  <https://developers.openai.com/codex/guides/agents-md>
- OpenAI Codex non-interactive mode: automation, sandboxing, and repository safety:
  <https://developers.openai.com/codex/noninteractive>
- OpenAI Codex GitHub Action: agent workflows as CI/release/review steps:
  <https://developers.openai.com/codex/github-action>
- Claude Code hooks: deterministic lifecycle control points for user-defined shell/HTTP/LLM hooks:
  <https://code.claude.com/docs/en/hooks>
- Cursor Background Agents: async agent status, follow-ups, takeover, isolated environments,
  install/start/terminal setup, and security tradeoffs:
  <https://docs.cursor.com/en/background-agents>
- Jules Tools CLI: remote session list/new/status/pull style workflow for delegated agent sessions:
  <https://jules.google/docs/cli/reference/>

## Neutral Reviewer Profile

Name: `Repo Workflow Client Reviewer`

Important: this profile must not impersonate Josh, YC, Diana Hu, OpenAI, Anthropic, Cursor, Google,
or any named person/company. It should be an original Robota reviewer inspired by the article's
principles: closed loops, high context, software-factory discipline, token leverage, and operator
accountability.

Reviewer role:

- Inspect a proposed `agent-cli` workflow feature.
- Reject designs that require the user's repo to depend on Robota.
- Reject baseline designs that infer, rank, or own repo commands.
- Reject baseline designs that perform evidence judgment, failure diagnosis, repair loops, review
  gates, hook installation, or repo workflow orchestration.
- Check whether command origin, background status, memory usage, and UI state are visible enough for
  a user to predict behavior.
- Recommend the smallest non-invasive client implementation slice.

## Split Backlog Items

- [Transparent workflow contract](completed/cli-transparent-workflow-contract.md) (completed):
  action provenance, named states, memory inspection, and UI disclosure rules shared by all
  baseline workflow features.
- [User-local storage foundation](completed/cli-user-local-storage-foundation.md) (completed):
  canonical user-local-only storage root, category contracts, inspection/removal APIs, and
  repo-outside validation.
- [Transparent process execution](completed/cli-transparent-process-execution.md) (completed):
  running user-supplied commands with visible origin, cwd, environment summary, output,
  cancellation, and terminal result.
- [Background work state management](completed/cli-background-work-state-management.md) (completed):
  switchable main thread, shell job, and agent task state with transparent lifecycle and retention
  behavior.
- [User-local memory transparency](completed/cli-user-local-memory-transparency.md) (completed):
  cwd, view preference, and task association storage that is inspectable, removable, and stored
  outside the repository.
- [Repository situational awareness](completed/cli-repository-situational-awareness.md) (completed):
  passive display of current working context without command inference, repo scanning, or
  package-manager guessing.

## Expected Outcomes

- Work can be promoted as focused PRs instead of one oversized CLI feature.
- Every focused backlog inherits the same repo-agnostic and transparent behavior rules.
- `agent-cli` becomes more capable at the moment the user tries to act, while avoiding hidden repo
  inference or Robota-owned harness structure.
- SDK/runtime ownership is established before TUI work, reducing the risk that `agent-cli` becomes
  the owner of workflow semantics.
- Later review can evaluate each capability independently: transparency contract, process
  execution, background state, user-local storage, local memory, and repo context display.

## Architecture Ownership Rule

`agent-cli` owns only TUI screens, keyboard navigation, prompt intake, task list rendering, and local
host adapter wiring.

Lower owners must be established first:

- `agent-runtime`: process lifecycle, background task lifecycle, cancellation, output streams,
  named status transitions, retention windows, and task state machines.
- `agent-sdk`: stable APIs for repo context display, process execution requests, background task
  projections, action provenance, local preference inspection/removal, and session-state access.
- `agent-command-*`: user-visible commands for run/status/task switching/preference inspection,
  backed by SDK/runtime contracts.

Do not implement durable workflow state, repo manifest parsing requirements, command semantics,
retention policy, artifact schema, evidence judgment, review policy, or hook policy inside
`agent-cli`.

Do not require a Robota manifest or Robota package dependency in user repositories.

## Recommended First Slice

Promote the split backlogs in this order:

1. `completed/cli-transparent-workflow-contract.md`
2. `completed/cli-user-local-storage-foundation.md`
3. `completed/cli-transparent-process-execution.md`
4. `completed/cli-background-work-state-management.md`
5. `completed/cli-user-local-memory-transparency.md`
6. `completed/cli-repository-situational-awareness.md`

Each implementation PR should update the owning package specs before changing `agent-cli` UI.

## Acceptance Criteria

- [ ] The umbrella backlog links every focused backlog item.
- [ ] The planning document cites the source article and prior-art docs.
- [ ] The reviewer profile is inspired by the article but does not impersonate a named person.
- [ ] The plan clearly states that user repos own their harness and must not depend on Robota.
- [ ] The plan clearly separates CLI UI from SDK/runtime ownership.
- [ ] The plan forbids automatic repo injection of Robota manifests, hooks, scripts, package
      dependencies, or CI changes.
- [ ] The plan forbids baseline command discovery, evidence judgment, failure diagnosis, repair
      loops, review gates, readiness scoring, and hook ownership.

## Test Plan

- Add document-link validation for every split backlog item referenced by the umbrella backlog and
  `README.md`.
- Add document authority checks that fail if implementation details are placed only in `agent-cli`
  without SDK/runtime ownership.
- For each focused backlog promoted to implementation, require package-level contract tests before
  TUI rendering tests.
- Include at least one fixture repository with no Robota files and no Robota local state inside the
  repo to verify that the planned behavior remains repo-agnostic.

## Verification Plan

- `pnpm harness:scan`
- Document authority scan must pass when this backlog is later promoted.
- Implementation PRs must add contract tests before TUI screens.
- Tests must include repos without Robota files to prove the client remains repo-agnostic.

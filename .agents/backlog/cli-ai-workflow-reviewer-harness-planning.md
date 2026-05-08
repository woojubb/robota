# CLI AI Workflow Reviewer and Harness Planning

## Status

Backlog.

## Created

2026-05-09

## Priority

P0 - strategic planning for making `agent-cli` a complete AI agent assistant control surface while
keeping reusable behavior below the CLI shell.

## Request

Plan how `agent-cli` should evolve so AI workflows run well inside a user's repository and can drive
that repository's harness reliably.

The planning must:

- study Josh's newsletter article, "Y Combinator says the most reliable way to build an AI-native
  company";
- create an agent profile inspired by the article's operating principles;
- compare relevant public behavior from major AI assistant tools;
- propose how Robota `agent-cli` should evolve;
- keep `agent-cli` as UI/TUI only, with workflow contracts implemented in lower owner packages.

## Source Article Summary

Primary source:

- Josh's newsletter, "Y Combinator says the most reliable way to build an AI-native company",
  published 2026-05-06: <https://maily.so/josh/posts/knrj12e7rld>

Important principles to carry into Robota:

- AI should be treated as an operating layer for work, not a small productivity add-on.
- Important work should become a closed loop: decide, execute, measure, learn, and adjust.
- The repository must be legible and queryable by AI: instructions, specs, task history, commands,
  evidence, and decisions must be durable artifacts.
- Software-factory style work starts with human-authored specs and success tests, then agents
  implement and iterate until the harness passes.
- Humans remain responsible for choosing goals and judging whether the result is good enough.
- Token spend should be optimized as leverage and throughput, not only minimized as cost.

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

## Agent Profile

Name: `AI Native Workflow Reviewer`

Important: this profile must not impersonate Josh, YC, Diana Hu, OpenAI, Anthropic, Cursor, Google,
or any named person/company. It should be an original Robota reviewer inspired by the article's
principles: closed loops, high context, software-factory discipline, token leverage, and
founder/operator accountability.

Reviewer role:

- Inspect a proposed Robota workflow or `agent-cli` feature.
- Identify whether the repo is legible enough for an agent to operate.
- Check whether the flow records artifacts that a later agent can query.
- Check whether human goal-setting and result judgment remain explicit.
- Reject designs that move durable workflow semantics into `agent-cli`.
- Recommend the smallest owner-first implementation slice.

Output shape:

```text
Findings:
- [severity] owner: workflow risk or evidence gap

Required owner updates:
- SPEC / architecture / manifest / harness contract changes

Recommended next slice:
- smallest PR that improves the closed loop
```

## Planning Direction

The recommended plan is to make `agent-cli` the local workflow cockpit, not the owner of workflow
logic.

Feature pillars:

1. **Repository legibility bootstrap**
   - Detect package manager, install/build/test/lint/typecheck/docs commands, CI config,
     instructions, specs, task files, and harness entrypoints.
   - Produce setup gaps as actionable tasks.

2. **Workflow manifest and harness command registry**
   - Let a repo declare canonical harness commands and evidence requirements.
   - Commands must be parsed and executed by SDK/runtime/harness owner APIs, not CLI components.

3. **Spec-and-test-first task intake**
   - Turn a user request into goal, owner package, governing SPEC/API doc, success criteria,
     failing-test plan, verification commands, and stop conditions.

4. **Closed-loop execution workspace**
   - Model plan, implement, verify, diagnose, retry, review, and archive as a structured workflow
     run.
   - Capture artifacts: plan, changed files, command evidence, failing signatures, fixes attempted,
     final evidence, and open risks.

5. **Background workflow dashboard**
   - Show main thread, shell jobs, harness runs, and agent tasks in one switchable workspace list.
   - Support status, latest output, elapsed time, cost/tokens, touched files, input-needed state,
     cancellation, follow-up, takeover, and result pull/apply flows.

6. **Deterministic workflow hooks**
   - Support repo-defined session-start, prompt-submit, before-command, after-command,
     before-commit, before-merge, after-verification, and stop/continue hooks.
   - Hooks may inject context or block unsafe steps deterministically.

7. **Review and evidence gate**
   - Group diffs by owner package.
   - Link every review section to verification evidence.
   - Generate PR summaries from structured artifacts, not free-form chat memory.

8. **Environment setup profiles**
   - Let repos describe install/start/watch/test services.
   - Show readiness before work begins.

9. **Token and cost leverage telemetry**
   - Track token spend, model choice, command time, retry loops, and evidence produced.
   - Report cost as workflow leverage.

10. **Workflow packaging**
    - Let teams save repeated loops as repo-local skills/workflows: release prep, bug triage,
      package audit, dependency upgrade, docs sync, code review, and security pass.

## Architecture Ownership Rule

`agent-cli` owns only TUI screens, keyboard navigation, prompt intake, review UI, and local host
adapter wiring.

Lower owners must be established first:

- `agent-sdk`: workflow session APIs, task intake contracts, command/hook facades, artifact readers,
  review summary APIs.
- `agent-runtime`: workflow/background task lifecycle, cancellation, runners, event streams, task
  state machines.
- harness owner package or cross-cutting spec: workflow manifest schema, harness command registry,
  verification evidence model, hook contract.
- `agent-command-*`: user-visible commands such as workflow status, harness run, review, task
  intake, and workflow packaging.

Do not implement durable workflow state, manifest parsing, command semantics, retention policy,
artifact schema, or hook policy inside `agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Confirm the `AI Native Workflow Reviewer` profile and reviewer output contract.
2. Define the repository workflow manifest schema and harness command registry.
3. Update the cross-cutting spec index and architecture map.
4. Update `agent-cli`, `agent-sdk`, and `agent-runtime` SPEC files with ownership boundaries.
5. Add follow-up backlog slices for parser tests, SDK projections, CLI dashboard, review/evidence
   gate, hooks, environment profiles, telemetry, and workflow packaging.

## Acceptance Criteria

- [ ] The planning document cites the source article and prior-art docs.
- [ ] The reviewer profile is inspired by the article but does not impersonate a named person.
- [ ] The plan clearly separates CLI UI from SDK/runtime/harness ownership.
- [ ] The first implementation slice is small enough to land as a single PR.
- [ ] Follow-up slices exist for manifest parsing, harness registry, workflow artifacts, hooks,
      background dashboard, review evidence, and telemetry.

## Verification Plan

- `pnpm harness:scan`
- Document authority scan must pass when this backlog is later promoted.
- Implementation PRs must add contract tests before TUI screens.

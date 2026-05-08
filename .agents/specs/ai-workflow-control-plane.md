# AI Workflow Control Plane

## Status

Design contract. This document defines the owner-first direction for making `agent-cli` a complete
AI agent assistant control surface without moving reusable workflow behavior into the CLI shell.

## Research Basis

Checked on 2026-05-09.

Primary source:

- Josh's newsletter, "Y Combinator says the most reliable way to build an AI-native company",
  published 2026-05-06: <https://maily.so/josh/posts/knrj12e7rld>

Prior-art sources:

- OpenAI Codex use cases: <https://developers.openai.com/codex/use-cases>
- OpenAI Codex `AGENTS.md` guidance: <https://developers.openai.com/codex/guides/agents-md>
- OpenAI Codex non-interactive mode: <https://developers.openai.com/codex/noninteractive>
- OpenAI Codex GitHub Action: <https://developers.openai.com/codex/github-action>
- Claude Code hooks reference: <https://code.claude.com/docs/en/hooks>
- Cursor background agents: <https://docs.cursor.com/en/background-agents>
- Cursor modes: <https://docs.cursor.com/agent>
- Jules getting started: <https://jules.google/docs>
- Jules Tools CLI reference: <https://jules.google/docs/cli/reference/>

Research findings:

- AI-native workflows need closed loops: decide, execute, measure, learn, and adjust.
- Repositories must be legible and queryable by agents through durable instructions, specs,
  manifests, artifacts, and command evidence.
- Software-factory style work starts with human-owned specs and success tests, then lets agents
  iterate until the harness passes.
- Reliable tools expose deterministic setup, hooks, background task visibility, review surfaces,
  non-interactive automation, and structured handoff artifacts.

## Product Direction

`agent-cli` should be the local cockpit for repo-native AI workflows:

- frame work from repository context;
- show main work, background agents, shell jobs, and harness runs in one workspace;
- run repository-declared verification commands through owner APIs;
- attach evidence to reviews and PR summaries;
- expose token/cost leverage at workflow level;
- let users decide goals and accept results.

The CLI must not own durable workflow semantics. It renders and routes. Lower owner packages define
state, policy, manifests, hooks, artifacts, retention, and command contracts.

## Ownership Model

| Concern                                  | Owner                                          | CLI responsibility                                      |
| ---------------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| Workflow manifest schema and validation  | Cross-cutting spec first; future harness owner | Show manifest status and setup gaps                     |
| Harness command registry                 | SDK facade over harness owner contracts        | Render commands and submit run requests                 |
| Workflow run lifecycle and read model    | `agent-sdk` + `agent-runtime`                  | Render snapshots and selected workflow detail           |
| Shell, harness, and agent task execution | `agent-runtime` runners through SDK APIs       | Provide terminal-local runner adapters when needed      |
| Workflow artifact schema and persistence | `agent-sdk`                                    | Display artifacts and link them from review UI          |
| Deterministic workflow hooks             | `agent-core`/SDK hook contracts                | Render hook decisions and ask only when escalation says |
| Review/evidence gate                     | `agent-sdk` workflow review APIs               | Render grouped diffs, evidence, and user decisions      |
| Task intake contracts                    | `agent-sdk` command/common APIs                | Render wizard screens and prompt collection             |
| Workflow packaging                       | SDK command/workflow contracts                 | Render workflow picker and command output               |
| Token/cost workflow telemetry            | SDK/runtime event model                        | Render summaries and budget warnings                    |

If workflow manifest and harness contracts outgrow SDK facades, create a dedicated lower-level
harness package. Do not place those contracts in `agent-cli`.

## Workflow Manifest Contract

Default discovery order:

1. `.agents/workflow-manifest.json`
2. `robota.workflow.json`
3. `package.json` field `robota.workflow`

Versioned manifest shape:

```json
{
  "version": 1,
  "repo": {
    "name": "robota",
    "rootInstructionFiles": ["AGENTS.md"],
    "ownerDocs": [".agents/specs/ARCHITECTURE-MAP.md"]
  },
  "commands": [
    {
      "id": "harness.scan",
      "category": "verification",
      "command": "pnpm harness:scan",
      "cwd": ".",
      "evidence": ["stdout", "exitCode"],
      "timeoutMs": 300000,
      "requiredFor": ["pre-pr", "pre-merge"]
    }
  ],
  "hooks": [
    {
      "event": "beforeCommand",
      "command": "pnpm harness:release:check -- --version ${version} --publish",
      "blocking": true
    }
  ],
  "artifacts": {
    "workflowRuns": ".robota/workflows",
    "evidence": ".robota/evidence",
    "reviews": ".robota/reviews"
  }
}
```

Contract rules:

- `version` is required and must be forward-compatible through explicit migration.
- `commands[].id` is the stable reference used by task plans and evidence records.
- `commands[].category` must come from a controlled set owned by the manifest contract.
- `command` is executed by an SDK/runtime runner, not by TUI components.
- `evidence` declares what must be captured for later review.
- `hooks` can inject context, block unsafe steps, or request another verification pass.
- Runtime artifact paths are local state; the versioned manifest only declares where artifacts live.

## Workflow Reviewer Profile

Name: `AI Native Workflow Reviewer`

Purpose: critique proposed Robota workflows using closed-loop, high-context, software-factory, and
token-leverage principles. This profile is inspired by the research above but must not impersonate
Josh, YC, Diana Hu, OpenAI, Anthropic, Cursor, or Google.

Reviewer checklist:

- Is the repository legible enough for an agent to start without hidden assumptions?
- Is the work framed as a closed loop with measurable gates and artifact capture?
- Are specs and success tests defined before implementation when contracts change?
- Are command choices declared by the repo instead of guessed from package metadata?
- Does each background shell/agent/harness task have a visible status, owner, and stop condition?
- Can a later agent query the evidence without reading the whole chat transcript?
- Is the human responsible for goal selection and final acceptance?
- Are token/cost decisions explained as leverage, not only minimized spend?
- Does every product-visible CLI feature have a lower reusable owner?

Output contract:

```text
Findings:
- [severity] owner: evidence gap or workflow risk

Required owner updates:
- SPEC / architecture / manifest changes needed before implementation

Recommended next slice:
- smallest PR that improves the workflow loop
```

## Implementation Slices

Recommended sequence:

1. Add manifest parser/validator and contract tests under the chosen lower owner.
2. Add SDK workflow run and evidence artifact APIs over runtime task projections.
3. Add deterministic workflow hook event contracts and tests.
4. Add CLI task intake and dashboard screens that render SDK projections only.
5. Add review/evidence gate and PR summary generation from artifacts.
6. Add token/cost workflow telemetry.
7. Add workflow packaging for repeated repo-local loops.

Decision points before slice 1:

- Keep manifest contracts in `agent-sdk` facades or create a dedicated harness owner package.
- Choose whether manifest files are mandatory for all repos or optional until bootstrapped.
- Choose artifact retention defaults and whether completed workflow artifacts are committed,
  project-local, or user-local.

## Test Plan

- Manifest parser unit tests for required fields, command ids, evidence kinds, hook decisions, and
  migration/version errors.
- SDK contract tests for workflow run snapshots, evidence artifact persistence, and detail reads.
- Runtime tests for shell/harness/agent task lifecycle projection into workflow runs.
- CLI TUI tests for task intake, workflow dashboard navigation, selected detail panes, and
  review/evidence rendering.
- Scenario test for a full loop: request, task plan, implementation, harness failure, fix,
  evidence summary, review, and archive.

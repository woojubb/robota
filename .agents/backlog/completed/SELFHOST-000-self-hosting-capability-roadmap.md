---
title: 'SELFHOST-000: self-hosting capability roadmap — the features Robota needs to build Robota'
status: done
created: 2026-07-16
completed: 2026-07-26
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework, packages/agent-tools, packages/agent-session, packages/agent-plugin, packages/agent-provider-defaults, packages/dag-framework, packages/agent-cli, apps/agent-app
depends_on: []
---

# Self-hosting capability roadmap

## Closing an index (2026-07-26) — and what `done` does and does not assert here

`status: todo` had been false for some time. This file states its own job in its second paragraph:
_"Individual capabilities are spun out into their own `SELFHOST-NNN` backlog items when scheduled;
this item is the index + the prioritization."_ That job is fully discharged, and an index that carries
no work of its own must not sit in the queue as `todo` — a reader scanning for unstarted work would
pick it up and find nothing to do.

**What is verified, not asserted:**

- **All 14 spun-out capabilities are archived complete.** `ls .agents/backlog/completed/ | grep -c '^SELFHOST-'`
  → **14**, and `grep -h '^status:' .agents/backlog/completed/SELFHOST-0*.md | sort | uniq -c` → **14
  × `status: done`**, with zero at any other status. Their gate evidence was reconciled in
  [#1314](https://github.com/woojubb/robota/pull/1314).
- **The three open follow-ups are separate live files**, so closing the index loses nothing:
  `.agents/backlog/SELFHOST-003-P4-embedding-vector-backend.md`,
  `.agents/backlog/SELFHOST-008-P5-concrete-semantic-backend.md`,
  `.agents/backlog/SELFHOST-011-P3-P4-evals-followups.md`.
- **Archiving repairs 14 dangling links.** Every child writes `Part of [SELFHOST-000](SELFHOST-000-self-hosting-capability-roadmap.md)`
  as a same-directory relative link from inside `completed/`
  (`grep -rn '](SELFHOST-000-self-hosting-capability-roadmap.md)' .agents/backlog/completed | wc -l` →
  **14**). Every one of those resolves to `.agents/backlog/completed/SELFHOST-000-…md`, which did not
  exist while this file sat in the root. Moving it here is what makes them correct.

**What this status does NOT claim.** The `## Test Plan` below sets a program-level bar — _"Robota can
plan, index, change, review, and ship a real change to the Robota repo using these capabilities"_ —
which is a continuous property of the product, not a checkbox, and is not something a backlog status
can certify. `done` here means the **index deliverable** (survey → prioritize → spin out → track to
completion) is finished. The north-star itself lives in [`VISION.md`](../../../VISION.md) and is measured
by the flywheel, not by this file.

The program that carries [`VISION.md`](../../../VISION.md) — "Robota builds Robota" — into concrete work: the
capabilities a real development agent needs, benchmarked against what leading commercial/OSS agents tout as
advantages, each placed at the correct Robota layer. Individual capabilities are spun out into their own
`SELFHOST-NNN` backlog items when scheduled; this item is the index + the prioritization.

## Prior Art Research

Surveyed from product documentation (2026-07-16, via `prior-art-researcher`): Claude Code, Cursor, Devin,
aider, Cline, Windsurf, Amp, GitHub Copilot cloud agent, CrewAI ("OpenCrew"), Hermes (Nous Research),
LangGraph, OpenAI Agents SDK, Google ADK, Microsoft Agent Framework, Mastra, OpenAI Operator/CUA. Sources
include https://docs.crewai.com/ , https://code.claude.com/docs/ , https://cursor.com/docs ,
https://aider.chat/docs/repomap.html , https://docs.langchain.com/oss/python/langgraph/persistence ,
https://openai.github.io/openai-agents-python/ , https://google.github.io/adk-docs/ ,
https://learn.microsoft.com/en-us/agent-framework/overview/ , https://mastra.ai/rag-pipeline ,
https://hermes-agent.nousresearch.com/docs/ , https://ampcode.com/manual ,
https://developers.openai.com/api/docs/guides/tools-computer-use .

**Already table-stakes in Robota (NOT re-filed):** subagents (`agent-subagent-runner`), background tasks
(`agent-executor`), hooks/permissions (`agent-core`), sessions/rewind (`agent-session`, `/rewind`), MCP
(`agent-tool-mcp`/`agent-transport-mcp`), slash-commands/skills (`agent-command`, `/skills`), `/memory`
command, model/provider commands + provider DIP, DAG workflow engine (`dag-*`), live remote collab
(REMOTE-001 WebRTC), usage/analytics plugins, PR-review orchestration (HARNESS-018). These need depth/docs,
not new items.

## The plan — prioritized candidate capabilities

`[T]` = table-stakes (parity); `[D]` = differentiator (headline edge). Layer = **hint**, not the final
placement decision (each item does its own Architecture Review). Neutrality rule: mechanism in `packages/`,
product opinion in `agent-cli`/`apps/agent-app`.

| #   | Capability                                                                                              | T/D | Gap in Robota                                                             | Layer (hint)                                                               |
| --- | ------------------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | Crew/multi-agent orchestration primitives (sequential/parallel/hierarchical-manager/handoff/group-chat) | T   | subagents exist, no named orchestration patterns                          | agent-core contracts + agent-framework assembly (or dag-\* patterns)       |
| 2   | Explicit plan-mode (plan → review → approve → act) with a todo/plan artifact                            | T   | permissions/HITL exist, no dedicated plan gate                            | agent-core (plan/approval event) → framework → `/plan` in cli/app          |
| 3   | Codebase indexing / RAG + budget-aware retrieval                                                        | T   | no advertised code-index/retrieval                                        | neutral retrieval interface+tool in agent-tools, index adapter (DIP)       |
| 4   | Run tracing + token/cost budgeting surfaced in TUI/GUI                                                  | T   | usage/analytics + dag-cost exist, no first-class trace/cost view          | agent-plugin + agent-session-analytics + transport-tui/-gui                |
| 5   | Structured output + parallel guardrails (validate, fail-fast)                                           | T   | —                                                                         | agent-core (guardrail contract + engine hook)                              |
| 6   | Per-role model routing / fallback (planner vs editor; provider fallback)                                | T   | provider DIP + `/model`, no per-role/fallback routing                     | provider family + agent-framework routing policy                           |
| 7   | Branching time-travel checkpoints (rewind to any step, fork alternate branch)                           | D   | `/rewind` exists, no branch/fork/what-if                                  | agent-session checkpoint tree + agent-core events                          |
| 8   | Durable project + semantic long-term memory (auto-curated, cross-session)                               | D   | `/memory` command, not auto-curated/semantic                              | neutral memory port in agent-core, store adapter (DIP), policy in surfaces |
| 9   | Rich lifecycle hook catalog (named events + PreToolUse security gate)                                   | D   | hooks exist, breadth/catalog gap                                          | agent-core events/hooks (extend)                                           |
| 10  | Computer/browser use tool (vision → click/type, approval-gated, takeover)                               | D   | absent                                                                    | neutral tool in agent-tools (+ screen-loop), gated by permissions          |
| 11  | Evals-as-code harness for SDK users (gate CI)                                                           | D   | internal `.agents/evals` only, no product surface                         | agent-framework SDK surface + a CLI command                                |
| 12  | Scheduled/cron tasks with pause/resume/edit                                                             | D   | background + dag-scheduler, no user-facing scheduled-task surface         | dag-scheduler + command surface                                            |
| 13  | Multi-surface deployment + gateway (one agent → many channels/runtimes)                                 | D   | cli/app/web/remote exist, no documented "one agent → many channels" story | transports + surfaces (packaging/docs)                                     |
| 14  | Shared/synced async session artifacts for collaboration                                                 | D   | REMOTE-001 live P2P, no async shareable session artifacts                 | agent-session persistence + sharing surface                                |

**Close first (parity):** #1–#6 spun out as SELFHOST-001..006.
**Invest for edge (differentiators):** #7–#14 spun out as SELFHOST-007..014 (SELFHOST-007 branching time-travel,
-008 semantic memory, -009 hook catalog, -010 computer use, -011 evals-as-code, -012 scheduled tasks,
-013 multi-surface deployment, -014 async shared sessions).

**Progress (2026-07-24):** all 14 spun-out capabilities are spec-gated DONE and archived to
`completed/` (specs in `.agents/spec-docs/done/`). Remaining open follow-ups: SELFHOST-003-P4
(embedding-vector backend), SELFHOST-008-P5 (concrete semantic backend), SELFHOST-011-P3/P4 remainder.

## Test Plan

Per spun-out item. Each capability item carries its own Architecture Review (correct-layer placement,
neutrality), Prior Art Research (deepened from the citations above), Test Plan, and — where it changes
user-facing behavior — User Execution Test Scenarios. Definition of done for the program: Robota can plan,
index, change, review, and ship a real change to the Robota repo using these capabilities (self-hosting).

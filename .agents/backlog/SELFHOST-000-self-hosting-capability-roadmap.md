---
title: 'SELFHOST-000: self-hosting capability roadmap — the features Robota needs to build Robota'
status: todo
created: 2026-07-16
priority: high
urgency: soon
area: packages/agent-core, packages/agent-framework, packages/agent-tools, packages/agent-session, packages/agent-plugin, packages/agent-provider-defaults, packages/dag-framework, packages/agent-cli, apps/agent-app
depends_on: []
---

# Self-hosting capability roadmap

The program that carries [`VISION.md`](../../VISION.md) — "Robota builds Robota" — into concrete work: the
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

**Close first (parity):** #1, #2, #3, #4, #5, #6 (spun out as SELFHOST-001..006).
**Invest for edge (differentiators):** #7, #8, #9, #10, #11 (+ #12–14 opportunistic).

## Test Plan

Per spun-out item. Each capability item carries its own Architecture Review (correct-layer placement,
neutrality), Prior Art Research (deepened from the citations above), Test Plan, and — where it changes
user-facing behavior — User Execution Test Scenarios. Definition of done for the program: Robota can plan,
index, change, review, and ship a real change to the Robota repo using these capabilities (self-hosting).

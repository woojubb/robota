---
title: CLI-BL-032 Agent Invocation Router
status: completed
priority: high
urgency: next
created: 2026-05-01
packages:
  - agent-sdk
  - agent-cli
  - agent-runtime
  - agent-transport-headless
  - agent-transport-ws
spec: .agents/specs/agent-invocation-router.md
merged_prs:
  - 105
  - 106
  - 108
---

## Summary

Implement deterministic, composable agent command invocation so injected slash commands and model-selected command tools create real background jobs instead of relying only on the model to call the `Agent` tool.

## Problem

Robota can already run background agent jobs when the `Agent` tool is called with `background: true`, but natural-language user prompts may produce assistant text that claims agents are running without any command/tool call or background task event.

LM Studio replay shows that the provider and model can emit tool calls in simple cases, but the full Robota prompt can still lead the model to print prose or tag-like assistant markup instead of calling `Agent` or `ExecuteCommand`. The fix must make the model-visible command/tool contracts explicit enough that real execution is the easy path, while keeping Robota free of natural-language pre-routing.

The current startup prompt contains hardcoded operational guidance in `system-prompt-builder`. Startup prompt content should instead be assembled from owner-provided framework instructions, project instructions, runtime metadata, permission descriptors, provider capabilities, command descriptors, skill descriptors, tool descriptors, and agent descriptors.

The agent command must not be treated as an unconditional SDK core command. `/agent`, the `Agent` tool, and agent descriptors are contributed by an optional `@robota-sdk/agent-command-agent` command module. Robota's product entrypoint may inject that module as a default capability, but SDK consumers must be able to omit it.

## Specification

See `.agents/specs/agent-invocation-router.md`.

## Prior Art Research

- Claude Code separates `CLAUDE.md` project instructions from skills and built-in commands. Skill descriptions are model-visible; full bodies load on invocation. Built-in commands execute coded CLI behavior.
- Codex exposes `/agent` as a built-in CLI command to switch and inspect active agent threads, while subagents spawn only when explicitly requested.
- Gemini CLI supports `/agents` management, automatic delegation, and explicit forced subagent invocation with `@agent-name`.

References:

- https://code.claude.com/docs/en/memory
- https://code.claude.com/docs/en/slash-commands
- https://code.claude.com/docs/en/commands
- https://code.claude.com/docs/en/agent-sdk/subagents
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/cli/slash-commands
- https://geminicli.com/docs/core/subagents/
- https://geminicli.com/docs/reference/commands/

## Implementation Plan

1. Add shared system prompt section and capability descriptor projection for framework instructions, runtime metadata, permissions, providers, built-in commands, skills, tools, and agent definitions.
2. Replace `system-prompt-builder` with a data-driven prompt composer that only orders and joins owner-provided sections.
3. Add an optional `@robota-sdk/agent-command-agent` package with `/agent` command metadata, execution, and agent runtime/tool enablement through a generic command module interface.
4. Keep the SDK core command set free of `/agent` unless the command module is injected.
5. Add a model-callable command execution tool that exposes only `modelInvocable` command descriptors and calls the same handlers as slash input.
6. Add `InteractiveSession` agent job APIs backed by the existing `SubagentManager` and `BackgroundTaskManager`.
7. Implement `/agent <prompt>`, `/agent run`, and `/agent parallel` as deterministic background spawn paths.
8. Make the `Agent` tool description and `/agent` command descriptor state the standardized execution protocol: call the tool/command bridge, spawn background jobs by default, use one same-turn tool call per parallel role, include backlog/task target selection inside the delegated prompt when needed, and avoid tag-shaped examples that local models may copy as assistant text.
9. Default omitted `Agent.background` to background execution while keeping explicit `background: false` as a foreground compatibility path.
10. Add runtime evidence reporting checks so Robota-owned execution state cannot report agents running without `agentId` or background task events.
11. Wire TUI slash input, headless slash input, structured transports, and model command tool calls through the same command handler path.
12. Ensure project-local `.robota/sessions` and `.robota/logs` contain the full prompt/tool/command context needed for resume and debugging.
13. Update package SPEC files and run package/harness verification.

## Test Plan

The implementation must prove command handler behavior without a real model first, then verify CLI/TUI/headless integration creates observable background task events and returned agent IDs.

### Unit Tests

- Given synthetic prompt sections, when startup context is built, then the composer orders and joins only supplied content without adding behavioral instructions.
- Given capability descriptors, when startup context is built, then capabilities render from registries and no hardcoded subagent section appears.
- Given composer source is scanned, then it contains no hardcoded role, permission, web search, tool, skill, slash command, or agent guidance.
- Given an SDK session is created without the agent command module, when commands/tools/system prompt are assembled, then `/agent`, `Agent`, and agent descriptors are absent.
- Given Robota product composition injects the agent command module, when commands/tools/system prompt are assembled, then `/agent`, `Agent`, and agent descriptors are present.
- Given an unrelated command module such as `/diagnose` is injected, when registry and executor are assembled, then it is visible/executable without adding command-specific SDK code.
- Given `/agent` is injected with `modelInvocable: true`, when model tools are built, then the command execution tool allows `/agent` and rejects non-model-invocable commands.
- Given `/agent "analyze this"` is submitted, when the command executes, then it defaults to `general-purpose` and starts a background job without awaiting completion.
- Given the model command execution tool receives `/agent Plan "draft architecture"`, when executed, then a background agent is spawned and an `agentId` returns without awaiting completion.
- Given `/agent run "analyze this"` is submitted without an agent type, when executed, then it remains a compatibility alias for default background execution.
- Given `/agent parallel developer=general-purpose:"x" designer=Plan:"y"`, when executed, then both jobs are spawned before any wait path.
- Given `/agent parallel developer:"x" designer:"y"`, when executed, then labels are preserved and both jobs use the default `general-purpose` agent type.
- Given an explicit unknown agent type is requested, when executed, then the command returns a structured failure instead of throwing an unhandled rejection.
- Given natural-language input asks for parallel agents and a test model calls the command execution tool, when executed, then it becomes a deterministic `/agent parallel` execution.
- Given natural-language input asks about agents but the model does not call a tool, when the turn completes, then no background job is started.
- Given the `Agent` tool is exposed, when its schema description is inspected, then it tells the model to call the tool in the same assistant turn for explicit subagent requests, emit one call per parallel role, default to background work, and avoid tag-shaped execution examples.
- Given the `Agent` tool is executed without `background`, when the run starts, then `SubagentManager.spawn()` receives `mode: "background"` and `wait()` is not called.
- Given the `Agent` tool is executed with `background: false`, when the run starts, then `SubagentManager.spawn()` receives `mode: "foreground"` and `wait()` is called.
- Given no runtime evidence exists, when Robota-owned execution state is projected, then it reports no started agent jobs.
- Given a session starts with model-visible `/agent` descriptors, when session data is saved, then the exact system prompt and registered tool schemas are persisted in `.robota/sessions`.
- Given a session run completes, when diagnostic JSONL is inspected, then session initialization, pre-run, and assistant events include full system/input/history/response data rather than length-only or truncated data.

### Integration Tests

- TUI `/agent parallel ...` shows background task rows and keeps the prompt usable.
- Headless `/agent ...` returns an `agentId` immediately.
- `stream-json` emits background task events for `/agent parallel`.

### Verification Commands

```bash
pnpm --filter @robota-sdk/agent-sdk test
pnpm --filter @robota-sdk/agent-cli test
pnpm --filter @robota-sdk/agent-runtime test
pnpm --filter @robota-sdk/agent-transport-headless test
pnpm --filter @robota-sdk/agent-transport-ws test
pnpm harness:scan
```

## Acceptance Criteria

- [x] `system-prompt-builder` does not own operational guidance; prompt content comes from owner-provided sections and descriptors.
- [x] `/agent` is model-visible through injected descriptors and user-invocable through command parsing when the agent command module is composed.
- [x] SDK core can run without the agent command module.
- [x] Explicit `/agent` requests and model command tool calls create real runtime jobs.
- [x] Parallel background agent execution returns job IDs and, by default, a wait_all group summary for same-turn consolidation.
- [x] Robota-owned execution status is backed by runtime evidence.

## Completion Notes

### 2026-05-02

- Confirmed the specification was introduced by PR #105.
- Confirmed the composable `/agent` command module and model-visible command descriptor path were implemented through PR #106.
- Confirmed background group orchestration and default `/agent parallel` consolidation were completed by PR #108.
- Archived this backlog item because the implementation is present on `develop` and package specs now describe the command-module, background-task, and group-orchestration contracts.

---
title: CLI-BL-032 Agent Invocation Router
status: backlog
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
---

## Summary

Implement deterministic, composable agent command invocation so injected slash commands and model-selected command tools create real background jobs instead of relying only on the model to call the `Agent` tool.

## Problem

Robota can already run background agent jobs when the `Agent` tool is called with `background: true`, but natural-language user prompts may produce assistant text that claims agents are running without any command/tool call or background task event.

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
7. Implement `/agent run --background` and `/agent parallel --background` as deterministic background spawn paths.
8. Add runtime evidence reporting checks so Robota-owned execution state cannot report agents running without `agentId` or background task events.
9. Wire TUI slash input, headless slash input, structured transports, and model command tool calls through the same command handler path.
10. Update package SPEC files and run package/harness verification.

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
- Given the model command execution tool receives `/agent run Plan --background "draft architecture"`, when executed, then a background agent is spawned and an `agentId` returns without awaiting completion.
- Given `/agent parallel developer=general-purpose:"x" designer=Plan:"y" --background`, when executed, then both jobs are spawned before any wait path.
- Given natural-language input asks for parallel agents and a test model calls the command execution tool, when executed, then it becomes a deterministic `/agent parallel` execution.
- Given natural-language input asks about agents but the model does not call a tool, when the turn completes, then no background job is started.
- Given no runtime evidence exists, when Robota-owned execution state is projected, then it reports no started agent jobs.

### Integration Tests

- TUI `/agent parallel ... --background` shows background task rows and keeps the prompt usable.
- Headless `/agent run ... --background` returns an `agentId` immediately.
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

- `system-prompt-builder` does not own operational guidance; prompt content comes from owner-provided sections and descriptors.
- `/agent` is model-visible through injected descriptors and user-invocable through command parsing when the agent command module is composed.
- SDK core can run without the agent command module.
- Explicit `/agent` requests and model command tool calls create real runtime jobs.
- Parallel background agent execution returns job IDs immediately.
- Robota-owned execution status is backed by runtime evidence.

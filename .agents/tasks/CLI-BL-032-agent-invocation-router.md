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

Implement deterministic agent invocation routing so explicit user requests to run, spawn, or parallelize agents create real background jobs instead of relying only on the model to call the `Agent` tool.

## Problem

Robota can already run background agent jobs when the `Agent` tool is called with `background: true`, but natural-language user prompts may produce assistant text that claims agents are running without any tool call or background task event.

The current startup prompt contains hardcoded operational guidance in `system-prompt-builder`. Startup prompt content should instead be assembled from owner-provided framework instructions, project instructions, runtime metadata, permission descriptors, provider capabilities, command descriptors, skill descriptors, tool descriptors, and agent descriptors.

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
3. Add `/agent` as a built-in command with `run`, `parallel`, `list`, `read`, `send`, `stop`, `close`, and `open` subcommands.
4. Add `InteractiveSession` agent job APIs backed by the existing `SubagentManager` and `BackgroundTaskManager`.
5. Implement `/agent run --background` and `/agent parallel --background` as deterministic background spawn paths.
6. Add a pure natural-language agent intent router for explicit agent execution requests.
7. Add assistant claim guards so Robota cannot report agents running without `agentId` or background task events.
8. Wire TUI, headless, and transport flows through the same command/router path.
9. Update package SPEC files and run package/harness verification.

## Test Plan

The implementation must prove routing behavior without a real model first, then verify CLI/TUI/headless integration creates observable background task events and returned agent IDs.

### Unit Tests

- Given synthetic prompt sections, when startup context is built, then the composer orders and joins only supplied content without adding behavioral instructions.
- Given capability descriptors, when startup context is built, then capabilities render from registries and no hardcoded subagent section appears.
- Given composer source is scanned, then it contains no hardcoded role, permission, web search, tool, skill, slash command, or agent guidance.
- Given `/agent run Plan --background "draft architecture"`, when executed, then a background agent is spawned and an `agentId` returns without awaiting completion.
- Given `/agent parallel developer=general-purpose:"x" designer=Plan:"y" --background`, when executed, then both jobs are spawned before any wait path.
- Given an explicit natural-language parallel-agent request, when routed, then it becomes a deterministic `/agent parallel` execution.
- Given ambiguous agent-related discussion, when routed, then it remains a normal model prompt.
- Given assistant text claims agents are running without runtime evidence, when the claim guard runs, then it fails.

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
- `/agent` is model-visible through descriptors and user-invocable through command parsing.
- Explicit `/agent` and routed natural-language requests create real runtime jobs.
- Parallel background agent execution returns job IDs immediately.
- Assistant execution claims are backed by runtime evidence.

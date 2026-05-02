---
title: CLI-BL-045 Memory Command Driven Orchestration
status: completed
priority: high
urgency: soon
created: 2026-05-02
packages:
  - agent-sdk
branch: feat/memory-command-driven-orchestration
---

# CLI-BL-045 Memory Command Driven Orchestration

## Objective

Align project memory behavior with the command/capability architecture. `/memory` should be the model-visible memory interface with enough descriptor metadata for the model to inspect, recall, and update memory through `ExecuteCommand`; the SDK must not silently inject topic memory or create memory candidates as a hidden turn side effect.

## Research

- Claude Code memory documentation says `MEMORY.md` is loaded at session start with caps, topic files are not loaded at startup, and Claude reads/writes topic files during a session when needed.
- Claude API memory tool documentation frames memory as a client-side tool: the model makes memory tool calls, the application executes them, and the active context stays focused through on-demand retrieval.
- Codex public documentation emphasizes durable project instructions through `AGENTS.md`; model-facing capabilities and tools are the appropriate extension point for dynamic behavior.

## Current Finding

- Robota already exposes `/memory` as a model-invocable built-in command through `ExecuteCommand`.
- The `/memory` descriptor is too terse to guide autonomous model use.
- `InteractiveSession` also performs automatic retrieval before every prompt and automatic candidate extraction after each completed turn. That creates a hidden memory path outside the command descriptor contract.

## Decision

- Keep startup `.robota/memory/MEMORY.md` loading as neutral project context.
- Keep `/memory` storage, review, and audit command behavior.
- Strengthen the `/memory` model descriptor so the model can call it when memory is relevant.
- Remove hidden prompt-time topic injection and turn-end candidate capture from `InteractiveSession`.
- Leave extraction/policy classes available as reusable internals for a future explicit command/module path, but do not wire them as automatic session side effects.

## Test Plan

- Given a system prompt with command descriptors, when `/memory` is model-invocable, then the Built-in Commands section contains the richer memory usage descriptor.
- Given existing topic memory, when a user submits an unrelated or related prompt, then `InteractiveSession` does not automatically prepend `<project-memory>` to the user message.
- Given a memory cue in a turn, when the turn completes, then no pending memory record is created unless `/memory` is explicitly invoked.
- Given `/memory add`, when invoked through `executeModelCommand`, then memory is persisted through the command bridge.

## Progress

### 2026-05-02

- Created branch and task record.
- Verified current implementation was mixed: model-invocable `/memory` existed, but `InteractiveSession` also performed hidden topic injection and turn-end candidate extraction.
- Added RED tests for descriptor guidance, no hidden topic injection, no hidden pending candidate creation, model-command `/memory add`, and sensitive-content rejection.
- Reworked `InteractiveSession` so memory topic retrieval/writes occur through explicit `/memory` command execution rather than implicit prompt lifecycle side effects.
- Strengthened `/memory` built-in command descriptor and command palette subcommands.
- Updated `agent-sdk` SPEC to make command-driven memory the contract.

## Verification

- `pnpm --filter @robota-sdk/agent-sdk test -- src/interactive/__tests__/interactive-session-memory.test.ts src/commands/__tests__/system-command.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk test -- src/commands/__tests__/system-command.test.ts src/memory/__tests__/automatic-memory.test.ts src/interactive/__tests__/interactive-session-memory.test.ts src/__tests__/system-prompt-builder.test.ts src/commands/__tests__/command-registry.test.ts`
- `pnpm --filter @robota-sdk/agent-cli test -- src/commands/__tests__/builtin-source.test.ts src/commands/__tests__/slash-executor.test.ts src/ui/__tests__/input-area-flow.test.ts`
- `pnpm --filter @robota-sdk/agent-sdk test`
- `pnpm --filter @robota-sdk/agent-sdk typecheck`
- `pnpm --filter @robota-sdk/agent-sdk lint`
- `pnpm --filter @robota-sdk/agent-sdk build`
- `pnpm --filter @robota-sdk/agent-cli typecheck`
- `pnpm harness:scan`

## Result

- Memory is now command-driven at the session boundary.
- `/memory` remains model-invocable through `ExecuteCommand`, with descriptor-owned guidance for inspection, durable saves, review, provenance, and sensitive-data avoidance.
- `InteractiveSession` no longer injects topic memory into prompts or queues memory candidates as a hidden post-turn side effect.
- `/memory add` rejects obvious sensitive content before writing files.

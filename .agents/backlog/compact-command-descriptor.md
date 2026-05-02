# Compact Command Descriptor and Auto-Trigger Policy

## What

Make context compaction a descriptor-owned built-in command with an explicit auto-trigger policy instead of a CLI-owned special case.

## Why

Compaction currently exists in multiple paths. The SDK has a `compact` system command, while the CLI slash executor also implements `/compact` directly. Auto-compaction is embedded in session execution through a hardcoded threshold. This makes compaction less composable than `/agent`, harder to expose consistently to model-invocable command routing, and harder to tune or explain to users.

## Current Signals

- `packages/agent-sdk/src/commands/system-command.ts` defines a `compact` system command.
- `packages/agent-cli/src/commands/slash-executor.ts` directly handles `/compact`.
- `packages/agent-sessions/src/context-window-tracker.ts` hardcodes `AUTO_COMPACT_THRESHOLD = 0.835`.
- `packages/agent-sessions/src/session-run.ts` auto-compacts at the start of `run()` when the tracker exceeds the threshold.
- `agent-invocation-router.md` already describes command descriptors and model-invocable command execution as the direction for built-in commands such as `/agent`.

## Research Required

Before implementation, research how context usage and compaction are exposed in comparable coding agents and SDKs. Confirm:

- whether users should see context usage every prompt, only in the status bar, or only near threshold;
- whether auto-compaction should happen before a prompt, after a response, or after tool results;
- how to avoid compacting while streaming or while a tool call is in flight;
- whether the model should be able to invoke compaction through the generic command tool;
- how threshold, cooldown, and "ask before compact" settings should be represented;
- how exact provider token usage and estimated token usage should be labelled.

## Scope

- Define a command descriptor for compact that includes user-visible metadata, model-invocable policy, and optional auto-trigger metadata.
- Route CLI `/compact` through the same command execution path as SDK/system commands.
- Move hardcoded threshold policy behind configuration with a default equivalent to the current behavior.
- Decide whether the status bar is sufficient for per-prompt context percentage or whether each prompt/turn needs an explicit usage row.
- Ensure auto-compaction emits enough events for CLI, headless, and logs to explain what happened.
- Preserve system prompt/project context across compaction.
- Add tests for manual compaction, threshold-based auto-triggering, disabled auto-triggering, and CLI routing.

## Non-Goals

- Do not remove manual `/compact`.
- Do not compact by prompt text injection or hidden assistant messages outside the session compaction contract.
- Do not make compaction provider-specific.
- Do not dump large command bodies into startup context; descriptors should stay concise.

## Acceptance Criteria

- [ ] `compact` has a descriptor-owned command module or equivalent registry entry.
- [ ] CLI slash input, SDK command execution, and model-invocable command routing use the same compact handler.
- [ ] Auto-compact threshold is configurable with a documented default.
- [ ] Context usage visibility is explicitly designed and tested for prompt submission and post-response reconciliation.
- [ ] Auto-compaction produces user-visible/log-visible events with before/after context percentages.
- [ ] Tests prove compaction does not stream summary text into the normal answer path.

## Test Plan

- Add command registry tests proving `compact` metadata is projected correctly.
- Add CLI slash-routing tests proving `/compact` no longer has a separate behavior path.
- Add session tests for default threshold, custom threshold, disabled threshold, and no compaction below threshold.
- Add UI/view-model tests for context percentage visibility and auto-compact notifications.

## Promotion Path

1. Move to `.agents/tasks/SDK-BL-0XX-compact-command-descriptor.md`.
2. Complete research before finalizing the descriptor shape.
3. Implement descriptor routing first, then migrate auto-trigger policy.

# Compact Command Descriptor and Auto-Trigger Policy

Status: completed in `feat/compact-command-descriptor`.

## What

Make context compaction a descriptor-owned built-in command with an explicit auto-trigger policy instead of a CLI-owned special case.

## Why

Compaction previously existed in multiple paths. The dedicated `agent-command-compact` module now owns `/compact`, and auto-compaction uses configurable session policy with structured events. This makes compaction composable like `/agent`, exposes it consistently to model-invocable command routing, and gives users/logs enough metadata to explain automatic compaction.

## Current Signals

- `packages/agent-command-compact/src/compact-command-module.ts` defines the `compact` command module, blocking lifecycle, model-invocable policy, and safety metadata.
- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts` routes slash commands through `InteractiveSession.executeCommand()`.
- `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts` bridges compact events back into TUI history so automatic compaction notifications are rendered.
- `packages/agent-sdk/src/config/config-types.ts` and `packages/agent-sessions/src/context-window-tracker.ts` define configurable auto-compact policy with the documented default.
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

## Recommendation

Start with descriptor unification, then move auto-trigger policy behind configuration.

The recommended default is:

- keep manual `/compact` user-invocable;
- route CLI slash input through the SDK command registry instead of the CLI-specific compact handler;
- let the session runtime consume descriptor/config metadata for auto-compact thresholds;
- keep the current default threshold behavior until research proves a better value;
- show context percentage in the status bar continuously, with explicit warning/notification only near the threshold or when auto-compaction runs;
- label context state as exact or estimated when that signal is available;
- do not rely on the model to decide routine auto-compaction.

Rationale: compaction is a runtime safety policy. The model may request compaction through a command later, but the default auto-trigger should be deterministic and observable rather than a hidden model decision.

## Scope

- [x] Define a command descriptor for compact that includes user-visible metadata, model-invocable policy, and safety metadata.
- [x] Route CLI `/compact` through the same command execution path as SDK/system commands.
- [x] Move hardcoded threshold policy behind configuration with a default equivalent to the current behavior.
- [x] Decide whether the status bar is sufficient for per-prompt context percentage or whether each prompt/turn needs an explicit usage row.
- [x] Ensure auto-compaction emits enough events for CLI, headless, and logs to explain what happened.
- [x] Preserve system prompt/project context across compaction.
- [x] Add tests for manual compaction, threshold-based auto-triggering, disabled auto-triggering, and CLI routing.

## Non-Goals

- Do not remove manual `/compact`.
- Do not compact by prompt text injection or hidden assistant messages outside the session compaction contract.
- Do not make compaction provider-specific.
- Do not dump large command bodies into startup context; descriptors should stay concise.

## Acceptance Criteria

- [x] `compact` has a descriptor-owned command module or equivalent registry entry.
- [x] CLI slash input, SDK command execution, and model-invocable command routing use the same compact handler.
- [x] Auto-compact threshold is configurable with a documented default.
- [x] Context usage visibility is explicitly designed and tested for prompt submission and post-response reconciliation.
- [x] Auto-compaction produces user-visible/log-visible events with before/after context percentages.
- [x] Tests prove compaction does not stream summary text into the normal answer path.

## Test Plan

- [x] Add command registry tests proving `compact` metadata is projected correctly.
- [x] Add CLI slash-routing tests proving `/compact` no longer has a separate behavior path.
- [x] Add session tests for default threshold, custom threshold, disabled threshold, and no compaction below threshold.
- [x] Add UI/view-model tests for context percentage visibility and auto-compact notifications.

## Promotion Path

1. [x] Move to `.agents/tasks/completed/compact-command-descriptor.md`.
2. [x] Complete research before finalizing the descriptor shape.
3. [x] Implement descriptor routing first, then migrate auto-trigger policy.

/**
 * Leaf type module for {@link IPresetApplicationOptions}.
 *
 * Split out of `preset-application.ts` so `host-adapters.ts` can depend on this type without
 * importing back from `preset-application.ts` (which imports `ICommandHostPresetApplication`/
 * `ICommandHostSessionAccess` from `host-roles.ts`, which imports `ICommandHostAdapters` from
 * `host-adapters.ts`) — that previously created an import cycle.
 */
import type { TModelEffortSelection, TPermissionMode } from '@robota-sdk/agent-core';

/**
 * Resolved-preset option subset that can be re-applied to a *live* session.
 *
 * This is a framework-owned shape. The agent-preset package's `IResolvedPresetOptions` satisfies it
 * structurally, so a consumer can hand a `resolvePreset(...)` result straight to
 * {@link applyPresetToSession} without framework importing agent-preset (no dependency cycle).
 *
 * PRESET-012 carries the permission/trust group (`permissionMode`); PRESET-013 adds the model group
 * (`model`, `effort`, `temperature`, `maxOutputTokens`); PRESET-014 adds the `persona` block,
 * re-applied to the live system prompt; PRESET-015 adds the command-module selection group
 * (`enabledCommandModules`/`disabledCommandModules`), re-filtered against the session-start set.
 */
export interface IPresetApplicationOptions {
  permissionMode?: TPermissionMode;
  model?: string;
  effort?: TModelEffortSelection;
  temperature?: number;
  maxOutputTokens?: number;
  /** PRESET-014 — preset persona re-applied to the live system prompt. */
  persona?: string;
  /** ARCH-040 — the agent's identity label, re-applied to the live agent. */
  agentName?: string;
  /** ARCH-040 — response language, re-applied as a prompt section. */
  language?: string;
  /** ARCH-040 — a preset-supplied system prompt that SEEDS the composed prompt (priority 4). */
  systemPrompt?: string;
  /**
   * ARCH-040 Group C — the preset's tool lists, re-applied to the live enforcer.
   *
   * An allowlist REPLACES what the preset layer previously contributed; a denylist UNIONS, because a
   * denial is not weakened by a later layer that forgot to repeat it. Both halves ship together: an
   * allowlist that replaces while its paired denylist stayed behind would widen what the session
   * permits, which is the failure the pairing exists to prevent.
   */
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  /** PRESET-015 — allowlist of command-module names to keep on the live session. */
  enabledCommandModules?: readonly string[];
  /** PRESET-015 — denylist of command-module names to remove from the live session. */
  disabledCommandModules?: readonly string[];
  /** PRESET-016 — runtime gate toggle for subagent dispatch on the live session. */
  enableParallelSubagents?: boolean;
  /** PRESET-017 — toggle the verify-before-done self-verification section on the live prompt. */
  selfVerification?: boolean;
}

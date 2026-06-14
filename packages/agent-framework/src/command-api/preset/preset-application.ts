import { writeCommandPermissionMode } from '../permissions/permission-mode-command-api.js';

import type { ICommandHostContext } from '../host-context.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';

/**
 * Resolved-preset option subset that can be re-applied to a *live* session.
 *
 * This is a framework-owned shape. The agent-preset package's `TResolvedPresetOptions` satisfies it
 * structurally, so a consumer can hand a `resolvePreset(...)` result straight to
 * {@link applyPresetToSession} without framework importing agent-preset (no dependency cycle).
 *
 * PRESET-012 carries only the permission/trust group (`permissionMode`). Later layers extend it:
 * - PRESET-013: `model`, `effort`, `temperature`, `maxOutputTokens`
 * - PRESET-014: `persona`, `systemPrompt`, `enabledCommandModules`, `enableParallelSubagents`,
 *   `selfVerification`
 */
export interface IPresetApplicationOptions {
  permissionMode?: TPermissionMode;
}

/** Outcome of {@link applyPresetToSession}: which option groups were re-applied vs. skipped. */
export interface IPresetApplicationResult {
  /** Option-group keys whose value was present and applied to the live session. */
  readonly applied: readonly string[];
  /** Option-group keys absent from the resolved options (left untouched). */
  readonly skipped: readonly string[];
}

/**
 * Re-apply a resolved preset to a live session and record it as the active preset.
 *
 * This is the single entry point for live preset switching. It first records the active preset id
 * (PRESET-011 runtime state) — the runtime's `setActivePresetId` is optional, so it is invoked
 * defensively. It then re-applies each option group it owns; PRESET-012 applies the permission
 * posture via the existing `writeCommandPermissionMode` seam. Groups absent from `options` are
 * left untouched and reported under `skipped`. Later layers (PRESET-013/014) extend the applied
 * groups without changing this contract.
 */
export function applyPresetToSession(
  context: ICommandHostContext,
  presetId: string,
  options: IPresetApplicationOptions,
): IPresetApplicationResult {
  const applied: string[] = [];
  const skipped: string[] = [];

  // PRESET-011 state — optional runtime method, applied defensively.
  context.getSession().setActivePresetId?.(presetId);

  if (options.permissionMode !== undefined) {
    writeCommandPermissionMode(context, options.permissionMode);
    applied.push('permissionMode');
  } else {
    skipped.push('permissionMode');
  }

  return { applied, skipped };
}

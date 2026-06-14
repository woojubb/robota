import { writeCommandPermissionMode } from '../permissions/permission-mode-command-api.js';

import type { ICommandHostContext, IModelReapplyOptions } from '../host-context.js';
import type { TModelEffort, TPermissionMode } from '@robota-sdk/agent-core';

/**
 * Resolved-preset option subset that can be re-applied to a *live* session.
 *
 * This is a framework-owned shape. The agent-preset package's `TResolvedPresetOptions` satisfies it
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
  effort?: TModelEffort;
  temperature?: number;
  maxOutputTokens?: number;
  /** PRESET-014 — preset persona re-applied to the live system prompt. */
  persona?: string;
  /** PRESET-015 — allowlist of command-module names to keep on the live session. */
  enabledCommandModules?: readonly string[];
  /** PRESET-015 — denylist of command-module names to remove from the live session. */
  disabledCommandModules?: readonly string[];
  /** PRESET-016 — runtime gate toggle for subagent dispatch on the live session. */
  enableParallelSubagents?: boolean;
  /** PRESET-017 — toggle the verify-before-done self-verification section on the live prompt. */
  selfVerification?: boolean;
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
 * posture via the existing `writeCommandPermissionMode` seam, and PRESET-013 re-applies the model
 * group (`model`/`effort`/`temperature`/`maxOutputTokens`) via the runtime's optional
 * `applyModelOptions`. PRESET-014 re-applies the `persona` group via the host context's optional
 * `applyPersona` seam. PRESET-015 re-applies the command-module selection group via the host
 * context's optional `applyCommandModuleSelection` seam. PRESET-016 toggles the parallel-subagents
 * runtime gate via the runtime's optional `setParallelSubagentsEnabled` seam. PRESET-017 toggles
 * the verify-before-done self-verification section via the host context's optional
 * `applySelfVerification` seam. Groups absent from `options` are left untouched and reported under
 * `skipped`.
 */
export async function applyPresetToSession(
  context: ICommandHostContext,
  presetId: string,
  options: IPresetApplicationOptions,
): Promise<IPresetApplicationResult> {
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

  // PRESET-013 model group — re-applied via the runtime's optional applyModelOptions seam.
  const modelOptions: IModelReapplyOptions = {
    ...(options.model !== undefined && { model: options.model }),
    ...(options.effort !== undefined && { effort: options.effort }),
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
  };
  for (const key of ['model', 'effort', 'temperature', 'maxOutputTokens'] as const) {
    if (options[key] !== undefined) {
      applied.push(key);
    } else {
      skipped.push(key);
    }
  }
  if (Object.keys(modelOptions).length > 0) {
    await context.getSession().applyModelOptions?.(modelOptions);
  }

  // PRESET-014 persona group — re-applied via the host context's optional applyPersona seam.
  if (options.persona !== undefined) {
    context.applyPersona?.(options.persona);
    applied.push('persona');
  } else {
    skipped.push('persona');
  }

  // PRESET-015 command-module group — re-applied via the host context's optional
  // applyCommandModuleSelection seam (re-filters the session-start module set).
  if (options.enabledCommandModules !== undefined || options.disabledCommandModules !== undefined) {
    context.applyCommandModuleSelection?.(
      options.enabledCommandModules,
      options.disabledCommandModules,
    );
    applied.push('commandModules');
  } else {
    skipped.push('commandModules');
  }

  // PRESET-016 parallel-subagents gate — toggled via the runtime's optional
  // setParallelSubagentsEnabled seam (live gate on an already-constructed session).
  if (options.enableParallelSubagents !== undefined) {
    context.getSession().setParallelSubagentsEnabled?.(options.enableParallelSubagents);
    applied.push('enableParallelSubagents');
  } else {
    skipped.push('enableParallelSubagents');
  }

  // PRESET-017 self-verification group — toggled via the host context's optional
  // applySelfVerification seam (recomposes the live system prompt).
  if (options.selfVerification !== undefined) {
    context.applySelfVerification?.(options.selfVerification);
    applied.push('selfVerification');
  } else {
    skipped.push('selfVerification');
  }

  return { applied, skipped };
}

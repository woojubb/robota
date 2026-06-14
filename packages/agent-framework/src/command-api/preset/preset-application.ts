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
 * re-applied to the live system prompt. (Command modules / execution capabilities remain deferred
 * to PRESET-015.)
 */
export interface IPresetApplicationOptions {
  permissionMode?: TPermissionMode;
  model?: string;
  effort?: TModelEffort;
  temperature?: number;
  maxOutputTokens?: number;
  /** PRESET-014 — preset persona re-applied to the live system prompt. */
  persona?: string;
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
 * `applyPersona` seam. Groups absent from `options` are left untouched and reported under `skipped`.
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
    context.getSession().applyModelOptions?.(modelOptions);
  }

  // PRESET-014 persona group — re-applied via the host context's optional applyPersona seam.
  if (options.persona !== undefined) {
    context.applyPersona?.(options.persona);
    applied.push('persona');
  } else {
    skipped.push('persona');
  }

  return { applied, skipped };
}

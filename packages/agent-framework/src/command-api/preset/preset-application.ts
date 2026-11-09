import { findInvalidPermissionPatterns, toolNamesToPatterns } from '@robota-sdk/agent-core';

import { writeCommandPermissionMode } from '../permissions/permission-mode-command-api.js';

import type {
  ICommandHostPresetApplication,
  ICommandHostSessionAccess,
} from '../host-roles.js';
import type {
  IModelReapplyOptions,
  IUnknownCommandModuleName,
} from '../host-context-types.js';
import type { IPresetApplicationOptions } from './preset-application-types.js';

export type { IPresetApplicationOptions } from './preset-application-types.js';

/** Outcome of {@link applyPresetToSession}: which option groups were re-applied vs. skipped. */
export interface IPresetApplicationResult {
  /** Option-group keys whose value was present and applied to the live session. */
  readonly applied: readonly string[];
  /** Option-group keys absent from the resolved options (left untouched). */
  readonly skipped: readonly string[];
  /**
   * Preset `enabledCommandModules`/`disabledCommandModules` names that matched no live
   * command module. Empty when every name matched (or the group was skipped). The `/preset` command
   * surfaces these as a non-fatal notice so an in-session switch is no longer silent.
   */
  readonly unknownCommandModules: readonly IUnknownCommandModuleName[];
}

/**
 * Re-apply a resolved preset to a live session and record it as the active preset.
 *
 * This is the single entry point for live preset switching. It first records the active preset id
 * (runtime state) — required, so it is called directly. It re-applies each option group it
 * owns: the permission posture via the existing `writeCommandPermissionMode` seam, the model
 * group (`model`/`effort`/`temperature`/`maxOutputTokens`) via the runtime's
 * `applyModelOptions`, the `persona` group via the host context's `applyPersona` seam, and the
 * command-module selection group via the host context's `applyCommandModuleSelection` seam. It
 * toggles the parallel-subagents runtime gate via the runtime's `setParallelSubagentsEnabled`
 * seam, and toggles the verify-before-done self-verification section via the host context's
 * `applySelfVerification` seam. Groups absent from `options` are left untouched and reported under
 * `skipped`.
 */
export async function applyPresetToSession(
  context: ICommandHostPresetApplication & ICommandHostSessionAccess,
  presetId: string,
  options: IPresetApplicationOptions,
): Promise<IPresetApplicationResult> {
  const applied: string[] = [];
  const skipped: string[] = [];

  // Refuse a preset whose allowlist the gate would refuse, BEFORE anything changes, so a
  // bad preset leaves the session as it was rather than half-applied.
  const invalidAllow = findInvalidPermissionPatterns(
    toolNamesToPatterns(options.allowedTools),
    'allow',
  );
  if (invalidAllow.length > 0) {
    const listed = invalidAllow.map(({ pattern, reason }) => `"${pattern}" ${reason}`).join('; ');
    throw new Error(`Preset "${presetId}" has invalid allowedTools: ${listed}.`);
  }

  // Active-preset state — required runtime method.
  context.getSession().setActivePresetId(presetId);

  if (options.permissionMode !== undefined) {
    writeCommandPermissionMode(context, options.permissionMode);
    applied.push('permissionMode');
  } else {
    skipped.push('permissionMode');
  }

  // Tool-list group. Skipped only when the preset states neither list — never because
  // a runtime could not apply them, which the required role member makes unrepresentable.
  if (options.allowedTools !== undefined || options.deniedTools !== undefined) {
    context.getSession().applyPresetToolLists({
      ...(options.allowedTools !== undefined && { allowedTools: options.allowedTools }),
      ...(options.deniedTools !== undefined && { deniedTools: options.deniedTools }),
    });
    applied.push('toolLists');
  } else {
    skipped.push('toolLists');
  }

  // Model group — re-applied via the runtime's applyModelOptions seam.
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
    await context.getSession().applyModelOptions(modelOptions);
  }

  // Persona group — re-applied via the host context's applyPersona seam.
  if (options.persona !== undefined) {
    context.applyPersona(options.persona);
    applied.push('persona');
  } else {
    skipped.push('persona');
  }

  // Language group — re-applied through the same rebuild seam as persona. Owner decision
  // 2026-08-20: a preset's `language` is a prompt instruction, not a provider parameter.
  if (options.language !== undefined) {
    context.applyResponseLanguage(options.language);
    applied.push('language');
  } else {
    skipped.push('language');
  }

  // Seeding-prompt group. `systemPrompt` SEEDS rather than replaces — the framework's own
  // replace seam would drop the AGENTS.md and capability sections without saying so.
  if (options.systemPrompt !== undefined) {
    context.applyPresetSystemPrompt(options.systemPrompt);
    applied.push('systemPrompt');
  } else {
    skipped.push('systemPrompt');
  }

  // Identity group — startup applies the preset's `agentName`, so the live path must too, or
  // switching to the SAME preset mid-session leaves the old name. Owner decision 2026-08-20:
  // `/preset` renames.
  if (options.agentName !== undefined) {
    await context.getSession().applyAgentName(options.agentName);
    applied.push('agentName');
  } else {
    skipped.push('agentName');
  }

  // Command-module group — re-applied via the host context's
  // applyCommandModuleSelection seam (re-filters the session-start module set).
  const hasCommandModuleSelection =
    options.enabledCommandModules !== undefined || options.disabledCommandModules !== undefined;
  // The seam returns any names that matched no live module; run it exactly once, only
  // when the group is present, and carry the unknowns up so `/preset` can surface a non-fatal notice.
  const unknownCommandModules: readonly IUnknownCommandModuleName[] = hasCommandModuleSelection
    ? context.applyCommandModuleSelection(
        options.enabledCommandModules,
        options.disabledCommandModules,
      )
    : [];
  if (hasCommandModuleSelection) {
    applied.push('commandModules');
  } else {
    skipped.push('commandModules');
  }

  // Parallel-subagents gate — toggled via the runtime's
  // setParallelSubagentsEnabled seam (live gate on an already-constructed session).
  if (options.enableParallelSubagents !== undefined) {
    context.getSession().setParallelSubagentsEnabled(options.enableParallelSubagents);
    applied.push('enableParallelSubagents');
  } else {
    skipped.push('enableParallelSubagents');
  }

  // Self-verification group — toggled via the host context's
  // applySelfVerification seam (recomposes the live system prompt).
  if (options.selfVerification !== undefined) {
    context.applySelfVerification(options.selfVerification);
    applied.push('selfVerification');
  } else {
    skipped.push('selfVerification');
  }

  return { applied, skipped, unknownCommandModules };
}

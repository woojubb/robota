/**
 * Preset selection glue — thin shell over `@robota-sdk/agent-preset`.
 * The CLI only selects the preset id and forwards CLI flags as overrides; the
 * precedence merge lives entirely inside `resolvePreset` (agent-preset), never here.
 */

import { resolvePreset } from '@robota-sdk/agent-preset';
import type { TResolvedPresetOptions } from '@robota-sdk/agent-preset';

import type { IParsedCliArgs } from '../utils/cli-args.js';

/** Pick the preset id: --preset flag > settings.preset > 'default'. Pure selection glue (shell). */
export function selectPresetId(
  args: Pick<IParsedCliArgs, 'preset'>,
  settingsPreset: string | undefined,
): string {
  return args.preset ?? settingsPreset ?? 'default';
}

/** Build the CLI-flag override set (highest-but-explicit tier) handed to resolvePreset. */
function buildPresetCliOverrides(args: IParsedCliArgs): TResolvedPresetOptions {
  return {
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
    ...(args.appendSystemPrompt !== undefined
      ? { appendSystemPrompt: args.appendSystemPrompt }
      : {}),
    ...(args.language !== undefined ? { language: args.language } : {}),
    ...(args.permissionMode !== undefined ? { permissionMode: args.permissionMode } : {}),
  };
}

/** Resolve the active preset → framework option bundle (merge owned by agent-preset). Throws on unknown id. */
export function resolveCliPreset(
  args: IParsedCliArgs,
  settingsPreset: string | undefined,
): TResolvedPresetOptions {
  return resolvePreset(selectPresetId(args, settingsPreset), {
    cliOverrides: buildPresetCliOverrides(args),
  });
}

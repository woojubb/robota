/**
 * Preset selection glue — thin shell over `@robota-sdk/agent-preset`.
 * The CLI only selects the preset id and forwards CLI flags as overrides; the
 * precedence merge lives entirely inside the resolver (agent-preset), never here.
 *
 * ARCH-008: the shell resolves over the kernel's PER-CALL instance registry (`createPresetRegistry`,
 * R8) — not `agent-preset`'s module-global `resolvePreset`. {@link resolveShellPreset} returns the
 * registry it resolved over together with the id and the override context, and `createRobotaProfile`
 * takes that whole result, so `assembleProduct` adopts the SAME registry and replays the SAME context.
 * One registry, one resolution: the shell and `product.defaultPreset` cannot drift apart, and the
 * module-global registry is no longer on robota's startup resolution path.
 */

import { createPresetRegistry } from '@robota-sdk/agent-preset';
import type {
  IPreset,
  IPresetRegistry,
  IResolvePresetContext,
  IResolvedPresetOptions,
} from '@robota-sdk/agent-preset';

import { parseToolList } from '../utils/cli-args.js';

import type { IParsedCliArgs } from '../utils/cli-args.js';

/** Pick the preset id: --preset flag > settings.preset > 'default'. Pure selection glue (shell). */
export function selectPresetId(
  args: Pick<IParsedCliArgs, 'preset'>,
  settingsPreset: string | undefined,
): string {
  return args.preset ?? settingsPreset ?? 'default';
}

/** Build the CLI-flag override set (highest-but-explicit tier) handed to the resolver. */
function buildPresetCliOverrides(args: IParsedCliArgs): IResolvedPresetOptions {
  return {
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.systemPrompt !== undefined ? { systemPrompt: args.systemPrompt } : {}),
    ...(args.appendSystemPrompt !== undefined
      ? { appendSystemPrompt: args.appendSystemPrompt }
      : {}),
    ...(args.language !== undefined ? { language: args.language } : {}),
    ...(args.permissionMode !== undefined ? { permissionMode: args.permissionMode } : {}),
    // ARCH-040 Group C (issue #1934): the tool lists go through the RESOLVER like every other
    // override, so `--allowed-tools` and a preset's list combine by the decided rule — allowlist
    // replaces, denylist unions — rather than by whichever spread happens to come last at a shell.
    // Before the lists reached a surface at all this did not matter; the moment they do, a shell
    // that also passes its own copy silently overrides the resolved answer.
    ...(parseToolList(args.allowedTools) !== undefined
      ? { allowedTools: parseToolList(args.allowedTools) }
      : {}),
    ...(parseToolList(args.deniedTools) !== undefined
      ? { deniedTools: parseToolList(args.deniedTools) }
      : {}),
  };
}

/**
 * The shell's ONE preset resolution (ARCH-008) — the registry it ran over, the id it picked, the
 * override layers it applied, and the resolved option bundle every shell surface binds to.
 *
 * Carried as a single value (rather than four loose locals) so the profile cannot be handed a registry,
 * id, or context other than the ones the resolution actually used: `IRobotaProfileInput` takes this
 * object, so a mismatch is not expressible.
 */
export interface IShellPresetResolution {
  /** The per-call instance-scoped registry (R8) the resolution ran over. Adopted by `assembleProduct`. */
  registry: IPresetRegistry;
  /** The selected preset id (`--preset` > `settings.preset` > `'default'`). */
  presetId: string;
  /** The override layers applied — replayed by the kernel so `product.defaultPreset` matches exactly. */
  context: IResolvePresetContext;
  /** The resolved framework option bundle (merge + posture mapping owned by agent-preset). */
  options: IResolvedPresetOptions;
}

/**
 * Resolve the active preset → framework option bundle, over a per-call instance registry built from the
 * external presets the shell loaded. The merge and the posture mapping stay in agent-preset.
 *
 * @throws Error when the selected id matches no preset in the registry.
 */
/**
 * PRESET-002/004/007/011 + ARCH-008/ARCH-009 — the shell's ONE preset resolution.
 *
 * `loadExternalPresets` reads `~/.robota/presets/*.json` (per-file problems are warnings, never
 * fatal) and REGISTERS NOTHING — it returns the presets it loaded. This builds the kernel's per-call
 * registry (R8) over them and resolves the selected id against it, returning registry + id +
 * override context as ONE value that travels whole into the profile. `assembleProduct` adopts that
 * same registry and surfaces it on the command host, which is where in-session `/preset` discovery
 * reads it.
 *
 * One registry, one load, no process state: the two surfaces cannot disagree because there is only
 * one of them.
 *
 * (Moved here from `cli.ts` by CLI-083: it describes this function, and the caller only needs to
 * know that resolution happens before command setup.)
 */
export function resolveShellPreset(
  externalPresets: readonly IPreset[],
  args: IParsedCliArgs,
  settingsPreset: string | undefined,
): IShellPresetResolution {
  const registry = createPresetRegistry(externalPresets);
  const presetId = selectPresetId(args, settingsPreset);
  const context: IResolvePresetContext = { cliOverrides: buildPresetCliOverrides(args) };
  return { registry, presetId, context, options: registry.resolvePreset(presetId, context) };
}

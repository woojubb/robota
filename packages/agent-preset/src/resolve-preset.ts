import { defaultPreset } from './presets/default.js';

import type {
  IPreset,
  TPresetAutonomy,
  TPresetPermissionMode,
  TResolvedPresetOptions,
} from './preset-types.js';

/**
 * Map a behavioural {@link TPresetAutonomy} posture onto a concrete permission mode.
 *
 * `act-first` opts into `acceptEdits` (writes are not prompted every time);
 * `ask-first` and `balanced` stay on `default` (the standard ask-on-write posture).
 * Only consulted when the resolved options set `autonomy` but no explicit
 * `permissionMode`/`defaultPermissionMode`.
 */
const AUTONOMY_TO_PERMISSION_MODE: Record<TPresetAutonomy, TPresetPermissionMode> = {
  'ask-first': 'default',
  balanced: 'default',
  'act-first': 'acceptEdits',
};

/**
 * Default agent identity. Owned by `agent-preset` (not baked into `defaultPreset`, which must stay
 * a no-op). Consumers apply this when no preset and no explicit override supplies an `agentName`.
 */
export const DEFAULT_AGENT_NAME = 'robota-cli';

/** Registry of built-in presets. */
const PRESETS: readonly IPreset[] = [defaultPreset];

/** Lightweight `{ id, title, description }` view of a preset for discovery/UX. */
export interface IPresetSummary {
  id: string;
  title: string;
  description: string;
}

/**
 * Override layers for {@link resolvePreset}, in increasing precedence.
 * `cliOverrides` model CLI flags; `explicit` models programmatic/SDK options.
 */
export interface IResolvePresetContext {
  cliOverrides?: TResolvedPresetOptions;
  explicit?: TResolvedPresetOptions;
}

/** Return the `{ id, title, description }` summary of every registered preset. */
export function listPresets(): readonly IPresetSummary[] {
  return PRESETS.map(({ id, title, description }) => ({ id, title, description }));
}

/** Look up a registered preset by id, or `undefined` if none matches. */
export function getPreset(id: string): IPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** Strip the identity triple from a preset, leaving only resolvable option overrides. */
function toPresetOptions(preset: IPreset): TResolvedPresetOptions {
  const { id: _id, title: _title, description: _description, ...options } = preset;
  return options;
}

/** Keep only the entries of `source` whose value is defined. */
function definedEntries(source: TResolvedPresetOptions): Partial<TResolvedPresetOptions> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
}

/** Merge `source` onto `target`, skipping `undefined` values so later layers only override set keys. */
function mergeDefined(
  target: TResolvedPresetOptions,
  source: TResolvedPresetOptions | undefined,
): TResolvedPresetOptions {
  if (!source) {
    return target;
  }
  return { ...target, ...definedEntries(source) };
}

/**
 * Resolve a preset id into framework option overrides.
 *
 * Precedence LOW → HIGH: preset options < `context.cliOverrides` < `context.explicit`
 * (later layers win; `undefined` values are skipped). For the no-op `'default'` preset the
 * result equals the merged overrides, guaranteeing no regression.
 *
 * @throws Error when `id` does not match a registered preset.
 */
export function resolvePreset(
  id: string,
  context: IResolvePresetContext = {},
): TResolvedPresetOptions {
  const preset = getPreset(id);
  if (!preset) {
    const available = PRESETS.map((p) => p.id).join(', ');
    throw new Error(`Unknown preset: "${id}". Available presets: ${available}.`);
  }

  let resolved = toPresetOptions(preset);
  resolved = mergeDefined(resolved, context.cliOverrides);
  resolved = mergeDefined(resolved, context.explicit);
  return derivePermissionMode(resolved);
}

/**
 * Fill the framework `permissionMode` seam from the preset's posture fields when it
 * is not already set. Precedence: explicit `permissionMode` (untouched) >
 * `defaultPermissionMode` > `autonomy` mapping. A no-op preset (no posture fields)
 * leaves the object unchanged — keeping `resolvePreset('default')` a no-op.
 */
function derivePermissionMode(resolved: TResolvedPresetOptions): TResolvedPresetOptions {
  if (resolved.permissionMode !== undefined) {
    return resolved;
  }
  if (resolved.defaultPermissionMode !== undefined) {
    return { ...resolved, permissionMode: resolved.defaultPermissionMode };
  }
  if (resolved.autonomy !== undefined) {
    return { ...resolved, permissionMode: AUTONOMY_TO_PERMISSION_MODE[resolved.autonomy] };
  }
  return resolved;
}

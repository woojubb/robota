import { autonomousBuilderPreset } from './presets/autonomous-builder.js';
import { carefulReviewerPreset } from './presets/careful-reviewer.js';
import { defaultPreset } from './presets/default.js';
import { neutralExecutorPreset } from './presets/neutral-executor.js';

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

/** Registry of built-in presets. Built-ins always win on id conflict and cannot be overridden. */
const BUILT_IN_PRESETS: readonly IPreset[] = [
  defaultPreset,
  autonomousBuilderPreset,
  carefulReviewerPreset,
  neutralExecutorPreset,
];

/**
 * Module-level mutable registry of user-authored external presets (PRESET-007).
 * Populated by {@link registerExternalPresets}; the sync readers iterate
 * `[...BUILT_IN_PRESETS, ...externalPresets]` so external presets merge with the built-ins.
 */
const externalPresets: IPreset[] = [];

/** The merged preset registry: built-ins first, then registered external presets. */
function allPresets(): readonly IPreset[] {
  return [...BUILT_IN_PRESETS, ...externalPresets];
}

/** Lightweight `{ id, title, description }` view of a preset for discovery/UX. */
export interface IPresetSummary {
  id: string;
  title: string;
  description: string;
}

/** Outcome of {@link registerExternalPresets}: which ids registered and which were rejected. */
export interface IPresetRegistrationResult {
  registered: readonly string[];
  rejected: readonly { id: string; reason: string }[];
}

/**
 * Register user-authored external presets into the module-level registry.
 *
 * Conflict policy: an external preset whose id matches a BUILT-IN preset is rejected
 * (`'collides with built-in preset'`) — built-ins always win. An external preset whose id
 * matches an already-registered external preset is rejected (`'duplicate preset id'`) — first
 * registration wins. All other presets are appended and counted as registered.
 *
 * @returns the ids that registered and the `{ id, reason }` of each rejection.
 */
export function registerExternalPresets(presets: readonly IPreset[]): IPresetRegistrationResult {
  const builtInIds = new Set(BUILT_IN_PRESETS.map((preset) => preset.id));
  const registered: string[] = [];
  const rejected: { id: string; reason: string }[] = [];

  for (const preset of presets) {
    if (builtInIds.has(preset.id)) {
      rejected.push({ id: preset.id, reason: 'collides with built-in preset' });
      continue;
    }
    if (externalPresets.some((existing) => existing.id === preset.id)) {
      rejected.push({ id: preset.id, reason: 'duplicate preset id' });
      continue;
    }
    externalPresets.push(preset);
    registered.push(preset.id);
  }

  return { registered, rejected };
}

/**
 * Remove every registered external preset, leaving only the built-ins.
 * Used at startup before a fresh re-load and for test isolation.
 */
export function clearExternalPresets(): void {
  externalPresets.length = 0;
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
  return allPresets().map(({ id, title, description }) => ({ id, title, description }));
}

/** Look up a registered preset by id, or `undefined` if none matches. */
export function getPreset(id: string): IPreset | undefined {
  return allPresets().find((preset) => preset.id === id);
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
    const available = allPresets()
      .map((p) => p.id)
      .join(', ');
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

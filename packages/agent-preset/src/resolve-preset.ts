import { autonomousBuilderPreset } from './presets/autonomous-builder.js';
import { carefulReviewerPreset } from './presets/careful-reviewer.js';
import { defaultPreset } from './presets/default.js';
import { neutralExecutorPreset } from './presets/neutral-executor.js';

import type {
  IPreset,
  TPresetAutonomy,
  TPresetPermissionMode,
  IResolvedPresetOptions,
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

/** Lightweight `{ id, title, description }` view of a preset for discovery/UX. */
export interface IPresetSummary {
  id: string;
  title: string;
  description: string;
}

/** Outcome of {@link partitionExternalPresets}: which presets were accepted and which rejected. */
export interface IPresetRegistrationResult {
  accepted: readonly IPreset[];
  rejected: readonly { id: string; reason: string }[];
}

/**
 * Apply the external-preset conflict policy to one list, reading and mutating NOTHING outside it.
 *
 * Conflict policy: an external preset whose id matches a BUILT-IN preset is rejected
 * (`'collides with built-in preset'`) — built-ins always win. An external preset whose id matches an
 * earlier ACCEPTED external preset is rejected (`'duplicate preset id'`) — first one wins.
 *
 * ARCH-009. This is the whole of what the module-global registry used to be, minus the register:
 * the policy was never the process's to hold, only the list it was applied to was. Both callers —
 * {@link createPresetRegistry} and the external-preset loader — now pass their own list, so two
 * products in one process cannot see each other's presets, and a repeated load cannot accumulate.
 */
export function partitionExternalPresets(presets: readonly IPreset[]): IPresetRegistrationResult {
  const builtInIds = new Set(BUILT_IN_PRESETS.map((preset) => preset.id));
  const accepted: IPreset[] = [];
  const rejected: { id: string; reason: string }[] = [];

  for (const preset of presets) {
    if (builtInIds.has(preset.id)) {
      rejected.push({ id: preset.id, reason: 'collides with built-in preset' });
      continue;
    }
    if (accepted.some((existing) => existing.id === preset.id)) {
      rejected.push({ id: preset.id, reason: 'duplicate preset id' });
      continue;
    }
    accepted.push(preset);
  }

  return { accepted, rejected };
}

/**
 * Override layers for {@link resolvePreset}, in increasing precedence.
 * `cliOverrides` model CLI flags; `explicit` models programmatic/SDK options.
 */
export interface IResolvePresetContext {
  cliOverrides?: IResolvedPresetOptions;
  explicit?: IResolvedPresetOptions;
}

/** Strip the identity triple from a preset, leaving only resolvable option overrides. */
function toPresetOptions(preset: IPreset): IResolvedPresetOptions {
  const { id: _id, title: _title, description: _description, ...options } = preset;
  return options;
}

/** Keep only the entries of `source` whose value is defined. */
function definedEntries(source: IResolvedPresetOptions): Partial<IResolvedPresetOptions> {
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined));
}

/**
 * Merge `source` onto `target`, skipping `undefined` values so later layers only override set keys.
 *
 * ARCH-040 Group C (issue #1934): the two tool lists combine differently, and the difference is the
 * decision rather than an implementation detail.
 *
 * - **`allowedTools` REPLACES.** An allowlist is a statement of the COMPLETE permitted set, so a
 *   later, more specific layer stating one supersedes the earlier answer. Intersecting would let an
 *   earlier layer veto a tool the operator just named, and unioning would let it smuggle one in.
 * - **`deniedTools` UNIONS.** A denial is not weakened by a later layer that forgot to repeat it —
 *   forgetting is the common case, and the cost of the two mistakes is not symmetric.
 *
 * This lives HERE, in the resolver, because precedence is the resolver's job: a union applied by one
 * of three shells is a rule the other two disagree with, which is the class ARCH-013 exists over.
 */
function mergeDefined(
  target: IResolvedPresetOptions,
  source: IResolvedPresetOptions | undefined,
): IResolvedPresetOptions {
  if (!source) {
    return target;
  }
  const merged = { ...target, ...definedEntries(source) };
  return source.deniedTools !== undefined || target.deniedTools !== undefined
    ? { ...merged, deniedTools: unionTools(target.deniedTools, source.deniedTools) }
    : merged;
}

/** Every denial either layer stated, order preserved and duplicates dropped. */
function unionTools(
  earlier: readonly string[] | undefined,
  later: readonly string[] | undefined,
): string[] {
  return [...new Set([...(earlier ?? []), ...(later ?? [])])];
}

/**
 * Pure resolve over an explicit preset list — the core every {@link createPresetRegistry} instance
 * resolves through. Reads only its arguments; performs the precedence merge + permission-mode
 * derivation.
 *
 * Precedence LOW → HIGH: preset options < `context.cliOverrides` < `context.explicit` (later layers
 * win; `undefined` values are skipped). For the no-op `'default'` preset the result equals the
 * merged overrides.
 *
 * @throws Error when `id` does not match a preset in `presets`.
 */
function resolvePresetFrom(
  presets: readonly IPreset[],
  id: string,
  context: IResolvePresetContext = {},
): IResolvedPresetOptions {
  const preset = presets.find((p) => p.id === id);
  if (!preset) {
    const available = presets.map((p) => p.id).join(', ');
    throw new Error(`Unknown preset: "${id}". Available presets: ${available}.`);
  }

  let resolved = toPresetOptions(preset);
  resolved = mergeDefined(resolved, context.cliOverrides);
  resolved = mergeDefined(resolved, context.explicit);
  return derivePermissionMode(resolved);
}

/**
 * A per-call, instance-scoped preset registry (ARCH-005 R8) — since ARCH-009 the ONLY one there is.
 *
 * A registry holds its own merged list `[built-ins, ...accepted externals]`, so two products in one
 * process do not share one and repeat construction does not accumulate. The
 * `@robota-sdk/agent-product` assembler builds one per `assembleProduct` call and surfaces it on the
 * command-host context, which is how `/preset` inside a live session reaches THIS product's presets
 * rather than the process's.
 */
export interface IPresetRegistry {
  /** Resolve a preset id against this registry's presets. */
  resolvePreset(id: string, context?: IResolvePresetContext): IResolvedPresetOptions;
  /** Look up a preset by id within this registry, or `undefined`. */
  getPreset(id: string): IPreset | undefined;
  /** `{ id, title, description }` summaries of every preset in this registry. */
  listPresets(): readonly IPresetSummary[];
}

/**
 * Build an instance-scoped {@link IPresetRegistry} over `[built-ins, ...externalPresets]`.
 *
 * The conflict policy is {@link partitionExternalPresets}, applied to the argument list only: built-ins
 * always win, and among the external presets the first one wins. No module-level state is read or
 * mutated — this is a pure factory, and since ARCH-009 there is no module-level state to read.
 *
 * Called with no argument it is the BUILT-INS, which is the registry a host that supplies none gets.
 */
export function createPresetRegistry(externalPresets: readonly IPreset[] = []): IPresetRegistry {
  const merged: readonly IPreset[] = [
    ...BUILT_IN_PRESETS,
    ...partitionExternalPresets(externalPresets).accepted,
  ];

  return {
    resolvePreset: (id, context = {}) => resolvePresetFrom(merged, id, context),
    getPreset: (id) => merged.find((preset) => preset.id === id),
    listPresets: () => merged.map(({ id, title, description }) => ({ id, title, description })),
  };
}

/**
 * Fill the framework `permissionMode` seam from the preset's posture fields when it
 * is not already set. Precedence: explicit `permissionMode` (untouched) >
 * `defaultPermissionMode` > `autonomy` mapping. A no-op preset (no posture fields)
 * leaves the object unchanged — keeping `resolvePreset('default')` a no-op.
 */
function derivePermissionMode(resolved: IResolvedPresetOptions): IResolvedPresetOptions {
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

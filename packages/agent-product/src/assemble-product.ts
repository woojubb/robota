import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { createProviderFromConfig } from '@robota-sdk/agent-core';
import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createPresetRegistry } from '@robota-sdk/agent-preset';

import type { IAssembledProduct, IBuildRuntimeInput, IProductProfile } from './product-profile.js';
import type { TCompositionFieldPolicy } from '@robota-sdk/agent-capability-pack';
import type {
  FunctionTool,
  IAIProvider,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  ICommandHostAdapters,
  ICommandModule,
  TInteractiveSessionOptions,
} from '@robota-sdk/agent-framework';
import type { IPresetRegistry, IResolvedPresetOptions } from '@robota-sdk/agent-preset';

export const PRODUCT_PROFILE_FIELD_POLICIES = {
  id: 'surfaced',
  agentName: 'surfaced',
  version: 'surfaced',
  providerDefinitions: 'consumed-and-surfaced',
  providerSettings: 'consumed',
  provider: 'consumed-and-surfaced',
  presets: 'consumed',
  presetRegistry: 'consumed-and-surfaced',
  defaultPresetId: 'consumed-and-surfaced',
  presetContext: 'consumed',
  packs: 'consumed',
  baseCommandModules: 'consumed',
  backgroundTaskRunners: 'surfaced',
  subagentRunnerFactory: 'surfaced',
  transports: 'consumed-and-surfaced',
} as const satisfies Record<keyof IProductProfile, TCompositionFieldPolicy>;

/** The product-owned materials the assembler overlays onto the shell-supplied session options. */
interface IOverlayMaterials {
  provider: IAIProvider | undefined;
  commandModules: readonly ICommandModule[];
  tools: readonly FunctionTool[];
  subagents: readonly IAgentDefinition[];
  defaultPermissionMode: TPermissionMode | undefined;
  /** ARCH-009: the instance preset registry, so `/preset` discovers this product's presets. */
  presetRegistry: IPresetRegistry;
}

/**
 * Overlay the assembled command modules, pack tools, and pack subagents onto the shell's session options.
 * The injected pre-built-session path gets command modules only (its session already owns its tools); the
 * standard construction path also receives the additive pack tools and — via the framework's
 * `agentDefinitions` injection seam (ARCH-005 S2, owner Decision 2) — the merged pack subagents, so a
 * pack's subagents actually reach the runtime instead of being inert material. `agentDefinitions` is left
 * UNSET when no pack contributes one, so the framework's own built-ins + discovery are unchanged.
 *
 * The default preset's `permissionMode` is applied only when the shell left it unset.
 */
function overlaySessionOptions(
  base: TInteractiveSessionOptions,
  materials: IOverlayMaterials,
): TInteractiveSessionOptions {
  const provider = base.provider ?? materials.provider;
  const permissionModeOverlay =
    base.permissionMode === undefined && materials.defaultPermissionMode !== undefined
      ? { permissionMode: materials.defaultPermissionMode }
      : {};
  // ARCH-007: the shell may hand in a selection it has ALREADY narrowed — `robota` applies its preset's
  // enabled/disabledCommandModules delta to the merged `base ⊕ packs` superset before calling the seam
  // (the spec's composition order: the merge widens, the preset delta narrows). Overwriting it here would
  // silently undo that narrowing, so the assembled set is overlaid only when the caller left it unset —
  // the same "only when the shell left it unset" rule `permissionMode` already follows.
  const commandModules = base.commandModules ?? materials.commandModules;
  // ARCH-009: MERGED into the shell's bag, never substituted for it. The shell wires its own adapters
  // there (remote control, process, settings) and the registry stands beside them; replacing the bag
  // would silently drop capabilities this assembler knows nothing about. Both arms get it — an
  // injected session is exactly the embedded-host case the item is about.
  const commandHostAdapters: ICommandHostAdapters = {
    ...base.commandHostAdapters,
    presetRegistry: materials.presetRegistry,
  };

  if ('session' in base) {
    return {
      ...base,
      provider,
      commandModules,
      commandHostAdapters,
      ...permissionModeOverlay,
    };
  }

  if (provider === undefined) {
    throw new Error(
      'assembleProduct: no provider available — the profile carried neither `providerSettings` nor an injected `provider`, and the session options supplied none.',
    );
  }

  return {
    ...base,
    provider,
    commandModules,
    commandHostAdapters,
    additionalTools: [
      ...(base.additionalTools ?? []),
      ...(materials.tools as readonly IToolWithEventService[]),
    ],
    ...(materials.subagents.length > 0 ? { agentDefinitions: materials.subagents } : {}),
    ...permissionModeOverlay,
  };
}

/**
 * The single product-composition function — a PURE, deterministic, IO-free fold over `IProductProfile`.
 *
 * `assembleProduct` is a **peer** of the repo's already-blessed pure folds (`resolvePreset`,
 * `mergeSettings`, `mergeCapabilityPacks`): it reads only its argument, calls only pure sub-folds and the
 * framework's runtime-construction seam, and hard-codes **no** product's choices — there is ZERO
 * product-specific branching (no `if (profile.id === '…')` ever). Everything product-specific arrives as
 * `profile` DATA. This property is what makes the `agent-product` carve-out safe under the amended
 * project-structure L129 rule, and it is enforced by the three composition-neutrality guards
 * (dependency-graph neutrality, purity/no-IO, no product-name conditionals).
 *
 * What it does:
 * 1. Builds a PER-CALL instance-scoped preset registry over `profile.presets` (R8) — or adopts the
 *    instance the caller already built and handed in as `profile.presetRegistry` (ARCH-008). Either way it
 *    never mutates agent-preset's module-level `externalPresets` global, so two products in one process do
 *    not share one registry and repeat calls do not accumulate. `defaultPresetId` is resolved over that
 *    registry with `profile.presetContext`, so the product's `defaultPreset` is the caller's resolution.
 * 2. Merges the additive capability packs onto `profile.baseCommandModules` via `mergeCapabilityPacks`
 *    (base ⊕ packs, with a rejection channel — never a silent override).
 * 3. Constructs the provider from `profile.providerDefinitions` + the shell's already-resolved
 *    `profile.providerSettings` (owner Decision 1) via agent-core's pure `createProviderFromConfig`; an
 *    injected `profile.provider` overrides it.
 * 4. Produces `buildRuntimeOptions`/`buildRuntime`, which DELEGATE runtime construction to
 *    `agent-framework`'s `buildRuntimeSession` seam (R2, RUNTIME-001 SSOT) — never re-implementing runtime
 *    assembly — overlaying the assembled modules, pack tools, and pack subagents (`agentDefinitions`).
 *
 * Settings/args/env resolution and concrete transports/presentation stay in the shell; `assembleProduct`
 * receives already-resolved data and returns neutral materials the shell binds its own transport over.
 */
export function assembleProduct(profile: IProductProfile): IAssembledProduct {
  // (1) Per-call instance-scoped preset registry — pure w.r.t. process state (R8). A caller that had to
  // resolve a preset BEFORE it could build this profile (a preset can carry the `model`/`agentName` the
  // profile is constructed from) hands its own instance in as `presetRegistry`; the assembler then uses
  // THAT one rather than building a second, equivalent registry, so there is exactly one resolution path
  // (ARCH-008). Either way the registry is instance-scoped — no module-level state is read or mutated.
  const presets = profile.presetRegistry ?? createPresetRegistry(profile.presets ?? []);
  const defaultPreset: IResolvedPresetOptions | undefined =
    profile.defaultPresetId !== undefined
      ? presets.resolvePreset(profile.defaultPresetId, profile.presetContext)
      : undefined;

  // (2) Additive capability merge — base ⊕ packs, deterministic, with a rejection channel.
  const { merged, acceptedPacks, rejected, rejectedPacks } = mergeCapabilityPacks(
    profile.baseCommandModules ?? [],
    profile.packs ?? [],
  );

  // (3) Provider construction — IN-KERNEL, from the profile's definitions + the shell's ALREADY-RESOLVED
  // settings (owner Decision 1). `createProviderFromConfig` is a pure `config → IAIProvider` factory that
  // lives in `@robota-sdk/agent-core` (relocated there by ARCH-PROVIDER-003), an ALLOWED dependency layer,
  // so this reads no fs/env and the fold stays pure. An injected `profile.provider` wins (advanced/test
  // override, e.g. `--session-log` replay); with neither, no provider is constructed and the consumer
  // supplies one in the `buildRuntime` session options (the Mode A shape).
  const provider =
    profile.provider ??
    (profile.providerSettings !== undefined
      ? createProviderFromConfig(profile.providerSettings, profile.providerDefinitions)
      : undefined);

  // (4) The runtime-construction delegate — DELEGATES to the framework seam, never re-implements.
  const buildRuntimeOptions = (input: IBuildRuntimeInput): TInteractiveSessionOptions =>
    overlaySessionOptions(input.session, {
      provider,
      commandModules: merged.commandModules,
      tools: merged.tools,
      subagents: merged.subagents,
      defaultPermissionMode: defaultPreset?.permissionMode,
      // ARCH-009: the instance registry reaches the SESSION through the host-adapter bag, so
      // `/preset` discovers through the same presets this product resolved with. It was already
      // assembled here and surfaced on the product; what was missing was the last hop, which is why
      // `/preset` read a module global and why two products in one process shared one mutable list.
      presetRegistry: presets,
    });

  return {
    id: profile.id,
    ...(profile.agentName !== undefined ? { agentName: profile.agentName } : {}),
    ...(profile.version !== undefined ? { version: profile.version } : {}),
    ...(provider !== undefined ? { provider } : {}),
    providerDefinitions: profile.providerDefinitions,
    commandModules: merged.commandModules,
    tools: merged.tools,
    subagents: merged.subagents,
    acceptedPacks,
    rejectedCapabilities: rejected,
    rejectedPacks,
    presets,
    resolvePreset: (id, context) => presets.resolvePreset(id, context),
    ...(profile.defaultPresetId !== undefined ? { defaultPresetId: profile.defaultPresetId } : {}),
    ...(defaultPreset !== undefined ? { defaultPreset } : {}),
    backgroundTaskRunners: profile.backgroundTaskRunners ?? [],
    ...(profile.subagentRunnerFactory !== undefined
      ? { subagentRunnerFactory: profile.subagentRunnerFactory }
      : {}),
    ...(profile.transports !== undefined
      ? {
          transports:
            typeof profile.transports === 'function' ? profile.transports() : profile.transports,
        }
      : {}),
    buildRuntimeOptions,
    buildRuntime: (input) => buildRuntimeSession(buildRuntimeOptions(input)),
  };
}

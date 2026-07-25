import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createPresetRegistry } from '@robota-sdk/agent-preset';

import type { IAssembledProduct, IBuildRuntimeInput, IProductProfile } from './product-profile.js';
import type {
  FunctionTool,
  IAIProvider,
  IToolWithEventService,
  TPermissionMode,
} from '@robota-sdk/agent-core';
import type {
  ICommandModule,
  InteractiveSession,
  TInteractiveSessionOptions,
} from '@robota-sdk/agent-framework';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/** The product-owned materials the assembler overlays onto the shell-supplied session options. */
interface IOverlayMaterials {
  provider: IAIProvider;
  commandModules: readonly ICommandModule[];
  tools: readonly FunctionTool[];
  defaultPermissionMode: TPermissionMode | undefined;
}

/**
 * Overlay the assembled command modules + pack tools onto the shell's session options. The injected
 * pre-built-session path gets command modules only (its session already owns its tools); the standard
 * construction path also receives the additive pack tools. The default preset's `permissionMode` is
 * applied only when the shell left it unset.
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

  if ('session' in base) {
    return { ...base, provider, commandModules: materials.commandModules, ...permissionModeOverlay };
  }

  return {
    ...base,
    provider,
    commandModules: materials.commandModules,
    additionalTools: [
      ...(base.additionalTools ?? []),
      ...(materials.tools as readonly IToolWithEventService[]),
    ],
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
 * 1. Builds a PER-CALL instance-scoped preset registry over `profile.presets` (R8) — it never mutates
 *    agent-preset's module-level `externalPresets` global, so two products in one process do not share one
 *    registry and repeat calls do not accumulate.
 * 2. Merges the additive capability packs onto `profile.baseCommandModules` via `mergeCapabilityPacks`
 *    (base ⊕ packs, with a rejection channel — never a silent override).
 * 3. Produces `buildRuntime`, which DELEGATES runtime construction to `agent-framework`'s
 *    `buildRuntimeSession` seam (R2, RUNTIME-001 SSOT) — it never re-implements runtime assembly.
 *
 * Settings/args/env resolution and concrete transports/presentation stay in the shell; `assembleProduct`
 * receives already-resolved data and returns neutral materials the shell binds its own transport over.
 */
export function assembleProduct(profile: IProductProfile): IAssembledProduct {
  // (1) Per-call instance-scoped preset registry — pure w.r.t. process state (R8).
  const presets = createPresetRegistry(profile.presets ?? []);
  const defaultPreset: IResolvedPresetOptions | undefined =
    profile.defaultPresetId !== undefined ? presets.resolvePreset(profile.defaultPresetId) : undefined;

  // (2) Additive capability merge — base ⊕ packs, deterministic, with a rejection channel.
  const { merged, rejected } = mergeCapabilityPacks(
    profile.baseCommandModules ?? [],
    profile.packs ?? [],
  );

  // (3) The runtime-construction delegate — DELEGATES to the framework seam, never re-implements.
  const buildRuntime = (input: IBuildRuntimeInput): InteractiveSession =>
    buildRuntimeSession(
      overlaySessionOptions(input.session, {
        provider: profile.provider,
        commandModules: merged.commandModules,
        tools: merged.tools,
        defaultPermissionMode: defaultPreset?.permissionMode,
      }),
    );

  return {
    id: profile.id,
    ...(profile.agentName !== undefined ? { agentName: profile.agentName } : {}),
    ...(profile.version !== undefined ? { version: profile.version } : {}),
    provider: profile.provider,
    commandModules: merged.commandModules,
    tools: merged.tools,
    subagents: merged.subagents,
    rejectedCapabilities: rejected,
    presets,
    resolvePreset: (id, context) => presets.resolvePreset(id, context),
    ...(profile.defaultPresetId !== undefined ? { defaultPresetId: profile.defaultPresetId } : {}),
    ...(defaultPreset !== undefined ? { defaultPreset } : {}),
    backgroundTaskRunners: profile.backgroundTaskRunners ?? [],
    ...(profile.subagentRunnerFactory !== undefined
      ? { subagentRunnerFactory: profile.subagentRunnerFactory }
      : {}),
    ...(profile.transports !== undefined
      ? { transports: typeof profile.transports === 'function' ? profile.transports() : profile.transports }
      : {}),
    buildRuntime,
  };
}

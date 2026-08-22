/**
 * ARCH-005 S2 — the concrete plumbing `robota`'s shell injects into its product profile.
 *
 * These are the product-owned I/O adapters `assembleProduct` must never construct itself: the transport
 * registry with a real `WsTransport` registered, and the dev-only session-log replay provider. They live
 * beside the profile (not in `cli.ts`) so the entry point stays arg parsing + mode dispatch, and so the
 * "concrete transports stay in the shell, injected as data" boundary is visible in one place.
 */

import { createRequire } from 'node:module';

import {
  createRestrictedWorkspaceProjectAccess,
  findUnknownModuleNames,
  getUserSettingsPath,
  selectCommandModules,
} from '@robota-sdk/agent-framework';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { WsTransport } from '@robota-sdk/agent-transport-ws';

import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IAgentDefinition,
  ICommandModule,
  IUnknownCommandModuleName,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { ROBOTA_PACKS_OWN_TOOL_SURFACE } from './robota-profile.js';

import type { IAssembledProduct } from '@robota-sdk/agent-product';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/**
 * Load the optional session-log replay provider (INFRA-017). `@robota-sdk/agent-provider-replay` is a
 * dev/test-only package deliberately kept out of the published dependency graph, so `--session-log`
 * replay is a development capability: resolvable in the monorepo (and for anyone who installs the
 * package), and reported as unavailable — never a hard crash — in the default published CLI.
 */
export function loadReplayProvider(logFile: string): IAIProvider {
  let mod: {
    createReplayProviderFromNodeLogFile: (file: string) => IAIProvider;
  };
  try {
    const requireFrom = createRequire(import.meta.url);
    mod = requireFrom('@robota-sdk/agent-provider-replay') as typeof mod;
  } catch {
    throw new Error(
      '--session-log replay requires @robota-sdk/agent-provider-replay, a dev-only package that is not bundled in the published CLI.',
    );
  }
  return mod.createReplayProviderFromNodeLogFile(logFile);
}

/**
 * Shell-owned wiring of the default transport registry. The generic registry lives in
 * `@robota-sdk/agent-transport`; choosing which concrete transports to pre-register is a
 * product-assembly decision, so the shell wires `WsTransport` here and injects the registry into the
 * profile as a read-only view — the neutral assembler never imports a concrete transport.
 */
export function createDefaultTransportRegistry(): {
  registry: TransportRegistry;
  wsTransport: WsTransport;
} {
  const registry = new TransportRegistry(getUserSettingsPath());
  // GUI-002: when a host (e.g. the agent-gui Electron shell) spawns this CLI as a loopback sidecar, it
  // passes ROBOTA_WS_TOKEN (a per-launch nonce) + optional ROBOTA_WS_PORT via env. The token makes the WS
  // transport reject any unauthenticated connection before emitting session data. Absent = unchanged
  // default (open localhost path); the token is never persisted to settings (secret, runtime-only).
  const wsToken = process.env['ROBOTA_WS_TOKEN'];
  const wsPortRaw = process.env['ROBOTA_WS_PORT'];
  const wsPort = wsPortRaw ? Number.parseInt(wsPortRaw, 10) : undefined;
  const wsTransport = new WsTransport({
    ...(wsToken ? { token: wsToken } : {}),
    ...(wsPort !== undefined && Number.isInteger(wsPort) ? { port: wsPort } : {}),
  });
  registry.register(wsTransport);
  // GUI-007: return the WS transport so `--serve --open` can read its `boundPort` to point the served
  // monitor's `ws-url` at the actual port.
  return { registry, wsTransport };
}

/**
 * The command-module NAMES the assembled product will carry: `baseCommandModules` ⊕ the pack-supplied
 * names, in merge order. Deriving the names without assembling lets the shell surface the INFRA-032
 * unknown-preset-module notice at its original point in the startup sequence — before the
 * `init`/`--configure`/provider-config early-returns — since `findUnknownModuleNames` needs only names.
 *
 * This equals `assembleProduct(...).commandModules.map(m => m.name)` exactly, because the product's base
 * excludes every pack-supplied name, so the merge appends them with no collision and no rejection. The
 * equivalence test asserts that identity so the two cannot drift apart.
 */
export function mergedCommandModuleNames(
  baseCommandModules: readonly ICommandModule[],
  packCommandModuleNames: readonly string[],
): readonly string[] {
  return [...baseCommandModules.map((module) => module.name), ...packCommandModuleNames];
}

/**
 * Report the preset selection names that matched no command module (INFRA-032) — a short form like
 * `"editor"` instead of `agent-command-editor`, or a typo. Non-fatal: surfaced, never silently dropped.
 */
export function findUnknownPresetModuleNames(
  moduleNames: readonly string[],
  preset: Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>,
): readonly IUnknownCommandModuleName[] {
  return findUnknownModuleNames(
    moduleNames,
    preset.enabledCommandModules,
    preset.disabledCommandModules,
  );
}

/**
 * Apply the preset's module-selection delta to the assembled base ⊕ pack SUPERSET, then append the fixed
 * modules the delta never filters (`/workflows`, caller-injected).
 *
 * ARCH-005: "this merger only produces the base ⊕ pack superset that the preset delta then filters" — the
 * capability merge widens, the preset delta narrows, and they compose in that order.
 */
export function selectProductCommandModules(
  product: IAssembledProduct,
  fixedCommandModules: readonly ICommandModule[],
  preset: Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>,
): readonly ICommandModule[] {
  return [
    ...selectCommandModules(
      product.commandModules,
      preset.enabledCommandModules,
      preset.disabledCommandModules,
    ),
    ...fixedCommandModules,
  ];
}

/**
 * INFRA-032: report every preset command-module name that matched no module — a short form like `"editor"`
 * instead of `agent-command-editor`, or a typo. Non-fatal: surfaced, never silently dropped, never an
 * abort, mirroring the external-preset skip reporting.
 *
 * Computed from the base ⊕ pack NAME superset, so no assembly is needed and the notice still fires BEFORE
 * the `init`/`--configure`/provider-config early-returns, exactly where it did before ARCH-005 S2.
 */
export function reportUnknownPresetModules(
  writeError: (message: string) => void,
  baseCommandModules: readonly ICommandModule[],
  packCommandModuleNames: readonly string[],
  preset: Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>,
): void {
  for (const { name, kind } of findUnknownPresetModuleNames(
    mergedCommandModuleNames(baseCommandModules, packCommandModuleNames),
    preset,
  )) {
    writeError(
      `Preset command-module "${name}" (${kind}) matched no module — expected the agent-command-* form; ignored.`,
    );
  }
}

/** The shell-resolved inputs `robota` hands to the kernel's runtime seam. */
export interface IRobotaRuntimeSeamInput {
  /** The assembled product whose overlay lays the product-owned materials on top. */
  product: IAssembledProduct;
  cwd: string;
  provider: IAIProvider;
  /** The shell's already-narrowed module selection (merged superset filtered by the preset delta). */
  selectedCommandModules: readonly ICommandModule[];
  /**
   * An EXPLICIT permission mode (`--permission-mode`). Left undefined, the kernel overlays the default
   * preset's posture — which is exactly the `args.permissionMode ?? resolvedPreset.permissionMode`
   * expression each surface used to compute by hand.
   */
  permissionMode?: TPermissionMode;
  projectAccess?: TWorkspaceProjectAccess;
}

/**
 * The product-owned session options `robota`'s three presentation channels are bound to — produced by the
 * KERNEL, not re-threaded by the shell.
 *
 * `buildRuntimeOptions` returns the `TInteractiveSessionOptions` UNION, so reading back the very fields the
 * overlay just added requires narrowing to the standard branch (recorded as finding F1 of the ARCH-005 S3
 * external proof). The shell supplies a standard-branch input, so the narrowing is sound; it is asserted
 * rather than assumed.
 */
export interface IRobotaRuntimeOptions {
  provider: IAIProvider;
  commandModules: readonly ICommandModule[];
  agentDefinitions: readonly IAgentDefinition[];
  /** The tool surface, grouped so every presentation channel is handed the SAME pair. */
  toolOptions: {
    additionalTools: IToolWithEventService[];
    defaultTools?: readonly IToolWithEventService[];
  };
  permissionMode?: TPermissionMode;
  projectAccess: TWorkspaceProjectAccess;
}

/**
 * ARCH-007 (B1) — route `robota` through the composition kernel's RUNTIME SEAM.
 *
 * Before this, `cli.ts` consumed the kernel's MATERIALS but hand-threaded them into
 * `runPrintMode` / `runServeMode` / `renderApp`, so the overlay — pack tools → `additionalTools`, pack
 * subagents → `agentDefinitions`, the default preset's `permissionMode` — was exercised only by tests and
 * by external Mode-A consumers, never by the reference product. Now the shell resolves its own session
 * inputs, the kernel lays the product-owned materials on top, and every surface binds to that ONE result.
 */
export function buildRobotaRuntimeOptions(input: IRobotaRuntimeSeamInput): IRobotaRuntimeOptions {
  const projectAccess =
    input.projectAccess ??
    createRestrictedWorkspaceProjectAccess('identity-unavailable', input.cwd);
  const options = input.product.buildRuntimeOptions({
    session: {
      cwd: input.cwd,
      provider: input.provider,
      commandModules: input.selectedCommandModules,
      // ARCH-006: hand the tool axis to the packs. The kernel's overlay appends their tools to
      // `additionalTools`; suppressing the framework tier here is what makes the packs the SOLE source.
      defaultTools: ROBOTA_PACKS_OWN_TOOL_SURFACE,
      projectAccess,
      ...(input.permissionMode !== undefined ? { permissionMode: input.permissionMode } : {}),
    },
  });
  if ('session' in options) {
    throw new Error(
      'buildRobotaRuntimeOptions: the kernel returned the injected-session branch for a standard-construction input.',
    );
  }
  return {
    ...options,
    projectAccess,
    commandModules: options.commandModules ?? [],
    agentDefinitions: options.agentDefinitions ?? [],
    // ARCH-006: `defaultTools` is deliberately NOT defaulted to `[]` here. An ABSENT tier (the framework
    // builds its own) and a SUPPRESSED tier (the packs own it) are different products, and collapsing them
    // would let the acceptance gate pass while the suppression was silently gone.
    toolOptions: {
      additionalTools: options.additionalTools ?? [],
      ...(options.defaultTools !== undefined ? { defaultTools: options.defaultTools } : {}),
    },
  };
}

/**
 * The channel-ready handler the TUI calls on every live-channel creation.
 *
 * A factory rather than a literal at the call site, because the two things it does are the same
 * subject — keeping process-level and remote-control state pointed at the channel the user is
 * actually driving — and neither is about assembling CLI options. It is called again on a
 * session-switch re-creation, which is why both targets are re-pointed rather than set once: an
 * enable that attached the previous channel would surface its async failures into a history nobody
 * is reading.
 */
export function createChannelReadyHandler<TChannel extends TLive & TRemote, TLive, TRemote>(
  setLive: (channel: TLive) => void,
  setRemoteControl: (channel: TRemote) => void,
  // PEER-006: optional, because the two existing setters are what a channel MUST reach and peer
  // messaging is a capability a host may not have. A required parameter here would make every
  // caller — including tests that care about neither peer — declare an opinion about it.
  startPeers?: (channel: TChannel) => void,
): (channel: TChannel) => void {
  return (channel) => {
    setLive(channel);
    setRemoteControl(channel);
    startPeers?.(channel);
  };
}

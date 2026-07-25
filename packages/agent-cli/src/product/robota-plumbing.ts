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
  findUnknownModuleNames,
  getUserSettingsPath,
  selectCommandModules,
} from '@robota-sdk/agent-framework';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { WsTransport } from '@robota-sdk/agent-transport-ws';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ICommandModule, IUnknownCommandModuleName } from '@robota-sdk/agent-framework';
import type { IAssembledProduct } from '@robota-sdk/agent-product';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/**
 * Load the optional session-log replay provider (INFRA-017). `@robota-sdk/agent-provider-replay` is a
 * dev/test-only package deliberately kept out of the published dependency graph, so `--session-log`
 * replay is a development capability: resolvable in the monorepo (and for anyone who installs the
 * package), and reported as unavailable — never a hard crash — in the default published CLI.
 */
export function loadReplayProvider(logFile: string): IAIProvider {
  let mod: { createReplayProviderFromLogFile: (file: string) => IAIProvider };
  try {
    const requireFrom = createRequire(import.meta.url);
    mod = requireFrom('@robota-sdk/agent-provider-replay') as typeof mod;
  } catch {
    throw new Error(
      '--session-log replay requires @robota-sdk/agent-provider-replay, a dev-only package that is not bundled in the published CLI.',
    );
  }
  return mod.createReplayProviderFromLogFile(logFile);
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
 * Apply the preset's module-selection delta to the assembled base ⊕ pack SUPERSET, then append the fixed
 * modules the delta never filters (`/workflows`, caller-injected).
 *
 * ARCH-005: "this merger only produces the base ⊕ pack superset that the preset delta then filters" — the
 * capability merge widens, the preset delta narrows, and they compose in that order.
 *
 * Also returns the selection names that matched no module (INFRA-032), computed against the same superset,
 * so the shell can surface a non-fatal notice per unknown instead of dropping it silently.
 */
export function selectProductCommandModules(
  product: IAssembledProduct,
  fixedCommandModules: readonly ICommandModule[],
  preset: Pick<IResolvedPresetOptions, 'enabledCommandModules' | 'disabledCommandModules'>,
): {
  commandModules: readonly ICommandModule[];
  unknownModuleNames: readonly IUnknownCommandModuleName[];
} {
  const { enabledCommandModules, disabledCommandModules } = preset;
  return {
    commandModules: [
      ...selectCommandModules(
        product.commandModules,
        enabledCommandModules,
        disabledCommandModules,
      ),
      ...fixedCommandModules,
    ],
    unknownModuleNames: findUnknownModuleNames(
      product.commandModules.map((module) => module.name),
      enabledCommandModules,
      disabledCommandModules,
    ),
  };
}

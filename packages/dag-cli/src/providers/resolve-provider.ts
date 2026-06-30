// PROVIDER-007: CLI helper that resolves the active runtime provider.
//
// Resolves the in-process LocalDagRuntimeProvider (the default and, currently,
// only runtime provider). A `--provider` flag / DAG_DEFAULT_PROVIDER env var
// selects the provider name; additional native providers may register later.

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import { createCliNodeRegistry } from '../local-runner/node-registry.js';

import type { IDagRuntimeProvider } from '@robota-sdk/dag-core';

export interface IResolveProviderOptions {
  /** Provider name. Overrides DAG_DEFAULT_PROVIDER. Defaults to `local`. */
  provider?: string;
  /** Project directory for local node-file scanning (local provider). */
  projectDir?: string;
}

/**
 * Resolve the runtime provider to use for the current command invocation.
 *
 * Default (and currently only): `local` (in-process).
 */
export async function resolveProvider(
  opts: IResolveProviderOptions = {},
): Promise<IDagRuntimeProvider> {
  const providerName = opts.provider ?? process.env['DAG_DEFAULT_PROVIDER'] ?? 'local';

  if (providerName !== 'local') {
    throw new Error(`Unknown provider "${providerName}". Supported providers: local.`);
  }

  return new LocalDagRuntimeProvider({
    nodeRegistry: createCliNodeRegistry(),
    ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
  });
}

/** List the providers known to the CLI. Used by `dag_provider_list` MCP tool. */
export function listAvailableProviders(): Array<{ id: string; displayName: string }> {
  return [{ id: 'local', displayName: 'Local (in-process)' }];
}

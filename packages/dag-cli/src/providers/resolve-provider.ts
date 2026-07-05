// PROVIDER-007 / WORKFLOW-002 Phase C: CLI helper that resolves the active runtime provider.
//
// Resolves either the in-process `LocalDagRuntimeProvider` (default) or the native
// `HttpDagRuntimeProvider` against a remote DAG runtime server (`apps/dag-runtime-server`).
// Provider name comes from a `--provider` flag / `DAG_DEFAULT_PROVIDER` env var; the HTTP
// provider's base URL comes from a `--server-url` flag (wins) else `DAG_RUNTIME_SERVER_URL`.

import { HttpDagRuntimeProvider, LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import { createCliNodeRegistry } from '../local-runner/node-registry.js';

import type { IDagRuntimeProvider } from '@robota-sdk/dag-core';

/** Env var holding the native DAG runtime-server base URL (overridden by `--server-url`). */
const RUNTIME_SERVER_URL_ENV = 'DAG_RUNTIME_SERVER_URL';

export interface IResolveProviderOptions {
  /** Provider name. Overrides DAG_DEFAULT_PROVIDER. Defaults to `local`. */
  provider?: string;
  /** Project directory for local node-file scanning (local provider). */
  projectDir?: string;
  /** Base URL of the native runtime server (http provider). Overrides DAG_RUNTIME_SERVER_URL. */
  serverUrl?: string;
}

/**
 * Resolve the runtime provider to use for the current command invocation.
 *
 * - `local` (default): in-process `LocalDagRuntimeProvider`.
 * - `http`: `HttpDagRuntimeProvider` against `--server-url` (else `DAG_RUNTIME_SERVER_URL`).
 */
export async function resolveProvider(
  opts: IResolveProviderOptions = {},
): Promise<IDagRuntimeProvider> {
  const providerName = opts.provider ?? process.env['DAG_DEFAULT_PROVIDER'] ?? 'local';

  if (providerName === 'local') {
    return new LocalDagRuntimeProvider({
      nodeRegistry: createCliNodeRegistry(),
      ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    });
  }

  if (providerName === 'http') {
    const baseUrl = opts.serverUrl ?? process.env[RUNTIME_SERVER_URL_ENV];
    if (baseUrl === undefined || baseUrl.trim().length === 0) {
      throw new Error(
        `Provider "http" requires a server URL. Pass --server-url <url> or set ${RUNTIME_SERVER_URL_ENV}.`,
      );
    }
    return new HttpDagRuntimeProvider({ baseUrl: baseUrl.trim() });
  }

  throw new Error(`Unknown provider "${providerName}". Supported providers: local, http.`);
}

/** List the providers known to the CLI. Used by `dag_provider_list` MCP tool. */
export function listAvailableProviders(): Array<{ id: string; displayName: string }> {
  return [
    { id: 'local', displayName: 'Local (in-process)' },
    { id: 'http', displayName: 'HTTP (native runtime server)' },
  ];
}

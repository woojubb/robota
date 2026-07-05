import type { IDagMcpEnvironment } from './types.js';
import { DEFAULT_DAG_SERVER_URL } from './types.js';

export type TDagMcpMode = 'http' | 'embedded';

export interface IDagMcpResolvedConfig {
  readonly mode: TDagMcpMode;
  readonly serverUrl: string;
}

/**
 * Resolves MCP connection mode from CLI args and environment variables.
 *
 * Mode resolution precedence:
 * 1. `--server-url <url>` flag → HTTP mode against that native runtime server (flag wins)
 * 2. `DAG_RUNTIME_SERVER_URL` env var set → HTTP mode with that URL
 * 3. Everything else (default) → Embedded in-process mode
 */
export function resolveDagMcpConfig(
  args: readonly string[],
  env: IDagMcpEnvironment = {},
): IDagMcpResolvedConfig {
  const serverUrlIndex = args.indexOf('--server-url');
  if (serverUrlIndex >= 0) {
    const value = args[serverUrlIndex + 1];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { mode: 'http', serverUrl: value };
    }
  }

  const envUrl =
    typeof env.DAG_RUNTIME_SERVER_URL === 'string' && env.DAG_RUNTIME_SERVER_URL.trim().length > 0
      ? env.DAG_RUNTIME_SERVER_URL
      : undefined;

  if (envUrl) {
    return { mode: 'http', serverUrl: envUrl };
  }

  return { mode: 'embedded', serverUrl: DEFAULT_DAG_SERVER_URL };
}

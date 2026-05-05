import type { IDagMcpEnvironment } from './types.js';
import { DEFAULT_DAG_SERVER_URL } from './types.js';

export interface IDagMcpResolvedConfig {
  readonly serverUrl: string;
}

export function resolveDagMcpConfig(
  args: readonly string[],
  env: IDagMcpEnvironment = {},
): IDagMcpResolvedConfig {
  const serverUrlIndex = args.indexOf('--server-url');
  if (serverUrlIndex >= 0) {
    const value = args[serverUrlIndex + 1];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { serverUrl: value };
    }
  }
  return {
    serverUrl:
      typeof env.ROBOTA_DAG_SERVER_URL === 'string' && env.ROBOTA_DAG_SERVER_URL.trim().length > 0
        ? env.ROBOTA_DAG_SERVER_URL
        : DEFAULT_DAG_SERVER_URL,
  };
}

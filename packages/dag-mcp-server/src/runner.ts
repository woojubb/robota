import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-api';
import { resolveDagMcpConfig } from './config.js';
import { createDagMcpServer } from './mcp-server.js';
import type { IDagMcpRunOptions } from './types.js';

const DEFAULT_VERSION = '1.0.0';

const defaultFetch = async (url: string, init?: RequestInit): Promise<Response> => fetch(url, init);

export async function runDagMcpServer(
  args: readonly string[],
  options: IDagMcpRunOptions = {},
): Promise<void> {
  const config = resolveDagMcpConfig(
    args,
    options.env ?? { ROBOTA_DAG_SERVER_URL: process.env.ROBOTA_DAG_SERVER_URL },
  );
  const client = new DagOrchestrationHttpClient({
    baseUrl: config.serverUrl,
    fetch: options.fetch ?? defaultFetch,
  });
  const server = createDagMcpServer({
    name: 'robota-dag',
    version: DEFAULT_VERSION,
    client,
  });
  await server.connect(new StdioServerTransport());
}

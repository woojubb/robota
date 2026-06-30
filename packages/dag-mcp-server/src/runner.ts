import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import type { IDagOrchestrationPort } from '@robota-sdk/dag-orchestration-client';
import { resolveDagMcpConfig } from './config.js';
import { createDagMcpServer } from './mcp-server.js';
import type { IDagMcpRunOptions } from './types.js';

const DEFAULT_VERSION = '1.0.0';

const defaultFetch = async (url: string, init?: RequestInit): Promise<Response> => fetch(url, init);

interface IClientHandle {
  readonly client: IDagOrchestrationPort;
  dispose(): Promise<void>;
}

async function buildHttpClient(
  serverUrl: string,
  options: IDagMcpRunOptions,
): Promise<IClientHandle> {
  const client = new DagOrchestrationHttpClient({
    baseUrl: serverUrl,
    fetch: options.fetch ?? defaultFetch,
  });
  return { client, dispose: async () => undefined };
}

async function buildEmbeddedClient(): Promise<IClientHandle> {
  // eslint-disable-next-line no-restricted-syntax -- conditional lazy import for embedded mode
  const { createDagFramework } = await import('@robota-sdk/dag-framework');
  const fw = await createDagFramework({ autoStart: true });
  return {
    client: fw.client,
    dispose: () => fw.stop(),
  };
}

export async function runDagMcpServer(
  args: readonly string[],
  options: IDagMcpRunOptions = {},
): Promise<void> {
  const config = resolveDagMcpConfig(
    args,
    options.env ?? {
      ROBOTA_DAG_SERVER_URL: process.env.ROBOTA_DAG_SERVER_URL,
      ROBOTA_DAG_EMBEDDED: process.env.ROBOTA_DAG_EMBEDDED,
    },
  );

  const handle =
    config.mode === 'http'
      ? await buildHttpClient(config.serverUrl, options)
      : await buildEmbeddedClient();

  const server = createDagMcpServer({
    name: 'robota-dag',
    version: DEFAULT_VERSION,
    client: handle.client,
  });

  await server.connect(new StdioServerTransport());
  await handle.dispose();
}

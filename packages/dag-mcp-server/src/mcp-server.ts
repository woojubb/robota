import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  CallToolResult,
  ListToolsResult,
  Notification,
  Request,
} from '@modelcontextprotocol/sdk/types.js';
import { callDagMcpTool, createDagMcpToolDefinitions } from './dag-mcp-tools.js';
import type { IDagMcpServerOptions } from './types.js';

type TDagMcpServerResult = CallToolResult | ListToolsResult;

export function createDagMcpServer(
  options: IDagMcpServerOptions,
): Server<Request, Notification, TDagMcpServerResult> {
  const server = new Server<Request, Notification, TDagMcpServerResult>(
    {
      name: options.name ?? 'robota-dag',
      version: options.version ?? '1.0.0',
    },
    { capabilities: { tools: {} } },
  );
  const tools = createDagMcpToolDefinitions();

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<ListToolsResult> => ({
      tools: [...tools],
    }),
  );
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    callDagMcpTool(request.params.name, request.params.arguments, options.client),
  );

  return server;
}

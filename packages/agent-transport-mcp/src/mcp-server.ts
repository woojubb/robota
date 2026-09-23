/** MCP translates the canonical session tool port; execution policy stays in the session. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import type { IMcpTransportSession } from './mcp-session.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface IAgentMcpOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
}

const SUBMIT_TOOL = {
  name: 'robota_submit',
  description: 'Robota extension: submit a prompt to the agent and await its own turn',
  inputSchema: {
    type: 'object' as const,
    properties: { prompt: { type: 'string', minLength: 1 } },
    required: ['prompt'],
    additionalProperties: false,
  },
};

async function readCatalog(session: IMcpTransportSession): Promise<Tool[]> {
  const names = new Set([SUBMIT_TOOL.name]);
  return (await session.listRuntimeTools()).map((schema) => {
    if (names.has(schema.name)) {
      throw new Error(`Duplicate or reserved MCP tool name: ${schema.name}`);
    }
    names.add(schema.name);
    return ToolSchema.parse({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.parameters,
    });
  });
}

function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

/** Validate the JSON boundary before passing the SDK's unknown argument values to the runtime. */
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return typeof value === 'object' && value !== null && Object.values(value).every(isJsonValue);
}
function isRuntimeParameters(
  value: Record<string, unknown>,
): value is Parameters<IMcpTransportSession['invokeRuntimeTool']>[1] {
  return Object.values(value).every(isJsonValue);
}

async function submitPrompt(
  session: IMcpTransportSession,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
): Promise<CallToolResult> {
  if (
    typeof parameters.prompt !== 'string' ||
    parameters.prompt.length === 0 ||
    Object.keys(parameters).some((key) => key !== 'prompt')
  ) {
    return toolError('robota_submit requires a non-empty string prompt and no other arguments');
  }
  try {
    const handle = await session.submit(parameters.prompt, undefined, undefined, {
      signal,
    });
    const result = await handle.completed;
    return { content: [{ type: 'text', text: result.response }] };
  } catch (error) {
    if (!isTurnNotRunError(error) && !signal.aborted) throw error;
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

/** Validate the catalog before the caller connects a carrier. */
export async function createAgentMcpServer(options: IAgentMcpOptions): Promise<Server> {
  const { name, version, session } = options;
  await readCatalog(session);
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...(await readCatalog(session)), SUBMIT_TOOL],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name: toolName, arguments: parameters = {} } = request.params;
    let catalog;
    try {
      extra.signal.throwIfAborted();
      catalog = await readCatalog(session);
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
    if (toolName === SUBMIT_TOOL.name) return submitPrompt(session, parameters, extra.signal);
    if (!catalog.some((tool) => tool.name === toolName))
      return toolError(`Unknown tool: ${toolName}`);
    if (!isRuntimeParameters(parameters))
      return toolError('Tool arguments must contain JSON values');
    try {
      const result = await session.invokeRuntimeTool(toolName, parameters, {
        signal: extra.signal,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.success,
      };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : String(error));
    }
  });
  return server;
}

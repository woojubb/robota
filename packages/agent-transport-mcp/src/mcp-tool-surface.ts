/** One canonical tool catalog and invocation path shared by stdio and HTTP MCP carriers. */
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import type { IMcpTransportSession } from './mcp-session.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface IMcpSubmitToolIdentity {
  readonly name: string;
  readonly description: string;
}

const DEFAULT_SUBMIT_TOOL: IMcpSubmitToolIdentity = {
  name: 'agent_submit',
  description: 'Submit a prompt to the agent and await its turn',
};

export function resolveSubmitTool(identity: IMcpSubmitToolIdentity = DEFAULT_SUBMIT_TOOL): Tool {
  if (typeof identity.name !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(identity.name)) {
    throw new Error(
      'MCP submit tool name must contain 1–128 ASCII letters, digits, dots, hyphens, or underscores',
    );
  }
  return ToolSchema.parse({
    name: identity.name,
    description: identity.description,
    inputSchema: {
      type: 'object' as const,
      properties: { prompt: { type: 'string', minLength: 1 } },
      required: ['prompt'],
      additionalProperties: false,
    },
  });
}

export async function readCatalog(
  session: IMcpTransportSession,
  submitToolName: string,
): Promise<Tool[]> {
  const names = new Set([submitToolName]);
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

export async function invokeMcpTool(
  session: IMcpTransportSession,
  toolName: string,
  parameters: Record<string, unknown>,
  signal: AbortSignal,
  submitToolName: string,
): Promise<CallToolResult> {
  let catalog: Tool[];
  try {
    signal.throwIfAborted();
    catalog = await readCatalog(session, submitToolName);
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
  if (toolName === submitToolName) {
    if (
      typeof parameters.prompt !== 'string' ||
      parameters.prompt.length === 0 ||
      Object.keys(parameters).some((key) => key !== 'prompt')
    ) {
      return toolError(
        `${submitToolName} requires a non-empty string prompt and no other arguments`,
      );
    }
    try {
      const handle = await session.submit(parameters.prompt, undefined, undefined, { signal });
      const result = await handle.completed;
      return { content: [{ type: 'text', text: result.response }] };
    } catch (error) {
      if (!isTurnNotRunError(error) && !signal.aborted) throw error;
      return toolError(error instanceof Error ? error.message : String(error));
    }
  }
  if (!catalog.some((tool) => tool.name === toolName))
    return toolError(`Unknown tool: ${toolName}`);
  if (!isRuntimeParameters(parameters)) return toolError('Tool arguments must contain JSON values');
  try {
    const result = await session.invokeRuntimeTool(toolName, parameters, { signal });
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      isError: !result.success,
    };
  } catch (error) {
    return toolError(error instanceof Error ? error.message : String(error));
  }
}

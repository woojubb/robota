/**
 * MCP transport adapter — exposes IInteractiveSession as an MCP server.
 *
 * Uses the low-level MCP Server class to avoid TypeScript depth issues
 * with McpServer.registerTool() generics. Registers tools/list and
 * tools/call handlers directly.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import type { IExecutionResult, IInteractiveSession } from '@robota-sdk/agent-interface-transport';

export interface IAgentMcpOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
  /** IInteractiveSession to expose. */
  session: IInteractiveSession;
  /** If true, register each system command as a separate MCP tool. Default: true. */
  exposeCommands?: boolean;
}

/**
 * Create an MCP server that exposes IInteractiveSession over Model Context Protocol.
 *
 * Usage:
 * ```typescript
 * const server = createAgentMcpServer({
 *   name: 'robota-agent',
 *   version: '1.0.0',
 *   session: interactiveSession,
 * });
 *
 * import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
 * await server.connect(new StdioServerTransport());
 * ```
 */
export function createAgentMcpServer(options: IAgentMcpOptions): Server {
  const { name, version, session, exposeCommands = true } = options;

  const server = new Server({ name, version }, { capabilities: { tools: {} } });

  // Build tool definitions
  const tools: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }> = [
    {
      name: 'submit',
      description: 'Submit a prompt to the AI agent and wait for the response',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt to send to the agent' },
        },
        required: ['prompt'],
      },
    },
  ];

  if (exposeCommands) {
    for (const cmd of session.listCommands()) {
      // SEC-008: an MCP peer's model calls these, so a command that is not model-invocable is not
      // offered. `plugin` is the concrete case — it installs and enables code, which is why it
      // carries the tag — and it was offered here because the list this reads had dropped it.
      if (!cmd.modelInvocable) continue;
      tools.push({
        name: `command_${cmd.name}`,
        description: cmd.description,
        inputSchema: {
          type: 'object',
          properties: {
            args: { type: 'string', description: 'Command arguments' },
          },
        },
      });
    }
  }

  // tools/list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools,
  }));

  // tools/call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: toolArgs } = request.params;

    if (toolName === 'submit') {
      const prompt = (toolArgs as Record<string, string>)?.prompt;
      if (!prompt) {
        return {
          content: [{ type: 'text', text: 'Error: prompt is required' }],
          isError: true,
        };
      }
      const result = await waitForCompletion(session, prompt);
      return {
        content: [{ type: 'text', text: result.response }],
      };
    }

    // System commands: command_<name>
    if (toolName.startsWith('command_')) {
      const cmdName = toolName.slice('command_'.length);
      const args = (toolArgs as Record<string, string>)?.args ?? '';
      // SEC-008: not offering a tool is an advertisement, not a gate — a peer can call a name it was
      // never given. The list is re-consulted here so the refusal is enforced rather than assumed.
      const offered = session.listCommands().find((cmd) => cmd.name === cmdName);
      if (!offered?.modelInvocable) {
        return {
          content: [{ type: 'text', text: `Command not available over MCP: ${cmdName}` }],
          isError: true,
        };
      }
      // SEC-008: 'remote', not the default 'user'. An MCP peer is not the person at the keyboard,
      // and defaulting to the local operator both mis-attributed the call and skipped the 'remote'
      // policy seam that exists to treat the two differently.
      const result = await session.executeCommand(cmdName, args, 'remote');
      return {
        content: [
          {
            type: 'text',
            text: result?.message ?? `Unknown command: ${cmdName}`,
          },
        ],
        isError: !result,
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  });

  return server;
}

/**
 * Submit a prompt and wait for the complete/interrupted/error event.
 */
function waitForCompletion(
  session: IInteractiveSession,
  prompt: string,
): Promise<IExecutionResult> {
  return new Promise((resolve, reject) => {
    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      resolve(result);
    };
    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      resolve(result);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    session.submit(prompt).catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

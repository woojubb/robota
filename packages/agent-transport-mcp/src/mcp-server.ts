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
      // A refused submission is a TOOL error, not a protocol one, and review is why. `completed`
      // rejects with `TurnNotRunError` when the queue coalesced, dropped or cancelled this
      // submission — an ordinary outcome of asking a busy session, and the whole reason the handle
      // exists. Left to propagate, it leaves this request handler as a thrown exception and the SDK
      // reports a JSON-RPC protocol failure: the caller learns the CALL broke rather than that its
      // turn did not run, which is the ambiguity RUNTIME-003 set out to remove.
      //
      // `isError: true` with the reason, matching the `command_*` handler two blocks down.
      try {
        const result = await waitForCompletion(session, prompt);
        return {
          content: [{ type: 'text', text: result.response }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }

    // System commands: command_<name>
    if (toolName.startsWith('command_')) {
      const cmdName = toolName.slice('command_'.length);
      const args = (toolArgs as Record<string, string>)?.args ?? '';
      const result = await session.executeCommand(cmdName, args);
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
 * Submit a prompt and wait for THIS submission's turn.
 *
 * The previous version subscribed to the session-global `complete` / `interrupted` / `error` events
 * and resolved on whichever fired first. A session runs one turn at a time and queues the rest, so
 * two concurrent `submit` calls did not run concurrently — the second waited and then took the
 * RUNNING turn's response as its own answer. Both callers were told about one turn, and neither was
 * told which.
 *
 * `submit` now returns the submission's identity, so there is nothing left to correlate by hand: the
 * handle settles for the turn this call asked for, and for no other. A submission the session
 * accepted but never ran rejects with `TurnNotRunError`, which is reported as a tool error rather
 * than left to hang — the failure mode the event-listening version could not even express.
 */
async function waitForCompletion(
  session: IInteractiveSession,
  prompt: string,
): Promise<IExecutionResult> {
  const handle = await session.submit(prompt);
  return handle.completed;
}

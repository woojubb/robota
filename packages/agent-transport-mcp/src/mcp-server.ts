/**
 * MCP transport adapter — exposes IInteractiveSession as an MCP server.
 *
 * Uses the low-level MCP Server class to avoid TypeScript depth issues
 * with McpServer.registerTool() generics. Registers tools/list and
 * tools/call handlers directly.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import type { IMcpTransportSession } from './mcp-session.js';
import type { IExecutionResult } from '@robota-sdk/agent-interface-session';

export interface IAgentMcpOptions {
  /** Name for the MCP server. */
  name: string;
  /** Version string. */
  version: string;
  /** IInteractiveSession to expose. */
  session: IMcpTransportSession;
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
      // A refused submission is a TOOL error, not a protocol one, and review is why. `completed`
      // rejects with `TurnNotRunError` when the queue coalesced, dropped or cancelled this
      // submission — an ordinary outcome of asking a busy session, and the whole reason the handle
      // exists. Left to propagate, it leaves this request handler as a thrown exception and the SDK
      // reports a JSON-RPC protocol failure: the caller learns the CALL broke rather than that its
      // turn did not run, which is the ambiguity RUNTIME-003 set out to remove.
      //
      // `isError: true` with the reason, matching the `command_*` handler two blocks down.
      //
      // ONLY that refusal. The first version of this catch took everything, and review named what
      // that costs: a provider dying mid-turn came back as a soft tool error carrying a message
      // that reads like a queue decision, where before this change it surfaced as the protocol
      // failure it is. Making refusals soft must not make real failures soft with them, so anything
      // that is not the declared refusal is rethrown and reaches the caller as it did before.
      try {
        const result = await waitForCompletion(session, prompt);
        return {
          content: [{ type: 'text', text: result.response }],
        };
      } catch (error) {
        if (!isTurnNotRunError(error)) throw error;
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
  session: IMcpTransportSession,
  prompt: string,
): Promise<IExecutionResult> {
  const handle = await session.submit(prompt);
  return handle.completed;
}

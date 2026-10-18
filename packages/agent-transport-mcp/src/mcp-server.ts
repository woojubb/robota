/** MCP translates the canonical session tool port; execution policy stays in the session. */
import { Server } from '@modelcontextprotocol/server';

import { clientDeclaresFormElicitation } from './mcp-call-prompts.js';
import { invokeMcpTool, readCatalog, resolveSubmitTool } from './mcp-tool-surface.js';

import type { McpPendingCalls } from './mcp-pending-calls.js';
import type { IMcpTransportSession } from './mcp-session.js';
import type { IMcpSubmitToolIdentity, TMcpCaller } from './mcp-tool-surface.js';
import type { ServerContext, Tool } from '@modelcontextprotocol/server';

/**
 * The session's own prompt backstop settles an unanswered prompt long before this and withdraws
 * the question; this bounds only a client that neither answers nor goes away after that.
 */
const ELICITATION_TIMEOUT_MS = 60 * 60 * 1000;

export interface IAgentMcpOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
  /**
   * Put the permission and ask prompts a call raises to the client that made it, through MCP
   * elicitation, when that client declared form-mode elicitation. A permission offers allow-once
   * and deny only. Off by default: such prompts are tool errors.
   */
  askClient?: boolean;
}

/** How a carrier can reach back into the client that made a call. */
export type TMcpCallChannel =
  /** One stateful connection (stdio): a question goes to the client as an elicitation request. */
  | { readonly kind: 'connection' }
  /** A stateless HTTP exchange on the 2026-07-28 era: a question is returned as an input-required result and the parked call waits in `pending` for the retry. */
  | { readonly kind: 'rounds'; readonly pending: McpPendingCalls }
  /** A stateless legacy-era HTTP exchange: nothing can carry a question back to the client. */
  | { readonly kind: 'none' };

/**
 * One server instance over the canonical catalog, for a caller that has already validated the
 * catalog and owns the carrier: the stdio transport connects one for its connection, the HTTP
 * hosts build one per request. Both carriers answer from the same two handlers.
 */
export function buildAgentMcpServer(
  options: Omit<IAgentMcpOptions, 'submitTool'>,
  submitTool: Tool,
  channel: TMcpCallChannel = { kind: 'none' },
): Server {
  const { name, version, session } = options;
  const askClient = options.askClient === true;
  const rounds = askClient && channel.kind === 'rounds' ? channel.pending : undefined;
  const server = new Server(
    { name, version },
    {
      capabilities: { tools: {} },
      // A retry's token must name a call parked here; anything else is refused before the handler runs.
      ...(rounds !== undefined
        ? {
            requestState: {
              verify: (state: string) => {
                if (!rounds.has(state)) throw new Error('Unknown or expired MCP request state');
              },
            },
          }
        : {}),
    },
  );
  const callerOf = (ctx: ServerContext): TMcpCaller | undefined => {
    if (rounds !== undefined) {
      const requestState = ctx.mcpReq.requestState<string>();
      if (requestState !== undefined) {
        return { kind: 'rounds', pending: rounds, requestState, inputResponses: ctx.mcpReq.inputResponses };
      }
    }
    if (!askClient || !clientDeclaresFormElicitation(server.getClientCapabilities())) {
      return undefined;
    }
    if (channel.kind === 'connection') {
      return {
        kind: 'elicit',
        elicit: (form, signal) => server.elicitInput(form, { signal, timeout: ELICITATION_TIMEOUT_MS }),
      };
    }
    if (rounds !== undefined) {
      return { kind: 'rounds', pending: rounds, requestState: undefined, inputResponses: undefined };
    }
    return undefined;
  };
  server.setRequestHandler('tools/list', async () => ({
    tools: [...(await readCatalog(session, submitTool.name)), submitTool],
  }));
  server.setRequestHandler('tools/call', async (request, ctx) =>
    invokeMcpTool(
      session,
      request.params.name,
      request.params.arguments ?? {},
      ctx.mcpReq.signal,
      submitTool.name,
      callerOf(ctx),
    ),
  );
  return server;
}

/** Validate the catalog before the caller connects a carrier of its own: one stateful connection. */
export async function createAgentMcpServer(options: IAgentMcpOptions): Promise<Server> {
  const submitTool = resolveSubmitTool(options.submitTool);
  await readCatalog(options.session, submitTool.name);
  return buildAgentMcpServer(options, submitTool, { kind: 'connection' });
}

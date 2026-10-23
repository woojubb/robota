/** The ACP agent handlers for one connection: one attached session, one prompt at a time. */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { agent, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import { promptText } from './acp-prompt-text.js';
import { availableCommands, replayHistory } from './acp-session-catalog.js';
import { runCommandTurn, runModelTurn } from './acp-turn.js';
import { createUpdateStream } from './acp-updates.js';

import type { IAcpTurnContext } from './acp-turn.js';
import type { IAcpTransportOptions, IAcpTransportSession } from './acp-types.js';
import type { AgentApp, AgentContext, McpServer, PromptResponse } from '@agentclientprotocol/sdk';

/**
 * JSON-RPC server-error code for a workspace the host has not admitted. Not -32000: ACP assigns
 * that to "authentication required", which an editor answers with a sign-in state this agent
 * does not have.
 */
const WORKSPACE_NOT_ADMITTED = -32001;
const INTERNAL_ERROR = -32603;
const COMMANDS_UNAVAILABLE = 'Slash commands are not available in this host.';

const commandsUnavailable = (): Promise<string> => Promise.resolve(COMMANDS_UNAVAILABLE);

export interface IAcpAgent {
  readonly app: AgentApp;
  /** Cancel the running prompt, if there is one. */
  cancelActive(): void;
}

/** What `session/new` and `session/load` both carry that decides whether the editor may have the session. */
interface ISessionRequest {
  readonly cwd: string;
  readonly mcpServers: readonly McpServer[];
  readonly additionalDirectories?: readonly string[] | null;
}

function sameDirectory(requested: string, served: string): boolean {
  if (resolve(requested) === resolve(served)) return true;
  try {
    return realpathSync(requested) === realpathSync(served);
  } catch {
    // allow-fallback: a path that cannot be resolved is not the served directory, and the caller refuses it.
    return false;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createAcpAgent(
  session: IAcpTransportSession,
  options: IAcpTransportOptions,
): IAcpAgent {
  const driverId = options.driverId ?? OWNER_DRIVER_ID;
  const report = (error: Error, context: string): void => options.onDeliveryError?.(error, context);
  let boundSessionId: string | undefined;
  /** A `session/new` or `session/load` is still settling which session this connection serves. */
  let binding = false;
  let active: { cancel(): void } | undefined;
  let toolCalls = 0;
  const nextToolCallId = (): string => `tool-${(toolCalls += 1)}`;
  /** The command list the editor last received, so an unchanged list is not sent again. */
  let advertised: string | undefined;

  /** Refuse what the editor may not ask for; the same rules hold for a new and a loaded session. */
  const admit = (params: ISessionRequest): void => {
    if (!isAbsolute(params.cwd) || !sameDirectory(params.cwd, options.cwd)) {
      throw RequestError.invalidParams(
        undefined,
        `cwd must be the directory this agent was started in: ${options.cwd}`,
      );
    }
    // Servers or roots named by the editor would widen what the session can reach.
    if (params.mcpServers.length > 0) {
      throw RequestError.invalidParams(undefined, 'mcpServers are not accepted by this agent');
    }
    if ((params.additionalDirectories ?? []).length > 0) {
      throw RequestError.invalidParams(
        undefined,
        'additionalDirectories are not accepted by this agent',
      );
    }
    const admission = options.admitWorkspace();
    if (!admission.admitted) {
      throw new RequestError(WORKSPACE_NOT_ADMITTED, admission.message, {
        reason: 'workspace-not-trusted',
      });
    }
  };

  /** Wait for the attached session to name itself; a session that failed to start is a fixed error. */
  const sessionId = async (context: string): Promise<string> => {
    try {
      // A session that builds itself in the background cannot name itself until it is ready.
      await session.whenInitialized?.();
      return session.getStatusSnapshot().sessionId;
    } catch (error) {
      report(asError(error), context);
      // The cause can name host paths or settings; the editor only needs to know it failed.
      throw new RequestError(INTERNAL_ERROR, 'The session could not be started');
    }
  };

  /**
   * Tell the editor which commands it may offer, when they differ from what it last received. The
   * update names the session, so it goes out only once the editor holds that id.
   */
  const advertiseCommands = (client: AgentContext, id: string): void => {
    if (session.listCommands === undefined && session.listSkills === undefined) return;
    let commands: ReturnType<typeof availableCommands>;
    try {
      commands = availableCommands(session);
    } catch (error) {
      report(asError(error), 'available_commands_update');
      return;
    }
    const serialized = JSON.stringify(commands);
    if (serialized === advertised) return;
    advertised = serialized;
    client
      .notify('session/update', {
        sessionId: id,
        update: { sessionUpdate: 'available_commands_update', availableCommands: commands },
      })
      .catch((error: unknown) => report(asError(error), 'available_commands_update'));
  };
  /** After the response that gives the editor the session id has been written. */
  const advertiseAfterReply = (client: AgentContext, id: string): void => {
    setImmediate(() => advertiseCommands(client, id));
  };

  const app = agent({ name: options.agentInfo.name })
    .onRequest('initialize', () => ({
      // Always the version this agent speaks: the client disconnects if it cannot use it.
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: options.loadSession !== undefined && session.getMessagesDisplay !== undefined,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
      },
      agentInfo: { name: options.agentInfo.name, version: options.agentInfo.version },
    }))
    .onRequest('session/new', async ({ params, client }) => {
      if (boundSessionId !== undefined || binding) {
        throw RequestError.invalidParams(undefined, 'one session per connection');
      }
      admit(params);
      binding = true;
      try {
        boundSessionId = await sessionId('session/new');
      } finally {
        binding = false;
      }
      advertiseAfterReply(client, boundSessionId);
      return { sessionId: boundSessionId };
    })
    .onRequest('session/load', async ({ params, client }) => {
      const load = options.loadSession;
      if (load === undefined || session.getMessagesDisplay === undefined) {
        throw RequestError.methodNotFound('session/load');
      }
      if (binding) throw RequestError.invalidParams(undefined, 'a session is already being opened');
      // A load replaces this connection's session, so it may not pull the session out from under a turn.
      if (active !== undefined) {
        throw RequestError.invalidParams(undefined, 'a prompt is running');
      }
      admit(params);
      binding = true;
      try {
        let outcome: Awaited<ReturnType<typeof load>>;
        try {
          outcome = await load(params.sessionId);
        } catch (error) {
          report(asError(error), 'session/load');
          throw new RequestError(INTERNAL_ERROR, 'The session could not be loaded');
        }
        if (!outcome.loaded) throw RequestError.invalidParams(undefined, outcome.message);
        boundSessionId = await sessionId('session/load');
        // The editor sees the conversation it reopened before the load answers.
        const updates = createUpdateStream(client, boundSessionId, report);
        try {
          replayHistory(session.getMessagesDisplay(), updates, nextToolCallId);
        } catch (error) {
          report(asError(error), 'session/load');
          // The session is loaded; only its history could not be shown, and the cause stays local.
          throw new RequestError(INTERNAL_ERROR, 'The session history could not be shown');
        }
        await updates.drained();
      } finally {
        binding = false;
      }
      advertised = undefined;
      advertiseAfterReply(client, boundSessionId);
      return {};
    })
    .onRequest('session/prompt', async ({ params, signal, client }): Promise<PromptResponse> => {
      if (params.sessionId !== boundSessionId || binding) {
        throw RequestError.invalidParams(undefined, 'unknown session');
      }
      if (active !== undefined) {
        throw RequestError.invalidParams(undefined, 'a prompt is already running');
      }
      const text = promptText(params.prompt);
      if (text.full.trim() === '') {
        throw RequestError.invalidParams(undefined, 'the prompt has no text');
      }
      const controller = new AbortController();
      let cancelled = false;
      active = {
        cancel() {
          cancelled = true;
          controller.abort();
          session.abort();
        },
      };
      const turn: IAcpTurnContext = {
        session,
        sessionId: params.sessionId,
        client,
        updates: createUpdateStream(client, params.sessionId, report),
        signal: AbortSignal.any([signal, controller.signal]),
        driverId,
        surface: options.surface ?? 'unknown',
        cwd: options.cwd,
        nextToolCallId,
        wasCancelled: () => cancelled,
        report,
      };
      try {
        return text.typed.trimStart().startsWith('/')
          ? await runCommandTurn(turn, text.typed, options.executeCommand ?? commandsUnavailable)
          : await runModelTurn(turn, text.full);
      } finally {
        active = undefined;
        // A command or a model turn can change the catalog (a plugin reload, a preset): the editor
        // gets the new list, and an unchanged one is not sent again.
        advertiseCommands(client, params.sessionId);
      }
    })
    .onNotification('session/cancel', ({ params }) => {
      if (params.sessionId === boundSessionId) active?.cancel();
    });

  return { app, cancelActive: () => active?.cancel() };
}

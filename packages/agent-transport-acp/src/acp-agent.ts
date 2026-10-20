/** The ACP agent handlers for one connection: one attached session, one prompt at a time. */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { agent, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import { promptText } from './acp-prompt-text.js';
import { runCommandTurn, runModelTurn } from './acp-turn.js';
import { createUpdateStream } from './acp-updates.js';

import type { IAcpTurnContext } from './acp-turn.js';
import type { IAcpTransportOptions, IAcpTransportSession } from './acp-types.js';
import type { AgentApp, PromptResponse } from '@agentclientprotocol/sdk';

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

function sameDirectory(requested: string, served: string): boolean {
  if (resolve(requested) === resolve(served)) return true;
  try {
    return realpathSync(requested) === realpathSync(served);
  } catch {
    // allow-fallback: a path that cannot be resolved is not the served directory, and the caller refuses it.
    return false;
  }
}

export function createAcpAgent(
  session: IAcpTransportSession,
  options: IAcpTransportOptions,
): IAcpAgent {
  const driverId = options.driverId ?? OWNER_DRIVER_ID;
  const report = (error: Error, context: string): void => options.onDeliveryError?.(error, context);
  let boundSessionId: string | undefined;
  /** A `session/new` is waiting for the session to start; a second one must not also claim it. */
  let binding = false;
  let active: { cancel(): void } | undefined;
  let toolCalls = 0;

  const app = agent({ name: options.agentInfo.name })
    .onRequest('initialize', () => ({
      // Always the version this agent speaks: the client disconnects if it cannot use it.
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: { image: false, audio: false, embeddedContext: true },
      },
      agentInfo: { name: options.agentInfo.name, version: options.agentInfo.version },
    }))
    .onRequest('session/new', async ({ params }) => {
      if (boundSessionId !== undefined || binding) {
        throw RequestError.invalidParams(undefined, 'one session per connection');
      }
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
      binding = true;
      try {
        // A session that builds itself in the background cannot name itself until it is ready.
        await session.whenInitialized?.();
        boundSessionId = session.getStatusSnapshot().sessionId;
      } catch (error) {
        report(error instanceof Error ? error : new Error(String(error)), 'session/new');
        // The cause can name host paths or settings; the editor only needs to know it failed.
        throw new RequestError(INTERNAL_ERROR, 'The session could not be started');
      } finally {
        binding = false;
      }
      return { sessionId: boundSessionId };
    })
    .onRequest('session/prompt', async ({ params, signal, client }): Promise<PromptResponse> => {
      if (params.sessionId !== boundSessionId) {
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
        nextToolCallId: () => `tool-${(toolCalls += 1)}`,
        wasCancelled: () => cancelled,
        report,
      };
      try {
        return text.typed.trimStart().startsWith('/')
          ? await runCommandTurn(turn, text.typed, options.executeCommand ?? commandsUnavailable)
          : await runModelTurn(turn, text.full);
      } finally {
        active = undefined;
      }
    })
    .onNotification('session/cancel', ({ params }) => {
      if (params.sessionId === boundSessionId) active?.cancel();
    });

  return { app, cancelActive: () => active?.cancel() };
}

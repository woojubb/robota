/** The ACP agent handlers for one connection: one attached session, one prompt at a time. */

import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { agent, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk';
import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import { promptText } from './acp-prompt-text.js';
import { runModelTurn } from './acp-turn.js';
import { createUpdateStream } from './acp-updates.js';

import type { IAcpTransportOptions, IAcpTransportSession } from './acp-types.js';
import type { AgentApp, PromptResponse } from '@agentclientprotocol/sdk';

/** JSON-RPC server-error code for a workspace the host has not admitted. */
const WORKSPACE_NOT_ADMITTED = -32000;
const INTERNAL_ERROR = -32603;
const COMMANDS_UNAVAILABLE = 'Slash commands are not available in this host.';

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
    .onRequest('session/new', ({ params }) => {
      if (boundSessionId !== undefined) {
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
      if (!admission.admitted) throw new RequestError(WORKSPACE_NOT_ADMITTED, admission.message);
      boundSessionId = session.getStatusSnapshot().sessionId;
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
      const turnSignal = AbortSignal.any([signal, controller.signal]);
      const updates = createUpdateStream(client, params.sessionId, report);
      try {
        if (text.typed.trimStart().startsWith('/')) {
          return await runCommandPrompt(options, updates, text.typed, turnSignal, report);
        }
        return await runModelTurn(
          {
            session,
            sessionId: params.sessionId,
            client,
            updates,
            signal: turnSignal,
            driverId,
            surface: options.surface ?? 'unknown',
            nextToolCallId: () => `tool-${(toolCalls += 1)}`,
            wasCancelled: () => cancelled,
            report,
          },
          text.full,
        );
      } finally {
        active = undefined;
      }
    })
    .onNotification('session/cancel', ({ params }) => {
      if (params.sessionId === boundSessionId) active?.cancel();
    });

  return { app, cancelActive: () => active?.cancel() };
}

/** A `/command` prompt: the host runs it and its output is the reply. */
async function runCommandPrompt(
  options: IAcpTransportOptions,
  updates: ReturnType<typeof createUpdateStream>,
  text: string,
  signal: AbortSignal,
  report: (error: Error, context: string) => void,
): Promise<PromptResponse> {
  let output = COMMANDS_UNAVAILABLE;
  if (options.executeCommand !== undefined) {
    try {
      output = await options.executeCommand(text, signal);
    } catch (error) {
      if (signal.aborted) return { stopReason: 'cancelled' };
      report(asError(error), 'command');
      throw new RequestError(INTERNAL_ERROR, 'Command failed');
    }
  }
  if (signal.aborted) return { stopReason: 'cancelled' };
  if (output !== '') updates.text(output);
  await updates.drained();
  return { stopReason: 'end_turn' };
}

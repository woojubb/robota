/** One `session/prompt` that runs a model turn: stream its events to the editor and settle with a stop reason. */

import { RequestError } from '@agentclientprotocol/sdk';
import { isTurnNotRunError } from '@robota-sdk/agent-interface-session';

import { permissionDecision, permissionOptions } from './acp-permission.js';
import { subscribeAcpEvents } from './acp-session-events.js';
import { createToolCallTracker } from './acp-tool-calls.js';

import type { IAcpTransportSession } from './acp-types.js';
import type { IAcpUpdateStream } from './acp-updates.js';
import type { AgentContext, PromptResponse } from '@agentclientprotocol/sdk';
import type {
  IPermissionRequestEvent,
  ISubmitOptions,
  TDriverId,
} from '@robota-sdk/agent-interface-session';

export interface IAcpTurnContext {
  readonly session: IAcpTransportSession;
  readonly sessionId: string;
  readonly client: AgentContext;
  readonly updates: IAcpUpdateStream;
  /** Aborts when the editor cancels the request or the connection closes. */
  readonly signal: AbortSignal;
  readonly driverId: TDriverId;
  readonly surface: ISubmitOptions['surface'];
  /** The served directory; paths the session reports relative to it are made absolute for the editor. */
  readonly cwd: string;
  /** Ids for tool calls the session gives no id; unique for the life of the session. */
  readonly nextToolCallId: () => string;
  /** Whether the editor sent `session/cancel` for this prompt. */
  readonly wasCancelled: () => boolean;
  readonly report: (error: Error, context: string) => void;
}

const CANCELLED: PromptResponse = { stopReason: 'cancelled' };
const END_TURN: PromptResponse = { stopReason: 'end_turn' };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export async function runModelTurn(turn: IAcpTurnContext, text: string): Promise<PromptResponse> {
  const { session, sessionId, client, updates } = turn;
  const tools = createToolCallTracker({
    updates,
    nextToolCallId: turn.nextToolCallId,
    cwd: turn.cwd,
  });
  let streamed = false;

  const onPermissionRequest = (event: IPermissionRequestEvent): void => {
    const options = permissionOptions(event.canPersistProjectPermission === true);
    const toolCall = tools.requested(event);
    void (async () => {
      let decision: ReturnType<typeof permissionDecision> = false;
      try {
        const response = await client.request('session/request_permission', {
          sessionId,
          toolCall,
          options,
        });
        decision = permissionDecision(response.outcome, options);
      } catch (error) {
        // A closed connection or a refused request means nobody approved: deny.
        turn.report(asError(error), 'session/request_permission');
      }
      tools.answered(event, decision !== false);
      try {
        session.resolvePermission(event.id, decision, turn.driverId);
      } catch (error) {
        turn.report(asError(error), 'resolvePermission');
      }
    })();
  };

  const unsubscribe = subscribeAcpEvents(session, {
    text_delta: (delta) => {
      if (delta === '') return;
      streamed = true;
      updates.text(delta);
    },
    tool_start: tools.start,
    tool_end: tools.end,
    permission_request: onPermissionRequest,
  });

  try {
    const handle = await session.submit(text, undefined, undefined, {
      signal: turn.signal,
      driverId: turn.driverId,
      ...(turn.surface !== undefined ? { surface: turn.surface } : {}),
    });
    const result = await handle.completed;
    if (turn.wasCancelled() || result.interrupted === true) return CANCELLED;
    // A provider that does not stream sends no deltas; the whole reply arrives with the result.
    if (!streamed && result.response !== '') updates.text(result.response);
    return END_TURN;
  } catch (error) {
    if (turn.wasCancelled() || turn.signal.aborted) return CANCELLED;
    if (isTurnNotRunError(error) && error.reason === 'cancelled') return CANCELLED;
    turn.report(asError(error), 'turn');
    // The provider's own text can carry request details; the editor gets a fixed message.
    throw new RequestError(-32603, isTurnNotRunError(error) ? 'Turn was not run' : 'Turn failed');
  } finally {
    unsubscribe();
    tools.finish();
    await updates.drained();
  }
}

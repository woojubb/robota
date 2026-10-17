/**
 * One `session/prompt` that runs a turn: stream the session's events to the editor, ask it about
 * permissions, and settle with a stop reason. A typed message and a `/command` that runs a model
 * turn (a skill) both go through here, so the editor sees the same thing from either.
 */

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

/** What a turn's work left behind: whether it was cut short, and the text to show if nothing streamed. */
interface IWorkOutcome {
  readonly interrupted: boolean;
  readonly reply: string;
}

interface IStreamedWork {
  run(): Promise<IWorkOutcome>;
  /** A failure that was not a cancellation, as the editor's answer: it reports the cause and throws a fixed error. */
  fail(error: unknown): never;
  /** Whether `error` is the work saying it was cancelled. */
  isCancellation?(error: unknown): boolean;
}

async function runStreamedTurn(
  turn: IAcpTurnContext,
  work: IStreamedWork,
): Promise<PromptResponse> {
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
    const outcome = await work.run();
    if (turn.wasCancelled() || turn.signal.aborted || outcome.interrupted) return CANCELLED;
    // Nothing streamed (a provider without deltas, or a command that is not a turn): the text arrives whole.
    if (!streamed && outcome.reply !== '') updates.text(outcome.reply);
    return END_TURN;
  } catch (error) {
    if (turn.wasCancelled() || turn.signal.aborted || work.isCancellation?.(error) === true) {
      return CANCELLED;
    }
    return work.fail(error);
  } finally {
    unsubscribe();
    tools.finish();
    await updates.drained();
  }
}

/** A typed message: submit it to the session and take the turn's result. */
export function runModelTurn(turn: IAcpTurnContext, text: string): Promise<PromptResponse> {
  return runStreamedTurn(turn, {
    async run() {
      const handle = await turn.session.submit(text, undefined, undefined, {
        signal: turn.signal,
        driverId: turn.driverId,
        ...(turn.surface !== undefined ? { surface: turn.surface } : {}),
      });
      const result = await handle.completed;
      return { interrupted: result.interrupted === true, reply: result.response };
    },
    isCancellation: (error) => isTurnNotRunError(error) && error.reason === 'cancelled',
    fail(error) {
      turn.report(asError(error), 'turn');
      // The provider's own text can carry request details; the editor gets a fixed message.
      throw new RequestError(-32603, isTurnNotRunError(error) ? 'Turn was not run' : 'Turn failed');
    },
  });
}

/**
 * A `/command` prompt: the host runs it and its output is the reply. A command that runs a model
 * turn (a skill) streams that turn and asks about permissions while it runs; its output then
 * repeats the streamed reply, so it is shown only when nothing streamed (`/help`, a message).
 */
export function runCommandTurn(
  turn: IAcpTurnContext,
  text: string,
  executeCommand: (text: string, signal: AbortSignal) => Promise<string>,
): Promise<PromptResponse> {
  return runStreamedTurn(turn, {
    async run() {
      return { interrupted: false, reply: await executeCommand(text, turn.signal) };
    },
    fail(error) {
      turn.report(asError(error), 'command');
      throw new RequestError(-32603, 'Command failed');
    },
  });
}

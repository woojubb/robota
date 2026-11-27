import { client, ndJsonStream } from '@agentclientprotocol/sdk';
import type {
  ParticipantExecutionOptions,
  ParticipantLease,
  ParticipantSession,
  ParticipantTurn,
} from '@robota-sdk/agent-roundtable';

import { createDeltaQueue } from './delta-queue';
import type { DeltaQueue } from './delta-queue';
import { AcpParticipantError } from './errors';
import type { AcpLauncher } from './launcher';
import { toTurnOutcome } from './outcome';
import { cancelledPermission, createPermissionTracker, rejectPermission } from './permission';
import type { AcpPermissionApprover, PermissionTracker } from './permission';
import type { TurnRenderer } from './render';

/** The ACP protocol version this adapter speaks; a different one is a different contract. */
const ACP_PROTOCOL_VERSION = 1;

export interface AcpSessionSettings {
  cwd: string;
  launcher: AcpLauncher;
  render: TurnRenderer;
  startupTimeoutMs: number;
  approver?: AcpPermissionApprover;
  cancelGraceMs: number;
  maxReplyChars: number;
}

interface OpenContext {
  conversationId: string;
  participantId: string;
}

/** What the update handler records for the one turn that is waiting on its prompt response. */
interface ActiveTurn {
  chunks: string[];
  /** Length of the text recorded so far, which the reply bound is checked against. */
  size: number;
  deltas: DeltaQueue;
  permissions: PermissionTracker;
  /** Set once nothing more of this turn is wanted: no chunk is recorded, no request is allowed. */
  ended: boolean;
  /** Set as soon as the prompt response, or its failure, has arrived. */
  responded: boolean;
  /** Settles, never rejects, once the prompt response has arrived or the connection failed. */
  promptSettled: Promise<void>;
  /** Rejects when the turn must fail for a reason the response cannot carry. */
  failure: Promise<never>;
  /** Fails the turn and ends it, since an agent that overran can no longer be trusted. */
  fail(error: AcpParticipantError): void;
}

interface StartupControl {
  isAbandoned(): boolean;
  /** Hands over how to end the connection as soon as one exists, so a timeout can end it. */
  onConnected(close: () => Promise<void>): void;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Rejects with the signal's reason when it aborts, after running `onAbort` in the same tick;
 * `stop` detaches the listener once it no longer matters.
 */
function whenAborted(
  signal: AbortSignal,
  onAbort: () => void,
): { promise: Promise<never>; stop(): void } {
  let listener: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    listener = () => {
      onAbort();
      reject(signal.reason);
    };
    signal.addEventListener('abort', listener, { once: true });
  });
  return { promise, stop: () => signal.removeEventListener('abort', listener) };
}

function promptFailure(error: unknown, connectionClosed: boolean): AcpParticipantError {
  return connectionClosed
    ? new AcpParticipantError('connection-closed', 'The agent connection closed mid-turn', {
        cause: error,
      })
    : new AcpParticipantError('agent-error', `The agent failed the prompt: ${errorText(error)}`, {
        cause: error,
      });
}

/**
 * Launch the agent, complete the handshake and open the one ACP session a lease owns, all within
 * the startup bound. `openSession` gets no abort signal from the roundtable, so this bound is the
 * adapter's own: past it the connection is ended, and one that comes up late is ended on arrival.
 */
export async function openAcpSession(
  settings: AcpSessionSettings,
  context: OpenContext,
): Promise<ParticipantLease> {
  let abandoned = false;
  let teardown: (() => Promise<void>) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abandoned = true;
      reject(
        new AcpParticipantError(
          'startup-timeout',
          `The agent did not finish starting within ${settings.startupTimeoutMs} ms`,
        ),
      );
      void teardown?.().catch(() => {});
    }, settings.startupTimeoutMs);
  });
  const starting = startSession(settings, context, {
    isAbandoned: () => abandoned,
    onConnected: (close) => {
      teardown = close;
    },
  });
  // When the bound wins the race, the abandoned attempt still settles; its cleanup is its own.
  starting.catch(() => {});
  try {
    return await Promise.race([starting, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function startSession(
  settings: AcpSessionSettings,
  context: OpenContext,
  control: StartupControl,
): Promise<ParticipantLease> {
  const connection = await settings.launcher.launch({ ...context });
  const state: { sessionId?: string; active?: ActiveTurn } = {};
  // Set once a turn can no longer be trusted (host abort, reply bound): its agent may still be
  // working, so the session takes no more turns and every later request of the agent is cancelled.
  let dead = false;
  let windDown: Promise<void> | undefined;

  // Client capabilities are advertised empty, so the only agent request this side handles is the
  // permission request, and the SDK answers every other one as an unknown method. Each chunk is
  // recorded synchronously, in this handler: the SDK dispatches a notification before it settles a
  // later response, so a chunk written just before the prompt response is never missed.
  const app = client({ name: 'robota-roundtable' })
    .onNotification('session/update', ({ params }) => {
      const turn = state.active;
      if (turn === undefined || turn.ended || params.sessionId !== state.sessionId) return;
      const { update } = params;
      if (update.sessionUpdate !== 'agent_message_chunk') return;
      if (update.content.type !== 'text' || update.content.text === '') return;
      const { text } = update.content;
      if (turn.size + text.length > settings.maxReplyChars) {
        turn.fail(
          new AcpParticipantError(
            'reply-too-long',
            `The agent's reply is longer than ${settings.maxReplyChars} characters`,
          ),
        );
        return;
      }
      turn.size += text.length;
      turn.chunks.push(text);
      turn.deltas.push(text);
    })
    .onRequest('session/request_permission', ({ params }) => {
      if (dead) return cancelledPermission;
      const turn = state.active;
      if (turn === undefined || turn.ended || params.sessionId !== state.sessionId) {
        return rejectPermission(params);
      }
      return turn.permissions.answer(params);
    });
  const acp = app.connect(ndJsonStream(connection.toAgent, connection.fromAgent));

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      acp.close();
      await connection.close();
    })());
  control.onConnected(close);
  // A connection that dies takes every request still waiting on the host with it.
  acp.signal.addEventListener('abort', () => state.active?.permissions.end(), { once: true });

  const abandon = async (): Promise<never> => {
    await close().catch(() => {});
    throw new AcpParticipantError('startup-timeout', 'The agent connection was abandoned');
  };
  if (control.isAbandoned()) return abandon();

  try {
    const initialized = await acp.agent.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    if (initialized.protocolVersion !== ACP_PROTOCOL_VERSION) {
      throw new AcpParticipantError(
        'protocol-version-mismatch',
        `The agent speaks ACP version ${String(initialized.protocolVersion)}, not ${ACP_PROTOCOL_VERSION}`,
      );
    }
    const created = await acp.agent.request('session/new', {
      cwd: settings.cwd,
      mcpServers: [],
    });
    if (typeof created.sessionId !== 'string' || created.sessionId === '') {
      throw new AcpParticipantError('handshake-failed', 'The agent returned no session id');
    }
    state.sessionId = created.sessionId;
  } catch (error) {
    await close().catch(() => {});
    if (error instanceof AcpParticipantError) throw error;
    throw new AcpParticipantError(
      'handshake-failed',
      `The agent did not complete the handshake: ${errorText(error)}`,
      { cause: error },
    );
  }
  if (control.isAbandoned()) return abandon();

  const sessionId = state.sessionId;
  let released = false;
  let running = false;
  let firstTurnDone = false;
  let releaseNow: () => void = () => {};
  const releasing = new Promise<void>((resolve) => {
    releaseNow = resolve;
  });

  /** Stops recording the turn and cancels whatever the agent still waits on the host for. */
  const endTurn = (turn: ActiveTurn): void => {
    turn.ended = true;
    turn.deltas.stop();
    turn.permissions.end();
  };

  /**
   * Ends a turn that can no longer be trusted, once per session. The session is dead from the
   * first instant. A prompt still in flight is cancelled, and the agent gets a bounded time to
   * acknowledge before the connection is ended, since cancellation is only a request. The session
   * stays dead even when the agent acknowledges: its own history now holds a turn the roundtable
   * never published.
   */
  const wind = (turn: ActiveTurn): Promise<void> =>
    (windDown ??= (async () => {
      dead = true;
      let cancelSent: Promise<void> | undefined;
      if (!turn.responded) {
        try {
          cancelSent = acp.agent.notify('session/cancel', { sessionId }).catch(() => {});
        } catch {
          // The connection is already gone; ending it below is all that is left.
        }
      }
      endTurn(turn);
      if (!turn.responded) {
        // The grace period starts now and covers the cancel write too: an agent that has stopped
        // reading its input never accepts it, and the connection must still end.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const grace = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, settings.cancelGraceMs);
        });
        // A host that releases the session wants the connection ended now.
        await Promise.race([Promise.all([cancelSent, turn.promptSettled]), grace, releasing]);
        clearTimeout(timer);
      }
      await close().catch(() => {});
    })());

  const session: ParticipantSession = {
    async runTurn(turn: ParticipantTurn, options: ParticipantExecutionOptions) {
      if (released) throw new AcpParticipantError('session-released', 'The session was released');
      if (dead) {
        throw new AcpParticipantError(
          'session-dead',
          'A cancelled or overrun turn ended this session; its agent may still be working, so it takes no more turns',
        );
      }
      // A turn is running from here until its `finally`, which includes delivering the last deltas
      // after the response has arrived; `state.active` only says where chunks are recorded.
      if (running) {
        throw new AcpParticipantError(
          'turn-in-progress',
          'A turn is already running on this session',
        );
      }
      const { signal } = options;
      signal.throwIfAborted();
      running = true;
      let active: ActiveTurn | undefined;
      // On abort the host gets its rejection at once; cancelling the agent and ending the
      // connection go on behind it, and nothing more is delivered from the moment the abort is seen.
      const abortion = whenAborted(signal, () => {
        if (active !== undefined) void wind(active);
      });
      try {
        const text = settings.render(turn, { firstTurn: !firstTurnDone });
        let failTurn: (error: AcpParticipantError) => void = () => {};
        const failure = new Promise<never>((_, reject) => {
          failTurn = reject;
        });
        failure.catch(() => {});
        const current: ActiveTurn = {
          chunks: [],
          size: 0,
          deltas: createDeltaQueue(options.onDelta),
          permissions: createPermissionTracker(settings.approver, context),
          ended: false,
          responded: false,
          promptSettled: Promise.resolve(),
          failure,
          fail: (error) => {
            failTurn(error);
            void wind(current);
          },
        };
        active = current;
        state.active = current;
        const prompt = acp.agent
          .request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
          .then(
            (answer) => {
              current.responded = true;
              return answer;
            },
            (error: unknown) => {
              current.responded = true;
              throw promptFailure(error, acp.signal.aborted);
            },
          );
        current.promptSettled = prompt.then(
          () => {},
          () => {},
        );
        // Every wait below also ends on a host abort, and an abort that settles alongside the last
        // of them still wins: a cancelled turn never publishes the words it had produced so far.
        const response = await Promise.race([prompt, abortion.promise, current.failure]);
        state.active = undefined;
        await Promise.race([current.deltas.flush(), abortion.promise, current.failure]);
        if (signal.aborted) throw signal.reason;
        const outcome = toTurnOutcome(response.stopReason, current.chunks.join(''));
        firstTurnDone = true;
        return outcome;
      } catch (error) {
        // Stopping the wait does not stop the agent, and a session whose agent may still be working
        // must not take a turn that could mix in what it says next.
        if (signal.aborted) {
          if (active !== undefined) void wind(active);
          throw signal.reason;
        }
        throw error;
      } finally {
        state.active = undefined;
        abortion.stop();
        running = false;
        if (active !== undefined) endTurn(active);
      }
    },
  };

  return {
    session,
    async release() {
      released = true;
      if (state.active !== undefined) endTurn(state.active);
      state.active = undefined;
      releaseNow();
      await windDown?.catch(() => {});
      await close();
    },
  };
}

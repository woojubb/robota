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
import { rejectPermission } from './permission';
import type { TurnRenderer } from './render';

/** The ACP protocol version this adapter speaks; a different one is a different contract. */
const ACP_PROTOCOL_VERSION = 1;

export interface AcpSessionSettings {
  cwd: string;
  launcher: AcpLauncher;
  render: TurnRenderer;
  startupTimeoutMs: number;
}

interface OpenContext {
  conversationId: string;
  participantId: string;
}

/** What the update handler records for the one turn that is waiting on its prompt response. */
interface ActiveTurn {
  chunks: string[];
  deltas: DeltaQueue;
}

interface StartupControl {
  isAbandoned(): boolean;
  /** Hands over how to end the connection as soon as one exists, so a timeout can end it. */
  onConnected(close: () => Promise<void>): void;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Rejects with the signal's reason when it aborts; `stop` detaches the listener once it no longer matters. */
function whenAborted(signal: AbortSignal): { promise: Promise<never>; stop(): void } {
  let listener: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason);
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

  // Client capabilities are advertised empty, so the only agent request this side handles is the
  // permission request, and the SDK answers every other one as an unknown method. Each chunk is
  // recorded synchronously, in this handler: the SDK dispatches a notification before it settles a
  // later response, so a chunk written just before the prompt response is never missed.
  const app = client({ name: 'robota-roundtable' })
    .onNotification('session/update', ({ params }) => {
      const turn = state.active;
      if (turn === undefined || params.sessionId !== state.sessionId) return;
      const { update } = params;
      if (update.sessionUpdate !== 'agent_message_chunk') return;
      if (update.content.type !== 'text' || update.content.text === '') return;
      turn.chunks.push(update.content.text);
      turn.deltas.push(update.content.text);
    })
    .onRequest('session/request_permission', ({ params }) => rejectPermission(params));
  const acp = app.connect(ndJsonStream(connection.toAgent, connection.fromAgent));

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      acp.close();
      await connection.close();
    })());
  control.onConnected(close);

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
  let dead = false;
  let running = false;
  let firstTurnDone = false;

  const session: ParticipantSession = {
    async runTurn(turn: ParticipantTurn, options: ParticipantExecutionOptions) {
      if (released) throw new AcpParticipantError('session-released', 'The session was released');
      if (dead) {
        throw new AcpParticipantError(
          'session-dead',
          'A host abort ended this session; its agent may still be working, so it takes no more turns',
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
      const abortion = whenAborted(signal);
      try {
        const text = settings.render(turn, { firstTurn: !firstTurnDone });
        const active: ActiveTurn = { chunks: [], deltas: createDeltaQueue(options.onDelta) };
        state.active = active;
        const prompt = acp.agent
          .request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
          .catch((error: unknown) => {
            throw promptFailure(error, acp.signal.aborted);
          });
        // Every wait below also ends on a host abort, and an abort that settles alongside the last
        // of them still wins: a cancelled turn never publishes the words it had produced so far.
        const response = await Promise.race([prompt, abortion.promise]);
        state.active = undefined;
        await Promise.race([active.deltas.flush(), abortion.promise]);
        if (signal.aborted) throw signal.reason;
        const outcome = toTurnOutcome(response.stopReason, active.chunks.join(''));
        firstTurnDone = true;
        return outcome;
      } catch (error) {
        // Stopping the wait does not stop the agent, and a session whose agent may still be working
        // must not take a turn that could mix in what it says next.
        if (signal.aborted) {
          dead = true;
          throw signal.reason;
        }
        throw error;
      } finally {
        state.active = undefined;
        abortion.stop();
        running = false;
      }
    },
  };

  return {
    session,
    release() {
      released = true;
      state.active = undefined;
      return close();
    },
  };
}

import { isAbsolute } from 'node:path';

import type { AgentParticipant, RuntimeReference } from '@robota-sdk/agent-roundtable';

import { openAcpSession } from './acp-session';
import { AcpParticipantError } from './errors';
import type { AcpLauncher } from './launcher';
import { renderSharedIncrement } from './render';
import type { TurnRenderer } from './render';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
/** The longest delay a timer honors; a larger one fires at once. */
const MAX_TIMER_MS = 2_147_483_647;

export interface AcpParticipantOptions {
  id: string;
  description?: string;
  /** The host-registered identity of this participant's runtime; a reload binds it through the host registry. */
  runtime: RuntimeReference;
  /** Absolute working directory the agent is told to use for its session. */
  cwd: string;
  /** Yields the connection to the agent; the adapter starts no process of its own. */
  launcher: AcpLauncher;
  render?: TurnRenderer;
  /** Bound on launching the agent and completing its handshake, in milliseconds. Defaults to 30000. */
  startupTimeoutMs?: number;
}

/**
 * Seat an Agent Client Protocol agent as an `agent-roundtable` participant.
 *
 * The agent keeps its own memory and tools: only the public-message increment of each turn goes
 * out, as one text prompt, and only the text it says in reply comes back. The factory declares that
 * it makes no metered model calls, offers no checkpoint and no wait continuation, so a roundtable
 * holding it cannot be loaded back after a turn and never parks a request for it.
 */
export function acpParticipant(options: AcpParticipantOptions): AgentParticipant {
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(startupTimeoutMs) ||
    startupTimeoutMs < 1 ||
    startupTimeoutMs > MAX_TIMER_MS
  ) {
    throw new AcpParticipantError(
      'invalid-options',
      `startupTimeoutMs must be an integer from 1 to ${MAX_TIMER_MS}`,
    );
  }
  if (!isAbsolute(options.cwd)) {
    throw new AcpParticipantError('invalid-options', 'cwd must be an absolute path');
  }
  const settings = {
    cwd: options.cwd,
    launcher: options.launcher,
    render: options.render ?? renderSharedIncrement,
    startupTimeoutMs,
  };
  return {
    kind: 'agent',
    id: options.id,
    ...(options.description !== undefined ? { description: options.description } : {}),
    runtime: options.runtime,
    factory: {
      modelCalls: 'none',
      openSession: (context) =>
        openAcpSession(settings, {
          conversationId: context.conversationId,
          participantId: context.participantId,
        }),
    },
  };
}

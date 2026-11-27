import { isAbsolute } from 'node:path';

import type { AgentParticipant, RuntimeReference } from '@robota-sdk/agent-roundtable';

import { openAcpSession } from './acp-session';
import { AcpParticipantError } from './errors';
import type { AcpLauncher } from './launcher';
import type { AcpPermissionApprover } from './permission';
import { renderSharedIncrement } from './render';
import type { TurnRenderer } from './render';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_GRACE_MS = 5_000;
const DEFAULT_MAX_REPLY_CHARS = 100_000;
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
  /**
   * Decides the agent's permission requests. Without one every request is refused: only a host
   * that gives an approver lets an agent's tool call proceed, and only once per call.
   */
  approver?: AcpPermissionApprover;
  /**
   * How long an aborted turn waits, in milliseconds, for the agent to acknowledge the cancellation
   * before the connection is ended. Defaults to 5000. The session ends either way.
   */
  cancelGraceMs?: number;
  /**
   * The most characters one turn's reply may have. Past it the turn fails with `reply-too-long` and
   * the session ends. Defaults to 100000.
   */
  maxReplyChars?: number;
}

/** A positive integer a timer or a bound can honor; anything else is a configuration mistake. */
function boundedOption(name: string, value: number | undefined, fallback: number): number {
  const chosen = value ?? fallback;
  if (!Number.isSafeInteger(chosen) || chosen < 1 || chosen > MAX_TIMER_MS) {
    throw new AcpParticipantError(
      'invalid-options',
      `${name} must be an integer from 1 to ${MAX_TIMER_MS}`,
    );
  }
  return chosen;
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
  const startupTimeoutMs = boundedOption(
    'startupTimeoutMs',
    options.startupTimeoutMs,
    DEFAULT_STARTUP_TIMEOUT_MS,
  );
  const cancelGraceMs = boundedOption(
    'cancelGraceMs',
    options.cancelGraceMs,
    DEFAULT_CANCEL_GRACE_MS,
  );
  const maxReplyChars = boundedOption(
    'maxReplyChars',
    options.maxReplyChars,
    DEFAULT_MAX_REPLY_CHARS,
  );
  if (!isAbsolute(options.cwd)) {
    throw new AcpParticipantError('invalid-options', 'cwd must be an absolute path');
  }
  const settings = {
    cwd: options.cwd,
    launcher: options.launcher,
    render: options.render ?? renderSharedIncrement,
    startupTimeoutMs,
    ...(options.approver !== undefined ? { approver: options.approver } : {}),
    cancelGraceMs,
    maxReplyChars,
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

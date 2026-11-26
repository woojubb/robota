import type { ParticipantOutcome } from '@robota-sdk/agent-roundtable';

import { AcpParticipantError } from './errors';

/**
 * Map a finished `session/prompt` to the turn's outcome. Only a turn the agent ended itself can
 * produce one: text that is blank after trimming yields, so the shared transcript never gains a
 * blank turn. Every other stop reason fails the turn, because a reply cut short, refused or
 * cancelled by someone other than the host is not a complete contribution, and a value this
 * package does not know is not one it may publish from.
 */
export function toTurnOutcome(stopReason: unknown, reply: string): ParticipantOutcome {
  switch (stopReason) {
    case 'end_turn': {
      const content = reply.trim();
      return content === '' ? { kind: 'yield' } : { kind: 'speak', content };
    }
    case 'max_tokens':
      throw new AcpParticipantError(
        'max-tokens',
        'The agent stopped at its token limit, so its reply is incomplete',
      );
    case 'max_turn_requests':
      throw new AcpParticipantError(
        'max-turn-requests',
        'The agent stopped at its limit of model requests for one turn, so its reply is incomplete',
      );
    case 'cancelled':
      throw new AcpParticipantError(
        'cancelled',
        'The agent reported a cancelled turn that the host did not cancel',
      );
    case 'refusal':
      throw new AcpParticipantError('refusal', 'The agent refused the prompt');
    default:
      throw new AcpParticipantError(
        'unknown-stop-reason',
        `The agent ended the turn with an unrecognized stop reason: ${String(stopReason)}`,
      );
  }
}

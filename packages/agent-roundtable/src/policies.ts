import type { ExternalParticipant, TurnSelector } from './types';

export function externalParticipant(
  options: Omit<ExternalParticipant, 'kind'>,
): ExternalParticipant {
  return { ...options, kind: 'external' };
}

export function roundRobin(): TurnSelector {
  return {
    reference: { id: 'roundtable/round-robin', version: '1' },
    select: ({ participants, turns }) => {
      const last = turns.at(-1)?.participantId;
      const next =
        participants[(participants.findIndex((p) => p.id === last) + 1) % participants.length];
      if (!next) return { kind: 'finish', reason: 'No participants' };
      return { kind: 'speak', participantId: next.id };
    },
  };
}

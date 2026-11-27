import type { ContextPolicy, ExternalParticipant, TurnSelector } from './types';

export function externalParticipant(
  options: Omit<ExternalParticipant, 'kind'>,
): ExternalParticipant {
  return { ...options, kind: 'external' };
}

export function roundRobin(): TurnSelector {
  return {
    reference: { id: 'roundtable/round-robin', version: '1' },
    modelCalls: 'none',
    select: ({ participants, turns }) => {
      const last = turns.at(-1)?.participantId;
      const next =
        participants[(participants.findIndex((p) => p.id === last) + 1) % participants.length];
      if (!next) return { kind: 'finish', reason: 'No participants' };
      return { kind: 'speak', participantId: next.id };
    },
  };
}

const builtInIncrements: ContextPolicy = {
  reference: Object.freeze({ id: 'roundtable/increments', version: '1' }),
  modelCalls: 'none',
  assemble: ({ undelivered }) => ({ messages: [...undelivered], consumed: [] }),
};
Object.freeze(builtInIncrements);

/** The default context policy: a participant is offered every message it has not seen and did not write. */
export function increments(): ContextPolicy {
  return builtInIncrements;
}

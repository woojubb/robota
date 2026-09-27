import type {
  AgentParticipant,
  ParticipantCheckpoint,
  ParticipantLease,
  ParticipantOutcome,
  ParticipantTurn,
  RoundtableEvent,
} from './types';

export interface PreparedMember {
  turn: ParticipantTurn;
  outcome: Exclude<ParticipantOutcome, { kind: 'failed' }>;
  checkpoint: ParticipantCheckpoint | null;
}

/** The workers overlap runtime calls; only publication is ordered by the selected member index. */
export async function executeGroup(options: {
  participants: AgentParticipant[];
  turns: ParticipantTurn[];
  concurrency: number;
  signal: AbortSignal;
  session: (participant: AgentParticipant) => Promise<ParticipantLease>;
  emit: (event: RoundtableEvent, signal: AbortSignal) => Promise<void>;
  start: (turn: ParticipantTurn) => Promise<void>;
  settle: (turn: ParticipantTurn, outcome: PreparedMember['outcome']) => Promise<void>;
  prepare: (member: PreparedMember) => Promise<void>;
  fail: (turn: ParticipantTurn, error: unknown) => Promise<void>;
  admit: () => Promise<void>;
}): Promise<PreparedMember[]> {
  const groupAbort = new AbortController();
  const signal = AbortSignal.any([options.signal, groupAbort.signal]);
  const prepared: PreparedMember[] = [];
  let cursor = 0;
  let failure: unknown;
  let failed = false;

  async function worker(): Promise<void> {
    while (!signal.aborted && cursor < options.participants.length) {
      const index = cursor++;
      const participant = options.participants[index];
      const turn = options.turns[index];
      try {
        await options.start(turn);
        await options.admit();
        signal.throwIfAborted();
        const lease = await options.session(participant);
        await options.admit();
        signal.throwIfAborted();
        const outcome = await lease.session.runTurn(structuredClone(turn), {
          signal,
          onDelta: async (text) => {
            signal.throwIfAborted();
            await options.emit(
              {
                type: 'delta',
                groupId: turn.groupId,
                turnId: turn.turnId,
                participantId: participant.id,
                text,
              },
              signal,
            );
          },
        });
        if (outcome.kind === 'failed') throw new Error(outcome.message);
        if (
          outcome.kind !== 'yield' &&
          (outcome.kind !== 'speak' || typeof outcome.content !== 'string')
        ) {
          throw new Error(`Invalid turn result from ${participant.id}`);
        }
        await options.settle(turn, outcome);
        const member = { turn, outcome, checkpoint: (await lease.session.checkpoint?.()) ?? null };
        // Save settled results even when a sibling or the caller cancelled during this call.
        await options.prepare(member);
        prepared[index] = member;
        signal.throwIfAborted();
        await options.emit(
          {
            type: 'prepared',
            groupId: turn.groupId,
            turnId: turn.turnId,
            participantId: participant.id,
          },
          signal,
        );
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        groupAbort.abort(error);
        await options.fail(turn, error).catch(() => {});
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(options.concurrency, options.participants.length) }, worker),
  );
  if (failed) throw failure;
  options.signal.throwIfAborted();
  return prepared;
}

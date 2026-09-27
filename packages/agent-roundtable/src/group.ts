import type {
  AgentParticipant,
  ParticipantCheckpoint,
  ParticipantLease,
  ParticipantOutcome,
  ParticipantTurn,
  ParticipantResponse,
  ParticipantExecutionOptions,
  RoundtableEvent,
  TurnServices,
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
  /**
   * Discard an attempt that cancellation ended without a prepared result; it is dispatched again.
   * `entered` says whether its session ran the attempt and so holds it in private state.
   */
  restore: (turn: ParticipantTurn, entered: boolean) => Promise<void>;
  settle: (turn: ParticipantTurn, outcome: PreparedMember['outcome']) => Promise<void>;
  prepare: (member: PreparedMember) => Promise<void>;
  fail: (turn: ParticipantTurn, error: unknown) => Promise<void>;
  admit: () => Promise<void>;
  services: (turn: ParticipantTurn) => TurnServices;
  responses?: (turn: ParticipantTurn) => ParticipantResponse[] | undefined;
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
      let entered = false;
      try {
        await options.start(turn);
        await options.admit();
        signal.throwIfAborted();
        const lease = await options.session(participant);
        await options.admit();
        signal.throwIfAborted();
        const executionOptions: ParticipantExecutionOptions = {
          signal,
          services: options.services(turn),
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
        };
        const responses = options.responses?.(turn);
        if (responses && (!participant.factory.supportsContinuation || !lease.session.resumeTurn))
          throw new Error(`Participant cannot continue a checkpointed wait: ${participant.id}`);
        entered = true;
        const outcome = structuredClone(
          responses
            ? await lease.session.resumeTurn!(structuredClone(turn), responses, executionOptions)
            : await lease.session.runTurn(structuredClone(turn), executionOptions),
        );
        if (outcome.kind === 'failed') throw new Error(outcome.message);
        if (
          outcome.kind !== 'wait' &&
          outcome.kind !== 'yield' &&
          (outcome.kind !== 'speak' || typeof outcome.content !== 'string')
        ) {
          throw new Error(`Invalid turn result from ${participant.id}`);
        }
        await options.settle(turn, outcome);
        const member = {
          turn,
          outcome,
          checkpoint: structuredClone((await lease.session.checkpoint?.()) ?? null),
        };
        if (
          outcome.kind === 'wait' &&
          (!participant.factory.supportsContinuation ||
            !lease.session.resumeTurn ||
            !member.checkpoint ||
            !participant.factory.checkpointVersions?.includes(member.checkpoint.version))
        )
          throw new Error(
            `Participant wait requires compatible checkpoint continuation: ${participant.id}`,
          );
        // Save settled results even when a sibling or the caller cancelled during this call.
        await options.prepare(member);
        prepared[index] = member;
        signal.throwIfAborted();
        if (outcome.kind !== 'wait')
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
        const interrupted = signal.aborted;
        if (!failed) {
          failed = true;
          failure = error;
        }
        groupAbort.abort(error);
        // This process saw the attempt settle. Under cancellation it contributed nothing, so it is
        // dispatched again later; a runtime that acted outside the conversation must report that.
        await (interrupted ? options.restore(turn, entered) : options.fail(turn, error)).catch(
          () => {},
        );
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

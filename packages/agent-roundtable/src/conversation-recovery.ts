import type { ConversationState, StoredMember } from './conversation-state';
import { parkMember } from './conversation-requests';
import { RoundtableError, errorMessage } from './errors';
import { assertJsonValue, canonicalJson } from './json';
import { applyCallSettlement } from './usage-settlement';
import type { UsageContext } from './usage-ledger';
import type {
  AgentParticipant,
  AttemptRecovery,
  AttemptRecoveryInput,
  CallSettlement,
  ParticipantCheckpoint,
  ParticipantDefinition,
  PricePolicy,
  TurnSelector,
  UsagePrincipal,
} from './types';

/** What recovery asked of the factories, gathered before anything is committed. */
export interface RecoveryPlan {
  /** The saved selection never finished; it is asked again. */
  reselect: boolean;
  /** One answer per interrupted member, by participant id. */
  answers: Map<string, AttemptRecovery>;
}

function refuse(message: string): never {
  throw new RoundtableError('recovery-required', message);
}

/** A member the process stopped without seeing it settle, or a selection it stopped before saving. */
export function needsRecovery(state: ConversationState): boolean {
  if (state.terminal) return false;
  const { phase } = state;
  if (phase.kind === 'selecting') return true;
  return (
    phase.kind === 'group' &&
    phase.members.some((member) => ['running', 'settled', 'failed'].includes(member.status))
  );
}

function reserved(state: ConversationState, principal: UsagePrincipal, attemptId: string) {
  return state.snapshot.usage.filter(
    (record) =>
      record.status === 'reserved' &&
      record.attemptId === attemptId &&
      record.principal.kind === principal.kind &&
      record.principal.id === principal.id,
  );
}

function interrupted(member: StoredMember): boolean {
  return member.status === 'running' || member.status === 'settled';
}

/**
 * Asks each interrupted member's factory what its own journal proves. Nothing is committed: an
 * unusable or throwing answer refuses the whole recovery, and a failed member ends the conversation
 * the way it would have had the process lived to record it.
 */
export async function gatherRecovery(options: {
  state: ConversationState;
  participants: ReadonlyMap<string, ParticipantDefinition>;
  selector: TurnSelector;
  /** Called before each runtime call so a lost claim or a stop is noticed first. */
  admit: () => Promise<void>;
}): Promise<RecoveryPlan> {
  const { state, participants, selector, admit } = options;
  const plan: RecoveryPlan = { reselect: false, answers: new Map() };
  const { phase } = state;
  if (phase.kind === 'selecting') {
    if (!selector.idempotentDecision)
      refuse('An interrupted selection cannot be asked again by this selector');
    plan.reselect = true;
    return plan;
  }
  if (phase.kind !== 'group') return plan;
  const failed = phase.members.find((member) => member.status === 'failed');
  if (failed) throw new Error(failed.error ?? 'Participant failed');
  for (const member of phase.members.filter(interrupted)) {
    const participant = participants.get(member.participantId);
    const factory = (participant as AgentParticipant | undefined)?.factory;
    if (participant?.kind !== 'agent' || typeof factory?.reconcile !== 'function')
      refuse(`Participant cannot reconcile an interrupted attempt: ${member.participantId}`);
    const input: AttemptRecoveryInput = {
      conversationId: state.snapshot.conversationId,
      participantId: member.participantId,
      turn: structuredClone(member.turn),
      checkpoint: structuredClone(
        member.checkpoint ??
          state.participants.find((saved) => saved.id === member.participantId)?.checkpoint ??
          null,
      ),
      reservedCalls: reserved(
        state,
        { kind: 'participant', id: member.participantId },
        member.turn.attemptId,
      ).map(({ callId, kind }) => ({ callId, kind })),
    };
    await admit();
    let answer: AttemptRecovery;
    try {
      answer = structuredClone(await factory.reconcile(input));
      assertJsonValue(answer);
    } catch (error) {
      refuse(`Reconciling ${member.participantId} failed: ${errorMessage(error)}`);
    }
    plan.answers.set(member.participantId, answer);
  }
  return plan;
}

function usableCheckpoint(
  checkpoint: ParticipantCheckpoint | undefined,
  versions: readonly string[] | undefined,
  participantId: string,
): ParticipantCheckpoint {
  if (
    typeof checkpoint?.version !== 'string' ||
    !Object.hasOwn(checkpoint, 'data') ||
    !versions?.includes(checkpoint.version)
  )
    refuse(`Recovered checkpoint is missing or unsupported: ${participantId}`);
  return checkpoint;
}

function answerCalls(
  state: ConversationState,
  revision: number,
  ctx: UsageContext,
  calls: readonly CallSettlement[] | undefined,
  mustRefund: boolean,
  pricing: PricePolicy | undefined,
): void {
  if (!Array.isArray(calls)) refuse(`Recovery answer lacks its calls: ${ctx.principal.id}`);
  const open = reserved(state, ctx.principal, ctx.attemptId)
    .map((record) => record.callId)
    .sort();
  const answered = calls.map((call) => call?.callId).sort();
  if (canonicalJson(open) !== canonicalJson(answered))
    refuse(`Recovery must answer every reserved call exactly once: ${ctx.principal.id}`);
  for (const call of calls) {
    if (mustRefund && call.kind !== 'not-dispatched')
      refuse(`A turn that never started cannot have a dispatched call: ${ctx.principal.id}`);
    try {
      applyCallSettlement(state, revision, ctx, call, pricing);
    } catch (error) {
      refuse(`Call settlement was refused: ${errorMessage(error)}`);
    }
  }
}

/**
 * A call an interrupted selection may have dispatched is kept counted; only the host can settle it,
 * since a selector has no journal to prove otherwise.
 */
export function retainSelectorCalls(
  state: ConversationState,
  revision: number,
  options: { runId: string; selectorId: string; attemptId: string; pricing?: PricePolicy },
): void {
  const principal: UsagePrincipal = { kind: 'selector', id: options.selectorId };
  for (const record of reserved(state, principal, options.attemptId)) {
    applyCallSettlement(
      state,
      revision,
      {
        conversationId: state.snapshot.conversationId,
        runId: options.runId,
        principal,
        turnId: null,
        groupId: null,
        attemptId: options.attemptId,
      },
      { kind: 'uncertain', callId: record.callId },
      options.pricing,
    );
  }
}

/**
 * The pure mutator of the one commit that settles every interrupted call and moves every interrupted
 * member forward. Any refusal throws before anything is stored, so recovery commits whole or not at
 * all.
 */
export function applyRecovery(
  state: ConversationState,
  revision: number,
  plan: RecoveryPlan,
  options: {
    runId: string;
    selectorId: string;
    pricing?: PricePolicy;
    participants: ReadonlyMap<string, ParticipantDefinition>;
    newAttemptId: () => string;
  },
): void {
  const { phase } = state;
  const base = { conversationId: state.snapshot.conversationId, runId: options.runId };
  if (plan.reselect) {
    if (phase.kind !== 'selecting') refuse('Saved selection changed during recovery');
    retainSelectorCalls(state, revision, {
      runId: options.runId,
      selectorId: options.selectorId,
      attemptId: phase.attemptId,
      ...(options.pricing ? { pricing: options.pricing } : {}),
    });
    state.phase = { kind: 'ready' };
    return;
  }
  if (phase.kind !== 'group') return;
  for (const member of phase.members.filter(interrupted)) {
    const answer = plan.answers.get(member.participantId);
    if (!answer) refuse(`No recovery answer for ${member.participantId}`);
    const factory = (options.participants.get(member.participantId) as AgentParticipant).factory;
    const { turn } = member;
    const ctx: UsageContext = {
      ...base,
      principal: { kind: 'participant', id: member.participantId },
      turnId: turn.turnId,
      groupId: turn.groupId,
      attemptId: turn.attemptId,
    };
    // A member resumed from a saved wait continues that turn's responses, never its first input.
    const resuming = member.requestIds.length > 0;
    answerCalls(state, revision, ctx, answer.calls, answer.kind === 'not-started', options.pricing);
    if (member.status === 'settled' && answer.kind !== 'settled')
      refuse(`A settled result cannot be contradicted: ${member.participantId}`);
    switch (answer.kind) {
      case 'not-started':
        // The old attempt's calls are all refunded, so the retry takes a new attempt id and with it
        // new call ids; a member resuming a saved wait keeps its responses.
        Object.assign(
          member,
          resuming
            ? { status: 'resumable' }
            : { status: 'pending', outcome: null, checkpoint: null },
          { turn: { ...turn, attemptId: options.newAttemptId() } },
        );
        break;
      case 'resume': {
        member.checkpoint = usableCheckpoint(
          answer.checkpoint,
          factory.checkpointVersions,
          member.participantId,
        );
        member.status = resuming ? 'resumable' : 'recovering';
        if (!resuming) member.outcome = null;
        break;
      }
      case 'settled': {
        const { outcome } = answer;
        const checkpoint = usableCheckpoint(
          answer.checkpoint,
          factory.checkpointVersions,
          member.participantId,
        );
        if (
          !outcome ||
          (outcome.kind === 'speak'
            ? typeof outcome.content !== 'string'
            : outcome.kind !== 'yield' &&
              (outcome.kind !== 'wait' ||
                !Array.isArray(outcome.requests) ||
                outcome.requests.length === 0))
        )
          refuse(`Recovered outcome is invalid: ${member.participantId}`);
        if (member.status === 'settled' && canonicalJson(member.outcome) !== canonicalJson(outcome))
          refuse(`A settled result cannot be contradicted: ${member.participantId}`);
        member.outcome = outcome;
        if (outcome.kind === 'wait') {
          if (!factory.supportsContinuation)
            refuse(`Participant cannot continue a wait: ${member.participantId}`);
          park(state, member, outcome.requests, checkpoint);
        } else
          Object.assign(member, { status: 'prepared', checkpoint, requestIds: [], error: null });
        break;
      }
      case 'uncertain': {
        const checkpoint = usableCheckpoint(
          answer.checkpoint,
          factory.checkpointVersions,
          member.participantId,
        );
        if (
          !factory.supportsContinuation ||
          !Array.isArray(answer.requests) ||
          answer.requests.length === 0 ||
          answer.requests.some((request) => request?.kind !== 'reconciliation')
        )
          refuse(`An uncertain effect needs reconciliation requests: ${member.participantId}`);
        // A host that already answered these requests before the process died is not asked again:
        // the member continues with those committed responses, and the participant journals them.
        const answered =
          answer.requests.length === member.requestIds.length &&
          answer.requests.every(
            (request) =>
              member.requestIds.includes(request.id) &&
              state.responses.some((entry) => entry.value.request.id === request.id),
          );
        if (answered) {
          Object.assign(member, { status: 'resumable', checkpoint });
          break;
        }
        member.outcome = { kind: 'wait', requests: answer.requests };
        park(state, member, answer.requests, checkpoint);
        break;
      }
      default:
        refuse(`Recovery answer is not recognized: ${member.participantId}`);
    }
  }
}

function park(
  state: ConversationState,
  member: StoredMember,
  requests: Parameters<typeof parkMember>[2],
  checkpoint: ParticipantCheckpoint,
): void {
  try {
    parkMember(state, member, requests, checkpoint);
  } catch (error) {
    refuse(`Recovered wait was refused: ${errorMessage(error)}`);
  }
}

import { maxSummaryLength } from './context-policy';
import type { ConversationState } from './conversation-state';
import {
  requireState,
  record,
  list,
  text,
  integer,
  unique,
  reference,
  checkpoint,
} from './state-codec-values';
import { validateRequestState } from './state-codec-requests';
import { validateUsageState } from './state-codec-usage';
import type { StoredBudget } from './usage-budget';
import { validUsageCost } from './usage-validation';
import { assertJsonValue, canonicalJson } from './json';
import type { ConversationEnvelope } from './store-types';

/** Decode untrusted store data before a registry or participant can act on it. */
export function decodeConversation(
  envelope: ConversationEnvelope,
  conversationId: string,
): ConversationState {
  requireState(
    envelope.schemaVersion === 1 &&
      envelope.conversationId === conversationId &&
      integer(envelope.revision),
  );
  assertJsonValue(envelope.state);
  const state = record(envelope.state);
  requireState(state.schemaVersion === 1);
  const snapshot = record(state.snapshot);
  requireState(
    snapshot.conversationId === conversationId && snapshot.revision === envelope.revision,
  );
  const definition = record(state.definition);
  const limits = record(definition.limits);
  requireState(definition.purpose === null || typeof definition.purpose === 'string');
  requireState(
    integer(limits.maxTurnsPerRun, 1) &&
      (limits.timeoutMs === null || integer(limits.timeoutMs, 1)) &&
      (limits.maxModelCallsPerRun === null || integer(limits.maxModelCallsPerRun, 1)) &&
      (limits.maxModelCallsPerConversation === null ||
        integer(limits.maxModelCallsPerConversation, 1)) &&
      (limits.maxModelCallsPerParticipant === null ||
        integer(limits.maxModelCallsPerParticipant, 1)),
  );
  requireState(integer(definition.maxConcurrentParticipants, 1) && integer(definition.leaseMs, 1));
  requireState(definition.recovery === 'none' || definition.recovery === 'durable');
  if (definition.selector !== null) reference(definition.selector);
  reference(definition.contextPolicy);
  requireState(definition.pricingVersion === null || text(definition.pricingVersion));
  // A budget is a required field, null without one; a cost amount needs the pricing it is counted by.
  if (definition.budget !== null) {
    const budget = record(definition.budget);
    requireState(
      Object.keys(budget).length === 3 &&
        (budget.tokens === null || integer(budget.tokens, 1)) &&
        (budget.cost === null ||
          (validUsageCost(budget.cost) &&
            BigInt(record(budget.cost).minorUnits as string) > 0n &&
            definition.pricingVersion !== null)) &&
        (budget.tokens !== null || budget.cost !== null) &&
        (budget.mode === 'strict' || budget.mode === 'estimated'),
    );
  }
  checkpoint(state.selectorCheckpoint);

  const participants = list(state.participants).map(record);
  requireState(participants.length > 0);
  unique(participants.map((p) => p.id));
  const byId = new Map(participants.map((p) => [p.id, p]));
  for (const participant of participants) {
    requireState(participant.description === null || typeof participant.description === 'string');
    if (participant.runtime !== null) reference(participant.runtime);
    checkpoint(participant.checkpoint);
    if (participant.runtime === null) requireState(participant.checkpoint === null);
    unique(list(participant.delivered));
  }

  const messages = list(snapshot.messages).map(record);
  unique(messages.map((m) => m.id));
  const byMessage = new Map(messages.map((m) => [m.id, m]));
  let previousRevision = 0;
  for (const message of messages) {
    requireState(byId.has(message.participantId) && typeof message.content === 'string');
    requireState(
      text(message.turnId) &&
        text(message.groupId) &&
        integer(message.revision, 1) &&
        message.revision <= envelope.revision &&
        message.revision >= previousRevision,
    );
    previousRevision = message.revision;
  }
  for (const participant of participants) {
    requireState(
      list(participant.delivered).every(
        (id) => byMessage.has(id) && byMessage.get(id)?.participantId !== participant.id,
      ),
    );
  }
  const turns = list(snapshot.turns).map(record);
  unique(turns.map((turn) => turn.id));
  for (const message of messages) {
    if (byId.get(message.participantId)?.runtime !== null) {
      requireState(
        turns.some(
          (turn) =>
            turn.id === message.turnId &&
            turn.groupId === message.groupId &&
            turn.participantId === message.participantId &&
            turn.outcome === 'speak',
        ),
      );
    }
  }
  for (const turn of turns) {
    requireState(
      byId.has(turn.participantId) &&
        text(turn.groupId) &&
        ['speak', 'yield'].includes(String(turn.outcome)),
    );
    if (turn.outcome === 'speak')
      requireState(
        messages.some(
          (m) =>
            m.turnId === turn.id &&
            m.groupId === turn.groupId &&
            m.participantId === turn.participantId,
        ),
      );
  }
  validateRequestState(state, snapshot, byId, byMessage, turns, envelope.revision);
  if (state.terminal !== null) {
    const terminal = record(state.terminal);
    requireState(terminal.revision === envelope.revision);
    requireState(
      (terminal.status === 'failed' && typeof terminal.message === 'string') ||
        (terminal.status === 'completed' && typeof terminal.reason === 'string'),
    );
  }

  const phase = record(state.phase);
  requireState(['ready', 'selecting', 'selected', 'group'].includes(String(phase.kind)));
  if (phase.kind === 'selecting' || phase.kind === 'selected') requireState(text(phase.attemptId));
  if (phase.kind === 'selected') {
    const selection = record(phase.selection);
    if (selection.kind === 'parallel') {
      const ids = list(selection.participantIds);
      unique(ids);
      requireState(
        ids.length > 0 &&
          ids.length <= Number(limits.maxTurnsPerRun) &&
          ids.every((id) => byId.has(id) && byId.get(id)?.runtime !== null),
      );
    } else if (selection.kind === 'finish') requireState(typeof selection.reason === 'string');
    else {
      requireState(
        (selection.kind === 'speak' || selection.kind === 'wait') &&
          byId.has(selection.participantId),
      );
      if (selection.kind === 'wait')
        requireState(
          byId.get(selection.participantId)?.runtime === null &&
            typeof selection.reason === 'string',
        );
    }
  }
  if (phase.kind === 'group') {
    requireState(
      text(phase.groupId) && integer(phase.baseRevision) && phase.baseRevision <= envelope.revision,
    );
    const members = list(phase.members).map(record);
    requireState(members.length > 0);
    unique(members.map((member) => member.participantId));
    unique(members.map((member) => member.messageId));
    unique(members.map((member) => record(member.turn).turnId));
    for (const member of members) {
      requireState(
        byId.has(member.participantId) && byId.get(member.participantId)?.runtime !== null,
      );
      requireState(
        !byMessage.has(member.messageId) &&
          [
            'pending',
            'running',
            'settled',
            'prepared',
            'waiting',
            'resumable',
            'recovering',
            'failed',
          ].includes(String(member.status)),
      );
      requireState(member.error === null || typeof member.error === 'string');
      checkpoint(member.checkpoint);
      const turn = record(member.turn);
      requireState(
        turn.conversationId === conversationId &&
          turn.participantId === member.participantId &&
          turn.groupId === phase.groupId &&
          text(turn.attemptId) &&
          !turns.some((t) => t.id === turn.turnId),
      );
      requireState(turn.purpose === undefined || typeof turn.purpose === 'string');
      const context = record(turn.context);
      requireState(context.baseRevision === phase.baseRevision);
      const offered = list(context.messages).map(record);
      unique(offered.map((m) => m.id));
      // A view may leave messages out, so each stored one only has to be an undelivered, foreign
      // transcript message at or below the base revision; a summary is text and never a message.
      const undelivered = (id: unknown): boolean => {
        const message = byMessage.get(id);
        return (
          message !== undefined &&
          Number(message.revision) <= Number(phase.baseRevision) &&
          message.participantId !== member.participantId &&
          !list(byId.get(member.participantId)?.delivered).includes(id)
        );
      };
      requireState(
        offered.every(
          (m) => undelivered(m.id) && canonicalJson(m) === canonicalJson(byMessage.get(m.id)),
        ),
      );
      if (context.summary !== undefined)
        requireState(text(context.summary) && context.summary.length <= maxSummaryLength);
      if (context.consumed !== undefined) {
        const consumed = list(context.consumed);
        unique(consumed);
        requireState(
          consumed.length > 0 &&
            consumed.every((id) => undelivered(id) && !offered.some((m) => m.id === id)),
        );
      }
      if (member.outcome !== null) {
        const outcome = record(member.outcome);
        requireState(
          outcome.kind === 'yield' ||
            (outcome.kind === 'speak' && typeof outcome.content === 'string') ||
            (outcome.kind === 'wait' &&
              Array.isArray(outcome.requests) &&
              outcome.requests.length > 0),
        );
      }
      if (member.status === 'prepared' || member.status === 'settled')
        requireState(member.outcome !== null);
      if (member.status === 'prepared') requireState(record(member.outcome).kind !== 'wait');
      if (member.status === 'pending')
        requireState(member.outcome === null && member.checkpoint === null);
      if (member.status === 'recovering')
        requireState(member.outcome === null && member.checkpoint !== null);
    }
  }
  const byTurn = new Set<string>(
    turns.map((turn) => `${turn.id}:${turn.groupId}:${turn.participantId}`),
  );
  if (phase.kind === 'group') {
    for (const member of list(phase.members).map(record)) {
      const turn = record(member.turn);
      byTurn.add(`${turn.turnId}:${turn.groupId}:${member.participantId}`);
    }
  }
  validateUsageState(
    snapshot.usage,
    byId,
    byTurn,
    conversationId,
    envelope.revision,
    definition.budget as StoredBudget | null,
  );
  return structuredClone(state) as unknown as ConversationState;
}

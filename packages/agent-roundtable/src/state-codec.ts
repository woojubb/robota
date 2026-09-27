import type { ConversationState } from './conversation-state';
import { RoundtableError } from './errors';
import { assertJsonValue, canonicalJson } from './json';
import type { ConversationEnvelope } from './store-types';

function requireState(condition: unknown): asserts condition {
  if (!condition)
    throw new RoundtableError(
      'invalid-config',
      'Stored conversation state is invalid or incompatible',
    );
}

function record(value: unknown): Record<string, unknown> {
  requireState(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  requireState(Array.isArray(value));
  return value;
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function integer(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}
function unique(values: unknown[]): void {
  requireState(values.every(text) && new Set(values).size === values.length);
}
function reference(value: unknown): void {
  const ref = record(value);
  requireState(text(ref.id) && text(ref.version));
}
function checkpoint(value: unknown): void {
  if (value === null) return;
  const saved = record(value);
  requireState(text(saved.version) && Object.hasOwn(saved, 'data'));
}

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
      (limits.timeoutMs === null || integer(limits.timeoutMs, 1)),
  );
  requireState(integer(definition.maxConcurrentParticipants, 1) && integer(definition.leaseMs, 1));
  requireState(definition.recovery === 'none' || definition.recovery === 'durable');
  if (definition.selector !== null) reference(definition.selector);
  reference(definition.contextPolicy);
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
  const requests = list(snapshot.requests).map(record);
  unique(requests.map((request) => request.id));
  for (const request of requests) {
    requireState(
      request.kind === 'input' &&
        byId.get(request.participantId)?.runtime === null &&
        typeof request.reason === 'string' &&
        text(request.groupId) &&
        text(request.turnId),
    );
  }
  const inputs = list(state.inputs).map(record);
  unique(inputs.map((input) => input.id));
  for (const input of inputs) {
    const result = record(input.result);
    requireState(
      text(input.fingerprint) &&
        byMessage.has(result.messageId) &&
        integer(result.revision, 1) &&
        byMessage.get(result.messageId)?.revision === result.revision,
    );
  }
  if (state.terminal !== null) {
    const terminal = record(state.terminal);
    requireState(terminal.revision === envelope.revision);
    requireState(
      terminal.status === 'cancelled' ||
        (terminal.status === 'failed' && typeof terminal.message === 'string') ||
        (terminal.status === 'completed' && typeof terminal.reason === 'string') ||
        (terminal.status === 'limited' && terminal.reason === 'time'),
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
        ids.length > 0 && ids.every((id) => byId.has(id) && byId.get(id)?.runtime !== null),
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
      text(phase.groupId) &&
        integer(phase.baseRevision) &&
        phase.baseRevision <= envelope.revision &&
        requests.length === 0,
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
          ['pending', 'running', 'settled', 'prepared', 'failed'].includes(String(member.status)),
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
      const delivered = list(context.messages).map(record);
      unique(delivered.map((m) => m.id));
      requireState(
        delivered.every(
          (m) =>
            byMessage.has(m.id) &&
            canonicalJson(m) === canonicalJson(byMessage.get(m.id)) &&
            Number(m.revision) <= Number(phase.baseRevision) &&
            m.participantId !== member.participantId &&
            !list(byId.get(member.participantId)?.delivered).includes(m.id),
        ),
      );
      if (member.outcome !== null) {
        const outcome = record(member.outcome);
        requireState(
          outcome.kind === 'yield' ||
            (outcome.kind === 'speak' && typeof outcome.content === 'string'),
        );
      }
      if (member.status === 'prepared' || member.status === 'settled')
        requireState(member.outcome !== null);
      if (member.status === 'pending')
        requireState(member.outcome === null && member.checkpoint === null);
    }
  }
  return structuredClone(state) as unknown as ConversationState;
}

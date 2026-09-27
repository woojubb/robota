import type { ConversationState, StoredMember } from './conversation-state';
import { RoundtableError } from './errors';
import { canonicalJson } from './json';
import type {
  ConversationRequest,
  ExternalInput,
  ParticipantCheckpoint,
  ParticipantRequest,
  ParticipantResponse,
  ResumeRequest,
  ResponseReceipt,
} from './types';

export function inputFingerprint(input: ExternalInput): string {
  return JSON.stringify([input.participantId, input.replyToRequestId ?? null, input.content]);
}

export function responseFingerprint(input: ResumeRequest): string {
  return canonicalJson([input.requestId, input.response]);
}

function conflict(message: string): never {
  throw new RoundtableError('conflict', message);
}

export function validateInput(input: ExternalInput): void {
  if (
    !input ||
    typeof input.participantId !== 'string' ||
    !input.participantId ||
    typeof input.inputId !== 'string' ||
    !input.inputId ||
    typeof input.content !== 'string' ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    (input.replyToRequestId !== undefined &&
      (typeof input.replyToRequestId !== 'string' || !input.replyToRequestId))
  )
    conflict('Input participant, response, revision and content are invalid');
}

export function validateResponse(input: ResumeRequest): void {
  if (
    !input ||
    typeof input.requestId !== 'string' ||
    !input.requestId ||
    typeof input.responseId !== 'string' ||
    !input.responseId ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    conflict('Request, response and revision identities are required');
  const response = input.response;
  if (!response || typeof response !== 'object' || Array.isArray(response))
    conflict('Invalid request response');
  canonicalJson(response);
  const key =
    response.kind === 'input'
      ? 'content'
      : response.kind === 'approval'
        ? 'approved'
        : response.kind === 'reconciliation'
          ? 'data'
          : '';
  if (
    !key ||
    Object.keys(response).sort().join(',') !== [key, 'kind'].sort().join(',') ||
    (response.kind === 'input' && typeof response.content !== 'string') ||
    (response.kind === 'approval' && typeof response.approved !== 'boolean')
  )
    conflict('Invalid request response');
}

/** Persist a safe runtime checkpoint and all its requests atomically. */
export function parkMember(
  state: ConversationState,
  member: StoredMember,
  requests: readonly ParticipantRequest[],
  checkpoint: ParticipantCheckpoint | null,
): void {
  if (!checkpoint || !requests.length)
    conflict('A participant wait requires a private checkpoint and requests');
  canonicalJson(requests);
  const ids = new Set([
    ...state.snapshot.requests.map((request) => request.id),
    ...state.responses.map((entry) => entry.value.request.id),
  ]);
  const stamped: ConversationRequest[] = requests.map((request) => {
    if (
      typeof request.id !== 'string' ||
      !request.id ||
      ids.has(request.id) ||
      typeof request.reason !== 'string'
    )
      conflict('Wait request identity is invalid or already used');
    ids.add(request.id);
    const base = {
      id: request.id,
      reason: request.reason,
      groupId: member.turn.groupId,
      turnId: member.turn.turnId,
      memberId: member.participantId,
    };
    if (request.kind === 'input') {
      if (
        !state.participants.some(
          (participant) => participant.id === request.participantId && participant.runtime === null,
        )
      )
        conflict('Member input must target a registered external participant');
      return { ...base, kind: 'input', participantId: request.participantId };
    }
    if (
      (request.kind !== 'approval' && request.kind !== 'reconciliation') ||
      !Object.hasOwn(request, 'data')
    )
      conflict('Unsupported participant request');
    return {
      ...base,
      kind: request.kind,
      participantId: member.participantId,
      data: structuredClone(request.data),
    };
  });
  member.status = 'waiting';
  member.checkpoint = checkpoint;
  member.requestIds = stamped.map((request) => request.id);
  state.snapshot.requests.push(...stamped);
}

/** One receipt owns both API entry points for an input response. */
export function recordResponse(
  state: ConversationState,
  request: ConversationRequest,
  input: ResumeRequest,
  revision: number,
  inputIdentity?: { messageId: string; turnId: string },
): ResponseReceipt {
  if (
    state.responses.some(
      (entry) =>
        entry.value.responseId === input.responseId || entry.value.request.id === input.requestId,
    ) ||
    state.inputs.some((entry) => entry.id === input.responseId)
  )
    conflict('Response identity or request was already consumed');
  if (request.kind !== input.response.kind) conflict('Response kind differs from its request');
  const result = { revision, requestId: request.id, responseId: input.responseId };
  const identity =
    input.response.kind === 'input'
      ? (inputIdentity ?? { messageId: crypto.randomUUID(), turnId: crypto.randomUUID() })
      : null;
  state.responses.push({
    value: {
      request: structuredClone(request),
      responseId: input.responseId,
      response: structuredClone(input.response),
    },
    fingerprint: responseFingerprint(input),
    result,
    inputMessageId: identity?.messageId ?? null,
    inputTurnId: identity?.turnId ?? null,
  });
  if (input.response.kind === 'input' && identity) {
    state.inputs.push({
      id: input.responseId,
      fingerprint: inputFingerprint({
        participantId: request.participantId,
        inputId: input.responseId,
        replyToRequestId: request.id,
        content: input.response.content,
        expectedRevision: input.expectedRevision,
      }),
      result: { revision, messageId: identity.messageId },
    });
  }
  state.snapshot.requests = state.snapshot.requests.filter((pending) => pending.id !== request.id);
  return result;
}

export function acceptMemberResponse(
  state: ConversationState,
  input: ResumeRequest,
  revision: number,
): ResponseReceipt {
  if (input.expectedRevision !== state.snapshot.revision) conflict('Conversation revision changed');
  const request = state.snapshot.requests.find((pending) => pending.id === input.requestId);
  if (!request?.memberId || state.phase.kind !== 'group') conflict('No matching member request');
  const member = state.phase.members.find(
    (candidate) => candidate.participantId === request.memberId,
  );
  if (
    !member ||
    member.status !== 'waiting' ||
    !member.requestIds.includes(request.id) ||
    member.turn.turnId !== request.turnId
  )
    conflict('Request no longer belongs to the waiting member');
  const result = recordResponse(state, request, input, revision);
  if (
    member.requestIds.every((id) => state.responses.some((entry) => entry.value.request.id === id))
  )
    member.status = 'resumable';
  return result;
}

export function memberResponses(
  state: ConversationState,
  member: StoredMember,
): ParticipantResponse[] {
  return member.requestIds.map((id) => {
    const response = state.responses.find((entry) => entry.value.request.id === id);
    if (!response) conflict('Member response is missing');
    return structuredClone(response.value);
  });
}

/** Publish only input replies, in acceptance order, as part of the same final group commit. */
export function publishMemberInputs(
  state: ConversationState,
  member: StoredMember,
  revision: number,
): string[] {
  const delivered: string[] = [];
  for (const { value, inputMessageId, inputTurnId } of state.responses) {
    if (
      value.request.memberId !== member.participantId ||
      value.request.turnId !== member.turn.turnId ||
      value.response.kind !== 'input'
    )
      continue;
    if (!inputMessageId || !inputTurnId) conflict('Input publication identity is missing');
    state.snapshot.messages.push({
      id: inputMessageId,
      participantId: value.request.participantId,
      content: value.response.content,
      revision,
      turnId: inputTurnId,
      groupId: member.turn.groupId,
    });
    state.snapshot.turns.push({
      id: inputTurnId,
      groupId: member.turn.groupId,
      participantId: value.request.participantId,
      outcome: 'speak',
    });
    delivered.push(inputMessageId);
  }
  return delivered;
}

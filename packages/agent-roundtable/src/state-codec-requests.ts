import { canonicalJson } from './json';
import { requireState, record, list, text, integer, unique } from './state-codec-values';

/** Validate request ownership and both API receipts before resolving a runtime. */
export function validateRequestState(
  state: Record<string, unknown>,
  snapshot: Record<string, unknown>,
  byId: Map<unknown, Record<string, unknown>>,
  byMessage: Map<unknown, Record<string, unknown>>,
  turns: Record<string, unknown>[],
  revision: number,
): void {
  const phase = record(state.phase);
  const members = phase.kind === 'group' ? list(phase.members).map(record) : [];
  const pending = list(snapshot.requests).map(record);
  unique(pending.map((request) => request.id));
  const responses = list(state.responses).map(record);
  const responseByRequest = new Map(
    responses.map((entry) => [record(record(entry.value).request).id, entry]),
  );
  unique(responses.map((entry) => record(entry.value).responseId));
  unique(responses.map((entry) => record(record(entry.value).request).id));

  function matchingMember(request: Record<string, unknown>): Record<string, unknown> | undefined {
    return members.find(
      (member) =>
        member.participantId === request.memberId &&
        record(member.turn).turnId === request.turnId &&
        phase.groupId === request.groupId,
    );
  }
  function validateRequest(request: Record<string, unknown>, unresolved: boolean): void {
    requireState(
      text(request.id) &&
        text(request.groupId) &&
        text(request.turnId) &&
        typeof request.reason === 'string',
    );
    if (request.kind === 'input') requireState(byId.get(request.participantId)?.runtime === null);
    else
      requireState(
        (request.kind === 'approval' || request.kind === 'reconciliation') &&
          request.memberId === request.participantId &&
          Object.hasOwn(request, 'data'),
      );
    if (request.memberId !== undefined) {
      requireState(
        text(request.memberId) &&
          byId.has(request.memberId) &&
          byId.get(request.memberId)?.runtime !== null,
      );
      const member = matchingMember(request);
      if (unresolved)
        requireState(
          member && list(member.requestIds).includes(request.id) && member.status === 'waiting',
        );
      else
        requireState(
          member ||
            turns.some(
              (turn) =>
                turn.id === request.turnId &&
                turn.groupId === request.groupId &&
                turn.participantId === request.memberId,
            ),
        );
    } else requireState(request.kind === 'input' && (!unresolved || phase.kind === 'ready'));
  }
  for (const request of pending) {
    validateRequest(request, true);
    requireState(!responseByRequest.has(request.id));
  }
  let previousRevision = 0;
  const inputMessageIds = new Set<unknown>();
  const inputTurnIds = new Set<unknown>();
  for (const entry of responses) {
    const value = record(entry.value);
    const request = record(value.request);
    const response = record(value.response);
    const result = record(entry.result);
    validateRequest(request, false);
    requireState(
      response.kind === request.kind &&
        result.requestId === request.id &&
        result.responseId === value.responseId &&
        integer(result.revision, 1) &&
        result.revision <= revision &&
        result.revision >= previousRevision &&
        entry.fingerprint === canonicalJson([request.id, response]),
    );
    previousRevision = result.revision;
    const key =
      response.kind === 'input' ? 'content' : response.kind === 'approval' ? 'approved' : 'data';
    requireState(Object.keys(response).sort().join(',') === [key, 'kind'].sort().join(','));
    if (response.kind === 'input') {
      requireState(
        typeof response.content === 'string' &&
          text(entry.inputMessageId) &&
          text(entry.inputTurnId) &&
          !inputMessageIds.has(entry.inputMessageId) &&
          !inputTurnIds.has(entry.inputTurnId),
      );
      inputMessageIds.add(entry.inputMessageId);
      inputTurnIds.add(entry.inputTurnId);
      const message = byMessage.get(entry.inputMessageId);
      const inputTurn = turns.find((turn) => turn.id === entry.inputTurnId);
      if (message)
        requireState(
          message.participantId === request.participantId &&
            message.content === response.content &&
            message.turnId === entry.inputTurnId &&
            message.groupId === request.groupId &&
            Number(message.revision) >= result.revision,
        );
      const activeMember = matchingMember(request);
      if (request.memberId !== undefined && activeMember) {
        requireState(
          !message &&
            !inputTurn &&
            !members.some(
              (member) =>
                member.messageId === entry.inputMessageId ||
                record(member.turn).turnId === entry.inputTurnId,
            ),
        );
      } else {
        requireState(
          message &&
            inputTurn &&
            inputTurn.groupId === request.groupId &&
            inputTurn.participantId === request.participantId &&
            inputTurn.outcome === 'speak',
        );
        if (request.memberId !== undefined)
          requireState(list(byId.get(request.memberId)?.delivered).includes(entry.inputMessageId));
      }
      if (request.memberId === undefined)
        requireState(
          message && message.revision === result.revision && entry.inputTurnId === request.turnId,
        );
    } else {
      requireState(entry.inputMessageId === null && entry.inputTurnId === null);
      if (response.kind === 'approval') requireState(typeof response.approved === 'boolean');
    }
  }

  const inputs = list(state.inputs).map(record);
  unique(inputs.map((input) => input.id));
  for (const input of inputs) {
    const result = record(input.result);
    requireState(
      text(input.fingerprint) && integer(result.revision, 1) && result.revision <= revision,
    );
    const entry = responses.find((candidate) => record(candidate.value).responseId === input.id);
    if (entry) {
      const value = record(entry.value);
      const request = record(value.request);
      const response = record(value.response);
      requireState(
        response.kind === 'input' &&
          result.messageId === entry.inputMessageId &&
          result.revision === record(entry.result).revision &&
          input.fingerprint ===
            JSON.stringify([request.participantId, request.id, response.content]),
      );
    } else {
      const message = byMessage.get(result.messageId);
      requireState(
        message &&
          message.revision === result.revision &&
          byId.get(message.participantId)?.runtime === null &&
          input.fingerprint === JSON.stringify([message.participantId, null, message.content]),
      );
    }
  }
  for (const entry of responses) {
    if (record(record(entry.value).response).kind === 'input')
      requireState(inputs.some((input) => input.id === record(entry.value).responseId));
  }

  for (const member of members) {
    const ids = list(member.requestIds);
    unique(ids);
    const outstanding = pending.filter((request) => request.memberId === member.participantId);
    if (member.status === 'waiting' || member.status === 'resumable') {
      requireState(
        ids.length > 0 && member.checkpoint !== null && record(member.outcome).kind === 'wait',
      );
      requireState(
        canonicalJson(ids) ===
          canonicalJson(list(record(member.outcome).requests).map((request) => record(request).id)),
      );
      requireState(member.status === 'waiting' ? outstanding.length > 0 : outstanding.length === 0);
    }
    if (member.status === 'pending' || member.status === 'prepared') requireState(ids.length === 0);
    for (const id of ids) {
      const request =
        pending.find((candidate) => candidate.id === id) ??
        record(record(responseByRequest.get(id)?.value).request);
      requireState(
        request.memberId === member.participantId &&
          request.turnId === record(member.turn).turnId &&
          request.groupId === phase.groupId,
      );
      if (member.status === 'waiting' || member.status === 'resumable') {
        const original = record(
          list(record(member.outcome).requests).find((value) => record(value).id === id),
        );
        requireState(
          original.kind === 'input' ||
            original.kind === 'approval' ||
            original.kind === 'reconciliation',
        );
        const expected = {
          id: original.id,
          reason: original.reason,
          kind: original.kind,
          participantId: original.kind === 'input' ? original.participantId : member.participantId,
          memberId: member.participantId,
          groupId: phase.groupId,
          turnId: record(member.turn).turnId,
          ...(original.kind === 'input' ? {} : { data: original.data }),
        };
        requireState(canonicalJson(request) === canonicalJson(expected));
      }
    }
  }
}

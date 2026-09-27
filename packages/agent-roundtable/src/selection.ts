import { RoundtableError } from './errors';
import type { ParticipantDefinition, Selection } from './types';

function invalid(message: string): never {
  throw new RoundtableError('invalid-selection', message);
}

export function resolveSelection(
  selection: Exclude<Selection, { kind: 'finish' }>,
  participants: ReadonlyMap<string, ParticipantDefinition>,
): ParticipantDefinition[] {
  const ids =
    selection.kind === 'parallel' ? [...selection.participantIds] : [selection.participantId];
  if (!ids.length || new Set(ids).size !== ids.length)
    invalid('Selection requires unique participants');
  return ids.map((id) => {
    const participant = participants.get(id);
    if (!participant) invalid(`Unknown participant: ${id}`);
    if (selection.kind === 'parallel' && participant.kind !== 'agent')
      invalid('Parallel selection requires agent participants');
    if (selection.kind === 'wait' && participant.kind !== 'external')
      invalid('Input wait requires an external participant');
    return participant;
  });
}

/**
 * Copy a selector decision into plain data and check it before it becomes stored progress: a saved
 * decision is reused by every later run, so one that no run can execute would stall the conversation.
 */
export function validateSelection(
  value: unknown,
  participants: ReadonlyMap<string, ParticipantDefinition>,
  maxTurnsPerRun: number,
): Selection {
  const decision: Partial<Record<string, unknown>> =
    value !== null && typeof value === 'object' ? { ...value } : {};
  const { kind, participantId, participantIds, reason } = decision;
  let selection: Selection;
  if (kind === 'finish' && typeof reason === 'string') selection = { kind, reason };
  else if (kind === 'speak' && typeof participantId === 'string')
    selection = { kind, participantId };
  else if (kind === 'wait' && typeof participantId === 'string' && typeof reason === 'string')
    selection = { kind, participantId, reason };
  else if (
    kind === 'parallel' &&
    Array.isArray(participantIds) &&
    participantIds.every((id): id is string => typeof id === 'string')
  )
    selection = { kind, participantIds: [...participantIds] };
  else invalid('Selection is malformed');
  if (
    selection.kind !== 'finish' &&
    resolveSelection(selection, participants).length > maxTurnsPerRun
  )
    invalid('Selection exceeds the turns allowed in one run');
  return selection;
}

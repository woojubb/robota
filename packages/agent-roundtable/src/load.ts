import { Conversation } from './conversation';
import { RoundtableError } from './errors';
import { roundRobin } from './policies';
import { decodeConversation } from './state-codec';
import type {
  LoadRoundtableOptions,
  ParticipantCheckpoint,
  ParticipantDefinition,
  Roundtable,
  RuntimeReference,
} from './types';

function sameReference(actual: RuntimeReference, expected: RuntimeReference): void {
  if (actual?.id !== expected.id || actual.version !== expected.version) {
    throw new RoundtableError(
      'invalid-config',
      'Runtime or policy version changed; explicit migration is required',
    );
  }
}

function samePricingVersion(actual: string | null, expected: string | null): void {
  if (actual !== expected) {
    throw new RoundtableError(
      'invalid-config',
      'Pricing policy version changed; explicit migration is required',
    );
  }
}

function compatible(checkpoint: ParticipantCheckpoint | null, versions?: readonly string[]): void {
  if (checkpoint && !versions?.includes(checkpoint.version)) {
    throw new RoundtableError(
      'invalid-config',
      `Unsupported checkpoint version: ${checkpoint.version}`,
    );
  }
}

export async function loadRoundtable(options: LoadRoundtableOptions): Promise<Roundtable> {
  const envelope = await options.store.load(options.conversationId);
  if (!envelope) throw new RoundtableError('conflict', 'Conversation does not exist');
  const state = decodeConversation(envelope, options.conversationId);
  const { definition, phase } = state;
  sameReference(definition.contextPolicy, { id: 'roundtable/increments', version: '1' });
  samePricingVersion(definition.pricingVersion, options.pricing?.version ?? null);
  if (
    !state.terminal &&
    (phase.kind === 'selecting' ||
      (phase.kind === 'group' &&
        phase.members.some(
          (member) => !['pending', 'prepared', 'waiting', 'resumable'].includes(member.status),
        )))
  ) {
    throw new RoundtableError(
      'recovery-required',
      'Interrupted execution requires runtime reconciliation before loading',
    );
  }
  const participants: ParticipantDefinition[] = [];
  for (const saved of state.participants) {
    const common = {
      id: saved.id,
      ...(saved.description === null ? {} : { description: saved.description }),
    };
    if (!saved.runtime) {
      participants.push({ kind: 'external', ...common });
      continue;
    }
    const registered = await options.registry.resolveParticipant({ ...saved.runtime });
    sameReference(registered.reference, saved.runtime);
    compatible(saved.checkpoint, registered.factory.checkpointVersions);
    const prepared =
      phase.kind === 'group'
        ? phase.members.find(
            (member) =>
              member.participantId === saved.id &&
              ['prepared', 'waiting', 'resumable'].includes(member.status),
          )
        : undefined;
    if (prepared) compatible(prepared.checkpoint, registered.factory.checkpointVersions);
    if (
      prepared &&
      (prepared.status === 'waiting' || prepared.status === 'resumable') &&
      !registered.factory.supportsContinuation
    )
      throw new RoundtableError(
        'invalid-config',
        `Participant does not support wait continuation: ${saved.id}`,
      );
    if (
      !state.terminal &&
      ((!saved.checkpoint &&
        state.snapshot.turns.some((turn) => turn.participantId === saved.id)) ||
        (prepared && !prepared.checkpoint))
    ) {
      throw new RoundtableError(
        'recovery-required',
        `Private checkpoint missing for participant: ${saved.id}`,
      );
    }
    participants.push({
      kind: 'agent',
      ...common,
      runtime: { ...saved.runtime },
      factory: registered.factory,
    });
  }
  if (!definition.selector)
    throw new RoundtableError('invalid-config', 'Loading requires a versioned selector policy');
  let selector = roundRobin();
  if (definition.selector.id === selector.reference?.id) {
    sameReference(definition.selector, selector.reference);
    compatible(state.selectorCheckpoint, []);
  } else {
    if (!options.registry.resolveSelector)
      throw new RoundtableError('invalid-config', 'Selector policy is not registered');
    const registered = await options.registry.resolveSelector({ ...definition.selector });
    sameReference(registered.reference, definition.selector);
    compatible(state.selectorCheckpoint, registered.checkpointVersions);
    selector = await registered.create(
      state.selectorCheckpoint ? { checkpoint: structuredClone(state.selectorCheckpoint) } : {},
    );
    if (!selector.reference)
      throw new RoundtableError('invalid-config', 'Restored selector has no version reference');
    sameReference(selector.reference, definition.selector);
  }
  return new Conversation(
    {
      conversationId: options.conversationId,
      store: options.store,
      participants,
      selector,
      ...(definition.purpose === null ? {} : { purpose: definition.purpose }),
      limits: {
        maxTurnsPerRun: definition.limits.maxTurnsPerRun,
        ...(definition.limits.timeoutMs === null ? {} : { timeoutMs: definition.limits.timeoutMs }),
        ...(definition.limits.maxModelCallsPerRun === null
          ? {}
          : { maxModelCallsPerRun: definition.limits.maxModelCallsPerRun }),
        ...(definition.limits.maxModelCallsPerConversation === null
          ? {}
          : { maxModelCallsPerConversation: definition.limits.maxModelCallsPerConversation }),
        ...(definition.limits.maxModelCallsPerParticipant === null
          ? {}
          : { maxModelCallsPerParticipant: definition.limits.maxModelCallsPerParticipant }),
      },
      ...(options.pricing ? { pricing: options.pricing } : {}),
      maxConcurrentParticipants: definition.maxConcurrentParticipants,
      recovery: definition.recovery,
      leaseMs: definition.leaseMs,
      onEvent: options.onEvent,
      onEventError: options.onEventError,
    },
    state,
  );
}

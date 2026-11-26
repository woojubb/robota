import type {
  ParticipantExecutionOptions,
  ParticipantLease,
  ParticipantTurn,
  SharedMessage,
  TurnServices,
} from '@robota-sdk/agent-roundtable';

import { acpParticipant } from './acp-participant';
import type { AcpParticipantOptions } from './acp-participant';
import type { FakeAgent } from './fake-agent';

export const CWD = '/work/space';

export function participantFor(
  fake: FakeAgent,
  overrides: Partial<AcpParticipantOptions> = {},
): ReturnType<typeof acpParticipant> {
  return acpParticipant({
    id: 'acp',
    runtime: { id: 'fixture/acp-agent', version: '1' },
    cwd: CWD,
    launcher: fake.launcher,
    ...overrides,
  });
}

export async function openLease(
  fake: FakeAgent,
  overrides: Partial<AcpParticipantOptions> = {},
): Promise<ParticipantLease> {
  return participantFor(fake, overrides).factory.openSession({
    conversationId: 'conversation-1',
    participantId: 'acp',
  });
}

export function message(
  participantId: string,
  content: string,
  id = `${participantId}-${content.length}`,
): SharedMessage {
  return { id, participantId, content, revision: 1, turnId: 't0', groupId: 'g0' };
}

export function turnOf(
  messages: readonly SharedMessage[] = [],
  overrides: Partial<ParticipantTurn> = {},
): ParticipantTurn {
  return {
    conversationId: 'conversation-1',
    participantId: 'acp',
    turnId: 'turn-1',
    attemptId: 'attempt-1',
    groupId: 'group-1',
    context: { baseRevision: 0, messages },
    ...overrides,
  };
}

/** Services that fail on any use, so a participant that touches them fails its test. */
export const forbiddenServices: TurnServices = {
  admitModelCall: async () => {
    throw new Error('an ACP participant must not admit a model call');
  },
  recordUsage: async () => {
    throw new Error('an ACP participant must not record usage');
  },
};

export function executionOptions(
  overrides: Partial<ParticipantExecutionOptions> = {},
): ParticipantExecutionOptions {
  return {
    signal: new AbortController().signal,
    onDelta: async () => {},
    services: forbiddenServices,
    ...overrides,
  };
}

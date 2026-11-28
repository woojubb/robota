import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { sessionParticipant, type SessionHostOptions } from './session-participant';
import type { RecoveryJournal } from './recovery-journal';

afterEach(() => {
  clearRegisteredToolProfiles();
});

function journal(durability: RecoveryJournal['durability']): RecoveryJournal {
  return { durability, append: async () => {}, read: async () => [] };
}

const open = { conversationId: 'c', participantId: 'p' };

function fixture(
  extra: Partial<SessionHostOptions> = {},
  durability: RecoveryJournal['durability'] = 'durable',
) {
  const provider = createScriptedProvider([{ text: 'hi' }]).provider;
  const tool = new FunctionTool(
    { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
    async () => 'ok',
  );
  const host: SessionHostOptions = {
    cwd: process.cwd(),
    hookTypeExecutors: [],
    tools: [tool],
    provider,
    systemMessage: 'Fixture host',
    model: 'test-model',
    autoCompactThreshold: false,
    ...extra,
  };
  const createSessionOptions = vi.fn(async () => host);
  const participant = sessionParticipant({
    id: 'p',
    runtime: { id: 'fixture/session', version: '1' },
    createSessionOptions,
    recovery: { journal: () => journal(durability) },
  });
  return { participant, createSessionOptions };
}

/** A refused open took no lease: the same provider and tools open fine afterwards. */
async function opensAfterRefusal(host: SessionHostOptions): Promise<void> {
  const participant = sessionParticipant({
    id: 'p',
    runtime: { id: 'fixture/session', version: '1' },
    createSessionOptions: async () => host,
  });
  const lease = await participant.factory.openSession(open);
  await lease.release();
}

describe('a reconcilable sessionParticipant', () => {
  it('declares recovery and reconcile only when given a recovery journal', () => {
    const { participant } = fixture();
    expect(participant.factory.recovery).toBe('reconcilable');
    expect(participant.factory.reconcile).toBeTypeOf('function');
    expect(participant.factory.supportsContinuation).toBe(true);
    const plain = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => {
        throw new Error('unused');
      },
    });
    expect(plain.factory.recovery).toBeUndefined();
    expect(plain.factory.reconcile).toBeUndefined();
  });

  it('refuses a recovery journal that is not durable, before it builds any session options', async () => {
    const { participant, createSessionOptions } = fixture({}, 'volatile');
    await expect(participant.factory.openSession(open)).rejects.toMatchObject({
      code: 'journal-not-durable',
    });
    expect(createSessionOptions).not.toHaveBeenCalled();
  });

  it('refuses to reconcile from a journal that is not durable', async () => {
    const { participant } = fixture({}, 'volatile');
    await expect(
      participant.factory.reconcile!({
        ...open,
        turn: {
          ...open,
          turnId: 't',
          attemptId: 'a',
          groupId: 'g',
          context: { baseRevision: 0, messages: [] },
        },
        checkpoint: null,
        reservedCalls: [],
      }),
    ).rejects.toMatchObject({ code: 'journal-not-durable' });
  });

  it('refuses automatic compaction, which writes under an execution id of its own, before the lease', async () => {
    const { participant, createSessionOptions } = fixture({ autoCompactThreshold: undefined });
    await expect(participant.factory.openSession(open)).rejects.toMatchObject({
      code: 'recovery-unsupported',
      message: expect.stringContaining('compaction'),
    });
    const host = await createSessionOptions.mock.results[0]!.value;
    await opensAfterRefusal(host);
  });

  it('refuses hooks, which run before the first journal record and are skipped on resume, before the lease', async () => {
    const { participant, createSessionOptions } = fixture({
      hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'true' }] }] },
    });
    await expect(participant.factory.openSession(open)).rejects.toMatchObject({
      code: 'recovery-unsupported',
      message: expect.stringContaining('Hooks'),
    });
    const host = await createSessionOptions.mock.results[0]!.value;
    await opensAfterRefusal(host);
  });

  it('accepts an empty hook table', async () => {
    const { participant } = fixture({ hooks: { SessionStart: [] } });
    const lease = await participant.factory.openSession(open);
    await lease.release();
  });

  it('is configured with its recovery journal or a plain one, never both', () => {
    expect(() =>
      sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        createSessionOptions: async () => {
          throw new Error('unused');
        },
        journal: () => ({ append: async () => {}, read: async () => [] }),
        recovery: { journal: () => journal('durable') },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });
});

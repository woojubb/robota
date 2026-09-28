import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantFactory,
  type RoundtableRegistry,
} from './index';
import type { ConversationState } from './conversation-state';

function fixture() {
  const factory: ParticipantFactory = {
    modelCalls: 'metered',
    checkpointVersions: ['1'],
    openSession: async () => ({
      session: {
        runTurn: async (_turn, options) => {
          await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
          return { kind: 'speak', content: 'ok' };
        },
        checkpoint: async () => ({ version: '1', data: null }),
      },
      release: async () => {},
    }),
  };
  const participant: AgentParticipant = {
    kind: 'agent',
    id: 'agent',
    runtime: { id: 'fixture', version: '1' },
    factory,
  };
  const registry: RoundtableRegistry = {
    resolveParticipant: vi.fn(async () => ({ reference: participant.runtime, factory })),
  };
  return { participant, registry };
}

describe('the persisted usage ledger is validated on load', () => {
  it.each([
    'duplicate-call-id',
    'unknown-participant',
    'foreign-conversation',
    'mismatched-turn-pair',
    'bad-cost',
    'reserved-with-report-fields',
    'settled-missing-outcome',
  ] as const)('rejects a malformed usage record: %s', async (corruption) => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'corrupt-usage',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const envelope = (await store.load('corrupt-usage'))!;
    const state = envelope.state as unknown as ConversationState;
    const [record] = state.snapshot.usage as unknown as Record<string, unknown>[];
    if (corruption === 'duplicate-call-id') {
      state.snapshot.usage.push(structuredClone(record) as never);
    }
    if (corruption === 'unknown-participant') {
      (record.principal as { id: string }).id = 'nobody';
    }
    if (corruption === 'foreign-conversation') {
      record.conversationId = 'someone-else';
    }
    if (corruption === 'mismatched-turn-pair') {
      record.groupId = null;
    }
    if (corruption === 'bad-cost') {
      record.price = { version: 'v1', cost: { currency: 'USD', minorUnits: '1.5' } };
    }
    if (corruption === 'reserved-with-report-fields') {
      Object.assign(record, { outcome: 'completed', provenance: 'reported', final: true });
    }
    if (corruption === 'settled-missing-outcome') {
      Object.assign(record, { status: 'settled', provenance: 'reported', final: true });
    }
    vi.spyOn(store, 'load').mockResolvedValue(envelope);
    await expect(
      loadRoundtable({ conversationId: 'corrupt-usage', store, registry: f.registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it('accepts a well-formed reserved record and a well-formed settled one', async () => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'well-formed-usage',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const loaded = await loadRoundtable({
      conversationId: 'well-formed-usage',
      store,
      registry: f.registry,
    });
    expect(loaded.snapshot().usage).toHaveLength(1);
    await loaded.dispose();
  });

  it.each([
    ['has no admitted marker', (record: Record<string, unknown>) => delete record.admitted],
    [
      'claims no admission for a completed call',
      (record: Record<string, unknown>) => (record.admitted = false),
    ],
  ])('rejects a stored usage record that %s', async (_label, corrupt) => {
    const f = fixture();
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'corrupt-admitted-marker',
      store,
      participants: [f.participant],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const envelope = (await store.load('corrupt-admitted-marker'))!;
    const state = envelope.state as unknown as ConversationState;
    const [record] = state.snapshot.usage as unknown as Record<string, unknown>[];
    corrupt(record);
    vi.spyOn(store, 'load').mockResolvedValue(envelope);
    await expect(
      loadRoundtable({ conversationId: 'corrupt-admitted-marker', store, registry: f.registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });
});

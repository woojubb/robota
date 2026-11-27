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

describe('a persisted tool effect is validated on load', () => {
  async function saved(conversationId: string) {
    const f = fixture();
    const factory: ParticipantFactory = {
      modelCalls: 'metered',
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: {
          runTurn: async (_turn, options) => {
            await options.services.admitToolEffect({
              callId: 'fx-1',
              toolName: 'search',
              tokens: 5,
            });
            await options.services.recordUsage({
              callId: 'fx-1',
              outcome: 'completed',
              provenance: 'reported',
              final: true,
              tokens: { input: 5, output: 0 },
            });
            return { kind: 'speak', content: 'ok' };
          },
          checkpoint: async () => ({ version: '1', data: null }),
        },
        release: async () => {},
      }),
    };
    const participant: AgentParticipant = { ...f.participant, factory };
    const registry: RoundtableRegistry = {
      resolveParticipant: vi.fn(async () => ({ reference: participant.runtime, factory })),
    };
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId,
      store,
      participants: [participant],
      limits: { maxTurnsPerRun: 1 },
    });
    await room.run();
    await room.dispose();
    const envelope = (await store.load(conversationId))!;
    const state = envelope.state as unknown as ConversationState;
    const [record] = state.snapshot.usage as unknown as Record<string, unknown>[];
    return { store, registry, envelope, record };
  }

  it('round-trips a tool-effect record', async () => {
    const { store, registry } = await saved('tool-effect-round-trip');
    const loaded = await loadRoundtable({
      conversationId: 'tool-effect-round-trip',
      store,
      registry,
    });
    expect(loaded.snapshot().usage).toEqual([
      expect.objectContaining({
        kind: 'tool-effect',
        providerId: 'tool',
        modelId: 'search',
        bound: { inputTokens: 5, maxOutputTokens: 0 },
        status: 'settled',
      }),
    ]);
    await loaded.dispose();
  });

  it.each([
    ['a corrupt kind', (record: Record<string, unknown>) => (record.kind = 'bogus')],
    ['no kind', (record: Record<string, unknown>) => delete record.kind],
    [
      'a tool effect with output tokens',
      (record: Record<string, unknown>) => (record.bound = { inputTokens: 5, maxOutputTokens: 1 }),
    ],
    [
      'a tool effect with a provider',
      (record: Record<string, unknown>) => (record.providerId = 'p'),
    ],
    [
      'an admission-free tool effect',
      (record: Record<string, unknown>) =>
        Object.assign(record, { admitted: false, outcome: 'cache-hit' }),
    ],
  ])('rejects %s', async (_label, corrupt) => {
    const { store, registry, envelope, record } = await saved('tool-effect-corrupt');
    corrupt(record);
    vi.spyOn(store, 'load').mockResolvedValue(envelope);
    await expect(
      loadRoundtable({ conversationId: 'tool-effect-corrupt', store, registry }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });
});

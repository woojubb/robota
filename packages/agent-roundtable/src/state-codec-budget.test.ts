import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantFactory,
  type PricePolicy,
  type RoundtableOptions,
  type RoundtableRegistry,
} from './index';
import type { ConversationState } from './conversation-state';

const usd = (minorUnits: string) => ({ currency: 'USD', minorUnits });

/** Prices a call at one minor unit per token, so a report and a bound cost what they count. */
const perToken: PricePolicy = {
  version: 'per-token',
  cost: (record) =>
    record.status === 'settled' && record.tokens
      ? usd(String((record.tokens.input ?? 0) + (record.tokens.output ?? 0)))
      : null,
  bound: (call) => usd(String(call.bound.inputTokens + call.bound.maxOutputTokens)),
};

function fixture() {
  const factory: ParticipantFactory = {
    modelCalls: 'enforced',
    checkpointVersions: ['1'],
    openSession: async () => ({
      session: {
        runTurn: async (_turn, options) => {
          await options.services.admitModelCall({
            callId: 'c1',
            providerId: 'p',
            modelId: 'm',
            bound: { inputTokens: 10, maxOutputTokens: 5 },
          });
          await options.services.recordUsage({
            callId: 'c1',
            outcome: 'completed',
            provenance: 'reported',
            tokens: { input: 4, output: 3 },
            final: true,
          });
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

async function saved(conversationId: string, extra: Partial<RoundtableOptions>) {
  const f = fixture();
  const store = new MemoryConversationStore();
  const room = createRoundtable({
    conversationId,
    store,
    participants: [f.participant],
    limits: { maxTurnsPerRun: 1 },
    ...extra,
  });
  await room.run();
  await room.dispose();
  return { f, store, room };
}

type Loose = Record<string, unknown>;

async function loadCorrupted(
  conversationId: string,
  extra: Partial<RoundtableOptions>,
  corrupt: (state: ConversationState, record: Loose) => void,
  loadExtra: { pricing?: PricePolicy } = {},
) {
  const { f, store } = await saved(conversationId, extra);
  const envelope = (await store.load(conversationId))!;
  const state = envelope.state as unknown as ConversationState;
  corrupt(state, state.snapshot.usage[0] as unknown as Loose);
  vi.spyOn(store, 'load').mockResolvedValue(envelope);
  return loadRoundtable({ conversationId, store, registry: f.registry, ...loadExtra });
}

describe('the budget fields of the saved conversation round trip', () => {
  it('saves the budget in the definition and the reservation on each record, and loads them back', async () => {
    const { f, store, room } = await saved('budget-roundtrip', { budget: { tokens: 100 } });
    const envelope = await store.load('budget-roundtrip');
    expect(envelope?.state).toMatchObject({
      definition: { budget: { tokens: 100, cost: null, mode: 'strict' } },
      snapshot: {
        usage: [
          {
            bound: { inputTokens: 10, maxOutputTokens: 5 },
            reservation: { tokens: 15, cost: null, provenance: 'declared' },
            reconciled: null,
          },
        ],
      },
    });
    const loaded = await loadRoundtable({
      conversationId: 'budget-roundtrip',
      store,
      registry: f.registry,
    });
    expect(loaded.snapshot().usage).toEqual(room.snapshot().usage);
    await loaded.dispose();
  });

  it('round trips a cost budget with its currency, the reserved cost and the settled price', async () => {
    const { f, store, room } = await saved('cost-roundtrip', {
      budget: { cost: usd('1000') },
      pricing: perToken,
    });
    expect((await store.load('cost-roundtrip'))?.state).toMatchObject({
      definition: { budget: { tokens: null, cost: usd('1000'), mode: 'strict' } },
      snapshot: {
        usage: [{ reservation: { tokens: 15, cost: usd('15') }, price: { cost: usd('7') } }],
      },
    });
    const loaded = await loadRoundtable({
      conversationId: 'cost-roundtrip',
      store,
      registry: f.registry,
      pricing: perToken,
    });
    expect(loaded.snapshot().usage).toEqual(room.snapshot().usage);
    await loaded.dispose();
  });

  it('round trips a conversation with no budget as null fields', async () => {
    const { f, store } = await saved('no-budget-roundtrip', {});
    expect((await store.load('no-budget-roundtrip'))?.state).toMatchObject({
      definition: { budget: null },
      snapshot: { usage: [{ reservation: null, reconciled: null }] },
    });
    const loaded = await loadRoundtable({
      conversationId: 'no-budget-roundtrip',
      store,
      registry: f.registry,
    });
    expect(loaded.snapshot().usage).toHaveLength(1);
    await loaded.dispose();
  });
});

describe('the saved budget is validated on load', () => {
  it.each<[string, (state: ConversationState) => void]>([
    ['a missing budget field', (state) => delete (state.definition as Loose).budget],
    [
      'a budget with no amount',
      (state) => (state.definition.budget = { tokens: null, cost: null, mode: 'strict' }),
    ],
    [
      'a zero token amount',
      (state) => (state.definition.budget = { tokens: 0, cost: null, mode: 'strict' }),
    ],
    [
      'a fractional token amount',
      (state) => (state.definition.budget = { tokens: 1.5, cost: null, mode: 'strict' }),
    ],
    [
      'an unknown mode',
      (state) => (state.definition.budget = { tokens: 5, cost: null, mode: 'loose' as never }),
    ],
    [
      'an extra budget key',
      (state) =>
        (state.definition.budget = { tokens: 5, cost: null, mode: 'strict', extra: 1 } as never),
    ],
    [
      'a cost amount with no pricing version',
      (state) => (state.definition.budget = { tokens: null, cost: usd('5'), mode: 'strict' }),
    ],
  ])('rejects %s', async (_label, corrupt) => {
    await expect(
      loadCorrupted('corrupt-budget', { budget: { tokens: 100 } }, corrupt),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it('rejects a zero cost amount even with pricing', async () => {
    await expect(
      loadCorrupted(
        'corrupt-zero-cost',
        { budget: { cost: usd('1000') }, pricing: perToken },
        (state) => (state.definition.budget = { tokens: null, cost: usd('0'), mode: 'strict' }),
        { pricing: perToken },
      ),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });
});

describe('the reservation fields of a saved record are validated on load', () => {
  it.each<[string, (record: Loose) => void]>([
    ['no reservation field', (record) => delete record.reservation],
    ['no reconciled field', (record) => delete record.reconciled],
    ['an admitted record with a null reservation', (record) => (record.reservation = null)],
    [
      'a reservation with an unknown provenance',
      (record) => (record.reservation = { tokens: 15, cost: null, provenance: 'guessed' }),
    ],
    [
      'a reservation with negative tokens',
      (record) => (record.reservation = { tokens: -1, cost: null, provenance: 'declared' }),
    ],
    [
      'a reservation with a cost under a token-only budget',
      (record) => (record.reservation = { tokens: 15, cost: usd('1'), provenance: 'declared' }),
    ],
    ['a declared reservation with no stored bound', (record) => delete record.bound],
    [
      'an estimated reservation under a strict budget',
      (record) => (record.reservation = { tokens: 15, cost: null, provenance: 'estimated' }),
    ],
    [
      'a reservation with an extra key',
      (record) =>
        (record.reservation = { tokens: 15, cost: null, provenance: 'declared', extra: true }),
    ],
    [
      'a reconciled amount with fractional tokens',
      (record) => (record.reconciled = { tokens: 0.5, cost: null }),
    ],
    [
      'a reconciled amount with a cost',
      (record) => (record.reconciled = { tokens: 1, cost: usd('1') }),
    ],
    ['an invalid bound', (record) => (record.bound = { inputTokens: -1, maxOutputTokens: 0 })],
    [
      'a bound with an extra key',
      (record) => (record.bound = { inputTokens: 1, maxOutputTokens: 0, x: 1 }),
    ],
  ])('rejects %s', async (_label, corrupt) => {
    await expect(
      loadCorrupted('corrupt-reservation', { budget: { tokens: 100 } }, (_state, record) =>
        corrupt(record),
      ),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it.each<[string, (record: Loose) => void]>([
    [
      'a reservation under no budget',
      (record) => (record.reservation = { tokens: 1, cost: null, provenance: 'declared' }),
    ],
    [
      'a reconciled amount under no budget',
      (record) => (record.reconciled = { tokens: 1, cost: null }),
    ],
  ])('rejects %s', async (_label, corrupt) => {
    await expect(
      loadCorrupted('corrupt-no-budget', {}, (_state, record) => corrupt(record)),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it.each<[string, (record: Loose) => void]>([
    [
      'a price in another currency',
      (record) =>
        (record.price = { version: 'per-token', cost: { currency: 'EUR', minorUnits: '7' } }),
    ],
    ['a negative price', (record) => (record.price = { version: 'per-token', cost: usd('-7') })],
    [
      'a reservation with no cost',
      (record) => (record.reservation = { tokens: 15, cost: null, provenance: 'declared' }),
    ],
    [
      'a reservation in another currency',
      (record) =>
        (record.reservation = {
          tokens: 15,
          cost: { currency: 'EUR', minorUnits: '15' },
          provenance: 'declared',
        }),
    ],
    [
      'a reconciled amount with no cost',
      (record) => (record.reconciled = { tokens: 1, cost: null }),
    ],
  ])('rejects %s under a cost budget', async (_label, corrupt) => {
    await expect(
      loadCorrupted(
        'corrupt-cost',
        { budget: { cost: usd('1000') }, pricing: perToken },
        (_state, record) => corrupt(record),
        { pricing: perToken },
      ),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it('accepts a well-formed reserved, settled and reconciled record', async () => {
    const loaded = await loadCorrupted(
      'well-formed-budget',
      { budget: { tokens: 100 } },
      (_state, record) => {
        record.reconciled = { tokens: 2, cost: null };
      },
    );
    expect(loaded.snapshot().usage[0]).toMatchObject({ reconciled: { tokens: 2, cost: null } });
    await loaded.dispose();
  });
});

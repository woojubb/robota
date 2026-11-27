import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantFactory,
  type PricePolicy,
  type RoundtableRegistry,
} from './index';
import type { ConversationState } from './conversation-state';

const usd = (minorUnits: string) => ({ currency: 'USD', minorUnits });

const perToken: PricePolicy = {
  version: 'per-token',
  cost: (record) =>
    record.status === 'settled' && record.tokens
      ? usd(String((record.tokens.input ?? 0) + (record.tokens.output ?? 0)))
      : null,
  bound: (call) => usd(String(call.bound.inputTokens + call.bound.maxOutputTokens)),
};

/** Saves a conversation whose one admitted call was never reported, so its record is still reserved. */
async function saved(conversationId: string) {
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
  const store = new MemoryConversationStore();
  const room = createRoundtable({
    conversationId,
    store,
    participants: [participant],
    pricing: perToken,
    budget: { tokens: 100, cost: usd('100') },
    limits: { maxTurnsPerRun: 1 },
  });
  await room.run();
  await room.dispose();
  const envelope = (await store.load(conversationId))!;
  const state = envelope.state as unknown as ConversationState;
  const [record] = state.snapshot.usage as unknown as Record<string, unknown>[];
  return { store, registry, envelope, record };
}

function refund(record: Record<string, unknown>): void {
  Object.assign(record, {
    status: 'settled',
    outcome: 'not-dispatched',
    provenance: 'reported',
    final: true,
    price: { version: 'per-token', cost: null },
  });
}

async function load(
  fixture: Awaited<ReturnType<typeof saved>>,
  conversationId: string,
  mutate: (record: Record<string, unknown>) => void,
) {
  mutate(fixture.record);
  vi.spyOn(fixture.store, 'load').mockResolvedValue(fixture.envelope);
  return loadRoundtable({
    conversationId,
    store: fixture.store,
    registry: fixture.registry,
    pricing: perToken,
  });
}

describe('a persisted not-dispatched record is validated on load', () => {
  it('round-trips a refunded call, keeping its reservation and counting it as a call', async () => {
    const loaded = await load(await saved('refund-round-trip'), 'refund-round-trip', refund);
    expect(loaded.snapshot().usage).toEqual([
      expect.objectContaining({
        status: 'settled',
        outcome: 'not-dispatched',
        final: true,
        reservation: { tokens: 15, cost: usd('15'), provenance: 'declared' },
      }),
    ]);
    await loaded.dispose();
  });

  it.each([
    ['not final', (record: Record<string, unknown>) => (record.final = false)],
    ['reported with tokens', (record: Record<string, unknown>) => (record.tokens = { input: 1 })],
    ['carrying a raw payload', (record: Record<string, unknown>) => (record.raw = { x: 1 })],
    [
      'with unknown provenance',
      (record: Record<string, unknown>) => (record.provenance = 'unknown'),
    ],
    [
      'priced',
      (record: Record<string, unknown>) =>
        (record.price = { version: 'per-token', cost: usd('1') }),
    ],
    [
      'reconciled by the host',
      (record: Record<string, unknown>) => (record.reconciled = { tokens: 1, cost: usd('1') }),
    ],
    [
      'never admitted',
      (record: Record<string, unknown>) =>
        Object.assign(record, { admitted: false, reservation: null }),
    ],
    ['an unknown outcome', (record: Record<string, unknown>) => (record.outcome = 'refunded')],
  ])('rejects a refunded record that is %s', async (_label, corrupt) => {
    const fixture = await saved('refund-corrupt');
    await expect(
      load(fixture, 'refund-corrupt', (record) => {
        refund(record);
        corrupt(record);
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
  });

  it('keeps the outcome out of what a participant can report', async () => {
    const factory: ParticipantFactory = {
      modelCalls: 'metered',
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: {
          runTurn: async (_turn, options) => {
            await options.services.admitModelCall({ callId: 'c1', providerId: 'p', modelId: 'm' });
            await options.services.recordUsage({
              callId: 'c1',
              outcome: 'not-dispatched' as never,
              provenance: 'reported',
              final: true,
            });
            return { kind: 'speak', content: 'ok' };
          },
          checkpoint: async () => ({ version: '1', data: null }),
        },
        release: async () => {},
      }),
    };
    const room = createRoundtable({
      conversationId: 'forged-refund',
      store: new MemoryConversationStore(),
      participants: [
        { kind: 'agent', id: 'agent', runtime: { id: 'fixture', version: '1' }, factory },
      ],
      limits: { maxTurnsPerRun: 1, maxModelCallsPerRun: 1 },
    });
    const result = await room.run();
    expect(result.status).toBe('failed');
    expect(room.snapshot().usage[0]).toMatchObject({ status: 'reserved' });
    await room.dispose();
  });
});

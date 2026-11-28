import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { TScriptedTurn } from '@robota-sdk/agent-core/testing';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import {
  createRoundtable,
  loadRoundtable,
  type Roundtable,
  type RoundtableOptions,
  type TurnSelector,
} from '@robota-sdk/agent-roundtable';
import { sessionParticipant } from './session-participant';
import type { RecoveryJournalEntry } from './recovery-journal';
import { Generation, LEASE_MS, runUntilKilled, World, type KillGate } from './recovery-drill';

afterEach(() => {
  clearRegisteredToolProfiles();
});

/** A provider whose usage is attested as complete, the way a real adapter marks what it reports. */
function attested(turns: readonly TScriptedTurn[]): { provider: IAIProvider; calls: () => number } {
  const scripted = createScriptedProvider(turns);
  return {
    calls: () => scripted.requests.length,
    provider: {
      ...scripted.provider,
      chat: async (messages, options) => {
        const reply = await scripted.provider.chat(messages, options);
        return { ...reply, metadata: { ...reply.metadata, usageProvenance: 'complete' } };
      },
    },
  };
}

const pay: TScriptedTurn = { toolCalls: [{ name: 'pay', args: {} }] };
const done: TScriptedTurn = { text: 'done' };

function solo(gen: Generation, turns: readonly TScriptedTurn[]) {
  const provider = attested(turns);
  const tool = new FunctionTool(
    { name: 'pay', description: 'Pays', parameters: { type: 'object', properties: {} } },
    async () => {
      gen.world.effects.set('pay', (gen.world.effects.get('pay') ?? 0) + 1);
      return 'paid';
    },
  );
  const participant = sessionParticipant({
    id: 'solo',
    runtime: { id: 'drill/session', version: '1' },
    enforcement: {
      providerAttempts: 1,
      requestOverheadTokens: 0,
      paidTools: { pay: { tokens: 0 } },
    },
    recovery: { journal: (scope) => gen.journal(scope) },
    createSessionOptions: async () => ({
      cwd: process.cwd(),
      hookTypeExecutors: [],
      tools: [tool],
      provider: provider.provider,
      systemMessage: 'Drill host',
      model: 'test-model',
      autoCompactThreshold: false,
      maxOutputTokens: 64,
      permissions: { allow: ['pay'], deny: [], ask: [] },
    }),
  });
  return { participant, provider };
}

const selector: TurnSelector = {
  reference: { id: 'drill/once', version: '1' },
  modelCalls: 'none',
  recovery: 'reconcilable',
  idempotentDecision: true,
  select: ({ turns }) =>
    turns.length >= 1
      ? { kind: 'finish', reason: 'done' }
      : { kind: 'speak', participantId: 'solo' },
};

const roomOptions = (
  gen: Generation,
  participant: ReturnType<typeof solo>['participant'],
): RoundtableOptions => ({
  conversationId: 'room',
  store: gen.store,
  recovery: 'durable',
  leaseMs: LEASE_MS,
  selector,
  participants: [participant],
  limits: { maxTurnsPerRun: 4 },
  budget: { tokens: 100_000, mode: 'strict' },
});

async function restart(world: World, turns: readonly TScriptedTurn[], gate?: KillGate) {
  const gen = world.generation(gate);
  const { participant, provider } = solo(gen, turns);
  const room = await loadRoundtable({
    conversationId: 'room',
    store: gen.store,
    registry: {
      resolveParticipant: (reference) => ({ reference, factory: participant.factory }),
      resolveSelector: (reference) => ({ reference, create: () => selector }),
    },
  });
  return { room, provider, gen };
}

/** Kills the first process where `gate` says, then restarts onto a provider with only `rest` left to say. */
async function killed(gate: KillGate, rest: readonly TScriptedTurn[]) {
  const world = new World();
  const gen = world.generation(gate);
  const { participant } = solo(gen, [pay, done]);
  const room = createRoundtable(roomOptions(gen, participant));
  expect(await runUntilKilled(gen, room)).toEqual({ killed: true });
  return { world, ...(await restart(world, rest)) };
}

/** Restarts onto a provider that never answers, killed once it has journaled its next request. */
async function restartKilled(world: World, rest: readonly TScriptedTurn[], gate: KillGate) {
  const next = await restart(world, rest, gate);
  expect(await runUntilKilled(next.gen, next.room)).toEqual({ killed: true });
  return next;
}

/** Kills at the `nth` (from zero) journaled record of `kind`. */
function atRecord(kind: string, nth: number, when: 'before' | 'after'): KillGate {
  let seen = 0;
  return (entry: RecoveryJournalEntry) => {
    if (entry.kind !== 'record' || entry.record.kind !== kind) return undefined;
    return seen++ === nth ? when : undefined;
  };
}

function usage(room: Roundtable) {
  return room.snapshot().usage;
}

function expectFinished(room: Roundtable, world: World, effects: number) {
  expect(room.snapshot().messages.map((message) => message.content)).toEqual(['done']);
  expect(world.effects.get('pay') ?? 0).toBe(effects);
  for (const record of usage(room)) expect(record.status).toBe('settled');
}

describe('a Session participant recovered after its process was killed', () => {
  it('re-admits a paid effect under a new id after recovery refunded its admission', async () => {
    // Admission committed, the effect's start record never journaled: the likeliest tool kill point.
    const { world, room } = await killed(atRecord('tool-effect-start', 0, 'before'), [done]);
    const result = await room.run();
    expect(result).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 1);
    const effects = usage(room).filter((record) => record.kind === 'tool-effect');
    expect(effects).toHaveLength(2);
    expect(new Set(effects.map((record) => record.callId)).size).toBe(2);
    expect(effects.map((record) => record.status === 'settled' && record.outcome).sort()).toEqual([
      'completed',
      'not-dispatched',
    ]);
    await room.dispose();
  });

  it('asks the provider again, under a new call id, after a request that got no response', async () => {
    // The second model request is journaled, the provider never answered.
    const { world, room, provider } = await killed(atRecord('model-request', 1, 'after'), [done]);
    const before = usage(room).filter((record) => record.kind === 'model');
    expect(before.map((record) => record.status)).toEqual(['settled', 'reserved']);
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 1);
    expect(provider.calls()).toBe(1);
    const models = usage(room).filter((record) => record.kind === 'model');
    expect(models).toHaveLength(3);
    expect(new Set(models.map((record) => record.callId)).size).toBe(3);
    await room.dispose();
  });

  it.each([2, 3])(
    'recovers after the restart is itself killed with its new request unanswered, %i times over',
    async (kills) => {
      // Each restart journals a new request and dies before the provider answers it.
      const { world } = await killed(atRecord('model-request', 1, 'after'), [done]);
      for (let n = 1; n < kills; n++)
        await restartKilled(world, [done], atRecord('model-request', 0, 'after'));
      const last = await restart(world, [done]);
      expect(await last.room.run()).toMatchObject({ status: 'completed' });
      expectFinished(last.room, world, 1);
      expect(last.provider.calls()).toBe(1);
      const models = usage(last.room).filter((record) => record.kind === 'model');
      expect(new Set(models.map((record) => record.callId)).size).toBe(models.length);
      await last.room.dispose();
    },
  );

  it('completes from a journaled final response without calling the provider', async () => {
    const { world, room, provider } = await killed(atRecord('model-response', 1, 'after'), []);
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 1);
    expect(provider.calls()).toBe(0);
    await room.dispose();
  });

  it('runs a turn again when nothing of it reached the journal but its binding', async () => {
    const { world, room } = await killed(atRecord('model-request', 0, 'before'), [pay, done]);
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 1);
    await room.dispose();
  });

  it('parks an effect that started without a result and never runs it again until the host settles it', async () => {
    const { world, room, provider } = await killed(atRecord('tool-effect-start', 0, 'after'), [
      done,
    ]);
    const parked = await room.run();
    if (parked.status !== 'waiting') throw new Error(`Expected a wait, got ${parked.status}`);
    expect(parked.requests).toHaveLength(1);
    expect(parked.requests[0]).toMatchObject({ kind: 'reconciliation' });
    expect(world.effects.get('pay') ?? 0).toBe(0);
    expect(provider.calls()).toBe(0);
    await room.resume({
      requestId: parked.requests[0]!.id,
      responseId: 'host-settles',
      expectedRevision: room.snapshot().revision,
      response: { kind: 'reconciliation', data: { result: 'paid by the host' } },
    });
    expect(await room.run()).toMatchObject({ status: 'completed' });
    // The effect never ran in either process; the host's word is its result.
    expectFinished(room, world, 0);
    expect(provider.calls()).toBe(1);
    await room.dispose();
  });

  it('settles an effect the host says failed, so the model sees a failed call and nothing runs again', async () => {
    const { world, room, provider } = await killed(atRecord('tool-effect-start', 0, 'after'), [
      done,
    ]);
    const parked = await room.run();
    if (parked.status !== 'waiting') throw new Error(`Expected a wait, got ${parked.status}`);
    await room.resume({
      requestId: parked.requests[0]!.id,
      responseId: 'host-settles',
      expectedRevision: room.snapshot().revision,
      response: { kind: 'reconciliation', data: { error: 'The payment was declined' } },
    });
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 0);
    expect(provider.calls()).toBe(1);
    await room.dispose();
  });

  it('binds the attempt to its session before any record of it passes through', async () => {
    const { world, room } = await killed(atRecord('model-request', 0, 'before'), [pay, done]);
    const [entries] = [...world.journals.values()];
    expect(entries!.map((entry) => entry.kind)).toEqual(['binding']);
    expect(entries![0]).toMatchObject({
      kind: 'binding',
      sessionId: expect.any(String),
      executionId: expect.any(String),
      cwd: process.cwd(),
    });
    await room.dispose();
  });

  it('answers a settled turn from the journal when its reply was lost', async () => {
    const { world, room, provider } = await killed(
      (entry) => (entry.kind === 'turn-end' ? 'after' : undefined),
      [],
    );
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expectFinished(room, world, 1);
    expect(provider.calls()).toBe(0);
    await room.dispose();
  });
});

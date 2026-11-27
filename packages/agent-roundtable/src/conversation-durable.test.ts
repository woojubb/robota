import { describe, expect, it, vi } from 'vitest';
import * as api from './index';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  roundRobin,
  type ConversationStore,
  type ParticipantFactory,
  type RoundtableOptions,
} from './index';
import type { ConversationState } from './conversation-state';
import {
  createIn,
  finish,
  finishingSelector,
  loadIn,
  runUntilKilled,
  World,
  type KillPlan,
  type Scenario,
  type Tamper,
} from './durable-harness';

// Commit indexes of the first turn of the sequential scenario, counting creation as 0.
const AFTER_SELECTING = 1;
const AFTER_MEMBER_RUNNING = 4;
const AFTER_MODEL_RESERVED = 5;
const AFTER_EFFECT_RESERVED = 7;
const AFTER_SETTLED = 9;

const sequential: Scenario = {
  conversationId: 'room',
  agents: ['alice', 'bob'],
  selector: finishingSelector(2, (turns) => ({
    kind: 'speak',
    participantId: turns % 2 === 0 ? 'alice' : 'bob',
  })),
};

async function killedAt(scenario: Scenario, plan: KillPlan): Promise<World> {
  const world = new World();
  const gen = world.generation(plan);
  const out = await runUntilKilled(gen, createIn(scenario, gen));
  expect(out.killed).toBe(true);
  return world;
}

const afterCommit = (n: number): KillPlan => ({ at: 'commit', n, replyLost: true });

async function stored(world: World): Promise<{ revision: number; state: ConversationState }> {
  const envelope = (await world.disk.load('room'))!;
  return { revision: envelope.revision, state: envelope.state as unknown as ConversationState };
}

/** A restart that reconciles with an answer the journal would never give is refused and changes nothing. */
async function refusedWith(tamper: Tamper, after: number, message: RegExp): Promise<void> {
  const world = await killedAt(sequential, afterCommit(after));
  const before = await stored(world);
  const gen = world.generation();
  const room = await loadIn({ ...sequential, tamper }, gen);
  await expect(room.run()).rejects.toMatchObject({
    code: 'recovery-required',
    message: expect.stringMatching(message),
  });
  expect(await stored(world)).toEqual(before);
}

describe('durable declarations are checked before any work', () => {
  function spies() {
    const world = new World();
    const gen = world.generation();
    const create = vi.spyOn(gen.store, 'create');
    const open = vi.fn();
    return { gen, create, open };
  }
  const base = (store: ConversationStore, factory: ParticipantFactory): RoundtableOptions => ({
    conversationId: 'room',
    store,
    recovery: 'durable',
    selector: roundRobin(),
    participants: [{ kind: 'agent', id: 'a', runtime: { id: 'a', version: '1' }, factory }],
    limits: { maxTurnsPerRun: 1 },
  });
  const goodFactory = (open: ParticipantFactory['openSession']): ParticipantFactory => ({
    recovery: 'reconcilable',
    supportsContinuation: true,
    checkpointVersions: ['1'],
    reconcile: () => ({ kind: 'not-started', calls: [] }),
    openSession: open,
  });

  it('accepts a durable store with reconcilable factories and the built-in selector', () => {
    const { gen, open } = spies();
    expect(() => createRoundtable(base(gen.store, goodFactory(open)))).not.toThrow();
  });

  it('refuses a conversation without a store, or with one that is not durable', () => {
    const { open } = spies();
    const { store: _omitted, ...withoutStore } = base(
      new MemoryConversationStore(),
      goodFactory(open),
    );
    expect(() => createRoundtable(withoutStore)).toThrow(/store that declares durability/);
    expect(() => createRoundtable(base(new MemoryConversationStore(), goodFactory(open)))).toThrow(
      expect.objectContaining({ code: 'invalid-config' }),
    );
  });

  it.each([
    ['a factory that is not reconcilable', { recovery: 'none' as const }],
    ['a factory without reconcile', { reconcile: undefined }],
    ['a factory without continuation', { supportsContinuation: false }],
    ['a factory without checkpoint versions', { checkpointVersions: [] }],
  ])('refuses %s before touching the store or opening a session', (_name, override) => {
    const { gen, create, open } = spies();
    expect(() => createRoundtable(base(gen.store, { ...goodFactory(open), ...override }))).toThrow(
      expect.objectContaining({ code: 'invalid-config' }),
    );
    expect(create).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['a selector that is not reconcilable', { recovery: 'none' as const }],
    ['a selector without a version reference', { reference: undefined }],
  ])('refuses %s', (_name, override) => {
    const { gen, create, open } = spies();
    expect(() =>
      createRoundtable({
        ...base(gen.store, goodFactory(open)),
        selector: { ...roundRobin(), ...override },
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses a saved durable conversation loaded with a store that is not durable', async () => {
    const world = await killedAt(sequential, afterCommit(AFTER_SELECTING));
    const resolveParticipant = vi.fn();
    await expect(
      loadRoundtable({
        conversationId: 'room',
        store: world.disk,
        registry: { resolveParticipant, resolveSelector: vi.fn() },
      }),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(resolveParticipant).not.toHaveBeenCalled();
  });

  it('declares the built-in round-robin selector recoverable and idempotent', () => {
    const selector = roundRobin();
    expect(selector).toMatchObject({ recovery: 'reconcilable', idempotentDecision: true });
  });

  it('keeps the settlement primitive internal', () => {
    expect('applyCallSettlement' in api).toBe(false);
  });
});

describe('reconciling a selection', () => {
  it('asks an idempotent selector again and goes on', async () => {
    const world = await killedAt(sequential, afterCommit(AFTER_SELECTING));
    expect((await stored(world)).state.phase.kind).toBe('selecting');
    const gen = world.generation();
    const room = await loadIn(sequential, gen);
    const out = await runUntilKilled(gen, room);
    expect(out).toMatchObject({ killed: false, result: { status: 'completed' } });
    expect(room.snapshot().messages).toHaveLength(2);
  });

  it('requires the host when the selector cannot be asked again', async () => {
    const stubborn: Scenario = {
      ...sequential,
      selector: { ...sequential.selector!, idempotentDecision: false },
    };
    const world = await killedAt(stubborn, afterCommit(AFTER_SELECTING));
    const before = await stored(world);
    const gen = world.generation();
    const room = await loadIn(stubborn, gen);
    await expect(room.run()).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await stored(world)).toEqual(before);
  });
});

describe('reconciling a member', () => {
  it('refunds a call proven never dispatched and runs the turn from the start', async () => {
    const world = await killedAt(sequential, afterCommit(AFTER_MODEL_RESERVED));
    expect((await stored(world)).state.snapshot.usage[0]).toMatchObject({ status: 'reserved' });
    const gen = world.generation();
    const room = await loadIn(sequential, gen);
    const out = await runUntilKilled(gen, room);
    expect(out).toMatchObject({ killed: false, result: { status: 'completed' } });
    const refunded = room
      .snapshot()
      .usage.filter((record) => record.status === 'settled' && record.outcome === 'not-dispatched');
    expect(refunded).toHaveLength(1);
    expect(refunded[0]).toMatchObject({ final: true, provenance: 'reported' });
    expect(refunded[0]).not.toHaveProperty('tokens');
    // The refunded call still counts, so the turn's retry is a new call under a new attempt.
    expect(room.snapshot().usage.filter((record) => record.kind === 'model')).toHaveLength(3);
  });

  it('refunds an effect proven never started and runs it once', async () => {
    const world = await killedAt(sequential, afterCommit(AFTER_EFFECT_RESERVED));
    const gen = world.generation();
    const room = await loadIn(sequential, gen);
    const out = await runUntilKilled(gen, room);
    expect(out).toMatchObject({ killed: false, result: { status: 'completed' } });
    expect([...world.effects.values()]).toEqual([1, 1]);
    const effects = room.snapshot().usage.filter((record) => record.kind === 'tool-effect');
    expect(effects.map((record) => record.status === 'settled' && record.outcome).sort()).toEqual([
      'completed',
      'completed',
      'not-dispatched',
    ]);
  });

  it('parks an effect that started without a result and never runs it until the host settles it', async () => {
    // The sixth journal append is the first turn's effect result; the effect itself already ran.
    const world = await killedAt(sequential, { at: 'append', k: 5, written: false });
    const ran = new Map(world.effects);
    expect([...ran.values()]).toEqual([1]);
    const gen = world.generation();
    const room = await loadIn(sequential, gen);
    const first = await room.run();
    expect(first.status).toBe('waiting');
    if (first.status !== 'waiting') return;
    expect(first.requests).toHaveLength(1);
    expect(first.requests[0]).toMatchObject({ kind: 'reconciliation' });
    // The effect was not attempted again, and its call keeps its bound counted as unknown.
    expect(world.effects).toEqual(ran);
    const effect = room.snapshot().usage.find((record) => record.kind === 'tool-effect');
    expect(effect).toMatchObject({ status: 'settled', provenance: 'unknown', final: true });
    // Another run changes nothing while the host has not settled it.
    expect((await room.run()).status).toBe('waiting');
    expect(world.effects).toEqual(ran);
    const done = await finish(world, room, first);
    expect(done.status).toBe('completed');
    expect([...world.effects.values()]).toEqual([1, 1]);
  });

  it('fails the conversation for a member that failed without a terminal result', async () => {
    const failing: Scenario = {
      ...sequential,
      failure: (participantId) => participantId === 'bob',
    };
    const reference = new World();
    const probe = reference.generation();
    await runUntilKilled(probe, createIn(failing, probe));
    // The last commit is the terminal result; the one before it records the failed member.
    const world = await killedAt(failing, afterCommit(probe.writes - 2));
    expect((await stored(world)).state.terminal).toBeNull();
    const gen = world.generation();
    const room = await loadIn(failing, gen);
    expect(await room.run()).toMatchObject({ status: 'failed', message: 'scripted failure' });
  });

  it('refuses an answer that leaves a reserved call unanswered', async () => {
    await refusedWith(
      (answer) => ({ ...answer, calls: [] }),
      AFTER_MODEL_RESERVED,
      /every reserved call/,
    );
  });

  it('refuses an answer that names a call twice', async () => {
    await refusedWith(
      (answer) => ({ ...answer, calls: [...answer.calls, ...answer.calls] }),
      AFTER_MODEL_RESERVED,
      /every reserved call/,
    );
  });

  it('refuses a turn that never started with a call that may have been dispatched', async () => {
    await refusedWith(
      (answer) => ({
        ...answer,
        calls: answer.calls.map(({ callId }) => ({ kind: 'uncertain' as const, callId })),
      }),
      AFTER_MODEL_RESERVED,
      /never started/,
    );
  });

  it('refuses a throwing reconcile', async () => {
    await refusedWith(
      () => {
        throw new Error('journal unreadable');
      },
      AFTER_MEMBER_RUNNING,
      /journal unreadable/,
    );
  });

  it('refuses a checkpoint no version of the factory can restore', async () => {
    await refusedWith(
      (answer) => ({
        kind: 'resume',
        checkpoint: { version: 'future', data: null },
        calls: answer.calls,
      }),
      AFTER_MEMBER_RUNNING,
      /checkpoint/,
    );
  });

  it('refuses an uncertain answer whose requests are not reconciliations', async () => {
    await refusedWith(
      (answer) => ({
        kind: 'uncertain',
        checkpoint: { version: '1', data: { turns: 0 } },
        requests: [{ id: 'ask', kind: 'input', reason: 'who', participantId: 'person' }],
        calls: answer.calls,
      }),
      AFTER_MEMBER_RUNNING,
      /reconciliation/,
    );
  });

  it('refuses an answer that contradicts a settled result', async () => {
    await refusedWith(
      (answer) =>
        answer.kind === 'settled'
          ? { ...answer, outcome: { kind: 'speak', content: 'something else' } }
          : answer,
      AFTER_SETTLED,
      /contradicted/,
    );
  });
});

describe('durable conversations that complete without interruption', () => {
  it('runs with the built-in round-robin selector and writes nothing recovery needs', async () => {
    const world = new World();
    const gen = world.generation();
    const room = createIn(
      { conversationId: 'room', agents: ['alice', 'bob'], maxTurnsPerRun: 2 },
      gen,
    );
    expect(await room.run()).toMatchObject({ status: 'limited', reason: 'turns' });
    expect(room.snapshot().messages.map((m) => m.participantId)).toEqual(['alice', 'bob']);
  });
});

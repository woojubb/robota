import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationState } from './conversation-state';
import type {
  AgentParticipant,
  Roundtable,
  RunResult,
  TurnSelector,
  TurnServices,
  UsageReport,
} from './types';
import {
  finish,
  finishingSelector,
  loadIn,
  scriptedAgent,
  World,
  type Generation,
  type JournalEntry,
  type Scenario,
} from './durable-harness';
import { createRoundtable } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

const solo: Scenario = {
  conversationId: 'room',
  agents: ['alice'],
  selector: finishingSelector(1, () => ({ kind: 'speak', participantId: 'alice' })),
};

const TIMEOUT_MS = 7_777_777;

function build(
  gen: Generation,
  options: { agent?: AgentParticipant; selector?: TurnSelector; timeoutMs?: number } = {},
): Roundtable {
  return createRoundtable({
    conversationId: 'room',
    store: gen.store,
    recovery: 'durable',
    leaseMs: 100,
    selector: options.selector ?? solo.selector!,
    participants: [options.agent ?? scriptedAgent(gen, 'alice')],
    limits: {
      maxTurnsPerRun: 8,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    },
    budget: { tokens: 100_000, mode: 'strict' },
  });
}

const stored = async (world: World): Promise<ConversationState> =>
  (await world.disk.load('room'))!.state as unknown as ConversationState;

const members = (state: ConversationState) =>
  state.phase.kind === 'group' ? state.phase.members : [];

const reservedCalls = (state: ConversationState) =>
  state.snapshot.usage.filter((record) => record.status === 'reserved');

/** What a process that was never stopped produces. */
async function uninterrupted(): Promise<{ content: string; effects: Record<string, number> }> {
  const world = new World();
  const room = build(world.generation());
  expect(await room.run()).toMatchObject({ status: 'completed' });
  const content = room.snapshot().messages[0]!.content;
  await room.dispose();
  return { content, effects: Object.fromEntries(world.effects) };
}

type Stop = 'cancel' | 'dispose' | 'time';

/**
 * Stops the first run in-process, the moment the journal holds the entry, the way a host would.
 * The runtime honours the stop at its next checkpoint, so the attempt is interrupted wherever it was.
 */
async function stoppedAt(
  stop: Stop,
  at: (entry: JournalEntry) => boolean,
): Promise<{ world: World; room: Roundtable; result: RunResult }> {
  const world = new World();
  const gen = world.generation();
  const abort = new AbortController();
  const room = build(gen, stop === 'time' ? { timeoutMs: TIMEOUT_MS } : {});
  let expire: (() => void) | undefined;
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: () => void,
    ms?: number,
    ...rest: unknown[]
  ) => {
    if (ms === TIMEOUT_MS) expire = handler;
    return realSetTimeout(handler, ms === TIMEOUT_MS ? 0x7fffffff : ms, ...rest);
  }) as typeof setTimeout);
  gen.onAppend = (entry) => {
    if (!at(entry)) return;
    gen.onAppend = undefined;
    if (stop === 'cancel') abort.abort();
    else if (stop === 'dispose') void room.dispose().catch(() => {});
    else expire?.();
  };
  const result = await room.run({ signal: abort.signal });
  vi.restoreAllMocks();
  return { world, room, result };
}

const next = (world: World, room: Roundtable, stop: Stop): Promise<Roundtable> =>
  stop === 'dispose' ? loadIn(solo, world.generation()) : Promise.resolve(room);

describe('a durable conversation reconciles an in-process interruption through its journal', () => {
  it.each(['cancel', 'dispose', 'time'] as const)(
    'does not run a completed effect again after a %s that came once the effect had a result',
    async (stop) => {
      const reference = await uninterrupted();
      const { world, room, result } = await stoppedAt(stop, (entry) => entry.t === 'effect-result');
      expect(result).toMatchObject(
        stop === 'time' ? { status: 'limited', reason: 'time' } : { status: 'cancelled' },
      );
      // The member stays as a process stop would have left it, under its own attempt, for its journal.
      const state = await stored(world);
      expect(members(state)).toMatchObject([{ status: 'running' }]);
      expect(reservedCalls(state).length).toBeGreaterThan(0);
      const attempt = members(state)[0]!.turn.attemptId;
      expect(state.snapshot.usage.every((record) => record.attemptId === attempt)).toBe(true);

      const resumed = await next(world, room, stop);
      expect(await resumed.run()).toMatchObject({ status: 'completed' });
      expect(resumed.snapshot().messages[0]!.content).toBe(reference.content);
      expect(Object.fromEntries(world.effects)).toEqual(reference.effects);
      expect(reservedCalls(await stored(world))).toEqual([]);
      await resumed.dispose();
    },
  );

  it.each(['cancel', 'dispose'] as const)(
    'parks an effect that started without a result after a %s, and does not start it again unasked',
    async (stop) => {
      const reference = await uninterrupted();
      const { world, room } = await stoppedAt(stop, (entry) => entry.t === 'effect-start');
      const resumed = await next(world, room, stop);
      const parked = await resumed.run();
      expect(parked).toMatchObject({ status: 'waiting' });
      // Nothing ran the effect between the stop and the host's answer.
      expect(world.effects.size).toBe(0);
      expect(await finish(world, resumed, parked)).toMatchObject({ status: 'completed' });
      expect(resumed.snapshot().messages[0]!.content).toBe(reference.content);
      expect(Object.fromEntries(world.effects)).toEqual(reference.effects);
      expect(reservedCalls(await stored(world))).toEqual([]);
      await resumed.dispose();
    },
  );

  it('refuses a late report for a call the reconciliation already settled', async () => {
    const world = new World();
    const gen = world.generation();
    const agent = scriptedAgent(gen, 'alice');
    let first: TurnServices | undefined;
    let late: unknown;
    let report!: UsageReport;
    const open = agent.factory.openSession;
    agent.factory.openSession = async (context) => {
      const lease = await open(context);
      const run = lease.session.runTurn.bind(lease.session);
      lease.session.runTurn = async (turn, options) => {
        // The abandoned attempt's own services, used again while the next attempt runs.
        if (first) late = await first.recordUsage(report).catch((error: unknown) => error);
        first ??= options.services;
        return run(turn, options);
      };
      return lease;
    };
    const room = build(gen, { agent });
    const abort = new AbortController();
    gen.onAppend = (entry) => {
      // Stopped once the model request is journaled and before its answer: recovery keeps it counted.
      if (entry.t === 'request') abort.abort();
    };
    expect(await room.run({ signal: abort.signal })).toMatchObject({ status: 'cancelled' });
    const call = reservedCalls(await stored(world)).find((record) => record.kind === 'model');
    expect(call).toBeDefined();
    report = {
      callId: call!.callId,
      outcome: 'completed',
      provenance: 'reported',
      tokens: { input: 10, output: 20 },
      final: true,
    };
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expect(late).toMatchObject({ code: 'conflict' });
    await room.dispose();
  });

  it('dispatches a member again, under a new attempt, when the stop came before it entered its runtime', async () => {
    const world = new World();
    const gen = world.generation();
    const abort = new AbortController();
    const agent = scriptedAgent(gen, 'alice');
    const open = agent.factory.openSession;
    agent.factory.openSession = async (context) => {
      abort.abort();
      return open(context);
    };
    const room = build(gen, { agent });
    expect(await room.run({ signal: abort.signal })).toMatchObject({ status: 'cancelled' });
    expect(members(await stored(world))).toMatchObject([{ status: 'pending' }]);
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expect(Object.fromEntries(world.effects)).toEqual((await uninterrupted()).effects);
    await room.dispose();
  });
});

describe('a durable conversation leaves no call reserved by an interrupted selector', () => {
  it('answers the selector calls a stop left open and asks again on the next run', async () => {
    let admittedNow!: () => void;
    const admitted = new Promise<void>((resolve) => (admittedNow = resolve));
    let asked = 0;
    const base = finishingSelector(1, () => ({ kind: 'speak', participantId: 'alice' }));
    const selector: TurnSelector = {
      ...base,
      modelCalls: 'enforced',
      select: async (context, options) => {
        const first = asked++ === 0;
        const callId = `selector-call-${asked}`;
        await options.services.admitModelCall({
          callId,
          providerId: 'script',
          modelId: 'm',
          bound: { inputTokens: 10, maxOutputTokens: 20 },
        });
        if (first) {
          admittedNow();
          await new Promise((_, reject) =>
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            }),
          );
        }
        await options.services.recordUsage({
          callId,
          outcome: 'completed',
          provenance: 'reported',
          tokens: { input: 10, output: 20 },
          final: true,
        });
        return base.select(context, options);
      },
    };
    const world = new World();
    const room = build(world.generation(), { selector });
    const abort = new AbortController();
    const running = room.run({ signal: abort.signal });
    await admitted;
    abort.abort();
    expect(await running).toMatchObject({ status: 'cancelled' });
    const state = await stored(world);
    expect(state.phase).toEqual({ kind: 'ready' });
    expect(reservedCalls(state)).toEqual([]);
    // The call may have reached a provider, so it stays counted until the host reconciles it.
    expect(state.snapshot.usage).toMatchObject([
      {
        callId: 'selector-call-1',
        principal: { kind: 'selector' },
        status: 'settled',
        outcome: 'failed',
        provenance: 'unknown',
        final: true,
      },
    ]);
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expect(reservedCalls(await stored(world))).toEqual([]);
    await room.dispose();
  });
});

describe('a conversation that is not durable runs an interrupted attempt again', () => {
  it('discards the abandoned attempt and dispatches the member under a new one', async () => {
    const world = new World();
    const gen = world.generation();
    const abort = new AbortController();
    const agent = scriptedAgent(gen, 'alice');
    const room = createRoundtable({
      conversationId: 'room',
      selector: solo.selector!,
      participants: [{ ...agent, factory: { ...agent.factory, reconcile: undefined } }],
      limits: { maxTurnsPerRun: 8 },
    });
    gen.onAppend = (entry) => {
      if (entry.t === 'effect-result') abort.abort();
    };
    expect(await room.run({ signal: abort.signal })).toMatchObject({ status: 'cancelled' });
    expect(await room.run()).toMatchObject({ status: 'completed' });
    // The abandoned attempt's effect completed and the next attempt asked for it again.
    expect([...world.effects.values()]).toEqual([2]);
    await room.dispose();
  });
});

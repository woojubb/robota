import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  externalParticipant,
  loadRoundtable,
  MemoryConversationStore,
  type AgentParticipant,
  type ParticipantSession,
  type Roundtable,
  type RoundtableOptions,
  type Selection,
  type TurnSelector,
} from './index';
import type { ConversationState } from './conversation-state';

const rooms: Roundtable[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(rooms.splice(0).map((room) => room.dispose()));
});

function agent(id: string, runTurn?: ParticipantSession['runTurn']) {
  const run = vi.fn(runTurn ?? (async () => ({ kind: 'speak' as const, content: id })));
  const participant: AgentParticipant = {
    kind: 'agent',
    id,
    runtime: { id, version: '1' },
    factory: {
      checkpointVersions: ['1'],
      openSession: async () => ({
        session: { runTurn: run, checkpoint: async () => ({ version: '1', data: id }) },
        release: async () => {},
      }),
    },
  };
  return { participant, run };
}

function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
  );
}

function setup<T extends { participant: AgentParticipant } = ReturnType<typeof agent>>(
  select: TurnSelector['select'],
  options: Partial<Pick<RoundtableOptions, 'limits' | 'onEvent' | 'maxConcurrentParticipants'>> & {
    agents?: T[];
  } = {},
) {
  const agents = options.agents ?? ([agent('a')] as unknown as T[]);
  const store = new MemoryConversationStore();
  const selector: TurnSelector = { reference: { id: 'scripted', version: '1' }, select };
  const room = createRoundtable({
    conversationId: 'room',
    store,
    selector,
    participants: [...agents.map((a) => a.participant), externalParticipant({ id: 'person' })],
    limits: options.limits ?? { maxTurnsPerRun: 2 },
    maxConcurrentParticipants: options.maxConcurrentParticipants,
    onEvent: options.onEvent,
  });
  rooms.push(room);
  const load = async () => {
    const loaded = await loadRoundtable({
      conversationId: 'room',
      store,
      registry: {
        resolveParticipant: (reference) => ({
          reference,
          factory: agents.find((a) => a.participant.runtime.id === reference.id)!.participant
            .factory,
        }),
        resolveSelector: () => ({ reference: selector.reference!, create: () => selector }),
      },
    });
    rooms.push(loaded);
    return loaded;
  };
  const stored = async () => (await store.load('room'))?.state as unknown as ConversationState;
  return { room, store, load, stored, agents };
}

const speakThenFinish: TurnSelector['select'] = ({ turns }) =>
  turns.length ? { kind: 'finish', reason: 'done' } : { kind: 'speak', participantId: 'a' };

describe('cancellation and time limits end the run, not the conversation', () => {
  it('leaves a conversation loadable and resumable when its time limit expires during selection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let calls = 0;
    const f = setup(
      async (context, { signal }) => {
        if (calls++ === 0) await untilAborted(signal);
        return speakThenFinish(context, { signal });
      },
      { limits: { maxTurnsPerRun: 2, timeoutMs: 1_000 } },
    );
    const first = f.room.run();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toMatchObject({ status: 'limited', reason: 'time' });
    expect(await f.stored()).toMatchObject({ terminal: null, phase: { kind: 'ready' } });
    await f.room.dispose();
    const loaded = await f.load();
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(loaded.snapshot().messages.map((m) => m.content)).toEqual(['a']);
  });

  it('keeps a committed group and continues after cancellation during its published event', async () => {
    const abort = new AbortController();
    const f = setup(speakThenFinish, {
      limits: { maxTurnsPerRun: 1 },
      onEvent: (event) => {
        if (event.type === 'published') abort.abort();
      },
    });
    expect(await f.room.run({ signal: abort.signal })).toMatchObject({ status: 'cancelled' });
    expect(await f.stored()).toMatchObject({ terminal: null });
    await f.room.dispose();
    const loaded = await f.load();
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(loaded.snapshot().messages.map((m) => m.content)).toEqual(['a']);
    expect(f.agents[0].run).toHaveBeenCalledOnce();
  });

  it('keeps a store-backed conversation loadable when a live handle is disposed mid-run', async () => {
    let entered!: () => void;
    const selecting = new Promise<void>((resolve) => (entered = resolve));
    let calls = 0;
    const f = setup(async (context, { signal }) => {
      if (calls++ === 0) {
        entered();
        await untilAborted(signal);
      }
      return speakThenFinish(context, { signal });
    });
    const running = f.room.run();
    await selecting;
    await f.room.dispose();
    expect(await running).toMatchObject({ status: 'cancelled' });
    const loaded = await f.load();
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'done' });
  });

  it('dispatches a member again when cancellation came before it entered its runtime', async () => {
    const abort = new AbortController();
    const a = agent('a');
    const b = agent('b');
    const open = b.participant.factory.openSession;
    b.participant.factory.openSession = async (context) => {
      abort.abort();
      return open(context);
    };
    const f = setup(
      ({ turns }) =>
        turns.length
          ? { kind: 'finish', reason: 'done' }
          : { kind: 'parallel', participantIds: ['a', 'b'] },
      { agents: [a, b], maxConcurrentParticipants: 1 },
    );
    expect(await f.room.run({ signal: abort.signal })).toMatchObject({ status: 'cancelled' });
    expect(await f.stored()).toMatchObject({
      terminal: null,
      phase: { kind: 'group', members: [{ status: 'prepared' }, { status: 'pending' }] },
    });
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(f.room.snapshot().messages.map((m) => m.content)).toEqual(['a', 'b']);
    expect(a.run).toHaveBeenCalledOnce();
    expect(b.run).toHaveBeenCalledOnce();
  });
});

/** The first turn waits and honours the abort by rejecting with its reason; later turns speak. */
function stoppable(id: string, late?: string) {
  let entered!: () => void;
  const running = new Promise<void>((resolve) => (entered = resolve));
  let calls = 0;
  const member = agent(id, async (_turn, { signal }) => {
    if (calls++ > 0) return { kind: 'speak', content: id };
    entered();
    if (late === undefined) return untilAborted(signal);
    await untilAborted(signal).catch(() => {});
    return { kind: 'speak', content: late };
  });
  return { ...member, running };
}

describe('cancelling a running participant', () => {
  it('a participant that honours the abort is dispatched again on the next run', async () => {
    const a = stoppable('a');
    const f = setup(speakThenFinish, { agents: [a] });
    const abort = new AbortController();
    const result = f.room.run({ signal: abort.signal });
    await a.running;
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(f.room.snapshot().requests).toEqual([]);
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(f.room.snapshot().messages.map((m) => m.content)).toEqual(['a']);
    const [first, second] = a.run.mock.calls.map(([turn]) => turn);
    expect(second.turnId).toBe(first.turnId);
    expect(second.attemptId).not.toBe(first.attemptId);
  });

  it('timeoutMs firing mid-turn leaves the conversation resumable', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const a = stoppable('a');
    const f = setup(speakThenFinish, {
      agents: [a],
      limits: { maxTurnsPerRun: 2, timeoutMs: 1_000 },
    });
    const first = f.room.run();
    await a.running;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await first).toMatchObject({ status: 'limited', reason: 'time' });
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(f.room.snapshot().messages.map((m) => m.content)).toEqual(['a']);
    expect(a.run).toHaveBeenCalledTimes(2);
  });

  it('dispose() mid-turn keeps a store-backed conversation loadable and resumable', async () => {
    const a = stoppable('a');
    const f = setup(speakThenFinish, { agents: [a] });
    const result = f.room.run();
    await a.running;
    await f.room.dispose();
    expect(await result).toMatchObject({ status: 'cancelled' });
    const loaded = await f.load();
    expect(await loaded.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(loaded.snapshot().messages.map((m) => m.content)).toEqual(['a']);
    expect(a.run).toHaveBeenCalledTimes(2);
  });

  it('a participant that completes after the abort keeps its prepared result', async () => {
    const a = stoppable('a', 'finished anyway');
    const f = setup(speakThenFinish, { agents: [a] });
    const abort = new AbortController();
    const result = f.room.run({ signal: abort.signal });
    await a.running;
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(f.room.snapshot().messages).toEqual([]);
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(f.room.snapshot().messages.map((m) => m.content)).toEqual(['finished anyway']);
    expect(a.run).toHaveBeenCalledOnce();
  });

  it('a participant failure stays final when cancellation races it', async () => {
    const abort = new AbortController();
    let bRunning!: () => void;
    const running = new Promise<void>((resolve) => (bRunning = resolve));
    const a = agent('a', async () => {
      await running;
      return { kind: 'failed', message: 'a failed' };
    });
    const b = agent('b', async (_turn, { signal }) => {
      bRunning();
      await untilAborted(signal).catch(() => {}); // The sibling failure stops b...
      abort.abort(); // ...and the caller cancels before the group has settled.
      throw signal.reason;
    });
    const f = setup(() => ({ kind: 'parallel', participantIds: ['a', 'b'] }), {
      agents: [a, b],
      maxConcurrentParticipants: 2,
    });
    const result = await f.room.run({ signal: abort.signal });
    expect(result).toMatchObject({ status: 'failed', message: 'a failed' });
    expect(await f.room.run()).toEqual(result);
    expect(await f.stored()).toMatchObject({ terminal: { status: 'failed' } });
    expect(a.run).toHaveBeenCalledOnce();
  });

  it('a member persisted as running at load time requires recovery', async () => {
    const f = setup(speakThenFinish);
    let crashed: Awaited<ReturnType<typeof f.store.load>>;
    const commit = f.store.commit.bind(f.store);
    vi.spyOn(f.store, 'commit').mockImplementation(async (change) => {
      const envelope = await commit(change);
      const state = envelope.state as unknown as ConversationState;
      if (state.phase.kind === 'group' && state.phase.members[0].status === 'running')
        crashed = structuredClone(envelope);
      return envelope;
    });
    expect(await f.room.run()).toMatchObject({ status: 'completed' });
    await f.room.dispose();
    // The process stopped mid-turn: the store still holds the member it last saw running.
    vi.spyOn(f.store, 'load').mockResolvedValue(crashed);
    await expect(f.load()).rejects.toMatchObject({ code: 'recovery-required' });
    expect(f.agents[0].run).toHaveBeenCalledOnce();
  });
});

/** A runtime with private history exported by checkpoint(); its `stopAt` turn meets the abort. */
function historyAgent(id: string, stopAt: number, completesAfterAbort = false) {
  let calls = 0;
  let entered!: () => void;
  const running = new Promise<void>((resolve) => (entered = resolve));
  const opened = vi.fn();
  const release = vi.fn(async () => {});
  const participant: AgentParticipant = {
    kind: 'agent',
    id,
    runtime: { id, version: '1' },
    factory: {
      checkpointVersions: ['1'],
      openSession: async ({ checkpoint }) => {
        opened(checkpoint?.data);
        const history = [...((checkpoint?.data as string[] | undefined) ?? [])];
        return {
          session: {
            runTurn: async (_turn, { signal }) => {
              history.push('input');
              if (++calls === stopAt) {
                entered();
                if (completesAfterAbort) await untilAborted(signal).catch(() => {});
                else await untilAborted(signal);
              }
              history.push('answer');
              return { kind: 'speak', content: `${id}:${calls}` };
            },
            checkpoint: async () => ({ version: '1', data: [...history] }),
          },
          release,
        };
      },
    },
  };
  return { participant, opened, release, running };
}

describe('retrying a participant after cancellation', () => {
  it.each(['in process', 'after a reload'] as const)(
    'a retried participant reopens from its saved checkpoint and its private history holds the turn once (%s)',
    async (path) => {
      const a = historyAgent('a', 2);
      const f = setup(
        ({ turns }) =>
          turns.length < 2
            ? { kind: 'speak', participantId: 'a' }
            : { kind: 'finish', reason: 'done' },
        { agents: [a] },
      );
      const abort = new AbortController();
      const result = f.room.run({ signal: abort.signal });
      await a.running;
      abort.abort();
      expect(await result).toMatchObject({ status: 'cancelled' });
      let room = f.room;
      if (path === 'after a reload') {
        await f.room.dispose();
        room = await f.load();
      }
      expect(await room.run()).toMatchObject({ status: 'completed', reason: 'done' });
      expect(a.opened.mock.calls).toEqual([[undefined], [['input', 'answer']]]);
      expect((await f.stored()).participants[0].checkpoint?.data).toEqual([
        'input',
        'answer',
        'input',
        'answer',
      ]);
    },
  );

  it("the discarded attempt's lease is released exactly once", async () => {
    const a = historyAgent('a', 1);
    const b = historyAgent('b', 1, true);
    const f = setup(
      ({ turns }) =>
        turns.length
          ? { kind: 'finish', reason: 'done' }
          : { kind: 'parallel', participantIds: ['a', 'b'] },
      { agents: [a, b], maxConcurrentParticipants: 2 },
    );
    const abort = new AbortController();
    const result = f.room.run({ signal: abort.signal });
    await Promise.all([a.running, b.running]);
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    // Only the discarded member's lease goes; the sibling that finished keeps its session.
    expect(a.release).toHaveBeenCalledOnce();
    expect(b.release).not.toHaveBeenCalled();
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    expect(f.room.snapshot().messages.map((m) => m.content)).toEqual(['a:2', 'b:1']);
    expect(a.opened).toHaveBeenCalledTimes(2);
    expect(b.opened).toHaveBeenCalledOnce();
    await f.room.dispose();
    expect(a.release).toHaveBeenCalledTimes(2);
    expect(b.release).toHaveBeenCalledOnce();
  });
  it('a failed release of the discarded lease is reported by dispose()', async () => {
    const a = historyAgent('a', 1);
    a.release.mockRejectedValueOnce(new Error('release failed'));
    const f = setup(speakThenFinish, { agents: [a] });
    rooms.splice(rooms.indexOf(f.room), 1);
    const abort = new AbortController();
    const result = f.room.run({ signal: abort.signal });
    await a.running;
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    expect(await f.room.run()).toMatchObject({ status: 'completed', reason: 'done' });
    await expect(f.room.dispose()).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'release failed' })],
    });
    expect(a.release).toHaveBeenCalledTimes(2);
  });
});

describe('selector decisions are validated before they are saved', () => {
  it.each([
    ['an unknown participant', { kind: 'speak', participantId: 'ghost' }, /Unknown participant/],
    [
      'an external participant in a parallel group',
      { kind: 'parallel', participantIds: ['a', 'person'] },
      /agent participants/,
    ],
    ['a duplicate member', { kind: 'parallel', participantIds: ['a', 'a'] }, /unique/],
    [
      'more members than one run allows',
      { kind: 'parallel', participantIds: ['a', 'b'] },
      /turns allowed in one run/,
    ],
    ['a malformed decision', { kind: 'finish' }, /malformed/],
  ] as const)(
    'fails the run on %s and keeps stored state loadable',
    async (_, decision, message) => {
      const f = setup(() => structuredClone(decision) as Selection, {
        agents: [agent('a'), agent('b')],
        limits: { maxTurnsPerRun: 1 },
      });
      const result = await f.room.run();
      expect(result).toMatchObject({ status: 'failed', message: expect.stringMatching(message) });
      expect((await f.stored()).phase.kind).not.toBe('selected');
      await f.room.dispose();
      const loaded = await f.load();
      expect(await loaded.run()).toEqual(result);
      expect(f.agents.every((a) => a.run.mock.calls.length === 0)).toBe(true);
    },
  );
});

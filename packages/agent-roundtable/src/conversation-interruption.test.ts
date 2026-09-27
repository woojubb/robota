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

function setup(
  select: TurnSelector['select'],
  options: Partial<Pick<RoundtableOptions, 'limits' | 'onEvent' | 'maxConcurrentParticipants'>> & {
    agents?: ReturnType<typeof agent>[];
  } = {},
) {
  const agents = options.agents ?? [agent('a')];
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

  it('requires reconciliation instead of finishing when cancellation interrupts a running participant', async () => {
    let entered!: () => void;
    const running = new Promise<void>((resolve) => (entered = resolve));
    const a = agent('a', async (_turn, { signal }) => {
      entered();
      return untilAborted(signal);
    });
    const f = setup(speakThenFinish, { agents: [a] });
    const abort = new AbortController();
    const result = f.room.run({ signal: abort.signal });
    await running;
    abort.abort();
    expect(await result).toMatchObject({ status: 'cancelled' });
    await expect(f.room.run()).rejects.toMatchObject({ code: 'recovery-required' });
    expect(await f.stored()).toMatchObject({ terminal: null });
    await f.room.dispose();
    await expect(f.load()).rejects.toMatchObject({ code: 'recovery-required' });
    expect(a.run).toHaveBeenCalledOnce();
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

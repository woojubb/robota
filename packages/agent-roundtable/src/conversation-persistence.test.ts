import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  externalParticipant,
  MemoryConversationStore,
  type AgentParticipant,
} from './index';

function participant(id: string): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: 'test', version: '1' },
    factory: {
      openSession: async () => ({
        session: {
          runTurn: async () => ({ kind: 'speak', content: id }),
          checkpoint: async () => ({ version: '1', data: { privateHistory: [id] } }),
        },
        release: async () => {},
      }),
    },
  };
}

describe('conversation persistence barriers', () => {
  it('saves member checkpoints as they finish and publishes with one atomic group commit', async () => {
    const store = new MemoryConversationStore();
    const states: unknown[] = [];
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      states.push(structuredClone(change.state));
      return commit(change);
    });
    const room = createRoundtable({
      conversationId: 'room',
      store,
      participants: [participant('a'), participant('b')],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 2 },
      selector: { select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }) },
    });
    expect((await room.run()).status).toBe('limited');
    expect(states).toContainEqual(
      expect.objectContaining({
        snapshot: expect.objectContaining({ messages: [] }),
        phase: expect.objectContaining({
          kind: 'group',
          members: expect.arrayContaining([
            expect.objectContaining({
              participantId: 'a',
              status: 'prepared',
              checkpoint: { version: '1', data: { privateHistory: ['a'] } },
            }),
          ]),
        }),
      }),
    );
    expect((await store.load('room'))?.state).toMatchObject({
      snapshot: { messages: [{ participantId: 'a' }, { participantId: 'b' }] },
      participants: [
        { id: 'a', checkpoint: { data: { privateHistory: ['a'] } } },
        { id: 'b', checkpoint: { data: { privateHistory: ['b'] } } },
      ],
    });
    await room.dispose();
  });

  it('does not enter the selector if saving its execution phase fails', async () => {
    const store = new MemoryConversationStore();
    vi.spyOn(store, 'commit').mockRejectedValue(new Error('store offline'));
    const select = vi.fn(() => ({ kind: 'finish' as const, reason: 'done' }));
    const room = createRoundtable({
      conversationId: 'phase',
      store,
      participants: [participant('a')],
      limits: { maxTurnsPerRun: 1 },
      selector: { select },
    });
    expect(await room.run()).toMatchObject({ status: 'failed', message: 'store offline' });
    expect(select).not.toHaveBeenCalled();
    expect(room.snapshot().messages).toEqual([]);
    await room.dispose();
  });

  it('resolves a lost publication reply without repeating participant execution or publishing twice', async () => {
    const store = new MemoryConversationStore();
    const commit = store.commit.bind(store);
    vi.spyOn(store, 'commit').mockImplementation(async (change) => {
      const result = await commit(change);
      throw Object.assign(new Error('reply lost'), { revision: result.revision });
    });
    const definition = participant('a');
    const open = vi.spyOn(definition.factory, 'openSession');
    const published = vi.fn();
    const room = createRoundtable({
      conversationId: 'lost',
      store,
      participants: [definition],
      limits: { maxTurnsPerRun: 1 },
      onEvent: (event) => {
        if (event.type === 'published') published();
      },
    });
    expect((await room.run()).status).toBe('limited');
    expect(open).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledOnce();
    expect((await store.load('lost'))?.state).toMatchObject({
      snapshot: { messages: [{ content: 'a' }] },
    });
    await room.dispose();
  });

  it('keeps confirmed output when a publication observer fails', async () => {
    const errors = vi.fn();
    const room = createRoundtable({
      conversationId: 'observer',
      participants: [participant('a')],
      limits: { maxTurnsPerRun: 2 },
      selector: {
        select: ({ turns }) =>
          turns.length ? { kind: 'finish', reason: 'done' } : { kind: 'speak', participantId: 'a' },
      },
      onEvent: (event) => {
        if (event.type === 'published') throw new Error('subscriber disconnected');
      },
      onEventError: errors,
    });
    expect(await room.run()).toMatchObject({ status: 'completed' });
    expect(room.snapshot().messages).toHaveLength(1);
    expect(errors).toHaveBeenCalledOnce();
    await room.dispose();
  });

  it('retains a prepared member when its sibling fails and does not rerun the failed group', async () => {
    const store = new MemoryConversationStore();
    const failing = participant('b');
    failing.factory.openSession = async () => ({
      session: {
        runTurn: async () => ({ kind: 'failed', message: 'b failed' }),
      },
      release: async () => {},
    });
    const first = participant('a');
    const opened = vi.spyOn(first.factory, 'openSession');
    const room = createRoundtable({
      conversationId: 'failed',
      store,
      participants: [first, failing],
      maxConcurrentParticipants: 1,
      limits: { maxTurnsPerRun: 2 },
      selector: { select: () => ({ kind: 'parallel', participantIds: ['a', 'b'] }) },
    });
    expect(await room.run()).toMatchObject({ status: 'failed', message: 'b failed' });
    expect(await room.run()).toMatchObject({ status: 'failed' });
    expect(opened).toHaveBeenCalledOnce();
    expect((await store.load('failed'))?.state).toMatchObject({
      snapshot: { messages: [] },
      terminal: { status: 'failed' },
      phase: { kind: 'group', members: [{ status: 'prepared' }, { status: 'failed' }] },
    });
    await room.dispose();
  });

  it('does not advertise durable execution for an unsupported runtime', () => {
    expect(() =>
      createRoundtable({
        conversationId: 'unsupported',
        recovery: 'durable',
        participants: [externalParticipant({ id: 'owner' })],
        limits: { maxTurnsPerRun: 1 },
      }),
    ).toThrow(/durable/i);
  });

  it('retains a settled response when private checkpoint export fails', async () => {
    const store = new MemoryConversationStore();
    const definition = participant('a');
    definition.factory.openSession = async () => ({
      session: {
        runTurn: async () => ({ kind: 'speak', content: 'already generated' }),
        checkpoint: async () => {
          throw new Error('checkpoint unavailable');
        },
      },
      release: async () => {},
    });
    const room = createRoundtable({
      conversationId: 'checkpoint',
      store,
      participants: [definition],
      limits: { maxTurnsPerRun: 1 },
    });
    expect(await room.run()).toMatchObject({ status: 'failed', message: 'checkpoint unavailable' });
    expect((await store.load('checkpoint'))?.state).toMatchObject({
      snapshot: { messages: [] },
      phase: {
        members: [{ status: 'failed', outcome: { kind: 'speak', content: 'already generated' } }],
      },
    });
    await room.dispose();
  });

  it('cancels an unresponsive observer without dispatching participants', async () => {
    const definition = participant('a');
    const open = vi.spyOn(definition.factory, 'openSession');
    let reached!: () => void;
    const observed = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const room = createRoundtable({
      conversationId: 'stuck-observer',
      participants: [definition],
      limits: { maxTurnsPerRun: 1 },
      onEvent: () => {
        reached();
        return new Promise(() => {});
      },
    });
    const abort = new AbortController();
    let settled = false;
    const running = room.run({ signal: abort.signal }).then((result) => {
      settled = true;
      return result;
    });
    await observed;
    abort.abort();
    // Give queued promise continuations a full event-loop turn, without timing the participant.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(true);
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(open).not.toHaveBeenCalled();
    await room.dispose();
  });
});

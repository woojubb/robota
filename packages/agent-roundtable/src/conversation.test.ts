import { describe, expect, it, vi } from 'vitest';
import {
  createRoundtable,
  externalParticipant,
  roundRobin,
  type AgentParticipant,
  type ParticipantTurn,
  type SelectionContext,
} from './index';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function agent(id: string, run: (turn: ParticipantTurn) => Promise<string>): AgentParticipant {
  return {
    kind: 'agent',
    id,
    runtime: { id: 'test', version: '1' },
    factory: {
      openSession: async () => ({
        session: { runTurn: async (turn) => ({ kind: 'speak', content: await run(turn) }) },
        release: async () => {},
      }),
    },
  };
}

describe('independent participants in a shared conversation', () => {
  it('claims the scheduler before a selector can reenter run', async () => {
    let entered = false;
    let nested: Promise<unknown> | undefined;
    const room = createRoundtable({
      conversationId: 'reentry',
      participants: [externalParticipant({ id: 'owner' })],
      limits: { maxTurnsPerRun: 1 },
      selector: {
        select: () => {
          if (!entered) {
            entered = true;
            nested = room.run().catch((error: unknown) => error);
          }
          return { kind: 'finish', reason: 'done' };
        },
      },
    });
    await room.run();
    expect(await nested).toMatchObject({ code: 'busy' });
    await room.dispose();
  });

  it('keeps validated configuration independent from later caller mutations', async () => {
    const calls = vi.fn(async () => 'answer');
    const limits = { maxTurnsPerRun: 1 };
    const participants = [agent('a', calls)];
    const room = createRoundtable({ conversationId: 'config', limits, participants });
    limits.maxTurnsPerRun = 0;
    participants[0].id = 'changed';
    await room.run();
    expect(calls).toHaveBeenCalledOnce();
    expect(room.snapshot().messages[0].participantId).toBe('a');
    await room.dispose();
  });

  it('runs peers concurrently, publishes in selected order, and delivers sibling outputs next time', async () => {
    const started = deferred<void>();
    const first = deferred<string>();
    const second = deferred<string>();
    const requests: Record<string, ParticipantTurn[]> = { a: [], b: [] };
    let starts = 0;
    const participant = (id: 'a' | 'b') =>
      agent(id, async (turn) => {
        requests[id].push(turn);
        if (++starts === 2) started.resolve();
        return (id === 'a' ? first : second).promise;
      });
    const room = createRoundtable({
      conversationId: 'parallel',
      participants: [participant('a'), participant('b')],
      maxConcurrentParticipants: 2,
      limits: { maxTurnsPerRun: 6 },
      selector: {
        select: (view: SelectionContext) =>
          view.turns.length === 0
            ? { kind: 'parallel', participantIds: ['a', 'b'] }
            : view.turns.length === 2
              ? { kind: 'parallel', participantIds: ['a', 'b'] }
              : { kind: 'finish', reason: 'reviewed' },
      },
    });
    const running = room.run();
    await started.promise; // Neither response can finish until BOTH requests have started.
    second.resolve('B');
    await Promise.resolve();
    expect(room.snapshot().messages).toEqual([]);
    first.resolve('A');
    expect((await running).status).toBe('completed');
    expect(room.snapshot().messages.map((m) => m.participantId)).toEqual(['a', 'b', 'a', 'b']);
    expect(requests.a[0].context.baseRevision).toBe(requests.b[0].context.baseRevision);
    expect(requests.a[1].context.messages.map((m) => m.participantId)).toEqual(['b']);
    expect(requests.b[1].context.messages.map((m) => m.participantId)).toEqual(['a']);
    await room.dispose();
  });

  it('isolates sessions opened from one reusable definition and releases each exactly once', async () => {
    const sessions: string[][] = [];
    const released = vi.fn(async () => {});
    const participant: AgentParticipant = {
      kind: 'agent',
      id: 'a',
      runtime: { id: 'test', version: '1' },
      factory: {
        openSession: async ({ conversationId }) => {
          const history: string[] = [];
          sessions.push(history);
          return {
            session: {
              runTurn: async () => {
                history.push(conversationId);
                return { kind: 'speak', content: conversationId };
              },
            },
            release: released,
          };
        },
      },
    };
    const make = (conversationId: string) =>
      createRoundtable({
        conversationId,
        participants: [participant],
        selector: roundRobin(),
        limits: { maxTurnsPerRun: 1 },
      });
    const a = make('one');
    const b = make('two');
    expect((await Promise.all([a.run(), b.run()])).map((r) => r.status)).toEqual([
      'limited',
      'limited',
    ]);
    expect(sessions).toEqual([['one'], ['two']]);
    await Promise.all([a.dispose(), a.dispose(), b.dispose()]);
    expect(released).toHaveBeenCalledTimes(2);
  });

  it('atomically satisfies external input and deduplicates retries before checking revision', async () => {
    const room = createRoundtable({
      conversationId: 'input',
      participants: [externalParticipant({ id: 'owner' })],
      selector: roundRobin(),
      limits: { maxTurnsPerRun: 1 },
    });
    const waiting = await room.run();
    expect(waiting.status).toBe('waiting');
    if (waiting.status !== 'waiting') throw new Error('expected input request');
    const input = {
      participantId: 'owner',
      inputId: 'response',
      content: 'hello',
      expectedRevision: waiting.revision,
      replyToRequestId: waiting.requests[0].id,
    };
    const accepted = await room.submitInput(input);
    expect(await room.submitInput(input)).toEqual(accepted);
    expect(room.snapshot().messages).toHaveLength(1);
    await expect(room.submitInput({ ...input, content: 'different' })).rejects.toMatchObject({
      code: 'conflict',
    });
    await room.dispose();
  });

  it('cancels a group without publishing completed siblings or dispatching queued members', async () => {
    const waiting = deferred<void>();
    const calls: string[] = [];
    const participant = (id: string): AgentParticipant => ({
      kind: 'agent',
      id,
      runtime: { id: 'test', version: '1' },
      factory: {
        openSession: async () => ({
          session: {
            runTurn: async (_turn, { signal }) => {
              calls.push(id);
              if (id === 'a') return { kind: 'speak', content: 'provisional' };
              waiting.resolve();
              await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
              );
              return { kind: 'yield' };
            },
          },
          release: async () => {},
        }),
      },
    });
    const room = createRoundtable({
      conversationId: 'abort',
      participants: ['a', 'b', 'c'].map(participant),
      selector: { select: () => ({ kind: 'parallel', participantIds: ['a', 'b', 'c'] }) },
      maxConcurrentParticipants: 1,
      limits: { maxTurnsPerRun: 3 },
    });
    const abort = new AbortController();
    const run = room.run({ signal: abort.signal });
    await waiting.promise;
    await expect(room.run()).rejects.toMatchObject({ code: 'busy' });
    abort.abort();
    expect((await run).status).toBe('cancelled');
    expect(calls).toEqual(['a', 'b']);
    expect(room.snapshot().messages).toEqual([]);
    await room.dispose();
  });
});

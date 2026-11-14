import { GoalBook, createMemoryGoalStore } from '@robota-sdk/agent-product/personal';
import { describe, expect, it } from 'vitest';

import { createGoalRunner } from '../goal-runner.js';

import type { TRunSession } from '../goal-runner.js';

type THandler = (event: never) => void;

/**
 * A session that raises one permission prompt when it runs, then waits until that prompt is settled
 * (answered, refused by a backstop, or aborted) before it ends its turn, as a real session does.
 */
function promptingSession() {
  const handlers = new Map<string, Set<THandler>>();
  const emit = (event: string, payload: unknown): void => {
    for (const handler of handlers.get(event) ?? []) (handler as (value: unknown) => void)(payload);
  };
  let settle: (approved: boolean) => void = () => undefined;
  const settled = new Promise<boolean>((resolve) => (settle = resolve));
  let open = true;
  const resolve = (approved: boolean): void => {
    if (!open) return;
    open = false;
    emit('prompt_resolved', { id: 'prompt-1' });
    settle(approved);
  };
  const session = {
    on: (event: string, handler: THandler) =>
      handlers.set(event, (handlers.get(event) ?? new Set()).add(handler)),
    off: (event: string, handler: THandler) => handlers.get(event)?.delete(handler),
    submit: async () => {
      queueMicrotask(() =>
        emit('permission_request', {
          id: 'prompt-1',
          toolName: 'BrowserSubmit',
          toolArgs: { method: 'POST', url: 'https://shop.example/buy' },
        }),
      );
      return {
        turnId: 't1',
        completed: settled.then((approved) => ({ response: approved ? 'Bought.' : 'Not bought.' })),
      };
    },
    resolvePermission: (_id: string, approved: boolean) => resolve(approved),
    abort: () => resolve(false),
    shutdown: async () => undefined,
  };
  return { session: session as unknown as TRunSession, backstop: () => resolve(false) };
}

async function pendingApproval(book: GoalBook) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const item = (await book.feed()).find((entry) => entry.approval?.state === 'pending');
    if (item !== undefined) return item;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no pending approval');
}

describe('goal runner', () => {
  it('expires an approval its session stopped waiting for, so it can never be approved afterwards', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const runner = createGoalRunner({ book, openSession: () => stub.session });
    const goal = await book.create({ title: 'Buy', instructions: 'Buy tickets' });
    await runner.runDue();
    const approval = await pendingApproval(book);

    stub.backstop();
    await runner.settled();
    expect((await book.feedItem(approval.id))?.approval?.state).toBe('expired');
    const [run] = await book.runs(goal.id);
    expect(run?.actions.map((action) => action.outcome)).toEqual(['waiting-approval', 'denied']);
    expect(run?.actions.map((action) => action.outcome)).not.toContain('approved');

    await expect(runner.answer(approval.id, true)).rejects.toThrow('no longer waiting');
    expect((await book.feedItem(approval.id))?.approval?.state).toBe('expired');
  });

  it('stops without waiting for a person: a turn waiting on approval is aborted and its approval expires', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const runner = createGoalRunner({ book, openSession: () => stub.session });
    const goal = await book.create({ title: 'Buy', instructions: 'Buy tickets' });
    await runner.runDue();
    const approval = await pendingApproval(book);
    await runner.stop();
    expect((await book.feedItem(approval.id))?.approval?.state).toBe('expired');
    expect((await book.runs(goal.id))[0]?.report).toBe('Not bought.');
    expect(await runner.runDue()).toBe(0);
  });

  it('works again once the person approves, and records the approval', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const runner = createGoalRunner({ book, openSession: () => stub.session });
    const goal = await book.create({ title: 'Buy', instructions: 'Buy tickets' });
    await runner.runDue();
    const approval = await pendingApproval(book);
    expect((await book.get(goal.id))?.status).toBe('waiting');
    await runner.answer(approval.id, true);
    await runner.settled();
    expect((await book.feedItem(approval.id))?.approval?.state).toBe('approved');
    expect((await book.runs(goal.id))[0]?.actions.map((action) => action.outcome)).toEqual([
      'waiting-approval',
      'approved',
    ]);
    expect((await book.get(goal.id))?.status).toBe('done');
  });
});

describe('goal runner stopping', () => {
  it('does not start the work of a run that was opening while the runner stopped', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    let submitted = 0;
    let runner: ReturnType<typeof createGoalRunner> | undefined;
    const session = {
      on: () => undefined,
      off: () => undefined,
      submit: async () => {
        submitted += 1;
        return { turnId: 't', completed: Promise.resolve({ response: 'worked' }) };
      },
      resolvePermission: () => undefined,
      abort: () => undefined,
      shutdown: async () => undefined,
    } as unknown as TRunSession;
    runner = createGoalRunner({
      book,
      // The runner stops while this run is opening its session.
      openSession: () => {
        void runner!.stop();
        return session;
      },
    });
    const goal = await book.create({ title: 'Late', instructions: 'x' });
    await runner.runDue();
    await runner.settled();
    expect(submitted).toBe(0);
    expect((await book.runs(goal.id))[0]).toEqual(
      expect.objectContaining({
        outcome: 'failed',
        report: 'The run failed: the agent was stopping',
      }),
    );
  });
});

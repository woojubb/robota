import { GoalBook, createMemoryGoalStore } from '@robota-sdk/agent-product/personal';
import { describe, expect, it, vi } from 'vitest';

import { createApprovalRegistry } from '../approvals.js';
import { createChannelTurns } from '../channel-turns.js';
import { createGoalRunner, describeCall } from '../goal-runner.js';

import type { TRunSession } from '../goal-runner.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

type THandler = (event: never) => void;

/**
 * A session that raises one permission prompt when it runs, then waits until that prompt is settled
 * (answered, refused by a backstop, or aborted) before it ends its turn, as a real session does.
 */
function promptingSession(
  request: { toolName: string; toolArgs: Record<string, unknown>; executionId?: string } = {
    toolName: 'BrowserSubmit',
    toolArgs: { method: 'POST', url: 'https://shop.example/buy' },
  },
) {
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
          ...request,
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

async function firstFeedItem(book: GoalBook) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const item = (await book.feed()).find(
      (entry) => entry.kind === 'notice' || entry.kind === 'approval',
    );
    if (item !== undefined) return item;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no feed item');
}

describe('connector action approvals', () => {
  const oversized = {
    toolName: 'ConnectorAct',
    toolArgs: {
      connector: 'mail',
      tool: 'send',
      argumentsJson: JSON.stringify({ body: 'x'.repeat(400), to: 'recipient@example.invalid' }),
    },
  };

  it('refuses the prompt and reports failure if the approval cannot be posted', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const post = vi.spyOn(book, 'post').mockRejectedValueOnce(new Error('feed unavailable'));
    const stub = promptingSession();
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    const goal = await book.create({ title: 'Buy', instructions: 'Buy the ticket.' });
    try {
      await runner.runDue();
      await runner.settled();
      expect((await book.get(goal.id))?.status).toBe('failed');
      expect((await book.runs(goal.id))[0]?.report).toMatch(/approval could not be shown/u);
      expect((await book.feed()).some((item) => item.approval?.state === 'pending')).toBe(false);
    } finally {
      post.mockRestore();
      await runner.stop();
    }
  });

  it('refuses a channel prompt and tells the person if the approval cannot be posted', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const post = vi.spyOn(book, 'post').mockRejectedValueOnce(new Error('feed unavailable'));
    const stub = promptingSession();
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    try {
      expect(await channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Buy it')).toMatch(
        /approval could not be shown/u,
      );
      expect((await book.feed()).some((item) => item.approval?.state === 'pending')).toBe(false);
    } finally {
      post.mockRestore();
      await channel.stop();
    }
  });

  it('does not expire a channel approval while its posted card is being registered', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const original = book.post.bind(book);
    let release!: () => void;
    let reached!: () => void;
    let registered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      registered = resolve;
    });
    const post = vi.spyOn(book, 'post').mockImplementation(async (item) => {
      const posted = await original(item);
      if (item.kind === 'approval') {
        reached();
        await gate;
      }
      return posted;
    });
    const stub = promptingSession();
    const approvals = createApprovalRegistry(book);
    approvals.onRegistered(() => registered());
    const channel = createChannelTurns({ book, approvals, openSession: () => stub.session });
    const turn = channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Buy it');
    try {
      await waiting;
      const item = (await book.feed())[0]!;
      await expect(approvals.answer(item.id, true)).rejects.toThrow(/being prepared/u);
      expect((await book.feedItem(item.id))?.approval?.state).toBe('pending');
      release();
      await ready;
      expect((await approvals.answer(item.id, true)).approval?.state).toBe('approved');
      expect(await turn).toBe('Bought.');
    } finally {
      release();
      await Promise.allSettled([turn]);
      post.mockRestore();
      await channel.stop();
    }
  });

  it.each(['failure', 'different detail'] as const)(
    'never resolves a prompt as approved when its record has a %s',
    async (scenario) => {
      const book = new GoalBook({ store: createMemoryGoalStore() });
      const item = await book.post({
        kind: 'approval',
        title: 'Action',
        body: '',
        approval: { tool: 'ConnectorAct', detail: 'send to alice', state: 'pending' },
      });
      const resolvePermission = vi.fn();
      const approvals = createApprovalRegistry(book);
      approvals.register(item, {
        session: { resolvePermission },
        promptId: 'prompt',
        recordAnswer: async () => {
          if (scenario === 'failure') throw new Error('cannot save');
          return {
            ...item,
            approval: { ...item.approval!, state: 'approved', detail: 'send to bob' },
          };
        },
      });
      await expect(approvals.answer(item.id, true)).rejects.toThrow();
      expect(resolvePermission).toHaveBeenCalledWith('prompt', false);
      expect(resolvePermission).not.toHaveBeenCalledWith('prompt', true);
      await approvals.settleFailed();
      expect((await book.feedItem(item.id))?.approval?.state).toBe('expired');
    },
  );

  it('does not expire an approval while another answer is being recorded', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const item = await book.post({
      kind: 'approval',
      title: 'Action',
      body: '',
      approval: { tool: 'ConnectorAct', detail: 'send to alice', state: 'pending' },
    });
    const resolvePermission = vi.fn();
    const approvals = createApprovalRegistry(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    approvals.register(item, {
      session: { resolvePermission },
      promptId: 'prompt',
      recordAnswer: async (approve) => {
        reached();
        await gate;
        return book.setApproval(item.id, approve ? 'approved' : 'denied');
      },
    });
    const first = approvals.answer(item.id, true);
    try {
      await waiting;
      await expect(approvals.answer(item.id, true)).rejects.toThrow(/being answered/u);
      expect((await book.feedItem(item.id))?.approval?.state).toBe('pending');
      release();
      expect((await first).approval?.state).toBe('approved');
      expect(resolvePermission).toHaveBeenCalledOnce();
      expect(resolvePermission).toHaveBeenCalledWith('prompt', true);
    } finally {
      release();
      await Promise.allSettled([first]);
    }
  });

  it('retries expiration when recording an answer and the first cleanup both fail', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const item = await book.post({
      kind: 'approval',
      title: 'Action',
      body: '',
      approval: { tool: 'ConnectorAct', detail: 'send to alice', state: 'pending' },
    });
    const write = vi.spyOn(book, 'cancelApproval').mockRejectedValueOnce(new Error('busy'));
    const approvals = createApprovalRegistry(book);
    approvals.register(item, {
      session: { resolvePermission: vi.fn() },
      promptId: 'prompt',
      recordAnswer: async () => {
        throw new Error('cannot save answer');
      },
    });
    try {
      await expect(approvals.answer(item.id, true)).rejects.toThrow('cannot save answer');
      await approvals.settleFailed();
      await approvals.settleFailed();
      expect((await book.feedItem(item.id))?.approval?.state).toBe('expired');
    } finally {
      write.mockRestore();
    }
  });

  it('drains a channel approval that is still being posted when the channel stops', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const original = book.post.bind(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const post = vi.spyOn(book, 'post').mockImplementation(async (item) => {
      if (item.kind === 'approval') {
        reached();
        await gate;
      }
      return original(item);
    });
    const stub = promptingSession();
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    const turn = channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Buy it');
    let stopping: Promise<void> | undefined;
    try {
      await waiting;
      let stopped = false;
      stopping = channel.stop().then(() => {
        stopped = true;
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(stopped).toBe(false);
      release();
      await stopping;
      await turn;
      expect((await book.feed()).find((item) => item.kind === 'approval')?.approval?.state).toBe(
        'expired',
      );
    } finally {
      release();
      await Promise.allSettled([turn, ...(stopping === undefined ? [] : [stopping])]);
      post.mockRestore();
      await channel.stop();
    }
  });

  it('expires a posted card if shutdown begins before its registration completes', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const original = book.post.bind(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const post = vi.spyOn(book, 'post').mockImplementation(async (item) => {
      const posted = await original(item);
      if (item.kind === 'approval') {
        reached();
        await gate;
      }
      return posted;
    });
    const stub = promptingSession();
    const abort = vi.spyOn(stub.session, 'abort').mockImplementation(() => undefined);
    const approvals = createApprovalRegistry(book);
    const channel = createChannelTurns({ book, approvals, openSession: () => stub.session });
    const turn = channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Buy it');
    let stopping: Promise<void> | undefined;
    try {
      await waiting;
      await approvals.shutdown();
      stopping = channel.stop();
      release();
      await stopping;
      await turn;
      expect((await book.feed()).find((item) => item.kind === 'approval')?.approval?.state).toBe(
        'expired',
      );
    } finally {
      release();
      await Promise.allSettled([turn, ...(stopping === undefined ? [] : [stopping])]);
      post.mockRestore();
      abort.mockRestore();
      await channel.stop();
    }
  });

  it('cancels and drains a channel answer being recorded during shutdown', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const original = book.setApproval.bind(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const write = vi.spyOn(book, 'setApproval').mockImplementation(async (...args) => {
      if (args[1] === 'approved') {
        reached();
        await gate;
      }
      return original(...args);
    });
    const stub = promptingSession();
    const resolve = vi.spyOn(stub.session, 'resolvePermission');
    const approvals = createApprovalRegistry(book);
    const channel = createChannelTurns({ book, approvals, openSession: () => stub.session });
    const turn = channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Buy it');
    let answer: Promise<unknown> | undefined;
    let stopping: Promise<void> | undefined;
    try {
      const item = await pendingApproval(book);
      answer = approvals.answer(item.id, true).catch((error: unknown) => error);
      await waiting;
      stopping = channel.stop();
      const early = await Promise.race([
        stopping.then(() => true),
        new Promise<false>((resolveEarly) => setTimeout(() => resolveEarly(false), 100)),
      ]);
      expect(early).toBe(false);
      release();
      await stopping;
      expect(await answer).toBeInstanceOf(Error);
      expect(resolve).not.toHaveBeenCalledWith('prompt-1', true);
      expect((await book.feedItem(item.id))?.approval?.state).toBe('expired');
      await turn;
    } finally {
      release();
      await Promise.allSettled([
        turn,
        ...(answer === undefined ? [] : [answer]),
        ...(stopping === undefined ? [] : [stopping]),
      ]);
      write.mockRestore();
      resolve.mockRestore();
      await channel.stop();
    }
  });

  it('binds the displayed case call and its recorded approval to the execution', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const args = {
      connector: 'mail',
      tool: 'send',
      argumentsJson: '{"to":"first@example.invalid"}',
    };
    const stub = promptingSession({
      toolName: 'ConnectorAct',
      toolArgs: args,
      executionId: 'call-one',
    });
    const accepted: { id: string; call: unknown; recorded: Promise<unknown> }[] = [];
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
      shape: async () => ({
        instructions: 'Case context.',
        onlyTools: ['ConnectorAct'],
        caseAction: {
          tool: {} as IToolWithEventService,
          approved: (id, call, recorded) => accepted.push({ id, call, recorded }),
        },
      }),
    });
    await book.create({
      title: 'Case',
      instructions: 'Continue.',
      readOnly: true,
      caseId: 'case-test',
    });
    try {
      await runner.runDue();
      const approval = await pendingApproval(book);
      expect(approval.approval?.detail).toContain('first@example.invalid');
      args.argumentsJson = '{"to":"later@example.invalid"}';
      await runner.answer(approval.id, true);
      await runner.settled();
      expect(accepted).toHaveLength(1);
      expect(accepted[0]).toMatchObject({
        id: 'call-one',
        call: { connector: 'mail', tool: 'send', argumentsJson: '{"to":"first@example.invalid"}' },
      });
      expect(await accepted[0]!.recorded).toMatchObject({ approval: { state: 'approved' } });
    } finally {
      await runner.stop();
    }
  });

  it('refuses a case action when the prompt lacks an execution identity', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession({
      toolName: 'ConnectorAct',
      toolArgs: { connector: 'mail', tool: 'send' },
    });
    const accepted: unknown[] = [];
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
      shape: async () => ({
        instructions: 'Case context.',
        onlyTools: ['ConnectorAct'],
        caseAction: {
          tool: {} as IToolWithEventService,
          approved: (...args) => accepted.push(args),
        },
      }),
    });
    await book.create({
      title: 'Case',
      instructions: 'Continue.',
      readOnly: true,
      caseId: 'case-test',
    });
    try {
      await runner.runDue();
      expect((await firstFeedItem(book)).kind).toBe('notice');
      await runner.settled();
      expect(accepted).toEqual([]);
    } finally {
      await runner.stop();
    }
  });

  it('shows the complete short call even if an extra URL is present', () => {
    const detail = describeCall('ConnectorAct', {
      connector: 'mail',
      tool: 'send',
      argumentsJson: '{"to":"recipient@example.invalid"}',
      url: 'https://misleading.example',
    });
    expect(detail).toContain('recipient@example.invalid');
    expect(detail).toContain('ConnectorAct');
    expect(describeCall('ConnectorAct', { text: 'before\u202eafter' })).not.toContain('\u202e');
  });

  it('shows the effective connector arguments after JSON escapes are decoded', () => {
    const recipient = 'recipient@example.invalid';
    const escaped = [...recipient]
      .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    const detail = describeCall('ConnectorAct', {
      connector: 'mail',
      tool: 'send',
      argumentsJson: `{"to":"${escaped}","body":"before\\u202eafter"}`,
    });
    expect(detail).toContain(recipient);
    expect(detail).not.toContain('\u202e');
    expect(detail).toContain('202e');
    expect(describeCall('ConnectorAct', { argumentsJson: '[]' })).toBeUndefined();
    expect(describeCall('ConnectorAct', { argumentsJson: '{bad json' })).toBeUndefined();
  });

  it('refuses an effective call that exceeds the display limit after invisible characters are made explicit', () => {
    expect(
      describeCall('ConnectorAct', {
        connector: 'mail',
        tool: 'send',
        argumentsJson: JSON.stringify({ body: '\u202e'.repeat(35) }),
      }),
    ).toBeUndefined();
  });

  it('shows a complete connector action and waits for the person to approve it', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession({
      toolName: 'ConnectorAct',
      toolArgs: {
        connector: 'mail',
        tool: 'send',
        argumentsJson: '{"to":"recipient@example.invalid"}',
      },
    });
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    const goal = await book.create({ title: 'Send', instructions: 'Send a message' });
    try {
      await runner.runDue();
      const approval = await pendingApproval(book);
      expect(approval.approval?.detail).toContain('recipient@example.invalid');
      expect(approval.approval?.detail).toContain('"connector":"mail"');
      await runner.answer(approval.id, true);
      await runner.settled();
      expect((await book.runs(goal.id))[0]?.report).toBe('Bought.');
    } finally {
      await runner.stop();
    }
  });

  it('refuses a goal action whose complete details cannot be shown', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession(oversized);
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    const goal = await book.create({ title: 'Send', instructions: 'Send a message' });
    try {
      await runner.runDue();
      const item = await firstFeedItem(book);
      expect(item.kind).toBe('notice');
      expect(item.body).toMatch(/too long|cannot be shown/u);
      await runner.settled();
      expect((await book.runs(goal.id))[0]?.report).toBe('Not bought.');
      expect((await book.runs(goal.id))[0]?.actions).toContainEqual(
        expect.objectContaining({ outcome: 'denied' }),
      );
      expect((await book.feed()).some((entry) => entry.approval?.state === 'pending')).toBe(false);
    } finally {
      await runner.stop();
    }
  });

  it('refuses a channel action whose complete details cannot be shown', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession(oversized);
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    try {
      const turn = channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Send it');
      const item = await firstFeedItem(book);
      expect(item.kind).toBe('notice');
      expect(item.body).toMatch(/too long|cannot be shown/u);
      await expect(turn).resolves.toBe('Not bought.');
      expect((await book.feed()).some((entry) => entry.approval?.state === 'pending')).toBe(false);
    } finally {
      await channel.stop();
    }
  });

  it('waits for a refused channel action notice before shutdown completes', async () => {
    const store = createMemoryGoalStore();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => undefined;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const book = new GoalBook({
      store: {
        ...store,
        putFeedItem: async (item) => {
          entered();
          await gate;
          await store.putFeedItem(item);
        },
      },
    });
    const stub = promptingSession(oversized);
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    try {
      await expect(
        channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Send it'),
      ).resolves.toBe('Not bought.');
      await writing;
      let stopped = false;
      const stopping = channel.stop().then(() => {
        stopped = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stopped).toBe(false);
      release();
      await stopping;
      expect((await book.feed()).some((item) => item.kind === 'notice')).toBe(true);
    } finally {
      release();
      await channel.stop();
    }
  });

  it('does not start a channel turn after shutdown begins', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession(oversized);
    let opened = 0;
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => {
        opened += 1;
        return stub.session;
      },
    });
    const stopping = channel.stop();
    await expect(
      channel.runTurn({ channel: 'test', conversationId: 'owner' }, 'Send it'),
    ).rejects.toThrow(/stopp/iu);
    await stopping;
    expect(opened).toBe(0);
    expect(await book.feed()).toEqual([]);
  });

  it('does not start a queued channel turn after shutdown begins', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    let submitted = 0;
    const channel = createChannelTurns({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => ({
        ...stub.session,
        submit: async (...args) => {
          submitted += 1;
          return stub.session.submit(...args);
        },
      }),
    });
    const key = { channel: 'test', conversationId: 'owner' };
    const first = channel.runTurn(key, 'First');
    await pendingApproval(book);
    const second = channel.runTurn(key, 'Second');
    const rejected = expect(second).rejects.toThrow(/stopp/iu);
    const stopping = channel.stop();
    await first;
    await rejected;
    await stopping;
    expect(submitted).toBe(1);
  });
});

async function pendingApproval(book: GoalBook) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const item = (await book.feed()).find((entry) => entry.approval?.state === 'pending');
    if (item !== undefined) return item;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no pending approval');
}

describe('goal runner', () => {
  it('does not approve when the prompt backstop fires while the answer is recorded', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const resolve = vi.spyOn(stub.session, 'resolvePermission');
    const original = book.setWaiting.bind(book);
    const waiting = vi.spyOn(book, 'setWaiting').mockImplementation(async (id, value) => {
      await original(id, value);
      if (!value) stub.backstop();
    });
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    try {
      await book.create({ title: 'Buy', instructions: 'Buy tickets' });
      await runner.runDue();
      const approval = await pendingApproval(book);
      await expect(runner.answer(approval.id, true)).rejects.toThrow(/cancelled/u);
      await runner.settled();
      expect(resolve).not.toHaveBeenCalledWith('prompt-1', true);
      expect((await book.feedItem(approval.id))?.approval?.state).toBe('expired');
    } finally {
      waiting.mockRestore();
      await runner.stop();
    }
  });

  it('expires a prompt settled before its approval finishes posting', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const original = book.post.bind(book);
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const posted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const write = vi.spyOn(book, 'post').mockImplementation(async (item) => {
      const result = await original(item);
      if (item.kind === 'approval') {
        reached();
        await gate;
      }
      return result;
    });
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    try {
      await book.create({ title: 'Buy', instructions: 'Buy tickets' });
      await runner.runDue();
      await posted;
      stub.backstop();
      release();
      await runner.settled();
      expect((await book.feed()).find((item) => item.kind === 'approval')?.approval?.state).toBe(
        'expired',
      );
    } finally {
      release();
      write.mockRestore();
      await runner.stop();
    }
  });

  it("interrupts a run in progress, as a person's Stop does, and keeps running goals afterwards", async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    let stub = promptingSession();
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
    const goal = await book.create({ title: 'Buy', instructions: 'Buy tickets' });
    await runner.runDue();
    await pendingApproval(book);
    runner.interrupt();
    await runner.settled();
    expect((await book.runs(goal.id))[0]?.report).toBe('Not bought.');
    // Not stopped: a goal made afterwards still runs.
    stub = promptingSession();
    await book.create({ title: 'Again', instructions: 'Buy more tickets' });
    expect(await runner.runDue()).toBe(1);
    await runner.stop();
  });

  it('expires an approval its session stopped waiting for, so it can never be approved afterwards', async () => {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const stub = promptingSession();
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
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
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
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
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => stub.session,
    });
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
      approvals: createApprovalRegistry(book),
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

describe('goal runner reporting', () => {
  /** A session whose turn ends with `response`, or fails when `response` is an error. */
  function endingSession(response: string | Error): TRunSession {
    return {
      on: () => undefined,
      off: () => undefined,
      submit: async () => ({
        turnId: 't',
        completed:
          response instanceof Error ? Promise.reject(response) : Promise.resolve({ response }),
      }),
      resolvePermission: () => undefined,
      abort: () => undefined,
      shutdown: async () => undefined,
    } as unknown as TRunSession;
  }

  /** One run of one goal; what the host was asked and told, in order, and what the feed holds. */
  async function runOnce(response: string | Error, quiet: boolean | undefined) {
    const book = new GoalBook({ store: createMemoryGoalStore() });
    const events: string[] = [];
    const runner = createGoalRunner({
      book,
      approvals: createApprovalRegistry(book),
      openSession: () => endingSession(response),
      ...(quiet !== undefined && {
        quiet: async () => {
          events.push('asked whether quiet');
          return quiet;
        },
      }),
      onReport: (_goal, report, run) =>
        events.push(`told ${run.quiet ? 'quiet' : 'not quiet'}: ${report}`),
    });
    await book.create({ title: 'Watch', instructions: 'Look' });
    await runner.runDue();
    await runner.settled();
    return { events, feed: await book.feed() };
  }

  it('tells the host a run was quiet after judging that once, and posts nothing to the feed', async () => {
    const { events, feed } = await runOnce('Looked.', true);
    expect(events).toEqual(['asked whether quiet', 'told quiet: Looked.']);
    expect(feed).toEqual([]);
  });

  it('tells the host a run was not quiet when the host says so, and posts its report', async () => {
    const { events, feed } = await runOnce('Looked.', false);
    expect(events).toEqual(['asked whether quiet', 'told not quiet: Looked.']);
    expect(feed.map((item) => [item.kind, item.body])).toEqual([['report', 'Looked.']]);
  });

  it('is never quiet for a goal the host does not judge', async () => {
    const { events, feed } = await runOnce('Looked.', undefined);
    expect(events).toEqual(['told not quiet: Looked.']);
    expect(feed).toHaveLength(1);
  });

  it('is never quiet for a run that failed, and does not ask the host about it', async () => {
    const { events, feed } = await runOnce(new Error('The model could not be reached'), true);
    expect(events).toEqual(['told not quiet: The run failed: The model could not be reached']);
    expect(feed.map((item) => item.body)).toEqual([
      'The run failed: The model could not be reached',
    ]);
  });
});

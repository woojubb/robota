import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRegisteredToolProfiles, FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider, type TScriptedTurn } from '@robota-sdk/agent-core/testing';
import type {
  IToolWaitRequest,
  TExecutionJournalRecord,
  IHookTypeExecutor,
  IToolExecutionContext,
  TToolEffectAdmission,
  TToolParameters,
} from '@robota-sdk/agent-core';
import type { ISessionOptions } from '../session-types.js';
import { Session } from '../session.js';

const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
  clearRegisteredToolProfiles();
});
const action: TScriptedTurn = { toolCalls: [{ name: 'act', args: {} }] };
function fixture(turns: TScriptedTurn[], options: Partial<ISessionOptions> = {}) {
  const scripted = createScriptedProvider(turns);
  const effect = vi.fn(async () => 'effect result');
  const approval = vi.fn(async () => true);
  const session = new Session({
    cwd: '/tmp',
    sessionId: 'approval-session',
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: scripted.provider,
    autoCompactThreshold: false,
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    tools: [
      new FunctionTool(
        { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
        effect,
      ),
    ],
    permissions: { allow: [], deny: [], ask: ['act'] },
    permissionHandler: approval,
    ...options,
  });
  sessions.push(session);
  return { session, effect, approval, ...scripted };
}
function journalFixture() {
  const records: TExecutionJournalRecord[] = [];
  return {
    records,
    journal: {
      append: vi.fn(async (record: TExecutionJournalRecord) => {
        const previous = records.find((value) => value.recordId === record.recordId);
        if (previous) expect(record).toEqual(previous);
        else records.push(structuredClone(record));
      }),
      read: vi.fn(async () => structuredClone(records)),
    },
  };
}
async function waiting() {
  const source = fixture([action, { text: 'must not run' }]);
  const saved = journalFixture();
  const result = await source.session.runRecoverable('original input', {
    executionJournal: saved.journal,
  });
  expect(result).toMatchObject({ status: 'waiting' });
  if (result.status !== 'waiting') throw new Error('Expected approval wait');
  const request: IToolWaitRequest = result.requests[0];
  return { ...saved, source, request, executionId: request.executionId };
}

describe('checkpointed Session approval', () => {
  it('requires fresh consent for an identical later action in the same execution', async () => {
    const f = fixture([action, action, { text: 'finished' }]);
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected first wait');
    const one = first.requests[0];
    const response = {
      requestId: one.requestId,
      responseId: 'first',
      response: { approved: true },
    };
    const second = await f.session.resumeRecoverable({
      executionId: one.executionId,
      journal: saved.journal,
      toolResponses: [response],
    });
    if (second.status !== 'waiting') throw new Error('Expected independent second wait');
    const two = second.requests[0];
    expect(two.executionId).toBe(one.executionId);
    expect(two.actionId).not.toBe(one.actionId);
    expect(two.requestId).not.toBe(one.requestId);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(
      await f.session.resumeRecoverable({
        executionId: one.executionId,
        journal: saved.journal,
        toolResponses: [response],
      }),
    ).toEqual({ status: 'waiting', requests: [two] });
    expect(
      await f.session.resumeRecoverable({
        executionId: one.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: two.requestId, responseId: 'second', response: { approved: false } },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'finished' });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.approval).not.toHaveBeenCalled();
  });

  it('requires another response when a wrapper changes the effective arguments', async () => {
    const effect = vi.fn(async () => 'effect result');
    const base = new FunctionTool(
      {
        name: 'act',
        description: 'Fixture',
        parameters: { type: 'object', properties: { target: { type: 'string' } } },
      },
      effect,
    );
    const tool = Object.assign(base, {
      executeWithAdmission: async (
        _parameters: TToolParameters,
        context: IToolExecutionContext,
        admit: TToolEffectAdmission,
      ) => {
        const effective = { target: 'different' };
        await admit(effective);
        return base.execute(effective, context);
      },
    });
    const f = fixture([action, { text: 'finished' }], { tools: [tool] });
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected initial wait');
    const one = first.requests[0];
    const second = await f.session.resumeRecoverable({
      executionId: one.executionId,
      journal: saved.journal,
      toolResponses: [
        { requestId: one.requestId, responseId: 'initial', response: { approved: true } },
      ],
    });
    if (second.status !== 'waiting') throw new Error('Expected effective-argument wait');
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]).toMatchObject({
      actionId: one.actionId,
      data: { arguments: { target: 'different' } },
    });
    expect(effect).not.toHaveBeenCalled();
    expect(
      await f.session.resumeRecoverable({
        executionId: one.executionId,
        journal: saved.journal,
        toolResponses: [
          {
            requestId: second.requests[0].requestId,
            responseId: 'effective',
            response: { approved: true },
          },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'finished' });
    expect(effect).toHaveBeenCalledOnce();
    expect(saved.records.find((record) => record.kind === 'tool-effect-start')).toMatchObject({
      parameters: { target: 'different' },
    });
  });

  it.each([false, true])(
    'honors a current hook denial with an old approval wait (answered=%s)',
    async (answered) => {
      const f = await waiting();
      const executor: IHookTypeExecutor = {
        type: 'command',
        execute: vi.fn<IHookTypeExecutor['execute']>(async () => ({
          outcome: 'deny',
          source: 'command',
          reason: 'current hook denied',
        })),
      };
      const fresh = fixture([{ text: 'blocked' }], {
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'fixture' }] }] },
        hookTypeExecutors: [executor],
      });
      expect(
        await fresh.session.resumeRecoverable({
          ...f,
          toolResponses: answered
            ? [
                {
                  requestId: f.request.requestId,
                  responseId: 'reply',
                  response: { approved: true },
                },
              ]
            : [],
        }),
      ).toEqual({ status: 'completed', response: 'blocked' });
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(fresh.approval).not.toHaveBeenCalled();
      expect(f.records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
      expect(await fresh.session.resumeRecoverable(f)).toEqual({
        status: 'completed',
        response: 'blocked',
      });
    },
  );

  it('does not run completion or failure hooks while waiting', async () => {
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: vi.fn<IHookTypeExecutor['execute']>(async () => ({
        outcome: 'allow',
        source: 'command',
        stdout: '',
      })),
    };
    const f = fixture([action], {
      hooks: Object.fromEntries(
        ['Stop', 'StopFailure'].map((event) => [
          event,
          [{ matcher: '', hooks: [{ type: 'command', command: 'fixture' }] }],
        ]),
      ),
      hookTypeExecutors: [executor],
    });
    const saved = journalFixture();
    expect(
      await f.session.runRecoverable('input', { executionJournal: saved.journal }),
    ).toMatchObject({ status: 'waiting' });
    expect(executor.execute).not.toHaveBeenCalled();
  });

  it('holds the turn until pending request persistence drains after cancellation', async () => {
    const f = fixture([action, { text: 'resumed after cancellation' }]);
    const saved = journalFixture();
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const append = saved.journal.append.getMockImplementation()!;
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-wait') {
        entered();
        await released;
      }
      await append(record);
    });
    const abort = new AbortController();
    let settled = false;
    const running = f.session
      .runRecoverable('input', { executionJournal: saved.journal, signal: abort.signal })
      .finally(() => {
        settled = true;
      });
    const caught = running.catch((error: unknown) => error);
    try {
      await Promise.race([writing, caught]);
      abort.abort();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      await expect(f.session.run('interleaved')).rejects.toThrow();
    } finally {
      release();
    }
    expect(await caught).toMatchObject({ name: 'AbortError' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(saved.records.filter((record) => record.kind === 'tool-wait')).toHaveLength(1);
    await expect(f.session.run('new input')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    const pending = f.session.getPendingExecution();
    const request = saved.records.find((record) => record.kind === 'tool-wait');
    if (!pending || request?.kind !== 'tool-wait') throw new Error('Expected a discoverable wait');
    expect(pending).toEqual({
      executionId: request.executionId,
      requests: [expect.objectContaining({ requestId: request.request.requestId })],
    });
    expect(
      await f.session.resumeRecoverable({
        executionId: pending.executionId,
        journal: saved.journal,
        toolResponses: [
          {
            requestId: pending.requests[0].requestId,
            responseId: 'after-cancel',
            response: { approved: true },
          },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'resumed after cancellation' });
    expect(f.session.getPendingExecution()).toBeUndefined();
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('accepts new input after a resumed execution fails in a later provider call', async () => {
    const f = fixture([action, { text: 'next answer' }]);
    const chat = f.provider.chat.bind(f.provider);
    let calls = 0;
    f.provider.chat = async (messages, options) => {
      if (++calls === 2) throw new Error('provider offline');
      return chat(messages, options);
    };
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected wait');
    const request = first.requests[0];
    const resume = {
      executionId: request.executionId,
      journal: saved.journal,
      toolResponses: [
        { requestId: request.requestId, responseId: 'reply', response: { approved: true } },
      ],
    };
    await expect(f.session.resumeRecoverable(resume)).rejects.toThrow('provider offline');
    expect(await f.session.run('next input')).toBe('next answer');
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('keeps a saved wait pending when a resume is refused before continuing', async () => {
    const f = fixture([action, { text: 'continued' }]);
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected wait');
    const request = first.requests[0];
    await expect(
      f.session.resumeRecoverable({
        executionId: request.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: 'unknown', responseId: 'stray', response: { approved: true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(f.session.getPendingExecution()).toEqual({
      executionId: request.executionId,
      requests: [request],
    });
    await expect(f.session.run('unrelated input')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(
      await f.session.resumeRecoverable({
        executionId: request.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: request.requestId, responseId: 'reply', response: { approved: true } },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'continued' });
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('abandons a saved wait without running its effect or writing the journal', async () => {
    const f = fixture([action, { text: 'fresh answer' }]);
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected wait');
    const request = first.requests[0];
    const recorded = structuredClone(saved.records);
    expect(() => f.session.abandonPendingExecution('another-execution')).toThrow(
      expect.objectContaining({ code: 'EXECUTION_RECOVERY_CONFLICT' }),
    );
    f.session.abandonPendingExecution(request.executionId);
    expect(f.session.getPendingExecution()).toBeUndefined();
    expect(await f.session.run('new input')).toBe('fresh answer');
    expect(f.requests[1].at(-2)).toMatchObject({
      role: 'tool',
      toolCallId: request.toolCallId,
      content: expect.stringContaining('abandoned'),
    });
    await expect(
      f.session.resumeRecoverable({
        executionId: request.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: request.requestId, responseId: 'late', response: { approved: true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(saved.records).toEqual(recorded);
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.approval).not.toHaveBeenCalled();
  });

  it('honors a durably accepted denial through ordinary resume after interrupted response acceptance', async () => {
    const f = await waiting();
    const fresh = fixture([{ text: 'denied' }]);
    const abort = new AbortController();
    const append = f.journal.append.getMockImplementation()!;
    f.journal.append.mockImplementation(async (record) => {
      await append(record);
      if (record.kind === 'tool-response') abort.abort();
    });
    await expect(
      fresh.session.resumeRecoverable({
        ...f,
        signal: abort.signal,
        toolResponses: [
          { requestId: f.request.requestId, responseId: 'reply', response: { approved: false } },
        ],
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fresh.session.resume(f)).toBe('denied');
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.approval).not.toHaveBeenCalled();
  });

  it('parks without entering a body or invoking the live approval handler', async () => {
    const f = await waiting();
    expect(f.source.effect).not.toHaveBeenCalled();
    expect(f.source.approval).not.toHaveBeenCalled();
    expect(f.source.requests).toHaveLength(1);
    expect(f.request).toMatchObject({
      kind: 'robota-session/approval',
      data: { version: 1, sessionId: 'approval-session', toolName: 'act', arguments: {} },
    });
    expect(
      f.records.some(
        (record) => record.kind === 'tool-effect-start' || record.kind === 'tool-result',
      ),
    ).toBe(false);
    await f.source.session.shutdown();
    const fresh = fixture([{ text: 'must not run' }]);
    expect(await fresh.session.resumeRecoverable(f)).toMatchObject({
      status: 'waiting',
      requests: [f.request],
    });
    expect(fresh.approval).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(0);
  });

  it.each([true, false])(
    'resumes one exact action without granting session consent (approved=%s)',
    async (approved) => {
      const f = await waiting();
      const fresh = fixture([{ text: 'continued' }]);
      const options = {
        ...f,
        toolResponses: [
          { requestId: f.request.requestId, responseId: 'reply', response: { approved } },
        ],
      };
      expect(await fresh.session.resumeRecoverable(options)).toEqual({
        status: 'completed',
        response: 'continued',
      });
      expect(fresh.effect).toHaveBeenCalledTimes(approved ? 1 : 0);
      expect(fresh.approval).not.toHaveBeenCalled();
      expect(fresh.session.getSessionAllowedTools()).toEqual([]);
      expect(await fresh.session.resumeRecoverable(options)).toEqual({
        status: 'completed',
        response: 'continued',
      });
      expect(fresh.requests).toHaveLength(1);
    },
  );

  it('lets current deny rules override a saved allow response', async () => {
    const f = await waiting();
    const fresh = fixture([{ text: 'denied' }], {
      permissions: { allow: [], deny: ['act'], ask: [] },
    });
    expect(
      await fresh.session.resumeRecoverable({
        ...f,
        toolResponses: [
          { requestId: f.request.requestId, responseId: 'reply', response: { approved: true } },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'denied' });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('preserves a host denial even if the current policy becomes permissive', async () => {
    const f = await waiting();
    const fresh = fixture([{ text: 'denied' }], {
      permissionMode: 'bypassPermissions',
      permissions: { allow: ['act'], deny: [], ask: [] },
    });
    expect(
      await fresh.session.resumeRecoverable({
        ...f,
        toolResponses: [
          { requestId: f.request.requestId, responseId: 'reply', response: { approved: false } },
        ],
      }),
    ).toEqual({ status: 'completed', response: 'denied' });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('keeps ordinary live permission handling after the recoverable turn releases its claim', async () => {
    const f = fixture([action, { text: 'resumed' }, action, { text: 'ordinary result' }]);
    const saved = journalFixture();
    const waiting = await f.session.runRecoverable('first', { executionJournal: saved.journal });
    expect(waiting).toMatchObject({ status: 'waiting' });
    if (waiting.status !== 'waiting') throw new Error('Expected wait');
    await expect(f.session.run('unrelated input')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    await f.session.resumeRecoverable({
      executionId: waiting.requests[0].executionId,
      journal: saved.journal,
      toolResponses: [
        {
          requestId: waiting.requests[0].requestId,
          responseId: 'reply',
          response: { approved: true },
        },
      ],
    });
    expect(await f.session.run('next input')).toBe('ordinary result');
    expect(f.approval).toHaveBeenCalledOnce();
    expect(f.effect).toHaveBeenCalledTimes(2);
  });
});

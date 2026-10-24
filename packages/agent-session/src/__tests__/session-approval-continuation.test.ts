import { readFileSync } from 'node:fs';
import { deserializeSessionArtifact, serializeSessionArtifact } from '../session-artifact.js';
import { decodeVersionedInteractiveSessionRecord } from '../session-record-codec/index.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSessionStore } from '../session-store.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearRegisteredToolProfiles, FunctionTool, createAssistantMessage } from '@robota-sdk/agent-core';
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
/** Reject the `nth` write of `kind` from now on, once; every other write is saved as usual. */
function failWrite(
  saved: ReturnType<typeof journalFixture>,
  kind: TExecutionJournalRecord['kind'],
  nth = 1,
) {
  const append = saved.journal.append.getMockImplementation()!;
  let seen = 0;
  saved.journal.append.mockImplementation(async (record) => {
    if (record.kind === kind && ++seen === nth) throw new Error(`${kind} write failed`);
    await append(record);
  });
}
const allowed: Partial<ISessionOptions> = {
  permissions: { allow: ['act'], deny: [], ask: [] },
};
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

describe('a journaled round left open by a failure', () => {
  it('stays pending and resumes when no effect had started', async () => {
    const f = fixture([action, { text: 'continued' }], allowed);
    const saved = journalFixture();
    failWrite(saved, 'tool-intent');
    await expect(
      f.session.runRecoverable('input', { executionJournal: saved.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-intent' });
    const executionId = saved.records[0].executionId;
    expect(f.session.getPendingExecution()).toEqual({ executionId, requests: [] });
    await expect(f.session.run('unrelated input')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(f.requests).toHaveLength(1);
    expect(f.effect).not.toHaveBeenCalled();
    expect(
      await f.session.resumeRecoverable({ executionId, journal: saved.journal, toolResponses: [] }),
    ).toEqual({ status: 'completed', response: 'continued' });
    expect(f.session.getPendingExecution()).toBeUndefined();
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('never replays an effect whose result was not saved, and abandons it as unknown', async () => {
    const f = fixture([action, { text: 'fresh answer' }], allowed);
    const saved = journalFixture();
    failWrite(saved, 'tool-result');
    await expect(
      f.session.runRecoverable('input', { executionJournal: saved.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-result' });
    expect(f.effect).toHaveBeenCalledOnce();
    const executionId = saved.records[0].executionId;
    expect(f.session.getPendingExecution()).toEqual({ executionId, requests: [] });
    await expect(
      f.session.resumeRecoverable({ executionId, journal: saved.journal, toolResponses: [] }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.session.getPendingExecution()).toEqual({ executionId, requests: [] });
    f.session.abandonPendingExecution(executionId);
    expect(await f.session.run('new input')).toBe('fresh answer');
    expect(f.requests[1].at(-2)).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('outcome is unknown'),
    });
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('stays pending when a later round of its continuation fails mid-batch', async () => {
    const f = fixture([action, action, { text: 'must not run' }]);
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected wait');
    const request = first.requests[0];
    failWrite(saved, 'tool-intent');
    await expect(
      f.session.resumeRecoverable({
        executionId: request.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: request.requestId, responseId: 'reply', response: { approved: true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-intent' });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getPendingExecution()).toEqual({
      executionId: request.executionId,
      requests: [],
    });
    await expect(f.session.run('unrelated input')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(f.requests).toHaveLength(2);
  });

  it('stops reporting a wait as unstarted once a resume admitted its effect', async () => {
    const f = fixture([action, { text: 'fresh answer' }]);
    const saved = journalFixture();
    const first = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (first.status !== 'waiting') throw new Error('Expected wait');
    const request = first.requests[0];
    failWrite(saved, 'tool-result');
    await expect(
      f.session.resumeRecoverable({
        executionId: request.executionId,
        journal: saved.journal,
        toolResponses: [
          { requestId: request.requestId, responseId: 'reply', response: { approved: true } },
        ],
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-result' });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getPendingExecution()).toEqual({
      executionId: request.executionId,
      requests: [],
    });
    f.session.abandonPendingExecution(request.executionId);
    expect(await f.session.run('new input')).toBe('fresh answer');
    expect(f.requests[1].at(-2)).toMatchObject({
      role: 'tool',
      toolCallId: request.toolCallId,
      content: expect.stringContaining('outcome is unknown'),
    });
  });
});

describe('saved pending execution admission', () => {
  it.each(['ordinary', 'recoverable'])(
    'refuses %s input after a persisted wait is reconstructed',
    async (mode) => {
      const directory = mkdtempSync(join(tmpdir(), 'session-pending-'));
      try {
        const store = new NodeSessionStore(directory);
        const saved = journalFixture();
        const source = fixture([action], { sessionStore: store });
        const parked = await source.session.runRecoverable('original input', {
          executionJournal: saved.journal,
        });
        expect(parked.status).toBe('waiting');
        await source.session.shutdown();
        const loaded = store.load('approval-session');
        if (loaded.status !== 'valid') throw new Error('Expected saved conversation');
        const restored = fixture([{ text: 'must not accept new input' }], { sessionStore: store });
        restored.session.restoreConversation(loaded.record);
        const before = restored.session.getHistory();
        const result =
          mode === 'ordinary'
            ? restored.session.run('new input')
            : restored.session.runRecoverable('new input', { executionJournal: saved.journal });
        await expect(result).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
        expect(restored.requests).toHaveLength(0);
        expect(restored.session.getHistory()).toEqual(before);
        expect(restored.effect).not.toHaveBeenCalled();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe('atomic recovery checkpoints', () => {
  it('saves open intent before effects and clears the marker with the settled history', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'session-checkpoint-'));
    try {
      const store = new NodeSessionStore(directory);
      const saved = journalFixture();
      const f = fixture([action, { text: 'done' }], { ...allowed, sessionStore: store });
      f.effect.mockImplementation(async () => {
        expect(store.load('approval-session')).toMatchObject({
          status: 'valid',
          record: { pendingExecution: { requests: [] } },
        });
        return 'effect result';
      });
      await expect(
        f.session.runRecoverable('input', { executionJournal: saved.journal }),
      ).resolves.toEqual({ status: 'completed', response: 'done' });
      const loaded = store.load('approval-session');
      expect(loaded).toMatchObject({ status: 'valid' });
      if (loaded.status !== 'valid') throw new Error('Expected saved conversation');
      expect(loaded.record.pendingExecution).toBeUndefined();
      expect(loaded.record.messages.at(-1)).toMatchObject({ role: 'assistant', content: 'done' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses effects when a configured checkpoint returns a rejected Promise', async () => {
    const f = fixture([action], {
      ...allowed,
      checkpointHistory: async () => {
        throw new Error('async write rejected');
      },
    });
    await expect(
      f.session.runRecoverable('input', { executionJournal: journalFixture().journal }),
    ).rejects.toThrow('synchronously');
    expect(f.effect).not.toHaveBeenCalled();
    await expect(f.session.run('other input')).rejects.toThrow('checkpoint()');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('rejects asynchronous store acknowledgment through the lower writer', async () => {
    const store = {
      load: () => ({ status: 'missing' as const }),
      save: async () => {
        throw new Error('late failure');
      },
      list: () => [],
      delete: () => undefined,
    };
    const f = fixture([action], { ...allowed, sessionStore: store });
    await expect(
      f.session.runRecoverable('input', { executionJournal: journalFixture().journal }),
    ).rejects.toThrow('synchronously');
    expect(f.effect).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does not acknowledge waiting when its strict suspension snapshot fails', async () => {
    let session: Session;
    const f = fixture([action], {
      checkpointHistory: () => {
        if (session.getPendingExecution()?.requests.length) throw new Error('wait save failed');
      },
    });
    session = f.session;
    await expect(
      session.runRecoverable('input', { executionJournal: journalFixture().journal }),
    ).rejects.toThrow('wait save failed');
    expect(f.effect).not.toHaveBeenCalled();
    await expect(session.run('other')).rejects.toThrow('checkpoint()');
  });

  it('retries a failed completed save through checkpoint without repeating effects or model calls', async () => {
    let session: Session;
    let rejectClear = false;
    const f = fixture([action, { text: 'done' }], {
      checkpointHistory: () => {
        if (rejectClear && !session.getPendingExecution()) throw new Error('clear save failed');
      },
    });
    session = f.session;
    const saved = journalFixture();
    const parked = await session.runRecoverable('input', { executionJournal: saved.journal });
    if (parked.status !== 'waiting') throw new Error('Expected wait');
    rejectClear = true;
    const options = {
      executionId: parked.requests[0].executionId,
      journal: saved.journal,
      toolResponses: [
        {
          requestId: parked.requests[0].requestId,
          responseId: 'yes',
          response: { approved: true },
        },
      ],
    };
    await expect(session.resumeRecoverable(options)).rejects.toThrow('clear save failed');
    await expect(session.resumeRecoverable(options)).rejects.toThrow('checkpoint()');
    expect(() => session.injectMessage('user', 'mutate')).toThrow('checkpoint()');
    expect(() => session.clearHistory()).toThrow('checkpoint()');
    const before = session.getConversationSnapshot();
    const count = f.requests.length;
    rejectClear = false;
    session.checkpoint();
    session.checkpoint();
    expect(session.getConversationSnapshot()).toEqual(before);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.requests).toHaveLength(count);
    expect(() => session.assertInputAllowed()).not.toThrow();
  });

  it('retries abandonment persistence without duplicating receipts and rejects the wrong identity before saving', async () => {
    let session: Session;
    let rejectClear = false;
    const save = vi.fn(() => {
      if (rejectClear && !session.getPendingExecution()) throw new Error('abandon save failed');
    });
    const f = fixture([action], { checkpointHistory: save });
    session = f.session;
    const result = await session.runRecoverable('input', {
      executionJournal: journalFixture().journal,
    });
    if (result.status !== 'waiting') throw new Error('Expected wait');
    const id = result.requests[0].executionId;
    rejectClear = true;
    expect(() => session.abandonPendingExecution(id)).toThrow('abandon save failed');
    const snapshot = session.getConversationSnapshot();
    const saves = save.mock.calls.length;
    expect(() => session.abandonPendingExecution('wrong')).toThrow('Checkpoint');
    expect(save).toHaveBeenCalledTimes(saves);
    rejectClear = false;
    session.abandonPendingExecution(id);
    session.abandonPendingExecution(id);
    expect(session.getConversationSnapshot()).toEqual(snapshot);
    expect(snapshot.messages.filter((message) => message.role === 'tool')).toHaveLength(1);
    expect(f.effect).not.toHaveBeenCalled();
  });

  it('restores cloned discovery but never claims a restored wait proves an effect did not start', async () => {
    const source = await waiting();
    const snapshot = source.source.session.getConversationSnapshot();
    const fresh = fixture([{ text: 'new' }]);
    fresh.session.restoreConversation(snapshot);
    snapshot.messages.length = 0;
    snapshot.pendingExecution!.requests[0].data.changed = true;
    expect(fresh.session.getPendingExecution()).toEqual({
      executionId: source.executionId,
      requests: [source.request],
    });
    fresh.session.abandonPendingExecution(source.executionId);
    expect(fresh.session.getHistory().at(-1)).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('outcome is unknown'),
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('restores exact identity, retains the block after wrong answers, then resumes once', async () => {
    const source = await waiting();
    const fresh = fixture([{ text: 'finished' }]);
    fresh.session.restoreConversation(source.source.session.getConversationSnapshot());
    await expect(
      fresh.session.resumeRecoverable({ executionId: 'wrong', journal: source.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    await expect(
      fresh.session.resumeRecoverable({
        executionId: source.executionId,
        journal: source.journal,
        toolResponses: [{ requestId: 'wrong', responseId: 'bad', response: { approved: true } }],
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(() => fresh.session.assertInputAllowed()).toThrow('pending');
    expect(fresh.effect).not.toHaveBeenCalled();
    await expect(
      fresh.session.resumeRecoverable({
        executionId: source.executionId,
        journal: source.journal,
        toolResponses: [
          { requestId: source.request.requestId, responseId: 'good', response: { approved: true } },
        ],
      }),
    ).resolves.toEqual({ status: 'completed', response: 'finished' });
    expect(fresh.effect).toHaveBeenCalledOnce();
    expect(fresh.session.getPendingExecution()).toBeUndefined();
  });

  it('validates owner, workspace and complete marker before mutating pristine history', async () => {
    const source = await waiting();
    const snapshot = source.source.session.getConversationSnapshot();
    const fresh = fixture([]);
    const before = fresh.session.getHistory();
    expect(() => fresh.session.restoreConversation({ ...snapshot, id: 'other' })).toThrow('owner');
    expect(() => fresh.session.restoreConversation({ ...snapshot, cwd: '/' })).toThrow('workspace');
    const invalid = structuredClone(snapshot);
    invalid.pendingExecution!.requests[0].toolCallId = 'absent';
    expect(() => fresh.session.restoreConversation(invalid)).toThrow('Invalid');
    expect(fresh.session.getHistory()).toEqual(before);
  });
});

describe('saved recovery contract and error precedence', () => {
  it('retains the exact original execution error when the secondary save also fails', async () => {
    let rejectSave = false;
    const f = fixture([action], {
      checkpointHistory: () => {
        if (rejectSave) throw new Error('secondary save error');
      },
    });
    const saved = journalFixture();
    const parked = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (parked.status !== 'waiting') throw new Error('Expected wait');
    rejectSave = true;
    const primary = new Error('primary journal read failure');
    await expect(
      f.session.resumeRecoverable({
        executionId: parked.requests[0].executionId,
        journal: {
          ...saved.journal,
          read: async () => {
            throw primary;
          },
        },
      }),
    ).rejects.toBe(primary);
    await expect(f.session.run('other')).rejects.toThrow('checkpoint()');
    expect(f.effect).not.toHaveBeenCalled();
    rejectSave = false;
    f.session.checkpoint();
    expect(() => f.session.assertInputAllowed()).toThrow('pending');
  });

  it('current denial overrides a restored saved approval', async () => {
    const f = await waiting();
    const fresh = fixture([{ text: 'denied' }], {
      permissions: { allow: [], ask: [], deny: ['act'] },
    });
    fresh.session.restoreConversation(f.source.session.getConversationSnapshot());
    await expect(
      fresh.session.resumeRecoverable({
        executionId: f.executionId,
        journal: f.journal,
        toolResponses: [
          { requestId: f.request.requestId, responseId: 'yes', response: { approved: true } },
        ],
      }),
    ).resolves.toEqual({ status: 'completed', response: 'denied' });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.session.getPendingExecution()).toBeUndefined();
  });

  it('round-trips v2 waits through file and artifact, reads v1 without a marker, and permits multiple waits for one action', async () => {
    const f = await waiting();
    const snapshot = f.source.session.getConversationSnapshot();
    const pending = snapshot.pendingExecution!;
    snapshot.pendingExecution = {
      ...pending,
      requests: [
        ...pending.requests,
        {
          ...pending.requests[0],
          requestId: 'other-request',
          kind: 'additional-check',
          data: { extra: true },
        },
      ],
    };
    const now = new Date().toISOString();
    const record = { ...snapshot, createdAt: now, updatedAt: now };
    const directory = mkdtempSync(join(tmpdir(), 'pending-codec-'));
    try {
      const store = new NodeSessionStore(directory);
      store.save(record);
      expect(
        JSON.parse(readFileSync(join(directory, 'approval-session.json'), 'utf8')).schemaVersion,
      ).toBe(2);
      const loaded = store.load('approval-session');
      expect(loaded).toEqual({ status: 'valid', record });
      const artifact = serializeSessionArtifact(record);
      expect(deserializeSessionArtifact(artifact)).toEqual(record);
      const { pendingExecution: _pending, ...legacy } = record;
      expect(decodeVersionedInteractiveSessionRecord({ schemaVersion: 1, record: legacy })).toEqual(
        { status: 'valid', record: legacy },
      );
      expect(decodeVersionedInteractiveSessionRecord({ schemaVersion: 1, record }).status).toBe(
        'corrupt',
      );
      const duplicate = structuredClone(record);
      if (!duplicate.pendingExecution) throw new Error('Expected pending fixture');
      duplicate.pendingExecution.requests[1].requestId =
        duplicate.pendingExecution.requests[0].requestId;
      expect(
        decodeVersionedInteractiveSessionRecord({ schemaVersion: 2, record: duplicate }).status,
      ).toBe('corrupt');
      const nan = structuredClone(record);
      if (!nan.pendingExecution) throw new Error('Expected pending fixture');
      nan.pendingExecution.requests[0].data = { invalid: Number.NaN };
      expect(
        decodeVersionedInteractiveSessionRecord({ schemaVersion: 2, record: nan }).status,
      ).toBe('corrupt');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});


it('keeps retained history reads from mutating a pending conversation', async () => {
  const f = await waiting();
  const before = f.source.session.getConversationSnapshot();
  const history = f.source.session.getHistory();
  const assistant = history.findLast((message) => message.role === 'assistant');
  if (assistant?.role !== 'assistant' || !assistant.toolCalls) throw new Error('Expected open round');
  assistant.toolCalls[0].function.name = 'mutated';
  expect(f.source.session.getConversationSnapshot()).toEqual(before);
});

it('uses a configured checkpoint callback instead of also saving to the lower store', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'checkpoint-owner-'));
  try {
    const store = new NodeSessionStore(directory);
    const save = vi.spyOn(store, 'save');
    const checkpointHistory = vi.fn();
    const f = fixture([action, { text: 'done' }], { ...allowed, sessionStore: store, checkpointHistory });
    await expect(f.session.runRecoverable('input', { executionJournal: journalFixture().journal })).resolves.toMatchObject({ status: 'completed' });
    expect(checkpointHistory).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

describe('reviewed transition ownership and primary errors', () => {
  it('holds the turn claim throughout manual compaction so input cannot create a pending tail underneath it', async () => {
    const f = fixture([action, { text: 'summary' }]);
    f.session.injectMessage('user', 'old conversation');
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const chat = f.provider.chat.bind(f.provider);
    f.provider.chat = async (messages, options) => {
      if (options?.toolChoice === 'none') { entered(); await held; return createAssistantMessage('summary'); }
      return chat(messages, options);
    };
    const compacting = f.session.compact();
    await started;
    try {
      await expect(f.session.runRecoverable('concurrent input', { executionJournal: journalFixture().journal })).rejects.toMatchObject({ name: 'SessionBusyError' });
      expect(f.session.getPendingExecution()).toBeUndefined();
    } finally {
      release();
      await compacting;
    }
    expect(f.effect).not.toHaveBeenCalled();
  });

  it('preserves the exact primary journal error even when the secondary save diagnostic throws', async () => {
    const primary = new Error('original journal failure');
    const diagnostic = new Error('diagnostic sink failure');
    let rejectSave = false;
    const f = fixture([action], {
      checkpointHistory: () => { if (rejectSave) throw new Error('secondary save failure'); },
      sessionLogger: { log(_id, event, data) {
        if (event === 'error' && String(data.message).startsWith('Session checkpoint failed')) throw diagnostic;
      } },
    });
    const saved = journalFixture();
    const parked = await f.session.runRecoverable('input', { executionJournal: saved.journal });
    if (parked.status !== 'waiting') throw new Error('Expected wait');
    rejectSave = true;
    await expect(f.session.resumeRecoverable({ executionId: parked.requests[0].executionId, journal: { ...saved.journal, read: async () => { throw primary; } } })).rejects.toBe(primary);
    await expect(f.session.run('other')).rejects.toThrow('checkpoint()');
    expect(f.effect).not.toHaveBeenCalled();
    rejectSave = false;
    f.session.checkpoint();
  });
});

it.each(['wait data', 'nested metadata'])('preserves own JSON prototype-named keys in %s', async (target) => {
  const f = await waiting();
  const snapshot = f.source.session.getConversationSnapshot();
  if (!snapshot.pendingExecution) throw new Error('Expected pending snapshot');
  const payload = { ['__proto__']: { own: 'retained' }, constructor: 'ordinary JSON field', nested: { ['__proto__']: { deep: true } } };
  const scores = { ['__proto__']: 42, constructor: 8 };
  snapshot.pendingExecution.requests[0].data = payload;
  snapshot.messages[0].metadata = { scores };
  const record = { ...snapshot, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const restored = deserializeSessionArtifact(serializeSessionArtifact(record));
  const actual = target === 'wait data' ? restored.pendingExecution?.requests[0].data : restored.messages[0].metadata?.scores;
  expect(actual).toEqual(target === 'wait data' ? payload : scores);
  if (typeof actual !== 'object' || actual === null) throw new Error('Expected decoded map');
  expect(Object.hasOwn(actual, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
});

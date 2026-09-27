import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearRegisteredToolProfiles,
  FunctionTool,
  registerToolPermissionProfile,
} from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type {
  IExecutionJournal,
  IToolExecutionContext,
  TExecutionJournalRecord,
  TToolArgs,
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

function fixture(options: Partial<ISessionOptions> = {}) {
  const scripted = createScriptedProvider([{ text: 'summary' }, { text: 'answer' }]);
  const session = new Session({
    cwd: '/tmp',
    tools: [],
    systemMessage: 'Test session',
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
    ...options,
  });
  sessions.push(session);
  return { session, ...scripted };
}

const refused: IExecutionJournal = {
  append: async () => {
    throw new Error('journal unavailable');
  },
};

describe('Session execution journal', () => {
  it('refuses nested relative arguments when permission would check a different canonical value', async () => {
    registerToolPermissionProfile('PathFixture', {
      riskClass: 'modify',
      argument: { key: 'filePath', kind: 'path' },
    });
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'PathFixture', args: { filePath: '/tmp/initial.txt' } }] },
      { text: 'done' },
    ]);
    const effect = vi.fn(async () => 'effect');
    const tool = Object.assign(
      new FunctionTool(
        {
          name: 'PathFixture',
          description: 'Path',
          parameters: {
            type: 'object',
            properties: { filePath: { type: 'string' } },
            required: ['filePath'],
          },
        },
        effect,
      ),
      {
        executeWithAdmission: async (
          _parameters: TToolParameters,
          context: IToolExecutionContext,
          admit: TToolEffectAdmission,
        ) => {
          const effective = { filePath: 'effective.txt' };
          await admit(effective);
          return tool.execute(effective, context);
        },
      },
    );
    const { session } = fixture({
      provider: scripted.provider,
      tools: [tool],
      permissions: { allow: [], deny: [], ask: ['PathFixture'] },
      permissionHandler: async (_name, args) => String(args.filePath).startsWith('/tmp/'),
    });
    const records: TExecutionJournalRecord[] = [];
    await session.run('act', undefined, {
      executionJournal: {
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(effect).not.toHaveBeenCalled();
    expect(records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
  });

  it.each([false, true])(
    'composes admission and reauthorizes changed arguments (deny=%s)',
    async (deny) => {
      const scripted = createScriptedProvider([
        { toolCalls: [{ name: 'act', args: { value: 'raw' } }] },
        { text: 'done' },
      ]);
      const effect = vi.fn(async () => 'effect');
      const tool = Object.assign(
        new FunctionTool(
          {
            name: 'act',
            description: 'Act',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
            },
          },
          effect,
        ),
        {
          executeWithAdmission: async (
            parameters: TToolParameters,
            context: IToolExecutionContext,
            admit: TToolEffectAdmission,
          ) => {
            const effective = { ...parameters, value: 'effective' };
            await admit(effective);
            return tool.execute(effective, context);
          },
        },
      );
      const approval = vi.fn(
        async (_name: string, args: TToolArgs) => !(deny && args.value === 'effective'),
      );
      const { session } = fixture({
        provider: scripted.provider,
        tools: [tool],
        permissions: { allow: [], deny: [], ask: ['act'] },
        permissionHandler: approval,
      });
      const records: TExecutionJournalRecord[] = [];
      await session.run('act', undefined, {
        executionJournal: {
          append: async (record) => {
            records.push(record);
          },
        },
      });
      expect(approval).toHaveBeenCalledTimes(2);
      if (deny) {
        expect(effect).not.toHaveBeenCalled();
        expect(records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
      } else {
        expect(records.filter((record) => record.kind === 'tool-effect-start')).toMatchObject([
          { parameters: { value: 'effective' } },
        ]);
        expect(effect).toHaveBeenCalledWith({ value: 'effective' }, expect.any(Object));
      }
    },
  );

  it.each(['abort', 'mutate'] as const)(
    'isolates a start observer that tries to %s before the effect',
    async (action) => {
      const scripted = createScriptedProvider([
        { toolCalls: [{ name: 'act', args: { value: 'approved' } }] },
        { text: 'done' },
      ]);
      const abort = new AbortController();
      const effect = vi.fn(async () => 'effect');
      const { session } = fixture({
        provider: scripted.provider,
        permissions: { allow: ['act'], deny: [], ask: [] },
        onToolExecution: (event) => {
          if (event.type === 'start') {
            if (action === 'abort') abort.abort();
            else if (event.toolArgs) event.toolArgs.value = 'observer mutation';
          }
        },
        tools: [
          new FunctionTool(
            {
              name: 'act',
              description: 'Act',
              parameters: {
                type: 'object',
                properties: { value: { type: 'string' } },
              },
            },
            effect,
          ),
        ],
      });
      const records: TExecutionJournalRecord[] = [];
      const running = session.run('act', undefined, {
        signal: abort.signal,
        executionJournal: {
          append: async (record) => {
            records.push(record);
          },
        },
      });
      if (action === 'abort') {
        await expect(running).rejects.toMatchObject({ name: 'AbortError' });
        expect(effect).not.toHaveBeenCalled();
        expect(records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
      } else {
        await running;
        expect(effect).toHaveBeenCalledWith({ value: 'approved' }, expect.any(Object));
        expect(records.find((record) => record.kind === 'tool-effect-start')).toMatchObject({
          parameters: { value: 'approved' },
        });
      }
    },
  );

  it('records the canonical approved parameters at the effect boundary', async () => {
    registerToolPermissionProfile('ReadFixture', {
      riskClass: 'inspect',
      argument: { key: 'filePath', kind: 'path' },
    });
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'ReadFixture', args: { filePath: 'src/a.ts' } }] },
      { text: 'done' },
    ]);
    const effect = vi.fn(async () => 'fixture content');
    const { session } = fixture({
      provider: scripted.provider,
      permissions: { allow: ['ReadFixture'], deny: [], ask: [] },
      tools: [
        new FunctionTool(
          {
            name: 'ReadFixture',
            description: 'Fixture',
            parameters: {
              type: 'object',
              properties: { filePath: { type: 'string' } },
              required: ['filePath'],
            },
          },
          effect,
        ),
      ],
    });
    const records: TExecutionJournalRecord[] = [];
    await session.run('read', undefined, {
      executionJournal: {
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(records.find((r) => r.kind === 'tool-intent')).toMatchObject({
      parameters: { filePath: 'src/a.ts' },
    });
    expect(records.find((r) => r.kind === 'tool-effect-start')).toMatchObject({
      parameters: { filePath: '/tmp/src/a.ts' },
    });
    expect(effect).toHaveBeenCalledWith({ filePath: '/tmp/src/a.ts' }, expect.any(Object));
  });

  it('does not admit a tool when cancellation arrives with the permission response', async () => {
    const abort = new AbortController();
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'act', args: {} }] }]);
    const effect = vi.fn(async () => 'effect');
    const { session } = fixture({
      provider: scripted.provider,
      permissions: { allow: [], deny: [], ask: ['act'] },
      permissionHandler: async () => {
        abort.abort();
        return true;
      },
      tools: [
        new FunctionTool(
          { name: 'act', description: 'Act', parameters: { type: 'object', properties: {} } },
          effect,
        ),
      ],
    });
    const records: TExecutionJournalRecord[] = [];
    await expect(
      session.run('act', undefined, {
        signal: abort.signal,
        executionJournal: {
          append: async (record) => {
            records.push(record);
          },
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(effect).not.toHaveBeenCalled();
    expect(records.some((record) => record.kind === 'tool-effect-start')).toBe(false);
    expect(scripted.requests).toHaveLength(1);
  });

  it.each([false, true])(
    'records effect-start only after fresh permission, and fails closed (reject=%s)',
    async (reject) => {
      const order: string[] = [];
      const scripted = createScriptedProvider([
        { toolCalls: [{ name: 'act', args: {} }] },
        { text: 'done' },
      ]);
      const effect = vi.fn(async () => {
        order.push('effect');
        return 'effect';
      });
      const approval = vi.fn(async () => {
        order.push('permission');
        return true;
      });
      const { session } = fixture({
        provider: scripted.provider,
        permissions: { allow: [], deny: [], ask: ['act'] },
        permissionHandler: approval,
        tools: [
          new FunctionTool(
            { name: 'act', description: 'Act', parameters: { type: 'object', properties: {} } },
            effect,
          ),
        ],
      });
      const running = session.run('act', undefined, {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-effect-start') {
              order.push('journal');
              if (reject) throw new Error('effect write failed');
            }
          },
        },
      });
      if (reject) {
        await expect(running).rejects.toMatchObject({
          code: 'EXECUTION_JOURNAL_FAILED',
          kind: 'tool-effect-start',
        });
        expect(order).toEqual(['permission', 'journal']);
        expect(effect).not.toHaveBeenCalled();
        expect(scripted.requests).toHaveLength(1);
      } else {
        await running;
        expect(order).toEqual(['permission', 'journal', 'effect']);
      }
    },
  );

  it('preserves the journal error when diagnostic logging also fails', async () => {
    const { session, requests } = fixture({
      sessionLogger: {
        log: (_id, event) => {
          if (event === 'error') throw new Error('logger failure');
        },
      },
    });
    await expect(
      session.run('first', undefined, { executionJournal: refused }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
      cause: { message: 'journal unavailable' },
    });
    expect(requests).toHaveLength(0);
  });

  it('preserves an ordinary provider error when diagnostic logging also fails', async () => {
    const { session, provider } = fixture({
      sessionLogger: {
        log: (_id, event) => {
          if (event === 'error') throw new Error('logger failure');
        },
      },
    });
    const failure = new Error('provider failed');
    provider.chat = async () => {
      throw failure;
    };
    await expect(session.run('first')).rejects.toBe(failure);
  });

  it('attributes compaction to the initial and final resolved model routes', async () => {
    const { session, provider, chatOptions } = fixture();
    session.injectMessage('user', 'Context');
    provider.resolveModelRoute = vi.fn(() => ({
      provider: 'initial-provider',
      model: 'initial-model',
    }));
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      options?.onModelFallback?.({
        from: { provider: 'initial-provider', model: 'initial-model' },
        to: { provider: 'final-provider', model: 'final-model' },
        reason: 'rate-limit',
      });
      return chat(messages, options);
    };
    const records: TExecutionJournalRecord[] = [];
    await session.compact(undefined, 'manual', undefined, {
      append: async (record) => {
        records.push(record);
      },
    });
    expect(records[0]).toMatchObject({
      kind: 'model-request',
      providerId: 'initial-provider',
      modelId: 'initial-model',
    });
    expect(records[1]).toMatchObject({
      kind: 'model-response',
      providerId: 'final-provider',
      modelId: 'final-model',
    });
    expect(chatOptions[0]?.executionId).toBe(records[0].executionId);
    expect(records[1].executionId).toBe(records[0].executionId);
    expect(provider.resolveModelRoute).toHaveBeenCalledWith('test-model', records[0].executionId);
  });

  it('refuses a turn before dispatch and does not retain its journal for the next turn', async () => {
    const { session, requests } = fixture();
    await expect(
      session.run('first', undefined, { executionJournal: refused }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(requests).toHaveLength(0);
    await expect(session.run('second')).resolves.toBe('summary');
    expect(requests).toHaveLength(1);
  });

  it.each(['model-request', 'model-response'])(
    'journals automatic compaction and preserves history on %s rejection',
    async (kind) => {
      const { session, requests } = fixture({ contextMaxTokens: 100, autoCompactThreshold: 0.5 });
      session.injectMessage('user', 'Long context. '.repeat(100));
      const before = session.getHistory();
      const journal: IExecutionJournal = {
        append: async (record) => {
          if (record.kind === kind) throw new Error('compaction write failed');
        },
      };
      await expect(
        session.run('continue', undefined, { executionJournal: journal }),
      ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
      expect(requests).toHaveLength(kind === 'model-request' ? 0 : 1);
      expect(session.getHistory()).toEqual(before);
    },
  );

  it('refuses new input over a tool round a journal failure left open until it is abandoned', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'after abandon' },
    ]);
    const effect = vi.fn(async () => 'effect');
    const { session } = fixture({
      provider: scripted.provider,
      permissions: { allow: ['act'], deny: [], ask: [] },
      tools: [
        new FunctionTool(
          { name: 'act', description: 'Act', parameters: { type: 'object', properties: {} } },
          effect,
        ),
      ],
    });
    const records: TExecutionJournalRecord[] = [];
    await expect(
      session.run('act', undefined, {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-result') throw new Error('result write failed');
            records.push(record);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-result' });
    const executionId = records[0].executionId;
    expect(session.getPendingExecution()).toEqual({ executionId, requests: [] });
    await expect(session.run('next')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(scripted.requests).toHaveLength(1);
    session.abandonPendingExecution(executionId);
    expect(await session.run('next')).toBe('after abandon');
    expect(scripted.requests[1].at(-2)).toMatchObject({
      role: 'tool',
      content: expect.stringContaining('outcome is unknown'),
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it('journals manual compaction before replacing history', async () => {
    const { session } = fixture();
    session.injectMessage('user', 'Something to summarize.');
    const records: TExecutionJournalRecord[] = [];
    await session.compact(undefined, 'manual', undefined, {
      append: async (record) => {
        expect(
          session.getHistory().some((message) => message.content === 'Something to summarize.'),
        ).toBe(true);
        records.push(record);
      },
    });
    expect(records.map((record) => record.kind)).toEqual(['model-request', 'model-response']);
    expect(session.getHistory().at(-1)?.content).toBe('[Context Summary]\nsummary');
  });

  it('keeps existing permission denial inside the journaled tool boundary', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'denied' },
    ]);
    const effect = vi.fn(async () => 'effect');
    const approval = vi.fn(async () => false);
    const { session } = fixture({
      provider: scripted.provider,
      permissions: { allow: [], deny: [], ask: ['act'] },
      permissionHandler: approval,
      tools: [
        new FunctionTool(
          {
            name: 'act',
            description: 'Test action',
            parameters: { type: 'object', properties: {} },
          },
          effect,
        ),
      ],
    });
    const records: TExecutionJournalRecord[] = [];
    await session.run('act', undefined, {
      executionJournal: {
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(approval).toHaveBeenCalledOnce();
    expect(effect).not.toHaveBeenCalled();
    expect(records.filter((record) => record.kind === 'tool-intent')).toHaveLength(1);
    expect(records.filter((record) => record.kind === 'tool-effect-start')).toHaveLength(0);
    expect(records.filter((record) => record.kind === 'tool-result')).toHaveLength(1);
  });
});

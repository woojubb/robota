import { afterEach, describe, expect, it, vi } from 'vitest';
import { FunctionTool } from '@robota-sdk/agent-core';
import type {
  IManagedRunProvider,
  IManagedTurnHost,
  TExecutionJournalRecord,
  TManagedToolBatch,
  TManagedTurnEvent,
  TManagedTurnResult,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { Session } from '../session.js';
import { SessionBusyError } from '../turn-claim.js';
import type { ISessionOptions } from '../session-types.js';

const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
});

function frame(id: string, calls: Array<[string, number]>): TManagedToolBatch {
  return {
    id,
    role: 'assistant',
    content: '',
    state: 'complete',
    timestamp: new Date(),
    toolCalls: calls.map(([callId, value]) => ({
      id: callId,
      type: 'function' as const,
      function: { name: 'act', arguments: JSON.stringify({ value }) },
    })) as TManagedToolBatch['toolCalls'],
  };
}

function fixture(
  run: IManagedRunProvider['run'],
  options: Partial<
    Pick<
      ISessionOptions,
      | 'permissions'
      | 'permissionHandler'
      | 'checkpointHistory'
      | 'hooks'
      | 'hookTypeExecutors'
      | 'permissionMode'
      | 'onTextDelta'
    >
  > = {},
) {
  const records: TExecutionJournalRecord[] = [];
  const journal = {
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      const prior = records.find((saved) => saved.recordId === record.recordId);
      if (prior) expect(record).toEqual(prior);
      else records.push(structuredClone(record));
    }),
    read: vi.fn(async (executionId: string) =>
      structuredClone(records.filter((record) => record.executionId === executionId)),
    ),
  };
  const provider: IManagedRunProvider = {
    kind: 'managed-run',
    name: 'managed-fixture',
    version: 'fixture',
    validateConfig: () => true,
    run: vi.fn(run),
  };
  const effect = vi.fn(async (value: number) => `effect:${value}`);
  const session = new Session({
    cwd: '/tmp',
    sessionId: 'managed-session',
    model: 'fixture-model',
    provider,
    systemMessage: 'Fixture',
    autoCompactThreshold: false,
    hookTypeExecutors: [],
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
        {
          name: 'act',
          description: 'Record a fixture action',
          parameters: { type: 'object', properties: { value: { type: 'number' } } },
        },
        async (parameters) => effect(Number(parameters.value)),
      ),
    ],
    permissions: { allow: ['act'], deny: [], ask: [] },
    toolExecutionPolicy: (calls) => ({
      mode: 'parallel',
      maxConcurrency: 2,
      scheduling: new Map(
        calls.map((call, index) => [
          call.id,
          { resources: [], ...(index === 1 && { dependsOn: [calls[0].id] }) },
        ]),
      ),
    }),
    ...options,
  });
  sessions.push(session);
  return { session, provider, effect, journal, records };
}

describe('managed Session turn', () => {
  it('runs two complete tool frames through durable Session authority and closes retained callbacks', async () => {
    let retained!: IManagedTurnHost['execute'];
    const f = fixture(async (input, host) => {
      retained = host.execute;
      expect(input.messages.map((message) => message.role)).toEqual(['system', 'user']);
      expect(input.tools.map((tool) => tool.name)).toEqual(['act']);
      const first = await host.execute(
        frame('first-frame', [
          ['first-call', 1],
          ['second-call', 2],
        ]),
      );
      expect(first.map((receipt) => receipt.result.result)).toEqual(['effect:1', 'effect:2']);
      await host.emit({
        kind: 'usage',
        frameId: 'final-frame',
        usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      });
      const second = await host.execute(frame('second-frame', [['third-call', 3]]));
      expect(second[0].result.result).toBe('effect:3');
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'done',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    const result = await f.session.runRecoverable('perform actions', {
      executionJournal: f.journal,
    });
    expect(result).toEqual({ status: 'completed', response: 'done' });
    expect(f.effect).toHaveBeenCalledTimes(3);
    expect(f.records.filter((record) => record.kind === 'managed-frame')).toHaveLength(2);
    expect(f.records.filter((record) => record.kind === 'tool-effect-start')).toHaveLength(3);
    expect(f.records.filter((record) => record.kind === 'tool-result')).toHaveLength(3);
    expect(f.session.getHistory().map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(f.session.getHistory().at(-1)?.metadata?.['usage']).toEqual({
      promptTokens: 3,
      completionTokens: 2,
      totalTokens: 5,
    });
    await expect(retained(frame('late-frame', [['late-call', 4]]))).rejects.toBeDefined();
    expect(f.effect).toHaveBeenCalledTimes(3);
    await expect(
      f.session.runRecoverable('continue', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.provider.run).toHaveBeenCalledOnce();
  });

  it('rejects a provider success that hid a conflicting host action', async () => {
    const f = fixture(async (_input, host) => {
      await host.execute(frame('first-frame', [['first-call', 1]]));
      try {
        await host.execute(frame('first-frame', [['first-call', 9]]));
      } catch {
        // The fixture intentionally swallows its host error.
      }
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'false success',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getHistory().at(-1)?.content).not.toBe('false success');
  });

  it('checkpoints the user and complete assistant intent before an effect', async () => {
    const saved: TUniversalMessage[][] = [];
    const f = fixture(
      async (_input, host) => {
        await host.execute(frame('first-frame', [['first-call', 1]]));
        return {
          id: 'final-frame',
          role: 'assistant',
          content: 'done',
          state: 'complete',
          timestamp: new Date(),
        };
      },
      { checkpointHistory: () => void saved.push(structuredClone(f.session.getHistory())) },
    );
    f.effect.mockImplementation(async () => {
      expect(saved.at(-1)?.at(-1)).toMatchObject({
        role: 'assistant',
        toolCalls: [{ id: 'first-call' }],
      });
      return 'effect';
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).resolves.toEqual({ status: 'completed', response: 'done' });
    expect(saved.some((messages) => messages.at(-1)?.role === 'user')).toBe(true);
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('refuses a final frame that tries to submit unjournaled tool calls', async () => {
    const f = fixture(
      async () =>
        ({
          ...frame('invalid-final', [['hidden-call', 1]]),
          content: 'pretend the action ran',
        }) as unknown as TManagedTurnResult,
    );
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(0);
  });

  it('rejects a final frame that reuses a committed tool-frame identity', async () => {
    const f = fixture(async (_input, host) => {
      await host.execute(frame('shared-frame', [['first-call', 1]]));
      return {
        id: 'shared-frame',
        role: 'assistant',
        content: 'ambiguous final',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getHistory().at(-1)?.content).not.toBe('ambiguous final');
  });

  it('refuses an unsupported peer capability before invoking the provider', async () => {
    const run = vi.fn<IManagedRunProvider['run']>();
    const hook = vi.fn(async () => ({
      outcome: 'allow' as const,
      source: 'command' as const,
      stdout: '',
    }));
    const f = fixture(run, {
      hooks: {
        UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: 'fixture' }] }],
      },
      hookTypeExecutors: [{ type: 'command', execute: hook }],
    });
    await expect(
      f.session.runRecoverable('perform actions', {
        executionJournal: f.journal,
        peerTurn: true,
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(run).not.toHaveBeenCalled();
    expect(hook).not.toHaveBeenCalled();
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(0);
  });

  it('refuses model-backed hooks without an isolated helper route', async () => {
    const run = vi.fn<IManagedRunProvider['run']>();
    const helper = vi.fn(async () => ({
      outcome: 'allow' as const,
      source: 'prompt' as const,
      stdout: '',
    }));
    const f = fixture(run, {
      hooks: { UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'Check' }] }] },
      hookTypeExecutors: [{ type: 'prompt', execute: helper }],
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(helper).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('holds the turn claim while an aborted host action settles', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const f = fixture(async (_input, host) => {
      await host.execute(frame('first-frame', [['first-call', 1]]));
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'should not finish',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    f.effect.mockImplementation(async (value) => {
      entered();
      await gate;
      return `effect:${value}`;
    });
    const running = f.session.runRecoverable('perform actions', { executionJournal: f.journal });
    const rejected = expect(running).rejects.toBeDefined();
    await started;
    f.session.abort();
    expect(f.session.isRunning()).toBe(true);
    await expect(
      f.session.runRecoverable('other turn', { executionJournal: f.journal }),
    ).rejects.toBeInstanceOf(SessionBusyError);
    release();
    await rejected;
    expect(f.session.isRunning()).toBe(false);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getHistory().at(-1)?.content).not.toBe('should not finish');
  });

  it('waits for an unawaited tool frame before rejecting a premature final answer', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const f = fixture(async (_input, host) => {
      void host.execute(frame('first-frame', [['first-call', 1]])).catch(() => {});
      await started;
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'premature',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    f.effect.mockImplementation(async (value) => {
      entered();
      await gate;
      return `effect:${value}`;
    });
    const running = f.session.runRecoverable('perform actions', { executionJournal: f.journal });
    const rejected = expect(running).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    await started;
    expect(f.session.isRunning()).toBe(true);
    release();
    await rejected;
    expect(f.session.isRunning()).toBe(false);
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getHistory().at(-1)?.content).not.toBe('premature');
  });

  it('stops dependent admissions when a provider event violates the host contract', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const f = fixture(async (_input, host) => {
      const pending = host.execute(
        frame('first-frame', [
          ['first-call', 1],
          ['second-call', 2],
        ]),
      );
      await started;
      await host
        .emit({
          kind: 'usage',
          frameId: 'bad-usage',
          usage: { promptTokens: -1, completionTokens: 1, totalTokens: 0 },
        })
        .catch(() => {});
      release();
      await pending.catch(() => {});
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'false success',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    f.effect.mockImplementation(async (value) => {
      if (value === 1) {
        entered();
        await gate;
      }
      return `effect:${value}`;
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      message: 'Managed provider emitted invalid usage',
    });
    expect(f.effect).toHaveBeenCalledOnce();
    expect(f.session.getHistory().at(-1)?.content).not.toBe('false success');
  });

  it('refuses transient text output until interrupted frames can be saved', async () => {
    const onTextDelta = vi.fn();
    const f = fixture(
      async (_input, host) => {
        await host
          .emit({
            kind: 'text-delta',
            frameId: 'final-frame',
            text: 'partial',
          } as unknown as TManagedTurnEvent)
          .catch(() => {});
        return {
          id: 'final-frame',
          role: 'assistant',
          content: 'false success',
          state: 'complete',
          timestamp: new Date(),
        };
      },
      { onTextDelta },
    );
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(onTextDelta).not.toHaveBeenCalled();
  });

  it('rejects usage duplicated on a tool frame and the host event channel', async () => {
    const f = fixture(async (_input, host) => {
      const batch = frame('first-frame', [['first-call', 1]]);
      batch.metadata = { usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 } };
      await host.execute(batch).catch(() => {});
      await host
        .emit({
          kind: 'usage',
          frameId: 'first-frame',
          usage: { promptTokens: 2, completionTokens: 1, totalTokens: 3 },
        })
        .catch(() => {});
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'false success',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(0);
  });

  it('does not commit a final answer when cancellation arrives during the final journal read', async () => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => (entered = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let providerReturned = false;
    const f = fixture(async () => {
      providerReturned = true;
      return {
        id: 'final-frame',
        role: 'assistant',
        content: 'must not commit',
        state: 'complete',
        timestamp: new Date(),
      };
    });
    const read = f.journal.read.getMockImplementation()!;
    f.journal.read.mockImplementation(async (executionId) => {
      if (providerReturned) {
        entered();
        await gate;
      }
      return read(executionId);
    });
    const running = f.session.runRecoverable('perform actions', { executionJournal: f.journal });
    const rejected = expect(running).rejects.toBeDefined();
    await started;
    f.session.abort();
    release();
    await rejected;
    expect(f.session.getHistory().some((message) => message.content === 'must not commit')).toBe(
      false,
    );
  });

  it('does not claim an approval wait can resume an unqualified native runtime', async () => {
    const f = fixture(
      async (_input, host) => {
        await host.execute(frame('first-frame', [['first-call', 1]]));
        return {
          id: 'final-frame',
          role: 'assistant',
          content: 'should not finish',
          state: 'complete',
          timestamp: new Date(),
        };
      },
      {
        permissions: { allow: [], deny: [], ask: ['act'] },
        permissionHandler: vi.fn(async () => true),
      },
    );
    await expect(
      f.session.runRecoverable('perform actions', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.records.some((record) => record.kind === 'tool-intent')).toBe(true);
  });
});

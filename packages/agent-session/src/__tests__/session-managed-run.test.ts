import { afterEach, describe, expect, it, vi } from 'vitest';
import { FunctionTool, ManagedHelperProviderError } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IManagedRunProvider,
  IManagedTurnHost,
  TExecutionJournalRecord,
  TManagedToolBatch,
  TManagedTurnEvent,
  TManagedTurnResult,
  IManagedTurnInput,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { Session } from '../session.js';
import { SessionBusyError } from '../turn-claim.js';
import { MANAGED_AUTO_REFUSAL } from '../managed-helper.js';
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
      | 'contextMaxTokens'
      | 'autoCompactThreshold'
      | 'permissionClassifier'
      | 'permissionClassifierFromHelper'
      | 'helperProvider'
    >
  > = {},
  continuation?: IManagedRunProvider['continuation'],
  isolatesHelperRequests?: true,
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
    ...(continuation ? { continuation } : {}),
    ...(isolatesHelperRequests ? { isolatesHelperRequests } : {}),
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
  it('requires committed conversation storage before starting a live native connection', async () => {
    const f = fixture(
      async () => {
        throw new Error('Native process must not run');
      },
      {},
      'live-process',
    );
    await expect(
      f.session.runRecoverable('first', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      message: 'Managed live continuation requires a committed conversation store',
    });
    expect(f.provider.run).not.toHaveBeenCalled();
  });

  it('continues only the exact live provider and committed action frontier', async () => {
    const seen: IManagedTurnInput[] = [];
    const f = fixture(
      async (input, host) => {
        seen.push(input);
        if (seen.length === 1) await host.execute(frame('live-frame', [['live-call', 1]]));
        return {
          id: `live-final-${seen.length}`,
          role: 'assistant',
          content: `answer-${seen.length}`,
          timestamp: new Date(),
          state: 'complete',
        };
      },
      { checkpointHistory: () => {} },
      'live-process',
    );
    expect(await f.session.runRecoverable('first', { executionJournal: f.journal })).toEqual({
      status: 'completed',
      response: 'answer-1',
    });
    expect(await f.session.runRecoverable('second', { executionJournal: f.journal })).toEqual({
      status: 'completed',
      response: 'answer-2',
    });
    expect(seen).toHaveLength(2);
    expect(seen[0].binding).toMatchObject({
      sessionId: 'managed-session',
      revision: 0,
      actionFrontier: [],
    });
    expect(seen[1].binding).toMatchObject({
      sessionId: 'managed-session',
      connectionId: seen[0].binding.connectionId,
      revision: 1,
      actionFrontier: [expect.any(String)],
    });
    expect(seen[1].messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
    ]);
    expect(f.effect).toHaveBeenCalledTimes(1);
  });

  it('refuses a reconstructed Session without the live connection', async () => {
    const f = fixture(
      async () => ({
        id: 'live-answer',
        role: 'assistant',
        content: 'done',
        timestamp: new Date(),
        state: 'complete',
      }),
      { checkpointHistory: () => {} },
      'live-process',
    );
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    const restored = fixture(
      async () => {
        throw new Error('Native process must not run');
      },
      { checkpointHistory: () => {} },
      'live-process',
    );
    restored.session.restoreConversation(f.session.getConversationSnapshot());
    await expect(
      restored.session.runRecoverable('second', { executionJournal: restored.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      message: 'Managed live continuation has ended and cannot be rebuilt from history',
    });
    expect(restored.provider.run).not.toHaveBeenCalled();
  });

  it('poisons a live connection after an uncommitted provider failure', async () => {
    let calls = 0;
    const f = fixture(
      async () => {
        calls += 1;
        if (calls === 2) throw new Error('native process lost');
        return {
          id: 'first-live-answer',
          role: 'assistant',
          content: 'done',
          timestamp: new Date(),
          state: 'complete',
        };
      },
      { checkpointHistory: () => {} },
      'live-process',
    );
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toThrow('native process lost');
    await expect(
      f.session.runRecoverable('third', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      message: 'A previous managed native connection ended without a committed continuation',
    });
    expect(calls).toBe(2);
  });

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
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      message: 'Managed provider cannot continue an existing conversation',
    });
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

function finalFrame(id: string, content: string): TManagedTurnResult {
  return { id, role: 'assistant', content, timestamp: new Date(), state: 'complete' };
}

describe('managed continuation binding', () => {
  const live = (run: IManagedRunProvider['run']) =>
    fixture(run, { checkpointHistory: () => {} }, 'live-process');
  const ended = 'Managed live continuation has ended and cannot be rebuilt from history';

  it('records a committed turn even when the journal cannot be read afterwards', async () => {
    const seen: IManagedTurnInput[] = [];
    let committed = false;
    const f = fixture(
      async (input, host) => {
        seen.push(input);
        if (seen.length === 1) await host.execute(frame('read-frame', [['read-call', 1]]));
        return finalFrame(`read-final-${seen.length}`, `answer-${seen.length}`);
      },
      {
        checkpointHistory: () => {
          if (f.session.getHistory().at(-1)?.content === 'answer-1') committed = true;
        },
      },
      'live-process',
    );
    const read = f.journal.read.getMockImplementation()!;
    f.journal.read.mockImplementation(async (executionId) => {
      if (committed) throw new Error('journal unreadable after commit');
      return read(executionId);
    });
    await expect(
      f.session.runRecoverable('first', { executionJournal: f.journal }),
    ).resolves.toEqual({ status: 'completed', response: 'answer-1' });
    f.journal.read.mockImplementation(read);
    await f.session.runRecoverable('second', { executionJournal: f.journal });
    expect(seen[1].binding).toMatchObject({ revision: 1, actionFrontier: [expect.any(String)] });
  });

  it('does not lock a fresh-only provider out after a failed turn', async () => {
    let calls = 0;
    const f = fixture(async () => {
      calls += 1;
      if (calls === 1) throw new Error('first turn failed');
      return finalFrame(`fresh-final-${calls}`, `answer-${calls}`);
    });
    await expect(
      f.session.runRecoverable('first', { executionJournal: f.journal }),
    ).rejects.toThrow('first turn failed');
    f.session.clearHistory();
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).resolves.toEqual({ status: 'completed', response: 'answer-2' });
  });

  it('starts a new connection and clears the poison when only system messages remain', async () => {
    const seen: IManagedTurnInput[] = [];
    const f = live(async (input) => {
      seen.push(input);
      if (seen.length === 2) throw new Error('native process lost');
      return finalFrame(`fresh-connection-${seen.length}`, `answer-${seen.length}`);
    });
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toThrow('native process lost');
    f.session.clearHistory();
    f.session.injectMessage('system', 'Fixture');
    await f.session.runRecoverable('third', { executionJournal: f.journal });
    expect(seen).toHaveLength(3);
    expect(seen[2].binding.revision).toBe(0);
    expect(seen[2].binding.connectionId).not.toBe(seen[0].binding.connectionId);
  });

  it('refuses compaction under a managed provider without ending the connection', async () => {
    const seen: IManagedTurnInput[] = [];
    const f = live(async (input) => {
      seen.push(input);
      return finalFrame(`compact-final-${seen.length}`, `answer-${seen.length}`);
    });
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(f.session.compact()).rejects.toMatchObject({
      code: 'MANAGED_RUN_UNAVAILABLE',
      message: expect.stringContaining(
        'Managed execution is not available for provider managed-fixture: compaction would replace',
      ),
    });
    await f.session.runRecoverable('second', { executionJournal: f.journal });
    expect(seen[1].binding).toMatchObject({
      connectionId: seen[0].binding.connectionId,
      revision: 1,
    });
  });

  it('refuses a continuation frame that reuses an earlier turn frame identity', async () => {
    let turn = 0;
    const f = live(async (_input, host) => {
      turn += 1;
      await host.execute(frame('shared-frame', [[`call-${turn}`, turn]]));
      return finalFrame(`reuse-final-${turn}`, `answer-${turn}`);
    });
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
      message: 'Managed continuation frame reused an earlier turn frame identity',
    });
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('refuses a continuation frame that reuses an earlier turn native call identity', async () => {
    let turn = 0;
    const f = live(async (_input, host) => {
      turn += 1;
      await host.execute(frame(`frame-${turn}`, [['shared-call', turn]]));
      return finalFrame(`reuse-final-${turn}`, `answer-${turn}`);
    });
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
      message: 'Managed continuation frame reused an earlier turn native call identity',
    });
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('ends continuation on explicit invalidation', async () => {
    let turn = 0;
    const f = live(async () => finalFrame(`invalid-final-${++turn}`, 'done'));
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    f.session.invalidateManagedContinuation();
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ message: ended });
    expect(f.provider.run).toHaveBeenCalledOnce();
  });

  it('does not record a continuation for a turn invalidated while it ran', async () => {
    let turn = 0;
    const f = live(async () => {
      turn += 1;
      if (turn === 2) f.session.invalidateManagedContinuation();
      return finalFrame(`mid-final-${turn}`, `answer-${turn}`);
    });
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await f.session.runRecoverable('second', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('third', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(turn).toBe(2);
  });

  it('ends continuation on a model swap', async () => {
    let turn = 0;
    const f = live(async () => finalFrame(`model-final-${++turn}`, 'done'));
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await f.session.applyModelOptions({ model: 'other-model' });
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ message: ended });
  });

  it('ends continuation on a provider swap', async () => {
    let turn = 0;
    const f = live(async () => finalFrame(`swap-final-${++turn}`, 'done'));
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    const other = fixture(async () => finalFrame('other-final', 'other'), {}, 'live-process');
    f.session.swapProvider(other.provider, 'fixture-model');
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ message: ended });
    expect(other.provider.run).not.toHaveBeenCalled();
  });

  it('ends continuation on a history replacement and refuses an unnoticed history edit', async () => {
    let turn = 0;
    const f = live(async () => finalFrame(`edit-final-${++turn}`, 'done'));
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    f.session.injectMessage('user', 'smuggled');
    await expect(
      f.session.runRecoverable('second', { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      message: 'Managed continuation history differs from the committed host prefix',
    });
    f.session.clearHistory();
    f.session.injectMessage('user', 'replacement');
    await expect(
      f.session.runRecoverable('third', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ message: ended });
    expect(f.provider.run).toHaveBeenCalledOnce();
  });
});

describe('refusals before native input', () => {
  it('keeps the connection after automatic compaction is refused', async () => {
    const seen: IManagedTurnInput[] = [];
    const f = fixture(
      async (input) => {
        seen.push(input);
        return finalFrame(`auto-compact-final-${seen.length}`, `answer-${seen.length}`);
      },
      { checkpointHistory: () => {}, contextMaxTokens: 600, autoCompactThreshold: 0.5 },
      'live-process',
    );
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    await expect(
      f.session.runRecoverable('long '.repeat(400), { executionJournal: f.journal }),
    ).rejects.toMatchObject({
      code: 'MANAGED_RUN_UNAVAILABLE',
      message: expect.stringContaining(
        'Managed execution is not available for provider managed-fixture: compaction would replace',
      ),
    });
    expect(seen).toHaveLength(1);
    await f.session.runRecoverable('third', { executionJournal: f.journal });
    expect(seen[1].binding).toMatchObject({
      connectionId: seen[0].binding.connectionId,
      revision: 1,
    });
  });

  it('keeps the connection after auto permission mode is refused', async () => {
    const seen: IManagedTurnInput[] = [];
    const f = fixture(
      async (input) => {
        seen.push(input);
        return finalFrame(`auto-mode-final-${seen.length}`, `answer-${seen.length}`);
      },
      { checkpointHistory: () => {}, permissionClassifier: { classify: vi.fn() } as never },
      'live-process',
    );
    await f.session.runRecoverable('first', { executionJournal: f.journal });
    expect(() => f.session.setPermissionMode('auto')).toThrow(MANAGED_AUTO_REFUSAL);
    await f.session.runRecoverable('third', { executionJournal: f.journal });
    expect(seen).toHaveLength(2);
    expect(seen[1].binding).toMatchObject({
      connectionId: seen[0].binding.connectionId,
      revision: 1,
    });
  });
});

describe('managed helper isolation', () => {
  const modelStepHelper = (): IAIProvider =>
    ({ name: 'helper', version: 'h', chat: vi.fn(), validateConfig: () => true }) as never;

  it('refuses a managed provider as the helper with a typed error', () => {
    const managedHelper = { kind: 'managed-run', name: 'other-managed' } as never;
    expect(() =>
      fixture(async () => finalFrame('x', 'y'), { helperProvider: managedHelper }),
    ).toThrow(ManagedHelperProviderError);
  });

  it('exposes the explicit helper and never invents one', () => {
    const helper = modelStepHelper();
    expect(
      fixture(async () => finalFrame('x', 'y'), {
        helperProvider: helper,
      }).session.getHelperProvider(),
    ).toBe(helper);
    expect(fixture(async () => finalFrame('x', 'y')).session.getHelperProvider()).toBeUndefined();
  });

  it('refuses auto without an isolated classifier and says what to configure', () => {
    const classifier = { classify: vi.fn() } as never;
    const notDeclared = fixture(async () => finalFrame('x', 'y'), {
      permissionClassifier: classifier,
      permissionClassifierFromHelper: true,
    });
    expect(() => notDeclared.session.setPermissionMode('auto')).toThrow(/helperProvider/);
    const notFromHelper = fixture(
      async () => finalFrame('x', 'y'),
      { permissionClassifier: classifier },
      undefined,
      true,
    );
    expect(() => notFromHelper.session.setPermissionMode('auto')).toThrow(/isolatesHelperRequests/);
    const noClassifier = fixture(async () => finalFrame('x', 'y'), {}, undefined, true);
    expect(() => noClassifier.session.setPermissionMode('auto')).toThrow(MANAGED_AUTO_REFUSAL);
  });

  it('judges tool calls with the isolated classifier in auto mode', async () => {
    const classify = vi.fn(async () => ({ decision: 'allow' as const, reason: 'safe' }));
    const f = fixture(
      async (_input, host) => {
        await host.execute(frame('auto-frame', [['auto-call', 1]]));
        return finalFrame('auto-final', 'done');
      },
      {
        permissions: { allow: [], deny: [], ask: [] },
        permissionClassifier: { classify } as never,
        permissionClassifierFromHelper: true,
      },
      undefined,
      true,
    );
    f.session.setPermissionMode('auto');
    await expect(f.session.runRecoverable('go', { executionJournal: f.journal })).resolves.toEqual({
      status: 'completed',
      response: 'done',
    });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(f.effect).toHaveBeenCalledOnce();
  });

  it('still refuses model-backed hooks under an isolated classifier', async () => {
    const f = fixture(
      async () => finalFrame('x', 'y'),
      {
        permissionClassifier: { classify: vi.fn() } as never,
        permissionClassifierFromHelper: true,
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'p' }] }] } as never,
      },
      undefined,
      true,
    );
    await expect(
      f.session.runRecoverable('go', { executionJournal: f.journal }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(f.provider.run).not.toHaveBeenCalled();
  });
});

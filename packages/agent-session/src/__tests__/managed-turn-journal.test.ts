import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionRecoveryError, FunctionTool, isManagedRunProvider } from '@robota-sdk/agent-core';
import type {
  IManagedRunProvider,
  IManagedTurnHost,
  TManagedToolBatch,
  TManagedTurnResult,
} from '@robota-sdk/agent-core';

import { abandonUnresolvedExecutions, runJournaledTurn } from '../managed-turn-journal.js';
import { NodeExecutionJournalStore } from '../node.js';
import { Session } from '../session.js';
import { SessionBusyError } from '../turn-claim.js';
import type { ISessionOptions } from '../session-types.js';

const SESSION_ID = 'managed-session';
const sessions: Session[] = [];
let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'managed-journal-'));
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
  rmSync(baseDir, { recursive: true, force: true });
});

function frame(id: string, callId: string, value: number): TManagedToolBatch {
  return {
    id,
    role: 'assistant',
    content: '',
    state: 'complete',
    timestamp: new Date(),
    toolCalls: [
      {
        id: callId,
        type: 'function' as const,
        function: { name: 'act', arguments: JSON.stringify({ value }) },
      },
    ],
  } as TManagedToolBatch;
}

function answer(content: string): TManagedTurnResult {
  return {
    id: `final-${content}`,
    role: 'assistant',
    content,
    timestamp: new Date(),
    state: 'complete',
  };
}

/** A process: a fresh Session and a fresh store instance over the same directory. */
function process_(
  run: IManagedRunProvider['run'],
  options: Partial<Pick<ISessionOptions, 'permissions'>> = {},
) {
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
    sessionId: SESSION_ID,
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
    ...options,
  });
  sessions.push(session);
  const journal = new NodeExecutionJournalStore(baseDir, { sealing: 'plain' }).forSession(
    SESSION_ID,
  );
  return { session, provider, effect, journal };
}

async function until(condition: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('condition was never met');
}

describe('a managed turn through the durable journal', () => {
  it('seals a completed execution so nothing is left unresolved', async () => {
    const p = process_(async (_input, host) => {
      await host.execute(frame('frame-1', 'call-1', 1));
      return answer('done');
    });
    expect(isManagedRunProvider(p.session.getExecutionProvider())).toBe(true);
    await expect(runJournaledTurn(p.session, p.journal, 'go')).resolves.toBe('done');
    expect(p.effect).toHaveBeenCalledOnce();
    expect(await p.journal.unresolved()).toEqual([]);
    // A restarted process sees the same: nothing to abandon.
    const reopened = new NodeExecutionJournalStore(baseDir, { sealing: 'plain' }).forSession(
      SESSION_ID,
    );
    expect(await reopened.unresolved()).toEqual([]);
  });

  it('seals a failed execution that the conversation itself settled', async () => {
    const p = process_(async (_input, host) => {
      await host.execute(frame('frame-1', 'call-1', 1));
      throw new Error('native process lost');
    });
    await expect(runJournaledTurn(p.session, p.journal, 'go')).rejects.toThrow(
      'native process lost',
    );
    expect(p.session.getPendingExecution()).toBeUndefined();
    expect(await p.journal.unresolved()).toEqual([]);
  });

  it('after a crash between an acknowledged append and the commit, refuses to run again and never re-runs the effect', async () => {
    let release!: () => void;
    const hung = new Promise<void>((resolve) => void (release = resolve));
    const crashed = process_(async (_input, host) => {
      await host.execute(frame('frame-1', 'call-1', 1));
      await hung;
      return answer('never committed');
    });
    const inFlight = runJournaledTurn(crashed.session, crashed.journal, 'go');
    inFlight.catch(() => undefined);
    await until(async () => (await crashed.journal.unresolved()).length === 1);
    await until(async () => {
      const [id] = await crashed.journal.unresolved();
      return (await crashed.journal.read(id!)).some((record) => record.kind === 'tool-result');
    });
    expect(crashed.effect).toHaveBeenCalledOnce();

    // The process is gone; a new one opens the same files.
    const restarted = process_(async () => answer('should not run'));
    const unresolved = await restarted.journal.unresolved();
    expect(unresolved).toHaveLength(1);
    await expect(
      runJournaledTurn(restarted.session, restarted.journal, 'again'),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(restarted.provider.run).not.toHaveBeenCalled();
    expect(restarted.effect).not.toHaveBeenCalled();

    // The user abandons it: told what may have happened, recorded, and never resumable.
    const abandoned = await abandonUnresolvedExecutions(restarted.session, restarted.journal);
    expect(abandoned.executionIds).toEqual(unresolved);
    expect(abandoned.message).toMatch(/may have changed files or reached outside/);
    expect(await restarted.journal.sealOf(unresolved[0]!)).toMatchObject({
      reason: 'abandoned',
      note: expect.stringContaining('unknown'),
    });
    await expect(restarted.journal.read(unresolved[0]!)).rejects.toBeInstanceOf(
      ExecutionRecoveryError,
    );

    // The session is usable again.
    await expect(runJournaledTurn(restarted.session, restarted.journal, 'fresh')).resolves.toBe(
      'should not run',
    );
    expect(restarted.provider.run).toHaveBeenCalledOnce();

    // The old process, if it were still alive, can no longer write to the abandoned execution.
    release();
    await expect(inFlight).rejects.toBeDefined();
    expect(crashed.effect).toHaveBeenCalledOnce();
  });

  it('a held unresolved execution refuses every kind of input until it is abandoned', async () => {
    let release!: () => void;
    const hung = new Promise<void>((resolve) => void (release = resolve));
    const crashed = process_(async (_input, host) => {
      await host.execute(frame('frame-1', 'call-1', 1));
      await hung;
      return answer('never committed');
    });
    const inFlight = runJournaledTurn(crashed.session, crashed.journal, 'go');
    inFlight.catch(() => undefined);
    await until(async () => (await crashed.journal.unresolved()).length === 1);

    const restarted = process_(async () => answer('after'));
    restarted.session.holdUnresolvedExecutions(await restarted.journal.unresolved());
    expect(() => restarted.session.assertInputAllowed()).toThrow(ExecutionRecoveryError);
    expect(() => restarted.session.clearHistory()).toThrow(ExecutionRecoveryError);
    await abandonUnresolvedExecutions(restarted.session, restarted.journal);
    expect(() => restarted.session.assertInputAllowed()).not.toThrow();
    release();
    await inFlight.catch(() => undefined);
  });

  it('abandon with nothing unresolved reports so and changes nothing', async () => {
    const p = process_(async () => answer('unused'));
    await expect(abandonUnresolvedExecutions(p.session, p.journal)).resolves.toEqual({
      executionIds: [],
      message: 'No managed execution is waiting to be abandoned.',
    });
  });

  it('abandon lifts a stale hold when the journal has nothing unresolved any more', async () => {
    const p = process_(async () => answer('after'));
    p.session.holdUnresolvedExecutions(['exec_sealed_meanwhile']);
    expect(() => p.session.assertInputAllowed()).toThrow(ExecutionRecoveryError);
    await expect(abandonUnresolvedExecutions(p.session, p.journal)).resolves.toMatchObject({
      executionIds: [],
    });
    expect(() => p.session.assertInputAllowed()).not.toThrow();
    await expect(runJournaledTurn(p.session, p.journal, 'go')).resolves.toBe('after');
  });

  it('abandon is refused while a turn runs', async () => {
    let release!: () => void;
    const hung = new Promise<void>((resolve) => void (release = resolve));
    const p = process_(async (_input, host: IManagedTurnHost) => {
      await host.execute(frame('frame-1', 'call-1', 1));
      await hung;
      return answer('done');
    });
    const turn = runJournaledTurn(p.session, p.journal, 'go');
    await until(async () => (await p.journal.unresolved()).length === 1);
    await expect(abandonUnresolvedExecutions(p.session, p.journal)).rejects.toBeInstanceOf(
      SessionBusyError,
    );
    release();
    await expect(turn).resolves.toBe('done');
  });

  it('leaves an execution unsealed while the session still holds its round open', async () => {
    const p = process_(async () => answer('unused'));
    const open = { executionId: 'exec_open', requests: [] };
    const fake = {
      runRecoverable: async (_message: string, options: { executionJournal: typeof p.journal }) => {
        await options.executionJournal.append({
          kind: 'model-request',
          recordId: 'r1',
          executionId: 'exec_open',
          callId: 'c1',
          providerId: 'p',
          modelId: 'm',
          messages: [],
          options: {},
        });
        throw new Error('cut off mid-round');
      },
      getPendingExecution: () => open,
    } as unknown as Session;
    await expect(runJournaledTurn(fake, p.journal, 'go')).rejects.toThrow('cut off mid-round');
    expect(await p.journal.unresolved()).toEqual(['exec_open']);
  });

  it('refuses a managed turn that parks, leaving the execution unsealed', async () => {
    const p = process_(async () => answer('unused'));
    const fake = {
      runRecoverable: async (_message: string, options: { executionJournal: typeof p.journal }) => {
        await options.executionJournal.append({
          kind: 'model-request',
          recordId: 'r1',
          executionId: 'exec_wait',
          callId: 'c1',
          providerId: 'p',
          modelId: 'm',
          messages: [],
          options: {},
        });
        return { status: 'waiting', requests: [] };
      },
      getPendingExecution: () => ({ executionId: 'exec_wait', requests: [] }),
    } as unknown as Session;
    await expect(runJournaledTurn(fake, p.journal, 'go')).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(await p.journal.unresolved()).toEqual(['exec_wait']);
  });
});

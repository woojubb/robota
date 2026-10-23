import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type {
  SessionExecutionController,
  IQueuedInput,
} from '../interactive-session-execution-controller.js';
import { createSelfPacedLoopState } from '../session-loop-transitions.js';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import type { TExecutionJournalRecord } from '@robota-sdk/agent-core';
import { Session, NodeSessionStore } from '@robota-sdk/agent-session';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import { InteractiveSession } from '../interactive-session.js';
import { persistSession } from '../interactive-session-persistence.js';

class TestInteractive extends InteractiveSession {
  ready() {
    return this.ensureInitialized();
  }
  owner() {
    return this.getSessionOrThrow();
  }
}
const closers: Array<() => Promise<void>> = [];
const directories: string[] = [];
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
  clearRegisteredToolProfiles();
});
function directory() {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'framework-pending-')));
  directories.push(value);
  return value;
}
function lower(cwd: string, store?: NodeSessionStore) {
  const scripted = createScriptedProvider([
    { toolCalls: [{ name: 'Act', args: {} }] },
    { text: 'done' },
  ]);
  const effect = vi.fn(async () => 'effect');
  const session = new Session({
    cwd,
    sessionId: 'saved_owner',
    systemMessage: 'Fixture',
    provider: scripted.provider,
    model: 'fixture',
    autoCompactThreshold: false,
    tools: [
      new FunctionTool(
        {
          name: 'Act',
          description: 'Local fixture',
          parameters: { type: 'object', properties: {} },
        },
        effect,
      ),
    ],
    terminal: {
      write: vi.fn(),
      writeLine: vi.fn(),
      writeMarkdown: vi.fn(),
      writeError: vi.fn(),
      prompt: vi.fn(async () => ''),
      select: vi.fn(async () => 0),
      spinner: vi.fn(() => ({ stop: vi.fn(), update: vi.fn() })),
    },
    permissions: { allow: [], deny: [], ask: ['Act'] },
    permissionHandler: async () => true,
    ...(store ? { sessionStore: store } : {}),
  });
  closers.push(() => session.shutdown());
  return { session, effect, ...scripted };
}
async function parked() {
  const cwd = directory();
  const store = new NodeSessionStore(directory());
  const source = lower(cwd, store);
  const records: TExecutionJournalRecord[] = [];
  const journal = {
    read: async () => structuredClone(records),
    append: async (record: TExecutionJournalRecord) => {
      records.push(structuredClone(record));
    },
  };
  const waiting = await source.session.runRecoverable('original', { executionJournal: journal });
  if (waiting.status !== 'waiting') throw new Error('Expected pending approval');
  await source.session.shutdown();
  return { cwd, store, waiting, journal, source };
}

describe('pending conversation framework boundaries', () => {
  it.each(['injected', 'deferred'])(
    'hydrates %s before accepting input without legacy receipt fabrication',
    async (mode) => {
      const f = await parked();
      const provider = createScriptedProvider([{ text: 'must not run' }]);
      const real = mode === 'injected' ? lower(f.cwd).session : undefined;
      const interactive = new TestInteractive({
        cwd: f.cwd,
        sessionStore: f.store,
        resumeSessionId: 'saved_owner',
        ...(real
          ? { session: real }
          : { provider: provider.provider, bare: true, defaultTools: [] }),
      });
      closers.push(() => interactive.shutdown());
      await interactive.ready();
      expect(interactive.owner().getPendingExecution()).toEqual({
        executionId: f.waiting.requests[0].executionId,
        requests: f.waiting.requests,
      });
      expect(
        interactive
          .owner()
          .getHistory()
          .filter((message) => message.role === 'tool'),
      ).toHaveLength(0);
      const before = interactive.owner().getConversationSnapshot();
      await expect(interactive.submit('new input')).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_REQUIRED',
      });
      expect(provider.requests).toHaveLength(0);
      expect(interactive.owner().getConversationSnapshot()).toEqual(before);
      const resolver = vi.fn(() => 'default');
      Object.assign(interactive, { resolveDefaultLoopPrompt: resolver });
      expect(interactive.requestWakeup('scheduled', 'schedule-1')).toBe(false);
      expect(resolver).not.toHaveBeenCalled();
      await expect(
        interactive.createSelfPacedLoop('do work', { useDefaultPrompt: true }),
      ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
      expect(interactive.listSelfPacedLoops()).toEqual([]);
    },
  );

  it('refuses unresolved fork and workspace move before writing any destination', async () => {
    const f = await parked();
    const real = lower(f.cwd).session;
    const save = vi.spyOn(f.store, 'save');
    const interactive = new TestInteractive({
      cwd: f.cwd,
      session: real,
      sessionStore: f.store,
      resumeSessionId: 'saved_owner',
      commandHostAdapters: { workspace: { move: vi.fn() } },
    });
    closers.push(() => interactive.shutdown());
    const writes = save.mock.calls.length;
    await expect(interactive.forkSession()).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    await expect(interactive.moveWorkspace(directory())).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(save).toHaveBeenCalledTimes(writes);
    expect(
      () =>
        new TestInteractive({
          cwd: f.cwd,
          sessionStore: f.store,
          resumeSessionId: 'saved_owner',
          forkSession: true,
          provider: createScriptedProvider([]).provider,
          bare: true,
        }),
    ).toThrow('pending execution');
    expect(save).toHaveBeenCalledTimes(writes);
  });

  it('rejects an async store hidden by the composed strict writer', async () => {
    const cwd = directory();
    const f = lower(cwd);
    const asyncSave = vi.fn(async (_record: IInteractiveSessionRecord) => {
      throw new Error('late custom store failure');
    });
    const store = {
      load: () => ({ status: 'missing' as const }),
      save: asyncSave,
      list: () => [],
      delete: () => undefined,
    };
    expect(() =>
      persistSession(
        store,
        f.session,
        undefined,
        cwd,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
      ),
    ).toThrow('synchronously');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('restored autonomous and queued input admission', () => {
  it('hydrates before the real schedule runner wakes and holds restored self-paced state before mutation', async () => {
    const f = await parked();
    const loaded = f.store.load('saved_owner');
    if (loaded.status !== 'valid') throw new Error('Expected record');
    const now = new Date().toISOString();
    const loop = {
      ...createSelfPacedLoopState('restored-loop', 'inspect', Date.now(), {
        useDefaultPrompt: true,
      }),
      phase: 'running' as const,
    };
    f.store.save({
      ...loaded.record,
      sessionLoops: [loop],
      backgroundTasks: [
        {
          id: 'restored-schedule',
          kind: 'scheduled',
          status: 'sleeping',
          mode: 'background',
          label: 'restored wake',
          parentSessionId: 'saved_owner',
          depth: 0,
          cwd: f.cwd,
          updatedAt: now,
          unread: false,
          nextFireAt: '2999-01-01T00:00:00.000Z',
          schedule: { cronExpression: '0 0 * * *', agentInstruction: 'inspect' },
        },
      ],
    });
    const started = vi.fn();
    const runner: IBackgroundTaskRunner<'scheduled'> = {
      kind: 'scheduled',
      start(task) {
        started();
        task.emit?.({ type: 'background_task_waking', instruction: 'inspect' });
        return {
          taskId: task.taskId,
          result: new Promise<never>(() => {}),
          cancel: async () => undefined,
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [runner] });
    const real = lower(f.cwd);
    storeAgentToolDeps(real.session, {
      backgroundTaskManager: manager,
    } as unknown as IAgentToolDeps);
    const resolver = vi.fn(() => 'default prompt');
    const interactive = new TestInteractive({
      cwd: f.cwd,
      session: real.session,
      sessionStore: f.store,
      resumeSessionId: 'saved_owner',
      resolveDefaultLoopPrompt: resolver,
    });
    closers.push(() => interactive.shutdown());
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
    expect(real.requests).toHaveLength(0);
    expect(resolver).not.toHaveBeenCalled();
    expect(interactive.listSelfPacedLoops()).toEqual([loop]);
    expect(interactive.getPendingCount()).toBe(0);
  });

  it('rechecks an already queued input before dispatch resolves defaults or changes loop state', async () => {
    const f = await parked();
    const loaded = f.store.load('saved_owner');
    if (loaded.status !== 'valid') throw new Error('Expected record');
    const real = lower(f.cwd);
    const interactive = new TestInteractive({ cwd: f.cwd, session: real.session });
    closers.push(() => interactive.shutdown());
    const controller = Reflect.get(interactive, 'execCtrl') as SessionExecutionController;
    const resumeQueued = Reflect.get(interactive, 'resumeQueuedTurn') as (
      entry: IQueuedInput,
    ) => Promise<void>;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const command = controller.executeForegroundCommand(
      async () => {
        await held;
        return { success: true, message: 'released' };
      },
      (entry) => resumeQueued.call(interactive, entry),
    );
    const queued = await interactive.submit('queued input');
    const outcome = queued.completed.catch((error: unknown) => error);
    expect(interactive.getPendingCount()).toBe(1);
    real.session.restoreConversation(loaded.record);
    const before = real.session.getConversationSnapshot();
    release();
    await command;
    expect(await outcome).toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(real.requests).toHaveLength(0);
    expect(real.session.getConversationSnapshot()).toEqual(before);
  });

  it('keeps marker-free ordinary interrupted-call repair even when metadata carries execution ids', async () => {
    const f = await parked();
    const loaded = f.store.load('saved_owner');
    if (loaded.status !== 'valid') throw new Error('Expected record');
    const { pendingExecution: _pending, ...ordinary } = loaded.record;
    f.store.save(ordinary);
    const real = lower(f.cwd);
    const interactive = new TestInteractive({
      cwd: f.cwd,
      session: real.session,
      sessionStore: f.store,
      resumeSessionId: 'saved_owner',
    });
    closers.push(() => interactive.shutdown());
    expect(real.session.getPendingExecution()).toBeUndefined();
    expect(real.session.getHistory().at(-1)).toMatchObject({
      role: 'tool',
      metadata: { interrupted: true, outcome: 'unknown' },
    });
  });
});

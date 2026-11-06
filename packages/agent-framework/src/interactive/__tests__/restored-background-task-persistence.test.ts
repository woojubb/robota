import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createScheduledTaskRunner } from '@robota-sdk/agent-executor/node';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRuntime } from '../../runtime/session-runtime.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { decorateSessionStore } from '../session-store-view.js';
import {
  cleanUpSealedSessionFixtures,
  directory,
  record,
  sessionOptions,
  started,
} from './helpers/sealed-session-fixtures.js';

import type { IAgentBackgroundTaskState } from '@robota-sdk/agent-interface-execution';
import type { IBackgroundTaskManager } from '@robota-sdk/agent-executor';
import type { SessionExecutionController } from '../interactive-session-execution-controller.js';

const PARENT = 'parent';
const CANARY = 'SENSITIVE-FORK-RESULT-8194';
const updatedAt = '2026-01-01T00:00:00.000Z';

afterEach(() => {
  vi.useRealTimers();
  return cleanUpSealedSessionFixtures();
});

function completedFork(cwd: string): IAgentBackgroundTaskState {
  return {
    id: 'agent_1',
    kind: 'agent',
    label: 'Fork',
    status: 'completed',
    mode: 'background',
    parentSessionId: PARENT,
    depth: 1,
    cwd,
    updatedAt,
    unread: false,
    isolation: 'worktree',
    resumeSessionId: 'fork-session',
    worktreePath: join(cwd, 'retained'),
    branchName: 'fork-branch',
    worktreeBaseRevision: '1234567890abcdef',
    result: { taskId: 'agent_1', kind: 'agent', output: CANARY },
  };
}

describe('restored background tasks', () => {
  it.each(['release', 'marker replacement'] as const)(
    'closes a newly created schedule after %s',
    async (loss) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const cwd = directory();
      const dir = directory();
      const store = new NodeSessionStore(dir, { sealing: 'plain' });
      const restored = {
        id: 'scheduled_1',
        kind: 'scheduled' as const,
        label: 'old',
        status: 'sleeping' as const,
        mode: 'background' as const,
        parentSessionId: PARENT,
        depth: 1,
        cwd,
        updatedAt,
        unread: false,
        nextFireAt: '2999-01-01T00:00:00.000Z',
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'old wake' },
      };
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [restored] }), {
        provenance: 'owner',
      });
      const runtime = createAgentRuntime({
        host: createTestFrameworkHost(),
        cwd,
        provider: createScriptedProvider([]).provider,
        sessionStore: store,
        backgroundTaskRunners: [createScheduledTaskRunner()],
      });
      const session = runtime.createSession({ resumeSessionId: PARENT });
      await session.whenInitialized();
      const manager = (
        session as unknown as { getBackgroundTaskManager(): IBackgroundTaskManager }
      ).getBackgroundTaskManager();
      const added = await manager.spawn({
        kind: 'scheduled',
        cronExpression: '* * * * * *',
        agentInstruction: 'new wake',
        label: 'new',
        mode: 'background',
        parentSessionId: PARENT,
        depth: 1,
        cwd,
      });
      const events: string[] = [];
      session.on('background_task_event', (event) => events.push(event.type));
      if (loss === 'release') session.releaseSessionClaim();
      else
        for (const entry of readdirSync(join(dir, 'claims')))
          rmSync(join(dir, 'claims', entry), { recursive: true, force: true });
      const next = new NodeSessionStore(dir, { sealing: 'plain' }).claim(PARENT);
      try {
        await vi.advanceTimersByTimeAsync(2100);
        expect(events).not.toContain('background_task_waking');
        expect(manager.get(added.id)).toMatchObject({ status: 'failed' });
      } finally {
        next.release();
        session.releaseSessionClaim();
        await session.shutdown().catch(() => undefined);
      }
    },
  );
  it.runIf(process.platform !== 'win32')(
    'attempts to stop an in-flight restored child when the claim is explicitly released',
    async () => {
      const realSetTimeout = setTimeout;
      const wait = (ms: number) => new Promise<void>((resolve) => realSetTimeout(resolve, ms));
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const cwd = directory();
      const scriptPath = join(cwd, 'child.cjs');
      const started = join(cwd, 'started');
      const finished = join(cwd, 'finished');
      writeFileSync(
        scriptPath,
        `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(started)}, 'started'); setTimeout(() => fs.writeFileSync(${JSON.stringify(finished)}, 'finished'), 800);`,
      );
      const store = new NodeSessionStore(directory(), { sealing: 'plain' });
      const task = {
        id: 'scheduled_1',
        kind: 'scheduled' as const,
        label: 'Shell',
        status: 'sleeping' as const,
        mode: 'background' as const,
        parentSessionId: PARENT,
        depth: 1,
        cwd,
        updatedAt,
        unread: false,
        nextFireAt: '2026-01-01T00:00:01.000Z',
        schedule: {
          cronExpression: '* * * * * *',
          command: `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`,
        },
      };
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
        provenance: 'owner',
      });
      const runtime = createAgentRuntime({
        host: createTestFrameworkHost(),
        cwd,
        provider: createScriptedProvider([]).provider,
        sessionStore: store,
        backgroundTaskRunners: [createScheduledTaskRunner()],
      });
      const session = runtime.createSession({ resumeSessionId: PARENT });
      try {
        await session.whenInitialized();
        await vi.advanceTimersByTimeAsync(1000);
        for (let count = 0; count < 100 && !existsSync(started); count += 1) await wait(20);
        expect(existsSync(started)).toBe(true);
        session.releaseSessionClaim();
        await wait(1000);
        expect(existsSync(finished)).toBe(false);
        expect(session.getBackgroundTask(task.id)).toMatchObject({ status: 'failed' });
      } finally {
        session.releaseSessionClaim();
        await session.shutdown().catch(() => undefined);
      }
    },
    10_000,
  );
  it('closes restored timers before explicitly releasing the writer claim', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const cwd = directory();
    const store = new NodeSessionStore(directory(), { sealing: 'plain' });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Wake',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2026-01-01T00:00:01.000Z',
      schedule: { cronExpression: '* * * * * *', agentInstruction: 'do not run' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: store,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    await session.whenInitialized();
    const events: string[] = [];
    session.on('background_task_event', (event) => events.push(event.type));
    session.releaseSessionClaim();
    const next = store.claim(PARENT);
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(events).not.toContain('background_task_waking');
      expect(session.getBackgroundTask(task.id)).toMatchObject({ status: 'failed' });
      expect(store.load(PARENT)).toMatchObject({
        status: 'valid',
        record: { backgroundTasks: [expect.objectContaining({ id: task.id, status: 'sleeping' })] },
      });
    } finally {
      next.release();
      await session.shutdown().catch(() => undefined);
    }
  });

  it('does not execute a queued restored wake after its writer marker is replaced', async () => {
    const cwd = directory();
    const dir = directory();
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Wake',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2999-01-01T00:00:00.000Z',
      schedule: { cronExpression: '0 0 * * *', agentInstruction: 'do not run' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    const scripted = createScriptedProvider([{ text: 'should not execute' }]);
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: scripted.provider,
      sessionStore: store,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    await session.whenInitialized();
    const ctrl = (session as unknown as { execCtrl: SessionExecutionController }).execCtrl;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resume = (
      session as unknown as {
        resumeQueuedTurn: Parameters<SessionExecutionController['executeForegroundCommand']>[1];
      }
    ).resumeQueuedTurn.bind(session);
    const foreground = ctrl.executeForegroundCommand(async () => {
      await held;
      return { success: true, message: 'done' };
    }, resume);
    expect(session.requestWakeup('queued wake', task.id)).toBe(true);
    await Promise.resolve();
    expect(ctrl.pending.contents).toHaveLength(1);
    const claims = join(dir, 'claims');
    for (const entry of readdirSync(claims))
      rmSync(join(claims, entry), { recursive: true, force: true });
    const next = new NodeSessionStore(dir, { sealing: 'plain' }).claim(PARENT);
    try {
      release();
      await foreground;
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
      expect(scripted.requests).toHaveLength(0);
      expect(ctrl.pending.contents).toHaveLength(0);
      expect(session.getBackgroundTask(task.id)).toMatchObject({ status: 'failed' });
    } finally {
      next.release();
      session.releaseSessionClaim();
      await session.shutdown().catch(() => undefined);
    }
  });
  it('stops a restored wake after another writer takes the marker', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const cwd = directory();
    const dir = directory();
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Wake',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2026-01-01T00:00:01.000Z',
      schedule: { cronExpression: '* * * * * *', agentInstruction: 'do not run' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: store,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    await session.whenInitialized();
    const events: string[] = [];
    session.on('background_task_event', (event) => events.push(event.type));
    const claims = join(dir, 'claims');
    for (const entry of readdirSync(claims))
      rmSync(join(claims, entry), { recursive: true, force: true });
    const second = new NodeSessionStore(dir, { sealing: 'plain' }).claim(PARENT);
    try {
      await vi.advanceTimersByTimeAsync(2000);
      expect(events).not.toContain('background_task_waking');
      expect(session.getBackgroundTask(task.id)).toMatchObject({ status: 'failed' });
      expect(store.load(PARENT)).toMatchObject({
        status: 'valid',
        record: { backgroundTasks: [expect.objectContaining({ id: task.id, status: 'sleeping' })] },
      });
    } finally {
      second.release();
      session.releaseSessionClaim();
      await session.shutdown().catch(() => undefined);
    }
  });
  it('does not activate a schedule when its writer marker is replaced during commit', async () => {
    vi.useFakeTimers();
    const cwd = directory();
    const dir = directory();
    const store = new NodeSessionStore(dir, { sealing: 'plain' });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Later',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2999-01-01T00:00:00.000Z',
      schedule: { cronExpression: '0 0 * * *', agentInstruction: 'wake' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    let secondClaim: ReturnType<NodeSessionStore['claim']> | undefined;
    const view = decorateSessionStore(store, {
      saveRestoreTransaction(value, options) {
        const result = store.saveRestoreTransaction(value, options);
        const claims = join(dir, 'claims');
        for (const entry of readdirSync(claims))
          rmSync(join(claims, entry), { recursive: true, force: true });
        secondClaim = new NodeSessionStore(dir, { sealing: 'plain' }).claim(PARENT);
        return result;
      },
    });
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: view,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    try {
      await expect(session.whenInitialized()).rejects.toThrow(/claim|ownership/i);
      expect(vi.getTimerCount()).toBe(0);
      expect(secondClaim).toBeDefined();
    } finally {
      secondClaim?.release();
      session.releaseSessionClaim();
      await session.shutdown().catch(() => undefined);
    }
  });
  it('does not activate a schedule if the claim is released during commit', async () => {
    vi.useFakeTimers();
    const cwd = directory();
    const store = new NodeSessionStore(directory(), { sealing: 'plain' });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Later',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2999-01-01T00:00:00.000Z',
      schedule: { cronExpression: '0 0 * * *', agentInstruction: 'wake' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    let session: ReturnType<ReturnType<typeof createAgentRuntime>['createSession']>;
    const view = decorateSessionStore(store, {
      saveRestoreTransaction(value, options) {
        const result = store.saveRestoreTransaction(value, options);
        session.releaseSessionClaim();
        return result;
      },
    });
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: view,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    session = runtime.createSession({ resumeSessionId: PARENT });
    await expect(session.whenInitialized()).rejects.toThrow(/claim|ownership/i);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.load(PARENT)).toMatchObject({
      status: 'valid',
      record: { backgroundTasks: [expect.objectContaining({ id: task.id })] },
    });
    const next = store.claim(PARENT);
    next.release();
  });
  it.each(['plain', 'sealed'] as const)(
    'shows a restored completed fork and its saved result as read-only in a %s session',
    async (mode) => {
      const cwd = directory();
      const sealer = createTestArtifactSealer();
      const store = new NodeSessionStore(directory(), {
        sealing: mode === 'sealed' ? { sealer } : 'plain',
      });
      const task = {
        ...completedFork(cwd),
        transcriptPath: join(cwd, 'unavailable.jsonl'),
        transcriptSealed: true as const,
      };
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
        provenance: 'owner',
      });
      const runtime = createAgentRuntime({
        host: createTestFrameworkHost(),
        cwd,
        provider: createScriptedProvider([]).provider,
        sessionStore: store,
      });
      const session = runtime.createSession({ resumeSessionId: PARENT });
      try {
        await session.whenInitialized();
        const entry = session
          .getExecutionWorkspaceSnapshot()
          .entries.find((item) => item.id === 'task:agent_1');
        expect(entry).toMatchObject({
          id: 'task:agent_1',
          status: 'completed',
          controls: ['select'],
        });
        expect(session.getBackgroundTask('agent_1')).toMatchObject({
          id: 'agent_1',
          status: 'completed',
        });
        expect(session.listBackgroundTasks({ status: 'completed' })).toEqual([
          expect.objectContaining({ id: 'agent_1' }),
        ]);
        const detail = await session.readExecutionWorkspaceDetail('task:agent_1');
        expect(detail.records).toEqual([expect.objectContaining({ kind: 'result', text: CANARY })]);
        await expect(session.closeBackgroundTask('agent_1')).rejects.toThrow(/read.only/i);
      } finally {
        await session.shutdown();
      }
    },
  );

  it.runIf(process.platform !== 'win32').each(['before', 'after'] as const)(
    'restarts safely after a process dies %s a restore commit',
    async (phase) => {
      const cwd = directory();
      const dir = directory();
      const task = {
        id: 'scheduled_1',
        kind: 'scheduled' as const,
        label: 'Later',
        status: 'sleeping' as const,
        mode: 'background' as const,
        parentSessionId: PARENT,
        depth: 1,
        cwd,
        updatedAt,
        unread: false,
        nextFireAt: '2999-01-01T00:00:00.000Z',
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'wake' },
      };
      new NodeSessionStore(dir, { sealing: 'plain' }).save(
        record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }),
      );
      const runtimeUrl = new URL('../../runtime/session-runtime.ts', import.meta.url).href;
      const hostUrl = new URL('../../testing/framework-host.ts', import.meta.url).href;
      const viewUrl = new URL('../session-store-view.ts', import.meta.url).href;
      const source = `
        import { writeSync } from 'node:fs';
        import { NodeSessionStore } from '@robota-sdk/agent-session/node';
        import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
        import { createScheduledTaskRunner } from '@robota-sdk/agent-executor/node';
        import { createAgentRuntime } from ${JSON.stringify(runtimeUrl)};
        import { createTestFrameworkHost } from ${JSON.stringify(hostUrl)};
        import { decorateSessionStore } from ${JSON.stringify(viewUrl)};
        const store = new NodeSessionStore(process.env.TEST_STORE, { sealing: 'plain' });
        const view = decorateSessionStore(store, {
          saveRestoreTransaction(value, options) {
            if (process.env.TEST_PHASE === 'after') {
              const result = store.saveRestoreTransaction(value, options);
              if (result.status !== 'committed') process.exit(92);
            }
            writeSync(1, 'REACHED_COMMIT_BOUNDARY\\n');
            process.kill(process.pid, 'SIGKILL');
            throw new Error('process survived termination');
          },
        });
        const runtime = createAgentRuntime({ host: createTestFrameworkHost(), cwd: process.env.TEST_CWD,
          provider: createScriptedProvider([]).provider, sessionStore: view,
          backgroundTaskRunners: [createScheduledTaskRunner()] });
        await runtime.createSession({ resumeSessionId: ${JSON.stringify(PARENT)} }).whenInitialized();
        process.exit(93);
      `;
      const child = spawnSync(
        process.execPath,
        ['--import', 'tsx', '--conditions=source', '--input-type=module', '-e', source],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 20_000,
          env: {
            PATH: process.env.PATH,
            HOME: cwd,
            TMPDIR: cwd,
            TEST_STORE: dir,
            TEST_CWD: cwd,
            TEST_PHASE: phase,
            PRODUCT_USER_STATE_DIR: join(cwd, 'product'),
            ROBOTA_USER_STATE_DIR: join(cwd, 'product'),
          },
        },
      );
      expect(child.stdout).toContain('REACHED_COMMIT_BOUNDARY');
      expect(child.signal).toBe('SIGKILL');
      const store = new NodeSessionStore(dir, { sealing: 'plain' });
      expect(store.load(PARENT)).toMatchObject({
        status: 'valid',
        record: { backgroundTasks: [expect.objectContaining({ id: task.id, status: 'sleeping' })] },
      });
      const runtime = createAgentRuntime({
        host: createTestFrameworkHost(),
        cwd,
        provider: createScriptedProvider([]).provider,
        sessionStore: store,
        backgroundTaskRunners: [createScheduledTaskRunner()],
      });
      const session = runtime.createSession({ resumeSessionId: PARENT });
      await session.whenInitialized();
      expect(session.listSchedules()).toEqual([
        expect.objectContaining({ id: task.id, status: 'sleeping' }),
      ]);
      await session.shutdown();
    },
    30_000,
  );

  it('does not activate a schedule after an uncertain committed sealed-store write', async () => {
    vi.useFakeTimers();
    const cwd = directory();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(directory(), { sealing: { sealer } });
    const task = {
      id: 'scheduled_1',
      kind: 'scheduled' as const,
      label: 'Later',
      status: 'sleeping' as const,
      mode: 'background' as const,
      parentSessionId: PARENT,
      depth: 1,
      cwd,
      updatedAt,
      unread: false,
      nextFireAt: '2999-01-01T00:00:00.000Z',
      schedule: { cronExpression: '0 0 * * *', agentInstruction: 'wake' },
    };
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
      provenance: 'owner',
    });
    const view = decorateSessionStore(store, {
      saveRestoreTransaction: (value, options) => {
        const outcome = store.saveRestoreTransaction(value, options);
        if (outcome.status !== 'committed') return outcome;
        return { status: 'unknown', error: new Error('injected post-write failure') };
      },
    });
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: view,
      backgroundTaskRunners: [createScheduledTaskRunner()],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    await expect(session.whenInitialized()).rejects.toThrow(/unknown/i);
    expect(vi.getTimerCount()).toBe(0);
    expect(store.load(PARENT)).toMatchObject({
      status: 'valid',
      record: { backgroundTasks: [expect.objectContaining({ id: task.id, status: 'sleeping' })] },
    });
    const claim = store.claim(PARENT);
    claim.release();
  });

  it.each(['plain', 'sealed'] as const)(
    'restarts a saved schedule twice against the real %s store',
    async (mode) => {
      const cwd = directory();
      const dir = directory();
      const sealer = createTestArtifactSealer();
      const store = new NodeSessionStore(dir, {
        sealing: mode === 'sealed' ? { sealer } : 'plain',
      });
      const task = {
        id: 'scheduled_1',
        kind: 'scheduled' as const,
        label: 'Later',
        status: 'sleeping' as const,
        mode: 'background' as const,
        parentSessionId: PARENT,
        depth: 1,
        cwd,
        updatedAt,
        unread: false,
        nextFireAt: '2999-01-01T00:00:00.000Z',
        schedule: { cronExpression: '0 0 * * *', agentInstruction: 'wake' },
      };
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
        provenance: 'owner',
      });
      for (let index = 0; index < 2; index += 1) {
        const runtime = createAgentRuntime({
          host: createTestFrameworkHost(),
          cwd,
          provider: createScriptedProvider([]).provider,
          sessionStore: store,
          backgroundTaskRunners: [createScheduledTaskRunner()],
        });
        const session = runtime.createSession({ resumeSessionId: PARENT });
        await session.whenInitialized();
        expect(session.listSchedules()).toEqual([
          expect.objectContaining({ id: task.id, status: 'sleeping' }),
        ]);
        await session.shutdown();
        expect(store.load(PARENT)).toMatchObject({
          status: 'valid',
          record: {
            backgroundTasks: [expect.objectContaining({ id: task.id, status: 'sleeping' })],
          },
        });
      }
    },
  );

  it.each(['plain', 'sealed'] as const)(
    'retains a completed fork after %s parent initialization',
    async (mode) => {
      const cwd = directory();
      const dir = directory();
      const sealer = createTestArtifactSealer();
      const store = new NodeSessionStore(dir, {
        sealing: mode === 'sealed' ? { sealer } : 'plain',
      });
      const task = completedFork(cwd);
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }), {
        provenance: 'owner',
      });
      const runtime = createAgentRuntime({
        host: createTestFrameworkHost(),
        cwd,
        provider: createScriptedProvider([]).provider,
        sessionStore: store,
      });
      const session = runtime.createSession({ resumeSessionId: PARENT });
      try {
        await session.whenInitialized();
        const saved = store.load(PARENT);
        expect(saved.status).toBe('valid');
        if (saved.status !== 'valid') throw new Error('session record unavailable');
        expect(saved.record.backgroundTasks).toContainEqual(task);
        if (mode === 'sealed')
          expect(readFileSync(join(dir, `${PARENT}.json`), 'utf8')).not.toContain(CANARY);
      } finally {
        await session.shutdown();
      }
    },
  );

  it('does not reuse a restored task ID for a newly spawned job', async () => {
    const cwd = directory();
    const store = new NodeSessionStore(directory(), { sealing: 'plain' });
    const task = completedFork(cwd);
    store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }));
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([{ text: 'new result' }]).provider,
      sessionStore: store,
      commandModules: [{ name: 'robota-test', sessionRequirements: ['runtime'] }],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    try {
      await session.whenInitialized();
      const spawned = await session.spawnAgentJob({
        agentType: 'general-purpose',
        label: 'New task',
        mode: 'background',
        prompt: 'do work',
      });
      expect(spawned.id).not.toBe(task.id);
      await session.waitAgentJob(spawned.id);
      const saved = store.load(PARENT);
      expect(saved.status).toBe('valid');
      if (saved.status !== 'valid') throw new Error('session record unavailable');
      expect(saved.record.backgroundTasks).toEqual(
        expect.arrayContaining([task, expect.objectContaining({ id: spawned.id })]),
      );
      await session.closeBackgroundTask(spawned.id);
      const afterClose = store.load(PARENT);
      expect(afterClose.status).toBe('valid');
      if (afterClose.status !== 'valid') throw new Error('session record unavailable');
      expect(afterClose.record.backgroundTasks).toEqual([task]);
    } finally {
      await session.shutdown();
    }
  });
});

describe('terminal restore details', () => {
  it.each(['completed', 'failed', 'cancelled'] as const)(
    'preserves a %s task across consecutive resumes without changing it',
    async (status) => {
      const cwd = directory();
      const store = new NodeSessionStore(directory(), { sealing: 'plain' });
      const task = { ...completedFork(cwd), status };
      store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }));
      for (let index = 0; index < 2; index += 1) {
        const runtime = createAgentRuntime({
          host: createTestFrameworkHost(),
          cwd,
          provider: createScriptedProvider([]).provider,
          sessionStore: store,
        });
        const session = runtime.createSession({ resumeSessionId: PARENT });
        try {
          await session.whenInitialized();
        } finally {
          await session.shutdown();
        }
        const saved = store.load(PARENT);
        expect(saved.status).toBe('valid');
        if (saved.status !== 'valid') throw new Error('session record unavailable');
        expect(saved.record.backgroundTasks).toEqual([task]);
      }
    },
  );
});

it('does not copy the parent task history into a startup fork', async () => {
  const cwd = directory();
  const store = new NodeSessionStore(directory(), { sealing: 'plain' });
  const task = completedFork(cwd);
  store.save(record(PARENT, cwd, 'owner message', { backgroundTasks: [task] }));
  const fork = await started(
    sessionOptions(cwd, store, { resumeSessionId: PARENT, forkSession: true }),
  );
  const copy = store.load(fork.sessionId);
  expect(copy.status).toBe('valid');
  if (copy.status !== 'valid') throw new Error('fork record unavailable');
  expect(copy.record.backgroundTasks ?? []).toEqual([]);
  const parent = store.load(PARENT);
  expect(parent.status).toBe('valid');
  if (parent.status !== 'valid') throw new Error('parent record unavailable');
  expect(parent.record.backgroundTasks).toEqual([task]);
});

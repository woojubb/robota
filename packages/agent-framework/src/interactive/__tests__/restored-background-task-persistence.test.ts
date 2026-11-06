import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { createScriptedProvider, createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createScheduledTaskRunner } from '@robota-sdk/agent-executor/node';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

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

const PARENT = 'parent';
const CANARY = 'SENSITIVE-FORK-RESULT-8194';
const updatedAt = '2026-01-01T00:00:00.000Z';

afterEach(cleanUpSealedSessionFixtures);

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
    const runner = createScheduledTaskRunner();
    let activated = 0;
    const observedRunner = {
      ...runner,
      prepareRestore: (...args: Parameters<NonNullable<typeof runner.prepareRestore>>) => {
        const prepare = runner.prepareRestore;
        if (!prepare) throw new Error('expected prepared runner');
        const prepared = prepare(...args);
        return {
          ...prepared,
          activate: () => {
            activated += 1;
            prepared.activate();
          },
        };
      },
    };
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost(),
      cwd,
      provider: createScriptedProvider([]).provider,
      sessionStore: view,
      backgroundTaskRunners: [observedRunner],
    });
    const session = runtime.createSession({ resumeSessionId: PARENT });
    await expect(session.whenInitialized()).rejects.toThrow(/unknown/i);
    expect(activated).toBe(0);
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

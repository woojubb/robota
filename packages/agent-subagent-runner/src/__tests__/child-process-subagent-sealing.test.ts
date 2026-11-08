/**
 * The child-process subagent path with a sealing parent, on the real spawn and IPC
 * path (the fixtures enter `runSubagentWorkerMain` from the built package).
 *
 * - The transcript the parent reads is the file the child wrote, by one rule, with worktree isolation
 *   too (a fork job used to log under the fork id while the parent read `<taskId>.jsonl`, and the
 *   worktree runner dropped the read altogether).
 * - A sealing parent hands its child a write grant, and a fork job the record it holds — only as the
 *   top-level `resumeHeld`, never on the request, the task state, its events or its result.
 * - What cannot be handed over fails before anything is spawned; a child whose parent seals never
 *   writes plain; a child started before the parent's key was verified follows the newer grant.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Writable } from 'node:stream';

import { ArtifactCorruptError, ArtifactLockedError } from '@robota-sdk/agent-core';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { SubagentManager } from '@robota-sdk/agent-executor';
import { createUserSessionStore } from '@robota-sdk/agent-framework/node';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChildProcessSubagentRunner, createChildProcessSubagentRunnerFactory } from '../index.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

const spawned = vi.hoisted(() => ({
  children: [] as import('node:child_process').ChildProcess[],
  settled: new WeakMap<import('node:child_process').ChildProcess, Promise<void>>(),
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      spawned.settled.set(
        child,
        new Promise<void>((resolve) => {
          let exited = false;
          let disconnected = !child.connected;
          let closed = false;
          const finish = (): void => {
            if (exited && disconnected && closed) resolve();
          };
          child.once('exit', () => {
            exited = true;
            finish();
          });
          child.once('disconnect', () => {
            disconnected = true;
            finish();
          });
          child.once('close', () => {
            closed = true;
            finish();
          });
          child.once('error', () => {
            if (child.pid === undefined) {
              exited = true;
              disconnected = true;
              finish();
            }
          });
        }),
      );
      spawned.children.push(child);
      return child;
    },
  };
});

import type {
  IArtifactContext,
  IArtifactSealer,
  IProviderDefinition,
} from '@robota-sdk/agent-core';
import type { ISubagentJobStart, ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';
import type {
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-interface-execution';
import type { TResumeSessionStore } from '../index.js';

const testHost = createTestFrameworkHost();

/** A session record, typed from the store port this package resumes through. */
type IInteractiveSessionRecord = Parameters<TResumeSessionStore['save']>[0];

const TEST_TIMEOUT_MS = 30_000;
const entry = (fixture: string) => ({
  execPath: process.execPath,
  args: [fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url))],
  execArgv: [] as readonly string[],
});
const ECHO_WORKER = entry('subagent-worker-fixture.mjs');
const FORK_WORKER = entry('fork-persistence-worker-entry.mjs');
const SEALING_WORKER = entry('sealing-worker-entry.mjs');
const TEST_PROVIDER_DEFINITIONS: readonly IProviderDefinition[] = [
  { type: 'openai', destinationEnvironment: [], createProvider: () => ({}) as never },
];
const NO_WORKTREES: ISubagentWorktreeAdapter = {
  prepare: () => {
    throw new Error('not used');
  },
  isClean: () => true,
  remove: () => {},
};
const CANARY = 'CANARY-sealed-fork-0f7e-conversation-text';

const roots: string[] = [];
async function cleanupTestState(): Promise<void> {
  await Promise.all(
    spawned.children.map(async (child) => {
      const settled = spawned.settled.get(child);
      if (!settled) throw new Error('Missing child lifecycle tracker');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          settled,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              child.kill('SIGKILL');
              reject(new Error('Child did not close and disconnect within 5 seconds'));
            }, 5_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
  // The parent's follower may release its marker after the child exits.
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 25 });
  }
  spawned.children.length = 0;
}
afterEach(cleanupTestState);
function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

it('waits for a worker to finish writing before removing its temporary directory', async () => {
  const root = directory('sealing-cleanup-');
  const child = spawn(
    process.execPath,
    [
      '-e',
      "const s=require('node:fs').createReadStream(null,{fd:4});s.on('end',()=>require('node:fs').writeFileSync(process.argv[1],'finished'));s.resume();process.stdout.write('ready')",
      join(root, 'late-write'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'pipe'] },
  );
  await once(child, 'spawn');
  const closed = once(child, 'close');
  await once(child.stdout!, 'data');
  const cleanup = cleanupTestState();
  (child.stdio[4] as Writable).end();
  await cleanup;
  const [code] = await closed;
  expect(code).toBe(0);
  expect(existsSync(root)).toBe(false);
});

// The descendants in the next two tests are detached so that they outlive the worker on every
// platform. On Windows a child that is not detached belongs to its parent's job object and is killed
// when that parent exits, so it would never hold the worker's streams open after the worker exited,
// which is the situation these tests exist to create.
it('keeps the temporary directory until the exited worker closes its streams', async () => {
  const root = directory('sealing-cleanup-close-');
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('node:child_process').spawn(process.execPath, ['-e', \"const s=require('node:fs').createReadStream(null,{fd:4});s.resume();process.stdout.write('ready')\"], {stdio: ['ignore', 1, 2, 'ignore', 4], detached: true}).unref()",
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'pipe'] },
  );
  let rootAtClose = false;
  child.once('close', () => {
    rootAtClose = existsSync(root);
  });
  const closed = once(child, 'close');
  const exited = once(child, 'exit');
  await once(child.stdout!, 'data');
  await exited;
  const cleanup = cleanupTestState();
  (child.stdio[4] as Writable).end();
  await cleanup;
  await closed;
  expect(rootAtClose).toBe(true);
  expect(existsSync(root)).toBe(false);
});

it('keeps the temporary directory until the exited worker disconnects its IPC channel', async () => {
  const root = directory('sealing-cleanup-ipc-');
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('node:child_process').spawn(process.execPath, ['-e', \"const s=require('node:fs').createReadStream(null,{fd:4});s.resume();process.stdout.write('ready')\"], {stdio: ['ignore', 1, 2, 3, 4], detached: true}).unref()",
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc', 'pipe'] },
  );
  let rootAtDisconnect = false;
  child.once('disconnect', () => {
    rootAtDisconnect = existsSync(root);
  });
  const exited = once(child, 'exit');
  await once(child.stdout!, 'data');
  await exited;
  const cleanup = cleanupTestState();
  (child.stdio[4] as Writable).end();
  await cleanup;
  expect(rootAtDisconnect).toBe(true);
  expect(existsSync(root)).toBe(false);
});

function createDeps(
  extra: Partial<IInProcessSubagentRunnerDeps> = {},
): IInProcessSubagentRunnerDeps {
  return {
    host: testHost,
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: { name: 'openai', model: 'test-model', apiKey: 'test-key' },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    tools: [],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    provider: {} as never,
    customAgentRegistry: () => ({
      name: 'tester',
      description: 'Test subagent',
      systemPrompt: 'Run test tasks.',
    }),
    ...extra,
  };
}

function job(cwd: string, extra: Partial<ISubagentJobStart['request']> = {}): ISubagentJobStart {
  return {
    taskId: 'agent_1',
    request: {
      permissionPolicy: 'inherit-allowlist',
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_parent',
      mode: 'background',
      depth: 1,
      cwd,
      prompt: 'Continue the forked record.',
      ...extra,
    },
  };
}

function forkRecord(id: string, cwd: string): IInteractiveSessionRecord {
  return {
    id,
    name: 'parent (fork)',
    cwd,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: CANARY,
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

/**
 * The parent half of the sealing fixture's stand-in sealer (see `fixtures/sealing-worker-entry.mjs`):
 * `RSL1` framing over base64url JSON naming the key it sealed to. Opens what any key it has had
 * sealed; `rotate` is the parent's verified key changing.
 */
function fixtureParentSealer(initialKey: string) {
  const keys = new Set([initialKey]);
  let current = initialKey;
  let locked = false;
  const seal = (context: IArtifactContext, text: string): string =>
    Buffer.from(
      JSON.stringify({ key: current, kind: context.kind, id: context.id, text }),
    ).toString('base64url');
  const open = (encoded: string, context: IArtifactContext): string => {
    if (locked) throw new ArtifactLockedError();
    let parsed: { key: string; kind: string; id: string; text: string };
    try {
      parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      throw new ArtifactCorruptError();
    }
    if (!keys.has(parsed.key) || parsed.kind !== context.kind || parsed.id !== context.id) {
      throw new ArtifactCorruptError();
    }
    return parsed.text;
  };
  const sealer: IArtifactSealer = {
    sealLine: (plain, context) => `RSL1:${seal(context, plain)}`,
    sealBytes: (plain, context) =>
      Buffer.from(`RSL1${seal(context, Buffer.from(plain).toString('utf8'))}`),
    openLine: (stored, context) => {
      if (!stored.startsWith('RSL1:')) throw new ArtifactCorruptError();
      return open(stored.slice('RSL1:'.length), context);
    },
    openBytes: (stored, context) => {
      const text = Buffer.from(stored).toString('latin1');
      if (!text.startsWith('RSL1')) throw new ArtifactCorruptError();
      return Buffer.from(open(text.slice(4), context), 'utf8');
    },
    isSealedLine: (stored) => /^RSL[0-9]:/.test(stored),
    isSealedBytes: (stored) =>
      /^RSL[0-9]$/.test(Buffer.from(stored).subarray(0, 4).toString('latin1')),
    writeGrant: () => `fixture-grant:${current}`,
  };
  return {
    sealer,
    rotate(key: string) {
      keys.add(key);
      current = key;
    },
    lock() {
      locked = true;
    },
    unlock() {
      locked = false;
    },
  };
}

/**
 * A runner with worktree isolation — the default for `/fork` — whose adapter counts the worktrees it
 * prepares, so a test can say that a refused job left none behind.
 */
function isolatedRunner(
  deps: IInProcessSubagentRunnerDeps,
  options: Omit<
    Parameters<typeof createChildProcessSubagentRunnerFactory>[0],
    'worktreeAdapter' | 'providerDefinitions'
  > & { providerDefinitions?: readonly IProviderDefinition[] },
) {
  const prepare = vi.fn(({ taskId }: { taskId: string }) => ({
    repoRoot: directory('sealing-isolated-repo-'),
    worktreePath: directory(`sealing-isolated-${taskId}-`),
    branchName: `agent/${taskId}`,
  }));
  const runner = createChildProcessSubagentRunnerFactory({
    ...options,
    worktreeAdapter: { prepare, isClean: () => true, remove: () => {} },
    providerDefinitions: options.providerDefinitions ?? TEST_PROVIDER_DEFINITIONS,
  })(deps);
  return { runner, prepare };
}

/** Whether a spawned child has exited, by a signal or on its own. */
function exited(child: import('node:child_process').ChildProcess | undefined): boolean {
  return child !== undefined && (child.exitCode !== null || child.signalCode !== null);
}

/** The conversation a held-record token carries. */
function heldText(token: string): string {
  return Buffer.from(token.split('.')[3] as string, 'base64url').toString('utf8');
}

/** The key the stand-in sealer sealed a line to, or `undefined` for a plain line. */
function keyOfLine(line: string): string | undefined {
  if (!line.startsWith('RSL1:')) return undefined;
  return JSON.parse(Buffer.from(line.slice(5), 'base64url').toString('utf8')).key;
}

/** What the fixture was asked to build or bind — every recorded event but the messages it received. */
function builtEvents(path: string): Record<string, unknown>[] {
  return readRecordEvents(path).filter((event) => !('received' in event));
}

function readRecordEvents(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('the transcript the parent reads is the one the child wrote', () => {
  function forkSetup() {
    const cwd = directory('sealing-fork-cwd-');
    const logsDir = directory('sealing-fork-logs-');
    const resumeSessionId = 'session_fork_transcript';
    // The parent's plain store, which lends the record; the fork fixture's store is one over it.
    const store = createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' });
    store.save(forkRecord(resumeSessionId, cwd), { handoff: true });
    return { cwd, logsDir, resumeSessionId, store };
  }

  it(
    'for a fork job run in the parent checkout',
    async () => {
      const { cwd, logsDir, resumeSessionId, store } = forkSetup();
      const runner = new ChildProcessSubagentRunner(createDeps({ resumeSessionStore: store }), {
        logSealing: 'plain',
        workerEntry: FORK_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
      });

      const handle = runner.start(job(cwd, { resumeSessionId }));
      await handle.result;
      const page = await handle.readLog?.({ offset: 0 });

      expect(handle.transcriptPath).toBe(
        join(logsDir, 'session_parent', 'subagents', `${resumeSessionId}.jsonl`),
      );
      expect(page?.lines.length).toBeGreaterThan(0);
      expect(page?.lines.join('\n')).toContain('Continue the forked record.');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'for a fork job isolated in a worktree, the default for /fork',
    async () => {
      const { cwd, logsDir, resumeSessionId, store } = forkSetup();
      const worktrees: ISubagentWorktreeAdapter = {
        prepare: ({ taskId }) => ({
          repoRoot: cwd,
          worktreePath: directory(`sealing-worktree-${taskId}-`),
          branchName: `agent/${taskId}`,
        }),
        isClean: () => true,
        remove: () => {},
      };
      const runner = createChildProcessSubagentRunnerFactory({
        logSealing: 'plain',
        workerEntry: FORK_WORKER,
        worktreeAdapter: worktrees,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
      })(createDeps({ resumeSessionStore: store }));

      const handle = runner.start(job(cwd, { resumeSessionId, isolation: 'worktree' }));
      await handle.result;
      const page = await handle.readLog?.({ offset: 0 });

      expect(handle.transcriptPath).toBe(
        join(logsDir, 'session_parent', 'subagents', `${resumeSessionId}.jsonl`),
      );
      expect(page?.lines.join('\n')).toContain('Continue the forked record.');
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * What the earlier paging returned for a page of a plain transcript (`readTranscriptLog`
 * over `createBackgroundTaskLogPage`, as at f7c8ed234), kept here verbatim as the golden reference.
 */
function pagePre3b(
  taskId: string,
  transcriptPath: string,
  cursor?: IBackgroundTaskLogCursor,
): IBackgroundTaskLogPage {
  if (!existsSync(transcriptPath)) return { taskId, cursor, lines: [] };
  const lines = readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const offset = cursor?.offset ?? 0;
  const nextOffset = Math.min(offset + 200, lines.length);
  return {
    taskId,
    cursor,
    nextCursor: nextOffset < lines.length ? { offset: nextOffset } : undefined,
    lines: lines.slice(offset, nextOffset),
  };
}

describe('a plain transcript pages by its display lines', () => {
  it(
    'offset for offset, past the end, negative and not a number, and with no transcript at all',
    async () => {
      const cwd = directory('plain-pages-');
      const logsDir = directory('plain-pages-logs-');
      const transcript = join(logsDir, 'session_parent', 'subagents', 'agent_1.jsonl');
      mkdirSync(join(logsDir, 'session_parent', 'subagents'), { recursive: true });
      const records = Array.from(
        { length: 450 },
        (_, index) =>
          `{"event":"e${index}"}${index % 7 === 0 ? '\r\n' : '\n'}${index % 50 === 0 ? '\n' : ''}`,
      );
      writeFileSync(transcript, records.join(''));
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        logSealing: 'plain',
        workerEntry: ECHO_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
      });
      const handle = runner.start(job(cwd));
      await handle.result;
      const length = readFileSync(transcript, 'utf8').split(/\r?\n/).filter(Boolean).length;
      expect(length).toBe(450);

      for (const offset of [0, 1, 199, 200, length - 1, length, length + 5, -5, Number.NaN]) {
        const cursor = { offset };
        expect(await handle.readLog?.(cursor), `offset ${offset}`).toStrictEqual(
          pagePre3b('agent_1', transcript, cursor),
        );
      }
      expect(await handle.readLog?.()).toStrictEqual(pagePre3b('agent_1', transcript));

      const missing = new ChildProcessSubagentRunner(createDeps(), {
        logSealing: 'plain',
        workerEntry: ECHO_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir: directory('plain-pages-none-'),
      }).start(job(cwd));
      await missing.result;
      expect(await missing.readLog?.({ offset: 0 })).toStrictEqual(
        pagePre3b('agent_1', join(logsDir, 'nowhere.jsonl'), { offset: 0 }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('a sealing parent’s fork job', () => {
  function lockedSealingParent() {
    const cwd = directory('sealing-parent-');
    const sealer = createTestArtifactSealer({ locked: true });
    const store = createUserSessionStore(join(cwd, 'sessions'), { sealing: { sealer } });
    store.save(forkRecord('session_fork_held', cwd), { handoff: true });
    return { cwd, sealer, store };
  }

  it(
    'carries the record only as top-level resumeHeld — never on the request, task state, events or result',
    async () => {
      const { cwd, sealer, store } = lockedSealingParent();
      const payloadPath = join(cwd, 'payload.json');
      const runner = new ChildProcessSubagentRunner(createDeps({ resumeSessionStore: store }), {
        workerEntry: ECHO_WORKER,
        env: { AGENT_FIXTURE_MODE: 'record-payload', AGENT_FIXTURE_PAYLOAD_PATH: payloadPath },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logSealing: { sealer },
        resumeStore: { scope: 'project', repositoryKey: 'fixture-repo', worktreeRoot: cwd },
      });
      const manager = new SubagentManager({ runner });
      const events: TBackgroundTaskEvent[] = [];
      manager.getBackgroundTaskManager().subscribe((event) => events.push(event));

      const state = await manager.spawn({
        ...job(cwd).request,
        resumeSessionId: 'session_fork_held',
      });
      const result = await manager.wait(state.id);
      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as Record<string, unknown>;

      expect(payload.resumeStore).toEqual({
        scope: 'project',
        repositoryKey: 'fixture-repo',
        worktreeRoot: cwd,
      });

      const held = payload.resumeHeld as string;
      expect(Buffer.from(held.split('.')[3] as string, 'base64url').toString('utf8')).toContain(
        CANARY,
      );
      const elsewhere = JSON.stringify({
        payload: { ...payload, resumeHeld: undefined },
        events,
        tasks: manager.getBackgroundTaskManager().list(),
        result,
      });
      const encoded = [0, 1, 2].map((shift) =>
        Buffer.from(`${'x'.repeat(shift)}${CANARY}`)
          .toString('base64url')
          .slice(4, -4),
      );
      for (const form of [CANARY, ...encoded]) expect(elsewhere).not.toContain(form);
      expect(elsewhere).not.toContain(held.slice(0, 40));
    },
    TEST_TIMEOUT_MS,
  );

  it('fails before preparing a worktree or spawning when the keys are locked and nothing is left to hand over', () => {
    const { cwd, sealer, store } = lockedSealingParent();
    const { runner, prepare } = isolatedRunner(createDeps({ resumeSessionStore: store }), {
      workerEntry: ECHO_WORKER,
      env: {
        AGENT_FIXTURE_MODE: 'record-payload',
        AGENT_FIXTURE_PAYLOAD_PATH: join(cwd, 'p.json'),
      },
      logSealing: { sealer },
    });
    const forkJob = job(cwd, { resumeSessionId: 'session_fork_held', isolation: 'worktree' });
    const first = runner.start(forkJob);
    void first.result.catch(() => undefined);
    // The child runs the fork and rewrites it, as a real one does; the parent holds nothing of that.
    const envelope = JSON.stringify({
      schemaVersion: 2,
      record: forkRecord('session_fork_held', cwd),
    });
    writeFileSync(
      join(cwd, 'sessions', 'session_fork_held.json'),
      sealer.sealBytes(Buffer.from(envelope), { kind: 'session-record', id: 'session_fork_held' }),
    );

    expect(() => runner.start(forkJob)).toThrow(
      'Session session_fork_held is sealed and could not be handed to its subagent: the keys are ' +
        'locked and this session no longer holds the record. Unlock, then run /fork again.',
    );
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(spawned.children).toHaveLength(1);
    return first.result.catch(() => undefined);
  });

  it('says a fork record that does not open cannot be handed over, never to unlock', () => {
    const cwd = directory('sealing-parent-');
    const sealer = createTestArtifactSealer();
    const store = createUserSessionStore(join(cwd, 'sessions'), { sealing: { sealer } });
    // Sealed with keys this session does not hold, so it opens for no one here.
    createUserSessionStore(join(cwd, 'sessions'), {
      sealing: { sealer: createTestArtifactSealer() },
    }).save(forkRecord('session_fork_foreign', cwd));
    const { runner, prepare } = isolatedRunner(createDeps({ resumeSessionStore: store }), {
      workerEntry: ECHO_WORKER,
      logSealing: { sealer },
    });

    let failure: unknown;
    try {
      runner.start(job(cwd, { resumeSessionId: 'session_fork_foreign', isolation: 'worktree' }));
    } catch (error) {
      failure = error;
    }
    expect((failure as Error).message).toBe(
      'Session session_fork_foreign could not be handed to its subagent: its saved record is ' +
        'missing, does not open, or is not sealed, so this session has nothing to hand over. The ' +
        'subagent was not started; run /fork again.',
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(spawned.children).toHaveLength(0);
  });

  it('fails before preparing a worktree or spawning when the record is past the wire bound', () => {
    const { cwd, sealer } = lockedSealingParent();
    const huge = {
      load: () => ({ status: 'missing' }),
      exportHeld: () => 'r'.repeat(32 * 1024 * 1024 + 1),
    };
    const { runner, prepare } = isolatedRunner(createDeps({ resumeSessionStore: huge as never }), {
      workerEntry: ECHO_WORKER,
      logSealing: { sealer },
    });

    expect(() =>
      runner.start(job(cwd, { resumeSessionId: 'session_fork_held', isolation: 'worktree' })),
    ).toThrow(/too large to hand to a subagent \(the limit is 32 MiB\)/);
    expect(prepare).not.toHaveBeenCalled();
    expect(spawned.children).toHaveLength(0);
  });

  it('refuses before preparing a worktree or spawning when its sealer cannot issue a write grant', () => {
    const { cwd, sealer } = lockedSealingParent();
    const { runner, prepare } = isolatedRunner(createDeps(), {
      workerEntry: ECHO_WORKER,
      logSealing: { sealer: { ...sealer, writeGrant: undefined } },
    });

    expect(() => runner.start(job(cwd, { isolation: 'worktree' }))).toThrow(
      /cannot hand its sealing to a subagent/,
    );
    expect(prepare).not.toHaveBeenCalled();
    expect(spawned.children).toHaveLength(0);
  });

  it('checks the record can be handed over without taking it, and the check holds none of it', () => {
    const { cwd, sealer, store } = lockedSealingParent();
    const runner = new ChildProcessSubagentRunner(createDeps({ resumeSessionStore: store }), {
      workerEntry: ECHO_WORKER,
      worktreeAdapter: NO_WORKTREES,
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      logSealing: { sealer },
    });
    const forkJob = job(cwd, { resumeSessionId: 'session_fork_held', isolation: 'worktree' });

    const checked: unknown = runner.preflight(forkJob);

    expect(checked).toBeUndefined();
    const left = store.exportHeld?.('session_fork_held', { keep: true });
    expect(heldText(left as string)).toContain(CANARY);
    expect(spawned.children).toHaveLength(0);
  });

  it(
    'leaves the record to hand over when preparing the worktree fails, so a retry resumes it',
    async () => {
      const { cwd, sealer, store } = lockedSealingParent();
      const payloadPath = join(cwd, 'payload.json');
      const { runner, prepare } = isolatedRunner(createDeps({ resumeSessionStore: store }), {
        workerEntry: ECHO_WORKER,
        env: { AGENT_FIXTURE_MODE: 'record-payload', AGENT_FIXTURE_PAYLOAD_PATH: payloadPath },
        logSealing: { sealer },
      });
      const forkJob = job(cwd, { resumeSessionId: 'session_fork_held', isolation: 'worktree' });
      prepare.mockImplementationOnce(() => {
        throw new Error('git worktree add failed');
      });

      expect(() => runner.start(forkJob)).toThrow('git worktree add failed');
      expect(spawned.children).toHaveLength(0);
      await runner.start(forkJob).result;

      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as { resumeHeld?: string };
      expect(heldText(payload.resumeHeld as string)).toContain(CANARY);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves the record to hand over when the connection check refuses the job, so a retry resumes it',
    async () => {
      const { cwd, sealer, store } = lockedSealingParent();
      const payloadPath = join(cwd, 'payload.json');
      const expectedEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        SEALING_FIXTURE_DESTINATION: 'https://elsewhere.example',
      };
      const { runner, prepare } = isolatedRunner(createDeps({ resumeSessionStore: store }), {
        workerEntry: ECHO_WORKER,
        env: {
          AGENT_FIXTURE_MODE: 'record-payload',
          AGENT_FIXTURE_PAYLOAD_PATH: payloadPath,
          SEALING_FIXTURE_DESTINATION: 'https://here.example',
        },
        expectedEnvironment,
        providerDefinitions: [
          {
            type: 'openai',
            destinationEnvironment: ['SEALING_FIXTURE_DESTINATION'],
            createProvider: () => ({}) as never,
          },
        ],
        logSealing: { sealer },
      });
      const forkJob = job(cwd, { resumeSessionId: 'session_fork_held', isolation: 'worktree' });

      expect(() => runner.start(forkJob)).toThrow(
        /sets SEALING_FIXTURE_DESTINATION differently from this session/,
      );
      expect(spawned.children).toHaveLength(0);
      expectedEnvironment.SEALING_FIXTURE_DESTINATION = 'https://here.example';
      await runner.start(forkJob).result;

      expect(prepare).toHaveBeenCalledTimes(2);
      const payload = JSON.parse(readFileSync(payloadPath, 'utf8')) as { resumeHeld?: string };
      expect(heldText(payload.resumeHeld as string)).toContain(CANARY);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'resumes the handed-over record in the child and saves the child’s turn sealed',
    async () => {
      const cwd = directory('sealing-handoff-');
      const logsDir = directory('sealing-handoff-logs-');
      const parent = fixtureParentSealer('key-a');
      parent.lock();
      const store = createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: parent.sealer },
      });
      // `/fork` writes the copy from the live session, as the owner's.
      store.save(forkRecord('session_fork_child', cwd), { handoff: true, provenance: 'owner' });
      const runner = new ChildProcessSubagentRunner(createDeps({ resumeSessionStore: store }), {
        workerEntry: SEALING_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
        logSealing: { sealer: parent.sealer },
      });

      const handle = runner.start(job(cwd, { resumeSessionId: 'session_fork_child' }));
      const result = await handle.result;
      const lockedPage = await handle.readLog?.({ offset: 0 });
      parent.unlock();
      const reread = store.load('session_fork_child');
      const page = await handle.readLog?.({ offset: 0 });

      expect(result.output).toBe('the child process answers');
      expect(handle.transcriptSealed).toBe(true);
      expect(reread.status).toBe('valid');
      if (reread.status === 'valid') {
        const text = JSON.stringify(reread.record.messages);
        expect(text).toContain(CANARY);
        expect(text).toContain('the child process answers');
      }
      expect(readFileSync(join(cwd, 'sessions', 'session_fork_child.json'), 'utf8')).not.toContain(
        'the child process answers',
      );
      expect(lockedPage?.lines).toHaveLength(1);
      expect(lockedPage?.lines[0]).toMatch(/^\[\d+ sealed log records?; the keys are locked\]$/);
      expect(lockedPage?.unreadable?.locked).toBeGreaterThan(0);
      expect(page?.unreadable).toBeUndefined();
      expect(page?.lines.join('\n')).toContain('Continue the forked record.');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('a child whose parent seals', () => {
  it(
    'fails before anything is built when its composition cannot seal — never plain',
    async () => {
      const cwd = directory('sealing-unbound-');
      const recordPath = join(cwd, 'record.jsonl');
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: SEALING_WORKER,
        env: { SEALING_FIXTURE_BIND: 'none', SEALING_FIXTURE_RECORD: recordPath },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir: directory('sealing-unbound-logs-'),
        logSealing: { sealer: fixtureParentSealer('key-a').sealer },
      });

      await expect(runner.start(job(cwd)).result).rejects.toThrow(
        /must seal what it writes, but this composition cannot seal/,
      );
      expect(builtEvents(recordPath)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it.each([
    ['binds plain', 'plain'],
    ['binds a sealer for another key', 'foreign'],
  ])(
    'fails before anything is built when its composition %s for the grant — never plain',
    async (_case, bind) => {
      const cwd = directory('sealing-misbound-');
      const recordPath = join(cwd, 'record.jsonl');
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: SEALING_WORKER,
        env: { SEALING_FIXTURE_BIND: bind, SEALING_FIXTURE_RECORD: recordPath },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir: directory('sealing-misbound-logs-'),
        logSealing: { sealer: fixtureParentSealer('key-a').sealer },
      });

      await expect(runner.start(job(cwd)).result).rejects.toThrow(
        /must seal to the key its parent handed it, but this composition's bindWriteGrant returned a sealing that does not/,
      );
      expect(builtEvents(recordPath)).toEqual([{ bind: 'fixture-grant:key-a' }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops with fixed text when it cannot follow a newer grant',
    async () => {
      const cwd = directory('sealing-stale-');
      const recordPath = join(cwd, 'record.jsonl');
      const marker = join(cwd, 'release');
      const parent = fixtureParentSealer('key-before-unlock');
      const listeners = new Set<() => void>();
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: SEALING_WORKER,
        env: {
          SEALING_FIXTURE_BIND: 'stale',
          SEALING_FIXTURE_RECORD: recordPath,
          SEALING_FIXTURE_HOLD_UNTIL: marker,
        },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir: directory('sealing-stale-logs-'),
        logSealing: { sealer: parent.sealer },
        watchSealingKey: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });

      const handle = runner.start(job(cwd));
      await vi.waitFor(() => expect(readRecordEvents(recordPath)).toContainEqual({ chat: true }), {
        timeout: 15_000,
      });
      parent.rotate('key-verified');
      for (const listener of listeners) listener();
      await vi.waitFor(
        () =>
          expect(readRecordEvents(recordPath)).toContainEqual({
            bind: 'fixture-grant:key-verified',
          }),
        { timeout: 15_000 },
      );
      writeFileSync(marker, '');

      await expect(handle.result).rejects.toThrow(
        'subagent worker: the parent now seals to another key and this subagent could not seal ' +
          'to it, so it stopped rather than go on sealing to the key its parent replaced.',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'is started with the key the parent verified after it was spawned, and is sent no grant ahead of its payload',
    async () => {
      const cwd = directory('sealing-early-key-');
      const logsDir = directory('sealing-early-key-logs-');
      const recordPath = join(cwd, 'record.jsonl');
      const parent = fixtureParentSealer('key-before-unlock');
      const listeners = new Set<() => void>();
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: SEALING_WORKER,
        env: { SEALING_FIXTURE_RECORD: recordPath },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
        logSealing: { sealer: parent.sealer },
        watchSealingKey: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });

      const handle = runner.start(job(cwd));
      // The parent's first unlock verifies another key once the child is spawned and before it is
      // sent its payload.
      spawned.children[0]?.once('spawn', () => {
        parent.rotate('key-verified');
        for (const listener of listeners) listener();
      });
      await handle.result;

      const received = readRecordEvents(recordPath).filter((event) => 'received' in event);
      expect(received[0]).toEqual({ received: 'start', grant: 'fixture-grant:key-verified' });
      expect(received.filter((event) => event.received === 'sealing_key')).toEqual([]);
      expect(readRecordEvents(recordPath).filter((event) => 'bind' in event)).toEqual([
        { bind: 'fixture-grant:key-verified' },
      ]);
      const keys = readFileSync(handle.transcriptPath as string, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(keyOfLine);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.every((key) => key === 'key-verified')).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'says a handed-over record that changed since cannot be resumed, and to /fork again — never to unlock',
    async () => {
      const cwd = directory('sealing-changed-');
      const parent = fixtureParentSealer('key-a');
      parent.lock();
      const store = createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: parent.sealer },
      });
      store.save(forkRecord('session_fork_changed', cwd), { handoff: true });
      const runner = new ChildProcessSubagentRunner(createDeps({ resumeSessionStore: store }), {
        workerEntry: SEALING_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logSealing: { sealer: parent.sealer },
      });

      const handle = runner.start(job(cwd, { resumeSessionId: 'session_fork_changed' }));
      // Another writer replaces the record after it was handed over and before the child reads it.
      writeFileSync(
        join(cwd, 'sessions', 'session_fork_changed.json'),
        parent.sealer.sealBytes(
          Buffer.from(
            JSON.stringify({
              schemaVersion: 2,
              record: forkRecord('session_fork_changed', join(cwd, 'elsewhere')),
            }),
          ),
          { kind: 'session-record', id: 'session_fork_changed' },
        ),
      );
      const failure = await handle.result.then(
        () => undefined,
        (error: Error) => error,
      );

      expect(failure?.message).toBe(
        'subagent worker: job agent_1 cannot resume session session_fork_changed: its record ' +
          'changed after the parent handed it over, so the copy this job holds is not what is ' +
          'saved. Run /fork again from the parent session.',
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'seals to the verified key once the parent’s key changes while it runs',
    async () => {
      const cwd = directory('sealing-rotate-');
      const logsDir = directory('sealing-rotate-logs-');
      const recordPath = join(cwd, 'record.jsonl');
      const marker = join(cwd, 'release');
      const parent = fixtureParentSealer('key-before-unlock');
      const listeners = new Set<() => void>();
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: SEALING_WORKER,
        env: { SEALING_FIXTURE_RECORD: recordPath, SEALING_FIXTURE_HOLD_UNTIL: marker },
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logsDir,
        logSealing: { sealer: parent.sealer },
        watchSealingKey: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      });

      const handle = runner.start(job(cwd));
      await vi.waitFor(() => expect(readRecordEvents(recordPath)).toContainEqual({ chat: true }), {
        timeout: 15_000,
      });
      // The parent's first unlock verified a key other than the one the child was started with.
      parent.rotate('key-verified');
      for (const listener of listeners) listener();
      await vi.waitFor(
        () =>
          expect(readRecordEvents(recordPath)).toContainEqual({
            bind: 'fixture-grant:key-verified',
          }),
        { timeout: 15_000 },
      );
      writeFileSync(marker, '');
      await handle.result;

      const keys = readFileSync(handle.transcriptPath as string, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(keyOfLine);
      expect(keys).not.toContain(undefined);
      expect(keys[0]).toBe('key-before-unlock');
      const firstVerified = keys.indexOf('key-verified');
      expect(firstVerified).toBeGreaterThan(0);
      expect(keys.slice(firstVerified).every((key) => key === 'key-verified')).toBe(true);
      expect(readRecordEvents(recordPath).filter((event) => 'bind' in event)).toEqual([
        { bind: 'fixture-grant:key-before-unlock' },
        { bind: 'fixture-grant:key-verified' },
      ]);
      // The child is gone, so nothing is left watching the parent's key.
      await vi.waitFor(() => expect(listeners.size).toBe(0));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'says a fork record it cannot open was not handed to it, never to unlock',
    async () => {
      const cwd = directory('sealing-no-handoff-');
      const sealedElsewhere = fixtureParentSealer('key-a');
      createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: sealedElsewhere.sealer },
      }).save(forkRecord('session_fork_unhanded', cwd));
      // A plain parent's store over the same files: it lends the record, which it cannot open.
      const parentStore = createUserSessionStore(join(cwd, 'sessions'), { sealing: 'plain' });
      const runner = new ChildProcessSubagentRunner(
        createDeps({ resumeSessionStore: parentStore }),
        {
          logSealing: 'plain',
          workerEntry: SEALING_WORKER,
          worktreeAdapter: NO_WORKTREES,
          providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        },
      );

      const failure = await runner
        .start(job(cwd, { resumeSessionId: 'session_fork_unhanded' }))
        .result.then(
          () => undefined,
          (error: Error) => error,
        );

      expect(failure?.message).toMatch(/record is sealed and was not handed to this job/);
      expect(failure?.message).not.toMatch(/unlock/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops before its run starts when a newer grant it cannot follow arrives while it is being built',
    async () => {
      const cwd = directory('sealing-early-stale-');
      const recordPath = join(cwd, 'record.jsonl');
      const marker = join(cwd, 'release');
      const parent = fixtureParentSealer('key-before-unlock');
      const listeners = new Set<() => void>();
      const snapshotting = { snapshot: async () => 'snap-1' } as never;
      const runner = new ChildProcessSubagentRunner(
        createDeps({ sandboxClient: snapshotting, sandboxType: 'fixture' }),
        {
          workerEntry: SEALING_WORKER,
          env: {
            SEALING_FIXTURE_BIND: 'stale',
            SEALING_FIXTURE_RECORD: recordPath,
            SEALING_FIXTURE_RESTORE_UNTIL: marker,
          },
          worktreeAdapter: NO_WORKTREES,
          providerDefinitions: TEST_PROVIDER_DEFINITIONS,
          logsDir: directory('sealing-early-stale-logs-'),
          logSealing: { sealer: parent.sealer },
          watchSealingKey: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      );

      const handle = runner.start(job(cwd));
      // The parent's key changes while the child is still restoring its sandbox.
      await vi.waitFor(
        () => expect(readRecordEvents(recordPath)).toContainEqual({ restore: 'snap-1' }),
        { timeout: 15_000 },
      );
      parent.rotate('key-verified');
      for (const listener of listeners) listener();
      await vi.waitFor(
        () =>
          expect(readRecordEvents(recordPath)).toContainEqual({
            bind: 'fixture-grant:key-verified',
          }),
        { timeout: 15_000 },
      );
      writeFileSync(marker, '');

      await expect(handle.result).rejects.toThrow(
        'subagent worker: the parent now seals to another key and this subagent could not seal ' +
          'to it, so it stopped rather than go on sealing to the key its parent replaced.',
      );
      const built = builtEvents(recordPath);
      expect(built).not.toContainEqual({ createProvider: true });
      expect(built).not.toContainEqual({ chat: true });
      const transcript = handle.transcriptPath as string;
      expect(existsSync(transcript) ? readFileSync(transcript, 'utf8') : '').toBe('');
    },
    TEST_TIMEOUT_MS,
  );
});

/**
 * A job that fails after its child was spawned and before the child was started: the child waits for
 * a `start` that never comes, so it is cancelled before the job rejects rather than left running.
 */
describe('a job whose start cannot be sent', () => {
  it(
    'cancels its child before rejecting when the grant cannot be read as start is sent',
    async () => {
      const cwd = directory('sealing-grant-at-send-');
      const parent = fixtureParentSealer('key-a');
      let unreadable = false;
      const sealer: IArtifactSealer = {
        ...parent.sealer,
        writeGrant: () => {
          if (unreadable) throw new Error('The sealing public key could not be read.');
          return parent.sealer.writeGrant?.() as string;
        },
      };
      const runner = new ChildProcessSubagentRunner(createDeps(), {
        workerEntry: ECHO_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        killGraceMs: 200,
        logSealing: { sealer },
      });

      const handle = runner.start(job(cwd));
      // Spawned and not yet sent `start`, which reads the grant again.
      spawned.children[0]?.once('spawn', () => {
        unreadable = true;
      });

      await expect(handle.result).rejects.toThrow('The sealing public key could not be read.');
      expect(spawned.children).toHaveLength(1);
      expect(exited(spawned.children[0])).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});

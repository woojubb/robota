/**
 * #3679 step 3e — a sealing parent vouches for the fork record its child-process subagent saved, on
 * the real spawn and IPC path (the sealing fixture enters `runSubagentWorkerMain` from the built
 * package and keeps its store with a write-only sealer, as a real child does).
 *
 * - The parent hands over only the copy `/fork` left (`handoffOnly`), never a record it opens from
 *   a file anyone with the public key could have sealed.
 * - A job that started from the owner's copy and saved cleanly ends with its record tagged as the
 *   owner's — at once while unlocked, at the next unlock while locked; anything else stays unverified.
 * - A save the child had refused is carried in the job's terminal message.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ArtifactCorruptError, ArtifactLockedError } from '@robota-sdk/agent-core';
import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChildProcessSubagentRunner } from '../index.js';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';

const spawned = vi.hoisted(() => ({
  children: [] as import('node:child_process').ChildProcess[],
  messages: [] as unknown[],
  /** Rewrites what the parent sends, to play a parent of another build. */
  rewriteSend: undefined as ((message: unknown) => unknown) | undefined,
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child = actual.spawn(...args);
      spawned.children.push(child);
      child.on('message', (message) => spawned.messages.push(message));
      const send = child.send.bind(child) as (...sendArgs: unknown[]) => boolean;
      (child as { send: unknown }).send = (message: unknown, ...rest: unknown[]) =>
        send(spawned.rewriteSend?.(message) ?? message, ...rest);
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
import type { TResumeSessionStore } from '../index.js';

const testHost = createTestFrameworkHost();

type IInteractiveSessionRecord = Parameters<TResumeSessionStore['save']>[0];

const TEST_TIMEOUT_MS = 30_000;
const SEALING_WORKER = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/sealing-worker-entry.mjs', import.meta.url))],
  execArgv: [] as readonly string[],
};
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
const FORK_ID = 'session_fork_vouched';
const CHILD_ANSWER = 'the child process answers';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  spawned.children.length = 0;
  spawned.messages.length = 0;
  spawned.rewriteSend = undefined;
});
function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

function createDeps(store: TResumeSessionStore): IInProcessSubagentRunnerDeps {
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
    resumeSessionStore: store,
  };
}

function job(cwd: string): ISubagentJobStart {
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
      resumeSessionId: FORK_ID,
    },
  };
}

function forkRecord(cwd: string, text = 'the parent conversation'): IInteractiveSessionRecord {
  return {
    id: FORK_ID,
    name: 'parent (fork)',
    cwd,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-1',
        role: 'user',
        content: text,
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

/**
 * The parent half of the sealing fixture's stand-in sealer (see `fixtures/sealing-worker-entry.mjs`),
 * with the authorship tags a real unlocked keyring makes: an HMAC under a key only this process holds,
 * made and checked only while unlocked, and unlock listeners held weakly.
 */
function authoringParentSealer(key: string) {
  const secret = randomBytes(32);
  let locked = false;
  const listeners = new Set<WeakRef<() => void>>();
  const seal = (context: IArtifactContext, text: string): string =>
    Buffer.from(JSON.stringify({ key, kind: context.kind, id: context.id, text })).toString(
      'base64url',
    );
  const tag = (bytes: Uint8Array, context: IArtifactContext): Buffer => {
    if (locked) throw new ArtifactLockedError();
    const digest = createHash('sha256').update(bytes).digest('hex');
    return createHmac('sha256', secret).update(`${context.kind}|${context.id}|${digest}`).digest();
  };
  const sealer: IArtifactSealer = {
    sealLine: (plain, context) => `RSL1:${seal(context, plain)}`,
    sealBytes: (plain, context) =>
      Buffer.from(`RSL1${seal(context, Buffer.from(plain).toString('utf8'))}`),
    openLine: () => {
      throw new ArtifactCorruptError();
    },
    openBytes: (stored, context) => {
      if (locked) throw new ArtifactLockedError();
      const text = Buffer.from(stored).toString('latin1');
      if (!text.startsWith('RSL1')) throw new ArtifactCorruptError();
      const parsed = JSON.parse(Buffer.from(text.slice(4), 'base64url').toString('utf8')) as {
        key: string;
        kind: string;
        id: string;
        text: string;
      };
      if (parsed.key !== key || parsed.kind !== context.kind || parsed.id !== context.id) {
        throw new ArtifactCorruptError();
      }
      return Buffer.from(parsed.text, 'utf8');
    },
    isSealedLine: (stored) => /^RSL[0-9]:/.test(stored),
    isSealedBytes: (stored) =>
      /^RSL[0-9]$/.test(Buffer.from(stored).subarray(0, 4).toString('latin1')),
    writeGrant: () => `fixture-grant:${key}`,
    tagAuthorship: tag,
    verifyAuthorship: (bytes, candidate, context) => {
      const expected = tag(bytes, context);
      return candidate.length === expected.length && timingSafeEqual(expected, candidate);
    },
    onUnlock: (listener) => {
      const reference = new WeakRef(listener);
      listeners.add(reference);
      return () => {
        listeners.delete(reference);
      };
    },
  };
  return {
    sealer,
    lock() {
      locked = true;
    },
    unlock() {
      locked = false;
      for (const reference of [...listeners]) reference.deref()?.();
    },
  };
}

/** A sealing parent and the store it wrote the fork record to for a handoff. */
function sealingParent(provenance: 'owner' | 'unverified') {
  const cwd = directory('countersign-');
  const parent = authoringParentSealer('key-a');
  const store = createUserSessionStore(join(cwd, 'sessions'), {
    sealing: { sealer: parent.sealer },
  });
  store.save(forkRecord(cwd), { handoff: true, provenance });
  const runner = new ChildProcessSubagentRunner(createDeps(store), {
    workerEntry: SEALING_WORKER,
    worktreeAdapter: NO_WORKTREES,
    providerDefinitions: TEST_PROVIDER_DEFINITIONS,
    logSealing: { sealer: parent.sealer },
    env: { SEALING_FIXTURE_RECORD: join(cwd, 'record.jsonl') },
  });
  /** Whose a store that never saw the record says it is. */
  const seenFresh = (): unknown => {
    const outcome = createUserSessionStore(join(cwd, 'sessions'), {
      sealing: { sealer: parent.sealer },
    }).load(FORK_ID);
    return outcome.status === 'valid' ? outcome.authorship : outcome.status;
  };
  const contentNow = (): string => {
    const outcome = createUserSessionStore(join(cwd, 'sessions'), {
      sealing: { sealer: parent.sealer },
    }).load(FORK_ID);
    return outcome.status === 'valid' ? JSON.stringify(outcome.record.messages) : outcome.status;
  };
  return { cwd, parent, store, runner, seenFresh, contentNow };
}

/** Resolves once the job's child has exited and its channel is closed. */
async function childGone(): Promise<void> {
  const child = spawned.children[0];
  if (child === undefined) throw new Error('no child was spawned');
  await vi.waitFor(() => expect(child.exitCode !== null && !child.connected).toBe(true), {
    timeout: 15_000,
  });
  // The parent's own listeners for `exit` and `disconnect` run in the same turns as these.
  await new Promise((resolve) => setImmediate(resolve));
}

function readRecordEvents(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('a sealing parent’s fork job, once its child is gone', () => {
  it(
    'leaves the record the child saved tagged as the owner’s, when it started from the owner’s copy',
    async () => {
      const { cwd, runner, seenFresh, contentNow } = sealingParent('owner');

      const result = await runner.start(job(cwd)).result;
      await childGone();

      expect(result.output).toBe(CHILD_ANSWER);
      expect(contentNow()).toContain(CHILD_ANSWER);
      expect(seenFresh()).toBe('verified');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'is not run from a copy that was not the owner’s, and vouches for nothing',
    async () => {
      const { cwd, runner, seenFresh, contentNow } = sealingParent('unverified');

      await expect(runner.start(job(cwd)).result).rejects.toThrow(
        `Cannot resume session ${FORK_ID}: nothing shows that you wrote it`,
      );
      await childGone();

      expect(contentNow()).not.toContain(CHILD_ANSWER);
      expect(seenFresh()).toBe('unverified');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'settles it at the next unlock when the keys locked while the child ran',
    async () => {
      const { cwd, parent, runner, seenFresh } = sealingParent('owner');
      parent.lock();

      await runner.start(job(cwd)).result;
      await childGone();
      expect(seenFresh()).toBe('locked');

      parent.unlock();

      expect(seenFresh()).toBe('verified');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'reports a save the child had refused in the job’s terminal message, and vouches for nothing',
    async () => {
      const cwd = directory('countersign-refused-');
      const recordPath = join(cwd, 'record.jsonl');
      const marker = join(cwd, 'release');
      const parent = authoringParentSealer('key-a');
      const store = createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: parent.sealer },
      });
      store.save(forkRecord(cwd), { handoff: true, provenance: 'owner' });
      const runner = new ChildProcessSubagentRunner(createDeps(store), {
        workerEntry: SEALING_WORKER,
        worktreeAdapter: NO_WORKTREES,
        providerDefinitions: TEST_PROVIDER_DEFINITIONS,
        logSealing: { sealer: parent.sealer },
        env: { SEALING_FIXTURE_RECORD: recordPath, SEALING_FIXTURE_HOLD_UNTIL: marker },
      });

      const handle = runner.start(job(cwd));
      await vi.waitFor(() => expect(readRecordEvents(recordPath)).toContainEqual({ chat: true }), {
        timeout: 15_000,
      });
      // Something that only has the public key replaces the record while the child runs.
      createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: parent.sealer },
      }).save(forkRecord(cwd, 'planted while the child ran'));
      writeFileSync(marker, '');
      const failure = await handle.result.then(
        () => undefined,
        (error: Error) => error,
      );
      await childGone();

      expect(failure?.message).toMatch(
        new RegExp(
          `^Session ${FORK_ID} was changed on disk by something this subagent cannot verify, so ` +
            'its turns from then on were not saved to it\\. ',
        ),
      );
      const outcome = createUserSessionStore(join(cwd, 'sessions'), {
        sealing: { sealer: parent.sealer },
      }).load(FORK_ID);
      expect(outcome.status === 'valid' && outcome.authorship).toBe('unverified');
      expect(outcome.status === 'valid' && JSON.stringify(outcome.record.messages)).toContain(
        'planted while the child ran',
      );
    },
    TEST_TIMEOUT_MS,
  );
});

describe('what a fork job hands over', () => {
  it('is only the copy /fork left, never a record opened from a file sealed by someone else', () => {
    const cwd = directory('countersign-handoff-only-');
    const parent = authoringParentSealer('key-a');
    const store = createUserSessionStore(join(cwd, 'sessions'), {
      sealing: { sealer: parent.sealer },
    });
    // No /fork wrote it: another program with the public key planted it under the fork's id.
    createUserSessionStore(join(cwd, 'sessions'), { sealing: { sealer: parent.sealer } }).save(
      forkRecord(cwd, 'planted under the fork id'),
    );
    const runner = new ChildProcessSubagentRunner(createDeps(store), {
      workerEntry: SEALING_WORKER,
      worktreeAdapter: NO_WORKTREES,
      providerDefinitions: TEST_PROVIDER_DEFINITIONS,
      logSealing: { sealer: parent.sealer },
    });

    expect(() => runner.start(job(cwd))).toThrow(
      `Session ${FORK_ID} could not be handed to its subagent: this session no longer holds the ` +
        'copy /fork wrote for it, or the file changed since. The subagent was not started; run ' +
        '/fork again.',
    );
    expect(spawned.children).toHaveLength(0);
  });
});

describe('record saves on the wire', () => {
  const recordSaves = (): unknown[] =>
    spawned.messages.filter(
      (message) => (message as { type?: unknown } | null)?.type === 'record_saved',
    );

  it(
    'are sent after each save of the fork record it was handed',
    async () => {
      const { cwd, runner } = sealingParent('owner');

      await runner.start(job(cwd)).result;
      await childGone();

      expect(recordSaves().length).toBeGreaterThan(0);
      expect(recordSaves()).toContainEqual(
        expect.objectContaining({ type: 'record_saved', sessionId: FORK_ID }),
      );
    },
    TEST_TIMEOUT_MS,
  );
});

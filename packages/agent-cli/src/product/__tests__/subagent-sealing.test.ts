/**
 * #3679 step 3b — the product's subagent path with sealing, on the real cryptography.
 *
 * A subagent worker decides how it seals in the product's one sealing decision, from the grant its
 * parent sends: every store and the subagent log then seal to the parent's key, a newer grant (the
 * parent's first unlock verified a different key) moves them to it, and the worker never opens a
 * keyring file — it has only the public key the grant names. The parent reads what the child wrote
 * once it unlocks. The runner gets the product's sealing and its key-change watch from the same
 * decision, and never the one without the other.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readCurrentProcessIdentity, readProcessStartTime } from '@robota-sdk/agent-core/node';
import { leaveProcessScopedDirectory } from '@robota-sdk/agent-core/testing';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import {
  createSubagentLogger,
  createUserSessionStore,
  readSubagentTranscriptPage,
  resolveSubagentTranscriptPath,
} from '@robota-sdk/agent-framework/node';
import { createKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { KeyHolderArtifactSealer } from '../../secure/artifact-sealer.js';
import { KeyHolder } from '../../secure/key-holder.js';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  withSwappedSealingKey,
} from '../../secure/__tests__/helpers.js';
import { ProductMigrationRunningError } from '../process-presence.js';
import {
  overrideProductSecureMode,
  resolveProductRunnerSealing,
  resolveProductSessionSealing,
  useProductKeyHolder,
} from '../session-sealing.js';

import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const keyringFiles = vi.hoisted(() => ({ opened: 0 }));
vi.mock('@robota-sdk/agent-local-host', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-local-host')>();
  return {
    ...actual,
    createKeyringFileStore: (...args: Parameters<typeof actual.createKeyringFileStore>) => {
      keyringFiles.opened += 1;
      return actual.createKeyringFileStore(...args);
    },
  };
});

const runner = vi.hoisted(() => ({ options: [] as unknown[] }));
vi.mock('@robota-sdk/agent-subagent-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-subagent-runner')>();
  return {
    ...actual,
    createChildProcessSubagentRunnerFactory: (options: unknown) => {
      runner.options.push(options);
      return () => ({ start: () => undefined }) as never;
    },
  };
});

const { createProductSubagentComposition, createProductSubagentRunnerFactory } =
  await import('../subagent-composition.js');

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  runner.options.length = 0;
});
function directory(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(dir);
  return dir;
}

const CANARY = 'CANARY-product-subagent-6a2d-text';
const passphrase = { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE } as const;

function record(id: string, text = CANARY): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-09-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  } as IInteractiveSessionRecord;
}

/** The parent: a locked holder over the fixture keyring (or one whose stored key was swapped). */
async function parent(swappedWith?: Awaited<ReturnType<typeof createKeyring>>['keyring']) {
  const { keyring } = await fixtureKeyring();
  const holder = new KeyHolder({
    store: createMemoryKeyringStore(
      swappedWith ? withSwappedSealingKey(keyring, swappedWith) : keyring,
    ),
    policy: { idleMs: 0 },
  });
  return { holder, sealer: new KeyHolderArtifactSealer(holder) };
}

describe('a product subagent worker binds its parent’s grant', () => {
  it('and every store it opens then seals to the parent’s key, with no keyring file opened', async () => {
    const { holder, sealer } = await parent();
    const runtime = createTestProductRuntime();
    const composition = createProductSubagentComposition(runtime);
    const before = keyringFiles.opened;

    const sealing = composition.bindWriteGrant?.(sealer.writeGrant());
    const store = composition.openSessionStore?.({ cwd: directory('worker-cwd-') });
    store?.save(record('sess_child'));

    expect(sealing).not.toBe('plain');
    expect(resolveProductSessionSealing(runtime)).toEqual(sealing);
    expect(keyringFiles.opened).toBe(before);
    const file = join(runtime.layout.userPaths.sessions, 'sess_child.json');
    expect(readFileSync(file).subarray(0, 4).toString('latin1')).toBe('RSL1');
    expect(readFileSync(file).includes(Buffer.from(CANARY))).toBe(false);
    // Only the parent, once unlocked, reads it.
    expect(store?.load('sess_child')).toEqual({ status: 'locked', reason: 'no-keys' });
    await holder.unlock(passphrase);
    const opened = new KeyHolderArtifactSealer(holder).openBytes(readFileSync(file), {
      kind: 'session-record',
      id: 'sess_child',
    });
    expect(Buffer.from(opened).toString('utf8')).toContain(CANARY);
  });

  it('is plain while no grant is bound, as a worker whose parent keeps its logs plain', () => {
    const runtime = createTestProductRuntime();
    createProductSubagentComposition(runtime);

    expect(resolveProductSessionSealing(runtime)).toBe('plain');
  });

  it('writes a subagent log the parent reads once unlocked, and a locked page until then', async () => {
    const { holder, sealer } = await parent();
    const logsDir = directory('worker-logs-');
    const sealing = createProductSubagentComposition(createTestProductRuntime()).bindWriteGrant?.(
      sealer.writeGrant(),
    );
    const logger = createSubagentLogger('session_parent', 'agent_1', logsDir, {
      sealing: sealing ?? 'plain',
    });
    logger.log('agent_1', 'session_init', { note: CANARY });
    logger.flush?.();
    const transcript = resolveSubagentTranscriptPath(logsDir, 'session_parent', 'agent_1');

    const locked = readSubagentTranscriptPage(transcript, { sealing: { sealer } });
    await holder.unlock(passphrase);
    const unlocked = readSubagentTranscriptPage(transcript, { sealing: { sealer } });

    expect(readFileSync(transcript, 'utf8')).not.toContain(CANARY);
    expect(locked).toEqual({
      lines: ['[1 sealed log record; the keys are locked]'],
      unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 },
    });
    expect(unlocked?.lines.join('\n')).toContain(CANARY);
  });

  it('seals to the verified key from the moment the parent’s unlock tells it, before which a swapped key was all it had', async () => {
    const swapped = await createKeyring({ passphrase: 'a passphrase nobody here knows at all' });
    swapped.unlocked.lock();
    const { holder, sealer } = await parent(swapped.keyring);
    const logsDir = directory('worker-rotate-logs-');
    const composition = createProductSubagentComposition(createTestProductRuntime());
    // Before the parent's first unlock, its grant names the key the file holds: here a swapped one.
    const sealing = composition.bindWriteGrant?.(sealer.writeGrant()) ?? 'plain';
    // The parent tells its running children through the runner; the child binds the newer grant.
    holder.onSealingKeyChange(() => composition.bindWriteGrant?.(sealer.writeGrant()));
    const logger = createSubagentLogger('session_parent', 'agent_1', logsDir, {
      sealing,
    });
    logger.log('agent_1', 'session_init', { note: 'before the unlock' });
    logger.flush?.();

    await holder.unlock(passphrase);
    logger.log('agent_1', 'session_shutdown', { note: 'after the unlock' });
    logger.flush?.();

    const page = readSubagentTranscriptPage(
      resolveSubagentTranscriptPath(logsDir, 'session_parent', 'agent_1'),
      { sealing: { sealer } },
    );
    expect(page?.lines[0]).toBe('[a sealed log record here does not open]');
    expect(page?.lines.slice(1).join('\n')).toContain('after the unlock');
    expect(page?.unreadable).toEqual({ locked: 0, noKeys: 0, doesNotOpen: 1 });
  });
});

/** What the product hands the child-process runner for its children's logs. */
interface IRunnerSealingOptions {
  readonly logSealing: 'plain' | { readonly sealer: IArtifactSealer };
  readonly watchSealingKey?: (listener: () => void) => () => void;
}

/**
 * A runtime whose connection environment (proxy, certificate and `NODE_OPTIONS` variables) is the
 * host's own. The product keeps the child-process runner only while a child would connect as its
 * parent does, so a host that sets one of these (a CI runner does) would otherwise make it choose the
 * in-process runner, which these tests do not exercise.
 */
function runtimeWithHostConnectionEnvironment(): ReturnType<typeof createTestProductRuntime> {
  const host = Object.fromEntries(
    TRANSPORT_ENVIRONMENT.flatMap((name) => {
      const value = process.env[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return createTestProductRuntime('test-product', host);
}

function productRunnerOptions(
  runtime = runtimeWithHostConnectionEnvironment(),
): IRunnerSealingOptions {
  const factory = createProductSubagentRunnerFactory({
    productRuntime: runtime,
    packContext: { cwd: '/work' },
    providerConfig: { name: 'openai', model: 'test-model', apiKeyEnv: 'TEST_PRODUCT_KEY' },
    providerDefinitions: [{ type: 'openai', createProvider: () => ({}) as never }],
    reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
    notice: () => undefined,
    persistTranscripts: true,
  });
  expect(factory).toBeTypeOf('function');
  return runner.options.at(-1) as IRunnerSealingOptions;
}

describe('a product subagent worker’s fork record', () => {
  it('is reported by the bytes of each save, which the parent then vouches for on the real keyring', async () => {
    const { holder, sealer } = await parent();
    await holder.unlock(passphrase);
    const runtime = createTestProductRuntime();
    const sessions = runtime.layout.userPaths.sessions;
    const parentStore = createUserSessionStore(sessions, { sealing: { sealer } });
    parentStore.save(record('sess_fork'), { handoff: true, provenance: 'owner' });
    const lease = parentStore.lend('sess_fork');
    const token = parentStore.exportHeld?.('sess_fork') as string;
    const composition = createProductSubagentComposition(runtime);
    composition.bindWriteGrant?.(sealer.writeGrant());
    const child = composition.openSessionStore?.({ cwd: directory('worker-cwd-') });
    child?.importHeld?.('sess_fork', token);
    const claim = child?.claim('sess_fork', { lease: lease.nonce });

    child?.save(record('sess_fork', 'the child turn'), { claim });
    const held = child?.authorship?.heldDigest('sess_fork');

    const digest = createHash('sha256')
      .update(readFileSync(join(sessions, 'sess_fork.json')))
      .digest('hex');
    expect(held).toBe(digest);
    // Raising a record lent to a child is refused until the lease ends.
    expect(parentStore.authorship?.adopt('sess_fork', digest)).toBe('has_writer');
    claim?.release();
    lease.end();
    expect(parentStore.authorship?.adopt('sess_fork', digest)).toBe('adopted');
    const seen = createUserSessionStore(sessions, { sealing: { sealer } }).load('sess_fork');
    expect(seen.status === 'valid' && seen.authorship).toBe('verified');
    expect(seen.status === 'valid' && JSON.stringify(seen.record.messages)).toContain(
      'the child turn',
    );
  });
});

describe('a product subagent worker marks its presence when it binds its parent’s grant', () => {
  const presence = (runtime: ReturnType<typeof createTestProductRuntime>): string[] =>
    existsSync(runtime.layout.userPaths.presence)
      ? readdirSync(runtime.layout.userPaths.presence).filter((name) => name.startsWith('process-'))
      : [];

  it('before it builds anything, naming itself a subagent', async () => {
    const { sealer } = await parent();
    const runtime = createTestProductRuntime();
    const composition = createProductSubagentComposition(runtime);
    expect(presence(runtime)).toEqual([]);

    composition.bindWriteGrant?.(sealer.writeGrant());

    const [name, ...others] = presence(runtime);
    expect(others).toEqual([]);
    expect(
      readFileSync(join(runtime.layout.userPaths.presence, name as string, 'mode'), 'utf8'),
    ).toBe('subagent');
  });

  it('and refuses to bind while a migration of its state root is running', async () => {
    const { sealer } = await parent();
    const runtime = createTestProductRuntime();
    leaveProcessScopedDirectory(runtime.layout.userPaths.presence, 'migration-', {
      ...readCurrentProcessIdentity(),
      pid: process.ppid,
      ...(readProcessStartTime(process.ppid) === undefined
        ? {}
        : { startTime: readProcessStartTime(process.ppid) as string }),
    });
    const composition = createProductSubagentComposition(runtime);

    expect(() => composition.bindWriteGrant?.(sealer.writeGrant())).toThrow(
      ProductMigrationRunningError,
    );
    expect(resolveProductSessionSealing(runtime)).toBe('plain');
  });
});

describe('a key holder is given only where secure mode is on', () => {
  it('is refused for a runtime secure mode is off for, which keeps every store plain', async () => {
    const { holder } = await parent();
    const runtime = createTestProductRuntime();

    expect(() => useProductKeyHolder(runtime, holder)).toThrow(/secure mode/iu);
    expect(resolveProductSessionSealing(runtime)).toBe('plain');

    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(runtime, holder);
    expect(resolveProductSessionSealing(runtime)).not.toBe('plain');
  });
});

describe('the product runner gets its sealing and its key watch from the one decision', () => {
  it('keeps the children plain, with nothing to watch, while this process holds no keys', () => {
    const options = productRunnerOptions();

    expect(options.logSealing).toBe('plain');
    expect('watchSealingKey' in options).toBe(false);
  });

  it('never hands the runner a sealing without the watch that follows its key', async () => {
    const { holder } = await parent();
    const runtime = runtimeWithHostConnectionEnvironment();
    overrideProductSecureMode(runtime, true);
    useProductKeyHolder(runtime, holder);
    const heard: string[] = [];

    const options = productRunnerOptions(runtime);
    options.watchSealingKey?.(() => heard.push('sealing key changed'));
    await holder.unlock(passphrase);

    expect(options.logSealing).not.toBe('plain');
    expect(options.watchSealingKey).toBeTypeOf('function');
    expect(heard).toEqual(['sealing key changed']);
    // The children's logs seal with the same sealer every store of this process uses: the holder's.
    expect(options.logSealing).toEqual(resolveProductSessionSealing(runtime));
    const context = { kind: 'session-log-line', id: 'session_parent' } as const;
    const sealer = (options.logSealing as { readonly sealer: IArtifactSealer }).sealer;
    expect(
      new KeyHolderArtifactSealer(holder).openLine(sealer.sealLine('a line', context), context),
    ).toBe('a line');
  });

  it('in a worker, hands a nested runner its parent’s sealing with a watch that hears each newer grant', async () => {
    const { sealer } = await parent();
    const runtime = createTestProductRuntime();
    const composition = createProductSubagentComposition(runtime);
    expect(resolveProductRunnerSealing(runtime)).toEqual({ logSealing: 'plain' });

    composition.bindWriteGrant?.(sealer.writeGrant());
    const sealing = resolveProductRunnerSealing(runtime);
    const heard: string[] = [];
    if (sealing.logSealing === 'plain') throw new Error('expected a sealing');
    sealing.watchSealingKey(() => heard.push('newer grant'));
    composition.bindWriteGrant?.(sealer.writeGrant());

    expect(sealing.logSealing).toEqual(resolveProductSessionSealing(runtime));
    expect(heard).toEqual(['newer grant']);
  });
});

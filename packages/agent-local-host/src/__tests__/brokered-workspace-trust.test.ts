import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import {
  BrokeredWorkspaceTrustService,
  brokeredAppend,
  brokeredDirectoryRemoval,
} from '../brokered-workspace-trust.js';
import { ensureWorkspaceRootBroker, workspaceRootBrokerEndpoint } from '../workspace-root-broker-process.js';
import { neverLaunch, startFixtureBroker, testProductState } from './helpers/fixture-broker.js';

const staleBrokerMessage = (operation: string): string =>
  `The stand-in broker is older than the host and cannot ${operation}.`;

/** The service over the broker a test started: no launch is needed, so launching is a failure. */
function createService(state: ReturnType<typeof testProductState>): Promise<BrokeredWorkspaceTrustService> {
  return BrokeredWorkspaceTrustService.create({
    projectStateDirectories: state.projectStateDirectories,
    ensureBroker: () => ensureWorkspaceRootBroker(state, neverLaunch),
    staleBrokerMessage,
  });
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe.skipIf(process.platform === 'win32')('brokered CLI workspace trust', () => {
  it('retains approval across clients, refuses a swapped root, and forgets live trust on restart', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'brokered-cli-trust-'));
    const home = join(parent, 'home');
    const root = join(parent, 'root');
    const outside = join(parent, 'outside');
    mkdirSync(home);
    mkdirSync(root);
    mkdirSync(outside);
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'approved.txt'), 'A');
    writeFileSync(join(outside, 'outside.txt'), 'B');
    const product = testProductState(home);
    const endpoint = workspaceRootBrokerEndpoint(product.userRoot);
    mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
    let broker = await startFixtureBroker(endpoint, dirname(endpoint), product.historyFile);
    cleanups.push(async () => {
      await broker.close();
      rmSync(dirname(endpoint), { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });

    const first = await createService(product);
    expect(await first.inspect(root)).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    const candidate = await first.prepare(root);
    const access = await first.grant(root, candidate);
    expect(access.status).toBe('trusted');
    if (access.status !== 'trusted') return;
    const reader = getWorkspaceProjectReader(access.authority);
    expect(reader.readText('approved.txt', 'broker test')).toBe('A');
    const state = process.platform === 'linux'
      ? getWorkspaceProjectStateStorage(access.authority, 'memory') : undefined;
    if (state !== undefined) {
      state.writeText('probe.txt', 'retained', 'broker test');
      expect(state.readText('probe.txt', 'broker test')).toBe('retained');
    }
    const second = await createService(product);
    expect(await second.inspect(root)).toMatchObject({ status: 'trusted' });

    const parked = join(parent, 'parked');
    renameSync(root, parked);
    renameSync(outside, root);
    expect(() => reader.readText('outside.txt', 'broker test')).toThrow();
    if (state !== undefined) expect(() => state.writeText('outside.txt', 'B', 'broker test')).toThrow();
    expect(await second.inspect(root)).toMatchObject({ status: 'restricted' });
    renameSync(root, outside);
    renameSync(parked, root);
    expect(reader.readText('approved.txt', 'broker test')).toBe('A');

    await broker.close();
    broker = await startFixtureBroker(endpoint, dirname(endpoint), product.historyFile);
    expect(await (await createService(product)).inspect(root))
      .toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    expect(() => reader.readText('approved.txt', 'broker test')).toThrow();
    first.close();
    second.close();
  }, 40_000);
});

describe.skipIf(process.platform !== 'linux')('brokered CLI checkpoint writer leases', () => {
  it('hands the framework a writer lease and directory claims that the broker holds', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'brokered-cli-lease-'));
    const home = join(parent, 'home');
    const root = join(parent, 'root');
    mkdirSync(home);
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    const product = testProductState(home);
    const endpoint = workspaceRootBrokerEndpoint(product.userRoot);
    mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
    const broker = await startFixtureBroker(endpoint, dirname(endpoint), product.historyFile);
    const service = await createService(product);
    cleanups.push(async () => {
      service.close();
      await broker.close();
      rmSync(dirname(endpoint), { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });
    const access = await service.grant(root, await service.prepare(root));
    expect(access.status).toBe('trusted');
    if (access.status !== 'trusted') return;
    const state = getWorkspaceProjectStateStorage(access.authority, 'memory');

    expect(state.claimDirectory?.('checkpoints/one', 'lease test')).toBe(true);
    expect(state.claimDirectory?.('checkpoints/one', 'lease test')).toBe(false);

    const lease = state.acquireWriter?.('session_1/.writer', 'lease test');
    expect(lease?.holds()).toBe(true);
    expect(state.acquireWriter?.('session_1/.writer', 'lease test')).toBeUndefined();
    expect(lease?.withGuard(() => 'ran')).toEqual({ status: 'ran', value: 'ran' });

    lease?.release();
    expect(lease?.holds()).toBe(false);
    expect(lease?.withGuard(() => 'never')).toEqual({ status: 'lost' });
    lease?.release();
    const again = state.acquireWriter?.('session_1/.writer', 'lease test');
    expect(again?.holds()).toBe(true);
    again?.release();
  }, 40_000);

  it('removes directories and appends without creating through the broker', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'brokered-cli-removal-'));
    const home = join(parent, 'home');
    const root = join(parent, 'root');
    mkdirSync(home);
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    const product = testProductState(home);
    const endpoint = workspaceRootBrokerEndpoint(product.userRoot);
    mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
    const broker = await startFixtureBroker(endpoint, dirname(endpoint), product.historyFile);
    const service = await createService(product);
    cleanups.push(async () => {
      service.close();
      await broker.close();
      rmSync(dirname(endpoint), { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });
    const access = await service.grant(root, await service.prepare(root));
    if (access.status !== 'trusted') throw new Error('expected a trusted root');
    const state = getWorkspaceProjectStateStorage(access.authority, 'memory');
    const onDisk = join(root, product.projectStateDirectories.memory);

    state.writeText('tree/one/file.txt', 'file', 'removal test');
    state.writeText('tree/two.txt', 'two', 'removal test');
    expect(state.removeDirectory?.('tree', 'removal test', { maxEntries: 1 })).toEqual({
      status: 'partial',
      reason: 'budget',
    });
    expect(state.removeDirectory?.('tree', 'removal test')).toEqual({ status: 'removed' });
    expect(existsSync(join(onDisk, 'tree'))).toBe(false);
    expect(state.removeDirectory?.('tree', 'removal test')).toEqual({ status: 'absent' });
    expect(() => state.removeDirectory?.('tree', 'removal test', { maxMs: 0.5 })).toThrow(
      /positive whole number/u,
    );

    expect(state.appendText('gone/run.jsonl', 'late\n', 'removal test', { create: false })).toBe(
      false,
    );
    expect(existsSync(join(onDisk, 'gone'))).toBe(false);
    expect(state.appendText('kept/run.jsonl', 'one\n', 'removal test')).toBe(true);
    expect(state.appendText('kept/run.jsonl', 'two\n', 'removal test', { create: false })).toBe(
      true,
    );
    expect(readFileSync(join(onDisk, 'kept', 'run.jsonl'), 'utf8')).toBe('one\ntwo\n');
  }, 40_000);
});

describe('brokered removal and append answers', () => {
  const removal = (response: Parameters<typeof brokeredDirectoryRemoval>[0]) =>
    brokeredDirectoryRemoval(response, staleBrokerMessage);
  const append = (response: Parameters<typeof brokeredAppend>[0], create: boolean) =>
    brokeredAppend(response, create, staleBrokerMessage);

  it('maps the broker answers and refuses anything else', () => {
    expect(removal({ status: 'mutation', value: 'removed' })).toEqual({
      status: 'removed',
    });
    expect(removal({ status: 'mutation', value: 'absent' })).toEqual({
      status: 'absent',
    });
    expect(removal({ status: 'mutation', value: 'partial-budget' })).toEqual({
      status: 'partial',
      reason: 'budget',
    });
    expect(removal({ status: 'mutation', value: 'partial-concurrent' })).toEqual({
      status: 'partial',
      reason: 'concurrent',
    });
    expect(() => removal({ status: 'mutation', value: true })).toThrow(
      /invalid removal/u,
    );
    expect(() => removal({ status: 'mutation' })).toThrow(/invalid removal/u);
    expect(() =>
      removal({ status: 'refused', reason: 'write-outcome-unknown' }),
    ).toThrow(/write-outcome-unknown/u);

    expect(append({ status: 'mutation', value: false }, false)).toBe(false);
    expect(append({ status: 'mutation', value: true }, false)).toBe(true);
    expect(() => append({ status: 'mutation' }, false)).toThrow(/invalid append/u);
    expect(append({ status: 'mutation', value: true }, true)).toBe(true);
    expect(append({ status: 'mutation' }, true)).toBe(true);
    expect(() => append({ status: 'mutation', value: false }, true)).toThrow(
      /invalid append/u,
    );
    expect(() => append({ status: 'refused', reason: 'unknown-lease' }, true)).toThrow(
      /unknown-lease/u,
    );
  });

  it('tells the person what the host says about a broker too old for the new operations', () => {
    const old = { status: 'refused', reason: 'malformed' } as const;
    expect(() => removal(old)).toThrow(WorkspaceAuthorityRequiredError);
    expect(() => removal(old)).toThrow(staleBrokerMessage('remove directories'));
    expect(() => append(old, false)).toThrow(staleBrokerMessage('append without creating'));
    expect(() => append(old, true)).toThrow(
      /^The live workspace broker refused the operation \(malformed\)\.$/u,
    );
  });
});

describe.skipIf(process.platform !== 'win32')('brokered Windows CLI workspace trust', () => {
  it('round trips trusted project bytes through the protected pipe and sync client', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'brokered-win-trust-'));
    const home = join(parent, 'home');
    const root = join(parent, 'root');
    mkdirSync(home);
    mkdirSync(root);
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'approved.txt'), 'A');
    const product = testProductState(home);
    const endpoint = workspaceRootBrokerEndpoint(product.userRoot);
    const lockDirectory = join(product.userRoot, 'root-broker');
    mkdirSync(lockDirectory, { recursive: true });
    const broker = await startFixtureBroker(endpoint, lockDirectory, product.historyFile);
    cleanups.push(async () => {
      await broker.close();
      rmSync(parent, { recursive: true, force: true });
    });
    const service = await createService(product);
    const candidate = await service.prepare(root);
    const access = await service.grant(root, candidate);
    expect(access.status).toBe('trusted');
    if (access.status !== 'trusted') return;
    expect(getWorkspaceProjectReader(access.authority).readText('approved.txt', 'broker test'))
      .toBe('A');
    service.close();
  });
});

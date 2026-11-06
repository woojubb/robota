import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { getWorkspaceProjectReader, getWorkspaceProjectStateStorage } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import { BrokeredWorkspaceTrustService } from '../brokered-workspace-trust.js';
import { workspaceRootBrokerEndpoint } from '../workspace-root-broker-process.js';
import { runWorkspaceTrustCommand } from '../workspace-trust-command.js';

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
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const endpoint = workspaceRootBrokerEndpoint(runtime);
    mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
    let broker = await startTestBroker(
      endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust,
    );
    cleanups.push(async () => {
      await broker.close();
      rmSync(dirname(endpoint), { recursive: true, force: true });
      rmSync(parent, { recursive: true, force: true });
    });

    const first = await BrokeredWorkspaceTrustService.create(runtime);
    expect(await first.inspect(root)).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    const candidate = await first.prepare(root);
    expect(await runWorkspaceTrustCommand(
      ['--yes', '--desktop-approved-candidate', candidate], root, runtime,
    )).toBe(1);
    expect(await first.inspect(root)).toMatchObject({ status: 'restricted', trustState: 'untrusted' });
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
    const second = await BrokeredWorkspaceTrustService.create(runtime);
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
    broker = await startTestBroker(
      endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust,
    );
    expect(await (await BrokeredWorkspaceTrustService.create(runtime)).inspect(root))
      .toMatchObject({ status: 'restricted', trustState: 'untrusted' });
    expect(() => reader.readText('approved.txt', 'broker test')).toThrow();
    first.close();
    second.close();
  }, 40_000);
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
    const runtime = createTestProductRuntime('test-product', { HOME: home });
    const endpoint = workspaceRootBrokerEndpoint(runtime);
    const lockDirectory = join(runtime.layout.userRoot, 'root-broker');
    mkdirSync(lockDirectory, { recursive: true });
    const broker = await startTestBroker(
      endpoint, lockDirectory, runtime.layout.userPaths.workspaceTrust,
    );
    cleanups.push(async () => {
      await broker.close();
      rmSync(parent, { recursive: true, force: true });
    });
    const service = await BrokeredWorkspaceTrustService.create(runtime);
    const candidate = await service.prepare(root);
    const access = await service.grant(root, candidate);
    expect(access.status).toBe('trusted');
    if (access.status !== 'trusted') return;
    expect(getWorkspaceProjectReader(access.authority).readText('approved.txt', 'broker test'))
      .toBe('A');
    service.close();
  });
});

import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, it } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';
import { workspaceRootBrokerEndpoint } from '../../startup/workspace-root-broker-process.js';
import { requestWorkspaceRootBroker } from '../../startup/workspace-root-broker.js';
import { SecureWorkspaceRootFence } from '../workspace-root-fence.js';

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('refuses a replacement at the same workspace path', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-root-fence-')));
  const runtime = createTestProductRuntime('test-product', createTestBinaryEnvironment(home));
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
  const broker = await startTestBroker(endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust);
  const root = join(home, 'workspace');
  mkdirSync(root);
  const fence = new SecureWorkspaceRootFence(root, endpoint, false);
  try {
    expect(fence.proof().tag).toMatch(/^\d+:\d+$/u);
    mkdirSync(join(root, '.git'));
    rmSync(join(root, '.git'), { recursive: true });
    expect(() => fence.assertCurrent()).not.toThrow();
    renameSync(root, join(home, 'old-workspace'));
    mkdirSync(root);
    expect(() => fence.assertCurrent()).toThrow();
  } finally {
    fence.close();
    await broker.close();
    rmSync(home, { recursive: true, force: true });
  }
}, 30_000);

it.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')('binds a native Restricted choice to the displayed folder through a replacement', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'restricted-root-fence-')));
  const runtime = createTestProductRuntime('test-product', createTestBinaryEnvironment(home));
  const endpoint = workspaceRootBrokerEndpoint(runtime);
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
  const root = join(home, 'workspace');
  mkdirSync(root);
  const broker = await startTestBroker(endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust);
  try {
    const prepared = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root });
    if (prepared.status !== 'prepared') throw new Error('Preparation failed.');
    renameSync(root, join(home, 'old-workspace'));
    mkdirSync(root);
    expect((await requestWorkspaceRootBroker(endpoint, {
      op: 'retainRestricted', root, candidate: prepared.candidate,
    })).status).toBe('refused');
    const replacement = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root });
    if (replacement.status !== 'prepared') throw new Error('Replacement preparation failed.');
    const retained = await requestWorkspaceRootBroker(endpoint, {
      op: 'retainRestricted', root, candidate: replacement.candidate,
    });
    if (retained.status !== 'restricted-held') throw new Error('Retention failed.');
    const fence = new SecureWorkspaceRootFence(root, endpoint, false, retained.hold);
    try {
      renameSync(root, join(home, 'second-workspace'));
      mkdirSync(root);
      expect(() => fence.assertCurrent()).toThrow();
      expect((await requestWorkspaceRootBroker(endpoint, {
        op: 'assertRestricted', root, hold: retained.hold,
      })).status).toBe('refused');
    } finally { fence.close(); }
  } finally { await broker.close(); rmSync(home, { recursive: true, force: true }); }
}, 30_000);

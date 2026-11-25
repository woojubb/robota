import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  approvePreparedCandidate,
  assertRestrictedRoot,
  prepareRestrictedRoot,
  releaseRestrictedRoot,
  retainRestrictedRoot,
} from '../native-owner-trust.js';
import { workspaceRootBrokerEndpoint } from '../workspace-root-broker-process.js';
import { requestWorkspaceRootBroker } from '../workspace-root-broker.js';
import { startFixtureBroker, testProductState } from './helpers/fixture-broker.js';

const CHANGED = 'The Restricted folder changed after approval.';
const NOT_RELEASED = 'The Restricted folder hold could not be released.';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A real broker for a fresh user-state root, and the folders a person could be asked about. */
async function startProduct() {
  const parent = mkdtempSync(join(tmpdir(), 'native-owner-trust-'));
  const home = join(parent, 'home');
  const root = join(parent, 'root');
  const other = join(parent, 'other');
  mkdirSync(home);
  mkdirSync(root);
  mkdirSync(other);
  const product = testProductState(home);
  const endpoint = workspaceRootBrokerEndpoint(product.userRoot);
  mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
  const broker = await startFixtureBroker(endpoint, dirname(endpoint), product.historyFile);
  cleanups.push(async () => {
    await broker.close();
    rmSync(dirname(endpoint), { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  });
  return { parent, userRoot: product.userRoot, endpoint, root, other };
}

/** Puts a different folder under the name the person was shown. */
function replaceFolder(parent: string, root: string, other: string): void {
  renameSync(root, join(parent, 'parked'));
  renameSync(other, root);
}

describe.skipIf(process.platform === 'win32')('a native owner shell asks the live broker', () => {
  describe('approving a prepared candidate', () => {
    it('trusts the folder the candidate was prepared for, once', async () => {
      const { userRoot, endpoint, root } = await startProduct();
      execFileSync('git', ['init', '--quiet', root]);
      const candidate = await prepareRestrictedRoot(userRoot, root);
      if (candidate === undefined) throw new Error('The test folder could not be prepared.');

      expect(await approvePreparedCandidate(userRoot, root, candidate)).toBe(true);
      expect(await requestWorkspaceRootBroker(endpoint, { op: 'inspect', root })).toMatchObject({
        status: 'trusted',
      });
      // The candidate was consumed by the approval.
      expect(await approvePreparedCandidate(userRoot, root, candidate)).toBe(false);
    });

    it('answers false for a candidate nobody prepared', async () => {
      const { userRoot, root } = await startProduct();
      expect(await approvePreparedCandidate(userRoot, root, randomUUID())).toBe(false);
    });

    it('answers false for a candidate prepared for another folder, and leaves it untrusted', async () => {
      const { userRoot, endpoint, root, other } = await startProduct();
      const candidate = await prepareRestrictedRoot(userRoot, root);
      if (candidate === undefined) throw new Error('The test folder could not be prepared.');

      expect(await approvePreparedCandidate(userRoot, other, candidate)).toBe(false);
      expect(await requestWorkspaceRootBroker(endpoint, { op: 'inspect', root })).toMatchObject({
        status: 'untrusted',
      });
    });

    it('answers false when the folder was replaced under its name after it was prepared', async () => {
      const { parent, userRoot, root, other } = await startProduct();
      const candidate = await prepareRestrictedRoot(userRoot, root);
      if (candidate === undefined) throw new Error('The test folder could not be prepared.');
      replaceFolder(parent, root, other);

      expect(await approvePreparedCandidate(userRoot, root, candidate)).toBe(false);
    });
  });

  describe('preparing a Restricted root', () => {
    it('answers a candidate for an existing folder', async () => {
      const { userRoot, root } = await startProduct();
      expect(await prepareRestrictedRoot(userRoot, root)).toMatch(/^[0-9a-f]{8}-/u);
    });

    it('answers undefined for a folder that does not exist', async () => {
      const { parent, userRoot } = await startProduct();
      expect(await prepareRestrictedRoot(userRoot, join(parent, 'missing'))).toBeUndefined();
    });
  });

  // The broker holds a Restricted choice only on the platforms that can keep the folder open.
  describe.skipIf(process.platform !== 'darwin' && process.platform !== 'linux')(
    'holding a Restricted root',
    () => {
      it('prepares, retains, asserts and releases one live choice', async () => {
        const { userRoot, endpoint, root } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');

        const hold = await retainRestrictedRoot(userRoot, root, candidate);
        if (hold === undefined) throw new Error('The test folder could not be held.');
        const stat = statSync(root, { bigint: true });
        expect(await assertRestrictedRoot(userRoot, root, hold)).toBe(`${stat.dev}:${stat.ino}`);
        // A hold grants no project reads: the folder stays untrusted.
        expect(await requestWorkspaceRootBroker(endpoint, { op: 'inspect', root })).toMatchObject({
          status: 'untrusted',
        });

        await expect(releaseRestrictedRoot(userRoot, hold)).resolves.toBeUndefined();
        await expect(assertRestrictedRoot(userRoot, root, hold)).rejects.toThrow(CHANGED);
        await expect(releaseRestrictedRoot(userRoot, hold)).rejects.toThrow(NOT_RELEASED);
      });

      it('retains a candidate only once', async () => {
        const { userRoot, root } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');

        expect(await retainRestrictedRoot(userRoot, root, candidate)).toEqual(expect.any(String));
        expect(await retainRestrictedRoot(userRoot, root, candidate)).toBeUndefined();
      });

      it('retains nothing for a candidate nobody prepared', async () => {
        const { userRoot, root } = await startProduct();
        expect(await retainRestrictedRoot(userRoot, root, randomUUID())).toBeUndefined();
      });

      it('retains nothing for a candidate prepared for another folder', async () => {
        const { userRoot, root, other } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');

        expect(await retainRestrictedRoot(userRoot, other, candidate)).toBeUndefined();
      });

      it('retains nothing when the folder was replaced under its name after it was prepared', async () => {
        const { parent, userRoot, root, other } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');
        replaceFolder(parent, root, other);

        expect(await retainRestrictedRoot(userRoot, root, candidate)).toBeUndefined();
      });

      it('refuses to assert a hold nobody retained', async () => {
        const { userRoot, root } = await startProduct();
        await expect(assertRestrictedRoot(userRoot, root, randomUUID())).rejects.toThrow(CHANGED);
      });

      it('refuses to assert a hold for another folder than the one it holds', async () => {
        const { userRoot, root, other } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');
        const hold = await retainRestrictedRoot(userRoot, root, candidate);
        if (hold === undefined) throw new Error('The test folder could not be held.');

        await expect(assertRestrictedRoot(userRoot, other, hold)).rejects.toThrow(CHANGED);
      });

      it('refuses to assert a hold after the folder was replaced under its name', async () => {
        const { parent, userRoot, root, other } = await startProduct();
        const candidate = await prepareRestrictedRoot(userRoot, root);
        if (candidate === undefined) throw new Error('The test folder could not be prepared.');
        const hold = await retainRestrictedRoot(userRoot, root, candidate);
        if (hold === undefined) throw new Error('The test folder could not be held.');
        replaceFolder(parent, root, other);

        await expect(assertRestrictedRoot(userRoot, root, hold)).rejects.toThrow(CHANGED);
      });

      it('refuses to release a hold nobody retained', async () => {
        const { userRoot } = await startProduct();
        await expect(releaseRestrictedRoot(userRoot, randomUUID())).rejects.toThrow(NOT_RELEASED);
      });
    },
  );
});

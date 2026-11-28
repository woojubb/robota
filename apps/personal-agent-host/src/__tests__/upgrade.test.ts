import { afterEach, describe, expect, it } from 'vitest';

import { HostError } from '../errors.js';
import { formatList, formatUpgrade, shortImage } from '../cli/format.js';
import { addInput, cleanTempDirs, type IHost, KEY, makeHost } from './harness.js';

afterEach(cleanTempDirs);

const IMAGE = 'personal-agent:test';

async function refusal(promise: Promise<unknown>): Promise<HostError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    return error as HostError;
  }
  throw new Error('expected a failure');
}

async function twoAccounts(): Promise<IHost> {
  const host = await makeHost();
  await host.plane.add(addInput('alice'));
  await host.plane.add(addInput('bob'));
  return host;
}

describe('image identity', () => {
  it('records the resolved image id at add and starts the unit from it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const recorded = host.store.get('alice')?.imageId;
    expect(recorded).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(host.runtime.imageOf('alice')).toBe(recorded);
    expect((await host.plane.show('alice')).imageId).toBe(recorded);
  });

  it('keeps a rebuilt tag from changing what the next start runs', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const before = host.store.get('alice')?.imageId;
    host.runtime.rebuildImage(IMAGE);
    await host.plane.suspend('alice');
    await host.plane.resume('alice');
    expect(host.runtime.imageOf('alice')).toBe(before);
    host.runtime.crash('alice');
    await host.plane.reconcile();
    expect(host.runtime.imageOf('alice')).toBe(before);
  });

  it('shows the short form in text and the full id in the status report', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const id = host.store.get('alice')?.imageId ?? '';
    expect(shortImage(id)).toHaveLength(12);
    expect(formatList([await host.plane.show('alice')])).toContain(shortImage(id));
    expect((await host.plane.status()).accounts[0]?.imageId).toBe(id);
  });
});

describe('upgrade', () => {
  it('moves an account to the rebuilt image and keeps its state and access code', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const code = await host.plane.accessCode('alice');
    const from = host.store.get('alice')?.imageId;
    const to = host.runtime.rebuildImage(IMAGE);
    const result = await host.plane.upgrade('alice');
    expect(result).toMatchObject({ target: to, moved: [{ id: 'alice', from }], skipped: [] });
    expect(host.store.get('alice')?.imageId).toBe(to);
    expect(host.runtime.imageOf('alice')).toBe(to);
    expect((await host.runtime.inspect('alice')).healthy).toBe(true);
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
    expect(await host.plane.accessCode('alice')).toBe(code);
    expect(formatUpgrade(result)).toContain('moved     alice');
  });

  it('is a no-op for an account already on the configured image', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const calls = host.runtime.calls.length;
    const result = await host.plane.upgrade('alice');
    expect(result.moved).toEqual([]);
    expect(result.current).toEqual(['alice']);
    expect(host.runtime.calls.slice(calls)).toEqual([`resolveImage:${IMAGE}`]);
  });

  it('fails when the image is gone, changing nothing', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.failNext('resolveImage', new Error('the unit image does not exist'));
    const error = await refusal(host.plane.upgrade('alice'));
    expect(error.code).toBe('runtime-failed');
    expect(host.runtime.calls.some((c) => c.startsWith('stop:'))).toBe(false);
  });

  it('rolls back to the previous image when the new unit is not healthy', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const code = await host.plane.accessCode('alice');
    const from = host.store.get('alice')?.imageId;
    host.runtime.rebuildImage(IMAGE);
    host.runtime.failNext('start', new Error(`did not become healthy; key ${KEY}`));
    const error = await refusal(host.plane.upgrade('alice'));
    expect(error.code).toBe('runtime-failed');
    expect(error.message).toContain('previous image is running again');
    expect(error.message).not.toContain(KEY);
    expect(host.store.get('alice')?.imageId).toBe(from);
    expect(host.runtime.imageOf('alice')).toBe(from);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(await host.plane.accessCode('alice')).toBe(code);
    // The reconcile loop has nothing to fix and keeps the recorded image.
    expect((await host.plane.reconcile()).started).toEqual([]);
    const audit = await host.auditLines();
    expect(audit.find((entry) => entry.command === 'upgrade')).toMatchObject({
      account: 'alice',
      result: 'failed',
    });
  });

  it('reports a failed rollback and leaves the account recorded on the previous image', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const from = host.store.get('alice')?.imageId;
    host.runtime.rebuildImage(IMAGE);
    host.runtime.failNext('start', new Error('new image is broken'));
    host.runtime.failNext('start', new Error('engine went away'));
    const error = await refusal(host.plane.upgrade('alice'));
    expect(error.message).toContain('new image is broken');
    expect(error.message).toContain('could not be started again');
    expect(error.message).toContain('engine went away');
    expect(host.store.get('alice')?.imageId).toBe(from);
    expect((await host.runtime.inspect('alice')).state).toBe('stopped');
    // Reconcile restarts it from the previous image, never the new one.
    host.clock.now += 60_000;
    expect((await host.plane.reconcile()).started).toEqual(['alice']);
    expect(host.runtime.imageOf('alice')).toBe(from);
  });

  it('refuses while the guard is unverified, before stopping anything', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.rebuildImage(IMAGE);
    host.runtime.setGuard('unverified');
    const calls = host.runtime.calls.length;
    expect((await refusal(host.plane.upgrade('alice'))).code).toBe('guard-unverified');
    expect(host.runtime.calls.slice(calls).some((c) => c.startsWith('stop:'))).toBe(false);
  });

  it('refuses a suspended account with "resume first"', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.suspend('alice');
    host.runtime.rebuildImage(IMAGE);
    const error = await refusal(host.plane.upgrade('alice'));
    expect(error.code).toBe('refused');
    expect(error.message).toContain('resume it first');
  });

  it('refuses an unknown account', async () => {
    const host = await makeHost();
    expect((await refusal(host.plane.upgrade('nobody'))).code).toBe('not-found');
  });
});

describe('upgrade --all', () => {
  it('moves every active account, one at a time, and lists the suspended one as skipped', async () => {
    const host = await twoAccounts();
    await host.plane.add(addInput('carol'));
    await host.plane.suspend('carol');
    const to = host.runtime.rebuildImage(IMAGE);
    const result = await host.plane.upgrade({ all: true });
    expect(result.moved.map((m) => m.id)).toEqual(['alice', 'bob']);
    expect(result.skipped).toEqual([{ id: 'carol', reason: 'suspended; resume it first' }]);
    expect(host.store.get('alice')?.imageId).toBe(to);
    expect(host.store.get('bob')?.imageId).toBe(to);
    expect(host.store.get('carol')?.imageId).not.toBe(to);
    expect(formatUpgrade(result)).toContain('skipped   carol');
  });

  it('stops at the first failure, rolled back, and says who moved, was skipped and failed', async () => {
    const host = await twoAccounts();
    await host.plane.add(addInput('carol'));
    const old = host.store.get('bob')?.imageId;
    const to = host.runtime.rebuildImage(IMAGE);
    // alice starts fine; bob's new unit fails; carol is never touched.
    const original = host.runtime.start.bind(host.runtime);
    let starts = 0;
    host.runtime.start = async (spec, secrets) => {
      starts += 1;
      if (starts === 2) throw new Error('bob image broken');
      return original(spec, secrets);
    };
    const error = await refusal(host.plane.upgrade({ all: true }));
    expect(error.message).toContain('bob image broken');
    expect(error.message).toContain('moved: alice');
    expect(error.message).toContain('failed: bob');
    expect(host.store.get('alice')?.imageId).toBe(to);
    expect(host.store.get('bob')?.imageId).toBe(old);
    expect(host.store.get('carol')?.imageId).toBe(old);
    expect(host.runtime.imageOf('carol')).toBe(old);
  });
});

describe('image retention', () => {
  it('releases the previous image after an upgrade and the image of a deleted account', async () => {
    const host = await twoAccounts();
    const first = host.store.get('alice')?.imageId ?? '';
    host.runtime.rebuildImage(IMAGE);
    host.runtime.calls.length = 0;
    await host.plane.upgrade('alice');
    // bob still runs the first image, so it is kept.
    expect(host.runtime.calls.filter((c) => c.startsWith('releaseImage:'))).toEqual([]);
    await host.plane.upgrade('bob');
    expect(host.runtime.calls).toContain(`releaseImage:${first}`);

    host.runtime.calls.length = 0;
    await host.plane.delete('alice', 'alice');
    expect(host.runtime.calls.filter((c) => c.startsWith('releaseImage:'))).toEqual([]);
    await host.plane.delete('bob', 'bob');
    expect(host.runtime.calls.filter((c) => c.startsWith('releaseImage:'))).toHaveLength(1);
  });

  it('keeps the previous image when the upgrade is rolled back, and ignores a failed release', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.rebuildImage(IMAGE);
    const failed = host.runtime.rebuildImage(IMAGE);
    host.runtime.failNext('start', new Error('broken'));
    await refusal(host.plane.upgrade('alice'));
    // Only the image that failed is let go; the one the account is recorded on stays.
    expect(host.runtime.calls.filter((c) => c.startsWith('releaseImage:'))).toEqual([
      `releaseImage:${failed}`,
    ]);

    host.runtime.failNext('releaseImage', new Error('image is in use'));
    await expect(host.plane.upgrade('alice')).resolves.toMatchObject({ moved: [{ id: 'alice' }] });
  });
});

describe('routes', () => {
  it('serve the account again after an upgrade that found it down', async () => {
    const host = await twoAccounts();
    host.runtime.crash('alice');
    await host.plane.delete('bob', 'bob'); // reapplies the routes while alice is down
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('unavailable');
    host.runtime.rebuildImage(IMAGE);
    await host.plane.upgrade('alice');
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
  });
});

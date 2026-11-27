import { describe, expect, it } from 'vitest';

import { FakeRuntime } from '../runtime/fake.js';
import { RuntimePortError } from '../runtime/port.js';
import { describeRuntimePortContract, unitSpecFor } from '../runtime/testing/contract.js';

describeRuntimePortContract('fake runtime', () => new FakeRuntime(), {
  makeUnverified: () => {
    const runtime = new FakeRuntime();
    runtime.setGuard('unverified');
    return runtime;
  },
});

describe('fake runtime specifics', () => {
  it('uses documentation-range addresses, never loopback', async () => {
    const runtime = new FakeRuntime();
    const a = await runtime.provision(unitSpecFor('a'));
    const b = await runtime.provision(unitSpecFor('b'));
    expect(a.endpoints.host).toMatch(/^198\.51\.100\.\d+$/u);
    expect(b.endpoints.host).not.toBe(a.endpoints.host);
    expect([a.endpoints.guiPort, a.endpoints.wsPort]).toEqual([8360, 8361]);
  });

  it('refuses to start while the guard is unverified', async () => {
    const runtime = new FakeRuntime();
    await runtime.provision(unitSpecFor('a'));
    runtime.setGuard('unverified');
    expect((await runtime.describe()).guard.state).toBe('unverified');
    await expect(runtime.start(unitSpecFor('a'), {})).rejects.toMatchObject({
      code: 'guard-unverified',
    });
    runtime.setGuard('verified');
    expect((await runtime.start(unitSpecFor('a'), {})).state).toBe('running');
  });

  it('injects a failure once per step', async () => {
    const runtime = new FakeRuntime();
    runtime.failNext('provision', new Error('boom'));
    await expect(runtime.provision(unitSpecFor('a'))).rejects.toThrow('boom');
    await expect(runtime.provision(unitSpecFor('a'))).resolves.toMatchObject({ account: 'a' });
  });

  it('simulates a crash and reports the unit unhealthy', async () => {
    const runtime = new FakeRuntime();
    await runtime.provision(unitSpecFor('a'));
    await runtime.start(unitSpecFor('a'), {});
    runtime.crash('a');
    expect(await runtime.inspect('a')).toMatchObject({ state: 'exited', healthy: false });
  });

  it('records which key started which unit but never returns it', async () => {
    const runtime = new FakeRuntime();
    await runtime.provision(unitSpecFor('a'));
    await runtime.provision(unitSpecFor('b'));
    await runtime.start(unitSpecFor('a'), { modelApiKey: 'key-a' });
    await runtime.start(unitSpecFor('b'), { modelApiKey: 'key-b' });
    expect(runtime.wasStartedWithKey('a', 'key-a')).toBe(true);
    expect(runtime.wasStartedWithKey('a', 'key-b')).toBe(false);
    expect(JSON.stringify([await runtime.list(), await runtime.inspect('a')])).not.toContain(
      'key-',
    );
    await runtime.stop('a');
    expect(runtime.wasStartedWithKey('a', 'key-a')).toBe(false);
  });

  it('gives a typed error for an access code before the first start', async () => {
    const runtime = new FakeRuntime();
    await runtime.provision(unitSpecFor('a'));
    await expect(runtime.accessCode('a')).rejects.toBeInstanceOf(RuntimePortError);
    await expect(runtime.accessCode('a')).rejects.toMatchObject({ code: 'no-access-code' });
  });
});

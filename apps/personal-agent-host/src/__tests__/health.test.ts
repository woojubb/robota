import { afterEach, describe, expect, it } from 'vitest';

import { EXIT } from '../admin/protocol.js';
import type { IHealthReport } from '../control-plane.js';
import { unitSpecFor } from '../runtime/testing/contract.js';
import { rawRequest, startHost, stopHosts } from './admin-harness.js';
import { addInput, cleanTempDirs, KEY, makeHost } from './harness.js';

afterEach(async () => {
  await stopHosts();
  await cleanTempDirs();
});

const ADD = ['add', 'vera', '--provider', 'anthropic', '--model', 'test-model'];
const ADD_WREN = ['add', 'wren', '--provider', 'anthropic', '--model', 'test-model'];

describe('health', () => {
  it('is healthy when the guard is verified, the routes are current and every active unit runs', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    expect(await host.plane.health()).toEqual({ healthy: true, checked: 2, problems: [] });
  });

  it('is healthy with no accounts at all', async () => {
    const host = await makeHost();
    await host.plane.reconcile();
    expect(await host.plane.health()).toEqual({ healthy: true, checked: 0, problems: [] });
  });

  it('names a unit that is down, until the reconcile loop restarts it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    host.runtime.crash('alice');
    const sick = await host.plane.health();
    expect(sick.healthy).toBe(false);
    expect(sick.problems).toEqual([
      {
        kind: 'unit-down',
        account: 'alice',
        message: 'the unit is exited but the account is active',
      },
    ]);
    await host.plane.reconcile();
    expect((await host.plane.health()).healthy).toBe(true);
  });

  it('names a running unit that is not healthy, and a unit that is gone', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    host.runtime.setSick('alice', true);
    expect((await host.plane.health()).problems.map((p) => [p.kind, p.account])).toEqual([
      ['unit-unhealthy', 'alice'],
    ]);
    host.runtime.setSick('alice', false);
    await host.runtime.destroy('bob');
    const gone = await host.plane.health();
    expect(gone.problems).toEqual([
      {
        kind: 'unit-down',
        account: 'bob',
        message: 'the unit is absent but the account is active',
      },
    ]);
  });

  it('names a unit that runs an image other than the recorded one', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const record = host.store.get('alice');
    if (!record) throw new Error('no record');
    const stray = `sha256:${'b'.repeat(64)}`;
    await host.runtime.stop('alice');
    await host.runtime.start(
      unitSpecFor('alice', {
        installId: host.store.installId,
        image: stray,
        subnetSlot: record.subnetSlot,
      }),
      { modelApiKey: KEY },
    );
    const report = await host.plane.health();
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ kind: 'unit-image', account: 'alice' });
    expect(report.problems[0].message).toContain('bbbbbbbbbbbb');
  });

  it('does not count a suspended account against the host', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.suspend('alice');
    expect(await host.plane.health()).toEqual({ healthy: true, checked: 0, problems: [] });
  });

  it('reports an unverified guard, and a guard that cannot be read', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.setGuard('unverified');
    const unverified = await host.plane.health();
    expect(unverified.problems.map((p) => p.kind)).toEqual(['guard']);
    host.runtime.setGuard('verified');
    host.runtime.failNext('describe', new Error('engine unreachable'));
    const unreadable = await host.plane.health();
    expect(unreadable.problems).toHaveLength(1);
    expect(unreadable.problems[0].message).toContain('engine unreachable');
  });

  it('reports routes that failed to apply, and clears once they apply again', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    host.proxy.failNext();
    // The loop restarts the unit but the routes cannot be applied.
    await host.plane.reconcile();
    const stale = await host.plane.health();
    expect(stale.problems.map((p) => p.kind)).toEqual(['routes']);
    await host.plane.reconcile();
    expect((await host.plane.health()).healthy).toBe(true);
  });

  it('lists every problem, not only the first, and never carries a key', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    host.runtime.setGuard('unverified');
    host.runtime.crash('alice');
    host.runtime.setSick('bob', true);
    const report = await host.plane.health();
    expect(report.problems.map((p) => p.kind).sort()).toEqual([
      'guard',
      'unit-down',
      'unit-unhealthy',
    ]);
    expect(JSON.stringify(report)).not.toContain(KEY);
  });

  it('is audited like every other command', async () => {
    const host = await makeHost();
    await host.plane.health();
    expect(await host.auditText()).toContain('"command":"health","account":null,"result":"ok"');
  });
});

describe('health does not repair', () => {
  it('reports a guard that went missing without reapplying it, which the reconcile loop then does', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.setGuard('unverified');
    host.runtime.calls.length = 0;
    const report = await host.plane.health();
    expect(report.problems.map((p) => p.kind)).toEqual(['guard']);
    // Verify-only: the repairing check (describe) is never asked, and no unit is touched.
    expect(host.runtime.calls).toContain('describe:verify');
    expect(host.runtime.calls).not.toContain('describe:');
    expect(host.runtime.calls.some((c) => /^(start|stop|provision):/u.test(c))).toBe(false);
  });
});

describe('status does not repair either', () => {
  it('shows an unverified guard and leaves it for the reconcile loop', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.setGuard('unverified');
    host.runtime.calls.length = 0;
    expect((await host.plane.status()).runtime.guard).toBe('unverified');
    expect(host.runtime.calls).not.toContain('describe:');
  });
});

describe('status shows what the reconcile loop did', () => {
  it('reports the last restart, and a backoff while restarts fail', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const first = (await host.plane.status()).accounts[0];
    expect(first.lastRestartAt).toBeNull();
    expect(first.backoff).toBeNull();

    host.clock.now += 5_000;
    host.runtime.crash('alice');
    host.runtime.failNext('start');
    await host.plane.reconcile();
    const failing = (await host.plane.status()).accounts[0];
    expect(failing.lastRestartAt).toBeNull();
    expect(failing.backoff).toEqual({
      failures: 1,
      retryAt: new Date(host.clock.now + 1_000).toISOString(),
    });

    host.clock.now += 1_000;
    await host.plane.reconcile();
    const restarted = (await host.plane.status()).accounts[0];
    expect(restarted.lastRestartAt).toBe(new Date(host.clock.now).toISOString());
    expect(restarted.backoff).toBeNull();

    // A deleted account's history does not follow a later account of the same id.
    await host.plane.delete('alice', 'alice');
    await host.plane.add(addInput('alice'));
    const again = (await host.plane.status()).accounts[0];
    expect(again.lastRestartAt).toBeNull();
  });
});

describe('health over the socket and the CLI', () => {
  it('exits 0 with a one-line answer when healthy, and 6 with one line per problem otherwise', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);
    await host.cli(ADD_WREN, KEY);

    const ok = await host.cli(['health']);
    expect(ok).toMatchObject({ code: EXIT.ok, err: '' });
    expect(ok.out).toBe(
      'healthy: the guard is verified, the routes are current, 2 active accounts running and healthy\n',
    );

    host.runtime.crash('vera');
    host.runtime.setSick('wren', true);
    const sick = await host.cli(['health']);
    expect(sick.code).toBe(EXIT.unhealthy);
    expect(sick.out.trimEnd().split('\n')).toEqual([
      'vera: the unit is exited but the account is active',
      'wren: the unit is running but not healthy',
    ]);

    const json = await host.cli(['health', '--json']);
    expect(json.code).toBe(EXIT.unhealthy);
    const report = JSON.parse(json.out) as IHealthReport;
    expect(report.healthy).toBe(false);
    expect(report.problems.map((p) => p.account)).toEqual(['vera', 'wren']);

    // The control plane repairs it; the same command then says so.
    host.runtime.setSick('wren', false);
    await host.host.plane.reconcile();
    expect((await host.cli(['health'])).code).toBe(EXIT.ok);
  });

  it('takes no arguments, and the route takes no body, query or other method', async () => {
    const host = await startHost();
    expect((await host.cli(['health', 'extra'])).code).toBe(2);
    expect((await host.cli(['health', '--all'])).code).toBe(2);
    expect((await rawRequest(host.env, 'POST', '/v1/health')).status).toBe(405);
    expect((await rawRequest(host.env, 'GET', '/v1/health?x=1')).status).toBe(400);
    expect((await rawRequest(host.env, 'GET', '/v1/health/extra')).status).toBe(404);
  });

  it('keeps every exit code distinct, so a monitor can tell a problem from an outage', () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
    expect(EXIT.unhealthy).toBe(6);
    expect(EXIT.unreachable).toBe(5);
  });
});

import { afterEach, describe, expect, it } from 'vitest';

import { unitSpecFor } from '../runtime/testing/contract.js';
import { addInput, cleanTempDirs, KEY, makeHost } from './harness.js';

afterEach(cleanTempDirs);

describe('reconcile', () => {
  it('does nothing when every unit is where its record says', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const report = await host.plane.reconcile();
    expect(report).toEqual({
      guard: 'verified',
      started: [],
      stopped: [],
      failed: [],
      orphans: [],
      unhealthy: [],
      backedOff: [],
    });
  });

  it('fails closed: with the guard unverified every running unit is stopped and none is started', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    host.runtime.setGuard('unverified');
    const report = await host.plane.reconcile();
    expect(report.guard).toBe('unverified');
    expect(report.stopped.sort()).toEqual(['alice', 'bob']);
    expect((await host.runtime.list()).every((u) => u.state === 'stopped')).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('unavailable');

    const again = await host.plane.reconcile();
    expect(again.started).toEqual([]);
    expect((await host.runtime.list()).every((u) => u.state === 'stopped')).toBe(true);

    host.runtime.setGuard('verified');
    const recovered = await host.plane.reconcile();
    expect(recovered.started.sort()).toEqual(['alice', 'bob']);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
  });

  it('treats a guard probe that throws as unverified', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.failNext('describe');
    const report = await host.plane.reconcile();
    expect(report.guard).toBe('unverified');
    expect((await host.runtime.inspect('alice')).state).toBe('stopped');
  });

  it('restarts a crashed unit with its stored key and updates the route', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    const report = await host.plane.reconcile();
    expect(report.started).toEqual(['alice']);
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
  });

  it('backs off after a failed restart, growing the wait', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    host.runtime.failNext('start');
    host.runtime.failNext('start');
    expect((await host.plane.reconcile()).failed).toHaveLength(1);
    expect((await host.plane.reconcile()).backedOff).toEqual(['alice']);

    host.clock.now += 1_000;
    expect((await host.plane.reconcile()).failed).toHaveLength(1);
    host.clock.now += 1_000;
    expect((await host.plane.reconcile()).backedOff).toEqual(['alice']);
    host.clock.now += 1_000;
    const done = await host.plane.reconcile();
    expect(done.started).toEqual(['alice']);
    expect((await host.plane.reconcile()).backedOff).toEqual([]);
  });

  it('keeps a key out of the report and audit when a restart fails', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    host.runtime.failNext('start', new Error(`engine echoed ${KEY}`));
    const report = await host.plane.reconcile();
    expect(JSON.stringify(report)).not.toContain(KEY);
    expect(JSON.stringify(report)).toContain('[redacted]');
    expect(await host.auditText()).not.toContain(KEY);
  });

  it('stops a unit that runs for a suspended account', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const record = host.store.get('alice');
    if (!record) throw new Error('missing');
    await host.store.put({ ...record, state: 'suspended' });
    const report = await host.plane.reconcile();
    expect(report.stopped).toEqual(['alice']);
    expect((await host.runtime.inspect('alice')).state).toBe('stopped');
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('suspended');
  });

  it('reports units with no record and never deletes them', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.runtime.provision(unitSpecFor('stray'));
    await host.runtime.start(unitSpecFor('stray'), {});
    const first = await host.plane.reconcile();
    const second = await host.plane.reconcile();
    expect(first.orphans).toEqual(['stray']);
    expect(second.orphans).toEqual(['stray']);
    expect((await host.runtime.inspect('stray')).state).toBe('running');
    const audited = (await host.auditLines()).filter((l) => l.command === 'reconcile-orphan');
    expect(audited).toHaveLength(1);
  });

  it('flags a running unit that reports unhealthy without touching it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const original = host.runtime.list.bind(host.runtime);
    host.runtime.list = async () => (await original()).map((u) => ({ ...u, healthy: false }));
    const report = await host.plane.reconcile();
    expect(report.unhealthy).toEqual(['alice']);
    expect(report.started).toEqual([]);
  });

  it('runs one operation at a time alongside commands', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    const [report, view] = await Promise.all([host.plane.reconcile(), host.plane.show('alice')]);
    expect(report.started).toEqual(['alice']);
    expect(view.runtime).toMatchObject({ state: 'running' });
  });
});

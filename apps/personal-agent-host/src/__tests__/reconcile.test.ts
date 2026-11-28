import { afterEach, describe, expect, it } from 'vitest';

import { unitSpecFor } from '../runtime/testing/contract.js';
import { addInput, cleanTempDirs, KEY, makeHost } from './harness.js';

afterEach(cleanTempDirs);

describe('reconcile', () => {
  it('restarts a running unit from the recorded image when it runs an unrecorded one', async () => {
    // What a control plane that restarted in the middle of an upgrade leaves behind.
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const recorded = host.store.get('alice')?.imageId ?? '';
    const record = host.store.get('alice');
    if (!record) throw new Error('no record');
    const stray = `sha256:${'b'.repeat(64)}`;
    const spec = unitSpecFor('alice', {
      installId: host.store.installId,
      image: stray,
      subnetSlot: record.subnetSlot,
    });
    await host.runtime.start(spec, { modelApiKey: KEY });
    expect(host.runtime.imageOf('alice')).toBe(stray);

    const report = await host.plane.reconcile();
    expect(report.stopped).toEqual(['alice']);
    expect(report.started).toEqual(['alice']);
    expect(host.runtime.imageOf('alice')).toBe(recorded);
    expect((await host.runtime.inspect('alice')).state).toBe('running');
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
    expect(
      (await host.auditLines()).some((l) => l.reason === 'unit runs an unrecorded image'),
    ).toBe(true);
  });

  it('releases the retention of an unrecorded image it stopped, and keeps one another account uses', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    const aliceRecord = host.store.get('alice');
    if (!aliceRecord) throw new Error('no record');
    const recorded = aliceRecord.imageId;
    const stray = `sha256:${'b'.repeat(64)}`;
    const onImage = (image: string) =>
      unitSpecFor('alice', {
        installId: host.store.installId,
        image,
        subnetSlot: aliceRecord.subnetSlot,
      });

    await host.runtime.start(onImage(stray), { modelApiKey: KEY });
    await host.plane.reconcile();
    expect(host.runtime.calls).toContain(`releaseImage:${stray}`);
    expect(host.runtime.calls).not.toContain(`releaseImage:${recorded}`);

    // Bob moves to a rebuilt image; alice's unit running that image is still not hers to keep.
    const rebuilt = host.runtime.rebuildImage('personal-agent:test');
    await host.plane.upgrade('bob');
    expect(host.store.get('bob')?.imageId).toBe(rebuilt);
    host.runtime.calls.length = 0;
    await host.runtime.start(onImage(rebuilt), { modelApiKey: KEY });
    await host.plane.reconcile();
    expect(host.runtime.calls).not.toContain(`releaseImage:${rebuilt}`);
  });

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

  it('applies the routes again on a later pass when the proxy refused them', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.crash('alice');
    host.proxy.failNext();
    const first = await host.plane.reconcile();
    expect(first.started).toEqual(['alice']);
    expect(first.failed).toEqual([{ account: '*', reason: expect.stringContaining('routes') }]);
    const applied = host.proxy.history.length;

    const second = await host.plane.reconcile();
    expect(second.failed).toEqual([]);
    expect(host.proxy.history.length).toBe(applied + 1);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');

    // Once they are current, a quiet pass applies nothing.
    await host.plane.reconcile();
    expect(host.proxy.history.length).toBe(applied + 1);
  });
});

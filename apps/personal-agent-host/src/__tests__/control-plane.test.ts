import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HostError } from '../errors.js';
import { unitSpecFor } from '../runtime/testing/contract.js';
import { addInput, cleanTempDirs, type IHost, KEY, makeHost } from './harness.js';

afterEach(cleanTempDirs);

async function expectNothingLeft(host: IHost, id: string): Promise<void> {
  expect(host.store.get(id)).toBeUndefined();
  expect(host.runtime.has(id)).toBe(false);
  expect(await host.secrets.hasAccountKey(id)).toBe(false);
  expect(host.proxy.siteFor(`${id}.agents.example.test`)).toBeUndefined();
}

async function refusal(promise: Promise<unknown>): Promise<HostError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HostError);
    return error as HostError;
  }
  throw new Error('expected a refusal');
}

describe('add', () => {
  it('creates an active account with its unit, secret and route', async () => {
    const host = await makeHost();
    const view = await host.plane.add(addInput('alice'));
    expect(view).toMatchObject({
      id: 'alice',
      hostname: 'alice.agents.example.test',
      url: 'https://alice.agents.example.test',
      state: 'active',
      key: 'set',
      keySource: 'account',
    });
    expect(host.store.get('alice')?.state).toBe('active');
    expect(await host.secrets.readAccountKey('alice')).toBe(KEY);
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    const site = host.proxy.siteFor('alice.agents.example.test');
    expect(site).toMatchObject({ kind: 'active' });
    const unit = await host.runtime.inspect('alice');
    expect(site).toMatchObject({
      guiUpstream: `${unit.endpoints.host}:${unit.endpoints.guiPort}`,
      wsUpstream: `${unit.endpoints.host}:${unit.endpoints.wsPort}`,
    });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  it('gives each account its own subnet slot and applies default limits', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob', { limits: { memoryMb: 256 } }));
    expect(host.store.get('alice')?.subnetSlot).toBe(0);
    expect(host.store.get('bob')?.subnetSlot).toBe(1);
    expect(host.store.get('alice')?.limits).toEqual(host.config.defaultLimits);
    expect(host.store.get('bob')?.limits.memoryMb).toBe(256);
  });

  it('shows the public port suffix when an HTTPS port is configured', async () => {
    const host = await makeHost({
      extra: { PERSONAL_AGENT_HOST_HTTPS_PORT: '8443', PERSONAL_AGENT_HOST_HTTP_PORT: '8080' },
    });
    expect((await host.plane.add(addInput('alice'))).url).toBe(
      'https://alice.agents.example.test:8443',
    );
  });

  it('refuses the container backend unless the setting allows it, naming the setting', async () => {
    const host = await makeHost({ extra: { PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'false' } });
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.code).toBe('refused');
    expect(error.message).toContain('PERSONAL_AGENT_HOST_ALLOW_CONTAINER');
    await expectNothingLeft(host, 'alice');
    expect(host.runtime.calls).toEqual([]);
  });

  it('refuses the vm backend as not yet available', async () => {
    const host = await makeHost();
    const error = await refusal(host.plane.add(addInput('alice', { backend: 'vm' })));
    expect(error.message).toContain('not available');
    await expectNothingLeft(host, 'alice');
  });

  it('refuses bad input and duplicates without touching the runtime', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const before = host.runtime.calls.length;
    for (const input of [
      addInput('Bad_Id'),
      addInput('bob', { apiKey: undefined }),
      addInput('bob', { keySource: 'none' }),
      addInput('bob', { keySource: 'operator', apiKey: undefined }),
      addInput('bob', { provider: { type: 'x', baseUrl: 'https://u:p@h.test' } }),
      addInput('bob', { limits: { pids: 1 } }),
      addInput('alice'),
    ]) {
      const error = await refusal(host.plane.add(input));
      expect(['invalid-input', 'refused', 'conflict']).toContain(error.code);
    }
    expect(host.runtime.calls.length).toBe(before);
    expect(host.store.list().map((r) => r.id)).toEqual(['alice']);
  });

  it('refuses when the host runs another backend', async () => {
    const host = await makeHost();
    const original = host.runtime.describe.bind(host.runtime);
    host.runtime.describe = async () => ({ ...(await original()), backend: 'vm' });
    expect((await refusal(host.plane.add(addInput('alice')))).message).toContain('backend');
    await expectNothingLeft(host, 'alice');
  });

  it('accepts the operator-wide key when it is set', async () => {
    const host = await makeHost();
    await host.secrets.writeOperatorKey('operator-key-42');
    const view = await host.plane.add(
      addInput('alice', { keySource: 'operator', apiKey: undefined }),
    );
    expect(view.key).toBe('set');
    expect(host.runtime.wasStartedWithKey('alice', 'operator-key-42')).toBe(true);
    expect(await host.secrets.hasAccountKey('alice')).toBe(false);
  });
});

describe('rollback', () => {
  const steps = ['provision', 'start', 'list'] as const;

  it.each(steps)('leaves no record, secret or unit when the runtime fails at %s', async (step) => {
    const host = await makeHost();
    host.runtime.failNext(step, new Error(`engine refused: key was ${KEY}`));
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.code).toBe('runtime-failed');
    expect(error.message).not.toContain(KEY);
    await expectNothingLeft(host, 'alice');
    expect(await host.auditText()).not.toContain(KEY);
  });

  it('leaves nothing when the guard check call itself fails', async () => {
    const host = await makeHost();
    const original = host.runtime.describe.bind(host.runtime);
    let calls = 0;
    host.runtime.describe = async () => {
      calls += 1;
      if (calls === 2) throw new Error(`guard probe died with ${KEY}`);
      return original();
    };
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.message).not.toContain(KEY);
    await expectNothingLeft(host, 'alice');
  });

  it('leaves nothing when the guard is not verified, and never starts the unit', async () => {
    const host = await makeHost();
    host.runtime.setGuard('unverified');
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.code).toBe('guard-unverified');
    expect(host.runtime.calls.some((c) => c.startsWith('start:'))).toBe(false);
    await expectNothingLeft(host, 'alice');
  });

  it('leaves nothing when the proxy cannot be applied', async () => {
    const host = await makeHost();
    host.proxy.failNext(new Error(`proxy rejected config with ${KEY}`));
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.message).not.toContain(KEY);
    await expectNothingLeft(host, 'alice');
    expect(JSON.stringify(host.proxy.history)).not.toContain(KEY);
  });

  it('removes the unit again after a failure so a retry succeeds cleanly', async () => {
    const host = await makeHost();
    host.runtime.failNext('start');
    await refusal(host.plane.add(addInput('alice')));
    const view = await host.plane.add(addInput('alice'));
    expect(view.state).toBe('active');
    expect(host.store.get('alice')?.subnetSlot).toBe(0);
  });

  it('keeps the record for recovery when the unit cannot be removed, then recovery removes it', async () => {
    const host = await makeHost();
    host.runtime.failNext('start');
    host.runtime.failNext('destroy', new Error('engine busy'));
    const error = await refusal(host.plane.add(addInput('alice')));
    expect(error.message).toContain('cleanup is incomplete');
    expect(host.store.get('alice')?.state).toBe('provisioning');
    expect(await host.plane.recover()).toEqual(['alice']);
    await expectNothingLeft(host, 'alice');
  });
});

describe('suspend and resume', () => {
  it('stops the unit, serves 503 and keeps the key only in the store', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const code = await host.plane.accessCode('alice');
    await host.plane.suspend('alice');
    expect(host.store.get('alice')?.state).toBe('suspended');
    expect((await host.runtime.inspect('alice')).state).toBe('stopped');
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(false);
    expect(host.proxy.siteFor('alice.agents.example.test')).toEqual({
      kind: 'suspended',
      hostname: 'alice.agents.example.test',
    });
    expect(await host.secrets.readAccountKey('alice')).toBe(KEY);

    await host.plane.resume('alice');
    expect(host.store.get('alice')?.state).toBe('active');
    expect(host.runtime.wasStartedWithKey('alice', KEY)).toBe(true);
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('active');
    expect(await host.plane.accessCode('alice')).toBe(code);
  });

  it('refuses resume while the guard is unverified and leaves the account suspended', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.suspend('alice');
    host.runtime.setGuard('unverified');
    expect((await refusal(host.plane.resume('alice'))).code).toBe('guard-unverified');
    expect(host.store.get('alice')?.state).toBe('suspended');
    expect((await host.runtime.inspect('alice')).state).toBe('stopped');
  });

  it('keeps the account suspended when starting fails on resume', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.suspend('alice');
    host.runtime.failNext('start', new Error(`start failed ${KEY}`));
    const error = await refusal(host.plane.resume('alice'));
    expect(error.message).not.toContain(KEY);
    expect(host.store.get('alice')?.state).toBe('suspended');
    expect(host.proxy.siteFor('alice.agents.example.test')?.kind).toBe('suspended');
  });

  it('reports a missing key on resume instead of starting without it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.suspend('alice');
    await host.secrets.removeAccountKey('alice');
    expect((await refusal(host.plane.resume('alice'))).code).toBe('secret-missing');
  });

  it('refuses unknown accounts', async () => {
    const host = await makeHost();
    expect((await refusal(host.plane.suspend('nobody'))).code).toBe('not-found');
    expect((await refusal(host.plane.resume('nobody'))).code).toBe('not-found');
  });
});

describe('delete', () => {
  it('needs the account id as the confirmation and changes nothing without it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    for (const confirmation of ['', 'yes', 'ALICE', 'bob']) {
      expect((await refusal(host.plane.delete('alice', confirmation))).code).toBe(
        'confirmation-required',
      );
    }
    expect(host.store.get('alice')?.state).toBe('active');
    expect(host.runtime.has('alice')).toBe(true);
  });

  it('removes the unit, key and record and makes the hostname unknown', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob'));
    await host.plane.delete('alice', 'alice');
    await expectNothingLeft(host, 'alice');
    expect(host.proxy.sites().map((s) => s.hostname)).toEqual(['bob.agents.example.test']);
    expect(await readdir(join(host.dir, 'secrets'))).toEqual(['bob.json']);
    expect((await refusal(host.plane.delete('alice', 'alice'))).code).toBe('not-found');
  });

  it('can be retried after the unit could not be destroyed', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.runtime.failNext('destroy', new Error('engine busy'));
    await refusal(host.plane.delete('alice', 'alice'));
    expect(host.store.get('alice')?.state).toBe('deleting');
    expect(host.proxy.siteFor('alice.agents.example.test')).toBeUndefined();
    await host.plane.delete('alice', 'alice');
    await expectNothingLeft(host, 'alice');
  });
});

describe('access code, list, show and status', () => {
  it('returns the unit access code and never writes it to the audit log', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const code = await host.plane.accessCode('alice');
    expect(code.length).toBeGreaterThan(0);
    expect(await host.auditText()).not.toContain(code);
  });

  it('lists and shows records with live state and the key only as set', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.add(addInput('bob', { keySource: 'none', apiKey: undefined }));
    host.runtime.crash('alice');
    const listed = await host.plane.list();
    expect(listed.map((v) => [v.id, v.key, v.runtime.state])).toEqual([
      ['alice', 'set', 'exited'],
      ['bob', 'unset', 'running'],
    ]);
    const shown = await host.plane.show('alice');
    expect(shown.runtime).toMatchObject({ state: 'exited' });
    expect(JSON.stringify([listed, shown])).not.toContain(KEY);
  });

  it('never loads a secret to list or show', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    let reads = 0;
    const original = host.secrets.resolve.bind(host.secrets);
    host.secrets.resolve = async (r) => ((reads += 1), original(r));
    host.secrets.readAccountKey = async () => {
      reads += 1;
      return undefined;
    };
    await host.plane.list();
    await host.plane.show('alice');
    expect(reads).toBe(0);
  });

  it('reports desired against actual state, the proxy hash and strays', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.runtime.provision(unitSpecFor('stray'));
    const status = await host.plane.status();
    expect(status.runtime).toMatchObject({ backend: 'container', guard: 'verified' });
    expect(status.routesHash).toMatch(/^[a-f0-9]{16}$/u);
    expect(status.accounts).toEqual([
      {
        id: 'alice',
        desired: 'active',
        actual: 'running',
        healthy: true,
        imageId: host.store.get('alice')?.imageId,
      },
    ]);
    expect(status.orphans).toEqual(['stray']);
    expect(status.domainMismatches).toEqual([]);
  });

  it('flags a stored hostname under another domain than the configured one, without rewriting it', async () => {
    const first = await makeHost();
    await first.plane.add(addInput('alice'));
    const moved = await makeHost({
      dir: first.dir,
      extra: { PERSONAL_AGENT_HOST_BASE_DOMAIN: 'agents.other.test' },
    });
    const status = await moved.plane.status();
    expect(status.baseDomain).toBe('agents.other.test');
    expect(status.domainMismatches).toEqual([
      { id: 'alice', hostname: 'alice.agents.example.test' },
    ]);
    expect(moved.store.get('alice')?.hostname).toBe('alice.agents.example.test');
    expect((await moved.plane.show('alice')).hostname).toBe('alice.agents.example.test');
  });
});

describe('one operation at a time', () => {
  it('does not interleave the runtime calls of concurrent commands', async () => {
    const host = await makeHost();
    await Promise.all([host.plane.add(addInput('alice')), host.plane.add(addInput('bob'))]);
    const accounts = host.runtime.calls.filter((c) => c.includes(':a') || c.includes(':b'));
    const firstOfB = accounts.findIndex((c) => c.endsWith(':bob'));
    const lastOfA = accounts.map((c) => c.endsWith(':alice')).lastIndexOf(true);
    expect(lastOfA).toBeLessThan(firstOfB);
    expect(host.store.list().map((r) => r.id)).toEqual(['alice', 'bob']);
  });

  it('keeps serving the queue after a failed command', async () => {
    const host = await makeHost();
    host.runtime.failNext('provision');
    const results = await Promise.allSettled([
      host.plane.add(addInput('alice')),
      host.plane.add(addInput('bob')),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  });
});

describe('crash recovery', () => {
  it('finishes provisioning and deleting accounts by removal and audits it', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('keeper'));
    const now = '2026-01-01T00:00:00.000Z';
    const base = host.store.get('keeper');
    if (!base) throw new Error('missing');
    await host.store.put({
      ...base,
      id: 'half',
      hostname: 'half.agents.example.test',
      state: 'provisioning',
      subnetSlot: 5,
      createdAt: now,
      updatedAt: now,
    });
    await host.store.put({
      ...base,
      id: 'going',
      hostname: 'going.agents.example.test',
      state: 'deleting',
      subnetSlot: 6,
      createdAt: now,
      updatedAt: now,
    });
    await host.runtime.provision(unitSpecFor('half'));
    await host.runtime.provision(unitSpecFor('going'));
    await host.secrets.writeAccountKey('going', KEY);

    const restarted = await makeHost({ dir: host.dir, runtime: host.runtime, proxy: host.proxy });
    expect(await restarted.plane.recover()).toEqual(['going', 'half']);
    expect(restarted.store.list().map((r) => r.id)).toEqual(['keeper']);
    expect(host.runtime.has('half')).toBe(false);
    expect(host.runtime.has('going')).toBe(false);
    expect(await restarted.secrets.hasAccountKey('going')).toBe(false);
    expect(host.runtime.has('keeper')).toBe(true);
    const recovered = (await restarted.auditLines()).filter((l) => l.result === 'recovered');
    expect(recovered.map((l) => l.account).sort()).toEqual(['going', 'half']);
    expect(recovered.every((l) => l.command === 'recover')).toBe(true);
  });

  it('does nothing when no account is half-made', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    expect(await host.plane.recover()).toEqual([]);
    expect(host.store.get('alice')?.state).toBe('active');
  });
});

describe('audit', () => {
  it('keeps the result of a completed command when only its audit write fails', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    host.audit.append = async () => {
      throw new Error('ENOSPC: disk full');
    };
    const view = await host.plane.suspend('alice');
    expect(view.state).toBe('suspended');
    expect(host.store.get('alice')?.state).toBe('suspended');
    const status = await host.plane.status();
    expect(status.audit.failures).toBeGreaterThanOrEqual(1);
    expect(status.audit.last).toContain('disk full');
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it('records every command, refused or not, and never a secret', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    await host.plane.accessCode('alice');
    await host.plane.list();
    await host.plane.show('alice');
    await host.plane.status();
    await host.plane.suspend('alice');
    await host.plane.resume('alice');
    await refusal(host.plane.delete('alice', 'wrong'));
    await refusal(host.plane.show('nobody'));
    await host.plane.delete('alice', 'alice', 'tester');
    const lines = await host.auditLines();
    expect(lines.map((l) => [l.command, l.account, l.result])).toEqual([
      ['add', 'alice', 'ok'],
      ['access-code', 'alice', 'ok'],
      ['list', null, 'ok'],
      ['show', 'alice', 'ok'],
      ['status', null, 'ok'],
      ['suspend', 'alice', 'ok'],
      ['resume', 'alice', 'ok'],
      ['delete', 'alice', 'refused'],
      ['show', 'nobody', 'refused'],
      ['delete', 'alice', 'ok'],
    ]);
    expect(lines[0].actor).toBe('operator');
    expect(lines[9].actor).toBe('tester');
    expect(lines[7].reason).toContain('confirmation');
    expect(await host.auditText()).not.toContain(KEY);
  });

  it('marks runtime failures as failed with a scrubbed reason', async () => {
    const host = await makeHost();
    host.runtime.failNext('start', new Error(`start failed ${KEY}`));
    await refusal(host.plane.add(addInput('alice')));
    const last = (await host.auditLines()).at(-1);
    expect(last).toMatchObject({ command: 'add', account: 'alice', result: 'failed' });
    expect(last?.reason).toContain('[redacted]');
    expect(await host.auditText()).not.toContain(KEY);
  });
});

describe('secrets never leave the store', () => {
  it('keeps the key out of every output of a full lifecycle', async () => {
    const host = await makeHost();
    const outputs: unknown[] = [];
    outputs.push(await host.plane.add(addInput('alice')));
    outputs.push(
      await host.plane.list(),
      await host.plane.show('alice'),
      await host.plane.status(),
    );
    outputs.push(await host.plane.suspend('alice'), await host.plane.resume('alice'));
    outputs.push(host.proxy.history, await host.runtime.list(), host.runtime.calls);
    outputs.push(await host.auditText());
    expect(JSON.stringify(outputs)).not.toContain(KEY);
  });
});

describe('routes', () => {
  it('treats a running unit that reports no address as unavailable, never as a :0 upstream', async () => {
    const host = await makeHost();
    await host.plane.add(addInput('alice'));
    const list = host.runtime.list.bind(host.runtime);
    host.runtime.list = async () =>
      (await list()).map((unit) => ({ ...unit, endpoints: { host: '', guiPort: 0, wsPort: 0 } }));
    await host.plane.add(addInput('bob'));
    expect(host.proxy.siteFor('alice.agents.example.test')).toEqual({
      kind: 'unavailable',
      hostname: 'alice.agents.example.test',
    });
  });
});

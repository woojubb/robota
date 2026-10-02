import { fork, type ChildProcess } from 'node:child_process';
import { copyFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrganizationAuditAppendConflict,
  OrganizationAudit,
  organizationAuditEvent,
  OrganizationBroker,
  verifyOrganizationAudit,
} from '../index.js';
import type { IOrganizationAuditSink, IOrganizationAuditAnchor } from '../index.js';
import { fixture } from './fixtures.js';
import { auditFixture } from './audit-fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
const brokers: OrganizationBroker[] = [];
const children = new Set<ChildProcess>();
function message(child: ChildProcess, kind: string): Promise<{ kind: string; url?: string }> {
  return new Promise((resolve, reject) => {
    const clean = () => {
      clearTimeout(timer);
      child.off('message', receive);
      child.off('exit', failed);
      child.off('error', failed);
    };
    const failed = () => {
      clean();
      reject(new Error('Audit fixture process failed'));
    };
    const receive = (value: unknown) => {
      const item = value as { kind: string; url?: string };
      if (item.kind === 'failed') {
        failed();
        return;
      }
      if (item.kind === kind) {
        clean();
        resolve(item);
      }
    };
    const timer = setTimeout(failed, 5000);
    child.on('message', receive);
    child.once('exit', failed);
    child.once('error', failed);
  });
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    children.delete(child);
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 1000);
    child.once('exit', () => {
      clearTimeout(timer);
      children.delete(child);
      resolve();
    });
    if (child.connected) child.send({ kind: 'stop' });
    else child.kill('SIGTERM');
  });
}
async function start(options: Record<string, unknown>) {
  const child = fork(new URL('./audit-store.mjs', import.meta.url), [], {
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  children.add(child);
  await message(child, 'ready');
  const ready = message(child, 'listening');
  child.send({ kind: 'start', options });
  const result = await ready;
  return { child, url: result.url! };
}
async function post(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    signal,
    redirect: 'manual',
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    if (response.status === 409) throw new OrganizationAuditAppendConflict();
    throw new Error('Audit storage unavailable');
  }
  return response.json();
}
function ports(
  sinkUrl: string,
  anchorUrl: string,
): { sink: IOrganizationAuditSink; anchor: IOrganizationAuditAnchor } {
  return {
    sink: {
      read: async (after, signal) =>
        (await post(sinkUrl + '/read', after, signal)) as Awaited<
          ReturnType<IOrganizationAuditSink['read']>
        >,
      append: async (expected, event, signal) =>
        (await post(sinkUrl + '/append', { expected, event }, signal)) as Awaited<
          ReturnType<IOrganizationAuditSink['append']>
        >,
    },
    anchor: {
      load: async (signal) =>
        (await post(anchorUrl + '/load', {}, signal)) as Awaited<
          ReturnType<IOrganizationAuditAnchor['load']>
        >,
      compareAndSet: async (expected, next, signal) =>
        (await post(anchorUrl + '/cas', { expected, next }, signal)) as boolean,
    },
  };
}
function setup() {
  const f = fixture();
  fixtures.push(f);
  const a = auditFixture();
  const common = { stream: a.stream, publicKey: a.signer.publicKey, genesis: a.genesis };
  const sinkConfig = {
    ...common,
    path: join(f.directory, 'audit-sink.sqlite'),
    role: 'sink',
    privateKey: a.signer.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
  const anchorConfig = {
    ...common,
    path: join(f.directory, 'audit-anchor.sqlite'),
    role: 'anchor',
  };
  const makeAudit = (sinkUrl: string, anchorUrl: string) =>
    new OrganizationAudit({
      stream: a.stream,
      publicKey: a.signer.publicKey,
      ...ports(sinkUrl, anchorUrl),
      timeoutMs: 2000,
    });
  const execute = vi.fn(async () => {
    appendFileSync(join(f.directory, 'benign-effect.txt'), 'effect\n');
    return {
      value: { secret: 'SECRET_CANARY_RETURN' },
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    };
  });
  const makeBroker = (audit: OrganizationAudit) => {
    const b = new OrganizationBroker({
      ledger: f.ledger,
      audit,
      actions: [
        {
          resource: 'asset',
          operation: 'read',
          roles: ['operator'],
          requiresApproval: false,
          reserve: () => ({ tokens: 10, timeMs: 5000, costMicros: 10 }),
          execute,
        },
      ],
    });
    brokers.push(b);
    return b;
  };
  return { f, a, sinkConfig, anchorConfig, makeAudit, makeBroker, execute };
}
afterEach(async () => {
  for (const b of brokers.splice(0)) b.close();
  await Promise.all([...children].map(stop));
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('separate local audit sink and checkpoint processes', () => {
  it('keeps load read-only and refuses unsigned checkpoint updates on the CAS route', async () => {
    const s = setup();
    const anchor = await start({ ...s.anchorConfig, bootstrap: true });
    const next = s.a.signed({ ...s.a.genesis.claims, sequence: 1, hash: 'a'.repeat(64) });
    const change = { expected: s.a.genesis.claims, next };
    const send = (route: string, body: unknown) =>
      post(anchor.url + route, body, AbortSignal.timeout(2000));
    expect(await send('/load', change)).toEqual(s.a.genesis);
    await expect(
      send('/cas', { ...change, next: { ...next, signature: 'invalid-signature' } }),
    ).rejects.toThrow('Audit storage unavailable');
    expect(await send('/load', {})).toEqual(s.a.genesis);
    expect(await send('/cas', change)).toBe(true);
    expect(await send('/load', {})).toEqual(next);
  });

  it('gates real benign effects and retains verifiable secret-free metadata across process/disk reopen', async () => {
    const s = setup();
    let sink = await start({ ...s.sinkConfig, bootstrap: true });
    let anchor = await start({ ...s.anchorConfig, bootstrap: true });
    let audit = s.makeAudit(sink.url, anchor.url);
    let broker = s.makeBroker(audit);
    const request = s.f.request({
      operation: {
        ...s.f.request().operation,
        parameters: { password: 'SECRET_CANARY_PARAMETER' },
      },
    });
    await broker.apply(s.f.call(request));
    expect(s.execute).toHaveBeenCalledTimes(1);
    broker.close();
    await stop(sink.child);
    await stop(anchor.child);
    sink = await start(s.sinkConfig);
    anchor = await start(s.anchorConfig);
    audit = s.makeAudit(sink.url, anchor.url);
    broker = s.makeBroker(audit);
    await broker.apply(s.f.call(s.f.request()));
    expect(s.execute).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(s.f.directory, 'benign-effect.txt'), 'utf8')).toBe('effect\neffect\n');
    const p = ports(sink.url, anchor.url);
    const head = await p.anchor.load(AbortSignal.timeout(2000));
    const page = await p.sink.read(s.a.genesis.claims, AbortSignal.timeout(2000));
    expect(head.claims.sequence).toBe(4);
    verifyOrganizationAudit(page.entries, s.a.genesis, head, s.a.signer.publicKey, s.a.stream);
    expect(JSON.stringify(page)).not.toContain('SECRET_CANARY');
  });

  it('recovers an actual HTTP persistence/anchor gap without executing or releasing the held operation', async () => {
    const s = setup();
    let sink = await start({ ...s.sinkConfig, bootstrap: true });
    let anchor = await start({ ...s.anchorConfig, bootstrap: true });
    const configured = message(anchor.child, 'configured');
    anchor.child.send({ kind: 'reject-cas' });
    await configured;
    let audit = s.makeAudit(sink.url, anchor.url);
    const broker = s.makeBroker(audit);
    const request = s.f.request();
    await expect(broker.apply(s.f.call(request))).rejects.toThrow('outcome-unknown');
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.f.ledger.budgetState('global').held.tokens).toBe(10);
    broker.close();
    await stop(sink.child);
    await stop(anchor.child);
    sink = await start(s.sinkConfig);
    anchor = await start(s.anchorConfig);
    audit = s.makeAudit(sink.url, anchor.url);
    await expect(audit.record(organizationAuditEvent(s.f.request(), 'dispatch'))).rejects.toThrow(
      'policy-unavailable',
    );
    expect((await audit.recover()).sequence).toBe(1);
    const reopened = s.makeBroker(audit);
    await expect(reopened.apply(s.f.call({ ...request, nonce: 'fresh-proof' }))).rejects.toThrow(
      /outcome-unknown|operation-pending/,
    );
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.f.ledger.budgetState('global').held.tokens).toBe(10);
  });

  it('refuses a restored audit disk when the separate checkpoint disk retains newer history', async () => {
    const s = setup();
    let sink = await start({ ...s.sinkConfig, bootstrap: true });
    const anchor = await start({ ...s.anchorConfig, bootstrap: true });
    let audit = s.makeAudit(sink.url, anchor.url);
    await audit.record(organizationAuditEvent(s.f.request(), 'dispatch'));
    await stop(sink.child);
    const snapshot = join(s.f.directory, 'audit-earlier.sqlite');
    copyFileSync(s.sinkConfig.path, snapshot);
    sink = await start(s.sinkConfig);
    audit = s.makeAudit(sink.url, anchor.url);
    await audit.record(organizationAuditEvent(s.f.request(), 'complete'));
    await stop(sink.child);
    copyFileSync(snapshot, s.sinkConfig.path);
    sink = await start(s.sinkConfig);
    audit = s.makeAudit(sink.url, anchor.url);
    await expect(s.makeBroker(audit).apply(s.f.call(s.f.request()))).rejects.toThrow(
      'outcome-unknown',
    );
    expect(s.execute).not.toHaveBeenCalled();
    const p = ports(sink.url, anchor.url);
    expect((await p.anchor.load(AbortSignal.timeout(2000))).claims.sequence).toBe(2);
    expect(s.f.ledger.budgetState('global').held.tokens).toBe(10);
  });

  it('permits two concurrent broker effects through the same separate audit services', async () => {
    const s = setup();
    const sink = await start({ ...s.sinkConfig, bootstrap: true });
    const anchor = await start({ ...s.anchorConfig, bootstrap: true });
    const first = s.makeBroker(s.makeAudit(sink.url, anchor.url));
    const second = s.makeBroker(s.makeAudit(sink.url, anchor.url));
    await Promise.all([
      first.apply(s.f.call(s.f.request())),
      second.apply(s.f.call(s.f.request())),
    ]);
    expect(s.execute).toHaveBeenCalledTimes(2);
    expect(s.f.ledger.budgetState('global').held.tokens).toBe(0);
    const p = ports(sink.url, anchor.url);
    const retained = await p.anchor.load(AbortSignal.timeout(2000));
    const history = await p.sink.read(s.a.genesis.claims, AbortSignal.timeout(2000));
    expect(retained.claims.sequence).toBe(4);
    verifyOrganizationAudit(
      history.entries,
      s.a.genesis,
      retained,
      s.a.signer.publicKey,
      s.a.stream,
    );
  });
});

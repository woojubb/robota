import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  requestWorkspaceRootBroker,
  startWorkspaceRootBroker,
} from '../workspace-root-broker.js';
import { startTestBroker } from '../../__tests__/helpers/test-workspace-root-broker.js';

const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];
const children: ReturnType<typeof spawn>[] = [];

async function spawnBroker(endpoint: string): Promise<ReturnType<typeof spawn>> {
  const loader = new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url).href;
  const fixturePath = fileURLToPath(new URL('./fixtures/workspace-root-broker-server.mjs', import.meta.url));
  const child = spawn(process.execPath, ['--import', loader, '--conditions=product-source', fixturePath, endpoint], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  return await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => reject(new Error(`Broker child did not start: ${errors}`)), 5_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('READY\n')) {
        clearTimeout(timeout);
        resolve(child);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { errors += chunk.toString('utf8'); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Broker child exited ${code}: ${errors}`));
    });
  });
}

async function stopChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
    await once(child, 'exit');
  }
  children.splice(children.indexOf(child), 1);
}

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), 'robota-root-broker-'));
  roots.push(parent);
  const privateDirectory = join(parent, 'private');
  mkdirSync(privateDirectory, { mode: 0o700 });
  const first = join(parent, 'first');
  const second = join(parent, 'second');
  mkdirSync(first);
  mkdirSync(second);
  return { endpoint: join(privateDirectory, 'broker.sock'), privateDirectory, first, second, parent };
}

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => stopChild(child, 'SIGKILL')));
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform !== 'win32')('protected Windows root broker', () => {
  it('serves only the approved folder through a private native pipe', async () => {
    const f = fixture();
    const endpoint = `\\\\.\\pipe\\robota-root-${randomBytes(12).toString('hex')}`;
    writeFileSync(join(f.first, 'approved.txt'), 'A');
    writeFileSync(join(f.second, 'outside.txt'), 'B');
    servers.push(await startWorkspaceRootBroker(endpoint, f.privateDirectory));
    const pending = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root: f.first });
    expect(pending.status).toBe('prepared');
    if (pending.status !== 'prepared') return;
    const approved = await requestWorkspaceRootBroker(endpoint, {
      op: 'approve', candidate: pending.candidate, root: f.first,
    });
    expect(approved.status).toBe('trusted');
    if (approved.status !== 'trusted') return;
    expect(await requestWorkspaceRootBroker(endpoint, {
      op: 'list', lease: approved.lease, segments: [],
    })).toMatchObject({ status: 'entries', entries: [{ name: 'approved.txt', kind: 'file' }] });
    const parked = join(f.parent, 'parked');
    renameSync(f.first, parked);
    renameSync(f.second, f.first);
    expect(await requestWorkspaceRootBroker(endpoint, {
      op: 'read', lease: approved.lease, segments: ['outside.txt'], maxBytes: 8,
    })).toMatchObject({ status: 'refused', reason: 'root-changed' });
  });
});

describe.skipIf(process.platform === 'win32')('root broker custody', () => {
  it('serves an approved root only while the current name still opens that same object', async () => {
    const f = fixture();
    writeFileSync(join(f.first, 'approved.txt'), 'A');
    writeFileSync(join(f.second, 'outside.txt'), 'B');
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    const pending = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(pending.status).toBe('prepared');
    if (pending.status !== 'prepared') return;
    const approved = await requestWorkspaceRootBroker(f.endpoint, {
      op: 'approve', candidate: pending.candidate, root: f.first,
    });
    expect(approved.status).toBe('trusted');
    if (approved.status !== 'trusted') return;
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'list', lease: approved.lease, segments: [],
    })).toMatchObject({ status: 'entries', entries: [{ name: 'approved.txt', kind: 'file' }] });
    const parked = join(f.parent, 'parked');
    renameSync(f.first, parked);
    renameSync(f.second, f.first);
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'read', lease: approved.lease, segments: ['outside.txt'], maxBytes: 8,
    })).toMatchObject({ status: 'refused', reason: 'root-changed' });
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'inspect', root: f.first,
    })).toMatchObject({ status: 'stale/replaced' });
    renameSync(f.first, f.second);
    renameSync(parked, f.first);
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'read', lease: approved.lease, segments: ['approved.txt'], maxBytes: 8,
    })).toMatchObject({ status: 'bytes', content: Buffer.from('A').toString('base64') });
  });

  it('requires approval again after the broker restarts', async () => {
    const f = fixture();
    const first = await spawnBroker(f.endpoint);
    const pending = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(pending.status).toBe('prepared');
    if (pending.status !== 'prepared') return;
    const approved = await requestWorkspaceRootBroker(f.endpoint, {
      op: 'approve', candidate: pending.candidate, root: f.first,
    });
    expect(approved.status).toBe('trusted');
    await stopChild(first, 'SIGKILL');
    await spawnBroker(f.endpoint);
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'inspect', root: f.first,
    })).toMatchObject({ status: 'untrusted' });
  });

  it('revokes the held folder through its new name after a rename', async () => {
    const f = fixture();
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    const prepared = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') return;
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'approve', candidate: prepared.candidate, root: f.first,
    })).toMatchObject({ status: 'trusted' });
    const moved = join(f.parent, 'moved');
    renameSync(f.first, moved);
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'inspect', root: moved }))
      .toMatchObject({ status: 'trusted' });
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'revoke', root: moved }))
      .toMatchObject({ status: 'revoked' });
    renameSync(moved, f.first);
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'inspect', root: f.first }))
      .toMatchObject({ status: 'revoked' });
  });

  it('compares two live prepared roots and keeps B refused after A returns to its pathname', async () => {
    const f = fixture();
    servers.push(await startWorkspaceRootBroker(f.endpoint));

    const [approved, alias] = await Promise.all([
      requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first }),
      requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first }),
    ]);
    expect(approved.status).toBe('prepared');
    expect(alias.status).toBe('prepared');
    if (approved.status !== 'prepared' || alias.status !== 'prepared') return;
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'compare', left: approved.candidate, right: alias.candidate,
    })).toMatchObject({ status: 'same' });

    const parked = join(f.parent, 'parked');
    renameSync(f.first, parked);
    renameSync(f.second, f.first);
    const substituted = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(substituted.status).toBe('prepared');
    renameSync(f.first, f.second);
    renameSync(parked, f.first);
    if (substituted.status !== 'prepared') return;
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'compare', left: approved.candidate, right: substituted.candidate,
    })).toMatchObject({ status: 'refused', reason: 'different-root' });
  });

  it('refuses stale candidates, unknown versions, and a second owner of the same endpoint', async () => {
    const f = fixture();
    const server = await startWorkspaceRootBroker(f.endpoint);
    servers.push(server);
    await expect(startWorkspaceRootBroker(f.endpoint)).rejects.toThrow();
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'ping' }))
      .toEqual({ status: 'ready', pid: process.pid });
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'ping' }, 999))
      .toMatchObject({ status: 'refused', reason: 'version' });
    const prepared = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') return;
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'release', candidate: prepared.candidate,
    })).toMatchObject({ status: 'released' });
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'compare', left: prepared.candidate, right: prepared.candidate,
    })).toMatchObject({ status: 'refused', reason: 'unknown-candidate' });

    await server.close();
    servers.splice(servers.indexOf(server), 1);
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'compare', left: prepared.candidate, right: prepared.candidate,
    })).toMatchObject({ status: 'refused', reason: 'unknown-candidate' });
  });

  it('closes an oversized frame without processing a request', async () => {
    const f = fixture();
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    const outcome = await new Promise<string>((resolve, reject) => {
      const socket = createConnection(f.endpoint);
      let received = '';
      socket.on('connect', () => socket.write(`${'x'.repeat(6 * 1_024 * 1_024 + 1)}\n`));
      socket.on('data', (chunk: Buffer) => { received += chunk.toString('utf8'); });
      socket.on('end', () => resolve(received));
      socket.on('error', reject);
    });
    expect(JSON.parse(outcome)).toMatchObject({ status: 'refused', reason: 'frame-size' });
  });

  it('refuses a non-private endpoint directory and an unsupported filesystem profile', async () => {
    const f = fixture();
    const exposed = join(f.parent, 'exposed');
    mkdirSync(exposed, { mode: 0o755 });
    await expect(startWorkspaceRootBroker(join(exposed, 'broker.sock'))).rejects.toThrow('owner-private');
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    const unsupported = process.platform === 'linux' ? '/proc' : '/dev';
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'prepare', root: unsupported,
    })).toMatchObject({ status: 'refused', reason: 'root-unavailable' });
  });

  it('restarts after a broker process crash without reviving its prepared roots', async () => {
    const f = fixture();
    const first = await spawnBroker(f.endpoint);
    const prepared = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    expect(prepared.status).toBe('prepared');
    if (prepared.status !== 'prepared') return;
    await stopChild(first, 'SIGKILL');

    const restarted = await spawnBroker(f.endpoint);
    expect(restarted.pid).not.toBe(first.pid);
    expect(await requestWorkspaceRootBroker(f.endpoint, {
      op: 'compare', left: prepared.candidate, right: prepared.candidate,
    })).toMatchObject({ status: 'refused', reason: 'unknown-candidate' });
  });
});

describe.skipIf(process.platform !== 'linux')('root broker checkpoint writer leases', () => {
  async function approvedRoot() {
    const f = fixture();
    servers.push(await startWorkspaceRootBroker(f.endpoint));
    const pending = await requestWorkspaceRootBroker(f.endpoint, { op: 'prepare', root: f.first });
    if (pending.status !== 'prepared') throw new Error('expected a prepared root');
    const approved = await requestWorkspaceRootBroker(f.endpoint, {
      op: 'approve', candidate: pending.candidate, root: f.first,
    });
    if (approved.status !== 'trusted') throw new Error('expected a trusted root');
    return { ...f, lease: approved.lease };
  }
  const claim = (f: { endpoint: string; lease: string }, relativePath: string) =>
    requestWorkspaceRootBroker(f.endpoint, {
      op: 'mutate', lease: f.lease, operationId: randomUUID(), method: 'claimDirectory', relativePath,
    });
  const acquire = (f: { endpoint: string; lease: string }, relativePath: string, owner = process.pid) =>
    requestWorkspaceRootBroker(f.endpoint, { op: 'acquireWriter', lease: f.lease, relativePath, owner });
  const holds = (f: { endpoint: string }, writerLease: string) =>
    requestWorkspaceRootBroker(f.endpoint, { op: 'writerLeaseHolds', writerLease });
  const release = (f: { endpoint: string }, writerLease: string) =>
    requestWorkspaceRootBroker(f.endpoint, { op: 'writerLeaseRelease', writerLease });

  it('claims a directory once and reports a later claim as already taken', async () => {
    const f = await approvedRoot();
    expect(await claim(f, 'checkpoints/one')).toMatchObject({ status: 'mutation', value: true });
    expect(await claim(f, 'checkpoints/one')).toMatchObject({ status: 'mutation', value: false });
    expect(existsSync(join(f.first, 'checkpoints', 'one'))).toBe(true);
  });

  it('grants one live lease per directory and a new one after release', async () => {
    const f = await approvedRoot();
    const first = await acquire(f, 'session_1/.writer');
    expect(first.status).toBe('writerLease');
    if (first.status !== 'writerLease') return;
    expect(await holds(f, first.writerLease)).toMatchObject({ status: 'mutation', value: true });
    expect(await acquire(f, 'session_1/.writer')).toMatchObject({ status: 'missing' });
    expect(await acquire(f, 'session_2/.writer')).toMatchObject({ status: 'writerLease' });

    expect(await release(f, first.writerLease)).toMatchObject({ status: 'released' });
    expect(await holds(f, first.writerLease)).toMatchObject({ status: 'mutation', value: false });
    expect(await release(f, first.writerLease)).toMatchObject({ status: 'released' });
    expect(await acquire(f, 'session_1/.writer')).toMatchObject({ status: 'writerLease' });
  });

  it('refuses a lease for a trust lease the broker does not hold', async () => {
    const f = await approvedRoot();
    expect(await acquire({ ...f, lease: randomUUID() }, 'session_1/.writer'))
      .toMatchObject({ status: 'refused', reason: 'unknown-lease' });
  });

  it('ends the leases of a trust lease when that trust is revoked', async () => {
    const f = await approvedRoot();
    const lease = await acquire(f, 'session_1/.writer');
    if (lease.status !== 'writerLease') throw new Error('expected a lease');
    expect(await requestWorkspaceRootBroker(f.endpoint, { op: 'revoke', root: f.first }))
      .toMatchObject({ status: 'revoked' });
    expect(await holds(f, lease.writerLease)).toMatchObject({ status: 'mutation', value: false });
  });

  it('releases the lease of a client process that is gone, and keeps one whose client runs', async () => {
    const f = await approvedRoot();
    const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await once(gone, 'exit');
    const orphaned = await acquire(f, 'session_1/.writer', gone.pid!);
    const running = await acquire(f, 'session_2/.writer');
    if (orphaned.status !== 'writerLease' || running.status !== 'writerLease') {
      throw new Error('expected two leases');
    }
    await vi.waitFor(
      async () => expect(await holds(f, orphaned.writerLease)).toMatchObject({ value: false }),
      { timeout: 10_000, interval: 200 },
    );
    expect(await holds(f, running.writerLease)).toMatchObject({ status: 'mutation', value: true });
    expect(await acquire(f, 'session_1/.writer')).toMatchObject({ status: 'writerLease' });
  });
});

describe('root broker lifetime', () => {
  function owned() {
    const f = fixture();
    const endpoint = process.platform === 'win32'
      ? `\\\\.\\pipe\\robota-root-${randomBytes(12).toString('hex')}` : f.endpoint;
    const state = join(f.parent, 'state');
    return { ...f, endpoint, state, history: join(state, 'workspace-trust.json') };
  }
  const answers = (endpoint: string) => requestWorkspaceRootBroker(endpoint, { op: 'ping' });
  const stopped = (endpoint: string) => vi.waitFor(
    () => expect(answers(endpoint)).rejects.toThrow(),
    { timeout: 10_000, interval: 100 },
  );

  it('serves while its user-state root remains and closes once that root is removed', async () => {
    const f = owned();
    servers.push(await startWorkspaceRootBroker(f.endpoint, f.privateDirectory, f.history));
    expect(existsSync(f.state)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(await answers(f.endpoint)).toMatchObject({ status: 'ready' });

    rmSync(f.state, { recursive: true, force: true });
    await stopped(f.endpoint);
  });

  it('closes once its user-state root is replaced by another directory of the same name', async () => {
    const f = owned();
    servers.push(await startWorkspaceRootBroker(f.endpoint, f.privateDirectory, f.history));
    rmSync(f.state, { recursive: true, force: true });
    mkdirSync(f.state);
    await stopped(f.endpoint);
  });

  it('ends the broker process once its user-state root is removed', async () => {
    const f = owned();
    const broker = await startTestBroker(f.endpoint, f.privateDirectory, f.history);
    servers.push(broker);
    rmSync(f.state, { recursive: true, force: true });
    await expect(broker.exited).resolves.toBeUndefined();
  }, 30_000);
});

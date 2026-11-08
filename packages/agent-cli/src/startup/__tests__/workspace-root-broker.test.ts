import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  requestWorkspaceRootBroker,
  startWorkspaceRootBroker,
} from '../workspace-root-broker.js';

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

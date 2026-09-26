/**
 * Files between two sessions on one host, over real sockets, each session with its own `HOME`: what
 * one sends arrives only with the receiving operator's yes, only as a verified copy kept aside under
 * the receiver's `~/.robota`, and never over anything already there.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  startLocalPeerMessaging,
  type IPeerMessaging,
} from '../../remote-control/local-peer-messaging.js';
import { peerSocketPath } from '../../remote-control/local-peer-channel.js';
import { prepareOutgoingFile, type IOutgoingFile } from '../outgoing-file.js';
import { openQuarantineSink, quarantineTarget, sanitizeReceivedFileName } from '../quarantine.js';

import type {
  ICapabilityApprovalRequest,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

let scratch: string;
let guardedDirectory: string;
let homeA: string;
let homeB: string;
let workspace: string;
const open: IPeerMessaging[] = [];

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-files-')));
  guardedDirectory = path.join(scratch, 'rendezvous');
  mkdirSync(guardedDirectory, { mode: 0o700 });
  homeA = path.join(scratch, 'home-a');
  homeB = path.join(scratch, 'home-b');
  workspace = path.join(homeA, 'project');
  mkdirSync(workspace, { recursive: true });
});

afterEach(async () => {
  for (const messaging of open.splice(0)) await messaging.close();
  rmSync(scratch, { recursive: true, force: true });
});

function operator(answer: boolean): IOperatorApprover & { asked: ICapabilityApprovalRequest[] } {
  const asked: ICapabilityApprovalRequest[] = [];
  return {
    asked,
    approve: async (request) => {
      asked.push(request);
      return answer;
    },
  };
}

const alive = () => [
  { sessionId: 'A', liveness: 'alive' as const },
  { sessionId: 'B', liveness: 'alive' as const },
];

const noIngress = {
  receive: async () => ({ ack: { id: '', sequence: 0, state: 'refused' as const } }),
};

async function sessions(
  approver: IOperatorApprover | undefined,
  maxBytes?: number,
): Promise<{ a: IPeerMessaging; b: IPeerMessaging; reports: string[] }> {
  const reports: string[] = [];
  const b = await startLocalPeerMessaging({
    guardedDirectory,
    sessionId: 'B',
    ingress: noIngress,
    list: alive,
    report: (message) => reports.push(message),
    files: {
      root: path.join(homeB, '.robota'),
      ...(approver !== undefined ? { approver } : {}),
      ...(maxBytes !== undefined ? { maxBytes } : {}),
    },
  });
  const a = await startLocalPeerMessaging({
    guardedDirectory,
    sessionId: 'A',
    ingress: noIngress,
    list: alive,
  });
  open.push(a, b);
  return { a, b, reports };
}

async function prepared(name: string, content: string): Promise<IOutgoingFile> {
  const file = path.join(workspace, name);
  writeFileSync(file, content);
  const result = await prepareOutgoingFile({
    path: file,
    cwd: workspace,
    home: homeA,
    origin: 'operator',
    maxBytes: 1024 * 1024,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.file;
}

const quarantine = (): string => path.join(homeB, '.robota', 'peer-files', 'local-A');

describe('file transfer between two sessions on one host', () => {
  it('delivers a verified copy into the receiver quarantine, and says only name, size and hash', async () => {
    const approver = operator(true);
    const { a, reports } = await sessions(approver);
    const content = 'hello from A\n'.repeat(5_000);
    const file = await prepared('notes.txt', content);

    await expect(a.sendFile('B', file)).resolves.toEqual({ state: 'delivered' });

    const kept = path.join(quarantine(), 'notes.txt');
    expect(readFileSync(kept, 'utf8')).toBe(content);
    // Kept inert: readable by this user only, never executable.
    expect(statSync(kept).mode & 0o777).toBe(0o600);
    expect(approver.asked).toHaveLength(1);
    expect(approver.asked[0]).toMatchObject({
      capability: 'file',
      scope: 'request',
      locality: 'same-host',
    });
    const sha256 = createHash('sha256').update(content).digest('hex');
    expect(approver.asked[0]?.summary).toContain(sha256);
    await expect.poll(() => reports.length).toBe(1);
    expect(reports[0]).toContain(`notes.txt, ${content.length} bytes, sha256 ${sha256}`);
    expect(reports[0]).not.toContain('hello from A');
    // Nothing but the kept file is left: no partial content under any name.
    expect(readdirSync(quarantine())).toEqual(['notes.txt']);
  });

  it('refuses a transfer the receiving operator did not approve, and keeps nothing', async () => {
    const { a } = await sessions(operator(false));
    const result = await a.sendFile('B', await prepared('notes.txt', 'x'));
    expect(result.state).toBe('refused');
    expect(readdirSync(quarantine())).toEqual([]);
  });

  it('refuses every transfer when there is nobody to approve it', async () => {
    const { a } = await sessions(undefined);
    const result = await a.sendFile('B', await prepared('notes.txt', 'x'));
    expect(result.state).toBe('refused');
  });

  it('refuses a transfer over the size limit without asking', async () => {
    const approver = operator(true);
    const { a } = await sessions(approver, 10);
    const result = await a.sendFile('B', await prepared('big.bin', 'x'.repeat(11)));
    expect(result).toMatchObject({ state: 'refused' });
    expect(result.reason).toMatch(/size limit/);
    expect(approver.asked).toHaveLength(0);
  });

  it('never overwrites a file already received', async () => {
    const { a } = await sessions(operator(true));
    await expect(a.sendFile('B', await prepared('notes.txt', 'first'))).resolves.toEqual({
      state: 'delivered',
    });
    const again = await a.sendFile('B', await prepared('notes.txt', 'second'));
    expect(again.state).toBe('refused');
    expect(readFileSync(path.join(quarantine(), 'notes.txt'), 'utf8')).toBe('first');
  });

  it('refuses a name that would leave the quarantine', async () => {
    const approver = operator(true);
    const { a } = await sessions(approver);
    const file = await prepared('notes.txt', 'escape');
    const result = await a.sendFile('B', { ...file, name: '../../escaped.txt' });
    expect(result.state).toBe('refused');
    expect(result.reason).toMatch(/name/);
    expect(approver.asked).toHaveLength(0);
    for (const where of [homeB, path.join(homeB, '.robota'), scratch]) {
      expect(existsSync(path.join(where, 'escaped.txt'))).toBe(false);
    }
  });

  it('never writes through a symbolic link planted at the name', async () => {
    const { a } = await sessions(operator(true));
    const victim = path.join(scratch, 'victim.txt');
    writeFileSync(victim, 'untouched');
    mkdirSync(quarantine(), { recursive: true, mode: 0o700 });
    symlinkSync(victim, path.join(quarantine(), 'notes.txt'));

    const result = await a.sendFile('B', await prepared('notes.txt', 'overwrite?'));

    expect(result.state).toBe('refused');
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
  });

  it('refuses to write when the quarantine directory is a symbolic link', async () => {
    const { a } = await sessions(operator(true));
    const elsewhere = path.join(scratch, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    mkdirSync(path.join(homeB, '.robota', 'peer-files'), { recursive: true, mode: 0o700 });
    symlinkSync(elsewhere, quarantine());

    const result = await a.sendFile('B', await prepared('notes.txt', 'redirected?'));

    expect(result.state).toBe('refused');
    expect(readdirSync(elsewhere)).toEqual([]);
  });

  it('refuses a file from a session that does not confirm sending it', async () => {
    const approver = operator(true);
    await sessions(approver);
    const offer = JSON.stringify({
      t: 'file-offer',
      transferId: 'forged',
      name: 'forged.txt',
      size: 1,
      sha256: createHash('sha256').update('x').digest('hex'),
    });
    const socket = connect(peerSocketPath(guardedDirectory, 'B'));
    socket.write(`${JSON.stringify({ file: { from: 'A', offer } })}\n`);
    const reply = await new Promise<string>((resolve) => {
      let text = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => (text += chunk));
      socket.on('close', () => resolve(text));
    });
    expect(reply).toContain('file-refuse');
    expect(approver.asked).toHaveLength(0);
  });
});

describe('what may be sent', () => {
  const prepare = (file: string, origin: 'operator' | 'model') =>
    prepareOutgoingFile({ path: file, cwd: workspace, home: homeA, origin, maxBytes: 1024 });

  it('lets the model send a workspace file', async () => {
    writeFileSync(path.join(workspace, 'report.md'), '# ok');
    await expect(prepare('report.md', 'model')).resolves.toMatchObject({
      ok: true,
      file: { name: 'report.md', size: 4 },
    });
  });

  it('keeps files outside the workspace to the operator command', async () => {
    const outside = path.join(homeA, 'outside.txt');
    writeFileSync(outside, 'x');
    const byModel = await prepare(outside, 'model');
    expect(byModel.ok).toBe(false);
    expect(byModel.ok ? '' : byModel.reason).toMatch(/\/peers send-file/);
    await expect(prepare(outside, 'operator')).resolves.toMatchObject({ ok: true });
  });

  it('judges a link inside the workspace by where it points', async () => {
    const outside = path.join(homeA, 'outside.txt');
    writeFileSync(outside, 'x');
    symlinkSync(outside, path.join(workspace, 'inside-looking.txt'));
    await expect(prepare('inside-looking.txt', 'model')).resolves.toMatchObject({ ok: false });
  });

  it.each(['.env', '.env.local', 'id_ed25519', 'server.pem', '.ssh/config', '.aws/credentials'])(
    'keeps the secret-looking %s to the operator command',
    async (name) => {
      const file = path.join(workspace, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'secret');
      await expect(prepare(name, 'model')).resolves.toMatchObject({ ok: false });
      await expect(prepare(name, 'operator')).resolves.toMatchObject({ ok: true });
    },
  );

  it('refuses a file over the size limit for anyone', async () => {
    writeFileSync(path.join(workspace, 'big.bin'), Buffer.alloc(2048));
    await expect(prepare('big.bin', 'operator')).resolves.toMatchObject({ ok: false });
  });
});

describe('keeping a received file', () => {
  it('does not take a name that something claimed while the content arrived', async () => {
    const root = path.join(homeB, '.robota');
    const target = await quarantineTarget({ root, senderId: 'local-A', name: 'late.txt' });
    if (!('ok' in target)) throw new Error('expected a target');
    const sink = await openQuarantineSink(target);
    await sink.write(Buffer.from('received'));
    const victim = path.join(scratch, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, target.file);

    await expect(sink.commit()).rejects.toThrow();

    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(readdirSync(target.directory)).toEqual(['late.txt']);
  });
});

describe('received file names', () => {
  it.each([
    ['notes.txt', 'notes.txt'],
    ['.bashrc', '_.bashrc'],
    ['a\u001b[31mred', 'a[31mred'],
    ['../escape', undefined],
    ['dir/file', undefined],
    ['dir\\file', undefined],
    ['..', undefined],
    ['', undefined],
    ['x'.repeat(300), undefined],
  ])('%j is kept as %j', (raw, kept) => {
    expect(sanitizeReceivedFileName(raw)).toBe(kept);
  });
});

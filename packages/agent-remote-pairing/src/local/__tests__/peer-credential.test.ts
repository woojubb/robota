import { chmodSync, mkdtempSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  admitLocalPeerDirectory,
  admitLocalPeerSocket,
  refuseLocalPeer,
} from '../peer-credential.js';

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function guardedDir(mode = 0o700): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sec-010-'));
  scratch.push(dir);
  chmodSync(dir, mode);
  return dir;
}

const UID = process.getuid?.() ?? 0;

describe('SEC-010 — the evidence is what the kernel enforces, not what the peer presents', () => {
  it('admits a directory this user owns that no other account can traverse', () => {
    const dir = guardedDir(0o700);

    const admission = admitLocalPeerDirectory(dir, { expectedUid: UID });

    expect(admission.admitted).toBe(true);
    expect(admission.trust).toBe('same-user-same-host');
    expect(admission.binding?.ownerUid).toBe(UID);
  });

  it('refuses a directory another account can enter — the whole proof is that they cannot', () => {
    // 0o755 is the ordinary, harmless-looking mode that silently destroys the guarantee: every
    // account on the host can now traverse to the socket, so reaching it proves nothing.
    const dir = guardedDir(0o755);

    const admission = admitLocalPeerDirectory(dir, { expectedUid: UID });

    expect(admission.admitted).toBe(false);
    expect(admission.trust).toBe('unproven');
    expect(admission.reason).toMatch(/group or other access/);
  });

  it('refuses group-readable as well as world-readable', () => {
    expect(admitLocalPeerDirectory(guardedDir(0o750), { expectedUid: UID }).admitted).toBe(false);
    expect(admitLocalPeerDirectory(guardedDir(0o701), { expectedUid: UID }).admitted).toBe(false);
  });

  it('refuses a directory owned by another uid', () => {
    const dir = guardedDir(0o700);

    // The uid is injected rather than spoofed: the decision under test is the comparison, and a
    // test that needed a second real account could not run anywhere.
    const admission = admitLocalPeerDirectory(dir, { expectedUid: UID + 1 });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/belongs to uid/);
  });

  it('refuses a symbolic link, because a link can be repointed after it is checked', () => {
    const real = guardedDir(0o700);
    const holder = guardedDir(0o700);
    const link = path.join(holder, 'link');
    symlinkSync(real, link);

    // Resolution happens first and the link check second, so a swap between the two reads cannot
    // slip past. `resolve` is stubbed to identity to exercise that ordering directly.
    const admission = admitLocalPeerDirectory(link, {
      expectedUid: UID,
      resolve: (target) => target,
    });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/symbolic link/);
  });

  it('refuses a path that is not a directory', () => {
    const dir = guardedDir(0o700);
    const file = path.join(dir, 'not-a-dir');
    writeFileSync(file, '');

    const admission = admitLocalPeerDirectory(file, { expectedUid: UID });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/not a directory/);
  });

  it('refuses an unresolvable path rather than passing it', () => {
    const admission = admitLocalPeerDirectory('/no/such/rendezvous', { expectedUid: UID });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/could not be resolved/);
  });

  it('refuses when the directory cannot be inspected — a guard that cannot read must not admit', () => {
    const admission = admitLocalPeerDirectory('/tmp', {
      expectedUid: UID,
      resolve: (target) => target,
      statAt: () => {
        throw new Error('EACCES');
      },
    });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/could not be inspected/);
  });

  it('never carries a binding on a refusal', () => {
    // The type permits it, so the invariant is asserted: a refusal must not hand back evidence a
    // caller could read as a guarantee.
    expect(refuseLocalPeer('any reason').binding).toBeUndefined();
    expect(
      admitLocalPeerDirectory(guardedDir(0o755), { expectedUid: UID }).binding,
    ).toBeUndefined();
  });
});

describe('SEC-010 — the socket must be inside the directory that vouches for it', () => {
  it('admits a socket path inside the guarded directory, before the socket exists', () => {
    // Bind time is the ordinary case: the guarantee is the directory, and the file is not there yet.
    const dir = guardedDir(0o700);

    const admission = admitLocalPeerSocket(path.join(dir, 'peer.sock'), { expectedUid: UID });

    expect(admission.admitted).toBe(true);
    expect(admission.binding?.socketPath).toBe(path.join(dir, 'peer.sock'));
  });

  it('admits a real, listening socket inside the guarded directory', async () => {
    // The end-to-end shape: a socket that actually exists and accepts a local connection.
    const dir = guardedDir(0o700);
    const socketPath = path.join(dir, 'live.sock');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const admission = admitLocalPeerSocket(socketPath, { expectedUid: UID });
    const connected = await new Promise<boolean>((resolve) => {
      const client = net.connect(socketPath, () => {
        client.end();
        resolve(true);
      });
      client.on('error', () => resolve(false));
    });
    server.close();

    expect(admission.admitted).toBe(true);
    expect(connected).toBe(true);
  });

  it('refuses a socket that resolves OUTSIDE the guarded directory', () => {
    // Not redundant with the directory check: without containment, a caller could pass a valid
    // directory and a path elsewhere, and the result would assert a guarantee about a different file.
    const elsewhere = guardedDir(0o700);
    const escaping = path.join(elsewhere, 'peer.sock');

    const admission = admitLocalPeerSocket(escaping, {
      expectedUid: UID,
      // Directory validation passes; the socket then resolves somewhere else entirely.
      resolve: (target) => (target === escaping ? '/tmp/other.sock' : target),
    });

    expect(admission.admitted).toBe(false);
    expect(admission.reason).toMatch(/outside the guarded directory/);
  });

  it('a socket in a world-traversable directory is refused however real it is', async () => {
    const dir = guardedDir(0o755);
    const socketPath = path.join(dir, 'open.sock');
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const admission = admitLocalPeerSocket(socketPath, { expectedUid: UID });
    server.close();

    // It listens, it accepts, and it proves nothing — which is exactly the confusion this item
    // exists to remove.
    expect(admission.admitted).toBe(false);
  });
});

describe('SEC-010 — what this does NOT prove', () => {
  it('cannot distinguish two processes of the SAME user, and does not claim to', () => {
    // The documented trust limit. Both admissions succeed because both processes are this user —
    // the boundary is the account, not the process, and a caller must not read it as more.
    const dir = guardedDir(0o700);
    const first = admitLocalPeerDirectory(dir, { expectedUid: UID });
    const second = admitLocalPeerDirectory(dir, { expectedUid: UID });

    expect(first.trust).toBe('same-user-same-host');
    expect(second.trust).toBe('same-user-same-host');
    expect(first.binding?.ownerUid).toBe(second.binding?.ownerUid);
  });

  it('the trust vocabulary is closed, so a consumer cannot collapse it to a boolean by accident', () => {
    const refused = admitLocalPeerDirectory(guardedDir(0o755), { expectedUid: UID });

    expect(refused.trust).toBe('unproven');
    expect(['same-user-same-host', 'unproven']).toContain(refused.trust);
  });
});

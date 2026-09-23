import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadOrCreateHostIdentity } from '../host-identity.js';

/**
 * REMOTE-012 E3 — the host identity is the stationary trust anchor every trusted device pins. Minting a
 * SECOND identity (or clobbering the persisted one) silently invalidates every pin and forces a re-pair,
 * so first-run creation must be atomic and a lost race must ADOPT the winner rather than overwrite it.
 */

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'host-identity-')));
  filePath = path.join(dir, 'nested', 'remote-host-identity.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadOrCreateHostIdentity', () => {
  it('generates, persists, and reloads the same identity', async () => {
    const created = await loadOrCreateHostIdentity(filePath);
    const reloaded = await loadOrCreateHostIdentity(filePath);

    expect(created.hostIdentityId).toMatch(/\S/);
    expect(reloaded.hostIdentityId).toBe(created.hostIdentityId);
    expect(reloaded.publicKeySpki).toBe(created.publicKeySpki);
  });

  it('persists the private key file as 0600', async () => {
    await loadOrCreateHostIdentity(filePath);
    // eslint-disable-next-line no-bitwise
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('concurrent first runs converge on one identity instead of discarding the winner', async () => {
    const [first, second] = await Promise.all([
      loadOrCreateHostIdentity(filePath),
      loadOrCreateHostIdentity(filePath),
    ]);

    expect(second.hostIdentityId).toBe(first.hostIdentityId);
    expect(second.publicKeySpki).toBe(first.publicKeySpki);
  });

  it('the persisted file matches the identity every caller received', async () => {
    const [first, second] = await Promise.all([
      loadOrCreateHostIdentity(filePath),
      loadOrCreateHostIdentity(filePath),
    ]);
    const onDisk = await loadOrCreateHostIdentity(filePath);

    expect(onDisk.hostIdentityId).toBe(first.hostIdentityId);
    expect(onDisk.hostIdentityId).toBe(second.hostIdentityId);
  });

  it('still fails fast on a corrupt file rather than minting a new identity', async () => {
    await loadOrCreateHostIdentity(filePath);
    writeFileSync(filePath, '{ not json', 'utf8');

    await expect(loadOrCreateHostIdentity(filePath)).rejects.toThrow(/corrupt/);
  });

  it('still fails fast on an unexpected file shape', async () => {
    await loadOrCreateHostIdentity(filePath);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version: number };
    parsed.version = 2;
    writeFileSync(filePath, JSON.stringify(parsed), 'utf8');

    await expect(loadOrCreateHostIdentity(filePath)).rejects.toThrow(/unexpected shape/);
  });
});

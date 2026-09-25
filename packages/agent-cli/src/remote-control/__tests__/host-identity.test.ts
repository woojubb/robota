import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  exportKeyPairJwk,
  exportPublicKey,
  generateIdentityKeyPair,
} from '@robota-sdk/agent-remote-pairing';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createKeychainCredentialStore } from '../../credentials/keychain-credential-store.js';
import { createFakeKeyring } from '../../credentials/__tests__/fake-keyring.js';
import { HOST_IDENTITY_CREDENTIAL_KEY, loadOrCreateHostIdentity } from '../host-identity.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

/**
 * REMOTE-012 E3 — the host identity is the stationary trust anchor every trusted device pins. Minting a
 * SECOND identity (or clobbering the stored one) silently invalidates every pin and forces a re-pair, so
 * first-run creation must converge on one key and a malformed stored key must fail fast.
 *
 * The key lives in the credential store. A key from before the store existed sat in a plain file that
 * backups or dotfile sync may have copied, so it is never carried over: a new key replaces it and the
 * operator is told, once, that trusted devices must pair again.
 */

let root: string;
let lockPath: string;
let legacyFilePath: string;
let store: ICredentialStore;

beforeEach(() => {
  root = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), 'host-identity-'))), '.robota');
  lockPath = path.join(root, 'remote-host-identity.lock');
  legacyFilePath = path.join(root, 'remote-host-identity.json');
  store = createFileCredentialStore(path.join(root, 'credentials'), { withinRoot: root });
});

afterEach(() => {
  rmSync(path.join(root, '..'), { recursive: true, force: true });
});

async function writeLegacyIdentity(): Promise<string> {
  const keyPair = await generateIdentityKeyPair(true);
  const file = { version: 1, keyPair: await exportKeyPairJwk(keyPair) };
  const { mkdirSync } = await import('node:fs');
  mkdirSync(root, { recursive: true });
  writeFileSync(legacyFilePath, JSON.stringify(file), { mode: 0o600 });
  return exportPublicKey(keyPair.publicKey);
}

describe('loadOrCreateHostIdentity', () => {
  it('generates the key into the credential store and reloads the same identity', async () => {
    const created = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath });
    const reloaded = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath });

    expect(created.hostIdentityId).toMatch(/\S/);
    expect(reloaded.hostIdentityId).toBe(created.hostIdentityId);
    expect(reloaded.publicKeySpki).toBe(created.publicKeySpki);
    expect(await store.get(HOST_IDENTITY_CREDENTIAL_KEY)).toBeDefined();
    expect(existsSync(legacyFilePath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('concurrent first runs converge on one identity instead of discarding the winner', async () => {
    const other = createFileCredentialStore(path.join(root, 'credentials'), { withinRoot: root });
    const [first, second] = await Promise.all([
      loadOrCreateHostIdentity({ store, lockPath, legacyFilePath }),
      loadOrCreateHostIdentity({ store: other, lockPath, legacyFilePath }),
    ]);
    const stored = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath });

    expect(second.hostIdentityId).toBe(first.hostIdentityId);
    expect(stored.hostIdentityId).toBe(first.hostIdentityId);
  });

  it('refuses a key the store accepted but did not keep, rather than using an unpinnable identity', async () => {
    const { module, controls } = createFakeKeyring();
    controls.dropWrites = true;
    await expect(
      loadOrCreateHostIdentity({
        store: createKeychainCredentialStore(module),
        lockPath,
        legacyFilePath,
      }),
    ).rejects.toThrow(/robota\.remote-control\/host-identity/);
  });

  it('still fails fast on a corrupt stored key rather than minting a new identity, without quoting it', async () => {
    await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath });
    await store.set(HOST_IDENTITY_CREDENTIAL_KEY, '{ "d": "PRIVATE-SCALAR"');

    const error = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath }).then(
      () => undefined,
      (caught: unknown) => caught as Error,
    );
    expect(error?.message).toMatch(/corrupt/);
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
      'PRIVATE-SCALAR',
    );
    expect(error?.cause).toBeUndefined();
  });

  it('still fails fast on an unexpected stored shape', async () => {
    await store.set(HOST_IDENTITY_CREDENTIAL_KEY, JSON.stringify({ version: 2, keyPair: {} }));
    await expect(loadOrCreateHostIdentity({ store, lockPath, legacyFilePath })).rejects.toThrow(
      /unexpected shape/,
    );
  });
});

describe('moving the host identity out of the legacy plain file', () => {
  it('generates a new key, stores it, removes the old file and tells the operator once', async () => {
    const legacyPublicKey = await writeLegacyIdentity();
    const notices: string[] = [];
    const notify = (message: string): void => {
      notices.push(message);
    };

    const migrated = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath, notify });

    expect(migrated.publicKeySpki).not.toBe(legacyPublicKey);
    expect(existsSync(legacyFilePath)).toBe(false);
    expect(await store.get(HOST_IDENTITY_CREDENTIAL_KEY)).toBeDefined();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/pair again/i);
    expect(notices[0]).not.toMatch(/"d"|privateJwk/);

    const again = await loadOrCreateHostIdentity({ store, lockPath, legacyFilePath, notify });
    expect(again.hostIdentityId).toBe(migrated.hostIdentityId);
    expect(notices).toHaveLength(1);
  });

  it('retires a legacy file it cannot even parse — its content is never read', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(root, { recursive: true });
    writeFileSync(legacyFilePath, '{ not json');
    const notices: string[] = [];

    await loadOrCreateHostIdentity({
      store,
      lockPath,
      legacyFilePath,
      notify: (message) => notices.push(message),
    });

    expect(existsSync(legacyFilePath)).toBe(false);
    expect(notices).toHaveLength(1);
  });

  it('says nothing when there was no legacy file', async () => {
    const notices: string[] = [];
    await loadOrCreateHostIdentity({
      store,
      lockPath,
      legacyFilePath,
      notify: (message) => notices.push(message),
    });
    expect(notices).toEqual([]);
  });

  it('two processes migrating at once tell the operator once between them', async () => {
    await writeLegacyIdentity();
    const notices: string[] = [];
    const notify = (message: string): void => {
      notices.push(message);
    };
    const [first, second] = await Promise.all([
      loadOrCreateHostIdentity({ store, lockPath, legacyFilePath, notify }),
      loadOrCreateHostIdentity({ store, lockPath, legacyFilePath, notify }),
    ]);
    expect(second.hostIdentityId).toBe(first.hostIdentityId);
    expect(notices).toHaveLength(1);
  });
});

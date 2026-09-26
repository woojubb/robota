/**
 * Host identity keypair for TOFU trusted-device reconnect (REMOTE-012 Stage E3).
 *
 * The host is the stationary trust anchor: it must reload and sign reconnect challenges across process
 * restarts, so — unlike the browser device key (non-extractable in IndexedDB) — its ECDSA identity keypair is
 * generated **extractable** and kept in the host's credential store (the OS keychain, or an owner-only file
 * where no keychain works). The device pins this host's PUBLIC key at first pair and verifies it on every
 * reconnect (rogue-host defense).
 *
 * Before the credential store existed the key sat in a plain `0600` JSON file under `~/.robota`, which
 * backups and dotfile sync copy. A key that may already have been copied elsewhere is not carried over: on
 * the first run after the move a new key is generated into the store, the old file is removed, and the
 * operator is told once that trusted devices must pair again, since the key they pinned is gone.
 */
import { unlinkSync } from 'node:fs';

import {
  deriveIdentityId,
  exportKeyPairJwk,
  exportPublicKey,
  generateIdentityKeyPair,
  importKeyPairJwk,
  type IIdentityKeyPairJwk,
} from '@robota-sdk/agent-remote-pairing';

import { CredentialStoreError, credentialKeyLabel } from '../credentials/credential-store-error.js';
import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';

import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';

/** The loaded host identity: the keypair plus its pinned-value derivatives. */
export interface IHostIdentity {
  /** The host's ECDSA identity keypair (private key signs reconnect challenges). */
  readonly keyPair: CryptoKeyPair;
  /** base64url SPKI public key — advertised to a device at first pair for pinning. */
  readonly publicKeySpki: string;
  /** Stable `SHA-256(SPKI)` id — the value the browser credential store keys on. */
  readonly hostIdentityId: string;
}

interface IHostIdentityRecord {
  readonly version: 1;
  readonly keyPair: IIdentityKeyPairJwk;
}

/** Where the host identity is kept in the credential store. */
export const HOST_IDENTITY_CREDENTIAL_KEY: ICredentialKey = {
  service: 'robota.remote-control',
  account: 'host-identity',
};

/** What the operator is told once, when the plain-file key is retired. */
export const HOST_IDENTITY_MOVED_NOTICE =
  'Remote control: the host identity key moved from a plain file into the credential store and was ' +
  'replaced with a new key, because the old file may have been copied by backups or dotfile sync. ' +
  'Trusted devices pinned the old key, so each must pair again from a new /remote-control link.';

export interface IHostIdentityOptions {
  /** The host's credential store. */
  readonly store: ICredentialStore;
  /** Held while a missing key is created, so concurrent first runs converge on one key. */
  readonly lockPath: string;
  /** Where a key from before the credential store was kept; removed, never read. */
  readonly legacyFilePath?: string;
  /** Tells the operator something they must act on (the re-pair notice). */
  readonly notify?: (message: string) => void;
}

async function derive(keyPair: CryptoKeyPair): Promise<IHostIdentity> {
  const publicKeySpki = await exportPublicKey(keyPair.publicKey);
  return { keyPair, publicKeySpki, hostIdentityId: await deriveIdentityId(publicKeySpki) };
}

/**
 * The stored identity, or `undefined` when none is stored. A stored value that does not parse or import
 * **throws** (fail-fast) rather than reading as absent — minting a new identity would force every trusted
 * device to re-pair, so surfacing corruption is the safer failure. The messages name the key and never
 * carry the stored text or a parser's quote of it, which is private key material.
 */
async function readStored(store: ICredentialStore): Promise<IHostIdentity | undefined> {
  const label = credentialKeyLabel(HOST_IDENTITY_CREDENTIAL_KEY);
  const raw = await store.get(HOST_IDENTITY_CREDENTIAL_KEY);
  if (raw === undefined) return undefined;
  let parsed: IHostIdentityRecord;
  try {
    parsed = JSON.parse(raw) as IHostIdentityRecord;
  } catch {
    throw new CredentialStoreError(`remote host identity ${label} is corrupt`);
  }
  if (parsed?.version !== 1 || !parsed.keyPair?.privateJwk || !parsed.keyPair?.publicJwk) {
    throw new CredentialStoreError(`remote host identity ${label} has an unexpected shape`);
  }
  let keyPair: CryptoKeyPair;
  try {
    keyPair = await importKeyPairJwk(parsed.keyPair);
  } catch {
    throw new CredentialStoreError(`remote host identity ${label} is not a usable key`);
  }
  return derive(keyPair);
}

/** Generate, store, and read back — a key the store did not keep is one no device could pin. */
async function create(store: ICredentialStore): Promise<IHostIdentity> {
  const keyPair = await generateIdentityKeyPair(true);
  const record: IHostIdentityRecord = { version: 1, keyPair: await exportKeyPairJwk(keyPair) };
  await store.set(HOST_IDENTITY_CREDENTIAL_KEY, JSON.stringify(record));
  const created = await derive(keyPair);
  const stored = await readStored(store);
  if (stored?.publicKeySpki !== created.publicKeySpki) {
    throw new CredentialStoreError(
      `the credential store did not keep remote host identity ${credentialKeyLabel(HOST_IDENTITY_CREDENTIAL_KEY)}`,
    );
  }
  return created;
}

/** Remove the plain-file key; whoever removes it tells the operator, so they hear it once. */
function retireLegacyFile(options: IHostIdentityOptions): void {
  if (options.legacyFilePath === undefined) return;
  try {
    unlinkSync(options.legacyFilePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new CredentialStoreError(
      `the old remote host identity file ${options.legacyFilePath} could not be removed`,
    );
  }
  options.notify?.(HOST_IDENTITY_MOVED_NOTICE);
}

/**
 * Load the host identity from the credential store, or generate and store one. Creation runs under a lock
 * and re-reads the store first, so two first runs — in this process or two — adopt one key rather than one
 * silently replacing the other's, which would invalidate every device pinned to the loser.
 */
export async function loadOrCreateHostIdentity(
  options: IHostIdentityOptions,
): Promise<IHostIdentity> {
  const { store } = options;
  const identity =
    (await readStored(store)) ??
    (await withExclusiveFileLock(
      options.lockPath,
      async () => (await readStored(store)) ?? create(store),
    ));
  retireLegacyFile(options);
  return identity;
}

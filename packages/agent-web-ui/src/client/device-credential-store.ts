/**
 * Browser device-credential store for TOFU trusted-device reconnect (REMOTE-012 Stage E3).
 *
 * Persists, per host, the browser device's **non-extractable** ECDSA keypair AND the pinned host-identity
 * public key, so a returning device can re-authenticate to the SAME host (verifying the pinned host key)
 * without re-pairing. Keyed by `relayOrigin | hostIdentityId` (the host identity is `SHA-256(host SPKI)`,
 * learned at first-pair enrollment). The private key is a non-extractable `CryptoKey` held via IndexedDB's
 * structured clone — it is NEVER serialized, and NO key/secret value ever touches `location.search`/history
 * (the store takes plain arguments, not URLs), consistent with the fragment-only-secret discipline.
 *
 * The persistence backend is injectable: the default is IndexedDB (browser); tests inject an in-memory
 * backend (Node vitest has no IndexedDB, and structured-cloneable CryptoKeys need no serialization anyway).
 */

/** One stored credential: the device keypair (non-extractable private key) + the pinned host public key (SPKI). */
export interface IDeviceCredential {
  readonly deviceKeyPair: CryptoKeyPair;
  readonly hostPublicSpki: string;
  /** REMOTE-013 E4: per-device reconnect seed (HKDF of the pairing sessionKey) for rotating-rendezvous rediscovery. */
  readonly reconnectSeed?: string;
  /** REMOTE-013 E4: monotonic reconnect counter (resync-on-success). Absent → 0. */
  readonly reconnectCounter?: number;
}

/** Minimal async key/value backend the store needs. IndexedDB satisfies it; tests inject a Map-backed fake. */
export interface ICredentialBackend {
  get(key: string): Promise<IDeviceCredential | undefined>;
  set(key: string, value: IDeviceCredential): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface IDeviceCredentialStore {
  get(relayOrigin: string, hostIdentityId: string): Promise<IDeviceCredential | undefined>;
  save(relayOrigin: string, hostIdentityId: string, credential: IDeviceCredential): Promise<void>;
  remove(relayOrigin: string, hostIdentityId: string): Promise<void>;
}

/** Compose the per-host store key. `relayOrigin` + `hostIdentityId` uniquely identify a paired host. */
export function credentialKey(relayOrigin: string, hostIdentityId: string): string {
  return `${relayOrigin}|${hostIdentityId}`;
}

const DB_NAME = 'robota-remote';
const STORE_NAME = 'device-credentials';

/** Default IndexedDB backend (browser). Stores the `IDeviceCredential` via structured clone (no serialization). */
function createIndexedDbBackend(indexed: IDBFactory = globalThis.indexedDB): ICredentialBackend {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexed.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    });
  }

  async function tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'));
      });
    } finally {
      db.close();
    }
  }

  return {
    get: (key) => tx('readonly', (s) => s.get(key) as IDBRequest<IDeviceCredential | undefined>),
    set: async (key, value) => {
      await tx('readwrite', (s) => s.put(value, key) as IDBRequest<IDBValidKey>);
    },
    delete: async (key) => {
      await tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
    },
  };
}

/** Create the device-credential store over a backend (default: IndexedDB). */
export function createDeviceCredentialStore(
  backend: ICredentialBackend = createIndexedDbBackend(),
): IDeviceCredentialStore {
  return {
    get: (relayOrigin, hostIdentityId) => backend.get(credentialKey(relayOrigin, hostIdentityId)),
    save: (relayOrigin, hostIdentityId, credential) =>
      backend.set(credentialKey(relayOrigin, hostIdentityId), credential),
    remove: (relayOrigin, hostIdentityId) =>
      backend.delete(credentialKey(relayOrigin, hostIdentityId)),
  };
}

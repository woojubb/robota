import { generateIdentityKeyPair } from '@robota-sdk/agent-remote-pairing';
import { describe, expect, it } from 'vitest';

import {
  createDeviceCredentialStore,
  credentialKey,
  type ICredentialBackend,
  type IDeviceCredential,
} from '../device-credential-store.js';

/**
 * REMOTE-012 E3 TC-06 — the browser device-credential store: persist + reload the (non-extractable) device
 * keypair and the pinned host key, keyed by relay origin + host identity, with no secret ever serialized.
 * Uses an in-memory backend (Node vitest has no IndexedDB; CryptoKeys are structured-cloneable, no serialize).
 */

function memoryBackend(): ICredentialBackend & { store: Map<string, IDeviceCredential> } {
  const store = new Map<string, IDeviceCredential>();
  return {
    store,
    get: (k) => Promise.resolve(store.get(k)),
    set: (k, v) => {
      store.set(k, v);
      return Promise.resolve();
    },
    delete: (k) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
}

describe('device credential store (REMOTE-012 TC-06)', () => {
  it('persists and reloads a device keypair + pinned host key, keyed by relayOrigin+hostIdentityId', async () => {
    const backend = memoryBackend();
    const store = createDeviceCredentialStore(backend);
    const deviceKeyPair = await generateIdentityKeyPair(false);
    const credential: IDeviceCredential = { deviceKeyPair, hostPublicSpki: 'host-spki' };

    expect(await store.get('wss://relay', 'host-1')).toBeUndefined();
    await store.save('wss://relay', 'host-1', credential);

    const reloaded = await store.get('wss://relay', 'host-1');
    expect(reloaded?.hostPublicSpki).toBe('host-spki');
    expect(reloaded?.deviceKeyPair.privateKey).toBe(deviceKeyPair.privateKey);
    // The reloaded private key is still non-extractable — it can never be serialized out.
    await expect(
      globalThis.crypto.subtle.exportKey('jwk', reloaded!.deviceKeyPair.privateKey),
    ).rejects.toBeTruthy();
  });

  it('scopes credentials per host and removes on request', async () => {
    const store = createDeviceCredentialStore(memoryBackend());
    const a = { deviceKeyPair: await generateIdentityKeyPair(false), hostPublicSpki: 'a' };
    const b = { deviceKeyPair: await generateIdentityKeyPair(false), hostPublicSpki: 'b' };
    await store.save('wss://relay', 'host-a', a);
    await store.save('wss://relay', 'host-b', b);
    expect((await store.get('wss://relay', 'host-a'))?.hostPublicSpki).toBe('a');
    expect((await store.get('wss://relay', 'host-b'))?.hostPublicSpki).toBe('b');

    await store.remove('wss://relay', 'host-a');
    expect(await store.get('wss://relay', 'host-a')).toBeUndefined();
    expect(await store.get('wss://relay', 'host-b')).toBeTruthy(); // unaffected
  });

  it('credentialKey composes relay origin + host identity (no URL/secret material)', () => {
    expect(credentialKey('wss://relay.example', 'host-xyz')).toBe('wss://relay.example|host-xyz');
  });

  it('REMOTE-013 E4: round-trips the reconnect seed + counter alongside the keypair', async () => {
    const store = createDeviceCredentialStore(memoryBackend());
    const cred = {
      deviceKeyPair: await generateIdentityKeyPair(false),
      hostPublicSpki: 'host',
      reconnectSeed: 'seed-abc',
      reconnectCounter: 3,
    };
    await store.save('wss://relay', 'host-1', cred);
    const reloaded = await store.get('wss://relay', 'host-1');
    expect(reloaded?.reconnectSeed).toBe('seed-abc');
    expect(reloaded?.reconnectCounter).toBe(3);
  });
});

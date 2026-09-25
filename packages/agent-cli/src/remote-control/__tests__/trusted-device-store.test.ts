import { mkdtempSync, readFileSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrustedDeviceStore, type ITrustedDeviceRecord } from '../trusted-device-store.js';

/**
 * REMOTE-012 E3 TC-04 — the host-side persistence of the trusted-device store (public keys only, fail-fast
 * on corrupt). The host identity keypair is covered by `host-identity.test.ts`.
 */

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'remote-e3-')));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function record(over: Partial<ITrustedDeviceRecord> = {}): ITrustedDeviceRecord {
  return {
    deviceId: 'dev-1',
    publicKey: 'cHVibGljLXNwa2k',
    label: 'phone',
    createdAt: '2026-07-11T00:00:00.000Z',
    lastSeenAt: '2026-07-11T00:00:00.000Z',
    ...over,
  };
}

describe('trusted-device store (REMOTE-012 TC-04)', () => {
  it('upsert → get/list; revoke removes; absent id is undefined', () => {
    const file = join(dir, 'devices.json');
    const store = createTrustedDeviceStore(file);
    expect(store.list()).toEqual([]);
    expect(store.get('dev-1')).toBeUndefined();

    store.upsert(record());
    store.upsert(record({ deviceId: 'dev-2', label: 'laptop' }));
    expect(store.list()).toHaveLength(2);
    expect(store.get('dev-1')?.label).toBe('phone');

    expect(store.revoke('dev-1')).toBe(true);
    expect(store.get('dev-1')).toBeUndefined();
    expect(store.revoke('dev-1')).toBe(false); // already gone
    expect(store.list()).toHaveLength(1);
  });

  it('persists ONLY public material — no private key ever written', () => {
    const file = join(dir, 'devices.json');
    createTrustedDeviceStore(file).upsert(record());
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('publicKey');
    expect(raw.toLowerCase()).not.toContain('private');
    expect(raw).not.toContain('"d"'); // a JWK private scalar field
  });

  it('fail-closed: a corrupt store throws (never silently an empty allow-list)', () => {
    const file = join(dir, 'devices.json');
    writeFileSync(file, '{ not valid json');
    expect(() => createTrustedDeviceStore(file).list()).toThrow(/corrupt/i);
  });
});

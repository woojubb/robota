import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../file-credential-store.js';
import { createKeychainCredentialStore } from '../keychain-credential-store.js';
import { createFakeKeyring } from './fake-keyring.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

/**
 * The port's contract, run against every backend: a caller handed either store must not be able to
 * tell which one it got. The keychain adapter runs over an injected fake keyring module.
 */

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'credential-contract-')));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const backends: ReadonlyArray<[string, () => ICredentialStore]> = [
  ['owner-only file', () => createFileCredentialStore(join(dir, '.robota', 'credentials'))],
  ['OS keychain', () => createKeychainCredentialStore(createFakeKeyring().module)],
];

const KEY = { service: 'robota.test', account: 'alpha' } as const;

describe.each(backends)('credential store contract: %s', (_name, create) => {
  it('reads nothing for a key never stored', async () => {
    expect(await create().get(KEY)).toBeUndefined();
  });

  it('returns exactly the secret stored under a key', async () => {
    const store = create();
    const secret = '{"d":"private","multi\\nline":"ünïcødé"}';
    await store.set(KEY, secret);
    expect(await store.get(KEY)).toBe(secret);
  });

  it('replaces a secret on a second set', async () => {
    const store = create();
    await store.set(KEY, 'first');
    await store.set(KEY, 'second');
    expect(await store.get(KEY)).toBe('second');
  });

  it('keeps keys apart by service and by account', async () => {
    const store = create();
    await store.set(KEY, 'a');
    await store.set({ service: 'robota.test', account: 'beta' }, 'b');
    await store.set({ service: 'robota.other', account: 'alpha' }, 'c');
    expect(await store.get(KEY)).toBe('a');
    expect(await store.get({ service: 'robota.test', account: 'beta' })).toBe('b');
    expect(await store.get({ service: 'robota.other', account: 'alpha' })).toBe('c');
  });

  it('does not confuse keys whose concatenation is the same', async () => {
    const store = create();
    await store.set({ service: 'ab', account: 'c' }, 'one');
    expect(await store.get({ service: 'a', account: 'bc' })).toBeUndefined();
  });

  it('deletes a secret, and deleting an absent one is not an error', async () => {
    const store = create();
    await store.set(KEY, 'gone');
    await store.delete(KEY);
    expect(await store.get(KEY)).toBeUndefined();
    await expect(store.delete(KEY)).resolves.toBeUndefined();
  });
});

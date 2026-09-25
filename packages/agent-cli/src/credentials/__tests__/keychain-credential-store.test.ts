import { describe, expect, it } from 'vitest';

import { createKeychainCredentialStore, loadKeyringModule } from '../keychain-credential-store.js';
import { createFakeKeyring } from './fake-keyring.js';

const KEY = { service: 'robota.test', account: 'alpha' } as const;
const SECRET = 'SECRET-VALUE-9b2e';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

function everything(error: Error): string {
  return JSON.stringify(error, Object.getOwnPropertyNames(error));
}

describe('OS keychain credential store', () => {
  it('a failed write names the key and never carries the secret, even when the keychain quotes it', async () => {
    const { module, controls } = createFakeKeyring();
    controls.failSet = 'Platform secure storage failure';
    const error = await rejection(createKeychainCredentialStore(module).set(KEY, SECRET));

    expect(error.message).toMatch(/robota\.test\/alpha/);
    expect(error.message).toMatch(/Platform secure storage failure/);
    expect(everything(error)).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('a failed read names the key', async () => {
    const { module, controls } = createFakeKeyring();
    controls.failGet = 'keychain is locked';
    const error = await rejection(createKeychainCredentialStore(module).get(KEY));
    expect(error.message).toMatch(/robota\.test\/alpha/);
    expect(error.message).toMatch(/locked/);
  });

  it('a failed delete is reported, not read as "nothing was there"', async () => {
    const { module, controls } = createFakeKeyring();
    controls.failDelete = 'access denied';
    await expect(createKeychainCredentialStore(module).delete(KEY)).rejects.toThrow(
      /robota\.test\/alpha/,
    );
  });

  it('on Linux, requires the persistent Secret Service rather than the in-memory kernel keyring', async () => {
    const { module, controls } = createFakeKeyring();
    await createKeychainCredentialStore(module, { platform: 'linux' }).get(KEY);
    expect(controls.constructedWith).toEqual([{ linux: { store: 'secret-service' } }]);
  });

  it('elsewhere, leaves the platform keychain to the binding', async () => {
    const { module, controls } = createFakeKeyring();
    await createKeychainCredentialStore(module, { platform: 'darwin' }).get(KEY);
    expect(controls.constructedWith).toEqual([undefined]);
  });
});

describe('loading the optional keychain binding', () => {
  it('says the binding is absent when it cannot be resolved', () => {
    expect(() =>
      loadKeyringModule(() => {
        throw new Error('Cannot find module');
      }),
    ).toThrow(/@napi-rs\/keyring/);
  });

  it('refuses a module that does not have the shape it needs', () => {
    expect(() => loadKeyringModule(() => ({}))).toThrow(/@napi-rs\/keyring/);
  });

  it('returns the resolved module', () => {
    const { module } = createFakeKeyring();
    expect(loadKeyringModule(() => module)).toBe(module);
  });
});

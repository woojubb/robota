/**
 * The OS keychain backend of the credential store port, over the optional `@napi-rs/keyring` binding:
 * macOS Keychain, Windows Credential Manager, and the Secret Service on Linux.
 *
 * The binding is an optional dependency loaded at first use, so the CLI installs and runs where no
 * prebuilt binary exists; its absence is reported by the selection that falls back from it, never
 * papered over here.
 */
import { createRequire } from 'node:module';

import {
  CredentialStoreError,
  credentialKeyLabel,
  redactedReason,
} from './credential-store-error.js';

import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';

/** The part of a keyring entry this store uses (`@napi-rs/keyring`'s `AsyncEntry`). */
export interface IKeyringEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

/** The part of `@napi-rs/keyring` this store uses. */
export interface IKeyringModule {
  readonly AsyncEntry: new (
    service: string,
    account: string,
    options?: { linux?: { store?: 'secret-service' | 'keyutils' } },
  ) => IKeyringEntry;
}

const KEYRING_MODULE_ID = '@napi-rs/keyring';

/** Resolve a module by id; the default is Node's `require`, and tests inject their own. */
export type TKeyringResolver = (id: string) => unknown;

const defaultResolver: TKeyringResolver = (id) => {
  const requireFrom = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native binding; resolved at runtime, never bundled
  return requireFrom(id);
};

/** Load the optional keychain binding, or throw saying it is not available. */
export function loadKeyringModule(resolve: TKeyringResolver = defaultResolver): IKeyringModule {
  let loaded: unknown;
  try {
    loaded = resolve(KEYRING_MODULE_ID);
  } catch (error) {
    throw new CredentialStoreError(
      `the optional ${KEYRING_MODULE_ID} binding could not be loaded (${redactedReason(error)})`,
    );
  }
  if (
    typeof loaded !== 'object' ||
    loaded === null ||
    typeof (loaded as Partial<IKeyringModule>).AsyncEntry !== 'function'
  ) {
    throw new CredentialStoreError(`the ${KEYRING_MODULE_ID} binding has an unexpected shape`);
  }
  return loaded as IKeyringModule;
}

export interface IKeychainCredentialStoreOptions {
  /** Defaults to `process.platform`. */
  readonly platform?: string;
}

/**
 * A credential store over the OS keychain. On Linux the entry requires the Secret Service: the
 * binding would otherwise fall back to the kernel keyring, which is memory-only and forgets every
 * secret at reboot — a host key lost that way changes the identity devices pinned, with no signal.
 */
export function createKeychainCredentialStore(
  keyring: IKeyringModule,
  options: IKeychainCredentialStoreOptions = {},
): ICredentialStore {
  const platform = options.platform ?? process.platform;
  const entryFor = (key: ICredentialKey): IKeyringEntry =>
    platform === 'linux'
      ? new keyring.AsyncEntry(key.service, key.account, { linux: { store: 'secret-service' } })
      : new keyring.AsyncEntry(key.service, key.account);
  const failure = (verb: string, key: ICredentialKey, error: unknown, secret?: string): Error =>
    new CredentialStoreError(
      `OS keychain could not ${verb} ${credentialKeyLabel(key)}: ${redactedReason(error, secret)}`,
    );

  return {
    get: async (key) => {
      try {
        const secret = await entryFor(key).getPassword();
        return secret ?? undefined;
      } catch (error) {
        throw failure('read', key, error);
      }
    },
    set: async (key, secret) => {
      try {
        await entryFor(key).setPassword(secret);
      } catch (error) {
        throw failure('store', key, error, secret);
      }
    },
    delete: async (key) => {
      try {
        await entryFor(key).deletePassword();
      } catch (error) {
        throw failure('delete', key, error);
      }
    },
  };
}

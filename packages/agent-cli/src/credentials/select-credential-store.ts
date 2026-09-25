/**
 * Which backend keeps this host's secrets: the OS keychain when its binding loads and a probe
 * round-trips, else an owner-only file under the host's storage root.
 *
 * The choice is explicit and reported — the description names the backend and, for the file, why the
 * keychain was not used — and it is recorded on first use and kept. A keychain that stops working
 * later (an SSH session with no Secret Service, a locked keychain) therefore fails closed instead of
 * sending new secrets to a file while the ones already in the keychain silently stop being found.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { CredentialStoreError, redactedReason } from './credential-store-error.js';
import { withExclusiveFileLock } from './exclusive-file-lock.js';
import { createFileCredentialStore } from './file-credential-store.js';
import { createKeychainCredentialStore, loadKeyringModule } from './keychain-credential-store.js';

import type { IKeyringModule } from './keychain-credential-store.js';
import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';

export type TCredentialBackend = 'os-keychain' | 'owner-only-file';

export interface ISelectedCredentialStore {
  readonly store: ICredentialStore;
  readonly backend: TCredentialBackend;
  /** One line for the operator: the backend, and for the file why the keychain is not used. */
  readonly description: string;
}

export interface ISelectCredentialStoreOptions {
  /** The host's storage root (`~/.robota`); the file backend and the recorded choice live under it. */
  readonly root: string;
  /** Loads the keychain binding or throws; defaults to the optional `@napi-rs/keyring`. */
  readonly loadKeyring?: () => IKeyringModule;
  /** Defaults to `process.platform`. */
  readonly platform?: string;
}

const MARKER_VERSION = 1;
const PROBE_SERVICE = 'robota.credential-store';

const KEYCHAIN_NAMES: Readonly<Record<string, string>> = {
  darwin: 'macOS Keychain',
  win32: 'Windows Credential Manager',
  linux: 'Secret Service',
};

function credentialDirectory(root: string): string {
  return join(root, 'credentials');
}

function readRecordedBackend(markerPath: string): TCredentialBackend | undefined {
  let text: string;
  try {
    tightenExistingFile(markerPath);
    text = readFileSync(markerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CredentialStoreError(
      `the recorded credential backend ${markerPath} is unreadable: ${redactedReason(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CredentialStoreError(`the recorded credential backend ${markerPath} is corrupt`);
  }
  const record = parsed as { version?: unknown; backend?: unknown } | null;
  if (
    record?.version !== MARKER_VERSION ||
    (record.backend !== 'os-keychain' && record.backend !== 'owner-only-file')
  ) {
    throw new CredentialStoreError(
      `the recorded credential backend ${markerPath} has an unexpected shape`,
    );
  }
  return record.backend;
}

/** Loads the keychain and proves it keeps a value; returns why not when it does not. */
async function openKeychain(
  loadKeyring: () => IKeyringModule,
  platform: string,
): Promise<{ store: ICredentialStore } | { reason: string }> {
  try {
    const store = createKeychainCredentialStore(loadKeyring(), { platform });
    const probe = randomBytes(16).toString('hex');
    // A probe account of its own, so another process probing at the same moment cannot overwrite or
    // delete this one's value and make a working keychain look broken.
    const probeKey: ICredentialKey = { service: PROBE_SERVICE, account: `probe-${probe}` };
    await store.set(probeKey, probe);
    const readBack = await store.get(probeKey);
    await store.delete(probeKey);
    if (readBack !== probe) return { reason: 'it accepted a value and did not keep it' };
    return { store };
  } catch (error) {
    return { reason: redactedReason(error) };
  }
}

/**
 * Choose the backend. The whole choice runs under a lock beside the record, so two processes choosing
 * at once cannot record different backends and each keep a secret where the other never looks.
 */
export async function selectCredentialStore(
  options: ISelectCredentialStoreOptions,
): Promise<ISelectedCredentialStore> {
  const directory = credentialDirectory(options.root);
  ensureOwnerOnlyDirectory(directory, { withinRoot: options.root });
  return withExclusiveFileLock(join(directory, 'backend.lock'), () => chooseBackend(options));
}

async function chooseBackend(
  options: ISelectCredentialStoreOptions,
): Promise<ISelectedCredentialStore> {
  const platform = options.platform ?? process.platform;
  const directory = credentialDirectory(options.root);
  const markerPath = join(directory, 'backend.json');
  const fileStore = (): ICredentialStore =>
    createFileCredentialStore(directory, { withinRoot: options.root });
  const record = (backend: TCredentialBackend): void => {
    ensureOwnerOnlyDirectory(directory, { withinRoot: options.root });
    writeOwnerOnlyFile(markerPath, `${JSON.stringify({ version: MARKER_VERSION, backend })}\n`);
  };

  const recorded = readRecordedBackend(markerPath);
  if (recorded === 'owner-only-file') {
    return {
      store: fileStore(),
      backend: 'owner-only-file',
      description: `owner-only file in ${directory} (recorded choice; secrets were first stored there)`,
    };
  }

  const keychain = await openKeychain(options.loadKeyring ?? (() => loadKeyringModule()), platform);
  if ('store' in keychain) {
    if (recorded === undefined) record('os-keychain');
    return {
      store: keychain.store,
      backend: 'os-keychain',
      description: `OS keychain (${KEYCHAIN_NAMES[platform] ?? platform})`,
    };
  }
  if (recorded === 'os-keychain') {
    throw new CredentialStoreError(
      `this host keeps its secrets in the OS keychain, which is unavailable now: ${keychain.reason}`,
    );
  }
  record('owner-only-file');
  return {
    store: fileStore(),
    backend: 'owner-only-file',
    description: `owner-only file in ${directory} (OS keychain unavailable: ${keychain.reason})`,
  };
}

export interface IHostCredentialStore {
  /** The store, choosing its backend on first use. */
  readonly store: ICredentialStore;
  /**
   * The chosen backend's description, why the last choice failed, or `undefined` while nothing has
   * needed a secret yet.
   */
  describe(): string | undefined;
}

/**
 * The host's credential store, chosen lazily so a session that never needs a secret never loads the
 * native binding or touches the keychain. A file fallback is told to the operator once through
 * `notify`; a failed choice is not remembered, so the next use tries again.
 */
export function createHostCredentialStore(
  options: ISelectCredentialStoreOptions & { readonly notify: (message: string) => void },
): IHostCredentialStore {
  let selected: ISelectedCredentialStore | undefined;
  let lastFailure: string | undefined;
  let pending: Promise<ISelectedCredentialStore> | undefined;
  const resolve = (): Promise<ISelectedCredentialStore> => {
    if (selected) return Promise.resolve(selected);
    pending ??= selectCredentialStore(options).then(
      (choice) => {
        selected = choice;
        if (choice.backend === 'owner-only-file') {
          options.notify(`Host keys are kept in an ${choice.description}.`);
        }
        return choice;
      },
      (error: unknown) => {
        pending = undefined;
        lastFailure = redactedReason(error);
        throw error;
      },
    );
    return pending;
  };
  return {
    store: {
      get: async (key) => (await resolve()).store.get(key),
      set: async (key, secret) => (await resolve()).store.set(key, secret),
      delete: async (key) => (await resolve()).store.delete(key),
    },
    describe: () =>
      selected?.description ??
      (lastFailure === undefined ? undefined : `unavailable (${lastFailure})`),
  };
}

/**
 * `/devices` at the composition root: identity state under `~/.robota/devices`, private keys in the
 * host credential store, the recovery phrase on the process's own terminal.
 */
import { join } from 'node:path';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import { createDeviceIdentityService } from './device-identity-service.js';
import { openSecretTerminal, type ISecretTerminalSession } from './secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IDevicesCommandPort } from '@robota-sdk/agent-command';

export interface IDevicesCommandPortOptions {
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  /** Defaults to the host credential store (OS keychain, else an owner-only file). */
  readonly credentials?: { readonly store: ICredentialStore; describe(): string | undefined };
  /** Defaults to the process TTY. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
}

export function createDevicesCommandPort(options: IDevicesCommandPortOptions = {}): IDevicesCommandPort {
  const root = options.root ?? userLocalStorageRoot();
  // The backend in use is reported in the `/devices init` result, so the one-time notice is not needed.
  const credentials = options.credentials ?? createHostCredentialStore({ root, notify: () => {} });
  return createDeviceIdentityService({
    directory: join(root, 'devices'),
    withinRoot: root,
    store: credentials.store,
    openTerminal: options.openTerminal ?? (() => openSecretTerminal()),
    describeKeyStorage: () => credentials.describe(),
  });
}

/**
 * `/devices` at the composition root: identity state under `~/.robota/devices`, private keys in the
 * host credential store, the recovery phrase on the process's own terminal.
 */
import { join } from 'node:path';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import { createDeviceIdentityService } from './device-identity-service.js';
import { scheduleListReissue } from './device-list-reissue.js';
import { openSecretTerminal, type ISecretTerminalSession } from './secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IDevicesCommandPort, IDevicesMeshStatus } from '@robota-sdk/agent-command';

export interface IDevicesCommandPortOptions {
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  /** Defaults to the host credential store (OS keychain, else an owner-only file). */
  readonly credentials?: { readonly store: ICredentialStore; describe(): string | undefined };
  /** Defaults to the process TTY. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
  /** This session's device mesh, shown by `/devices`. */
  readonly meshStatus?: () => IDevicesMeshStatus;
}

export function createDevicesCommandPort(
  options: IDevicesCommandPortOptions = {},
): IDevicesCommandPort {
  const root = options.root ?? userLocalStorageRoot();
  // The backend in use is reported in the `/devices init` result, so the one-time notice is not needed.
  const credentials = options.credentials ?? createHostCredentialStore({ root, notify: () => {} });
  const service = createDeviceIdentityService({
    directory: join(root, 'devices'),
    withinRoot: root,
    store: credentials.store,
    openTerminal: options.openTerminal ?? (() => openSecretTerminal()),
    describeKeyStorage: () => credentials.describe(),
  });
  const meshStatus = options.meshStatus;
  return meshStatus === undefined ? service : { ...service, meshStatus };
}

export { createDeviceMeshHost } from './device-mesh-host.js';
export type { IDeviceMeshHost } from './device-mesh-host.js';

export interface IDeviceListReissueStartOptions {
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  readonly credentials?: { readonly store: ICredentialStore };
}

/**
 * Keep this device's roster and revocation list from lapsing while the host runs, when it holds the
 * signing key. A failed check is retried on the next one; the lists' validity, shown by
 * `/devices list`, is where a lasting failure becomes visible.
 */
export function startDeviceListReissue(options: IDeviceListReissueStartOptions = {}): () => void {
  const root = options.root ?? userLocalStorageRoot();
  const credentials = options.credentials ?? createHostCredentialStore({ root, notify: () => {} });
  return scheduleListReissue({
    directory: join(root, 'devices'),
    withinRoot: root,
    store: credentials.store,
    // allow-fallback: the next hourly check retries, and an expiring list shows in `/devices list`
    onError: () => undefined,
  });
}

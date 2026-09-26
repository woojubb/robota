/**
 * `/devices` at the composition root: identity state under `~/.robota/devices`, private keys in the
 * host credential store, the recovery phrase and enrollment codes on the process's own terminal, and
 * enrollment signaling through the configured relay (`transports.webrtc.options.relayUrl`).
 */
import { join } from 'node:path';

import { WsMeshRelayClient } from '@robota-sdk/agent-transport-webrtc';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import { parseIceServers } from '../remote-control/ice-config.js';
import { readWebrtcOption, readWebrtcRawOption } from '../remote-control/webrtc-settings.js';
import { createDeviceIdentityService } from './device-identity-service.js';
import { scheduleListReissue } from './device-list-reissue.js';
import { openSecretTerminal, type ISecretTerminalSession } from './secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IDevicesCommandPort, IDevicesMeshStatus } from '@robota-sdk/agent-command';
import type { IIceServer, IMeshRelay } from '@robota-sdk/agent-transport-webrtc';

export interface IDevicesCommandPortOptions {
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  /** Defaults to the host credential store (OS keychain, else an owner-only file). */
  readonly credentials?: { readonly store: ICredentialStore; describe(): string | undefined };
  /** Defaults to the process TTY. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
  /** This session's device mesh, shown by `/devices`. */
  readonly meshStatus?: () => IDevicesMeshStatus;
  /** Defaults to a client of the configured signaling relay, or none when no relay is configured. */
  readonly openEnrollmentRelay?: (onError: (error: Error) => void) => IMeshRelay | undefined;
  /** Defaults to the configured ICE servers. */
  readonly iceServers?: () => readonly IIceServer[] | undefined;
  /**
   * Called after a verb that changed this device's identity or lists (init, join, add, revoke,
   * recover), so the running session's mesh opens for a new identity or pushes the new lists.
   */
  readonly onIdentityChanged?: () => void;
  /** Test seams for enrollment timing. */
  readonly enrollment?: {
    readonly ttlMs?: number;
    readonly maxFailedAttempts?: number;
    readonly connectTimeoutMs?: number;
  };
}

/** A client of the configured signaling relay, or `undefined` when none is configured. */
function openConfiguredRelay(onError: (error: Error) => void): IMeshRelay | undefined {
  const url = readWebrtcOption('relayUrl');
  return url === undefined ? undefined : new WsMeshRelayClient({ url, onError });
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
    openEnrollmentRelay: options.openEnrollmentRelay ?? openConfiguredRelay,
    iceServers: options.iceServers ?? (() => parseIceServers(readWebrtcRawOption('iceServers'))),
    ...(options.enrollment !== undefined ? { enrollment: options.enrollment } : {}),
  });
  const onChanged = options.onIdentityChanged;
  const told =
    onChanged === undefined
      ? service
      : {
          ...service,
          init: tell(service.init, onChanged),
          join: tell(service.join, onChanged),
          add: tell(service.add, onChanged),
          revoke: tell(service.revoke, onChanged),
          recover: tell(service.recover, onChanged),
        };
  const meshStatus = options.meshStatus;
  return meshStatus === undefined ? told : { ...told, meshStatus };
}

/** `verb`, calling `changed` after each outcome that succeeded. */
function tell<TArgs extends unknown[], TOutcome extends { readonly ok: boolean }>(
  verb: (...args: TArgs) => Promise<TOutcome>,
  changed: () => void,
): (...args: TArgs) => Promise<TOutcome> {
  return async (...args) => {
    const outcome = await verb(...args);
    if (outcome.ok) {
      try {
        changed();
      } catch {
        // allow-fallback: the change is made and saved; the mesh takes it up at its next refresh
      }
    }
    return outcome;
  };
}

export { createDeviceMeshHost } from './device-mesh-host.js';
export type { IDeviceMeshHost } from './device-mesh-host.js';

export interface IDeviceListReissueStartOptions {
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  readonly credentials?: { readonly store: ICredentialStore };
  /** New lists were issued: a running mesh pushes them. */
  readonly onReissued?: () => void;
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
    ...(options.onReissued !== undefined ? { onReissued: options.onReissued } : {}),
    // allow-fallback: the next hourly check retries, and an expiring list shows in `/devices list`
    onError: () => undefined,
  });
}

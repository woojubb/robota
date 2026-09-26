/**
 * This device's endpoint in the user's device mesh, from the identity `/devices` keeps under
 * `~/.robota/devices` and the private keys in the credential store.
 *
 * Opening it announces this device at its peers' relay inboxes and lets a peer device connect;
 * every connection is admitted by the device handshake before anything but the handshake crosses it.
 * Beyond the local network it can publish and look up rendezvous records on the Mainline DHT and
 * signal over public Nostr relays; those are candidates and carriers only, and before a remote
 * admission the lists other devices published there are looked up for a newer revocation. Where no
 * direct path works, a connection is relayed by a TURN relay a paired device runs, then by the
 * user's own TURN servers, and otherwise refused with an error saying a relay device is needed.
 * Lists a peer hands over during a handshake are saved only when they verify for this device and are
 * newer than the ones held, so a peer can bring a revocation but never roll one back.
 */
import { isIPv4 } from 'node:net';
import { join } from 'node:path';

import {
  signSessionDescriptor,
  type IDeviceHandshakeIdentity,
  type IListUpdate,
  type ISessionDescriptor,
  type TDeviceCapability,
} from '@robota-sdk/agent-remote-pairing';
import {
  DeviceMeshNode,
  MeshDht,
  MeshTurnRelay,
  NostrMeshRelay,
  createNostrRelayPool,
  createPkarrRelayStore,
  localInterfaceAddresses,
  startLanMeshRelay,
  startMainlineDhtStore,
  type IDeviceMeshRelayOptions,
  type IIceServer,
  type IMeshMdnsOptions,
  type IMeshRelayEndpoint,
  type IMeshRelay,
  type INostrRelayPool,
  type IRendezvousItemStore,
} from '@robota-sdk/agent-transport-webrtc';

import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { createFileMeshAddressCache } from './address-cache.js';
import { DeviceIdentityError } from './device-identity-error.js';
import { loadDevicePrivateKeys } from './identity-keys.js';
import { checked } from './identity-lists.js';
import type { IMeshInternetSettings } from './mesh-internet-settings.js';
import {
  readIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from './identity-state.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IOperatorApprover } from '@robota-sdk/agent-interface-session-mobility';

/** What a peer may ask of this device until per-connection authority says otherwise. */
export const DEFAULT_MESH_POLICY: readonly TDeviceCapability[] = ['presence', 'message'];

export interface IOpenDeviceMeshOptions {
  /** `~/.robota` of the `HOME` this device runs under. */
  readonly root: string;
  readonly store: ICredentialStore;
  readonly relay: IMeshRelay;
  /**
   * Look for peers on the local network before the relay: the addresses that worked last (kept
   * under the devices directory), then mDNS. Absent: the relay only.
   */
  readonly lan?: IDeviceMeshLanOptions;
  /**
   * Look for peers beyond the local network too: rendezvous records on the DHT (or pkarr relays)
   * after mDNS, and Nostr signaling before the self-hosted relay. Absent: none of it.
   */
  readonly internet?: IDeviceMeshInternetOptions;
  /** Asked before a peer may use a capability that needs the operator; absent → such requests are refused. */
  readonly operatorApprover?: IOperatorApprover;
  readonly localPolicy?: readonly TDeviceCapability[];
  readonly iceServers?: readonly IIceServer[];
  readonly connectTimeoutMs?: number;
  readonly now?: () => number;
  /**
   * A list a peer handed over that could not be saved, or a periodic refresh that failed. The
   * endpoint keeps running either way; this is where the failure becomes visible.
   */
  readonly onError?: (error: unknown) => void;
}

export interface IDeviceMeshLanOptions {
  /** The address this device's direct signaling endpoint binds; default: every interface. */
  readonly host?: string;
  /** mDNS options, or `false` to find peers only at remembered addresses. */
  readonly mdns?: IMeshMdnsOptions | false;
  /** Something on the local network could not be used; the relay still is. */
  readonly onError?: (error: Error) => void;
}

export interface IDeviceMeshInternetOptions {
  /** From `parseMeshInternetSettings`. */
  readonly settings: IMeshInternetSettings;
  /** Test seam: where records go (default: the DHT, else the pkarr relays, per the settings). */
  readonly stores?: readonly IRendezvousItemStore[];
  /** Test seam: the Nostr relays (default: the settings' relays). */
  readonly nostrPool?: INostrRelayPool;
  /** Test seam: the longest delay before a pair's records are published. */
  readonly maxPublishJitterMs?: number;
  /** A record or signal could not be published; the other ways still work. */
  readonly onError?: (error: Error) => void;
}

interface IInternetParts {
  readonly dht?: MeshDht;
  readonly nostr?: NostrMeshRelay;
  /** The relay this device runs for its paired devices. */
  readonly turn?: MeshTurnRelay;
}

/** Where paired devices reach this device's relay. */
function relayEndpoints(
  internet: IDeviceMeshInternetOptions,
  turn: MeshTurnRelay,
): readonly IMeshRelayEndpoint[] {
  const { publicAddress, host } = internet.settings.relay;
  const port = turn.endpoint.port;
  if (publicAddress !== undefined) return [{ host: publicAddress, port }];
  if (host !== undefined && host !== '0.0.0.0') return [{ host, port }];
  // The relay listens on IPv4 only.
  return localInterfaceAddresses()
    .filter((address) => isIPv4(address))
    .map((address) => ({ host: address, port }));
}

function closeInternet(parts: IInternetParts): void {
  parts.dht?.close();
  parts.nostr?.close();
  void parts.turn?.close();
}

async function recordStores(internet: IDeviceMeshInternetOptions): Promise<IRendezvousItemStore[]> {
  if (internet.stores !== undefined) return [...internet.stores];
  if (internet.settings.dht) {
    try {
      return [
        await startMainlineDhtStore({
          ...(internet.onError !== undefined ? { onError: internet.onError } : {}),
        }),
      ];
    } catch (error) {
      // allow-fallback: without the DHT the pkarr relays, if any, carry the records
      internet.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return internet.settings.pkarrRelays.length > 0
    ? [createPkarrRelayStore({ relays: internet.settings.pkarrRelays })]
    : [];
}

async function startInternet(
  internet: IDeviceMeshInternetOptions,
  directory: string,
): Promise<IInternetParts> {
  const onError = internet.onError;
  const { relay } = internet.settings;
  const turn = relay.serve
    ? await MeshTurnRelay.start({
        port: relay.port,
        ...(relay.host !== undefined ? { host: relay.host } : {}),
        ...(relay.publicAddress !== undefined ? { relayAddress: relay.publicAddress } : {}),
        ...(relay.relayPorts !== undefined ? { relayPorts: relay.relayPorts } : {}),
        ...(onError !== undefined ? { onError } : {}),
      })
    : undefined;
  let stores: IRendezvousItemStore[];
  try {
    stores = await recordStores(internet);
  } catch (error) {
    void turn?.close();
    throw error;
  }
  const dht =
    stores.length === 0
      ? undefined
      : new MeshDht({
          stores,
          addresses: localInterfaceAddresses,
          // Only the pair can open a hints record, so the relay's address reaches paired devices only.
          ...(turn !== undefined ? { relayEndpoints: () => relayEndpoints(internet, turn) } : {}),
          ...(internet.maxPublishJitterMs !== undefined
            ? { maxPublishJitterMs: internet.maxPublishJitterMs }
            : {}),
          // The lists on disk are the newest this device holds, whoever handed them over.
          lists: () => {
            const state = readIdentityState(directory);
            return state === undefined
              ? undefined
              : { revocation: state.revocation, signingKeyRevocation: state.signingKeyRevocation };
          },
          ...(onError !== undefined ? { onError } : {}),
        });
  try {
    const pool =
      internet.nostrPool ??
      (internet.settings.nostrRelays.length > 0
        ? createNostrRelayPool(internet.settings.nostrRelays)
        : undefined);
    const nostr =
      pool === undefined
        ? undefined
        : new NostrMeshRelay({ pool, ...(onError !== undefined ? { onError } : {}) });
    return {
      ...(dht !== undefined ? { dht } : {}),
      ...(nostr !== undefined ? { nostr } : {}),
      ...(turn !== undefined ? { turn } : {}),
    };
  } catch (error) {
    closeInternet({ ...(dht !== undefined ? { dht } : {}), ...(turn !== undefined ? { turn } : {}) });
    throw error;
  }
}

function randomSessionId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Save lists adopted in a handshake: only newer ones, only from this device's signing key, only if they verify. */
export async function saveAdoptedLists(
  directory: string,
  withinRoot: string | undefined,
  update: IListUpdate,
  now: number,
): Promise<boolean> {
  return withExclusiveFileLock(join(directory, 'identity.lock'), async () => {
    const current = readIdentityState(directory);
    if (current === undefined) return false;
    const signingKeyId = current.signingKeyCertificate.signingKeyId;
    const next: IDeviceIdentityState = {
      ...current,
      ...(update.roster !== undefined &&
      update.roster.signingKeyId === signingKeyId &&
      update.roster.seq > current.roster.seq
        ? { roster: update.roster }
        : {}),
      ...(update.revocation !== undefined &&
      update.revocation.signingKeyId === signingKeyId &&
      update.revocation.seq > current.revocation.seq
        ? { revocation: update.revocation }
        : {}),
      ...(update.signingKeyRevocation !== undefined &&
      update.signingKeyRevocation.seq > current.signingKeyRevocation.seq
        ? { signingKeyRevocation: update.signingKeyRevocation }
        : {}),
    };
    if (
      next.roster === current.roster &&
      next.revocation === current.revocation &&
      next.signingKeyRevocation === current.signingKeyRevocation
    ) {
      return false;
    }
    // Refuses — and saves nothing — when the lists do not verify for this device, e.g. revoke it.
    const state = await checked(next, now);
    writeIdentityState(directory, state, withinRoot);
    return true;
  });
}

/** How often a running endpoint picks up lists saved since it opened. */
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** A session descriptor is renewed once less than this is left. */
const DESCRIPTOR_RENEW_MS = 60 * 60 * 1000;

export interface IDeviceMeshEndpoint {
  readonly node: DeviceMeshNode;
  /**
   * Put lists saved since the endpoint opened — reissued by this device, or handed over by a peer —
   * in force, and renew the session descriptor before it expires. Also runs periodically.
   */
  refresh(): Promise<void>;
  close(): void;
}

interface IDeviceKeys {
  readonly signPrivateKey: CryptoKey;
  readonly kaPrivateKey: CryptoKey;
}

function handshakeIdentity(
  state: IDeviceIdentityState,
  keys: IDeviceKeys,
): IDeviceHandshakeIdentity {
  return {
    masterPublicKey: state.masterPublicKey,
    signingKeyCertificate: state.signingKeyCertificate,
    deviceCertificate: state.deviceCertificate,
    signPrivateKey: keys.signPrivateKey,
    kaPrivateKey: keys.kaPrivateKey,
    roster: state.roster,
    revocation: state.revocation,
    signingKeyRevocation: state.signingKeyRevocation,
    marks: state.marks,
  };
}

/** Open and start this device's mesh endpoint. Throws when the device has no usable identity. */
export async function openDeviceMesh(
  options: IOpenDeviceMeshOptions,
): Promise<IDeviceMeshEndpoint> {
  const now = options.now ?? Date.now;
  const directory = join(options.root, 'devices');
  const state = readIdentityState(directory);
  if (state === undefined) {
    throw new DeviceIdentityError('this device has no identity yet; run `/devices init` first');
  }
  const keys = await loadDevicePrivateKeys(options.store, state.deviceCertificate);
  if (keys === undefined) {
    throw new DeviceIdentityError(
      "this device's private keys are missing from the credential store",
    );
  }
  const deviceId = state.deviceCertificate.deviceId;
  const describe = (): Promise<ISessionDescriptor> =>
    signSessionDescriptor({
      signPrivateKey: keys.signPrivateKey,
      deviceId,
      sessionId: randomSessionId(),
      startedAt: now(),
    });
  let descriptor = await describe();
  const internet =
    options.internet === undefined ? {} : await startInternet(options.internet, directory);
  // Beyond the local network needs the direct endpoint too: DHT records point at it.
  const lan =
    options.lan ?? (options.internet !== undefined ? { mdns: false as const } : undefined);
  let relay: IMeshRelay;
  try {
    relay =
      lan === undefined
        ? options.relay
        : await startLanMeshRelay({
            relay: options.relay,
            cache: createFileMeshAddressCache(directory, { withinRoot: options.root, now }),
            ...(lan.host !== undefined ? { host: lan.host } : {}),
            ...(lan.mdns !== undefined ? { mdns: lan.mdns } : {}),
            ...((lan.onError ?? options.onError) !== undefined
              ? { onError: lan.onError ?? options.onError }
              : {}),
            internet: {
              ...(internet.dht !== undefined ? { dht: internet.dht } : {}),
              ...(internet.nostr !== undefined ? { signaling: [internet.nostr] } : {}),
            },
          });
  } catch (error) {
    closeInternet(internet);
    throw error;
  }
  const dht = internet.dht;
  const settings = options.internet?.settings;
  const relays: IDeviceMeshRelayOptions | undefined =
    settings === undefined
      ? undefined
      : {
          ...(dht !== undefined ? { advertised: (peers, signal) => dht.relayAdverts(peers, signal) } : {}),
          configured: settings.turnServers,
          relayOnly: settings.relayOnly,
        };
  // Everything started so far is closed again if the endpoint cannot be opened.
  let node: DeviceMeshNode | undefined;
  try {
    node = new DeviceMeshNode({
      identity: handshakeIdentity(state, keys),
      sessionDescriptor: descriptor,
      localPolicy: options.localPolicy ?? DEFAULT_MESH_POLICY,
      relay,
      ...(options.operatorApprover !== undefined
        ? { operatorApprover: options.operatorApprover }
        : {}),
      onListsAdopted: (update) => {
        // A list that cannot be saved is adopted again from the next peer that has it; say so meanwhile.
        void saveAdoptedLists(directory, options.root, update, now()).catch((error: unknown) =>
          options.onError?.(error),
        );
      },
      ...(dht !== undefined ? { fetchLatestLists: (signal) => dht.latestLists(signal) } : {}),
      ...(options.iceServers !== undefined ? { iceServers: options.iceServers } : {}),
      ...(relays !== undefined ? { relays } : {}),
      ...(internet.turn !== undefined ? { relayServer: internet.turn } : {}),
      ...(options.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
      now,
    });
    await node.start();
  } catch (error) {
    node?.stop();
    if (relay !== options.relay) relay.close();
    internet.nostr?.close();
    void internet.turn?.close();
    throw error;
  }

  const refresh = async (): Promise<void> => {
    const current = readIdentityState(directory);
    // The device's own certificate changed (recovery): a new endpoint is needed for its new keys.
    if (current === undefined || current.deviceCertificate.deviceId !== deviceId) return;
    if (descriptor.expiresAt - now() < DESCRIPTOR_RENEW_MS) descriptor = await describe();
    await node.refresh({
      identity: handshakeIdentity(current, keys),
      sessionDescriptor: descriptor,
    });
  };
  const timer = setInterval(() => {
    // The next interval retries; the lists in force stay valid until they expire.
    refresh().catch((error: unknown) => options.onError?.(error));
  }, REFRESH_INTERVAL_MS);
  timer.unref?.();
  return {
    node,
    refresh,
    close: () => {
      clearInterval(timer);
      node.stop();
      // Closes the DHT records source with it.
      if (relay !== options.relay) relay.close();
      internet.nostr?.close();
      void internet.turn?.close();
    },
  };
}

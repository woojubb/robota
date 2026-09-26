/**
 * The device mesh as an interactive session runs it: opened at startup when the user settings turn
 * it on and this device has an identity, closed on exit.
 *
 * Every admitted link is wired to the same receive paths as a session on this host: messages become
 * peer turns with no authority, files are kept aside and hand-offs saved unstarted, each only with the
 * operator's yes at this machine's terminal. The setting is read from the user settings alone, so a
 * project cannot open this machine to the user's other devices.
 */
import { join } from 'node:path';

import { readSettings } from '@robota-sdk/agent-framework';
import { WsMeshRelayClient, type IMeshRelay } from '@robota-sdk/agent-transport-webrtc';

import { holdExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { describeReceived } from '../peer-files/receiving.js';
import { robotaUserSettingsPath } from '../product/robota-user-settings.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import {
  openDeviceMesh,
  type IDeviceMeshEndpoint,
  type IDeviceMeshLanOptions,
  type IOpenDeviceMeshOptions,
} from './device-mesh.js';
import { readIdentityState } from './identity-state.js';
import {
  acceptDeviceChannels,
  handoffToDevice,
  sendFileToDevice,
  type IDeviceFileSendResult,
} from './mesh-files.js';
import { MeshMessaging } from './mesh-messaging.js';
import { parseMeshSettings, type IMeshSettings } from './mesh-settings.js';

import type { IHandoffArrival } from '../handoff/handoff-receiving.js';
import type { TReceiveHandoffOutcome } from '../handoff/handoff-receive.js';
import type { IPushHandoffOptions, IPushHandoffResult } from '../handoff/handoff-push.js';
import type { IOutgoingFile } from '../peer-files/outgoing-file.js';
import type { IPeerIngressPort, IPeerSendOptions } from '../remote-control/local-peer-messaging.js';
import type { IDevicesMeshStatus } from '@robota-sdk/agent-command';
import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { ILinkedDeviceSummary } from '@robota-sdk/agent-framework';
import type {
  IOperatorApprover,
  IPeerMessageAck,
} from '@robota-sdk/agent-interface-session-mobility';
import type { IDeviceMeshLink } from '@robota-sdk/agent-transport-webrtc';

export interface IDeviceMeshHostOptions {
  /** Where things are said to the operator. */
  readonly report: (message: string) => void;
  /** Defaults to `~/.robota` under the current `HOME`. */
  readonly root?: string;
  /** Defaults to the host credential store. */
  readonly store?: ICredentialStore;
  /** The user settings' `transports`; defaults to the user settings file, never a project's. */
  readonly readTransports?: () => unknown;
  /** Test seam: open the endpoint. */
  readonly open?: (options: IOpenDeviceMeshOptions) => Promise<IDeviceMeshEndpoint>;
  /**
   * The user's own relay; defaults to one at `transports.webrtc.options.relayUrl`, the relay
   * `/remote-control` uses, when that is set.
   */
  readonly relay?: (onError: (error: Error) => void) => IMeshRelay | undefined;
  /** Test seam: the local network, or `false` for none. Defaults to mDNS and remembered addresses. */
  readonly lan?: IDeviceMeshLanOptions | false;
  readonly connectTimeoutMs?: number;
}

/** What the live session gives the mesh once there is one. */
export interface IDeviceMeshBinding {
  readonly ingress?: IPeerIngressPort;
  readonly handoff?: {
    readonly receive: (arrival: IHandoffArrival) => Promise<TReceiveHandoffOutcome>;
    readonly onOutcome: (fromDeviceId: string, outcome: TReceiveHandoffOutcome) => void;
  };
}

export interface IDeviceMeshHost {
  /** Open the mesh if the settings turn it on; never throws. */
  start(options: { readonly operatorApprover?: IOperatorApprover }): Promise<void>;
  bind(binding: IDeviceMeshBinding): void;
  status(): IDevicesMeshStatus;
  /** The devices linked now. */
  devices(): readonly ILinkedDeviceSummary[];
  isLinked(deviceId: string): boolean;
  /** This device's id while the mesh is open. */
  ownDeviceId(): string | undefined;
  send(deviceId: string, text: string, options?: IPeerSendOptions): Promise<IPeerMessageAck>;
  sendFile(deviceId: string, file: IOutgoingFile): Promise<IDeviceFileSendResult>;
  /** Rejects when `deviceId` is not linked. */
  handoff(
    deviceId: string,
    options: Omit<IPushHandoffOptions, 'openChannel' | 'carrierBinding'>,
  ): Promise<IPushHandoffResult>;
  close(): void;
}

interface ILinked {
  readonly link: IDeviceMeshLink;
  readonly name: string | undefined;
  readonly stop: () => void;
}

function userTransports(): unknown {
  return readSettings(robotaUserSettingsPath()).transports;
}

/** `transports.webrtc.options.relayUrl`, when set. */
function relayUrlOf(transports: unknown): string | undefined {
  const webrtc = (transports as { webrtc?: { options?: { relayUrl?: unknown } } } | undefined)
    ?.webrtc;
  const url = typeof webrtc === 'object' && webrtc !== null ? webrtc.options?.relayUrl : undefined;
  return typeof url === 'string' && url.length > 0 ? url : undefined;
}

/**
 * Whether the mesh reaches beyond the local network: public discovery, or a TURN relay — this
 * device's own for its other devices, the user's TURN servers, or relayed connections only.
 */
function hasInternet(settings: IMeshSettings): boolean {
  const { dht, pkarrRelays, nostrRelays, relay, turnServers, relayOnly } = settings.internet;
  return (
    dht ||
    pkarrRelays.length > 0 ||
    nostrRelays.length > 0 ||
    relay.serve ||
    turnServers.length > 0 ||
    relayOnly
  );
}

function servers(count: number): string {
  return `${count} TURN server${count === 1 ? '' : 's'} of yours`;
}

/** How this device finds the others, in the operator's words. */
function describeSources(
  settings: IMeshSettings,
  lan: boolean,
  ownRelay: boolean,
): readonly string[] {
  const { dht, pkarrRelays, nostrRelays, relay, turnServers, relayOnly } = settings.internet;
  const turn = turnServers.length > 0 ? `, then ${servers(turnServers.length)}` : '';
  return [
    ...(lan ? ['the local network (mDNS, remembered addresses)'] : []),
    ...(dht ? ['the Mainline DHT'] : []),
    ...(!dht && pkarrRelays.length > 0 ? [`${pkarrRelays.length} pkarr relays`] : []),
    ...(nostrRelays.length > 0 ? [`${nostrRelays.length} Nostr relays`] : []),
    ...(ownRelay ? ['your own relay'] : []),
    ...(relayOnly
      ? [`relays only: the relays your devices run${turn}`]
      : turnServers.length > 0
        ? [`${servers(turnServers.length)} when no direct path works`]
        : []),
    ...(relay.serve ? [`your relay for your other devices, on port ${relay.port}`] : []),
  ];
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** How long to try for the device's mesh before deciding another session holds it. */
const HOLD_ATTEMPT_MS = 250;

/**
 * Hold `path` exclusively until the returned function is called — which removes the lock before it
 * returns — or `undefined` when another live holder has it. A holder that died is taken over once
 * its lock goes stale.
 */
async function holdUntilReleased(path: string): Promise<(() => void) | undefined> {
  try {
    const lock = await holdExclusiveFileLock(path, { timeoutMs: HOLD_ATTEMPT_MS });
    return () => lock.release();
  } catch {
    // allow-fallback: held elsewhere; the caller says so
    return undefined;
  }
}

function notLinked(deviceId: string): string {
  return `device ${deviceId} is not linked right now. Run /peers to see which are.`;
}

export function createDeviceMeshHost(options: IDeviceMeshHostOptions): IDeviceMeshHost {
  const root = options.root ?? userLocalStorageRoot();
  const links = new Map<string, ILinked>();
  let binding: IDeviceMeshBinding = {};
  let state: IDevicesMeshStatus['state'] = 'off';
  let reason: string | undefined;
  let sources: readonly string[] = [];
  let endpoint: IDeviceMeshEndpoint | undefined;
  let ownRelay: IMeshRelay | undefined;
  let own: string | undefined;
  let closed = false;
  let relayErrorSaid = false;
  /** Lets go of this device's mesh, held while this session has it open. */
  let release: (() => void) | undefined;

  const report = (text: string): void => {
    try {
      options.report(text);
    } catch {
      // allow-fallback: there is nowhere left to report a reporter that throws.
    }
  };
  const messaging = new MeshMessaging({ ingress: () => binding.ingress, report });

  const letGo = (): void => {
    release?.();
    release = undefined;
  };

  const fail = (why: string): void => {
    letGo();
    state = 'failed';
    reason = why;
    report(`The device mesh could not start: ${why}`);
  };

  const nameOf = (deviceId: string): string | undefined => {
    try {
      return readIdentityState(join(root, 'devices'))?.roster.devices.find(
        (device) => device.deviceId === deviceId,
      )?.name;
    } catch {
      // allow-fallback: the name is display only
      return undefined;
    }
  };

  const adopt = (link: IDeviceMeshLink, self: string): void => {
    const deviceId = link.admission.deviceId;
    links.get(deviceId)?.stop();
    const offMessages = messaging.attach(link);
    const offChannels = acceptDeviceChannels(link, {
      files: {
        root,
        onOutcome: (outcome) => report(describeReceived(`device ${deviceId}`, outcome)),
      },
      handoff: {
        deviceId: self,
        receive: async (arrival) => {
          const handoff = binding.handoff;
          if (handoff === undefined) {
            arrival.channel.close();
            return {
              received: false,
              reason: 'closed',
              detail: 'no session is ready to take it here',
            };
          }
          return handoff.receive(arrival);
        },
        onOutcome: (outcome) => binding.handoff?.onOutcome(deviceId, outcome),
      },
    });
    const entry: ILinked = {
      link,
      name: nameOf(deviceId),
      stop: () => {
        offMessages();
        offChannels();
        offClose();
      },
    };
    const offClose = link.onClose(() => {
      if (links.get(deviceId) !== entry) return;
      entry.stop();
      links.delete(deviceId);
    });
    links.set(deviceId, entry);
  };

  const linkOf = (deviceId: string): IDeviceMeshLink | undefined => links.get(deviceId)?.link;

  const shut = (): void => {
    for (const entry of links.values()) entry.stop();
    links.clear();
    endpoint?.close();
    endpoint = undefined;
    ownRelay?.close();
    ownRelay = undefined;
    own = undefined;
    letGo();
  };

  return {
    start: async ({ operatorApprover }) => {
      if (closed || state !== 'off') return;
      let settings: IMeshSettings;
      let transports: unknown;
      try {
        transports = (options.readTransports ?? userTransports)();
        settings = parseMeshSettings(transports);
      } catch (error) {
        fail(message(error));
        return;
      }
      if (!settings.enabled) return;
      let identity;
      try {
        identity = readIdentityState(join(root, 'devices'));
      } catch (error) {
        fail(message(error));
        return;
      }
      if (identity === undefined) {
        report(
          'The device mesh is on in your settings, but this device has no identity yet. ' +
            'Run `/devices init`; the mesh opens in the next session.',
        );
        return;
      }
      // One session per device: the peer devices keep one link to this device, and a second
      // endpoint would take it from the first.
      state = 'starting';
      const held = await holdUntilReleased(join(root, 'devices', 'mesh.lock'));
      if (held === undefined) {
        fail('another Robota session on this device has it open, and links the devices there');
        return;
      }
      release = held;
      if (closed) {
        letGo();
        return;
      }
      const url = relayUrlOf(transports);
      const onRelayError = (error: Error): void => {
        // Said once: a relay that keeps failing would otherwise repeat itself for the whole session.
        if (relayErrorSaid) return;
        relayErrorSaid = true;
        report(`The device mesh's relay failed; the other ways still work: ${error.message}`);
      };
      try {
        ownRelay =
          options.relay !== undefined
            ? options.relay(onRelayError)
            : url === undefined
              ? undefined
              : new WsMeshRelayClient({ url, onError: onRelayError });
      } catch (error) {
        fail(message(error));
        return;
      }
      const lan = options.lan === false ? undefined : (options.lan ?? {});
      const internet = hasInternet(settings);
      sources = describeSources(settings, lan !== undefined, ownRelay !== undefined);
      let opened: IDeviceMeshEndpoint;
      try {
        const store =
          options.store ?? createHostCredentialStore({ root, notify: () => undefined }).store;
        opened = await (options.open ?? openDeviceMesh)({
          root,
          store,
          localPolicy: settings.policy,
          ...(ownRelay !== undefined ? { relay: ownRelay } : {}),
          ...(lan !== undefined ? { lan } : {}),
          ...(internet ? { internet: { settings: settings.internet } } : {}),
          ...(operatorApprover !== undefined ? { operatorApprover } : {}),
          ...(options.connectTimeoutMs !== undefined
            ? { connectTimeoutMs: options.connectTimeoutMs }
            : {}),
          // A list that could not be saved is taken again from the next peer that has it.
          onError: () => undefined,
        });
      } catch (error) {
        ownRelay?.close();
        ownRelay = undefined;
        // After exit there is nobody to tell.
        if (closed) letGo();
        else fail(message(error));
        return;
      }
      endpoint = opened;
      if (closed) {
        shut();
        return;
      }
      own = identity.deviceCertificate.deviceId;
      const self = own;
      opened.node.onLink((link) => adopt(link, self));
      state = 'on';
    },
    bind: (next) => {
      binding = { ...binding, ...next };
    },
    status: () => ({
      state,
      ...(reason !== undefined ? { reason } : {}),
      sources: state === 'on' || state === 'starting' ? sources : [],
      linked: [...links.values()].map(({ link, name }) => ({
        deviceId: link.admission.deviceId,
        ...(name !== undefined ? { name } : {}),
        locality: link.admission.locality,
      })),
    }),
    devices: () =>
      [...links.values()].map(({ link, name }) => ({
        deviceId: link.admission.deviceId,
        ...(name !== undefined ? { name } : {}),
        locality: link.admission.locality,
      })),
    isLinked: (deviceId) => links.has(deviceId),
    ownDeviceId: () => own,
    send: async (deviceId, text, sendOptions) => {
      const link = linkOf(deviceId);
      if (link === undefined)
        return { id: '', sequence: 0, state: 'refused', reason: notLinked(deviceId) };
      return messaging.send(link, text, sendOptions);
    },
    sendFile: async (deviceId, file) => {
      const link = linkOf(deviceId);
      return link === undefined
        ? { state: 'refused', reason: notLinked(deviceId) }
        : sendFileToDevice(link, file);
    },
    handoff: async (deviceId, handoffOptions) => {
      const link = linkOf(deviceId);
      if (link === undefined) throw new Error(notLinked(deviceId));
      return handoffToDevice(link, handoffOptions);
    },
    close: () => {
      closed = true;
      shut();
      state = 'off';
      reason = undefined;
    },
  };
}

import { join } from 'node:path';

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { readSettings } from '@robota-sdk/agent-framework';
import { robotaUserSettingsPath } from '../product/robota-user-settings.js';

import { createHostCredentialStore } from '../credentials/select-credential-store.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import { loadOrCreateHostIdentity } from './host-identity.js';
import { parseIceServers } from './ice-config.js';
import { renderQrToTerminal } from './render-qr.js';
import { RemoteControlController } from './remote-control-controller.js';
import { createRemoteControlTransportHost } from './transport-host-adapter.js';
import { createTrustedDeviceStore } from './trusted-device-store.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { TransportRegistry } from '@robota-sdk/agent-framework';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { ISessionMessageHandlerOptions } from '@robota-sdk/agent-transport';

type TUsageReporters = Pick<
  ISessionMessageHandlerOptions,
  'personalUsageReporter' | 'usageReporter' | 'storedSessionUsageReporter'
>;

/** The surface the controller needs from the live TUI channel (structural — no coupling to the class). */
interface ILiveChannel {
  getSession(): IInteractiveSession;
  readonly stateManager: { addEntry(entry: IHistoryEntry): void };
}

export { RemoteControlController } from './remote-control-controller.js';
export type { IRemoteControlControllerDeps } from './remote-control-controller.js';

/** Read a nested string under `transports.webrtc.options.<key>` from user settings (undefined when absent). */
function readWebrtcOption(key: string): string | undefined {
  const settings = readSettings(robotaUserSettingsPath());
  const transports = settings.transports;
  if (typeof transports !== 'object' || transports === null) return undefined;
  const webrtc = (transports as Record<string, unknown>).webrtc;
  if (typeof webrtc !== 'object' || webrtc === null) return undefined;
  const options = (webrtc as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) return undefined;
  const value = (options as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read a raw (untyped) value under `transports.webrtc.options.<key>` — for structured values (REMOTE-010). */
function readWebrtcRawOption(key: string): unknown {
  const settings = readSettings(robotaUserSettingsPath());
  const transports = settings.transports;
  if (typeof transports !== 'object' || transports === null) return undefined;
  const webrtc = (transports as Record<string, unknown>).webrtc;
  if (typeof webrtc !== 'object' || webrtc === null) return undefined;
  const options = (webrtc as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) return undefined;
  return (options as Record<string, unknown>)[key];
}

/**
 * Build the `/remote-control` controller at the composition root. The returned `setChannel` is called from
 * `onChannelReady` (each live channel, incl. session-switch re-creations) so the enable path attaches the
 * session the user is actually driving and surfaces async failures into that channel's history.
 */
export function createRemoteControlController(
  registry: TransportRegistry,
  usageReporters?: TUsageReporters,
): {
  controller: RemoteControlController;
  setChannel: (channel: ILiveChannel | undefined) => void;
} {
  let channel: ILiveChannel | undefined;
  const report = (message: string): void =>
    channel?.stateManager.addEntry(messageToHistoryEntry(createSystemMessage(message)));
  // The host identity key lives in the credential store: the OS keychain, or an owner-only file under
  // ~/.robota where no keychain works. The backend is chosen at first use and named in the status.
  const root = userLocalStorageRoot();
  const credentials = createHostCredentialStore({ root, notify: report });
  const controller = new RemoteControlController({
    host: createRemoteControlTransportHost(registry),
    ...(usageReporters ? { usageReporters } : {}),
    readRelayUrl: () => readWebrtcOption('relayUrl'),
    readClientUrl: () => readWebrtcOption('clientUrl'),
    readIceServers: () => parseIceServers(readWebrtcRawOption('iceServers')),
    readForceTurn: () => readWebrtcRawOption('forceTurn') === true,
    getSession: () => channel?.getSession(),
    renderQr: renderQrToTerminal,
    reportError: report,
    // REMOTE-012 E3: TOFU trusted-device reconnect is on by default — the host identity + device store live
    // under ~/.robota (like an SSH host key + known_hosts). A returning device reconnects without re-pairing;
    // a new device enrolls on first pair after the explicit accept.
    trustedDeviceStore: createTrustedDeviceStore(),
    loadHostIdentity: () =>
      loadOrCreateHostIdentity({
        store: credentials.store,
        lockPath: join(root, 'remote-host-identity.lock'),
        legacyFilePath: join(root, 'remote-host-identity.json'),
        notify: report,
      }),
    describeKeyStorage: () => credentials.describe(),
  });
  return {
    controller,
    setChannel: (next) => {
      channel = next;
    },
  };
}

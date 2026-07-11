import { getUserSettingsPath, readSettings } from '@robota-sdk/agent-framework';

import { renderQrToTerminal } from './render-qr.js';
import { RemoteControlController } from './remote-control-controller.js';

import type { TransportRegistry } from '@robota-sdk/agent-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-transport';

export { RemoteControlController } from './remote-control-controller.js';
export type { IRemoteControlControllerDeps } from './remote-control-controller.js';

/** Read a nested string under `transports.webrtc.options.<key>` from user settings (undefined when absent). */
function readWebrtcOption(key: string): string | undefined {
  const settings = readSettings(getUserSettingsPath());
  const transports = settings.transports;
  if (typeof transports !== 'object' || transports === null) return undefined;
  const webrtc = (transports as Record<string, unknown>).webrtc;
  if (typeof webrtc !== 'object' || webrtc === null) return undefined;
  const options = (webrtc as Record<string, unknown>).options;
  if (typeof options !== 'object' || options === null) return undefined;
  const value = (options as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Build the `/remote-control` controller at the composition root. The returned `setSession` is called from
 * `onChannelReady` (each live channel) so the enable path can attach the current session.
 */
export function createRemoteControlController(registry: TransportRegistry): {
  controller: RemoteControlController;
  setSession: (session: IInteractiveSession | undefined) => void;
} {
  let session: IInteractiveSession | undefined;
  const controller = new RemoteControlController({
    registry,
    readRelayUrl: () => readWebrtcOption('relayUrl'),
    readClientUrl: () => readWebrtcOption('clientUrl'),
    getSession: () => session,
    renderQr: renderQrToTerminal,
  });
  return {
    controller,
    setSession: (next) => {
      session = next;
    },
  };
}

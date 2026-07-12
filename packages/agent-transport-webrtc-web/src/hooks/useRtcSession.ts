/**
 * React hook that connects to a paired host over WebRTC (REMOTE-009 Stage D) and reconstructs conversation
 * state from the TServerMessage stream.
 *
 * The transport-neutral session reducer (`useSessionClient`) and its state/handle types live in
 * `@robota-sdk/agent-transport-gui` (the GUI presentation core). This module owns only the browser-remote
 * (WebRTC) surface: it widens the status union with the RTC pairing/failed states and wires the RTC client.
 */

import {
  useSessionClient,
  type IWsSessionState,
  type TMakeSessionClient,
  type TConnectionStatus,
} from '@robota-sdk/agent-transport-gui';
import { useCallback, useMemo } from 'react';

import { createDeviceCredentialStore } from '../client/device-credential-store.js';
import {
  createRtcSessionClient,
  type IRtcSessionClientOptions,
  type TRtcConnectionStatus,
} from '../client/rtc-session-client.js';

/** The connection status shown by the browser-remote UI — the WS statuses plus the RTC pairing/failed states. */
export type TSessionStatus = TConnectionStatus | TRtcConnectionStatus;

/** Connect to a paired host over WebRTC (REMOTE-009 Stage D). Memoized on the primitive connection fields. */
export function useRtcSession(
  options: Pick<
    IRtcSessionClientOptions,
    'relayUrl' | 'rendezvous' | 'secret' | 'iceServers' | 'forceTurn'
  >,
): IWsSessionState<TSessionStatus> {
  const { relayUrl, rendezvous, secret, iceServers, forceTurn } = options;
  // REMOTE-012 E3: a stable per-session credential store (IndexedDB) so first-pair enrolls this device.
  const deviceCredentials = useMemo(() => createDeviceCredentialStore(), []);
  const makeClient = useCallback<TMakeSessionClient<TSessionStatus>>(
    (cb) =>
      createRtcSessionClient(
        {
          relayUrl,
          rendezvous,
          secret,
          ...(iceServers ? { iceServers } : {}),
          ...(forceTurn ? { forceTurn } : {}),
          deviceCredentials,
        },
        cb,
      ),
    [relayUrl, rendezvous, secret, iceServers, forceTurn, deviceCredentials],
  );
  return useSessionClient<TSessionStatus>(makeClient);
}

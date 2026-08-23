/**
 * Constructing the pairing-gated WebRTC transport the remote-control controller registers.
 *
 * "How a transport is built from resolved inputs" is a different subject from "what state the
 * remote-control session is in", which is the controller's. Split out because that file had reached
 * its size ratchet, where the rule is to split rather than extend — and because this is the one
 * place a new transport option is threaded, so it is worth being findable.
 */

import { WebRtcTransport } from '@robota-sdk/agent-transport-webrtc';

import type {
  IIceServer,
  IHostReconnectConfig,
  ILocalPeerProof,
  ISignalingClient,
} from '@robota-sdk/agent-transport-webrtc';
import type { IPairingResult } from '@robota-sdk/agent-remote-pairing';
import type { IConfigurableTransport } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type { SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

export interface ITransportHooks {
  readonly onPaired: (result?: IPairingResult) => void;
  readonly onPairingFailed: () => void;
  readonly onDropped?: () => void;
}

export interface IIceOptions {
  readonly iceServers?: readonly IIceServer[];
  readonly forceTurn?: boolean;
}

/**
 * Build the transport.
 *
 * Optional inputs are spread conditionally rather than passed as `undefined`: the transport's
 * options are `exactOptionalPropertyTypes`-strict, and "absent" is a different statement from
 * "present and undefined" for every one of them — `localPeer` most of all, where absent means the
 * gate behaves as before (a REMOTE peer has no guarded rendezvous to have reached, so demanding one
 * unconditionally would refuse every legitimate remote session).
 */
export function defaultCreateTransport(
  signaling: ISignalingClient,
  secret: string,
  hooks: ITransportHooks,
  ice: IIceOptions,
  reconnect?: IHostReconnectConfig,
  resumeBridge?: SessionResumeBridge,
  localPeer?: ILocalPeerProof,
): IConfigurableTransport<IInteractiveSession> {
  return new WebRtcTransport({
    signaling,
    secret,
    onPaired: hooks.onPaired,
    onPairingFailed: hooks.onPairingFailed,
    ...(hooks.onDropped ? { onDropped: hooks.onDropped } : {}),
    ...(ice.iceServers ? { iceServers: ice.iceServers } : {}),
    ...(ice.forceTurn ? { forceTurn: ice.forceTurn } : {}),
    ...(reconnect ? { reconnect } : {}),
    ...(resumeBridge ? { resumeBridge } : {}),
    ...(localPeer ? { localPeer } : {}),
  });
}

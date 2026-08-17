/**
 * Wiring an admitted channel to the session — the step immediately after the gate says yes.
 *
 * "How session frames travel once admission is settled" is a different subject from "what may reach
 * the session at all", which is the gate's. Split out for the same reason the frame vocabulary and
 * the controllers already were: `pairing-gate.ts` is at its size limit, and the rule there is to
 * split rather than extend.
 *
 * Two carriers, chosen by whether a resume bridge exists. Neither decides anything about admission —
 * by the time either runs, that question is closed.
 */

import { createWsHandler, type SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

import { createChannelDelivery } from './channel-delivery.js';

import type { IPairingChannel } from './pairing-gate.js';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

export interface IAttachSessionOptions {
  readonly channel: IPairingChannel;
  readonly session: IProtocolSession;
  readonly resumeBridge?: SessionResumeBridge;
  readonly createHandler?: typeof createWsHandler;
}

export interface IAttachedSession {
  /** Where post-accept inbound frames go. */
  readonly onSessionMessage: (data: string) => void;
  /** Detach (bridge) or dispose (handler). The gate calls this on teardown. */
  readonly cleanup: () => void;
}

/**
 * Attach the admitted channel to the session.
 *
 * `viaReconnect` is threaded through rather than inferred: on a reconnect the bridge must hold live
 * forwarding until the client's `resume` replays the buffered tail, and getting that backwards
 * delivers new frames ahead of the replay — an ordering bug that looks like data loss.
 */
export function attachSession(
  options: IAttachSessionOptions,
  viaReconnect: boolean,
  onDeliveryError: (error: Error, event: string) => void,
): IAttachedSession {
  const bridge = options.resumeBridge;
  if (bridge) {
    // REMOTE-013 E4: route the session through the persistent bridge. Attach this channel as the
    // sink; post-accept inbound frames (incl. resume/ack) go to the bridge; cleanup DETACHES it
    // (never disposes — the bridge is owned by the transport across reconnects).
    bridge.attach((data) => options.channel.send(data), {
      awaitResume: viaReconnect,
      onDeliveryError,
    });
    return {
      onSessionMessage: (data) => bridge.onClientMessage(data),
      cleanup: () => bridge.detach(),
    };
  }

  const create = options.createHandler ?? createWsHandler;
  // ARCH-030: the gate is the carrier on this branch — its own channel sink, its own failure policy.
  const { onMessage, cleanup } = create({
    session: options.session,
    deliver: createChannelDelivery(options.channel, onDeliveryError),
  });
  return { onSessionMessage: onMessage, cleanup };
}

/**
 * How a message from a peer — another session on this host, or another of the user's devices —
 * becomes a turn of the live session: a peer turn attributed to the sender the carrier confirmed and
 * answered to it, under the session's ordinary permissions, counted against the sender's rate limit.
 */

import { PeerMessageIngress } from '@robota-sdk/agent-framework';

import type { IPeerIngressPort } from './local-peer-messaging.js';
import type { IPeerTurnContext, ITurnHandle } from '@robota-sdk/agent-interface-session';
import type { IPeerMessageIngress } from '@robota-sdk/agent-interface-session-mobility';

/** The one session operation peer messaging needs — narrow, so no caller can grow a second one. */
export interface IPeerIngressSession {
  submit(
    input: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    options: {
      turnSource: 'peer';
      driverId?: string;
      onAccepted?: (handle: ITurnHandle) => void;
      peer?: IPeerTurnContext;
    },
  ): Promise<ITurnHandle>;
}

/** Deliver each admitted message into the session `getSession` names when it arrives. */
export function sessionPeerIngress(getSession: () => IPeerIngressSession): IPeerIngressPort {
  return {
    // One ingress per message, so the turn it submits carries THAT message's reply route, taken from
    // admission and never from the message.
    receive: (incoming: IPeerMessageIngress) =>
      new PeerMessageIngress({
        // The driver id is NOT taken from the arriving message: the carrier's side derives it from
        // the confirmed sender before this is reached, so a peer cannot pick the name a transcript's
        // reader trusts.
        submit: (input, origin, onAccepted) =>
          getSession().submit(input, undefined, undefined, {
            turnSource: 'peer',
            ...(origin.driverId !== undefined ? { driverId: origin.driverId } : {}),
            onAccepted,
            peer: { messageId: incoming.message.id, replyTo: origin.sessionId },
          }),
      }).receive(incoming),
  };
}

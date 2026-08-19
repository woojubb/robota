/**
 * Constructing the admission controllers the gate drives.
 *
 * "Which controller runs, with what inputs" is a different subject from "what state is the gate in
 * and what may reach the session" — the same boundary that already moved the frame vocabulary into
 * `pairing-frames.ts` and the best-effort channel calls into `pairing-channel-lifecycle.ts`.
 *
 * Split out because `pairing-gate.ts` had reached the size limit, where the rule is to split rather
 * than extend. These two functions were the largest thing in it that was not about gating, and they
 * touch nothing of the gate's own state: they take inputs, wire a controller's `send` to the
 * channel, and hand back the controller plus a settled/rejected outcome for the caller to act on.
 */

import { startHostReconnect, startPairingHandshake } from '@robota-sdk/agent-remote-pairing';

import { pairingChannel } from './pairing-channel-lifecycle.js';

import type { IHostReconnectConfig, IPairingChannel } from './pairing-gate.js';
import type { IPairingResult, TPairingRole } from '@robota-sdk/agent-remote-pairing';

/** What both controllers need to talk on the channel and bind to it. */
export interface IControllerContext {
  readonly channel: IPairingChannel;
  readonly localFingerprint: string;
  readonly remoteFingerprint: string;
  /** Handshake timeout (ms); fail closed on expiry. */
  readonly timeoutMs?: number;
}

/**
 * Start the B3 first-pair handshake.
 *
 * `onAccepted`/`onRejected` rather than handing the promise back, so a caller cannot forget to
 * attach a rejection path — an unhandled rejection here would leave a gate waiting forever on a
 * handshake that already failed, which is a fail-OPEN shaped as a hang.
 */
export function startFirstPairController(
  context: IControllerContext,
  secret: string,
  role: TPairingRole,
  onAccepted: (result: IPairingResult) => void,
  onRejected: () => void,
  start: typeof startPairingHandshake = startPairingHandshake,
): ReturnType<typeof startPairingHandshake> {
  const controller = start({
    secret,
    role,
    localFingerprint: context.localFingerprint,
    remoteFingerprint: context.remoteFingerprint,
    send: (frame) => pairingChannel.send(context.channel, JSON.stringify(frame)),
    ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
  });
  controller.result.then(onAccepted, onRejected);
  return controller;
}

/** Start the E3 host-side reconnect exchange against a pinned device key. */
export function startReconnectController(
  context: IControllerContext,
  config: IHostReconnectConfig,
  onAccepted: () => void,
  onRejected: () => void,
): ReturnType<typeof startHostReconnect> {
  const controller = startHostReconnect({
    hostIdentityId: config.hostIdentityId,
    localFingerprint: context.localFingerprint,
    remoteFingerprint: context.remoteFingerprint,
    hostPrivateKey: config.hostPrivateKey,
    resolveDevicePublicKey: config.resolveDevicePublicKey,
    send: (frame) => pairingChannel.send(context.channel, JSON.stringify(frame)),
    ...(context.timeoutMs !== undefined ? { timeoutMs: context.timeoutMs } : {}),
  });
  controller.result.then(onAccepted, onRejected);
  return controller;
}

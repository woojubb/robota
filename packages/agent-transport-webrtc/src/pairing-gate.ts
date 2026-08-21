/**
 * Pairing gate for the WebRTC data channel (REMOTE-008 Stage B4-2b; extended for REMOTE-012 Stage E3 TOFU
 * reconnect).
 *
 * The data channel is phase-separated: pre-accept it carries pairing/reconnect frames, post-accept only
 * session messages. An eager subscription feeds {@link PairingGate.onInbound}; the session bridge is not
 * built until acceptance, so no pre-accept peer frame can reach the live session.
 *
 * E3 selects first-pair (`pair-nonce`, then identity-key enrollment) or reconnect (`rc-hello`, pinned
 * identities) from the client's first frame and exposes the session only after mutual acceptance.
 *
 * Fail-closed: a non-admission frame pre-accept is DROPPED; the handshake `result` is the ONLY accept signal;
 * on reject/timeout the channel is closed and no session bridge is ever created; a post-close frame is ignored.
 *
 * When no E3 `reconnect` config is supplied the gate is **exactly** the B4 first-pair-only gate (eager host
 * `pair-nonce`, no enrollment, no reconnect) — preserving existing behavior.
 *
 * SEC-010 adds an optional `local-proof` step between handshake acceptance and session exposure; see
 * `local-peer-proof.ts` for why both of those edges are load-bearing.
 */

import {
  deriveIdentityId,
  importPublicKey,
  startPairingHandshake,
  type IPairingResult,
  type TPairingRole,
} from '@robota-sdk/agent-remote-pairing';
import { createWsHandler, type SessionResumeBridge } from '@robota-sdk/agent-transport-protocol';

import { nextAdmissionStep } from './admission-steps.js';
import type {
  IHostReconnectConfig,
  IPairingChannel,
  IPairingGateOptions,
} from './pairing-gate-options.js';

// Re-exported so every existing import of these names keeps working: the split moved where they are
// DECLARED, and moving where they are imported from would be a migration this change is not.
export type { IHostReconnectConfig, IPairingChannel, IPairingGateOptions };
import { judgeHandoffGrant, type IHandoffGrantProof } from './handoff-grant-gate.js';
import { judgeLocalProof, type ILocalPeerProof } from './local-peer-proof.js';
import { pairingChannel } from './pairing-channel-lifecycle.js';
import { startFirstPairController, startReconnectController } from './pairing-controllers.js';
import { isEnrollFrame, isPairingFrame, isReconnectFrame } from './pairing-frames.js';
import { attachSession } from './session-attachment.js';

import type { IEnrollFrame } from './pairing-frames.js';
import type { IProtocolSession } from '@robota-sdk/agent-transport-protocol';

type TGateState =
  | 'awaiting-mode'
  | 'pairing'
  | 'enrolling'
  | 'reconnecting'
  | 'local-proof'
  | 'handoff-grant'
  | 'accepted'
  | 'closed';

export class PairingGate {
  private state: TGateState;
  /** Session message router — built ONLY on accept (nothing reaches the session before). */
  private onSessionMessage?: (data: string) => void;
  private handlerCleanup?: () => void;
  private pairingController?: ReturnType<typeof startPairingHandshake>;
  private reconnectController?: ReturnType<typeof startReconnectController>;
  /** The first-pair result, held so it can be surfaced on accept (E4 uses its sessionKey). */
  private pendingResult?: IPairingResult;
  /** Held across the local-proof step so the reconnect ordering rule survives the detour. */
  private pendingViaReconnect = false;

  constructor(private readonly options: IPairingGateOptions) {
    if (options.reconnect) {
      // E3 mode: stay reactive — the client's first frame selects first-pair vs reconnect.
      this.state = 'awaiting-mode';
    } else {
      // Legacy B4 mode: eagerly start the first-pair handshake (host sends pair-nonce immediately).
      this.state = 'pairing';
      this.startFirstPair();
    }
  }

  /**
   * Route one inbound channel frame. Pre-accept: admission frames → the active controller, everything else
   * DROPPED. Post-accept: session messages → the session bridge. Post-close: ignored.
   */
  onInbound(data: string): void {
    if (this.state === 'closed') return;
    if (this.state === 'accepted') {
      this.onSessionMessage?.(data);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // undecodable pre-accept frame → drop
    }

    if (this.state === 'awaiting-mode') {
      // First frame selects the mode (E3).
      if (isReconnectFrame(parsed) && parsed.t === 'rc-hello') {
        this.state = 'reconnecting';
        this.startReconnect();
        this.reconnectController?.onFrame(parsed);
      } else if (isPairingFrame(parsed) && parsed.t === 'pair-nonce') {
        this.state = 'pairing';
        this.startFirstPair();
        this.pairingController?.onFrame(parsed);
      }
      // anything else pre-mode → drop
      return;
    }

    if (this.state === 'pairing') {
      if (isPairingFrame(parsed)) this.pairingController?.onFrame(parsed);
      return;
    }

    if (this.state === 'reconnecting') {
      if (isReconnectFrame(parsed)) this.reconnectController?.onFrame(parsed);
      return;
    }

    if (this.state === 'local-proof') {
      const admission = judgeLocalProof(parsed, this.options.localPeer);
      this.options.localPeer?.onAdmission?.(admission);
      if (admission.admitted) this.accept(this.pendingResult, this.pendingViaReconnect);
      else this.rejectAndClose();
      return;
    }

    if (this.state === 'handoff-grant') {
      // Verifying a signature is async, and this handler is not. The promise is consumed here rather
      // than returned so a rejection cannot escape into the channel's message subscription — an
      // unhandled rejection would leave the gate parked in this state with the channel open, which
      // is a hang. `judgeHandoffGrant` already converts a throw into a refusal; this is the second
      // layer, because a gate that can hang is a gate that fails open by waiting.
      void this.judgeGrantFrame(parsed);
      return;
    }

    if (this.state === 'enrolling') {
      // Awaiting the peer's identity public key to pin, then expose the session.
      if (isEnrollFrame(parsed)) this.completeEnrollment(parsed.spki);
      return;
    }
  }

  /** Tear down: cleanup the session bridge (if built) and mark closed. Idempotent. */
  cleanup(): void {
    this.state = 'closed';
    this.handlerCleanup?.();
    this.handlerCleanup = undefined;
    this.onSessionMessage = undefined;
  }

  private startFirstPair(): void {
    // `IPairingGateOptions` already carries every field `IControllerContext` asks for, so it is
    // passed straight through — projecting it field by field would be a copy to keep in step.
    this.pairingController = startFirstPairController(
      this.options,
      this.options.secret,
      this.options.role,
      (result) => this.onFirstPairAccepted(result),
      () => this.rejectAndClose(),
      this.options.startHandshake ?? startPairingHandshake,
    );
  }

  private startReconnect(): void {
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.rejectAndClose();
      return;
    }
    this.reconnectController = startReconnectController(
      this.options,
      cfg,
      // reconnect → hold live forwarding until the client's resume replays
      () => this.accept(undefined, true),
      () => this.rejectAndClose(),
    );
  }

  /** B3 handshake accepted. Without E3: expose immediately. With E3: run first-pair enrollment first. */
  private onFirstPairAccepted(result: IPairingResult): void {
    if (this.state !== 'pairing') return;
    this.pendingResult = result;
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.accept(result);
      return;
    }
    // E3 enrollment: advertise the host public key; the peer's `enroll-key` completes it (then expose).
    this.state = 'enrolling';
    pairingChannel.send(
      this.options.channel,
      JSON.stringify({ t: 'enroll-key', spki: cfg.hostPublicSpki } satisfies IEnrollFrame),
    );
  }

  private completeEnrollment(deviceSpki: string): void {
    if (this.state !== 'enrolling') return;
    const cfg = this.options.reconnect;
    if (!cfg) {
      this.rejectAndClose();
      return;
    }
    void (async (): Promise<void> => {
      try {
        // Validate the SPKI parses as a public key before pinning (fail closed on garbage).
        await importPublicKey(deviceSpki);
        const deviceId = await deriveIdentityId(deviceSpki);
        if (this.state !== 'enrolling') return;
        cfg.onEnroll(deviceId, deviceSpki);
        this.accept(this.pendingResult);
      } catch {
        this.rejectAndClose();
      }
    })();
  }

  private accept(result?: IPairingResult, viaReconnect = false): void {
    if (this.state === 'closed' || this.state === 'accepted') return;
    // The steps this channel still owes. Demanded here rather than earlier because the handshake
    // must already have bound the channel, and before anything below because that is where the
    // session becomes reachable. The ordering argument lives in `admission-steps.ts`.
    const owed = nextAdmissionStep(this.options, this.state);
    if (owed !== null) {
      this.pendingResult = result ?? this.pendingResult;
      this.pendingViaReconnect = viaReconnect;
      this.state = owed;
      return;
    }
    const attached = attachSession(this.options, viaReconnect, (error, event) =>
      this.handleSessionDeliveryError(error, event),
    );
    this.onSessionMessage = attached.onSessionMessage;
    this.handlerCleanup = attached.cleanup;
    this.state = 'accepted';
    this.options.onAccept?.(result);
  }

  /** The async half of the `handoff-grant` state, kept off the synchronous message path. */
  private async judgeGrantFrame(parsed: unknown): Promise<void> {
    const admission = await judgeHandoffGrant(parsed, this.options.handoffGrant);
    // A channel torn down while the signature was being checked must not be re-accepted by a verdict
    // that arrives afterwards. Checked after the await, because that is the window it exists for.
    if (this.state !== 'handoff-grant') return;
    this.options.handoffGrant?.onAdmission?.(admission);
    if (admission.admitted) this.accept(this.pendingResult, this.pendingViaReconnect);
    else this.rejectAndClose();
  }

  private rejectAndClose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    pairingChannel.close(this.options.channel);
    this.options.onReject?.();
  }

  private handleSessionDeliveryError(error: Error, event: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.handlerCleanup?.();
    this.handlerCleanup = undefined;
    this.onSessionMessage = undefined;
    pairingChannel.reportDeliveryError(this.options.onDeliveryError, error, event);
    pairingChannel.close(this.options.channel);
  }
}

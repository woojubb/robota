/**
 * The source end of a hand-off over a real channel: the side that holds the session gives it away.
 *
 * Only this side starts one, and only because its operator asked. It opens the channel, takes the
 * receiver's value for it, presents the grant for this one transfer, and sends the sealed session on
 * the file carrier once the receiver's operator has said yes. It gives up authority only on the
 * receiver's acknowledgement that the session is saved there; every other ending — a refusal, a
 * dropped connection, silence — leaves the session here and usable.
 */

import { createHash } from 'node:crypto';

import {
  HandoffSource,
  type IHandoffCarrier,
  type IHandoffCommitAck,
  type IHandoffComposition,
  type IHandoffManifest,
  type IHandoffManifestRequest,
  type IHandoffOutcome,
  type TSourceAbandonReason,
} from '@robota-sdk/agent-interface-session-mobility';
import { sendFileOverChannel } from '@robota-sdk/agent-transport/node';

import { describeFileRefusal } from '../peer-files/receiving.js';
import { handoffChannelFingerprint } from './handoff-grant.js';
import { openHandoffWire, type IHandoffWire } from './handoff-wire.js';

import type { THandoffWireRefusal } from './handoff-wire.js';
import type { IFileFrameChannel } from '@robota-sdk/agent-interface-session-mobility';

/** For the receiving operator to answer. */
const DECISION_MS = 5 * 60_000;
/** Between frames otherwise; saving a session is quick. */
const IDLE_MS = 30_000;

/** Where the push is, as the source's operator is told. */
export type TPushProgress = 'offered' | 'sending' | 'awaiting-confirmation';

export interface IPushHandoffOptions {
  readonly composition: IHandoffComposition;
  readonly request: IHandoffManifestRequest;
  /** Opened only once the session is ready to be offered. */
  readonly openChannel: () => Promise<IFileFrameChannel>;
  /** What the carrier bound the connection to, as this side sees the receiver's end of it. */
  readonly carrierBinding: string;
  /** Sign the grant for this manifest over the channel named by `channelFingerprint`. */
  readonly mintGrant: (manifest: IHandoffManifest, channelFingerprint: string) => Promise<unknown>;
  /** The session stops being this side's. Called once, only on the receiver's acknowledgement. */
  readonly onReadOnly: () => void;
  readonly onProgress?: (progress: TPushProgress) => void;
  readonly decisionMs?: number;
  readonly idleMs?: number;
}

export interface IPushHandoffResult {
  readonly outcome: IHandoffOutcome;
  /**
   * The source's transfer, still open when the connection ended before an answer: an
   * acknowledgement that arrives later — the same hand-off pushed again — still completes it.
   */
  readonly source: HandoffSource;
}

/** The receiver ended the transfer, and said why. */
class Refused extends Error {
  constructor(
    readonly reason: TSourceAbandonReason,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** The receiver already saved this transfer, from an earlier push of it. */
class AlreadyCommitted extends Error {
  constructor(readonly ack: IHandoffCommitAck) {
    super('already committed');
  }
}

function abandonReason(reason: THandoffWireRefusal): TSourceAbandonReason {
  switch (reason) {
    case 'unauthorized':
    case 'integrity-failed':
    case 'payload-undecodable':
    case 'destination-cannot-resume':
      return reason;
    default:
      return 'cancelled';
  }
}

function describeRefusal(reason: THandoffWireRefusal, detail: string | undefined): string {
  const said: Record<THandoffWireRefusal, string> = {
    'push-only': 'the other side only takes a session its holder sends',
    unauthorized: 'the other side did not accept the grant for this transfer',
    declined: 'the operator there did not accept the session',
    'integrity-failed': 'the session did not arrive intact',
    'payload-undecodable': 'the other side cannot read this session',
    'destination-cannot-resume': 'the other side cannot take the session on',
    protocol: 'the other side broke the hand-off protocol',
  };
  return detail !== undefined ? `${said[reason]} (${detail})` : said[reason];
}

/** The channel carrier `HandoffSource` sends through. */
class ChannelCarrier implements IHandoffCarrier {
  wire?: IHandoffWire;

  constructor(private readonly options: IPushHandoffOptions) {}

  async sendManifest(manifest: IHandoffManifest): Promise<void> {
    const wire = openHandoffWire(await this.options.openChannel());
    this.wire = wire;
    wire.send({ t: 'handoff-open' });
    const binding = await wire.next(this.options.idleMs ?? IDLE_MS);
    if (binding.t === 'handoff-refuse') {
      throw new Refused(
        abandonReason(binding.reason),
        describeRefusal(binding.reason, binding.detail),
      );
    }
    if (binding.t !== 'handoff-binding') throw new Refused('cancelled', 'expected the binding');
    const grant = await this.options.mintGrant(
      manifest,
      handoffChannelFingerprint(this.options.carrierBinding, binding.nonce),
    );
    wire.send({ t: 'handoff-offer', manifest, grant });
    this.options.onProgress?.('offered');
    const answer = await wire.next(this.options.decisionMs ?? DECISION_MS);
    if (answer.t === 'handoff-ack') throw new AlreadyCommitted(answer.ack);
    if (answer.t === 'handoff-refuse') {
      throw new Refused(
        abandonReason(answer.reason),
        describeRefusal(answer.reason, answer.detail),
      );
    }
    if (answer.t !== 'handoff-accept') throw new Refused('cancelled', 'expected an answer');
  }

  sendChunk(): Promise<void> {
    return Promise.reject(new Error('handoff: this carrier moves the payload whole'));
  }

  async sendPayload(handoffId: string, serialized: string): Promise<void> {
    const wire = this.wire;
    if (wire === undefined) throw new Error('handoff: the payload before the manifest');
    this.options.onProgress?.('sending');
    const bytes = Buffer.from(serialized, 'utf8');
    const outcome = await sendFileOverChannel({
      channel: wire.fileChannel(),
      offer: {
        transferId: handoffId,
        name: `${handoffId}.json`,
        size: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      source: {
        size: bytes.byteLength,
        read: async function* () {
          yield bytes;
        },
      },
    });
    if (!outcome.ok) {
      const reason = outcome.reason === 'integrity' ? 'integrity-failed' : 'cancelled';
      throw new Refused(reason, describeFileRefusal(outcome.reason, outcome.detail));
    }
  }
}

/**
 * Push the session described by `request`. A session that is not settled is refused before any
 * channel is opened.
 */
export async function pushHandoff(options: IPushHandoffOptions): Promise<IPushHandoffResult> {
  const carrier = new ChannelCarrier(options);
  const source = new HandoffSource({
    composition: options.composition,
    carrier,
    onReadOnly: options.onReadOnly,
  });
  // Refused here, before anything is sealed or a channel opened, when the session is not settled.
  const offer = source.offer(options.request);
  if (!offer.started) return { outcome: offer.outcome, source };

  try {
    try {
      await source.transfer();
    } catch (error) {
      if (error instanceof AlreadyCommitted) return { outcome: source.applyAck(error.ack), source };
      // Nothing was saved there: a refusal, or a connection gone before the payload was taken.
      const reason = error instanceof Refused ? error.reason : 'cancelled';
      const detail = error instanceof Error ? error.message : String(error);
      return { outcome: source.abandon(reason, detail), source };
    }
    const wire = carrier.wire;
    if (wire === undefined) throw new Error('handoff: transferred without a channel');
    return { outcome: await settle(wire, source, options), source };
  } finally {
    carrier.wire?.close();
  }
}

/** Wait for the receiver to save the session, or to say it will not. */
async function settle(
  wire: IHandoffWire,
  source: HandoffSource,
  options: IPushHandoffOptions,
): Promise<IHandoffOutcome> {
  for (;;) {
    let frame;
    try {
      frame = await wire.next(options.idleMs ?? IDLE_MS);
    } catch (error) {
      // The receiver may have saved it and its answer been lost. This side keeps the session, and
      // the transfer stays open for that answer, so a later one still completes it.
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ...source.status(),
        detail: `the other side did not confirm (${reason}); this machine keeps the session`,
      };
    }
    if (frame.t === 'handoff-staged') {
      options.onProgress?.('awaiting-confirmation');
      continue;
    }
    if (frame.t === 'handoff-ack') return source.applyAck(frame.ack);
    if (frame.t === 'handoff-refuse') {
      return source.abandon(
        abandonReason(frame.reason),
        describeRefusal(frame.reason, frame.detail),
      );
    }
    return source.abandon('cancelled', 'the other side broke the hand-off protocol');
  }
}

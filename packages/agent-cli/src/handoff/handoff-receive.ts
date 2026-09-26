/**
 * The receiving end of a hand-off over a real channel.
 *
 * It takes a session only when the side holding it pushes it. A channel that asks for this side's
 * session instead is refused, and nothing here ever sends one. Before a byte of the session arrives
 * the grant must authorize exactly this transfer to this side over this channel, and then the
 * operator here must say yes. The payload is kept aside, verified against the manifest the grant
 * covers, and saved — nothing runs it. Only then is the source told it may let go.
 */

import { readFile, unlink } from 'node:fs/promises';

import {
  HandoffDestination,
  type IDestinationReport,
  type IFileFrameChannel,
  type IHandoffCommitAck,
  type IHandoffComposition,
  type IHandoffManifest,
  type IHandoffStateItem,
  type IPeerAdmission,
  type TCredentialResolver,
  type TRecordPersister,
} from '@robota-sdk/agent-interface-session-mobility';
import { receiveFileOverChannel } from '@robota-sdk/agent-transport/node';
import { handoffGrantFrame, judgeHandoffGrant } from '@robota-sdk/agent-transport-webrtc';

import { openQuarantineSink, quarantineTarget } from '../peer-files/quarantine.js';
import { describeFileRefusal } from '../peer-files/receiving.js';
import { handoffChannelFingerprint, newChannelNonce } from './handoff-grant.js';
import { openHandoffWire, type IHandoffWire, type THandoffWireRefusal } from './handoff-wire.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const IDLE_MS = 30_000;
/** After this side's last word, how long it waits for the source to close first. */
const LAST_WORD_MS = 5_000;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const MAX_TEXT = 1024;
const MAX_INVENTORY = 64;
const DISPOSITIONS: ReadonlySet<string> = new Set([
  'transferred',
  'rehydrated',
  'source-local',
  'never-transferred',
]);

/** Said to the side that asked for a session instead of sending one. */
const PUSH_ONLY_DETAIL =
  'a session is only ever sent by the machine that holds it; its operator starts that with /handoff';

export interface IReceiveHandoffOptions {
  readonly channel: IFileFrameChannel;
  /** What the carrier bound the connection to, as this side sees its own end of it. */
  readonly carrierBinding: string;
  /** This side, as a grant must name it as the destination. */
  readonly destinationId: string;
  /** The sending side, as the carrier established it. Names its directory for what is kept aside. */
  readonly senderId: string;
  /** Judge the grant for `manifest` over the channel named by `channelFingerprint`. */
  readonly verifyGrant: (
    grant: unknown,
    manifest: IHandoffManifest,
    channelFingerprint: string,
  ) => Promise<IPeerAdmission>;
  /** Ask the operator here. Called only for a grant that verified. */
  readonly consent: (admission: IPeerAdmission, manifest: IHandoffManifest) => Promise<boolean>;
  readonly composition: IHandoffComposition;
  /** `~/.robota` of this side's `HOME`; the payload is kept aside under it until saved. */
  readonly root: string;
  readonly resolveCredential: TCredentialResolver;
  readonly persist: TRecordPersister;
  /**
   * Transfers this receiver already saved, by id. A transfer pushed again is answered with the same
   * acknowledgement and is not saved twice.
   */
  readonly committed: Map<string, IHandoffCommitAck>;
  readonly maxBytes?: number;
  readonly now?: () => number;
}

export type TReceiveHandoffOutcome =
  | {
      readonly received: true;
      readonly manifest: IHandoffManifest;
      /** The session as saved; absent when this push repeated one already saved. */
      readonly record?: IInteractiveSessionRecord;
    }
  | {
      readonly received: false;
      readonly reason: THandoffWireRefusal | 'closed';
      readonly detail: string;
    };

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TEXT;
}

function decodeInventory(value: unknown): IHandoffStateItem[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_INVENTORY) return undefined;
  const items: IHandoffStateItem[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const item = entry as Record<string, unknown>;
    const { kind, disposition, note } = item;
    if (!text(kind) || typeof disposition !== 'string' || !DISPOSITIONS.has(disposition)) {
      return undefined;
    }
    if (note !== undefined && !text(note)) return undefined;
    items.push({
      kind,
      disposition: disposition as IHandoffStateItem['disposition'],
      ...(note !== undefined ? { note } : {}),
    });
  }
  return items;
}

/** The offered manifest, or `undefined` when it is not exactly one. */
export function decodeHandoffManifest(value: unknown): IHandoffManifest | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const { handoffId, sessionId, sourceDeviceId, destinationDeviceId, offeredAt, integrity } = raw;
  if (typeof handoffId !== 'string' || !ID.test(handoffId)) return undefined;
  if (!text(sessionId) || !text(sourceDeviceId) || !text(destinationDeviceId)) return undefined;
  if (typeof offeredAt !== 'number' || !Number.isFinite(offeredAt)) return undefined;
  if (typeof integrity !== 'object' || integrity === null) return undefined;
  const { digest, byteLength } = integrity as Record<string, unknown>;
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return undefined;
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0) {
    return undefined;
  }
  const inventory = decodeInventory(raw['inventory']);
  if (inventory === undefined) return undefined;
  return {
    handoffId,
    sessionId,
    sourceDeviceId,
    destinationDeviceId,
    inventory,
    integrity: { digest, byteLength },
    offeredAt,
  };
}

class Refusal extends Error {
  constructor(
    readonly reason: THandoffWireRefusal,
    readonly detail: string,
  ) {
    super(detail);
  }
}

/** The payload was refused on the file carrier, which has already said so to the source. */
class PayloadRefused extends Error {
  constructor(
    readonly reason: THandoffWireRefusal,
    readonly detail: string,
  ) {
    super(detail);
  }
}

function fromReport(report: IDestinationReport): Refusal {
  const reason: THandoffWireRefusal =
    report.refusal === 'payload-undecodable' || report.refusal === 'destination-cannot-resume'
      ? report.refusal
      : 'integrity-failed';
  return new Refusal(reason, report.detail ?? 'the session was not kept');
}

/**
 * Receive one pushed session on `channel`, or refuse it. Resolves with the session as saved, or why
 * nothing was. Closes the channel either way.
 */
export async function receiveHandoff(
  options: IReceiveHandoffOptions,
): Promise<TReceiveHandoffOutcome> {
  const wire = openHandoffWire(options.channel);
  let kept: string | undefined;
  try {
    const opening = await wire.next(IDLE_MS);
    if (opening.t === 'handoff-pull') throw new Refusal('push-only', PUSH_ONLY_DETAIL);
    if (opening.t !== 'handoff-open') throw new Refusal('protocol', 'expected a hand-off to open');

    const nonce = newChannelNonce();
    wire.send({ t: 'handoff-binding', nonce });
    const offer = await wire.next(IDLE_MS);
    if (offer.t !== 'handoff-offer') throw new Refusal('protocol', 'expected an offer');
    const manifest = decodeHandoffManifest(offer.manifest);
    if (manifest === undefined) throw new Refusal('protocol', 'the manifest could not be read');
    if (manifest.destinationDeviceId !== options.destinationId) {
      throw new Refusal('unauthorized', 'the transfer is addressed to another destination');
    }

    // The gate: the grant first, then — for a transfer not already saved — the person here.
    const channelFingerprint = handoffChannelFingerprint(options.carrierBinding, nonce);
    let asked = false;
    const admission = await judgeHandoffGrant(handoffGrantFrame(offer.grant), {
      verify: (grant) => options.verifyGrant(grant, manifest, channelFingerprint),
      consent: (verified) => {
        if (options.committed.has(manifest.handoffId)) return Promise.resolve(true);
        asked = true;
        return options.consent(verified, manifest);
      },
    });
    if (!admission.admitted) {
      throw new Refusal(asked ? 'declined' : 'unauthorized', admission.reason ?? 'refused');
    }
    const saved = options.committed.get(manifest.handoffId);
    if (saved !== undefined) {
      wire.send({ t: 'handoff-ack', ack: saved });
      await wire.closedWithin(LAST_WORD_MS);
      return { received: true, manifest };
    }

    const destination = new HandoffDestination({
      composition: options.composition,
      deviceId: options.destinationId,
      resolveCredential: options.resolveCredential,
      persist: options.persist,
      ...(options.now !== undefined ? { now: options.now } : {}),
    });
    destination.receiveManifest(manifest);
    wire.send({ t: 'handoff-accept' });

    kept = await receivePayload(wire, options, manifest);
    const staged = destination.receivePayload(await readFile(kept, 'utf8'));
    if (staged.state !== 'staged') throw fromReport(staged);
    wire.send({ t: 'handoff-staged' });

    let committed: IDestinationReport;
    try {
      committed = await destination.commit();
    } catch (error) {
      destination.discard(
        'destination-cannot-resume',
        error instanceof Error ? error.message : String(error),
      );
      throw new Refusal('destination-cannot-resume', 'the session could not be saved here');
    }
    const ack = destination.acknowledgement();
    const record = destination.liveRecord();
    if (committed.state !== 'committed' || ack === null || record === null) {
      throw fromReport(committed);
    }
    options.committed.set(manifest.handoffId, ack);
    wire.send({ t: 'handoff-ack', ack });
    await wire.closedWithin(LAST_WORD_MS);
    return { received: true, manifest, record };
  } catch (error) {
    if (error instanceof PayloadRefused) {
      return { received: false, reason: error.reason, detail: error.detail };
    }
    if (error instanceof Refusal) {
      try {
        wire.send({ t: 'handoff-refuse', reason: error.reason, detail: error.detail });
      } catch {
        // allow-fallback: the source is already gone; the outcome below says why.
      }
      await wire.closedWithin(LAST_WORD_MS);
      return { received: false, reason: error.reason, detail: error.detail };
    }
    return {
      received: false,
      reason: 'closed',
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Kept aside only until saved or refused: the session store holds the copy that is kept.
    if (kept !== undefined) await unlink(kept).catch(() => undefined);
    wire.close();
  }
}

/** Take the sealed session on the file carrier into the aside directory. Resolves with where it is. */
async function receivePayload(
  wire: IHandoffWire,
  options: IReceiveHandoffOptions,
  manifest: IHandoffManifest,
): Promise<string> {
  const expectedSha256 = Buffer.from(manifest.integrity.digest, 'base64url').toString('hex');
  const outcome = await receiveFileOverChannel({
    channel: wire.fileChannel(),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    admit: async (offer) => {
      // The operator already said yes to this manifest; the file must be exactly what it sealed.
      if (
        offer.transferId !== manifest.handoffId ||
        offer.size !== manifest.integrity.byteLength ||
        offer.sha256 !== expectedSha256
      ) {
        return { refused: 'integrity', detail: 'the payload is not the one the manifest sealed' };
      }
      const target = await quarantineTarget({
        root: options.root,
        senderId: options.senderId,
        name: `${manifest.handoffId}.json`,
        area: 'handoff',
      });
      if (!('ok' in target)) return target;
      return { sink: await openQuarantineSink(target) };
    },
  });
  if (!outcome.ok) {
    // The file carrier already told the source; this side reports it and stops.
    throw new PayloadRefused(
      outcome.reason === 'integrity' ? 'integrity-failed' : 'protocol',
      describeFileRefusal(outcome.reason, outcome.detail),
    );
  }
  return outcome.location;
}

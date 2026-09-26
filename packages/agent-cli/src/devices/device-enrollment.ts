/**
 * Enrolling a new device into the user's roster, both ends: the existing device that holds the signing
 * key offers a one-time code, the new device joins with it.
 *
 * The code lives only in memory, on the terminal it is shown or typed on. The relay sees the topics it
 * derives and nothing else; the two devices meet over WebRTC and the new one must prove the code over
 * the negotiated DTLS fingerprints before anything else crosses. The code is spent by the first
 * attempt that proves it, whatever the operator then decides, and dies when it expires or after a few
 * attempts that fail to prove it. Nothing is issued until the operator of the existing device has
 * compared the short string both devices show and said yes; the new device keeps nothing until the
 * chain it is handed verifies against the master key that string covered.
 */
import { join } from 'node:path';

import {
  DEVICE_CAPABILITIES,
  EnrollmentError,
  certifyDevice,
  decodeEnrollmentFrame,
  deriveEnrollmentMaterial,
  enrollmentSas,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateEnrollmentCode,
  issueDeviceRoster,
  signEnrollmentRequest,
  startEnrollmentProof,
  verifyEnrollmentRequest,
  type IEnrollmentAnchorFrame,
  type IEnrollmentBinding,
  type IEnrollmentGrantFrame,
  type IEnrollmentMaterial,
  type IEnrollmentRequestFrame,
  type ISigningKey,
  type TEnrollmentFrame,
  type TEnrollmentRole,
} from '@robota-sdk/agent-remote-pairing';
import {
  EnrollmentLinkError,
  dialEnrollment,
  listenForEnrollment,
  type IEnrollmentChannel,
  type IIceServer,
  type IMeshRelay,
} from '@robota-sdk/agent-transport-webrtc';

import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { DeviceIdentityError } from './device-identity-error.js';
import { DEVICE_KA_KEY, DEVICE_SIGN_KEY, importPublicKey, storeKeyPair } from './identity-keys.js';
import { checked, nextSeq } from './identity-lists.js';
import {
  readIdentityState,
  sameIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from './identity-state.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type {
  IDevicesAddResult,
  IDevicesJoinResult,
  TDevicesOutcome,
  TDevicesRefusal,
} from '@robota-sdk/agent-command';
/** How long a code works. */
export const ENROLLMENT_CODE_TTL_MS = 5 * 60 * 1000;
/** Attempts that fail to prove the code before it stops working. */
export const MAX_FAILED_ENROLLMENT_ATTEMPTS = 3;
/** Each exchange after the proof, and the new device's confirmation that it kept its identity. */
const STEP_TIMEOUT_MS = 30_000;
/** How long the operator of the existing device has to compare the string and decide. */
const DECISION_TIMEOUT_MS = 3 * 60 * 1000;
/** How long the new device waits for that decision; a little longer, so the existing side speaks first. */
const JOINER_DECISION_TIMEOUT_MS = DECISION_TIMEOUT_MS + STEP_TIMEOUT_MS;
/** Frames queued ahead of the step that reads them; an enrollment says a handful. */
const MAX_QUEUED_FRAMES = 16;

export interface IEnrollmentEnvironment {
  /** `~/.robota/devices`. */
  readonly directory: string;
  readonly withinRoot?: string;
  readonly store: ICredentialStore;
  /** Signaling only; the caller owns it and closes it. */
  readonly relay: IMeshRelay;
  /** Aborts when the relay fails; an enrollment still waiting on it ends. */
  readonly relayFailed?: AbortSignal;
  readonly iceServers?: readonly IIceServer[];
  readonly now: () => number;
  /** From the first signal of a connection attempt to its open channel. */
  readonly connectTimeoutMs?: number;
}

type TOutcome<T> = TDevicesOutcome<T>;

function refuse<T>(reason: TDevicesRefusal): TOutcome<T> {
  return { ok: false, reason };
}

class InboxClosed extends Error {
  constructor(readonly reason: 'closed' | 'timeout' | 'overflow') {
    super(`enrollment channel ${reason}`);
    this.name = 'InboxClosed';
  }
}

/** The channel's frames in order, read one step at a time. */
class FrameInbox {
  private readonly queue: unknown[] = [];
  private waiter?: { resolve: (frame: unknown) => void; reject: (error: Error) => void };
  private ended?: InboxClosed;

  public constructor(channel: IEnrollmentChannel) {
    channel.onFrame((frame) => {
      if (this.waiter !== undefined) {
        const { resolve } = this.waiter;
        this.waiter = undefined;
        resolve(frame);
        return;
      }
      if (this.queue.length >= MAX_QUEUED_FRAMES) {
        this.end(new InboxClosed('overflow'));
        channel.close();
        return;
      }
      this.queue.push(frame);
    });
    channel.onClose(() => this.end(new InboxClosed('closed')));
  }

  private end(error: InboxClosed): void {
    this.ended ??= error;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.reject(error);
  }

  public next(timeoutMs: number): Promise<unknown> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift());
    if (this.ended !== undefined) return Promise.reject(this.ended);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = undefined;
        reject(new InboxClosed('timeout'));
      }, timeoutMs);
      this.waiter = {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  /** The next frame, decoded; anything else than one of `kinds` is a failed enrollment. */
  public async expect<K extends TEnrollmentFrame['t']>(
    kinds: readonly K[],
    timeoutMs: number,
  ): Promise<Extract<TEnrollmentFrame, { t: K }>> {
    const decoded = decodeEnrollmentFrame(await this.next(timeoutMs));
    if (!decoded.ok || !(kinds as readonly string[]).includes(decoded.frame.t)) {
      throw new DeviceIdentityError('the other device sent something unexpected');
    }
    return decoded.frame as Extract<TEnrollmentFrame, { t: K }>;
  }
}

/** Run the proof over `channel`; resolves with the binding, rejects as the proof or the channel fails. */
async function prove(
  channel: IEnrollmentChannel,
  inbox: FrameInbox,
  role: TEnrollmentRole,
  material: IEnrollmentMaterial,
): Promise<IEnrollmentBinding> {
  const proof = startEnrollmentProof({
    role,
    material,
    localFingerprint: channel.localFingerprint,
    remoteFingerprint: channel.remoteFingerprint,
    send: (frame) => channel.send(frame),
    timeoutMs: STEP_TIMEOUT_MS,
  });
  // Feed the proof its two frames only; whatever follows the peer's proof stays queued for the next step.
  void (async () => {
    for (;;) {
      const frame = await inbox.next(STEP_TIMEOUT_MS);
      proof.onFrame(frame);
      const t =
        typeof frame === 'object' && frame !== null ? (frame as { t?: unknown }).t : undefined;
      if (t === 'en-proof') return;
    }
  })().catch(() => proof.onFrame(undefined));
  return proof.result;
}

function spkiOf(key: CryptoKey): Promise<string> {
  return globalThis.crypto.subtle
    .exportKey('spki', key)
    .then((bytes) => Buffer.from(bytes).toString('base64url'));
}

// ── Existing device ─────────────────────────────────────────────────────────────────────────────

export interface IOfferEnrollmentOptions extends IEnrollmentEnvironment {
  /** The state read when the operator asked, and the signing key it names. */
  readonly before: IDeviceIdentityState;
  readonly signingKey: ISigningKey;
  readonly ttlMs?: number;
  readonly maxFailedAttempts?: number;
  /** Show the code to the operator, and only to the operator. */
  readonly showCode: (code: string, expiresAt: number) => void;
  /** Ask the operator; resolves true to enrol. Rejects when `signal` aborts (the device left, or time ran out). */
  readonly confirm: (request: {
    readonly name: string;
    readonly sas: string;
    readonly signal: AbortSignal;
  }) => Promise<boolean>;
  /** The operator cancelled while waiting for a device. */
  readonly cancelled: AbortSignal;
}

type TProven = {
  readonly channel: IEnrollmentChannel;
  readonly inbox: FrameInbox;
  readonly binding: IEnrollmentBinding;
};

/** Wait for a device that proves the code: the first one spends it. */
function awaitProvenDevice(
  options: IOfferEnrollmentOptions,
  material: IEnrollmentMaterial,
): Promise<TProven | TDevicesRefusal> {
  return new Promise((resolve) => {
    let failures = 0;
    let settled = false;
    const maxFailures = options.maxFailedAttempts ?? MAX_FAILED_ENROLLMENT_ATTEMPTS;
    const settle = (value: TProven | TDevicesRefusal): void => {
      if (settled) {
        if (typeof value === 'object') value.channel.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.cancelled.removeEventListener('abort', onCancel);
      options.relayFailed?.removeEventListener('abort', onRelayFailed);
      listener.close();
      resolve(value);
    };
    const timer = setTimeout(
      () => settle('enrollment-expired'),
      options.ttlMs ?? ENROLLMENT_CODE_TTL_MS,
    );
    const onCancel = (): void => settle('cancelled');
    const onRelayFailed = (): void => settle('enrollment-failed');
    const listener = listenForEnrollment({
      relay: options.relay,
      inbound: material.existingInbox,
      outbound: material.joinerInbox,
      ...(options.iceServers !== undefined ? { iceServers: options.iceServers } : {}),
      ...(options.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: options.connectTimeoutMs }
        : {}),
      onChannel: (channel) => {
        const inbox = new FrameInbox(channel);
        prove(channel, inbox, 'existing', material).then(
          (binding) => settle({ channel, inbox, binding }),
          () => {
            channel.close();
            failures += 1;
            if (failures >= maxFailures) settle('too-many-attempts');
          },
        );
      },
    });
    options.cancelled.addEventListener('abort', onCancel, { once: true });
    options.relayFailed?.addEventListener('abort', onRelayFailed, { once: true });
    if (options.cancelled.aborted) onCancel();
    if (options.relayFailed?.aborted === true) onRelayFailed();
  });
}

/** Show a code, and enrol the device that proves it once the operator confirms. */
export async function offerEnrollment(
  options: IOfferEnrollmentOptions,
): Promise<TOutcome<IDevicesAddResult>> {
  const code = generateEnrollmentCode();
  const material = await deriveEnrollmentMaterial(code);
  options.showCode(code, options.now() + (options.ttlMs ?? ENROLLMENT_CODE_TTL_MS));
  const proven = await awaitProvenDevice(options, material);
  // Nobody can use the code any more: the listener is gone, and so is the relay presence with it.
  options.relay.close();
  if (typeof proven !== 'object') return refuse(proven);
  const { channel, inbox, binding } = proven;
  try {
    return await enrol(options, material, channel, inbox, binding);
  } finally {
    channel.close();
  }
}

async function enrol(
  options: IOfferEnrollmentOptions,
  material: IEnrollmentMaterial,
  channel: IEnrollmentChannel,
  inbox: FrameInbox,
  binding: IEnrollmentBinding,
): Promise<TOutcome<IDevicesAddResult>> {
  const { before } = options;
  const anchor: IEnrollmentAnchorFrame = {
    t: 'en-anchor',
    masterPublicKey: before.masterPublicKey,
    userId: before.userId,
  };
  channel.send(anchor);
  let request: IEnrollmentRequestFrame;
  try {
    request = await inbox.expect(['en-request'], STEP_TIMEOUT_MS);
  } catch {
    return refuse('enrollment-failed');
  }
  if (!(await verifyEnrollmentRequest(binding, request))) return refuse('enrollment-failed');
  const sas = await enrollmentSas({ material, binding, request, anchor });

  const gone = new AbortController();
  const stopWatching = channel.onClose(() => gone.abort());
  let accepted: boolean;
  try {
    accepted = await options.confirm({
      name: request.name,
      sas,
      signal: AbortSignal.any([gone.signal, AbortSignal.timeout(DECISION_TIMEOUT_MS)]),
    });
  } catch {
    return refuse(gone.signal.aborted ? 'enrollment-failed' : 'cancelled');
  } finally {
    stopWatching();
  }
  if (!accepted) {
    channel.send({ t: 'en-declined' });
    return refuse('enrollment-declined');
  }

  const issued = await withExclusiveFileLock(join(options.directory, 'identity.lock'), async () => {
    const current = readIdentityState(options.directory);
    if (current === undefined || !sameIdentityState(before, current)) {
      return refuse<IEnrollmentGrantFrame>('changed-concurrently');
    }
    const issuedAt = options.now();
    const deviceCertificate = await certifyDevice({
      signingKey: options.signingKey,
      signPublicKey: await importPublicKey('ES256', request.signKey),
      kaPublicKey: await importPublicKey('X25519', request.kaKey),
      kaEpoch: 0,
      name: request.name,
      capabilities: DEVICE_CAPABILITIES,
      issuedAt,
    });
    const id = deviceCertificate.deviceId;
    if (
      current.roster.devices.some((device) => device.deviceId === id) ||
      current.revocation.revokedDeviceIds.includes(id)
    ) {
      return refuse<IEnrollmentGrantFrame>('enrollment-failed');
    }
    const marks = current.marks.bySigningKey?.[current.signingKeyCertificate.signingKeyId];
    const state = await checked(
      {
        ...current,
        roster: await issueDeviceRoster({
          signingKey: options.signingKey,
          seq: nextSeq(Math.max(current.roster.seq, marks?.rosterSeq ?? 0), issuedAt),
          issuedAt,
          devices: [...current.roster.devices, deviceCertificate],
        }),
      },
      issuedAt,
    );
    writeIdentityState(options.directory, state, options.withinRoot);
    const grant: IEnrollmentGrantFrame = {
      t: 'en-grant',
      signingKeyCert: state.signingKeyCertificate,
      deviceCert: deviceCertificate,
      roster: state.roster,
      revocation: state.revocation,
      signingKeyRevocation: state.signingKeyRevocation,
    };
    return { ok: true as const, value: grant };
  });
  if (!issued.ok) {
    channel.send({ t: 'en-declined' });
    return refuse(issued.reason);
  }
  channel.send(issued.value);
  let confirmed = false;
  try {
    await inbox.expect(['en-stored'], STEP_TIMEOUT_MS);
    confirmed = true;
  } catch {
    // allow-fallback: the device is enrolled here either way; the result says it did not confirm
  }
  return {
    ok: true,
    value: { deviceId: issued.value.deviceCert.deviceId, name: request.name, confirmed },
  };
}

// ── New device ──────────────────────────────────────────────────────────────────────────────────

export interface IJoinEnrollmentOptions extends IEnrollmentEnvironment {
  /** Topics and keys from the typed code. */
  readonly material: IEnrollmentMaterial;
  /** The name this device asks to be certified under (already a valid device name). */
  readonly name: string;
  /** Show the short string to the operator; they compare it with the other device. */
  readonly showSas: (sas: string) => void;
  /** The operator cancelled. */
  readonly cancelled: AbortSignal;
  readonly describeKeyStorage?: () => string | undefined;
}

/** Join the user's devices with the code another device shows. */
export async function joinEnrollment(
  options: IJoinEnrollmentOptions,
): Promise<TOutcome<IDevicesJoinResult>> {
  const [signPair, kaPair] = await Promise.all([
    generateDeviceSignKeyPair(true),
    generateDeviceKeyAgreementKeyPair(true),
  ]);
  const signKey = await spkiOf(signPair.publicKey);
  const kaKey = await spkiOf(kaPair.publicKey);

  let channel: IEnrollmentChannel;
  const dialing = dialEnrollment({
    relay: options.relay,
    inbound: options.material.joinerInbox,
    outbound: options.material.existingInbox,
    ...(options.iceServers !== undefined ? { iceServers: options.iceServers } : {}),
    ...(options.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: options.connectTimeoutMs }
      : {}),
  });
  const interrupted = new Promise<TDevicesRefusal>((resolve) => {
    const on = (signal: AbortSignal | undefined, reason: TDevicesRefusal): void => {
      if (signal?.aborted === true) resolve(reason);
      signal?.addEventListener('abort', () => resolve(reason), { once: true });
    };
    on(options.cancelled, 'cancelled');
    on(options.relayFailed, 'enrollment-failed');
  });
  try {
    const first = await Promise.race([dialing, interrupted]);
    if (typeof first === 'string') {
      // A channel that still comes about is closed unused.
      dialing.then(
        (late) => late.close(),
        () => undefined,
      );
      return refuse(first);
    }
    channel = first;
  } catch (error) {
    return refuse(
      error instanceof EnrollmentLinkError && error.reason === 'absent'
        ? 'code-not-accepted'
        : 'enrollment-failed',
    );
  }
  // Signaling is done: the relay has nothing more to carry.
  options.relay.close();
  const onCancel = (): void => channel.close();
  options.cancelled.addEventListener('abort', onCancel, { once: true });
  try {
    if (options.cancelled.aborted) return refuse('cancelled');
    return await joinOver(options, channel, { signPair, kaPair, signKey, kaKey });
  } finally {
    options.cancelled.removeEventListener('abort', onCancel);
    channel.close();
  }
}

async function joinOver(
  options: IJoinEnrollmentOptions,
  channel: IEnrollmentChannel,
  keys: {
    readonly signPair: CryptoKeyPair;
    readonly kaPair: CryptoKeyPair;
    readonly signKey: string;
    readonly kaKey: string;
  },
): Promise<TOutcome<IDevicesJoinResult>> {
  const inbox = new FrameInbox(channel);
  const failed = (): TOutcome<IDevicesJoinResult> =>
    refuse(options.cancelled.aborted ? 'cancelled' : 'enrollment-failed');
  let binding: IEnrollmentBinding;
  try {
    binding = await prove(channel, inbox, 'joiner', options.material);
  } catch (error) {
    if (error instanceof EnrollmentError && error.reason === 'proof-failed') {
      return refuse('code-not-accepted');
    }
    return failed();
  }
  const fields = { name: options.name, signKey: keys.signKey, kaKey: keys.kaKey };
  channel.send(
    await signEnrollmentRequest({ binding, signPrivateKey: keys.signPair.privateKey, ...fields }),
  );
  let anchor: IEnrollmentAnchorFrame;
  try {
    anchor = await inbox.expect(['en-anchor'], STEP_TIMEOUT_MS);
  } catch {
    return failed();
  }
  options.showSas(
    await enrollmentSas({ material: options.material, binding, request: fields, anchor }),
  );
  let answer: IEnrollmentGrantFrame | { readonly t: 'en-declined' };
  try {
    answer = await inbox.expect(['en-grant', 'en-declined'], JOINER_DECISION_TIMEOUT_MS);
  } catch {
    return failed();
  }
  if (answer.t === 'en-declined') return refuse('enrollment-declined');

  const certificate = answer.deviceCert;
  if (
    certificate.signKey !== keys.signKey ||
    certificate.kaKey !== keys.kaKey ||
    certificate.name !== options.name ||
    answer.signingKeyCert.userId !== anchor.userId
  ) {
    return refuse('enrollment-failed');
  }
  let state: IDeviceIdentityState;
  try {
    // The chain must verify against the master key the short string covered, with this device rostered.
    state = await checked(
      {
        masterPublicKey: anchor.masterPublicKey,
        userId: anchor.userId,
        deviceCertificate: certificate,
        signingKeyCertificate: answer.signingKeyCert,
        holdsSigningKey: false,
        roster: answer.roster,
        revocation: answer.revocation,
        signingKeyRevocation: answer.signingKeyRevocation,
        marks: {},
      },
      options.now(),
    );
  } catch {
    return refuse('enrollment-failed');
  }
  const saved = await withExclusiveFileLock(join(options.directory, 'identity.lock'), async () => {
    // Another session may have created an identity while this one was joining.
    if (readIdentityState(options.directory) !== undefined) return false;
    await storeKeyPair(options.store, DEVICE_SIGN_KEY, keys.signPair);
    await storeKeyPair(options.store, DEVICE_KA_KEY, keys.kaPair);
    writeIdentityState(options.directory, state, options.withinRoot);
    return true;
  });
  if (!saved) return refuse('changed-concurrently');
  channel.send({ t: 'en-stored' });
  const keyStorage = options.describeKeyStorage?.();
  return {
    ok: true,
    value: {
      userId: state.userId,
      deviceId: certificate.deviceId,
      name: certificate.name,
      ...(keyStorage !== undefined ? { keyStorage } : {}),
    },
  };
}

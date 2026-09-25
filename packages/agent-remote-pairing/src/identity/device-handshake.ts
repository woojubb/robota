/**
 * The device handshake: how two of one user's devices admit each other over a channel whose
 * negotiated DTLS fingerprints the caller supplies. Transport-agnostic (`send` + `onFrame`).
 *
 * Order of admission, each step gating the next:
 *
 * 1. **Pre-proof.** Both sides exchange nonces, then a MAC under their pairwise secret over both
 *    fingerprints, both nonces and the sender's role. No identity travels and no signature is
 *    checked before it passes, so a stranger learns nothing and costs one MAC. The initiator names
 *    its expected peer by nothing but the MAC itself: the responder finds the one roster device
 *    whose pairwise secret verifies it, so no identifier a stranger could link is ever sent.
 * 2. **Hello.** Protocol version and the sequence numbers of the lists each side holds.
 * 3. **Prove.** Certificates, the session descriptor, and a signature over the transcript, plus any
 *    list the peer is behind on. The chain is verified against the newest verified lists, then the
 *    signature proves possession of the certified device key over this very channel.
 *
 * Every refusal is a {@link DeviceHandshakeError} with a closed reason; the result settles once.
 */

import { webcrypto, ab, randomBytes, toBase64Url } from '../crypto-primitives.js';
import type { TPairingRole } from '../pairing.js';
import type {
  IDeviceCertificate,
  ISigningKeyCertificate,
  TDeviceCapability,
} from './certificates.js';
import {
  HOUR_MS,
  IDENTITY_PURPOSES,
  canonicalBytes,
  decodeBase64Url,
  importVerifyKey,
  signCanonical,
  verifyCanonical,
} from './encoding.js';
import {
  DEVICE_HANDSHAKE_PROTOCOL,
  HANDSHAKE_NONCE_BYTES,
  decodeDeviceHandshakeFrame,
  handshakeTranscriptFields,
  preProofBytes,
  type IDeviceHelloFrame,
  type IDeviceProveFrame,
  type TDeviceHandshakeFrame,
} from './device-handshake-frames.js';
import { derivePairwiseSecret } from './pairwise-secret.js';
import {
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSigningKeyRevocation,
  revocationListBytes,
  rosterBytes,
  signingKeyRevocationBytes,
  type IDeviceRevocationList,
  type IDeviceRoster,
  type ISessionDescriptor,
  type ISigningKeyRevocation,
} from './statements.js';
import {
  verifyDeviceChain,
  verifySessionDescriptor,
  type IChainRejection,
  type IListHighWaterMarks,
  type TChainRejection,
  type TSessionRejection,
} from './verify-chain.js';

/** How long a freshness lookup may delay a remote admission. */
export const FRESHNESS_LOOKUP_MS = 3_000;
/** How long past expiry a remote peer is still admitted, with a warning, when no newer list is reachable. */
export const REMOTE_ADMISSION_GRACE_MS = 72 * HOUR_MS;

const DEFAULT_TIMEOUT_MS = 10_000;

/** Where the carrier established the peer runs. `same-host` only on a kernel-enforced rendezvous. */
export type TMeshLocality = 'same-host' | 'another-host';

/** Structurally the `IMeshAdmission` of `agent-interface-session-mobility`. */
export interface IDeviceMeshAdmission {
  readonly trust: 'same-user-same-host' | 'same-user-different-host';
  readonly locality: TMeshLocality;
  readonly workspace?: string;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly capabilities: readonly TDeviceCapability[];
}

/**
 * `grace`: a remote peer admitted on lists past their expiry but inside the grace — warn the user.
 * `stale-same-host`: a same-host peer admitted on lists past their expiry, however old.
 */
export type TListFreshness = 'fresh' | 'grace' | 'stale-same-host';

export type TDeviceHandshakeRefusal =
  | 'malformed-frame'
  | 'unexpected-frame'
  | 'channel-invalid'
  | 'unknown-peer'
  | 'pre-proof-failed'
  | 'unsupported-protocol'
  | 'gossip-invalid'
  | 'chain'
  | 'identity-mismatch'
  | 'signature-invalid'
  | 'session'
  | 'timeout'
  | 'internal';

export class DeviceHandshakeError extends Error {
  readonly reason: TDeviceHandshakeRefusal;
  /** For `malformed-frame`: which field failed. Never its value. */
  readonly field?: string;
  /** For `chain`: why the peer's chain was refused. */
  readonly chain?: IChainRejection<TChainRejection>;
  /** For `session`: why the session descriptor was refused. */
  readonly session?: IChainRejection<TSessionRejection>;

  constructor(
    reason: TDeviceHandshakeRefusal,
    detail: {
      readonly field?: string;
      readonly chain?: IChainRejection<TChainRejection>;
      readonly session?: IChainRejection<TSessionRejection>;
    } = {},
  ) {
    const suffix = detail.field ?? detail.chain?.reason ?? detail.session?.reason;
    super(`device handshake refused: ${reason}${suffix !== undefined ? ` (${suffix})` : ''}`);
    this.name = 'DeviceHandshakeError';
    this.reason = reason;
    if (detail.field !== undefined) this.field = detail.field;
    if (detail.chain !== undefined) this.chain = detail.chain;
    if (detail.session !== undefined) this.session = detail.session;
  }
}

/** This device's identity and the lists it holds, as its store keeps them. */
export interface IDeviceHandshakeIdentity {
  /** The pinned trust anchor. */
  readonly masterPublicKey: string;
  /** The signing key that issued this device's certificate and the lists below. */
  readonly signingKeyCertificate: ISigningKeyCertificate;
  readonly deviceCertificate: IDeviceCertificate;
  /** Private half of `deviceCertificate.signKey`. */
  readonly signPrivateKey: CryptoKey;
  /** Private half of `deviceCertificate.kaKey`. */
  readonly kaPrivateKey: CryptoKey;
  readonly roster: IDeviceRoster;
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation: ISigningKeyRevocation;
  /** The highest `seq` accepted per list. */
  readonly marks: IListHighWaterMarks;
}

/** Newer lists verified during a handshake, for the caller to persist with the advanced marks. */
export interface IListUpdate {
  readonly roster?: IDeviceRoster;
  readonly revocation?: IDeviceRevocationList;
  readonly signingKeyRevocation?: ISigningKeyRevocation;
  readonly marks: IListHighWaterMarks;
}

export interface IDeviceHandshakeOptions {
  /** Initiator ≡ the side that chose its peer; it must name `expectedPeerDeviceId`. */
  readonly role: TPairingRole;
  readonly identity: IDeviceHandshakeIdentity;
  /** This device's signed descriptor of the session it offers. */
  readonly sessionDescriptor: ISessionDescriptor;
  /** Initiator only: the rostered device it means to reach. */
  readonly expectedPeerDeviceId?: string;
  /** This side's DTLS fingerprint. */
  readonly localFingerprint: string;
  /** The fingerprint of the certificate the DTLS layer verified — never SDP text. */
  readonly remoteFingerprint: string;
  readonly locality: TMeshLocality;
  /** What this device lets a peer be asked for; the admission grants the intersection. */
  readonly localPolicy: readonly TDeviceCapability[];
  readonly send: (frame: TDeviceHandshakeFrame) => void;
  /**
   * Remote admission only: ask a signing-key holder for its latest lists. Resolves to
   * `{ roster?, revocation?, signingKeyRevocation? }` as received; each is verified before use and
   * anything unverifiable is ignored. Bounded to {@link FRESHNESS_LOOKUP_MS}, then aborted.
   */
  readonly fetchLatestLists?: (signal: AbortSignal) => Promise<unknown>;
  /** Called once, before the verdict, when newer verified lists were adopted. */
  readonly onListsAdopted?: (update: IListUpdate) => void;
  readonly now?: () => number;
  /** The whole handshake, including the freshness lookup (default 10 s). */
  readonly timeoutMs?: number;
}

export interface IDeviceHandshakeResult {
  readonly admission: IDeviceMeshAdmission;
  readonly freshness: TListFreshness;
  /** When `freshness` is not `fresh`: the earliest list expiry that has passed. */
  readonly listsExpiredAt?: number;
  /** The caller's marks advanced by everything accepted here. */
  readonly marks: IListHighWaterMarks;
}

export interface IDeviceHandshakeController {
  /** Resolves only on admission. The caller closes the channel on rejection. */
  readonly result: Promise<IDeviceHandshakeResult>;
  /** Feed one inbound frame exactly as received. Never throws. */
  onFrame(frame: unknown): void;
}

type TListKind = 'roster' | 'revocation' | 'signingKeyRevocation';
const LIST_KINDS: readonly TListKind[] = ['roster', 'revocation', 'signingKeyRevocation'];
const SEQ_FIELD = {
  roster: 'rosterSeq',
  revocation: 'revocationSeq',
  signingKeyRevocation: 'signingKeyRevocationSeq',
} as const;

interface IHeldLists {
  roster: IDeviceRoster;
  revocation: IDeviceRevocationList;
  signingKeyRevocation: ISigningKeyRevocation;
}

function refuse(
  reason: TDeviceHandshakeRefusal,
  detail?: ConstructorParameters<typeof DeviceHandshakeError>[1],
): never {
  throw new DeviceHandshakeError(reason, detail);
}

function peerRoleOf(role: TPairingRole): TPairingRole {
  return role === 'initiator' ? 'responder' : 'initiator';
}

function maxDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function advanceMarks(
  marks: IListHighWaterMarks,
  signingKeyId: string,
  seen: {
    readonly rosterSeq?: number;
    readonly revocationSeq?: number;
    readonly signingKeyRevocationSeq?: number;
  },
): IListHighWaterMarks {
  const table = marks.bySigningKey ?? {};
  const own = Object.prototype.hasOwnProperty.call(table, signingKeyId)
    ? (table[signingKeyId] ?? {})
    : {};
  const rosterSeq = maxDefined(own.rosterSeq, seen.rosterSeq);
  const revocationSeq = maxDefined(own.revocationSeq, seen.revocationSeq);
  const signingKeyRevocationSeq = maxDefined(
    marks.signingKeyRevocationSeq,
    seen.signingKeyRevocationSeq,
  );
  return {
    ...(signingKeyRevocationSeq !== undefined ? { signingKeyRevocationSeq } : {}),
    bySigningKey: {
      ...table,
      [signingKeyId]: {
        ...(rosterSeq !== undefined ? { rosterSeq } : {}),
        ...(revocationSeq !== undefined ? { revocationSeq } : {}),
      },
    },
  };
}

/** Start one side of a device handshake. Sends this side's nonce immediately. */
export function startDeviceHandshake(options: IDeviceHandshakeOptions): IDeviceHandshakeController {
  const now = options.now ?? Date.now;
  const self = options.identity.deviceCertificate;
  const signingKeyId = options.identity.signingKeyCertificate.signingKeyId;
  const peerRole = peerRoleOf(options.role);
  const localNonce = toBase64Url(randomBytes(HANDSHAKE_NONCE_BYTES));
  const held: IHeldLists = {
    roster: options.identity.roster,
    revocation: options.identity.revocation,
    signingKeyRevocation: options.identity.signingKeyRevocation,
  };
  const ownHello: IDeviceHelloFrame = {
    t: 'dh-hello',
    ctx: IDENTITY_PURPOSES.handshake,
    proto: DEVICE_HANDSHAKE_PROTOCOL,
    rosterSeq: held.roster.seq,
    revocationSeq: held.revocation.seq,
    signingKeyRevocationSeq: held.signingKeyRevocation.seq,
  };

  /** The one frame accepted next; `done` once the peer's prove has arrived. */
  let expecting: TDeviceHandshakeFrame['t'] | 'done' = 'dh-nonce';
  let peerNonce: string | undefined;
  let peer: IDeviceCertificate | undefined;
  let peerHello: IDeviceHelloFrame | undefined;
  let lookup: Promise<unknown> = Promise.resolve(undefined);
  let lookupAbort: AbortController | undefined;
  const secretKeys = new Map<string, Promise<CryptoKey>>();

  let settled = false;
  let resolve!: (value: IDeviceHandshakeResult) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<IDeviceHandshakeResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const timer = setTimeout(
    () => fail(new DeviceHandshakeError('timeout')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  function finish(): void {
    settled = true;
    clearTimeout(timer);
    lookupAbort?.abort();
  }

  function fail(error: unknown): void {
    if (settled) return;
    finish();
    reject(error instanceof DeviceHandshakeError ? error : new DeviceHandshakeError('internal'));
  }

  function succeed(value: IDeviceHandshakeResult): void {
    if (settled) return;
    finish();
    resolve(value);
  }

  function fingerprints(): { fingerprintInitiator: string; fingerprintResponder: string } {
    return options.role === 'initiator'
      ? {
          fingerprintInitiator: options.localFingerprint,
          fingerprintResponder: options.remoteFingerprint,
        }
      : {
          fingerprintInitiator: options.remoteFingerprint,
          fingerprintResponder: options.localFingerprint,
        };
  }

  function nonces(): { nonceInitiator: string; nonceResponder: string } {
    const remote = peerNonce as string;
    return options.role === 'initiator'
      ? { nonceInitiator: localNonce, nonceResponder: remote }
      : { nonceInitiator: remote, nonceResponder: localNonce };
  }

  /** Devices this side will talk to: rostered, not itself, not revoked by the list it holds. */
  function candidates(): readonly IDeviceCertificate[] {
    const revoked = new Set(held.revocation.revokedDeviceIds);
    return held.roster.devices.filter(
      (d) => d.deviceId !== self.deviceId && !revoked.has(d.deviceId),
    );
  }

  function pairwiseKey(device: IDeviceCertificate): Promise<CryptoKey> {
    let key = secretKeys.get(device.deviceId);
    if (key === undefined) {
      key = derivePairwiseSecret({
        ownKaPrivateKey: options.identity.kaPrivateKey,
        own: self,
        peer: device,
      }).then((secret) =>
        webcrypto.subtle.importKey('raw', ab(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
          'sign',
          'verify',
        ]),
      );
      secretKeys.set(device.deviceId, key);
    }
    return key;
  }

  function preBytes(senderRole: TPairingRole): Uint8Array {
    return preProofBytes({ senderRole, ...fingerprints(), ...nonces() });
  }

  async function verifyPre(device: IDeviceCertificate, mac: string): Promise<boolean> {
    try {
      const key = await pairwiseKey(device);
      return await webcrypto.subtle.verify(
        'HMAC',
        key,
        ab(decodeBase64Url(mac)),
        ab(preBytes(peerRole)),
      );
    } catch {
      // allow-fallback: a device whose secret cannot be derived verifies no proof
      return false;
    }
  }

  async function sendPre(device: IDeviceCertificate): Promise<void> {
    const key = await pairwiseKey(device);
    const mac = new Uint8Array(
      await webcrypto.subtle.sign('HMAC', key, ab(preBytes(options.role))),
    );
    options.send({ t: 'dh-pre', mac: toBase64Url(mac) });
  }

  function startLookup(): void {
    const fetchLatest = options.fetchLatestLists;
    if (options.locality !== 'another-host' || fetchLatest === undefined) return;
    const abort = new AbortController();
    lookupAbort = abort;
    lookup = new Promise<unknown>((done) => {
      const bound = setTimeout(() => {
        abort.abort();
        done(undefined);
      }, FRESHNESS_LOOKUP_MS);
      const settle = (value: unknown): void => {
        clearTimeout(bound);
        done(value);
      };
      try {
        fetchLatest(abort.signal).then(settle, () => settle(undefined));
      } catch {
        // allow-fallback: a lookup that throws means no signing-key holder answered
        settle(undefined);
      }
    });
  }

  function afterPreProof(): void {
    options.send(ownHello);
    startLookup();
    expecting = 'dh-hello';
  }

  async function sendProve(): Promise<void> {
    const hello = peerHello as IDeviceHelloFrame;
    const device = peer as IDeviceCertificate;
    const fields = handshakeTranscriptFields({
      signerRole: options.role,
      ...fingerprints(),
      ...nonces(),
      helloInitiator: options.role === 'initiator' ? ownHello : hello,
      helloResponder: options.role === 'initiator' ? hello : ownHello,
      signerDeviceId: self.deviceId,
      peerDeviceId: device.deviceId,
      sessionDescriptorSig: options.sessionDescriptor.sig,
    });
    const sig = await signCanonical(
      options.identity.signPrivateKey,
      canonicalBytes(IDENTITY_PURPOSES.handshake, fields),
    );
    const gossip: { -readonly [K in TListKind]?: IHeldLists[K] } = {};
    for (const kind of LIST_KINDS) {
      if (ownHello[SEQ_FIELD[kind]] > hello[SEQ_FIELD[kind]])
        Object.assign(gossip, { [kind]: held[kind] });
    }
    options.send({
      t: 'dh-prove',
      signingKeyCert: options.identity.signingKeyCertificate,
      deviceCert: self,
      sessionDescriptor: options.sessionDescriptor,
      sig,
      ...gossip,
    });
  }

  let issuerKey: Promise<CryptoKey | undefined> | undefined;
  let masterKey: Promise<CryptoKey | undefined> | undefined;

  /** A candidate list, verified as issued for this user by the key it names, or undefined. */
  async function verifiedList(
    kind: TListKind,
    value: unknown,
  ): Promise<IHeldLists[TListKind] | undefined> {
    const issuer = options.identity.signingKeyCertificate;
    if (kind === 'signingKeyRevocation') {
      const decoded = decodeSigningKeyRevocation(value);
      if (!decoded.ok || decoded.value.userId !== issuer.userId) return undefined;
      masterKey ??= importVerifyKey('Ed25519', options.identity.masterPublicKey);
      const key = await masterKey;
      const ok =
        key !== undefined &&
        (await verifyCanonical(key, decoded.value.sig, signingKeyRevocationBytes(decoded.value)));
      return ok ? decoded.value : undefined;
    }
    const decoded =
      kind === 'roster' ? decodeDeviceRoster(value) : decodeDeviceRevocationList(value);
    if (!decoded.ok) return undefined;
    const list = decoded.value;
    if (list.userId !== issuer.userId || list.signingKeyId !== issuer.signingKeyId)
      return undefined;
    issuerKey ??= importVerifyKey(issuer.alg, issuer.publicKey);
    const key = await issuerKey;
    if (key === undefined) return undefined;
    const bytes =
      list.ctx === IDENTITY_PURPOSES.roster ? rosterBytes(list) : revocationListBytes(list);
    return (await verifyCanonical(key, list.sig, bytes)) ? list : undefined;
  }

  async function verifyProve(frame: IDeviceProveFrame): Promise<void> {
    const hello = peerHello as IDeviceHelloFrame;
    const device = peer as IDeviceCertificate;
    let marks = options.identity.marks;
    const adopted: { -readonly [K in TListKind]?: IHeldLists[K] } = {};

    // Gossip: exactly the lists the peer's hello declared newer, each verified before adoption.
    for (const kind of LIST_KINDS) {
      const declared = hello[SEQ_FIELD[kind]];
      const offered = frame[kind];
      if ((offered !== undefined) !== declared > ownHello[SEQ_FIELD[kind]])
        refuse('gossip-invalid', { field: kind });
      if (offered === undefined) continue;
      const list = offered.seq === declared ? await verifiedList(kind, offered) : undefined;
      if (list === undefined) refuse('gossip-invalid', { field: kind });
      Object.assign(adopted, { [kind]: list });
    }

    // Freshness: whatever a signing-key holder returned in time, if it verifies and is newer.
    const fetched = await lookup;
    if (typeof fetched === 'object' && fetched !== null) {
      for (const kind of LIST_KINDS) {
        const raw = Object.prototype.hasOwnProperty.call(fetched, kind)
          ? (fetched as Record<string, unknown>)[kind]
          : undefined;
        if (raw === undefined) continue;
        const list = await verifiedList(kind, raw);
        const current = adopted[kind] ?? held[kind];
        if (list !== undefined && list.seq > current.seq) Object.assign(adopted, { [kind]: list });
      }
    }

    const chosen: IHeldLists = {
      roster: adopted.roster ?? held.roster,
      revocation: adopted.revocation ?? held.revocation,
      signingKeyRevocation: adopted.signingKeyRevocation ?? held.signingKeyRevocation,
    };
    if (Object.keys(adopted).length > 0) {
      marks = advanceMarks(marks, signingKeyId, {
        ...(adopted.roster !== undefined ? { rosterSeq: adopted.roster.seq } : {}),
        ...(adopted.revocation !== undefined ? { revocationSeq: adopted.revocation.seq } : {}),
        ...(adopted.signingKeyRevocation !== undefined
          ? { signingKeyRevocationSeq: adopted.signingKeyRevocation.seq }
          : {}),
      });
      options.onListsAdopted?.({ ...adopted, marks });
    }

    const at = now();
    const chain = await verifyDeviceChain({
      masterPublicKey: options.identity.masterPublicKey,
      signingKeyCert: frame.signingKeyCert,
      deviceCert: frame.deviceCert,
      roster: chosen.roster,
      revocation: chosen.revocation,
      signingKeyRevocation: chosen.signingKeyRevocation,
      now: at,
      lastSeen: options.identity.marks,
      required: { roster: true, revocation: true, signingKeyRevocation: true },
      listExpiryGraceMs:
        options.locality === 'same-host' ? Number.POSITIVE_INFINITY : REMOTE_ADMISSION_GRACE_MS,
    });
    if (!chain.ok) refuse('chain', { chain });

    // The proven device must be the one whose pairwise secret passed the pre-proof.
    const proven = chain.deviceCertificate;
    if (
      proven.deviceId !== device.deviceId ||
      proven.kaKey !== device.kaKey ||
      proven.kaEpoch !== device.kaEpoch
    ) {
      refuse('identity-mismatch');
    }

    const fields = handshakeTranscriptFields({
      signerRole: peerRole,
      ...fingerprints(),
      ...nonces(),
      helloInitiator: options.role === 'initiator' ? ownHello : hello,
      helloResponder: options.role === 'initiator' ? hello : ownHello,
      signerDeviceId: proven.deviceId,
      peerDeviceId: self.deviceId,
      sessionDescriptorSig: frame.sessionDescriptor.sig,
    });
    const signKey = await importVerifyKey('ES256', proven.signKey);
    const bytes = canonicalBytes(IDENTITY_PURPOSES.handshake, fields);
    if (signKey === undefined || !(await verifyCanonical(signKey, frame.sig, bytes)))
      refuse('signature-invalid');

    const session = await verifySessionDescriptor(frame.sessionDescriptor, {
      deviceCertificate: proven,
      now: at,
    });
    if (!session.ok) refuse('session', { session });

    const policy = new Set(options.localPolicy);
    const freshness: TListFreshness =
      chain.listsExpiredAt === undefined
        ? 'fresh'
        : options.locality === 'same-host'
          ? 'stale-same-host'
          : 'grace';
    succeed({
      admission: {
        trust:
          options.locality === 'same-host' ? 'same-user-same-host' : 'same-user-different-host',
        locality: options.locality,
        ...(session.workspaceClaim !== undefined ? { workspace: session.workspaceClaim } : {}),
        deviceId: proven.deviceId,
        sessionId: session.sessionId,
        capabilities: chain.capabilities.filter((capability) => policy.has(capability)),
      },
      freshness,
      ...(chain.listsExpiredAt !== undefined ? { listsExpiredAt: chain.listsExpiredAt } : {}),
      marks: advanceMarks(marks, chain.signingKeyId, chain.accepted),
    });
  }

  async function handle(frame: TDeviceHandshakeFrame): Promise<void> {
    if (settled) return;
    if (frame.t !== expecting) refuse('unexpected-frame', { field: frame.t });
    switch (frame.t) {
      case 'dh-nonce': {
        // A nonce equal to ours is our own frame reflected back.
        if (frame.nonce === localNonce) refuse('pre-proof-failed');
        peerNonce = frame.nonce;
        expecting = 'dh-pre';
        if (options.role === 'initiator') await sendPre(peer as IDeviceCertificate);
        return;
      }
      case 'dh-pre': {
        if (options.role === 'initiator') {
          if (!(await verifyPre(peer as IDeviceCertificate, frame.mac))) refuse('pre-proof-failed');
        } else {
          // Try every candidate so how far down the roster the match sits is not observable.
          const matches: IDeviceCertificate[] = [];
          for (const device of candidates())
            if (await verifyPre(device, frame.mac)) matches.push(device);
          if (matches.length !== 1) refuse('pre-proof-failed');
          peer = matches[0];
          await sendPre(peer as IDeviceCertificate);
        }
        afterPreProof();
        return;
      }
      case 'dh-hello': {
        if (frame.proto !== DEVICE_HANDSHAKE_PROTOCOL) refuse('unsupported-protocol');
        peerHello = frame;
        expecting = 'dh-prove';
        await sendProve();
        return;
      }
      case 'dh-prove': {
        expecting = 'done';
        await verifyProve(frame);
        return;
      }
    }
  }

  let queue: Promise<void> = Promise.resolve();

  // Before anything is sent: a usable channel, and for the initiator a peer it may talk to.
  try {
    if (
      options.localFingerprint.length === 0 ||
      options.remoteFingerprint.length === 0 ||
      options.localFingerprint === options.remoteFingerprint
    ) {
      refuse('channel-invalid');
    }
    if (options.role === 'initiator') {
      peer = candidates().find((d) => d.deviceId === options.expectedPeerDeviceId);
      if (peer === undefined) refuse('unknown-peer');
    }
    options.send({ t: 'dh-nonce', nonce: localNonce });
  } catch (error) {
    fail(error);
  }

  return {
    result,
    onFrame(value: unknown): void {
      if (settled) return;
      const decoded = decodeDeviceHandshakeFrame(value);
      if (!decoded.ok) {
        fail(new DeviceHandshakeError('malformed-frame', { field: decoded.field }));
        return;
      }
      queue = queue.then(() => handle(decoded.frame)).catch((error: unknown) => fail(error));
    },
  };
}

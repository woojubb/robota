/**
 * This device's place in the user's device mesh: present at one relay inbox per peer device, and at
 * most one WebRTC connection per device pair, each admitted by the device handshake.
 *
 * **Who offers is decided by the pair, not by timing.** The device with the lower id is the offerer
 * for that pair and the other one only ever answers, so two devices reaching for each other at once
 * never produce two connections and never race. A node that wants a connection announces itself
 * (`hello`); the offerer answers a `hello` with an offer and the answerer answers it with its own
 * `hello`. Each node run has a random instance id, so a peer that restarted is recognised as a new
 * run and gets a fresh connection, while a repeated `hello` from the run already being served is
 * ignored. An offer names the answerer's run, so an offer meant for a previous run is not taken.
 *
 * **The relay is only a mailbox.** Inbox topics come from the pair's secret, so the relay sees no
 * device id; everything read from it is decoded as hostile input. Nothing it says is authenticated,
 * so a new attempt never displaces an admitted connection: it runs beside it and replaces it only once
 * it is admitted itself, and attempts per pair are paced, so forged announcements can neither cut a
 * working connection nor make this node open connections without bound. Admission is the device
 * handshake over the negotiated channel, and a peer is accepted only as the device its inbox belongs
 * to.
 *
 * **Lists are live.** Newer lists adopted in a handshake, and lists the caller hands over through
 * {@link DeviceMeshNode.refresh}, apply from the next handshake on; a device they remove or revoke is
 * dropped along with its connection.
 */
import {
  derivePairRendezvous,
  startDeviceHandshake,
  type IDeviceCertificate,
  type IDeviceHandshakeIdentity,
  type IDeviceHandshakeResult,
  type IDeviceMeshAdmission,
  type IListHighWaterMarks,
  type IListUpdate,
  type IPairRendezvous,
  type IRelayInboxTopics,
  type ISessionDescriptor,
  type TDeviceCapability,
} from '@robota-sdk/agent-remote-pairing';

import type { MeshLinkEndedError } from './mesh-peer-link.js';
import {
  MeshPeerLink,
  type TMeshLinkEnd,
  type TMeshLinkRole,
  type TMeshLinkSignal,
} from './mesh-peer-link.js';
import {
  MESH_SIGNAL_VERSION,
  decodeMeshSignal,
  type IMeshDescription,
  type TMeshSignal,
} from './mesh-signal.js';
import {
  ConnectionAuthority,
  type IFileFrameChannel,
  type IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

import { RtcPeer, type RtcChannel } from './rtc-peer.js';

import {
  MeshRelayNeededError,
  meshRelayIceServers,
  type IMeshRelayEndpoint,
  type IMeshRelayPeer,
} from './mesh-turn-relay.js';

import type { IMeshPeerRoute } from './mesh-discovery.js';
import type { IMeshRelay } from './mesh-relay.js';
import type { IDataChannelModule } from './datachannel-loader.js';
import type { IIceServer } from './webrtc-transport-options.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;
/** At most one new attempt, and one `hello` reply, per pair per this interval; later ones wait. */
const MIN_ATTEMPT_INTERVAL_MS = 1_000;
/** Candidates kept for an offer that waits for its pacing slot. */
const MAX_WAITING_CANDIDATES = 64;
/** How long an attempt waits to learn which relays paired devices advertise. */
const RELAY_ADVERT_LOOKUP_MS = 3_000;
/** Paired devices' relays one attempt uses, and endpoints of each. */
const MAX_RELAY_DEVICES = 2;
const MAX_RELAY_ENDPOINTS = 3;

/**
 * How a connection reaches a peer no direct path reaches: a relay a paired device runs first, then
 * the TURN servers the user configured. With neither, a connection that needs a relay is refused
 * with {@link MeshRelayNeededError} rather than left to fail silently.
 */
export interface IDeviceMeshRelayOptions {
  /** The relays `peers` advertise, by device id, as found over their pairwise records. */
  readonly advertised?: (
    peers: readonly IMeshPeerRoute[],
    signal: AbortSignal,
  ) => Promise<ReadonlyMap<string, readonly IMeshRelayEndpoint[]>>;
  /** TURN servers the user configured, tried once the advertised relays did not carry a connection. */
  readonly configured?: readonly IIceServer[];
  /** Relay candidates only: for a network where no direct path can work. */
  readonly relayOnly?: boolean;
  /** How long a relay credential lasts (default: see `meshRelayCredential`). */
  readonly credentialTtlMs?: number;
}

/** Which way an attempt reaches the peer: directly only, or through one kind of relay too. */
type TRelayStage = 'direct' | 'embedded' | 'configured';

export interface IDeviceMeshNodeOptions {
  readonly identity: IDeviceHandshakeIdentity;
  /** This device's signed descriptor of the session it offers to peers. */
  readonly sessionDescriptor: ISessionDescriptor;
  /** What this device lets a peer be asked for; an admission grants the intersection. */
  readonly localPolicy: readonly TDeviceCapability[];
  readonly relay: IMeshRelay;
  /**
   * The operator of this session, asked before a peer may use a capability that needs approval.
   * Absent: such capabilities are refused.
   */
  readonly operatorApprover?: IOperatorApprover;
  readonly iceServers?: readonly IIceServer[];
  readonly relays?: IDeviceMeshRelayOptions;
  /** This device's own relay: told which devices it serves whenever the lists in force change. */
  readonly relayServer?: { declarePeers(peers: readonly IMeshRelayPeer[]): void };
  /** Before a remote admission, ask a signing-key holder for newer lists (see the device handshake). */
  readonly fetchLatestLists?: (signal: AbortSignal) => Promise<unknown>;
  /** Newer verified lists adopted during a handshake, for the caller to persist. */
  readonly onListsAdopted?: (update: IListUpdate) => void;
  /** From the first signal of an attempt to its admission (default 20 s). */
  readonly connectTimeoutMs?: number;
  readonly handshakeTimeoutMs?: number;
  /** Test seam: inject the `node-datachannel` module. */
  readonly loadDataChannel?: () => IDataChannelModule;
  readonly now?: () => number;
}

/** An admitted connection to one peer device. */
export interface IDeviceMeshLink {
  readonly admission: IDeviceMeshAdmission;
  readonly result: IDeviceHandshakeResult;
  /** What the peer may do on this connection; ask it before acting on the peer's request. */
  readonly authority: ConnectionAuthority;
  send(body: string): void;
  onMessage(handler: (body: string) => void): () => void;
  /**
   * A channel of its own for one file transfer. What travels on it is the file carrier's; the peer
   * decides on it with its operator, and this side's authority is not asked.
   */
  openFileChannel(): Promise<IFileFrameChannel>;
  /**
   * Channels the peer opened to send a file. Whoever takes them decides on each transfer, asking
   * {@link IDeviceMeshLink.authority}; with no handler, such channels are closed unread.
   */
  onFileChannel(handler: (channel: IFileFrameChannel) => void): () => void;
  onClose(handler: () => void): () => void;
  close(): void;
}

/** A data channel as a file frame channel. */
function fileFrameChannel(channel: RtcChannel): IFileFrameChannel {
  return {
    send: (frame) => channel.send(frame),
    onFrame: (handler) => channel.onMessage(handler),
    onClose: (handler) => {
      if (channel.readyState === 'closed') {
        queueMicrotask(handler);
        return () => undefined;
      }
      return channel.onStateChange((state) => {
        if (state === 'closed') handler();
      });
    },
    close: () => channel.close(),
  };
}

/** A connection attempt that ended before admission. */
export interface IDeviceMeshRefusal {
  readonly deviceId: string;
  readonly end: TMeshLinkEnd;
  /**
   * Why: a {@link MeshLinkEndedError} (its `cause` is e.g. the handshake refusal), a
   * {@link MeshRelayNeededError} when the peer needs a relay and none could be tried, or why the
   * device was dropped.
   */
  readonly error?: unknown;
}

interface IAttempt {
  readonly cid: string;
  /** The peer's run this attempt connects to. */
  readonly remoteInstance: string;
  readonly link: MeshPeerLink;
  exposed?: IDeviceMeshLink;
  /** Set once the attempt's connection is created. */
  relayStage?: TRelayStage;
}

/** Runs an action at most once per interval; a later one waits, and only the latest waiting one runs. */
class Pacer {
  private last?: number;
  private waiting?: () => void;
  private timer?: ReturnType<typeof setTimeout>;

  public run(action: () => void): void {
    const now = Date.now();
    if (this.last === undefined || now - this.last >= MIN_ATTEMPT_INTERVAL_MS) {
      this.last = now;
      action();
      return;
    }
    this.waiting = action;
    if (this.timer !== undefined) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        const next = this.waiting;
        this.waiting = undefined;
        if (next !== undefined) this.run(next);
      },
      MIN_ATTEMPT_INTERVAL_MS - (now - this.last),
    );
    this.timer.unref?.();
  }

  public cancel(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.waiting = undefined;
  }
}

interface IPeerState {
  readonly device: IDeviceCertificate;
  readonly role: TMeshLinkRole;
  readonly rendezvous: IPairRendezvous;
  readonly inbound: string;
  readonly outbound: string;
  /** The pair's connection. */
  admitted?: IAttempt;
  /** A connection being set up, beside the admitted one until it is admitted itself. */
  pending?: IAttempt;
  readonly attempts: Pacer;
  readonly replies: Pacer;
  /** An offer waiting for its pacing slot, and the candidates that arrived for it meanwhile. */
  waitingOffer?: { readonly cid: string; readonly from: string; readonly ice: TMeshLinkSignal[] };
  /** Relayed attempts in a row whose connection never came up: which relay stage is next. */
  relayFailures: number;
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** Whether `next` is a newer list issued by the same signing key as `current`. */
function newer<T extends { readonly seq: number; readonly signingKeyId?: string }>(
  current: T,
  next: T | undefined,
): next is T {
  return next !== undefined && next.seq > current.seq && next.signingKeyId === current.signingKeyId;
}

function maxSeq(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** The higher mark of each list, per signing key: marks only ever move forward. */
function mergeMarks(a: IListHighWaterMarks, b: IListHighWaterMarks): IListHighWaterMarks {
  const merged = new Map<string, { rosterSeq?: number; revocationSeq?: number }>();
  for (const table of [a.bySigningKey ?? {}, b.bySigningKey ?? {}]) {
    for (const [keyId, marks] of Object.entries(table)) {
      const held = merged.get(keyId) ?? {};
      const rosterSeq = maxSeq(held.rosterSeq, marks.rosterSeq);
      const revocationSeq = maxSeq(held.revocationSeq, marks.revocationSeq);
      merged.set(keyId, {
        ...(rosterSeq !== undefined ? { rosterSeq } : {}),
        ...(revocationSeq !== undefined ? { revocationSeq } : {}),
      });
    }
  }
  // `fromEntries` defines own properties, so no key id can reach the prototype.
  const bySigningKey = Object.fromEntries(merged);
  const signingKeyRevocationSeq = maxSeq(a.signingKeyRevocationSeq, b.signingKeyRevocationSeq);
  return {
    ...(signingKeyRevocationSeq !== undefined ? { signingKeyRevocationSeq } : {}),
    bySigningKey,
  };
}

/**
 * `next`, but never older than what is in force: a list this node already holds from the same
 * signing key with a higher `seq` stays, so a refresh from a store that missed an adopted revocation
 * cannot roll it back. A new signing key's lists (after recovery) are taken as they are.
 */
function mergeIdentity(
  current: IDeviceHandshakeIdentity,
  next: IDeviceHandshakeIdentity,
): IDeviceHandshakeIdentity {
  const sameKey =
    next.signingKeyCertificate.signingKeyId === current.signingKeyCertificate.signingKeyId;
  return {
    ...next,
    ...(sameKey && newer(next.roster, current.roster) ? { roster: current.roster } : {}),
    ...(sameKey && newer(next.revocation, current.revocation)
      ? { revocation: current.revocation }
      : {}),
    ...(current.signingKeyRevocation.seq > next.signingKeyRevocation.seq
      ? { signingKeyRevocation: current.signingKeyRevocation }
      : {}),
    marks: mergeMarks(current.marks, next.marks),
  };
}

export class DeviceMeshNode {
  /** This run's instance id. */
  public readonly instance = randomId();
  private identity: IDeviceHandshakeIdentity;
  private sessionDescriptor: ISessionDescriptor;
  private readonly peers = new Map<string, IPeerState>();
  private readonly byInbound = new Map<string, IPeerState>();
  private readonly linkHandlers = new Set<(link: IDeviceMeshLink) => void>();
  private readonly refusalHandlers = new Set<(refusal: IDeviceMeshRefusal) => void>();
  private readonly waiters = new Set<(error: Error) => void>();
  private readonly unsubscribes: (() => void)[] = [];
  private started = false;
  private stopped = false;
  private sync: Promise<void> = Promise.resolve();

  public constructor(private readonly options: IDeviceMeshNodeOptions) {
    this.identity = options.identity;
    this.sessionDescriptor = options.sessionDescriptor;
  }

  public get deviceId(): string {
    return this.identity.deviceCertificate.deviceId;
  }

  /** Derive the inbox topics, be present at them, and announce this run to every peer device. */
  public async start(): Promise<void> {
    if (this.started) throw new Error('DeviceMeshNode already started');
    this.started = true;
    this.unsubscribes.push(
      this.options.relay.onMessage((topic, data) => this.receive(topic, data)),
    );
    await this.syncPeers();
  }

  /**
   * Use newer lists or a new session descriptor from the next handshake on. A list older than the
   * one in force is ignored. Peers the lists no longer name, or revoke, are dropped with their
   * connections; new ones are announced to.
   */
  public refresh(update: {
    readonly identity?: IDeviceHandshakeIdentity;
    readonly sessionDescriptor?: ISessionDescriptor;
  }): Promise<void> {
    if (update.sessionDescriptor !== undefined) this.sessionDescriptor = update.sessionDescriptor;
    if (update.identity === undefined) return Promise.resolve();
    this.identity = mergeIdentity(this.identity, update.identity);
    return this.syncPeers();
  }

  /** Recompute the peer set from the current lists; serialized so two refreshes never interleave. */
  private syncPeers(): Promise<void> {
    this.sync = this.sync.then(async () => {
      if (this.stopped) return;
      const identity = this.identity;
      const self = identity.deviceCertificate;
      const revoked = new Set(identity.revocation.revokedDeviceIds);
      const wanted = new Map<string, IDeviceCertificate>();
      for (const device of identity.roster.devices) {
        if (device.deviceId !== self.deviceId && !revoked.has(device.deviceId)) {
          wanted.set(device.deviceId, device);
        }
      }
      for (const [deviceId, state] of this.peers) {
        const device = wanted.get(deviceId);
        if (
          device !== undefined &&
          device.kaKey === state.device.kaKey &&
          device.kaEpoch === state.device.kaEpoch
        ) {
          continue;
        }
        this.drop(state);
      }
      const added: IPeerState[] = [];
      for (const [deviceId, device] of wanted) {
        if (this.peers.has(deviceId)) continue;
        let rendezvous: IPairRendezvous;
        let topics: IRelayInboxTopics;
        try {
          rendezvous = await derivePairRendezvous({
            ownKaPrivateKey: identity.kaPrivateKey,
            own: self,
            peerDeviceId: deviceId,
            lists: identity,
          });
          topics = await rendezvous.relayInbox();
        } catch {
          // allow-fallback: a device no pairwise secret can be agreed with cannot be reached; the rest can
          continue;
        }
        const state: IPeerState = {
          device,
          role: self.deviceId < device.deviceId ? 'offerer' : 'answerer',
          rendezvous,
          inbound: topics.inbound,
          outbound: topics.outbound,
          attempts: new Pacer(),
          replies: new Pacer(),
          relayFailures: 0,
        };
        this.peers.set(deviceId, state);
        this.byInbound.set(topics.inbound, state);
        added.push(state);
      }
      if (this.stopped) return;
      this.options.relayServer?.declarePeers(
        [...this.peers.values()].map((peer) => ({
          deviceId: peer.device.deviceId,
          rendezvous: peer.rendezvous,
        })),
      );
      this.options.relay.declarePresence([...this.byInbound.keys()]);
      const routes = this.peerRoutes();
      this.options.relay.declarePeers?.(routes);
      // Learn the peers' relays ahead of the first attempt, so it does not wait on the lookup.
      // allow-fallback: a lookup that fails here is run again by the attempt that needs it
      this.options.relays
        ?.advertised?.(routes, AbortSignal.timeout(RELAY_ADVERT_LOOKUP_MS))
        .catch(() => undefined);
      for (const state of added) this.hello(state);
    });
    const done = this.sync;
    // One failed sync must not stop every later one.
    this.sync = done.catch(() => undefined);
    return done;
  }

  private drop(state: IPeerState): void {
    this.peers.delete(state.device.deviceId);
    this.byInbound.delete(state.inbound);
    state.attempts.cancel();
    state.replies.cancel();
    const { pending, admitted } = state;
    state.pending = undefined;
    state.admitted = undefined;
    pending?.link.close();
    admitted?.link.close();
    if (pending !== undefined && !this.stopped) {
      const refusal: IDeviceMeshRefusal = {
        deviceId: state.device.deviceId,
        end: 'closed',
        error: new Error('peer device was revoked or is no longer in the roster'),
      };
      for (const handler of this.refusalHandlers) handler(refusal);
    }
  }

  /** The offerer for a pair is the device with the lower id. */
  public roleFor(deviceId: string): TMeshLinkRole | undefined {
    return this.peers.get(deviceId)?.role;
  }

  /** The admitted link to `deviceId`, if there is one. */
  public link(deviceId: string): IDeviceMeshLink | undefined {
    return this.peers.get(deviceId)?.admitted?.exposed;
  }

  /**
   * An admitted link to `deviceId`: the existing one, or a new one once the peer is reachable.
   * Rejects for a device this node will not talk to, when an attempt is refused, on timeout, or when
   * the node stops.
   */
  public connect(
    deviceId: string,
    timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
  ): Promise<IDeviceMeshLink> {
    if (this.stopped) return Promise.reject(new Error('device mesh node stopped'));
    const state = this.peers.get(deviceId);
    if (state === undefined) {
      return Promise.reject(new Error('not a rostered, unrevoked peer device'));
    }
    const existing = state.admitted?.exposed;
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<IDeviceMeshLink>((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer);
        offLink();
        offRefusal();
        this.waiters.delete(fail);
      };
      const fail = (error: Error): void => {
        done();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(new Error('peer device did not connect in time')),
        timeoutMs,
      );
      timer.unref?.();
      const offLink = this.onLink((link) => {
        if (link.admission.deviceId !== deviceId) return;
        done();
        resolve(link);
      });
      const offRefusal = this.onRefusal((refusal) => {
        if (refusal.deviceId !== deviceId) return;
        fail(
          refusal.error instanceof Error ? refusal.error : new Error(`connection ${refusal.end}`),
        );
      });
      this.waiters.add(fail);
      this.hello(state);
    });
  }

  public onLink(handler: (link: IDeviceMeshLink) => void): () => void {
    this.linkHandlers.add(handler);
    return () => this.linkHandlers.delete(handler);
  }

  public onRefusal(handler: (refusal: IDeviceMeshRefusal) => void): () => void {
    this.refusalHandlers.add(handler);
    return () => this.refusalHandlers.delete(handler);
  }

  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    for (const state of [...this.peers.values()]) this.drop(state);
    for (const fail of [...this.waiters]) fail(new Error('device mesh node stopped'));
    this.linkHandlers.clear();
    this.refusalHandlers.clear();
  }

  private hello(state: IPeerState): void {
    if (this.stopped) return;
    this.options.relay.send(state.outbound, {
      v: MESH_SIGNAL_VERSION,
      kind: 'hello',
      from: this.instance,
    });
  }

  private receive(topic: string, data: unknown): void {
    if (this.stopped) return;
    const state = this.byInbound.get(topic);
    if (state === undefined) return;
    const signal = decodeMeshSignal(data);
    if (signal === undefined) return;
    if (signal.kind === 'hello') {
      this.onHello(state, signal.from);
      return;
    }
    if (signal.to !== this.instance) return; // meant for a previous run of this node
    if (signal.kind === 'offer') {
      this.onOffer(state, signal);
      return;
    }
    for (const attempt of [state.pending, state.admitted]) {
      if (attempt?.cid === signal.cid && attempt.remoteInstance === signal.from) {
        attempt.link.onSignal(toLinkSignal(signal));
        return;
      }
    }
    const waiting = state.waitingOffer;
    if (
      signal.kind === 'ice' &&
      waiting?.cid === signal.cid &&
      waiting.from === signal.from &&
      waiting.ice.length < MAX_WAITING_CANDIDATES
    ) {
      waiting.ice.push(toLinkSignal(signal));
    }
  }

  /** The run already being served, or being connected to. */
  private serves(state: IPeerState, remoteInstance: string): boolean {
    return (
      state.admitted?.remoteInstance === remoteInstance ||
      state.pending?.remoteInstance === remoteInstance
    );
  }

  private onHello(state: IPeerState, remoteInstance: string): void {
    if (this.serves(state, remoteInstance)) return;
    if (state.role === 'answerer') {
      // Only the offerer opens a connection; tell it this run is here.
      state.replies.run(() => this.hello(state));
      return;
    }
    state.attempts.run(() => {
      if (this.stopped || this.peers.get(state.device.deviceId) !== state) return;
      if (this.serves(state, remoteInstance)) return;
      void this.startAttempt(state, remoteInstance, randomId()).link.offer();
    });
  }

  private onOffer(state: IPeerState, signal: IMeshDescription): void {
    // Glare resolution: an offer toward the pair's offerer is not taken, whoever sent it.
    if (state.role !== 'answerer') return;
    if (state.admitted?.cid === signal.cid || state.pending?.cid === signal.cid) return;
    const waiting = { cid: signal.cid, from: signal.from, ice: [] as TMeshLinkSignal[] };
    state.waitingOffer = waiting;
    state.attempts.run(() => {
      if (state.waitingOffer === waiting) state.waitingOffer = undefined;
      if (this.stopped || this.peers.get(state.device.deviceId) !== state) return;
      if (state.admitted?.cid === signal.cid || state.pending?.cid === signal.cid) return;
      const { link } = this.startAttempt(state, signal.from, signal.cid);
      link.onSignal(toLinkSignal(signal));
      for (const candidate of waiting.ice) link.onSignal(candidate);
    });
  }

  /** A new attempt replaces any other pending one, never the admitted connection. */
  private startAttempt(state: IPeerState, remoteInstance: string, cid: string): IAttempt {
    const previous = state.pending;
    state.pending = undefined;
    previous?.link.close();
    const send = (signal: TMeshLinkSignal): void => {
      if (this.stopped) return;
      this.options.relay.send(state.outbound, {
        v: MESH_SIGNAL_VERSION,
        from: this.instance,
        to: remoteInstance,
        cid,
        ...signal,
      });
    };
    let attempt: IAttempt | undefined;
    const link: MeshPeerLink = new MeshPeerLink({
      role: state.role,
      createPeer: async () => {
        const { stage, servers } = await this.relayStage(state);
        if (attempt !== undefined) attempt.relayStage = stage;
        return this.createPeer(servers);
      },
      sendSignal: send,
      startHandshake: (binding) =>
        startDeviceHandshake({
          role: state.role === 'offerer' ? 'initiator' : 'responder',
          identity: this.identity,
          sessionDescriptor: this.sessionDescriptor,
          ...(state.role === 'offerer' ? { expectedPeerDeviceId: state.device.deviceId } : {}),
          localFingerprint: binding.localFingerprint,
          remoteFingerprint: binding.remoteFingerprint,
          // A data channel proves nothing about where the peer runs.
          locality: 'another-host',
          localPolicy: this.options.localPolicy,
          send: binding.send,
          ...(this.options.fetchLatestLists !== undefined
            ? { fetchLatestLists: this.options.fetchLatestLists }
            : {}),
          onListsAdopted: (update) => this.adoptLists(update),
          ...(this.options.now !== undefined ? { now: this.options.now } : {}),
          ...(this.options.handshakeTimeoutMs !== undefined
            ? { timeoutMs: this.options.handshakeTimeoutMs }
            : {}),
        }),
      connectTimeoutMs: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
      // The inbox the peer reached is the pair's: only that device is taken, before it is told so.
      accepts: (result) => result.admission.deviceId === state.device.deviceId,
      onAdmitted: (result) => this.admitted(state, link, result),
      onEnded: (end, error) => this.ended(state, link, end, error),
    });
    attempt = { cid, remoteInstance, link };
    state.pending = attempt;
    return attempt;
  }

  /** Lists the handshake verified and found newer: in force here at once, then handed to the caller. */
  private adoptLists(update: IListUpdate): void {
    const current = this.identity;
    const next: IDeviceHandshakeIdentity = {
      ...current,
      ...(newer(current.roster, update.roster) ? { roster: update.roster } : {}),
      ...(newer(current.revocation, update.revocation) ? { revocation: update.revocation } : {}),
      ...(update.signingKeyRevocation !== undefined &&
      update.signingKeyRevocation.seq > current.signingKeyRevocation.seq
        ? { signingKeyRevocation: update.signingKeyRevocation }
        : {}),
      marks: mergeMarks(current.marks, update.marks),
    };
    // allow-fallback: a failed sync keeps the lists in force; the adopted ones apply to handshakes regardless
    this.refresh({ identity: next }).catch(() => undefined);
    this.options.onListsAdopted?.(update);
  }

  private admitted(state: IPeerState, link: MeshPeerLink, result: IDeviceHandshakeResult): void {
    const attempt = state.pending;
    if (attempt === undefined || attempt.link !== link) return;
    // The inbox the peer reached is the pair's; any other admitted device is not this pair's peer.
    if (result.admission.deviceId !== state.device.deviceId) {
      link.close();
      return;
    }
    const admission = result.admission;
    const authority = new ConnectionAuthority(
      {
        deviceId: admission.deviceId,
        sessionId: admission.sessionId,
        locality: admission.locality,
        capabilities: admission.capabilities,
      },
      this.options.operatorApprover,
    );
    // A message from the peer is delivered only when this connection's authority allows it; the
    // decision is taken once and every message waits on it, so order is kept.
    const messaging = authority.authorize('message');
    const exposed: IDeviceMeshLink = {
      admission,
      result,
      authority,
      send: (body) => link.send(body),
      onMessage: (handler) =>
        link.onMessage((body) => {
          void messaging.then((decision) => {
            if (decision.allowed) handler(body);
            else link.close();
          });
        }),
      openFileChannel: async () => fileFrameChannel(await link.openFileChannel()),
      onFileChannel: (handler) =>
        link.onFileChannel((channel) => handler(fileFrameChannel(channel))),
      onClose: (handler) => link.onEnd(() => handler()),
      close: () => link.close(),
    };
    attempt.exposed = exposed;
    state.relayFailures = 0;
    const previous = state.admitted;
    state.admitted = attempt;
    state.pending = undefined;
    previous?.link.close();
    this.options.relay.confirmPeer?.(admission.deviceId);
    for (const handler of this.linkHandlers) handler(exposed);
  }

  private ended(
    state: IPeerState,
    link: MeshPeerLink,
    end: TMeshLinkEnd,
    error: MeshLinkEndedError,
  ): void {
    if (state.admitted?.link === link) {
      state.admitted = undefined;
      return;
    }
    if (state.pending?.link !== link) return;
    const stage = state.pending.relayStage;
    state.pending = undefined;
    // This side took the peer's description, so the peer is up and paths were being tried, and
    // still none connected: ICE failed, or was still checking when time ran out. (An answer lost on
    // its way looks the same to the answerer; the cause attached says which.) Only this calls for
    // a relay; an attempt that ended before paths were tried, or after one connected, is reported
    // as it ended.
    const unreachable =
      error.stage === 'connecting' &&
      (end === 'timeout' || error.peer?.state === 'failed') &&
      error.peer?.history.includes('connected') !== true;
    let reported: unknown = error;
    if (error.cause instanceof MeshRelayNeededError) reported = error.cause;
    else if (unreachable && stage === 'direct') {
      reported = new MeshRelayNeededError(state.device.deviceId, 'no-direct-path', {
        cause: error,
      });
    } else if (unreachable) state.relayFailures += 1;
    const refusal: IDeviceMeshRefusal = {
      deviceId: state.device.deviceId,
      end,
      error: reported,
    };
    for (const handler of this.refusalHandlers) handler(refusal);
  }

  /**
   * The relays the next attempt to `state`'s peer uses: the ones paired devices advertise, then the
   * configured ones once those did not carry a connection, and round again. None: a direct attempt,
   * or — when only relay candidates may be used — a refusal naming the missing relay.
   */
  private async relayStage(
    state: IPeerState,
  ): Promise<{ readonly stage: TRelayStage; readonly servers: readonly IIceServer[] }> {
    const relays = this.options.relays;
    const stages: { readonly stage: TRelayStage; readonly servers: readonly IIceServer[] }[] = [];
    const embedded = await this.embeddedRelays(state);
    if (embedded.length > 0) stages.push({ stage: 'embedded', servers: embedded });
    if (relays?.configured !== undefined && relays.configured.length > 0) {
      stages.push({ stage: 'configured', servers: relays.configured });
    }
    if (stages.length === 0) {
      if (relays?.relayOnly === true) {
        throw new MeshRelayNeededError(state.device.deviceId, 'relay-only');
      }
      return { stage: 'direct', servers: [] };
    }
    return stages[state.relayFailures % stages.length]!;
  }

  /** The routes of every peer, `first`'s first: a lookup bounded to some peers covers it. */
  private peerRoutes(first?: IPeerState): IMeshPeerRoute[] {
    const states = [...this.peers.values()];
    const ordered = first === undefined ? states : [first, ...states.filter((p) => p !== first)];
    return ordered.map((peer) => ({
      deviceId: peer.device.deviceId,
      inbound: peer.inbound,
      outbound: peer.outbound,
      rendezvous: peer.rendezvous,
    }));
  }

  /**
   * ICE servers for the relays paired devices advertise, with this pair's credential for each: the
   * peer's own relay first. Only a device the lists in force name, unrevoked, is asked to relay.
   */
  private async embeddedRelays(state: IPeerState): Promise<IIceServer[]> {
    const advertised = this.options.relays?.advertised;
    if (advertised === undefined) return [];
    let found: ReadonlyMap<string, readonly IMeshRelayEndpoint[]>;
    try {
      found = await advertised(this.peerRoutes(state), AbortSignal.timeout(RELAY_ADVERT_LOOKUP_MS));
    } catch {
      // allow-fallback: no advertised relay is known; the configured ones, or the explicit refusal, follow
      return [];
    }
    const peerId = state.device.deviceId;
    const order = [peerId, ...[...found.keys()].filter((deviceId) => deviceId !== peerId)];
    const now = (this.options.now ?? Date.now)();
    const servers: IIceServer[] = [];
    let devices = 0;
    for (const deviceId of order) {
      if (devices >= MAX_RELAY_DEVICES) break;
      const endpoints = found.get(deviceId);
      const relayDevice = this.peers.get(deviceId);
      if (endpoints === undefined || endpoints.length === 0 || relayDevice === undefined) continue;
      devices += 1;
      servers.push(
        ...(await meshRelayIceServers(
          relayDevice.rendezvous,
          endpoints.slice(0, MAX_RELAY_ENDPOINTS),
          now,
          this.options.relays?.credentialTtlMs,
        )),
      );
    }
    return servers;
  }

  /**
   * A connection with a DTLS certificate of its own (the implementation makes one per connection):
   * a per-process certificate would be a stable identifier the relay could link across connections.
   * No ICE server is contacted unless one is configured or a paired device advertises its relay.
   */
  private createPeer(relayServers: readonly IIceServer[]): RtcPeer {
    const iceServers = [...(this.options.iceServers ?? []), ...relayServers];
    return new RtcPeer({
      ...(iceServers.length > 0 ? { iceServers } : {}),
      ...(this.options.relays?.relayOnly === true ? { forceTurn: true } : {}),
      ...(this.options.loadDataChannel !== undefined
        ? { loadDataChannel: this.options.loadDataChannel }
        : {}),
    });
  }
}

function toLinkSignal(signal: Exclude<TMeshSignal, { kind: 'hello' }>): TMeshLinkSignal {
  return signal.kind === 'ice'
    ? { kind: 'ice', candidate: { ...signal.candidate } }
    : { kind: signal.kind, sdp: signal.sdp };
}

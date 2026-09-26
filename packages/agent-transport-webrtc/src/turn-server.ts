/**
 * A TURN server (RFC 8656) over UDP: the subset a WebRTC client needs to reach a peer through a
 * relayed address — Allocate, Refresh, CreatePermission, ChannelBind, Send and Data indications,
 * ChannelData — with the long-term credential mechanism (RFC 8489 §9.2).
 *
 * It relays datagrams and nothing else: what crosses it is the peers' own DTLS, which it cannot
 * open. Who may allocate is the caller's answer ({@link ITurnServerOptions.authorize}), asked once
 * per allocation; the key it yields then authenticates every later request on that allocation, so
 * an allocation outlives its credential's expiry but not its owner's removal ({@link TurnServer.retain}).
 * Quotas bound what one owner can take: allocations, relayed bytes per second, and how long an
 * allocation may live.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

import {
  StunAttr,
  StunClass,
  StunMethod,
  attribute,
  attributes,
  decodeChannelData,
  decodeStun,
  decodeXorAddress,
  encodeChannelData,
  encodeStun,
  encodeXorAddress,
  errorCode,
  isChannelData,
  longTermKey,
  verifyIntegrity,
  uint32,
  MAX_CHANNEL,
  MIN_CHANNEL,
  type IStunMessage,
  type ITransportAddress,
} from './stun-message.js';

/** Who a username belongs to, and the password it was issued with. */
export interface ITurnAuthorization {
  /** The owner quotas are counted against and {@link TurnServer.retain} names. */
  readonly owner: string;
  readonly password: string;
}

export interface ITurnQuotas {
  /** Allocations one owner may hold at once. */
  readonly allocationsPerOwner: number;
  /** Allocations the server holds at once. */
  readonly totalAllocations: number;
  /** Bytes relayed per second for one owner, both directions together; more is dropped. */
  readonly bytesPerSecondPerOwner: number;
  /** The longest lifetime one Allocate or Refresh grants. */
  readonly maxLifetimeSeconds: number;
  /** How long an allocation may live however often it is refreshed. */
  readonly maxAllocationAgeMs: number;
  readonly permissionsPerAllocation: number;
  readonly channelsPerAllocation: number;
}

export const DEFAULT_TURN_QUOTAS: ITurnQuotas = {
  allocationsPerOwner: 8,
  totalAllocations: 64,
  bytesPerSecondPerOwner: 1024 * 1024,
  maxLifetimeSeconds: 3600,
  maxAllocationAgeMs: 12 * 60 * 60 * 1000,
  permissionsPerAllocation: 32,
  channelsPerAllocation: 32,
};

export interface ITurnServerOptions {
  /** The address the server and its relayed sockets bind (default every IPv4 interface). */
  readonly host?: string;
  /** The server's UDP port (default 3478; 0 picks a free one). */
  readonly port?: number;
  /** The address relayed transport addresses carry (default `host`, or this machine's first external IPv4). */
  readonly relayAddress?: string;
  /** Default `relay`: a realm travels in the clear, so it names nothing. */
  readonly realm?: string;
  /** Who `username` belongs to and its password; `undefined` refuses it. Asked once per allocation. */
  readonly authorize: (username: string) => Promise<ITurnAuthorization | undefined>;
  readonly quotas?: Partial<ITurnQuotas>;
  /**
   * Whether data may be relayed to or from `address`. Default: not unspecified, multicast or
   * broadcast addresses, and not loopback unless the relay itself is on loopback.
   */
  readonly allowPeer?: (address: string) => boolean;
  readonly now?: () => number;
  /** A socket failed; the server keeps running. */
  readonly onError?: (error: Error) => void;
}

const DEFAULT_LIFETIME_SECONDS = 600;
const PERMISSION_LIFETIME_MS = 300_000;
const CHANNEL_LIFETIME_MS = 600_000;
const NONCE_LIFETIME_MS = 600_000;
const SWEEP_INTERVAL_MS = 5_000;
const UDP = 17;

/** Attributes a request may carry that this server understands or may ignore by RFC. */
const UNDERSTOOD = new Set<number>([
  StunAttr.MappedAddress,
  StunAttr.Username,
  StunAttr.MessageIntegrity,
  StunAttr.ErrorCode,
  StunAttr.ChannelNumber,
  StunAttr.Lifetime,
  StunAttr.XorPeerAddress,
  StunAttr.Data,
  StunAttr.Realm,
  StunAttr.Nonce,
  StunAttr.RequestedAddressFamily,
  StunAttr.RequestedTransport,
  StunAttr.MessageIntegritySha256,
  StunAttr.PasswordAlgorithm,
  StunAttr.XorMappedAddress,
  StunAttr.Priority,
  StunAttr.UseCandidate,
]);

interface IChannel {
  readonly number: number;
  readonly peer: ITransportAddress;
  expiresAt: number;
}

interface IAllocation {
  readonly key: string;
  readonly client: ITransportAddress;
  readonly owner: string;
  readonly username: string;
  readonly integrityKey: Buffer;
  readonly transactionId: Buffer;
  readonly socket: Socket;
  readonly relayed: ITransportAddress;
  readonly createdAt: number;
  expiresAt: number;
  /** Peer IP → expiry. */
  readonly permissions: Map<string, number>;
  readonly channelsByNumber: Map<number, IChannel>;
  readonly channelsByPeer: Map<string, IChannel>;
  response: Buffer;
}

interface IBucket {
  tokens: number;
  at: number;
}

function clientKey(rinfo: RemoteInfo | ITransportAddress): string {
  return `${rinfo.address}:${rinfo.port}`;
}

function firstExternalIpv4(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function isLoopback(address: string): boolean {
  return address.startsWith('127.') || address === '::1';
}

function defaultAllowPeer(relayOnLoopback: boolean): (address: string) => boolean {
  return (address) => {
    if (!isIPv4(address)) return false;
    const first = Number(address.split('.')[0]);
    if (first === 0 || first >= 224) return false; // unspecified, multicast, reserved, broadcast
    if (first === 127) return relayOnLoopback;
    return true;
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export class TurnServer {
  private readonly allocations = new Map<string, IAllocation>();
  private readonly buckets = new Map<string, IBucket>();
  private readonly quotas: ITurnQuotas;
  private readonly realm: string;
  private readonly nonceSecret = randomBytes(32);
  private readonly allowPeer: (address: string) => boolean;
  private readonly sweeper: ReturnType<typeof setInterval>;
  /** Once {@link TurnServer.retain} has named them: the only owners that may allocate. */
  private retained?: ReadonlySet<string>;
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly options: ITurnServerOptions,
    private readonly bindHost: string,
    private readonly relayAddress: string,
  ) {
    this.quotas = { ...DEFAULT_TURN_QUOTAS, ...options.quotas };
    this.realm = options.realm ?? 'relay';
    this.allowPeer = options.allowPeer ?? defaultAllowPeer(isLoopback(relayAddress));
    socket.on('message', (data, rinfo) => this.receive(data, rinfo));
    socket.on('error', (error) => options.onError?.(error));
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  /** Bind the server's socket and start serving. */
  public static async start(options: ITurnServerOptions): Promise<TurnServer> {
    const host = options.host ?? '0.0.0.0';
    const socket = createSocket('udp4');
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(options.port ?? 3478, host, () => {
        socket.off('error', reject);
        resolve();
      });
    });
    const relayAddress = options.relayAddress ?? (host === '0.0.0.0' ? firstExternalIpv4() : host);
    return new TurnServer(socket, options, host, relayAddress);
  }

  /** Where clients reach the server. */
  public get address(): ITransportAddress {
    const bound = this.socket.address();
    return {
      address: this.bindHost === '0.0.0.0' ? this.relayAddress : bound.address,
      port: bound.port,
    };
  }

  /** Allocations held, by one owner or in all. */
  public allocationCount(owner?: string): number {
    if (owner === undefined) return this.allocations.size;
    let count = 0;
    for (const allocation of this.allocations.values()) if (allocation.owner === owner) count += 1;
    return count;
  }

  /**
   * Close every allocation whose owner is not one of `owners`, and allocate for these owners only
   * from now on — also for a request whose authorization was answered before this call.
   */
  public retain(owners: ReadonlySet<string>): void {
    this.retained = new Set(owners);
    for (const allocation of [...this.allocations.values()]) {
      if (!owners.has(allocation.owner)) this.remove(allocation);
    }
    for (const owner of [...this.buckets.keys()])
      if (!owners.has(owner)) this.buckets.delete(owner);
  }

  public close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    clearInterval(this.sweeper);
    for (const allocation of [...this.allocations.values()]) this.remove(allocation);
    return new Promise((resolve) => this.socket.close(() => resolve()));
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private receive(data: Buffer, rinfo: RemoteInfo): void {
    if (this.closed) return;
    if (isChannelData(data)) {
      this.fromClientChannel(data, rinfo);
      return;
    }
    const message = decodeStun(data);
    if (message === undefined) return;
    if (message.cls === StunClass.Indication) {
      if (message.method === StunMethod.Send) this.fromClientSend(message, rinfo);
      return;
    }
    if (message.cls !== StunClass.Request) return;
    this.request(message, rinfo).catch((error: unknown) => this.options.onError?.(asError(error)));
  }

  private send(data: Buffer, to: ITransportAddress): void {
    if (this.closed) return;
    this.socket.send(data, to.port, to.address, (error) => {
      if (error) this.options.onError?.(error);
    });
  }

  private reply(
    request: IStunMessage,
    to: ITransportAddress,
    attrs: { type: number; value: Buffer }[],
    key?: Buffer,
  ): Buffer {
    const response = encodeStun(request.method, StunClass.Success, request.transactionId, attrs, {
      ...(key !== undefined ? { integrityKey: key } : {}),
    });
    this.send(response, to);
    return response;
  }

  private fail(
    request: IStunMessage,
    to: ITransportAddress,
    code: number,
    reason: string,
    extra: { type: number; value: Buffer }[] = [],
    key?: Buffer,
  ): void {
    const response = encodeStun(
      request.method,
      StunClass.Error,
      request.transactionId,
      [{ type: StunAttr.ErrorCode, value: errorCode(code, reason) }, ...extra],
      { ...(key !== undefined ? { integrityKey: key } : {}) },
    );
    this.send(response, to);
  }

  private nonce(client: ITransportAddress): string {
    const issued = Math.floor(this.now() / 1000)
      .toString(16)
      .padStart(10, '0');
    return issued + this.nonceMac(issued, client);
  }

  private nonceMac(issued: string, client: ITransportAddress): string {
    return createHmac('sha256', this.nonceSecret)
      .update(`${issued}|${clientKey(client)}`)
      .digest('hex')
      .slice(0, 32);
  }

  private nonceValid(nonce: string, client: ITransportAddress): boolean {
    if (nonce.length !== 42) return false;
    const issued = nonce.slice(0, 10);
    const expected = Buffer.from(this.nonceMac(issued, client));
    const given = Buffer.from(nonce.slice(10));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    const age = this.now() - parseInt(issued, 16) * 1000;
    return age >= -60_000 && age <= NONCE_LIFETIME_MS;
  }

  private challenge(request: IStunMessage, to: ITransportAddress, code: 401 | 438): void {
    this.fail(request, to, code, code === 401 ? 'Unauthorized' : 'Stale Nonce', [
      { type: StunAttr.Realm, value: Buffer.from(this.realm) },
      { type: StunAttr.Nonce, value: Buffer.from(this.nonce(to)) },
    ]);
  }

  /**
   * Authenticate a request. On an existing allocation only its own username and key count;
   * otherwise the caller's authorization is asked. `undefined`: already answered with an error.
   */
  private async authenticate(
    request: IStunMessage,
    client: ITransportAddress,
    allocation: IAllocation | undefined,
  ): Promise<
    | { readonly auth: ITurnAuthorization; readonly key: Buffer; readonly username: string }
    | undefined
  > {
    const integrity = attribute(request, StunAttr.MessageIntegrity);
    if (integrity === undefined) {
      this.challenge(request, client, 401);
      return undefined;
    }
    const username = attribute(request, StunAttr.Username)?.toString('utf8');
    const realm = attribute(request, StunAttr.Realm)?.toString('utf8');
    const nonce = attribute(request, StunAttr.Nonce)?.toString('utf8');
    if (username === undefined || realm === undefined || nonce === undefined) {
      this.fail(request, client, 400, 'Bad Request');
      return undefined;
    }
    if (realm !== this.realm) {
      this.challenge(request, client, 401);
      return undefined;
    }
    if (!this.nonceValid(nonce, client)) {
      this.challenge(request, client, 438);
      return undefined;
    }
    if (allocation !== undefined) {
      if (username !== allocation.username) {
        this.fail(request, client, 441, 'Wrong Credentials');
        return undefined;
      }
      if (!verifyIntegrity(request, allocation.integrityKey)) {
        this.challenge(request, client, 401);
        return undefined;
      }
      return {
        auth: { owner: allocation.owner, password: '' },
        key: allocation.integrityKey,
        username,
      };
    }
    let auth: ITurnAuthorization | undefined;
    try {
      auth = await this.options.authorize(username);
    } catch {
      // allow-fallback: an authorization that cannot be answered refuses, like an unknown username
      auth = undefined;
    }
    if (this.closed) return undefined;
    const key = auth === undefined ? undefined : longTermKey(username, this.realm, auth.password);
    if (auth === undefined || key === undefined || !verifyIntegrity(request, key)) {
      this.challenge(request, client, 401);
      return undefined;
    }
    return { auth, key, username };
  }

  private unknownAttributes(request: IStunMessage): number[] {
    return request.attributes
      .map((a) => a.type)
      .filter((type) => type < 0x8000 && !UNDERSTOOD.has(type));
  }

  private async request(request: IStunMessage, rinfo: RemoteInfo): Promise<void> {
    const client: ITransportAddress = { address: rinfo.address, port: rinfo.port };
    if (request.method === StunMethod.Binding) {
      this.reply(request, client, [
        { type: StunAttr.XorMappedAddress, value: encodeXorAddress(client, request.transactionId) },
      ]);
      return;
    }
    const known: number[] = [
      StunMethod.Allocate,
      StunMethod.Refresh,
      StunMethod.CreatePermission,
      StunMethod.ChannelBind,
    ];
    if (!known.includes(request.method)) {
      this.fail(request, client, 400, 'Bad Request');
      return;
    }
    const held = this.allocations.get(clientKey(client));
    const existing = this.live(held) ? held : undefined;
    if (
      request.method === StunMethod.Allocate &&
      existing !== undefined &&
      existing.transactionId.equals(request.transactionId)
    ) {
      // A retransmission of the request that made the allocation.
      this.send(existing.response, client);
      return;
    }
    const authenticated = await this.authenticate(request, client, existing);
    if (authenticated === undefined) return;
    const { key } = authenticated;
    const unknown = this.unknownAttributes(request);
    if (unknown.length > 0) {
      const list = Buffer.alloc(unknown.length * 2);
      unknown.forEach((type, i) => list.writeUInt16BE(type, i * 2));
      this.fail(
        request,
        client,
        420,
        'Unknown Attribute',
        [{ type: StunAttr.UnknownAttributes, value: list }],
        key,
      );
      return;
    }
    const found = this.allocations.get(clientKey(client));
    const current = this.live(found) ? found : undefined;
    if (request.method === StunMethod.Allocate) {
      await this.allocate(request, client, authenticated, current);
      return;
    }
    if (current === undefined || current.owner !== authenticated.auth.owner) {
      this.fail(request, client, 437, 'Allocation Mismatch', [], key);
      return;
    }
    if (request.method === StunMethod.Refresh) this.refresh(request, client, current);
    else if (request.method === StunMethod.CreatePermission) this.permit(request, client, current);
    else this.bindChannel(request, client, current);
  }

  private async allocate(
    request: IStunMessage,
    client: ITransportAddress,
    authenticated: {
      readonly auth: ITurnAuthorization;
      readonly key: Buffer;
      readonly username: string;
    },
    existing: IAllocation | undefined,
  ): Promise<void> {
    const { auth, key, username } = authenticated;
    if (existing !== undefined) {
      this.fail(request, client, 437, 'Allocation Mismatch', [], key);
      return;
    }
    const transport = attribute(request, StunAttr.RequestedTransport);
    if (transport === undefined || transport.length !== 4) {
      this.fail(request, client, 400, 'Bad Request', [], key);
      return;
    }
    if (transport[0] !== UDP) {
      this.fail(request, client, 442, 'Unsupported Transport Protocol', [], key);
      return;
    }
    const family = attribute(request, StunAttr.RequestedAddressFamily);
    if (family !== undefined && family[0] !== 0x01) {
      this.fail(request, client, 440, 'Address Family not Supported', [], key);
      return;
    }
    if (this.retained !== undefined && !this.retained.has(auth.owner)) {
      this.fail(request, client, 403, 'Forbidden', [], key);
      return;
    }
    if (this.allocations.size >= this.quotas.totalAllocations) {
      this.fail(request, client, 508, 'Insufficient Capacity', [], key);
      return;
    }
    if (this.allocationCount(auth.owner) >= this.quotas.allocationsPerOwner) {
      this.fail(request, client, 486, 'Allocation Quota Reached', [], key);
      return;
    }
    const socket = createSocket('udp4');
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.bind(0, this.bindHost, () => {
          socket.off('error', reject);
          resolve();
        });
      });
    } catch {
      socket.close();
      this.fail(request, client, 508, 'Insufficient Capacity', [], key);
      return;
    }
    // Checked again: other allocations may have been made, or the owner removed, while the socket bound.
    if (!this.closed && this.retained !== undefined && !this.retained.has(auth.owner)) {
      socket.close();
      this.fail(request, client, 403, 'Forbidden', [], key);
      return;
    }
    if (
      this.closed ||
      this.allocations.has(clientKey(client)) ||
      this.allocationCount(auth.owner) >= this.quotas.allocationsPerOwner ||
      this.allocations.size >= this.quotas.totalAllocations
    ) {
      socket.close();
      if (!this.closed) this.fail(request, client, 486, 'Allocation Quota Reached', [], key);
      return;
    }
    const now = this.now();
    const lifetime = this.grantedLifetime(request, now, now);
    const allocation: IAllocation = {
      key: clientKey(client),
      client,
      owner: auth.owner,
      username,
      integrityKey: key,
      transactionId: Buffer.from(request.transactionId),
      socket,
      relayed: { address: this.relayAddress, port: socket.address().port },
      createdAt: now,
      expiresAt: now + lifetime * 1000,
      permissions: new Map(),
      channelsByNumber: new Map(),
      channelsByPeer: new Map(),
      response: Buffer.alloc(0),
    };
    socket.on('message', (data, rinfo) => this.fromPeer(allocation, data, rinfo));
    socket.on('error', (error) => this.options.onError?.(error));
    this.allocations.set(allocation.key, allocation);
    allocation.response = this.reply(
      request,
      client,
      [
        {
          type: StunAttr.XorRelayedAddress,
          value: encodeXorAddress(allocation.relayed, request.transactionId),
        },
        { type: StunAttr.Lifetime, value: uint32(lifetime) },
        { type: StunAttr.XorMappedAddress, value: encodeXorAddress(client, request.transactionId) },
      ],
      key,
    );
  }

  /** The lifetime granted: what was asked, within the quota and the allocation's remaining age. */
  private grantedLifetime(request: IStunMessage, createdAt: number, now: number): number {
    const asked = attribute(request, StunAttr.Lifetime);
    const requested =
      asked !== undefined && asked.length === 4 ? asked.readUInt32BE(0) : DEFAULT_LIFETIME_SECONDS;
    const remaining = Math.floor((createdAt + this.quotas.maxAllocationAgeMs - now) / 1000);
    return Math.max(0, Math.min(requested, this.quotas.maxLifetimeSeconds, remaining));
  }

  private refresh(request: IStunMessage, client: ITransportAddress, allocation: IAllocation): void {
    const now = this.now();
    const lifetime = this.grantedLifetime(request, allocation.createdAt, now);
    if (lifetime === 0) {
      this.remove(allocation);
      this.reply(
        request,
        client,
        [{ type: StunAttr.Lifetime, value: uint32(0) }],
        allocation.integrityKey,
      );
      return;
    }
    allocation.expiresAt = now + lifetime * 1000;
    this.reply(
      request,
      client,
      [{ type: StunAttr.Lifetime, value: uint32(lifetime) }],
      allocation.integrityKey,
    );
  }

  private peerAddresses(request: IStunMessage): ITransportAddress[] | undefined {
    const out: ITransportAddress[] = [];
    for (const value of attributes(request, StunAttr.XorPeerAddress)) {
      const peer = decodeXorAddress(value, request.transactionId);
      if (peer === undefined) return undefined;
      out.push(peer);
    }
    return out.length > 0 ? out : undefined;
  }

  private permit(request: IStunMessage, client: ITransportAddress, allocation: IAllocation): void {
    const key = allocation.integrityKey;
    const peers = this.peerAddresses(request);
    if (peers === undefined) {
      this.fail(request, client, 400, 'Bad Request', [], key);
      return;
    }
    if (peers.some((peer) => !isIPv4(peer.address))) {
      this.fail(request, client, 443, 'Peer Address Family Mismatch', [], key);
      return;
    }
    if (peers.some((peer) => !this.allowPeer(peer.address))) {
      this.fail(request, client, 403, 'Forbidden', [], key);
      return;
    }
    const added = new Set(
      peers.map((p) => p.address).filter((a) => !allocation.permissions.has(a)),
    );
    if (allocation.permissions.size + added.size > this.quotas.permissionsPerAllocation) {
      this.fail(request, client, 508, 'Insufficient Capacity', [], key);
      return;
    }
    const expiresAt = this.now() + PERMISSION_LIFETIME_MS;
    for (const peer of peers) allocation.permissions.set(peer.address, expiresAt);
    this.reply(request, client, [], key);
  }

  private bindChannel(
    request: IStunMessage,
    client: ITransportAddress,
    allocation: IAllocation,
  ): void {
    const key = allocation.integrityKey;
    const numberValue = attribute(request, StunAttr.ChannelNumber);
    const peers = this.peerAddresses(request);
    const number =
      numberValue !== undefined && numberValue.length === 4 ? numberValue.readUInt16BE(0) : -1;
    if (number < MIN_CHANNEL || number > MAX_CHANNEL || peers === undefined || peers.length !== 1) {
      this.fail(request, client, 400, 'Bad Request', [], key);
      return;
    }
    const peer = peers[0]!;
    if (!isIPv4(peer.address)) {
      this.fail(request, client, 443, 'Peer Address Family Mismatch', [], key);
      return;
    }
    if (!this.allowPeer(peer.address)) {
      this.fail(request, client, 403, 'Forbidden', [], key);
      return;
    }
    const byNumber = allocation.channelsByNumber.get(number);
    const byPeer = allocation.channelsByPeer.get(clientKey(peer));
    if (
      (byNumber !== undefined && clientKey(byNumber.peer) !== clientKey(peer)) ||
      (byPeer !== undefined && byPeer.number !== number)
    ) {
      this.fail(request, client, 400, 'Bad Request', [], key);
      return;
    }
    const isNew = byNumber === undefined;
    if (
      (isNew && allocation.channelsByNumber.size >= this.quotas.channelsPerAllocation) ||
      (!allocation.permissions.has(peer.address) &&
        allocation.permissions.size >= this.quotas.permissionsPerAllocation)
    ) {
      this.fail(request, client, 508, 'Insufficient Capacity', [], key);
      return;
    }
    const now = this.now();
    const channel: IChannel = byNumber ?? { number, peer, expiresAt: 0 };
    channel.expiresAt = now + CHANNEL_LIFETIME_MS;
    allocation.channelsByNumber.set(number, channel);
    allocation.channelsByPeer.set(clientKey(peer), channel);
    allocation.permissions.set(peer.address, now + PERMISSION_LIFETIME_MS);
    this.reply(request, client, [], key);
  }

  private permitted(allocation: IAllocation, address: string): boolean {
    const expiresAt = allocation.permissions.get(address);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  /** Take `bytes` from the owner's budget for this second; false when it is spent. */
  private spend(owner: string, bytes: number): boolean {
    const now = this.now();
    const rate = this.quotas.bytesPerSecondPerOwner;
    const bucket = this.buckets.get(owner) ?? { tokens: rate, at: now };
    bucket.tokens = Math.min(rate, bucket.tokens + ((now - bucket.at) / 1000) * rate);
    bucket.at = now;
    this.buckets.set(owner, bucket);
    if (bucket.tokens < bytes) return false;
    bucket.tokens -= bytes;
    return true;
  }

  private live(allocation: IAllocation | undefined): allocation is IAllocation {
    if (allocation === undefined) return false;
    if (allocation.expiresAt > this.now()) return true;
    this.remove(allocation);
    return false;
  }

  private fromClientSend(message: IStunMessage, rinfo: RemoteInfo): void {
    const allocation = this.allocations.get(clientKey(rinfo));
    if (!this.live(allocation)) return;
    const peerValue = attribute(message, StunAttr.XorPeerAddress);
    const data = attribute(message, StunAttr.Data);
    if (peerValue === undefined || data === undefined) return;
    const peer = decodeXorAddress(peerValue, message.transactionId);
    if (peer === undefined || !this.permitted(allocation, peer.address)) return;
    if (!this.spend(allocation.owner, data.length)) return;
    allocation.socket.send(data, peer.port, peer.address);
  }

  private fromClientChannel(data: Buffer, rinfo: RemoteInfo): void {
    const allocation = this.allocations.get(clientKey(rinfo));
    if (!this.live(allocation)) return;
    const frame = decodeChannelData(data);
    if (frame === undefined) return;
    const channel = allocation.channelsByNumber.get(frame.channel);
    if (channel === undefined || channel.expiresAt <= this.now()) return;
    if (!this.permitted(allocation, channel.peer.address)) return;
    if (!this.spend(allocation.owner, frame.payload.length)) return;
    allocation.socket.send(frame.payload, channel.peer.port, channel.peer.address);
  }

  private fromPeer(allocation: IAllocation, data: Buffer, rinfo: RemoteInfo): void {
    if (this.allocations.get(allocation.key) !== allocation || !this.live(allocation)) return;
    if (!this.permitted(allocation, rinfo.address)) return;
    if (!this.spend(allocation.owner, data.length)) return;
    const channel = allocation.channelsByPeer.get(clientKey(rinfo));
    if (channel !== undefined && channel.expiresAt > this.now()) {
      this.send(encodeChannelData(channel.number, data), allocation.client);
      return;
    }
    const transactionId = randomBytes(12);
    this.send(
      encodeStun(StunMethod.Data, StunClass.Indication, transactionId, [
        {
          type: StunAttr.XorPeerAddress,
          value: encodeXorAddress({ address: rinfo.address, port: rinfo.port }, transactionId),
        },
        { type: StunAttr.Data, value: data },
      ]),
      allocation.client,
    );
  }

  private remove(allocation: IAllocation): void {
    if (this.allocations.get(allocation.key) === allocation)
      this.allocations.delete(allocation.key);
    try {
      allocation.socket.close();
    } catch {
      /* already closed */
    }
  }

  private sweep(): void {
    const now = this.now();
    for (const allocation of [...this.allocations.values()]) {
      if (allocation.expiresAt <= now) {
        this.remove(allocation);
        continue;
      }
      for (const [address, expiresAt] of allocation.permissions) {
        if (expiresAt <= now) allocation.permissions.delete(address);
      }
      for (const [number, channel] of allocation.channelsByNumber) {
        if (channel.expiresAt > now) continue;
        allocation.channelsByNumber.delete(number);
        allocation.channelsByPeer.delete(clientKey(channel.peer));
      }
    }
  }
}

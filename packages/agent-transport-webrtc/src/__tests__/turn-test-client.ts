/**
 * A minimal TURN client over UDP for tests: it speaks just enough RFC 8656 to allocate, refresh,
 * permit, bind channels and move data, and reports what the server answered.
 */
import { randomBytes } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';

import {
  StunAttr,
  StunClass,
  StunMethod,
  attribute,
  decodeChannelData,
  decodeStun,
  decodeXorAddress,
  encodeChannelData,
  encodeStun,
  encodeXorAddress,
  isChannelData,
  longTermKey,
  readErrorCode,
  uint32,
  type IStunMessage,
  type ITransportAddress,
} from '../stun-message.js';

export interface ITurnAnswer {
  readonly ok: boolean;
  readonly code?: number;
  readonly message: IStunMessage;
}

export class TurnTestClient {
  private realm?: string;
  private nonce?: string;
  private readonly waiting = new Map<string, (message: IStunMessage) => void>();
  private readonly data: { from: ITransportAddress; payload: Buffer }[] = [];

  private constructor(
    private readonly socket: Socket,
    private readonly server: ITransportAddress,
    private readonly username: string,
    private readonly password: string,
  ) {
    socket.on('message', (raw) => {
      if (isChannelData(raw)) {
        const frame = decodeChannelData(raw);
        if (frame !== undefined) {
          this.data.push({
            from: { address: `channel`, port: frame.channel },
            payload: frame.payload,
          });
        }
        return;
      }
      const message = decodeStun(raw);
      if (message === undefined) return;
      if (message.cls === StunClass.Indication && message.method === StunMethod.Data) {
        const peer = attribute(message, StunAttr.XorPeerAddress);
        const payload = attribute(message, StunAttr.Data);
        const from = peer && decodeXorAddress(peer, message.transactionId);
        if (from && payload) this.data.push({ from, payload: Buffer.from(payload) });
        return;
      }
      const key = message.transactionId.toString('hex');
      this.waiting.get(key)?.(message);
      this.waiting.delete(key);
    });
  }

  public static async connect(
    server: ITransportAddress,
    username: string,
    password: string,
  ): Promise<TurnTestClient> {
    const socket = createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
    return new TurnTestClient(socket, server, username, password);
  }

  /** Relayed data received so far. */
  public received(): readonly { from: ITransportAddress; payload: Buffer }[] {
    return this.data;
  }

  private exchange(message: Buffer, transactionId: Buffer): Promise<IStunMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no TURN answer')), 2_000);
      this.waiting.set(transactionId.toString('hex'), (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      this.socket.send(message, this.server.port, this.server.address);
    });
  }

  /** Send an authenticated request, answering a 401/438 challenge once. */
  public async request(
    method: number,
    attrs: { type: number; value: Buffer }[] = [],
    transactionId: Buffer = randomBytes(12),
  ): Promise<ITurnAnswer> {
    // One transaction id throughout: the peer addresses in `attrs` are XORed with it.
    for (let round = 0; round < 3; round += 1) {
      const auth =
        this.realm !== undefined && this.nonce !== undefined
          ? [
              { type: StunAttr.Username, value: Buffer.from(this.username) },
              { type: StunAttr.Realm, value: Buffer.from(this.realm) },
              { type: StunAttr.Nonce, value: Buffer.from(this.nonce) },
            ]
          : [];
      const key =
        this.realm !== undefined
          ? longTermKey(this.username, this.realm, this.password)
          : undefined;
      const answer = await this.exchange(
        encodeStun(method, StunClass.Request, transactionId, [...attrs, ...auth], {
          ...(key !== undefined && auth.length > 0 ? { integrityKey: key } : {}),
        }),
        transactionId,
      );
      const code = readErrorCode(attribute(answer, StunAttr.ErrorCode));
      const challenged = code === 401 || code === 438;
      const realm = attribute(answer, StunAttr.Realm)?.toString();
      const nonce = attribute(answer, StunAttr.Nonce)?.toString();
      if (challenged && realm !== undefined && nonce !== undefined) {
        const first = this.nonce === undefined || code === 438;
        this.realm = realm;
        this.nonce = nonce;
        if (first) continue;
      }
      return {
        ok: answer.cls === StunClass.Success,
        ...(code !== undefined ? { code } : {}),
        message: answer,
      };
    }
    throw new Error('TURN challenge loop');
  }

  public allocate(
    extra: { type: number; value: Buffer }[] = [],
    transport = 17,
  ): Promise<ITurnAnswer> {
    return this.request(StunMethod.Allocate, [
      { type: StunAttr.RequestedTransport, value: Buffer.from([transport, 0, 0, 0]) },
      ...extra,
    ]);
  }

  public refresh(lifetime: number): Promise<ITurnAnswer> {
    return this.request(StunMethod.Refresh, [{ type: StunAttr.Lifetime, value: uint32(lifetime) }]);
  }

  public permit(peer: ITransportAddress): Promise<ITurnAnswer> {
    const transactionId = randomBytes(12);
    return this.request(
      StunMethod.CreatePermission,
      [{ type: StunAttr.XorPeerAddress, value: encodeXorAddress(peer, transactionId) }],
      transactionId,
    );
  }

  public bindChannel(channel: number, peer: ITransportAddress): Promise<ITurnAnswer> {
    const transactionId = randomBytes(12);
    const number = Buffer.alloc(4);
    number.writeUInt16BE(channel, 0);
    return this.request(
      StunMethod.ChannelBind,
      [
        { type: StunAttr.ChannelNumber, value: number },
        { type: StunAttr.XorPeerAddress, value: encodeXorAddress(peer, transactionId) },
      ],
      transactionId,
    );
  }

  /** Send data to `peer` through the relay in a Send indication. */
  public sendTo(peer: ITransportAddress, payload: Buffer): void {
    const transactionId = randomBytes(12);
    this.socket.send(
      encodeStun(StunMethod.Send, StunClass.Indication, transactionId, [
        { type: StunAttr.XorPeerAddress, value: encodeXorAddress(peer, transactionId) },
        { type: StunAttr.Data, value: payload },
      ]),
      this.server.port,
      this.server.address,
    );
  }

  public sendOnChannel(channel: number, payload: Buffer): void {
    this.socket.send(encodeChannelData(channel, payload), this.server.port, this.server.address);
  }

  public close(): void {
    this.socket.close();
  }
}

/** The relayed address in an Allocate success. */
export function relayedAddress(answer: ITurnAnswer): ITransportAddress | undefined {
  const value = attribute(answer.message, StunAttr.XorRelayedAddress);
  return value && decodeXorAddress(value, answer.message.transactionId);
}

export function lifetimeOf(answer: ITurnAnswer): number | undefined {
  return attribute(answer.message, StunAttr.Lifetime)?.readUInt32BE(0);
}

/** A plain UDP peer on loopback that records what reaches it. */
export async function udpPeer(): Promise<{
  readonly address: ITransportAddress;
  readonly received: Buffer[];
  send(to: ITransportAddress, payload: Buffer): void;
  close(): void;
}> {
  const socket = createSocket('udp4');
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const received: Buffer[] = [];
  socket.on('message', (data) => received.push(data));
  return {
    address: { address: '127.0.0.1', port: socket.address().port },
    received,
    send: (to, payload) => socket.send(payload, to.port, to.address),
    close: () => socket.close(),
  };
}

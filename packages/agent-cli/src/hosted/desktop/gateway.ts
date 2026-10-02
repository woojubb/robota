import { ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { bearerCredential, createBearerResourceServer } from '@robota-sdk/agent-transport/node';
import { DesktopRefused, desktopBindingKey } from './authorization.js';
import { DESKTOP_FRAME_BYTES } from './worker-port.js';
import type { HostedDesktopAuthorization, IDesktopBinding } from './authorization.js';
import type { HostedDesktopAuthorityStore, IDesktopAccess } from './authority-store.js';
import type { HostedDesktopWorkerPort } from './worker-port.js';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

interface IPaired {
  binding: IDesktopBinding;
  access: IDesktopAccess;
  jwt: string;
  operatorJwt?: string;
  port: HostedDesktopWorkerPort;
}
const uniqueHeaders = new Set([
  'authorization',
  'x-desktop-operator-authorization',
  'host',
  'origin',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);
const address = (value: string | undefined): string =>
  (value ?? '').replace(/^::ffff:/u, '').toLowerCase();

/** Outside workers: owns scoped ingress and a separate operator channel to one pinned task session. */
export class HostedDesktopGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: DESKTOP_FRAME_BYTES });
  private readonly paired = new Map<string, IPaired>();
  private readonly active = new Map<WebSocket, IPaired>();
  private readonly names;
  private readonly proxies: ReadonlySet<string>;
  private readonly interval: number;
  private closed = false;
  private readonly upgrades = new Set<Duplex>();
  constructor(
    private readonly options: {
      readonly server: Server;
      readonly authorization: HostedDesktopAuthorization;
      readonly store: HostedDesktopAuthorityStore;
      readonly ports: ReadonlyMap<string, HostedDesktopWorkerPort>;
      readonly trustedProxies?: readonly string[];
      readonly policyIntervalMs?: number;
    },
  ) {
    this.interval = options.policyIntervalMs ?? 1000;
    if (
      !Number.isSafeInteger(this.interval) ||
      this.interval < 100 ||
      this.interval > 5000 ||
      (options.trustedProxies ?? []).some((ip) => isIP(ip) === 0)
    )
      throw new DesktopRefused('gateway-configuration');
    this.proxies = new Set((options.trustedProxies ?? []).map(address));
    this.names = createBearerResourceServer({
      publicUrl: options.authorization.url.href,
      label: 'Desktop runtime',
      trustedProxies: options.trustedProxies,
    });
    for (const [id, port] of options.ports) {
      const binding = options.authorization.binding(id);
      if (
        binding.session !== port.session ||
        JSON.stringify(binding.worker) !== JSON.stringify(port.worker)
      )
        throw new DesktopRefused('owner-worker-binding');
      port.ready();
    }
    options.server.on('request', this.request);
    options.server.on('upgrade', this.upgrade);
  }
  private boundary(req: IncomingMessage, res: ServerResponse): boolean {
    const seen = new Set<string>();
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index]!.toLowerCase();
      if (uniqueHeaders.has(name) && seen.has(name)) {
        res.writeHead(403).end();
        return false;
      }
      seen.add(name);
    }
    const forwarded = [...seen].some((name) => name.startsWith('x-forwarded-'));
    const trusted = this.proxies.has(address(req.socket.remoteAddress));
    if (
      (forwarded && !trusted) ||
      (!(req.socket as { encrypted?: boolean }).encrypted &&
        (!trusted || req.headers['x-forwarded-proto'] !== 'https')) ||
      (forwarded &&
        (req.headers['x-forwarded-proto'] !== 'https' ||
          req.headers['x-forwarded-host'] !== this.names.url.host))
    ) {
      res.writeHead(403).end();
      return false;
    }
    return this.names.checkNames(req, res);
  }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work(abort.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            abort.abort();
            reject(new DesktopRefused('authority-timeout'));
          }, 5000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      abort.abort();
    }
  }
  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    const buffers: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      const buffer = Buffer.from(chunk as Uint8Array);
      length += buffer.length;
      if (length > 8192) throw new DesktopRefused('request-capacity');
      buffers.push(buffer);
    }
    const value = JSON.parse(Buffer.concat(buffers).toString('utf8')) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new DesktopRefused('request-shape');
    return value;
  }
  private readonly request = (req: IncomingMessage, res: ServerResponse): void => {
    void this.handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(403);
      res.end();
    });
  };
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.closed || !this.boundary(req, res)) return;
    if (
      req.method !== 'POST' ||
      ![
        `${this.names.url.pathname.replace(/\/$/u, '')}/pair`,
        `${this.names.url.pathname.replace(/\/$/u, '')}/approval`,
      ].includes(req.url ?? '')
    ) {
      res.writeHead(404).end();
      return;
    }
    const timer = setTimeout(() => req.destroy(), 5000);
    try {
      const body = await this.body(req);
      if (req.url?.endsWith('/pair')) {
        if (Object.keys(body).join(',') !== 'binding' || typeof body.binding !== 'string')
          throw new DesktopRefused('request-shape');
        const binding = this.options.authorization.binding(body.binding);
        const port = this.options.ports.get(binding.id);
        if (!port) throw new DesktopRefused('worker-unavailable');
        port.ready();
        const jwt = bearerCredential(req.headers.authorization);
        if (!jwt) throw new DesktopRefused('missing-token');
        const operatorJwt = bearerCredential(
          req.headers['x-desktop-operator-authorization'] as string | undefined,
        );
        if (req.headers['x-desktop-operator-authorization'] !== undefined && !operatorJwt)
          throw new DesktopRefused('operator-token');
        const { drive, operator } = await this.bounded(async (signal) => {
          const drive = await this.options.authorization.verify(jwt, binding, false, signal);
          const operator =
            operatorJwt === undefined
              ? undefined
              : await this.options.authorization.verify(operatorJwt, binding, true, signal);
          signal.throwIfAborted();
          return { drive, operator };
        });
        if (req.aborted || res.destroyed || this.closed)
          throw new DesktopRefused('connection-withdrawn');
        const key = desktopBindingKey(binding);
        const access = this.options.store.pair(
          key,
          [drive, ...(operator ? [operator] : [])].map((proof) => ({
            id: proof.jti,
            expiresAt: proof.credentialExpiresAt,
          })),
          Math.min(drive.expiresAt, operator?.expiresAt ?? drive.expiresAt),
          operator !== undefined,
        );
        this.paired.set(binding.id, { binding, access, jwt, operatorJwt, port });
        for (const [socket, previous] of this.active)
          if (previous.binding.id === binding.id) socket.terminate();
        res.setHeader('cache-control', 'no-store');
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            binding: binding.id,
            generation: access.generation,
            token: access.token,
            approvalToken: access.approvalToken,
            expiresAt: access.expiresAt,
            session: binding.session,
          }),
        );
      } else {
        if (
          Object.keys(body).sort().join(',') !== 'allow,binding,digest,generation,id' ||
          typeof body.binding !== 'string' ||
          !Number.isSafeInteger(body.generation) ||
          typeof body.id !== 'string' ||
          typeof body.digest !== 'string' ||
          !/^[a-f0-9]{64}$/u.test(body.digest) ||
          typeof body.allow !== 'boolean'
        )
          throw new DesktopRefused('request-shape');
        const pair = this.paired.get(body.binding);
        const token = bearerCredential(req.headers.authorization);
        if (!pair || pair.access.generation !== body.generation || !token || !pair.operatorJwt)
          throw new DesktopRefused('operator-token');
        this.options.store.authorize(pair.access.key, pair.access.generation, token, true);
        await this.bounded((signal) =>
          this.options.authorization.verify(pair.operatorJwt!, pair.binding, true, signal),
        );
        if (req.aborted || res.destroyed || this.closed)
          throw new DesktopRefused('connection-withdrawn');
        pair.port.prompt(body.id, body.digest);
        this.options.store.approveOnce(pair.access.key, pair.access.generation, token, body.digest);
        pair.port.approve(body.id, body.digest, body.allow);
        res.writeHead(204).end();
      }
    } finally {
      clearTimeout(timer);
    }
  }
  private readonly upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    this.upgrades.add(socket);
    socket.once('close', () => this.upgrades.delete(socket));
    socket.once('error', () => socket.destroy());
    const res = new ServerResponse(req);
    res.assignSocket(socket as import('node:net').Socket);
    if (!this.boundary(req, res)) {
      res.on('finish', () => socket.destroy());
      return;
    }
    res.detachSocket(socket as import('node:net').Socket);
    void this.connect(req, socket, head).catch(() => {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n', () =>
        socket.destroy(),
      );
    });
  };
  private async connect(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.closed) throw new DesktopRefused('gateway-closed');
    const url = new URL(req.url!, this.names.url);
    if (
      req.method !== 'GET' ||
      url.pathname !== `${this.names.url.pathname.replace(/\/$/u, '')}/connect` ||
      [...url.searchParams.keys()].sort().join(',') !== 'binding,generation'
    )
      throw new DesktopRefused('connection-shape');
    const pair = this.paired.get(url.searchParams.get('binding')!);
    const generation = Number(url.searchParams.get('generation'));
    const token = bearerCredential(req.headers.authorization);
    if (
      !pair ||
      !token ||
      !Number.isSafeInteger(generation) ||
      generation !== pair.access.generation
    )
      throw new DesktopRefused('withdrawn-connection');
    this.options.store.authorize(pair.access.key, generation, token);
    await this.bounded((signal) =>
      this.options.authorization.verify(pair.jwt, pair.binding, false, signal),
    );
    if (socket.destroyed || this.closed) throw new DesktopRefused('connection-withdrawn');
    pair.port.ready();
    this.options.store.connect(pair.access.key, generation, token);
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, pair, token));
  }
  private attach(ws: WebSocket, pair: IPaired, token: string): void {
    this.active.set(ws, pair);
    let checking = false;
    let queue = Promise.resolve();
    let queued = 0;
    const withdraw = (): void => ws.terminate();
    const validate = async (): Promise<void> => {
      this.options.store.authorize(pair.access.key, pair.access.generation, token);
      await this.bounded((signal) =>
        this.options.authorization.verify(pair.jwt, pair.binding, false, signal),
      );
      this.options.store.authorize(pair.access.key, pair.access.generation, token);
    };
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void validate()
        .catch(withdraw)
        .finally(() => {
          checking = false;
        });
    }, this.interval);
    timer.unref();
    const removeFrames = pair.port.onFrame((frame) => {
      try {
        this.options.store.authorize(pair.access.key, pair.access.generation, token);
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1024 * 1024)
          throw new DesktopRefused('delivery-capacity');
        ws.send(JSON.stringify(frame));
      } catch {
        withdraw();
      }
    });
    const removeClose = pair.port.onClose(withdraw);
    ws.on('message', (data, binary) => {
      if (binary || ++queued > 16) {
        withdraw();
        return;
      }
      queue = queue
        .then(async () => {
          await validate();
          if (ws.readyState !== WebSocket.OPEN) return;
          const frame = JSON.parse(String(data)) as Record<string, unknown>;
          const response = pair.port.send(frame);
          if (response) ws.send(JSON.stringify(response));
        })
        .catch(withdraw)
        .finally(() => {
          queued--;
        });
    });
    ws.on('error', withdraw);
    ws.once('close', () => {
      clearInterval(timer);
      removeFrames();
      removeClose();
      this.active.delete(ws);
    });
    pair.port.send({ type: 'get-messages' });
    pair.port.send({ type: 'get-status' });
    pair.port.send({ type: 'get-prompts' });
  }
  /** Owner-only withdrawal; no administrator route is exposed. */
  revoke(binding: string): void {
    const key = desktopBindingKey(this.options.authorization.binding(binding));
    this.options.store.revoke(key);
    this.paired.delete(binding);
    for (const [socket, pair] of this.active) if (pair.binding.id === binding) socket.terminate();
  }
  async close(): Promise<void> {
    this.closed = true;
    this.options.server.off('request', this.request);
    this.options.server.off('upgrade', this.upgrade);
    for (const socket of this.upgrades) socket.destroy();
    for (const socket of this.active.keys()) socket.terminate();
    for (const port of this.options.ports.values()) port.close();
    this.paired.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

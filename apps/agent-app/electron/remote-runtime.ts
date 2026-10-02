import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { constants, openSync, closeSync, fstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { request } from 'node:https';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { Duplex } from 'node:stream';
import type { IDaemonEndpoint } from './sidecar.js';

export interface IDesktopRemoteConfig {
  readonly version: 1;
  readonly publicUrl: string;
  readonly binding: string;
  readonly credentialFile: string;
  readonly operatorCredentialFile?: string;
  readonly caFile?: string;
}
export interface IRemotePermission {
  readonly id: string;
  readonly toolName: string;
  readonly [key: string]: unknown;
}
export const REMOTE_RUNTIME_FAILURE =
  'Remote runtime connection refused. Refresh the owner-issued desktop credentials, then reconnect.';
function ownerFile(path: string, privateFile: boolean, maximum: number): Buffer {
  if (!isAbsolute(path)) throw new Error(REMOTE_RUNTIME_FAILURE);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.size > maximum ||
      (stat.mode & (privateFile ? 0o077 : 0o022)) !== 0 ||
      (process.getuid !== undefined && stat.uid !== process.getuid())
    )
      throw new Error(REMOTE_RUNTIME_FAILURE);
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
export function loadDesktopRemoteConfig(path: string): IDesktopRemoteConfig {
  try {
    const config = JSON.parse(
      ownerFile(path, true, 16 * 1024).toString('utf8'),
    ) as IDesktopRemoteConfig;
    const url = new URL(config.publicUrl);
    if (
      config.version !== 1 ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      typeof config.binding !== 'string' ||
      config.binding.length === 0 ||
      config.binding.length > 256 ||
      !isAbsolute(config.credentialFile) ||
      (config.operatorCredentialFile !== undefined && !isAbsolute(config.operatorCredentialFile)) ||
      (config.caFile !== undefined && !isAbsolute(config.caFile))
    )
      throw new Error(REMOTE_RUNTIME_FAILURE);
    return Object.freeze({ ...config, publicUrl: url.href.replace(/\/$/u, '') });
  } catch {
    throw new Error(REMOTE_RUNTIME_FAILURE);
  }
}
/** Main-process connection owner. Only a fresh loopback nonce reaches the local renderer. */
export class DesktopRemoteRuntime {
  private readonly server = createServer((_req, res) => res.writeHead(404).end());
  private readonly local = new WebSocketServer({ noServer: true, maxPayload: 128 * 1024 });
  private upstream?: WebSocket;
  private endpoint?: IDaemonEndpoint;
  private readonly prefix: string[] = [];
  private prefixBytes = 0;
  private closed = false;
  private closing?: Promise<void>;
  private readonly upgrades = new Set<Duplex>();
  private approvals = Promise.resolve();
  private readonly nonce = randomBytes(32).toString('base64url');
  private readonly ca?: Buffer;
  constructor(
    private readonly config: IDesktopRemoteConfig,
    private readonly approve: (event: IRemotePermission) => Promise<boolean>,
  ) {
    this.ca = config.caFile === undefined ? undefined : ownerFile(config.caFile, false, 64 * 1024);
  }
  private exchange(
    path: string,
    bearer: string,
    body: unknown,
    operator?: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const req = request(
        `${this.config.publicUrl}${path}`,
        {
          method: 'POST',
          ca: this.ca,
          timeout: 5000,
          headers: {
            authorization: `Bearer ${bearer}`,
            origin: new URL(this.config.publicUrl).origin,
            'content-type': 'application/json',
            ...(operator ? { 'x-desktop-operator-authorization': `Bearer ${operator}` } : {}),
          },
        },
        (res) => {
          let bytes = 0;
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 128 * 1024) req.destroy();
            else chunks.push(chunk);
          });
          res.once('error', () => reject(new Error(REMOTE_RUNTIME_FAILURE)));
          res.once('end', () => {
            if (res.statusCode !== 200 && res.statusCode !== 204) {
              reject(new Error(REMOTE_RUNTIME_FAILURE));
              return;
            }
            try {
              resolve(
                res.statusCode === 204
                  ? {}
                  : (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>),
              );
            } catch {
              reject(new Error(REMOTE_RUNTIME_FAILURE));
            }
          });
        },
      );
      const deadline = setTimeout(() => {
        req.destroy();
        reject(new Error(REMOTE_RUNTIME_FAILURE));
      }, 5000);
      req.once('close', () => clearTimeout(deadline));
      req.once('timeout', () => req.destroy());
      req.once('error', () => reject(new Error(REMOTE_RUNTIME_FAILURE)));
      req.end(JSON.stringify(body));
    });
  }
  async start(): Promise<IDaemonEndpoint> {
    try {
      const jwt = ownerFile(this.config.credentialFile, true, 8192).toString('utf8').trim();
      const operator =
        this.config.operatorCredentialFile === undefined
          ? undefined
          : ownerFile(this.config.operatorCredentialFile, true, 8192).toString('utf8').trim();
      const paired = await this.exchange('/pair', jwt, { binding: this.config.binding }, operator);
      const claims = JSON.parse(
        Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'),
      ) as Record<string, unknown>;
      if (
        this.closed ||
        paired.binding !== this.config.binding ||
        paired.session !== claims.session ||
        !Number.isSafeInteger(paired.generation) ||
        (paired.generation as number) < 1 ||
        typeof paired.expiresAt !== 'number' ||
        !Number.isSafeInteger(paired.expiresAt) ||
        paired.expiresAt <= Date.now() ||
        paired.expiresAt > Date.now() + 60_000 ||
        typeof paired.token !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/u.test(paired.token) ||
        (paired.approvalToken !== null &&
          (typeof paired.approvalToken !== 'string' ||
            !/^[A-Za-z0-9_-]{43}$/u.test(paired.approvalToken)))
      )
        throw new Error(REMOTE_RUNTIME_FAILURE);
      const url = new URL(`${this.config.publicUrl}/connect`);
      url.protocol = 'wss:';
      url.searchParams.set('binding', this.config.binding);
      url.searchParams.set('generation', String(paired.generation));
      const remote = new WebSocket(url, {
        ca: this.ca,
        maxPayload: 128 * 1024,
        followRedirects: false,
        handshakeTimeout: 5000,
        headers: {
          authorization: `Bearer ${paired.token}`,
          origin: url.origin.replace('wss:', 'https:'),
        },
      });
      this.upstream = remote;
      remote.on('error', () => {
        void this.close();
      });
      remote.on('close', () => {
        void this.close();
      });
      remote.on('message', (bytes, binary) => {
        try {
          if (binary) throw new Error(REMOTE_RUNTIME_FAILURE);
          const text = String(bytes);
          const frame = JSON.parse(text) as Record<string, unknown>;
          this.deliver(text);
          if (frame.type === 'permission_request') {
            const event = frame.event as IRemotePermission;
            if (!event || typeof event.id !== 'string' || typeof event.toolName !== 'string')
              throw new Error(REMOTE_RUNTIME_FAILURE);
            const digest = createHash('sha256')
              .update('robota/desktop-permission/v1\0')
              .update(JSON.stringify(event))
              .digest('hex');
            this.approvals = this.approvals
              .then(async () => {
                if (this.closed || remote.readyState !== WebSocket.OPEN) return;
                if (typeof paired.approvalToken !== 'string') {
                  remote.send(JSON.stringify({ type: 'abort' }));
                  return;
                }
                const allow = await this.approve(Object.freeze({ ...event }));
                if (this.closed || remote.readyState !== WebSocket.OPEN) return;
                await this.exchange('/approval', paired.approvalToken, {
                  binding: this.config.binding,
                  generation: paired.generation,
                  id: event.id,
                  digest,
                  allow,
                });
              })
              .catch(() => remote.terminate());
          }
        } catch {
          remote.terminate();
        }
      });
      await new Promise<void>((resolve, reject) => {
        remote.once('open', resolve);
        remote.once('error', () => reject(new Error(REMOTE_RUNTIME_FAILURE)));
      });
      if (this.closed || remote.readyState !== WebSocket.OPEN)
        throw new Error(REMOTE_RUNTIME_FAILURE);
      this.server.on('upgrade', (req, socket, head) => {
        this.upgrades.add(socket);
        socket.once('close', () => this.upgrades.delete(socket));
        socket.once('error', () => socket.destroy());
        const reject = (): void => {
          socket.end(
            'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
            () => socket.destroy(),
          );
        };
        let url: URL;
        try {
          url = new URL(req.url ?? '', 'http://127.0.0.1');
        } catch {
          reject();
          return;
        }
        const localPort = this.endpoint?.port;
        const supplied = url.searchParams.get('token') ?? '';
        const equal = timingSafeEqual(
          createHash('sha256').update(supplied).digest(),
          createHash('sha256').update(this.nonce).digest(),
        );
        if (
          this.closed ||
          remote.readyState !== WebSocket.OPEN ||
          !localPort ||
          ![`127.0.0.1:${localPort}`, `localhost:${localPort}`].includes(req.headers.host ?? '') ||
          (req.headers.origin !== undefined && req.headers.origin !== 'file://') ||
          url.pathname !== '/' ||
          url.searchParams.getAll('token').length !== 1 ||
          [...url.searchParams.keys()].join(',') !== 'token' ||
          !equal
        ) {
          reject();
          return;
        }
        this.local.handleUpgrade(req, socket, head, (client) => {
          for (const previous of this.local.clients) if (previous !== client) previous.terminate();
          for (const message of this.prefix) client.send(message);
          this.prefix.length = 0;
          this.prefixBytes = 0;
          client.on('error', () => client.terminate());
          client.on('message', (data, binary) => {
            try {
              const frame = JSON.parse(String(data)) as Record<string, unknown>;
              if (
                binary ||
                remote.readyState !== WebSocket.OPEN ||
                remote.bufferedAmount > 1024 * 1024 ||
                [
                  'permission-response',
                  'switch-session',
                  'new-session',
                  'delete-session',
                  'command',
                ].includes(String(frame.type))
              )
                throw new Error(REMOTE_RUNTIME_FAILURE);
              remote.send(JSON.stringify(frame));
            } catch {
              client.terminate();
            }
          });
          remote.send(JSON.stringify({ type: 'get-messages' }));
          remote.send(JSON.stringify({ type: 'get-status' }));
        });
      });
      await new Promise<void>((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', resolve);
      });
      const port = (this.server.address() as { port: number }).port;
      this.endpoint = {
        id: `remote-${this.config.binding}`,
        port,
        url: `ws://127.0.0.1:${port}/?token=${this.nonce}`,
      };
      return this.endpoint;
    } catch {
      await this.close();
      throw new Error(REMOTE_RUNTIME_FAILURE);
    }
  }
  private deliver(text: string): void {
    if (this.local.clients.size === 0) {
      this.prefixBytes += Buffer.byteLength(text);
      if (this.prefixBytes > 1024 * 1024) {
        this.upstream?.terminate();
        return;
      }
      this.prefix.push(text);
      return;
    }
    for (const client of this.local.clients) {
      if (client.bufferedAmount > 1024 * 1024) client.terminate();
      else client.send(text);
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      this.upstream?.terminate();
      for (const socket of this.upgrades) socket.destroy();
      for (const client of this.local.clients) client.terminate();
      await new Promise<void>((resolve) => this.local.close(() => resolve()));
      await new Promise<void>((resolve) => this.server.close(() => resolve()));
      this.prefix.length = 0;
      this.prefixBytes = 0;
    })();
    return this.closing;
  }
}

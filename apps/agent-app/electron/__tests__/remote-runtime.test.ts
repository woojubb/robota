import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { connect as netConnect } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, it } from 'vitest';
import {
  DesktopRemoteRuntime,
  loadDesktopRemoteConfig,
  REMOTE_RUNTIME_FAILURE,
} from '../remote-runtime.js';

it('keeps remote credentials in the host and binds native approval separately from renderer traffic', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'desktop-client-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(directory, 'key'),
      '-out',
      join(directory, 'ca'),
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  chmodSync(join(directory, 'ca'), 0o644);
  const ca = readFileSync(join(directory, 'ca'));
  const drive = 'd'.repeat(43),
    operator = 'o'.repeat(43);
  const jwt = `header.${Buffer.from(JSON.stringify({ session: 'owned-session' })).toString('base64url')}.synthetic-signature`;
  const received: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
  let drip = false;
  const wss = new WebSocketServer({ noServer: true });
  const server = createServer(
    { cert: ca, key: readFileSync(join(directory, 'key')) },
    async (req, res) => {
      let raw = '';
      for await (const bytes of req) raw += String(bytes);
      received.push({ authorization: req.headers.authorization, body: JSON.parse(raw) });
      if (drip) {
        res.writeHead(200);
        const timer = setInterval(() => res.write(' '), 50);
        const stop = setTimeout(() => res.end('{}'), 6500);
        res.once('close', () => {
          clearInterval(timer);
          clearTimeout(stop);
        });
        return;
      }
      if (req.url === '/desktop/pair') {
        expect(req.headers.authorization).toBe(`Bearer ${jwt}`);
        expect(req.headers['x-desktop-operator-authorization']).toBe(
          'Bearer synthetic-operator-jwt',
        );
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            binding: 'owner',
            generation: 1,
            session: 'owned-session',
            token: drive,
            approvalToken: operator,
            expiresAt: Date.now() + 50_000,
          }),
        );
      } else res.writeHead(204).end();
    },
  );
  const frames: Record<string, unknown>[] = [];
  let upstream: WebSocket | undefined;
  server.on('upgrade', (req, socket, head) => {
    expect(req.headers.authorization).toBe(`Bearer ${drive}`);
    expect(req.url).not.toContain(drive);
    wss.handleUpgrade(req, socket, head, (ws) => {
      upstream = ws;
      ws.on('message', (data) => frames.push(JSON.parse(String(data))));
      ws.send(JSON.stringify({ type: 'session_status', status: { sessionId: 'owned-session' } }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const configFile = join(directory, 'config');
  writeFileSync(join(directory, 'credential'), jwt, { mode: 0o600 });
  writeFileSync(join(directory, 'operator'), 'synthetic-operator-jwt', { mode: 0o600 });
  writeFileSync(
    configFile,
    JSON.stringify({
      version: 1,
      publicUrl: `https://127.0.0.1:${(server.address() as { port: number }).port}/desktop`,
      binding: 'owner',
      credentialFile: join(directory, 'credential'),
      operatorCredentialFile: join(directory, 'operator'),
      caFile: join(directory, 'ca'),
    }),
    { mode: 0o600 },
  );
  let nativeApprovals = 0;
  const runtime = new DesktopRemoteRuntime(loadDesktopRemoteConfig(configFile), async () => {
    nativeApprovals++;
    return true;
  });
  const clients: WebSocket[] = [];
  const rawClients: ReturnType<typeof netConnect>[] = [];
  const connect = async (url: string, origin?: string) => {
    const ws = new WebSocket(url, origin ? { headers: { origin } } : undefined);
    clients.push(ws);
    ws.on('error', () => undefined);
    await new Promise<void>((done, fail) => {
      ws.once('open', done);
      ws.once('error', fail);
    });
    return ws;
  };
  try {
    const endpoint = await runtime.start();
    const malformed = new PassThrough();
    expect(() =>
      (runtime as unknown as { server: { emit: (...args: unknown[]) => void } }).server.emit(
        'upgrade',
        { url: '//[', headers: {} },
        malformed,
        Buffer.alloc(0),
      ),
    ).not.toThrow();
    const halfOpen = netConnect({ host: '127.0.0.1', port: endpoint.port, allowHalfOpen: true });
    rawClients.push(halfOpen);
    let rejection = '';
    halfOpen.on('data', (bytes) => {
      rejection += String(bytes);
    });
    await new Promise<void>((done) => halfOpen.once('connect', done));
    halfOpen.write(
      `GET /?token=wrong HTTP/1.1\r\nHost: 127.0.0.1:${endpoint.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: AAAAAAAAAAAAAAAAAAAAAA==\r\n\r\n`,
    );
    await expect.poll(() => rejection).toContain('403');
    expect(endpoint.url).not.toContain(drive);
    expect(endpoint.url).not.toContain(operator);
    expect(endpoint.url).not.toContain(jwt);
    await expect(connect(endpoint.url, 'https://hostile.example')).rejects.toThrow();
    await expect(connect(endpoint.url.replace(/token=.*/u, 'token=wrong'))).rejects.toThrow();
    const client = await connect(endpoint.url);
    const messages: string[] = [];
    client.on('message', (data) => messages.push(String(data)));
    client.send(JSON.stringify({ type: 'submit', prompt: 'remote message' }));
    await expect.poll(() => frames.some((frame) => frame.prompt === 'remote message')).toBe(true);
    upstream!.send(
      JSON.stringify({
        type: 'permission_request',
        event: { id: 'operation', toolName: 'Write', input: { path: '/remote/work.txt' } },
      }),
    );
    await expect.poll(() => received.length).toBe(2);
    expect(nativeApprovals).toBe(1);
    expect(received[1]!.authorization).toBe(`Bearer ${operator}`);
    expect(received[1]!.body).toMatchObject({
      binding: 'owner',
      generation: 1,
      id: 'operation',
      allow: true,
    });
    expect(received[1]!.body.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(messages.join('')).not.toContain(jwt);
    expect(messages.join('')).not.toContain(drive);
    expect(messages.join('')).not.toContain(operator);
    const stopped = new Promise<void>((done) => client.once('close', () => done()));
    client.send(JSON.stringify({ type: 'permission-response', id: 'operation', result: true }));
    await stopped;
    expect(frames.some((frame) => frame.type === 'permission-response')).toBe(false);
    const restored = await connect(endpoint.url);
    const withdrawn = new Promise<void>((done) => restored.once('close', () => done()));
    upstream!.terminate();
    await withdrawn;
    await Promise.race([
      runtime.close(),
      new Promise<never>((_done, fail) => {
        const timer = setTimeout(() => fail(new Error('Raw upgrade prevented teardown')), 1000);
        timer.unref();
      }),
    ]);
    await expect(connect(endpoint.url)).rejects.toThrow();
    chmodSync(configFile, 0o644);
    expect(() => loadDesktopRemoteConfig(configFile)).toThrow(REMOTE_RUNTIME_FAILURE);
    chmodSync(configFile, 0o600);
    drip = true;
    const stalled = new DesktopRemoteRuntime(
      loadDesktopRemoteConfig(configFile),
      async () => false,
    );
    const started = Date.now();
    await expect(stalled.start()).rejects.toThrow(REMOTE_RUNTIME_FAILURE);
    expect(Date.now() - started).toBeLessThan(6000);
    await stalled.close();
  } finally {
    for (const raw of rawClients) raw.destroy();
    for (const client of clients) client.terminate();
    await runtime.close();
    for (const client of wss.clients) client.terminate();
    await new Promise<void>((done) => wss.close(() => done()));
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(directory, { recursive: true, force: true });
  }
}, 20_000);

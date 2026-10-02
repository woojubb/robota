import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createConnection } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { expect, it, vi } from 'vitest';
import { openHostedServeIngress } from '../hosted-serve-ingress.js';
import type { IE2BWorkerProcessOptions } from '../e2b-worker-process.js';
import type { IHostedWorkerExecutionConfig } from '../hosted-worker-execution-config.js';

const clientToken = 'synthetic-runtime-client-token-123456789';
const workerToken = 'synthetic-worker-launch-token';
const config = { nodeExecutable: process.execPath, workspaceRoot: tmpdir() } as IHostedWorkerExecutionConfig;

async function fixture() {
  const worker = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => worker.once('listening', resolve));
  const workerPort = (worker.address() as { port: number }).port;
  const requests: { url: string | undefined; authorization: string | undefined; origin: string | undefined }[] = [];
  worker.on('connection', (socket, request) => {
    requests.push({ url: request.url, authorization: request.headers.authorization, origin: request.headers.origin });
    socket.on('message', (bytes, binary) => socket.send(bytes, { binary }));
  });
  const startProcess = vi.fn(async (options: IE2BWorkerProcessOptions) => {
    const child = spawn('/bin/sh', ['-c', options.command], { cwd: options.cwd, env: options.environment });
    child.stdout.on('data', (bytes: Buffer) => options.onStdout(bytes.toString()));
    child.stderr.on('data', (bytes: Buffer) => options.onStderr(bytes.toString()));
    const wait = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? 1));
    });
    return {
      wait: () => wait,
      sendInput: (data: string | Uint8Array) => new Promise<void>((resolve, reject) => {
        child.stdin.write(data, (error) => error ? reject(error) : resolve());
      }),
      closeInput: async () => { child.stdin.end(); },
      resize: async () => undefined,
      disconnect: async () => undefined,
    };
  });
  const abort = new AbortController();
  const owned = { startProcess, release: async () => undefined, client: {} as never };
  const ingress = await openHostedServeIngress(owned, config,
    { port: 0, workerPort, token: clientToken }, workerToken, abort.signal, 10_000);
  return { ingress, requests, startProcess, abort, close: async () => {
    await ingress.close();
    for (const socket of worker.clients) socket.terminate();
    await new Promise<void>((resolve) => worker.close(() => resolve()));
  } };
}

async function open(port: number, token = clientToken, headers: Record<string, string> = {}): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, { headers });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  }).catch((error: unknown) => { socket.terminate(); throw error; });
  return socket;
}

it('preserves binary frames and replaces client credentials and headers with a pinned worker handshake', async () => {
  const f = await fixture();
  try {
    const socket = await open(f.ingress.port, clientToken, { Authorization: 'Bearer client-header-canary', 'X-Forwarded-Host': 'untrusted.example' });
    const reply = new Promise<{ data: Buffer; binary: boolean }>((resolve) =>
      socket.once('message', (data, binary) => resolve({ data: data as Buffer, binary })));
    const bytes = Buffer.from([0, 255, 254, 128, 13, 10, 240, 159]);
    socket.send(bytes);
    expect(await reply).toEqual({ data: bytes, binary: true });
    expect(f.requests).toEqual([{ url: `/?token=${workerToken}`, authorization: undefined, origin: undefined }]);
    expect(f.startProcess.mock.calls[0]![0].environment).toEqual({});
    expect(JSON.stringify(f.startProcess.mock.calls)).not.toContain(clientToken);
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    f.abort.abort();
    await closed;
    await f.ingress.close();
    await expect(open(f.ingress.port)).rejects.toThrow(/ECONNREFUSED/u);
  } finally { await f.close(); }
});

it.each<{ token: string; headers: Record<string, string>; status: number }>([
  { token: 'wrong', headers: {}, status: 401 },
  { token: clientToken, headers: { Origin: 'https://untrusted.example' }, status: 403 },
  { token: clientToken, headers: { Host: 'untrusted.example' }, status: 403 },
])('refuses unauthenticated or cross-origin clients before allocating a worker relay: $status', async ({ token, headers, status }) => {
  const f = await fixture();
  try {
    await expect(open(f.ingress.port, token, headers)).rejects.toThrow(String(status));
    expect(f.startProcess).not.toHaveBeenCalled();
  } finally { await f.close(); }
});

it('settles cleanup even when a rejected client keeps its half of the upgraded socket open', async () => {
  const f = await fixture();
  const socket = createConnection({ host: '127.0.0.1', port: f.ingress.port, allowHalfOpen: true });
  try {
    socket.on('error', () => undefined);
    await new Promise<void>((resolve) => socket.once('connect', resolve));
    const response = new Promise<string>((resolve) => socket.once('data', (data: Buffer) => resolve(data.toString())));
    socket.write(`GET /?token=wrong HTTP/1.1\r\nHost: 127.0.0.1:${f.ingress.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    expect(await response).toContain('401');
    await Promise.race([f.ingress.close(), new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('rejected client blocked ingress cleanup')), 500);
      timer.unref();
    })]);
    expect(f.startProcess).not.toHaveBeenCalled();
  } finally { socket.destroy(); await f.close(); }
});

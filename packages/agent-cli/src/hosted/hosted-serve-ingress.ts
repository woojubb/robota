import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { hostedAdmissionError } from './hosted-runtime-config.js';
import type { Duplex } from 'node:stream';
import type { IE2BOwnedTaskWorker } from './e2b-task-worker.js';
import type { IE2BWorkerProcess } from './e2b-worker-process.js';
import type { IHostedWorkerExecutionConfig, IHostedWorkerServe } from './hosted-worker-execution-config.js';

const maxPendingBytes = 1024 * 1024;
const chunkBytes = 32 * 1024;

/** Binary TCP rides the SDK's text command streams without exposing a provider ingress capability. */
export const hostedServeRelay = `
const net = require('node:net');
const port = Number(process.argv[1]);
let socket, input = '', connected = false;
const deadline = Date.now() + 20000;
process.stdin.pause();
function connect() {
  socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { connected = true; process.stdin.resume(); });
  socket.on('data', data => {
    for (let offset = 0; offset < data.length; offset += 32768) {
      if (!process.stdout.write(data.subarray(offset, offset + 32768).toString('base64') + '\\n')) socket.pause();
    }
  });
  socket.once('error', () => {
    if (!connected && Date.now() < deadline) setTimeout(connect, 100);
    else process.exit(1);
  });
  socket.once('close', () => { if (connected) process.exit(0); });
  socket.on('drain', () => process.stdin.resume());
}
process.stdout.on('drain', () => socket.resume());
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  input += data;
  if (input.length > 1048576) process.exit(1);
  let end;
  while ((end = input.indexOf('\\n')) >= 0) {
    const line = input.slice(0, end); input = input.slice(end + 1);
    const bytes = Buffer.from(line, 'base64');
    if (!line || bytes.length > 32768 || bytes.toString('base64') !== line) process.exit(1);
    if (!socket.write(bytes)) process.stdin.pause();
  }
});
process.stdin.once('end', () => { socket.destroy(); process.exit(0); });
connect();
`;

export interface IHostedServeIngress {
  readonly port: number;
  close(): Promise<void>;
}

/** Bind only runtime loopback and replace all client authority with the pinned worker handshake. */
export async function openHostedServeIngress(
  owned: IE2BOwnedTaskWorker,
  config: IHostedWorkerExecutionConfig,
  serve: IHostedWorkerServe,
  workerToken: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<IHostedServeIngress> {
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  const expected = createHash('sha256').update(serve.token).digest();
  const clients = new Set<Duplex>();
  const upgraded = new Set<Duplex>();
  const relays = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  server.maxConnections = 64;
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.on('upgrade', (request, socket, head) => {
    upgraded.add(socket);
    socket.once('close', () => upgraded.delete(socket));
    socket.on('error', () => socket.destroy());
    const reject = (status: number): void => {
      socket.end(`HTTP/1.1 ${status} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`, () => socket.destroy());
    };
    if (closing || signal.aborted) { reject(503); return; }
    const port = (server.address() as { port: number }).port;
    if (request.headers.host !== `127.0.0.1:${port}` && request.headers.host !== `localhost:${port}`) {
      reject(403); return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== 'file://' && origin !== `http://127.0.0.1:${port}` &&
      origin !== `http://localhost:${port}`) { reject(403); return; }
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { reject(400); return; }
    const supplied = url.searchParams.get('token') ?? '';
    if (url.pathname !== '/' || url.searchParams.getAll('token').length !== 1 ||
      !timingSafeEqual(expected, createHash('sha256').update(supplied).digest())) {
      reject(401); return;
    }
    const key = request.headers['sec-websocket-key'];
    if (request.method !== 'GET' || request.headers.upgrade?.toLowerCase() !== 'websocket' ||
      request.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' ||
      !/^[A-Za-z0-9+/]{22}==$/u.test(key) || clients.size >= 8) { reject(400); return; }
    clients.add(socket);
    socket.pause();
    const task = (async (): Promise<void> => {
      let remote: IE2BWorkerProcess | undefined;
      let output = '';
      let pendingBytes = 0;
      let input = Promise.resolve();
      let ended = false;
      const enqueue = (data: Buffer): void => {
        if (ended) return;
        pendingBytes += data.length;
        if (pendingBytes > maxPendingBytes) { socket.destroy(); return; }
        socket.pause();
        input = input.then(async () => {
          if (ended || signal.aborted || closing) return;
          for (let offset = 0; offset < data.length; offset += chunkBytes)
            await remote!.sendInput(data.subarray(offset, offset + chunkBytes).toString('base64') + '\n');
          pendingBytes -= data.length;
          if (pendingBytes === 0 && !ended) socket.resume();
        });
        void input.catch(() => socket.destroy());
      };
      socket.once('close', () => {
        ended = true;
        // Closing stdin terminates the relay TCP connection; VM deletion owns final cleanup.
        void remote?.closeInput().catch(() => undefined);
      });
      try {
        remote = await owned.startProcess({
          command: `exec env -i PATH='/usr/local/bin:/usr/bin:/bin' ${quote(config.nodeExecutable)} -e ${quote(hostedServeRelay)} ${serve.workerPort}`,
          cwd: config.workspaceRoot,
          environment: {},
          timeoutMs,
          onStdout: (chunk) => {
            if (ended || signal.aborted || closing) return;
            output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
            if (output.length > maxPendingBytes) { socket.destroy(); return; }
            let end: number;
            while ((end = output.indexOf('\n')) >= 0) {
              const line = output.slice(0, end); output = output.slice(end + 1);
              const bytes = Buffer.from(line, 'base64');
              if (!line || bytes.length > chunkBytes || bytes.toString('base64') !== line ||
                socket.writableLength + bytes.length > maxPendingBytes) { socket.destroy(); return; }
              socket.write(bytes);
            }
          },
          onStderr: () => socket.destroy(),
        });
        if (ended || signal.aborted || closing) { await remote.closeInput(); return; }
        // Do not forward client headers, paths, bearer tokens or proxy claims to the worker.
        enqueue(Buffer.from(`GET /?token=${workerToken} HTTP/1.1\r\nHost: 127.0.0.1:${serve.workerPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
        if (head.length) enqueue(head);
        socket.on('data', enqueue);
        await remote.wait();
      } catch { socket.destroy(); }
      finally {
        ended = true;
        socket.destroy();
        clients.delete(socket);
        await remote?.disconnect();
      }
    })();
    relays.add(task);
    void task.finally(() => relays.delete(task)).catch(() => undefined);
  });
  const close = (): Promise<void> => {
    closing ??= (async () => {
      signal.removeEventListener('abort', onAbort);
      for (const socket of upgraded) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      const results = await Promise.allSettled([...relays]);
      if (results.some((result) => result.status === 'rejected'))
        throw hostedAdmissionError('worker serve stream cleanup is unresolved');
    })();
    return closing;
  };
  const onAbort = (): void => { void close().catch(() => undefined); };
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(serve.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  }).catch(() => { throw hostedAdmissionError('runtime serve loopback ingress is unavailable'); });
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) { await close(); signal.throwIfAborted(); }
  return { port: (server.address() as { port: number }).port, close };
}

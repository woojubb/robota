import { request } from 'node:http';
import { pipeline } from 'node:stream/promises';

import { HostError, type HostErrorCode } from '../errors.js';
import { type IAdminErrorBody, type IAdminResultBody, TAR_TYPE } from './protocol.js';

/** The control plane could not be reached at all, as opposed to answering with a refusal. */
export class UnreachableError extends Error {
  constructor(socket: string, reason: string) {
    super(
      `Cannot reach the control plane at ${socket} (${reason}); is "personal-agent-host serve" running?`,
    );
    this.name = 'UnreachableError';
  }
}

const CODES: ReadonlySet<string> = new Set<HostErrorCode>([
  'config-invalid',
  'bad-request',
  'invalid-input',
  'refused',
  'not-found',
  'conflict',
  'confirmation-required',
  'busy',
  'guard-unverified',
  'runtime-failed',
  'store-corrupt',
  'secret-missing',
]);

function parseFailure(text: string, status: number): HostError {
  try {
    const body = JSON.parse(text) as Partial<IAdminErrorBody>;
    const code = body.error?.code;
    if (typeof code === 'string' && CODES.has(code) && typeof body.error?.message === 'string') {
      return new HostError(code as HostErrorCode, body.error.message);
    }
  } catch {
    // Fall through to the generic failure below.
  }
  return new HostError('runtime-failed', `The control plane answered with status ${status}`);
}

/** One JSON request over the admin socket. A refusal comes back as the `HostError` it was. */
export function adminRequest<T>(
  socket: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: socket,
        path,
        method,
        headers: {
          connection: 'close',
          ...(payload !== undefined
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const status = res.statusCode ?? 0;
          if (status === 200) {
            try {
              resolve((JSON.parse(text) as IAdminResultBody<T>).result);
              return;
            } catch {
              reject(
                new HostError('runtime-failed', 'The control plane sent an unreadable answer'),
              );
              return;
            }
          }
          reject(parseFailure(text, status));
        });
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => reject(transportError(socket, error)));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function transportError(socket: string, error: NodeJS.ErrnoException): Error {
  const down = ['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM', 'ENOTSOCK'].includes(error.code ?? '');
  return down ? new UnreachableError(socket, error.code ?? 'error') : error;
}

/** Where downloaded bytes go: a stream such as stdout, or anything with the same two calls. */
export interface IByteSink {
  write(chunk: Uint8Array): unknown;
  once?(event: 'drain', listener: () => void): unknown;
}

async function writeTo(sink: IByteSink, chunk: Uint8Array): Promise<void> {
  const flushed = sink.write(chunk);
  if (flushed === false && sink.once) {
    await new Promise<void>((resolve) => sink.once?.('drain', resolve));
  }
}

function readText(res: AsyncIterable<Buffer>): Promise<string> {
  return (async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of res) chunks.push(chunk);
    return Buffer.concat(chunks).toString('utf8');
  })();
}

/**
 * A POST whose answer is an archive, written to `sink` as it arrives. The answer carries its
 * length, so a transfer that stops early is an error, never a short file that looks finished.
 */
export function adminDownload(socket: string, path: string, sink: IByteSink): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const req = request(
      {
        socketPath: socket,
        path,
        method: 'POST',
        headers: { connection: 'close', 'content-length': 0 },
      },
      (res) => {
        void (async () => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            reject(parseFailure(await readText(res).catch(() => ''), status));
            return;
          }
          const expected = Number(res.headers['content-length']);
          let received = 0;
          try {
            for await (const chunk of res) {
              received += (chunk as Buffer).length;
              await writeTo(sink, chunk as Buffer);
            }
          } catch {
            reject(
              new HostError(
                'runtime-failed',
                'The transfer was cut off; the archive is incomplete',
              ),
            );
            return;
          }
          if (!res.complete || received !== expected) {
            reject(
              new HostError(
                'runtime-failed',
                'The transfer was cut off; the archive is incomplete',
              ),
            );
            return;
          }
          resolve(received);
        })();
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => reject(transportError(socket, error)));
    req.end();
  });
}

/** A POST whose body is an archive read from `source`; the answer is JSON as for any command. */
export function adminUpload<T>(
  socket: string,
  path: string,
  source: NodeJS.ReadableStream,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let answered = false;
    const req = request(
      {
        socketPath: socket,
        path,
        method: 'POST',
        headers: { connection: 'close', 'content-type': TAR_TYPE },
      },
      (res) => {
        answered = true;
        void readText(res).then((text) => {
          const status = res.statusCode ?? 0;
          if (status !== 200) {
            reject(parseFailure(text, status));
            return;
          }
          try {
            resolve((JSON.parse(text) as IAdminResultBody<T>).result);
          } catch {
            reject(new HostError('runtime-failed', 'The control plane sent an unreadable answer'));
          }
        });
      },
    );
    req.on('error', (error: NodeJS.ErrnoException) => {
      // The control plane may refuse and hang up while the rest is still being sent.
      if (!answered) reject(transportError(socket, error));
    });
    pipeline(source, req).catch((error: NodeJS.ErrnoException) => {
      if (!answered) reject(transportError(socket, error));
    });
  });
}

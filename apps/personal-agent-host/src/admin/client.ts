import { request } from 'node:http';

import { HostError, type HostErrorCode } from '../errors.js';
import type { IAdminErrorBody, IAdminResultBody } from './protocol.js';

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
    req.on('error', (error: NodeJS.ErrnoException) => {
      const down = ['ENOENT', 'ECONNREFUSED', 'EACCES', 'EPERM', 'ENOTSOCK'].includes(
        error.code ?? '',
      );
      reject(down ? new UnreachableError(socket, error.code ?? 'error') : error);
    });
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

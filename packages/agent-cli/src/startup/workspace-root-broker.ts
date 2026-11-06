import { randomUUID } from 'node:crypto';
import { lstatSync, unlinkSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute } from 'node:path';

import {
  assertSameStableRoot,
  createStableRootedFileReader,
  StableFileAuthorityError,
  type IStableRootedFileReader,
} from '@robota-sdk/agent-file-authority';
import { createProcessOperationLock } from '@robota-sdk/agent-session/node';

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 4_096;
const MAX_ROOT_BYTES = 2_048;
const MAX_PREPARED_ROOTS = 32;
const REQUEST_TIMEOUT_MS = 2_000;
const CANDIDATE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type TRequest =
  | { readonly op: 'ping' }
  | { readonly op: 'prepare'; readonly root: string }
  | { readonly op: 'compare'; readonly left: string; readonly right: string }
  | { readonly op: 'release'; readonly candidate: string };

type TResponse =
  | { readonly status: 'ready' }
  | { readonly status: 'prepared'; readonly candidate: string }
  | { readonly status: 'same' }
  | { readonly status: 'released' }
  | { readonly status: 'refused'; readonly reason: string };

function refuse(reason: string): TResponse {
  return { status: 'refused', reason };
}

function privateEndpoint(endpoint: string, requireSocket: boolean): void {
  if (process.platform === 'win32') throw new Error('Protected Windows root broker pipes are not available.');
  if (!isAbsolute(endpoint) || Buffer.byteLength(endpoint, 'utf8') > 100) {
    throw new Error('The root broker endpoint must be a short absolute path.');
  }
  const parent = lstatSync(dirname(endpoint));
  if (!parent.isDirectory() || parent.isSymbolicLink() ||
      parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0) {
    throw new Error('The root broker endpoint directory is not owner-private.');
  }
  if (requireSocket) {
    const entry = lstatSync(endpoint);
    if (!entry.isSocket() || entry.uid !== process.getuid?.()) {
      throw new Error('The root broker endpoint is not an owner socket.');
    }
  }
}

function candidate(value: unknown): value is string {
  return typeof value === 'string' && CANDIDATE.test(value);
}

function parseRequest(frame: string): { version: number; request: TRequest } | undefined {
  let value: unknown;
  try { value = JSON.parse(frame); } catch { return undefined; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version)) return undefined;
  if (row.op === 'ping') return { version: Number(row.version), request: { op: 'ping' } };
  if (row.op === 'prepare' && typeof row.root === 'string' &&
      Buffer.byteLength(row.root, 'utf8') <= MAX_ROOT_BYTES && !row.root.includes('\0') &&
      isAbsolute(row.root)) {
    return { version: Number(row.version), request: { op: 'prepare', root: row.root } };
  }
  if (row.op === 'compare' && candidate(row.left) && candidate(row.right)) {
    return { version: Number(row.version), request: {
      op: 'compare', left: row.left, right: row.right,
    } };
  }
  if (row.op === 'release' && candidate(row.candidate)) {
    return { version: Number(row.version), request: { op: 'release', candidate: row.candidate } };
  }
  return undefined;
}

function frameResponse(response: TResponse): string {
  return `${JSON.stringify(response)}\n`;
}

/** A process lock serializes recovery; a live or unproven endpoint is never unlinked. */
async function clearCrashedEndpoint(endpoint: string): Promise<void> {
  let old;
  try {
    old = lstatSync(endpoint, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (!old.isSocket() || old.uid !== BigInt(process.getuid?.() ?? -1)) {
    throw new Error('The existing root broker endpoint is not an owner socket.');
  }
  const state = await new Promise<'live' | 'stale'>((resolve, reject) => {
    const probe = createConnection(endpoint);
    const timer = setTimeout(() => {
      probe.destroy();
      reject(new Error('The existing root broker endpoint could not be checked.'));
    }, REQUEST_TIMEOUT_MS);
    const settle = (result: 'live' | 'stale' | Error) => {
      clearTimeout(timer);
      probe.destroy();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    probe.once('connect', () => settle('live'));
    probe.once('error', (error: NodeJS.ErrnoException) =>
      settle(error.code === 'ECONNREFUSED' ? 'stale' : error));
  });
  if (state === 'live') throw new Error('A root broker already owns this endpoint.');
  const current = lstatSync(endpoint, { bigint: true });
  if (!current.isSocket() || current.dev !== old.dev || current.ino !== old.ino) {
    throw new Error('The crashed root broker endpoint changed during recovery.');
  }
  unlinkSync(endpoint);
}

/** A non-authorizing registry: no request returns project content or mints workspace trust. */
export async function startWorkspaceRootBroker(endpoint: string): Promise<{ close(): Promise<void> }> {
  privateEndpoint(endpoint, false);
  const lock = createProcessOperationLock(dirname(endpoint)).tryAcquire('workspace-root-broker');
  if (lock === undefined) throw new Error('A root broker already owns this namespace.');
  try {
    await clearCrashedEndpoint(endpoint);
  } catch (error) {
    lock.release();
    throw error;
  }
  const prepared = new Map<string, IStableRootedFileReader>();
  const sockets = new Set<Socket>();
  let closed = false;
  const handle = (frame: string): TResponse => {
    const parsed = parseRequest(frame);
    if (parsed === undefined) return refuse('malformed');
    if (parsed.version !== PROTOCOL_VERSION) return refuse('version');
    const request = parsed.request;
    if (request.op === 'ping') return { status: 'ready' };
    if (request.op === 'prepare') {
      if (prepared.size >= MAX_PREPARED_ROOTS) return refuse('capacity');
      let root: IStableRootedFileReader | undefined;
      try {
        root = createStableRootedFileReader(request.root);
        // Profile proof is required before retaining even a pending object.
        assertSameStableRoot(root, root);
        const id = randomUUID();
        prepared.set(id, root);
        return { status: 'prepared', candidate: id };
      } catch {
        root?.close();
        return refuse('root-unavailable');
      }
    }
    if (request.op === 'release') {
      const root = prepared.get(request.candidate);
      if (root === undefined) return refuse('unknown-candidate');
      try {
        root.close();
      } catch {
        return refuse('cleanup-unconfirmed');
      }
      prepared.delete(request.candidate);
      return { status: 'released' };
    }
    const left = prepared.get(request.left);
    const right = prepared.get(request.right);
    if (left === undefined || right === undefined) return refuse('unknown-candidate');
    try {
      assertSameStableRoot(left, right);
      return { status: 'same' };
    } catch (error) {
      return refuse(error instanceof StableFileAuthorityError && error.code === 'ROOT_CHANGED'
        ? 'different-root' : 'root-unavailable');
    }
  };

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    let frame = Buffer.alloc(0);
    let done = false;
    socket.on('data', (chunk: Buffer) => {
      if (done) return;
      if (frame.length + chunk.length > MAX_FRAME_BYTES) {
        done = true;
        socket.end(frameResponse(refuse('frame-size')));
        return;
      }
      frame = Buffer.concat([frame, chunk]);
      const newline = frame.indexOf(10);
      if (newline < 0) return;
      done = true;
      socket.end(frameResponse(newline === frame.length - 1
        ? handle(frame.subarray(0, newline).toString('utf8')) : refuse('malformed')));
    });
    socket.on('error', () => socket.destroy());
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    lock.release();
    throw error;
  }
  const bound = lstatSync(endpoint);
  try {
    privateEndpoint(endpoint, true);
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    let cleanupConfirmed = false;
    try {
      const now = lstatSync(endpoint);
      if (now.dev === bound.dev && now.ino === bound.ino) {
        unlinkSync(endpoint);
        cleanupConfirmed = true;
      }
    } catch (cleanupError) {
      // Node removes its Unix socket on server.close(). An absent path confirms cleanup here.
      cleanupConfirmed = (cleanupError as NodeJS.ErrnoException).code === 'ENOENT';
    }
    if (cleanupConfirmed) lock.release();
    throw error;
  }
  let closing: Promise<void> | undefined;
  return {
    close(): Promise<void> {
      return closing ??= (async () => {
        if (closed) return;
        closed = true;
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        for (const root of prepared.values()) root.close();
        prepared.clear();
        try {
          const now = lstatSync(endpoint);
          if (now.dev !== bound.dev || now.ino !== bound.ino) {
            throw new Error('Root broker endpoint cleanup is unconfirmed.');
          }
          unlinkSync(endpoint);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        lock.release();
      })();
    },
  };
}

/** One bounded request to a live, owner-private broker endpoint. */
export async function requestWorkspaceRootBroker(
  endpoint: string,
  request: TRequest,
  version = PROTOCOL_VERSION,
): Promise<TResponse> {
  privateEndpoint(endpoint, true);
  return new Promise<TResponse>((resolve, reject) => {
    const socket = createConnection(endpoint);
    let frame = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, response?: TResponse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(response ?? refuse('malformed'));
    };
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => finish(new Error('Root broker timed out.')));
    socket.once('error', (error) => finish(error));
    socket.once('connect', () => socket.write(`${JSON.stringify({ version, ...request })}\n`));
    socket.on('data', (chunk: Buffer) => {
      frame = Buffer.concat([frame, chunk]);
      if (frame.length > MAX_FRAME_BYTES) return finish(new Error('Root broker response exceeded its bound.'));
      const newline = frame.indexOf(10);
      if (newline < 0) return;
      if (newline !== frame.length - 1) return finish(new Error('Root broker response is malformed.'));
      try {
        const value: unknown = JSON.parse(frame.subarray(0, newline).toString('utf8'));
        if (typeof value !== 'object' || value === null || !('status' in value) ||
            typeof value.status !== 'string') throw new Error('Root broker response is malformed.');
        finish(undefined, value as TResponse);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Root broker response is malformed.'));
      }
    });
    socket.once('end', () => finish(new Error('Root broker closed without a response.')));
  });
}

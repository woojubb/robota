import { randomUUID } from 'node:crypto';
import { lstatSync, unlinkSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { dirname, isAbsolute } from 'node:path';

import {
  assertSameStableRoot,
  assertSameStablePosixRootDescriptor,
  assertSameStableRootedWriter,
  createStableRootedFileReader,
  createStableRootedFileWriter,
  StableFileAuthorityError,
  type IStableRootedFileReader,
  type INamedStableRootedFileWriter,
} from '@robota-sdk/agent-file-authority';
import {
  createNodeWorkspaceIdentityResolver,
  createNodeWorkspaceProjectFiles,
  createNodeWorkspaceTrustStore,
} from '@robota-sdk/agent-framework/node';
import { createProcessOperationLock } from '@robota-sdk/agent-session/node';
import { WindowsControlPipeServer, type IControlChannel } from '@robota-sdk/agent-local-host';

import type { IWorkspaceIdentity, IWorkspaceIdentityResolver } from '@robota-sdk/agent-framework';

const PROTOCOL_VERSION = 1;
const MAX_REQUEST_FRAME_BYTES = 6 * 1_024 * 1_024;
const MAX_RESPONSE_FRAME_BYTES = 8 * 1_024 * 1_024;
const MAX_ROOT_BYTES = 2_048;
const MAX_PREPARED_ROOTS = 32;
const PREPARED_ROOT_TTL_MS = 5 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;
const CANDIDATE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export type TWorkspaceRootBrokerRequest =
  | { readonly op: 'ping' }
  | { readonly op: 'prepare'; readonly root: string }
  | { readonly op: 'approve'; readonly candidate: string; readonly root: string }
  | { readonly op: 'inspect'; readonly root: string }
  | { readonly op: 'revoke'; readonly root: string }
  | { readonly op: 'read'; readonly lease: string; readonly segments: readonly string[]; readonly maxBytes: number }
  | { readonly op: 'list' | 'kind'; readonly lease: string; readonly segments: readonly string[] }
  | {
      readonly op: 'mutate'; readonly lease: string; readonly operationId: string;
      readonly method: 'write' | 'replace' | 'append' | 'delete' | 'sweepTemporaries' |
        'linkCount' | 'stage' | 'commitStaged' | 'discardStaged';
      readonly relativePath: string;
      readonly content?: string;
      readonly temporaryName?: string;
      readonly apply?: boolean;
      readonly migrationStartedAt?: number;
    }
  | { readonly op: 'prepareWriter'; readonly lease: string }
  | { readonly op: 'writerAssert' | 'writerClose'; readonly writer: string }
  | { readonly op: 'writerWrite'; readonly writer: string; readonly segments: readonly string[]; readonly content: string }
  | { readonly op: 'compare'; readonly left: string; readonly right: string }
  | { readonly op: 'release'; readonly candidate: string };

export type TWorkspaceRootBrokerResponse =
  | { readonly status: 'ready'; readonly pid: number }
  | { readonly status: 'prepared'; readonly candidate: string }
  | { readonly status: 'trusted'; readonly lease: string; readonly grantedAt: string; readonly generation: number }
  | { readonly status: 'untrusted' | 'stale/replaced' | 'revoked'; readonly generation: number }
  | { readonly status: 'bytes'; readonly content: string }
  | { readonly status: 'missing' | 'over-budget' }
  | { readonly status: 'entries'; readonly entries: readonly { readonly name: string; readonly kind: string }[] }
  | { readonly status: 'kind'; readonly kind: string }
  | { readonly status: 'mutation'; readonly value?: boolean | number | string }
  | { readonly status: 'writer'; readonly writer: string }
  | { readonly status: 'written' }
  | { readonly status: 'same' }
  | { readonly status: 'released' }
  | { readonly status: 'refused'; readonly reason: string };

type TRequest = TWorkspaceRootBrokerRequest;
type TResponse = TWorkspaceRootBrokerResponse;

function refuse(reason: string): TResponse {
  return { status: 'refused', reason };
}

function privateEndpoint(endpoint: string, requireSocket: boolean): void {
  if (process.platform === 'win32') {
    if (!/^\\\\\.\\pipe\\robota-root-[0-9a-f]{24}$/u.test(endpoint)) {
      throw new Error('The Windows root broker pipe name is invalid.');
    }
    return;
  }
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

function rootPath(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_ROOT_BYTES &&
    !value.includes('\0') && isAbsolute(value);
}

function segments(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 64 && value.every((part) =>
    typeof part === 'string' && part.length > 0 && Buffer.byteLength(part, 'utf8') <= 255 &&
    part !== '.' && part !== '..' && !part.includes('\0') &&
    !part.includes('/') && !part.includes('\\'));
}

function relativePath(value: unknown): value is string {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 2_048 &&
    !value.includes('\0');
}

function base64(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 5_592_408 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}

function parseRequest(frame: string): { version: number; request: TRequest } | undefined {
  let value: unknown;
  try { value = JSON.parse(frame); } catch { return undefined; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.version)) return undefined;
  if (row.op === 'ping') return { version: Number(row.version), request: { op: 'ping' } };
  if (row.op === 'prepare' && rootPath(row.root)) {
    return { version: Number(row.version), request: { op: 'prepare', root: row.root } };
  }
  if ((row.op === 'inspect' || row.op === 'revoke') && rootPath(row.root)) {
    return { version: Number(row.version), request: { op: row.op, root: row.root } };
  }
  if (row.op === 'approve' && candidate(row.candidate) && rootPath(row.root)) {
    return { version: Number(row.version), request: {
      op: 'approve', candidate: row.candidate, root: row.root,
    } };
  }
  if (row.op === 'read' && candidate(row.lease) && segments(row.segments) &&
      row.segments.length > 0 && Number.isSafeInteger(row.maxBytes) &&
      Number(row.maxBytes) >= 0 && Number(row.maxBytes) <= 4_194_304) {
    return { version: Number(row.version), request: {
      op: 'read', lease: row.lease, segments: row.segments, maxBytes: Number(row.maxBytes),
    } };
  }
  if ((row.op === 'list' || row.op === 'kind') && candidate(row.lease) &&
      segments(row.segments)) {
    return { version: Number(row.version), request: {
      op: row.op, lease: row.lease, segments: row.segments,
    } };
  }
  if (row.op === 'mutate' && candidate(row.lease) && candidate(row.operationId) &&
      relativePath(row.relativePath) && typeof row.method === 'string' &&
      ['write', 'replace', 'append', 'delete', 'sweepTemporaries', 'linkCount',
        'stage', 'commitStaged', 'discardStaged'].includes(row.method) &&
      (row.content === undefined || base64(row.content)) &&
      (row.temporaryName === undefined ||
        (typeof row.temporaryName === 'string' && row.temporaryName.length <= 255 &&
          !row.temporaryName.includes('/') && !row.temporaryName.includes('\\'))) &&
      (row.apply === undefined || typeof row.apply === 'boolean') &&
      (row.migrationStartedAt === undefined ||
        (typeof row.migrationStartedAt === 'number' && Number.isFinite(row.migrationStartedAt)))) {
    return { version: Number(row.version), request: {
      op: 'mutate', lease: row.lease, operationId: row.operationId,
      method: row.method as Extract<TRequest, { op: 'mutate' }>['method'],
      relativePath: row.relativePath,
      ...(row.content === undefined ? {} : { content: row.content }),
      ...(row.temporaryName === undefined ? {} : { temporaryName: row.temporaryName }),
      ...(row.apply === undefined ? {} : { apply: row.apply }),
      ...(row.migrationStartedAt === undefined ? {} : { migrationStartedAt: row.migrationStartedAt }),
    } };
  }
  if (row.op === 'prepareWriter' && candidate(row.lease)) {
    return { version: Number(row.version), request: { op: 'prepareWriter', lease: row.lease } };
  }
  if ((row.op === 'writerAssert' || row.op === 'writerClose') && candidate(row.writer)) {
    return { version: Number(row.version), request: { op: row.op, writer: row.writer } };
  }
  if (row.op === 'writerWrite' && candidate(row.writer) && segments(row.segments) &&
      row.segments.length > 0 && typeof row.content === 'string' &&
      Buffer.byteLength(row.content, 'utf8') <= 4_194_304) {
    return { version: Number(row.version), request: {
      op: 'writerWrite', writer: row.writer, segments: row.segments, content: row.content,
    } };
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
  if (process.platform === 'win32') return;
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

/** Retains approved root objects and performs every project operation against them. */
export async function startWorkspaceRootBroker(
  endpoint: string,
  lockDirectory: string = dirname(endpoint),
  historyFile?: string,
): Promise<{ close(): Promise<void> }> {
  privateEndpoint(endpoint, false);
  const lock = createProcessOperationLock(lockDirectory).tryAcquire('workspace-root-broker');
  if (lock === undefined) throw new Error('A root broker already owns this namespace.');
  try {
    await clearCrashedEndpoint(endpoint);
  } catch (error) {
    lock.release();
    throw error;
  }
  const prepared = new Map<string, {
    readonly root: string;
    readonly reader: IStableRootedFileReader;
    readonly createdAt: number;
  }>();
  const active = new Map<string, {
    readonly root: string;
    readonly reader: IStableRootedFileReader;
    readonly grantedAt: string;
    readonly identity?: IWorkspaceIdentity;
  }>();
  const revokedPaths = new Set<string>();
  let generation = 0;
  const mutationResults = new Map<string, TResponse>();
  const writers = new Map<string, { readonly lease: string; readonly authority: INamedStableRootedFileWriter }>();
  const nodeFiles = createNodeWorkspaceProjectFiles();
  const history = historyFile === undefined ? undefined : createNodeWorkspaceTrustStore(historyFile);
  const sockets = new Set<Socket | IControlChannel>();
  let closed = false;
  const handle = async (frame: string): Promise<TResponse> => {
    if (closed) return refuse('broker-closing');
    for (const [id, pending] of prepared) {
      if (Date.now() - pending.createdAt < PREPARED_ROOT_TTL_MS) continue;
      try { pending.reader.close(); }
      catch { return refuse('cleanup-unconfirmed'); }
      prepared.delete(id);
    }
    const parsed = parseRequest(frame);
    if (parsed === undefined) return refuse('malformed');
    if (parsed.version !== PROTOCOL_VERSION) return refuse('version');
    const request = parsed.request;
    if (request.op === 'ping') return { status: 'ready', pid: process.pid };
    if (request.op === 'prepare') {
      if (prepared.size >= MAX_PREPARED_ROOTS) return refuse('capacity');
      let root: IStableRootedFileReader | undefined;
      try {
        root = createStableRootedFileReader(request.root);
        // Profile proof is required before retaining even a pending object.
        assertSameStableRoot(root, root);
        const id = randomUUID();
        prepared.set(id, { root: request.root, reader: root, createdAt: Date.now() });
        return { status: 'prepared', candidate: id };
      } catch {
        root?.close();
        return refuse('root-unavailable');
      }
    }
    if (request.op === 'approve') {
      const pending = prepared.get(request.candidate);
      if (pending === undefined) return refuse('unknown-candidate');
      if (pending.root !== request.root) return refuse('candidate-root-mismatch');
      let current: IStableRootedFileReader | undefined;
      try {
        current = createStableRootedFileReader(pending.root);
        assertSameStableRoot(pending.reader, current);
        const identity = history === undefined ? undefined
          : createNodeWorkspaceIdentityResolver().resolve(pending.root);
        const recorded = identity === undefined || history === undefined ? undefined
          : await history.grant(identity, (await history.inspect(identity)).generation);
        const named = createStableRootedFileReader(pending.root);
        try { assertSameStableRoot(pending.reader, named); }
        finally { named.close(); }
        const lease = randomUUID();
        const grantedAt = recorded?.grantedAt ?? new Date().toISOString();
        generation += 1;
        prepared.delete(request.candidate);
        active.set(lease, { root: pending.root, reader: pending.reader, grantedAt,
          ...(identity === undefined ? {} : { identity }),
        });
        revokedPaths.delete(pending.root);
        return { status: 'trusted', lease, grantedAt, generation };
      } catch {
        return refuse('root-changed');
      } finally {
        current?.close();
      }
    }
    if (request.op === 'inspect') {
      let current: IStableRootedFileReader | undefined;
      try {
        current = createStableRootedFileReader(request.root);
        assertSameStableRoot(current, current);
        for (const [lease, approved] of active) {
          try {
            assertSameStableRoot(approved.reader, current);
            return { status: 'trusted', lease, grantedAt: approved.grantedAt, generation };
          } catch (error) {
            if (!(error instanceof StableFileAuthorityError) || error.code !== 'ROOT_CHANGED') {
              return refuse('root-unavailable');
            }
          }
        }
        if ([...active.values()].some((entry) => entry.root === request.root)) {
          return { status: 'stale/replaced', generation };
        }
        return { status: revokedPaths.has(request.root) ? 'revoked' : 'untrusted', generation };
      } catch {
        return refuse('root-unavailable');
      } finally {
        current?.close();
      }
    }
    if (request.op === 'revoke') {
      let named: IStableRootedFileReader | undefined;
      try {
        named = createStableRootedFileReader(request.root);
        assertSameStableRoot(named, named);
      } catch {
        named?.close();
        named = undefined;
      }
      const matching: string[] = [];
      try {
        for (const [lease, approved] of active) {
          if (approved.root === request.root) {
            matching.push(lease);
            continue;
          }
          if (named === undefined) continue;
          try {
            assertSameStableRoot(approved.reader, named);
            matching.push(lease);
          } catch (error) {
            if (!(error instanceof StableFileAuthorityError) || error.code !== 'ROOT_CHANGED') {
              return refuse('root-unavailable');
            }
          }
        }
      } finally {
        named?.close();
      }
      let historicalIdentity: IWorkspaceIdentity | undefined;
      for (const lease of matching) {
        const approved = active.get(lease)!;
        historicalIdentity ??= approved.identity;
        revokedPaths.add(approved.root);
        active.delete(lease);
        for (const [writerId, writer] of writers) {
          if (writer.lease !== lease) continue;
          writers.delete(writerId);
          try { writer.authority.close(); } catch { return refuse('cleanup-unconfirmed'); }
        }
        try {
          approved.reader.close();
        } catch {
          return refuse('cleanup-unconfirmed');
        }
      }
      if (history !== undefined) {
        try {
          historicalIdentity ??= createNodeWorkspaceIdentityResolver().resolve(request.root);
          await history.revoke(
            historicalIdentity, (await history.inspect(historicalIdentity)).generation,
          );
        } catch {
          return refuse('history-unconfirmed');
        }
      }
      revokedPaths.add(request.root);
      generation += 1;
      return { status: 'revoked', generation };
    }
    if (request.op === 'mutate') {
      const prior = mutationResults.get(request.operationId);
      if (prior !== undefined) return prior;
      const approved = active.get(request.lease);
      if (approved === undefined) return refuse('unknown-lease');
      const identity: IWorkspaceIdentity = {
        worktreeRoot: approved.root, displayPath: approved.root, repositoryKey: approved.root,
      };
      const resolver: IWorkspaceIdentityResolver = {
        resolve: () => identity,
        assertOpenedRootDescriptor: (descriptor) =>
          assertSameStablePosixRootDescriptor(approved.reader, descriptor),
      };
      let result: TResponse;
      try {
        const boundary = nodeFiles.createMutationBoundary(identity, resolver);
        const path = request.relativePath;
        const content = request.content === undefined ? undefined : Buffer.from(request.content, 'base64');
        switch (request.method) {
          case 'write':
          case 'replace': {
            if (content === undefined) return refuse('malformed');
            boundary[request.method](path, content);
            result = { status: 'mutation' };
            break;
          }
          case 'stage': {
            if (content === undefined) return refuse('malformed');
            result = { status: 'mutation', value: boundary.stage(path, content) };
            break;
          }
          case 'append':
            if (content === undefined) return refuse('malformed');
            boundary.append(path, new TextDecoder('utf-8', { fatal: true }).decode(content));
            result = { status: 'mutation' };
            break;
          case 'delete': result = { status: 'mutation', value: boundary.delete(path) }; break;
          case 'linkCount': {
            const value = boundary.linkCount(path);
            result = value === undefined ? { status: 'missing' } : { status: 'mutation', value };
            break;
          }
          case 'sweepTemporaries':
            if (request.apply === undefined) return refuse('malformed');
            result = { status: 'mutation', value: boundary.sweepTemporaries(
              path, request.apply, request.migrationStartedAt,
            ) };
            break;
          case 'commitStaged':
          case 'discardStaged':
            if (request.temporaryName === undefined) return refuse('malformed');
            boundary[request.method](path, request.temporaryName);
            result = { status: 'mutation' };
            break;
        }
      } catch {
        result = refuse('write-outcome-unknown');
      }
      mutationResults.set(request.operationId, result);
      if (mutationResults.size > 1_024) mutationResults.delete(mutationResults.keys().next().value!);
      return result;
    }
    if (request.op === 'prepareWriter') {
      const approved = active.get(request.lease);
      if (approved === undefined) return refuse('unknown-lease');
      let writer: INamedStableRootedFileWriter | undefined;
      try {
        writer = createStableRootedFileWriter(approved.root);
        assertSameStableRootedWriter(approved.reader, writer);
        const id = randomUUID();
        writers.set(id, { lease: request.lease, authority: writer });
        return { status: 'writer', writer: id };
      } catch {
        writer?.close();
        return refuse('root-changed');
      }
    }
    if (request.op === 'writerAssert' || request.op === 'writerWrite' || request.op === 'writerClose') {
      const entry = writers.get(request.writer);
      if (entry === undefined || !active.has(entry.lease)) return refuse('unknown-writer');
      try {
        if (request.op === 'writerClose') {
          writers.delete(request.writer);
          entry.authority.close();
          return { status: 'released' };
        }
        entry.authority.assertNamedRoot();
        if (request.op === 'writerWrite') {
          entry.authority.writeUtf8WhileNamed(request.segments, request.content);
          return { status: 'written' };
        }
        return { status: 'same' };
      } catch {
        return refuse(request.op === 'writerWrite' ? 'write-outcome-unknown' : 'root-changed');
      }
    }
    if (request.op === 'read' || request.op === 'list' || request.op === 'kind') {
      const approved = active.get(request.lease);
      if (approved === undefined) return refuse('unknown-lease');
      let operation: IStableRootedFileReader | undefined;
      try {
        operation = createStableRootedFileReader(approved.root);
        assertSameStableRoot(approved.reader, operation);
        if (request.op === 'read') {
          const bytes = operation.readBytes(request.segments, request.maxBytes);
          return bytes === undefined
            ? { status: 'missing' }
            : { status: 'bytes', content: Buffer.from(bytes).toString('base64') };
        }
        if (request.op === 'list') {
          return { status: 'entries', entries: operation.listDirectory(request.segments) };
        }
        const kind = operation.inspectKind(request.segments);
        return kind === undefined ? { status: 'missing' } : { status: 'kind', kind };
      } catch (error) {
        return error instanceof StableFileAuthorityError && error.code === 'OVER_BUDGET'
          ? { status: 'over-budget' }
          : refuse(error instanceof StableFileAuthorityError && error.code === 'ROOT_CHANGED'
            ? 'root-changed' : 'operation-unavailable');
      } finally {
        operation?.close();
      }
    }
    if (request.op === 'release') {
      const pending = prepared.get(request.candidate);
      if (pending === undefined) return refuse('unknown-candidate');
      try {
        pending.reader.close();
      } catch {
        return refuse('cleanup-unconfirmed');
      }
      prepared.delete(request.candidate);
      return { status: 'released' };
    }
    if (request.op !== 'compare') return refuse('malformed');
    const left = prepared.get(request.left)?.reader;
    const right = prepared.get(request.right)?.reader;
    if (left === undefined || right === undefined) return refuse('unknown-candidate');
    try {
      assertSameStableRoot(left, right);
      return { status: 'same' };
    } catch (error) {
      return refuse(error instanceof StableFileAuthorityError && error.code === 'ROOT_CHANGED'
        ? 'different-root' : 'root-unavailable');
    }
  };
  let tail: Promise<unknown> = Promise.resolve();
  const dispatch = (frame: string): Promise<TResponse> => {
    const current = tail.then(() => handle(frame));
    tail = current.catch(() => undefined);
    return current;
  };

  const onConnection = (socket: Socket | IControlChannel) => {
    sockets.add(socket);
    socket.setTimeout(REQUEST_TIMEOUT_MS, () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    socket.on('data', (chunk: Buffer) => {
      if (done) return;
      length += chunk.length;
      if (length > MAX_REQUEST_FRAME_BYTES) {
        done = true;
        socket.end(frameResponse(refuse('frame-size')));
        return;
      }
      chunks.push(chunk);
      if (chunk.indexOf(10) < 0) return;
      const frame = Buffer.concat(chunks, length);
      const newline = frame.indexOf(10);
      done = true;
      if (newline !== frame.length - 1) {
        socket.end(frameResponse(refuse('malformed')));
        return;
      }
      void dispatch(frame.subarray(0, newline).toString('utf8')).then(
        (response) => socket.end(frameResponse(response)),
        () => socket.end(frameResponse(refuse('operation-unavailable'))),
      );
    });
    socket.on('error', () => socket.destroy());
  };
  const server: Server | WindowsControlPipeServer = process.platform === 'win32'
    ? new WindowsControlPipeServer(onConnection)
    : createServer(onConnection);
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
  const bound = process.platform === 'win32' ? undefined : lstatSync(endpoint);
  try {
    privateEndpoint(endpoint, true);
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    let cleanupConfirmed = process.platform === 'win32';
    try {
      const now = bound === undefined ? undefined : lstatSync(endpoint);
      if (now !== undefined && bound !== undefined && now.dev === bound.dev && now.ino === bound.ino) {
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
        await tail;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        for (const root of prepared.values()) root.reader.close();
        prepared.clear();
        for (const root of active.values()) root.reader.close();
        active.clear();
        for (const writer of writers.values()) writer.authority.close();
        writers.clear();
        if (bound !== undefined) {
          try {
            const now = lstatSync(endpoint);
            if (now.dev !== bound.dev || now.ino !== bound.ino) {
              throw new Error('Root broker endpoint cleanup is unconfirmed.');
            }
            unlinkSync(endpoint);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
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
    const chunks: Buffer[] = [];
    let length = 0;
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
      length += chunk.length;
      if (length > MAX_RESPONSE_FRAME_BYTES) return finish(new Error('Root broker response exceeded its bound.'));
      chunks.push(chunk);
      if (chunk.indexOf(10) < 0) return;
      const frame = Buffer.concat(chunks, length);
      const newline = frame.indexOf(10);
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

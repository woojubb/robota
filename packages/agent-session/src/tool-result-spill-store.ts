import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readdirSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { SEALED_ARTIFACT_MAX_OVERHEAD_BYTES } from '@robota-sdk/agent-core';
import {
  PROCESS_OWNER_RECORD_NAME,
  createProcessScopedDirectory,
  removeDirectoryOnProcessExit,
  sweepStaleProcessScopedDirectories,
} from '@robota-sdk/agent-core/node';

import { NodeExternalPayloadSource } from './session-log-sources.js';
import { sessionSealingOf } from './stored-session-record.js';

import type {
  IArtifactContext,
  IArtifactSealer,
  IToolResultSpillStore,
  TArtifactSealing,
} from '@robota-sdk/agent-core';

const REFERENCE = /^tool-result:([A-Za-z0-9_-]{22,64})$/u;
/**
 * The product-neutral name every spill directory starts with; one in a host's parent adds its owner's
 * pid before the random suffix.
 */
const TOOL_RESULT_SPILL_DIRECTORY_PREFIX = 'agent-tool-results-';
const DEFAULT_RETENTION_MS = 60 * 60 * 1000;
const MAX_SPILL_BYTES = 8 * 1024 * 1024;
const FILE_FLAGS =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0);

export type TToolResultSpillErrorCode =
  | 'invalid-options'
  | 'unsafe-root'
  | 'write-failed'
  | 'missing'
  | 'expired'
  | 'invalid-reference'
  | 'read-failed'
  | 'cleanup-failed'
  | 'closed';

export class ToolResultSpillError extends Error {
  constructor(readonly code: TToolResultSpillErrorCode) {
    super(`Tool result spill failed (${code})`);
    this.name = 'ToolResultSpillError';
  }
}

/**
 * Remove the spill directories under `parent` whose recorded owner can no longer be alive (a process
 * killed before `shutdown()` or its exit removal could run). Returns the names removed.
 */
export function sweepStaleToolResultSpillDirectories(parent: string): readonly string[] {
  return sweepStaleProcessScopedDirectories(parent, TOOL_RESULT_SPILL_DIRECTORY_PREFIX);
}

export interface INodeToolResultSpillStoreOptions {
  /**
   * Host-owned, owner-only parent that already exists; it is used as it is. Spilled results are
   * conversation content, so they never go to a directory the store picks: the store's directory in
   * the parent records its owner, is removed when the process ends without reaching `shutdown()`,
   * and is removed after a kill by {@link sweepStaleToolResultSpillDirectories}.
   */
  readonly parentDirectory: string;
  readonly retentionMs?: number;
  readonly now?: () => number;
  /** Receives a fixed, payload-free reason if an idle expiry timer cannot delete a file. */
  readonly onCleanupFailure?: (reason: 'cleanup-failed') => void;
  /**
   * Required. `{ sealer }` keeps every result sealed on disk, bound to its reference, as
   * `<token>.sealed`, and opens it with the same sealer to read it back; a result that does not open
   * reads as `read-failed`. `'plain'` writes each result as it is to `<token>.txt`.
   */
  readonly sealing: TArtifactSealing;
}

interface IStoredResult {
  readonly fileName: string;
  /** The random part of the reference: what a sealed result is bound to. */
  readonly token: string;
  readonly expiresAt: number;
}

/**
 * The raw bytes a sealed result may take: the plaintext budget and what any sealer adds to it, so a
 * result of exactly the largest size a spill takes still reads back once sealed.
 */
const MAX_SEALED_SPILL_BYTES = MAX_SPILL_BYTES + SEALED_ARTIFACT_MAX_OVERHEAD_BYTES;

function spillContext(token: string): IArtifactContext {
  return { kind: 'tool-result-spill', id: token };
}

/**
 * Node host implementation of core's opaque, session-lifetime spill port. A sealing store keeps the
 * last result it opened in memory, so paging through a large result opens it once.
 */
export class NodeToolResultSpillStore implements IToolResultSpillStore {
  private readonly directory: string;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly onCleanupFailure?: (reason: 'cleanup-failed') => void;
  private readonly sealer: IArtifactSealer | undefined;
  private readonly entries = new Map<string, IStoredResult>();
  /** The result a sealing store opened last; forgotten with its entry. */
  private opened?: { readonly reference: string; readonly content: string };
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private cancelExitRemoval?: () => void;
  private closed = false;

  constructor(options: INodeToolResultSpillStoreOptions) {
    // A caller that ignores the types gets the same refusal as one that passes a bad value.
    const parent = options?.parentDirectory;
    if (typeof parent !== 'string' || parent.length === 0) {
      throw new ToolResultSpillError('invalid-options');
    }
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? Date.now;
    this.onCleanupFailure = options.onCleanupFailure;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs <= 0) {
      throw new ToolResultSpillError('invalid-options');
    }
    let sealing: TArtifactSealing;
    try {
      sealing = sessionSealingOf(options);
    } catch {
      throw new ToolResultSpillError('invalid-options');
    }
    this.sealer = sealing === 'plain' ? undefined : sealing.sealer;
    try {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe parent');
      // The host's parent is used as it is; the directory made in it is owner-only and records its
      // owner before any result goes in.
      this.directory = createProcessScopedDirectory(parent, TOOL_RESULT_SPILL_DIRECTORY_PREFIX, {
        prepareParent: false,
      });
      this.assertRoot();
    } catch {
      throw new ToolResultSpillError('unsafe-root');
    }
    // `shutdown()` is the normal removal; a process that ends without reaching it (an exit, or a
    // signal nothing else handles) still leaves nothing, and one killed outright is swept at the next
    // start by its owner record.
    this.cancelExitRemoval = removeDirectoryOnProcessExit(this.directory);
  }

  private assertRoot(): void {
    try {
      const stat = lstatSync(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe directory');
      if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
        throw new Error('directory is not owner-only');
      }
    } catch {
      throw new ToolResultSpillError('unsafe-root');
    }
  }

  private scheduleExpiry(minimumDelayMs = 1): void {
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.closed || this.entries.size === 0) return;
    let firstExpiry = Number.POSITIVE_INFINITY;
    for (const entry of this.entries.values()) {
      if (entry.expiresAt < firstExpiry) firstExpiry = entry.expiresAt;
    }
    const delay = Math.min(2_147_483_647, Math.max(minimumDelayMs, firstExpiry - this.now()));
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined;
      void this.cleanupExpired().catch(() => {
        try {
          if (this.onCleanupFailure) this.onCleanupFailure('cleanup-failed');
          else process.emitWarning('Tool result spill expiry cleanup failed (cleanup-failed)');
        } catch {
          process.emitWarning('Tool result spill expiry cleanup failed (cleanup-failed)');
        }
        this.scheduleExpiry(60_000);
      });
    }, delay);
    this.expiryTimer.unref?.();
  }

  async write(content: string): Promise<{ readonly reference: string }> {
    if (this.closed) throw new ToolResultSpillError('closed');
    await this.cleanupExpired();
    this.assertRoot();
    if (Buffer.byteLength(content, 'utf8') > MAX_SPILL_BYTES) {
      throw new ToolResultSpillError('write-failed');
    }
    const token = randomBytes(18).toString('base64url');
    const tempName = `${randomBytes(18).toString('base64url')}.partial`;
    const fileName = `${token}${this.sealer === undefined ? '.txt' : '.sealed'}`;
    const tempPath = join(this.directory, tempName);
    const finalPath = join(this.directory, fileName);
    let data: string | Uint8Array;
    try {
      data = this.storedForm(content, token);
    } catch {
      throw new ToolResultSpillError('write-failed');
    }
    let fd: number | undefined;
    let linked = false;
    try {
      fd = openSync(tempPath, FILE_FLAGS, 0o600);
      writeFileSync(fd, data, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      linkSync(tempPath, finalPath);
      linked = true;
      unlinkSync(tempPath);
      const reference = `tool-result:${token}`;
      this.entries.set(reference, { fileName, token, expiresAt: this.now() + this.retentionMs });
      this.scheduleExpiry();
      return { reference };
    } catch {
      let cleanupFailed = false;
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          cleanupFailed = true;
        }
      }
      try {
        unlinkSync(tempPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') cleanupFailed = true;
      }
      if (linked) {
        try {
          unlinkSync(finalPath);
        } catch {
          cleanupFailed = true;
        }
      }
      throw new ToolResultSpillError(cleanupFailed ? 'cleanup-failed' : 'write-failed');
    }
  }

  async read(reference: string): Promise<string> {
    if (this.closed) throw new ToolResultSpillError('closed');
    if (!REFERENCE.test(reference)) throw new ToolResultSpillError('invalid-reference');
    const entry = this.entries.get(reference);
    if (!entry) throw new ToolResultSpillError('missing');
    if (this.now() >= entry.expiresAt) {
      this.removeEntry(reference, entry);
      this.scheduleExpiry();
      throw new ToolResultSpillError('expired');
    }
    if (this.opened?.reference === reference) return this.opened.content;
    this.assertRoot();
    try {
      // The raw stored bytes: this store opens a sealed result itself, bound to its token, so the
      // payload source only reads the file.
      const bytes = new NodeExternalPayloadSource(this.directory, { sealing: 'plain' }).readBytes(
        entry.fileName,
        this.sealer === undefined ? MAX_SPILL_BYTES : MAX_SEALED_SPILL_BYTES,
      );
      if (bytes === undefined) throw new ToolResultSpillError('missing');
      if (this.sealer === undefined) return Buffer.from(bytes).toString('utf8');
      const content = this.openStored(this.sealer, bytes, entry.token);
      this.opened = { reference, content };
      return content;
    } catch (error) {
      if (error instanceof ToolResultSpillError) throw error;
      throw new ToolResultSpillError('read-failed');
    }
  }

  /** What goes on disk for `content`: the text as it is, or sealed to the result's token. */
  private storedForm(content: string, token: string): string | Uint8Array {
    if (this.sealer === undefined) return content;
    const plain = Buffer.from(content, 'utf8');
    try {
      return this.sealer.sealBytes(plain, spillContext(token));
    } finally {
      plain.fill(0);
    }
  }

  /**
   * The text a sealed result holds, held to the plaintext budget exactly. Any failure to open it —
   * damaged, moved from another reference, sealed with other keys — is the caller's `read-failed`.
   */
  private openStored(sealer: IArtifactSealer, stored: Uint8Array, token: string): string {
    const plain = sealer.openBytes(stored, spillContext(token));
    try {
      if (plain.byteLength > MAX_SPILL_BYTES) throw new ToolResultSpillError('read-failed');
      return Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength).toString('utf8');
    } finally {
      plain.fill(0);
    }
  }

  /**
   * Removes a result. What a sealing store had open of it is forgotten first, so a removal that fails
   * does not keep it in memory; a file already gone counts as removed, or one result deleted from
   * outside would fail every later cleanup, and with it every write.
   */
  private removeEntry(reference: string, entry: IStoredResult): void {
    this.assertRoot();
    if (this.opened?.reference === reference) this.opened = undefined;
    try {
      unlinkSync(join(this.directory, entry.fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ToolResultSpillError('cleanup-failed');
      }
    }
    this.entries.delete(reference);
  }

  async cleanupExpired(): Promise<void> {
    if (this.closed) throw new ToolResultSpillError('closed');
    for (const [reference, entry] of this.entries) {
      if (this.now() >= entry.expiresAt) this.removeEntry(reference, entry);
    }
    this.scheduleExpiry();
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.opened = undefined;
    for (const [reference, entry] of this.entries) this.removeEntry(reference, entry);
    this.assertRoot();
    try {
      // The owner record goes last, so a directory a failed shutdown leaves can still be swept.
      const left = readdirSync(this.directory).filter((name) => name !== PROCESS_OWNER_RECORD_NAME);
      if (left.length !== 0) throw new Error('unexpected files');
      rmSync(join(this.directory, PROCESS_OWNER_RECORD_NAME), { force: true });
      rmdirSync(this.directory);
      this.closed = true;
      this.cancelExitRemoval?.();
    } catch {
      throw new ToolResultSpillError('cleanup-failed');
    }
  }
}

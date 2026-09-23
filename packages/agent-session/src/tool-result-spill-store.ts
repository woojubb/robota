import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeExternalPayloadSource } from './session-log-sources.js';

import type { IToolResultSpillStore } from '@robota-sdk/agent-core';

const REFERENCE = /^tool-result:([A-Za-z0-9_-]{22,64})$/u;
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

export interface INodeToolResultSpillStoreOptions {
  /** Host-owned parent; defaults to the operating-system temporary directory. */
  readonly parentDirectory?: string;
  readonly retentionMs?: number;
  readonly now?: () => number;
  /** Receives a fixed, payload-free reason if an idle expiry timer cannot delete a file. */
  readonly onCleanupFailure?: (reason: 'cleanup-failed') => void;
}

interface IStoredResult {
  readonly fileName: string;
  readonly expiresAt: number;
}

/** Node host implementation of core's opaque, session-lifetime spill port. */
export class NodeToolResultSpillStore implements IToolResultSpillStore {
  private readonly directory: string;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly onCleanupFailure?: (reason: 'cleanup-failed') => void;
  private readonly entries = new Map<string, IStoredResult>();
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(options: INodeToolResultSpillStoreOptions = {}) {
    const parent = options.parentDirectory ?? tmpdir();
    this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
    this.now = options.now ?? Date.now;
    this.onCleanupFailure = options.onCleanupFailure;
    if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs <= 0) {
      throw new ToolResultSpillError('invalid-options');
    }
    try {
      const stat = lstatSync(parent);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe parent');
      this.directory = mkdtempSync(join(parent, 'robota-tool-results-'));
      if (process.platform !== 'win32') chmodSync(this.directory, 0o700);
      this.assertRoot();
    } catch {
      throw new ToolResultSpillError('unsafe-root');
    }
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
    const fileName = `${token}.txt`;
    const tempPath = join(this.directory, tempName);
    const finalPath = join(this.directory, fileName);
    let fd: number | undefined;
    let linked = false;
    try {
      fd = openSync(tempPath, FILE_FLAGS, 0o600);
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      linkSync(tempPath, finalPath);
      linked = true;
      unlinkSync(tempPath);
      const reference = `tool-result:${token}`;
      this.entries.set(reference, { fileName, expiresAt: this.now() + this.retentionMs });
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
    this.assertRoot();
    try {
      const bytes = new NodeExternalPayloadSource(this.directory).readBytes(
        entry.fileName,
        MAX_SPILL_BYTES,
      );
      if (bytes === undefined) throw new ToolResultSpillError('missing');
      return Buffer.from(bytes).toString('utf8');
    } catch (error) {
      if (error instanceof ToolResultSpillError) throw error;
      throw new ToolResultSpillError('read-failed');
    }
  }

  private removeEntry(reference: string, entry: IStoredResult): void {
    this.assertRoot();
    try {
      unlinkSync(join(this.directory, entry.fileName));
      this.entries.delete(reference);
    } catch {
      throw new ToolResultSpillError('cleanup-failed');
    }
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
    for (const [reference, entry] of this.entries) this.removeEntry(reference, entry);
    this.assertRoot();
    try {
      if (readdirSync(this.directory).length !== 0) throw new Error('unexpected files');
      rmdirSync(this.directory);
      this.closed = true;
    } catch {
      throw new ToolResultSpillError('cleanup-failed');
    }
  }
}

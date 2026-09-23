/** Bounded stdio framing around the public SDK Client transport contract. */
import { spawn } from 'node:child_process';

import { DEFAULT_INHERITED_ENV_VARS } from '@modelcontextprotocol/sdk/client/stdio.js';
import { deserializeMessage, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';

import type { IMCPStdioSnapshot } from './stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

const MAX_STDERR_COUNT = 65_536;
const MAX_STDOUT_MESSAGE_BYTES = 8 * 1024 * 1024;

export class MCPStdioError extends Error {
  constructor(
    readonly reason:
      | 'authority'
      | 'start'
      | 'early-exit'
      | 'send'
      | 'cancelled'
      | 'cleanup'
      | 'receive-limit'
      | 'receive-invalid',
  ) {
    super(`Stdio transport ${reason}`);
    this.name = 'MCPStdioError';
  }
}

function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new MCPStdioError('cleanup')), ms);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        reject(new MCPStdioError('cleanup'));
      },
    );
  });
}

export class MCPStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: Transport['onmessage'];
  protocolVersion?: string;
  readonly sensitiveDiagnostics = true;
  private child?: ChildProcessWithoutNullStreams;
  private closePromise?: Promise<void>;
  private childClosed = false;
  private closeNotified = false;
  private started = false;
  private stderrBytes = 0;
  private stderrTruncated = false;
  private stdoutParts: Buffer[] = [];
  private stdoutBytes = 0;
  private resolveChildClose?: () => void;
  private readonly childClose = new Promise<void>((resolve) => {
    this.resolveChildClose = resolve;
  });

  constructor(
    private readonly snapshot: IMCPStdioSnapshot,
    private readonly revalidate: () => Promise<boolean>,
  ) {}

  get stderrSummary(): Readonly<{ bytes: number; truncated: boolean }> {
    return { bytes: this.stderrBytes, truncated: this.stderrTruncated };
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  get closedDirectChild(): boolean {
    return this.childClosed;
  }

  get stdioStartupMs(): number {
    return this.snapshot.startupMs;
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
  }

  private notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.onclose?.();
  }

  private receive(chunk: Buffer): void {
    if (this.closePromise !== undefined) return;
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const part = chunk.subarray(offset, end);
      if (this.stdoutBytes + part.length > MAX_STDOUT_MESSAGE_BYTES) {
        this.onerror?.(new MCPStdioError('receive-limit'));
        void this.close().catch(() => this.onerror?.(new MCPStdioError('cleanup')));
        return;
      }
      this.stdoutParts.push(part);
      this.stdoutBytes += part.length;
      if (newline >= 0) {
        const line = Buffer.concat(this.stdoutParts, this.stdoutBytes)
          .toString('utf8')
          .replace(/\r$/u, '');
        this.stdoutParts = [];
        this.stdoutBytes = 0;
        try {
          this.onmessage?.(deserializeMessage(line));
        } catch {
          this.onerror?.(new MCPStdioError('receive-invalid'));
          void this.close().catch(() => this.onerror?.(new MCPStdioError('cleanup')));
          return;
        }
      }
      offset = end + 1;
    }
  }

  async start(): Promise<void> {
    if (this.started || this.closePromise !== undefined) throw new MCPStdioError('start');
    this.started = true;
    if (!(await this.revalidate())) throw new MCPStdioError('authority');
    if (this.closePromise !== undefined) throw new MCPStdioError('start');
    const environment: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const key of DEFAULT_INHERITED_ENV_VARS) environment[key] = this.snapshot.env[key] ?? '';
    for (const [key, value] of Object.entries(this.snapshot.env)) environment[key] = value;
    try {
      const child = spawn(this.snapshot.command, [...this.snapshot.args], {
        cwd: this.snapshot.cwd,
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: process.platform === 'win32',
      });
      this.child = child;
      const spawned = new Promise<void>((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', () => reject(new MCPStdioError('start')));
      });
      child.on('error', () => this.onerror?.(new MCPStdioError('start')));
      child.on('close', () => {
        this.childClosed = true;
        this.child = undefined;
        this.resolveChildClose?.();
        this.notifyClose();
      });
      child.stdin.on('error', () => this.onerror?.(new MCPStdioError('send')));
      child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
      child.stdout.on('error', () => this.onerror?.(new MCPStdioError('receive-invalid')));
      child.stderr.on('data', (chunk: Buffer) => {
        this.stderrBytes = Math.min(MAX_STDERR_COUNT, this.stderrBytes + chunk.length);
        if (this.stderrBytes >= MAX_STDERR_COUNT) this.stderrTruncated = true;
      });
      await spawned;
      if (this.childClosed) throw new MCPStdioError('early-exit');
    } catch {
      await this.close();
      throw new MCPStdioError('start');
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const child = this.child;
    if (child === undefined || this.childClosed) throw new MCPStdioError('send');
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdin.write(serializeMessage(message), (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } catch {
      throw new MCPStdioError('send');
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closePromise = this.closeOwned();
    return this.closePromise;
  }

  private async closeOwned(): Promise<void> {
    const child = this.child;
    this.stdoutParts = [];
    this.stdoutBytes = 0;
    if (child === undefined) {
      this.notifyClose();
      return;
    }
    try {
      child.stdin.end();
      try {
        await bounded(this.childClose, 2_000);
      } catch {
        child.kill('SIGTERM');
        try {
          await bounded(this.childClose, 2_000);
        } catch {
          child.kill('SIGKILL');
          await bounded(this.childClose, this.snapshot.cleanupMs - 4_000);
        }
      }
    } catch {
      throw new MCPStdioError('cleanup');
    }
  }
}

/** Lifecycle wrapper for the public SDK stdio transport. No SDK private process access. */
import {
  DEFAULT_INHERITED_ENV_VARS,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';

import type { IMCPStdioSnapshot } from './stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

const MAX_STDERR_COUNT = 65_536;

export class MCPStdioError extends Error {
  constructor(
    readonly reason: 'authority' | 'start' | 'early-exit' | 'send' | 'cancelled' | 'cleanup',
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
  private sdk?: StdioClientTransport;
  private closePromise?: Promise<void>;
  private childClosed = false;
  private started = false;
  private stderrBytes = 0;
  private stderrTruncated = false;
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
    return this.sdk?.pid ?? null;
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

  async start(): Promise<void> {
    if (this.started || this.closePromise !== undefined) throw new MCPStdioError('start');
    // Reserve the single start synchronously. Two callers can otherwise both pass the guard while
    // the first awaits filesystem admission and each spawn a child, losing one SDK handle.
    this.started = true;
    if (!(await this.revalidate())) throw new MCPStdioError('authority');
    if (this.closePromise !== undefined) throw new MCPStdioError('start');
    const environment: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const key of DEFAULT_INHERITED_ENV_VARS) environment[key] = this.snapshot.env[key] ?? '';
    for (const [key, value] of Object.entries(this.snapshot.env)) environment[key] = value;
    const sdk = new StdioClientTransport({
      command: this.snapshot.command,
      args: [...this.snapshot.args],
      cwd: this.snapshot.cwd,
      env: environment,
      stderr: 'pipe',
    });
    this.sdk = sdk;
    sdk.onmessage = (message) => {
      this.onmessage?.(message);
    };
    sdk.onerror = () => {
      this.onerror?.(new MCPStdioError('start'));
    };
    sdk.onclose = () => {
      this.childClosed = true;
      this.resolveChildClose?.();
      this.onclose?.();
    };
    sdk.stderr?.on('data', (chunk: Buffer) => {
      this.stderrBytes = Math.min(MAX_STDERR_COUNT, this.stderrBytes + chunk.length);
      if (this.stderrBytes >= MAX_STDERR_COUNT) this.stderrTruncated = true;
    });
    try {
      await sdk.start();
      if (this.childClosed) throw new MCPStdioError('early-exit');
    } catch {
      await this.close();
      throw new MCPStdioError('start');
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.sdk === undefined || this.childClosed) throw new MCPStdioError('send');
    try {
      await this.sdk.send(message);
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
    const sdk = this.sdk;
    if (sdk === undefined) {
      this.onclose?.();
      return;
    }
    try {
      await bounded(sdk.close(), this.snapshot.cleanupMs);
      if (!this.childClosed) await bounded(this.childClose, this.snapshot.cleanupMs);
    } catch {
      throw new MCPStdioError('cleanup');
    }
  }
}

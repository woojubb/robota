import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { Worker } from 'node:worker_threads';
import { searchFile } from './grep-search.js';

type TMode = 'files_with_matches' | 'content' | 'count';
type TRequest = {
  id: number;
  content: string;
  filePath: string;
  pattern: string;
  contextLines: number;
  outputMode: TMode;
};
type TResponse = { id: number; matches?: string[]; error?: string };
interface IGrepWorker {
  on(event: 'message', listener: (message: TResponse) => void): this;
  on(event: 'error', listener: () => void): this;
  once(event: 'exit', listener: () => void): this;
  postMessage(request: TRequest): void;
  terminate(): Promise<unknown>;
}

const BOOTSTRAP = `
const { parentPort } = require('node:worker_threads');
const searchFile = ${searchFile.toString()};
parentPort.on('message', (request) => {
  try {
    const regex = new RegExp(request.pattern);
    const matches = searchFile(request.content, request.filePath, regex, request.contextLines, request.outputMode, 4 * 1024 * 1024);
    let bytes = 0;
    for (const match of matches) { bytes += Buffer.byteLength(match, 'utf8'); if (bytes > 4 * 1024 * 1024) throw new Error('byte limit'); }
    parentPort.postMessage({ id: request.id, matches });
  } catch (error) { parentPort.postMessage({ id: request.id, error: error?.message === 'byte limit' ? 'Grep search exceeded its byte limit' : 'Invalid grep regex execution' }); }
});
`;

// Bun cannot use Node's eval Worker consistently; keep the same pure operation in a child process.
class GrepProcessWorker extends EventEmitter implements IGrepWorker {
  private readonly child = spawn(
    process.execPath,
    [
      '-e',
      `
const searchFile = ${searchFile.toString()};
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  try {
    const regex = new RegExp(request.pattern);
    const matches = searchFile(request.content, request.filePath, regex, request.contextLines, request.outputMode, 4 * 1024 * 1024);
    let bytes = 0;
    for (const match of matches) { bytes += Buffer.byteLength(match, 'utf8'); if (bytes > 4 * 1024 * 1024) throw new Error('byte limit'); }
    process.stdout.write(JSON.stringify({ id: request.id, matches }) + String.fromCharCode(10));
  } catch (error) { process.stdout.write(JSON.stringify({ id: request.id, error: error?.message === 'byte limit' ? 'Grep search exceeded its byte limit' : 'Invalid grep regex execution' }) + String.fromCharCode(10)); }
});
`,
    ],
    {
      env: {
        BUN_BE_BUN: '1',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      cwd: tmpdir(),
      stdio: 'pipe',
    },
  );
  private readonly closed: Promise<void>;
  public constructor() {
    super();
    let pending = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      if (Buffer.byteLength(pending, 'utf8') > 24 * 1024 * 1024 + 1024) {
        this.emit('error');
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          this.emit('message', JSON.parse(line));
        } catch {
          this.emit('error');
        }
      }
    });
    this.child.stderr.resume();
    this.child.on('error', () => this.emit('error'));
    this.child.stdin.on('error', () => this.emit('error'));
    this.closed = new Promise<void>((resolve) => {
      this.child.once('close', () => {
        this.emit('exit');
        resolve();
      });
    });
  }
  public postMessage(request: TRequest): void {
    this.child.stdin.write(JSON.stringify(request) + '\n');
  }
  public async terminate(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
    await this.closed;
  }
}

/** One worker per grep invocation; a deadline or abort terminates it before the failure is exposed. */
export class IsolatedGrepSearch {
  private readonly worker: IGrepWorker = process.versions.bun
    ? new GrepProcessWorker()
    : new Worker(BOOTSTRAP, {
        eval: true,
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      });
  private readonly pending = new Map<
    number,
    { resolve: (matches: string[]) => void; reject: (error: Error) => void }
  >();
  private nextId = 0;
  private stopped = false;
  private termination?: Promise<void>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = (): void => {
    void this.stop(new Error('Grep search cancelled'));
  };
  public constructor(
    private readonly pattern: string,
    private readonly signal?: AbortSignal,
  ) {
    this.worker.on('message', (message) => {
      const pending = this.pending.get(message.id);
      if (!pending || this.stopped) return;
      this.pending.delete(message.id);
      if (Array.isArray(message.matches) && message.matches.every((m) => typeof m === 'string'))
        pending.resolve(message.matches);
      else pending.reject(new Error(message.error ?? 'Invalid grep worker response'));
    });
    this.worker.on('error', () => {
      void this.stop(new Error('Grep search worker failed'));
    });
    this.worker.once('exit', () => {
      void this.stop(new Error('Grep search worker exited'));
    });
    this.timer = setTimeout(() => {
      void this.stop(new Error('Grep search timed out'));
    }, 2000);
    signal?.addEventListener('abort', this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  public search(
    content: string,
    filePath: string,
    contextLines: number,
    outputMode: TMode,
  ): Promise<string[]> {
    if (this.stopped)
      return Promise.reject(
        new Error(this.signal?.aborted ? 'Grep search cancelled' : 'Grep search timed out'),
      );
    const id = this.nextId++;
    return new Promise<string[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({
          id,
          content,
          filePath,
          pattern: this.pattern,
          contextLines,
          outputMode,
        });
      } catch {
        void this.stop(new Error('Grep search worker failed'));
      }
    });
  }
  public async stop(error?: Error): Promise<void> {
    if (this.termination) return this.termination;
    this.stopped = true;
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.abort);
    this.termination = (async () => {
      try {
        await this.worker.terminate();
      } catch {
        /* process is already exiting */
      }
      for (const pending of this.pending.values())
        pending.reject(error ?? new Error('Grep search stopped'));
      this.pending.clear();
    })();
    return this.termination;
  }
}

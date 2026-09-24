import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import type { IRegexReplaceRequest } from '@robota-sdk/dag-core';
import { boundedRegexReplace } from './bounded-regex-replace.js';

const MAX_BYTES = 4 * 1024 * 1024;
// JSON escaping can expand each admitted byte up to six ASCII bytes.
const MAX_WIRE_BYTES = MAX_BYTES * 6 + 1024;
const BOOTSTRAP = `
const boundedRegexReplace = ${boundedRegexReplace.toString()};
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input, 'utf8') > ${MAX_WIRE_BYTES}) process.exit(2);
});
process.stdin.on('end', () => {
  const request = JSON.parse(input);
  send({ type: 'entered' });
  try {
    send(boundedRegexReplace(request, request.maxOutputBytes));
  } catch { send({ type: 'invalid-regex' }); }
});
send({ type: 'ready' });
`;

/** Keeps Bun's pure operation in a separate process using its own embedded runtime. */
export class RegexProcessWorker extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly closed: Promise<number>;
  private finished = false;

  public constructor() {
    super();
    // BUN_BE_BUN is Bun's documented standalone-executable CLI mode. No disk sidecar,
    // external runtime, product entry, inherited preload options or workflow source is needed.
    this.child = spawn(process.execPath, ['-e', BOOTSTRAP], {
      env: {
        BUN_BE_BUN: '1',
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      },
      cwd: tmpdir(),
      stdio: 'pipe',
    });
    let pending = '';
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      if (Buffer.byteLength(pending, 'utf8') > MAX_WIRE_BYTES) {
        this.emit('error', new Error('Regex process response exceeds its transport limit'));
        return;
      }
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          this.emit('message', JSON.parse(line));
        } catch {
          this.emit('error', new Error('Invalid regex process response'));
        }
      }
    });
    this.child.stderr.resume();
    this.child.stdin.on('error', (error) => this.emit('error', error));
    this.child.once('error', (error) => this.emit('error', error));
    this.closed = new Promise<number>((resolve) => {
      this.child.once('close', (code) => {
        this.finished = true;
        const exitCode = code ?? 1;
        resolve(exitCode);
        this.emit('exit', exitCode);
      });
    });
  }

  public postMessage(request: IRegexReplaceRequest & { maxOutputBytes: number }): void {
    this.child.stdin.end(JSON.stringify(request));
  }

  public async terminate(): Promise<number> {
    if (
      !this.finished &&
      this.child.pid !== undefined &&
      this.child.exitCode === null &&
      this.child.signalCode === null &&
      !this.child.kill('SIGKILL')
    )
      throw new Error('Could not terminate regex process');
    return this.closed;
  }
}

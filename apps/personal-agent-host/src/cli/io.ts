import { createInterface } from 'node:readline';

import { HostError } from '../errors.js';

export interface ICliIo {
  stdin: NodeJS.ReadableStream & {
    isTTY?: boolean;
    setRawMode?(mode: boolean): unknown;
  };
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  /** Where `serve` listens for SIGTERM and SIGINT; the process itself unless a test supplies one. */
  signals?: Pick<NodeJS.EventEmitter, 'once'>;
}

export function processIo(): ICliIo {
  return { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr };
}

/** Everything piped in, minus the one trailing newline a shell adds. */
export async function readAll(io: ICliIo): Promise<string> {
  io.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of io.stdin) text += String(chunk);
  return text.replace(/\r?\n$/u, '');
}

/** Reads a secret from a terminal without echoing it. The prompt goes to stderr, never stdout. */
export function readHidden(io: ICliIo, prompt: string): Promise<string> {
  const { stdin } = io;
  io.stderr.write(prompt);
  return new Promise<string>((resolve, reject) => {
    let typed = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode?.(false);
      stdin.pause();
      io.stderr.write('\n');
    };
    const onData = (chunk: Buffer | string): void => {
      for (const ch of String(chunk)) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') {
          finish();
          resolve(typed);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new HostError('bad-request', 'Aborted'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

/** Reads one visible line from a terminal, for answers that are meant to be seen as typed. */
export function readLine(io: ICliIo, prompt: string): Promise<string> {
  const rl = createInterface({ input: io.stdin, output: io.stderr as NodeJS.WritableStream });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

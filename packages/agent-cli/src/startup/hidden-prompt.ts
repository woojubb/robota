/**
 * Reading one secret line without echoing it: raw mode on a terminal, the first line of stdin
 * otherwise (so a secret can be piped in rather than typed into a command line or a file).
 */

const DEFAULT_MAX_LENGTH = 4096;

/** The line typed or piped was longer than the prompt accepts. */
export class HiddenPromptTooLongError extends Error {
  constructor() {
    super('The value is too long.');
    this.name = 'HiddenPromptTooLongError';
  }
}

export interface IHiddenPromptOptions {
  readonly maxLength?: number;
  /** Stops reading; the prompt rejects as cancelled. */
  readonly signal?: AbortSignal;
}
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = new Set(['\u007f', '\b']);

export interface IHiddenPromptStreams {
  readonly input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (raw: boolean) => void };
  readonly output: NodeJS.WritableStream;
}

export function promptHiddenLine(
  prompt: string,
  streams: IHiddenPromptStreams = { input: process.stdin, output: process.stderr },
  options: IHiddenPromptOptions = {},
): Promise<string> {
  const { input, output } = streams;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const raw = input.isTTY === true && typeof input.setRawMode === 'function';
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const onAbort = (): void => finish(new Error('Cancelled.'));
    const finish = (error?: Error): void => {
      options.signal?.removeEventListener('abort', onAbort);
      input.removeListener('data', onData);
      input.removeListener('end', onEnd);
      if (raw) input.setRawMode?.(false);
      input.pause();
      if (raw) output.write('\n');
      if (error === undefined) resolve(value);
      else reject(error);
    };
    const onEnd = (): void => finish();
    const onData = (chunk: Buffer | string): void => {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n' || (raw && char === CTRL_D)) return finish();
        if (raw && char === CTRL_C) return finish(new Error('Cancelled.'));
        if (raw && BACKSPACE.has(char)) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
        if (value.length > maxLength) return finish(new HiddenPromptTooLongError());
      }
    };
    if (options.signal?.aborted === true) return finish(new Error('Cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (raw) input.setRawMode?.(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

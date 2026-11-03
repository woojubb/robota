/**
 * Reading one secret line without echoing it: raw mode on a terminal, the first line of stdin
 * otherwise (so a secret can be piped in rather than typed into a command line or a file).
 */
import { SecretInputCancelled, SecretLineReader } from '../devices/secret-terminal.js';

const DEFAULT_MAX_LENGTH = 4096;

/** The prompt was cancelled: Ctrl-C at the terminal, or the signal aborted. */
export class HiddenPromptCancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'HiddenPromptCancelledError';
  }
}

/** The prompt would have had to read the secret from something other than a terminal, and does not. */
export class HiddenPromptTerminalRequiredError extends Error {
  constructor() {
    super('This needs an interactive terminal.');
    this.name = 'HiddenPromptTerminalRequiredError';
  }
}

/** The line typed or piped was longer than the prompt accepts. */
export class HiddenPromptTooLongError extends Error {
  constructor() {
    super('The value is too long.');
    this.name = 'HiddenPromptTooLongError';
  }
}

export interface IHiddenPromptOptions {
  readonly maxLength?: number;
  /**
   * Refuse, before writing the prompt or touching the input, unless the input is a terminal in raw
   * mode's reach. Without it a piped input is read, which lets a secret arrive from a pipe; a
   * passphrase must be typed at a terminal. The line is then read the way the controlling-terminal
   * path reads it, so a keyring passphrase typed here derives the same key as on macOS or Linux.
   */
  readonly requireTty?: boolean;
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
  if (options.requireTty === true) {
    if (!raw) return Promise.reject(new HiddenPromptTerminalRequiredError());
    return readTerminalLine(prompt, streams, maxLength, options.signal);
  }
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    const onAbort = (): void => finish(new HiddenPromptCancelledError());
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
        if (raw && char === CTRL_C) return finish(new HiddenPromptCancelledError());
        if (raw && BACKSPACE.has(char)) {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
        if (value.length > maxLength) return finish(new HiddenPromptTooLongError());
      }
    };
    if (options.signal?.aborted === true) return finish(new HiddenPromptCancelledError());
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (raw) input.setRawMode?.(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

/**
 * One line through the secret terminal's own reader: escape sequences and control characters are
 * dropped, ctrl-C and ctrl-D cancel, and a character split across two reads is joined.
 */
async function readTerminalLine(
  prompt: string,
  { input, output }: IHiddenPromptStreams,
  maxLength: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  const reader = new SecretLineReader({ write: (text) => output.write(text) });
  output.write(prompt);
  input.setRawMode?.(true);
  input.on('data', reader.onData);
  input.resume();
  try {
    const line = await reader.read(false, signal);
    if (line.length > maxLength) throw new HiddenPromptTooLongError();
    return line;
  } catch (error) {
    throw error instanceof SecretInputCancelled ? new HiddenPromptCancelledError() : error;
  } finally {
    input.removeListener('data', reader.onData);
    reader.discard();
    input.setRawMode?.(false);
    input.pause();
  }
}

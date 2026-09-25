/**
 * The dedicated terminal path for secrets: the recovery phrase is shown and read here and nowhere
 * else.
 *
 * It opens the controlling terminal (`/dev/tty`) as streams of its own and never reads the
 * session's stdin. That is the point, not a detail: the session's stdin has readers of its own
 * (the TUI's input proxy keeps a permanent listener that buffers every byte for the prompt
 * composer), so a byte read through it would be delivered to the composer — and from there to prompt
 * history, the conversation and the model — once the session takes the terminal back. The session's
 * stdin stays paused throughout, and if something is reading it the path does not open at all.
 *
 * It runs while the session has handed the terminal over, on the alternate screen, so what it shows
 * is not left in the main screen's scrollback; after a secret is shown the screen and scrollback are
 * wiped. Input is read in raw mode and echoes nothing unless a prompt asks for echo. Without an
 * interactive controlling terminal it does not open — there is no fallback to a pipe or a file.
 */
import { closeSync, openSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import { ReadStream, WriteStream, isatty } from 'node:tty';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J';
const CLEAR_SCROLLBACK = '\x1b[3J';
const CURSOR_HOME = '\x1b[H';
const BLANK = `${CLEAR_SCREEN}${CURSOR_HOME}`;
/** Also drops scrollback, for a terminal that kept the shown secret there despite the alternate screen. */
const WIPE = `${CLEAR_SCREEN}${CLEAR_SCROLLBACK}${CURSOR_HOME}`;

const CTRL_C = '\x03';
const CTRL_D = '\x04';
const CTRL_U = '\x15';
const BACKSPACE = '\x7f';
const CTRL_H = '\b';
const ESCAPE = '\x1b';

/** The operator cancelled at the terminal. */
export class SecretInputCancelled extends Error {
  constructor() {
    super('cancelled at the terminal');
    this.name = 'SecretInputCancelled';
  }
}

export interface ISecretTerminal {
  /** Write text as is. Lines end with `\r\n`: raw mode does no newline translation. */
  write(text: string): void;
  /** Wipe the screen and its scrollback — what was shown is gone from the terminal. */
  clearScreen(): void;
  /** Read one line. Nothing typed is echoed unless `echo` is true. Rejects on ctrl-C / ctrl-D. */
  readLine(prompt: string, options?: { readonly echo?: boolean }): Promise<string>;
}

export interface ISecretTerminalSession {
  /** Take the terminal, run `work`, and always give it back blank. */
  run<T>(work: (terminal: ISecretTerminal) => Promise<T>): Promise<T>;
}

/** The input side of the controlling terminal. */
export interface ISecretTerminalInput {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(mode: boolean): unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  off(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  resume(): unknown;
  pause(): unknown;
  isPaused(): boolean;
}

/** The output side of the controlling terminal. */
export interface ISecretTerminalOutput {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

/** The controlling terminal, opened for this path alone. */
export interface ISecretTerminalTty {
  readonly input: ISecretTerminalInput;
  readonly output: ISecretTerminalOutput;
  /** Release what was opened. */
  close(): void;
}

export interface ISecretTerminalOptions {
  /** The session's stdin. Only inspected — this path never reads, resumes or re-modes it. */
  readonly sessionInput?: { readonly readableFlowing?: boolean | null };
  /** Opens the controlling terminal; defaults to `/dev/tty`. */
  readonly openTty?: () => ISecretTerminalTty | undefined;
}

interface IPendingRead {
  readonly echo: boolean;
  readonly resolve: (line: string) => void;
  readonly reject: (error: Error) => void;
  buffer: string;
}

type TEscapeState = 'none' | 'escape' | 'sequence';

/** Turns raw key bytes into lines; keeps what was typed ahead for the next read. */
class LineReader {
  private pending: IPendingRead | undefined;
  private queue = '';
  private escape: TEscapeState = 'none';
  private cancelled = false;
  // A multi-byte character split across two chunks is joined, not mangled.
  private readonly decoder = new StringDecoder('utf8');

  constructor(private readonly output: ISecretTerminalOutput) {}

  readonly onData = (chunk: Buffer | string): void => {
    this.queue += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.drain();
  };

  read(echo: boolean): Promise<string> {
    if (this.cancelled) return Promise.reject(new SecretInputCancelled());
    return new Promise<string>((resolve, reject) => {
      this.pending = { echo, resolve, reject, buffer: '' };
      this.drain();
    });
  }

  /** Forget anything typed ahead, so a secret never outlives the session in memory we hold. */
  discard(): void {
    this.queue = '';
    this.decoder.end();
    if (this.pending !== undefined) this.pending.buffer = '';
  }

  private drain(): void {
    while (this.pending !== undefined && this.queue.length > 0) {
      const [ch] = this.queue;
      if (ch === undefined) return;
      this.queue = this.queue.slice(ch.length);
      this.accept(this.pending, ch);
    }
  }

  /** Whether `ch` belongs to an escape sequence and is dropped. Line ends and ctrl-C never do. */
  private inEscape(ch: string): boolean {
    if (ch === '\r' || ch === '\n' || ch === CTRL_C || ch === CTRL_D) {
      this.escape = 'none';
      return false;
    }
    if (this.escape === 'escape') {
      // CSI (`ESC [`) and SS3 (`ESC O`) continue; anything else was an Alt+key, which ends here.
      this.escape = ch === '[' || ch === 'O' ? 'sequence' : 'none';
      return true;
    }
    if (this.escape === 'sequence') {
      // A sequence ends on a final byte in 0x40–0x7e.
      if (ch >= '@' && ch <= '~') this.escape = 'none';
      return true;
    }
    if (ch === ESCAPE) {
      this.escape = 'escape';
      return true;
    }
    return false;
  }

  private accept(read: IPendingRead, ch: string): void {
    if (this.inEscape(ch)) return;
    if (ch === '\r' || ch === '\n') {
      // A CRLF pair is one line end.
      if (ch === '\r' && this.queue.startsWith('\n')) this.queue = this.queue.slice(1);
      this.pending = undefined;
      this.output.write('\r\n');
      const line = read.buffer;
      read.buffer = '';
      read.resolve(line);
      return;
    }
    if (ch === CTRL_C || ch === CTRL_D) {
      this.cancelled = true;
      this.pending = undefined;
      read.buffer = '';
      this.queue = '';
      this.output.write('\r\n');
      read.reject(new SecretInputCancelled());
      return;
    }
    if (ch === BACKSPACE || ch === CTRL_H) {
      if (read.buffer.length === 0) return;
      const chars = Array.from(read.buffer);
      chars.pop();
      read.buffer = chars.join('');
      if (read.echo) this.output.write('\b \b');
      return;
    }
    if (ch === CTRL_U) {
      if (read.echo) this.output.write('\b \b'.repeat(Array.from(read.buffer).length));
      read.buffer = '';
      return;
    }
    if (ch < ' ') return;
    read.buffer += ch;
    if (read.echo) this.output.write(ch);
  }
}

function isInteractive(tty: ISecretTerminalTty): boolean {
  return (
    tty.input.isTTY === true &&
    tty.output.isTTY === true &&
    typeof tty.input.setRawMode === 'function'
  );
}

/** `/dev/tty` as a fresh read and write stream, or `undefined` when there is no controlling terminal. */
function openControllingTty(): ISecretTerminalTty | undefined {
  if (process.platform === 'win32') return undefined;
  const fds: number[] = [];
  try {
    fds.push(openSync('/dev/tty', 'r'));
    fds.push(openSync('/dev/tty', 'w'));
  } catch {
    // allow-fallback: no controlling terminal — the caller refuses; nothing else is tried.
    for (const fd of fds) closeSync(fd);
    return undefined;
  }
  const [inFd, outFd] = fds as [number, number];
  if (!isatty(inFd) || !isatty(outFd)) {
    closeSync(inFd);
    closeSync(outFd);
    return undefined;
  }
  const input = new ReadStream(inFd);
  const output = new WriteStream(outFd);
  return {
    input,
    output,
    close: () => {
      input.destroy();
      output.destroy();
    },
  };
}

/**
 * The secret terminal, or `undefined` when there is no interactive controlling terminal (headless,
 * piped, CI) or the session's stdin is being read — the caller refuses rather than reading a secret
 * from anywhere else, or from a stream another reader shares.
 */
export function openSecretTerminal(
  options: ISecretTerminalOptions = {},
): ISecretTerminalSession | undefined {
  const sessionInput = options.sessionInput ?? process.stdin;
  const openTty = options.openTty ?? openControllingTty;
  const sessionIsReading = (): boolean => sessionInput.readableFlowing === true;
  if (sessionIsReading()) return undefined;
  const probe = openTty();
  if (probe === undefined) return undefined;
  const interactive = isInteractive(probe);
  probe.close();
  if (!interactive) return undefined;

  return {
    async run<T>(work: (terminal: ISecretTerminal) => Promise<T>): Promise<T> {
      const tty = sessionIsReading() ? undefined : openTty();
      if (tty === undefined || !isInteractive(tty)) {
        tty?.close();
        throw new Error('the controlling terminal is no longer available');
      }
      const { input, output } = tty;
      const wasRaw = input.isRaw === true;
      const wasPaused = input.isPaused();
      const reader = new LineReader(output);
      const terminal: ISecretTerminal = {
        write: (text) => {
          output.write(text);
        },
        clearScreen: () => {
          output.write(WIPE);
        },
        readLine: (prompt, readOptions) => {
          output.write(prompt);
          return reader.read(readOptions?.echo === true);
        },
      };
      try {
        output.write(`${ENTER_ALT_SCREEN}${BLANK}`);
        input.setRawMode?.(true);
        input.on('data', reader.onData);
        input.resume();
        return await work(terminal);
      } finally {
        input.off('data', reader.onData);
        reader.discard();
        input.setRawMode?.(wasRaw);
        if (wasPaused) input.pause();
        output.write(`${BLANK}${LEAVE_ALT_SCREEN}`);
        tty.close();
      }
    },
  };
}

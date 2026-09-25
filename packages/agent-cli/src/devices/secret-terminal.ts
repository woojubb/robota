/**
 * The dedicated terminal path for secrets: the recovery phrase is shown and read here and nowhere
 * else.
 *
 * It talks to the process's own TTY directly, never through the session: nothing typed or shown
 * here passes the prompt input, prompt history, conversation, transcript, trace or telemetry. It
 * runs while the session has handed the terminal over, on the alternate screen, so what it shows is
 * not left in the main screen's scrollback; the screen and its scrollback are cleared before it
 * leaves. Input is read in raw mode and echoes nothing unless a prompt asks for echo. Without an
 * interactive input and output it does not open at all — there is no fallback to a pipe or a file.
 */

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J';
const CLEAR_SCROLLBACK = '\x1b[3J';
const CURSOR_HOME = '\x1b[H';
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
  /** Clear the screen and its scrollback — what was shown is gone from the terminal. */
  clearScreen(): void;
  /** Read one line. Nothing typed is echoed unless `echo` is true. Rejects on ctrl-C / ctrl-D. */
  readLine(prompt: string, options?: { readonly echo?: boolean }): Promise<string>;
}

export interface ISecretTerminalSession {
  /** Take the terminal, run `work`, and always give it back cleared. */
  run<T>(work: (terminal: ISecretTerminal) => Promise<T>): Promise<T>;
}

/** The slice of `process.stdin` this path uses. */
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

/** The slice of `process.stdout` this path uses. */
export interface ISecretTerminalOutput {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface ISecretTerminalIo {
  readonly input: ISecretTerminalInput;
  readonly output: ISecretTerminalOutput;
}

interface IPendingRead {
  readonly echo: boolean;
  readonly resolve: (line: string) => void;
  readonly reject: (error: Error) => void;
  buffer: string;
}

/** Turns raw key bytes into lines; keeps what was typed ahead for the next read. */
class LineReader {
  private pending: IPendingRead | undefined;
  private queue = '';
  private inEscape = false;
  private cancelled = false;

  constructor(private readonly output: ISecretTerminalOutput) {}

  readonly onData = (chunk: Buffer | string): void => {
    this.queue += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
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

  private accept(read: IPendingRead, ch: string): void {
    if (this.inEscape) {
      // CSI / SS3 sequences (arrows, function keys) end on a byte in 0x40–0x7e.
      if (ch !== '[' && ch !== 'O' && ch >= '@' && ch <= '~') this.inEscape = false;
      return;
    }
    if (ch === ESCAPE) {
      this.inEscape = true;
      return;
    }
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

function isInteractive(io: ISecretTerminalIo): boolean {
  return (
    io.input.isTTY === true &&
    io.output.isTTY === true &&
    typeof io.input.setRawMode === 'function'
  );
}

/**
 * The secret terminal over the process TTY, or `undefined` when there is no interactive terminal
 * (headless, piped, CI) — the caller refuses rather than reading a secret from anywhere else.
 */
export function openSecretTerminal(
  io: ISecretTerminalIo = { input: process.stdin, output: process.stdout },
): ISecretTerminalSession | undefined {
  if (!isInteractive(io)) return undefined;
  const { input, output } = io;
  return {
    async run<T>(work: (terminal: ISecretTerminal) => Promise<T>): Promise<T> {
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
        readLine: (prompt, options) => {
          output.write(prompt);
          return reader.read(options?.echo === true);
        },
      };
      output.write(`${ENTER_ALT_SCREEN}${WIPE}`);
      input.setRawMode?.(true);
      input.on('data', reader.onData);
      input.resume();
      try {
        return await work(terminal);
      } finally {
        input.off('data', reader.onData);
        reader.discard();
        input.setRawMode?.(wasRaw);
        if (wasPaused) input.pause();
        output.write(`${WIPE}${LEAVE_ALT_SCREEN}`);
      }
    },
  };
}

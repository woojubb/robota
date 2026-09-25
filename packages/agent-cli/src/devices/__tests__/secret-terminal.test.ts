import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  SecretInputCancelled,
  openSecretTerminal as openWith,
  type ISecretTerminalInput,
  type ISecretTerminalOutput,
  type ISecretTerminalSession,
} from '../secret-terminal.js';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCROLLBACK = '\x1b[3J';

class FakeInput extends EventEmitter implements ISecretTerminalInput {
  isTTY = true;
  isRaw = false;
  paused = true;
  rawHistory: boolean[] = [];

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    this.rawHistory.push(mode);
    return this;
  }
  resume(): this {
    this.paused = false;
    return this;
  }
  pause(): this {
    this.paused = true;
    return this;
  }
  isPaused(): boolean {
    return this.paused;
  }
  type(text: string): void {
    this.emit('data', Buffer.from(text, 'utf8'));
  }
}

class FakeOutput implements ISecretTerminalOutput {
  isTTY = true;
  written = '';
  write(chunk: string): boolean {
    this.written += chunk;
    return true;
  }
}

function io(): { input: FakeInput; output: FakeOutput } {
  return { input: new FakeInput(), output: new FakeOutput() };
}

/**
 * The session's own stdin, as the TUI leaves it during a handoff: paused, with the input proxy's
 * listener still attached. The secret terminal must never make it deliver a byte.
 */
class SessionStdin extends EventEmitter {
  readableFlowing: boolean | null = false;
  received: string[] = [];
  resumed = 0;
  constructor() {
    super();
    this.on('data', (chunk: Buffer) => this.received.push(chunk.toString('utf8')));
  }
  resume(): this {
    this.resumed += 1;
    return this;
  }
}

let sessionStdin = new SessionStdin();

/** The secret terminal over a fake controlling terminal, beside a fake session stdin. */
function openSecretTerminal(tty: {
  input: ISecretTerminalInput;
  output: ISecretTerminalOutput;
}): ISecretTerminalSession | undefined {
  sessionStdin = new SessionStdin();
  return openWith({ sessionInput: sessionStdin, openTty: () => ({ ...tty, close: () => {} }) });
}

/** Let the reader attach before typing. */
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('secret terminal', () => {
  it('is unavailable without an interactive input and output', () => {
    const a = io();
    a.input.isTTY = false;
    expect(openSecretTerminal(a)).toBeUndefined();
    const b = io();
    b.output.isTTY = false;
    expect(openSecretTerminal(b)).toBeUndefined();
    const c = io();
    Object.defineProperty(c.input, 'setRawMode', { value: undefined });
    expect(openSecretTerminal(c)).toBeUndefined();
    expect(openWith({ sessionInput: new SessionStdin(), openTty: () => undefined })).toBeUndefined();
  });

  it('refuses while something is reading the session stdin', () => {
    const reading = new SessionStdin();
    reading.readableFlowing = true;
    const tty = io();
    expect(
      openWith({ sessionInput: reading, openTty: () => ({ ...tty, close: () => {} }) }),
    ).toBeUndefined();
  });

  it("reads its own terminal: the session stdin and its listeners never receive a byte", async () => {
    const { input, output } = io();
    const closed: number[] = [];
    let opened = 0;
    const session = openWith({
      sessionInput: (sessionStdin = new SessionStdin()),
      openTty: () => {
        opened += 1;
        return { input, output, close: () => closed.push(opened) };
      },
    });
    const value = await session!.run(async (terminal) => {
      const pending = terminal.readLine('Word 1 of 24: ');
      await tick();
      input.type('abandon\r');
      return pending;
    });
    expect(value).toBe('abandon');
    expect(sessionStdin.received).toEqual([]);
    expect(sessionStdin.resumed).toBe(0);
    expect(sessionStdin.readableFlowing).toBe(false);
    // Probed once at open, opened again for the run; each is closed.
    expect(closed).toEqual([1, 2]);
  });

  it('reads with no echo in raw mode, on the alternate screen, and clears it afterwards', async () => {
    const { input, output } = io();
    const session = openSecretTerminal({ input, output });
    const read = session!.run(async (terminal) => {
      expect(input.isRaw).toBe(true);
      const pending = terminal.readLine('Secret: ');
      await tick();
      input.type('hunter2');
      input.type('\r');
      return pending;
    });
    await expect(read).resolves.toBe('hunter2');
    expect(output.written).not.toContain('hunter2');
    expect(output.written.startsWith(ENTER_ALT_SCREEN)).toBe(true);
    expect(output.written.endsWith(LEAVE_ALT_SCREEN)).toBe(true);
    // Nothing was shown, so the operator's scrollback is left alone.
    expect(output.written).not.toContain(CLEAR_SCROLLBACK);
    expect(input.isRaw).toBe(false);
    expect(input.paused).toBe(true);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('clears the screen region it wrote after the secret is shown', async () => {
    const { input, output } = io();
    await openSecretTerminal({ input, output })!.run(async (terminal) => {
      terminal.write('alpha bravo');
      terminal.clearScreen();
      const afterShow = output.written.lastIndexOf('alpha bravo');
      expect(output.written.indexOf(CLEAR_SCROLLBACK, afterShow)).toBeGreaterThan(afterShow);
    });
  });

  it('echoes only when asked, and edits with backspace and ctrl-U', async () => {
    const { input, output } = io();
    const values = await openSecretTerminal({ input, output })!.run(async (terminal) => {
      const first = terminal.readLine('Visible: ', { echo: true });
      await tick();
      input.type('abX\x7fc\r');
      const second = terminal.readLine('Hidden: ');
      await tick();
      input.type('zzz\x15ok\r');
      return [await first, await second];
    });
    expect(values).toEqual(['abc', 'ok']);
    expect(output.written).toContain('ab');
    expect(output.written).not.toContain('zzz');
  });

  it('keeps pasted input that runs past one line for the next read, and drops escape sequences', async () => {
    const { input, output } = io();
    const values = await openSecretTerminal({ input, output })!.run(async (terminal) => {
      const first = terminal.readLine('1: ');
      await tick();
      input.type('one\x1b[Ax\rtwo\r');
      return [await first, await terminal.readLine('2: ')];
    });
    expect(values).toEqual(['onex', 'two']);
  });

  it('ends an Alt+key at once, and ctrl-C and Enter are never swallowed by an escape', async () => {
    const { input, output } = io();
    const first = await openSecretTerminal({ input, output })!.run(async (terminal) => {
      const pending = terminal.readLine('1: ');
      await tick();
      input.type('\x1bbok\r');
      return pending;
    });
    expect(first).toBe('ok');
    const second = io();
    const run = openSecretTerminal(second)!.run(async (terminal) => {
      const pending = terminal.readLine('2: ');
      await tick();
      second.input.type('\x1b[1;\x03');
      return pending;
    });
    await expect(run).rejects.toBeInstanceOf(SecretInputCancelled);
  });

  it('joins a multi-byte character split across chunks', async () => {
    const { input, output } = io();
    const value = await openSecretTerminal({ input, output })!.run(async (terminal) => {
      const pending = terminal.readLine('Passphrase: ');
      await tick();
      const bytes = Buffer.from('é', 'utf8');
      input.emit('data', bytes.subarray(0, 1));
      input.emit('data', bytes.subarray(1));
      input.type('\r');
      return pending;
    });
    expect(value).toBe('é');
  });

  it('cancels on ctrl-C and still restores the terminal', async () => {
    const { input, output } = io();
    const run = openSecretTerminal({ input, output })!.run(async (terminal) => {
      const pending = terminal.readLine('Secret: ');
      await tick();
      input.type('abc\x03');
      return pending;
    });
    await expect(run).rejects.toBeInstanceOf(SecretInputCancelled);
    expect(input.isRaw).toBe(false);
    expect(output.written.endsWith(LEAVE_ALT_SCREEN)).toBe(true);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('restores the terminal when the work throws', async () => {
    const { input, output } = io();
    input.isRaw = true;
    input.paused = false;
    await expect(
      openSecretTerminal({ input, output })!.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(input.isRaw).toBe(true);
    expect(input.paused).toBe(false);
    expect(output.written.endsWith(LEAVE_ALT_SCREEN)).toBe(true);
  });
});

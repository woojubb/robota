import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { SecretInputCancelled, openSecretTerminal } from '../../devices/secret-terminal.js';
import { openSecureTerminal, type IConsoleStreams } from '../secure-terminal.js';

type TInput = PassThrough & { isTTY?: boolean; setRawMode?: (raw: boolean) => void };

function consoleStreams(options: {
  inputIsTty: boolean;
  outputIsTty: boolean;
  pipedText?: string;
}): {
  streams: IConsoleStreams;
  input: TInput;
  written: () => string;
} {
  const input: TInput = new PassThrough();
  if (options.inputIsTty) {
    input.isTTY = true;
    input.setRawMode = () => undefined;
  }
  if (options.pipedText !== undefined) input.end(options.pipedText);
  const output = new PassThrough() as PassThrough & { isTTY?: boolean };
  output.isTTY = options.outputIsTty;
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return { streams: { input, output }, input, written: () => chunks.join('') };
}

describe('openSecureTerminal on the Windows console', () => {
  it('offers nothing when stdin is piped, and never reads the pipe', () => {
    const { streams, input } = consoleStreams({
      inputIsTty: false,
      outputIsTty: true,
      pipedText: 'hunter2hunter2\n',
    });
    expect(openSecureTerminal({ platform: 'win32', console: streams })).toBeUndefined();
    expect(input.listenerCount('data')).toBe(0);
    expect(input.read()?.toString()).toBe('hunter2hunter2\n');
  });

  it('offers nothing when the output is not a terminal', () => {
    const { streams } = consoleStreams({ inputIsTty: true, outputIsTty: false });
    expect(openSecureTerminal({ platform: 'win32', console: streams })).toBeUndefined();
  });

  it('reads a line without echoing it and shows only the prompt', async () => {
    const { streams, input, written } = consoleStreams({ inputIsTty: true, outputIsTty: true });
    const session = openSecureTerminal({ platform: 'win32', console: streams });
    expect(session).toBeDefined();

    const typed = session!.run(async (terminal) => {
      const reading = terminal.readLine('Passphrase: ');
      input.write('a long typed passphrase\r');
      return reading;
    });

    await expect(typed).resolves.toBe('a long typed passphrase');
    expect(written()).toContain('Passphrase: ');
    expect(written()).not.toContain('a long typed passphrase');
  });

  it('reports ctrl-C as the same cancellation the terminal path uses', async () => {
    const { streams, input } = consoleStreams({ inputIsTty: true, outputIsTty: true });
    const session = openSecureTerminal({ platform: 'win32', console: streams });

    const result = session!.run(async (terminal) => {
      const reading = terminal.readLine('Passphrase: ');
      input.write('abc\u0003');
      return reading;
    });
    await expect(result).rejects.toBeInstanceOf(SecretInputCancelled);
  });

  it('clears the screen and scrollback on request', async () => {
    const { streams, written } = consoleStreams({ inputIsTty: true, outputIsTty: true });
    const session = openSecureTerminal({ platform: 'win32', console: streams });
    await session!.run(async (terminal) => {
      terminal.write('the recovery key\r\n');
      terminal.clearScreen();
    });
    expect(written().endsWith('the recovery key\r\n\u001b[2J\u001b[3J\u001b[H')).toBe(true);
  });
});

describe('the same keystrokes give the same secret on every platform', () => {
  // Arrow keys (CSI and SS3), Alt+x, a bracketed-paste marker, tab and bell, a character split across
  // two reads, a typo erased with backspace and a line killed with ctrl-U: everything a person's
  // fingers or terminal can add that is not the passphrase.
  const keystrokes: Buffer[] = [
    Buffer.from('junk\x15pa\x1b[Ds\x1bOAs\x1bx\tw\x07', 'utf8'),
    Buffer.from('ö', 'utf8').subarray(0, 1),
    Buffer.concat([
      Buffer.from('ö', 'utf8').subarray(1),
      Buffer.from('rdX\x7f\x1b[200~\r', 'utf8'),
    ]),
  ];
  const expected = 'passwörd';

  async function readOnControllingTerminal(): Promise<string> {
    const input = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(mode: boolean) {
        input.isRaw = mode;
      },
    });
    const output = { isTTY: true, write: () => true };
    const session = openSecretTerminal({
      sessionInput: { readableFlowing: null },
      openTty: () => ({ input, output, close: () => undefined }),
    });
    return session!.run(async (terminal) => {
      const reading = terminal.readLine('Passphrase: ');
      for (const chunk of keystrokes) input.write(chunk);
      return reading;
    });
  }

  async function readOnWindowsConsole(): Promise<string> {
    const { streams, input } = consoleStreams({ inputIsTty: true, outputIsTty: true });
    const session = openSecureTerminal({ platform: 'win32', console: streams });
    return session!.run(async (terminal) => {
      const reading = terminal.readLine('Passphrase: ');
      for (const chunk of keystrokes) input.write(chunk);
      return reading;
    });
  }

  it('reads one keystroke stream as the same line on the controlling terminal and the Windows console', async () => {
    const posix = await readOnControllingTerminal();
    const windows = await readOnWindowsConsole();
    expect(posix).toBe(expected);
    expect(windows).toBe(posix);
  });

  it('treats ctrl-D as a cancellation on the Windows console too, not as Enter', async () => {
    const { streams, input } = consoleStreams({ inputIsTty: true, outputIsTty: true });
    const session = openSecureTerminal({ platform: 'win32', console: streams });
    const result = session!.run(async (terminal) => {
      const reading = terminal.readLine('Passphrase: ');
      input.write('half a passphrase\u0004');
      return reading;
    });
    await expect(result).rejects.toBeInstanceOf(SecretInputCancelled);
  });
});

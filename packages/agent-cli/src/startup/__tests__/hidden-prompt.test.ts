import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import {
  HiddenPromptCancelledError,
  HiddenPromptTerminalRequiredError,
  promptHiddenLine,
} from '../hidden-prompt.js';

type TInput = PassThrough & { isTTY?: boolean; setRawMode?: (raw: boolean) => void };

function pipedInput(text: string): TInput {
  const input: TInput = new PassThrough();
  input.end(text);
  return input;
}

function terminalInput(): { input: TInput; rawModes: boolean[] } {
  const input: TInput = new PassThrough();
  const rawModes: boolean[] = [];
  input.isTTY = true;
  input.setRawMode = (raw) => {
    rawModes.push(raw);
  };
  return { input, rawModes };
}

function capturedOutput(): { output: PassThrough; text: () => string } {
  const output = new PassThrough();
  const chunks: string[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
  return { output, text: () => chunks.join('') };
}

describe('promptHiddenLine', () => {
  it('reads the first line of a piped input by default, so a script can feed a client secret', async () => {
    const { output } = capturedOutput();
    await expect(
      promptHiddenLine('Client secret: ', { input: pipedInput('s3cret\nignored\n'), output }),
    ).resolves.toBe('s3cret');
  });

  describe('requireTty', () => {
    it('refuses a piped input before writing the prompt or reading a byte', async () => {
      const input = pipedInput('hunter2hunter2\n');
      const resume = vi.spyOn(input, 'resume');
      const { output, text } = capturedOutput();

      await expect(
        promptHiddenLine('Passphrase: ', { input, output }, { requireTty: true }),
      ).rejects.toBeInstanceOf(HiddenPromptTerminalRequiredError);

      expect(text()).toBe('');
      expect(resume).not.toHaveBeenCalled();
      expect(input.listenerCount('data')).toBe(0);
      expect(input.read()?.toString()).toBe('hunter2hunter2\n');
    });

    it('reads from a terminal in raw mode without echoing what is typed', async () => {
      const { input, rawModes } = terminalInput();
      const { output, text } = capturedOutput();
      const reading = promptHiddenLine('Passphrase: ', { input, output }, { requireTty: true });

      input.write('wrong');
      input.write('\u007f\u007f\u007f\u007f\u007f');
      input.write('right passphrase\r');

      await expect(reading).resolves.toBe('right passphrase');
      expect(rawModes).toEqual([true, false]);
      expect(text()).toBe('Passphrase: \r\n');
    });

    it('rejects a ctrl-C as a cancellation', async () => {
      const { input } = terminalInput();
      const { output } = capturedOutput();
      const reading = promptHiddenLine('Passphrase: ', { input, output }, { requireTty: true });
      input.write('abc\u0003');
      await expect(reading).rejects.toBeInstanceOf(HiddenPromptCancelledError);
      await expect(reading).rejects.toThrow('Cancelled.');
    });
  });

  it('rejects an aborted signal as a cancellation', async () => {
    const { input } = terminalInput();
    const { output } = capturedOutput();
    const controller = new AbortController();
    const reading = promptHiddenLine('x: ', { input, output }, { signal: controller.signal });
    controller.abort();
    await expect(reading).rejects.toBeInstanceOf(HiddenPromptCancelledError);
  });
});

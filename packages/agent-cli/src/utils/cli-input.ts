import type { TPromptInput } from '@robota-sdk/agent-command';

const PRINTABLE_ASCII_START = 32;

export const promptInput: TPromptInput = (label: string, masked = false): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    process.stdout.write(label);
    let input = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Cannot prompt for input: stdin is not a TTY.\n' +
            'Set your API key via environment variable instead:\n' +
            '  ANTHROPIC_API_KEY=<key> robota\n' +
            '  OPENAI_API_KEY=<key> robota',
        ),
      );
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (data: string): void => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(input.trim());
          return;
        } else if (ch === '\x7f' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch === '\x03') {
          stdin.removeListener('data', onData);
          stdin.setRawMode(wasRaw ?? false);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(0);
        } else if (ch.charCodeAt(0) >= PRINTABLE_ASCII_START) {
          input += ch;
          process.stdout.write(masked ? '*' : ch);
        }
      }
    };
    stdin.on('data', onData);
  });

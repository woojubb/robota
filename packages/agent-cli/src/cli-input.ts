import type { IUserInteraction } from '@robota-sdk/agent-core';

const PRINTABLE_ASCII_START = 32;

export const promptInput = (
  label: string,
  masked = false,
  options: { readonly signal?: AbortSignal } = {},
): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException('Input cancelled.', 'AbortError'));
      return;
    }
    process.stdout.write(label);
    let input = '';
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (!stdin.isTTY) {
      reject(
        new Error(
          'Cannot prompt for input: stdin is not a TTY.\n' +
            'Set your API key via environment variable instead:\n' +
            '  ANTHROPIC_API_KEY=<key>\n' +
            '  OPENAI_API_KEY=<key>',
        ),
      );
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let finished = false;
    const cleanup = (): void => {
      finished = true;
      stdin.removeListener('data', onData);
      options.signal?.removeEventListener('abort', onAbort);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      process.stdout.write('\n');
    };
    const onAbort = (): void => {
      if (finished) return;
      cleanup();
      input = '';
      reject(new DOMException('Input cancelled.', 'AbortError'));
    };
    const onData = (data: string): void => {
      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          resolve(input.trim());
          return;
        } else if (ch === '\x7f' || ch === '\b') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch === '\x03') {
          if (options.signal !== undefined) {
            onAbort();
            return;
          }
          cleanup();
          process.exit(0);
        } else if (ch.charCodeAt(0) >= PRINTABLE_ASCII_START) {
          input += ch;
          process.stdout.write(masked ? '*' : ch);
        }
      }
    };
    stdin.on('data', onData);
    options.signal?.addEventListener('abort', onAbort, { once: true });
  });

/** Startup setup uses the same neutral action contract as an interactive App session. */
export function createStartupProviderInteraction(
  read: typeof promptInput = promptInput,
): IUserInteraction {
  return {
    async ask(request, options) {
      const signal = options?.signal ?? new AbortController().signal;
      const choices = request.options ?? [];
      const label = [
        `\n  ${request.title}`,
        request.description,
        ...choices.map((choice, index) => `    ${index + 1}. ${choice.label}`),
        choices.length > 0 ? `  Choose [1-${choices.length}] (Ctrl+C to cancel): ` : '  ',
      ]
        .filter((part): part is string => part !== undefined)
        .join('\n');
      try {
        const value = await read(label, request.masked === true, { signal });
        if (signal.aborted) return { type: 'cancelled' };
        if (request.allowFreeText === true) return { type: 'answer', values: [], text: value };
        const selected =
          value.trim().length === 0
            ? request.default?.values?.[0]
            : (choices[Number(value) - 1]?.value ??
              choices.find((choice) => choice.value === value)?.value);
        return selected === undefined
          ? { type: 'cancelled' }
          : { type: 'answer', values: [selected] };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return { type: 'cancelled' };
        throw error;
      }
    },
  };
}

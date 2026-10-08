import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStartupProviderInteraction, promptInput } from '../cli-input.js';

function terminal() {
  const input = Object.assign(new EventEmitter(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(function (this: { isRaw: boolean }, value: boolean) {
      this.isRaw = value;
    }),
    resume: vi.fn(),
    pause: vi.fn(),
    setEncoding: vi.fn(),
  });
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  return { input, output, exit };
}

const settled = async (promise: Promise<string>) =>
  Promise.race([
    promise.then(
      () => 'resolved',
      (error: unknown) => (error as Error).name,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve('still-waiting'), 20)),
  ]);

afterEach(() => vi.restoreAllMocks());

describe('cancellable startup credential input', () => {
  it('withdraws caller-aborted input and restores the terminal', async () => {
    const { input, exit } = terminal();
    const cancel = new AbortController();
    const pending = promptInput('Key: ', true, { signal: cancel.signal });
    input.emit('data', 'synthetic-sensitive-input');
    cancel.abort();
    expect(await settled(pending)).toBe('AbortError');
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
    expect(input.pause).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
  });

  it('treats Ctrl+C during auth input as cancellation without exiting before host cleanup', async () => {
    const { input, exit } = terminal();
    const pending = promptInput('Cancel connection: ', false, {
      signal: new AbortController().signal,
    });
    input.emit('data', '\x03');
    expect(await settled(pending)).toBe('AbortError');
    expect(exit).not.toHaveBeenCalled();
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('does not enter raw mode for an already aborted prompt', async () => {
    const { input } = terminal();
    const cancel = new AbortController();
    cancel.abort();
    expect(await settled(promptInput('Key: ', true, { signal: cancel.signal }))).toBe('AbortError');
    expect(input.setRawMode).not.toHaveBeenCalled();
  });

  it('keeps ordinary input and masked echo behavior', async () => {
    const { input, output } = terminal();
    const pending = promptInput('Key: ', true);
    input.emit('data', 'synthetic-key\r');
    expect(await pending).toBe('synthetic-key');
    expect(output.mock.calls.map(([value]) => String(value)).join('')).not.toContain(
      'synthetic-key',
    );
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('lets Ctrl+C cancel the first authentication method prompt without exiting', async () => {
    const { input, exit } = terminal();
    const pending = createStartupProviderInteraction().ask({
      id: 'method',
      title: 'Connect',
      options: [
        { value: 'api-key', label: 'API key' },
        { value: 'browser', label: 'Browser' },
      ],
    });
    input.emit('data', '\x03');
    const result = await Promise.race([
      pending,
      new Promise<string>((resolve) => setTimeout(() => resolve('still-waiting'), 20)),
    ]);
    expect(result).toEqual({ type: 'cancelled' });
    expect(exit).not.toHaveBeenCalled();
    expect(input.isRaw).toBe(false);
  });
});

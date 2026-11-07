/**
 * #3679 3f: while the terminal is handed over, what reaches stdin belongs to whoever has the terminal
 * — a child the person started, or the passphrase prompt — never to the composer.
 *
 * The prompt on Windows reads the console through `process.stdin`, the same stream the composer's
 * proxy listens to; a byte the proxy forwarded there would be delivered to the composer, and from it
 * to prompt history and the model, once the TUI took the terminal back.
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FocusReportingStdin } from '../attention/focus-input-filter.js';
import { TerminalHandoffController } from '../terminal-handoff-controller.js';
import { createTerminalModeHooks } from '../terminal-mode-hooks.js';
import { createFocusReportingWriter } from '../terminal-focus-reporting.js';

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
}

const origStdin = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const origStdout = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
afterEach(() => {
  if (origStdin) Object.defineProperty(process.stdin, 'isTTY', origStdin);
  if (origStdout) Object.defineProperty(process.stdout, 'isTTY', origStdout);
});

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function proxyOver(source: FakeStdin): { proxy: FocusReportingStdin; forwarded: () => string } {
  const proxy = new FocusReportingStdin(source, {
    negotiated: () => false,
    onFocusIn: () => undefined,
    onFocusOut: () => undefined,
    onKeystroke: () => undefined,
  });
  const chunks: Buffer[] = [];
  proxy.on('data', (chunk: Buffer) => chunks.push(chunk));
  return { proxy, forwarded: () => Buffer.concat(chunks).toString() };
}

describe('the composer while the terminal is handed over', () => {
  it('a held proxy forwards nothing, and forwards again once released', async () => {
    const source = new FakeStdin();
    const { proxy, forwarded } = proxyOver(source);

    proxy.hold();
    source.emit('data', Buffer.from('typed while held'));
    proxy.release();
    source.emit('data', Buffer.from('x'));
    await settle();

    expect(forwarded()).toBe('x');
  });

  it('gets nothing a prompt reading the same stdin is typed during the handover', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const source = new FakeStdin();
    const { proxy, forwarded } = proxyOver(source);
    const focus = createFocusReportingWriter({ supported: () => false, write: () => undefined });
    const controller = new TerminalHandoffController();
    controller.registerSuspendHooks({ suspend: async () => undefined, resume: () => undefined });
    controller.setTerminalModeHooks(
      createTerminalModeHooks({ focusReporting: focus, stdin: proxy }),
    );

    let prompted = '';
    await controller.runWithTerminal(async () => {
      // The console prompt's own reader, on the stream the proxy also listens to.
      const read = (chunk: Buffer): void => {
        prompted += chunk.toString();
      };
      source.on('data', read);
      source.emit('data', Buffer.from('correct horse battery staple\r'));
      source.off('data', read);
    });
    source.emit('data', Buffer.from('after'));
    await settle();

    expect(prompted).toBe('correct horse battery staple\r');
    expect(forwarded()).toBe('after');
  });

  it('keeps the focus-reporting bracket and the parked output drain around a handover', async () => {
    const order: string[] = [];
    const source = new FakeStdin();
    const { proxy } = proxyOver(source);
    const hooks = createTerminalModeHooks({
      focusReporting: {
        enable: () => void order.push('focus on'),
        disable: () => void order.push('focus off'),
      },
      parked: { drain: async () => void order.push('drained') },
      stdin: proxy,
    });

    await hooks.preSuspend();
    hooks.postResume();

    expect(order).toEqual(['focus off', 'drained', 'focus on']);
  });
});

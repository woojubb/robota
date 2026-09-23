import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { filterFocusSequences, FocusReportingStdin } from '../focus-input-filter.js';
import { createFocusReportingWriter } from '../../terminal-focus-reporting.js';

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
}

function collect(stream: FocusReportingStdin): Buffer[] {
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  return chunks;
}

describe('focus input filter (SCREEN-1992 TC-06)', () => {
  it('strips CSI I / CSI O only while negotiated and forwards everything else byte-identical', () => {
    const negotiated = filterFocusSequences(Buffer.from('a\x1b[Ob\x1b[Ic'), true);
    expect(negotiated.forwarded.toString()).toBe('abc');
    expect(negotiated).toMatchObject({ focusIn: 1, focusOut: 1 });

    const passthrough = filterFocusSequences(Buffer.from('a\x1b[Ob'), false);
    expect(passthrough.forwarded.toString()).toBe('a\x1b[Ob');
    expect(passthrough).toMatchObject({ focusIn: 0, focusOut: 0 });

    // A split escape sequence and a bracketed paste are Ink's to parse — untouched.
    expect(filterFocusSequences(Buffer.from('\x1b['), true).forwarded.toString()).toBe('\x1b[');
    expect(filterFocusSequences(Buffer.from('A'), true).forwarded.toString()).toBe('A');
    const paste = '\x1b[200~pasted \x1b[I text\x1b[201~';
    expect(filterFocusSequences(Buffer.from(paste), false).forwarded.toString()).toBe(paste);
    const utf8 = Buffer.from('한글\x1b[O😀');
    expect(filterFocusSequences(utf8, true).forwarded.toString()).toBe('한글😀');
  });

  it('proxies stdin: reports focus and keystrokes, forwards isTTY/setRawMode/ref/unref', async () => {
    const source = new FakeStdin();
    const hooks = {
      negotiated: () => true,
      onFocusIn: vi.fn(),
      onFocusOut: vi.fn(),
      onKeystroke: vi.fn(),
    };
    const proxy = new FocusReportingStdin(source, hooks);
    const chunks = collect(proxy);
    source.emit('data', Buffer.from('\x1b[O'));
    source.emit('data', Buffer.from('x\x1b[I'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(hooks.onFocusOut).toHaveBeenCalledTimes(1);
    expect(hooks.onFocusIn).toHaveBeenCalledTimes(1);
    expect(hooks.onKeystroke).toHaveBeenCalledTimes(1);
    expect(Buffer.concat(chunks).toString()).toBe('x');

    expect(proxy.isTTY).toBe(true);
    proxy.setRawMode(true);
    proxy.ref();
    proxy.unref();
    expect(source.setRawMode).toHaveBeenCalledWith(true);
    expect(source.ref).toHaveBeenCalledTimes(1);
    expect(source.unref).toHaveBeenCalledTimes(1);

    proxy.detach();
    source.emit('data', Buffer.from('y'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(Buffer.concat(chunks).toString()).toBe('x');
  });

  it('writes DECSET 1004 only when the gate allows, and DECRST once on disable', () => {
    const written: string[] = [];
    let supported = false;
    const writer = createFocusReportingWriter({
      supported: () => supported,
      write: (text) => written.push(text),
    });
    writer.enable();
    expect(writer.negotiated).toBe(false);
    expect(written).toEqual([]);
    supported = true;
    writer.enable();
    writer.enable();
    expect(writer.negotiated).toBe(true);
    expect(written).toEqual(['\x1b[?1004h']);
    writer.disable();
    writer.disable();
    expect(writer.negotiated).toBe(false);
    expect(written).toEqual(['\x1b[?1004h', '\x1b[?1004l']);
  });
});

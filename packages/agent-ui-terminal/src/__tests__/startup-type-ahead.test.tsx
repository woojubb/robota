/**
 * Keys typed while the app starts are not lost.
 *
 * Ink reads its stdin from the first commit and hands each key to whoever listens at that moment,
 * while the composer attaches its listeners in a later commit. A key read in between reached
 * nobody. The stdin proxy defers keys until the app signals that its start has settled, and the
 * signal comes from an effect that runs after the composer's own, so the keys land on the composer.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { render, useInput } from 'ink';
import React, { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FocusReportingStdin } from '../attention/focus-input-filter.js';
import { InputReadinessProvider, useSignalInputReady } from '../input-readiness-context.js';

import type { Instance } from 'ink';

class FakeStdin extends EventEmitter {
  isTTY = true;
  setRawMode = vi.fn();
  ref = vi.fn();
  unref = vi.fn();
}

/** Stands in for the composer: it attaches its key listener, then says the app can take keys. */
function Composer({ onKey }: { onKey: (key: string) => void }): null {
  useInput((input) => onKey(input));
  const signalReady = useSignalInputReady();
  useEffect(() => {
    signalReady();
  }, [signalReady]);
  return null;
}

/** Keeps Ink reading stdin the whole time, as the app-level key bindings do, and mounts the composer late. */
function App({
  onKey,
  mountAfterMs,
}: {
  onKey: (key: string) => void;
  mountAfterMs: number;
}): React.ReactElement | null {
  useInput(() => undefined);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), mountAfterMs);
    return () => clearTimeout(timer);
  }, [mountAfterMs]);
  return mounted ? <Composer onKey={onKey} /> : null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('keys typed while the app starts', () => {
  let instance: Instance | undefined;

  afterEach(() => {
    instance?.unmount();
    instance?.cleanup();
    instance = undefined;
  });

  it('reach the composer that mounts after they were typed, in the order they were typed', async () => {
    const source = new FakeStdin();
    const proxy = new FocusReportingStdin(source, {
      negotiated: () => false,
      onFocusIn: () => undefined,
      onFocusOut: () => undefined,
      onKeystroke: () => undefined,
    });
    proxy.deferInput();
    const received: string[] = [];
    const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 24, isTTY: false });
    instance = render(
      <InputReadinessProvider onReady={() => proxy.openInput()}>
        <App onKey={(key) => received.push(key)} mountAfterMs={60} />
      </InputReadinessProvider>,
      {
        stdin: proxy.asInkStdin(),
        stdout: stdout as unknown as NodeJS.WriteStream,
        debug: true,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );

    await wait(20);
    source.emit('data', Buffer.from('/'));
    await wait(10);
    source.emit('data', Buffer.from('e'));
    await vi.waitFor(() => expect(received).toEqual(['/', 'e']), { timeout: 2_000 });

    source.emit('data', Buffer.from('x'));
    await vi.waitFor(() => expect(received).toEqual(['/', 'e', 'x']), { timeout: 2_000 });
  });
});

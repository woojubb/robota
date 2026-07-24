import { render } from 'ink-testing-library';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import CjkTextInput from '../CjkTextInput.js';

/**
 * CLI-061 — integration proof that the CjkTextInput defer-submit includes a trailing IME character whose stdin
 * event arrives JUST AFTER Enter. This exercises the real handler + stateRef + defer wiring (not the pure
 * reducer, which by construction only sees the value captured at Enter and would be accidental-green).
 *
 * Real timers + a real wait > IME_SUBMIT_DEFER_MS so the deferred submit actually fires (fake timers conflict
 * with Ink's own render scheduling).
 */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const waitDefer = (): Promise<void> => new Promise((r) => setTimeout(r, 90)); // > 50ms defer

function Harness({ onSubmit }: { onSubmit: (value: string) => void }): React.ReactElement {
  const [value, setValue] = useState('');
  return <CjkTextInput value={value} onChange={setValue} onSubmit={onSubmit} focus />;
}

describe('CLI-061 — CjkTextInput defer-submit (integration)', () => {
  it('includes a trailing syllable that arrives after Enter (안녕하세 + Enter + 요 → 안녕하세요)', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);
    await tick();

    stdin.write('안녕하세'); // composed so far
    await tick();
    stdin.write('\r'); // Enter — schedules the deferred submit, does NOT submit synchronously
    await tick();
    expect(onSubmit).not.toHaveBeenCalled(); // deferred, not immediate

    stdin.write('요'); // the final syllable's stdin event lands after Enter; the pipeline is still live
    await tick();

    await waitDefer(); // the defer window elapses → the deferred submit fires, re-reading the LATEST value
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('안녕하세요');
  }, 10_000);

  it('a second Enter within the window does not double-submit', async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(<Harness onSubmit={onSubmit} />);
    await tick();

    stdin.write('hi');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('\r'); // second Enter within the defer window
    await tick();

    await waitDefer();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('hi');
  }, 10_000);
});

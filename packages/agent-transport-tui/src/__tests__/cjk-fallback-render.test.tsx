/**
 * CLI-062 — fallback-path pinning guard.
 *
 * When real-cursor positioning is NOT active (capability off — the default in this test process:
 * stdout is not a TTY and ROBOTA_IME_CURSOR is unset), CjkTextInput's rendering must stay
 * byte-identical to the pre-CLI-062 behavior (invariant I4: guard fail → today's visuals, drawn
 * inverse cursor included). The expected strings below are literal captures of the component's
 * output BEFORE the CLI-062 change (chalk.level forced to 3 so the inverse-cursor bytes are pinned,
 * not stripped). If this test breaks, the `<Box ref>` wrapper or the drawn-cursor gating changed
 * the fallback rendering — that is a regression, not a snapshot to refresh.
 */

import chalk from 'chalk';
import { render } from 'ink-testing-library';
import React from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import CjkTextInput from '../CjkTextInput.js';

const noop = (): void => {};
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

const ORIGINAL_CHALK_LEVEL = chalk.level;

describe('CLI-062 — fallback rendering is byte-identical to pre-change output', () => {
  beforeAll(() => {
    chalk.level = 3;
  });
  afterAll(() => {
    chalk.level = ORIGINAL_CHALK_LEVEL;
  });

  it('sanity: capability is off in this test process (fallback path is the one being pinned)', () => {
    expect(process.env['ROBOTA_IME_CURSOR']).toBeUndefined();
    expect(Boolean(process.stdout.isTTY)).toBe(false);
  });

  it('ASCII value with drawn end-of-line cursor', async () => {
    const { lastFrame, unmount } = render(<CjkTextInput value="hello" onChange={noop} />);
    await tick();
    expect(lastFrame()).toBe('hello\u001b[7m \u001b[27m');
    unmount();
  });

  it('CJK value with drawn end-of-line cursor', async () => {
    const { lastFrame, unmount } = render(<CjkTextInput value="안녕하세요" onChange={noop} />);
    await tick();
    expect(lastFrame()).toBe('안녕하세요\u001b[7m \u001b[27m');
    unmount();
  });

  it('empty value renders placeholder with inverse first character', async () => {
    const { lastFrame, unmount } = render(
      <CjkTextInput value="" onChange={noop} placeholder="Type a message or /help" />,
    );
    await tick();
    expect(lastFrame()).toBe('\u001b[7mT\u001b[27m\u001b[90mype a message or /help\u001b[39m');
    unmount();
  });

  it('unfocused input renders plain text without a drawn cursor', async () => {
    const { lastFrame, unmount } = render(
      <CjkTextInput value="hello" onChange={noop} focus={false} />,
    );
    await tick();
    expect(lastFrame()).toBe('hello');
    unmount();
  });

  it('long value wraps identically (the <Box ref> wrapper must not change layout)', async () => {
    const { lastFrame, unmount } = render(
      <CjkTextInput value={'a'.repeat(150) + '안녕'} onChange={noop} availableWidth={58} />,
    );
    await tick();
    expect(lastFrame()).toBe('a'.repeat(100) + '\n' + 'a'.repeat(50) + '안녕\u001b[7m \u001b[27m');
    unmount();
  });
});

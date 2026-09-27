// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyToClipboard } from '../clipboard.js';

/**
 * #3289 §2 — the async Clipboard API first, and (for a page that denies it) an `execCommand('copy')`
 * fallback through an offscreen textarea. Rejects only once both have failed.
 */

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  document.execCommand = originalExecCommand;
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('writes through the async Clipboard API when it is available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    await copyToClipboard('hello there');

    expect(writeText).toHaveBeenCalledWith('hello there');
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as typeof document.execCommand;

    await expect(copyToClipboard('fallback text')).resolves.toBeUndefined();

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when there is no Clipboard API at all', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn().mockReturnValue(true);
    document.execCommand = execCommand as typeof document.execCommand;

    await copyToClipboard('no clipboard api');

    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('rejects once both the Clipboard API and the execCommand fallback have failed', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(false) as typeof document.execCommand;

    await expect(copyToClipboard('nope')).rejects.toThrow();
  });

  it('restores focus to whatever had it (e.g. the "Copy code" button) after the execCommand fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    document.execCommand = vi.fn().mockReturnValue(true) as typeof document.execCommand;
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    expect(document.activeElement).toBe(button);

    await copyToClipboard('fallback text');

    // The offscreen textarea needed focus to be selectable, but it is removed once the copy is done —
    // without restoring it, focus would be dropped to <body>, silently losing a keyboard user's place.
    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });
});

import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PermissionPrompt, { PERMISSION_PROMPT_ARM_DELAY_MS } from '../PermissionPrompt.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

import type { IPendingPermissionRequest } from '../types.js';

/**
 * #3189: the permission prompt replaces the composer while the user may still be typing, and its
 * keys are ordinary letters and digits. A key typed as it appears must not answer it; keys answer
 * only once it is armed.
 */

function request(resolve: IPendingPermissionRequest['resolve']): IPendingPermissionRequest {
  return { toolName: 'Bash', toolArgs: { command: 'ls' }, resolve };
}

/** Lets Ink register its input handlers, deliver the written keys and commit a render. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function waitOutArming(): Promise<void> {
  await vi.advanceTimersByTimeAsync(PERMISSION_PROMPT_ARM_DELAY_MS);
  await settle();
}

describe('the permission prompt arms before its keys answer it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a key pressed as the prompt appears does not answer it; one pressed after the delay does', async () => {
    const resolve = vi.fn();
    const { stdin, lastFrame, unmount } = render(<PermissionPrompt request={request(resolve)} />);
    await settle();

    stdin.write('y');
    await settle();
    stdin.write('1');
    await settle();
    stdin.write('\r');
    await settle();
    expect(resolve).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('keys answer in a moment');
    expect(lastFrame()).not.toContain('> Allow [y]');

    await waitOutArming();
    expect(lastFrame()).not.toContain('keys answer in a moment');
    expect(lastFrame()).toContain('> Allow [y]');
    stdin.write('y');
    await settle();
    unmount();

    expect(resolve).toHaveBeenCalledWith(true);
  });

  it('a new request arms again', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { stdin, rerender, unmount } = render(<PermissionPrompt request={request(first)} />);
    await waitOutArming();
    stdin.write('n');
    await settle();
    expect(first).toHaveBeenCalledWith(false);

    rerender(<PermissionPrompt request={request(second)} />);
    await settle();
    stdin.write('a');
    await settle();
    expect(second).not.toHaveBeenCalled();

    await waitOutArming();
    stdin.write('n');
    await settle();
    unmount();

    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(false);
  });

  it('in screen-reader mode a number typed while arming is neither taken nor kept for Enter', async () => {
    const resolve = vi.fn();
    const { stdin, unmount } = render(
      <ScreenReaderProvider enabled={true}>
        <PermissionPrompt request={request(resolve)} />
      </ScreenReaderProvider>,
    );
    await settle();

    stdin.write('1');
    await settle();
    stdin.write('\r');
    await settle();
    expect(resolve).not.toHaveBeenCalled();

    await waitOutArming();
    stdin.write('\r');
    await settle();
    expect(resolve).not.toHaveBeenCalled();

    stdin.write('4');
    await settle();
    stdin.write('\r');
    await settle();
    unmount();

    // Option 4 is Deny.
    expect(resolve).toHaveBeenCalledWith(false);
  });
});

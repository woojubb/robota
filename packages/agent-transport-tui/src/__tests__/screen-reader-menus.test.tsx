/**
 * CLI-2004 TC-06 / TC-07 — arrow-key menus become numbered lists with a typed answer.
 *
 * Position is the thing a reader cannot get: the `> ` cursor and the accent colour say which row is
 * selected, and neither survives being read aloud. A spoken number does.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import ConfirmPrompt, { CONFIRM_PROMPT_TYPED_LITERAL } from '../ConfirmPrompt.js';
import MenuSelect from '../MenuSelect.js';
import { NUMBERED_LIST_CANCEL_SUFFIX } from '../numbered-list.js';
import PermissionPrompt from '../PermissionPrompt.js';
import { ScreenReaderProvider } from '../screen-reader-context.js';

import type { IPendingPermissionRequest } from '../types.js';

/** Ink needs a tick to deliver stdin and flush a frame. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function renderInMode(element: React.ReactElement): ReturnType<typeof render> {
  return render(<ScreenReaderProvider enabled={true}>{element}</ScreenReaderProvider>);
}

const ITEMS = [
  { label: 'First option', value: 'a' },
  { label: 'Second option', value: 'b' },
  { label: 'Third option', value: 'c' },
];

describe('TC-06: MenuSelect as a numbered list', () => {
  it('renders `1. `, `2. `, `3. ` rows and the authored prompt literal', async () => {
    const { lastFrame, unmount } = renderInMode(
      <MenuSelect title="Pick one" items={ITEMS} onSelect={vi.fn()} onBack={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('1. First option');
    expect(frame).toContain('2. Second option');
    expect(frame).toContain('3. Third option');
    expect(frame).toContain('Enter selection (1-3)');
    expect(frame).not.toContain('> ');
    expect(frame).not.toMatch(/[╭╮╰╯│─]/u);
  });

  it('a cancellable menu names Escape in the same literal', async () => {
    const { lastFrame, unmount } = renderInMode(
      <MenuSelect title="Pick one" items={ITEMS} onSelect={vi.fn()} onBack={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain(`Enter selection (1-3)${NUMBERED_LIST_CANCEL_SUFFIX}`);
  });

  it('typing `2` then Enter selects the SECOND option', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = renderInMode(
      <MenuSelect title="Pick one" items={ITEMS} onSelect={onSelect} onBack={vi.fn()} />,
    );
    await tick();
    stdin.write('2');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('typing `9` then Enter selects nothing and re-prints the same literal', async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame, unmount } = renderInMode(
      <MenuSelect title="Pick one" items={ITEMS} onSelect={onSelect} onBack={vi.fn()} />,
    );
    await tick();
    stdin.write('9');
    await tick();
    stdin.write('\r');
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(onSelect).not.toHaveBeenCalled();
    // The range IS the correction: the same literal comes back, twice in the frame.
    expect(frame.split('Enter selection (1-3)').length - 1).toBeGreaterThanOrEqual(2);
  });

  it('keeps the bordered arrow-key menu when the mode is off', async () => {
    const { lastFrame, unmount } = render(
      <MenuSelect title="Pick one" items={ITEMS} onSelect={vi.fn()} onBack={vi.fn()} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('> First option');
    expect(frame).not.toContain('Enter selection');
    expect(frame).toMatch(/[╭╮╰╯]/u);
  });
});

describe('TC-07: PermissionPrompt and ConfirmPrompt', () => {
  function permissionRequest(resolve: (value: unknown) => void): IPendingPermissionRequest {
    return {
      toolName: 'Bash',
      toolArgs: { command: 'ls -la' },
      resolve,
    } as unknown as IPendingPermissionRequest;
  }

  it('renders the permission ask as a numbered list with no border', async () => {
    const { lastFrame, unmount } = renderInMode(
      <PermissionPrompt request={permissionRequest(vi.fn())} />,
    );
    await tick();
    const frame = lastFrame() ?? '';
    unmount();

    expect(frame).toContain('permission required:');
    expect(frame).toContain('1. Allow');
    expect(frame).toContain('Enter selection (1-4)');
    expect(frame).not.toMatch(/[╭╮╰╯│─]/u);
    expect(frame).not.toContain('> ');
  });

  it('a typed number resolves the permission ask', async () => {
    const resolve = vi.fn();
    const { stdin, unmount } = renderInMode(
      <PermissionPrompt request={permissionRequest(resolve)} />,
    );
    await tick();
    stdin.write('4');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();

    // Option 4 is Deny.
    expect(resolve).toHaveBeenCalledWith(false);
  });

  it('ConfirmPrompt accepts `y` + Enter', async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame, unmount } = renderInMode(
      <ConfirmPrompt message="Proceed?" onSelect={onSelect} />,
    );
    await tick();
    expect(lastFrame() ?? '').toContain(CONFIRM_PROMPT_TYPED_LITERAL);
    stdin.write('y');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();

    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('ConfirmPrompt accepts `no` + Enter', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = renderInMode(<ConfirmPrompt message="Proceed?" onSelect={onSelect} />);
    await tick();
    stdin.write('n');
    await tick();
    stdin.write('o');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();

    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('ConfirmPrompt rejects anything else without selecting', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = renderInMode(<ConfirmPrompt message="Proceed?" onSelect={onSelect} />);
    await tick();
    stdin.write('m');
    await tick();
    stdin.write('a');
    await tick();
    stdin.write('\r');
    await tick();
    unmount();

    expect(onSelect).not.toHaveBeenCalled();
  });
});

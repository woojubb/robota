// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import type { TConversationEntry } from '../../hooks/useSessionClient.js';

/**
 * #3289 §2 — every code block gets a "Copy code" button and every assistant message a "Copy message"
 * one; both copy the real Markdown/code source (not the rendered DOM text), show a short "Copied" /
 * "Couldn't copy" state announced via `aria-live`, and a code block itself is a focusable, named,
 * horizontally-scrollable region so a keyboard user without a mouse wheel can still reach a long line.
 */

function agentMessage(content: string): TConversationEntry {
  return { id: `m-${content.length}-${content.slice(0, 8)}`, role: 'assistant', content };
}

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  document.execCommand = originalExecCommand;
  vi.restoreAllMocks();
});

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return { writeText };
}

describe('ConversationView — copy buttons (#3289 §2)', () => {
  it('"Copy message" copies the message\'s Markdown source, not its rendered text', async () => {
    const { writeText } = mockClipboard();
    const markdown = '**bold** and a [link](https://example.com)';
    render(
      <ConversationView
        messages={[agentMessage(markdown)]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Copy message/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(markdown));
  });

  it('shows a "Copied" state announced via aria-live after a successful copy, and schedules it to clear', async () => {
    mockClipboard();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    render(
      <ConversationView
        messages={[agentMessage('plain reply')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    const button = screen.getByRole('button', { name: /Copy message/ });
    const live = within(button).getByRole('status');
    // Idle: nothing to announce yet — the visible, constant label is not itself the live region (a
    // live region doubling as the button's own name is the fragile shape that broke in a real
    // browser; see `CopyButton`'s doc comment).
    expect(live.textContent).toBe('');

    fireEvent.click(button);

    await waitFor(() => expect(live.textContent).toBe('Copied'));
    // The feedback is temporary: a timer is armed to clear it back to the normal label.
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
  });

  it('shows "Couldn\'t copy" when both the Clipboard API and the fallback fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false) as typeof document.execCommand;
    render(
      <ConversationView
        messages={[agentMessage('plain reply')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    const button = screen.getByRole('button', { name: /Copy message/ });

    fireEvent.click(button);

    await waitFor(() =>
      expect(within(button).getByRole('status').textContent).toBe("Couldn't copy"),
    );
  });

  it('a still-streaming message has no "Copy message" button yet', () => {
    render(
      <ConversationView
        messages={[]}
        activeTools={[]}
        streamingText="still going"
        isThinking
        ownDriverId={null}
      />,
    );
    expect(screen.queryByRole('button', { name: /Copy message/ })).toBeNull();
  });

  it('"Copy code" copies the code block\'s own source, and the block is a focusable, named, scrollable region', async () => {
    const { writeText } = mockClipboard();
    const code = 'const a = 1;\nconst b = 2;';
    const markdown = ['Some text.', '', '```ts', code, '```'].join('\n');
    render(
      <ConversationView
        messages={[agentMessage(markdown)]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );

    const pre = document.querySelector('pre.gui-code-scroll') as HTMLPreElement;
    expect(pre).toBeTruthy();
    expect(pre.tabIndex).toBe(0);
    expect(pre.getAttribute('aria-label')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Copy code/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });
});

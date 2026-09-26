// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionPrompt, PROMPT_ARM_DELAY_MS } from '../PermissionPrompt.js';

import type { TPendingPrompt } from '../../hooks/prompt-state.js';

/**
 * #3189: the docked prompt can appear while the user is typing in the composer. A key typed at that
 * moment must stay in the composer rather than answer the prompt (`1` allows); keys answer only once
 * the prompt is armed, while a click answers at once.
 */

function permission(id: string): TPendingPrompt {
  return {
    kind: 'permission',
    id,
    toolName: 'write_file',
    toolArgs: { path: 'x' },
  } as TPendingPrompt;
}

function Surface({
  prompts,
  onAnswerPermission,
  onAnswerAsk = vi.fn(),
}: {
  prompts: readonly TPendingPrompt[];
  onAnswerPermission: (id: string, result: boolean) => void;
  onAnswerAsk?: React.ComponentProps<typeof PermissionPrompt>['onAnswerAsk'];
}): React.ReactElement {
  return (
    <>
      <PermissionPrompt
        layout="dock"
        prompts={prompts}
        onAnswerPermission={onAnswerPermission}
        onAnswerAsk={onAnswerAsk}
      />
      <textarea aria-label="message" />
    </>
  );
}

/** The user is typing in the composer when the prompt appears. */
function appearWhileTyping(onAnswerPermission: (id: string, result: boolean) => void): {
  composer: HTMLTextAreaElement;
  rerender: (prompts: readonly TPendingPrompt[]) => void;
} {
  const view = render(<Surface prompts={[]} onAnswerPermission={onAnswerPermission} />);
  const composer = screen.getByLabelText('message') as HTMLTextAreaElement;
  composer.focus();
  const rerender = (prompts: readonly TPendingPrompt[]): void =>
    view.rerender(<Surface prompts={prompts} onAnswerPermission={onAnswerPermission} />);
  rerender([permission('p1')]);
  return { composer, rerender };
}

describe('the docked prompt arms before its keys answer it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a digit pressed as the prompt appears does not answer it; one pressed after the delay does', () => {
    const onAnswerPermission = vi.fn();
    const { composer } = appearWhileTyping(onAnswerPermission);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });

    // Focus stays in the composer, so the keystroke is typed there, not taken as an answer.
    expect(document.activeElement).toBe(composer);
    expect(dialog.getAttribute('data-armed')).toBe('false');
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    expect(dialog.getAttribute('data-armed')).toBe('true');
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', true);
  });

  it('shows that its keys are not live yet, then names them once armed', () => {
    appearWhileTyping(vi.fn());
    expect(screen.getByText(/keys answer in a moment/)).toBeTruthy();
    expect(screen.queryByText(/1 allow/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    expect(screen.queryByText(/keys answer in a moment/)).toBeNull();
    expect(screen.getByText(/1 allow · 2 deny/)).toBeTruthy();
  });

  it('a mouse click answers at once', () => {
    const onAnswerPermission = vi.fn();
    appearWhileTyping(onAnswerPermission);
    // A mouse click reports its click count in `detail`; a keyboard-activated click reports 0.
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 1 });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', true);
  });

  it('a button focused to answer one prompt does not answer the next with a key', () => {
    const onAnswerPermission = vi.fn();
    const { rerender } = appearWhileTyping(onAnswerPermission);
    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    const allow = screen.getByRole('button', { name: 'Allow' });
    allow.focus();
    fireEvent.click(allow, { detail: 1 });
    expect(onAnswerPermission).toHaveBeenLastCalledWith('p1', true);

    // The next prompt renders into the same buttons while the focused one still holds the key.
    rerender([permission('p2')]);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Allow' }));
    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'pending question' }));
    // Enter or Space on a focused button, or a held key repeating, fires a click with `detail` 0.
    fireEvent.click(document.activeElement as Element, { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 0 });
    expect(onAnswerPermission).not.toHaveBeenCalledWith('p2', true);

    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 1 });
    expect(onAnswerPermission).toHaveBeenLastCalledWith('p2', true);
  });

  it('Esc denies at once, since denying is the safe direction', () => {
    const onAnswerPermission = vi.fn();
    appearWhileTyping(onAnswerPermission);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'pending question' }), { key: 'Escape' });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', false);
  });

  it('the next prompt arms again, even though the dock kept focus from the one before', () => {
    const onAnswerPermission = vi.fn();
    const { rerender } = appearWhileTyping(onAnswerPermission);
    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    const dialog = screen.getByRole('dialog', { name: 'pending question' });
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).toHaveBeenLastCalledWith('p1', true);

    rerender([permission('p2')]);
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).not.toHaveBeenCalledWith('p2', true);

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    fireEvent.keyDown(dialog, { key: '2' });
    expect(onAnswerPermission).toHaveBeenLastCalledWith('p2', false);
  });

  it('an ask answers by number only once armed', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a1',
      request: {
        title: 'Select language',
        options: [
          { value: 'ko', label: 'ko' },
          { value: 'en', label: 'en' },
        ],
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });
    fireEvent.keyDown(dialog, { key: '2' });
    expect(onAnswerAsk).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    fireEvent.keyDown(dialog, { key: '2' });
    expect(onAnswerAsk).toHaveBeenCalledWith('a1', { type: 'answer', values: ['en'] });
  });
});

describe('PermissionPrompt shows what the tool was asked to do', () => {
  afterEach(cleanup);

  it('shows the command line and every other argument beside it', () => {
    const prompt = {
      kind: 'permission',
      id: 'p1',
      toolName: 'Bash',
      toolArgs: {
        command: 'pnpm test --filter agent-session',
        workingDirectory: '/srv/app',
        stdin: 'yes',
      },
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('pnpm test --filter agent-session')).toBeTruthy();
    expect(screen.getByText('/srv/app')).toBeTruthy();
    expect(screen.getByText('yes')).toBeTruthy();
  });

  it('shows a long argument whole', () => {
    const content = 'x'.repeat(2000);
    const prompt = {
      kind: 'permission',
      id: 'p2',
      toolName: 'Write',
      toolArgs: { path: 'notes.md', content },
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('notes.md')).toBeTruthy();
    expect(screen.getByText(content)).toBeTruthy();
  });

  it('keeps the key cap out of the button name', () => {
    render(<Surface prompts={[permission('p3')]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Allow' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
  });
});

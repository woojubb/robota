// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionPrompt, PROMPT_ARM_DELAY_MS } from '../PermissionPrompt.js';

import type { TPendingPrompt } from '../../hooks/prompt-state.js';

/**
 * #3280 §1: the docked prompt can appear while the user is typing in the composer. It must never take
 * that focus away — a key typed for the composer, including a digit that would otherwise answer the
 * prompt, always stays in the composer. Once the person moves focus to the prompt themselves (a click,
 * or Shift+Tab from the composer) its keys answer it, and answering it there sends focus back to the
 * composer so typing can continue.
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
  const composerRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <PermissionPrompt
        layout="dock"
        prompts={prompts}
        onAnswerPermission={onAnswerPermission}
        onAnswerAsk={onAnswerAsk}
        onFocusReturn={() => composerRef.current?.focus()}
      />
      <textarea aria-label="message" ref={composerRef} />
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

/** The prompt appears while nothing has focus — jsdom's default `document.activeElement` (`<body>`). */
function appearWithNothingFocused(onAnswerPermission: (id: string, result: boolean) => void): {
  rerender: (prompts: readonly TPendingPrompt[]) => void;
} {
  const view = render(<Surface prompts={[]} onAnswerPermission={onAnswerPermission} />);
  const rerender = (prompts: readonly TPendingPrompt[]): void =>
    view.rerender(<Surface prompts={prompts} onAnswerPermission={onAnswerPermission} />);
  rerender([permission('p1')]);
  return { rerender };
}

describe('the docked prompt never takes focus from a field the person is typing in', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('with the composer focused, typing 1, 2 and letters never answers the prompt, even once armed', () => {
    const onAnswerPermission = vi.fn();
    const { composer } = appearWhileTyping(onAnswerPermission);

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    // Armed, but focus never left the composer — a stolen focus would have moved it to the dialog.
    expect(screen.getByRole('dialog', { name: 'pending question' }).getAttribute('data-armed')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(composer);

    // Keystrokes go wherever focus actually is, so they are fired there — as a real keypress would be.
    for (const key of ['1', '2', 'a', 'Enter']) {
      fireEvent.keyDown(document.activeElement as Element, { key });
    }
    expect(onAnswerPermission).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
  });

  it('with nothing focused, the prompt takes focus once armed, and its keys answer it', () => {
    const onAnswerPermission = vi.fn();
    appearWithNothingFocused(onAnswerPermission);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });

    expect(document.activeElement).not.toBe(dialog);
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    // Nothing editable had focus, so the prompt was free to take it.
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', true);
  });

  it('answering from the focused prompt sends focus back to the composer', () => {
    const onAnswerPermission = vi.fn();
    const { rerender } = appearWithNothingFocused(onAnswerPermission);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });
    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    expect(document.activeElement).toBe(dialog);

    fireEvent.keyDown(dialog, { key: '1' });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', true);
    // The caller's state drops the answered prompt — no other one is queued behind it.
    rerender([]);

    expect(document.activeElement).toBe(screen.getByLabelText('message'));
  });

  it('shows a plain hint while it lacks focus, and the key hint once it has focus and is armed', () => {
    const onAnswerPermission = vi.fn();
    appearWhileTyping(onAnswerPermission);
    expect(screen.getByText(/Click to answer, or press Shift\+Tab/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    // Still unfocused (the composer kept it), so the hint stays the plain one even once armed.
    expect(screen.getByText(/Click to answer, or press Shift\+Tab/)).toBeTruthy();
    expect(screen.queryByText(/1 allow/)).toBeNull();

    // The person now reaches the prompt themselves (Shift+Tab or a click land focus on it directly).
    act(() => {
      screen.getByRole('dialog', { name: 'pending question' }).focus();
    });
    expect(screen.queryByText(/Click to answer, or press Shift\+Tab/)).toBeNull();
    expect(screen.getByText(/1 allow · 2 deny/)).toBeTruthy();
  });
});

describe('the docked prompt arms before its keys answer it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('a mouse click answers at once', () => {
    const onAnswerPermission = vi.fn();
    appearWithNothingFocused(onAnswerPermission);
    // A mouse click reports its click count in `detail`; a keyboard-activated click reports 0.
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 1 });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', true);
  });

  it('a button focused to answer one prompt does not answer the next with a key', () => {
    const onAnswerPermission = vi.fn();
    const { rerender } = appearWithNothingFocused(onAnswerPermission);
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
    appearWithNothingFocused(onAnswerPermission);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'pending question' }), { key: 'Escape' });
    expect(onAnswerPermission).toHaveBeenCalledWith('p1', false);
  });

  it('the next prompt arms again, even though the dock kept focus from the one before', () => {
    const onAnswerPermission = vi.fn();
    const { rerender } = appearWithNothingFocused(onAnswerPermission);
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

/**
 * RTL's own `render`/`rerender` wrap every call in `act()`, which flushes pending `useEffect`s
 * before returning — including the very effect a leaked-secret regression must catch in the act of
 * NOT having run yet. Asserting through `rerender` would flush that effect first and pass even
 * against the bug it exists to catch. `flushSync` forces the synchronous commit (so the DOM reflects
 * the new prompt) without the `act`-only step of also draining the passive-effect queue, which is
 * exactly the gap a `useEffect`-based reset relies on and a same-commit fix does not need.
 */
function renderWithoutEffectFlush(ui: React.ReactElement): {
  container: HTMLDivElement;
  rerender: (next: React.ReactElement) => void;
  cleanup: () => void;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(ui));
  return {
    container,
    rerender: (next) => flushSync(() => root.render(next)),
    cleanup: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

/**
 * #3280 §3: a question with `allowFreeText` showed only its title and Cancel — nothing to type an
 * answer into. `values: []` alongside `text` is the same shape the terminal renderer already sends
 * for free text (`PendingActionPrompt.tsx`'s `TextPrompt` path), not a new one.
 */
describe("the ask prompt's free-text field", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the field with its placeholder, and Enter submits the typed value', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a1',
      request: {
        title: 'Duplicate anthropic as',
        allowFreeText: true,
        placeholder: 'anthropic-copy',
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />);

    const field = screen.getByPlaceholderText('anthropic-copy') as HTMLInputElement;
    expect(field.type).toBe('text');
    fireEvent.change(field, { target: { value: 'anthropic-copy-2' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(onAnswerAsk).toHaveBeenCalledWith('a1', {
      type: 'answer',
      values: [],
      text: 'anthropic-copy-2',
    });
  });

  it('blocks an empty submit unless allowEmpty is set', () => {
    const onAnswerAsk = vi.fn();
    const request = { title: 'Name the profile', allowFreeText: true };
    const ask = { kind: 'ask', id: 'a2', request } as unknown as TPendingPrompt;
    const view = render(
      <Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'answer' }), { key: 'Enter' });
    expect(onAnswerAsk).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    const askAllowingEmpty = {
      kind: 'ask',
      id: 'a3',
      request: { ...request, allowEmpty: true },
    } as unknown as TPendingPrompt;
    view.rerender(
      <Surface
        prompts={[askAllowingEmpty]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={onAnswerAsk}
      />,
    );
    expect(
      (screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'answer' }), { key: 'Enter' });
    expect(onAnswerAsk).toHaveBeenCalledWith('a3', { type: 'answer', values: [], text: '' });
  });

  it('masks the field for a secret answer, and the value is gone from the DOM once submitted', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a4',
      request: {
        title: 'Anthropic API key',
        allowFreeText: true,
        masked: true,
        allowEmpty: true,
        placeholder: '(unchanged)',
      },
    } as unknown as TPendingPrompt;
    const view = render(
      <Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    const field = screen.getByPlaceholderText('(unchanged)') as HTMLInputElement;
    expect(field.type).toBe('password');

    fireEvent.change(field, { target: { value: 'sk-super-secret' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAnswerAsk).toHaveBeenCalledWith('a4', {
      type: 'answer',
      values: [],
      text: 'sk-super-secret',
    });
    // Cleared from this component's own state — not left behind for a later render to pick up.
    expect(field.value).toBe('');

    // The caller drops the answered prompt; nothing of the secret survives in the markup.
    view.rerender(
      <Surface prompts={[]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    expect(view.container.innerHTML).not.toContain('sk-super-secret');
  });

  it('shows each option next to a free-text field, with "or type an answer" between them', () => {
    const ask = {
      kind: 'ask',
      id: 'a5',
      request: {
        title: 'Pick a mode or type one',
        allowFreeText: true,
        allowEmpty: true,
        options: [
          { value: 'default', label: 'default' },
          { value: 'plan', label: 'plan' },
        ],
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'default' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'plan' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'answer' })).toBeTruthy();
    expect(screen.getByText('or type an answer')).toBeTruthy();
  });

  it("shows each option's description as small, plain secondary text", () => {
    const ask = {
      kind: 'ask',
      id: 'a6',
      request: {
        title: 'Choose a permission mode',
        options: [
          { value: 'default', label: 'default', description: 'Confirms risky actions' },
          { value: 'plan', label: 'plan', description: 'Plans without changing files' },
        ],
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={vi.fn()} />);

    expect(screen.getByText('Confirms risky actions')).toBeTruthy();
    expect(screen.getByText('Plans without changing files')).toBeTruthy();
  });

  it('an Enter that only finishes an IME composition does not submit the unfinished text', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a8',
      request: { title: 'Name the profile', allowFreeText: true },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />);

    const field = screen.getByRole('textbox', { name: 'answer' }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '한글' } });
    // The IME's own Enter, confirming the composed text — not the person submitting the answer.
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onAnswerAsk).not.toHaveBeenCalled();

    // A plain Enter afterwards (composition already finished) submits normally.
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAnswerAsk).toHaveBeenCalledWith('a8', {
      type: 'answer',
      values: [],
      text: '한글',
    });
  });

  it('Escape inside the field cancels the ask', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a9',
      request: { title: 'Name the profile', allowFreeText: true },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />);

    const field = screen.getByRole('textbox', { name: 'answer' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onAnswerAsk).toHaveBeenCalledWith('a9', { type: 'cancelled' });
  });

  /**
   * A masked question (an API key) cancelled mid-type must never let that text reach the field of
   * the next question, even for a single frame — the risk being an unmasked field, where it would
   * render in plaintext. The fix is a per-prompt field whose state is remounted (not merely reset)
   * on the next `prompt.id`, so there is no render in which the old value and the new prompt coexist.
   */
  it('cancelling a masked answer (Cancel button) never carries it into the next, unmasked field', () => {
    const onAnswerAsk = vi.fn();
    const secretAsk = {
      kind: 'ask',
      id: 'secret-cancel',
      request: {
        title: 'Anthropic API key',
        allowFreeText: true,
        masked: true,
        allowEmpty: true,
        placeholder: '(unchanged)',
      },
    } as unknown as TPendingPrompt;
    const nextAsk = {
      kind: 'ask',
      id: 'after-cancel',
      request: { title: 'Name the profile', allowFreeText: true, placeholder: 'profile name' },
    } as unknown as TPendingPrompt;

    const view = renderWithoutEffectFlush(
      <Surface prompts={[secretAsk]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    try {
      const secretField = screen.getByPlaceholderText('(unchanged)') as HTMLInputElement;
      expect(secretField.type).toBe('password');
      flushSync(() => fireEvent.change(secretField, { target: { value: 'sk-super-secret' } }));
      expect(secretField.value).toBe('sk-super-secret');

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      flushSync(() => fireEvent.click(cancelButton, { detail: 1 }));
      expect(onAnswerAsk).toHaveBeenCalledWith('secret-cancel', { type: 'cancelled' });

      // The caller drops the cancelled prompt and shows the next one in the same synchronous commit.
      view.rerender(
        <Surface prompts={[nextAsk]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
      );
      const nextField = screen.getByPlaceholderText('profile name') as HTMLInputElement;
      expect(nextField.type).toBe('text');
      expect(nextField.value).toBe('');
      expect(view.container.innerHTML).not.toContain('sk-super-secret');
    } finally {
      view.cleanup();
    }
  });

  it('Esc inside a masked field never carries its text into the next, unmasked field', () => {
    const onAnswerAsk = vi.fn();
    const secretAsk = {
      kind: 'ask',
      id: 'secret-esc',
      request: {
        title: 'Anthropic API key',
        allowFreeText: true,
        masked: true,
        allowEmpty: true,
        placeholder: '(unchanged)',
      },
    } as unknown as TPendingPrompt;
    const nextAsk = {
      kind: 'ask',
      id: 'after-esc',
      request: { title: 'Name the profile', allowFreeText: true, placeholder: 'profile name' },
    } as unknown as TPendingPrompt;

    const view = renderWithoutEffectFlush(
      <Surface prompts={[secretAsk]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    try {
      const secretField = screen.getByPlaceholderText('(unchanged)') as HTMLInputElement;
      flushSync(() => fireEvent.change(secretField, { target: { value: 'sk-super-secret' } }));
      expect(secretField.value).toBe('sk-super-secret');

      flushSync(() => fireEvent.keyDown(secretField, { key: 'Escape' }));
      expect(onAnswerAsk).toHaveBeenCalledWith('secret-esc', { type: 'cancelled' });

      view.rerender(
        <Surface prompts={[nextAsk]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
      );
      const nextField = screen.getByPlaceholderText('profile name') as HTMLInputElement;
      expect(nextField.type).toBe('text');
      expect(nextField.value).toBe('');
      expect(view.container.innerHTML).not.toContain('sk-super-secret');
    } finally {
      view.cleanup();
    }
  });

  /**
   * The free-text field is now its own component, remounted (not merely updated) on every new
   * `prompt.id` — the fix above for the leaked-secret defect. Removing a focused DOM node drops
   * `document.activeElement` to `<body>` as an intrinsic side effect (verified in both jsdom and
   * Chromium): a reused button never triggered this, since answering left it in place for the
   * existing container-refocus effect to find. A remounted field must be caught the same way, or the
   * dock's Esc and the arm timer's takeover both go dead until the person clicks something.
   */
  it('focus returns to the prompt, not lost to document.body, when the next prompt also has a free-text field', () => {
    const onAnswerAsk = vi.fn();
    const askA = {
      kind: 'ask',
      id: 'field-to-field-a',
      request: { title: 'First question', allowFreeText: true, allowEmpty: true, placeholder: 'a' },
    } as unknown as TPendingPrompt;
    const askB = {
      kind: 'ask',
      id: 'field-to-field-b',
      request: { title: 'Second question', allowFreeText: true, allowEmpty: true, placeholder: 'b' },
    } as unknown as TPendingPrompt;
    const view = render(
      <Surface prompts={[askA]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    const fieldA = screen.getByPlaceholderText('a') as HTMLInputElement;
    act(() => {
      fieldA.focus();
    });
    expect(document.activeElement).toBe(fieldA);

    fireEvent.keyDown(fieldA, { key: 'Enter' });
    expect(onAnswerAsk).toHaveBeenCalledWith('field-to-field-a', {
      type: 'answer',
      values: [],
      text: '',
    });

    view.rerender(
      <Surface prompts={[askB]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'pending question' });
    expect(document.activeElement).toBe(dialog);
    expect(document.activeElement).not.toBe(document.body);

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    expect(document.activeElement).toBe(screen.getByPlaceholderText('b'));
  });

  it('hints "Enter to submit" while focus is in the field, and "1–9 choose" once it moves to an option', () => {
    const ask = {
      kind: 'ask',
      id: 'a10',
      request: {
        title: 'Pick a mode or type one',
        allowFreeText: true,
        allowEmpty: true,
        options: [
          { value: 'default', label: 'default' },
          { value: 'plan', label: 'plan' },
        ],
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={vi.fn()} />);

    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    // Once armed, nothing editable already had focus, so the field (the prompt's primary control) gets it.
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'answer' }));
    expect(screen.getByText('Enter to submit · Esc to cancel')).toBeTruthy();

    // The person tabs (or clicks) to an option button — focus leaves the field.
    act(() => {
      screen.getByRole('button', { name: 'default' }).focus();
    });
    expect(screen.getByText('1–9 choose · Esc cancel')).toBeTruthy();
    expect(screen.queryByText('Enter to submit · Esc to cancel')).toBeNull();
  });

  it('typing a digit in the field types it there instead of picking that numbered option', () => {
    const onAnswerAsk = vi.fn();
    const ask = {
      kind: 'ask',
      id: 'a7',
      request: {
        title: 'Pick a mode or type one',
        allowFreeText: true,
        allowEmpty: true,
        options: [
          { value: 'default', label: 'default' },
          { value: 'plan', label: 'plan' },
        ],
      },
    } as unknown as TPendingPrompt;
    render(<Surface prompts={[ask]} onAnswerPermission={vi.fn()} onAnswerAsk={onAnswerAsk} />);

    const field = screen.getByRole('textbox', { name: 'answer' }) as HTMLInputElement;
    field.focus();
    act(() => {
      vi.advanceTimersByTime(PROMPT_ARM_DELAY_MS);
    });
    expect(screen.getByRole('dialog', { name: 'pending question' }).getAttribute('data-armed')).toBe(
      'true',
    );
    fireEvent.change(field, { target: { value: '1' } });
    fireEvent.keyDown(field, { key: '1' });

    expect(onAnswerAsk).not.toHaveBeenCalled();
    expect(field.value).toBe('1');
  });
});

describe('PermissionPrompt shows what the tool was asked to do', () => {
  afterEach(cleanup);

  it('for a tool without its own preview, shows the command line and every other argument beside it', () => {
    // #3288: Bash and Edit/Write get a dedicated preview (see below); anything else still falls
    // back to this generic "command line, then every other arg" dump.
    const prompt = {
      kind: 'permission',
      id: 'p1',
      toolName: 'CustomShellTool',
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

  it('exposes the digit shortcut through aria-keyshortcuts, without it reaching the name', () => {
    render(<Surface prompts={[permission('p4')]} onAnswerPermission={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Allow' }).getAttribute('aria-keyshortcuts')).toBe(
      '1',
    );
    expect(screen.getByRole('button', { name: 'Deny' }).getAttribute('aria-keyshortcuts')).toBe(
      '2',
    );
  });

  it('#3288: an Edit request with a diff preview shows "Edit <path>" and the diff, not raw args', () => {
    const prompt = {
      kind: 'permission',
      id: 'p4',
      toolName: 'Edit',
      toolArgs: { file_path: 'src/task-title.ts', old_string: 'a', new_string: 'b' },
      diffFile: 'src/task-title.ts',
      diffLines: [
        { type: 'remove', text: 'a', lineNumber: 1 },
        { type: 'add', text: 'b', lineNumber: 1 },
      ],
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('src/task-title.ts')).toBeTruthy();
    expect(screen.getByText(/- a/)).toBeTruthy();
    expect(screen.getByText(/\+ b/)).toBeTruthy();
    // The raw args are gone — no "Allow Edit to run?" line, no dumped old_string/new_string keys.
    expect(screen.queryByText(/to run\?/)).toBeNull();
    expect(screen.queryByText('old_string:')).toBeNull();
  });

  it('#3288: a Write request with a diff preview shows the same diff view', () => {
    const prompt = {
      kind: 'permission',
      id: 'p5',
      toolName: 'Write',
      toolArgs: { file_path: 'src/new-file.ts', content: 'hello' },
      diffFile: 'src/new-file.ts',
      diffLines: [{ type: 'add', text: 'hello', lineNumber: 1 }],
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('Write')).toBeTruthy();
    expect(screen.getByText('src/new-file.ts')).toBeTruthy();
    expect(screen.getByText(/\+ hello/)).toBeTruthy();
  });

  it('#3288: a Shell request shows the command, with no cwd line when it matches the workspace', () => {
    const prompt = {
      kind: 'permission',
      id: 'p6',
      toolName: 'Bash',
      toolArgs: { command: 'pnpm test' },
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('pnpm test')).toBeTruthy();
    expect(screen.queryByText(/^in /)).toBeNull();
  });

  it('#3288: a Shell request notes its cwd only when it differs from the workspace', () => {
    const prompt = {
      kind: 'permission',
      id: 'p7',
      toolName: 'Bash',
      toolArgs: { command: 'pnpm test', workingDirectory: 'sub' },
      cwd: '/workspace/sub',
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText('pnpm test')).toBeTruthy();
    expect(screen.getByText('/workspace/sub')).toBeTruthy();
  });
});

describe('PermissionPrompt names a different kind of surface, never a raw id (#3289 §3)', () => {
  afterEach(cleanup);

  function withRequester(requesterDriverId: string | undefined): TPendingPrompt {
    return { ...permission('p1'), requesterDriverId } as TPendingPrompt;
  }

  it('shows no requester when the prompt is this connection\'s own turn', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('owner')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
      />,
    );
    expect(screen.getByText('Permission request')).toBeTruthy();
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it('shows no requester for a turn from the same kind of surface as this connection\'s own', () => {
    // Every WS connection of one `--serve` process learns the SAME driver id, so a co-driver's turn
    // can arrive with this connection's own literal id too — same kind, no requester shown.
    render(
      <PermissionPrompt
        prompts={[withRequester('remote:ws')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
        ownDriverId="remote:ws"
      />,
    );
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it('shows a human phrase for a different kind of surface, never the raw id', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('browser')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
        ownDriverId="app"
      />,
    );
    expect(screen.getByText('from the browser')).toBeTruthy();
    expect(screen.queryByText('browser')).toBeNull();
  });

  it('names the terminal while this window is the browser, in plain words', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('attach:1')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
        ownDriverId="browser"
      />,
    );
    expect(screen.getByText('from the terminal')).toBeTruthy();
    expect(screen.queryByText(/attach:/)).toBeNull();
  });

  it('names a remote mesh peer as a remote device, never its raw id', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('peer:session-abc123')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
      />,
    );
    expect(screen.getByText('from a remote device')).toBeTruthy();
    expect(screen.queryByText(/session-abc123/)).toBeNull();
  });

  it('says "automatic" for the agent\'s own wake-up, not "from automatic"', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('agent')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
      />,
    );
    expect(screen.getByText('automatic')).toBeTruthy();
    expect(screen.queryByText(/from automatic/)).toBeNull();
  });
});

describe('issue #3288 §1: a background agent names itself on its own permission request', () => {
  afterEach(cleanup);

  it('says which background agent is asking, instead of an unattributed prompt', () => {
    const prompt = {
      kind: 'permission',
      id: 'p4',
      toolName: 'Glob',
      toolArgs: { pattern: '**/*' },
      requester: { kind: 'background-agent', label: 'general-purpose', taskId: 'agent_1' },
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText(/Background agent/)).toBeTruthy();
    expect(screen.getByText('general-purpose')).toBeTruthy();
  });

  it('reads as an ordinary ask when no requester is present', () => {
    render(<Surface prompts={[permission('p5')]} onAnswerPermission={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });

    expect(dialog.textContent).toContain('to run?');
    expect(dialog.textContent).not.toContain('Background agent');
  });

  it('#3288 review MUST 2: still names the background agent when the request also carries a diff', () => {
    const prompt = {
      kind: 'permission',
      id: 'p6',
      toolName: 'Edit',
      toolArgs: { file_path: 'src/task-title.ts', old_string: 'a', new_string: 'b' },
      requester: { kind: 'background-agent', label: 'general-purpose', taskId: 'agent_1' },
      diffFile: 'src/task-title.ts',
      diffLines: [
        { type: 'remove', text: 'a', lineNumber: 1 },
        { type: 'add', text: 'b', lineNumber: 1 },
      ],
    } as TPendingPrompt;
    render(<Surface prompts={[prompt]} onAnswerPermission={vi.fn()} />);

    expect(screen.getByText(/Background agent/)).toBeTruthy();
    expect(screen.getByText('general-purpose')).toBeTruthy();
    expect(screen.getByText(/- a/)).toBeTruthy();
    expect(screen.getByText(/\+ b/)).toBeTruthy();
  });
});

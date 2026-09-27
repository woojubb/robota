// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';
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

  it('exposes the digit shortcut through aria-keyshortcuts, without it reaching the name', () => {
    render(<Surface prompts={[permission('p4')]} onAnswerPermission={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Allow' }).getAttribute('aria-keyshortcuts')).toBe(
      '1',
    );
    expect(screen.getByRole('button', { name: 'Deny' }).getAttribute('aria-keyshortcuts')).toBe(
      '2',
    );
  });
});

describe('PermissionPrompt names who else is driving, never a raw id (#3289 §3)', () => {
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

  it('shows no requester when the raised turn is this connection\'s own learned driver id', () => {
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

  it('shows a human phrase for another window, never the raw id', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('browser')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
        ownDriverId="app"
      />,
    );
    expect(screen.getByText('from another window')).toBeTruthy();
    expect(screen.queryByText('browser')).toBeNull();
  });

  it('names the attached terminal in plain words', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('attach:1')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
      />,
    );
    expect(screen.getByText('from the terminal')).toBeTruthy();
    expect(screen.queryByText(/attach:/)).toBeNull();
  });

  it('names a paired device in plain words, never its raw id', () => {
    render(
      <PermissionPrompt
        prompts={[withRequester('peer:session-abc123')]}
        onAnswerPermission={vi.fn()}
        onAnswerAsk={vi.fn()}
      />,
    );
    expect(screen.getByText('from a paired device')).toBeTruthy();
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

// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '../Composer.js';

import type { TCommandCatalog, TSessionStatus } from '../../hooks/session-client-types.js';

// #3280 §4: the draft persists to `localStorage` — never leak one test's stored draft into another.
afterEach(() => window.localStorage.clear());

/**
 * #3282 §4e: a command the GUI cannot run at all (`/shell`, declared `runner: 'client'` for the
 * terminal only) never appears in the `/` menu — it stays in the catalog (other surfaces still list
 * it), so a realistic catalog here still carries it, alongside `share` (an ordinary session command
 * that also matches the query `/sh` once `shell` is filtered out).
 */

const catalog: TCommandCatalog = {
  commands: [
    { name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' },
    { name: 'settings', description: 'Open settings', modelInvocable: false, runner: 'runtime' },
    { name: 'resume', description: 'Resume another session', modelInvocable: false, runner: 'runtime' },
    { name: 'share', description: 'Share the session', modelInvocable: false, runner: 'runtime' },
    {
      name: 'shell',
      description: 'Open a shell',
      modelInvocable: false,
      runner: 'client',
      surfaces: ['terminal'],
    },
  ],
  skills: [],
};

/** The props every render needs beyond the ones a test itself cares about. */
function baseProps(): {
  onSubmit: ReturnType<typeof vi.fn>;
  onCommand: ReturnType<typeof vi.fn>;
  catalog: TCommandCatalog;
  status: null;
  running: boolean;
  onStop: ReturnType<typeof vi.fn>;
  queued: null;
  onCancelQueue: ReturnType<typeof vi.fn>;
} {
  return {
    onSubmit: vi.fn(),
    onCommand: vi.fn(),
    catalog,
    status: null,
    running: false,
    onStop: vi.fn(),
    queued: null,
    onCancelQueue: vi.fn(),
  };
}

/** A minimal but complete `TSessionStatus`, so the status row never reads through an undefined field. */
function statusFor(sessionId: string): TSessionStatus {
  return {
    sessionId,
    model: 'm',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null,
  } as TSessionStatus;
}

/**
 * #3282 §4d: the persisted draft is now JSON (`{text, attachments}`), not the bare text string it used
 * to be — reads back just the text half, so a test asserting "this text is what got saved" does not
 * need to know the wrapper shape.
 */
function storedDraftText(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof (parsed as { text?: unknown }).text === 'string') {
      return (parsed as { text: string }).text;
    }
  } catch {
    // A plain string, saved before attachments shipped — the text itself.
  }
  return raw;
}

function openMenu(): void {
  render(<Composer {...baseProps()} />);
  fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });
}

describe('Composer command menu (#3282 §4e)', () => {
  afterEach(cleanup);

  it('never shows a command the GUI cannot run at all, even though the catalog still carries it', () => {
    openMenu();

    expect(screen.queryByRole('option', { name: /\/shell/u })).toBeNull();
    expect(screen.queryByText('Open a shell')).toBeNull();
    // Everything else still shows.
    expect(screen.getByRole('option', { name: /\/help/u })).toBeTruthy();
    expect(screen.getByRole('option', { name: /\/share/u })).toBeTruthy();
  });

  it('groups skills under their own "Skills" heading, after a "Commands" heading', () => {
    const withSkill: TCommandCatalog = {
      ...catalog,
      skills: [
        { name: 'demo', description: 'A demo skill', source: 'project', modelInvocable: true, userInvocable: true },
      ],
    };
    render(<Composer {...baseProps()} catalog={withSkill} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });

    const menu = screen.getByRole('listbox', { name: 'commands' });
    expect(within(menu).getByText('Commands')).toBeTruthy();
    expect(within(menu).getByText('Skills')).toBeTruthy();
    // Every command row precedes every skill row.
    const rowOrder = within(menu)
      .getAllByRole('option')
      .map((el) => el.textContent ?? '');
    const skillIndex = rowOrder.findIndex((text) => text.includes('/demo'));
    const commandIndexes = rowOrder
      .map((text, index) => (text.includes('/demo') ? -1 : index))
      .filter((index) => index >= 0);
    const lastCommandIndex = Math.max(...commandIndexes);
    expect(skillIndex).toBeGreaterThan(lastCommandIndex);
  });

  it('scrolls beyond the visible rows, and keyboard navigation keeps the selected row in view', () => {
    const many: TCommandCatalog = {
      commands: Array.from({ length: 15 }, (_, i) => ({
        name: `cmd${i}`,
        description: `Command ${i}`,
        modelInvocable: false,
        runner: 'runtime' as const,
      })),
      skills: [],
    };
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView; the component guards the call, but this test needs a
    // spy to prove it is actually invoked as the highlighted row changes.
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<Composer {...baseProps()} catalog={many} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/cmd' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(15); // every match is present, not truncated to the visible count

    scrollIntoView.mockClear();
    const input = screen.getByLabelText('message');
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(scrollIntoView).toHaveBeenCalled();
    expect(options[10]?.getAttribute('aria-selected')).toBe('true');
  });

  it.each(['help', 'settings', 'resume'])(
    'choosing (or Tab-completing) /%s — a command that opens a GUI screen — runs it at once, not filling the draft',
    (name) => {
      const onCommand = vi.fn();
      render(<Composer {...baseProps()} onCommand={onCommand} />);
      const input = screen.getByLabelText('message') as HTMLTextAreaElement;
      fireEvent.change(input, { target: { value: `/${name}` } });
      fireEvent.keyDown(input, { key: 'Tab' });

      expect(onCommand).toHaveBeenCalledWith(name);
      expect(input.value).toBe(''); // not "/{name} " — there is nothing useful to type after it
    },
  );

  it('choosing an ordinary command still fills the draft, waiting for its arguments', () => {
    const onCommand = vi.fn();
    render(<Composer {...baseProps()} onCommand={onCommand} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/sha' } });
    fireEvent.keyDown(input, { key: 'Tab' });

    expect(onCommand).not.toHaveBeenCalled();
    expect(input.value).toBe('/share ');
  });
});

/**
 * #3280 §5: while the transport is not `connected`, nothing typed is lost — Enter and Send refuse to
 * submit, and the draft stays exactly as typed. Send explains why via an accessible description.
 */
describe('Composer — refuses to send while not connected', () => {
  afterEach(cleanup);

  it('Enter sends nothing and keeps the draft while disconnected', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} connected={false} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'are you there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('are you there');
  });

  it('Send is disabled and says why while disconnected, even with text typed', () => {
    render(<Composer {...baseProps()} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(send.getAttribute('aria-description')).toBe('Not connected');
  });

  it('clicking Send does nothing while disconnected', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('connected (the default) still sends on Enter and clears the draft', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('hello');
    expect(input.value).toBe('');
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-description')).toBeNull();
  });

  // #3282 §2 (part 2): the `/` command menu is one of the controls disabled while disconnected.
  it('the slash command menu does not open while disconnected', () => {
    render(<Composer {...baseProps()} connected={false} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });

    expect(screen.queryByRole('listbox', { name: 'commands' })).toBeNull();
  });

  it('Stop is unavailable while disconnected too: an abort could not be delivered either', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} connected={false} />);
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop.disabled).toBe(true);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });
});

/**
 * #3280 §2: while a turn runs the composer can stop it (button or Esc) instead of only waiting, and
 * a message the host queued behind the turn is visible and editable rather than silently swallowed.
 */
describe('Composer — stop a running turn', () => {
  afterEach(cleanup);

  it('shows Send (not Stop) while idle, and disables it for an empty draft', () => {
    render(<Composer {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Stop instead of Send while a turn runs, always enabled', () => {
    render(<Composer {...baseProps()} running />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement;
    expect(stop).toBeTruthy();
    expect(stop.disabled).toBe(false);
  });

  it('clicking Stop calls onStop', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Esc in the composer stops a running turn', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('Esc does nothing while idle', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} onStop={onStop} />);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Esc closes the command menu instead of stopping, even while a turn runs', () => {
    const onStop = vi.fn();
    render(<Composer {...baseProps()} running onStop={onStop} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/' } });
    expect(screen.getByRole('listbox', { name: 'commands' })).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(screen.queryByRole('listbox', { name: 'commands' })).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
  });

  it('Enter still submits (queues) while a turn runs — the draft is not blocked', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} running onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'follow-up' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('follow-up');
    expect(input.value).toBe('');
  });
});

describe('Composer — queued message row', () => {
  afterEach(cleanup);

  it('shows nothing when nothing is queued', () => {
    render(<Composer {...baseProps()} />);
    expect(screen.queryByRole('status', { name: 'queued prompt' })).toBeNull();
  });

  it('shows the queued text, truncated to one line, with no "and N more" for a single entry', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} />);
    const row = screen.getByRole('status', { name: 'queued prompt' });
    expect(row.textContent).toContain('Queued: ping the team');
    expect(row.textContent).not.toContain('more');
  });

  it('adds "and N more" when more than one prompt is queued', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 3 }} />);
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
  });

  it('offers Edit and Remove when exactly one prompt is queued', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} />);
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove all' })).toBeNull();
  });

  // #3280 §4 (design follow-up): `cancel-queue` clears the WHOLE queue — with more than one message
  // queued, Edit could only ever restore the shown prompt's text, silently dropping the others. Offer
  // only Remove all once there is more than one, never Edit.
  it('offers only Remove all — no Edit — when more than one prompt is queued', () => {
    render(<Composer {...baseProps()} queued={{ text: 'ping the team', count: 3 }} />);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove all' })).toBeTruthy();
  });

  it('Remove all sends cancel-queue', () => {
    const onCancelQueue = vi.fn();
    render(
      <Composer {...baseProps()} queued={{ text: 'ping the team', count: 3 }} onCancelQueue={onCancelQueue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(onCancelQueue).toHaveBeenCalledTimes(1);
  });

  it('Remove sends cancel-queue', () => {
    const onCancelQueue = vi.fn();
    render(
      <Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} onCancelQueue={onCancelQueue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onCancelQueue).toHaveBeenCalledTimes(1);
  });

  it('Edit sends cancel-queue and restores the text to the draft', () => {
    const onCancelQueue = vi.fn();
    render(
      <Composer {...baseProps()} queued={{ text: 'ping the team', count: 1 }} onCancelQueue={onCancelQueue} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onCancelQueue).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('ping the team');
  });
});

/**
 * #3280 §4: an Enter that only finishes an IME (Korean/Japanese/Chinese) composition must not send —
 * `isComposing` (or `keyCode` 229 on older browsers) marks it, and applies equally to accepting the
 * highlighted `/` command.
 */
describe('Composer — an IME composition Enter never sends', () => {
  afterEach(cleanup);

  it('Enter with isComposing true does not submit, and keeps the draft', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '한글' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('한글');
  });

  it('a plain Enter right after (composition already finished) sends normally', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '한글' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).toHaveBeenCalledWith('한글');
    expect(input.value).toBe('');
  });

  it('keyCode 229 alone (no isComposing) also blocks Enter, for browsers that predate it', () => {
    const onSubmit = vi.fn();
    render(<Composer {...baseProps()} onSubmit={onSubmit} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'still composing' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(input.value).toBe('still composing');
  });

  it('does not accept the highlighted command menu item either', () => {
    render(<Composer {...baseProps()} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/sh' } });
    expect(screen.getByRole('listbox', { name: 'commands' })).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });

    // Still showing the raw typed text, not completed to "/share " (`/shell` is excluded from the
    // menu entirely — #3282 §4e — so it is the only match).
    expect(input.value).toBe('/sh');
    expect(screen.getByRole('listbox', { name: 'commands' })).toBeTruthy();
  });
});

/**
 * #3280 §4: the draft is not lost to a Chat → Usage → Chat switch (the composer unmounts), a page
 * reload, or a desktop relaunch — kept in `localStorage`, per session id, cleared on send.
 */
describe('Composer — the draft survives a remount, per session', () => {
  afterEach(cleanup);

  it('starts empty when nothing was saved', () => {
    render(<Composer {...baseProps()} status={statusFor('s1')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
  });

  it('restores a draft saved under the current session id, on mount', () => {
    window.localStorage.setItem('test-product.draft.s1', 'unsent thought');
    render(<Composer {...baseProps()} status={statusFor('s1')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('unsent thought');
  });

  it('persists as it is typed, so an unmount and remount (the Usage → Chat switch) restores it', () => {
    const { unmount } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'half a sentence' } });
    unmount();

    render(<Composer {...baseProps()} status={statusFor('s1')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('half a sentence');
  });

  it('is cleared from storage (and the field) once sent', () => {
    const { unmount } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'ready to send' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
    unmount();

    expect(window.localStorage.getItem('test-product.draft.s1')).toBeNull();
    render(<Composer {...baseProps()} status={statusFor('s1')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
  });

  it('switching sessions shows the new session\'s own draft, not the old one\'s', () => {
    window.localStorage.setItem('test-product.draft.s2', 'already waiting in session 2');
    const { rerender } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'typing in session 1' } });

    rerender(<Composer {...baseProps()} status={statusFor('s2')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe(
      'already waiting in session 2',
    );
    // Session 1's own draft was not lost — it stayed under its own key.
    expect(storedDraftText(window.localStorage.getItem('test-product.draft.s1'))).toBe('typing in session 1');
  });

  it('switching to a session with nothing saved shows an empty composer', () => {
    const { rerender } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'typing in session 1' } });

    rerender(<Composer {...baseProps()} status={statusFor('s2')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
  });

  /**
   * A real switch goes A → null → B: `session_switched` clears `sessionStatus` before `get-status`
   * answers (`useSessionClient.ts`), so the composer briefly sees no session id at all — not just at
   * the very start of the app. That transient null must not be treated as "no session has ever been
   * known" (the fallback-key migration case, below): once a real session id has been seen, the
   * composer stays bound to it — draft and keystrokes keep going to ITS key — until a new CONCRETE id
   * arrives, so nothing typed during the round trip leaks into whichever session answers next.
   */
  it('a transient null status mid-switch (A -> null -> B) does not leak A\'s draft into B', () => {
    const { rerender } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    rerender(<Composer {...baseProps()} status={null} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'typing during the switch' } });

    rerender(<Composer {...baseProps()} status={statusFor('s2')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('');
    expect(window.localStorage.getItem('test-product.draft.s2')).toBeNull();
    // What was typed mid-switch belongs to s1 (the last known session while typing), not s2.
    expect(storedDraftText(window.localStorage.getItem('test-product.draft.s1'))).toBe('typing during the switch');
  });

  it('B\'s own already-saved draft still shows after the same transient null step', () => {
    window.localStorage.setItem('test-product.draft.s2', 'already waiting in s2');
    const { rerender } = render(<Composer {...baseProps()} status={statusFor('s1')} />);
    rerender(<Composer {...baseProps()} status={null} />);

    rerender(<Composer {...baseProps()} status={statusFor('s2')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe('already waiting in s2');
  });

  it('typed before the session id was known (the fallback key) carries over once it arrives', () => {
    const { rerender } = render(<Composer {...baseProps()} status={null} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: 'typing before connected' } });
    expect(storedDraftText(window.localStorage.getItem('test-product.draft'))).toBe('typing before connected');

    rerender(<Composer {...baseProps()} status={statusFor('s1')} />);
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe(
      'typing before connected',
    );
    expect(storedDraftText(window.localStorage.getItem('test-product.draft.s1'))).toBe('typing before connected');
    expect(window.localStorage.getItem('test-product.draft')).toBeNull();
  });

  it('a storage failure does not throw, and typing still works in memory', () => {
    const originalSetItem = window.localStorage.setItem;
    const originalGetItem = window.localStorage.getItem;
    window.localStorage.setItem = () => {
      throw new Error('storage disabled');
    };
    window.localStorage.getItem = () => {
      throw new Error('storage disabled');
    };
    try {
      expect(() => render(<Composer {...baseProps()} status={statusFor('s1')} />)).not.toThrow();
      const input = screen.getByLabelText('message') as HTMLTextAreaElement;
      expect(() => fireEvent.change(input, { target: { value: 'still typable' } })).not.toThrow();
      expect(input.value).toBe('still typable');
    } finally {
      window.localStorage.setItem = originalSetItem;
      window.localStorage.getItem = originalGetItem;
    }
  });
});

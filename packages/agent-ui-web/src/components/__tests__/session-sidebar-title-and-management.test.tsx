// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionSidebar, sessionTitle } from '../SessionSidebar.js';

import type { IWsSessionState, TSessionListing } from '../../hooks/session-client-types.js';

/**
 * #3289 §1 — a stable title instead of the raw latest reply, no message count, rename in place, and
 * delete with confirmation.
 */

function row(
  id: string,
  fields: { name?: string; title?: string; preview?: string } = {},
): TSessionListing['sessions'][number] {
  return {
    id,
    cwd: '/w',
    updatedAt: '2026-09-26T00:00:00.000Z',
    messageCount: 39,
    preview: fields.preview ?? '## some reply',
    ...(fields.name !== undefined ? { name: fields.name } : {}),
    ...(fields.title !== undefined ? { title: fields.title } : {}),
  };
}

function makeState(overrides: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    sessionListing: {
      currentSessionId: 'cur',
      sessions: [row('cur', { title: 'first request' }), row('other', { title: 'another one' })],
      unreadableSessionIds: [],
    },
    sessionsError: null,
    setSessionSidebarOpen: () => undefined,
    newSession: () => undefined,
    switchSession: () => undefined,
    renameSessionInList: () => undefined,
    deleteSession: () => undefined,
    send: () => undefined,
    ...overrides,
  } as unknown as IWsSessionState;
}

afterEach(cleanup);

describe('sessionTitle (#3289 §1)', () => {
  it('prefers name, then title, then "New session"', () => {
    expect(sessionTitle(row('a', { name: 'Named', title: 'first request' }))).toBe('Named');
    expect(sessionTitle(row('a', { title: 'first request' }))).toBe('first request');
    expect(sessionTitle(row('a', {}))).toBe('New session');
  });

  it('never falls back to preview, which changes every turn', () => {
    expect(sessionTitle(row('a', { preview: '## unstable reply' }))).toBe('New session');
  });
});

describe('SessionSidebar rows (#3289 §1)', () => {
  it('shows the stable title, not the raw preview', () => {
    render(<SessionSidebar state={makeState()} />);
    expect(screen.getByText('first request')).toBeTruthy();
    expect(screen.getByText('another one')).toBeTruthy();
    expect(screen.queryByText(/## some reply/)).toBeNull();
  });

  it('shows no message count', () => {
    render(<SessionSidebar state={makeState()} />);
    expect(screen.queryByText(/39/)).toBeNull();
    expect(screen.queryByText(/msg/)).toBeNull();
  });
});

describe('SessionSidebar inline rename (#3289 §1)', () => {
  it('opens the row menu and starts an inline rename, saving on Enter', () => {
    const send = vi.fn();
    render(<SessionSidebar state={makeState({ send })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for first request' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: 'Rename first request' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My renamed session' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // The current row's rename reuses the `/rename` command path.
    expect(send).toHaveBeenCalledWith({ type: 'command', name: 'rename', args: 'My renamed session' });
    expect(screen.queryByRole('textbox', { name: /Rename/ })).toBeNull();
  });

  it('renames a non-current row through the typed message instead of the command', () => {
    const renameSessionInList = vi.fn();
    const send = vi.fn();
    render(<SessionSidebar state={makeState({ renameSessionInList, send })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename another one' });
    fireEvent.change(input, { target: { value: 'Renamed other' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(renameSessionInList).toHaveBeenCalledWith('other', 'Renamed other');
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels on Escape without renaming', () => {
    const renameSessionInList = vi.fn();
    render(<SessionSidebar state={makeState({ renameSessionInList })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename another one' });
    fireEvent.change(input, { target: { value: 'Should not save' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(renameSessionInList).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: /Rename/ })).toBeNull();
    expect(screen.getByText('another one')).toBeTruthy();
  });
});

describe('SessionSidebar delete confirmation (#3289 §1)', () => {
  it('asks for confirmation, and only sends delete-session on confirming', () => {
    const deleteSession = vi.fn();
    render(<SessionSidebar state={makeState({ deleteSession })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Delete');
    expect(dialog.textContent).toContain('another one');
    expect(within(dialog).getByText(/removes its conversation from this computer/)).toBeTruthy();
    expect(deleteSession).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(deleteSession).toHaveBeenCalledWith('other');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does nothing when Cancel is clicked', () => {
    const deleteSession = vi.fn();
    render(<SessionSidebar state={makeState({ deleteSession })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(deleteSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape without deleting, and restores focus to the row\'s More button', () => {
    const deleteSession = vi.fn();
    render(<SessionSidebar state={makeState({ deleteSession })} />);

    const moreButton = screen.getByRole('button', { name: 'More for another one' });
    fireEvent.click(moreButton);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // The menu item that opened the dialog is already gone by the time it mounts — focus must
    // return to the row's own "More" button, not to whatever the browser fell back to (the body).
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(deleteSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(moreButton);
  });

  it('focuses Cancel when the dialog opens', () => {
    render(<SessionSidebar state={makeState()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('a backdrop click does not delete', () => {
    const deleteSession = vi.fn();
    render(<SessionSidebar state={makeState({ deleteSession })} />);

    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
    // The dialog shell listens for a mousedown directly on its backdrop (the dialog panel's parent).
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);

    expect(deleteSession).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Tab cycles between Cancel and Delete without leaving the dialog', () => {
    render(<SessionSidebar state={makeState()} />);
    fireEvent.click(screen.getByRole('button', { name: 'More for another one' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const del = screen.getByRole('button', { name: 'Delete' });
    expect(document.activeElement).toBe(cancel);

    del.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(del);
  });
});

describe('SessionSidebar row menu accessibility (#3289 §1)', () => {
  it('marks the "More" trigger as a menu popup, expanded only while its menu is open', () => {
    render(<SessionSidebar state={makeState()} />);
    const trigger = screen.getByRole('button', { name: 'More for first request' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Rename' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('SessionSidebar unreadable sessions wording (#3289 §1)', () => {
  it('uses plain singular/plural wording, ids only inside the details', () => {
    render(
      <SessionSidebar
        state={makeState({
          sessionListing: {
            currentSessionId: 'cur',
            sessions: [row('cur', { title: 'first request' })],
            unreadableSessionIds: ['session_broken_1'],
          },
        })}
      />,
    );
    expect(screen.getByText("1 older session in this folder can't be opened")).toBeTruthy();
    // The id is data for someone who opens the details, not something shown at a glance.
    expect(screen.getByText('session_broken_1').closest('details')).toBeTruthy();
  });

  it('pluralizes for more than one', () => {
    render(
      <SessionSidebar
        state={makeState({
          sessionListing: {
            currentSessionId: 'cur',
            sessions: [],
            unreadableSessionIds: ['a', 'b'],
          },
        })}
      />,
    );
    expect(screen.getByText("2 older sessions in this folder can't be opened")).toBeTruthy();
  });
});

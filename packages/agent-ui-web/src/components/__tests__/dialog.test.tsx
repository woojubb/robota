// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog, Dialog } from '../Dialog.js';

/**
 * The shared modal-shell primitive (#3282 §4a) ships without its own generic test coverage; #3289
 * §1's session-delete confirmation is its first consumer here, so this covers the mechanics that
 * consumer relies on directly: focus moved in and restored on close (including through the
 * `restoreFocusTo` override #3289 §1 adds — see `Dialog`'s doc comment), the Tab focus trap, Esc, and
 * a destructive dialog refusing a backdrop-click dismissal.
 */

afterEach(cleanup);

describe('Dialog', () => {
  it('moves focus inside on open and restores it to the opener on close', () => {
    function Harness(): React.ReactElement {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} title="A dialog" onClose={() => setOpen(false)}>
            <button type="button">Inside</button>
          </Dialog>
        </div>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inside' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('restores focus to an explicit restoreFocusTo element instead of the ambient opener (#3289 §1)', () => {
    // Mirrors the session sidebar's row menu: the element that had focus when the dialog opens is
    // gone from the DOM by the time this runs (removed in the same update), so the caller must be
    // able to say explicitly where focus goes back to.
    const target = document.createElement('button');
    target.textContent = 'Elsewhere';
    document.body.appendChild(target);
    try {
      const { unmount } = render(
        <Dialog open title="A dialog" onClose={vi.fn()} restoreFocusTo={target}>
          <button type="button">Inside</button>
        </Dialog>,
      );
      unmount();
      expect(document.activeElement).toBe(target);
    } finally {
      target.remove();
    }
  });

  it('traps Tab within the dialog, wrapping both directions', () => {
    render(
      <Dialog open title="A dialog" onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Esc', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="A dialog" onClose={onClose}>
        <button type="button">Inside</button>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click by default, but not on a mousedown inside the panel', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="A dialog" onClose={onClose}>
        <button type="button">Inside</button>
      </Dialog>,
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Inside' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a destructive dialog is not dismissed by a backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="A dialog" onClose={onClose} destructive>
        <button type="button">Inside</button>
      </Dialog>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ConfirmDialog', () => {
  it('focuses Cancel by default and renders the body', () => {
    render(
      <ConfirmDialog
        open
        title="Delete it?"
        body="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('alertdialog');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(dialog.textContent).toContain('This cannot be undone.');
  });

  it('a destructive confirm is not dismissed by a backdrop click — HIG: answered by its own buttons', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete it?"
        body="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.mouseDown(screen.getByRole('alertdialog').parentElement!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('#3282 §4e: a destructive confirm is an alertdialog, never a plain dialog', () => {
    render(
      <ConfirmDialog
        open
        title="Delete it?"
        body="This cannot be undone."
        confirmLabel="Delete"
        destructive
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a non-destructive confirm IS dismissed by a backdrop click, and is a plain dialog, not an alertdialog', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Proceed?"
        body="Nothing destructive here."
        confirmLabel="OK"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Cancel and Confirm call their own handlers', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Proceed?"
        body="Body text."
        confirmLabel="Do it"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});

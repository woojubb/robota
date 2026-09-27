'use client';

import React, { useEffect, useId, useRef } from 'react';

/**
 * The shared modal-shell primitive (#3282 §4a, coordinated with #3282 §2's model/mode controls,
 * which also need a confirmation dialog). Whichever of the two lands first defines this file; the
 * other rebases onto it rather than shipping a second copy.
 *
 * `role="dialog"`, `aria-modal`, a labelled title, focus moved inside on open, a focus trap while
 * open, Esc to close, and focus restored to whatever had it before the dialog opened. A backdrop
 * click closes the dialog UNLESS `destructive` is set — a destructive dialog (e.g. "Remove this
 * rule?") is dismissed only by an explicit choice, never an accidental outside click.
 */
export interface IDialogProps {
  open: boolean;
  /** Called on Esc, a backdrop click (non-destructive only), or an explicit close control. */
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** Disables backdrop-click-to-close for a dialog whose only correct exits are explicit buttons. */
  destructive?: boolean;
  /** Overrides the panel's own classes; the backdrop/overlay classes are never overridden. */
  panelClassName?: string;
  /** Id of an element describing the dialog, wired to `aria-describedby`. */
  describedById?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Every currently-open `Dialog`, oldest first. All instances share one `document` keydown listener
 * target, so listeners fire in REGISTRATION order regardless of nesting — the outer dialog's
 * listener (registered first, when it opened) always runs before a nested `ConfirmDialog`'s
 * (registered later, when the user triggered it). `stopImmediatePropagation` on the outer listener
 * therefore cannot defer to the inner one; it fires first and would win. Instead, each instance
 * checks this stack and only acts when it is the LAST (topmost) entry — an outer dialog that isn't
 * topmost no-ops on the keydown and lets the still-registered inner listener act.
 */
let openDialogStack: symbol[] = [];

export function Dialog({
  open,
  onClose,
  title,
  children,
  destructive = false,
  panelClassName,
  describedById,
}: IDialogProps): React.ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const dialogToken = useRef<symbol>(Symbol('dialog'));

  // Move focus in on open, and restore it to the opener once the dialog goes away.
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? panel)?.focus();
    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  // Tracks this dialog's membership on the shared open-dialog stack. Kept separate from the
  // keydown-listener effect below (which also depends on `onClose`) so that a caller passing a
  // fresh `onClose` identity on every render can never re-push this dialog and wrongly promote it
  // to topmost — membership changes only when `open` itself flips.
  useEffect(() => {
    if (!open) return undefined;
    const token = dialogToken.current;
    openDialogStack.push(token);
    return () => {
      openDialogStack = openDialogStack.filter((entry) => entry !== token);
    };
  }, [open]);

  // Esc closes; Tab traps focus inside the panel while it is open. Both no-op unless this dialog
  // is the topmost open one (see `openDialogStack` above).
  useEffect(() => {
    if (!open) return undefined;
    const token = dialogToken.current;
    const isTopmost = (): boolean => openDialogStack[openDialogStack.length - 1] === token;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isTopmost()) return;
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="robota-ui fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (destructive) return;
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(describedById ? { 'aria-describedby': describedById } : {})}
        tabIndex={-1}
        className={
          panelClassName ??
          'flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-card text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none'
        }
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

const BUTTON =
  'inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[14px] font-medium transition-colors';
const PRIMARY_BUTTON = `${BUTTON} bg-primary text-primary-foreground hover:opacity-90`;
const SECONDARY_BUTTON = `${BUTTON} bg-raised text-foreground hover:bg-hover`;
const DESTRUCTIVE_BUTTON = `${BUTTON} bg-destructive text-destructive-foreground hover:opacity-90`;

export interface IConfirmDialogProps {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive; the dialog itself also stops closing on a backdrop click. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A title, a body, Cancel focused by default, and a confirm button that can be styled destructive. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: IConfirmDialogProps): React.ReactElement | null {
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      destructive={destructive}
      describedById={bodyId}
      panelClassName="w-full max-w-sm rounded-2xl bg-card p-5 text-card-foreground shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] focus:outline-none"
    >
      <p className="text-[15px] font-medium text-foreground">{title}</p>
      <p id={bodyId} className="mt-2 text-[13.5px] text-muted-foreground">
        {body}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        {/* Cancel is the FIRST focusable element in the panel, so Dialog's open-focus lands here. */}
        <button type="button" className={SECONDARY_BUTTON} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={destructive ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

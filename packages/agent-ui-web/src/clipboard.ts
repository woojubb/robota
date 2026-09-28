import { useEffect, useState } from 'react';

/**
 * Copies `text` to the clipboard for the "Copy code" / "Copy message" buttons (#3289 §2): the async
 * Clipboard API first, and — for a page that denies it (no permission granted yet, a browser that
 * never implements it, or a context that disallows it outright) — a same-tick `execCommand('copy')`
 * fallback through a throwaway, invisible textarea. Rejects only once both have failed, so a caller
 * can show its own "Couldn't copy" message rather than a browser one.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Falls through to the legacy path — some browsers reject outside a user gesture, or before a
      // permission prompt has ever been answered.
    }
  }
  if (!legacyCopy(text)) throw new Error('copy failed');
}

/**
 * `execCommand('copy')` needs a selection in the page, so the text is staged in an offscreen field —
 * which needs focus to be selectable, so whatever had focus (typically the "Copy code" / "Copy
 * message" button a keyboard user just activated) is restored afterward rather than left on `<body>`.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.top = '0';
  field.style.left = '0';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.appendChild(field);
  field.focus();
  field.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(field);
  previouslyFocused?.focus();
  return ok;
}

export type TCopyStatus = 'idle' | 'copied' | 'error';

/** How long the "Copied" / "Couldn't copy" feedback holds before the button reads its normal label again. */
const FEEDBACK_MS = 2000;

/**
 * The "Copy code" / "Copy message" buttons' shared feedback state: `copied` or `error` for a couple of
 * seconds, then back to `idle` — drives both the button's own label swap and an `aria-live` region a
 * screen reader announces without moving focus (#3289 §2).
 */
export function useCopyFeedback(): { status: TCopyStatus; copy: (text: string) => void } {
  const [status, setStatus] = useState<TCopyStatus>('idle');

  useEffect(() => {
    if (status === 'idle') return undefined;
    const timer = setTimeout(() => setStatus('idle'), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const copy = (text: string): void => {
    copyToClipboard(text).then(
      () => setStatus('copied'),
      () => setStatus('error'),
    );
  };

  return { status, copy };
}

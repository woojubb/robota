import { useEffect } from 'react';

import { useProductDisplayName } from './product-display-name-context.js';
import { sanitizeTerminalText } from './sanitize-terminal-text.js';

/**
 * Set the terminal's window title from the session name.
 *
 * Split out of `App.tsx` under SEC-019 (issue #2022) by responsibility: this is the one place the TUI
 * writes an escape sequence to stdout directly rather than through Ink, which makes it the one place
 * where a value is interpolated INTO terminal syntax rather than rendered as content. Keeping it
 * inside a 600-line component is what let it sit unexamined next to code that never touches an
 * escape.
 *
 * `sessionName` is untrusted — a session can be named from a prompt, and a name containing BEL or ESC
 * terminates the OSC early, so everything after it is read by the terminal as its own command.
 *
 * Both the host-selected product name and the session name are sanitized separately from the
 * `\x1b]0;` … `\x07` framing this module deliberately writes.
 */
export function useTerminalTitle(sessionName: string | undefined): void {
  const productDisplayName = useProductDisplayName();
  useEffect(() => {
    const safeName = sanitizeTerminalText(sessionName ?? '');
    const safeProductName = sanitizeTerminalText(productDisplayName);
    const title = safeName ? `${safeProductName} — ${safeName}` : safeProductName;
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [sessionName, productDisplayName]);
}

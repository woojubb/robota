import { useEffect } from 'react';

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
 * Only the NAME is sanitized, not the finished string: the `\x1b]0;` … `\x07` around it is framing
 * this module is deliberately writing, and sanitizing the whole thing would strip it.
 */
export function useTerminalTitle(sessionName: string | undefined): void {
  useEffect(() => {
    const safeName = sanitizeTerminalText(sessionName ?? '');
    const title = safeName ? `Robota — ${safeName}` : 'Robota';
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [sessionName]);
}

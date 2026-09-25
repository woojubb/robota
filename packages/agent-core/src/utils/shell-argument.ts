/**
 * One argument of a command the user is told to paste into a POSIX shell, when it comes from text
 * someone else controls — a server name from a repository's settings, say.
 *
 * A plain token is shown as it is; anything else is single-quoted, so no `;`, `$()`, backtick or
 * space in it can start another command. A value with a control or format character is not shown
 * at all: a newline, an escape sequence or a bidirectional override can make what the terminal
 * displays differ from what is pasted, and no quoting fixes that.
 */

const PLAIN_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;
/** C0 and C1 controls, DEL, line and paragraph separators, and every format character. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSHOWABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/u;

/** The argument as it is safe to paste, or `undefined` when it cannot be shown faithfully. */
export function shellArgumentForDisplay(value: string): string | undefined {
  if (value === '' || UNSHOWABLE.test(value)) return undefined;
  if (PLAIN_ARGUMENT.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

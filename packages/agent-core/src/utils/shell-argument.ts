/**
 * One argument of a command the user is told to paste into a shell, when it comes from text someone
 * else controls — a server name from a repository's settings, say.
 *
 * It is shown only when it is a plain token that reads the same in every shell and cannot be taken
 * for an option or an assignment. Nothing is quoted: quoting rules differ between shells (in fish a
 * backslash escapes inside single quotes), so a quoted name safe in one shell runs a command in
 * another. Anything else is not shown, and the caller names the argument generically instead.
 */

const PLAIN_ARGUMENT = /^[A-Za-z0-9_@%+:,./][A-Za-z0-9_@%+=:,./-]*$/;

/** The argument as it is safe to paste, or `undefined` when it is not. */
export function shellArgumentForDisplay(value: string): string | undefined {
  return PLAIN_ARGUMENT.test(value) ? value : undefined;
}
